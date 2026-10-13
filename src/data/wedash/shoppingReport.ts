/** Informe de vendas no shopping. A data é AAAA-MM-DD no fuso da filial. */

export type InformedDay = {
  date: string;
  /** Valor que o formulário do shopping já tem. null = campo vazio. */
  fieldCents: number | null;
  soldCents: number;
};

export type SalesWindow = {
  kind: "informed" | "online";
  days: InformedDay[];
};

export type LaunchValue = {
  date: string;
  /** null = o campo segue vazio no salvar. */
  cents: number | null;
};

export type ClosedDay = {
  date: string;
  soldCents: number;
  /** null = ainda não lançado. */
  launchedCents: number | null;
};

export type MonthReport = {
  soldCents: number;
  launchedCents: number;
  /** Lançado menos vendido. Positivo = a mais. Negativo = a menos. */
  differenceCents: number;
  blankDays: number;
};

/** Dias anteriores a hoje. Hoje ainda não fechou. */
export function isClosedDay(date: string, today: string): boolean {
  return date < today;
}

/**
 * Valores da linha Informada a reenviar.
 * Dia passado vazio recebe o faturamento. Dia com valor permanece. Hoje e o futuro seguem vazios.
 */
export function informedLaunchValues(windows: SalesWindow[], today: string): LaunchValue[] {
  const days = windows.filter((window) => window.kind === "informed").flatMap((window) => window.days);
  return days.map((day) => ({ date: day.date, cents: launchCents(day, today) }));
}

function launchCents(day: InformedDay, today: string, only?: ReadonlySet<string>): number | null {
  if (!isClosedDay(day.date, today)) return null;
  if (day.fieldCents != null) return day.fieldCents;
  if (only && !only.has(day.date)) return null;
  return day.soldCents;
}

/** KPIs do mês: só dias anteriores a hoje. Dia sem lançamento conta como 0. */
export function monthReport(days: ClosedDay[], today: string): MonthReport {
  const closed = days.filter((day) => isClosedDay(day.date, today));
  const soldCents = closed.reduce((sum, day) => sum + day.soldCents, 0);
  const launchedCents = closed.reduce((sum, day) => sum + (day.launchedCents ?? 0), 0);
  return {
    soldCents,
    launchedCents,
    differenceCents: launchedCents - soldCents,
    blankDays: closed.filter((day) => day.launchedCents == null).length,
  };
}

export type PeriodReport = {
  from: string;
  to: string;
  soldCents: number;
  launchedCents: number;
  differenceCents: number;
};

/** Semana da Allos: domingo a sábado, cortada no mês. */
export function allosPeriods(from: string, to: string): Array<{ from: string; to: string }> {
  const periods: Array<{ from: string; to: string }> = [];
  let start = from;
  for (let day = from; day <= to; day = nextIso(day)) {
    if (weekday(day) === 6 || day === to) {
      periods.push({ from: start, to: day });
      start = nextIso(day);
    }
  }
  return periods;
}

export const ALREADY_LAUNCHED = "Os dias passados deste período já estão informados. O shopping não foi aberto.";

/** Dias anteriores a hoje, no mês, que ainda não têm lançamento gravado. */
export function unlaunchedDays(from: string, to: string, today: string, launched: ReadonlySet<string>): string[] {
  const pending: string[] = [];
  for (let day = from; day <= to && day < today; day = nextIso(day)) {
    if (!launched.has(day)) pending.push(day);
  }
  return pending;
}

/** Uma linha por bloco da Allos. Só entram dias anteriores a hoje. */
export function periodReports(days: ClosedDay[], monthFrom: string, monthTo: string): PeriodReport[] {
  return allosPeriods(monthFrom, monthTo).flatMap((period) => {
    const inside = days.filter((day) => day.date >= period.from && day.date <= period.to);
    if (inside.length === 0) return [];
    const soldCents = inside.reduce((sum, day) => sum + day.soldCents, 0);
    const launchedCents = inside.reduce((sum, day) => sum + (day.launchedCents ?? 0), 0);
    return [{ from: period.from, to: period.to, soldCents, launchedCents, differenceCents: launchedCents - soldCents }];
  });
}

