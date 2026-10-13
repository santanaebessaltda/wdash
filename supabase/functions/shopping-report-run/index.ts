/**
 * shopping-report-run — lança agora os dias passados vazios da linha Informada.
 * Se o painel não confirmar o formulário, nada é gravado como lançado.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, serve } from "../_shared/cors.ts";
import { canAccessStore, loadStaffCaller } from "../_shared/staffAuth.ts";
import { fillAllosWeek, forceLaunchAllowed, informedStoredValues, informedWeekIds, parseAllosForm, sumSoldByDay, type LaunchValue } from "../_shared/shoppingFill.ts";

const KEEP = "Não foi possível lançar no shopping. Os valores já informados foram mantidos.";
const READ_FAIL = "Não foi possível ler o que já está no shopping. Nada foi alterado.";

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

function todayIn(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const erpSecret = Deno.env.get("ERP_SECRET_KEY");
  if (!supabaseUrl || !supabaseAnon || !serviceKey || !erpSecret) return json({ ok: false, message: KEEP }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const caller = await loadStaffCaller(admin, userData.user.id);
  if (!caller) return json({ error: "forbidden" }, 403);

  let body: { storeId?: unknown; read?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, message: KEEP });
  }
  const readOnly = body.read === true;
  const storeId = typeof body.storeId === "string" ? body.storeId : "";
  if (!storeId || !canAccessStore(caller.role, caller.memberStoreIds, storeId)) return json({ error: "forbidden" }, 403);

  const { data: store } = await admin.from("store").select("id, point_type, timezone").eq("id", storeId).eq("tenant_id", caller.tenantId).maybeSingle();
  if (!store) return json({ ok: false, message: KEEP });

  const { data: account } = await admin
    .from("store_shopping")
    .select("administrator, base_url, username, secret_ciphertext")
    .eq("store_id", storeId)
    .maybeSingle();
  const administrator = account?.administrator === "allos" || account?.administrator === "argo" ? account.administrator : null;
  const gate = forceLaunchAllowed({ kiosk: store.point_type === "MALL", administrator });
  if (!gate.ok) return json({ ok: false, message: gate.message });

  const today = todayIn((store.timezone as string | null) || "America/Campo_Grande");
  let message = readOnly ? READ_FAIL : KEEP;
  try {
    const password = await decryptPassword(String(account?.secret_ciphertext ?? ""), erpSecret);
    const baseUrl = String(account?.base_url ?? "");
    const username = String(account?.username ?? "");
    const posted = readOnly
      ? await readAllos(baseUrl, username, password, today)
      : await postAllos(baseUrl, username, password, today, async (from, to) => {
          const { data, error } = await admin
            .from("sales_day_agg")
            .select("day, brand, revenue_cents")
            .eq("tenant_id", caller.tenantId)
            .eq("store_id", storeId)
            .gte("day", from)
            .lte("day", to);
          if (error) throw new Error(error.message);
          return sumSoldByDay(
            (data ?? []).map((row) => ({
              day: String(row.day),
              brand: typeof row.brand === "string" ? row.brand : null,
              revenueCents: Number(row.revenue_cents) || 0,
            })),
          );
        });
    if (posted.ok) {
      await remember(admin, caller.tenantId, storeId, posted.days);
      await admin.from("store_shopping").update({ last_run_at: new Date().toISOString(), last_error: "" }).eq("store_id", storeId);
      return json({ ok: true });
    }
    message = posted.message;
  } catch {
    message = KEEP;
  }
  await admin.from("store_shopping").update({ last_run_at: new Date().toISOString(), last_error: message }).eq("store_id", storeId);
  return json({ ok: false, message });
});

async function remember(admin: SupabaseClient, tenantId: string, storeId: string, days: LaunchValue[]): Promise<void> {
  const rows = days.filter((day) => day.cents != null).map((day) => ({
    tenant_id: tenantId,
    store_id: storeId,
    day: day.date,
    launched_cents: day.cents,
  }));
  if (rows.length === 0) return;
  const { error } = await admin.from("shopping_day").upsert(rows, { onConflict: "store_id,day" });
  if (error) throw new Error(error.message);
}

type SoldLookup = (from: string, to: string) => Promise<Record<string, number>>;

async function openAllos(
  baseUrl: string,
  username: string,
  password: string,
  fail: string,
): Promise<{ ok: true; jar: Map<string, string>; base: string; weekIds: string[] } | { ok: false; message: string }> {
  const base = baseUrl.replace(/\/$/, "");
  const jar = new Map<string, string>();
  const home = await browse(jar, `${base}/`);
  if (!home || challenge(home)) return { ok: false, message: fail };
  const fields = loginFields(home);
  if (!fields) return { ok: false, message: fail };
  const form = new URLSearchParams();
  form.set(fields.user, username);
  form.set(fields.password, password);
  const logged = await browse(jar, `${base}/db/autentica.asp`, { method: "POST", body: form.toString(), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  if (!logged || challenge(logged)) return { ok: false, message: fail };
  const list = await browse(jar, `${base}/loja/vendas-s4/vendas.asp`);
  if (!list || challenge(list)) return { ok: false, message: fail };
  const weekIds = informedWeekIds(list);
  if (weekIds.length === 0) return { ok: false, message: fail };
  return { ok: true, jar, base, weekIds };
}

/** Lê a linha Informada e não envia nada. */
async function readAllos(
  baseUrl: string,
  username: string,
  password: string,
  today: string,
): Promise<{ ok: true; days: LaunchValue[] } | { ok: false; message: string }> {
  const opened = await openAllos(baseUrl, username, password, READ_FAIL);
  if (!opened.ok) return opened;
  const accepted: LaunchValue[] = [];
  for (const weekId of opened.weekIds) {
    const formHtml = await browse(opened.jar, `${opened.base}/loja/vendas-s4/vendas_alterar.asp?IDSEMANA=${weekId}`);
    const parsed = formHtml ? parseAllosForm(formHtml) : null;
    if (!formHtml || !parsed || parsed.weekId !== weekId) return { ok: false, message: READ_FAIL };
    accepted.push(...informedStoredValues(parsed.fields, today));
  }
  await browse(opened.jar, `${opened.base}/logout.asp`);
  return { ok: true, days: accepted };
}

