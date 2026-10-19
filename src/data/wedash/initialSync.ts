import { getSupabase } from "@/lib/supabase";

/** Na fila sem o worker pegar por mais que isso = o sincronizador nao esta respondendo. */
export const STUCK_QUEUED_MS = 90_000;

/**
 * Busca das vendas de hoje logo apos conectar o Millennium (job SEED). O onboarding nao espera:
 * o board abre zerado e este estado alimenta o aviso de cima das telas.
 * - `queued`: na fila, ainda sem o worker (sem aviso  -  com `SYNC_ONBOARDING=off` o worker encerra o job
 *   assim que pega, e a tela nao deve anunciar uma busca que nao vai acontecer).
 * - `waiting`: na fila porque outra conta da empresa ja esta sincronizando.
 * - `running`: o worker esta buscando.
 * - `stuck`: parado na fila (worker fora do ar).
 * - `failed`: terminou com erro; `busy` = usuario ERP logado em outro lugar.
 * null = terminou, nunca houve, ou um Atualizar posterior ja cobriu (a falha deixa de importar).
 */
export type InitialSync =
  | { phase: "queued" }
  | { phase: "waiting" }
  | { phase: "running" }
  | { phase: "stuck" }
  | { phase: "failed"; busy: boolean };

export type InitialSyncJob = {
  kind: string;
  status: string;
  error: string | null;
  createdAt: string;
};

function isBusyError(msg: string | null): boolean {
  const t = (msg ?? "").toLowerCase();
  return ["ultrapassado", "já está conectado", "ja esta conectado", "máximo", "maximo", "busy"].some((k) => t.includes(k));
}

function isSeedKind(kind: string): boolean {
  return kind === "SEED" || kind === "BACKFILL";
}

/** O SEED aberto de qualquer conta vale, mesmo com um Atualizar mais novo de outra conta. */
export function initialSyncFromJobs(jobs: InitialSyncJob[], now = Date.now()): InitialSync | null {
  const ordered = [...jobs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const open = ordered.find((job) => isSeedKind(job.kind) && (job.status === "RUNNING" || job.status === "QUEUED"));
  const focus = open ?? ordered.find((job) => isSeedKind(job.kind) || job.kind === "FORCE");
  if (!focus || focus.kind === "FORCE") return null;
  if (focus.status === "RUNNING") return { phase: "running" };
  if (focus.status === "QUEUED") {
    const busyElsewhere = ordered.some((job) => job.status === "RUNNING");
    if (busyElsewhere) return { phase: "waiting" };
    return now - new Date(focus.createdAt).getTime() > STUCK_QUEUED_MS ? { phase: "stuck" } : { phase: "queued" };
  }
  if (focus.status === "FAILED") return { phase: "failed", busy: isBusyError(focus.error) };
  return null;
}

export async function fetchInitialSync(tenantId: string): Promise<InitialSync | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const [recent, running] = await Promise.all([
    sb
      .from("sync_job")
      .select("kind, status, error, created_at")
      .eq("tenant_id", tenantId)
      .in("kind", ["SEED", "BACKFILL", "FORCE"])
      .order("created_at", { ascending: false })
      .limit(20),
    sb.from("sync_job").select("kind, status, error, created_at").eq("tenant_id", tenantId).eq("status", "RUNNING").limit(10),
  ]);
  if (recent.error) {
    console.warn("fetchInitialSync:", recent.error.message);
    return null;
  }
  const rows = [...(recent.data ?? []), ...(running.error ? [] : (running.data ?? []))] as {
    kind: string;
    status: string;
    error: string | null;
    created_at: string;
  }[];
  return initialSyncFromJobs(
    rows.map((row) => ({
      kind: row.kind,
      status: row.status,
      error: row.error,
      createdAt: row.created_at,
    })),
  );
}

/** Pede a busca das vendas de hoje (SEED). A Edge nao duplica se ja houver uma na fila da conta. */
export async function requestTodaySync(storeIds?: string[]): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return true;
  try {
    const { error } = await sb.functions.invoke("erp-sync-enqueue", {
      body: { action: "seed", ...(storeIds && storeIds.length > 0 ? { storeIds } : {}) },
    });
    if (error) {
      console.warn("erp-sync-enqueue seed:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("erp-sync-enqueue seed:", e);
    return false;
  }
}
