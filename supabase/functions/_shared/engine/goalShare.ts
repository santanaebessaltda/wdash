import { collaboratorName } from "./format.ts";
import { dayInGeneralGoal, goalStatus } from "./goalView.ts";
import type { GoalRecord, GoalTeamMember, SalesDayAgg, SalesSellerDayAgg } from "./goalTypes.ts";
import { presenceDays } from "./presence.ts";

export type ShareDay = { revenue: number; sales: number; items: number; missing: boolean };

export function splitEven(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const safe = Math.max(0, Math.floor(total));
  const base = Math.floor(safe / parts);
  let rest = safe - base * parts;
  return Array.from({ length: parts }, () => base + (rest-- > 0 ? 1 : 0));
}

function coveringGoal(goals: GoalRecord[], storeId: string, day: string, today: string): GoalRecord | null {
  const matches = goals.filter(
    (goal) => goal.storeId === storeId && goal.startsOn <= day && day <= goal.endsOn && goalStatus(goal, today) !== "upcoming",
  );
  matches.sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  return matches[0] ?? null;
}

export function inStore(storeIds: string[], storeId: string): boolean {
  return storeIds.length === 0 || storeIds.includes(storeId);
}

/** Venda sem nome no Millennium, em centavos. Usuário da filial e gerência já estão no nome e ficam de fora. */
export function unidentifiedGap(
  dayAggs: SalesDayAgg[],
  named: SalesSellerDayAgg[],
  storeId: string,
  day: string,
): { revenue: number; sales: number; items: number; missing: boolean } {
  let storeRevenue = 0;
  let storeSales = 0;
  let storeItems = 0;
  let missing = false;
  for (const row of dayAggs) {
    if (row.storeId !== storeId || row.day !== day || row.brand !== "ALL") continue;
    storeRevenue += row.revenueCents;
    storeSales += row.salesCount;
    if (row.salesCount > 0 && !(row.itemCount && row.itemCount > 0)) missing = true;
    else storeItems += row.itemCount ?? 0;
  }
  let namedRevenue = 0;
  let namedSales = 0;
  let namedItems = 0;
  for (const row of named) {
    if (row.storeId !== storeId || row.day !== day) continue;
    namedRevenue += row.revenueCents;
    namedSales += row.salesCount;
    namedItems += row.itemCount ?? 0;
  }
  return {
    revenue: Math.max(0, storeRevenue - namedRevenue),
    sales: Math.max(0, storeSales - namedSales),
    items: Math.max(0, storeItems - namedItems),
    missing,
  };
}

type Recipient = { key: string; name: string; shiftName: string | null; storeId: string };

/** Quem recebe o rateio naquele dia: equipe de vendas presente, mais quem vendeu e não é caixa nem gerência. */
export function recipientsOn(team: GoalTeamMember[], sellerDays: SalesSellerDayAgg[], goal: GoalRecord, day: string): Recipient[] {
  const members = team.filter((member) => member.storeId === goal.storeId);
  const byCode = new Map(members.map((member) => [member.employeeId, member]));
  const byName = new Map<string, GoalTeamMember>();
  for (const member of members) for (const key of member.nameKeys) if (!byName.has(key)) byName.set(key, member);

  type Acc = { key: string; name: string; employeeId: number | null; shiftName: string | null; lastSale: string | null; member?: GoalTeamMember };
  const accs = new Map<string, Acc>();
  const touch = (key: string, name: string, employeeId: number | null, member?: GoalTeamMember): Acc => {
    const found = accs.get(key);
    if (found) return found;
    const row: Acc = { key, name, employeeId, shiftName: member?.shiftName ?? null, lastSale: null, member };
    accs.set(key, row);
    return row;
  };

  for (const row of sellerDays) {
    if (row.storeId !== goal.storeId || row.day < goal.startsOn || row.day > goal.endsOn) continue;
    const member = row.sellerEmployeeId != null ? byCode.get(row.sellerEmployeeId) : byName.get(row.sellerKey);
    if (member?.branchUser || (member && !member.salesPerson)) continue;
    const employeeId = member?.employeeId ?? row.sellerEmployeeId ?? null;
    const key = employeeId != null ? `e:${employeeId}` : `n:${row.sellerKey}`;
    const acc = touch(key, member ? collaboratorName(member.name) : row.sellerName, employeeId, member);
    if ((row.revenueCents > 0 || row.salesCount > 0) && (!acc.lastSale || row.day > acc.lastSale)) acc.lastSale = row.day;
  }
  for (const member of members) {
    if (!member.salesPerson || member.branchUser) continue;
    touch(`e:${member.employeeId}`, collaboratorName(member.name), member.employeeId, member);
  }

  return [...accs.values()]
    .filter((acc) =>
      presenceDays(
        goal.startsOn,
        goal.endsOn,
        {
          admittedOn: acc.member?.admittedOn ?? null,
          departedOn: acc.member?.departedOn ?? null,
          active: acc.member ? acc.member.salesPerson : true,
        },
        acc.lastSale,
      ).includes(day),
    )
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((acc) => ({ key: acc.key, name: acc.name, shiftName: acc.shiftName, storeId: goal.storeId }));
}

