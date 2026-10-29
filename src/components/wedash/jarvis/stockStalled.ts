import { fetchSalesProductPeriodAggs } from "@/data/wedash/salesRepo";
import { fetchStockCatalog, fetchStoreStock } from "@/data/wedash/stockRepo";
import { matchStoresInText, scopeLabel, type JarvisContext } from "./context";

export type StalledProduct = {
  code: string;
  name: string;
  stock: number;
  items30d: number;
  /** null = sem venda no período (parado de verdade). */
  coverageDays: number | null;
};

export function pickStalledProducts(input: {
  stock: Array<{ storeId: string; code: string; qty: number }>;
  catalog: Map<string, { code: string; name: string }>;
  sold: Array<{ storeId: string; productCode: string; itemCount: number; brand: string }>;
  storeIds: string[];
  limit?: number;
}): StalledProduct[] {
  const scoped = new Set(input.storeIds);
  const stockBy = new Map<string, number>();
  for (const s of input.stock) {
    if (!scoped.has(s.storeId) || s.qty <= 0) continue;
    stockBy.set(s.code, (stockBy.get(s.code) ?? 0) + s.qty);
  }

  const allBy = new Map<string, number>();
  const partBy = new Map<string, number>();
  for (const r of input.sold) {
    if (!scoped.has(r.storeId)) continue;
    const code = r.productCode.trim();
    if (!code) continue;
    if (r.brand === "ALL") allBy.set(code, (allBy.get(code) ?? 0) + r.itemCount);
    else partBy.set(code, (partBy.get(code) ?? 0) + r.itemCount);
  }
  const soldBy = new Map<string, number>();
  for (const code of new Set([...allBy.keys(), ...partBy.keys()])) {
    soldBy.set(code, (allBy.get(code) ?? 0) > 0 ? allBy.get(code)! : (partBy.get(code) ?? 0));
  }

  const out: StalledProduct[] = [];
  for (const [code, stock] of stockBy) {
    if (stock < 3) continue;
    const items30d = soldBy.get(code) ?? 0;
    const coverageDays = items30d > 0 ? stock / (items30d / 30) : null;
    const stalled = items30d === 0 || (coverageDays != null && coverageDays >= 45);
    if (!stalled) continue;
    const name = input.catalog.get(code)?.name ?? code;
    out.push({ code, name, stock, items30d, coverageDays });
  }

  out.sort((a, b) => {
    const ca = a.coverageDays ?? 1e9;
    const cb = b.coverageDays ?? 1e9;
    if (cb !== ca) return cb - ca;
    return b.stock - a.stock;
  });
  return out.slice(0, input.limit ?? 8);
}

export function formatStalledBrief(
  rows: StalledProduct[],
  storeLabel: string,
  from: string,
  to: string,
): string {
  if (rows.length === 0) {
    return `Em ${storeLabel}, não vi produto com saldo relevante e giro fraco nos últimos 30 dias (${fmt(from)} a ${fmt(to)}). Posso olhar outra filial ou montar um desafio por categoria mesmo assim.`;
  }
  const lines = rows
    .map((r) => {
      const cover =
        r.coverageDays == null ? "sem venda no período" : `~${Math.round(r.coverageDays)} dias de cobertura`;
      return `${r.name} (${r.code}): ${r.stock} em estoque · ${cover}`;
    })
    .join("; ");
  return (
    `Em ${storeLabel}, candidatos a desafio por estoque parado (saldo vs vendas de ${fmt(from)} a ${fmt(to)}): ${lines}. ` +
    `Quer que a gente feche um desafio em cima de algum desses? Eu monto o rascunho e só gravo com a sua autorização.`
  );
}

function fmt(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function shiftDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export async function loadStockStalledBrief(ctx: JarvisContext, question: string): Promise<string> {
  const matched = matchStoresInText(question, ctx.stores);
  const stores = matched.length > 0 ? matched : ctx.stores;
  const storeIds = stores.map((s) => s.id);
  const to = ctx.today;
  const from = shiftDays(to, -29);
  try {
    const [stockPack, catalog, sold] = await Promise.all([
      fetchStoreStock(ctx.tenantId, storeIds),
      fetchStockCatalog(),
      fetchSalesProductPeriodAggs({ tenantId: ctx.tenantId, storeIds, from, to }),
    ]);
    const rows = pickStalledProducts({
      stock: stockPack.rows,
      catalog,
      sold: sold.map((r) => ({
        storeId: r.storeId,
        productCode: r.productCode,
        itemCount: r.itemCount,
        brand: r.brand,
      })),
      storeIds,
    });
    return formatStalledBrief(rows, scopeLabel(stores, ctx.stores), from, to);
  } catch (e) {
    console.warn("jarvis stockStalled:", e);
    return "Não consegui ler o estoque agora. Abra Estoque > Produtos ou tente de novo em instantes.";
  }
}
