import { endOfMonth, startOfMonth, addDays } from "./engine/format.ts";

/** Meses civis que o intervalo toca, do primeiro ao último, inclusive. */
export function monthsTouched(from: string, to: string): string[] {
  const start = startOfMonth(from <= to ? from : to);
  const end = startOfMonth(from <= to ? to : from);
  const months: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    months.push(cursor);
    const [year, month] = cursor.split("-").map(Number);
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    cursor = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  }
  return months;
}

/** Do dia 1 do mês de `monthDay` até ontem, ou até o fim do mês se ele já passou. */
export function monthCloseSpanFor(monthDay: string, today: string): { from: string; to: string } | null {
  const from = startOfMonth(monthDay);
  const yesterday = addDays(today, -1);
  const end = endOfMonth(monthDay);
  const to = end < yesterday ? end : yesterday;
  if (from > to) return null;
  return { from, to };
}

/** Sangria do mês visível, do dia 1 até hoje (ou até o fim do mês, se ele já passou). */
export function sangriaMonthSpan(monthDay: string, today: string): { from: string; to: string } | null {
  const from = startOfMonth(monthDay);
  const end = endOfMonth(monthDay);
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
  const current = startOfMonth(today);
  const [y, m] = current.split("-").map(Number);
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  const previous = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
  const newest = newestPastDay?.slice(0, 10) ?? "";
  if (!newest || startOfMonth(newest) !== previous) return current;
  const oldest = startOfMonth(oldestDay && oldestDay.slice(0, 10) < current ? oldestDay : previous);
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

/**
 * A primeira leitura pode sair antes de a loja fechar o caixa.
 * Ontem e os dois dias anteriores são lidos de novo, mesmo já gravados.
 */
export const CLOSE_REOPEN_DAYS = 3;

/** Dias do intervalo, até ontem, que ainda não têm fechamento, mais a janela recente. */
export function missingCloseDays(from: string, to: string, today: string, filled: ReadonlySet<string>): string[] {
  const yesterday = addDays(today, -1);
  const end = to < yesterday ? to : yesterday;
  if (from > end) return [];
  const reopenFrom = addDays(yesterday, -(CLOSE_REOPEN_DAYS - 1));
  const out: string[] = [];
  for (let day = from; day <= end; day = addDays(day, 1)) {
    if (!filled.has(day) || day >= reopenFrom) out.push(day);
  }
  return out;
}
