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

export type CostLine = { label: string; pct: number; valor: number };

export type PriceComposition = {
  preco: number | null;
  custo: number | null;
  icmsStPct: number;
  icmsSt: number | null;
  custoAquisicao: number | null;
  /** Despesas sobre a venda (so as > 0%); valor = % x preco. */
  despesas: CostLine[];
  pctTotal: number;
  impostos: number | null;
  franquiaAluguel: number | null;
  custoTotal: number | null;
  lucro: number | null;
  margemPct: number | null;
  precoMinimo: number | null;
};

export function productBrand(code: string): "WEPINK" | "WPINK" {
  const t = code.trim().toUpperCase();
  return /^WP[\dA-Z]/.test(t) || t === "WP" || t.startsWith("WP ") ? "WPINK" : "WEPINK";
}

/** % sobre o preco de venda que a loja paga em cada peca do produto. */
export function saleCostPcts(store: Store, code: string): CostLine[] {
  const c = store.custos;
  const wpink = productBrand(code) === "WPINK";
  const rent = store.pointType === "SHOPPING" ? (c?.rentWepinkPct ?? c?.rentWpinkPct ?? 0) : 0;
  const lines: CostLine[] = [
    { label: "ICMS", pct: (wpink ? c?.icmsWpinkPct : c?.icmsWepinkPct) ?? 0, valor: 0 },
    { label: "Royalties", pct: (wpink ? c?.royaltiesWpinkPct : c?.royaltiesWepinkPct) ?? 0, valor: 0 },
    { label: "Taxa de marketing", pct: (wpink ? c?.marketingWpinkPct : c?.marketingWepinkPct) ?? 0, valor: 0 },
    { label: "Aluguel percentual", pct: rent, valor: 0 },
  ];
  return lines.filter((l) => l.pct > 0);
}

export function composePrice(store: Store, code: string, priceCents: number | null, costCents: number | null): PriceComposition {
  const preco = priceCents == null ? null : priceCents / 100;
  const custo = costCents == null ? null : costCents / 100;
  const wpink = productBrand(code) === "WPINK";
  const icmsStPct = (wpink ? store.custos?.icmsStWpinkPct : store.custos?.icmsStWepinkPct) ?? 0;
  const icmsSt = custo == null ? null : (custo * icmsStPct) / 100;
  const custoAquisicao = custo == null ? null : custo + (icmsSt ?? 0);
  const pcts = saleCostPcts(store, code);
  const pctTotal = pcts.reduce((s, l) => s + l.pct, 0);
  const despesas = pcts.map((l) => ({ ...l, valor: preco == null ? 0 : (preco * l.pct) / 100 }));
  const icms = despesas.find((l) => l.label === "ICMS")?.valor ?? 0;
  const franquiaAluguel = preco == null ? null : despesas.filter((l) => l.label !== "ICMS").reduce((s, l) => s + l.valor, 0);
  const impostos = custo == null ? null : (icmsSt ?? 0) + (preco == null ? 0 : icms);
  const custoTotal = custoAquisicao == null || preco == null ? null : custoAquisicao + icms + (franquiaAluguel ?? 0);
  const lucro = custoTotal == null || preco == null ? null : preco - custoTotal;
  return {
    preco,
    custo,
    icmsStPct,
    icmsSt,
    custoAquisicao,
    despesas,
    pctTotal,
    impostos,
    franquiaAluguel,
    custoTotal,
    lucro,
    margemPct: lucro == null || !preco ? null : (lucro / preco) * 100,
    precoMinimo: custoAquisicao == null || pctTotal >= 100 ? null : custoAquisicao / (1 - pctTotal / 100),
  };
}

export type StockLocation = { nome: string; qtd: number };

/** `qtd` pecas do local `de` para o local `para`, na mesma loja. */
export type StockTransfer = { de: string; para: string; qtd: number };

type LocalNivel = "estoque" | "intermediario" | "loja";

/** Nome na interface do local de onde sai a venda (QUIOSQUE no Millennium). */
export const STOCK_SALES_LOCATION = "PONTO DE VENDA";

