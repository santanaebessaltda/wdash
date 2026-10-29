const KEY_PREFIX = "wedash.jarvis.chat.";
/** Limite para não estourar localStorage. */
const MAX_MESSAGES = 80;

export type StoredChatMessage = { from: "user" | "jarvis"; text: string };

export function chatHistoryKey(tenantId: string, membershipId: string): string {
  return `${KEY_PREFIX}${tenantId}.${membershipId}`;
}

function isMessage(raw: unknown): raw is StoredChatMessage {
  if (!raw || typeof raw !== "object") return false;
  const m = raw as Record<string, unknown>;
  return (m.from === "user" || m.from === "jarvis") && typeof m.text === "string" && m.text.length > 0;
}

/** Carrega o histórico do aparelho (vazio se não houver / corrompido). */
export function loadChatMessages(tenantId: string, membershipId: string): StoredChatMessage[] {
  try {
    const raw = localStorage.getItem(chatHistoryKey(tenantId, membershipId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { messages?: unknown }).messages)
        ? (parsed as { messages: unknown[] }).messages
        : [];
    return list.filter(isMessage).slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

export function saveChatMessages(
  tenantId: string,
  membershipId: string,
  messages: StoredChatMessage[],
): void {
  try {
    const trimmed = messages.slice(-MAX_MESSAGES);
    localStorage.setItem(
      chatHistoryKey(tenantId, membershipId),
      JSON.stringify({ v: 1, messages: trimmed, updatedAt: Date.now() }),
    );
  } catch {
    /* private mode / quota */
  }
}

export function clearChatMessages(tenantId: string, membershipId: string): void {
  try {
    localStorage.removeItem(chatHistoryKey(tenantId, membershipId));
  } catch {
    /* ignore */
  }
}
