import { useCallback, useState } from "react";
import { useMinSkeleton } from "./useMinSkeleton";

/**
 * Skeleton so na primeira carga (ainda sem nenhum filtro carregado).
 * Troca de filtro mantem a tela anterior e marca `refreshing` ate `settle(key)`.
 * Recarga da mesma chave (venda nova) nao liga skeleton nem refreshing.
 */
export function useFilterSkeleton(filterKey: string) {
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const pending = loadedKey !== filterKey;
  const firstLoad = loadedKey === null;
  const showSkeleton = useMinSkeleton(pending && firstLoad);
  const refreshing = pending && !firstLoad;
  const settle = useCallback((key: string) => {
    setLoadedKey((current) => (current === key ? current : key));
  }, []);
  return { pending, showSkeleton, refreshing, settle };
}
