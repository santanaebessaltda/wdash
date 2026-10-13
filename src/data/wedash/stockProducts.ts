/**
 * Estoque (saldo por local, transferencia, em falta) e Tabelas de venda (custo, despesas sobre a venda e lucro por peca), por loja.
 * Custo de aquisicao = custo da tabela de custo da loja + ICMS ST (% do custo).
 * Despesas sobre a venda = ICMS + royalties + taxa de marketing (da marca do produto) + aluguel percentual
 * (so Shopping)  -  todas em % do preco. Lucro por peca = preco  despesas  custo de aquisicao.
 * Preco minimo = custo de aquisicao  (1  %): o menor preco que nao da prejuizo.
 */
import type { Store } from "./stores";

export type StockCatalogItem = { code: string; name: string; category: string };

export type StockInput = {
  stores: Store[];
  catalog: Map<string, StockCatalogItem>;
  /** qty = soma dos locais; locations = saldo por local de estoque (ESTOQUE, QUIOSQUE, SHOP010...). */
  stock: Array<{ storeId: string; code: string; qty: number; locations?: Record<string, number> }>;
  /** tabela de custo  ->  COD_PRODUTO  ->  custo unitario (centavos). */
  costPrices: Map<number, Map<string, number>>;
  /** tabela de venda  ->  COD_PRODUTO  ->  preco (centavos). */
  salePrices: Map<number, Map<string, number>>;
  saleTableId: number | null;
  /** Vendas dos ultimos 30 dias por loja x produto (preco medio praticado). */
  charged: Array<{ storeId: string; code: string; revenueCents: number; items: number }>;
  /** Pedidos em aberto (Saldo Atual e Futuro), chave `loja|codigo`. */
  incoming?: Map<string, number>;
  /** Lojas cujo saldo futuro ja foi buscado. Sem todas, A receber fica vazio. */
  incomingKnown?: Set<string>;
};

export type CostLine = { label: string; pct: number; amount: number };

export type PriceComposition = {
  price: number | null;
  cost: number | null;
  icmsStPct: number;
  icmsSt: number | null;
  costAquisicao: number | null;
  /** Despesas sobre a venda (so as > 0%); valor = % x preco. */
  despesas: CostLine[];
  pctTotal: number;
  taxes: number | null;
  franchiseRent: number | null;
  costTotal: number | null;
  profit: number | null;
  marginPct: number | null;
  priceMinimum: number | null;
};

export function productBrand(code: string): "WEPINK" | "WPINK" {
  const t = code.trim().toUpperCase();
  return /^WP[\dA-Z]/.test(t) || t === "WP" || t.startsWith("WP ") ? "WPINK" : "WEPINK";
}

/** % sobre o preco de venda que a loja paga em cada peca do produto. */
export function saleCostPcts(store: Store, code: string): CostLine[] {
  const c = store.costs;
  const wpink = productBrand(code) === "WPINK";
  const rent = store.pointType === "SHOPPING" ? (c?.rentWepinkPct ?? c?.rentWpinkPct ?? 0) : 0;
  const lines: CostLine[] = [
    { label: "ICMS", pct: (wpink ? c?.icmsWpinkPct : c?.icmsWepinkPct) ?? 0, amount: 0 },
    { label: "Royalties", pct: (wpink ? c?.royaltiesWpinkPct : c?.royaltiesWepinkPct) ?? 0, amount: 0 },
    { label: "Taxa de marketing", pct: (wpink ? c?.marketingWpinkPct : c?.marketingWepinkPct) ?? 0, amount: 0 },
    { label: "Aluguel percentual", pct: rent, amount: 0 },
  ];
  return lines.filter((l) => l.pct > 0);
}

