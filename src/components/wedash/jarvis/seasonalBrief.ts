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

export type SeasonalBiasLine = {
  name: string;
  kind: "commercial" | "national";
  date: string;
  /** Contribuição no fator (ex.: +0.12, −0.01). */
  delta: number;
};

export type SeasonalBias = {
  /** Multiplicador no alvo (1 = neutro). */
  factor: number;
  events: SeasonalEvent[];
  /** Linhas com contribuição (comerciais primeiro, por |delta|). */
  lines: SeasonalBiasLine[];
  /** Uma linha pra falar com o Gestor. */
  summary: string;
};

function deltaForEvent(e: SeasonalEvent): number {
  if (e.kind === "commercial") return COMMERCIAL_DELTA[e.name] ?? 0;
  return -0.01;
}

/**
 * Quanto o periodo puxa a meta pra cima/baixo por sazonal + feriado.
 * Black Friday / Natal / Dia das Maes sobem; Carnaval e muitos feriados baixam um pouco.
 */
export function seasonalBiasForPeriod(from: string, to: string): SeasonalBias {
  const events = eventsInPeriod(from, to);
  const lines: SeasonalBiasLine[] = events.map((e) => ({
    name: e.name,
    kind: e.kind,
    date: e.date,
    delta: deltaForEvent(e),
  }));
  let delta = lines.reduce((s, l) => s + l.delta, 0);
  delta = Math.max(-0.25, Math.min(0.25, delta));
  const factor = Math.round((1 + delta) * 1000) / 1000;

  // Comerciais com peso primeiro (Black Friday não some atrás de feriados por data).
  const ordered = [...lines].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "commercial" ? -1 : 1;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });
  const bits = ordered.map((l) => {
    const pct = Math.round(l.delta * 100);
    if (l.kind === "national") return `feriado ${l.name} (${pct}%)`;
    if (l.delta === 0) return `${l.name} em ${fmt(l.date)}`;
    return `${l.name} (${pct > 0 ? "+" : ""}${pct}%)`;
  });
  const summary =
    bits.length === 0
      ? "Sem data sazonal forte no periodo."
      : `No periodo: ${bits.slice(0, 6).join("; ")}${bits.length > 6 ? "…" : ""}. Ajuste tipico no alvo: ${
          delta === 0 ? "neutro" : `${delta > 0 ? "+" : ""}${Math.round(delta * 100)}%`
        }.`;
  return { factor, events, lines: ordered, summary };
}

/** Texto curto do ajuste: destaca comerciais (ex. Black Friday) e feriados à parte. */
export function speakSeasonalBiasBreakdown(bias: SeasonalBias): string {
  if (bias.lines.length === 0) return "Sem data sazonal forte no período.";
  const commercial = bias.lines.filter((l) => l.kind === "commercial" && l.delta !== 0);
  const holidays = bias.lines.filter((l) => l.kind === "national");
  const pct = Math.round((bias.factor - 1) * 100);
  const parts: string[] = [];
  if (commercial.length) {
    parts.push(
      "Comercial: " +
        commercial
          .map((l) => {
            const p = Math.round(l.delta * 100);
            return `${l.name} ${p > 0 ? "+" : ""}${p}%`;
          })
          .join("; "),
    );
  }
  if (holidays.length) {
    parts.push(
      "Feriados (−1% cada): " + holidays.map((l) => l.name).join(", "),
    );
  }
  parts.push(
    pct === 0
      ? "Ajuste líquido no alvo: neutro."
      : `Ajuste líquido no alvo: ${pct > 0 ? "+" : ""}${pct}%.`,
  );
  return parts.join(". ");
}

/** Aliases de fala → nome canônico do calendário (comercial ou feriado). */
const SEASONAL_MENTION_ALIASES: { re: RegExp; name: string }[] = [
  { re: /black\s*friday|blackfriday/, name: "Black Friday" },
  { re: /\bnatal\b/, name: "Natal" },
  { re: /\bcarnaval\b/, name: "Carnaval" },
  { re: /dia das maes|dia das mães/, name: "Dia das Mães" },
  { re: /dia dos namorados/, name: "Dia dos Namorados" },
  { re: /dia dos pais/, name: "Dia dos Pais" },
  { re: /dia do professor/, name: "Dia do Professor" },
  { re: /\bpascoa\b|\bpáscoa\b/, name: "Páscoa" },
  { re: /\bfinados\b/, name: "Finados" },
  { re: /proclamacao da republica|proclamação da república/, name: "Proclamação da República" },
  { re: /consciencia negra|consciência negra/, name: "Consciência Negra" },
  { re: /nossa senhora/, name: "Nossa Senhora Aparecida" },
];

