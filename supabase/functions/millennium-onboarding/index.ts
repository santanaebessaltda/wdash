/**
 * millennium-onboarding  -  sessao Millennium do TENANT (nao do worker).
 *
 * Body:
 *   { username, password }      ->  liberar sessao salva + login + FILIAIS
 *     + checkReports: true      ->  smoke dos relatorios personalizados; sem acesso = reason "reports"
 *   { action: "logout", session }  ->  logout token explicito + limpa credencial
 *   { action: "release" }       ->  encerra sessao salva do tenant (app/worker)
 *   { action: "pause" }         ->  release + sync_paused + limpa presenca
 *   { action: "resume" }        ->  sync_paused=false + presenca
 *   { action: "presence"|"heartbeat" }  ->  marca app online (worker pode syncar)
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import {
  checkCustomReports,
  listMillenniumStores,
  loginMillennium,
  logoutMillennium,
  type MillenniumStore,
  type LoginReason,
  type ReportCheck,
} from "../_shared/millennium.ts";
import { loadStaffCaller } from "../_shared/staffAuth.ts";

type OkResponse = { ok: true; session: string; stores: MillenniumStore[]; reclaimed?: boolean };
type ErrResponse = { ok: false; reason: LoginReason; reports?: ReportCheck[] };
type SimpleOk = { ok: true; paused?: boolean };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authedClients(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseAnon || !serviceKey) {
    return { error: json({ error: "server_misconfigured" }, 500) };
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: json({ error: "unauthorized" }, 401) };

  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return { error: json({ error: "unauthorized" }, 401) };

  const admin = createClient(supabaseUrl, serviceKey);
  return { userId: userData.user.id, admin };
}

async function loadCredential(
  admin: SupabaseClient,
  opts: { tenantId?: string | null; username?: string },
): Promise<{ id: string; millennium_session: string | null } | null> {
  if (opts.tenantId) {
    const { data } = await admin
      .from("erp_credential")
      .select("id, millennium_session")
      .eq("tenant_id", opts.tenantId)
      .maybeSingle();
    if (data) return data as { id: string; millennium_session: string | null };
  }
  if (opts.username) {
    const { data } = await admin
      .from("erp_credential")
      .select("id, millennium_session")
      .eq("username", opts.username.toUpperCase())
      .limit(1)
      .maybeSingle();
    if (data) return data as { id: string; millennium_session: string | null };
  }
  return null;
}

async function clearSessionRow(admin: SupabaseClient, credentialId: string) {
  await admin
    .from("erp_credential")
    .update({
      millennium_session: null,
      millennium_session_at: null,
      millennium_session_by: null,
    })
    .eq("id", credentialId);
}

async function saveSessionRow(
  admin: SupabaseClient,
  credentialId: string,
  session: string,
  by: "app" | "worker",
) {
  await admin
    .from("erp_credential")
    .update({
      millennium_session: session,
      millennium_session_at: new Date().toISOString(),
      millennium_session_by: by,
    })
    .eq("id", credentialId);
}

/** Encerra sessao salva na credencial (best-effort). */
async function releaseStored(
  admin: SupabaseClient,
  opts: { tenantId?: string | null; username?: string },
): Promise<boolean> {
  const cred = await loadCredential(admin, opts);
  const token = cred?.millennium_session?.trim();
  if (!token || !cred) return false;
  try {
    await logoutMillennium(token);
  } catch {
    /* best-effort */
  }
  await clearSessionRow(admin, cred.id);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = await authedClients(req);
  if ("error" in auth) return auth.error;
  const { userId, admin } = auth;

  let body: {
    action?: string;
    username?: string;
    password?: string;
    usuario?: string;
    senha?: string;
    session?: string;
    includeStores?: boolean;
    keepSession?: boolean;
    checkReports?: boolean;
    incluirFiliais?: boolean;
    manterSessao?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const action = String(body.action ?? "").trim().toLowerCase();

  // Controle ERP / sessao Millennium: so Gestor ou Gerente ACTIVE (nao vendedor).
  const staff = await loadStaffCaller(admin, userId);
  if (!staff) return json({ error: "forbidden" }, 403);
  const tenantId = staff.tenantId;

  if (action === "logout") {
    const session = String(body.session ?? "").trim();
    if (session) {
      await logoutMillennium(session);
    }
    if (tenantId) await releaseStored(admin, { tenantId });
    const r: SimpleOk = { ok: true };
    return json(r);
  }

  if (action === "release") {
    const released = tenantId ? await releaseStored(admin, { tenantId }) : false;
    const r: SimpleOk = { ok: true };
    console.log("release", { tenantId, released });
    return json(r);
  }

  if (action === "pause") {
    if (!tenantId) return json({ error: "no_tenant" }, 400);
    await releaseStored(admin, { tenantId });
    await admin
      .from("erp_credential")
      .update({ sync_paused: true, wedash_present_at: null })
      .eq("tenant_id", tenantId);
    const r: SimpleOk = { ok: true, paused: true };
    return json(r);
  }

  if (action === "resume") {
    if (!tenantId) return json({ error: "no_tenant" }, 400);
    await admin
      .from("erp_credential")
      .update({
        sync_paused: false,
        wedash_present_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId);
    const r: SimpleOk = { ok: true, paused: false };
    return json(r);
  }

  // Heartbeat: app logado  ->  worker pode syncar. Sem presenca recente = idle.
  if (action === "presence" || action === "heartbeat") {
    if (!tenantId) return json({ error: "no_tenant" }, 400);
    await admin
      .from("erp_credential")
      .update({
        sync_paused: false,
        wedash_present_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId);
    const r: SimpleOk = { ok: true };
    return json(r);
  }

  const username = String(body.username ?? body.usuario ?? "").trim().toUpperCase();
  const password = String(body.password ?? body.senha ?? "");
  const includeStores = (body.includeStores ?? body.incluirFiliais) !== false;
  const keepSession = (body.keepSession ?? body.manterSessao) !== false;
  const checkReports = body.checkReports === true;

  if (!username || !password) {
    const r: ErrResponse = { ok: false, reason: "password" };
    return json(r);
  }

  // Sempre tenta liberar sessao WeDash salva antes de logar (evita busy do nosso sync).
  let reclaimed = await releaseStored(admin, { tenantId, username });

  let session: string | null = null;
  try {
    let login = await loginMillennium(username, password);
    if (!login.ok && login.reason === "busy") {
      // Segunda chance: outra credencial / race
      reclaimed = (await releaseStored(admin, { tenantId, username })) || reclaimed;
      await new Promise((r) => setTimeout(r, 600));
      login = await loginMillennium(username, password);
    }
    if (!login.ok) {
      const r: ErrResponse = { ok: false, reason: login.reason };
      return json(r);
    }
    session = login.session;

    const cred = await loadCredential(admin, { tenantId, username });
    if (cred && keepSession) {
      await saveSessionRow(admin, cred.id, session, "app");
    }

    let stores: MillenniumStore[] = [];
    if (includeStores) {
      try {
        stores = await listMillenniumStores(session);
      } catch (e) {
        console.error("FILIAIS.Lista falhou", e);
        await logoutMillennium(session);
        if (cred) await clearSessionRow(admin, cred.id);
        session = null;
        const r: ErrResponse = { ok: false, reason: "stores" };
        return json(r);
      }
    }

    if (checkReports) {
      const reports = await checkCustomReports(session);
      if (reports.some((r) => !r.ok)) {
        console.warn("relatórios personalizados sem acesso", reports.filter((r) => !r.ok));
        await logoutMillennium(session);
        if (cred) await clearSessionRow(admin, cred.id);
        session = null;
        const r: ErrResponse = { ok: false, reason: "reports", reports };
        return json(r);
      }
    }

    if (!keepSession) {
      await logoutMillennium(session);
      if (cred) await clearSessionRow(admin, cred.id);
      const r: OkResponse = { ok: true, session: "", stores, reclaimed };
      return json(r);
    }

    const r: OkResponse = { ok: true, session, stores, reclaimed };
    return json(r);
  } catch (e) {
    console.error("millennium-onboarding falhou", e);
    if (session) await logoutMillennium(session);
    const r: ErrResponse = { ok: false, reason: "other" };
    return json(r);
  }
});