function localNivel(nome: string): LocalNivel {
  const n = nome.trim().toUpperCase();
  if (n === "ESTOQUE") return "estoque";
  if (n === STOCK_SALES_LOCATION || n === "QUIOSQUE") return "loja";
  return "intermediario";
}

/**
 * Transferencias pendentes entre locais de uma loja, pela hierarquia: Estoque e pai de todos; os demais
 * (Shop010...) sao filhos do Estoque; a Loja (QUIOSQUE, de onde sai a venda) e filha de todos. Cobre primeiro os
 * locais intermediarios negativos (so pelo Estoque) e depois a Loja (pelo que sobrar, do local com mais saldo).
 */
export function stockTransfers(locais: StockLocation[]): StockTransfer[] {
  const saldo = new Map(locais.map((l) => [l.nome, l.qtd]));
  const out: StockTransfer[] = [];
  const cobrir = (para: string, pais: (nome: string) => boolean) => {
    let falta = -(saldo.get(para) ?? 0);
    const origens = [...saldo].filter(([nome, q]) => nome !== para && q > 0 && pais(nome)).sort((a, b) => b[1] - a[1]);
    for (const [de, q] of origens) {
      if (falta <= 0) break;
      const qtd = Math.min(q, falta);
      saldo.set(de, q - qtd);
      falta -= qtd;
      out.push({ de, para, qtd });
    }
  };
  const negativos = [...locais].filter((l) => l.qtd < 0).sort((a, b) => a.qtd - b.qtd);
  for (const l of negativos) if (localNivel(l.nome) === "intermediario") cobrir(l.nome, (n) => localNivel(n) === "estoque");
  for (const l of negativos) if (localNivel(l.nome) === "loja") cobrir(l.nome, (n) => localNivel(n) !== "loja");
  return out;
}

export type StockStoreDetail = {
  store: Store;
  estoque: number;
  /** Saldo por local (so locais com saldo = 0), maior primeiro. */
  locais: StockLocation[];
  transferencias: StockTransfer[];
  composicao: PriceComposition;
  praticado: { preco: number; itens: number; lucro: number | null; margemPct: number | null } | null;
  /** Pecas vendidas nos ultimos 30 dias na loja. */
  vendidos30d: number;
};

export type StockProductRow = {
  codigo: string;
  nome: string;
  categoria: string;
  estoque: number;
  /** Pecas a transferir entre locais de estoque, somando as lojas do filtro. */
  transferir: number;
  custo: number | null;
  impostos: number | null;
  franquiaAluguel: number | null;
  custoTotal: number | null;
  preco: number | null;
  lucro: number | null;
  margemPct: number | null;
  precoMinimo: number | null;
  precoPraticado: number | null;
  margemPraticadaPct: number | null;
  itensVendidos30d: number;
  /** Custo / lucro diferentes entre as lojas do filtro: valores = media das lojas. */
  variaPorLoja: boolean;
  /** Pecas pedidas e ainda nao recebidas, somando as lojas do filtro. Null = saldo futuro ainda nao buscado. */
  aReceber: number | null;
  /** Saldo em estoque + a receber. */
  totalGeral: number | null;
  lojas: StockStoreDetail[];
};

export type NegativeStock = { codigo: string; nome: string; quantidade: number; lojas: string[] };

