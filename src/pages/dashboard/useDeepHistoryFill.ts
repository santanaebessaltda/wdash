import { useEffect, useSyncExternalStore } from "react";
import { calendarTodayIso } from "@/data/wedash/clock";
import { fetchDeepHistoryFill, type DeepHistoryFill } from "@/data/wedash/salesRepo";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useActiveSession } from "@/session/SessionProvider";

/** Carga funda anda ~1 mes / 15 min na madrugada — poll mais lento que o do mes. */
const ACTIVE_POLL_MS = 30_000;
const IDLE_POLL_MS = 120_000;

let current: DeepHistoryFill | null = null;
let currentTenant: string | null = null;
let subscribers = 0;
let timer: number | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

async function poll(tenantId: string) {
  const next = await fetchDeepHistoryFill(tenantId, calendarTodayIso());
  if (tenantId !== currentTenant) return;
  const prev = current;
  current = next;
  if (prev && (!next || next.nextMonth !== prev.nextMonth || next.oldestLoaded !== prev.oldestLoaded)) {
    window.dispatchEvent(new Event(SALES_SYNCED_EVENT));
  }
  if (
    prev?.done !== next?.done ||
    prev?.total !== next?.total ||
    prev?.nextMonth !== next?.nextMonth ||
    prev?.oldestLoaded !== next?.oldestLoaded
  ) {
    emit();
  }
  schedule(tenantId);
}

function schedule(tenantId: string) {
  if (timer != null) window.clearTimeout(timer);
  if (subscribers === 0) {
    timer = null;
    return;
  }
  timer = window.setTimeout(() => void poll(tenantId), current ? ACTIVE_POLL_MS : IDLE_POLL_MS);
}

function onVisible() {
  if (document.visibilityState !== "visible" || !currentTenant || subscribers === 0) return;
  void poll(currentTenant);
}

export function refreshDeepHistoryFill() {
  if (currentTenant && subscribers > 0) void poll(currentTenant);
}

function start(tenantId: string) {
  subscribers += 1;
  if (currentTenant !== tenantId) {
    currentTenant = tenantId;
    current = null;
    emit();
  }
  if (subscribers === 1) {
    document.addEventListener("visibilitychange", onVisible);
    void poll(tenantId);
  }
}

function stop() {
  subscribers = Math.max(0, subscribers - 1);
  if (subscribers === 0) {
    document.removeEventListener("visibilitychange", onVisible);
    if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Recuperacao de vendas antigas (DEEP_HISTORY). Um poll so para o app;
 * mostra desde 0% (antes da 1a madrugada) e some ao completar.
 */
export function useDeepHistoryFill(): DeepHistoryFill | null {
  const { tenantId } = useActiveSession();
  useEffect(() => {
    start(tenantId);
    return stop;
  }, [tenantId]);
  return useSyncExternalStore(subscribe, () => current);
}
