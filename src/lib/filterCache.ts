/**
 * Cache em memoria por chave de filtro (periodo + lojas + marca).
 * Trocar o filtro e voltar fica instantaneo; a tela ainda refresca em silencio.
 */
const store = new Map<string, unknown>();
const MAX = 24;

export function filterCacheGet<T>(key: string): T | null {
  if (!store.has(key)) return null;
  const value = store.get(key) as T;
  // LRU simples: regrava no fim.
  store.delete(key);
  store.set(key, value);
  return value;
}

export function filterCacheSet(key: string, value: unknown): void {
  if (store.has(key)) store.delete(key);
  store.set(key, value);
  while (store.size > MAX) {
    const oldest = store.keys().next().value;
    if (oldest == null) break;
    store.delete(oldest);
  }
}

export function filterCacheClear(): void {
  store.clear();
}
