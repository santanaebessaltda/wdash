/**
 * Carga funda do historico (madrugada): depois da carga do onboarding, volta mes a mes ate a
 * inauguracao da loja (teto = `.env DEEP_HISTORY` do worker), so de madrugada.
 * Regras puras  -  o worker (`enqueueDueDeepHistoryJobs`) consulta o banco e aplica.
 */
import { addDays, localClock } from "./autoRefresh.ts";

/** Intervalo entre um mes e o proximo. */
export const DEEP_HISTORY_SPACING_MIN = 15;
/** Madrugada no fuso da loja: [inicio, fim) em horas. */
export const DEEP_WINDOW_START_H = 0;
export const DEEP_WINDOW_END_H = 6;
/** Loja sem inauguracao cadastrada: para apos N meses seguidos sem venda. */
export const DEEP_EMPTY_MONTHS = 3;
/** Mes que falhou (sessao caida, ERP fora) so tenta de novo na proxima madrugada. */
export const DEEP_FAIL_WAIT_H = 12;
/**
 * Teto da barra de progresso na UI (meses contando o atual), alinhado ao `.env DEEP_HISTORY=24m`.
 * O worker usa o valor do env; a tela usa este teto para o % quando a inauguracao e mais antiga.
 */
export const DEEP_HISTORY_UI_CAP_MONTHS = 24;

export function monthStart(isoDay: string): string {
  return `${isoDay.slice(0, 7)}-01`;
}

export function addMonths(isoDay: string, delta: number): string {
  const [y, m] = isoDay.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1 + delta, 1)).toISOString().slice(0, 10);
}

/** Madrugada = 0h - 6h no fuso de todas as lojas. */
export function isDeepHistoryWindow(stores: Array<{ timezone: string }>, now: Date): boolean {
  if (stores.length === 0) return false;
  return stores.every((s) => {
    const h = localClock(now, s.timezone).minutes / 60;
    return h >= DEEP_WINDOW_START_H && h < DEEP_WINDOW_END_H;
  });
}

/** Dia mais antigo a carregar: inauguracao, sem passar do teto (`cap`, 1 dia do mes mais antigo). */
export function deepHistoryFloor(openedAt: string | null | undefined, cap: string): string {
  const opened = openedAt ? openedAt.slice(0, 10) : null;
  return opened && opened > cap ? opened : cap;
}

export type DeepStore = {
  id: string;
  /** Dia mais antigo ja gravado (null = loja ainda sem nenhum dia  -  espera o onboarding). */
  oldestDay: string | null;
  floor: string;
  /** Sem inauguracao: os ultimos meses mais antigos ja carregados vieram zerados. */
  emptyTail: boolean;
};

export type DeepPlan = { day: string; fillUntil: string; storeIds: string[] };

export function deepStoreDone(s: DeepStore): boolean {
  return s.oldestDay == null || s.oldestDay <= s.floor || s.emptyTail;
}

/**
 * Proximo mes: o mais recente que falta entre as lojas (dia anterior ao mais antigo gravado),
 * com todas as lojas que precisam desse mesmo mes. Null = nada a carregar.
 */
export function planDeepHistory(stores: DeepStore[]): DeepPlan | null {
  const pending = stores
    .filter((s) => !deepStoreDone(s))
    .map((s) => ({ ...s, next: addDays(s.oldestDay!, -1) }));
  if (pending.length === 0) return null;
  const day = pending.map((s) => s.next).reduce((a, b) => (b > a ? b : a));
  const month = monthStart(day);
  const group = pending.filter((s) => monthStart(s.next) === month);
  const lowestFloor = group.map((s) => s.floor).reduce((a, b) => (b < a ? b : a));
  return {
    day,
    fillUntil: lowestFloor > month ? lowestFloor : month,
    storeIds: group.map((s) => s.id),
  };
}

/** Meses calendário inclusivos entre dois dias 1 (a <= b). */
export function monthsInclusive(fromMonthStart: string, toMonthStart: string): number {
  const [fy, fm] = fromMonthStart.split("-").map(Number);
  const [ty, tm] = toMonthStart.split("-").map(Number);
  return Math.max(0, (ty! - fy!) * 12 + (tm! - fm!) + 1);
}

/** Teto (1º dia do mês mais antigo) a partir de hoje e N meses contando o atual. */
export function deepHistoryCap(todayIso: string, capMonths = DEEP_HISTORY_UI_CAP_MONTHS): string {
  return addMonths(monthStart(todayIso), -(Math.max(1, capMonths) - 1));
}

export type DeepHistoryProgress = {
  done: number;
  total: number;
  /** Proximo mes a carregar (YYYY-MM-01), ou null se nada pendente. */
  nextMonth: string | null;
};

/**
 * Progresso da carga funda: meses ja cobertos / horizonte (inauguracao ou teto UI).
 * `oldestDay` = dia mais antigo gravado na rede; null = ainda no onboarding.
 */
export function deepHistoryProgress(
  stores: DeepStore[],
  todayIso: string,
): DeepHistoryProgress | null {
  if (stores.length === 0 || stores.some((s) => s.oldestDay == null)) return null;
  const plan = planDeepHistory(stores);
  const floor = stores.map((s) => s.floor).reduce((a, b) => (b < a ? b : a));
  const horizonEnd = addMonths(monthStart(todayIso), -1);
  if (horizonEnd < floor) return null;
  const total = monthsInclusive(monthStart(floor), horizonEnd);
  if (total <= 0) return null;
  if (!plan) {
    return { done: total, total, nextMonth: null };
  }
  const nextMonth = monthStart(plan.day);
  const pending = monthsInclusive(monthStart(floor), nextMonth);
  const done = Math.max(0, Math.min(total, total - pending));
  return { done, total, nextMonth };
}
