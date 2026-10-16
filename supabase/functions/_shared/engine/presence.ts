import { eachDay } from "./format.ts";

/** Janela de emprego usada na meta e no desafio. Datas ISO YYYY-MM-DD. */
export interface Tenure {
  /** Null = participa desde o início do período. */
  admittedOn: string | null;
  /** Null = ainda não há dia de saída gravado. */
  departedOn: string | null;
  /** Ativa na equipe de vendas. Inativa sem saída e sem venda no período fica de fora. */
  active: boolean;
}

/**
 * Dias do período em que a pessoa participa, inclusive.
 * Sem admissão, começa no primeiro dia. Ativa e sem saída, vai até o fim.
 * Inativa: fecha em `departedOn` ou, se o ERP não trouxe o dia, no último dia vendido no período.
 */
export function presenceDays(startsOn: string, endsOn: string, tenure: Tenure, lastSaleOn: string | null): string[] {
  if (tenure.admittedOn && tenure.admittedOn > endsOn) return [];
  const start = tenure.admittedOn && tenure.admittedOn > startsOn ? tenure.admittedOn : startsOn;
  let end = endsOn;
  if (!tenure.active || tenure.departedOn) {
    const left = tenure.departedOn ?? (tenure.active ? null : lastSaleOn);
    if (!left || left < startsOn) return [];
    if (left < end) end = left;
  }
  if (start > end) return [];
  return eachDay(start, end);
}

/** Mínimo do desafio no recorte dos dias presentes. Quem fizer mais não usa esta conta. */
export function scaledMinimum(target: number, eligibleDays: number, periodDays: number): number {
  if (periodDays <= 0) return target;
  return (target * eligibleDays) / periodDays;
}
