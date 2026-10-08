import { hora } from "@/lib/format";

/**
 * Relogio congelado do mock (fixtures Equipe/Financeiro/...).
 * Overview com sync real usa `calendarTodayIso()`  -  nao este valor.
 */
export const NOW = new Date(2026, 8, 15, 14, 32);
export const TODAY_ISO = "2026-09-15";
export const CURRENT_HOUR = 14;

/** Horario do ultimo sync leve concluido e intervalo configurado. */
export const LAST_SYNC = new Date(2026, 8, 15, 14, 30);
export const SYNC_INTERVAL_MIN = 2;

/** Sync e da conta, nao de uma tela: qualquer aba do Dashboard mostra o mesmo horario. */
export const UPDATED_AT = hora(LAST_SYNC);

/** "ha 2 min"  -  para o subtitulo do Dashboard, no lugar de uma frase fixa. */
const MINUTES_SINCE_SYNC = Math.floor((NOW.getTime() - LAST_SYNC.getTime()) / 60000);
export const SYNC_RELATIVE = MINUTES_SINCE_SYNC <= 0 ? "agora mesmo" : `há ${MINUTES_SINCE_SYNC} min`;

const CALENDAR_TZ = "America/Campo_Grande";

/** Dia civil de hoje no fuso das lojas (MS)  -  para filtros do Overview com dados reais. */
export function calendarTodayIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CALENDAR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Hora cheia atual no fuso das lojas (MS)  -  eixo horario do Overview. */
export function calendarCurrentHour(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CALENDAR_TZ,
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  // en-US hour12:false as vezes devolve "24" a meia-noite
  return h === 24 ? 0 : h;
}
