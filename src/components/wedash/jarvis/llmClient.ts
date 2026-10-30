import { getSupabase } from "@/lib/supabase";
import type { JarvisContext } from "./context";
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
  challengeDraftSummary?: string | null;
  scheduleDraftSummary?: string | null;
  /** Memória de longo prazo (não some com Apagar conversa). */
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
  const stores =
    ctx.stores.length === 0
      ? "nenhuma filial no escopo"
      : ctx.stores.map((s) => `${s.tradeName || s.name} (${s.code || s.id})`).join("; ");
  const lines = [
    `Hoje: ${ctx.today}. Filiais no escopo: ${stores}. Tenant: ${ctx.tenantId}.`,
    `Datas relativas (ano passado, mês passado, últimos N meses) usam a data de Hoje acima — interprete você.`,
    `Gestor (chame pelo primeiro nome): ${ctx.managerFirstName || "Gestor"}.`,
    `Sazonal/feriados a considerar sozinho (meta/desafio): ${compactSeasonalContext(ctx.today, 2)}.`,
    "Voce redige toda a fala. Tools so executam. Cumprimento = zero tools. Nunca use travessao (—).",
    "Agente: pode chamar varias tools no mesmo raciocinio (vendas, meta, sazonal) antes de propor. Baseie meta/desafio em numeros da tool.",
    "Memoria de longo prazo: use remember_fact para preferencias/decisoes duraveis; Apagar conversa NAO apaga isso.",
  ];
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
      "Nao diga 'vou preparar' sem draft_goal. Avance checklist[0] so. Se path ja e copy/fresh, nao repergunte copiar vs zero.",
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

/** Um turno com loop de tools (máx. 3). Side effects (rascunho) o caller aplica se o hook nao aplicou. */
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
        const ctx = (error as { context?: Response }).context;
        if (ctx) {
          const body = (await ctx.clone().json()) as typeof payload;
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
      // Vazio ou vazamento → ok com content vazio; o Provider pede pra mandar de novo.
      const content = raw && !looksLikeLeakedGoalFacts(raw) ? raw : "";
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

  return { ok: false, reason: "tool_loop_limit" };
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
