/**
 * Pedido de compra: saldo guardado (Saldo Atual e Futuro, `store_purchase_stock`), mínimos da loja
 * (`store_purchase_min`), vendidos em 30 dias e busca do saldo no Millennium (Edge `erp-stock-sync`).
 */
import { getSupabase } from "@/lib/supabase";
import { soldHistoryCovers, type PurchaseStockRow } from "./purchaseOrder";
import { fetchAllPages, fetchSalesProductDayAggs } from "./salesRepo";
import type { SalesProductDayAgg } from "./salesTypes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const from = (table: string): any => (getSupabase() as any)?.from(table);

export type PurchaseStockDbRow = {
  product_code: string;
  color: string | null;
  print: string | null;
  size: string | null;
  description: string | null;
  balance: number | string | null;
  open_order: number | string | null;
  total: number | string | null;
  purchase_multiple: number | string | null;
  purchase_blocked: boolean | null;
  registered_at: string | null;
  position: number | string | null;
};

const num = (v: number | string | null | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** numeric do Postgres chega como texto. */
export function purchaseStockFromRow(r: PurchaseStockDbRow): PurchaseStockRow {
  const multiple = r.purchase_multiple == null ? null : num(r.purchase_multiple);
  return {
    code: String(r.product_code).trim(),
    color: (r.color ?? "").trim(),
    print: (r.print ?? "").trim(),
    size: (r.size ?? "").trim(),
    description: (r.description ?? "").trim(),
    balance: num(r.balance),
    openOrder: num(r.open_order),
    total: num(r.total),
    multiple: multiple != null && multiple > 0 ? multiple : null,
    blocked: r.purchase_blocked === true,
    registeredAt: r.registered_at ? r.registered_at.slice(0, 10) : null,
    position: num(r.position),
  };
}

/** Σ itens vendidos por COD_PRODUTO (1 linha por loja × dia × produto). */
export function sold30FromAggs(aggs: Pick<SalesProductDayAgg, "productCode" | "itemCount">[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of aggs) {
    const code = (a.productCode ?? "").trim();
    if (!code) continue;
    out.set(code, (out.get(code) ?? 0) + (Number(a.itemCount) || 0));
  }
  return out;
}

/** Pedidos em aberto por loja x código, e quando cada loja buscou o saldo futuro pela última vez. */
export async function fetchIncomingQty(
  tenantId: string,
  storeIds: string[],
): Promise<{ qty: Map<string, number>; syncedAt: Map<string, string | null> }> {
  const qty = new Map<string, number>();
  const syncedAt = new Map<string, string | null>(storeIds.map((id) => [id, null]));
  if (storeIds.length === 0) return { qty, syncedAt };
  const q = from("store_purchase_stock");
  const storeQ = from("store");
  if (!q || !storeQ) return { qty, syncedAt };
  const [rows, stores] = await Promise.all([
    fetchAllPages<{ store_id: string; product_code: string; open_order: number | string | null }>(
      q
        .select("store_id, product_code, open_order")
        .eq("tenant_id", tenantId)
        .in("store_id", storeIds)
        .order("store_id")
        .order("product_code"),
      "fetchIncomingQty",
    ),
    storeQ.select("id, purchase_synced_at").in("id", storeIds),
  ]);
  for (const s of (stores?.data ?? []) as Array<{ id: string; purchase_synced_at: string | null }>) {
    syncedAt.set(s.id, s.purchase_synced_at);
  }
  for (const r of rows) {
    const code = String(r.product_code).trim();
    if (!code) continue;
    const key = `${r.store_id}|${code}`;
    qty.set(key, (qty.get(key) ?? 0) + num(r.open_order));
  }
  return { qty, syncedAt };
}

export async function fetchPurchaseStock(
  tenantId: string,
  storeId: string,
): Promise<{ rows: PurchaseStockRow[]; syncedAt: string | null }> {
  const q = from("store_purchase_stock");
  if (!q) return { rows: [], syncedAt: null };
  const [rows, store] = await Promise.all([
    fetchAllPages<PurchaseStockDbRow>(
      q
        .select("product_code, color, print, size, description, balance, open_order, total, purchase_multiple, purchase_blocked, registered_at, position")
        .eq("tenant_id", tenantId)
        .eq("store_id", storeId)
        .order("position")
        .order("product_code")
        .order("color")
        .order("print")
        .order("size"),
      "fetchPurchaseStock",
    ),
    from("store").select("purchase_synced_at").eq("id", storeId).maybeSingle(),
  ]);
  return {
    rows: rows.map(purchaseStockFromRow),
    syncedAt: (store?.data?.purchase_synced_at as string | null | undefined) ?? null,
  };
}

export async function fetchPurchaseMins(tenantId: string, storeId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const q = from("store_purchase_min");
  if (!q) return out;
  const rows = await fetchAllPages<{ product_code: string; min_qty: number | string }>(
    q.select("product_code, min_qty").eq("tenant_id", tenantId).eq("store_id", storeId).order("product_code"),
    "fetchPurchaseMins",
  );
  for (const r of rows) out.set(String(r.product_code).trim(), num(r.min_qty));
  return out;
}

/** `null` apaga o mínimo (campo vazio); número grava (0 inclusive). */
export async function savePurchaseMin(tenantId: string, storeId: string, code: string, value: number | null): Promise<boolean> {
  const q = from("store_purchase_min");
  if (!q) return false;
  const { error } =
    value == null
      ? await q.delete().eq("tenant_id", tenantId).eq("store_id", storeId).eq("product_code", code)
      : await q.upsert(
          { tenant_id: tenantId, store_id: storeId, product_code: code, min_qty: value, updated_at: new Date().toISOString() },
          { onConflict: "store_id,product_code" },
        );
  if (error) {
    console.warn("savePurchaseMin:", error.message);
    return false;
  }
  return true;
}

export async function fetchSold30(tenantId: string, storeId: string, fromIso: string, toIso: string): Promise<Map<string, number>> {
  return sold30FromAggs(await fetchSalesProductDayAggs({ tenantId, storeIds: [storeId], from: fromIso, to: toIso }));
}

/**
 * Códigos que a loja já vendeu, ou `null` quando o histórico gravado ainda não cobre 12 meses nem a inauguração
 * (ou a leitura falhou) — aí "Novo" fica só pela data de cadastro.
 */
export async function fetchSoldEver(tenantId: string, storeId: string, todayIso: string): Promise<Set<string> | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const [first, store] = await Promise.all([
      from("sales_day_agg").select("day").eq("tenant_id", tenantId).eq("store_id", storeId).eq("brand", "ALL").order("day").limit(1),
      from("store").select("opened_at").eq("id", storeId).maybeSingle(),
    ]);
    const firstDay = (first?.data?.[0]?.day as string | undefined)?.slice(0, 10) ?? null;
    const openedAt = (store?.data?.opened_at as string | null | undefined)?.slice(0, 10) ?? null;
    if (!soldHistoryCovers(firstDay, openedAt, todayIso)) return null;
    const { data, error } = await sb.rpc("store_sold_product_codes", { p_tenant_id: tenantId, p_store_id: storeId });
    if (error || !Array.isArray(data)) {
      if (error) console.warn("fetchSoldEver:", error.message);
      return null;
    }
    return new Set((data as string[]).map((c) => String(c).trim()).filter(Boolean));
  } catch (e) {
    console.warn("fetchSoldEver:", e);
    return null;
  }
}

