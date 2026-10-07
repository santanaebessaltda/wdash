/**
 * Chamadas ao ERP Millennium.
 * - Com Supabase: Edge Function `millennium-onboarding` (login + stores + logout).
 * - Sem Supabase: mock local (senhas demos: errada / ocupado / falha).
 */
import { stores, type Store } from "./stores";
import { getSupabase } from "@/lib/supabase";
import { persistErpCredentialAndStores } from "@/session/authApi";
import { syncProductsNow } from "./productCatalog";

function esperar(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export interface StoreErp {
  storeId: number;
  code: string;
  name: string;
  tradeName: string;
  taxId: string;
  city: string;
  state: string;
  franchise: string;
  type: "M" | "F";
  hasWpink: boolean;
  openedAt: string;
}

/** Resultado do teste de cada relatorio personalizado do Millennium que o sync usa. */
export type ErpReportCheck = { key: string; name: string; ok: boolean; error?: string };

export type ErpLoginFailReason = "password" | "busy" | "other" | "stores" | "reports";

export type ErpLoginResult =
  | { ok: true; session?: string; stores: StoreErp[] }
  | { ok: false; reason: ErpLoginFailReason; reports?: ErpReportCheck[] };

type EdgeResponse =
  | { ok: true; session: string; stores?: StoreErp[] }
  | { ok: false; reason: ErpLoginFailReason; reports?: ErpReportCheck[] }
  | { ok: true }
  | { error: string };

const REPORTS_MOCK: ErpReportCheck[] = [
  { key: "cupom", name: "WE PINK - PRODUTOS POR CUPOM E VENDEDOR", ok: false, error: "Tipo de documento não suportado" },
];

function storesMock(): StoreErp[] {
  return stores.map(
    (f: Store): StoreErp => ({
      storeId: f.millenniumFilial,
      code: f.codFilial,
      name: f.nome,
      tradeName: f.fantasia,
      taxId: f.cnpj,
      city: f.cidade,
      state: f.uf,
      franchise: "WEPINK",
      type: f.tipo,
      hasWpink: f.temWpink,
      openedAt: f.dataInauguracao,
    }),
  );
}

/**
 * Login + FILIAIS.Lista + acesso aos relatorios personalizados no ERP.
 * Antes de logar, a Edge libera sessao WDash salva (reclaim)  -  busy do nosso sync some sem o usuario ver.
 * Sem acesso a algum relatorio  ->  `reason: "reports"` + lista (Edge ja deslogou).
 * Demo (sem Edge): senha "errada" | "ocupado" | "falha" | "relatorio"; qualquer outra  ->  ok + mock.
 */
export async function testErpLogin(usuario: string, senha: string): Promise<ErpLoginResult> {
  const u = usuario.trim();
  if (!u || !senha) return { ok: false, reason: "password" };

  const sb = getSupabase();
  if (sb) {
    // Libera sessao do tenant antes (idempotente).
    try {
      await sb.functions.invoke("millennium-onboarding", { body: { action: "release" } });
    } catch {
      /* best-effort */
    }
    await esperar(400);

    const attempt = async () =>
      sb.functions.invoke<EdgeResponse>("millennium-onboarding", {
        body: { username: u, password: senha, includeStores: true, keepSession: true, checkReports: true },
      });

    let { data, error } = await attempt();
    if (data && typeof data === "object" && "ok" in data && data.ok === false && data.reason === "busy") {
      // Ainda busy (ERP desktop ou orfao sem token)  -  release de novo + 1 retry curto.
      try {
        await sb.functions.invoke("millennium-onboarding", { body: { action: "release" } });
      } catch {
        /* ignore */
      }
      await esperar(1500);
      ({ data, error } = await attempt());
    }
    if (data && typeof data === "object" && "ok" in data) {
      if (data.ok === true && "session" in data) {
        return {
          ok: true,
          session: data.session || undefined,
          stores: Array.isArray(data.stores) ? data.stores : [],
        };
      }
      if (data.ok === false) {
        return { ok: false, reason: data.reason, reports: Array.isArray(data.reports) ? data.reports : undefined };
      }
    }
    console.warn("millennium-onboarding:", error?.message ?? data);
    return { ok: false, reason: "other" };
  }

  await esperar(1400);
  const s = senha.trim().toLowerCase();
  if (s === "errada") return { ok: false, reason: "password" };
  if (s === "ocupado") return { ok: false, reason: "busy" };
  if (s === "falha") return { ok: false, reason: "other" };
  if (s === "relatorio") return { ok: false, reason: "reports", reports: REPORTS_MOCK };
  return { ok: true, session: "mock-session", stores: storesMock() };
}

/** Encerra a sessao no ERP (voltar no wizard / desconectar). Best-effort.
 * Nao chamar ao confirmar lojas  -  o token fica no tenant p/ o worker. */
export async function logoutErp(session: string | undefined): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.functions.invoke("millennium-onboarding", {
      body: { action: "logout", session: session ?? "" },
    });
  } catch (e) {
    console.warn("millennium-onboarding logout:", e);
  }
}

