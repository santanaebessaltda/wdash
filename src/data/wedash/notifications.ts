import { getSupabase } from "@/lib/supabase";

/** Aviso do sino (novidade da WDash), publicado pela equipe WDash na tabela `announcement`. */
export type Announcement = { id: string; at: Date; title: string; body: string | null; link: string | null };

type AnnouncementRow = { id: string; title: string; body: string | null; link: string | null; published_at: string };

/** Ultimos avisos publicados para o papel da pessoa (`roles` null = todos). */
export async function fetchAnnouncements(role: string, limit = 20): Promise<Announcement[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("announcement")
    .select("id, title, body, link, published_at")
    .or(`roles.is.null,roles.cs.{${role}`)
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("fetchAnnouncements:", error.message);
    return [];
  }
  return ((data ?? []) as AnnouncementRow[]).map((r) => ({
    id: r.id,
    at: new Date(r.published_at),
    title: r.title,
    body: r.body,
    link: r.link,
  }));
}

/** Avisos lidos / limpos da pessoa nesta empresa (iguais em qualquer aparelho). */
export type NotificationState = { readBefore: number; clearedBefore: number; readIds: string[] };

type NotificationStateRow = { readBefore: string | null; clearedBefore: string | null; readIds: string[] | null };

function parseState(row: unknown): NotificationState | null {
  if (!row || typeof row !== "object") return null;
  const r = row as NotificationStateRow;
  return {
    readBefore: r.readBefore ? new Date(r.readBefore).getTime() : 0,
    clearedBefore: r.clearedBefore ? new Date(r.clearedBefore).getTime() : 0,
    readIds: Array.isArray(r.readIds) ? r.readIds.map(String) : [],
  };
}

async function callState(fn: string, args: Record<string, unknown>): Promise<NotificationState | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    console.warn(`${fn}:`, error.message);
    return null;
  }
  return parseState(data);
}

const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);

/**
 * Estado salvo no banco. No 1 uso comeca com o que este aparelho ja tinha (`seed`);
 * sem nada, tudo que ja foi publicado conta como lido. `null` = sem banco (demo) ou falha.
 */
export function fetchNotificationState(
  tenantId: string,
  seed: { readBefore: number | null; clearedBefore: number | null; readIds: string[] | null },
) {
  return callState("notification_state", {
    p_tenant: tenantId,
    p_read_before: iso(seed.readBefore),
    p_cleared_before: iso(seed.clearedBefore),
    p_read_ids: seed.readIds,
  });
}

export function markNotificationRead(tenantId: string, id: string, keep: string[]) {
  return callState("notification_mark_read", { p_tenant: tenantId, p_id: id, p_keep: keep });
}

export function markAllNotificationsRead(tenantId: string, until: number, clear = false) {
  return callState("notification_mark_all_read", { p_tenant: tenantId, p_until: iso(until), p_clear: clear });
}
