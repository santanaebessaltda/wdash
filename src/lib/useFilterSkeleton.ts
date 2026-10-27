import { useCallback, useState } from "react";
import { useMinSkeleton } from "./useMinSkeleton";

/**
 * Skeleton so na primeira carga (ainda sem nenhum filtro carregado).
 * Troca de filtro: mantem a tela anterior sem escurecer ate `settle(key)`.
 * Recarga da mesma chave (venda nova) nao liga skeleton.
 *
 * Na view, use um `viewScope` que so atualiza no settle (junto com os aggs),
 * senao o escopo novo filtra os dados velhos e os cards piscam vazios.
 */
export function useFilterSkeleton(filterKey: string) {
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const pending = loadedKey !== filterKey;
  const firstLoad = loadedKey === null;
  const showSkeleton = useMinSkeleton(pending && firstLoad);
  const settle = useCallback((key: string) => {
    setLoadedKey((current) => (current === key ? current : key));
  }, []);
  return { pending, showSkeleton, settle };
}
