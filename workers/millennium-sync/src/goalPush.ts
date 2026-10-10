/**
 * Meta da loja: avisa uma vez quando o faturamento (marca ALL) cruza um nível.
 * A primeira leitura só grava o nível atual, para não avisar o que já estava cruzado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { localClock } from "./autoRefresh.ts";
import { notifyScoped, type SalesPushStore } from "./salesPush.ts";

const BODY_LIMIT = 180;

type Tier = { minPct: number; name: string };

export function goalLevel(pct: number, tiers: Tier[]): { level: number; name: string | null } {
  const ordered = [...tiers].sort((a, b) => a.minPct - b.minPct);
  let level = 0;
  let name: string | null = null;
  for (const [i, tier] of ordered.entries()) {
    if (pct < tier.minPct) break;
    level = i + 1;
    name = tier.name;
  }
  return { level, name };
}

export function formatStoreGoalPush(rows: Array<{ storeName: string; goalName: string; levelName: string }>): { title: string; body: string } | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) {
    const only = rows[0]!;
    return {
      title: `${only.storeName} chegou ao ${only.levelName} ✨`,
      body: `Novo nível da meta de ${only.goalName}.`,
    };
  }
  const title = `${rows.length} lojas avançaram de nível ✨`;
  let body = "";
  let shown = 0;
  for (const row of rows) {
    const line = `${row.storeName} · ${row.levelName}`;
    const next = body ? `${body}\n${line}` : line;
    if (next.length > BODY_LIMIT && shown > 0) break;
    if (next.length > BODY_LIMIT) break;
    body = next;
    shown += 1;
  }
  const rest = rows.length - shown;
  if (rest > 0) body += `\ne mais ${rest} ${rest === 1 ? "loja" : "lojas"}`;
  return { title, body };
}

function tiersOf(raw: unknown): Tier[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { minPct?: unknown; name?: unknown };
    const minPct = Number(row.minPct);
    const name = typeof row.name === "string" ? row.name : "";
    if (!Number.isFinite(minPct) || !name) return [];
    return [{ minPct, name }];
  });
}

export async function notifyStoreGoals(
  sb: SupabaseClient,
  args: { tenantId: string; stores: SalesPushStore[] },
): Promise<void> {
  if (args.stores.length === 0) return;
  const now = new Date();
  const todayOf = new Map(args.stores.map((store) => [store.id, localClock(now, store.timezone || "America/Campo_Grande").day]));
  const days = [...todayOf.values()];
  const minDay = days.reduce((a, b) => (a < b ? a : b));
  const maxDay = days.reduce((a, b) => (a > b ? a : b));

  const { data: goals, error: goalErr } = await sb
    .from("goal")
    .select("id, store_id, name, starts_on, ends_on, target_cents, tiers")
    .eq("tenant_id", args.tenantId)
    .in("store_id", args.stores.map((store) => store.id))
    .lte("starts_on", maxDay)
    .gte("ends_on", minDay);
  if (goalErr) throw goalErr;
  const active = (goals ?? []).filter((goal) => {
    const today = todayOf.get(goal.store_id as string);
    if (!today) return false;
    return String(goal.starts_on) <= today && String(goal.ends_on) >= today;
  });
  if (active.length === 0) return;

  const spanFrom = active.reduce((min, goal) => (String(goal.starts_on) < min ? String(goal.starts_on) : min), String(active[0]!.starts_on));
  const spanTo = active.reduce((max, goal) => (String(goal.ends_on) > max ? String(goal.ends_on) : max), String(active[0]!.ends_on));
  const { data: sales, error: salesErr } = await sb
    .from("sales_day_agg")
    .select("store_id, day, revenue_cents")
    .eq("tenant_id", args.tenantId)
    .eq("brand", "ALL")
    .in("store_id", [...new Set(active.map((goal) => goal.store_id as string))])
    .gte("day", spanFrom)
    .lte("day", spanTo);
  if (salesErr) throw salesErr;

  const { data: marks, error: markErr } = await sb
    .from("notification_mark")
    .select("subject, level")
    .eq("tenant_id", args.tenantId)
    .eq("kind", "store_goal")
    .in("subject", active.map((goal) => goal.id as string));
  if (markErr) throw markErr;
  const known = new Map((marks ?? []).map((mark) => [mark.subject as string, Number(mark.level) || 0]));

  const nameOf = new Map(args.stores.map((store) => [store.id, store.name]));
  const crossed: Array<{ storeId: string; storeName: string; goalName: string; levelName: string }> = [];
  for (const goal of active) {
    const storeId = goal.store_id as string;
    const target = Number(goal.target_cents) || 0;
    let realized = 0;
    for (const row of sales ?? []) {
      if (row.store_id !== storeId) continue;
      const day = String(row.day);
      if (day < String(goal.starts_on) || day > String(goal.ends_on)) continue;
      realized += Number(row.revenue_cents) || 0;
    }
    const pct = target > 0 ? (realized / target) * 100 : 0;
    const { level, name } = goalLevel(pct, tiersOf(goal.tiers));
    const previous = known.get(goal.id as string);
    if (previous == null) {
      const { error } = await sb.from("notification_mark").upsert(
        { tenant_id: args.tenantId, kind: "store_goal", subject: goal.id, level },
        { onConflict: "tenant_id,kind,subject" },
      );
      if (error) throw error;
      continue;
    }
    if (level <= previous || !name) continue;
    const { error } = await sb.from("notification_mark").upsert(
      { tenant_id: args.tenantId, kind: "store_goal", subject: goal.id, level },
      { onConflict: "tenant_id,kind,subject" },
    );
    if (error) throw error;
    crossed.push({ storeId, storeName: nameOf.get(storeId) || "Loja", goalName: String(goal.name), levelName: name });
  }
  if (crossed.length === 0) return;
  await notifyScoped(sb, {
    tenantId: args.tenantId,
    stores: args.stores,
    pref: "storeGoal",
    url: "/goals",
    text: (stores) => {
      const ids = new Set(stores.map((store) => store.id));
      return formatStoreGoalPush(crossed.filter((row) => ids.has(row.storeId)));
    },
  });
}
