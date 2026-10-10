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

/** Sangria do mês visível, do dia 1 até hoje (ou até o fim do mês, se ele já passou). */
export function sangriaMonthSpan(monthDay: string, today: string): { from: string; to: string } | null {
  const from = inicioDoMes(monthDay);
  const end = fimDoMes(monthDay);
  const to = end < today ? end : today;
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

/**
 * Primeiro mês que a tela deixa abrir.
 * Sem lançamento no mês anterior já fechado, só o mês de `today`.
 * Com lançamento nesse mês, abre desde o mês mais antigo que ainda tem dado.
 */
export function navMonthFloor(today: string, oldestDay: string | null, newestPastDay: string | null): string {
  const current = inicioDoMes(today);
  const [y, m] = current.split("-").map(Number);
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  const previous = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
  const newest = newestPastDay?.slice(0, 10) ?? "";
  if (!newest || inicioDoMes(newest) !== previous) return current;
  const oldest = inicioDoMes(oldestDay && oldestDay.slice(0, 10) < current ? oldestDay : previous);
  return oldest > current ? current : oldest;
}

/** Recorta o intervalo para o chão. `null` quando o período inteiro é anterior. */
export function clampCloseRange(from: string, to: string, floor: string): { from: string; to: string } | null {
  const start = from < floor ? floor : from;
  if (start > to) return null;
  return { from: start, to };
}

export type CashCloseJobPart = "sangria" | "close" | "both";

/** O job da tela espera o pedido dela. Um passeio sem parte (madrugada) serve as duas. */
export function cashCloseJobMatches(
  payload: { cashOnly?: unknown; part?: unknown } | null | undefined,
  part: "sangria" | "close",
): boolean {
  if (payload?.cashOnly !== true) return false;
  const got = payload.part;
  if (got == null || got === "both") return true;
  return got === part;
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
