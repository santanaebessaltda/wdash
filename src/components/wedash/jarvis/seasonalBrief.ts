import { easter, nationalHolidays, type Holiday } from "@/data/wedash/scheduleHolidays";

export type SeasonalEvent = {
  date: string;
  name: string;
  kind: "commercial" | "national";
  hint: string;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function dateIso(d: Date): string {
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** N-ésimo domingo do mês (1 = primeiro). */
function nthSunday(year: number, month: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const dow = first.getUTCDay(); // 0 = domingo
  const day = 1 + ((7 - dow) % 7) + (n - 1) * 7;
  return iso(year, month, day);
}

/** Última sexta do mês. */
function lastFriday(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0));
  const dow = last.getUTCDay();
  const delta = (dow + 2) % 7; // sexta = 5
  last.setUTCDate(last.getUTCDate() - delta);
  return dateIso(last);
}

export function commercialDates(year: number): SeasonalEvent[] {
  const pascoa = easter(year);
  return [
    {
      date: dateIso(addDays(pascoa, -48)),
      name: "Carnaval",
      kind: "commercial",
      hint: "fluxo irregular na loja; bom para desafio curto de kit ou body splash",
    },
    {
      date: nthSunday(year, 5, 2),
      name: "Dia das Mães",
      kind: "commercial",
      hint: "principal data de presente do semestre — meta e desafio de kit/perfume",
    },
    {
      date: iso(year, 6, 12),
      name: "Dia dos Namorados",
      kind: "commercial",
      hint: "presente a dois; desafio de valor ou P.A. costuma responder bem",
    },
    {
      date: nthSunday(year, 8, 2),
      name: "Dia dos Pais",
      kind: "commercial",
      hint: "menor que Dia das Mães, mas ainda puxa perfume e kit",
    },
    {
      date: iso(year, 10, 15),
      name: "Dia do Professor",
      kind: "commercial",
      hint: "pico local de presente; desafio de ticket curto",
    },
    {
      date: lastFriday(year, 11),
      name: "Black Friday",
      kind: "commercial",
      hint: "volume alto — cuidado com margem; desafio de quantidade em produto parado",
    },
    {
      date: iso(year, 12, 25),
      name: "Natal",
      kind: "commercial",
      hint: "pico do ano; meta do mês e desafio de kit/cesta",
    },
  ];
}

function fmt(isoDay: string): string {
  const [, m, d] = isoDay.split("-");
  return `${d}/${m}`;
}

export function buildSeasonalBrief(today: string, monthsAhead = 4): SeasonalEvent[] {
  const y = Number(today.slice(0, 4));
  const end = shiftMonths(today, monthsAhead);
  const pool: SeasonalEvent[] = [
    ...commercialDates(y),
    ...commercialDates(y + 1),
    ...nationalHolidays(y).map(holidayToEvent),
    ...nationalHolidays(y + 1).map(holidayToEvent),
  ];
  const seen = new Set<string>();
  return pool
    .filter((e) => e.date >= today && e.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((e) => {
      const key = `${e.date}|${e.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function holidayToEvent(h: Holiday): SeasonalEvent {
  return {
    date: h.date,
    name: h.name,
    kind: "national",
    hint: "feriado — afeta escala e fluxo da loja",
  };
}

function shiftMonths(isoDay: string, delta: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1 + delta, d!));
  return dateIso(dt);
}

export function formatSeasonalBrief(events: SeasonalEvent[], today: string): string {
  if (events.length === 0) {
    return "Não há data sazonal relevante nos próximos meses neste calendário. Posso olhar um horizonte maior se quiser.";
  }
  const lines = events
    .slice(0, 8)
    .map((e) => `${e.name} em ${fmt(e.date)} (${e.hint})`)
    .join("; ");
  return (
    `A partir de ${fmt(today)}, as próximas datas que costumam mover a rede: ${lines}. ` +
    `Quer montar meta ou desafio em cima de alguma delas? Fechamos o rascunho juntos e só gravo com a sua autorização.`
  );
}

export function loadSeasonalBrief(today: string): string {
  return formatSeasonalBrief(buildSeasonalBrief(today), today);
}

/** Fator comercial tipico sobre o valor-alvo (somatorio; teto ±25%). */
const COMMERCIAL_DELTA: Record<string, number> = {
  Carnaval: -0.03,
  "Dia das Maes": 0.1,
  "Dia das Mães": 0.1,
  "Dia dos Namorados": 0.06,
  "Dia dos Pais": 0.05,
  "Dia do Professor": 0.02,
  "Black Friday": 0.12,
  Natal: 0.15,
};

/** Eventos (comerciais + feriados) que caem dentro de [from, to]. */
export function eventsInPeriod(from: string, to: string): SeasonalEvent[] {
  const y0 = Number(from.slice(0, 4));
  const y1 = Number(to.slice(0, 4));
  const years = y0 === y1 ? [y0] : [y0, y1];
  const pool: SeasonalEvent[] = [];
  for (const y of years) {
    pool.push(...commercialDates(y), ...nationalHolidays(y).map(holidayToEvent));
  }
  const seen = new Set<string>();
  return pool
    .filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((e) => {
      const key = `${e.date}|${e.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export type SeasonalBias = {
  /** Multiplicador no alvo (1 = neutro). */
  factor: number;
  events: SeasonalEvent[];
  /** Uma linha pra falar com o Gestor. */
  summary: string;
};

/**
 * Quanto o periodo puxa a meta pra cima/baixo por sazonal + feriado.
 * Black Friday / Natal / Dia das Maes sobem; Carnaval e muitos feriados baixam um pouco.
 */
export function seasonalBiasForPeriod(from: string, to: string): SeasonalBias {
  const events = eventsInPeriod(from, to);
  let delta = 0;
  const bits: string[] = [];
  for (const e of events) {
    if (e.kind === "commercial") {
      const d = COMMERCIAL_DELTA[e.name] ?? 0;
      if (d !== 0) {
        delta += d;
        bits.push(`${e.name} (${d > 0 ? "+" : ""}${Math.round(d * 100)}%)`);
      } else {
        bits.push(`${e.name} em ${fmt(e.date)}`);
      }
    } else {
      delta -= 0.01;
      bits.push(`feriado ${e.name} (${fmt(e.date)})`);
    }
  }
  delta = Math.max(-0.25, Math.min(0.25, delta));
  const factor = Math.round((1 + delta) * 1000) / 1000;
  const summary =
    bits.length === 0
      ? "Sem data sazonal forte no periodo."
      : `No periodo: ${bits.slice(0, 6).join("; ")}${bits.length > 6 ? "…" : ""}. Ajuste tipico no alvo: ${
          delta === 0 ? "neutro" : `${delta > 0 ? "+" : ""}${Math.round(delta * 100)}%`
        }.`;
  return { factor, events, summary };
}

/** Resumo curto das proximas datas (contexto da sessao LLM). */
export function compactSeasonalContext(today: string, monthsAhead = 2): string {
  const rows = buildSeasonalBrief(today, monthsAhead);
  if (rows.length === 0) return "Nenhuma data sazonal relevante nos proximos meses.";
  return rows
    .slice(0, 6)
    .map((e) => `${e.name} ${fmt(e.date)}`)
    .join("; ");
}
