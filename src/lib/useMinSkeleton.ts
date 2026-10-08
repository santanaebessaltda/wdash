import { useEffect, useRef, useState } from "react";

/** Tempo minimo do skeleton: carga rapida nao vira um "pisca". */
export const MIN_SKELETON_MS = 600;

/**
 * `true` enquanto `loading` for true e, depois, ate completar `ms` desde que comecou a carregar.
 * Uso: `const showSkeleton = useMinSkeleton(loading)`.
 */
export function useMinSkeleton(loading: boolean, ms = MIN_SKELETON_MS): boolean {
  const startedAt = useRef<number | null>(loading ? Date.now() : null);
  const [hold, setHold] = useState(loading);

  useEffect(() => {
    if (loading) {
      startedAt.current ??= Date.now();
      setHold(true);
      return;
    }
    const start = startedAt.current;
    startedAt.current = null;
    const rest = start == null ? 0 : ms - (Date.now() - start);
    if (rest <= 0) {
      setHold(false);
      return;
    }
    const t = setTimeout(() => setHold(false), rest);
    return () => clearTimeout(t);
  }, [loading, ms]);

  return loading || hold;
}
