/**
 * erp-sync-enqueue  -  JWT OWNER/MANAGER enfileira SEED | LIGHT | FORCE | RANGE | REGISTRY | CLOSE (cashOnly).
 * REGISTRY (Atualizar cadastros, Integracoes) = so Gestor (OWNER).
 * Rate limit FORCE: ver FORCE_COOLDOWN_MS (0 = off p/ teste).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, serve } from "../_shared/cors.ts";
import { loadStaffCaller, managerAllowedStores } from "../_shared/staffAuth.ts";

type JobKind = "SEED" | "LIGHT" | "FORCE" | "FORCE_LIGHT" | "RANGE" | "BACKFILL" | "REGISTRY" | "CLOSE";

/** 0 = off (sem cooldown no Atualizar). Religar: 5 * 60 * 1000. */
const FORCE_COOLDOWN_MS = 0;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapAction(action: string): JobKind | null {
  switch (action) {
    case "light":
      return "LIGHT";
    case "force":
    case "force_light":
      return "FORCE";
    case "seed":
    case "backfill":
      return "SEED";
    case "range":
      return "RANGE";
    case "registry":
      return "REGISTRY";
    case "cash_close":
      return "CLOSE";
    default:
      return null;
  }
}

function isIsoDay(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseAnon || !serviceKey) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  let body: { action?: string; from?: string; to?: string; storeIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const kind = mapAction(String(body.action ?? "").trim().toLowerCase());
  if (!kind) return json({ error: "invalid_action" }, 400);

  const payload: { from?: string; to?: string; storeIds?: string[]; cashOnly?: boolean } = {};
  if (kind === "CLOSE") payload.cashOnly = true;
  if (kind === "FORCE" || kind === "FORCE_LIGHT") {
    // So hoje  -  client pode mandar from=to=hoje (audit); worker usa fuso da loja.
    if (isIsoDay(body.from) && isIsoDay(body.to) && body.from === body.to) {
      payload.from = body.from;
      payload.to = body.to;
    }
  } else if (kind === "RANGE" || kind === "CLOSE") {
    if (!isIsoDay(body.from) || !isIsoDay(body.to)) {
      return json({ error: "from_to_required" }, 400);
    }
    payload.from = body.from <= body.to ? body.from : body.to;
    payload.to = body.from <= body.to ? body.to : body.from;
    // Cap 90 days per request
    const [y1, m1, d1] = payload.from.split("-").map(Number);
    const [y2, m2, d2] = payload.to.split("-").map(Number);
    const a = Date.UTC(y1, m1 - 1, d1);
    const b = Date.UTC(y2, m2 - 1, d2);
    const days = Math.floor((b - a) / 86_400_000) + 1;
    if (days > 90) return json({ error: "range_too_large", maxDays: 90 }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const membership = await loadStaffCaller(admin, userData.user.id);
  if (!membership) return json({ error: "forbidden" }, 403);
  if (kind === "REGISTRY" && membership.role !== "OWNER" && membership.role !== "ADMIN_GLOBAL") {
    return json({ error: "forbidden" }, 403);
  }

  const tenantId = membership.tenantId;
  const managerScope = managerAllowedStores(membership.role, membership.memberStoreIds);

  // FORCE/RANGE: opcionalmente so as lojas do StorePicker (nao "Todas").
  if (
    (kind === "FORCE" || kind === "FORCE_LIGHT" || kind === "RANGE" || kind === "CLOSE") &&
    Array.isArray(body.storeIds) &&
    body.storeIds.length > 0
  ) {
    const ids = [
      ...new Set(
        body.storeIds.filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    if (ids.length === 0) {
      return json({ error: "invalid_store" }, 400);
    }
    if (managerScope && ids.some((id) => !managerScope.includes(id))) {
      return json({ error: "forbidden" }, 403);
    }
    const { data: stores, error: storeErr } = await admin
      .from("store")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", ids);
    if (storeErr) return json({ error: "store_check_failed" }, 500);
    if (!stores || stores.length !== ids.length) {
      return json({ error: "invalid_store" }, 400);
    }
    payload.storeIds = ids;
  }

  // Gerente com lojas vinculadas: nunca enfileira sync da rede inteira.
  if (managerScope && !payload.storeIds) {
    payload.storeIds = managerScope;
  }

  const { data: credential, error: credErr } = await admin
    .from("erp_credential")
    .select("id, status, sync_paused")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (credErr || !credential) return json({ error: "credential_missing" }, 400);
  if (credential.status === "INVALID" || credential.status === "NOT_CONFIGURED") {
    return json({ error: "credential_invalid" }, 400);
  }
  // Desconectado: o worker nao pega jobs de integracao pausada  -  job ficaria QUEUED para sempre.
  if (credential.sync_paused) return json({ error: "integration_paused" }, 409);

  if ((kind === "FORCE" || kind === "FORCE_LIGHT") && FORCE_COOLDOWN_MS > 0) {
    const windowMs = FORCE_COOLDOWN_MS;
    const since = new Date(Date.now() - windowMs).toISOString();
    // Abertos: pela criacao. Concluidos: pelo finished_at (5 min contam a partir do fim do job).
    const [openRes, doneRes] = await Promise.all([
      admin
        .from("sync_job")
        .select("id, created_at, finished_at, status, payload")
        .eq("tenant_id", tenantId)
        .in("kind", ["FORCE", "FORCE_LIGHT"])
        .in("status", ["QUEUED", "RUNNING"])
        .gte("created_at", since)
        .limit(50),
      admin
        .from("sync_job")
        .select("id, created_at, finished_at, status, payload")
        .eq("tenant_id", tenantId)
        .in("kind", ["FORCE", "FORCE_LIGHT"])
        .eq("status", "SUCCEEDED")
        .gte("finished_at", since)
        .limit(50),
    ]);
    if (openRes.error || doneRes.error) {
      return json({ error: "rate_check_failed" }, 500);
    }
    const recentJobs = [...(openRes.data ?? []), ...(doneRes.data ?? [])];

    const requestedIds = payload.storeIds ?? null; // null = Todas as lojas
    const jobStoreIds = (p: unknown): string[] | null => {
      if (!p || typeof p !== "object") return null;
      const ids = (p as { storeIds?: unknown }).storeIds;
      if (!Array.isArray(ids) || ids.length === 0) return null;
      return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
    };

    const jobAnchorMs = (row: {
      status?: string;
      created_at?: string;
      finished_at?: string | null;
    }): number => {
      if (row.status === "SUCCEEDED" && row.finished_at) {
        return new Date(row.finished_at).getTime();
      }
      return new Date(row.created_at as string).getTime();
    };

    let blocking: { created_at: string; finished_at?: string | null; status?: string } | null = null;
    let blockingAnchor = 0;
    for (const row of recentJobs) {
      const recentIds = jobStoreIds((row as { payload?: unknown }).payload);
      let hits = false;
      if (requestedIds == null) {
        hits = true; // Opcao A: qualquer FORCE recente
      } else if (recentIds == null) {
        hits = true; // "Todas" recente bloqueia cada loja
      } else if (requestedIds.some((id) => recentIds.includes(id))) {
        hits = true;
      }
      if (!hits) continue;
      const anchor = jobAnchorMs(row as { status?: string; created_at?: string; finished_at?: string | null });
      if (!blocking || anchor > blockingAnchor) {
        blocking = row as { created_at: string; finished_at?: string | null; status?: string };
        blockingAnchor = anchor;
      }
    }

    if (blocking) {
      const retryAfterSec = Math.max(1, Math.ceil((blockingAnchor + windowMs - Date.now()) / 1000));
      return json({ ok: false, error: "rate_limited", retryAfterSec }, 429);
    }
  }

  // Atualizar repetido (outra pessoa do tenant clicou antes): acompanha o job aberto que ja cobre
  // as lojas pedidas em vez de chamar o ERP de novo. "Todas" cobre qualquer loja; loja nao cobre
  // "Todas". Rodada automatica fica de fora (sessao caida nela falha sem relogin).
  if (kind === "FORCE") {
    const { data: open, error: openErr } = await admin
      .from("sync_job")
      .select("id, kind, status, created_at, payload")
      .eq("tenant_id", tenantId)
      .eq("kind", "FORCE")
      .in("status", ["QUEUED", "RUNNING"])
      .order("created_at", { ascending: false })
      .limit(20);
    if (openErr) return json({ error: "dedupe_check_failed" }, 500);
    const requested = payload.storeIds ?? null;
    const covering = (open ?? []).find((row) => {
      const p = (row.payload ?? {}) as { auto?: unknown; storeIds?: unknown };
      if (p.auto) return false;
      const ids = Array.isArray(p.storeIds) && p.storeIds.length > 0 ? (p.storeIds as string[]) : null;
      if (ids == null) return true;
      return requested != null && requested.every((id) => ids.includes(id));
    });
    if (covering) {
      const { payload: _p, ...job } = covering;
      return json({ ok: true, job, deduped: true });
    }
  }

  // Avoid duplicate SEED/RANGE/REGISTRY while one is already queued/running.
  // CLOSE do botão só deduplica outro fechamento manual (cashOnly), não o da madrugada.
  if (kind === "CLOSE") {
    const { data: open } = await admin
      .from("sync_job")
      .select("id, payload")
      .eq("tenant_id", tenantId)
      .eq("kind", "CLOSE")
      .in("status", ["QUEUED", "RUNNING"])
      .limit(20);
    const hit = (open ?? []).find((row) => (row.payload as { cashOnly?: unknown } | null)?.cashOnly === true);
    if (hit) return json({ ok: true, job: { id: hit.id }, deduped: true });
  } else if (kind === "SEED" || kind === "RANGE" || kind === "REGISTRY") {
    const { data: open } = await admin
      .from("sync_job")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("kind", kind)
      .in("status", ["QUEUED", "RUNNING"])
      .limit(1)
      .maybeSingle();
    if (open) {
      return json({ ok: true, job: open, deduped: true });
    }
  }

  const { data: job, error: jobErr } = await admin
    .from("sync_job")
    .insert({
      tenant_id: tenantId,
      credential_id: credential.id,
      kind,
      status: "QUEUED",
      payload,
    })
    .select("id, kind, status, created_at")
    .single();

  if (jobErr || !job) {
    console.error("sync_job insert failed", jobErr);
    return json({ error: "enqueue_failed" }, 500);
  }

  return json({ ok: true, job });
});
