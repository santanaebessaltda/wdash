/**
 * Carga do historico em periodo: Lista, relatorio de cupom e margem vem 1x por loja no periodo
 * (em vez de 1x por dia), em blocos de mes calendario, so com dias que ja fecharam.
 * Margem do dia = itens do dia (relatorio de cupom + detalhe das vendas sem vendedora)
 * x custo unitario do periodo  -  o custo nao muda dentro do mes (validado ago/26 nas 3 lojas).
 */
import type { MargemLine } from "./millenniumMargem.ts";

export type ClosedMonthItem = { code: string; qty: number; revenueCents: number };

/** `day` ja fechou em relacao a `today` (ambos no fuso da loja). */
export function isHistoryRangeDay(day: string, today: string): boolean {
  return day < today;
}

/** Periodo da carga que termina em `day`: do dia 1 do mes (ou `until`, se for depois) ate `day`. */
export function closedMonthRange(day: string, until: string): { from: string; to: string } {
  const first = `${day.slice(0, 7)}-01`;
  return { from: first > until ? first : until, to: day };
}

/** COD_PRODUTO  ->  custo unitario (reais) da margem do periodo. */
export function unitCostsFromMargem(lines: MargemLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    const code = line.codProduto.trim();
    if (!code) continue;
    const unit = line.custoFranquias > 0 || line.qty === 0 ? line.custoFranquias : line.custoTotal / line.qty;
    out.set(code, unit);
  }
  return out;
}

/** Margem de 1 dia a partir dos itens vendidos. null = algum produto sem custo no mes. */
export function margemLinesFromItems(items: ClosedMonthItem[], unitCost: Map<string, number>): MargemLine[] | null {
  const byCode = new Map<string, { qty: number; revenueCents: number }>();
  for (const item of items) {
    const code = item.code.trim();
    if (!code) return null;
    const acc = byCode.get(code) ?? { qty: 0, revenueCents: 0 };
    acc.qty += item.qty;
    acc.revenueCents += item.revenueCents;
    byCode.set(code, acc);
  }
  const out: MargemLine[] = [];
  for (const [code, { qty, revenueCents }] of byCode) {
    const unit = unitCost.get(code);
    if (unit == null) return null;
    out.push({
      codProduto: code,
      qty,
      custoFranquias: unit,
      custoTotal: unit * qty,
      totalVenda: revenueCents / 100,
    });
  }
  return out;
}
