/**
 * Cache por chave de filtro (periodo + lojas + marca).
 * Memoria (LRU) + sessionStorage: voltar na mesma aba e no mesmo filtro fica instantaneo
 * sem ir de novo no banco; a tela ainda refresca em silencio.
 *
 * Padrao das telas do Dashboard:
 * 1. cache hit → aplica + `setViewScope` + `settle` (tela instantanea)
 * 2. rede: `Promise.all` do pacote completo → aplica + `setViewScope` + `settle` uma vez
 * 3. `viewScope` so muda com os aggs (nunca no clique do filtro sozinho)
 * 4. datas do cache: sempre `filterCacheDate(...)` — JSON vira ISO string
 */
const store = new Map<string, unknown>();
const MAX = 32;
const STORAGE_PREFIX = "wdash.fc.v2:";
/** Evita estourar sessionStorage com payloads enormes. */
const MAX_STORAGE_CHARS = 1_500_000;

/** Revive Date apos JSON.parse do sessionStorage (ISO string). */
export function filterCacheDate(value: Date | string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function filterCacheGet<T>(key: string): T | null {
  if (store.has(key)) {
    const value = store.get(key) as T;
    store.delete(key);
    store.set(key, value);
    return value;
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const value = JSON.parse(raw) as T;
    store.set(key, value);
    return value;
  } catch {
    return null;
  }
}

export function filterCacheSet(key: string, value: unknown): void {
  if (store.has(key)) store.delete(key);
  store.set(key, value);
  while (store.size > MAX) {
    const oldest = store.keys().next().value;
    if (oldest == null) break;
    store.delete(oldest);
  }
  try {
    const raw = JSON.stringify(value);
    if (raw.length <= MAX_STORAGE_CHARS) {
      sessionStorage.setItem(STORAGE_PREFIX + key, raw);
    }
  } catch {
    /* quota / private mode */
  }
}

export function filterCacheClear(): void {
  store.clear();
  try {
    const drop: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(STORAGE_PREFIX)) drop.push(k);
    }
    for (const k of drop) sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
