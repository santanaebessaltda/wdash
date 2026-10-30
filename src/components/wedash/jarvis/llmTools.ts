import type { JarvisContext } from "./context";
import { loadGoalBrief } from "./goalBrief";
import { loadSalesBrief } from "./salesBrief";
import { loadSeasonalBrief } from "./seasonalBrief";
import { loadStockStalledBrief } from "./stockStalled";
import type { LlmSideEffect } from "./llmClient";

export type JarvisToolName =
  | "analyze_sales"
  | "analyze_goal"
  | "analyze_stock"
  | "analyze_seasonal"
  | "draft_challenge"
  | "draft_goal"
  | "draft_schedule"
  | "commit_draft"
  | "discard_draft";

export async function runJarvisTool(
  name: JarvisToolName,
  args: Record<string, unknown>,
  ctx: JarvisContext,
  fallbackQuestion: string,
): Promise<{ content: string; sideEffect?: LlmSideEffect }> {
  const question = String(args.question ?? args.request ?? fallbackQuestion);
  const target = String(args.target ?? "goal");

  switch (name) {
    case "analyze_sales":
      return { content: await loadSalesBrief(ctx, question) };
    case "analyze_goal":
      return { content: await loadGoalBrief(ctx, question) };
    case "analyze_stock":
      return { content: await loadStockStalledBrief(ctx, question) };
    case "analyze_seasonal":
      return {
        content:
          loadSeasonalBrief(ctx.today) +
          " Use isso ao sugerir meta/desafio do periodo — nao espere o Gestor citar Black Friday ou feriado.",
      };
    case "draft_challenge":
      return {
        content: "Rascunho de desafio será montado no app; o Gestor precisa autorizar para gravar.",
        sideEffect: { kind: "draft_challenge", request: question },
      };
    case "draft_goal":
      return {
        content:
          "Proposta de meta atualizada no app (so texto, sem card). Use o estado interno se o hook nao tiver devolvido fatos. Para GRAVAR use commit_draft. Fale naturalmente o proximo passo.",
        sideEffect: { kind: "draft_goal", request: question },
      };
    case "draft_schedule":
      return {
        content: "Rascunho de escala será montado no app; o Gestor precisa autorizar para gravar.",
        sideEffect: { kind: "draft_schedule", request: question },
      };
    case "commit_draft":
      return {
        content: "Hook do app deve gravar o rascunho; se este texto aparecer, o hook falhou.",
        sideEffect: { kind: "commit_draft", target },
      };
    case "discard_draft":
      return {
        content: "Hook do app deve descartar o rascunho; se este texto aparecer, o hook falhou.",
        sideEffect: { kind: "discard_draft", target },
      };
    default:
      return { content: "Tool desconhecida." };
  }
}
