/**
 * erp-products-sync — JWT Gestor (OWNER/ADMIN_GLOBAL) busca as tabelas de custo do Millennium.
 * O catálogo de produtos não passa por aqui: o worker recarrega sozinho quando precisa.
 * - `scope: "tables"` (padrão; Atualizar do card Custo dos produtos da loja): só a lista de tabelas de custo (1 chamada).
 * - `scope: "table", tableId` (Salvar do card): preços só dessa tabela (1 chamada, ~3s).
 * - `scope: "registry"` (Atualizar do card Millennium em Integrações): lista de tabelas de custo + dados das
 *   lojas do tenant (FILIAIS.Lista; loja nova no ERP não entra). 2 chamadas, sem lease.
 * - `scope: "costs", storeIds, from, to` (Atualizar custos do aviso de produtos sem custo): preços da tabela
 *   de cada loja afetada + margem do período por loja; grava o custo que o Millennium passou a devolver.
 * Custo fica por tabela (product_cost_table_price), nunca no catálogo: o catálogo é da rede inteira e cada
 * loja usa a tabela do seu estado (store.cost_table_id).
 * Síncrono: não passa pela fila do worker. Usa o mesmo lease do worker (claim_product_catalog_refresh).
 * Reusa o token salvo em erp_credential; 401 → login com a senha cifrada e persiste o token novo.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, serve } from "../_shared/cors.ts";
import { listMillenniumStores, loginMillennium } from "../_shared/millennium.ts";
import { MillenniumHttpError } from "../_shared/millenniumSellers.ts";
import { fetchMargemUnitCosts } from "../_shared/millenniumMargem.ts";
import { fetchCostTablePrices, fetchCostTables } from "../_shared/millenniumProducts.ts";

const LEASE_SEC = 300;

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

async function savePrices(admin: SupabaseClient, tableId: number, prices: Map<string, number>): Promise<void> {
  const startedAt = new Date().toISOString();
  const rows = [...prices].map(([code, cents]) => ({
    table_id: tableId,
    product_code: code,
    unit_cost_cents: cents,
    updated_at: startedAt,
  }));
  for (const part of chunk(rows, 500)) {
    const { error } = await admin.from("product_cost_table_price").upsert(part, { onConflict: "table_id,product_code" });
    if (error) throw error;
  }
  const { error } = await admin
    .from("product_cost_table_price")
    .delete()
    .eq("table_id", tableId)
    .lt("updated_at", startedAt);
  if (error) throw error;
}

type Scope = "tables" | "table" | "costs" | "registry";
type CostsRequest = { storeIds: string[]; from: string; to: string };
type RefreshResult = { tables?: number; stores?: number; prices?: number; fixed?: number; missing?: number };
type ZeroRow = { store_id: string; day: string; product_code: string; item_count: number };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MARGEM_SPAN_DAYS = 92;

function brandFromProductCode(code: string): "WEPINK" | "WPINK" {
  const t = code.trim().toUpperCase();
  if (/^WP[\dA-Z]/.test(t) || t === "WP" || t.startsWith("WP ")) return "WPINK";
  return "WEPINK";
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

async function refreshTableList(admin: SupabaseClient, session: string): Promise<number> {
  const now = new Date().toISOString();
  const tables = await fetchCostTables(session);
  if (tables.length === 0) throw new Error("lookup de tabelas de custo voltou vazio");
  const { error } = await admin.from("product_cost_table").upsert(
    tables.map((t) => ({ table_id: t.tableId, code: t.code, description: t.description, updated_at: now })),
    { onConflict: "table_id" },
  );
  if (error) throw error;
  return tables.length;
}

/** Lojas do tenant que o ERP devolve: atualiza código, nome, fantasia, CNPJ e inauguração. Loja nova não entra. */
async function refreshStores(admin: SupabaseClient, session: string, tenantId: string): Promise<number> {
  const erp = await listMillenniumStores(session);
  const { data, error } = await admin
    .from("store")
    .select("id, millennium_store_id, code, name, trade_name, tax_id, opened_at")
    .eq("tenant_id", tenantId);
  if (error) throw error;
  const byErpId = new Map((data ?? []).map((r) => [Number(r.millennium_store_id), r]));
  let updated = 0;
  for (const s of erp) {
    const row = byErpId.get(s.storeId);
    if (!row) continue;
    const opened = /^\d{4}-\d{2}-\d{2}/.test(s.openedAt ?? "") ? s.openedAt.slice(0, 10) : "";
    const patch: Record<string, string> = {};
    if (s.code && s.code !== row.code) patch.code = s.code;
    if (s.name && s.name !== row.name) patch.name = s.name;
    if (s.tradeName && s.tradeName !== row.trade_name) patch.trade_name = s.tradeName;
    if (s.taxId?.trim() && s.taxId.trim() !== row.tax_id) patch.tax_id = s.taxId.trim();
    if (opened && opened !== (row.opened_at ? String(row.opened_at).slice(0, 10) : "")) patch.opened_at = opened;
    if (Object.keys(patch).length === 0) continue;
    const { error: upErr } = await admin.from("store").update(patch).eq("id", row.id);
    if (upErr) throw upErr;
    updated++;
  }
  return updated;
}

