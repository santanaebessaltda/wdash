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
      return (
        "Eu leio a mesma base do Dashboard, aponto sazonal e monto meta, desafio e escala com você. " +
        "Também te levo pra qualquer tela do menu. Gravar só depois do seu Autorizar — pode perguntar vendas, estoque parado ou o que vem de sazonal."
      );
    default:
      return jarvisReply(question);
  }
}
