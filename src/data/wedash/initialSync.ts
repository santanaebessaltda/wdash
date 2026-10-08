import { getSupabase } from "@/lib/supabase";

/** Na fila sem o worker pegar por mais que isso = o sincronizador nao esta respondendo. */
const STUCK_QUEUED_MS = 90_000;

/**
 * Busca das vendas de hoje logo apos conectar o Millennium (job SEED). O onboarding nao espera:
 * o board abre zerado e este estado alimenta o aviso de cima das telas.
 * - `queued`: na fila, ainda sem o worker (sem aviso  -  com `SYNC_ONBOARDING=off` o worker encerra o job
 *   assim que pega, e a tela nao deve anunciar uma busca que nao vai acontecer).
 * - `running`: o worker esta buscando.
 * - `stuck`: parado na fila (worker fora do ar).
 * - `failed`: terminou com erro; `busy` = usuario ERP logado em outro lugar.
 * null = terminou, nunca houve, ou um Atualizar posterior ja cobriu (a falha deixa de importar).
 */
export type InitialSync =
  | { phase: "queued" }
  | { phase: "running" }
  | { phase: "stuck" }
  | { phase: "failed"; busy: boolean };

function isBusyError(msg: string | null): boolean {
  const t = (msg ?? "").toLowerCase();
  return ["ultrapassado", "já está conectado", "ja esta conectado", "máximo", "maximo", "busy"].some((k) => t.includes(k));
}

export async function fetchInitialSync(tenantId: string): Promise<InitialSync | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("sync_job")
    .select("kind, status, error, created_at")
    .eq("tenant_id", tenantId)
    .in("kind", ["SEED", "BACKFILL", "FORCE"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("fetchInitialSync:", error.message);
    return null;
  }
  const job = data as { kind: string; status: string; error: string | null; created_at: string } | null;
  if (!job || job.kind === "FORCE") return null;
  if (job.status === "RUNNING") return { phase: "running" };
  if (job.status === "QUEUED") {
    return Date.now() - new Date(job.created_at).getTime() > STUCK_QUEUED_MS ? { phase: "stuck" } : { phase: "queued" };
  }
  if (job.status === "FAILED") return { phase: "failed", busy: isBusyError(job.error) };
  return null;
}

/** Pede a busca das vendas de hoje (SEED). A Edge nao duplica se ja houver uma na fila. */
export async function requestTodaySync(): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return true;
  try {
    const { error } = await sb.functions.invoke("erp-sync-enqueue", { body: { action: "seed" } });
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
