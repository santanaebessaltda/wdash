import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, AlertLink } from "@/components/ui";
import { fetchErpIntegrationStatus, type ErpIntegrationStatus } from "@/data/wedash/erp";
import { fetchSyncWatermark } from "@/data/wedash/salesRepo";
import { isGestor } from "@/layout/nav-wedash";
import { paths } from "@/router/paths";
import { useActiveSession } from "@/session/SessionProvider";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";

export type ErpConnection = "connected" | "disconnected" | "password" | "unknown";

type ErpSnapshot = { connection: ErpConnection; lastSync: Date | null };

/** Mesma tela pode ter mais de um aviso lendo o status: 1 leitura a cada poucos segundos por empresa. */
const CACHE_MS = 5_000;
const cache = new Map<string, { at: number; promise: Promise<ErpSnapshot> }>();

function connectionOf(st: ErpIntegrationStatus | null): ErpConnection {
  if (!st) return "unknown";
  if (st.syncPaused) return "disconnected";
  if (st.status === "INVALID") return "password";
  return st.status === "VALID" ? "connected" : "disconnected";
}

function loadSnapshot(tenantId: string, force: boolean): Promise<ErpSnapshot> {
  const hit = cache.get(tenantId);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = Promise.all([
    fetchErpIntegrationStatus(tenantId).catch(() => null),
    fetchSyncWatermark(tenantId).catch(() => null),
  ]).then(([st, wm]) => ({ connection: connectionOf(st), lastSync: wm }));
  cache.set(tenantId, { at: Date.now(), promise });
  return promise;
}

/** Status da integracao agora (mesmo cache do aviso)  -  para nao iniciar busca no Millennium com a integracao desligada. */
export function fetchErpConnection(tenantId: string): Promise<ErpConnection> {
  return loadSnapshot(tenantId, false).then((s) => s.connection);
}

/** Status da integracao com o Millennium (rele ao voltar para o app e ao terminar uma sincronizacao). */
export function useErpConnection(): ErpSnapshot {
  const session = useActiveSession();
  const [snap, setSnap] = useState<ErpSnapshot>({ connection: "unknown", lastSync: null });

  const load = useCallback(
    (force: boolean) => {
      void loadSnapshot(session.tenantId, force).then(setSnap);
    },
    [session.tenantId],
  );

  useEffect(() => {
    load(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") load(true);
    };
    const onSynced = () => load(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
    };
  }, [load]);

  return snap;
}

function desde(at: Date): string {
  const hora = at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const dia = at.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return at.toDateString() === new Date().toDateString() ? `hoje às ${hora}` : `${dia} às ${hora}`;
}

/**
 * Aviso quando a integracao com o Millennium esta desconectada ou com senha invalida: as vendas
 * (e o estoque) param de ser atualizados. Gestor ganha o atalho para Integracoes; Gerente so o aviso.
 */
export function ErpStatusNotice({ dado = "vendas", className = "mt-4" }: { dado?: "vendas" | "estoque"; className?: string }) {
  const session = useActiveSession();
  const navigate = useNavigate();
  const { connection, lastSync } = useErpConnection();
  if (connection !== "disconnected" && connection !== "password") return null;

  const gestor = isGestor(session.role);
  const titulo = connection === "password" ? "A senha do Millennium não é mais válida" : "Millennium desconectado";
  const texto =
    dado === "estoque"
      ? "O estoque não está sendo atualizado. Os valores mostram a última atualização disponível."
      : lastSync
        ? `As vendas não estão sendo atualizadas desde ${desde(lastSync)}. Os números mostram as vendas até esse momento.`
        : "As vendas não estão sendo atualizadas.";

  return (
    <Alert
      variant="warning"
      className={className}
      title={titulo}
      action={
        gestor ? (
          <AlertLink onClick={() => navigate(paths.settings.erp)}>{connection === "password" ? "Atualizar senha" : "Conectar"}</AlertLink>
        ) : undefined
      }
    >
      {gestor
        ? texto
        : `${texto} ${connection === "password" ? "Peça ao gestor da conta para atualizar a integração." : "Peça ao gestor da conta para conectar novamente."}`}
    </Alert>
  );
}
