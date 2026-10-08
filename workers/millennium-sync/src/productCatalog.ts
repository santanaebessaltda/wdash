/**
 * Produtos compartilhados pela rede: catalogo (product_type + product_catalog) + cadastro do produto (data de
 * cadastro, quantidade multipla, bloqueado compra  -  relatorio Saldo Atual e Futuro) + tabelas de custo
 * (product_cost_table + product_cost_table_price). Sem relogio  -  cada gatilho busca so a sua parte:
 * - catalogo vazio / produto desconhecido nas vendas  ->  tipos + produtos de cada tipo + cadastro (~21 chamadas);
 * - tabelas de custo vazias  ->  lista de tabelas + precos de todas (~9 chamadas);
 * - produto vendido com custo 0 sem preco na tabela da loja  ->  precos so dessa tabela (1 chamada).
 * No max. 1x por job e 1x a cada 15 min na rede inteira (lease no banco  -  o 1 worker que precisar busca).
 * O que segue faltando depois da recarga nao forca outra por 24h.
 */
import type { CatalogProduct, ProductRegistry, ProductType } from "./millenniumCatalog.ts";
import type { CostTable } from "./millenniumCostTable.ts";

export const CATALOG_MIN_INTERVAL_SEC = 15 * 60;
export const CATALOG_LEASE_SEC = 300;
/** Chamadas simultaneas na recarga (o Atualizar pode estar com outra frente no ERP ao mesmo tempo). */
export const CATALOG_CONCURRENCY = 2;

export type SeenProduct = { erpProductId: number; code: string };
export type CatalogEntry = { code: string; description: string; typeId: number | null };

export type CatalogDeps = {
  countCatalog: () => Promise<number>;
  /** Ids ja no catalogo ou marcados como desconhecidos nas ultimas 24h. */
  knownProductIds: (ids: number[]) => Promise<Set<number>>;
  lookupProducts: (ids: number[]) => Promise<Map<number, CatalogEntry>>;
  claimRefresh: (owner: string, leaseSec: number, minIntervalSec: number) => Promise<boolean>;
  releaseRefresh: (owner: string, ok: boolean, error?: string) => Promise<void>;
  upsertTypes: (types: ProductType[]) => Promise<void>;
  upsertProducts: (products: CatalogProduct[]) => Promise<void>;
  recordMisses: (items: SeenProduct[]) => Promise<void>;
  fetchTypes: (session: string) => Promise<ProductType[]>;
  fetchProductsOfType: (session: string, typeId: number) => Promise<CatalogProduct[]>;
  countCostTables: () => Promise<number>;
  storeCostTable: (storeId: string) => Promise<number | null>;
  /** Codigos com preco na tabela ou marcados sem preco nas ultimas 24h. */
  coveredCostCodes: (tableId: number, codes: string[]) => Promise<Set<string>>;
  recordCostMisses: (tableId: number, codes: string[]) => Promise<void>;
  fetchCostTables: (session: string) => Promise<CostTable[]>;
  fetchCostTablePrices: (session: string, tableId: number) => Promise<Map<string, number>>;
  saveCostTables: (tables: CostTable[]) => Promise<void>;
  saveCostTablePrices: (tableId: number, prices: Map<string, number>) => Promise<void>;
  /** Data de cadastro, quantidade multipla e bloqueado compra (ESTOQUEEMCOMPRA; qualquer loja). */
  fetchRegistry?: (session: string, millenniumStoreId: number) => Promise<ProductRegistry[]>;
  saveRegistry?: (items: ProductRegistry[]) => Promise<number>;
};

/** Estado por job: no max. 1 recarga. */
export type CatalogGuard = { attempted: boolean };

export type ProductsRefresh = {
  /** Recarregou tipos + produtos + cadastro. */
  catalog: boolean;
  /** "all" = lista + precos de todas as tabelas; "one" = precos so da tabela da loja; null = nao mexeu. */
  costTables: "all" | "one" | null;
  types: number;
  products: number;
  tables: number;
  prices: number;
  calls: number;
  /** Produtos com cadastro (data/multipla/bloqueio) gravado; null = nao buscou ou falhou. */
  registry: number | null;
  registryError?: string;
};

export type EnsureCatalogResult =
  | { status: "ok"; unknown: 0 }
  | { status: "skipped"; unknown: number; reason: "job" | "busy" }
  | ({ status: "refreshed"; unknown: number; stillUnknown: number; costMissing: number; stillCostMissing: number } & ProductsRefresh);