/** Libera sessao WDash no Millennium + (opcional) pausa o sync do worker. */
export async function releaseErpSession(opts?: { pauseSync?: boolean }): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.functions.invoke("millennium-onboarding", {
      body: { action: opts?.pauseSync ? "pause" : "release" },
    });
  } catch (e) {
    console.warn("millennium-onboarding release:", e);
  }
}

export async function resumeErpSync(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.functions.invoke("millennium-onboarding", { body: { action: "resume" } });
  } catch (e) {
    console.warn("millennium-onboarding resume:", e);
  }
}

export type ErpIntegrationStatus = {
  username: string;
  status: string;
  syncPaused: boolean;
  dedicated: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastLightSyncAt: string | null;
  autoRefreshEnabled: boolean;
};

/** Le estado da integracao (sem senha) para Configuracoes > Integracao ERP. */
export async function fetchErpIntegrationStatus(
  tenantId: string,
): Promise<ErpIntegrationStatus | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("erp_credential")
    .select(
      "username, status, sync_paused, dedicated, last_success_at, last_error, last_error_at, last_light_sync_at, auto_refresh_enabled",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) {
    console.warn("fetchErpIntegrationStatus:", error.message);
    return null;
  }
  if (!data) return null;
  const row = data as {
    username: string;
    status: string;
    sync_paused?: boolean | null;
    dedicated?: boolean | null;
    last_success_at?: string | null;
    last_error?: string | null;
    last_error_at?: string | null;
    last_light_sync_at?: string | null;
    auto_refresh_enabled?: boolean | null;
  };
  return {
    username: row.username,
    status: row.status,
    syncPaused: Boolean(row.sync_paused),
    dedicated: Boolean(row.dedicated),
    lastSuccessAt: row.last_success_at ?? null,
    lastError: row.last_error ?? null,
    lastErrorAt: row.last_error_at ?? null,
    lastLightSyncAt: row.last_light_sync_at ?? null,
    autoRefreshEnabled: row.auto_refresh_enabled ?? true,
  };
}

/**
 * Atualizar do card Millennium: lojas do tenant + opcoes de tabela de custo do ERP (nada de venda).
 * Sincrono (Edge `erp-products-sync`, `scope: "registry"`), sem passar pela fila do worker.
 */
export async function refreshErpRegistry(): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!getSupabase()) {
    await esperar(1200);
    return { ok: true };
  }
  const r = await syncProductsNow({ scope: "registry" });
  return r.ok ? { ok: true } : r;
}

/** Quando foi enfileirada a ultima rodada automatica (base da proxima). */
export async function fetchLastAutoRefreshAt(tenantId: string): Promise<Date | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("sync_job")
    .select("created_at")
    .eq("tenant_id", tenantId)
    .eq("kind", "FORCE")
    .eq("payload->>auto", "true")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("fetchLastAutoRefreshAt:", error.message);
    return null;
  }
  const at = (data as { created_at?: string | null } | null)?.created_at;
  return at ? new Date(at) : null;
}

export type ErpCredentialChangeResult =
  | { ok: true; wiped: boolean; storeIds: string[] }
  | { ok: false; reason: ErpLoginFailReason | "no_stores" | "persist"; reports?: ErpReportCheck[] };

/** Lojas ativas do tenant (id Millennium + nome)  -  base da comparacao ao trocar usuario. */
async function tenantErpStores(tenantId: string): Promise<{ storeId: number; name: string }[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("store")
    .select("millennium_store_id, trade_name, name")
    .eq("tenant_id", tenantId)
    .eq("active", true);
  return ((data as { millennium_store_id: number; trade_name: string | null; name: string | null }[] | null) ?? []).map(
    (r) => ({ storeId: Number(r.millennium_store_id), name: r.trade_name || r.name || String(r.millennium_store_id) }),
  );
}

/**
 * Impacto de trocar a credencial:
 * - `credential`: mesmo usuario (troca de senha)  -  so grava.
 * - `keep`: outro usuario que enxerga todas as lojas atuais  -  so grava, dados ficam.
 * - `partial`: outro usuario sem algumas lojas  -  remove so essas (pede confirmacao).
 * - `full`: nenhuma loja em comum / tenant sem lojas  -  recria lojas + carga inicial
 *   (pede confirmacao se ja havia lojas).
 */
