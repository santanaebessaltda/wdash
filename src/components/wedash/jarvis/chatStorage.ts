/**
 * Histórico do Chat IA.
 * localStorage (não sessionStorage): sobrevive a F5 e não compete com o cache
 * enorme do Dashboard em sessionStorage (quota → setItem falha em silêncio → “conversa sumiu”).
 */

export type JarvisMessageLink = { label: string; to: string };
export type JarvisMessage = {
  from: "user" | "jarvis";
  text: string;
  link?: JarvisMessageLink | null;
  retryOf?: string | null;
};

export const CHAT_HISTORY_LEGACY_SESSION_KEY = "wedash.jarvis.chat";
export const CHAT_HISTORY_KEY_PREFIX = "wedash.jarvis.chat.v1:";
export const CHAT_PANEL_OPEN_KEY = "wedash.jarvis.panelOpen.v1";
export const CHAT_HISTORY_MAX = 80;

const memory = new Map<string, string>();

function chatKey(tenantId: string, membershipId: string): string {
  return `${CHAT_HISTORY_KEY_PREFIX}${tenantId}:${membershipId}`;
}

function storageGet(key: string): string | null {
  try {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem(key);
      if (v != null) return v;
    }
  } catch {
    /* private mode */
  }
  try {
    if (typeof sessionStorage !== "undefined") {
      const v = sessionStorage.getItem(key);
      if (v != null) return v;
    }
  } catch {
    /* ignore */
  }
  return memory.get(key) ?? null;
}

function storageSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
      memory.set(key, value);
      return;
    }
  } catch {
    /* quota / private — tenta session como fallback curto */
  }
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(key, value);
      memory.set(key, value);
      return;
    }
  } catch {
    /* ignore */
  }
  memory.set(key, value);
}

function storageRemove(key: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  memory.delete(key);
}

function normalizeMessages(parsed: unknown): JarvisMessage[] {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (m): m is JarvisMessage =>
        Boolean(m) &&
        typeof m === "object" &&
        ((m as JarvisMessage).from === "user" || (m as JarvisMessage).from === "jarvis") &&
        typeof (m as JarvisMessage).text === "string" &&
        (m as JarvisMessage).text.trim().length > 0,
    )
    .map((m) => ({
      from: m.from,
      text: m.text,
      link:
        m.link &&
        typeof m.link === "object" &&
        typeof m.link.label === "string" &&
        typeof m.link.to === "string"
          ? { label: m.link.label, to: m.link.to }
          : null,
      retryOf: typeof m.retryOf === "string" ? m.retryOf : null,
    }))
    .slice(-CHAT_HISTORY_MAX);
}

/** Migra chave antiga (sessionStorage sem escopo) para a chave local com tenant. */
function migrateLegacy(tenantId: string, membershipId: string): JarvisMessage[] {
  let raw: string | null = null;
  try {
    if (typeof sessionStorage !== "undefined") {
      raw = sessionStorage.getItem(CHAT_HISTORY_LEGACY_SESSION_KEY);
    }
  } catch {
    /* ignore */
  }
  if (!raw) {
    try {
      if (typeof localStorage !== "undefined") {
        raw = localStorage.getItem(CHAT_HISTORY_LEGACY_SESSION_KEY);
      }
    } catch {
      /* ignore */
    }
  }
  if (!raw) return [];
  try {
    const msgs = normalizeMessages(JSON.parse(raw) as unknown);
    if (msgs.length) {
      persistChatHistory(tenantId, membershipId, msgs);
    }
    try {
      sessionStorage.removeItem(CHAT_HISTORY_LEGACY_SESSION_KEY);
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem(CHAT_HISTORY_LEGACY_SESSION_KEY);
    } catch {
      /* ignore */
    }
    return msgs;
  } catch {
    return [];
  }
}

export function loadChatHistory(tenantId: string, membershipId: string): JarvisMessage[] {
  if (!tenantId || !membershipId) return [];
  const key = chatKey(tenantId, membershipId);
  try {
    const raw = storageGet(key);
    if (raw) {
      const msgs = normalizeMessages(JSON.parse(raw) as unknown);
      if (msgs.length) return msgs;
    }
  } catch {
    /* parse quebrado — não apaga disco aqui */
  }
  return migrateLegacy(tenantId, membershipId);
}

/**
 * Grava o histórico. Array vazio NÃO apaga o disco (evita corrida de reidratação
 * sobrescrever a conversa). Use clearChatHistory para zerar de propósito.
 */
export function persistChatHistory(
  tenantId: string,
  membershipId: string,
  messages: JarvisMessage[],
): void {
  if (!tenantId || !membershipId) return;
  if (messages.length === 0) return;
  const key = chatKey(tenantId, membershipId);
  storageSet(key, JSON.stringify(messages.slice(-CHAT_HISTORY_MAX)));
}

export function clearChatHistory(tenantId: string, membershipId: string): void {
  if (!tenantId || !membershipId) return;
  storageRemove(chatKey(tenantId, membershipId));
  try {
    sessionStorage.removeItem(CHAT_HISTORY_LEGACY_SESSION_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(CHAT_HISTORY_LEGACY_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function loadPanelOpen(tenantId: string, membershipId: string): boolean {
  if (!tenantId || !membershipId) return false;
  try {
    const raw = storageGet(`${CHAT_PANEL_OPEN_KEY}:${tenantId}:${membershipId}`);
    return raw === "1";
  } catch {
    return false;
  }
}

export function persistPanelOpen(tenantId: string, membershipId: string, open: boolean): void {
  if (!tenantId || !membershipId) return;
  const key = `${CHAT_PANEL_OPEN_KEY}:${tenantId}:${membershipId}`;
  if (open) storageSet(key, "1");
  else storageRemove(key);
}
