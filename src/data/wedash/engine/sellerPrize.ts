/** Premiacao do vendedor: ganho ao chegar no proximo nivel e projecao pelo ritmo (regra da Visao geral). */
import { isoToDate, eachDay } from "./format.ts";
import type { GoalRecord } from "./goalTypes.ts";
import type { SellerGoalLevel } from "./goalView.ts";

/** Parte da pessoa na premiacao: 1 no modo Individual; no Grupo, dividida igualmente entre as pessoas do grupo. */
function share(level: SellerGoalLevel, groupSize: number): number {
  return level.modo === "individual" ? 1 : 1 / Math.max(1, groupSize);
}

/** Premiacao no proximo nivel sobre as vendas atuais  premiacao agora + bonus do proximo nivel; null no ultimo nivel. */
export function nextLevelGain(level: SellerGoalLevel, groupSize: number): number | null {
  if (!level.next) return null;
  const inNext = ((level.achieved * level.next.commissionPct) / 100) * share(level, groupSize);
  return inNext - level.prizeAmount + level.next.bonus;
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
  if (level.goalAmount <= 0) return null;
  let total = 0;
  let closed = 0;
  for (const iso of eachDay(goal.startsOn, goal.endsOn)) {
    const w = input.weights[isoToDate(iso).getDay()] ?? 0;
    total += w;
    if (iso < input.today) closed += w;
  }
  if (total <= 0 || closed < total / 2) return null;
  const projected = (input.soldUntilYesterday * total) / closed;
  const pct = (projected / level.goalAmount) * 100;
  let idx = -1;
  goal.tiers.forEach((t, i) => {
    if (pct >= t.minAttainmentPct && i === idx + 1) idx = i;
  });
  if (idx < 0) return 0;
  const prizeAmount = ((projected * goal.tiers[idx]!.commissionPct) / 100) * share(level, input.groupSize);
  return prizeAmount + goal.tiers.slice(0, idx + 1).reduce((s, t) => s + t.bonus, 0);
}

export interface GoalCeilingTier {
  name: string;
  minAttainmentPct: number;
  commissionPct: number;
  bonus: number;
}

export interface GoalCeiling {
  /** Reais que ainda dá para conquistar até o último nível. Zero se a meta fechou ou ela já está nele. */
  upside: number;
  /** Ganho ao fechar a folga do próximo nível (venda no piso desse nível), não o ritmo atual. */
  next: { name: string; number: number; gap: number; prizeGain: number; bonusGain: number } | null;
}

/**
 * Teto da meta aberta. O percentual do último nível substitui os anteriores; o bônus de cada nível acumula.
 * A parte dela sai da premiação que já tem; sem premiação, divide igual pelo tamanho do grupo.
 * O bônus segue a fração que ela já recebe; sem bônus ainda, conta o bônus inteiro.
 */
export function goalCeiling(input: {
  open: boolean;
  achieved: number;
  goalAmount: number;
  prizeNow: number;
  bonusNow: number;
  currentPct: number;
  groupSize: number;
  tiers: GoalCeilingTier[];
}): GoalCeiling {
  const none: GoalCeiling = { upside: 0, next: null };
  if (!input.open || input.goalAmount <= 0 || input.tiers.length === 0) return none;
  const heads = Math.max(1, input.groupSize);
  let idx = -1;
  const pct = (input.achieved / input.goalAmount) * 100;
  input.tiers.forEach((tier, i) => {
    if (pct >= tier.minAttainmentPct && i === idx + 1) idx = i;
  });
  const baseNow = (input.achieved * input.currentPct) / 100;
  const factor = input.prizeNow > 0 && baseNow > 0 ? input.prizeNow / baseNow : 1 / heads;
  const reachedBonus = input.tiers.slice(0, idx + 1).reduce((sum, tier) => sum + tier.bonus, 0);
  const fraction = reachedBonus > 0 && input.bonusNow > 0 ? Math.min(1, input.bonusNow / reachedBonus) : 1;
  const last = input.tiers[input.tiers.length - 1]!;
  const arrival = Math.max(input.achieved, (input.goalAmount * last.minAttainmentPct) / 100);
  const prizeTop = ((arrival * last.commissionPct) / 100) * factor;
  const bonusTop = input.tiers.reduce((sum, tier) => sum + tier.bonus, 0) * fraction;
  const upside = Math.max(0, prizeTop - input.prizeNow) + Math.max(0, bonusTop - input.bonusNow);
  if (!Number.isFinite(upside)) return none;
  const step = idx + 1 < input.tiers.length ? input.tiers[idx + 1] : null;
  if (!step) return { upside, next: null };
  const threshold = (input.goalAmount * step.minAttainmentPct) / 100;
  const prizeAt = ((threshold * step.commissionPct) / 100) * factor;
  return {
    upside,
    next: {
      name: step.name,
      number: idx + 2,
      gap: Math.max(0, threshold - input.achieved),
      prizeGain: Math.max(0, prizeAt - input.prizeNow),
      bonusGain: Math.max(0, step.bonus * fraction),
    },
  };
}