async function refreshTablePrices(admin: SupabaseClient, session: string, tableId: number): Promise<number> {
  const p = await fetchCostTablePrices(session, tableId);
  await savePrices(admin, tableId, p);
  return p.size;
}

/** Linha da margem com custo 0 → CMV novo; soma a diferença no ALL e na marca do dia. false = já tinha custo. */
async function patchZeroCost(admin: SupabaseClient, tenantId: string, r: ZeroRow, cmvCents: number): Promise<boolean> {
  const { data: upd, error } = await admin
    .from("sales_product_cost_day_agg")
    .update({ cmv_cents: cmvCents })
    .eq("tenant_id", tenantId)
    .eq("store_id", r.store_id)
    .eq("day", r.day)
    .eq("product_code", r.product_code)
    .eq("cmv_cents", 0)
    .select("product_code");
  if (error) throw error;
  if (!upd || upd.length === 0) return false;
  for (const brand of ["ALL", brandFromProductCode(r.product_code)]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: row, error: readErr } = await admin
        .from("sales_day_agg")
        .select("cmv_cents")
        .eq("tenant_id", tenantId)
        .eq("store_id", r.store_id)
        .eq("day", r.day)
        .eq("brand", brand)
        .maybeSingle();
      if (readErr) throw readErr;
      if (!row) break;
      const prev = row.cmv_cents as number | null;
      let q = admin
        .from("sales_day_agg")
        .update({ cmv_cents: (prev ?? 0) + cmvCents })
        .eq("tenant_id", tenantId)
        .eq("store_id", r.store_id)
        .eq("day", r.day)
        .eq("brand", brand);
      q = prev == null ? q.is("cmv_cents", null) : q.eq("cmv_cents", prev);
      const { data: done, error: updErr } = await q.select("day");
      if (updErr) throw updErr;
      if (done && done.length > 0) break;
    }
  }
  return true;
}

/**
 * Produtos vendidos com custo 0 nas lojas/período: busca de novo os preços da tabela de custo de cada loja
 * e a margem do período (1 chamada por loja). Custo que o Millennium passou a devolver entra no CMV gravado;
 * preço na tabela entra pelo preenchimento na leitura. `missing` = códigos que seguem sem custo.
 */
