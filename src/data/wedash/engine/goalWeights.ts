/** Peso de cada dia da semana na distribuicao da meta (sem dependencias fora do motor). */
import { deIso } from "./format.ts";

/** 0 = domingo ... 6 = sabado (Date#getDay). */
export type Dow = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** null = fechado nesse dia. */
export type DayHours = { open: string; close: string } | null;

export type StoreWeekHours = Record<Dow, DayHours>;

/**
 * Abaixo disso, o dia da semana nao representa a loja (uma segunda com venda
 * residual nao pode ficar com quase nada da meta do mes).
 */
const THIN_WEEKDAY = 0.2;

/**
 * Peso por dia da semana (indice = Dow). Media do faturamento dos dias com venda;
 * dia sem observacao, ou aberto com media muito abaixo do restante, usa a media geral
 * se a loja abre nesse dia, senao 0.
 */
export function weekdayWeights(dayRevenue: Map<string, number>, week: StoreWeekHours): number[] {
  const sum = [0, 0, 0, 0, 0, 0, 0];
  const count = [0, 0, 0, 0, 0, 0, 0];
  for (const [iso, v] of dayRevenue) {
    if (v <= 0) continue;
    const dow = deIso(iso).getDay();
    sum[dow] += v;
    count[dow] += 1;
  }
  const observed = count.reduce((s, c) => s + c, 0);
  const overall = observed > 0 ? sum.reduce((s, v) => s + v, 0) / observed : 1;
  const weights = sum.map((s, dow) => {
    const open = week[dow as Dow] != null;
    if (count[dow] === 0) return open ? overall : 0;
    const avg = s / count[dow];
    if (open && overall > 0 && avg < overall * THIN_WEEKDAY) return overall;
    return avg;
  });
  return weights.some((w) => w > 0) ? weights : [1, 1, 1, 1, 1, 1, 1];
}
