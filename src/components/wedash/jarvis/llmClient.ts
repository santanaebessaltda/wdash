import { getSupabase } from "@/lib/supabase";
import { friendlyStoreLabel, type JarvisContext } from "./context";
import { looksLikeLeakedGoalFacts } from "./goalDraft";
import { compactSeasonalContext } from "./seasonalBrief";
import { runJarvisTool, type JarvisToolName } from "./llmTools";

export type LlmChatMessage = {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  name?: string;
};

export type LlmTurnResult =
  | { ok: true; content: string; sideEffects: LlmSideEffect[] }
  | { ok: false; reason: string };

export type LlmSideEffect =
  | { kind: "draft_challenge"; request: string }
  | { kind: "draft_goal"; request: string }
  | { kind: "draft_schedule"; request: string }
  | { kind: "commit_draft"; target: string }
  | { kind: "discard_draft"; target: string };

/** Estado do app que a IA precisa para continuar o fio (sem keyword routing). */
export type JarvisLlmSession = {
  goalDraftSummary?: string | null;
  goalDraftMissing?: string | null;
  /** true = Gestor já escolheu o mês — NÃO perguntar de novo. */
  goalPeriodConfirmed?: boolean | null;
  goalNextStep?: string | null;
  /** copy | fresh | null — se já definido, não reperguntar copiar vs zero. */
  goalAssemblyPath?: string | null;
  /** A fala deste turno já atualizou o rascunho (ex.: “sim” na cópia). */
  goalTurnApplied?: boolean | null;
  /** JSON operacional completo do rascunho (níveis/grupos/origem) — fonte da verdade. */
  goalOperationalState?: string | null;
  /** ok | failed | null */
  goalCopyStatus?: string | null;
  challengeDraftSummary?: string | null;
  scheduleDraftSummary?: string | null;
  /** Memória de longo prazo (Apagar conversa zera). */
  longTermMemory?: string | null;
};

/** Hooks para aplicar rascunho no app e devolver texto denso à tool (a IA fala depois). */
export type JarvisLlmHooks = {
  onDraftGoal?: (request: string) => Promise<string>;
  onDraftChallenge?: (request: string) => Promise<string>;
  onDraftSchedule?: (request: string) => Promise<string>;
  onCommitDraft?: (target: string) => Promise<string>;
  onDiscardDraft?: (target: string) => Promise<string>;
};

