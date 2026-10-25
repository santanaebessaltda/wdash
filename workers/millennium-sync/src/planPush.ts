/**
 * Avisos de meta e desafio gravados na hora do publicar. O worker entrega no próximo ciclo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { salesPushConfigured } from "./salesPush.ts";

type OutboxRow = {
  id: string;
  tenant_id: string;
  store_id: string;
  title: string;
  body: string;
  url: string;
  exclude_auth_user_id: string | null;
};

type MemberRow = {
  role: string;
  membership_store: Array<{ store_id: string }> | null;
  identity: { auth_user_id: string } | { auth_user_id: string }[] | null;
};

function authUserId(identity: MemberRow["identity"]): string | null {
  if (!identity) return null;
  if (Array.isArray(identity)) return identity[0]?.auth_user_id ?? null;
  return identity.auth_user_id;
}

async function deliverRow(sb: SupabaseClient, row: OutboxRow): Promise<void> {
  if (!salesPushConfigured()) return;
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:wdash@wdash.app", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

  const { data: members, error: memberErr } = await sb
    .from("membership")
    .select("role, identity!inner(auth_user_id), membership_store(store_id)")
    .eq("tenant_id", row.tenant_id)
    .eq("status", "ACTIVE")
    .in("role", ["OWNER", "MANAGER", "ADMIN_GLOBAL", "SELLER"]);
  if (memberErr) throw memberErr;

  const allowed = new Map<string, { role: string; stores: Set<string> | null }>();
  for (const member of (members ?? []) as MemberRow[]) {
    const userId = authUserId(member.identity);
    if (!userId || userId === row.exclude_auth_user_id) continue;
    const links = member.membership_store ?? [];
    const stores = links.length === 0 ? null : new Set(links.map((link) => link.store_id));
    if (stores && !stores.has(row.store_id)) continue;
    allowed.set(userId, { role: member.role, stores });
  }
  const userIds = [...allowed.keys()];
  if (userIds.length === 0) return;

  const [{ data: subs, error: subErr }, { data: prefs, error: prefErr }] = await Promise.all([
    sb.from("push_subscription").select("id, auth_user_id, endpoint, p256dh, auth").eq("tenant_id", row.tenant_id).in("auth_user_id", userIds),
    sb.from("notification_pref").select("auth_user_id, plan, seller_plan").eq("tenant_id", row.tenant_id).in("auth_user_id", userIds),
  ]);
  if (subErr) throw subErr;
  const prefByUser = new Map<string, { plan?: boolean; seller_plan?: boolean }>();
  if (!prefErr) {
    for (const pref of prefs ?? []) prefByUser.set(pref.auth_user_id as string, pref as { plan?: boolean; seller_plan?: boolean });
  }

  for (const sub of subs ?? []) {
    const userId = sub.auth_user_id as string;
    const who = allowed.get(userId);
    if (!who) continue;
    const pref = prefByUser.get(userId);
    const seller = who.role === "SELLER";
    if (seller ? pref?.seller_plan === false : pref?.plan === false) continue;
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint as string, keys: { p256dh: sub.p256dh as string, auth: sub.auth as string } },
        JSON.stringify({ title: row.title, body: row.body, url: row.url, tag: `plan-${row.id}` }),
        { TTL: 2 * 60 * 60, urgency: "high" },
      );
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await sb.from("push_subscription").delete().eq("id", sub.id);
      else console.warn(`  AVISO push de meta não foi enviado: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export async function drainPlanOutbox(sb: SupabaseClient): Promise<number> {
  const { data, error } = await sb
    .from("push_outbox")
    .select("id, tenant_id, store_id, title, body, url, exclude_auth_user_id")
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) {
    if (error.code === "42P01" || error.code === "42703") return 0;
    console.warn(`  AVISO fila de meta: ${error.message}`);
    return 0;
  }
  const rows = (data ?? []) as OutboxRow[];
  for (const row of rows) {
    try {
      await deliverRow(sb, row);
    } catch (e) {
      console.warn(`  AVISO fila de meta: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    await sb.from("push_outbox").update({ sent_at: new Date().toISOString() }).eq("id", row.id);
  }
  return rows.length;
}
