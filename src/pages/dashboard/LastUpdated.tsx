import { useCallback, useEffect, useState } from "react";
import { fetchSyncWatermark } from "@/data/wedash/salesRepo";
import { useActiveSession } from "@/session/SessionProvider";
import { SALES_SYNCED_EVENT } from "./useForceRefresh";

/** Horario da ultima busca das vendas de hoje (Atualizar manual/automatico, carga do onboarding), em linhas. */
export function lastUpdatedLines(at: Date, now: Date = new Date()): string[] {
  const hora = at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const dia = at.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  if (at.toDateString() === now.toDateString()) return [`Vendas de hoje atualizadas às ${hora}`];
  return ["Vendas de hoje ainda não atualizadas", `Última atualização em ${dia} às ${hora}`];
}

/** Mesma informacao numa linha so (cabecalho do PDF). */
export function lastUpdatedLabel(at: Date, now: Date = new Date()): string {
  return lastUpdatedLines(at, now).join(" · ");
}

/** Cabecalho do PDF: quando as vendas de hoje foram buscadas pela ultima vez (sem sync ainda = nada). Na tela fica no tooltip do Atualizar. */
export function LastUpdated() {
  const session = useActiveSession();
  const [at, setAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      setAt(await fetchSyncWatermark(session.tenantId));
    } catch (e) {
      console.warn("LastUpdated:", e);
    }
  }, [session.tenantId]);

  useEffect(() => {
    void load();
    const onSynced = () => void load();
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [load]);

  if (!at) return null;
  return <span>{lastUpdatedLabel(at)}</span>;
}
