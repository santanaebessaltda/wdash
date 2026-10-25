import { endOfMonth } from "@/lib/format";
import { goals as fixtureGoals } from "./goals";
import { resolveBranchSellerId } from "./engine/branchUser";
import { goalFromRow, teamMemberFromRow, type GoalRow, type GoalTeamRow } from "./engine/goalRows";
import type { GoalRecord, GoalTeamMember } from "./engine/goalTypes";

export type { GoalGroup, GoalRecord, GoalTeamMember } from "./engine/goalTypes";

/** Demo sem Supabase: metas fixture (lojas f1/f2), so a meta principal de cada mes. */
function fixtureRecords(): GoalRecord[] {
  return fixtureGoals
    .filter((g) => g.brands.length !== 1)
    .map((g) => ({
      id: g.id,
      storeId: g.storeId,
      name: g.name,
      startsOn: `${g.competence}-01`,
      endsOn: endOfMonth(`${g.competence}-01`),
      target: g.storeAmount,
      tierMode: g.kind === "individual" ? "INDIVIDUAL" : "GROUP",
      tiers: g.tiers,
      groups: [],
      published: true,
    }));
}

const COLS = "id, store_id, name, starts_on, ends_on, target_cents, tier_mode, tiers, groups, spread_unidentified, published_at";
const COLS_WITHOUT_SPREAD = "id, store_id, name, starts_on, ends_on, target_cents, tier_mode, tiers, groups, published_at";
const COLS_LEGACY = "id, store_id, name, starts_on, ends_on, target_cents, tier_mode, tiers, groups, spread_unidentified";

export type GoalInput = Omit<GoalRecord, "id">;

/** Cria (sem id) ou atualiza a meta. `overlap` = ja existe meta da loja com datas que se cruzam. */
export async function saveGoal(
  tenantId: string,
  id: string | null,
  g: GoalInput,
): Promise<{ ok: true; id: string } | { ok: false; reason: "overlap" | "error" }> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: true, id: id ?? "demo" };
  const row = {
    store_id: g.storeId,
    name: g.name.trim(),
    starts_on: g.startsOn,
    ends_on: g.endsOn,
    target_cents: Math.round(g.target * 100),
    tier_mode: g.tierMode,
    spread_unidentified: g.spreadUnidentified === true,
    tiers: g.tiers.map((t) => ({
      name: t.name,
      minPct: t.minAttainmentPct,
      commissionPct: t.commissionPct,
      bonusCents: Math.round(t.bonus * 100),
      ...(t.managerPct != null
        ? { managerCommissionPct: t.managerPct, managerBonusCents: Math.round((t.managerBonus ?? 0) * 100) }
        : {}),
    })),
    groups: g.groups.map((x) => ({ shiftId: x.shiftId, name: x.name, pct: x.pct })),
  };
  const publishedAt =
    !id
      ? g.published === false
        ? null
        : new Date().toISOString()
      : g.published === true
        ? new Date().toISOString()
        : g.published === false
          ? null
          : undefined;
  const res = id
    ? await sb
        .from("goal")
        .update({ ...row, updated_at: new Date().toISOString(), ...(publishedAt !== undefined ? { published_at: publishedAt } : {}) })
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select("id")
        .single()
    : await sb
        .from("goal")
        .insert({ ...row, tenant_id: tenantId, published_at: publishedAt ?? null })
        .select("id")
        .single();
  if (res.error) {
    console.warn("saveGoal:", res.error.message);
    return { ok: false, reason: res.error.code === "23P01" ? "overlap" : "error" };
  }
  return { ok: true, id: (res.data as { id: string }).id };
}

