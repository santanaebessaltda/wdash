/**
 * Texto do push da rodada automática e o envio Web Push.
 * O valor é a diferença do faturamento de hoje (marca ALL) desde a rodada anterior.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { localClock } from "./autoRefresh.ts";

const BODY_LIMIT = 180;

export type SalesPushStore = { id: string; name: string; timezone: string };

function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** `null` quando não houve venda nova no intervalo. */
export function formatSalesPush(rows: Array<{ name: string; deltaCents: number }>): { title: string; body: string } | null {
  const sold = rows.filter((row) => row.deltaCents > 0).sort((a, b) => b.deltaCents - a.deltaCents || a.name.localeCompare(b.name, "pt-BR"));
  const total = sold.reduce((sum, row) => sum + row.deltaCents, 0);
  if (total <= 0) return null;
  const title = `Vendas · ${money(total)}`;
  let body = "Últimos 30 min";
  let shown = 0;
  for (const row of sold) {
    const line = `${row.name} · ${money(row.deltaCents)}`;
    const next = `${body}\n${line}`;
    if (next.length > BODY_LIMIT && shown > 0) break;
    if (next.length > BODY_LIMIT) break;
    body = next;
    shown += 1;
  }
  const rest = sold.length - shown;
  if (rest > 0) {
    const extra = `\ne mais ${rest} ${rest === 1 ? "loja" : "lojas"}`;
    if ((body + extra).length <= BODY_LIMIT + 24) body += extra;
  }
  return { title, body };
}

export function salesPushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export async function readTodayRevenue(sb: SupabaseClient, tenantId: string, stores: SalesPushStore[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const byDay = new Map<string, string[]>();
  const now = new Date();
  for (const store of stores) {
    const day = localClock(now, store.timezone || "America/Campo_Grande").day;
    byDay.set(day, [...(byDay.get(day) ?? []), store.id]);
    out.set(store.id, 0);
  }
  for (const [day, ids] of byDay) {
    const { data, error } = await sb
      .from("sales_day_agg")
      .select("store_id, revenue_cents")
      .eq("tenant_id", tenantId)
      .eq("day", day)
      .eq("brand", "ALL")
      .in("store_id", ids);
    if (error) throw error;
    for (const row of data ?? []) out.set(row.store_id as string, Number(row.revenue_cents) || 0);
  }
  return out;
}

type MemberRow = {
  id: string;
  membership_store: Array<{ store_id: string }> | null;
  identity: { auth_user_id: string } | { auth_user_id: string }[] | null;
};

function authUserId(identity: MemberRow["identity"]): string | null {
  if (!identity) return null;
  if (Array.isArray(identity)) return identity[0]?.auth_user_id ?? null;
  return identity.auth_user_id;
}

/** Avisa gestor e gerente com o app inscrito. Falha de um aparelho não interrompe a rodada. */
export async function notifyAutoSales(
  sb: SupabaseClient,
  args: { tenantId: string; stores: SalesPushStore[]; before: Map<string, number>; after: Map<string, number> },
): Promise<void> {
  if (!salesPushConfigured()) return;
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:wdash@wdash.app", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

  const { data: members, error: memberErr } = await sb
    .from("membership")
    .select("id, identity!inner(auth_user_id), membership_store(store_id)")
    .eq("tenant_id", args.tenantId)
    .eq("status", "ACTIVE")
    .in("role", ["OWNER", "MANAGER", "ADMIN_GLOBAL"]);
  if (memberErr) throw memberErr;

  const allowed = new Map<string, Set<string> | null>();
  for (const member of (members ?? []) as MemberRow[]) {
    const userId = authUserId(member.identity);
    if (!userId) continue;
    const links = member.membership_store ?? [];
    allowed.set(userId, links.length === 0 ? null : new Set(links.map((link) => link.store_id)));
  }
  const userIds = [...allowed.keys()];
  if (userIds.length === 0) return;

  const { data: subs, error: subErr } = await sb
    .from("push_subscription")
    .select("id, auth_user_id, endpoint, p256dh, auth")
    .eq("tenant_id", args.tenantId)
    .in("auth_user_id", userIds);
  if (subErr) throw subErr;

  for (const sub of subs ?? []) {
    const userId = sub.auth_user_id as string;
    const scope = allowed.get(userId);
    const rows = args.stores
      .filter((store) => scope == null || scope.has(store.id))
      .map((store) => ({
        name: store.name,
        deltaCents: (args.after.get(store.id) ?? 0) - (args.before.get(store.id) ?? 0),
      }));
    const text = formatSalesPush(rows);
    if (!text) continue;
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint as string, keys: { p256dh: sub.p256dh as string, auth: sub.auth as string } },
        JSON.stringify({ title: text.title, body: text.body, url: "/" }),
      );
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await sb.from("push_subscription").delete().eq("id", sub.id as string);
      } else {
        console.warn(`  AVISO push de vendas não foi enviado: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}
