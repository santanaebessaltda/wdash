/** Premiacao do vendedor: ganho ao chegar no proximo nivel e projecao pelo ritmo (regra da Visao geral). */
import { deIso, intervaloDias } from "./format.ts";
import type { GoalRecord } from "./goalTypes.ts";
import type { SellerGoalLevel } from "./goalView.ts";

/** Parte da pessoa na premiacao: 1 no modo Individual; no Grupo, dividida igualmente entre as pessoas do grupo. */
function share(level: SellerGoalLevel, groupSize: number): number {
  return level.modo === "individual" ? 1 : 1 / Math.max(1, groupSize);
}

/** Premiacao no proximo nivel sobre as vendas atuais  premiacao agora + bonus do proximo nivel; null no ultimo nivel. */
export function nextLevelGain(level: SellerGoalLevel, groupSize: number): number | null {
  if (!level.proximo) return null;
  const noProximo = ((level.realizado * level.proximo.comissaoPct) / 100) * share(level, groupSize);
  return noProximo - level.premiacao + level.proximo.bonus;
}

/**
 * Premiacao + bonus se mantiver o ritmo: vendido ate ontem  peso dos dias fechados x peso de todos os dias da meta.
 * So depois de metade do peso da meta ter passado; antes disso null. Modo Grupo = vendido do grupo.
 */
export function projectedPrize(
  goal: GoalRecord,
  level: SellerGoalLevel,
  input: { today: string; weights: number[]; soldUntilYesterday: number; groupSize: number },
): number | null {
  if (level.metaValor <= 0) return null;
  let total = 0;
  let closed = 0;
  for (const iso of intervaloDias(goal.startsOn, goal.endsOn)) {
    const w = input.weights[deIso(iso).getDay()] ?? 0;
    total += w;
    if (iso < input.today) closed += w;
  }
  if (total <= 0 || closed < total / 2) return null;
  const projetado = (input.soldUntilYesterday * total) / closed;
  const pct = (projetado / level.metaValor) * 100;
  let idx = -1;
  goal.tiers.forEach((t, i) => {
    if (pct >= t.atingimentoMinPct && i === idx + 1) idx = i;
  });
  if (idx < 0) return 0;
  const premiacao = ((projetado * goal.tiers[idx]!.comissaoPct) / 100) * share(level, input.groupSize);
  return premiacao + goal.tiers.slice(0, idx + 1).reduce((s, t) => s + t.bonus, 0);
}