function contextNote(ctx: JarvisContext, session?: JarvisLlmSession | null): string {
  const networkScope =
    ctx.storeIds.length === 0 && ctx.network.length > 1 && ctx.stores.length === ctx.network.length;
  const stores =
    ctx.stores.length === 0
      ? "nenhuma filial no escopo"
      : networkScope
        ? `TODAS AS LOJAS (rede — Topbar sem filtro de filial): ${ctx.stores
            .map((s) => `${friendlyStoreLabel(s)} [id=${s.id}]`)
            .join("; ")}`
        : ctx.stores.map((s) => `${friendlyStoreLabel(s)} [id=${s.id}]`).join("; ");
  const lines = [
    `Hoje: ${ctx.today}. Filiais no escopo: ${stores}. Tenant: ${ctx.tenantId}.`,
    `Datas relativas (ano passado, mês passado, últimos N meses) usam a data de Hoje acima — interprete você.`,
    `Gestor (chame pelo primeiro nome): ${ctx.managerFirstName || "Gestor"}.`,
    `Sazonal/feriados a considerar sozinho (meta/desafio): ${compactSeasonalContext(ctx.today, 2)}.`,
    "Voce redige toda a fala. Tools so executam. Cumprimento = zero tools. Nunca use travessao (—).",
    "Agente: pode chamar varias tools no mesmo raciocinio (vendas, meta, sazonal) antes de propor. Baseie meta/desafio em numeros da tool.",
    "PROIBIDO encerrar só com 'vou buscar/analisar/consultar os dados'. Sempre chame analyze_* ANTES de falar números ou concluir análise.",
    "Nome da filial na fala: use o nome amigável do escopo (não o código LOJAWEPINK...).",
    "Memoria de longo prazo: use remember_fact para preferencias/decisoes duraveis. Apagar conversa zera thread, rascunhos e esta memoria.",
  ];
  if (networkScope || ctx.stores.length > 1) {
    lines.push(
      "Escrita (meta/desafio/escala) e por UMA filial. Com Topbar em Todas ou varias no filtro: PERGUNTE de qual loja — nao invente nem use a primeira da lista.",
    );
  }
  if (session?.longTermMemory) {
    lines.push(`Memoria deste Gestor:\n${session.longTermMemory}`);
  }
  if (session?.goalDraftSummary) {
    lines.push(
      `META em discussao: ${session.goalDraftSummary}. Continue SEMPRE com draft_goal neste fio (valor R$ nao encerra a meta). Gravar = commit_draft target=goal.`,
    );
    if (session.goalPeriodConfirmed) {
      lines.push("Mes ja confirmado. Nao pergunte o mes de novo.");
    } else {
      lines.push("Mes ainda nao confirmado.");
    }
    if (session.goalAssemblyPath) {
      lines.push(
        `Caminho da meta ja definido: ${session.goalAssemblyPath}. NUNCA pergunte de novo se copia escada ou monta do zero.`,
      );
    }
    if (session.goalCopyStatus) {
      lines.push(`copyStatus=${session.goalCopyStatus}. Se ok, a escada JA esta no rascunho — nao busque meta publicada do mes de destino.`);
    }
    if (session.goalOperationalState) {
      lines.push(`ESTADO_OPERACIONAL_META (fonte da verdade):\n${session.goalOperationalState}`);
    }
    if (session.goalNextStep) {
      lines.push(`Proximo passo da meta (um por vez): ${session.goalNextStep}`);
    }
    if (session.goalTurnApplied) {
      lines.push(
        "A fala DESTE turno ja foi aplicada no rascunho. Fale SO o proximo passo acima. NUNCA repita a pergunta anterior (ex.: copiar vs zero).",
      );
    }
    if (session.goalDraftMissing) {
      lines.push(`Campos ainda incompletos: ${session.goalDraftMissing}.`);
    }
    lines.push(
      "PROIBIDO: 'vou montar/preparar', 'um momento', 'qual valor voce esta pensando?'. Voce PROPÕE (proposta_meta / alvo). Ao perguntarem 'como ficou' / niveis, recite ESTADO_OPERACIONAL_META — nao desvie para sazonalidade. Se path ja e copy/fresh, nao repergunte copiar vs zero.",
    );
  }
  if (session?.challengeDraftSummary) {
    lines.push(`DESAFIO aberto (card): ${session.challengeDraftSummary}. Gravar = commit_draft target=challenge.`);
  }
  if (session?.scheduleDraftSummary) {
    lines.push(`ESCALA aberta (card): ${session.scheduleDraftSummary}. Gravar = commit_draft target=schedule.`);
  }
  if (!session?.goalDraftSummary && !session?.challengeDraftSummary && !session?.scheduleDraftSummary) {
    lines.push("Nenhum rascunho aberto no app agora.");
  }
  return lines.join("\n");
}

/** Prometeu analisar/buscar dados sem entregar resultado na mesma fala. */
export function looksLikeUnfinishedAnalysisPromise(text: string): boolean {
  const n = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
  if (!n) return false;
  const promises =
    /vou (buscar|analisar|consultar|olhar|puxar|verificar|checar|levantar|cruzar)|vamos (analisar|consultar|buscar|olhar)|deixa eu (buscar|analisar|consultar|ver|olhar)|buscando (os )?dados|analisando|consultando|ja (vou )?busc/.test(
      n,
    );
  if (!promises) return false;
  // Exige desfecho concreto — "vendas" sozinho na frase da promessa não conta.
  const hasResult =
    /r\$\s*[\d.]|\d[\d.]*\s*mil\b|faturamento.{0,48}\d|ticket.{0,24}\d|recomendo\s+r\$|recomend(o|ada).{0,24}r\$|nao (achei|encontrei|ha dado)|sem (dado|venda) sincroniz|falhou|tente novamente|dias? com venda|insuficiente|fechou em/.test(
      n,
    );
  return !hasResult;
}