async function refreshCosts(
  admin: SupabaseClient,
  session: string,
  tenantId: string,
  req: CostsRequest,
): Promise<RefreshResult> {
  let storeQuery = admin
    .from("store")
    .select("id, millennium_store_id, cost_table_id")
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (req.storeIds.length > 0) storeQuery = storeQuery.in("id", req.storeIds);
  const { data: stores, error: storeErr } = await storeQuery;
  if (storeErr) throw storeErr;
  if (!stores || stores.length === 0) return { fixed: 0, missing: 0 };

  const zero: ZeroRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("sales_product_cost_day_agg")
      .select("store_id, day, product_code, item_count")
      .eq("tenant_id", tenantId)
      .in("store_id", stores.map((s) => s.id))
      .gte("day", req.from)
      .lte("day", req.to)
      .eq("cmv_cents", 0)
      .gt("item_count", 0)
      .gt("revenue_cents", 0)
      .range(from, from + 999);
    if (error) throw error;
    zero.push(...((data ?? []) as ZeroRow[]));
    if (!data || data.length < 1000) break;
  }
  if (zero.length === 0) return { fixed: 0, missing: 0 };

  const affected = stores.filter((s) => zero.some((r) => r.store_id === s.id));
  const tablePrice = new Set<string>();
  let prices = 0;
  for (const tableId of new Set(affected.map((s) => s.cost_table_id as number | null).filter((t) => t != null))) {
    const p = await fetchCostTablePrices(session, tableId!);
    await savePrices(admin, tableId!, p);
    prices += p.size;
    for (const code of p.keys()) tablePrice.add(`${tableId}|${code}`);
  }

  let fixed = 0;
  const missing = new Set<string>();
  for (const store of affected) {
    const rows = zero.filter((r) => r.store_id === store.id);
    const days = rows.map((r) => r.day).sort();
    const windows: Array<[string, string]> = [];
    if (daysBetween(days[0]!, days[days.length - 1]!) <= MAX_MARGEM_SPAN_DAYS) {
      windows.push([days[0]!, days[days.length - 1]!]);
    } else {
      const byMonth = new Map<string, string[]>();
      for (const d of days) byMonth.set(d.slice(0, 7), [...(byMonth.get(d.slice(0, 7)) ?? []), d]);
      for (const ds of byMonth.values()) windows.push([ds[0]!, ds[ds.length - 1]!]);
    }
    const units = new Map<string, number>();
    for (const [from, to] of windows) {
      for (const [code, unit] of await fetchMargemUnitCosts(session, Number(store.millennium_store_id), from, to)) {
        units.set(code, unit);
      }
    }
    for (const r of rows) {
      const unit = units.get(r.product_code);
      if (unit) {
        if (await patchZeroCost(admin, tenantId, r, Math.round(unit * r.item_count * 100))) fixed++;
        continue;
      }
      if (store.cost_table_id != null && tablePrice.has(`${store.cost_table_id}|${r.product_code}`)) continue;
      missing.add(r.product_code);
    }
  }
  return { prices, fixed, missing: missing.size };
}

