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

/**
 * Escopo da Topbar: vazio ou lista completa = rede (“Todas as lojas”).
 * Alinhado a `scopeStoreIds` em useScope.
 */
export function isTopbarNetworkScope(
  scopeStoreIds: string[],
  networkIds: string[],
): boolean {
  if (networkIds.length <= 1) return false;
  if (scopeStoreIds.length === 0) return true;
  if (scopeStoreIds.length < networkIds.length) return false;
  const set = new Set(scopeStoreIds);
  return networkIds.every((id) => set.has(id));
}

/** Topbar em rede / várias filiais — operação por loja precisa escolher uma. */
export function needsStorePickForWrite(ctx: JarvisContext): boolean {
  return ctx.stores.length !== 1;
}

export function isNetworkStoreScope(ctx: JarvisContext): boolean {
  return (
    ctx.storeIds.length === 0 &&
    ctx.network.length > 1 &&
    ctx.stores.length === ctx.network.length
  );
}

/**
 * Meta / desafio / escala são por filial.
 * Com Topbar em Todas (ou várias), o JARVIS pergunta — não inventa a primeira.
 */
export function speakAskWriteStore(
  ctx: JarvisContext,
  kind: "meta" | "desafio" | "escala",
  opts?: { monthLabel?: string | null },
): string {
  const tip = opts?.monthLabel ? `${opts.monthLabel}, fechado.\n\n` : "";
  const noun =
    kind === "meta" ? "a meta" : kind === "desafio" ? "o desafio" : "a escala";
  if (isNetworkStoreScope(ctx) || (ctx.storeIds.length === 0 && ctx.stores.length > 1)) {
    return (
      `${tip}Você está com o filtro em todas as lojas.\n\n` +
      `De qual filial quer montar ${noun}?`
    );
  }
  if (ctx.stores.length > 1) {
    const names = ctx.stores.map((s) => friendlyStoreLabel(s)).join(", ");
    return `${tip}De qual filial? No filtro estão: ${names}.`;
  }
  return tip ? `${tip}Qual filial?` : `De qual filial quer montar ${noun}?`;
}

export function jarvisContextFromSession(session: Session, scopeStoreIds: string[]): JarvisContext {
  const network = storesForSession(session.stores).map(toRef);
  const networkIds = network.map((s) => s.id);
  const networkScope = isTopbarNetworkScope(scopeStoreIds, networkIds);
  const picked = networkScope
    ? network
    : network.filter((s) => scopeStoreIds.includes(s.id));
  const stores = picked.length > 0 ? picked : network;
  return {
    tenantId: session.tenantId,
    membershipId: session.membershipId,
    // Vazio = todas (igual useScope). Não expandir para a lista inteira —
    // senão o JARVIS “esquece” que o filtro está em Todas as lojas.
    storeIds: networkScope ? [] : stores.map((s) => s.id),
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

/** Código operacional tipo LOJAWEPINK.CENTRO.CAMPOGRANDE — não é nome de exibição. */
export function isTechnicalStoreCode(label: string): boolean {
  const t = label.trim();
  if (!t) return false;
  if (/^[A-Z0-9]+(\.[A-Z0-9]+)+$/.test(t)) return true;
  return /lojawepink|wepink\.|wpink\./i.test(t) && t.includes(".");
}

/**
 * Nome amigável para o chat: fantasia/cadastro humano.
 * Se só houver código ERP, deriva o segmento central (CENTRO → Centro) — sem inventar cidade/shopping.
 */
export function friendlyStoreLabel(s: {
  tradeName?: string;
  name?: string;
  code?: string;
  id: string;
}): string {
  const candidates = [s.tradeName, s.name]
    .map((x) => (x || "").trim())
    .filter(Boolean);
  const human = candidates.find((c) => !isTechnicalStoreCode(c) && !/^filial$/i.test(c));
  if (human) return human;
  const tech = candidates.find((c) => isTechnicalStoreCode(c));
  if (tech) {
    const parts = tech.split(".").map((p) => p.trim()).filter(Boolean);
    const core =
      parts.find((p) => !/^loja/i.test(p) && !/wepink|wpink/i.test(p)) ?? parts[1] ?? parts[0];
    if (core) {
      const titled = core
        .toLowerCase()
        .split(/[_\s]+/)
        .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(" ");
      return titled;
    }
  }
  return candidates[0] || s.code || s.id;
}

export function scopeLabel(stores: JarvisStoreRef[], all: JarvisStoreRef[]): string {
  if (stores.length === 0) return "rede";
  if (stores.length === all.length && all.length > 1) return "rede";
  if (stores.length === 1) return friendlyStoreLabel(stores[0]!);
  return `${stores.length} filiais`;
}
