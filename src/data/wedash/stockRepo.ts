/**
 * Estoque e Tabelas de venda: leitura (estoque da loja, tabelas/precos de venda, tabela usada nas vendas, catalogo)
 * e busca no Millennium sob demanda (Edge `erp-stock-sync`).
 */
import { labelCase } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { fetchAllPages } from "./salesRepo";
import { STOCK_SALES_LOCATION, type StockCatalogItem, type StockInput } from "./stockProducts";

export type SaleTable = { id: number; code: string; description: string; updatedAt: string; pricesAt: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const from = (table: string): any => (getSupabase() as any)?.from(table);

export async function fetchSaleTables(): Promise<SaleTable[]> {
  const q = from("product_sale_table");
  if (!q) return [];
  const { data, error } = await q.select("table_id, code, description, updated_at, prices_at").order("code");
  if (error) {
    console.warn("fetchSaleTables:", error.message);
    return [];
  }
  return (data ?? []).map((r: { table_id: number; code: string; description: string; updated_at: string; prices_at: string | null }) => ({
    id: Number(r.table_id),
    code: String(r.code ?? ""),
    description: labelCase(r.description),
    updatedAt: r.updated_at,
    pricesAt: r.prices_at,
  }));
}

async function priceMap(table: string, idCol: string, valueCol: string, ids: number[]): Promise<Map<number, Map<string, number>>> {
  const out = new Map<number, Map<string, number>>();
  const q = from(table);
  if (!q || ids.length === 0) return out;
  const rows = await fetchAllPages<Record<string, unknown>>(
    q.select(`${idCol}, product_code, ${valueCol}`).in(idCol, ids).order(idCol).order("product_code"),
    `priceMap ${table}`,
  );
  for (const r of rows) {
    const id = Number(r[idCol]);
    const m = out.get(id) ?? new Map<string, number>();
    m.set(String(r.product_code).trim(), Number(r[valueCol]) || 0);
    out.set(id, m);
  }
  return out;
}

/** tabela de venda  ->  COD_PRODUTO  ->  preco (centavos). */
export const fetchSalePrices = (ids: number[]) => priceMap("product_sale_price", "table_id", "price_cents", ids);

/** tabela de custo  ->  COD_PRODUTO  ->  custo unitario (centavos). */
export const fetchCostPrices = (ids: number[]) => priceMap("product_cost_table_price", "table_id", "unit_cost_cents", ids);

export async function fetchStoreStock(
  tenantId: string,
  storeIds: string[],
): Promise<{ rows: StockInput["stock"]; syncedAt: Map<string, string | null> }> {
  const syncedAt = new Map<string, string | null>();
  const q = from("store_stock");
  if (!q || storeIds.length === 0) return { rows: [], syncedAt };
  const [rows, stores] = await Promise.all([
    fetchAllPages<{ store_id: string; product_code: string; quantity: number | string; locations: Record<string, number | string> | null }>(
      q
        .select("store_id, product_code, quantity, locations")
        .eq("tenant_id", tenantId)
        .in("store_id", storeIds)
        .order("store_id")
        .order("product_code"),
      "fetchStoreStock",
    ),
    from("store").select("id, stock_synced_at").in("id", storeIds),
  ]);
  for (const s of (stores.data ?? []) as Array<{ id: string; stock_synced_at: string | null }>) syncedAt.set(s.id, s.stock_synced_at);
  return {
    rows: rows.map((r) => ({
      storeId: r.store_id,
      code: String(r.product_code).trim(),
      qty: Number(r.quantity) || 0,
      locations: locationsUpper(r.locations ?? {}),
    })),
    syncedAt,
  };
}

/**
 * Nome do local em caixa alta; o QUIOSQUE (de onde sai a venda) aparece como "PONTO DE VENDA"  -  "loja" na WDash
 * e a filial. Mesma grafia no ERP soma junto.
 */
function locationsUpper(raw: Record<string, number | string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const upper = k.trim().toUpperCase();
    const nome = upper === "QUIOSQUE" ? STOCK_SALES_LOCATION : upper || "ESTOQUE";
    out[nome] = (out[nome] ?? 0) + (Number(v) || 0);
  }
  return out;
}

