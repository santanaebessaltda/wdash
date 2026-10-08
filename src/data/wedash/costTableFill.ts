/**
 * Produto vendido que veio com custo 0 no RELATORIOMARGEM  ->  CMV = itens x custo unitario da tabela de custo
 * da loja (Configuracoes > Lojas; product_cost_table_price). Calculado na leitura: o historico se corrige sem
 * nova chamada ao ERP. Custo que veio da margem nunca e trocado; produto sem preco na tabela segue com 0.
 */
import type { SalesDayAgg, SalesProductCostDayAgg } from "./salesTypes";

/** `loja|dia|codigo`  ->  CMV em centavos vindo da tabela. */
export type TableCostFill = Map<string, number>;

const rowKey = (storeId: string, day: string, code: string) => `${storeId}|${day}|${code}`;

/** Mesma regra do worker (millenniumMargem.brandFromCodProduto). */
export function brandFromProductCode(code: string): "WEPINK" | "WPINK" {
  const t = code.trim().toUpperCase();
  if (/^WP[\dA-Z]/.test(t) || t === "WP" || t.startsWith("WP ")) return "WPINK";
  return "WEPINK";
}

export function buildTableCostFill(
  zeroRows: Array<Pick<SalesProductCostDayAgg, "storeId" | "day" | "productCode" | "itemCount" | "cmvCents">>,
  storeTable: Map<string, number>,
  /** `tabela|codigo`  ->  custo unitario em centavos. */
  prices: Map<string, number>,
): TableCostFill {
  const out: TableCostFill = new Map();
  for (const r of zeroRows) {
    if (r.cmvCents !== 0 || r.itemCount <= 0) continue;
    const table = storeTable.get(r.storeId);
    if (table == null) continue;
    const unit = prices.get(`${table}|${r.productCode}`);
    if (!unit) continue;
    out.set(rowKey(r.storeId, r.day, r.productCode), unit * r.itemCount);
  }
  return out;
}

export function applyFillToProductCosts(
  rows: SalesProductCostDayAgg[],
  fill: TableCostFill,
): SalesProductCostDayAgg[] {
  if (fill.size === 0) return rows;
  return rows.map((r) => {
    if (r.cmvCents !== 0) return r;
    const cmv = fill.get(rowKey(r.storeId, r.day, r.productCode));
    return cmv ? { ...r, cmvCents: cmv } : r;
  });
}

/** Soma o CMV da tabela no ALL e na marca do produto (WP* = WPINK) de cada loja/dia. */
export function applyFillToDayAggs(days: SalesDayAgg[], fill: TableCostFill): SalesDayAgg[] {
  if (fill.size === 0) return days;
  const delta = new Map<string, number>();
  for (const [key, cmv] of fill) {
    const [storeId, day, code] = key.split("|") as [string, string, string];
    for (const brand of ["ALL", brandFromProductCode(code)]) {
      const k = `${storeId}|${day}|${brand}`;
      delta.set(k, (delta.get(k) ?? 0) + cmv);
    }
  }
  return days.map((d) => {
    const add = delta.get(`${d.storeId}|${d.day}|${d.brand}`);
    return add ? { ...d, cmvCents: (d.cmvCents ?? 0) + add } : d;
  });
}
