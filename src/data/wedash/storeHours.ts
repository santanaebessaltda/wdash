/** Horario de funcionamento e fusos  -  Configuracoes > Lojas. */

import type { DayHours, Dow, StoreWeekHours } from "./engine/goalWeights.ts";

export type { DayHours, Dow, StoreWeekHours } from "./engine/goalWeights.ts";

/** Mesmo conceito de `Store.pointType` (evita import ciclico com stores.ts). */
export type HoursPointType = "SHOPPING" | "RUA";

export const DOW_LABELS: Record<Dow, string> = {
  0: "Domingo",
  1: "Segunda-feira",
  2: "Terça-feira",
  3: "Quarta-feira",
  4: "Quinta-feira",
  5: "Sexta-feira",
  6: "Sábado",
};

export const DOW_SHORT: Record<Dow, string> = {
  0: "D",
  1: "S",
  2: "T",
  3: "Q",
  4: "Q",
  5: "S",
  6: "S",
};

/** Fusos oficiais do Brasil (sem horario de verao desde 2019), ordenados pelo offset. */
export const STORE_TIMEZONES: Array<{ value: string; label: string; states: string }> = [
  { value: "America/Noronha", label: "(UTC−02:00) Fernando de Noronha", states: "Fernando de Noronha" },
  {
    value: "America/Sao_Paulo",
    label: "(UTC−03:00) Horário de Brasília",
    states: "DF, Sul, Sudeste, Nordeste, GO, TO, PA e AP",
  },
  { value: "America/Manaus", label: "(UTC−04:00) Horário do Amazonas", states: "AM, MS, MT, RO e RR" },
  { value: "America/Rio_Branco", label: "(UTC−05:00) Horário do Acre", states: "AC e sudoeste do AM" },
];

/** IANA equivalentes (mesmo offset, sem DST)  ->  fuso oficial da lista. */
const TZ_ALIAS: Record<string, string> = {
  "America/Campo_Grande": "America/Manaus",
  "America/Cuiaba": "America/Manaus",
  "America/Porto_Velho": "America/Manaus",
  "America/Boa_Vista": "America/Manaus",
  "America/Fortaleza": "America/Sao_Paulo",
  "America/Belem": "America/Sao_Paulo",
  "America/Recife": "America/Sao_Paulo",
  "America/Bahia": "America/Sao_Paulo",
  "America/Maceio": "America/Sao_Paulo",
  "America/Araguaina": "America/Sao_Paulo",
  "America/Santarem": "America/Sao_Paulo",
  "America/Eirunepe": "America/Rio_Branco",
};

export function canonicalStoreTimezone(tz: string): string {
  return TZ_ALIAS[tz] ?? tz;
}

