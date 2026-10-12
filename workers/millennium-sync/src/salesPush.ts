/**
 * Texto do push da rodada automática e o envio Web Push.
 * Título = o que entrou nos últimos 30 min. O corpo traz o dia da rede e cada filial do acesso.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { localClock } from "./autoRefresh.ts";

export type SalesPushStore = { id: string; name: string; timezone: string };

function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export type SalesPushRow = { name: string; deltaCents: number; todayCents: number };

/**
 * Resumo da rodada. `null` sem filial no acesso.
 * O nome da filial é o do Millennium, como está cadastrado.
 * Com venda: título "Vendas · +R$ …". Uma filial: "NOME · R$ … hoje".
 * Várias: "Hoje · R$ …" e uma linha por filial ("NOME · +R$ … · R$ …"), da que mais vendeu no intervalo para a que menos vendeu.
 * Sem venda nova: título "Sem vendas nos últimos 30 min" e a posição do dia.
 */
export function formatSalesPush(rows: SalesPushRow[]): { title: string; body: string } | null {
  if (rows.length === 0) return null;
  const labeled = rows.map((row) => ({
    ...row,
    deltaCents: Math.max(0, row.deltaCents),
    label: row.name.trim(),
  }));
  const deltaTotal = labeled.reduce((sum, row) => sum + row.deltaCents, 0);
  const todayTotal = labeled.reduce((sum, row) => sum + row.todayCents, 0);
  const quiet = deltaTotal === 0;
  const byRecent = (a: (typeof labeled)[number], b: (typeof labeled)[number]) =>
    b.deltaCents - a.deltaCents || b.todayCents - a.todayCents || a.label.localeCompare(b.label, "pt-BR");

  if (labeled.length === 1) {
    const only = labeled[0]!;
    return {
      title: quiet ? "Sem vendas nos últimos 30 min" : `Vendas · +${money(deltaTotal)}`,
      body: `${only.label} · ${money(only.todayCents)} hoje`,
    };
  }

  const ordered = [...labeled].sort(byRecent);
  if (quiet) {
    const lines = ordered.map((row) => `${row.label} · ${money(row.todayCents)}`);
    return { title: "Sem vendas nos últimos 30 min", body: [`Hoje · ${money(todayTotal)}`, ...lines].join("\n") };
  }
  const lines = ordered.map((row) => {
    const recent = row.deltaCents > 0 ? `+${money(row.deltaCents)}` : money(0);
    return `${row.label} · ${recent} · ${money(row.todayCents)}`;
  });
  return { title: `Vendas · +${money(deltaTotal)}`, body: [`Hoje · ${money(todayTotal)}`, ...lines].join("\n") };
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

type PushPrefs = { sales: boolean; cashClose: boolean; storeGoal: boolean; stock: boolean };

const PREF_DEFAULT: PushPrefs = { sales: true, cashClose: true, storeGoal: true, stock: true };

function prefsOf(row: Record<string, unknown> | undefined): PushPrefs {
  if (!row) return PREF_DEFAULT;
  return {
    sales: row.sales !== false,
    cashClose: row.cash_close !== false,
    storeGoal: row.store_goal !== false,
    stock: row.stock !== false,
  };
}

type Audience = {
  webpush: {
    sendNotification: (
      sub: { endpoint: string; keys: { p256dh: string; auth: string } },
      payload: string,
      options?: { TTL?: number; urgency?: "very-low" | "low" | "normal" | "high" },
    ) => Promise<unknown>;
  };
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
    sb.from("notification_pref").select("auth_user_id, sales, cash_close, store_goal, stock").eq("tenant_id", tenantId).in("auth_user_id", userIds),
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
  tag?: string,
): Promise<void> {
  for (const sub of audience.subs) {
    if (sub.auth_user_id !== userId) continue;
    try {
      await audience.webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title: text.title, body: text.body, url, ...(tag ? { tag } : {}) }),
        // high: o iPhone entrega na hora, com o app aberto ou fechado.
        { TTL: 2 * 60 * 60, urgency: "high" },
      );
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // Abrir o app pelo aviso invalida a inscrição no iPhone. Sem este aviso
        // a rodada seguinte parece que não rodou: a linha some e ninguém fica inscrito.
        console.warn("  AVISO push: inscrição do aparelho expirou e foi removida");
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
  if (audience.subs.length === 0) {
    console.warn("  AVISO push: nenhum aparelho inscrito");
    return;
  }
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
    const text = formatSalesPush(rows);
    if (!text || !wants(audience, userId, "sales")) continue;
    await deliver(sb, audience, userId, text, "/", "wdash-sales");
  }
}
