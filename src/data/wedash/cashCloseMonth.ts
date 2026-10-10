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

/**
 * Fechamento e sangria começam no mês em que a conta entrou na WDash.
 * Nada anterior a outubro/2026: a regra antiga tinha puxado esse histórico.
 */
export const CLOSE_HISTORY_START = "2026-10-01";

export function closeHistoryFloor(joinedOn: string): string {
  const month = `${joinedOn.slice(0, 10).slice(0, 7)}-01`;
  return month > CLOSE_HISTORY_START ? month : CLOSE_HISTORY_START;
}

/** Recorta o intervalo para o chão. `null` quando o período inteiro é anterior. */
export function clampCloseRange(from: string, to: string, floor: string): { from: string; to: string } | null {
  const start = from < floor ? floor : from;
  if (start > to) return null;
  return { from: start, to };
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
