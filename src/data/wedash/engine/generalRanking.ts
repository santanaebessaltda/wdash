import { brlCent, num, addDays } from "@/lib/format";
import { calendarCurrentHour } from "../clock";
import {
  buildTeamDashboardView,
  kpiDelta,
  previousPeriod,
  type Scope,
  type TeamAggInput,
  type TeamDashboardView,
  type TeamKpi,
  type TeamMemberRow,
} from "../dashboard";
import { collaboratorName } from "./format";
import { dayInGeneralGoal, goalStatus } from "./goalView";
import type { GoalRecord, GoalTeamMember, SalesDayAgg, SalesSellerDayAgg } from "./goalTypes";
import { presenceDays } from "./presence";

export { dayInGeneralGoal };

/** Tira as vendas dos dias em meta Geral. Sem meta Geral, devolve o mesmo array. */
export function omitGeneralGoalSellerRows<T extends { storeId: string; day: string }>(
  rows: T[] | undefined,
  goals: GoalRecord[],
  today: string,
): T[] | undefined {
  if (!rows || !goals.some((goal) => goal.tierMode === "GENERAL")) return rows;
  return rows.filter((row) => !dayInGeneralGoal(goals, row.storeId, row.day, today));
}

/**
 * Ranking e pódio: a filial em meta Geral fica de fora.
 * Os KPIs e o faturamento por grupo continuam os da view completa.
 */
export function rankingOutsideGeneralGoal(
  scope: Scope,
  input: TeamAggInput,
  goals: GoalRecord[],
  today: string,
): TeamDashboardView {
  const base = buildTeamDashboardView(scope, input);
  const sellerDayAggs = omitGeneralGoalSellerRows(input.sellerDayAggs, goals, today);
  if (sellerDayAggs === input.sellerDayAggs) return base;
  return { ...base, people: buildTeamDashboardView(scope, { ...input, sellerDayAggs }).people };
}

const TEAM_REVENUE_TIP =
  "Faturamento da equipe. Na meta Individual ou Grupo com rateio, a venda sem vendedor entra neste valor, na média e no ranking. Na meta Geral, é o total da filial dividido entre quem estava na loja.";

/** Fatia do gráfico de grupos: venda que não saiu no nome de ninguém. */
export const TEAM_UNATTRIBUTED_SALE = "Sem vendedor";

type Money = { revenue: number; sales: number; items: number; missing: boolean };
type ShareDay = { revenue: number; sales: number; items: number; missing: boolean };

function emptyMoney(): Money {
  return { revenue: 0, sales: 0, items: 0, missing: false };
}

