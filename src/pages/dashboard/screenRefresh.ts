import { useEffect, useRef, useSyncExternalStore } from "react";

/** O que o Atualizar do topo faz enquanto esta tela está aberta. */
export type ScreenRefresh = {
  /** Nome acessível do botão. */
  label: string;
  /** Tooltip: só o que este clique busca. */
  tip: string;
  /** Também busca as vendas de hoje. O tooltip da tela substitui o das vendas. */
  sales?: boolean;
  run: () => void | Promise<void>;
};

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
  useEffect(() => {
    const mine = { read: () => ref.current };
    holder = mine;
    emit();
    return () => {
      if (holder === mine) {
        holder = null;
        emit();
      }
    };
  }, []);
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
