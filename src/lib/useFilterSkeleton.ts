import { useCallback, useState } from "react";
import { useMinSkeleton } from "./useMinSkeleton";

/**
 * Skeleton nos cards/KPIs enquanto o filtro atual nao tem pacote completo (`settle`).
 * Titulo, filtro e subtitulo ficam fora do skeleton (nas paginas).
 * 1ª carga e troca de filial/periodo/marca: espera o pacote 100%.
 * Recarga da mesma chave (venda nova) nao liga skeleton.
 *
 * Na view, use um `viewScope` que so atualiza no settle (junto com os aggs),
 * senao o escopo novo filtra os dados velhos e os cards piscam vazios.
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