/** Metas das lojas com periodo que cruza [from, to]; mais recentes primeiro. */
export async function fetchGoals(q: { tenantId: string; storeIds: string[]; from: string; to: string; includeDrafts?: boolean }): Promise<GoalRecord[]> {
  if (q.storeIds.length === 0) return [];
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) {
    return fixtureRecords()
      .filter((g) => q.storeIds.includes(g.storeId) && g.startsOn <= q.to && g.endsOn >= q.from && (q.includeDrafts || g.published !== false))
      .sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  }
  const run = (cols: string, drafts: boolean) => {
    let query = sb
      .from("goal")
      .select(cols)
      .eq("tenant_id", q.tenantId)
      .in("store_id", q.storeIds)
      .lte("starts_on", q.to)
      .gte("ends_on", q.from)
      .order("starts_on", { ascending: false });
    if (!drafts) query = query.not("published_at", "is", null);
    return query;
  };
  let { data, error } = await run(COLS, q.includeDrafts === true);
  if (error?.code === "42703") ({ data, error } = await run(COLS_WITHOUT_SPREAD, q.includeDrafts === true));
  if (error?.code === "42703") ({ data, error } = await run(COLS_LEGACY, true));
  if (error) {
    console.warn("fetchGoals:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as GoalRow[]).map(goalFromRow);
}

export async function fetchGoal(tenantId: string, id: string): Promise<GoalRecord | null> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return fixtureRecords().find((g) => g.id === id) ?? null;
  let { data, error } = await sb.from("goal").select(COLS).eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error?.code === "42703") ({ data, error } = await sb.from("goal").select(COLS_WITHOUT_SPREAD).eq("tenant_id", tenantId).eq("id", id).maybeSingle());
  if (error?.code === "42703") ({ data, error } = await sb.from("goal").select(COLS_LEGACY).eq("tenant_id", tenantId).eq("id", id).maybeSingle());
  if (error) {
    console.warn("fetchGoal:", error.message);
    return null;
  }
  return data ? goalFromRow(data as GoalRow) : null;
}

export async function deleteGoal(tenantId: string, id: string): Promise<{ ok: boolean }> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: true };
  const { error } = await sb.from("goal").delete().eq("tenant_id", tenantId).eq("id", id);
  if (error) {
    console.warn("deleteGoal:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

/** Funcionarios das lojas (store_seller) com turno  -  elegibilidade da meta e nome/turno na escada. */
export async function fetchGoalTeam(tenantId: string, storeIds: string[]): Promise<GoalTeamMember[]> {
  if (storeIds.length === 0) return [];
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return [];
  const withTenure =
    "id, store_id, code, millennium_employee_id, millennium_gerador_id, name, name_keys, active, erp_role, admitted_on, departed_on, shift_id, store_shift(name)";
  const withoutTenure =
    "id, store_id, code, millennium_employee_id, millennium_gerador_id, name, name_keys, active, erp_role, shift_id, store_shift(name)";
  let { data, error } = await sb.from("store_seller").select(withTenure).eq("tenant_id", tenantId).in("store_id", storeIds).limit(2000);
  if (error) {
    const again = await sb.from("store_seller").select(withoutTenure).eq("tenant_id", tenantId).in("store_id", storeIds).limit(2000);
    data = again.data as typeof data;
    error = again.error;
  }
  if (error) {
    console.warn("fetchGoalTeam:", error.message);
    return [];
  }
  const rows = (data ?? []) as unknown as (GoalTeamRow & { id: string; code: string | null })[];
  const members = rows.map(teamMemberFromRow);
  return markBranchUsers(sb, tenantId, storeIds, rows, members);
}

async function markBranchUsers(
  sb: NonNullable<Awaited<ReturnType<typeof import("@/lib/supabase").getSupabase>>>,
  tenantId: string,
  storeIds: string[],
  rows: { id: string; store_id: string; code: string | null }[],
  members: GoalTeamMember[],
): Promise<GoalTeamMember[]> {
  const full = "id, code, millennium_store_id, branch_user_chosen, branch_user_seller_id";
  const plain = "id, code, millennium_store_id";
  const first = await sb.from("store").select(full).eq("tenant_id", tenantId).in("id", storeIds);
  const loaded = first.error?.code === "42703" ? await sb.from("store").select(plain).eq("tenant_id", tenantId).in("id", storeIds) : first;
  if (loaded.error || !loaded.data) return members;
  const stores = loaded.data as unknown as {
    id: string;
    code: string | null;
    millennium_store_id: number;
    branch_user_chosen?: boolean | null;
    branch_user_seller_id?: string | null;
  }[];
  const sellers = rows.map((r) => ({ id: r.id, code: r.code, storeId: r.store_id }));
  const branchId = new Map<string, string | null>();
  for (const store of stores) {
    branchId.set(
      store.id,
      resolveBranchSellerId({
        sellers,
        storeId: store.id,
        branchCode: store.code || String(store.millennium_store_id),
        millenniumBranch: Number(store.millennium_store_id),
      }),
    );
  }
  return members.map((member, i) => {
    const row = rows[i];
    if (!row || branchId.get(row.store_id) !== row.id) return member;
    return { ...member, branchUser: true, salesPerson: false };
  });
}
