import { getSupabase } from "@/lib/supabase";
import { shiftName } from "@/lib/format";
import {
  excludeNonSalesPeople,
  sellerDayFromRow,
  type NonSalesPeople,
  type SellerDayRow,
} from "./engine/goalRows";
import {
  applyFillToDayAggs,
  applyFillToProductCosts,
  buildTableCostFill,
  type TableCostFill,
} from "./costTableFill";
import {
  DEEP_EMPTY_MONTHS,
  addMonths,
  deepHistoryCap,
  deepHistoryFloor,
  deepHistoryProgress,
  monthStart,
} from "./deepHistory";
import type {
  SalesBrand,
  SalesCategoryDayAgg,
  SalesCategoryRef,
  SalesDayAgg,
  SalesHourAgg,
  SalesPaymentDayAgg,
  SalesProductDayAgg,
  SalesProductCostDayAgg,
  SalesSellerDayAgg,
  SellerShiftRef,
} from "./salesTypes";

export type SalesDayQuery = {
  tenantId: string;
  /** Empty = all stores for tenant. */
  storeIds: string[];
  from: string;
  to: string;
  brand?: SalesBrand | null;
};

export type SalesHourQuery = {
  tenantId: string;
  storeIds: string[];
  /** Um dia ou lista de dias (ex.: mesmo dia da semana nas semanas anteriores). */
  day: string | string[];
  brand?: SalesBrand | null;
};

export type SalesCategoryDayQuery = {
  tenantId: string;
  storeIds: string[];
  from: string;
  to: string;
  brand?: SalesBrand | null;
};

export type SalesPaymentDayQuery = {
  tenantId: string;
  storeIds: string[];
  from: string;
  to: string;
};

export type SalesSellerDayQuery = {
  tenantId: string;
  storeIds: string[];
  from: string;
  to: string;
};

export type SalesProductDayQuery = {
  tenantId: string;
  storeIds: string[];
  from: string;
  to: string;
};

/** Minimal thenable query surface for unit tests (Supabase-compatible). */
export type SalesQueryClient = {
  from: (table: string) => {
    select: (cols: string) => unknown;
  };
};

type DayRow = {
  tenant_id: string;
  store_id: string;
  day: string;
  brand: SalesBrand;
  revenue_cents: number;
  sales_count: number;
  item_count: number;
  cmv_cents?: number | null;
};

type HourRow = DayRow & { hour: number };

type CategoryDayRow = {
  tenant_id: string;
  store_id: string;
  day: string;
  category_id: number;
  category_name: string;
  brand: SalesBrand;
  revenue_cents: number;
  item_count: number;
};

type PaymentDayRow = {
  tenant_id: string;
  store_id: string;
  day: string;
  payment_method: string;
  brand: SalesBrand;
  revenue_cents: number;
  sales_count: number;
};

type ProductDayRow = {
  tenant_id: string;
  store_id: string;
  day: string;
  product_id: number;
  product_code: string;
  product_name: string;
  brand: SalesBrand;
  revenue_cents: number;
  item_count: number;
};

function mapDay(r: DayRow): SalesDayAgg {
  return {
    tenantId: r.tenant_id,
    storeId: r.store_id,
    day: r.day,
    brand: r.brand,
    revenueCents: Number(r.revenue_cents) || 0,
    salesCount: Number(r.sales_count) || 0,
    itemCount: Number(r.item_count) || 0,
    cmvCents: Number(r.cmv_cents) || 0,
  };
}

function mapHour(r: HourRow): SalesHourAgg {
  return {
    ...mapDay(r),
    hour: Number(r.hour),
  };
}

function mapCategoryDay(r: CategoryDayRow): SalesCategoryDayAgg {
  return {
    tenantId: r.tenant_id,
    storeId: r.store_id,
    day: r.day,
    categoryId: Number(r.category_id),
    categoryName: String(r.category_name ?? ""),
    brand: r.brand,
    revenueCents: Number(r.revenue_cents) || 0,
    itemCount: Number(r.item_count) || 0,
  };
}

function mapPaymentDay(r: PaymentDayRow): SalesPaymentDayAgg {
  return {
    tenantId: r.tenant_id,
    storeId: r.store_id,
    day: r.day,
    paymentMethod: String(r.payment_method ?? "") || "Outros",
    brand: r.brand,
    revenueCents: Number(r.revenue_cents) || 0,
    salesCount: Number(r.sales_count) || 0,
  };
}

function mapProductDay(r: ProductDayRow): SalesProductDayAgg {
  return {
    tenantId: r.tenant_id,
    storeId: r.store_id,
    day: r.day,
    productId: Number(r.product_id),
    productCode: String(r.product_code ?? ""),
    productName: String(r.product_name ?? ""),
    brand: r.brand,
    revenueCents: Number(r.revenue_cents) || 0,
    itemCount: Number(r.item_count) || 0,
  };
}

function clientOrNull(override?: SalesQueryClient): SalesQueryClient | null {
  if (override) return override;
  return getSupabase() as unknown as SalesQueryClient | null;
}

/** Fetch daily aggregates for scope. Empty array when none  -  never mock R$. */
export async function fetchSalesDayAggs(
  query: SalesDayQuery,
  clientOverride?: SalesQueryClient,
): Promise<SalesDayAgg[]> {
  const client = clientOrNull(clientOverride);
  if (!client) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = (client.from("sales_day_agg") as any)
    .select("tenant_id, store_id, day, brand, revenue_cents, sales_count, item_count, cmv_cents")
    .eq("tenant_id", query.tenantId)
    .gte("day", query.from)
    .lte("day", query.to);

  if (query.storeIds.length > 0) q = q.in("store_id", query.storeIds);
  if (query.brand) q = q.eq("brand", query.brand);

  const ordered = q.order("day", { ascending: true }).order("store_id").order("brand");
  const days = (await fetchAllPages<DayRow>(ordered, "fetchSalesDayAggs")).map(mapDay);
  if (days.length === 0) return days;
  return applyFillToDayAggs(days, await loadTableCostFill(client, null, query));
}

