/**
 * erp-sellers-sync  -  JWT OWNER/MANAGER sincroniza os funcionarios de 1 loja (botao Atualizar
 * em Configuracoes > Lojas > detalhe). Sincrono: nao passa pela fila do worker.
 * Reusa o token salvo em erp_credential; 401  ->  login com a senha cifrada e persiste o token novo.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { loginMillennium } from "../_shared/millennium.ts";
import {
  fetchStoreSellers,
  mergeNameKeys,
  MillenniumHttpError,
  type ErpSeller,
} from "../_shared/millenniumSellers.ts";
import { canAccessStore, loadStaffCaller } from "../_shared/staffAuth.ts";

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

async function saveSellers(
  admin: SupabaseClient,
  tenantId: string,
  storeId: string,
  sellers: ErpSeller[],
): Promise<void> {
  const now = new Date().toISOString();
  const { data: existing, error: exErr } = await admin
    .from("store_seller")
    .select("millennium_employee_id, name_keys")
    .eq("store_id", storeId);
  if (exErr) throw exErr;
  const prevKeys = new Map(
    (existing ?? []).map((r) => [Number(r.millennium_employee_id), (r.name_keys as string[] | null) ?? []]),
  );
  if (sellers.length > 0) {
    const { error } = await admin.from("store_seller").upsert(
      sellers.map((s) => ({
        tenant_id: tenantId,
        store_id: storeId,
        millennium_employee_id: s.employeeId,
        code: s.code || null,
        name: s.name,
        name_keys: mergeNameKeys(prevKeys.get(s.employeeId), s.name),
        erp_login: s.login,
        erp_role: s.role,
        active: s.active,
        erp_flags: s.flags,
        millennium_gerador_id: s.geradorId,
        in_erp: true,
        synced_at: now,
      })),
      { onConflict: "store_id,millennium_employee_id" },
    );
    if (error) throw error;
  }
  let gone = admin
    .from("store_seller")
    .update({ in_erp: false, synced_at: now })
    .eq("store_id", storeId)
    .eq("in_erp", true);
  if (sellers.length > 0) {
    gone = gone.not("millennium_employee_id", "in", `(${sellers.map((s) => s.employeeId).join(",")})`);
  }
  const { error: goneErr } = await gone;
  if (goneErr) throw goneErr;
  const { error: linkErr } = await admin.rpc("link_seller_day_aggs", { p_tenant_id: tenantId, p_store_id: storeId });
  if (linkErr) console.warn("link_seller_day_aggs", linkErr.message);
  const { error: accessErr } = await admin.rpc("sync_seller_access", { p_tenant_id: tenantId, p_store_id: storeId });
  if (accessErr) console.warn("sync_seller_access", accessErr.message);
}

Deno.serve(async (req) => {
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

  let body: { storeId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const storeId = typeof body.storeId === "string" ? body.storeId.trim() : "";
  if (!storeId) return json({ error: "invalid_store" }, 400);

  const admin = createClient(supabaseUrl, serviceKey);

  const membership = await loadStaffCaller(admin, userData.user.id);
  if (!membership) return json({ error: "forbidden" }, 403);
  if (!canAccessStore(membership.role, membership.memberStoreIds, storeId)) {
    return json({ error: "forbidden" }, 403);
  }
  const tenantId = membership.tenantId;

  const { data: store } = await admin
    .from("store")
    .select("id, millennium_store_id")
    .eq("id", storeId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!store) return json({ error: "invalid_store" }, 400);

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

  const millenniumStoreId = store.millennium_store_id as number;
  let session = (cred.millennium_session as string | null)?.trim() || null;
  let reused = session != null;
  if (!session) {
    const s = await login();
    if (typeof s !== "string") return json({ ok: false, error: s.error });
    session = s;
  }

  let sellers: ErpSeller[];
  try {
    try {
      sellers = await fetchStoreSellers(session, millenniumStoreId);
    } catch (e) {
      if (!(reused && e instanceof MillenniumHttpError && e.status === 401)) throw e;
      reused = false;
      const s = await login();
      if (typeof s !== "string") return json({ ok: false, error: s.error });
      sellers = await fetchStoreSellers(s, millenniumStoreId);
    }
    await saveSellers(admin, tenantId, storeId, sellers);
  } catch (e) {
    console.error("erp-sellers-sync", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "erp_request_failed" });
  }

  return json({ ok: true, total: sellers.length, active: sellers.filter((s) => s.active).length });
});