export type PersonShare = {
  name: string;
  storeId: string;
  shiftName: string | null;
  byDay: Map<string, ShareDay>;
};

/** Parte igual da venda sem vendedor, nos dias de meta Individual ou Grupo com o rateio ligado. */
export function unidentifiedShares(input: {
  goals: GoalRecord[];
  team: GoalTeamMember[];
  dayAggs: SalesDayAgg[];
  namedSellerDayAggs?: SalesSellerDayAgg[];
  sellerDayAggs?: SalesSellerDayAgg[];
  storeIds: string[];
  from: string;
  to: string;
  today: string;
}): Map<string, PersonShare> {
  const out = new Map<string, PersonShare>();
  const named = input.namedSellerDayAggs ?? [];
  const sellerDays = input.sellerDayAggs ?? [];
  if (!input.goals.some((goal) => goal.spreadUnidentified && goal.tierMode !== "GENERAL")) return out;
  const days = new Set<string>();
  for (const row of input.dayAggs) {
    if (!inStore(input.storeIds, row.storeId) || row.brand !== "ALL") continue;
    if (row.day < input.from || row.day > input.to) continue;
    days.add(`${row.storeId}|${row.day}`);
  }
  for (const stamp of days) {
    const [storeId, day] = stamp.split("|") as [string, string];
    const goal = coveringGoal(input.goals, storeId, day, input.today);
    if (!goal || goal.tierMode === "GENERAL" || !goal.spreadUnidentified || dayInGeneralGoal(input.goals, storeId, day, input.today)) continue;
    const gap = unidentifiedGap(input.dayAggs, named, storeId, day);
    if (gap.revenue <= 0 && gap.sales <= 0) continue;
    const present = recipientsOn(input.team, sellerDays, goal, day);
    if (present.length === 0) continue;
    const revenue = splitEven(gap.revenue, present.length);
    const sales = splitEven(gap.sales, present.length);
    const items = splitEven(gap.items, present.length);
    present.forEach((member, index) => {
      const key = member.key;
      const row = out.get(key) ?? { name: member.name, storeId, shiftName: member.shiftName, byDay: new Map() };
      const bit = row.byDay.get(day) ?? { revenue: 0, sales: 0, items: 0, missing: false };
      bit.revenue += (revenue[index] ?? 0) / 100;
      bit.sales += sales[index] ?? 0;
      bit.items += items[index] ?? 0;
      if (gap.missing && (sales[index] ?? 0) > 0) bit.missing = true;
      row.byDay.set(day, bit);
      out.set(key, row);
    });
  }
  return out;
}

/** Na meta Geral, o total do dia da filial dividido entre a equipe de vendas presente. */
export function generalShares(input: {
  goals: GoalRecord[];
  team: GoalTeamMember[];
  dayAggs: SalesDayAgg[];
  sellerDayAggs?: SalesSellerDayAgg[];
  storeIds: string[];
  from: string;
  to: string;
  today: string;
}): Map<string, PersonShare> {
  const out = new Map<string, PersonShare>();
  const sellerDays = input.sellerDayAggs ?? [];
  if (!input.goals.some((goal) => goal.tierMode === "GENERAL")) return out;
  const days = new Set<string>();
  for (const row of input.dayAggs) {
    if (!inStore(input.storeIds, row.storeId) || row.brand !== "ALL") continue;
    if (row.day < input.from || row.day > input.to) continue;
    if (!dayInGeneralGoal(input.goals, row.storeId, row.day, input.today)) continue;
    days.add(`${row.storeId}|${row.day}`);
  }
  for (const stamp of days) {
    const [storeId, day] = stamp.split("|") as [string, string];
    const goal = input.goals
      .filter((item) => item.storeId === storeId && item.tierMode === "GENERAL" && item.startsOn <= day && day <= item.endsOn && goalStatus(item, input.today) !== "upcoming")
      .sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0];
    if (!goal) continue;
    const pot = unidentifiedGap(input.dayAggs, [], storeId, day);
    if (pot.revenue <= 0 && pot.sales <= 0) continue;
    const present = recipientsOn(input.team, sellerDays, goal, day);
    if (present.length === 0) continue;
    const revenue = splitEven(pot.revenue, present.length);
    const sales = splitEven(pot.sales, present.length);
    const items = splitEven(pot.items, present.length);
    present.forEach((member, index) => {
      const row = out.get(member.key) ?? { name: member.name, storeId, shiftName: member.shiftName, byDay: new Map() };
      const bit = row.byDay.get(day) ?? { revenue: 0, sales: 0, items: 0, missing: false };
      bit.revenue += (revenue[index] ?? 0) / 100;
      bit.sales += sales[index] ?? 0;
      bit.items += items[index] ?? 0;
      if (pot.missing && (sales[index] ?? 0) > 0) bit.missing = true;
      row.byDay.set(day, bit);
      out.set(member.key, row);
    });
  }
  return out;
}