async function postAllos(
  baseUrl: string,
  username: string,
  password: string,
  today: string,
  sold: SoldLookup,
): Promise<{ ok: true; days: LaunchValue[] } | { ok: false; message: string }> {
  const opened = await openAllos(baseUrl, username, password, KEEP);
  if (!opened.ok) return opened;

  const accepted: LaunchValue[] = [];
  for (const weekId of opened.weekIds) {
    const formHtml = await browse(opened.jar, `${opened.base}/loja/vendas-s4/vendas_alterar.asp?IDSEMANA=${weekId}`);
    const parsed = formHtml ? parseAllosForm(formHtml) : null;
    if (!formHtml || !parsed || parsed.weekId !== weekId) return { ok: false, message: KEEP };
    const from = parsed.fields[0]?.date ?? today;
    const to = parsed.fields[parsed.fields.length - 1]?.date ?? today;
    const filled = fillAllosWeek(parsed, await sold(from, to), today);
    const saved = await browse(opened.jar, `${opened.base}/loja/vendas-s4/vendas_atualizar.asp`, {
      method: "POST",
      body: filled.body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!saved || challenge(saved)) return { ok: false, message: KEEP };
    const echoed = parseAllosForm(await browse(opened.jar, `${opened.base}/loja/vendas-s4/vendas_alterar.asp?IDSEMANA=${weekId}`) ?? "");
    if (!echoed || !sameDays(filled.days, echoed.fields)) return { ok: false, message: KEEP };
    accepted.push(...filled.days);
  }
  await browse(opened.jar, `${opened.base}/logout.asp`);
  return { ok: true, days: accepted };
}

function sameDays(sent: LaunchValue[], echoed: Array<{ date: string; fieldCents: number | null }>): boolean {
  return sent.length === echoed.length && sent.every((day, index) => day.date === echoed[index]?.date && day.cents === echoed[index]?.fieldCents);
}

function challenge(html: string): boolean {
  const text = html.toLowerCase();
  return text.includes("cf-challenge") || text.includes("just a moment") || text.includes("cf_chl");
}

function loginFields(html: string): { user: string; password: string } | null {
  const inputs = [...html.matchAll(/<input\b[^>]*>/gi)].map((match) => {
    const attrs: Record<string, string> = {};
    for (const found of match[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) attrs[found[1].toLowerCase()] = found[2];
    return attrs;
  });
  const passwordIndex = inputs.findIndex((input) => input.type?.toLowerCase() === "password" && input.name);
  const password = passwordIndex >= 0 ? inputs[passwordIndex] : undefined;
  const user = inputs.slice(0, passwordIndex).reverse().find((input) => input.name && (input.type ?? "text").toLowerCase() === "text");
  if (!password?.name || !user?.name) return null;
  return { user: user.name, password: password.name };
}

async function browse(jar: Map<string, string>, url: string, init?: RequestInit, hops = 0): Promise<string | null> {
  if (hops > 4) return null;
  const headers = new Headers(init?.headers);
  const cookie = [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  if (cookie) headers.set("cookie", cookie);
  headers.set("user-agent", "Mozilla/5.0");
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  const setCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const lines = setCookie.length > 0 ? setCookie : res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : [];
  for (const line of lines) {
    const pair = line.split(";")[0] ?? "";
    const cut = pair.indexOf("=");
    if (cut > 0) jar.set(pair.slice(0, cut).trim(), pair.slice(cut + 1).trim());
  }
  if (res.status >= 300 && res.status < 400) {
    const next = res.headers.get("location");
    if (!next) return null;
    return browse(jar, new URL(next, url).toString(), undefined, hops + 1);
  }
  if (!res.ok) return null;
  return res.text();
}
