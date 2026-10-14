/**
 * shopping-credential-persist — só o Gestor grava o painel do shopping de um quiosque.
 * A senha em claro não volta na resposta e não fica no banco sem cifra.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, serve } from "../_shared/cors.ts";
import { groupComBaseUrl, listGroupComUnits, type GroupComUnit } from "../_shared/groupCom.ts";
import { canAccessStore, OWNER_ROLES, loadStaffCaller } from "../_shared/staffAuth.ts";

const INTRANET_MALL_SLUG = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

/** Mesma regra de intranetMallBaseUrl em shoppingReport.ts. Só o slug da filial entra na URL. */
function intranetMallBaseUrl(value: string): string | null {
  const raw = value.trim().replace(/^\/+|\/+$/g, "");
  if (!raw) return null;
  const slug = INTRANET_MALL_SLUG.test(raw) ? raw : slugFromIntranetMallUrl(raw);
  return slug ? `https://app3.intranetmall.com/${slug}` : null;
}

function slugFromIntranetMallUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "app3.intranetmall.com" || url.search || url.hash) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 1 || !INTRANET_MALL_SLUG.test(parts[0])) return null;
  return parts[0];
}

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
  if (!supabaseUrl || !supabaseAnon || !serviceKey || !erpSecret) return json({ error: "server_misconfigured" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const caller = await loadStaffCaller(admin, userData.user.id, OWNER_ROLES);
  if (!caller) return json({ error: "forbidden" }, 403);

  let body: { storeId?: unknown; administrator?: unknown; baseUrl?: unknown; username?: unknown; password?: unknown; listUnits?: unknown; unit?: unknown; clear?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const storeId = typeof body.storeId === "string" ? body.storeId : "";
  const clear = body.clear === true;
  const listUnits = body.listUnits === true;
  const requested = body.administrator === "allos" || body.administrator === "argo" || body.administrator === "groupcom" ? body.administrator : "";
  const administrator = listUnits ? "groupcom" : requested;
  const baseUrl = administrator === "groupcom" ? groupComBaseUrl(typeof body.baseUrl === "string" ? body.baseUrl : "") : intranetMallBaseUrl(typeof body.baseUrl === "string" ? body.baseUrl : "");
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!storeId || (!clear && (!administrator || !baseUrl || !username))) return json({ error: "invalid_input" }, 400);
  if (!canAccessStore(caller.role, caller.memberStoreIds, storeId)) return json({ error: "forbidden" }, 403);

  const { data: store, error: storeErr } = await admin
    .from("store")
    .select("id, point_type")
    .eq("id", storeId)
    .eq("tenant_id", caller.tenantId)
    .maybeSingle();
  if (storeErr || !store || store.point_type !== "MALL") return json({ error: "invalid_store" }, 400);

  if (clear) {
    const { error } = await admin.from("store_shopping").delete().eq("store_id", storeId).eq("tenant_id", caller.tenantId);
    if (error) return json({ error: "persist_failed" }, 500);
    return json({ ok: true });
  }

  if (listUnits) {
    if (!password.trim()) return json({ error: "secret_required" }, 400);
    const listed = await listGroupComUnits(baseUrl, username, password);
    if (!listed.ok) {
      const message = listed.error === "no_units" ? "Nenhuma unidade de lojista encontrada nesse Group COM." : "Não foi possível entrar no Group COM. Confira o e-mail e a senha.";
      return json({ ok: false, message });
    }
    return json({ ok: true, units: listed.units });
  }

  const { data: existing } = await admin.from("store_shopping").select("secret_ciphertext, unit").eq("store_id", storeId).maybeSingle();
  const previous = (existing?.secret_ciphertext as string | undefined) ?? "";
  if (!password.trim() && !previous) return json({ error: "secret_required" }, 400);
  const ciphertext = password.trim() ? await encryptPassword(password.trim(), erpSecret) : previous;
  let unit: GroupComUnit | null = null;
  if (administrator === "groupcom") {
    const picked = await chosenUnit(baseUrl, username, password, body.unit, existing?.unit);
    if (!picked.ok) return json({ ok: false, message: picked.message });
    unit = picked.unit;
  }

  const { error } = await admin.from("store_shopping").upsert(
    {
      store_id: storeId,
      tenant_id: caller.tenantId,
      administrator,
      base_url: baseUrl,
      username,
      secret_ciphertext: ciphertext,
      unit,
    },
    { onConflict: "store_id" },
  );
  if (error) return json({ error: "persist_failed" }, 500);
  return json({ ok: true, administrator, baseUrl, username, unit });
});

async function chosenUnit(
  baseUrl: string,
  username: string,
  password: string,
  submitted: unknown,
  stored: unknown,
): Promise<{ ok: true; unit: GroupComUnit } | { ok: false; message: string }> {
  const wanted = contractId(submitted) ?? contractId(stored);
  if (!wanted) return { ok: false, message: "Escolha a unidade dessa filial no Group COM." };
  if (!password.trim()) {
    const current = sameContract(stored, wanted) ? asUnit(stored) : null;
    return current ? { ok: true, unit: current } : { ok: false, message: "Escolha a unidade dessa filial no Group COM." };
  }
  const listed = await listGroupComUnits(baseUrl, username, password);
  if (!listed.ok) {
    const message = listed.error === "no_units" ? "Nenhuma unidade de lojista encontrada nesse Group COM." : "Não foi possível entrar no Group COM. Confira o e-mail e a senha.";
    return { ok: false, message };
  }
  const unit = listed.units.find((item) => item.contractId === wanted);
  return unit ? { ok: true, unit } : { ok: false, message: "Escolha a unidade dessa filial no Group COM." };
}

function contractId(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const id = (value as { contractId?: unknown }).contractId;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

function sameContract(value: unknown, id: number): boolean {
  return contractId(value) === id;
}

function asUnit(value: unknown): GroupComUnit | null {
  return value && typeof value === "object" ? value as GroupComUnit : null;
}
