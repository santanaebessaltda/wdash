import { kpiDelta, previousPeriod, resolvePeriod } from "@/data/wedash/dashboard";
import { addDays } from "@/data/wedash/engine/format";
import type { SellerDay } from "@/data/wedash/engine/sellerHome";

export type NumbersMode = "today" | "month";

export interface SellerNumber {
  value: number | null;
  delta?: { value: string; positive: boolean; vs?: string; previous?: string };
}

export interface SellerNumbers {
  revenue: SellerNumber;
  sales: SellerNumber;
  ticket: SellerNumber;
  /** null = algum dia com venda sem itens gravados (nada estimado). */
  pa: SellerNumber;
}

const ZERO: SellerNumbers = {
  revenue: { value: 0 },
  sales: { value: 0 },
  ticket: { value: 0 },
  pa: { value: 0 },
};

interface Totais {
  revenue: number;
  sales: number;
  items: number | null;
}

function sum(days: SellerDay[], from: string, to: string): Totais {
  let revenue = 0;
  let sales = 0;
  let items = 0;
  let withoutItems = false;
  for (const d of days) {
    if (d.day < from || d.day > to) continue;
    revenue += d.revenue;
    sales += d.sales;
    if (d.items == null && d.sales > 0) withoutItems = true;
    else items += d.items ?? 0;
  }
  return { revenue, sales, items: withoutItems ? null : items };
}

function number(
  shown: number,
  compare: number | null,
  previous: number | null,
  vs: string | undefined,
  unit: "brl" | "sales" | "pa",
): SellerNumber {
  return { value: shown, delta: compare == null || previous == null ? undefined : kpiDelta(compare, previous, vs, unit) };
}

/**
 * Faturamento, vendas, ticket e P.A. do vendedor.
 * O número é o período inteiro, o mesmo corte do ranking. A comparação, quando o
 * período termina hoje, perde o último dia nos dois lados (não há venda por pessoa
 * e hora) — a mesma regra da Dashboard > Equipe.
 * P.A. fica indisponível quando algum dia com venda não tem itens.
 */
export function sellerNumbers(days: SellerDay[], period: { from: string; to: string }, today: string, mode: NumbersMode): SellerNumbers {
  if (mode === "today") {
    const t = sum(days, today, today);
    return {
      revenue: { value: t.revenue },
      sales: { value: t.sales },
      ticket: { value: t.sales > 0 ? t.revenue / t.sales : 0 },
      pa: { value: t.items == null ? null : t.sales > 0 ? t.items / t.sales : 0 },
    };
  }

  const resolvido = resolvePeriod({ kind: "custom", start: period.from, end: period.to }, today);
  const compara = resolvido.endsToday;
  const band = previousPeriod(resolvido);
  const endCompare = compara ? addDays(period.to, -1) : period.to;
  const endPrevious = compara ? addDays(band.end, -1) : band.end;
  const shown = sum(days, period.from, period.to);
  if (shown.sales === 0 && shown.revenue === 0) return { ...ZERO, pa: { value: shown.items == null ? null : 0 } };

  const compare = compara ? sum(days, period.from, endCompare) : shown;
  const previous = sum(days, band.start, endPrevious);
  const hasPrevious = previous.sales > 0 || previous.revenue > 0;
  const vs = band.label;
  const compareRevenue = hasPrevious ? compare.revenue : null;
  const compareSales = hasPrevious ? compare.sales : null;

  const ticketShown = shown.sales > 0 ? shown.revenue / shown.sales : 0;
  const ticketCompare = compare.sales > 0 ? compare.revenue / compare.sales : null;
  const ticketPrevious = previous.sales > 0 ? previous.revenue / previous.sales : null;
  const paShown = shown.items == null ? null : shown.sales > 0 ? shown.items / shown.sales : 0;
  const paCompare = compare.items == null ? null : compare.sales > 0 ? compare.items / compare.sales : null;
  const paPrevious = previous.items == null ? null : previous.sales > 0 ? previous.items / previous.sales : null;

  return {
    revenue: number(shown.revenue, compareRevenue, hasPrevious ? previous.revenue : null, vs, "brl"),
    sales: number(shown.sales, compareSales, hasPrevious ? previous.sales : null, vs, "sales"),
    ticket: number(ticketShown, hasPrevious ? ticketCompare : null, hasPrevious ? ticketPrevious : null, vs, "brl"),
    pa: { value: paShown, delta: paCompare != null && paPrevious != null ? kpiDelta(paCompare, paPrevious, vs, "pa") : undefined },
  };
}
