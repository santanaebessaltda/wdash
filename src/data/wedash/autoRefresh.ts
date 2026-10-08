/**
 * Atualizacao automatica: regras puras (worker + front).
 * - Rodadas a cada 30 min so nas lojas no expediente (Configuracoes > Loja: horario + fuso).
 * - Ultima rodada do dia = fechamento + 30 min (notas processadas com atraso).
 * - Loja sem horario configurado = sem atualizacao automatica (so o botao Atualizar).
 * - O dia fecha na madrugada (CLOSE); toda rodada ok fecha antes os dias pendentes
 *   (ate o dia 1 do mes anterior) se a madrugada nao rodou.
 */
import { hhmmToHour, parseWeekHours, weekHoursConfigured, type DayHours, type StoreWeekHours } from "./storeHours.ts";

/** Intervalo fixo entre rodadas (sem opcao na UI). */
export const AUTO_REFRESH_MIN = 30;
/** Minutos depois do fechamento da ultima rodada do dia. */
export const CLOSE_GRACE_MIN = 30;
/** Ultima rodada do dia que falhou tenta de novo a cada X min ate a meia-noite. */
export const FINAL_RETRY_MIN = 10;
/** Dias pendentes fechados por rodada (o resto fica para as proximas / madrugada). */
export const RECOVERY_DAYS_PER_ROUND = 3;
/** Marca no `sync_job.error` da rodada pulada por sessao caida  ->  a proxima pode fazer login. */
export const AUTO_SESSION_MARK = "[auto-sessao]";

/** `store.hours`  ->  semana (dia null = fechado; nenhum dia aberto = nao configurado). */
export function parseStoreHours(raw: unknown): StoreWeekHours {
  return parseWeekHours(raw);
}

/** Loja com horario configurado (pelo menos 1 dia aberto) = tem atualizacao automatica. */
export function autoRefreshConfigured(hours: StoreWeekHours): boolean {
  return weekHoursConfigured(hours);
}

/** Dia (YYYY-MM-DD), dia da semana (0=dom) e minuto do dia no fuso. */
export function localClock(date: Date, timeZone: string): { day: string; dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    dow: Math.max(0, dows.indexOf(get("weekday"))),
    minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
  };
}

/** Expediente do dia em minutos; fechamento  abertura (ex.: 00:00) = ate a meia-noite. */
function dayWindow(day: DayHours): { openMin: number; closeMin: number } | null {
  if (!day) return null;
  const openMin = Math.round(hhmmToHour(day.open) * 60);
  let closeMin = Math.round(hhmmToHour(day.close) * 60);
  if (closeMin <= openMin) closeMin = 24 * 60;
  return { openMin, closeMin };
}

/**
 * Fase da loja agora:
 * - `open`: dentro do expediente (rodadas no intervalo);
 * - `wrapup`: fechou ha menos de 30 min (espera a ultima rodada);
 * - `finalDue`: fechou ha 30 min ou mais (ultima rodada do dia, se ainda nao houve);
 * - `before`: ainda nao abriu; `closed`: nao abre hoje (ou horario nao configurado).
 */
export type StorePhase = "open" | "wrapup" | "finalDue" | "before" | "closed";

export function storePhase(hours: StoreWeekHours, now: Date, timeZone: string): StorePhase {
  const clock = localClock(now, timeZone);
  const w = dayWindow(hours[clock.dow as keyof StoreWeekHours] ?? null);
  if (!w) return "closed";
  if (clock.minutes < w.openMin) return "before";
  if (clock.minutes < w.closeMin) return "open";
  if (clock.minutes < w.closeMin + CLOSE_GRACE_MIN) return "wrapup";
  return "finalDue";
}

/** Instante de hoje (fuso da loja) no minuto `minutes` do dia. */
function todayAtMinute(now: Date, timeZone: string, minutes: number): Date {
  const clock = localClock(now, timeZone);
  return new Date(now.getTime() - now.getSeconds() * 1000 - now.getMilliseconds() + (minutes - clock.minutes) * 60_000);
}

/** Instante da ultima rodada do dia (fechamento + 30 min); null se a loja nao abre hoje. */
export function finalRoundAt(hours: StoreWeekHours, now: Date, timeZone: string): Date | null {
  const w = dayWindow(hours[localClock(now, timeZone).dow as keyof StoreWeekHours] ?? null);
  return w ? todayAtMinute(now, timeZone, w.closeMin + CLOSE_GRACE_MIN) : null;
}