export function composePrice(store: Store, code: string, priceCents: number | null, costCents: number | null): PriceComposition {
  const price = priceCents == null ? null : priceCents / 100;
  const cost = costCents == null ? null : costCents / 100;
  const wpink = productBrand(code) === "WPINK";
  const icmsStPct = (wpink ? store.costs?.icmsStWpinkPct : store.costs?.icmsStWepinkPct) ?? 0;
  const icmsSt = cost == null ? null : (cost * icmsStPct) / 100;
  const costAquisicao = cost == null ? null : cost + (icmsSt ?? 0);
  const pcts = saleCostPcts(store, code);
  const pctTotal = pcts.reduce((s, l) => s + l.pct, 0);
  const despesas = pcts.map((l) => ({ ...l, amount: price == null ? 0 : (price * l.pct) / 100 }));
  const icms = despesas.find((l) => l.label === "ICMS")?.amount ?? 0;
  const franchiseRent = price == null ? null : despesas.filter((l) => l.label !== "ICMS").reduce((s, l) => s + l.amount, 0);
  const taxes = cost == null ? null : (icmsSt ?? 0) + (price == null ? 0 : icms);
  const costTotal = costAquisicao == null || price == null ? null : costAquisicao + icms + (franchiseRent ?? 0);
  const profit = costTotal == null || price == null ? null : price - costTotal;
  return {
    price,
    cost,
    icmsStPct,
    icmsSt,
    costAquisicao,
    despesas,
    pctTotal,
    taxes,
    franchiseRent,
    costTotal,
    profit,
    marginPct: profit == null || !price ? null : (profit / price) * 100,
    priceMinimum: costAquisicao == null || pctTotal >= 100 ? null : costAquisicao / (1 - pctTotal / 100),
  };
}

export type StockLocation = { name: string; qty: number };

/** `qtd` pecas do local `de` para o local `para`, na mesma loja. */
export type StockTransfer = { from: string; to: string; qty: number };

type LocalLevel = "estoque" | "intermediario" | "loja";

/** Nome na interface do local de onde sai a venda (QUIOSQUE no Millennium). */
export const STOCK_SALES_LOCATION = "PONTO DE VENDA";

function localLevel(name: string): LocalLevel {
  const n = name.trim().toUpperCase();
  if (n === "ESTOQUE") return "estoque";
  if (n === STOCK_SALES_LOCATION || n === "QUIOSQUE") return "loja";
  return "intermediario";
}

/**
 * Transferencias pendentes entre locais de uma loja, pela hierarquia: Estoque e pai de todos; os demais
 * (Shop010...) sao filhos do Estoque; a Loja (QUIOSQUE, de onde sai a venda) e filha de todos. Cobre primeiro os
 * locais intermediarios negativos (so pelo Estoque) e depois a Loja (pelo que sobrar, do local com mais saldo).
 */
export function stockTransfers(locations: StockLocation[]): StockTransfer[] {
  const saldo = new Map(locations.map((l) => [l.name, l.qty]));
  const out: StockTransfer[] = [];
  const cobrir = (to: string, pais: (name: string) => boolean) => {
    let gap = -(saldo.get(to) ?? 0);
    const origens = [...saldo].filter(([name, q]) => name !== to && q > 0 && pais(name)).sort((a, b) => b[1] - a[1]);
    for (const [from, q] of origens) {
      if (gap <= 0) break;
      const qty = Math.min(q, gap);
      saldo.set(from, q - qty);
      gap -= qty;
      out.push({ from, to, qty });
    }
  };
  const negativos = [...locations].filter((l) => l.qty < 0).sort((a, b) => a.qty - b.qty);
  for (const l of negativos) if (localLevel(l.name) === "intermediario") cobrir(l.name, (n) => localLevel(n) === "estoque");
  for (const l of negativos) if (localLevel(l.name) === "loja") cobrir(l.name, (n) => localLevel(n) !== "loja");
  return out;
}

export type StockStoreDetail = {
  store: Store;
  stock: number;
  /** Saldo por local (so locais com saldo = 0), maior primeiro. */
  locations: StockLocation[];
  transferencias: StockTransfer[];
  composition: PriceComposition;
  praticado: { price: number; items: number; profit: number | null; marginPct: number | null } | null;
  /** Pecas vendidas nos ultimos 30 dias na loja. */
  vendidos30d: number;
};

export type StockProductRow = {
  code: string;
  name: string;
  category: string;
  stock: number;
  /** Pecas a transferir entre locais de estoque, somando as lojas do filtro. */
  transfer: number;
  cost: number | null;
  taxes: number | null;
  franchiseRent: number | null;
  costTotal: number | null;
  price: number | null;
  profit: number | null;
  marginPct: number | null;
  priceMinimum: number | null;
  shelfPrice: number | null;
  marginPraticadaPct: number | null;
  itemsVendidos30d: number;
  /** Custo / lucro diferentes entre as lojas do filtro: valores = media das lojas. */
  variesByStore: boolean;
  /** Pecas pedidas e ainda nao recebidas, somando as lojas do filtro. Null = saldo futuro ainda nao buscado. */
  aReceive: number | null;
  /** Saldo em estoque + a receber. */
  totalGeral: number | null;
  storeRows: StockStoreDetail[];
};

