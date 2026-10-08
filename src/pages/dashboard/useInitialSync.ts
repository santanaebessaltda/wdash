import { useCallback, useEffect, useRef, useState } from "react";
import { fetchInitialSync, requestTodaySync, type InitialSync } from "@/data/wedash/initialSync";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { refreshMonthFill } from "@/pages/dashboard/useMonthFill";
import { useActiveSession } from "@/session/SessionProvider";

const POLL_MS = 3_000;

/**
 * Busca das vendas de hoje logo apos conectar o Millennium. Confere a cada 3s enquanto roda;
 * ao terminar, as telas recarregam (`SALES_SYNCED_EVENT`) e a carga do historico entra no aviso dela.
 */
export function useInitialSync(): { sync: InitialSync | null; retry: () => Promise<void>; retrying: boolean } {
  const { tenantId } = useActiveSession();
  const [sync, setSync] = useState<InitialSync | null>(null);
  const [retrying, setRetrying] = useState(false);
  const prev = useRef<InitialSync | null>(null);

  const check = useCallback(async () => {
    const next = await fetchInitialSync(tenantId);
    const pendente = prev.current?.phase === "queued" || prev.current?.phase === "running";
    if (pendente && !next) {
      window.dispatchEvent(new Event(SALES_SYNCED_EVENT));
      refreshMonthFill();
    }
    prev.current = next;
    setSync(next);
  }, [tenantId]);

  useEffect(() => {
    void check();
  }, [check]);

  const ativo = sync !== null && sync.phase !== "failed";
  useEffect(() => {
    if (!ativo) return;
    const id = window.setInterval(() => void check(), POLL_MS);
    return () => window.clearInterval(id);
  }, [ativo, check]);

  // Um Atualizar manual tambem resolve uma busca que falhou.
  useEffect(() => {
    const onSynced = () => void check();
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [check]);

  const retry = useCallback(async () => {
    setRetrying(true);
    await requestTodaySync();
    prev.current = { phase: "queued" };
    setSync({ phase: "queued" });
    setRetrying(false);
  }, []);

  return { sync, retry, retrying };
}
