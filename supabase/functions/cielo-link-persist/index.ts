/**
 * cielo-link-persist — Gestor grava o acesso Cielo da empresa e o estabelecimento da filial.
 * Certificado, client secret, chave HMAC e chave privada saem cifrados. Não voltam na resposta.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, serve } from "../_shared/cors.ts";
import { canAccessStore, loadStaffCaller } from "../_shared/staffAuth.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function code10(raw: unknown): string {
  const digits = typeof raw === "string" ? raw.replace(/\D/g, "").replace(/^0+/, "") : "";
  if (digits.length < 4 || digits.length > 10) return "";
  return digits.padStart(10, "0");
}

function text(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value || value.length > max) return "";
  return value;
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function encryptSecret(plain: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyHash = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  const key = await crypto.subtle.importKey("raw", keyHash, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
  return `${b64(iv)}.${b64(cipher)}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const erpSecret = Deno.env.get("ERP_SECRET_KEY");
  if (!supabaseUrl || !supabaseAnon || !serviceKey || !erpSecret) return json({ error: "server_misconfigured" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const caller = await loadStaffCaller(admin, userData.user.id);
  if (!caller) return json({ error: "forbidden" }, 403);

  let body: {
    storeId?: unknown;
    establishmentCode?: unknown;
    merchantCode?: unknown;
    clientId?: unknown;
    clientSecret?: unknown;
    hmac?: unknown;
    cert?: unknown;
    privateKey?: unknown;
    disconnect?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const storeId = typeof body.storeId === "string" ? body.storeId : "";
  if (!storeId) return json({ error: "invalid_input" }, 400);
  if (!canAccessStore(caller.role, caller.memberStoreIds, storeId)) return json({ error: "forbidden" }, 403);

  const { data: store, error: storeErr } = await admin
    .from("store")
    .select("id, timezone")
    .eq("id", storeId)
    .eq("tenant_id", caller.tenantId)
    .maybeSingle();
  if (storeErr || !store) return json({ ok: false, message: "Não foi possível encontrar esta filial." });

  if (body.disconnect === true) {
    const { error: dropErr } = await admin.from("store_cielo").delete().eq("store_id", storeId).eq("tenant_id", caller.tenantId);
    if (dropErr) return json({ ok: false, message: "Não foi possível desconectar a Cielo. Tente novamente." });
    return json({ ok: true });
  }

  const code = code10(body.establishmentCode);
  if (!code) return json({ ok: false, message: "Informe o número do estabelecimento." });

  const stone = await admin.from("store_stone").select("store_id").eq("store_id", storeId).maybeSingle();
  if (!stone.error && stone.data) {
    return json({ ok: false, message: "Esta filial já usa a Stone. Desconecte a Stone antes de conectar a Cielo." });
  }
  const taken = await admin
    .from("store_cielo")
    .select("store_id")
    .eq("tenant_id", caller.tenantId)
    .eq("establishment_code", code)
    .neq("store_id", storeId)
    .maybeSingle();
  if (!taken.error && taken.data) {
    return json({ ok: false, message: "Este estabelecimento já está em outra filial." });
  }

  const current = await admin
    .from("tenant_cielo")
    .select("merchant_code, client_id, secret_ciphertext, hmac_ciphertext, cert_ciphertext, key_ciphertext")
    .eq("tenant_id", caller.tenantId)
    .maybeSingle();
  if (current.error) return json({ ok: false, message: "Não foi possível conectar a Cielo. Tente novamente." });
  const saved = current.data;

  const merchantCode = code10(body.merchantCode) || (saved ? String(saved.merchant_code) : "");
  const clientId = text(body.clientId, 120) || (saved ? String(saved.client_id) : "");
  const clientSecret = text(body.clientSecret, 500);
  const hmac = text(body.hmac, 500);
  const cert = text(body.cert, 24000);
  const privateKey = text(body.privateKey, 24000);
  if (!merchantCode || !clientId) {
    return json({ ok: false, message: "Informe a matriz e o client ID da Cielo." });
  }
  if (!saved && (!clientSecret || !hmac || !cert || !privateKey)) {
    return json({ ok: false, message: "Informe o client secret, a chave, o certificado e a chave privada." });
  }

  const row = {
    tenant_id: caller.tenantId,
    merchant_code: merchantCode,
    client_id: clientId,
    secret_ciphertext: clientSecret ? await encryptSecret(clientSecret, erpSecret) : String(saved?.secret_ciphertext ?? ""),
    hmac_ciphertext: hmac ? await encryptSecret(hmac, erpSecret) : String(saved?.hmac_ciphertext ?? ""),
    cert_ciphertext: cert ? await encryptSecret(cert, erpSecret) : String(saved?.cert_ciphertext ?? ""),
    key_ciphertext: privateKey ? await encryptSecret(privateKey, erpSecret) : String(saved?.key_ciphertext ?? ""),
  };
  const { error: credErr } = await admin.from("tenant_cielo").upsert(row, { onConflict: "tenant_id" });
  if (credErr) return json({ ok: false, message: "Não foi possível conectar a Cielo. Tente novamente." });

  const { error } = await admin.from("store_cielo").upsert(
    { store_id: storeId, tenant_id: caller.tenantId, establishment_code: code },
    { onConflict: "store_id" },
  );
  if (error) return json({ ok: false, message: "Não foi possível conectar a Cielo. Tente novamente." });
  await enqueuePastClose(admin, caller.tenantId, storeId, (store.timezone as string | null) || "America/Sao_Paulo");
  return json({ ok: true, establishmentCode: code });
});

async function enqueuePastClose(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  storeId: string,
  tz: string,
): Promise<void> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  const to = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) - 1)).toISOString().slice(0, 10);
  const from = `${today.slice(0, 8)}01`;
  if (to < from) return;
  const { data: cred } = await admin
    .from("erp_credential")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "VALID")
    .limit(1)
    .maybeSingle();
  if (!cred?.id) return;
  const { data: open } = await admin
    .from("sync_job")
    .select("id, payload")
    .eq("tenant_id", tenantId)
    .eq("kind", "CLOSE")
    .in("status", ["QUEUED", "RUNNING"])
    .limit(20);
  const already = (open ?? []).some((row) => {
    const payload = row.payload as { cashOnly?: boolean; part?: string; storeIds?: string[] } | null;
    return payload?.cashOnly === true && payload.part !== "sangria" && (!payload.storeIds?.length || payload.storeIds.includes(storeId));
  });
  if (already) return;
  await admin.from("sync_job").insert({
    tenant_id: tenantId,
    kind: "CLOSE",
    status: "QUEUED",
    credential_id: cred.id,
    payload: { from, to, storeIds: [storeId], cashOnly: true, part: "close" },
  });
}