/**
 * Custo da tabela da loja para os produtos que vieram com custo 0 na margem.
 * `rows` ja carregadas (produto) ou null = busca so as linhas zeradas do periodo. Falha  ->  sem ajuste.
 */
async function loadTableCostFill(
  client: SalesQueryClient,
  rows: SalesProductCostDayAgg[] | null,
  query: { tenantId: string; storeIds: string[]; from: string; to: string },
): Promise<TableCostFill> {
  try {
    let zero = rows?.filter((r) => r.cmvCents === 0 && r.itemCount > 0);
    if (!zero) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = (client.from("sales_product_cost_day_agg") as any)
        .select("store_id, day, product_code, item_count, cmv_cents")
        .eq("tenant_id", query.tenantId)
        .gte("day", query.from)
        .lte("day", query.to)
        .eq("cmv_cents", 0)
        .gt("item_count", 0);
      if (query.storeIds.length > 0) q = q.in("store_id", query.storeIds);
      const ordered = q.order("day", { ascending: true }).order("store_id").order("product_code");
      const raw = await fetchAllPages<Omit<ProductCostDayRow, "tenant_id" | "revenue_cents">>(
        ordered,
        "loadTableCostFill",
      );
      zero = raw.map((r) => ({
        tenantId: query.tenantId,
        storeId: r.store_id,
        day: r.day,
        productCode: String(r.product_code ?? "").trim(),
        itemCount: Number(r.item_count) || 0,
        revenueCents: 0,
        cmvCents: 0,
      }));
    }
    if (zero.length === 0) return new Map();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: stores, error: storeErr } = await (client.from("store") as any)
      .select("id, cost_table_id")
      .in("id", [...new Set(zero.map((r) => r.storeId))]);
    if (storeErr) throw storeErr;
    const storeTable = new Map<string, number>();
    for (const s of (stores ?? []) as Array<{ id: string; cost_table_id: number | string | null }>) {
      if (s.cost_table_id != null) storeTable.set(s.id, Number(s.cost_table_id));
    }
    if (storeTable.size === 0) return new Map();

    const codes = [...new Set(zero.filter((r) => storeTable.has(r.storeId)).map((r) => r.productCode))];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: priceRows, error: priceErr } = await (client.from("product_cost_table_price") as any)
      .select("table_id, product_code, unit_cost_cents")
      .in("table_id", [...new Set(storeTable.values())])
      .in("product_code", codes);
    if (priceErr) throw priceErr;
    const prices = new Map<string, number>();
    for (const p of (priceRows ?? []) as Array<{ table_id: number | string; product_code: string; unit_cost_cents: number }>) {
      prices.set(`${Number(p.table_id)}|${String(p.product_code).trim()}`, Number(p.unit_cost_cents) || 0);
    }
    return buildTableCostFill(zero, storeTable, prices);
  } catch (e) {
    console.warn("loadTableCostFill:", e);
    return new Map();
  }
}

const PAGE_SIZE = 1000;

/**
 * PostgREST corta em 1000 linhas por request (`.limit` maior nao adianta): pagina
 * com `range` quando o client suporta (Supabase). A query precisa de ordem total
 * (inclua a chave da linha no `order`) para as paginas nao repetirem/pularem linhas.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllPages<Row>(ordered: any, label: string): Promise<Row[]> {
  if (typeof ordered.range !== "function") {
    const { data, error } = await ordered;
    if (error) {
      console.warn(`${label}:`, error.message ?? error);
      return [];
    }
    return (data as Row[] | null) ?? [];
  }
  const out: Row[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await ordered.range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.warn(`${label}:`, error.message ?? error);
      return out;
    }
    const rows = (data as Row[] | null) ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

/** Fetch hourly aggregates for one local day. */
export async function fetchSalesHourAggs(
  query: SalesHourQuery,
  clientOverride?: SalesQueryClient,
): Promise<SalesHourAgg[]> {
  const client = clientOrNull(clientOverride);
  if (!client) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = (client.from("sales_hour_agg") as any)
    .select("tenant_id, store_id, day, hour, brand, revenue_cents, sales_count, item_count")
    .eq("tenant_id", query.tenantId);
  if (Array.isArray(query.day)) {
    if (query.day.length === 0) return [];
    q = q.in("day", query.day);
  } else {
    q = q.eq("day", query.day);
  }

  if (query.storeIds.length > 0) q = q.in("store_id", query.storeIds);
  if (query.brand) q = q.eq("brand", query.brand);

  const ordered = q.order("hour", { ascending: true }).order("day").order("store_id").order("brand");
  return (await fetchAllPages<HourRow>(ordered, "fetchSalesHourAggs")).map(mapHour);
}

/** Itens vendidos (top produtos) x catalogo de produtos da rede  ->  receita por tipo de produto. */
const CATEGORY_SOURCE = "sales_category_day_view";

