import { getSupabase } from "@/lib/supabase";
import type { JarvisContext } from "./context";
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
  | { kind: "draft_schedule"; request: string };

/** Estado do app que a IA precisa para continuar o fio (sem keyword routing). */
export type JarvisLlmSession = {
  goalDraftSummary?: string | null;
  goalDraftMissing?: string | null;
  challengeDraftSummary?: string | null;
  scheduleDraftSummary?: string | null;
};

/** Hooks para aplicar rascunho no app e devolver texto denso à tool (a IA fala depois). */
export type JarvisLlmHooks = {
  onDraftGoal?: (request: string) => Promise<string>;
  onDraftChallenge?: (request: string) => Promise<string>;
  onDraftSchedule?: (request: string) => Promise<string>;
};

function contextNote(ctx: JarvisContext, session?: JarvisLlmSession | null): string {
  const stores =
    ctx.stores.length === 0
      ? "nenhuma filial no escopo"
      : ctx.stores.map((s) => `${s.tradeName || s.name} (${s.code || s.id})`).join("; ");
  const lines = [
    `Hoje: ${ctx.today}. Filiais no escopo: ${stores}. Tenant: ${ctx.tenantId}.`,
    `Gestor (chame pelo primeiro nome): ${ctx.managerFirstName || "Gestor"}.`,
    `Sazonal/feriados a considerar sozinho (meta/desafio): ${compactSeasonalContext(ctx.today, 2)}.`,
    "Interprete a intenção pelo histórico + mensagem atual. Não roteie por palavra isolada.",
    "Você escreve TODA a fala ao Gestor. Tools só trazem dado/estado. Nunca use travessão (—).",
    "Cumprimento (oi/e aí): cumprimente pelo nome e pergunte o que precisa. NÃO liste menu (vendas, estoque, meta…).",
    "Ao montar meta ou desafio, ja leve sazonal/feriado na sugestao de valor quando couber (1 frase).",
  ];
  if (session?.goalDraftSummary) {
    lines.push(
      `Proposta de META em discussao (so texto, sem card): ${session.goalDraftSummary}. Continuacao = draft_goal. Confirmacao curta (cria a meta/autorizo) grava rascunho em Metas. Nao invente que ja gravou.`,
    );
    if (session.goalDraftMissing) {
      lines.push(`Ainda faltando na meta: ${session.goalDraftMissing}. Pergunte isso de forma natural.`);
    }
  }
  if (session?.challengeDraftSummary) {
    lines.push(`Rascunho de DESAFIO (produto/disputa) aberto: ${session.challengeDraftSummary}.`);
  }
  if (session?.scheduleDraftSummary) {
    lines.push(`Rascunho de ESCALA aberto: ${session.scheduleDraftSummary}.`);
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
  session?: JarvisLlmSession | null,
  hooks?: JarvisLlmHooks | null,
): Promise<LlmTurnResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, reason: "supabase_missing" };

  const messages: LlmChatMessage[] = [...history, { role: "user", content: userText }];
  const sideEffects: LlmSideEffect[] = [];
  const maxRounds = 4;

  for (let round = 0; round < maxRounds; round++) {
    const { data, error } = await sb.functions.invoke("jarvis-ai", {
      body: {
        action: "chat",
        messages,
        contextNote: contextNote(ctx, session),
      },
    });

    const payload = data as {
      ok?: boolean;
      error?: string;
      type?: string;
      content?: string;
      assistant?: LlmChatMessage;
    } | null;

    if (error && !payload) {
      return { ok: false, reason: error.message || "invoke_failed" };
    }

    if (!payload?.ok) {
      return { ok: false, reason: payload?.error || error?.message || "jarvis_ai_error" };
    }

    if (payload.type === "message" && payload.content) {
      return { ok: true, content: payload.content, sideEffects };
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
