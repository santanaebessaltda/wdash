/**
 * Texto do push da rodada automática e o envio Web Push.
 * Título = o que entrou no intervalo da pessoa (30 min ou 1 hora). O corpo traz o dia da rede e cada filial do acesso.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { localClock } from "./autoRefresh.ts";

export type SalesPushStore = { id: string; name: string; timezone: string };

function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export type SalesPushRow = { name: string; deltaCents: number; todayCents: number };

/** Intervalo do push de vendas. A rodada continua a cada 30 min. */
export type SalesEveryMin = 30 | 60;

/** Faturamento de hoje gravado na última vez que o aviso saiu. */
export type SalesBaseline = Record<string, { day: string; cents: number }>;

const SALES_SLOT_MS = 30 * 60_000;

export function salesEveryMin(value: unknown): SalesEveryMin {
  return value === 60 || value === "60" ? 60 : 30;
}

/** Início do bloco de 30 min em que a rodada cai. O relógio atrasado do sync não empurra a hora. */
export function salesRoundSlot(at: Date): number {
  return Math.floor(at.getTime() / SALES_SLOT_MS) * SALES_SLOT_MS;
}

/**
 * 30 min: toda rodada. 1 hora: dois blocos depois do último aviso.
 * Sem aviso anterior, manda nesta rodada.
 */
export function salesPushDue(every: SalesEveryMin, now: Date, lastNotifiedAt: Date | null): boolean {
  if (every === 30 || !lastNotifiedAt) return true;
  return salesRoundSlot(now) - salesRoundSlot(lastNotifiedAt) >= 60 * 60_000;
}

/**
 * 30 min: o que esta rodada acabou de gravar.
 * 1 hora, com base de hoje: o que entrou desde o último aviso (inclui a rodada que não mandou push).
 * Sem base de hoje: o que esta rodada gravou.
 */
export function salesPeriodDelta(args: {
  every: SalesEveryMin;
  storeId: string;
  day: string;
  todayCents: number;
  roundDelta: number;
  baseline: SalesBaseline;
}): number {
  if (args.every === 30) return args.roundDelta;
  const saved = args.baseline[args.storeId];
  if (!saved || saved.day !== args.day) return args.roundDelta;
  return args.todayCents - saved.cents;
}

export function parseSalesBaseline(raw: unknown): SalesBaseline {
  if (!raw || typeof raw !== "object") return {};
  const out: SalesBaseline = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const day = (value as { day?: unknown }).day;
    const cents = (value as { cents?: unknown }).cents;
    if (typeof day === "string" && typeof cents === "number" && Number.isFinite(cents)) out[id] = { day, cents };
  }
  return out;
}

function quietSalesTitle(every: SalesEveryMin): string {
  return every === 60 ? "Sem vendas na última hora" : "Sem vendas nos últimos 30 min";
}

/**
 * Resumo da rodada. `null` sem filial no acesso.
 * O nome da filial é o do Millennium, como está cadastrado.
 * Com venda: título "Vendas · +R$ …". Uma filial: "NOME · R$ … hoje".
 * Várias: "Hoje · R$ …" e uma linha por filial ("NOME · +R$ … · R$ …"), da que mais vendeu no dia para a que menos vendeu.
 * Sem venda nova: "Sem vendas nos últimos 30 min" ou "Sem vendas na última hora", e a posição do dia.
 */
export function formatSalesPush(rows: SalesPushRow[], every: SalesEveryMin = 30): { title: string; body: string } | null {
  if (rows.length === 0) return null;
  const labeled = rows.map((row) => ({
    ...row,
    deltaCents: Math.max(0, row.deltaCents),
    label: row.name.trim(),
  }));
  const deltaTotal = labeled.reduce((sum, row) => sum + row.deltaCents, 0);
  const todayTotal = labeled.reduce((sum, row) => sum + row.todayCents, 0);
  const quiet = deltaTotal === 0;
  const byToday = (a: (typeof labeled)[number], b: (typeof labeled)[number]) =>
    b.todayCents - a.todayCents || a.label.localeCompare(b.label, "pt-BR");

  if (labeled.length === 1) {
    const only = labeled[0]!;
    return {
      title: quiet ? quietSalesTitle(every) : `Vendas · +${money(deltaTotal)}`,
      body: `${only.label} · ${money(only.todayCents)} hoje`,
    };
  }

  const ordered = [...labeled].sort(byToday);
  if (quiet) {
    const lines = ordered.map((row) => `${row.label} · ${money(row.todayCents)}`);
    return { title: quietSalesTitle(every), body: [`Hoje · ${money(todayTotal)}`, ...lines].join("\n") };
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

type SalesPushCandidate = { id: string; name: string; timezone: string; todayCents: number; roundDelta: number };

/** Lojas ativas fora desta rodada, com o faturamento de hoje já gravado. */
async function loadOtherStoresToday(
  sb: SupabaseClient,
  tenantId: string,
  known: SalesPushStore[],
): Promise<SalesPushCandidate[]> {
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
    timezone: (row.timezone as string) || "America/Campo_Grande",
    todayCents: revenue.get(row.id as string) ?? 0,
    roundDelta: 0,
  }));
}