/** Receita diaria por categoria (PRODUTO_TIPO do catalogo). */
export async function fetchSalesCategoryDayAggs(
  query: SalesCategoryDayQuery,
  clientOverride?: SalesQueryClient,
): Promise<SalesCategoryDayAgg[]> {
  const client = clientOrNull(clientOverride);
  if (!client) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = (client.from(CATEGORY_SOURCE) as any)
    .select(
      "tenant_id, store_id, day, category_id, category_name, brand, revenue_cents, item_count",
    )
    .eq("tenant_id", query.tenantId)
    .gte("day", query.from)
    .lte("day", query.to);

  if (query.storeIds.length > 0) q = q.in("store_id", query.storeIds);
  if (query.brand) q = q.eq("brand", query.brand);

  const ordered = q
    .order("day", { ascending: true })
    .order("store_id")
    .order("category_id")
    .order("brand");
  return (await fetchAllPages<CategoryDayRow>(ordered, "fetchSalesCategoryDayAggs")).map(mapCategoryDay);
}

/**
 * Catalogo de categorias ja vistas no sync da loja/rede (sem filtro de periodo).
 * Serve para exibir barras zeradas no grafico de mix.
 */
export async function fetchSalesCategoryCatalog(
  query: { tenantId: string; storeIds: string[]; brand?: SalesBrand | null },
  clientOverride?: SalesQueryClient,
): Promise<SalesCategoryRef[]> {
  const client = clientOrNull(clientOverride);
  if (!client) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = (client.from(CATEGORY_SOURCE) as any)
    .select("category_id, category_name, brand")
    .eq("tenant_id", query.tenantId);

  if (query.storeIds.length > 0) q = q.in("store_id", query.storeIds);
  if (query.brand) q = q.eq("brand", query.brand);

  const data = await fetchAllPages<{ category_id: number; category_name: string; brand: SalesBrand }>(
    q.order("store_id").order("day").order("category_id").order("brand"),
    "fetchSalesCategoryCatalog",
  );

  const byId = new Map<number, SalesCategoryRef>();
  for (const r of data) {
    const id = Number(r.category_id);
    if (!Number.isFinite(id) || byId.has(id)) continue;
    byId.set(id, {
      categoryId: id,
      categoryName: String(r.category_name ?? "") || `Tipo ${id}`,
      brand: r.brand,
    });
  }
  return [...byId.values()].sort((a, b) => a.categoryName.localeCompare(b.categoryName, "pt-BR"));
}

/** Receita diaria por forma de pagamento (CONDICAO / VENDAS.Lista). */
export async function fetchSalesPaymentDayAggs(
  query: SalesPaymentDayQuery,
  clientOverride?: SalesQueryClient,
): Promise<SalesPaymentDayAgg[]> {
  const client = clientOrNull(clientOverride);
  if (!client) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = (client.from("sales_payment_day_agg") as any)
    .select(
      "tenant_id, store_id, day, payment_method, brand, revenue_cents, sales_count",
    )
    .eq("tenant_id", query.tenantId)
    .gte("day", query.from)
    .lte("day", query.to);

  if (query.storeIds.length > 0) q = q.in("store_id", query.storeIds);

  const ordered = q
    .order("day", { ascending: true })
    .order("store_id")
    .order("payment_method")
    .order("brand");
  return (await fetchAllPages<PaymentDayRow>(ordered, "fetchSalesPaymentDayAggs")).map(mapPaymentDay);
}

export { excludeNonSalesPeople, type NonSalesPeople } from "./engine/goalRows";

export async function fetchNonSalesPeople(client: SalesQueryClient, tenantId: string): Promise<NonSalesPeople> {
  const out: NonSalesPeople = { employeeIds: new Set(), geradorIds: new Set(), storeNameKeys: new Set() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client.from("store_seller") as any)
    .select("store_id, millennium_employee_id, millennium_gerador_id, name_keys")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .not("erp_role", "is", null)
    .neq("erp_role", "VENDEDOR");
  if (error) {
    console.warn("fetchNonSalesPeople:", error.message);
    return out;
  }
  for (const r of (data ?? []) as {
    store_id: string;
    millennium_employee_id: number | null;
    millennium_gerador_id: number | null;
    name_keys: string[] | null;
  }[]) {
    if (r.millennium_employee_id != null) out.employeeIds.add(Number(r.millennium_employee_id));
    if (r.millennium_gerador_id != null) out.geradorIds.add(Number(r.millennium_gerador_id));
    for (const k of r.name_keys ?? []) out.storeNameKeys.add(`${r.store_id}|${k}`);
  }
  return out;
}

/** Funcionarias com turno definido em Configuracoes > Lojas (vazio se a migration de turnos nao existir). */
export async function fetchSellerShifts(
  tenantId: string,
  clientOverride?: SalesQueryClient,
): Promise<SellerShiftRef[]> {
  const client = clientOrNull(clientOverride);
  if (!client) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client.from("store_seller") as any)
    .select("store_id, millennium_employee_id, millennium_gerador_id, name_keys, store_shift(name, start_time, end_time)")
    .eq("tenant_id", tenantId)
    .not("shift_id", "is", null);
  if (error) {
    console.warn("fetchSellerShifts:", error.message);
    return [];
  }
  const out: SellerShiftRef[] = [];
  for (const r of (data ?? []) as {
    store_id: string;
    millennium_employee_id: number | null;
    millennium_gerador_id: number | null;
    name_keys: string[] | null;
    store_shift: { name: string; start_time: string; end_time: string } | null;
  }[]) {
    if (!r.store_shift) continue;
    out.push({
      storeId: r.store_id,
      employeeId: r.millennium_employee_id == null ? null : Number(r.millennium_employee_id),
      geradorId: r.millennium_gerador_id == null ? null : Number(r.millennium_gerador_id),
      nameKeys: r.name_keys ?? [],
      name: shiftName(r.store_shift.name),
      start: String(r.store_shift.start_time).slice(0, 5),
      end: String(r.store_shift.end_time).slice(0, 5),
    });
  }
  return out;
}