function weekday(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function nextIso(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${mm}-${dd}`;
}

export type ShoppingAdministrator = "allos" | "argo";

/**
 * Informe de vendas e Shopping ficam no menu.
 * A tela explica quando a filial não é quiosque ou ainda não tem Allos.
 */
export function shoppingMenu(): { settings: boolean; report: boolean } {
  return { settings: true, report: true };
}

/** O Atualizar desta tela só chama o shopping quando a filial é quiosque e o acesso está salvo. */
export function forceLaunchAllowed(input: {
  kiosk: boolean;
  administrator: ShoppingAdministrator | null;
}): { ok: true } | { ok: false; message: string } {
  if (!input.kiosk) return { ok: false, message: "Esta tela está disponível apenas para filiais do tipo Quiosque em shopping." };
  if (input.administrator == null) return { ok: false, message: "O Gestor ainda não configurou a administradora desta filial." };
  if (input.administrator === "argo") {
    return { ok: false, message: "A integração com a Argo ainda não está disponível na WDash." };
  }
  return { ok: true };
}

/**
 * Faturamento bruto da filial no dia.
 * A linha ALL já é o total. WEPINK e WPINK são a divisão dessa mesma venda e não entram de novo.
 */
export function sumSoldByDay(rows: Array<{ day: string; revenueCents: number; brand?: string | null }>): Record<string, number> {
  const hasBrand = rows.some((row) => row.brand === "ALL" || row.brand === "WEPINK" || row.brand === "WPINK");
  const all = rows.filter((row) => row.brand === "ALL");
  const chosen = !hasBrand ? rows : all.length > 0 ? all : rows.filter((row) => row.brand === "WEPINK" || row.brand === "WPINK");
  const out: Record<string, number> = {};
  for (const row of chosen) {
    const day = row.day.slice(0, 10);
    out[day] = (out[day] ?? 0) + row.revenueCents;
  }
  return out;
}

/** O que a linha Informada já tem. Campo vazio passado conta como zero. Hoje e o futuro ficam de fora. */
export function informedStoredValues(fields: AllosField[], today: string): LaunchValue[] {
  return fields.flatMap((field) => {
    if (!isClosedDay(field.date, today)) return [];
    return [{ date: field.date, cents: field.fieldCents ?? 0 }];
  });
}

/** Dia passado sem valor gravado não é zero informado. Zero gravado é um valor real. */
export function informedGap(soldCents: number, informedCents: number | null): "missing" | "match" | "over" | "under" {
  if (informedCents == null) return "missing";
  const gap = informedCents - soldCents;
  if (gap === 0) return "match";
  return gap > 0 ? "over" : "under";
}

/** Dias do mês anteriores a hoje. Sem lançamento gravado, o dia conta como em branco. */
export function reportDays(
  dates: string[],
  soldCentsByDay: Record<string, number>,
  launchedCentsByDay: Record<string, number>,
  today: string,
): ClosedDay[] {
  return dates.filter((date) => isClosedDay(date, today)).map((date) => ({
    date,
    soldCents: soldCentsByDay[date] ?? 0,
    launchedCents: Object.prototype.hasOwnProperty.call(launchedCentsByDay, date) ? launchedCentsByDay[date] : null,
  }));
}

/** A tela lê o acesso. A senha cifrada não entra na resposta. */
export function shoppingAccountView(row: {
  store_id: string;
  administrator: string;
  base_url: string;
  username: string;
  last_run_at?: string | null;
  last_error?: string | null;
  secret_ciphertext?: string;
}): {
  storeId: string;
  administrator: ShoppingAdministrator;
  baseUrl: string;
  username: string;
  lastRunAt: string | null;
  lastError: string;
} | null {
  if (row.administrator !== "allos" && row.administrator !== "argo") return null;
  return {
    storeId: row.store_id,
    administrator: row.administrator,
    baseUrl: row.base_url,
    username: row.username,
    lastRunAt: row.last_run_at ?? null,
    lastError: row.last_error ?? "",
  };
}

/** Só a semana da linha Informada. A linha Online fica de fora. */
export function informedWeekIds(html: string): string[] {
  const ids: string[] = [];
  for (const match of html.matchAll(/IDSEMANA=(\d+)/gi)) {
    const before = html.slice(Math.max(0, (match.index ?? 0) - 500), match.index).toLowerCase();
    const informed = before.lastIndexOf("informada");
    const online = before.lastIndexOf("online");
    if (informed >= 0 && informed > online) ids.push(match[1]);
  }
  return [...new Set(ids)];
}

export type AllosField = { date: string; fieldCents: number | null };

/** Lê o formulário da semana. A Allos manda de 1 a 11 dias; a primeira semana do mês pode ser curta. */
export function parseAllosForm(html: string): { weekId: string; fields: AllosField[] } | null {
  const inputs = [...html.matchAll(/<input\b[^>]*>/gi)].map((match) => inputAttrs(match[0]));
  const weekId = inputs.find((input) => input.name === "idsemana")?.value?.trim() ?? "";
  const dates = inputs.filter((input) => input.name === "data_cadastra").map((input) => isoFromAllosDate(input.value ?? ""));
  const stated = Number(inputs.find((input) => input.name === "dias")?.value ?? "");
  const amounts = Array.from({ length: dates.length }, (_, index) => inputs.find((input) => input.name === `venda${index}`));
  if (!weekId || dates.length < 1 || dates.length > 11 || dates.some((date) => date == null) || amounts.some((input) => input == null)) return null;
  if (Number.isFinite(stated) && stated > 0 && stated !== dates.length) return null;
  return {
    weekId,
    fields: dates.map((date, index) => ({ date: date as string, fieldCents: parseAllosAmount(amounts[index]?.value ?? "") })),
  };
}

/** Preenche só o vazio passado e devolve o corpo do salvar. */
export function fillAllosWeek(
  parsed: { weekId: string; fields: AllosField[] },
  soldCentsByDay: Record<string, number>,
  today: string,
  only?: ReadonlySet<string>,
): { weekId: string; body: string; days: LaunchValue[] } {
  const days = parsed.fields.map((field) => ({
    date: field.date,
    cents: launchCents(
      { date: field.date, fieldCents: field.fieldCents, soldCents: soldCentsByDay[field.date] ?? 0 },
      today,
      only,
    ),
  }));
  return { weekId: parsed.weekId, days, body: allosWeekBody(days, parsed.weekId) };
}

export function allosWeekBody(days: LaunchValue[], weekId: string): string {
  const parts: string[] = [];
  days.forEach((day, index) => {
    parts.push(`data_cadastra=${allosDateParam(day.date)}`);
    parts.push(`venda${index}=${day.cents == null ? "" : formatAllosAmount(day.cents)}`);
  });
  parts.push(`dias=${days.length}`);
  parts.push(`idsemana=${weekId}`);
  return parts.join("&");
}

export function allosDateParam(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${year}-${Number(month)}-${Number(day)}`;
}

export function parseAllosAmount(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

function isoFromAllosDate(value: string): string | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function inputAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) attrs[match[1].toLowerCase()] = match[2];
  return attrs;
}

/** Valor do formulário Allos. 675680 centavos = "6.756,80". */
export function formatAllosAmount(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const reais = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const centavos = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${reais},${centavos}`;
}
