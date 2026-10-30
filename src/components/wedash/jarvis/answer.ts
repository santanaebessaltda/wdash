import type { JarvisContext } from "./context";
import { loadGoalBrief } from "./goalBrief";
import { classifyIntent, jarvisReply } from "./respond";
import { loadSalesBrief } from "./salesBrief";
import { loadSeasonalBrief } from "./seasonalBrief";
import { loadStockStalledBrief } from "./stockStalled";

/**
 * Resposta do JARVIS. Intents de leitura usam a camada de métricas;
 * desafio / meta / escala com Autorizar ficam no `Jarvis` (discuss* + commit*).
 */
export async function jarvisAnswer(question: string, ctx: JarvisContext): Promise<string> {
  const intent = classifyIntent(question);
  switch (intent) {
    case "analyze_sales":
      return loadSalesBrief(ctx, question);
    case "analyze_goal":
      return loadGoalBrief(ctx, question);
    case "analyze_stock":
      return loadStockStalledBrief(ctx, question);
    case "seasonal":
      return loadSeasonalBrief(ctx.today);
    case "capability":
      return jarvisReply(question, ctx.managerFirstName);
    case "greeting":
      return jarvisReply(question, ctx.managerFirstName);
    default:
      return jarvisReply(question, ctx.managerFirstName);
  }
}