/** Receita diaria por vendedora (VENDEDOR_MILLENNIUM / VENDAS.Lista), sem gerencia / conta de freelancer. */
export async function fetchSalesSellerDayAggs(
  query: SalesSellerDayQuery,
  clientOverride?: SalesQueryClient,
): Promise<SalesSellerDayAgg[]> {
  const client = clientOrNull(clientOverride);
  if (!client) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = (client.from("sales_seller_day_agg") as any)
    .select(
      "tenant_id, store_id, day, seller_key, seller_name, seller_employee_id, seller_gerador_id, brand, revenue_cents, sales_count, item_count",
    )
    .eq("tenant_id", query.tenantId)
    .gte("day", query.from)
    .lte("day", query.to);

  if (query.storeIds.length > 0) q = q.in("store_id", query.storeIds);

  const ordered = q
    .order("day", { ascending: true })
    .order("store_id")
    .order("seller_key")
    .order("brand");
  const [rows, nonSales] = await Promise.all([
    fetchAllPages<SellerDayRow>(ordered, "fetchSalesSellerDayAggs"),
    fetchNonSalesPeople(client, query.tenantId),
  ]);
  return excludeNonSalesPeople(rows.map(sellerDayFromRow), nonSales);
}

/** Receita diaria por SKU ({E7A5C5C7} VENDAS DE PRODUTOS POR FILIAL). */
export async function fetchSalesProductDayAggs(
  query: SalesProductDayQuery,
  clientOverride?: SalesQueryClient,
): Promise<SalesProductDayAgg[]> {
  const client = clientOrNull(clientOverride);
  if (!client) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = (client.from("sales_product_day_agg") as any)
    .select(
      "tenant_id, store_id, day, product_id, product_code, product_name, brand, revenue_cents, item_count",
    )
    .eq("tenant_id", query.tenantId)
    .gte("day", query.from)
    .lte("day", query.to);

  if (query.storeIds.length > 0) q = q.in("store_id", query.storeIds);

  const ordered = q
    .order("day", { ascending: true })
    .order("store_id")
    .order("product_id")
    .order("brand");
  return (await fetchAllPages<ProductDayRow>(ordered, "fetchSalesProductDayAggs")).map(mapProductDay);
}

let catalogDescriptions: Promise<string[]> | null = null;

/** Descricoes do catalogo de produtos (global, ~600 linhas)  -  base das linhas de produto. 1x por sessao. */
export function fetchProductCatalogDescriptions(clientOverride?: SalesQueryClient): Promise<string[]> {
  if (catalogDescriptions && !clientOverride) return catalogDescriptions;
  const client = clientOrNull(clientOverride);
  if (!client) return Promise.resolve([]);
  const run = (async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = (client.from("product_catalog") as any).select("description").order("product_code");
    const rows = await fetchAllPages<{ description: string | null }>(q, "fetchProductCatalogDescriptions");
    return rows.map((r) => r.description ?? "").filter(Boolean);
  })();
  if (!clientOverride) {
    catalogDescriptions = run;
    // Falha de leitura volta vazia  ->  tenta de novo no proximo carregamento.
    void run.then((rows) => {
      if (rows.length === 0) catalogDescriptions = null;
    });
  }
  return run;
}

let catalogTypes: Promise<Record<number, number>> | null = null;

/**
 * id do produto no ERP  ->  tipo (categoria), mesmo join da `sales_category_day_view`.
 * Global (~600 linhas), 1x por sessao. Falha  ->  {} (detalhe da Curva ABC fica sem produtos).
 */
export function fetchProductCatalogTypes(clientOverride?: SalesQueryClient): Promise<Record<number, number>> {
  if (catalogTypes && !clientOverride) return catalogTypes;
  const client = clientOrNull(clientOverride);
  if (!client) return Promise.resolve({});
  const run = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = (client.from("product_catalog") as any).select("erp_product_id, type_id").order("product_code");
      const rows = await fetchAllPages<{ erp_product_id: number; type_id: number | null }>(q, "fetchProductCatalogTypes");
      const out: Record<number, number> = {};
      for (const r of rows) if (r.type_id != null) out[Number(r.erp_product_id)] = Number(r.type_id);
      return out;
    } catch (e) {
      console.error("fetchProductCatalogTypes:", e);
      return {};
    }
  })();
  if (!clientOverride) {
    catalogTypes = run;
    void run.then((m) => {
      if (Object.keys(m).length === 0) catalogTypes = null;
    });
  }
  return run;
}

/** COD_PRODUTO  ->  descricao do catalogo. Falha de leitura  ->  {} (aviso mostra so o codigo). */
export async function fetchProductNames(
  codes: string[],
  clientOverride?: SalesQueryClient,
): Promise<Record<string, string>> {
  const client = clientOrNull(clientOverride);
  const uniq = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  if (!client || uniq.length === 0) return {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (client.from("product_catalog") as any)
      .select("product_code, description")
      .in("product_code", uniq);
    if (error) throw error;
    const out: Record<string, string> = {};
    for (const r of (data ?? []) as Array<{ product_code: string; description: string | null }>) {
      if (r.description) out[String(r.product_code).trim()] = r.description;
    }
    return out;
  } catch (e) {
    console.warn("fetchProductNames:", e);
    return {};
  }
}

type ProductCostDayRow = {
  tenant_id: string;
  store_id: string;
  day: string;
  product_code: string;
  item_count: number;
  revenue_cents: number;
  cmv_cents: number;
};

