import { useEffect, useSyncExternalStore } from "react";
import { fetchMonthFill, type MonthFill } from "@/data/wedash/salesRepo";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useActiveSession } from "@/session/SessionProvider";

const ACTIVE_POLL_MS = 10_000;
const IDLE_POLL_MS = 60_000;

let current: MonthFill | null = null;
let currentTenant: string | null = null;
let subscribers = 0;
let timer: number | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

async function poll(tenantId: string) {
  const next = await fetchMonthFill(tenantId);
  if (tenantId !== currentTenant) return;
  const prev = current;
  current = next;
  // Um dia terminou (a cadeia andou para tras ou acabou)  ->  telas recarregam.
  if (prev && (!next || next.currentDay !== prev.currentDay)) {
    window.dispatchEvent(new Event(SALES_SYNCED_EVENT));
  }
  if (prev?.currentDay !== next?.currentDay || prev?.fillUntil !== next?.fillUntil) emit();
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

/** PWA em segundo plano congela o timer: ao voltar para a tela, confere na hora. */
function onVisible() {
  if (document.visibilityState !== "visible" || !currentTenant || subscribers === 0) return;
  void poll(currentTenant);
}

/** Acabou de enfileirar uma carga (ex.: Recarregar custos): confere na hora em vez de esperar o poll ocioso. */
export function refreshMonthFill() {
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
 * Carga do mes pos-onboarding (dias anteriores a hoje chegando por tras).
 * Um poll so para o app inteiro; quando um dia termina dispara `SALES_SYNCED_EVENT`.
 */
export function useMonthFill(): MonthFill | null {
  const { tenantId } = useActiveSession();
  useEffect(() => {
    start(tenantId);
    return stop;
  }, [tenantId]);
  return useSyncExternalStore(subscribe, () => current);
}