function normPt(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Qual data sazonal o Gestor citou (qualquer uma do calendário, não só BF). */
export function detectSeasonalEventMention(
  text: string,
  bias?: SeasonalBias | null,
): string | null {
  const p = normPt(text);
  for (const { re, name } of SEASONAL_MENTION_ALIASES) {
    if (re.test(p)) return name;
  }
  // Nomes que estão no bias do período (cobre datas novas sem alias fixo).
  if (bias) {
    for (const line of bias.lines) {
      const n = normPt(line.name);
      if (n.length >= 4 && p.includes(n)) return line.name;
    }
  }
  return null;
}

export function looksLikeAskSeasonalInclusion(text: string, bias?: SeasonalBias | null): boolean {
  const p = normPt(text);
  if (detectSeasonalEventMention(text, bias) != null) return true;
  return (
    /sazonal|ajuste sazonal|calendario|calendário|feriado/.test(p) &&
    /(ja|já)\s+(esta|está|entrou|inclu|embut)|entrou no|inclu|embut|conta(r|ndo)? (com|a)|foi (consider|inclu|embut)|esse ajuste|esse fator/.test(
      p,
    )
  );
}

/** @deprecated use looksLikeAskSeasonalInclusion */
export function looksLikeAskBlackFridayOrSeasonalInclusion(text: string): boolean {
  return looksLikeAskSeasonalInclusion(text);
}

/**
 * Responde se um evento sazonal (Natal, Black Friday, feriado…) já entrou no cálculo —
 * sem sugerir novo R$ nem misturar limiar de nível com meta-base.
 */
export function speakSeasonalInclusionAnswer(opts: {
  bias: SeasonalBias;
  eventName?: string | null;
  proposedAmount: number | null;
  appliedTarget: number | null;
  /** Se a conversa tratou R$ como limiar de nível (ex. 110%). */
  tierThresholdAmount?: number | null;
  tierPct?: number | null;
  tierBase?: number | null;
}): string {
  const breakdown = speakSeasonalBiasBreakdown(opts.bias);
  const focus = opts.eventName?.trim() || null;
  const line = focus
    ? opts.bias.lines.find((l) => l.name.toLowerCase() === focus.toLowerCase())
    : null;
  const included = line != null && line.delta !== 0;
  const focusPct = line ? Math.round(line.delta * 100) : 0;

  let head: string;
  if (focus) {
    head = included
      ? `Sim — ${focus} já entrou no ajuste sazonal da proposta` +
        (focusPct !== 0 ? ` (${focusPct > 0 ? "+" : ""}${focusPct}% no fator)` : "") +
        "."
      : opts.bias.lines.some((l) => l.name.toLowerCase() === focus.toLowerCase())
        ? `${focus} está no calendário do período, mas com peso neutro neste modelo.`
        : `${focus} não aparece no calendário deste período da meta.`;
  } else {
    head = "O ajuste sazonal da proposta já está detalhado abaixo — não mudo o valor só por causa do calendário.";
  }

  const parts = [head, breakdown];

  if (opts.proposedAmount != null) {
    parts.push(
      `A recomendada ${brlLike(opts.proposedAmount)} já embute esse ajuste — não somo de novo em cima.`,
    );
  }
  if (opts.appliedTarget != null && opts.appliedTarget !== opts.proposedAmount) {
    parts.push(`No rascunho, o valor aplicado continua ${brlLike(opts.appliedTarget)}.`);
  }

  if (
    opts.tierThresholdAmount != null &&
    opts.tierPct != null &&
    opts.tierBase != null
  ) {
    parts.push(
      `Sobre os R$ ${brlLike(opts.tierThresholdAmount).replace(/^R\$\s*/, "")}: se esse for o patamar de ${opts.tierPct}%, ` +
        `a meta-base fica ${brlLike(opts.tierBase)} — a análise comercial (histórico + sazonal) se refere à base, não ao limiar do nível.`,
    );
  } else {
    parts.push("Não vou sugerir outro valor só porque você perguntou do calendário.");
  }

  return parts.join("\n\n");
}

function brlLike(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(n);
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