function splitEven(total: number, parts: number): number[] {
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

function inStore(storeIds: string[], storeId: string): boolean {
  return storeIds.length === 0 || storeIds.includes(storeId);
}

/** Venda sem nome no Millennium, em centavos. Usuário da filial e gerência já estão no nome e ficam de fora. */
function unidentifiedGap(
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
function recipientsOn(team: GoalTeamMember[], sellerDays: SalesSellerDayAgg[], goal: GoalRecord, day: string): Recipient[] {
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

function addMoney(total: Money, day: string, from: string, to: string, bit: { revenue: number; sales: number; items: number; missing?: boolean }): void {
  if (day < from || day > to) return;
  total.revenue += bit.revenue;
  total.sales += bit.sales;
  total.items += bit.items;
  if (bit.missing || (bit.sales > 0 && bit.items <= 0)) total.missing = true;
}

function namedTeamMoney(rows: SalesSellerDayAgg[] | undefined, storeIds: string[], goals: GoalRecord[], today: string, from: string, to: string): Money {
  const total = emptyMoney();
  for (const row of rows ?? []) {
    if (!inStore(storeIds, row.storeId) || row.day < from || row.day > to) continue;
    if (dayInGeneralGoal(goals, row.storeId, row.day, today)) continue;
    addMoney(total, row.day, from, to, {
      revenue: row.revenueCents / 100,
      sales: row.salesCount,
      items: row.itemCount ?? 0,
      missing: row.salesCount > 0 && !(row.itemCount && row.itemCount > 0),
    });
  }
  return total;
}

function generalStoreMoney(rows: SalesDayAgg[], storeIds: string[], goals: GoalRecord[], today: string, from: string, to: string): Money {
  const total = emptyMoney();
  for (const row of rows) {
    if (!inStore(storeIds, row.storeId) || row.brand !== "ALL" || row.day < from || row.day > to) continue;
    if (!dayInGeneralGoal(goals, row.storeId, row.day, today)) continue;
    addMoney(total, row.day, from, to, {
      revenue: row.revenueCents / 100,
      sales: row.salesCount,
      items: row.itemCount ?? 0,
      missing: row.salesCount > 0 && !(row.itemCount && row.itemCount > 0),
    });
  }
  return total;
}

function shareMoney(shares: Map<string, PersonShare>, from: string, to: string): Money {
  const total = emptyMoney();
  for (const person of shares.values()) {
    for (const [day, bit] of person.byDay) addMoney(total, day, from, to, bit);
  }
  return total;
}

function plus(a: Money, b: Money): Money {
  return {
    revenue: a.revenue + b.revenue,
    sales: a.sales + b.sales,
    items: a.items + b.items,
    missing: a.missing || b.missing,
  };
}

function teamKpis(current: Money, cmp: Money, prev: Money, people: number, vs: string): TeamKpi[] {
  const comparable = current.revenue > 0 && cmp.sales > 0 && prev.sales > 0;
  const ticket = current.sales > 0 ? current.revenue / current.sales : 0;
  const ticketCmp = cmp.sales > 0 ? cmp.revenue / cmp.sales : 0;
  const ticketPrev = prev.sales > 0 ? prev.revenue / prev.sales : 0;
  const pa = current.missing || current.sales === 0 ? null : current.items / current.sales;
  const paComparable = comparable && !cmp.missing && !prev.missing;
  return [
    {
      label: "Faturamento da equipe",
      amount: brlCent(current.revenue),
      sub: people > 0 ? `${people} ${people === 1 ? "pessoa" : "pessoas"} · média de ${brlCent(current.revenue / people)}` : undefined,
      delta: comparable ? kpiDelta(cmp.revenue, prev.revenue, vs) : undefined,
      tooltip: TEAM_REVENUE_TIP,
    },
    {
      label: "Nº de vendas",
      amount: num(current.sales),
      sub: current.sales > 0 && !current.missing ? `${num(current.items)} itens vendidos` : undefined,
      delta: comparable ? kpiDelta(cmp.sales, prev.sales, vs, "sales") : undefined,
    },
    {
      label: "Ticket médio",
      amount: brlCent(ticket),
      delta: comparable ? kpiDelta(ticketCmp, ticketPrev, vs) : undefined,
    },
    {
      label: "P.A.",
      amount: pa == null ? (current.sales > 0 ? "—" : num(0, 2)) : num(pa, 2),
      sub: "Itens por venda",
      delta: paComparable ? kpiDelta(cmp.items / cmp.sales, prev.items / prev.sales, vs, "pa") : undefined,
      tooltip: pa == null && current.sales > 0 ? "O P.A. não está disponível para este período." : undefined,
    },
  ];
}

function withUnattributedSale(view: TeamDashboardView): TeamDashboardView {
  const revenue = view.composition.unidentified;
  if (!(revenue > 0) || view.shifts.some((shift) => shift.name === TEAM_UNATTRIBUTED_SALE)) return view;
  return { ...view, shifts: [...view.shifts, { name: TEAM_UNATTRIBUTED_SALE, revenue, people: 0 }] };
}

/**
 * KPIs, ranking e pódio recebem a parte igual.
 * Individual ou Grupo com rateio: a venda sem vendedor. Geral: o total da filial.
 * O faturamento por grupo continua com a venda no nome e ganha a fatia sem vendedor.
 */
export function teamViewWithGoalShare(
  scope: Scope,
  input: TeamAggInput,
  goals: GoalRecord[],
  team: GoalTeamMember[],
  today: string,
  storeNames: Map<string, string> = new Map(),
): TeamDashboardView {
  const ranked = rankingOutsideGeneralGoal(scope, input, goals, today);
  if (goals.length === 0) return withUnattributedSale(ranked);
  const period = ranked.period;
  const prev = previousPeriod(period, calendarCurrentHour());
  const cuts = prev.hourMax != null;
  const endCmp = cuts ? addDays(period.end, -1) : period.end;
  const prevEndCmp = cuts ? addDays(prev.end, -1) : prev.end;
  const from = prev.start < period.start ? prev.start : period.start;
  const shareInput = {
    goals,
    team,
    dayAggs: input.dayAggs,
    namedSellerDayAggs: input.namedSellerDayAggs,
    sellerDayAggs: input.sellerDayAggs,
    storeIds: scope.storeIds,
    from,
    to: period.end,
    today,
  };
  const shares = unidentifiedShares(shareInput);
  const collective = generalShares(shareInput);
  const storeIds = scope.storeIds;
  const current = plus(
    plus(namedTeamMoney(input.sellerDayAggs, storeIds, goals, today, period.start, period.end), generalStoreMoney(input.dayAggs, storeIds, goals, today, period.start, period.end)),
    shareMoney(shares, period.start, period.end),
  );
  const cmp = plus(
    plus(namedTeamMoney(input.sellerDayAggs, storeIds, goals, today, period.start, endCmp), generalStoreMoney(input.dayAggs, storeIds, goals, today, period.start, endCmp)),
    shareMoney(shares, period.start, endCmp),
  );
  const previous = plus(
    plus(namedTeamMoney(input.sellerDayAggs, storeIds, goals, today, prev.start, prevEndCmp), generalStoreMoney(input.dayAggs, storeIds, goals, today, prev.start, prevEndCmp)),
    shareMoney(shares, prev.start, prevEndCmp),
  );
  const baseCurrent = namedTeamMoney(input.sellerDayAggs, storeIds, goals, today, period.start, period.end);
  const unchanged = shares.size === 0 && collective.size === 0 && current.revenue === baseCurrent.revenue && current.sales === baseCurrent.sales;
  if (unchanged) return withUnattributedSale(ranked);

  const people = ranked.people.map((person) => ({ ...person, storeIds: [...person.storeIds], storeRows: [...person.storeRows] }));
  const byKey = new Map(people.map((person) => [person.key, person]));
  const missing = new Set(people.filter((person) => person.pa == null && person.sales > 0).map((person) => person.key));
  for (const [key, share] of [...shares, ...collective]) {
    let person = byKey.get(key);
    if (!person) {
      person = {
        key,
        name: share.name,
        storeIds: [share.storeId],
        storeRows: [storeNames.get(share.storeId) ?? "Filial"],
        ...(share.shiftName ? { shift: share.shiftName } : {}),
        revenue: 0,
        sales: 0,
        items: 0,
        averageTicket: 0,
        pa: null,
        participationPct: 0,
        variationPct: null,
        revenueCmp: 0,
        revenuePrev: 0,
      } satisfies TeamMemberRow;
      people.push(person);
      byKey.set(key, person);
    } else if (!person.storeIds.includes(share.storeId)) {
      person.storeIds.push(share.storeId);
      const name = storeNames.get(share.storeId);
      if (name) person.storeRows.push(name);
    }
    for (const [day, bit] of share.byDay) {
      if (day >= period.start && day <= period.end) {
        person.revenue += bit.revenue;
        person.sales += bit.sales;
        person.items += bit.items;
        if (bit.missing) missing.add(key);
      }
      if (day >= period.start && day <= endCmp) person.revenueCmp += bit.revenue;
      if (day >= prev.start && day <= prevEndCmp) person.revenuePrev += bit.revenue;
    }
  }
  const visible = people.filter((person) => person.revenue > 0 || person.sales > 0);
  const total = visible.reduce((sum, person) => sum + person.revenue, 0);
  for (const person of visible) {
    person.averageTicket = person.sales > 0 ? person.revenue / person.sales : 0;
    person.pa = missing.has(person.key) || person.sales === 0 ? null : person.items / person.sales;
    person.participationPct = total > 0 ? (person.revenue / total) * 100 : 0;
    person.variationPct = person.revenueCmp > 0 && person.revenuePrev > 0 ? ((person.revenueCmp - person.revenuePrev) / person.revenuePrev) * 100 : null;
  }
  visible.sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "pt-BR"));
  return withUnattributedSale({
    ...ranked,
    people: visible,
    kpis: teamKpis(current, cmp, previous, visible.length, ranked.vsVariation),
  });
}

/** Parte de um vendedor, por dia, para o detalhe bater com a linha do ranking. */
export function personShareDays(
  scope: Scope,
  input: TeamAggInput,
  goals: GoalRecord[],
  team: GoalTeamMember[],
  today: string,
  key: string,
): Map<string, ShareDay> {
  const period = rankingOutsideGeneralGoal(scope, input, goals, today).period;
  const prev = previousPeriod(period, calendarCurrentHour());
  const from = prev.start < period.start ? prev.start : period.start;
  const shareInput = {
    goals,
    team,
    dayAggs: input.dayAggs,
    namedSellerDayAggs: input.namedSellerDayAggs,
    sellerDayAggs: input.sellerDayAggs,
    storeIds: scope.storeIds,
    from,
    to: period.end,
    today,
  };
  const byDay = new Map<string, ShareDay>();
  for (const source of [unidentifiedShares(shareInput), generalShares(shareInput)]) {
    const row = source.get(key);
    if (!row) continue;
    for (const [day, bit] of row.byDay) byDay.set(day, bit);
  }
  return byDay;
}
