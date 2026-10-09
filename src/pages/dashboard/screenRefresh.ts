import { useEffect, useRef, useSyncExternalStore } from "react";

/** O que o Atualizar do topo faz enquanto esta tela está aberta. */
export type ScreenRefresh = {
  /** Nome acessível do botão. */
  label: string;
  /** Tooltip: só o que este clique busca. */
  tip: string;
  /** Última busca, no formato "Estoque atualizado às HH:MM". */
  status?: string;
  /** Também busca as vendas de hoje. O tooltip da tela substitui o das vendas. */
  sales?: boolean;
  run: () => void | Promise<void>;
};

/** "Estoque atualizado às HH:MM" hoje, "Estoque atualizado em DD/MM às HH:MM" em outro dia. */
export function refreshStatusLine(done: string, pending: string, iso: string | null | undefined): string {
  if (!iso) return pending;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return pending;
  const hora = at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (at.toDateString() === new Date().toDateString()) return `${done} às ${hora}`;
  const dia = at.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${done} em ${dia} às ${hora}`;
}

let holder: { read: () => ScreenRefresh } | null = null;
let generation = 0;
const subs = new Set<() => void>();

function emit() {
  generation += 1;
  subs.forEach((fn) => fn());
}

/** A tela aberta assume o Atualizar do topo. Sem registro, o botão segue buscando as vendas de hoje. */
export function useScreenRefresh(claim: ScreenRefresh) {
  const ref = useRef(claim);
  ref.current = claim;
  const mine = useRef<{ read: () => ScreenRefresh } | null>(null);
  const fingerprint = `${claim.label}\n${claim.tip}\n${claim.status ?? ""}\n${claim.sales ? "1" : "0"}`;
  useEffect(() => {
    const entry = { read: () => ref.current };
    mine.current = entry;
    holder = entry;
    emit();
    return () => {
      if (holder === entry) {
        holder = null;
        emit();
      }
    };
  }, []);
  useEffect(() => {
    if (holder === mine.current) emit();
  }, [fingerprint]);
}

export function useScreenRefreshGeneration(): number {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => generation,
    () => 0,
  );
}

export function readScreenRefresh(): ScreenRefresh | null {
  return holder?.read() ?? null;
}