const ANALYZE_TOOLS = new Set<string>([
  "analyze_sales",
  "analyze_goal",
  "analyze_stock",
  "analyze_seasonal",
]);

/** Um turno com loop de tools. Side effects (rascunho) o caller aplica se o hook nao aplicou. */
export async function jarvisLlmTurn(
  history: LlmChatMessage[],
  ctx: JarvisContext,
  userText: string,
  session?: JarvisLlmSession | null | (() => JarvisLlmSession | null | undefined),
  hooks?: JarvisLlmHooks | null,
): Promise<LlmTurnResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, reason: "supabase_missing" };

  const resolveSession = () => (typeof session === "function" ? session() : session);
  const messages: LlmChatMessage[] = [...history, { role: "user", content: userText }];
  const sideEffects: LlmSideEffect[] = [];
  const maxRounds = 6;
  let analyzeToolsRan = false;
  let forcedAnalysisOnce = false;

  for (let round = 0; round < maxRounds; round++) {
    const { data, error } = await sb.functions.invoke("jarvis-ai", {
      body: {
        action: "chat",
        messages,
        contextNote: contextNote(ctx, resolveSession()),
      },
    });

    let payload = data as {
      ok?: boolean;
      error?: string;
      type?: string;
      content?: string;
      assistant?: LlmChatMessage;
    } | null;

    // Non-2xx: o client às vezes só traz "Edge Function returned a non-2xx…"; tenta o body.
    if (error && (!payload || payload.ok === false)) {
      try {
        const errCtx = (error as { context?: Response }).context;
        if (errCtx) {
          const body = (await errCtx.clone().json()) as typeof payload;
          if (body && typeof body === "object") payload = body;
        }
      } catch {
        /* ignore */
      }
    }

    if (!payload?.ok) {
      return {
        ok: false,
        reason: payload?.error || error?.message || "jarvis_ai_error",
      };
    }

    if (payload.type === "message") {
      const raw = (payload.content || "").trim();
      const content = raw && !looksLikeLeakedGoalFacts(raw) ? raw : "";

      // Contrato: não aceitar “vou buscar” sem tool real neste turno.
      if (
        content &&
        looksLikeUnfinishedAnalysisPromise(content) &&
        !analyzeToolsRan &&
        !forcedAnalysisOnce
      ) {
        forcedAnalysisOnce = true;
        const forceId = `forced-sales-${Date.now().toString(36)}`;
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: forceId,
              type: "function",
              function: {
                name: "analyze_sales",
                arguments: JSON.stringify({ question: userText }),
              },
            },
          ],
        });
        try {
          const ran = await runJarvisTool("analyze_sales", { question: userText }, ctx, userText);
          analyzeToolsRan = true;
          messages.push({
            role: "tool",
            tool_call_id: forceId,
            name: "analyze_sales",
            content: ran.content,
          });
          messages.push({
            role: "user",
            content:
              "Os dados da tool analyze_sales já estão acima. Conclua AGORA com números reais: recomendação, dados insuficientes (explique o que falta) ou falha amigável. PROIBIDO dizer só que vai buscar/analisar.",
          });
          continue;
        } catch {
          return {
            ok: true,
            content:
              "Não consegui consultar as vendas agora. Pode tentar de novo em instantes?",
            sideEffects,
          };
        }
      }

      return { ok: true, content, sideEffects };
    }

    if (payload.type === "tool_calls" && payload.assistant?.tool_calls?.length) {
      messages.push(payload.assistant);
      // Tools em paralelo — menos espera entre análise e resposta.
      const ranList = await Promise.all(
        payload.assistant.tool_calls.map(async (call) => {
          const name = call.function.name as JarvisToolName;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
          } catch {
            args = {};
          }
          const question = String(args.question ?? args.request ?? userText);
          if (ANALYZE_TOOLS.has(name)) analyzeToolsRan = true;
          if (name === "draft_goal" && hooks?.onDraftGoal) {
            const content = await hooks.onDraftGoal(question);
            return {
              call,
              name,
              ran: { content, sideEffect: { kind: "draft_goal" as const, request: question } },
            };
          }
          if (name === "draft_challenge" && hooks?.onDraftChallenge) {
            const content = await hooks.onDraftChallenge(question);
            return {
              call,
              name,
              ran: { content, sideEffect: { kind: "draft_challenge" as const, request: question } },
            };
          }
          if (name === "draft_schedule" && hooks?.onDraftSchedule) {
            const content = await hooks.onDraftSchedule(question);
            return {
              call,
              name,
              ran: { content, sideEffect: { kind: "draft_schedule" as const, request: question } },
            };
          }
          if (name === "commit_draft" && hooks?.onCommitDraft) {
            const target = String(args.target ?? "goal");
            const content = await hooks.onCommitDraft(target);
            return {
              call,
              name,
              ran: { content, sideEffect: { kind: "commit_draft" as const, target } },
            };
          }
          if (name === "discard_draft" && hooks?.onDiscardDraft) {
            const target = String(args.target ?? "all");
            const content = await hooks.onDiscardDraft(target);
            return {
              call,
              name,
              ran: { content, sideEffect: { kind: "discard_draft" as const, target } },
            };
          }
          const ran = await runJarvisTool(name, args, ctx, userText);
          return { call, name, ran };
        }),
      );
      for (const { call, name, ran } of ranList) {
        if (ran.sideEffect) sideEffects.push(ran.sideEffect);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name,
          content: ran.content,
        });
      }
      continue;
    }

    return { ok: false, reason: "unexpected_response" };
  }

  // Limite de rodadas: ainda assim entrega desfecho de análise (nunca some no silêncio).
  if (!analyzeToolsRan) {
    try {
      const ran = await runJarvisTool("analyze_sales", { question: userText }, ctx, userText);
      const body = (ran.content || "").trim();
      return {
        ok: true,
        content:
          body ||
          "Não achei venda sincronizada para essa consulta. Vale conferir o sync ou o filtro de filial.",
        sideEffects,
      };
    } catch {
      return {
        ok: true,
        content: "Não consegui consultar as vendas agora. Pode tentar de novo em instantes?",
        sideEffects,
      };
    }
  }
  return {
    ok: true,
    content:
      "A consulta ficou longa demais neste turno. Pode tentar de novo? Posso retomar a análise das vendas.",
    sideEffects,
  };
}

