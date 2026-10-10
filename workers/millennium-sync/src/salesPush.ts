/**
 * Texto do push da rodada automática e o envio Web Push.
 * O título é o que entrou nos últimos 30 min. O texto traz o acumulado de hoje
 * de todas as lojas do acesso (marca ALL), não só das que venderam nesse intervalo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { localClock } from "./autoRefresh.ts";

const BODY_LIMIT = 180;

export type SalesPushStore = { id: string; name: string; timezone: string };

function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatQuietSalesPush(): { title: string; body: string } {
  return { title: "Sem vendas nos últimos 30 min", body: "Nenhuma nova venda registrada no período." };
}

export type SalesPushRow = { name: string; deltaCents: number; todayCents: number };

function moreStores(count: number): string {
  return `e mais ${count} ${count === 1 ? "loja" : "lojas"}`;
}

/** Cabeçalho do dia e as lojas do intervalo, até caber. O que sobra vira "e mais N lojas". */
function fitStoreLines(header: string, storeLines: string[]): string {
  const kept: string[] = [];
  for (const line of storeLines) {
    const draft = [header, ...kept, line].join("\n");
    if (draft.length > BODY_LIMIT) break;
    kept.push(line);
  }
  let rest = storeLines.length - kept.length;
  if (rest === 0) return [header, ...kept].join("\n");
  while (kept.length > 0) {
    const draft = [header, ...kept, moreStores(rest)].join("\n");
    if (draft.length <= BODY_LIMIT) return draft;
    kept.pop();
    rest += 1;
  }
  return [header, moreStores(rest)].join("\n");
}

/** `null` quando não houve venda nova no intervalo. `rows` é o acesso inteiro, inclusive loja sem venda nova. */
export function formatSalesPush(rows: SalesPushRow[]): { title: string; body: string } | null {
  const sold = rows
    .filter((row) => row.deltaCents > 0)
    .sort((a, b) => b.deltaCents - a.deltaCents || a.name.localeCompare(b.name, "pt-BR"));
  const deltaTotal = sold.reduce((sum, row) => sum + row.deltaCents, 0);
  if (deltaTotal <= 0) return null;
  const todayTotal = rows.reduce((sum, row) => sum + row.todayCents, 0);
  const title = `${money(deltaTotal)} nos últimos 30 min`;
  if (rows.length === 1) {
    const only = rows[0]!;
    return { title, body: `${only.name} · ${money(only.todayCents)} hoje` };
  }
  if (sold.length === 1) {
    const only = sold[0]!;
    return { title, body: `${only.name} · ${money(only.deltaCents)}\nHoje nas suas lojas · ${money(todayTotal)}` };
  }
  const header = `Hoje nas suas lojas · ${money(todayTotal)}`;
  const storeLines = sold.map((row) => `${row.name} · ${money(row.deltaCents)}`);
  return { title, body: fitStoreLines(header, storeLines) };
}