/** Mesmo codigo de produto em 2 tipos / mesmo id com 2 codigos: fica o ultimo visto. */
export function dedupeCatalogProducts(products: CatalogProduct[]): CatalogProduct[] {
  const byCode = new Map<string, CatalogProduct>();
  const codeById = new Map<number, string>();
  for (const p of products) {
    const prevCode = codeById.get(p.erpProductId);
    if (prevCode != null && prevCode !== p.code) byCode.delete(prevCode);
    byCode.set(p.code, p);
    codeById.set(p.erpProductId, p.code);
  }
  return [...byCode.values()];
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Tipos, produtos de cada tipo e cadastro (data/multipla/bloqueio  -  soft-fail). */
export async function refreshCatalog(
  deps: CatalogDeps,
  session: string,
  millenniumStoreId?: number,
): Promise<{ types: number; products: number; calls: number; registry: number | null; registryError?: string; productIds: Set<number> }> {
  const types = await deps.fetchTypes(session);
  if (types.length === 0) throw new Error("lookup de tipos voltou vazio");
  await deps.upsertTypes(types);
  const byType = await mapPool(types, CATALOG_CONCURRENCY, (t) => deps.fetchProductsOfType(session, t.typeId));
  const products = dedupeCatalogProducts(byType.flat());
  await deps.upsertProducts(products);

  let registry: number | null = null;
  let registryError: string | undefined;
  let registryCalls = 0;
  if (deps.fetchRegistry && deps.saveRegistry && millenniumStoreId != null) {
    registryCalls = 1;
    try {
      registry = await deps.saveRegistry(await deps.fetchRegistry(session, millenniumStoreId));
    } catch (e) {
      registryError = e instanceof Error ? e.message : String(e);
    }
  }
  return {
    types: types.length,
    products: products.length,
    calls: 1 + types.length + registryCalls,
    registry,
    registryError,
    productIds: new Set(products.map((p) => p.erpProductId)),
  };
}

/** `onlyTableId` = precos so dessa tabela (1 chamada); sem ele = lista de tabelas + precos de todas. */
export async function refreshCostTables(
  deps: CatalogDeps,
  session: string,
  onlyTableId?: number,
): Promise<{ tables: number; prices: number; calls: number; pricesByTable: Map<number, Map<string, number>> }> {
  let tableIds: number[];
  let listCalls = 0;
  if (onlyTableId != null) {
    tableIds = [onlyTableId];
  } else {
    const tables = await deps.fetchCostTables(session);
    if (tables.length === 0) throw new Error("lookup de tabelas de custo voltou vazio");
    await deps.saveCostTables(tables);
    tableIds = tables.map((t) => t.tableId);
    listCalls = 1;
  }
  const pricesByTable = new Map<number, Map<string, number>>();
  let prices = 0;
  await mapPool(tableIds, CATALOG_CONCURRENCY, async (tableId) => {
    const p = await deps.fetchCostTablePrices(session, tableId);
    await deps.saveCostTablePrices(tableId, p);
    pricesByTable.set(tableId, p);
    prices += p.size;
  });
  return { tables: tableIds.length, prices, calls: listCalls + tableIds.length, pricesByTable };
}

export async function ensureProductCatalog(
  deps: CatalogDeps,
  args: {
    session: string;
    seen: SeenProduct[];
    /** Produtos vendidos com custo 0 na margem (completa pela tabela da loja). */
    zeroCost?: { storeId: string; codes: string[] };
    guard: CatalogGuard;
    owner: string;
    /** Loja usada para o cadastro (ESTOQUEEMCOMPRA e por filial, mas igual em todas). */
    millenniumStoreId?: number;
  },
): Promise<EnsureCatalogResult> {
  const catalogEmpty = (await deps.countCatalog()) === 0;
  const tablesEmpty = (await deps.countCostTables()) === 0;

  let unknown: SeenProduct[] = [];
  const ids = [...new Set(args.seen.map((s) => s.erpProductId))];
  if (ids.length > 0) {
    const known = catalogEmpty ? new Set<number>() : await deps.knownProductIds(ids);
    const seenIds = new Set<number>();
    for (const s of args.seen) {
      if (known.has(s.erpProductId) || seenIds.has(s.erpProductId)) continue;
      seenIds.add(s.erpProductId);
      unknown.push(s);
    }
  }

  let costTable: number | null = null;
  let costMissing: string[] = [];
  const zeroCodes = [...new Set(args.zeroCost?.codes ?? [])];
  if (args.zeroCost && zeroCodes.length > 0 && !tablesEmpty) {
    costTable = await deps.storeCostTable(args.zeroCost.storeId);
    if (costTable != null) {
      const covered = await deps.coveredCostCodes(costTable, zeroCodes);
      costMissing = zeroCodes.filter((c) => !covered.has(c));
    }
  }

  const needCatalog = catalogEmpty || unknown.length > 0;
  const costTables: "all" | "one" | null = tablesEmpty ? "all" : costMissing.length > 0 ? "one" : null;
  if (!needCatalog && costTables == null) return { status: "ok", unknown: 0 };
  if (args.guard.attempted) return { status: "skipped", unknown: unknown.length, reason: "job" };
  args.guard.attempted = true;

  const firstLoad = catalogEmpty || tablesEmpty;
  const claimed = await deps.claimRefresh(args.owner, CATALOG_LEASE_SEC, firstLoad ? 0 : CATALOG_MIN_INTERVAL_SEC);
  if (!claimed) return { status: "skipped", unknown: unknown.length, reason: "busy" };

  try {
    const cat = needCatalog ? await refreshCatalog(deps, args.session, args.millenniumStoreId) : null;
    const cost =
      costTables == null ? null : await refreshCostTables(deps, args.session, costTables === "one" ? (costTable ?? undefined) : undefined);
    const still = cat ? unknown.filter((u) => !cat.productIds.has(u.erpProductId)) : [];
    if (still.length > 0) await deps.recordMisses(still);
    const tablePrices = costTable != null ? cost?.pricesByTable.get(costTable) : undefined;
    const stillCost = tablePrices ? costMissing.filter((c) => !tablePrices.has(c)) : costMissing;
    if (costTable != null && stillCost.length > 0) await deps.recordCostMisses(costTable, stillCost);
    await deps.releaseRefresh(args.owner, true);
    return {
      status: "refreshed",
      unknown: unknown.length,
      stillUnknown: still.length,
      costMissing: costMissing.length,
      stillCostMissing: stillCost.length,
      catalog: cat != null,
      costTables,
      types: cat?.types ?? 0,
      products: cat?.products ?? 0,
      tables: cost?.tables ?? 0,
      prices: cost?.prices ?? 0,
      calls: (cat?.calls ?? 0) + (cost?.calls ?? 0),
      registry: cat?.registry ?? null,
      registryError: cat?.registryError,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await deps.releaseRefresh(args.owner, false, msg.slice(0, 500)).catch(() => {});
    throw e;
  }
}