export type StockProductsView = {
  rows: StockProductRow[];
  categorias: string[];
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
export type StockStatus = "negativo" | "aguardando" | "ok";

export function stockStatus(r: StockProductRow): StockStatus {
  if (r.lojas.some((l) => l.estoque < 0)) return "negativo";
  return r.lojas.some((l) => l.transferencias.length > 0) ? "aguardando" : "ok";
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
  for (const l of r.lojas) {
    const unit = l.composicao.custo;
    if (unit == null || l.estoque === 0) continue;
    any = true;
    units.push(unit);
    amount += l.estoque * unit;
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
    for (const [nome, q] of Object.entries(s.locations ?? {})) acc[nome] = (acc[nome] ?? 0) + q;
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
    const nome = cat?.name || code;
    const priceCents = prices.get(code) ?? null;
    const lojas: StockStoreDetail[] = input.stores.map((store) => {
      const estoque = stockBy.get(`${store.id}|${code}`) ?? 0;
      const locais = Object.entries(locationsBy.get(`${store.id}|${code}`) ?? {})
        .filter(([, q]) => q !== 0)
        .map(([nome, q]) => ({ nome, qtd: q }))
        .sort((a, b) => b.qtd - a.qtd);
      const costCents = costCentsFor(input.costPrices, store, code);
      const composicao = composePrice(store, code, priceCents, costCents);
      const ch = chargedBy.get(`${store.id}|${code}`);
      let praticado: StockStoreDetail["praticado"] = null;
      if (ch && ch.items > 0 && ch.revenueCents > 0) {
        const p = composePrice(store, code, Math.round(ch.revenueCents / ch.items), costCents);
        praticado = { preco: ch.revenueCents / ch.items / 100, itens: ch.items, lucro: p.lucro, margemPct: p.margemPct };
      }
      return { store, estoque, locais, transferencias: stockTransfers(locais), composicao, praticado, vendidos30d: ch?.items ?? 0 };
    });

    const neg = lojas.filter((l) => l.estoque < 0);
    if (neg.length > 0) {
      negativos.push({ codigo: code, nome, quantidade: neg.reduce((s, l) => s + l.estoque, 0), lojas: neg.map((l) => l.store.fantasia) });
    }

    const comp = lojas.map((l) => l.composicao);
    const pick = (f: (c: PriceComposition) => number | null) => {
      const vals = comp.map(f);
      return same(vals) ? vals[0]! : mean(vals);
    };
    const estoque = lojas.reduce((s, l) => s + l.estoque, 0);
    const aReceber = allIncomingKnown ? input.stores.reduce((s, store) => s + (incoming.get(`${store.id}|${code}`) ?? 0), 0) : null;
    const varia = comp.length > 1 && !same(comp.map((c) => c.lucro ?? c.custoAquisicao));
    const ch = lojas.filter((l) => l.praticado);
    const itensPraticados = ch.reduce((s, l) => s + l.praticado!.itens, 0);
    const receitaPraticada = ch.reduce((s, l) => s + l.praticado!.preco * l.praticado!.itens, 0);
    const lucroPraticado = ch.every((l) => l.praticado!.lucro != null)
      ? ch.reduce((s, l) => s + l.praticado!.lucro! * l.praticado!.itens, 0)
      : null;

    rows.push({
      codigo: code,
      nome,
      categoria: cat?.category || "Sem categoria",
      estoque,
      aReceber,
      totalGeral: aReceber == null ? null : estoque + aReceber,
      transferir: lojas.reduce((s, l) => s + l.transferencias.reduce((t, x) => t + x.qtd, 0), 0),
      custo: pick((c) => c.custo),
      impostos: pick((c) => c.impostos),
      franquiaAluguel: pick((c) => c.franquiaAluguel),
      custoTotal: pick((c) => c.custoTotal),
      preco: priceCents == null ? null : priceCents / 100,
      lucro: pick((c) => c.lucro),
      margemPct: pick((c) => c.margemPct),
      precoMinimo: pick((c) => c.precoMinimo),
      precoPraticado: itensPraticados > 0 ? receitaPraticada / itensPraticados : null,
      margemPraticadaPct: lucroPraticado != null && receitaPraticada > 0 ? (lucroPraticado / receitaPraticada) * 100 : null,
      itensVendidos30d: lojas.reduce((s, l) => s + l.vendidos30d, 0),
      variaPorLoja: varia,
      lojas,
    });
  }

  rows.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  negativos.sort((a, b) => a.quantidade - b.quantidade);
  return {
    rows,
    categorias: [...new Set(rows.map((r) => r.categoria))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    negativos,
  };
}

/** Tabela mais usada (em pecas) no periodo, somando as lojas; `usadas` = tabelas com venda no periodo, mais usada primeiro. */
export function suggestSaleTable(usage: Array<{ day: string; tableId: number; items: number }>): {
  sugerida: number | null;
  usadas: number[];
} {
  const m = new Map<number, number>();
  for (const u of usage) m.set(u.tableId, (m.get(u.tableId) ?? 0) + u.items);
  const usadas = [...m].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  return { sugerida: usadas[0] ?? null, usadas };
}
