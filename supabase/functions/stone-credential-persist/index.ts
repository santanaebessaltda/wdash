/**
 * stone-credential-persist — Gestor/Gerente grava Stone Code e chave cifrada de uma loja.
 * A chave em claro não volta na resposta e não fica no banco sem cifra.
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

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function encryptPassword(plain: string, secret: string): Promise<string> {
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

  const admin = createClient(supabaseUrl, serviceKey);
  const caller = await loadStaffCaller(admin, userData.user.id);
  if (!caller) return json({ error: "forbidden" }, 403);

  let body: { storeId?: unknown; stoneCode?: unknown; secret?: unknown; covers?: unknown; disconnect?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const storeId = typeof body.storeId === "string" ? body.storeId : "";
  if (!storeId) return json({ error: "invalid_input" }, 400);
  if (!canAccessStore(caller.role, caller.memberStoreIds, storeId)) return json({ error: "forbidden" }, 403);

  if (body.disconnect === true) {
    const { data: owned, error: ownedErr } = await admin
      .from("store")
      .select("id")
      .eq("id", storeId)
      .eq("tenant_id", caller.tenantId)
      .maybeSingle();
    if (ownedErr || !owned) return json({ error: "invalid_store" }, 400);
    const { error: dropErr } = await admin.from("store_stone").delete().eq("store_id", storeId).eq("tenant_id", caller.tenantId);
    if (dropErr) return json({ error: "persist_failed" }, 500);
    return json({ ok: true });
  }

  const stoneCode = typeof body.stoneCode === "string" ? body.stoneCode.replace(/\D/g, "") : "";
  const secret = typeof body.secret === "string" ? body.secret.trim() : "";
  const covers = body.covers === "online_pix" ? "online_pix" : body.covers === "all" ? "all" : "";
  if (stoneCode.length < 5 || !covers) return json({ error: "invalid_input" }, 400);

  const { data: store, error: storeErr } = await admin
    .from("store")
    .select("id, tenant_id")
    .eq("id", storeId)
    .eq("tenant_id", caller.tenantId)
    .maybeSingle();
  if (storeErr || !store) return json({ error: "invalid_store" }, 400);

  const { data: existing } = await admin
    .from("store_stone")
    .select("secret_ciphertext")
    .eq("store_id", storeId)
    .maybeSingle();
  const previous = (existing?.secret_ciphertext as string | undefined) ?? "";
  if (!secret && !previous) return json({ error: "secret_required" }, 400);

  const ciphertext = secret ? await encryptPassword(secret, erpSecret) : previous;
  const { error } = await admin.from("store_stone").upsert(
    {
      store_id: storeId,
      tenant_id: caller.tenantId,
      stone_code: stoneCode,
      secret_ciphertext: ciphertext,
      covers,
    },
    { onConflict: "store_id" },
  );
  if (error) return json({ error: "persist_failed" }, 500);
  return json({ ok: true, stoneCode, covers });
});