/** CMV diario por COD_PRODUTO (RELATORIOMARGEM). Falha de leitura  ->  [] (colunas de custo ficam " - "). */
export async function fetchSalesProductCostDayAggs(
  query: SalesProductDayQuery,
  clientOverride?: SalesQueryClient,
): Promise<SalesProductCostDayAgg[]> {
  const client = clientOrNull(clientOverride);
  if (!client) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = (client.from("sales_product_cost_day_agg") as any)
    .select("tenant_id, store_id, day, product_code, item_count, revenue_cents, cmv_cents")
    .eq("tenant_id", query.tenantId)
    .gte("day", query.from)
    .lte("day", query.to);

  if (query.storeIds.length > 0) q = q.in("store_id", query.storeIds);

  const ordered = q.order("day", { ascending: true }).order("store_id").order("product_code");
  try {
    const rows = (await fetchAllPages<ProductCostDayRow>(ordered, "fetchSalesProductCostDayAggs")).map((r) => ({
      tenantId: r.tenant_id,
      storeId: r.store_id,
      day: r.day,
      productCode: String(r.product_code ?? "").trim(),
      itemCount: Number(r.item_count) || 0,
      revenueCents: Number(r.revenue_cents) || 0,
      cmvCents: Number(r.cmv_cents) || 0,
    }));
    return applyFillToProductCosts(rows, await loadTableCostFill(client, rows, query));
  } catch (e) {
    console.warn("fetchSalesProductCostDayAggs:", e);
    return [];
  }
}