/** Whisper via Edge. audioBase64 sem prefixo data:. */
export async function jarvisTranscribe(audioBase64: string, mime: string): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, reason: "supabase_missing" };
  const { data, error } = await sb.functions.invoke("jarvis-ai", {
    body: { action: "transcribe", audioBase64, mime },
  });
  if (error) return { ok: false, reason: error.message || "invoke_failed" };
  const payload = data as { ok?: boolean; error?: string; text?: string } | null;
  if (!payload?.ok || !payload.text) return { ok: false, reason: payload?.error || "empty_transcript" };
  return { ok: true, text: payload.text };
}

/** TTS via Edge (default OpenAI cedar masculina; Gemini se JARVIS_TTS_PROVIDER=gemini). */
export async function jarvisSpeak(
  text: string,
): Promise<{ ok: true; audioBase64: string; mime: string } | { ok: false; reason: string }> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty_text" };
  const sb = getSupabase();
  if (!sb) return { ok: false, reason: "supabase_missing" };
  const { data, error } = await sb.functions.invoke("jarvis-ai", {
    body: { action: "speak", text: trimmed },
  });
  if (error) return { ok: false, reason: error.message || "invoke_failed" };
  const payload = data as { ok?: boolean; error?: string; audioBase64?: string; mime?: string } | null;
  if (!payload?.ok || !payload.audioBase64) {
    return { ok: false, reason: payload?.error || "empty_audio" };
  }
  return {
    ok: true,
    audioBase64: payload.audioBase64,
    mime: payload.mime || "audio/mpeg",
  };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const i = result.indexOf(",");
      resolve(i >= 0 ? result.slice(i + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsDataURL(blob);
  });
}
