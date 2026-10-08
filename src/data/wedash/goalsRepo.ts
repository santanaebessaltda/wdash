import { fimDoMes } from "@/lib/format";
import { goals as fixtureGoals } from "./goals";
import { goalFromRow, teamMemberFromRow, type GoalRow, type GoalTeamRow } from "./engine/goalRows";
import type { GoalRecord, GoalTeamMember } from "./engine/goalTypes";

export type { GoalGroup, GoalRecord, GoalTeamMember } from "./engine/goalTypes";

/** Demo sem Supabase: metas fixture (lojas f1/f2), so a meta principal de cada mes. */
function fixtureRecords(): GoalRecord[] {
  return fixtureGoals
    .filter((g) => g.marcas.length !== 1)
    .map((g) => ({
      id: g.id,
      storeId: g.filialId,
      name: g.nome,
      startsOn: `${g.competencia}-01`,
      endsOn: fimDoMes(`${g.competencia}-01`),
      target: g.valorLoja,
      tierMode: g.tipo === "individual" ? "INDIVIDUAL" : "GROUP",
      tiers: g.degraus,
      groups: [],
    }));
}

const COLS = "id, store_id, name, starts_on, ends_on, target_cents, tier_mode, tiers, groups";

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
    tiers: g.tiers.map((t) => ({
      name: t.nome,
      minPct: t.atingimentoMinPct,
      commissionPct: t.comissaoPct,
      bonusCents: Math.round(t.bonus * 100),
      ...(t.gerenciaPct != null
        ? { managerCommissionPct: t.gerenciaPct, managerBonusCents: Math.round((t.gerenciaBonus ?? 0) * 100) }
        : {}),
    })),
    groups: g.groups.map((x) => ({ shiftId: x.shiftId, name: x.name, pct: x.pct })),
  };
  const res = id
    ? await sb
        .from("goal")
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select("id")
        .single()
    : await sb
        .from("goal")
        .insert({ ...row, tenant_id: tenantId })
        .select("id")
        .single();
  if (res.error) {
    console.warn("saveGoal:", res.error.message);
    return { ok: false, reason: res.error.code === "23P01" ? "overlap" : "error" };
  }
  return { ok: true, id: (res.data as { id: string }).id };
}

/** Metas das lojas com periodo que cruza [from, to]; mais recentes primeiro. */
export async function fetchGoals(q: { tenantId: string; storeIds: string[]; from: string; to: string }): Promise<GoalRecord[]> {
  if (q.storeIds.length === 0) return [];
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) {
    return fixtureRecords()
      .filter((g) => q.storeIds.includes(g.storeId) && g.startsOn <= q.to && g.endsOn >= q.from)
      .sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  }
  const { data, error } = await sb
    .from("goal")
    .select(COLS)
    .eq("tenant_id", q.tenantId)
    .in("store_id", q.storeIds)
    .lte("starts_on", q.to)
    .gte("ends_on", q.from)
    .order("starts_on", { ascending: false });
  if (error) {
    console.warn("fetchGoals:", error.message);
    return [];
  }
  return ((data ?? []) as GoalRow[]).map(goalFromRow);
}

export async function fetchGoal(tenantId: string, id: string): Promise<GoalRecord | null> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return fixtureRecords().find((g) => g.id === id) ?? null;
  const { data, error } = await sb.from("goal").select(COLS).eq("tenant_id", tenantId).eq("id", id).maybeSingle();
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
  const { data, error } = await sb
    .from("store_seller")
    .select(
      "store_id, millennium_employee_id, millennium_gerador_id, name, name_keys, active, erp_role, shift_id, store_shift(name)",
    )
    .eq("tenant_id", tenantId)
    .in("store_id", storeIds)
    .limit(2000);
  if (error) {
    console.warn("fetchGoalTeam:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as GoalTeamRow[]).map(teamMemberFromRow);
}