export type ErpChangePlan =
  | { kind: "credential" }
  | { kind: "keep" }
  | { kind: "partial"; removed: { storeId: number; name: string }[] }
  | { kind: "full"; hadStores: boolean };

export type PreparedErpChange = {
  tenantId: string;
  membershipId: string;
  username: string;
  password: string;
  dedicated: boolean;
  session?: string;
  loginStores: StoreErp[];
  plan: ErpChangePlan;
};

export function erpChangeNeedsConfirm(plan: ErpChangePlan): boolean {
  return plan.kind === "partial" || (plan.kind === "full" && plan.hadStores);
}

/**
 * Passo 1  -  testa login + relatorios e calcula o impacto (nada gravado ainda).
 * Se o chamador desistir, chamar `cancelErpCredentialChange`.
 */
export async function prepareErpCredentialChange(input: {
  tenantId: string;
  membershipId: string;
  currentUsername: string | null;
  username: string;
  password: string;
  dedicated: boolean;
}): Promise<{ ok: true; change: PreparedErpChange } | Extract<ErpCredentialChangeResult, { ok: false }>> {
  const username = input.username.trim();
  const login = await testErpLogin(username, input.password);
  if (!login.ok) return { ok: false, reason: login.reason, reports: login.reports };

  const base = {
    tenantId: input.tenantId,
    membershipId: input.membershipId,
    username,
    password: input.password,
    dedicated: input.dedicated,
    session: login.session,
    loginStores: login.stores,
  };
  if ((input.currentUsername ?? "").trim() === username) {
    return { ok: true, change: { ...base, plan: { kind: "credential" } } };
  }

  const prev = await tenantErpStores(input.tenantId);
  const visible = new Set(login.stores.map((s) => s.storeId));
  const kept = prev.filter((s) => visible.has(s.storeId));
  let plan: ErpChangePlan;
  if (prev.length > 0 && kept.length === prev.length) plan = { kind: "keep" };
  else if (kept.length > 0) plan = { kind: "partial", removed: prev.filter((s) => !visible.has(s.storeId)) };
  else plan = { kind: "full", hadStores: prev.length > 0 };

  if (plan.kind === "full" && login.stores.length === 0) {
    await logoutErp(login.session);
    return { ok: false, reason: "no_stores" };
  }
  return { ok: true, change: { ...base, plan } };
}

/** Desistiu da troca apos o teste  -  encerra a sessao aberta no teste. */
export async function cancelErpCredentialChange(change: PreparedErpChange): Promise<void> {
  await logoutErp(change.session);
}

/** Passo 2  -  grava a credencial conforme o plano. `wiped` = recriou lojas + SEED. */
export async function applyErpCredentialChange(change: PreparedErpChange): Promise<ErpCredentialChangeResult> {
  const { plan } = change;
  const persisted = await persistErpCredentialAndStores({
    tenantId: change.tenantId,
    membershipId: change.membershipId,
    username: change.username,
    password: change.password,
    dedicated: change.dedicated,
    stores: plan.kind === "full" ? change.loginStores : [],
    millenniumSession: change.session,
    ...(plan.kind === "keep" || plan.kind === "partial"
      ? {
          userChange: {
            mode: "keep" as const,
            removeMillenniumStoreIds: plan.kind === "partial" ? plan.removed.map((s) => s.storeId) : [],
          },
        }
      : {}),
  });
  if (!persisted.ok) return { ok: false, reason: "persist" };

  if (plan.kind === "full") {
    const sb = getSupabase();
    try {
      await sb?.functions.invoke("erp-sync-enqueue", { body: { action: "seed" } });
    } catch (e) {
      console.warn("erp-sync-enqueue seed:", e);
    }
  }
  return { ok: true, wiped: plan.kind === "full", storeIds: persisted.storeIds };
}

/** Marca presenca WDash (heartbeat). Worker so synca com presenca recente. */
export async function touchErpPresence(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.functions.invoke("millennium-onboarding", { body: { action: "presence" } });
  } catch {
    /* best-effort  -  sem credencial ainda (pre-onboarding) */
  }
}

/** Pausar sync + logout no Millennium (sair da WDash). Precisa do JWT ainda valido. */
export async function pauseErpForLogout(): Promise<void> {
  await releaseErpSession({ pauseSync: true });
}

/** Preferir lojas ja trazidas no login; fallback mock so sem sessao. */
export async function listErpStores(precarregadas?: StoreErp[]): Promise<StoreErp[]> {
  if (precarregadas) return precarregadas;
  await esperar(900);
  return storesMock();
}