async function refresh(
  admin: SupabaseClient,
  session: string,
  tenantId: string,
  scope: Scope,
  tableId: number | null,
  costs: CostsRequest | null,
): Promise<RefreshResult> {
  if (scope === "costs") return refreshCosts(admin, session, tenantId, costs!);
  if (scope === "table") return { prices: await refreshTablePrices(admin, session, tableId!) };
  if (scope === "registry") {
    // Tabelas primeiro: sessão caída vira MillenniumHttpError 401 (relogin) antes da lista de lojas.
    const tables = await refreshTableList(admin, session);
    return { tables, stores: await refreshStores(admin, session, tenantId) };
  }
  return { tables: await refreshTableList(admin, session) };
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
  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  let scope: Scope = "tables";
  let tableId: number | null = null;
  let costs: CostsRequest | null = null;
  try {
    const body = await req.json();
    if (body?.scope === "table") {
      scope = "table";
      tableId = Number(body.tableId);
    }
    if (body?.scope === "registry") scope = "registry";
    if (body?.scope === "costs") {
      scope = "costs";
      costs = {
        storeIds: Array.isArray(body.storeIds) ? body.storeIds.map(String) : [],
        from: String(body.from ?? ""),
        to: String(body.to ?? ""),
      };
    }
  } catch {
    // corpo vazio = lista de tabelas
  }
  if (scope === "table" && !(Number.isFinite(tableId) && tableId! > 0)) {
    return json({ ok: false, error: "invalid_table" }, 400);
  }
  if (scope === "costs" && !(costs && YMD.test(costs.from) && YMD.test(costs.to) && costs.from <= costs.to)) {
    return json({ ok: false, error: "invalid_period" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: identity } = await admin
    .from("identity")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (!identity) return json({ error: "identity_not_found" }, 403);

  const { data: membership } = await admin
    .from("membership")
    .select("tenant_id")
    .eq("identity_id", identity.id)
    .eq("status", "ACTIVE")
    .in("role", ["OWNER", "ADMIN_GLOBAL"])
    .limit(1)
    .maybeSingle();
  if (!membership) return json({ error: "forbidden" }, 403);
  const tenantId = membership.tenant_id as string;

  const { data: cred } = await admin
    .from("erp_credential")
    .select("id, username, password_ciphertext, status, sync_paused, millennium_session")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!cred) return json({ ok: false, error: "credential_missing" });
  if (cred.status === "INVALID" || cred.status === "NOT_CONFIGURED") {
    return json({ ok: false, error: "credential_invalid" });
  }
  if (cred.sync_paused) return json({ ok: false, error: "integration_paused" });

  const login = async (): Promise<string | { error: string }> => {
    let password: string;
    try {
      password = await decryptPassword(cred.password_ciphertext as string, erpSecret);
    } catch {
      return { error: "credential_invalid" };
    }
    const r = await loginMillennium(cred.username as string, password);
    if (!r.ok)
      return {
        error: r.reason === "password" ? "credential_invalid" : r.reason === "busy" ? "erp_busy" : "erp_login_failed",
      };
    await admin
      .from("erp_credential")
      .update({
        millennium_session: r.session,
        millennium_session_at: new Date().toISOString(),
        millennium_session_by: "app",
      })
      .eq("id", cred.id);
    return r.session;
  };

  const owner = `app-${crypto.randomUUID()}`;
  const leased = scope !== "registry";
  const release = async (error: string | null) => {
    if (leased) await admin.rpc("release_product_catalog_refresh", { p_owner: owner, p_ok: false, p_error: error });
  };
  if (leased) {
    const { data: claimed, error: claimErr } = await admin.rpc("claim_product_catalog_refresh", {
      p_owner: owner,
      p_lease_seconds: LEASE_SEC,
      p_min_interval_seconds: 0,
    });
    if (claimErr) {
      console.error("erp-products-sync claim", claimErr.message);
      return json({ ok: false, error: "erp_request_failed" });
    }
    if (claimed !== true) return json({ ok: false, error: "busy" });
  }

  let session = (cred.millennium_session as string | null)?.trim() || null;
  let reused = session != null;
  try {
    if (!session) {
      const s = await login();
      if (typeof s !== "string") {
        await release(s.error);
        return json({ ok: false, error: s.error });
      }
      session = s;
    }
    let result: RefreshResult;
    try {
      result = await refresh(admin, session, tenantId, scope, tableId, costs);
    } catch (e) {
      if (!(reused && e instanceof MillenniumHttpError && e.status === 401)) throw e;
      reused = false;
      const s = await login();
      if (typeof s !== "string") {
        await release(s.error);
        return json({ ok: false, error: s.error });
      }
      result = await refresh(admin, s, tenantId, scope, tableId, costs);
    }
    // p_ok=false + p_error=null libera sem mexer em refreshed_at (só a recarga do catálogo no worker atualiza).
    await release(null);
    return json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("erp-products-sync", msg);
    await release(msg.slice(0, 500));
    return json({ ok: false, error: "erp_request_failed" });
  }
});