/** Tenant watermark of last successful light sync. */
export async function fetchSyncWatermark(
  tenantId: string,
  clientOverride?: SalesQueryClient,
): Promise<Date | null> {
  const client = clientOrNull(clientOverride);
  if (!client) return null;

  // Prefer light watermark; fall back to any successful sync (e.g. onboarding BACKFILL).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client.from("erp_credential") as any)
    .select("last_light_sync_at, last_success_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.warn("fetchSyncWatermark:", error.message ?? error);
    return null;
  }
  const row = data as {
    last_light_sync_at?: string | null;
    last_success_at?: string | null;
  } | null;
  const raw = row?.last_light_sync_at ?? row?.last_success_at ?? null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function requestForceRefresh(opts: {
  from: string;
  to: string;
  /** Empty / omit = all stores; otherwise only these store UUIDs. */
  storeIds?: string[];
}): Promise<
  | { ok: true; jobId?: string }
  | { ok: false; retryAfterSec?: number; error: string }
> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "supabase_unavailable" };
  const { data, error } = await sb.functions.invoke("erp-sync-enqueue", {
    body: {
      action: "force",
      from: opts.from,
      to: opts.to,
      ...(opts.storeIds && opts.storeIds.length > 0 ? { storeIds: opts.storeIds } : {}),
    },
  });

  // Em non-2xx o invoke preenche `error` e as vezes deixa `data` vazio  - 
  // o JSON real (rate_limited etc.) vem em error.context.
  let body = data as {
    ok?: boolean;
    error?: string;
    retryAfterSec?: number;
    job?: { id?: string };
  } | null;
  if ((!body || typeof body !== "object") && error && typeof error === "object") {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        body = (await ctx.json()) as typeof body;
      } catch {
        /* ignore */
      }
    }
  }

  if (body?.ok === true) {
    const jobId = body.job?.id ? String(body.job.id) : undefined;
    return { ok: true, jobId };
  }
  if (body?.error === "rate_limited" || body?.error === "range_too_large") {
    return {
      ok: false,
      error: body.error,
      retryAfterSec: body.retryAfterSec,
    };
  }
  if (body?.ok === false && body.error) {
    return { ok: false, error: body.error, retryAfterSec: body.retryAfterSec };
  }
  if (error) {
    const msg = error.message ?? "enqueue_failed";
    if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
      return { ok: false, error: "rate_limited", retryAfterSec: 300 };
    }
    return { ok: false, error: msg };
  }
  return { ok: false, error: body?.error ?? "enqueue_failed" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type SyncJobWaitResult =
  | { status: "SUCCEEDED" }
  | { status: "FAILED"; error: string | null }
  | { status: "TIMEOUT" }
  | { status: "CANCELLED" };

/** Uma leitura do status  -  usado ao voltar da aba (nao piscar "Atualizando..." se ja terminou). */
export async function peekSyncJob(jobId: string): Promise<SyncJobWaitResult | null> {
  const sb = getSupabase();
  if (!sb) return { status: "FAILED", error: "supabase_unavailable" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.from("sync_job") as any)
    .select("status, error")
    .eq("id", jobId)
    .maybeSingle();
  if (error) {
    console.warn("peekSyncJob:", error.message ?? error);
    return null;
  }
  if (!data) return null;
  const row = data as { status?: string; error?: string | null };
  const st = String(row.status ?? "");
  if (st === "SUCCEEDED") return { status: "SUCCEEDED" };
  if (st === "FAILED" || st === "CANCELLED") {
    return { status: "FAILED", error: row.error ?? null };
  }
  // QUEUED / RUNNING / desconhecido  -  ainda em andamento
  return null;
}

/**
 * Espera o sync_job chegar em SUCCEEDED/FAILED (poll).
 * FORCE pode demorar (Lista + DetMov); default 12 min.
 * `onStatus` recebe QUEUED/RUNNING a cada poll (UI: Na fila... / Atualizando...).
 */
export async function waitForSyncJob(
  jobId: string,
  opts?: {
    timeoutMs?: number;
    pollMs?: number;
    signal?: AbortSignal;
    onStatus?: (status: string) => void;
  },
): Promise<SyncJobWaitResult> {
  const sb = getSupabase();
  if (!sb) return { status: "FAILED", error: "supabase_unavailable" };
  const timeoutMs = opts?.timeoutMs ?? 12 * 60 * 1000;
  const pollMs = opts?.pollMs ?? 1_000;
  const started = Date.now();
  let lastReported: string | null = null;

  while (Date.now() - started < timeoutMs) {
    if (opts?.signal?.aborted) return { status: "CANCELLED" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (sb.from("sync_job") as any)
      .select("status, error")
      .eq("id", jobId)
      .maybeSingle();
    if (error) {
      console.warn("waitForSyncJob:", error.message ?? error);
    } else if (data) {
      const row = data as { status?: string; error?: string | null };
      const st = String(row.status ?? "");
      if (st && st !== lastReported) {
        lastReported = st;
        opts?.onStatus?.(st);
      }
      if (st === "SUCCEEDED") return { status: "SUCCEEDED" };
      if (st === "FAILED" || st === "CANCELLED") {
        return { status: "FAILED", error: row.error ?? null };
      }
    }
    await sleep(pollMs);
  }
  return { status: "TIMEOUT" };
}

/** Fallback quando o enqueue nao devolveu jobId  -  pega o FORCE mais recente do tenant. */
export async function waitForLatestForceJob(
  tenantId: string,
  opts?: { sinceIso?: string; timeoutMs?: number; pollMs?: number; signal?: AbortSignal },
): Promise<SyncJobWaitResult> {
  const sb = getSupabase();
  if (!sb) return { status: "FAILED", error: "supabase_unavailable" };
  const timeoutMs = opts?.timeoutMs ?? 12 * 60 * 1000;
  const pollMs = opts?.pollMs ?? 2_000;
  const started = Date.now();
  const sinceMs = opts?.sinceIso ? new Date(opts.sinceIso).getTime() : 0;

  while (Date.now() - started < timeoutMs) {
    if (opts?.signal?.aborted) return { status: "CANCELLED" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (sb.from("sync_job") as any)
      .select("id, status, error, created_at")
      .eq("tenant_id", tenantId)
      .eq("kind", "FORCE")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("waitForLatestForceJob:", error.message ?? error);
    } else if (data) {
      const row = data as {
        status?: string;
        error?: string | null;
        created_at?: string | null;
      };
      const created = row.created_at ? new Date(row.created_at).getTime() : 0;
      if (!sinceMs || created >= sinceMs - 5_000) {
        const st = String(row.status ?? "");
        if (st === "SUCCEEDED") return { status: "SUCCEEDED" };
        if (st === "FAILED" || st === "CANCELLED") {
          return { status: "FAILED", error: row.error ?? null };
        }
      }
    }
    await sleep(pollMs);
  }
  return { status: "TIMEOUT" };
}

/** Status do job SEED mais recente (para tela de sincronizacao). */
export async function fetchLatestSeedJob(
  tenantId: string,
  clientOverride?: SalesQueryClient,
): Promise<{ status: string; error: string | null; finishedAt: string | null; createdAt: string | null } | null> {
  const client = clientOrNull(clientOverride);
  if (!client) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client.from("sync_job") as any)
    .select("status, error, finished_at, created_at")
    .eq("tenant_id", tenantId)
    .in("kind", ["SEED", "BACKFILL"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("fetchLatestSeedJob:", error.message ?? error);
    return null;
  }
  if (!data) return null;
  const row = data as {
    status: string;
    error: string | null;
    finished_at?: string | null;
    created_at?: string | null;
  };
  return {
    status: String(row.status),
    error: row.error ?? null,
    finishedAt: row.finished_at ?? null,
    createdAt: row.created_at ?? null,
  };
}

/**
 * Libera pos-onboarding so quando:
 * 1) SEED mais recente esta SUCCEEDED
 * 2) A cobertura em sales_day_agg cobre a janela SEED (mes ant.  ->  hoje)
 *
 * O flag `since` so evita liberar com SEED antigo **sem** cobertura.
 * Se os dias ja estao no banco, libera mesmo se o relogio do retry/F5
 * tiver sido bumpado depois do SUCCEEDED (senao a UI fica em "Buscando" pra sempre).
 */
export async function fetchSyncReady(
  tenantId: string,
  opts?: { sinceIso?: string | null; seedFrom?: string; seedTo?: string },
  clientOverride?: SalesQueryClient,
): Promise<boolean> {
  const seed = await fetchLatestSeedJob(tenantId, clientOverride);
  if (!seed || seed.status !== "SUCCEEDED" || !seed.finishedAt) return false;

  const seedFrom = opts?.seedFrom;
  const seedTo = opts?.seedTo;
  if (seedFrom && seedTo) {
    const days = await countSalesDays(tenantId, seedFrom, seedTo, clientOverride);
    const { expectedDays } = seedCoverageWindow(seedTo);
    const minDays = Math.min(expectedDays, Math.max(2, Math.ceil(expectedDays * 0.9)));
    if (days < minDays) return false;

    const cov = await fetchSalesCoverage(tenantId, [], clientOverride);
    if (!cov.from || cov.from > seedFrom) return false;

    return true;
  }

  if (opts?.sinceIso) {
    const finished = new Date(seed.finishedAt).getTime();
    const since = new Date(opts.sinceIso).getTime();
    if (!Number.isNaN(since) && finished < since) return false;
  }

  return true;
}

/** Janela do SEED = so hoje (o resto do mes carrega por tras  -  ver `fetchMonthFill`). */
export function seedCoverageWindow(todayIso: string): {
  from: string;
  to: string;
  expectedDays: number;
} {
  return { from: todayIso, to: todayIso, expectedDays: 1 };
}

/** Carga do mes pos-onboarding (jobs CLOSE com `fillUntil`), do dia mais recente para o dia 1. */
export type MonthFill = {
  /** Dia sendo carregado agora (ou o proximo da fila). Dias  este ainda faltam. */
  currentDay: string;
  /** Dia 1 do mes (fim da carga). */
  fillUntil: string;
};

/**
 * Progresso da carga funda (madrugada): meses cobertos / horizonte.
 * Null = nada a mostrar (desligada, ainda nao comecou, ou ja completa).
 */
export type DeepHistoryFill = {
  done: number;
  total: number;
  /** Proximo mes a carregar (YYYY-MM-01). */
  nextMonth: string;
  /** Dia mais antigo ja gravado na rede. */
  oldestLoaded: string;
};

/** Carga do mes em andamento, ou null quando nao ha nada na fila. */
export async function fetchMonthFill(
  tenantId: string,
  clientOverride?: SalesQueryClient,
): Promise<MonthFill | null> {
  const client = clientOrNull(clientOverride);
  if (!client) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client.from("sync_job") as any)
    .select("payload")
    .eq("tenant_id", tenantId)
    .eq("kind", "CLOSE")
    .in("status", ["QUEUED", "RUNNING"])
    .not("payload->>fillUntil", "is", null)
    .is("payload->>deep", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("fetchMonthFill:", error.message ?? error);
    return null;
  }
  const payload = (data as { payload?: { to?: unknown; fillUntil?: unknown; progressDay?: unknown } } | null)
    ?.payload;
  if (typeof payload?.to !== "string" || typeof payload.fillUntil !== "string") return null;
  // Job em periodo (mes inteiro): o worker grava o ultimo dia concluido; falta o dia anterior a ele.
  const currentDay =
    typeof payload.progressDay === "string" ? previousIsoDay(payload.progressDay.slice(0, 10)) : payload.to.slice(0, 10);
  return { currentDay, fillUntil: payload.fillUntil.slice(0, 10) };
}

function previousIsoDay(iso: string): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) - 1));
  return d.toISOString().slice(0, 10);
}