/** Itens vendidos por tabela de preco (loja x dia) no periodo. */
export async function fetchPriceTableUsage(
  tenantId: string,
  storeIds: string[],
  fromDay: string,
  toDay: string,
): Promise<Array<{ day: string; tableId: number; tableName: string; items: number }>> {
  const q = from("sales_price_table_day_agg");
  if (!q || storeIds.length === 0) return [];
  const rows = await fetchAllPages<{ day: string; table_id: number; table_name: string; item_count: number; store_id: string }>(
    q
      .select("store_id, day, table_id, table_name, item_count")
      .eq("tenant_id", tenantId)
      .in("store_id", storeIds)
      .gte("day", fromDay)
      .lte("day", toDay)
      .order("day")
      .order("store_id")
      .order("table_id"),
    "fetchPriceTableUsage",
  );
  return rows.map((r) => ({ day: r.day, tableId: Number(r.table_id), tableName: labelCase(r.table_name), items: Number(r.item_count) || 0 }));
}

let catalogPromise: Promise<Map<string, StockCatalogItem>> | null = null;

/** Catalogo global (codigo  ->  nome + categoria). 1x por sessao. */
export function fetchStockCatalog(): Promise<Map<string, StockCatalogItem>> {
  if (catalogPromise) return catalogPromise;
  const run = (async () => {
    const out = new Map<string, StockCatalogItem>();
    const cat = from("product_catalog");
    const types = from("product_type");
    if (!cat || !types) return out;
    const [rows, typeRes] = await Promise.all([
      fetchAllPages<{ product_code: string; description: string | null; type_id: number | null }>(
        cat.select("product_code, description, type_id").order("product_code"),
        "fetchStockCatalog",
      ),
      types.select("type_id, description"),
    ]);
    const typeName = new Map<number, string>(
      ((typeRes.data ?? []) as Array<{ type_id: number; description: string }>).map((t) => [Number(t.type_id), t.description]),
    );
    for (const r of rows) {
      const code = String(r.product_code).trim();
      const category = r.type_id == null ? "" : (typeName.get(Number(r.type_id)) ?? "").trim();
      const categoria = category.toUpperCase();
      out.set(code, { code, name: (r.description ?? "").trim().toUpperCase(), category: categoria === "INDEFINIDO" ? "" : categoria });
    }
    return out;
  })();
  catalogPromise = run;
  void run.then((m) => {
    if (m.size === 0) catalogPromise = null;
  });
  return run;
}

const STOCK_SYNC_ERRORS: Record<string, string> = {
  credential_missing: "Não foi possível acessar o Millennium. Verifique os dados da integração.",
  credential_invalid: "Não foi possível acessar o Millennium. Verifique os dados da integração.",
  integration_paused: "A conexão com o Millennium está desconectada.",
  erp_busy: "Este usuário do Millennium está conectado em outro local. Encerre a outra sessão e tente novamente.",
  forbidden: "Você não tem permissão para buscar o estoque.",
};

/** Busca no Millennium agora (tabelas de venda, precos de tabelas, estoque das lojas). */
export async function syncStockNow(req: {
  saleTables?: boolean;
  salePriceTableIds?: number[];
  stockStoreIds?: string[];
  purchaseStoreIds?: string[];
}): Promise<{ ok: true; failed: string[]; purchaseFailedStores: string[] } | { ok: false; message: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, message: "Não foi possível conectar à WDash. Verifique sua conexão e tente novamente." };
  const { data, error } = await sb.functions.invoke("erp-stock-sync", { body: req });
  let body = data as { ok?: boolean; error?: string; failed?: string[]; purchaseFailedStores?: string[] } | null;
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
  if (body?.ok === true) return { ok: true, failed: body.failed ?? [], purchaseFailedStores: body.purchaseFailedStores ?? [] };
  return {
    ok: false,
    message: STOCK_SYNC_ERRORS[body?.error ?? ""] ?? "Não foi possível buscar o estoque no Millennium. Tente novamente.",
  };
}
