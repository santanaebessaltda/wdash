import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveSession } from "@/session/SessionProvider";
import {
  requestForceRefresh,
  waitForSyncJob,
  waitForLatestForceJob,
  peekSyncJob,
} from "@/data/wedash/salesRepo";
import {
  canForceSyncRefresh,
  forceCooldownForScopeSec,
  readForceAtMap,
  recordForceAt,
  lastForceAtFromRetryAfter,
  readPendingForce,
  writePendingForce,
  clearPendingForce,
  type ForceAtMap,
} from "@/data/wedash/syncUi";
import { calendarTodayIso } from "@/data/wedash/clock";

/** Disparado no `window` quando um Atualizar (FORCE) termina  -  telas com dados do ERP recarregam. */
export const SALES_SYNCED_EVENT = "wedash:sales-synced";

/** Disparado quando o usuario clica em Atualizar  -  tela com dado pesado proprio (estoque) busca junto. */
export const FORCE_REFRESH_CLICK_EVENT = "wedash:force-refresh-click";

const DISCONNECTED_MSG = "O Millennium está desconectado. As vendas só podem ser atualizadas depois que a integração for conectada novamente.";

export type ForceRefreshState = {
  canForce: boolean;
  refreshing: boolean;
  forceError: string | null;
  /** Muda a cada Atualizar concluido com sucesso (para o toast). */
  forceDoneAt: number | null;
  forceCooldownSec: number | null;
  forcarAtualizacao: () => Promise<void>;
};

/**
 * Botao Atualizar do Topbar: enfileira FORCE (hoje, loja do StorePicker),
 * espera o job e chama `reload`. Retoma o FORCE pendente ao reabrir / voltar da aba.
 */