export type NegativeStock = { code: string; name: string; quantity: number; storeRows: string[] };

export type StockProductsView = {
  rows: StockProductRow[];
  categories: string[];
  negativos: NegativeStock[];
};

const same = (vals: Array<number | null>) => vals.every((v) => v != null && Math.abs(v - vals[0]!) < 0.005);
const mean = (vals: Array<number | null>): number | null => {
  const ok = vals.filter((v): v is number => v != null);
  return ok.length === 0 ? null : ok.reduce((s, v) => s + v, 0) / ok.length;
};

export function costCentsFor(costPrices: StockInput["costPrices"], store: Store, code: string): number | null {
  if (store.costTableId == null) return null;
  return costPrices.get(store.costTableId)?.get(code) ?? null;
}

/**
 * Situacao do produto na aba Estoque, a mais grave primeiro (por loja do filtro):
 * negativo = total da loja abaixo de zero; aguardando = algum local negativo com saldo positivo num local "pai".
 * Hierarquia: Estoque e pai de todos; os demais (Shop010...) sao filhos do Estoque; a Loja (QUIOSQUE, de onde sai
 * a venda) e filha de todos.
 */
export type StockStatus = "negative" | "awaiting" | "ok";

export function stockStatus(r: StockProductRow): StockStatus {
  if (r.storeRows.some((l) => l.stock < 0)) return "negative";
  return r.storeRows.some((l) => l.transferencias.length > 0) ? "awaiting" : "ok";
}

export type StockCostAmount = {
  /** Saldo x preco unitario da tabela de custo, somando as lojas que tem custo. */
  amount: number | null;
  /** Preco unitario quando e o mesmo nas lojas com saldo e custo; null se varia ou nao ha custo. */
  unit: number | null;
};

/** Quanto o saldo vale pelo preco de custo da tabela de cada loja. Loja sem custo fica de fora da soma. */
export function stockCostAmount(r: StockProductRow): StockCostAmount {
  const units: number[] = [];
  let amount = 0;
  let any = false;
  for (const l of r.storeRows) {
    const unit = l.composition.cost;
    if (unit == null || l.stock === 0) continue;
    any = true;
    units.push(unit);
    amount += l.stock * unit;
  }
  if (!any) return { amount: null, unit: null };
  const sameUnit = units.every((u) => Math.abs(u - units[0]!) < 0.005);
  return { amount, unit: sameUnit ? units[0]! : null };
}