export function addDays(isoDay: string, delta: number): string {
  const d = new Date(`${isoDay}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Chao da recuperacao de dias: dia 1 do mes anterior. */
export function recoveryFloor(todayIso: string): string {
  const [y, m] = todayIso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 2, 1)).toISOString().slice(0, 10);
}

/**
 * Dias pendentes da loja (depois do ultimo fechado, antes de hoje), do mais antigo ao mais novo.
 * Sem ultimo dia fechado ainda = nada pendente (a carga do historico / madrugada cria a base).
 */
export function pendingDays(
  lastClosedDay: string | null | undefined,
  todayIso: string,
  max = RECOVERY_DAYS_PER_ROUND,
): string[] {
  if (!lastClosedDay) return [];
  const floor = recoveryFloor(todayIso);
  let day = addDays(lastClosedDay, 1);
  if (day < floor) day = floor;
  const out: string[] = [];
  while (day < todayIso && out.length < max) {
    out.push(day);
    day = addDays(day, 1);
  }
  return out;
}

export type AutoStore = {
  id: string;
  timezone: string;
  hours: StoreWeekHours;
  /** Ultimo Atualizar ok da loja (`store.last_sync_at`). */
  lastSyncAt: Date | null;
};

/**
 * Rodada automatica devida agora? Lojas no expediente, `intervalMin` depois da ultima rodada
 * automatica (Atualizar manual nao conta; rodada perdida = roda assim que voltar). Loja que fechou
 * ha 30 min ou mais e ainda nao teve Atualizar depois disso entra na ultima rodada do dia
 * (nova tentativa a cada 10 min se falhar, ate a meia-noite).
 */
export function planAutoRound(args: {
  stores: AutoStore[];
  now: Date;
  intervalMin: number;
  lastAutoAt: Date | null;
}): { storeIds: string[] } | null {
  const { stores, now, intervalMin } = args;
  const sinceMin = args.lastAutoAt ? (now.getTime() - args.lastAutoAt.getTime()) / 60_000 : Infinity;
  const openIds: string[] = [];
  const finalIds: string[] = [];
  for (const s of stores) {
    const phase = storePhase(s.hours, now, s.timezone);
    if (phase === "open") openIds.push(s.id);
    else if (phase === "finalDue") {
      const final = finalRoundAt(s.hours, now, s.timezone);
      if (final && (!s.lastSyncAt || s.lastSyncAt < final)) finalIds.push(s.id);
    }
  }
  const openDue = openIds.length > 0 && sinceMin >= intervalMin;
  const finalDue = finalIds.length > 0 && sinceMin >= FINAL_RETRY_MIN;
  if (!openDue && !finalDue) return null;
  return { storeIds: [...(openDue ? openIds : []), ...(finalDue ? finalIds : [])] };
}

/**
 * Proxima rodada automatica das lojas do escopo (tooltip do Atualizar). Loja aberta  ->  ultima
 * rodada automatica + intervalo (ou a ultima do dia, se cair depois do fechamento); fechou ha
 * < 30 min  ->  ultima rodada do dia. Nenhuma loja nesses casos = null.
 */
export function nextAutoRefreshAt(args: {
  stores: Array<Pick<AutoStore, "hours" | "timezone">>;
  now: Date;
  intervalMin: number;
  lastAutoAt: Date | null;
}): Date | null {
  const { stores, now } = args;
  const due = args.lastAutoAt ? new Date(args.lastAutoAt.getTime() + args.intervalMin * 60_000) : now;
  const next = due < now ? now : due;
  const candidates: Date[] = [];
  for (const s of stores) {
    const phase = storePhase(s.hours, now, s.timezone);
    const final = finalRoundAt(s.hours, now, s.timezone);
    if (!final) continue;
    const closeAt = new Date(final.getTime() - CLOSE_GRACE_MIN * 60_000);
    if (phase === "open") candidates.push(next >= closeAt ? final : next);
    else if (phase === "wrapup") candidates.push(final);
  }
  return candidates.length > 0 ? candidates.reduce((a, b) => (b < a ? b : a)) : null;
}
