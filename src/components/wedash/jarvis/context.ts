import { calendarTodayIso } from "@/data/wedash/clock";
import { storesForSession, type Store } from "@/data/wedash/stores";
import type { Session } from "@/session/session";

export type JarvisStoreRef = {
  id: string;
  name: string;
  tradeName: string;
  code: string;
};

export type JarvisContext = {
  tenantId: string;
  /** Vazio = todas as lojas da sessão. */
  storeIds: string[];
  stores: JarvisStoreRef[];
  today: string;
};

export function jarvisContextFromSession(session: Session, scopeStoreIds: string[]): JarvisContext {
  const network = storesForSession(session.stores);
  const picked =
    scopeStoreIds.length > 0 ? network.filter((s) => scopeStoreIds.includes(s.id)) : network;
  const stores = (picked.length > 0 ? picked : network).map(toRef);
  return {
    tenantId: session.tenantId,
    storeIds: stores.map((s) => s.id),
    stores,
    today: calendarTodayIso(),
  };
}

function toRef(s: Store): JarvisStoreRef {
  return { id: s.id, name: s.name, tradeName: s.tradeName, code: s.branchCode };
}

/** Cruza o texto com fantasia/código das lojas do contexto. */
export function matchStoresInText(text: string, stores: JarvisStoreRef[]): JarvisStoreRef[] {
  const n = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  const hit = stores.filter((s) => {
    const names = [s.tradeName, s.name, s.code]
      .map((x) =>
        x
          .toLowerCase()
          .normalize("NFD")
          .replace(/\p{M}/gu, ""),
      )
      .filter(Boolean);
    return names.some((name) => name.length >= 3 && n.includes(name));
  });
  return hit;
}

export function scopeLabel(stores: JarvisStoreRef[], all: JarvisStoreRef[]): string {
  if (stores.length === 0) return "rede";
  if (stores.length === all.length && all.length > 1) return "rede";
  if (stores.length === 1) return stores[0]!.tradeName || stores[0]!.name;
  return `${stores.length} filiais`;
}
