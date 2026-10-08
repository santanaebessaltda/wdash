/**
 * Curva da meta  -  distribui a meta mensal da loja pelos dias e horas
 * conforme o peso historico de faturamento (Faturamento x meta, Visao Geral).
 *
 * - Dia: meta do mes x peso do dia da semana   pesos dos dias do mes.
 * - Hora: meta do dia x participacao historica da hora no expediente.
 * Sem historico  ->  divisao igual (dias abertos / horas do expediente).
 */
import { deIso, fimDoMes, inicioDoMes, intervaloDias, somarDias } from "@/lib/format";
import { closeHourCeil, openHourFloor, type Dow, type StoreWeekHours } from "./storeHours";

export { weekdayWeights } from "./engine/goalWeights";

/** Semanas de historico usadas para a curva. */
export const GOAL_CURVE_WEEKS = 6;

/** Dias do historico (antes do periodo) para o peso por dia da semana. */
export function goalHistoryDayRange(periodStart: string): { from: string; to: string } {
  return { from: somarDias(periodStart, -GOAL_CURVE_WEEKS * 7), to: somarDias(periodStart, -1) };
}

/** Mesmo dia da semana nas semanas anteriores (curva por hora). */
export function goalHistorySameWeekdays(day: string): string[] {
  const out: string[] = [];
  for (let w = 1; w <= GOAL_CURVE_WEEKS; w++) out.push(somarDias(day, -7 * w));
  return out;
}

/** Meta de um dia a partir da meta do mes e dos pesos por dia da semana. */
export function dailyGoal(monthlyGoal: number, iso: string, weights: number[]): number {
  return periodDailyGoal(monthlyGoal, inicioDoMes(iso), fimDoMes(iso), iso, weights);
}

/** Meta de um dia a partir da meta de um periodo (datas da meta) e dos pesos por dia da semana; 0 fora do periodo. */
export function periodDailyGoal(target: number, from: string, to: string, iso: string, weights: number[]): number {
  if (target <= 0 || iso < from || iso > to) return 0;
  const total = intervaloDias(from, to).reduce((s, d) => s + (weights[deIso(d).getDay()] ?? 0), 0);
  if (total <= 0) return 0;
  return (target * (weights[deIso(iso).getDay()] ?? 0)) / total;
}

/**
 * Participacao de cada hora (h = h:00 - h:59) no expediente do dia. Soma 1.
 * Horas fora do expediente ficam de fora; sem historico no expediente  ->  divisao igual.
 */
export function hourShares(
  hourRevenue: Map<number, number>,
  week: StoreWeekHours,
  dow: Dow,
): Map<number, number> {
  const out = new Map<number, number>();
  let open = openHourFloor(week[dow]);
  let close = closeHourCeil(week[dow]);
  if (open == null || close == null || close <= open) {
    // Fechado no cadastro mas com venda historica: usa as horas que venderam.
    const sold = [...hourRevenue].filter(([, v]) => v > 0).map(([h]) => h);
    if (sold.length === 0) return out;
    open = Math.min(...sold);
    close = Math.max(...sold) + 1;
  }
  let total = 0;
  for (let h = open; h < close; h++) total += Math.max(0, hourRevenue.get(h) ?? 0);
  for (let h = open; h < close; h++) {
    out.set(h, total > 0 ? Math.max(0, hourRevenue.get(h) ?? 0) / total : 1 / (close - open));
  }
  return out;
}
