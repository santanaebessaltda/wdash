import { STUCK_QUEUED_MS } from "@/data/wedash/initialSync";
import type { MonthFill } from "@/data/wedash/salesRepo";
import { getSupabase } from "@/lib/supabase";

/** Andamento da carga de uma conta Millennium (vendas de hoje + histórico). */
export type AccountSyncView = {
  /** null = esta conta não tem carga inicial em aberto. */
  seed: "queued" | "waiting" | "running" | "stuck" | "failed" | null;
  busy: boolean;
  fill: MonthFill | null;
};

export type ErpSyncJobRow = {
  credentialId: string;
  kind: string;
  status: string;
  error: string | null;
  createdAt: string;
  to: string | null;
  fillUntil: string | null;
  progressDay: string | null;
  deep: boolean;
};

function isSeedKind(kind: string): boolean {
  return kind === "SEED" || kind === "BACKFILL";
}

function isBusyError(msg: string | null): boolean {
  const t = (msg ?? "").toLowerCase();
  return ["ultrapassado", "já está conectado", "ja esta conectado", "máximo", "maximo", "busy"].some((k) => t.includes(k));
}

function previousIsoDay(iso: string): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Carga desta conta. Um SEED na fila enquanto outra conta já roda fica `waiting`
 * (não é o sincronizador parado). Um Atualizar posterior à falha encerra o aviso.
 */
export function accountSyncView(credentialId: string, jobs: ErpSyncJobRow[], now = Date.now()): AccountSyncView {
  const mine = jobs
    .filter((job) => job.credentialId === credentialId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const seeds = mine.filter((job) => isSeedKind(job.kind));
  const open = seeds.find((job) => job.status === "RUNNING") ?? seeds.find((job) => job.status === "QUEUED");
  let seed: AccountSyncView["seed"] = null;
  let busy = false;
  if (open?.status === "RUNNING") seed = "running";
  else if (open?.status === "QUEUED") {
    const otherRunning = jobs.some((job) => job.credentialId !== credentialId && job.status === "RUNNING");
    if (otherRunning) seed = "waiting";
    else seed = now - new Date(open.createdAt).getTime() > STUCK_QUEUED_MS ? "stuck" : "queued";
  } else {
    const latestSeed = seeds[0];
    const laterForce = latestSeed
      ? mine.some((job) => job.kind === "FORCE" && job.createdAt > latestSeed.createdAt)
      : false;
    if (latestSeed?.status === "FAILED" && !laterForce) {
      seed = "failed";
      busy = isBusyError(latestSeed.error);
    }
  }

  const fillJob = mine.find(
    (job) =>
      job.kind === "CLOSE" &&
      (job.status === "QUEUED" || job.status === "RUNNING") &&
      !job.deep &&
      job.fillUntil &&
      job.to,
  );
  const fill =
    fillJob?.fillUntil && fillJob.to
      ? {
          currentDay: fillJob.progressDay ? previousIsoDay(fillJob.progressDay.slice(0, 10)) : fillJob.to.slice(0, 10),
          fillUntil: fillJob.fillUntil.slice(0, 10),
        }
      : null;
  return { seed, busy, fill };
}

type JobDbRow = {
  credential_id: string;
  kind: string;
  status: string;
  error: string | null;
  created_at: string;
  payload?: {
    to?: unknown;
    fillUntil?: unknown;
    progressDay?: unknown;
    deep?: unknown;
  } | null;
};

function toJob(row: JobDbRow): ErpSyncJobRow {
  const payload = row.payload ?? {};
  return {
    credentialId: row.credential_id,
    kind: row.kind,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    to: typeof payload.to === "string" ? payload.to : null,
    fillUntil: typeof payload.fillUntil === "string" ? payload.fillUntil : null,
    progressDay: typeof payload.progressDay === "string" ? payload.progressDay : null,
    deep: payload.deep === true,
  };
}

export type ErpAccountSyncState = {
  views: Map<string, AccountSyncView>;
  /** Contas que já tiveram uma carga inicial, mesmo que já tenha terminado. */
  seeded: Set<string>;
};

/** Jobs abertos (e falhas recentes) de todas as contas, para o andamento de cada uma. */
export async function fetchErpAccountSync(tenantId: string): Promise<ErpAccountSyncState | null> {
  const sb = getSupabase();
  if (!sb) return { views: new Map(), seeded: new Set() };
  const [openRes, recentRes, seededRes] = await Promise.all([
    sb
      .from("sync_job")
      .select("credential_id, kind, status, error, created_at, payload")
      .eq("tenant_id", tenantId)
      .in("status", ["QUEUED", "RUNNING"])
      .limit(50),
    sb
      .from("sync_job")
      .select("credential_id, kind, status, error, created_at, payload")
      .eq("tenant_id", tenantId)
      .in("kind", ["SEED", "BACKFILL", "FORCE"])
      .order("created_at", { ascending: false })
      .limit(30),
    sb
      .from("sync_job")
      .select("credential_id")
      .eq("tenant_id", tenantId)
      .in("kind", ["SEED", "BACKFILL"])
      .limit(200),
  ]);
  if (openRes.error || recentRes.error || seededRes.error) {
    console.warn(
      "fetchErpAccountSync:",
      openRes.error?.message ?? recentRes.error?.message ?? seededRes.error?.message,
    );
    return null;
  }
  const byId = new Map<string, ErpSyncJobRow>();
  for (const row of [...(openRes.data ?? []), ...(recentRes.data ?? [])] as JobDbRow[]) {
    const job = toJob(row);
    byId.set(`${job.credentialId}:${job.kind}:${job.status}:${job.createdAt}`, job);
  }
  const jobs = [...byId.values()];
  const views = new Map<string, AccountSyncView>();
  for (const credentialId of new Set(jobs.map((job) => job.credentialId))) {
    views.set(credentialId, accountSyncView(credentialId, jobs));
  }
  const seeded = new Set(
    ((seededRes.data ?? []) as { credential_id?: string }[])
      .map((row) => row.credential_id)
      .filter((id): id is string => Boolean(id)),
  );
  return { views, seeded };
}