/** Default no banco = todos os dias desligados (ainda nao configurado). */
export function defaultWeekHours(): StoreWeekHours {
  return { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
}

/**
 * Preenchimento sugerido no formulario (Configuracoes > Loja), conforme o tipo do ponto.
 * Shopping/quiosque: seg–sab 10–22, dom 12–22. Loja de rua: seg–sex 08–18, sab 08–17, dom fechado.
 */
export function presetWeekHours(pointType: HoursPointType): StoreWeekHours {
  if (pointType === "RUA") {
    const util: DayHours = { open: "08:00", close: "18:00" };
    const sab: DayHours = { open: "08:00", close: "17:00" };
    return {
      0: null,
      1: { ...util },
      2: { ...util },
      3: { ...util },
      4: { ...util },
      5: { ...util },
      6: { ...sab },
    };
  }
  const semana: DayHours = { open: "10:00", close: "22:00" };
  const domingo: DayHours = { open: "12:00", close: "22:00" };
  return {
    0: { ...domingo },
    1: { ...semana },
    2: { ...semana },
    3: { ...semana },
    4: { ...semana },
    5: { ...semana },
    6: { ...semana },
  };
}

export const PRESET_HOURS_HINT: Record<HoursPointType, string> = {
  SHOPPING: "Padrão de quiosque (shopping): seg–sáb 10h–22h · domingo 12h–22h. Ajuste se for diferente.",
  RUA: "Padrão de loja de rua: seg–sex 8h–18h · sábado 8h–17h · domingo fechado. Ajuste se for diferente.",
};

/** Nenhum dia aberto = horario ainda nao configurado. */
export function weekHoursConfigured(h: StoreWeekHours): boolean {
  return ([0, 1, 2, 3, 4, 5, 6] as Dow[]).some((d) => h[d] != null);
}

/**
 * Horario usado nos graficos (eixo por hora, curva da meta): sem configuracao = 10:00 - 22:00
 * todos os dias, so para o calculo nao zerar. O sync nao usa horario (atualiza o dia inteiro).
 */
export function effectiveWeekHours(h: StoreWeekHours): StoreWeekHours {
  if (weekHoursConfigured(h)) return h;
  const day: DayHours = { open: "10:00", close: "22:00" };
  return { 0: { ...day }, 1: { ...day }, 2: { ...day }, 3: { ...day }, 4: { ...day }, 5: { ...day }, 6: { ...day } };
}

export function parseWeekHours(raw: unknown): StoreWeekHours {
  const base = defaultWeekHours();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  for (let d = 0; d <= 6; d++) {
    const key = String(d);
    if (!(key in o)) continue;
    const v = o[key];
    if (v == null) {
      base[d as Dow] = null;
      continue;
    }
    if (typeof v !== "object") continue;
    const row = v as Record<string, unknown>;
    const open = typeof row.open === "string" ? row.open : null;
    const close = typeof row.close === "string" ? row.close : null;
    if (open && close) base[d as Dow] = { open, close };
  }
  return base;
}

/** "09:00"  ->  9; "09:30"  ->  9.5 */
export function hhmmToHour(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return 0;
  return h + min / 60;
}

/** Primeira hora cheia inclusiva do expediente. */
export function openHourFloor(day: DayHours): number | null {
  if (!day) return null;
  return Math.floor(hhmmToHour(day.open));
}

/** Ultima hora cheia exclusiva do expediente (ex.: fecha 21:00  ->  eixo ate 20). */
export function closeHourCeil(day: DayHours): number | null {
  if (!day) return null;
  const c = hhmmToHour(day.close);
  const floor = Math.floor(c);
  return c > floor ? floor + 1 : Math.max(floor, openHourFloor(day)! + 1);
}

/** Opcoes de select a cada 30 min (00:00 - 23:30). */
export function halfHourOptions(): string[] {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
}

/**
 * Janela uniao das lojas no dia da semana (graficos).
 * Se todas fechadas, cai no default 9 - 21.
 */
/** Uniao do expediente so das lojas com horario configurado; null = nenhuma  ->  o eixo sai das vendas. */
export function unionConfiguredWindow(
  hoursList: StoreWeekHours[],
  dow: Dow,
): { abertura: number; fechamento: number } | null {
  const configured = hoursList.filter(weekHoursConfigured);
  if (configured.length === 0) return null;
  const w = unionOpenWindow(configured, dow);
  return configured.some((h) => openHourFloor(h[dow]) != null) ? w : null;
}

/**
 * Eixo dos graficos por hora (1 dia), igual em todas as telas: expediente configurado das lojas no dia
 * (Configuracoes > Loja); venda fora do expediente estende o eixo. Nenhuma loja com horario  ->  horas com
 * venda  `fallbackHours` (ex.: horas com meta); sem nada, 10h - 22h. `first`/`last` inclusivos.
 */
export function hourAxisRange(
  hoursList: StoreWeekHours[],
  dow: Dow,
  soldHours: number[],
  fallbackHours: number[] = [],
): { first: number; last: number; win: { abertura: number; fechamento: number } } {
  const configured = unionConfiguredWindow(hoursList, dow);
  const livres = [...soldHours, ...fallbackHours];
  const win =
    configured ??
    (livres.length > 0
      ? { abertura: Math.min(...livres), fechamento: Math.max(...livres) + 1 }
      : { abertura: 10, fechamento: 22 });
  return {
    first: Math.min(win.abertura, ...soldHours),
    last: Math.max(win.fechamento - 1, ...soldHours),
    win,
  };
}

export function unionOpenWindow(
  hoursList: StoreWeekHours[],
  dow: Dow,
): { abertura: number; fechamento: number } {
  let abertura = 24;
  let fechamento = 0;
  for (const hours of hoursList) {
    const day = hours[dow];
    const a = openHourFloor(day);
    const c = closeHourCeil(day);
    if (a == null || c == null) continue;
    abertura = Math.min(abertura, a);
    fechamento = Math.max(fechamento, c);
  }
  if (abertura >= fechamento) return { abertura: 9, fechamento: 21 };
  return { abertura, fechamento };
}
