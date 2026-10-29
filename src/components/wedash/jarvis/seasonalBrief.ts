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
