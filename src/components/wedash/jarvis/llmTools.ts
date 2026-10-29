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
  | "draft_schedule";

export async function runJarvisTool(
  name: JarvisToolName,
  args: Record<string, unknown>,
  ctx: JarvisContext,
  fallbackQuestion: string,
): Promise<{ content: string; sideEffect?: LlmSideEffect }> {
  const question = String(args.question ?? args.request ?? fallbackQuestion);

  switch (name) {
    case "analyze_sales":
      return { content: await loadSalesBrief(ctx, question) };
    case "analyze_goal":
      return { content: await loadGoalBrief(ctx, question) };
    case "analyze_stock":
      return { content: await loadStockStalledBrief(ctx, question) };
    case "analyze_seasonal":
      return { content: loadSeasonalBrief(ctx.today) };
    case "draft_challenge":
      return {
        content: "Rascunho de desafio será montado no app; o Gestor precisa autorizar para gravar.",
        sideEffect: { kind: "draft_challenge", request: question },
      };
    case "draft_goal":
      return {
        content: "Rascunho de meta sera montado; se o pedido for confirmar/criar e estiver completo, o app grava em Metas como rascunho.",
        sideEffect: { kind: "draft_goal", request: question },
      };
    case "draft_schedule":
      return {
        content: "Rascunho de escala será montado no app; o Gestor precisa autorizar para gravar.",
        sideEffect: { kind: "draft_schedule", request: question },
      };
    default:
      return { content: "Tool desconhecida." };
  }
}