export function buildStockProductsView(input: StockInput): StockProductsView {
  const prices = input.saleTableId == null ? new Map<string, number>() : (input.salePrices.get(input.saleTableId) ?? new Map());
  const stockBy = new Map<string, number>();
  const locationsBy = new Map<string, Record<string, number>>();
  for (const s of input.stock) {
    const k = `${s.storeId}|${s.code}`;
    stockBy.set(k, (stockBy.get(k) ?? 0) + s.qty);
    const acc = locationsBy.get(k) ?? {};
    for (const [name, q] of Object.entries(s.locations ?? {})) acc[name] = (acc[name] ?? 0) + q;
    locationsBy.set(k, acc);
  }
  const chargedBy = new Map<string, { revenueCents: number; items: number }>();
  for (const c of input.charged) {
    const k = `${c.storeId}|${c.code}`;
    const acc = chargedBy.get(k) ?? { revenueCents: 0, items: 0 };
    acc.revenueCents += c.revenueCents;
    acc.items += c.items;
    chargedBy.set(k, acc);
  }
  const incoming = input.incoming ?? new Map<string, number>();
  const incomingKnown = input.incomingKnown ?? new Set<string>();
  const allIncomingKnown = input.stores.length > 0 && input.stores.every((s) => incomingKnown.has(s.id));
  const storeIds = new Set(input.stores.map((s) => s.id));
  const codes = new Set<string>(prices.keys());
  for (const s of input.stock) {
    if (storeIds.has(s.storeId) && (s.qty !== 0 || Object.values(s.locations ?? {}).some((q) => q !== 0))) codes.add(s.code);
  }
  if (allIncomingKnown) {
    for (const [key, q] of incoming) {
      if (q === 0) continue;
      const cut = key.indexOf("|");
      if (cut < 0 || !storeIds.has(key.slice(0, cut))) continue;
      codes.add(key.slice(cut + 1));
    }
  }
  const rows: StockProductRow[] = [];
  const negativos: NegativeStock[] = [];

  for (const code of codes) {
    const cat = input.catalog.get(code);
    const name = cat?.name || code;
    const priceCents = prices.get(code) ?? null;
    const storeRows: StockStoreDetail[] = input.stores.map((store) => {
      const stock = stockBy.get(`${store.id}|${code}`) ?? 0;
      const locations = Object.entries(locationsBy.get(`${store.id}|${code}`) ?? {})
        .filter(([, q]) => q !== 0)
        .map(([name, q]) => ({ name, qty: q }))
        .sort((a, b) => b.qty - a.qty);
      const costCents = costCentsFor(input.costPrices, store, code);
      const composition = composePrice(store, code, priceCents, costCents);
      const ch = chargedBy.get(`${store.id}|${code}`);
      let praticado: StockStoreDetail["praticado"] = null;
      if (ch && ch.items > 0 && ch.revenueCents > 0) {
        const p = composePrice(store, code, Math.round(ch.revenueCents / ch.items), costCents);
        praticado = { price: ch.revenueCents / ch.items / 100, items: ch.items, profit: p.profit, marginPct: p.marginPct };
      }
      return { store, stock, locations, transferencias: stockTransfers(locations), composition, praticado, vendidos30d: ch?.items ?? 0 };
    });

    const neg = storeRows.filter((l) => l.stock < 0);
    if (neg.length > 0) {
      negativos.push({ code: code, name, quantity: neg.reduce((s, l) => s + l.stock, 0), storeRows: neg.map((l) => l.store.tradeName) });
    }

    const comp = storeRows.map((l) => l.composition);
    const pick = (f: (c: PriceComposition) => number | null) => {
      const vals = comp.map(f);
      return same(vals) ? vals[0]! : mean(vals);
    };
    const stock = storeRows.reduce((s, l) => s + l.stock, 0);
    const aReceive = allIncomingKnown ? input.stores.reduce((s, store) => s + (incoming.get(`${store.id}|${code}`) ?? 0), 0) : null;
    const varies = comp.length > 1 && !same(comp.map((c) => c.profit ?? c.costAquisicao));
    const ch = storeRows.filter((l) => l.praticado);
    const itemsPracticed = ch.reduce((s, l) => s + l.praticado!.items, 0);
    const revenuePraticada = ch.reduce((s, l) => s + l.praticado!.price * l.praticado!.items, 0);
    const profitPraticado = ch.every((l) => l.praticado!.profit != null)
      ? ch.reduce((s, l) => s + l.praticado!.profit! * l.praticado!.items, 0)
      : null;

    rows.push({
      code: code,
      name,
      category: cat?.category || "Sem categoria",
      stock,
      aReceive,
      totalGeral: aReceive == null ? null : stock + aReceive,
      transfer: storeRows.reduce((s, l) => s + l.transferencias.reduce((t, x) => t + x.qty, 0), 0),
      cost: pick((c) => c.cost),
      taxes: pick((c) => c.taxes),
      franchiseRent: pick((c) => c.franchiseRent),
      costTotal: pick((c) => c.costTotal),
      price: priceCents == null ? null : priceCents / 100,
      profit: pick((c) => c.profit),
      marginPct: pick((c) => c.marginPct),
      priceMinimum: pick((c) => c.priceMinimum),
      shelfPrice: itemsPracticed > 0 ? revenuePraticada / itemsPracticed : null,
      marginPraticadaPct: profitPraticado != null && revenuePraticada > 0 ? (profitPraticado / revenuePraticada) * 100 : null,
      itemsVendidos30d: storeRows.reduce((s, l) => s + l.vendidos30d, 0),
      variesByStore: varies,
      storeRows,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  negativos.sort((a, b) => a.quantity - b.quantity);
  return {
    rows,
    categories: [...new Set(rows.map((r) => r.category))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    negativos,
  };
}

/** Tabela mais usada (em pecas) no periodo, somando as lojas; `usadas` = tabelas com venda no periodo, mais usada primeiro. */
export function suggestSaleTable(usage: Array<{ day: string; tableId: number; items: number }>): {
  sugerida: number | null;
  used: number[];
} {
  const m = new Map<number, number>();
  for (const u of usage) m.set(u.tableId, (m.get(u.tableId) ?? 0) + u.items);
  const used = [...m].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  return { sugerida: used[0] ?? null, used };
}
