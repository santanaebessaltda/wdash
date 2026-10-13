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

function launchCents(day: InformedDay, today: string): number | null {
  if (!isClosedDay(day.date, today)) return null;
  if (day.fieldCents != null) return day.fieldCents;
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

/** Valor do formulário Allos. 675680 centavos = "6.756,80". */
export function formatAllosAmount(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const reais = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const centavos = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${reais},${centavos}`;
}
