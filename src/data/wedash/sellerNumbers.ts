import { kpiDelta, previousPeriod, resolvePeriod } from "@/data/wedash/dashboard";
import { addDays } from "@/data/wedash/engine/format";
import type { SellerDay } from "@/data/wedash/engine/sellerHome";

export type NumbersMode = "today" | "month";

export interface SellerNumber {
  value: number | null;
  delta?: { value: string; positive: boolean; vs?: string; anterior?: string };
}

export interface SellerNumbers {
  revenue: SellerNumber;
  vendas: SellerNumber;
  ticket: SellerNumber;
  /** null = algum dia com venda sem itens gravados (nada estimado). */
  pa: SellerNumber;
}

const ZERO: SellerNumbers = {
  revenue: { value: 0 },
  vendas: { value: 0 },
  ticket: { value: 0 },
  pa: { value: 0 },
};

interface Totais {
  revenue: number;
  sales: number;
  items: number | null;
}

function soma(days: SellerDay[], from: string, to: string): Totais {
  let revenue = 0;
  let sales = 0;
  let items = 0;
  let semItens = false;
  for (const d of days) {
    if (d.day < from || d.day > to) continue;
    revenue += d.revenue;
    sales += d.sales;
    if (d.items == null && d.sales > 0) semItens = true;
    else items += d.items ?? 0;
  }
  return { revenue, sales, items: semItens ? null : items };
}

function numero(atual: number, anterior: number | null, vs: string | undefined, unit: "brl" | "vendas" | "pa"): SellerNumber {
  return { value: atual, delta: anterior == null ? undefined : kpiDelta(atual, anterior, vs, unit) };
}

/**
 * Faturamento, vendas, ticket e P.A. do vendedor.
 * Mes compara com o mesmo recorte do periodo anterior, os dois lados ate ontem
 * (mesma regra da Dashboard > Equipe, via `previousPeriod`); Hoje nao compara.
 * P.A. fica indisponivel quando algum dia com venda nao tem itens.
 */
export function sellerNumbers(days: SellerDay[], period: { from: string; to: string }, today: string, mode: NumbersMode): SellerNumbers {
  if (mode === "today") {
    const t = soma(days, today, today);
    return {
      revenue: { value: t.revenue },
      vendas: { value: t.sales },
      ticket: { value: t.sales > 0 ? t.revenue / t.sales : 0 },
      pa: { value: t.items == null ? null : t.sales > 0 ? t.items / t.sales : 0 },
    };
  }

  const resolvido = resolvePeriod({ kind: "custom", start: period.from, end: period.to }, today);
  const compara = resolvido.endsToday;
  const band = previousPeriod(resolvido);
  // Periodo que termina hoje: os dois lados perdem o ultimo dia (nao existe venda por pessoa e hora).
  const fimAtual = compara ? addDays(period.to, -1) : period.to;
  const fimAnterior = compara ? addDays(band.end, -1) : band.end;
  const atual = soma(days, period.from, fimAtual);
  if (atual.sales === 0 && atual.revenue === 0) return { ...ZERO, pa: { value: atual.items == null ? null : 0 } };

  const anterior = soma(days, band.start, fimAnterior);
  const temAnterior = anterior.sales > 0 || anterior.revenue > 0;
  const vs = band.label;

  const ticketAtual = atual.sales > 0 ? atual.revenue / atual.sales : 0;
  const ticketAnterior = anterior && anterior.sales > 0 ? anterior.revenue / anterior.sales : null;
  const paAtual = atual.items == null ? null : atual.sales > 0 ? atual.items / atual.sales : 0;
  const paAnterior = anterior == null || anterior.items == null ? null : anterior.sales > 0 ? anterior.items / anterior.sales : null;

  return {
    revenue: numero(atual.revenue, temAnterior && anterior ? anterior.revenue : null, vs, "brl"),
    vendas: numero(atual.sales, temAnterior && anterior ? anterior.sales : null, vs, "vendas"),
    ticket: numero(ticketAtual, temAnterior && ticketAnterior != null ? ticketAnterior : null, vs, "brl"),
    pa: { value: paAtual, delta: paAtual != null && paAnterior != null ? kpiDelta(paAtual, paAnterior, vs, "pa") : undefined },
  };
}
