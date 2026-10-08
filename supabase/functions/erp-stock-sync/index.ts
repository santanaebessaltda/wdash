/**
 * erp-stock-sync — Estoque > Produtos (Gestor e Gerente). Síncrono, sem fila do worker e sem lease do catálogo.
 * Corpo (qualquer combinação; cada parte é independente — falhou uma, as outras seguem):
 * - `saleTables: true` → lista de tabelas de preço de venda (`tabela_venda.TABELA`, 1 chamada).
 * - `salePriceTableIds: number[]` → preços de venda de cada tabela (wtsreports {24B9BF6D}, ~3,5s cada).
 * - `stockStoreIds: string[]` → estoque atual de cada loja por local (ESTOQUEPORLOCAL; total = soma dos locais; 2 por vez).
 * - `purchaseStoreIds: string[]` → Saldo Atual e Futuro de cada loja (ESTOQUEEMCOMPRA, Pedido de compra; 2 por vez).
 *   Loja que falhou mantém o saldo guardado e volta em `purchaseFailedStores`; o cadastro (data, múltipla,
 *   bloqueado) do mesmo retorno atualiza o catálogo (best-effort).
 * Gerente só busca estoque/saldo das lojas dele (membership_store vazio = todas).
 * Tabelas e preços de venda (catálogo global) = só Gestor.
 * Reusa o token salvo em erp_credential; 401 → login com a senha cifrada e persiste o token novo.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, serve } from "../_shared/cors.ts";
import { loginMillennium } from "../_shared/millennium.ts";
import { MillenniumHttpError } from "../_shared/millenniumSellers.ts";
import { fetchPurchaseStock, fetchSalePrices, fetchSaleTables, fetchStoreStock } from "../_shared/millenniumProducts.ts";
import { purchaseRegistry, type PurchaseRegistry } from "../_shared/purchaseStock.ts";

const MAX_PRICE_TABLES = 20;
const STOCK_CONCURRENCY = 2;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function decryptPassword(ciphertext: string, secret: string): Promise<string> {
  const [ivB64, dataB64] = ciphertext.split(".");
  if (!ivB64 || !dataB64) throw new Error("invalid_ciphertext_format");
  const enc = new TextEncoder();
  const keyHash = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  const key = await crypto.subtle.importKey("raw", keyHash, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(ivB64) }, key, b64ToBytes(dataB64));
  return new TextDecoder().decode(plain);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Request = { saleTables: boolean; salePriceTableIds: number[]; stockStoreIds: string[]; purchaseStoreIds: string[] };
type StoreRow = { id: string; code: string | null; millennium_store_id: number | null; cost_table_id: number | null };
type Part = "saleTables" | "salePrices" | "stock" | "purchase";

async function replaceRows(
  admin: SupabaseClient,
  table: string,
  match: Record<string, string | number>,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  const startedAt = new Date().toISOString();
  for (const part of chunk(rows.map((r) => ({ ...r, updated_at: startedAt })), 500)) {
    const { error } = await admin.from(table).upsert(part, { onConflict });
    if (error) throw error;
  }
  let del = admin.from(table).delete().lt("updated_at", startedAt);
  for (const [k, v] of Object.entries(match)) del = del.eq(k, v);
  const { error } = await del;
  if (error) throw error;
}

async function refreshSaleTables(admin: SupabaseClient, session: string): Promise<number> {
  const tables = await fetchSaleTables(session);
  if (tables.length === 0) throw new Error("lookup de tabelas de venda voltou vazio");
  const now = new Date().toISOString();
  const { error } = await admin.from("product_sale_table").upsert(
    tables.map((t) => ({ table_id: t.tableId, code: t.code, description: t.description, updated_at: now })),
    { onConflict: "table_id" },
  );
  if (error) throw error;
  return tables.length;
}

async function refreshSalePrices(admin: SupabaseClient, session: string, tableIds: number[], costTableId: number): Promise<number> {
  let total = 0;
  for (const tableId of tableIds) {
    const prices = await fetchSalePrices(session, costTableId, tableId);
    await replaceRows(
      admin,
      "product_sale_price",
      { table_id: tableId },
      [...prices].map(([code, cents]) => ({ table_id: tableId, product_code: code, price_cents: cents })),
      "table_id,product_code",
    );
    const { error } = await admin.from("product_sale_table").update({ prices_at: new Date().toISOString() }).eq("table_id", tableId);
    if (error) throw error;
    total += prices.size;
  }
  return total;
}

async function refreshStock(
  admin: SupabaseClient,
  session: string,
  tenantId: string,
  stores: StoreRow[],
): Promise<number> {
  let done = 0;
  for (const group of chunk(stores, STOCK_CONCURRENCY)) {
    await Promise.all(
      group.map(async (s) => {
        const stock = await fetchStoreStock(session, s.millennium_store_id!);
        await replaceRows(
          admin,
          "store_stock",
          { store_id: s.id },
          [...stock].map(([code, item]) => ({
            tenant_id: tenantId,
            store_id: s.id,
            product_code: code,
            quantity: item.total,
            locations: item.locations,
          })),
          "store_id,product_code",
        );
        const { error } = await admin.from("store").update({ stock_synced_at: new Date().toISOString() }).eq("id", s.id);
        if (error) throw error;
        done++;
      }),
    );
  }
  return done;
}

/** `failedStores` é preenchido aqui (zerado a cada tentativa). 401 sobe para o relogin; nenhuma loja ok = erro. */
async function refreshPurchase(
  admin: SupabaseClient,
  session: string,
  tenantId: string,
  stores: StoreRow[],
  failedStores: string[],
): Promise<number> {
  failedStores.length = 0;
  const registry = new Map<string, PurchaseRegistry>();
  let done = 0;
  for (const group of chunk(stores, STOCK_CONCURRENCY)) {
    await Promise.all(
      group.map(async (s) => {
        try {
          const rows = await fetchPurchaseStock(session, s.millennium_store_id!);
          if (rows.length === 0) throw new Error("saldo atual e futuro voltou vazio");
          await replaceRows(
            admin,
            "store_purchase_stock",
            { store_id: s.id },
            rows.map((r) => ({
              tenant_id: tenantId,
              store_id: s.id,
              product_code: r.code,
              color: r.color,
              print: r.print,
              size: r.size,
              description: r.description,
              balance: r.balance,
              open_order: r.openOrder,
              total: r.total,
              purchase_multiple: r.multiple,
              purchase_blocked: r.blocked,
              registered_at: r.registeredAt,
              position: r.position,
            })),
            "store_id,product_code,color,print,size",
          );
          const { error } = await admin.from("store").update({ purchase_synced_at: new Date().toISOString() }).eq("id", s.id);
          if (error) throw error;
          for (const reg of purchaseRegistry(rows)) if (!registry.has(reg.code)) registry.set(reg.code, reg);
          done++;
        } catch (e) {
          if (e instanceof MillenniumHttpError && e.status === 401) throw e;
          console.error("erp-stock-sync purchase", s.code, e instanceof Error ? e.message : e);
          failedStores.push(s.id);
        }
      }),
    );
  }
  if (done === 0) throw new Error("saldo atual e futuro: nenhuma loja");
  try {
    for (const part of chunk([...registry.values()], 500)) {
      const { error } = await admin.rpc("set_product_catalog_registry", {
        items: part.map((i) => ({
          product_code: i.code,
          registered_at: i.registeredAt,
          purchase_multiple: i.purchaseMultiple,
          purchase_blocked: i.purchaseBlocked,
        })),
      });
      if (error) throw error;
    }
  } catch (e) {
    console.error("erp-stock-sync purchase registry", e instanceof Error ? e.message : e);
  }
  return done;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const erpSecret = Deno.env.get("ERP_SECRET_KEY");
  if (!supabaseUrl || !supabaseAnon || !serviceKey || !erpSecret) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  let body: Request = { saleTables: false, salePriceTableIds: [], stockStoreIds: [], purchaseStoreIds: [] };
  try {
    const raw = await req.json();
    body = {
      saleTables: raw?.saleTables === true,
      salePriceTableIds: Array.isArray(raw?.salePriceTableIds)
        ? [...new Set<number>(raw.salePriceTableIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0))].slice(0, MAX_PRICE_TABLES)
        : [],
      stockStoreIds: Array.isArray(raw?.stockStoreIds) ? raw.stockStoreIds.map(String) : [],
      purchaseStoreIds: Array.isArray(raw?.purchaseStoreIds) ? raw.purchaseStoreIds.map(String) : [],
    };
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }
  if (
    !body.saleTables &&
    body.salePriceTableIds.length === 0 &&
    body.stockStoreIds.length === 0 &&
    body.purchaseStoreIds.length === 0
  ) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: identity } = await admin.from("identity").select("id").eq("auth_user_id", userData.user.id).maybeSingle();
  if (!identity) return json({ error: "identity_not_found" }, 403);

  const { data: membership } = await admin
    .from("membership")
    .select("id, tenant_id, role")
    .eq("identity_id", identity.id)
    .eq("status", "ACTIVE")
    .in("role", ["OWNER", "ADMIN_GLOBAL", "MANAGER"])
    .limit(1)
    .maybeSingle();
  if (!membership) return json({ error: "forbidden" }, 403);
  const gestor = membership.role === "OWNER" || membership.role === "ADMIN_GLOBAL";
  if ((body.saleTables || body.salePriceTableIds.length > 0) && !gestor) {
    return json({ error: "forbidden" }, 403);
  }
  const tenantId = membership.tenant_id as string;

  let allStores: StoreRow[] = [];
  const requestedStoreIds = [...new Set([...body.stockStoreIds, ...body.purchaseStoreIds])];
  if (requestedStoreIds.length > 0) {
    const { data, error } = await admin
      .from("store")
      .select("id, code, millennium_store_id, cost_table_id")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .in("id", requestedStoreIds);
    if (error) return json({ ok: false, error: "erp_request_failed" });
    allStores = ((data ?? []) as StoreRow[]).filter((s) => s.millennium_store_id != null);
    if (membership.role === "MANAGER") {
      const { data: allowed } = await admin.from("membership_store").select("store_id").eq("membership_id", membership.id);
      const ids = new Set((allowed ?? []).map((r) => r.store_id as string));
      if (ids.size > 0) allStores = allStores.filter((s) => ids.has(s.id));
    }
  }
  const stores = allStores.filter((s) => body.stockStoreIds.includes(s.id));
  const purchaseStores = allStores.filter((s) => body.purchaseStoreIds.includes(s.id));

  const { data: anyCostTable } = await admin.from("product_cost_table").select("table_id").order("table_id").limit(1).maybeSingle();
  const tenantCostTable = stores.find((s) => s.cost_table_id != null)?.cost_table_id;
  let fallbackCostTable = tenantCostTable ?? null;
  if (fallbackCostTable == null) {
    const { data: tenantStore } = await admin
      .from("store")
      .select("cost_table_id")
      .eq("tenant_id", tenantId)
      .not("cost_table_id", "is", null)
      .limit(1)
      .maybeSingle();
    fallbackCostTable = (tenantStore?.cost_table_id as number | null) ?? (anyCostTable?.table_id as number | null) ?? null;
  }
  if (fallbackCostTable == null && body.salePriceTableIds.length > 0) {
    return json({ ok: false, error: "no_cost_table" });
  }

  const { data: cred } = await admin
    .from("erp_credential")
    .select("id, username, password_ciphertext, status, sync_paused, millennium_session")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!cred) return json({ ok: false, error: "credential_missing" });
  if (cred.status === "INVALID" || cred.status === "NOT_CONFIGURED") return json({ ok: false, error: "credential_invalid" });
  if (cred.sync_paused) return json({ ok: false, error: "integration_paused" });

  const login = async (): Promise<string | { error: string }> => {
    let password: string;
    try {
      password = await decryptPassword(cred.password_ciphertext as string, erpSecret);
    } catch {
      return { error: "credential_invalid" };
    }
    const r = await loginMillennium(cred.username as string, password);
    if (!r.ok) return { error: r.reason === "password" ? "credential_invalid" : r.reason === "busy" ? "erp_busy" : "erp_login_failed" };
    await admin
      .from("erp_credential")
      .update({ millennium_session: r.session, millennium_session_at: new Date().toISOString(), millennium_session_by: "app" })
      .eq("id", cred.id);
    return r.session;
  };

  const parts: Array<{ part: Part; run: (session: string) => Promise<number> }> = [];
  if (body.saleTables) parts.push({ part: "saleTables", run: (s) => refreshSaleTables(admin, s) });
  if (body.salePriceTableIds.length > 0) {
    parts.push({ part: "salePrices", run: (s) => refreshSalePrices(admin, s, body.salePriceTableIds, fallbackCostTable!) });
  }
  if (stores.length > 0) parts.push({ part: "stock", run: (s) => refreshStock(admin, s, tenantId, stores) });
  const purchaseFailedStores: string[] = [];
  if (purchaseStores.length > 0) {
    parts.push({ part: "purchase", run: (s) => refreshPurchase(admin, s, tenantId, purchaseStores, purchaseFailedStores) });
  }
  if (parts.length === 0) return json({ ok: true, stores: 0 });

  let session = (cred.millennium_session as string | null)?.trim() || null;
  let reused = session != null;
  if (!session) {
    const s = await login();
    if (typeof s !== "string") return json({ ok: false, error: s.error });
    session = s;
  }

  const result: Record<string, number> = {};
  const failed: Part[] = [];
  for (const { part, run } of parts) {
    try {
      result[part] = await run(session);
    } catch (e) {
      if (reused && e instanceof MillenniumHttpError && e.status === 401) {
        reused = false;
        const s = await login();
        if (typeof s !== "string") return json({ ok: false, error: s.error });
        session = s;
        try {
          result[part] = await run(session);
          continue;
        } catch (e2) {
          console.error("erp-stock-sync", part, e2 instanceof Error ? e2.message : e2);
        }
      } else {
        console.error("erp-stock-sync", part, e instanceof Error ? e.message : e);
      }
      failed.push(part);
    }
  }
  if (parts.every(({ part }) => result[part] === undefined)) {
    return json({ ok: false, error: "erp_request_failed", failed, purchaseFailedStores });
  }
  if (purchaseFailedStores.length > 0 && !failed.includes("purchase")) failed.push("purchase");
  return json({ ok: true, ...result, failed, purchaseFailedStores });
});
