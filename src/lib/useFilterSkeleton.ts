import { useCallback, useState } from "react";
import { useMinSkeleton } from "./useMinSkeleton";

/**
 * Skeleton na primeira carga e quando `filterKey` muda, no mesmo render.
 * `settle(key)` libera a tela quando os dados dessa chave chegaram.
 * Recarga da mesma chave (venda nova, catálogo) não liga o skeleton.
 */
export function useFilterSkeleton(filterKey: string) {
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const pending = loadedKey !== filterKey;
  const showSkeleton = useMinSkeleton(pending);
  const settle = useCallback((key: string) => {
    setLoadedKey((current) => (current === key ? current : key));
  }, []);
  return { pending, showSkeleton, settle };
}
