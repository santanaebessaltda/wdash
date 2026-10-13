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

function number(current: number, previous: number | null, vs: string | undefined, unit: "brl" | "sales" | "pa"): SellerNumber {
  return { value: current, delta: previous == null ? undefined : kpiDelta(current, previous, vs, unit) };
}

/**
 * Faturamento, vendas, ticket e P.A. do vendedor.
 * Mes compara com o mesmo recorte do periodo anterior, os dois lados ate ontem
 * (mesma regra da Dashboard > Equipe, via `previousPeriod`); Hoje nao compara.
 * P.A. fica indisponivel quando algum dia com venda nao tem itens.
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
  // Periodo que termina hoje: os dois lados perdem o ultimo dia (nao existe venda por pessoa e hora).
  const endCurrent = compara ? addDays(period.to, -1) : period.to;
  const endPrevious = compara ? addDays(band.end, -1) : band.end;
  const current = sum(days, period.from, endCurrent);
  if (current.sales === 0 && current.revenue === 0) return { ...ZERO, pa: { value: current.items == null ? null : 0 } };

  const previous = sum(days, band.start, endPrevious);
  const hasPrevious = previous.sales > 0 || previous.revenue > 0;
  const vs = band.label;

  const ticketCurrent = current.sales > 0 ? current.revenue / current.sales : 0;
  const ticketPrevious = previous && previous.sales > 0 ? previous.revenue / previous.sales : null;
  const paCurrent = current.items == null ? null : current.sales > 0 ? current.items / current.sales : 0;
  const paPrevious = previous == null || previous.items == null ? null : previous.sales > 0 ? previous.items / previous.sales : null;

  return {
    revenue: number(current.revenue, hasPrevious && previous ? previous.revenue : null, vs, "brl"),
    sales: number(current.sales, hasPrevious && previous ? previous.sales : null, vs, "sales"),
    ticket: number(ticketCurrent, hasPrevious && ticketPrevious != null ? ticketPrevious : null, vs, "brl"),
    pa: { value: paCurrent, delta: paCurrent != null && paPrevious != null ? kpiDelta(paCurrent, paPrevious, vs, "pa") : undefined },
  };
}
