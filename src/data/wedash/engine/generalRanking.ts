import type { TeamDashboardView, TeamMemberRow } from "../dashboard";
import { collaboratorName, eachDay } from "./format";
import { goalStatus } from "./goalView";
import type { GoalRecord, GoalTeamMember, SalesDayAgg } from "./goalTypes";
import { presenceDays } from "./presence";

/**
 * Ranking da meta Geral: o total da filial no período, dividido entre quem estava na equipe de vendas naquele dia.
 * A venda sem vendedor, a do caixa e a da gerência entram no bolo. Quem não é da equipe fica de fora.
 */
export function rankingWithGeneralShare(
  view: TeamDashboardView,
  input: {
    goals: GoalRecord[];
    team: GoalTeamMember[];
    dayAggs: SalesDayAgg[];
    today: string;
    storeNames: Map<string, string>;
  },
): TeamDashboardView {
  const shares = shareRows(view, input);
  if (shares.length === 0) return view;
  const generalStores = new Set(shares.flatMap((row) => row.storeIds));
  const kept = view.people.filter((person) => person.storeIds.some((id) => !generalStores.has(id)));
  const seen = new Set(kept.map((person) => person.key));
  const people = [...kept, ...shares.filter((row) => !seen.has(row.key))];
  people.sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "pt-BR"));
  const total = people.reduce((sum, person) => sum + person.revenue, 0);
  return {
    ...view,
    people: people.map((person) => ({ ...person, participationPct: total > 0 ? (person.revenue / total) * 100 : 0 })),
  };
}

function shareRows(
  view: TeamDashboardView,
  input: {
    goals: GoalRecord[];
    team: GoalTeamMember[];
    dayAggs: SalesDayAgg[];
    today: string;
    storeNames: Map<string, string>;
  },
): TeamMemberRow[] {
  const period = view.period;
  const scopeIds = view.scope.storeIds.length > 0 ? view.scope.storeIds : [...new Set(input.goals.map((goal) => goal.storeId))];
  const byKey = new Map<string, TeamMemberRow>();
  for (const storeId of scopeIds) {
    const goal = generalGoal(input.goals, storeId, period.start, period.end, input.today);
    if (!goal) continue;
    const members = input.team.filter((member) => member.storeId === storeId && member.salesPerson && !member.branchUser);
    if (members.length === 0) continue;
    const from = period.start > goal.startsOn ? period.start : goal.startsOn;
    const goalEnd = period.end < goal.endsOn ? period.end : goal.endsOn;
    const to = goalEnd > input.today ? input.today : goalEnd;
    if (from > to) continue;
    const presence = new Map(
      members.map((member) => [
        member.employeeId,
        new Set(
          presenceDays(
            from,
            to,
            { admittedOn: member.admittedOn ?? null, departedOn: member.departedOn ?? null, active: member.salesPerson },
            null,
          ),
        ),
      ]),
    );
    const store = { revenue: 0, sales: 0, items: 0, missingItems: false };
    const share = new Map<number, { revenue: number; sales: number }>();
    for (const day of eachDay(from, to)) {
      const present = members.filter((member) => presence.get(member.employeeId)?.has(day));
      if (present.length === 0) continue;
      const bits = dayTotal(input.dayAggs, storeId, day);
      store.revenue += bits.revenue;
      store.sales += bits.sales;
      store.items += bits.items;
      if (bits.missingItems) store.missingItems = true;
      for (const member of present) {
        const current = share.get(member.employeeId) ?? { revenue: 0, sales: 0 };
        current.revenue += bits.revenue / present.length;
        current.sales += bits.sales / present.length;
        share.set(member.employeeId, current);
      }
    }
    const ticket = store.sales > 0 ? store.revenue / store.sales : 0;
    const pa = store.missingItems || store.sales <= 0 ? null : store.items / store.sales;
    const storeName = input.storeNames.get(storeId) ?? "Filial";
    for (const member of members) {
      const part = share.get(member.employeeId);
      if (!part || (part.revenue <= 0 && part.sales <= 0)) continue;
      const key = `e:${member.employeeId}`;
      const current = byKey.get(key);
      if (current) {
        current.revenue += part.revenue;
        current.sales += part.sales;
        current.items += pa == null ? 0 : pa * part.sales;
        current.storeIds.push(storeId);
        current.storeRows.push(storeName);
        current.averageTicket = current.sales > 0 ? current.revenue / current.sales : 0;
        current.pa = pa == null || current.pa == null ? null : current.items / current.sales;
        continue;
      }
      byKey.set(key, {
        key,
        name: collaboratorName(member.name),
        storeIds: [storeId],
        storeRows: [storeName],
        shift: member.shiftName ?? undefined,
        revenue: part.revenue,
        sales: part.sales,
        items: pa == null ? 0 : pa * part.sales,
        averageTicket: ticket,
        pa,
        participationPct: 0,
        variationPct: null,
        revenueCmp: 0,
        revenuePrev: 0,
      });
    }
  }
  return [...byKey.values()];
}

function generalGoal(goals: GoalRecord[], storeId: string, from: string, to: string, today: string): GoalRecord | null {
  const matches = goals.filter((goal) => {
    if (goal.storeId !== storeId || goal.tierMode !== "GENERAL") return false;
    if (goalStatus(goal, today) === "upcoming") return false;
    return goal.startsOn <= to && goal.endsOn >= from;
  });
  matches.sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  return matches[0] ?? null;
}

function dayTotal(days: SalesDayAgg[], storeId: string, day: string): { revenue: number; sales: number; items: number; missingItems: boolean } {
  let revenue = 0;
  let sales = 0;
  let items = 0;
  let missingItems = false;
  for (const row of days) {
    if (row.storeId !== storeId || row.brand !== "ALL" || row.day !== day) continue;
    revenue += row.revenueCents / 100;
    sales += row.salesCount;
    if (!row.itemCount && row.salesCount > 0) missingItems = true;
    else items += row.itemCount ?? 0;
  }
  return { revenue, sales, items, missingItems };
}
