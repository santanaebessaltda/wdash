import { calendarTodayIso } from "@/data/wedash/clock";
import { storesForSession, type Store } from "@/data/wedash/stores";
import type { Session } from "@/session/session";
import { firstNameFrom } from "./greeting";

export type JarvisStoreRef = {
  id: string;
  name: string;
  tradeName: string;
  code: string;
};

export type JarvisContext = {
  tenantId: string;
  /** Membership do Gestor — memória de longo prazo do JARVIS. */
  membershipId: string;
  /** Vazio = todas as lojas da sessão. */
  storeIds: string[];
  /** Escopo da Topbar (ou rede se vazio). */
  stores: JarvisStoreRef[];
  /** Todas as lojas do acesso — para casar nome no texto mesmo com Topbar filtrada. */
  network: JarvisStoreRef[];
  today: string;
  /** Primeiro nome do Gestor (cumprimento). */
  managerFirstName: string;
};

/** Palavras genericas demais para casar como nome de filial. */
const STORE_NAME_BLOCKLIST = new Set([
  "loja",
  "lojas",
  "filial",
  "filiais",
  "rede",
  "todas",
  "shopping",
  "unidade",
  "ponto",
]);

export function jarvisContextFromSession(session: Session, scopeStoreIds: string[]): JarvisContext {
  const network = storesForSession(session.stores).map(toRef);
  const picked =
    scopeStoreIds.length > 0 ? network.filter((s) => scopeStoreIds.includes(s.id)) : network;
  const stores = picked.length > 0 ? picked : network;
  return {
    tenantId: session.tenantId,
    membershipId: session.membershipId,
    storeIds: stores.map((s) => s.id),
    stores,
    network,
    today: calendarTodayIso(),
    managerFirstName: firstNameFrom(session.name || ""),
  };
}

function toRef(s: Store): JarvisStoreRef {
  return { id: s.id, name: s.name, tradeName: s.tradeName, code: s.branchCode };
}

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function storeLabels(s: JarvisStoreRef): string[] {
  return [s.tradeName, s.name, s.code].map(fold).filter(Boolean);
}

function labelLen(s: JarvisStoreRef): number {
  return Math.max(...storeLabels(s).map((x) => x.length), 0);
}

/**
 * Cruza o texto com fantasia/codigo das lojas.
 * Ignora nomes genericos ("loja"); prefere o nome mais longo quando varios batem.
 */
export function matchStoresInText(text: string, stores: JarvisStoreRef[]): JarvisStoreRef[] {
  const n = fold(text);
  const hit = stores.filter((s) => {
    const names = storeLabels(s);
    return names.some((name) => {
      if (name.length < 3) return false;
      if (STORE_NAME_BLOCKLIST.has(name)) return false;
      return n.includes(name);
    });
  });

  // "pra Loja" / "a Loja" → unica filial cujo nome comeca com LOJA… (ex.: LOJAWEPINK.CENTRO)
  // So "pra/para Loja" — "da loja" generico nao conta.
  if (/\b((aqui\s+)?pra|para(\s+a)?)\s+loja\b/.test(n)) {
    const lojaNamed = stores.filter((s) => storeLabels(s).some((name) => name.startsWith("loja") && name.length > 4));
    if (lojaNamed.length === 1 && !hit.some((s) => s.id === lojaNamed[0]!.id)) {
      hit.push(lojaNamed[0]!);
    }
  }

  hit.sort((a, b) => labelLen(b) - labelLen(a));
  return hit;
}

/** Casar nomes na rede inteira; se ninguem for citado, usa o escopo da Topbar. */
export function resolveStoresInQuestion(question: string, ctx: JarvisContext): JarvisStoreRef[] {
  const pool = ctx.network.length > 0 ? ctx.network : ctx.stores;
  const named = matchStoresInText(question, pool);
  if (named.length > 0) return named;
  return ctx.stores;
}

export function scopeLabel(stores: JarvisStoreRef[], all: JarvisStoreRef[]): string {
  if (stores.length === 0) return "rede";
  if (stores.length === all.length && all.length > 1) return "rede";
  if (stores.length === 1) return stores[0]!.tradeName || stores[0]!.name;
  return `${stores.length} filiais`;
}