type SalesCadence = { every: Map<string, SalesEveryMin>; state: Map<string, { notifiedAt: Date; baseline: SalesBaseline }>; ready: boolean };

/** Intervalo e a base do último aviso. Se a coluna ou a tabela ainda não existem, segue o de 30 min. */
async function loadSalesCadence(sb: SupabaseClient, tenantId: string, userIds: string[]): Promise<SalesCadence> {
  const every = new Map<string, SalesEveryMin>();
  const state = new Map<string, { notifiedAt: Date; baseline: SalesBaseline }>();
  if (userIds.length === 0) return { every, state, ready: true };
  const [{ data: prefs, error: prefErr }, { data: marks, error: markErr }] = await Promise.all([
    sb.from("notification_pref").select("auth_user_id, sales_every_min").eq("tenant_id", tenantId).in("auth_user_id", userIds),
    sb.from("sales_push_state").select("auth_user_id, notified_at, baseline").eq("tenant_id", tenantId).in("auth_user_id", userIds),
  ]);
  if (prefErr || markErr) {
    console.warn(`  AVISO intervalo do push de vendas indisponível: ${prefErr?.message ?? markErr?.message}`);
    return { every, state, ready: false };
  }
  for (const row of prefs ?? []) every.set(row.auth_user_id as string, salesEveryMin(row.sales_every_min));
  for (const row of marks ?? []) {
    const at = new Date(row.notified_at as string);
    if (Number.isNaN(at.getTime())) continue;
    state.set(row.auth_user_id as string, { notifiedAt: at, baseline: parseSalesBaseline(row.baseline) });
  }
  return { every, state, ready: true };
}

function pushRows(candidates: SalesPushCandidate[], every: SalesEveryMin, now: Date, baseline: SalesBaseline): SalesPushRow[] {
  return candidates.map((store) => {
    const day = localClock(now, store.timezone || "America/Campo_Grande").day;
    return {
      name: store.name,
      todayCents: store.todayCents,
      deltaCents: salesPeriodDelta({
        every,
        storeId: store.id,
        day,
        todayCents: store.todayCents,
        roundDelta: store.roundDelta,
        baseline,
      }),
    };
  });
}

function nextBaseline(candidates: SalesPushCandidate[], now: Date): SalesBaseline {
  const out: SalesBaseline = {};
  for (const store of candidates) {
    out[store.id] = { day: localClock(now, store.timezone || "America/Campo_Grande").day, cents: store.todayCents };
  }
  return out;
}

/** Avisa gestor e gerente com o app inscrito. Falha de um aparelho não interrompe a rodada. */
export async function notifyAutoSales(
  sb: SupabaseClient,
  args: { tenantId: string; stores: SalesPushStore[]; before: Map<string, number>; after: Map<string, number>; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  const audience = await loadAudience(sb, args.tenantId);
  if (!audience) return;
  if (audience.subs.length === 0) {
    console.warn("  AVISO push: nenhum aparelho inscrito");
    return;
  }
  let others: SalesPushCandidate[] = [];
  try {
    others = await loadOtherStoresToday(sb, args.tenantId, args.stores);
  } catch (e) {
    console.warn(`  AVISO total de hoje das outras lojas não entrou no push: ${e instanceof Error ? e.message : String(e)}`);
  }
  const userIds = [...new Set(audience.subs.map((sub) => sub.auth_user_id))];
  const cadence = await loadSalesCadence(sb, args.tenantId, userIds);
  const pending: Array<{ userId: string; baseline: SalesBaseline }> = [];
  const seen = new Set<string>();
  for (const sub of audience.subs) {
    const userId = sub.auth_user_id;
    if (seen.has(userId)) continue;
    seen.add(userId);
    if (!wants(audience, userId, "sales")) continue;
    const every = cadence.ready ? (cadence.every.get(userId) ?? 30) : 30;
    const mark = cadence.state.get(userId);
    if (cadence.ready && !salesPushDue(every, now, mark?.notifiedAt ?? null)) continue;
    const scope = audience.allowed.get(userId);
    const inScope = (id: string) => scope == null || scope.has(id);
    const candidates: SalesPushCandidate[] = [
      ...args.stores.filter((store) => inScope(store.id)).map((store) => ({
        id: store.id,
        name: store.name,
        timezone: store.timezone,
        todayCents: args.after.get(store.id) ?? 0,
        roundDelta: (args.after.get(store.id) ?? 0) - (args.before.get(store.id) ?? 0),
      })),
      ...others.filter((store) => inScope(store.id)),
    ];
    if (candidates.length === 0) continue;
    const text = formatSalesPush(pushRows(candidates, every, now, mark?.baseline ?? {}), every);
    if (!text) continue;
    await deliver(sb, audience, userId, text, "/", "wdash-sales");
    pending.push({ userId, baseline: nextBaseline(candidates, now) });
  }
  if (pending.length === 0) return;
  const { error } = await sb.from("sales_push_state").upsert(
    pending.map((row) => ({
      auth_user_id: row.userId,
      tenant_id: args.tenantId,
      notified_at: now.toISOString(),
      baseline: row.baseline,
    })),
    { onConflict: "auth_user_id,tenant_id" },
  );
  if (error) console.warn(`  AVISO base do push de vendas não foi salva: ${error.message}`);
}