export function useForceRefresh({
  storeIds,
  reload,
  disconnected = false,
}: {
  storeIds: string[];
  reload: () => Promise<void>;
  /** Integracao desconectada: o worker nao roda o job  ->  nao enfileira nem espera. */
  disconnected?: boolean;
}): ForceRefreshState {
  const session = useActiveSession();
  const canForce = canForceSyncRefresh(session.role);
  const [refreshing, setRefreshing] = useState(false);
  const [forceError, setForceError] = useState<string | null>(null);
  const [forceDoneAt, setForceDoneAt] = useState<number | null>(null);
  const [forceAtMap, setForceAtMap] = useState<ForceAtMap>(() => readForceAtMap(session.tenantId));
  const [forceCooldownSec, setForceCooldownSec] = useState<number | null>(() =>
    forceCooldownForScopeSec(readForceAtMap(session.tenantId), storeIds),
  );
  /** Evita dois waitForSyncJob paralelos (remount + clique). */
  const forceWaitLock = useRef<Promise<void> | null>(null);
  const waitAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    const tick = () => setForceCooldownSec(forceCooldownForScopeSec(forceAtMap, storeIds));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [forceAtMap, storeIds]);

  useEffect(() => {
    setForceAtMap(readForceAtMap(session.tenantId));
  }, [session.tenantId]);

  const applyForceWaitResult = useCallback(
    async (wait: Awaited<ReturnType<typeof waitForSyncJob>>, ids: string[]) => {
      clearPendingForce(session.tenantId);
      if (wait.status === "FAILED") {
        setForceError("Não foi possível atualizar as vendas. Tente novamente em alguns minutos.");
        console.warn("FORCE job failed:", wait.error);
      } else if (wait.status === "TIMEOUT") {
        setForceError("A atualização está demorando mais que o normal. Os dados podem aparecer em instantes.");
      } else if (wait.status === "CANCELLED") {
        setRefreshing(false);
        return;
      } else if (wait.status === "SUCCEEDED") {
        setForceAtMap(recordForceAt(session.tenantId, ids, new Date()));
      }
      try {
        await reload();
      } finally {
        setRefreshing(false);
        if (wait.status === "SUCCEEDED") setForceDoneAt(Date.now());
      }
    },
    [session.tenantId, reload],
  );

  const resumeOrWaitForce = useCallback(
    async (
      opts: { jobId?: string; storeIds: string[]; enqueuedAt: string },
      /** true = clique do usuario; false = retomada ao voltar da aba / remount */
      fromUserClick = false,
    ) => {
      // Se ja ha wait em curso, reusa a mesma Promise (evita return vazio + UI "pronto" cedo).
      if (forceWaitLock.current) {
        await forceWaitLock.current;
        return;
      }
      const run = (async () => {
        try {
          // Voltou da aba com pending ja concluido  ->  limpa sem piscar "Atualizando...".
          if (!fromUserClick && opts.jobId) {
            const done = await peekSyncJob(opts.jobId);
            if (done) {
              await applyForceWaitResult(done, opts.storeIds);
              return;
            }
          }
          setRefreshing(true);
          setForceError(null);
          const abort = new AbortController();
          waitAbort.current = abort;
          const wait = opts.jobId
            ? await waitForSyncJob(opts.jobId, { signal: abort.signal })
            : await waitForLatestForceJob(session.tenantId, { sinceIso: opts.enqueuedAt, signal: abort.signal });
          await applyForceWaitResult(wait, opts.storeIds);
        } finally {
          forceWaitLock.current = null;
          waitAbort.current = null;
        }
      })();
      forceWaitLock.current = run;
      await run;
    },
    [session.tenantId, applyForceWaitResult],
  );

  // Desconectou (ou ja estava) com um Atualizar pendente  ->  para de girar.
  useEffect(() => {
    if (!disconnected) return;
    waitAbort.current?.abort();
    clearPendingForce(session.tenantId);
  }, [disconnected, session.tenantId]);

  // Reabre o PWA no meio do FORCE  ->  mantem "Atualizando..." ate o job terminar.
  useEffect(() => {
    if (!canForce || disconnected) return;
    const pending = readPendingForce(session.tenantId);
    if (!pending) return;
    void resumeOrWaitForce(pending);
  }, [session.tenantId, canForce, disconnected, resumeOrWaitForce]);

  // Voltou do background: se ainda ha pending e o poll parou, retoma.
  useEffect(() => {
    if (!canForce || disconnected) return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (forceWaitLock.current) return;
      const pending = readPendingForce(session.tenantId);
      if (!pending) return;
      void resumeOrWaitForce(pending);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [session.tenantId, canForce, disconnected, resumeOrWaitForce]);

  const forcarAtualizacao = useCallback(async () => {
    if (!canForce || refreshing || forceCooldownSec != null) return;
    if (disconnected) {
      setForceError(DISCONNECTED_MSG);
      return;
    }
    setRefreshing(true);
    setForceError(null);
    window.dispatchEvent(new Event(FORCE_REFRESH_CLICK_EVENT));
    const enqueuedAt = new Date();
    const today = calendarTodayIso();
    const result = await requestForceRefresh({ from: today, to: today, storeIds });
    if (!result.ok) {
      if (result.error === "rate_limited") {
        const at = lastForceAtFromRetryAfter(result.retryAfterSec ?? 300);
        setForceAtMap(recordForceAt(session.tenantId, storeIds, at));
        setForceError(null);
      } else if (result.error === "forbidden") {
        setForceError("Você não tem permissão para atualizar as vendas.");
      } else if (result.error === "integration_paused") {
        setForceError(DISCONNECTED_MSG);
      } else if (result.error === "credential_missing" || result.error === "credential_invalid") {
        setForceError("Não foi possível acessar o Millennium. Verifique os dados da integração.");
      } else {
        setForceError("Não foi possível iniciar a atualização. Tente novamente.");
        console.warn("requestForceRefresh:", result.error);
      }
      setRefreshing(false);
      return;
    }
    const pending = { jobId: result.jobId, storeIds, enqueuedAt: enqueuedAt.toISOString() };
    writePendingForce(session.tenantId, pending);
    await resumeOrWaitForce(pending, true);
  }, [canForce, refreshing, forceCooldownSec, disconnected, storeIds, session.tenantId, resumeOrWaitForce]);

  return { canForce, refreshing, forceError, forceDoneAt, forceCooldownSec, forcarAtualizacao };
}
