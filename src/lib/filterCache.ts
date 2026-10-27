/**
 * Cache por chave de filtro (periodo + lojas + marca).
 * Memoria (LRU) + sessionStorage: voltar na mesma aba e no mesmo filtro fica instantaneo
 * sem ir de novo no banco; a tela ainda refresca em silencio.
 */
const store = new Map<string, unknown>();
const MAX = 32;
const STORAGE_PREFIX = "wdash.fc.v2:";
/** Evita estourar sessionStorage com payloads enormes. */
const MAX_STORAGE_CHARS = 1_500_000;

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
