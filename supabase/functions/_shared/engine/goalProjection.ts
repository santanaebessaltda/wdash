/** Projecao de fechamento da meta da loja: a mesma conta do card Atingimento e do detalhe. */
import { addDays, eachDay, isoToDate } from "./format.ts";
import { weekdayWeights, type StoreWeekHours } from "./goalWeights.ts";

/** Semanas de historico antes do inicio da meta para o peso de cada dia da semana. */
export const GOAL_CURVE_WEEKS = 6;

/** Primeiro dia do historico da curva (6 semanas antes do inicio da meta). */
export function goalWeightFrom(startsOn: string): string {
  return addDays(startsOn, -GOAL_CURVE_WEEKS * 7);
}

/**
 * Peso por dia da semana a partir do faturamento das 6 semanas anteriores ao inicio.
 * Dia fora dessa janela nao entra. Sem historico, o horario da loja define o que abre.
 */
export function goalWeekdayWeights(
  days: Iterable<{ day: string; revenue: number }>,
  startsOn: string,
  week: StoreWeekHours,
): number[] {
  const from = goalWeightFrom(startsOn);
  const to = addDays(startsOn, -1);
  const hist = new Map<string, number>();
  for (const d of days) {
    if (d.revenue <= 0 || d.day < from || d.day > to) continue;
    hist.set(d.day, (hist.get(d.day) ?? 0) + d.revenue);
  }
  return weekdayWeights(hist, week);
}

/**
 * Fechamento se o ritmo dos dias ja encerrados se mantiver.
 * Vendido ate ontem x peso de todos os dias da meta / peso dos dias fechados.
 * null antes de metade do peso da meta, antes de comecar ou depois de encerrar.
 */
export function goalClosingProjection(input: {
  target: number;
  startsOn: string;
  endsOn: string;
  today: string;
  soldByDay: ReadonlyMap<string, number>;
  /** Peso por dia da semana (0 = domingo). Ausente = todos os dias iguais. */
  weights?: readonly number[];
}): { amount: number; pct: number } | null {
  const { target, startsOn, endsOn, today } = input;
  if (target <= 0 || today <= startsOn || today > endsOn) return null;
  const weights = input.weights?.some((w) => w > 0) ? input.weights : [1, 1, 1, 1, 1, 1, 1];
  let total = 0;
  let closed = 0;
  let sold = 0;
  for (const iso of eachDay(startsOn, endsOn)) {
    const w = weights[isoToDate(iso).getDay()] ?? 0;
    total += w;
    if (iso < today) {
      closed += w;
      sold += input.soldByDay.get(iso) ?? 0;
    }
  }
  if (total <= 0 || closed < total / 2) return null;
  const amount = (sold * total) / closed;
  return { amount, pct: (amount / target) * 100 };
}

/** A projecao da filial. `dayAggs` pode incluir as 6 semanas anteriores; o vendido da meta para em ontem. */
export function goalStoreClosing(
  goal: { target: number; storeId: string; startsOn: string; endsOn: string },
  dayAggs: { storeId: string; day: string; revenueCents: number }[],
  today: string,
  week?: StoreWeekHours,
): { amount: number; pct: number } | null {
  const sold = new Map<string, number>();
  const hist: { day: string; revenue: number }[] = [];
  for (const a of dayAggs) {
    if (a.storeId !== goal.storeId) continue;
    const revenue = a.revenueCents / 100;
    hist.push({ day: a.day, revenue });
    if (a.day >= goal.startsOn && a.day < today && a.day <= goal.endsOn) {
      sold.set(a.day, (sold.get(a.day) ?? 0) + revenue);
    }
  }
  return goalClosingProjection({
    target: goal.target,
    startsOn: goal.startsOn,
    endsOn: goal.endsOn,
    today,
    soldByDay: sold,
    weights: week ? goalWeekdayWeights(hist, goal.startsOn, week) : undefined,
  });
}
