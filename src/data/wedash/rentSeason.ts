/** Exceção do aluguel mínimo. `month` repete todo ano; `yearMonth` vale só naquele mês. */
export type RentSeason = {
  month: number | null;
  yearMonth: string | null;
  factor: number;
};

/** Fator do mínimo naquele mês. O mês específico ganha do mês que se repete. Sem exceção, 1. */
export function rentSeasonFactor(seasons: RentSeason[] | undefined, yearMonth: string): number {
  const specific = seasons?.find((season) => season.yearMonth === yearMonth);
  if (specific && specific.factor > 0) return specific.factor;
  const month = Number(yearMonth.slice(5, 7));
  const yearly = seasons?.find((season) => season.yearMonth == null && season.month === month);
  if (yearly && yearly.factor > 0) return yearly.factor;
  return 1;
}

export function parseRentSeasons(raw: unknown): RentSeason[] {
  if (!Array.isArray(raw)) return [];
  const out: RentSeason[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const factor = Number((item as { factor?: unknown }).factor);
    if (!Number.isFinite(factor) || factor <= 0) continue;
    const yearMonthRaw = (item as { yearMonth?: unknown }).yearMonth;
    const yearMonth = typeof yearMonthRaw === "string" && /^\d{4}-\d{2}$/.test(yearMonthRaw) ? yearMonthRaw : null;
    const month = Number((item as { month?: unknown }).month);
    if (yearMonth) out.push({ month: null, yearMonth, factor });
    else if (month >= 1 && month <= 12) out.push({ month, yearMonth: null, factor });
  }
  return out;
}
