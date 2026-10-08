import { useCallback, useEffect, useState } from "react";
import {
  fetchAnnouncements,
  fetchNotificationState,
  markAllNotificationsRead,
  markNotificationRead,
  type Announcement,
  type NotificationState,
} from "@/data/wedash/notifications";
import { fetchErpIntegrationStatus } from "@/data/wedash/erp";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";

const POLL_MS = 60_000;
/*
 * Copia local do estado do banco: vale sem banco (demo), enquanto a resposta nao chega
 * e como ponto de partida no 1 uso do banco (o que o aparelho ja tinha lido continua lido).
 */
/** Tudo que foi publicado ate esse instante conta como lido. */
const readBeforeKey = (tenantId: string) => `wedash.notif.seen.${tenantId}`;
const readIdsKey = (tenantId: string) => `wedash.notif.read.${tenantId}`;
/** "Limpar": some da lista tudo que foi publicado ate esse instante. */
const clearedBeforeKey = (tenantId: string) => `wedash.notif.cleared.${tenantId}`;

function storedNumber(key: string): number | null {
  const raw = localStorage.getItem(key);
  return raw == null ? null : Number(raw) || 0;
}

function storedIds(key: string): string[] | null {
  const raw = localStorage.getItem(key);
  if (raw == null) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function loadLocal(tenantId: string): NotificationState {
  let readBefore = storedNumber(readBeforeKey(tenantId));
  if (readBefore == null) {
    readBefore = Date.now();
    localStorage.setItem(readBeforeKey(tenantId), String(readBefore));
  }
  return {
    readBefore,
    clearedBefore: storedNumber(clearedBeforeKey(tenantId)) ?? 0,
    readIds: storedIds(readIdsKey(tenantId)) ?? [],
  };
}

function saveLocal(tenantId: string, s: NotificationState) {
  localStorage.setItem(readBeforeKey(tenantId), String(s.readBefore));
  localStorage.setItem(clearedBeforeKey(tenantId), String(s.clearedBefore));
  localStorage.setItem(readIdsKey(tenantId), JSON.stringify(s.readIds));
}

export type AnnouncementNotification = Announcement & { read: boolean };

/** Problema que pede acao do gestor; fica no topo do sino enquanto durar (nao e lido nem limpo). */
export type NotificationAlert = { id: string; title: string; body: string };

/**
 * Sino de Notificacoes: avisos de novidade (tabela `announcement`) + problemas que pedem acao
 * (so quem gerencia a integracao: senha do Millennium invalida, integracao desconectada).
 * Lidos / limpos ficam no banco por pessoa (iguais no navegador, no PWA e em outros aparelhos).
 * Recarrega a cada 60s, quando uma sincronizacao termina e ao voltar para o app (PWA).
 */
export function useNotifications(tenantId: string, role: string, canManageErp: boolean) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [alerts, setAlerts] = useState<NotificationAlert[]>([]);
  const [state, setState] = useState<NotificationState>(() => loadLocal(tenantId));

  const apply = useCallback(
    (s: NotificationState | null) => {
      if (!s) return;
      saveLocal(tenantId, s);
      setState(s);
    },
    [tenantId],
  );

  const load = useCallback(async () => {
    const seed = {
      readBefore: storedNumber(readBeforeKey(tenantId)),
      clearedBefore: storedNumber(clearedBeforeKey(tenantId)),
      readIds: storedIds(readIdsKey(tenantId)),
    };
    const [announcements, remote, erp] = await Promise.all([
      fetchAnnouncements(role),
      fetchNotificationState(tenantId, seed),
      canManageErp && role !== "SELLER" ? fetchErpIntegrationStatus(tenantId).catch(() => null) : Promise.resolve(null),
    ]);
    setItems(announcements);
    apply(remote);
    const next: NotificationAlert[] = [];
    if (erp?.syncPaused) {
      next.push({
        id: "erp-paused",
        title: "Millennium desconectado",
        body: "As vendas não estão sendo atualizadas. Conecte novamente para retomar a sincronização.",
      });
    } else if (erp?.status === "INVALID") {
      next.push({
        id: "erp-password",
        title: "A senha do Millennium não é mais válida",
        body: "Conecte novamente com a senha atual para retomar a sincronização.",
      });
    }
    setAlerts(next);
  }, [tenantId, role, canManageErp, apply]);

  useEffect(() => {
    setState(loadLocal(tenantId));
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    const onSynced = () => void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tenantId, load]);

  const markRead = useCallback(
    (id: string) => {
      if (state.readIds.includes(id)) return;
      // Guarda so os ids que ainda estao na lista (nao cresce para sempre).
      const keep = items.map((i) => i.id);
      const next = { ...state, readIds: [...state.readIds.filter((x) => keep.includes(x)), id] };
      saveLocal(tenantId, next);
      setState(next);
      void markNotificationRead(tenantId, id, keep).then(apply);
    },
    [tenantId, items, state, apply],
  );

  const readAll = useCallback(
    (clear: boolean) => {
      const ate = Math.max(Date.now(), ...items.map((i) => i.at.getTime()));
      const next: NotificationState = {
        readBefore: Math.max(state.readBefore, ate),
        clearedBefore: clear ? Math.max(state.clearedBefore, ate) : state.clearedBefore,
        readIds: [],
      };
      saveLocal(tenantId, next);
      setState(next);
      void markAllNotificationsRead(tenantId, ate, clear).then(apply);
    },
    [tenantId, items, state, apply],
  );

  /** Marca como lido tudo que esta na lista agora. */
  const markAllRead = useCallback(() => readAll(false), [readAll]);
  /** Esconde tudo que esta na lista agora; os proximos avisos aparecem normalmente. */
  const clearAll = useCallback(() => readAll(true), [readAll]);

  const notifications: AnnouncementNotification[] = items
    .filter((i) => i.at.getTime() > state.clearedBefore)
    .map((i) => ({
      ...i,
      read: i.at.getTime() <= state.readBefore || state.readIds.includes(i.id),
    }));

  return {
    alerts,
    items: notifications,
    unread: notifications.some((n) => !n.read),
    markRead,
    markAllRead,
    clearAll,
  };
}