export function salesPushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export async function readTodayRevenue(
  sb: SupabaseClient,
  tenantId: string,
  stores: Array<{ id: string; timezone: string }>,
): Promise<Map<string, number>> {
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

type PushPrefs = { sales: boolean; quiet: boolean; cashClose: boolean; storeGoal: boolean };

const PREF_DEFAULT: PushPrefs = { sales: true, quiet: false, cashClose: true, storeGoal: true };

function prefsOf(row: Record<string, unknown> | undefined): PushPrefs {
  if (!row) return PREF_DEFAULT;
  return {
    sales: row.sales !== false,
    quiet: row.quiet === true,
    cashClose: row.cash_close !== false,
    storeGoal: row.store_goal !== false,
  };
}

type Audience = {
  webpush: { sendNotification: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown> };
  allowed: Map<string, Set<string> | null>;
  prefs: Map<string, PushPrefs>;
  subs: Array<{ id: string; auth_user_id: string; endpoint: string; p256dh: string; auth: string }>;
};

async function loadAudience(sb: SupabaseClient, tenantId: string): Promise<Audience | null> {
  if (!salesPushConfigured()) return null;
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:wdash@wdash.app", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

  const { data: members, error: memberErr } = await sb
    .from("membership")
    .select("id, identity!inner(auth_user_id), membership_store(store_id)")
    .eq("tenant_id", tenantId)
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
  if (userIds.length === 0) return null;

  const [{ data: subs, error: subErr }, { data: prefRows, error: prefErr }] = await Promise.all([
    sb.from("push_subscription").select("id, auth_user_id, endpoint, p256dh, auth").eq("tenant_id", tenantId).in("auth_user_id", userIds),
    sb.from("notification_pref").select("auth_user_id, sales, quiet, cash_close, store_goal").eq("tenant_id", tenantId).in("auth_user_id", userIds),
  ]);
  if (subErr) throw subErr;
  if (prefErr) throw prefErr;

  const prefs = new Map<string, PushPrefs>();
  for (const row of prefRows ?? []) prefs.set(row.auth_user_id as string, prefsOf(row as Record<string, unknown>));

  return {
    webpush,
    allowed,
    prefs,
    subs: (subs ?? []) as Audience["subs"],
  };
}

async function deliver(
  sb: SupabaseClient,
  audience: Audience,
  userId: string,
  text: { title: string; body: string },
  url: string,
): Promise<void> {
  for (const sub of audience.subs) {
    if (sub.auth_user_id !== userId) continue;
    try {
      await audience.webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title: text.title, body: text.body, url }),
      );
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await sb.from("push_subscription").delete().eq("id", sub.id);
      } else {
        console.warn(`  AVISO push não foi enviado: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}

function wants(audience: Audience, userId: string, key: keyof PushPrefs): boolean {
  return (audience.prefs.get(userId) ?? PREF_DEFAULT)[key];
}

/** Um texto por pessoa, no escopo das lojas dela. Quem desligou o tipo não recebe. */
export async function notifyScoped(
  sb: SupabaseClient,
  args: {
    tenantId: string;
    stores: SalesPushStore[];
    pref: keyof PushPrefs;
    url: string;
    text: (stores: SalesPushStore[]) => { title: string; body: string } | null;
  },
): Promise<void> {
  const audience = await loadAudience(sb, args.tenantId);
  if (!audience) return;
  const seen = new Set<string>();
  for (const sub of audience.subs) {
    const userId = sub.auth_user_id;
    if (seen.has(userId) || !wants(audience, userId, args.pref)) continue;
    seen.add(userId);
    const scope = audience.allowed.get(userId);
    const stores = args.stores.filter((store) => scope == null || scope.has(store.id));
    const text = args.text(stores);
    if (!text) continue;
    await deliver(sb, audience, userId, text, args.url);
  }
}

function storeLabel(row: { trade_name?: string | null; name?: string | null; code?: string | null }): string {
  return String(row.trade_name ?? "").trim() || String(row.name ?? "").trim() || String(row.code ?? "").trim();
}

/** Lojas ativas fora desta rodada, com o faturamento de hoje já gravado. */
async function loadOtherStoresToday(
  sb: SupabaseClient,
  tenantId: string,
  known: SalesPushStore[],
): Promise<Array<{ id: string; name: string; todayCents: number }>> {
  const { data, error } = await sb.from("store").select("id, code, name, trade_name, timezone").eq("tenant_id", tenantId).eq("active", true);
  if (error) throw error;
  const seen = new Set(known.map((store) => store.id));
  const missing = (data ?? []).filter((row) => !seen.has(row.id as string));
  if (missing.length === 0) return [];
  const revenue = await readTodayRevenue(
    sb,
    tenantId,
    missing.map((row) => ({ id: row.id as string, timezone: (row.timezone as string) || "America/Campo_Grande" })),
  );
  return missing.map((row) => ({
    id: row.id as string,
    name: storeLabel(row as { trade_name?: string | null; name?: string | null; code?: string | null }),
    todayCents: revenue.get(row.id as string) ?? 0,
  }));
}

/** Avisa gestor e gerente com o app inscrito. Falha de um aparelho não interrompe a rodada. */
export async function notifyAutoSales(
  sb: SupabaseClient,
  args: { tenantId: string; stores: SalesPushStore[]; before: Map<string, number>; after: Map<string, number> },
): Promise<void> {
  const audience = await loadAudience(sb, args.tenantId);
  if (!audience) return;
  let others: Array<{ id: string; name: string; todayCents: number }> = [];
  try {
    others = await loadOtherStoresToday(sb, args.tenantId, args.stores);
  } catch (e) {
    console.warn(`  AVISO total de hoje das outras lojas não entrou no push: ${e instanceof Error ? e.message : String(e)}`);
  }
  const seen = new Set<string>();
  for (const sub of audience.subs) {
    const userId = sub.auth_user_id;
    if (seen.has(userId)) continue;
    seen.add(userId);
    const scope = audience.allowed.get(userId);
    const inScope = (id: string) => scope == null || scope.has(id);
    const rows: SalesPushRow[] = [
      ...args.stores.filter((store) => inScope(store.id)).map((store) => ({
        name: store.name,
        deltaCents: (args.after.get(store.id) ?? 0) - (args.before.get(store.id) ?? 0),
        todayCents: args.after.get(store.id) ?? 0,
      })),
      ...others.filter((store) => inScope(store.id)).map((store) => ({
        name: store.name,
        deltaCents: 0,
        todayCents: store.todayCents,
      })),
    ];
    if (rows.length === 0) continue;
    const sold = formatSalesPush(rows);
    if (sold && wants(audience, userId, "sales")) await deliver(sb, audience, userId, sold, "/");
    else if (!sold && wants(audience, userId, "quiet")) await deliver(sb, audience, userId, formatQuietSalesPush(), "/");
  }
}