export const PURCHASE_SYNC_TITLE = "Não foi possível atualizar o saldo";
export const PURCHASE_SYNC_ERROR = "O pedido usará o último saldo disponível.";
export const PURCHASE_SYNC_BUSY = "Este usuário do Millennium está conectado em outro local. Encerre a outra sessão e tente novamente.";
export const PURCHASE_SYNC_OFFLINE = "Não foi possível conectar à WeDash. Verifique sua conexão e tente novamente.";

/** Código de erro da Edge → texto da tela. */
export function purchaseSyncMessage(error: string | undefined): string {
  if (error === "erp_busy") return PURCHASE_SYNC_BUSY;
  return PURCHASE_SYNC_ERROR;
}

/** Busca o Saldo Atual e Futuro agora. Loja que falhou mantém o saldo guardado. */
export async function syncPurchaseStockNow(
  storeIds: string[],
): Promise<{ ok: true; failedStores: string[] } | { ok: false; message: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, message: PURCHASE_SYNC_OFFLINE };
  const { data, error } = await sb.functions.invoke("erp-stock-sync", { body: { purchaseStoreIds: storeIds } });
  let body = data as { ok?: boolean; error?: string; purchaseFailedStores?: string[] } | null;
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
  if (body?.ok === true) return { ok: true, failedStores: body.purchaseFailedStores ?? [] };
  return { ok: false, message: purchaseSyncMessage(body?.error) };
}