/** Dias ja carregados / total do mes (hoje conta como carregado). */
export function monthFillProgress(fill: MonthFill, todayIso: string): { done: number; total: number } {
  const toMs = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const DAY = 86_400_000;
  const total = Math.round((toMs(todayIso) - toMs(fill.fillUntil)) / DAY) + 1;
  const done = Math.round((toMs(todayIso) - toMs(fill.currentDay)) / DAY);
  return { done: Math.max(0, Math.min(total, done)), total: Math.max(1, total) };
}

/**
 * Progresso da recuperacao de vendas antigas (DEEP_HISTORY).
 * So aparece depois que o worker enfileirou pelo menos 1 job `deep` (se DEEP_HISTORY=off, nunca mostra).
 */
export async function fetchDeepHistoryFill(
  tenantId: string,
  todayIso: string,
  clientOverride?: SalesQueryClient,
): Promise<DeepHistoryFill | null> {
  const client = clientOrNull(clientOverride);
  if (!client) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = client as any;
  const { data: doneMarker, error: doneErr } = await c
    .from("sync_job")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("payload->>deepDone", "true")
    .limit(1)
    .maybeSingle();
  if (doneErr) {
    console.warn("fetchDeepHistoryFill deepDone:", doneErr.message ?? doneErr);
    return null;
  }
  if (doneMarker) return null;

  const { data: deepJob, error: deepErr } = await c
    .from("sync_job")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("kind", "CLOSE")
    .eq("payload->>deep", "true")
    .limit(1)
    .maybeSingle();
  if (deepErr) {
    console.warn("fetchDeepHistoryFill deep job:", deepErr.message ?? deepErr);
    return null;
  }
  if (!deepJob) return null;

  const { data: storeRows, error: storeErr } = await c
    .from("store")
    .select("id, opened_at")
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (storeErr) {
    console.warn("fetchDeepHistoryFill stores:", storeErr.message ?? storeErr);
    return null;
  }
  const stores = (storeRows ?? []) as Array<{ id: string; opened_at?: string | null }>;
  if (stores.length === 0) return null;

  const cap = deepHistoryCap(todayIso);
  const deepStores: Array<{
    id: string;
    oldestDay: string | null;
    floor: string;
    emptyTail: boolean;
  }> = [];

  for (const s of stores) {
    const { data: oldestRow, error: oldErr } = await c
      .from("sales_day_agg")
      .select("day")
      .eq("store_id", s.id)
      .eq("brand", "ALL")
      .order("day", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (oldErr) {
      console.warn("fetchDeepHistoryFill oldest:", oldErr.message ?? oldErr);
      return null;
    }
    const oldestDay = oldestRow?.day ? String(oldestRow.day).slice(0, 10) : null;
    const openedAt = s.opened_at ? String(s.opened_at).slice(0, 10) : null;
    let emptyTail = false;
    if (!openedAt && oldestDay && oldestDay === monthStart(oldestDay)) {
      const { data: tail, error: tailErr } = await c
        .from("sales_day_agg")
        .select("revenue_cents")
        .eq("store_id", s.id)
        .eq("brand", "ALL")
        .gte("day", oldestDay)
        .lt("day", addMonths(oldestDay, DEEP_EMPTY_MONTHS));
      if (tailErr) {
        console.warn("fetchDeepHistoryFill emptyTail:", tailErr.message ?? tailErr);
        return null;
      }
      emptyTail = ((tail ?? []) as Array<{ revenue_cents?: number | null }>).every(
        (r) => Number(r.revenue_cents ?? 0) === 0,
      );
    }
    deepStores.push({
      id: s.id,
      oldestDay,
      floor: deepHistoryFloor(openedAt, cap),
      emptyTail,
    });
  }

  const progress = deepHistoryProgress(deepStores, todayIso);
  if (!progress || progress.nextMonth == null || progress.done >= progress.total) return null;
  const loaded = deepStores.map((s) => s.oldestDay).filter((d): d is string => d != null);
  if (loaded.length === 0) return null;
  const oldestLoaded = loaded.reduce((a, b) => (b < a ? b : a));
  return {
    done: progress.done,
    total: progress.total,
    nextMonth: progress.nextMonth,
    oldestLoaded,
  };
}

/** Dias distintos com venda no periodo (UI de progresso). */
export async function countSalesDays(
  tenantId: string,
  from: string,
  to: string,
  clientOverride?: SalesQueryClient,
): Promise<number> {
  const client = clientOrNull(clientOverride);
  if (!client) return 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = (client.from("sales_day_agg") as any)
    .select("day")
    .eq("tenant_id", tenantId)
    .gte("day", from)
    .lte("day", to);
  const { data, error } = await q;
  if (error) {
    console.warn("countSalesDays:", error.message ?? error);
    return 0;
  }
  const days = new Set<string>();
  for (const r of (data as { day: string }[] | null) ?? []) {
    days.add(String(r.day).slice(0, 10));
  }
  return days.size;
}

/** Cobertura sincronizada (min/max day)  -  DateRangePicker bloqueia fora disso. */
export async function fetchSalesCoverage(
  tenantId: string,
  storeIds: string[] = [],
  clientOverride?: SalesQueryClient,
): Promise<{ from: string | null; to: string | null }> {
  const client = clientOrNull(clientOverride);
  if (!client) return { from: null, to: null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let qMin: any = (client.from("sales_day_agg") as any)
    .select("day")
    .eq("tenant_id", tenantId)
    .order("day", { ascending: true })
    .limit(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let qMax: any = (client.from("sales_day_agg") as any)
    .select("day")
    .eq("tenant_id", tenantId)
    .order("day", { ascending: false })
    .limit(1);
  if (storeIds.length > 0) {
    qMin = qMin.in("store_id", storeIds);
    qMax = qMax.in("store_id", storeIds);
  }

  const [minRes, maxRes] = await Promise.all([qMin.maybeSingle(), qMax.maybeSingle()]);
  if (minRes.error) {
    console.warn("fetchSalesCoverage min:", minRes.error.message ?? minRes.error);
    return { from: null, to: null };
  }
  if (maxRes.error) {
    console.warn("fetchSalesCoverage max:", maxRes.error.message ?? maxRes.error);
    return { from: null, to: null };
  }
  const from = minRes.data?.day ? String(minRes.data.day).slice(0, 10) : null;
  const to = maxRes.data?.day ? String(maxRes.data.day).slice(0, 10) : null;
  return { from, to };
}

/** Dias de calendario inclusivos entre from e to (YYYY-MM-DD). */
export function calendarDaysInclusive(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.floor((b - a) / 86_400_000) + 1;
}

/** Meses civis na janela SEED (igual ao worker). */
export function seedMonthWindows(from: string, to: string): Array<{ from: string; to: string }> {
  if (from > to) return [];
  const out: Array<{ from: string; to: string }> = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const wFrom = monthStart < from ? from : monthStart;
    const wTo = monthEnd > to ? to : monthEnd;
    if (wFrom <= wTo) out.push({ from: wFrom, to: wTo });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export type SyncStoreRow = {
  id: string;
  code: string;
  name: string;
};

/** Lojas ativas do tenant (progresso SEED por filial). */
export async function fetchTenantStores(
  tenantId: string,
  clientOverride?: SalesQueryClient,
): Promise<SyncStoreRow[]> {
  const client = clientOrNull(clientOverride);
  if (!client) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client.from("store") as any)
    .select("id, code, trade_name, name")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("code");
  if (error) {
    console.warn("fetchTenantStores:", error.message ?? error);
    return [];
  }
  return ((data as Array<{ id: string; code: string | null; trade_name: string | null; name: string | null }> | null) ?? []).map(
    (r) => ({
      id: r.id,
      code: r.code || "—",
      name: (r.trade_name || r.name || r.code || "Loja").trim(),
    }),
  );
}

/**
 * Cobertura por loja na janela SEED: storeId  ->  set de dias YYYY-MM-DD.
 * Uma query so (poll da SyncingPage).
 */
export async function fetchSeedDaysByStore(
  tenantId: string,
  from: string,
  to: string,
  clientOverride?: SalesQueryClient,
): Promise<Map<string, Set<string>>> {
  const client = clientOrNull(clientOverride);
  const out = new Map<string, Set<string>>();
  if (!client) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client.from("sales_day_agg") as any)
    .select("store_id, day")
    .eq("tenant_id", tenantId)
    .gte("day", from)
    .lte("day", to);
  if (error) {
    console.warn("fetchSeedDaysByStore:", error.message ?? error);
    return out;
  }
  for (const r of (data as { store_id: string; day: string }[] | null) ?? []) {
    const sid = String(r.store_id);
    const day = String(r.day).slice(0, 10);
    let set = out.get(sid);
    if (!set) {
      set = new Set();
      out.set(sid, set);
    }
    set.add(day);
  }
  return out;
}

/** Quantos dias da janela [from,to] ja existem no set. */
export function countDaysInWindow(days: Set<string> | undefined, from: string, to: string): number {
  if (!days || days.size === 0) return 0;
  let n = 0;
  for (const d of days) {
    if (d >= from && d <= to) n += 1;
  }
  return n;
}
