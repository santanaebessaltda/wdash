import { fimDoMes, inicioDoMes, somarDias } from "./engine/format.ts";

/** Do dia 1 do mês de `monthDay` até ontem, ou até o fim do mês se ele já passou. */
export function monthCloseSpanFor(monthDay: string, today: string): { from: string; to: string } | null {
  const from = inicioDoMes(monthDay);
  const yesterday = somarDias(today, -1);
  const end = fimDoMes(monthDay);
  const to = end < yesterday ? end : yesterday;
  if (from > to) return null;
  return { from, to };
}

/** Do dia 1 do mês até ontem. No dia 1 ainda não há fechamento deste mês. */
export function monthCloseSpan(today: string): { from: string; to: string } | null {
  return monthCloseSpanFor(today, today);
}

/** Dias do intervalo, até ontem, que ainda não têm fechamento gravado. */
export function missingCloseDays(from: string, to: string, today: string, filled: ReadonlySet<string>): string[] {
  const yesterday = somarDias(today, -1);
  const end = to < yesterday ? to : yesterday;
  if (from > end) return [];
  const out: string[] = [];
  for (let day = from; day <= end; day = somarDias(day, 1)) {
    if (!filled.has(day)) out.push(day);
  }
  return out;
}
