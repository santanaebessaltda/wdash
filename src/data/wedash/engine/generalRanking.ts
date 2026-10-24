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
import { dayInGeneralGoal } from "./goalView";
import { generalShares, inStore, unidentifiedShares, type PersonShare, type ShareDay } from "./goalShare";
import type { GoalRecord, GoalTeamMember, SalesDayAgg, SalesSellerDayAgg } from "./goalTypes";

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
export const TEAM_UNATTRIBUTED_SALE = "SEM GRUPO IDENTIFICADO";

type Money = { revenue: number; sales: number; items: number; missing: boolean };

function emptyMoney(): Money {
  return { revenue: 0, sales: 0, items: 0, missing: false };
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
  if (Math.round(revenue * 100) < 1 || view.shifts.some((shift) => shift.name === TEAM_UNATTRIBUTED_SALE)) return view;
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
