/** Pacote da tela Inicio do vendedor. No modo Geral, os números da pessoa são a parte igual da filial e o ranking fica vazio. Com rateio na meta Individual ou Grupo, os números e o ranking somam a parte da venda sem vendedor. Nos outros modos, o ranking é a venda de cada pessoa. */
import { addMonths, addDays, brlCent, collaboratorName, eachDay, startOfMonth } from "./format.ts";
import type { GoalCardView, GoalRecord, GoalTeamMember, SalesDayAgg, SalesSellerDayAgg, SellerRow } from "./goalTypes.ts";
import { buildGoalCardView, goalSpreadsUnidentified, goalStatus, sellerGoalLevels, type SellerGoalLevel } from "./goalView.ts";
import { weekdayWeights, type StoreWeekHours } from "./goalWeights.ts";
import { buildSellerRanking, groupSize, type SellerRankingEntry } from "./sellerRanking.ts";
import {
  challengeStanding,
  sellerChallengeRules,
  type SellerChallengeMetric,
  type SellerChallengeScope,
  type SellerProductDay,
} from "./sellerChallenge.ts";
import { unidentifiedShares } from "./goalShare.ts";
import { nextLevelGain, projectedPrize } from "./sellerPrize.ts";

/** Semanas de historico da loja antes da meta para o peso por dia da semana (as mesmas da curva da meta). */
const HISTORY_WEEKS = 6;

/** Meses de venda que a integracao carrega (DEEP_HISTORY=24m), contando o mes atual. */
export const SELLER_HISTORY_MONTHS = 24;

/** Primeiro dia do mes mais antigo coberto pelo carregamento de 24 meses. */
export function sellerHistoryFloor(today: string): string {
  return addMonths(startOfMonth(today), -(SELLER_HISTORY_MONTHS - 1));
}

/**
 * Primeiro mes que a pessoa pode abrir: o mais recente entre o piso de 24 meses
 * e o mes da admissao. Sem data de admissao, fica so o piso.
 */
export function sellerHistoryFrom(today: string, admittedOn: Array<string | null>): string {
  const floor = sellerHistoryFloor(today);
  if (admittedOn.length === 0 || admittedOn.some((day) => !day)) return floor;
  const joined = admittedOn.reduce((earliest, day) => (day! < earliest! ? day : earliest))!;
  const admittedMonth = startOfMonth(joined);
  return admittedMonth > floor ? admittedMonth : floor;
}

/** Primeiro dia a buscar: o periodo anterior da comparacao e as 6 semanas de peso da meta. */
export function sellerLoadFrom(rangeFrom: string, rangeTo: string): string {
  const span = Math.max(1, eachDay(rangeFrom, rangeTo).length);
  const comparisonFrom = addDays(rangeFrom, -Math.max(span, 7));
  const weightFrom = addDays(startOfMonth(addDays(rangeFrom, -HISTORY_WEEKS * 7)), 0);
  return comparisonFrom < weightFrom ? comparisonFrom : weightFrom;
}

/** Uma meta que cruza o mes visto, com a parte da pessoa. */
export interface SellerHomeGoal {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  mode: "individual" | "grupo" | "geral";
  /** Individual ou Grupo com o rateio de vendas sem vendedor identificado. */
  spreadsUnidentified: boolean;
  /** null = fora dos grupos da meta. */
  me: SellerGoalLevel | null;
  nextLevelGain: number | null;
  projectedPrize: number | null;
  /** Atingimento projetado no fim da meta (%). null antes de haver ritmo. */
  projectedPct: number | null;
  ranking: SellerRankingEntry[];
  gapPp: number | null;
  abovePosition: number | null;
}

export interface SellerHomeStore {
  storeId: string;
  storeName: string;
  lastSyncAt: string | null;
  /** Metas ativas da loja no mês, uma por card. Vazio = nenhuma. */
  goals: SellerHomeGoal[];
  /** Primeira meta ativa. O mesmo que `goals[0]`, null quando não há meta. */
  goal: SellerHomeGoal | null;
  /** Podio do mes no grupo da pessoa (dia 1 ate hoje), por faturamento, com ou sem meta. Na meta Geral, a parte igual da filial. */
  monthRanking: MonthRankingEntry[];
  /** Pódio da equipe de vendas da loja no intervalo. Com rateio, soma a parte da venda sem vendedor. */
  storeRanking: MonthRankingEntry[];
  /** Nome do grupo da pessoa; null quando ela esta sem grupo. */
  groupName: string | null;
  /** Desafios da loja que cruzam o mes corrente. */
  challenges: SellerChallenge[];
}

/** Uma linha do podio do mes. `revenue` em reais. */
export interface MonthRankingEntry {
  position: number;
  employeeId: number;
  name: string;
  revenue: number;
  sales: number;
  me: boolean;
}

export type SellerChallengePrize =
  | { kind: "MONEY"; amount: number }
  | { kind: "ITEM"; label: string };

/** Desafio ja com status, premio e o andamento da propria pessoa. */
export interface SellerChallenge {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  status: "active" | "upcoming" | "ended";
  mode: "CONTEST" | "MINIMUM" | "COLLECTIVE";
  prize: string | null;
  /** Regras em linguagem da vendedora (como ganha, o que conta, piso, premios). */
  rules: string[];
  metricLabel: string;
  /** null = a comecar ou resultado indisponivel. */
  result: string | null;
  position: number | null;
  won: boolean;
  gap: string | null;
  unavailable: boolean;
  progressPct: number | null;
}

/** Como o desafio vem do banco, antes do rotulo de premio. */
export interface SellerChallengeInput {
  id: string;
  storeId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  mode: "CONTEST" | "MINIMUM" | "COLLECTIVE";
  prize: SellerChallengePrize | null;
  /** Ausente = itens de tudo o que a pessoa vendeu (desafios antigos do teste). */
  metric?: SellerChallengeMetric;
  scope?: SellerChallengeScope;
  productCodes?: string[];
  categoryIds?: number[];
  lines?: { key: string; kinds: string[] }[];
  target?: number | null;
  minSales?: number | null;
  prizes?: SellerChallengePrize[];
}

/** Um dia de vendas do vendedor numa loja (R$). items null = dia com venda sem itens gravados. */
export interface SellerDay {
  storeId: string;
  day: string;
  revenue: number;
  sales: number;
  items: number | null;
}

export interface SellerHomePayload {
  today: string;
  /** Primeiro dia do mes escolhido. */
  month: string;
  /** Primeiro dia do mes mais antigo que a pessoa pode abrir. */
  historyFrom: string;
  name: string;
  stores: SellerHomeStore[];
  myDays: SellerDay[];
  numbersPeriod: { from: string; to: string };
}

export interface SellerHomeInput {
  today: string;
  /** Intervalo escolhido no seletor. Sem isso, o mes de `today` ate `today`. */
  period?: { from: string; to: string };
  /** Lojas do vendedor com o codigo dele no Millennium; `week` = horario efetivo (sem horario = todos os dias abertos). */
  stores: { storeId: string; storeName: string; lastSyncAt: string | null; employeeId: number; week: StoreWeekHours }[];
  goals: GoalRecord[];
  /** Faturamento das lojas, das 6 semanas antes da meta ate hoje. */
  dayAggs: SalesDayAgg[];
  /** Vendas por pessoa ja sem gerencia e sem o usuário da filial (`excludeNonSalesPeople`). */
  sellerDayAggs: SalesSellerDayAgg[];
  /** Vendas com nome, para o rateio separar usuário da filial e gerência. */
  namedSellerDayAggs?: SalesSellerDayAgg[];
  team: GoalTeamMember[];
  challenges?: SellerChallengeInput[];
  /** Itens por pessoa x produto, para desafios de produtos ou categorias. */
  sellerProducts?: SellerProductDay[];
  /** COD_PRODUTO  ->  tipo, para desafios de categorias. */
  productTypes?: { code: string; typeId: number }[];
  /** COD_PRODUTO  ->  descricao, para desafios por linha. */
  productNames?: { code: string; name: string }[];
}

function storeWeights(input: SellerHomeInput, goal: GoalRecord, week: StoreWeekHours): number[] {
  const from = addDays(goal.startsOn, -HISTORY_WEEKS * 7);
  const hist = new Map<string, number>();
  for (const a of input.dayAggs) {
    if (a.storeId !== goal.storeId || a.brand !== "ALL" || a.day < from || a.day >= goal.startsOn) continue;
    hist.set(a.day, (hist.get(a.day) ?? 0) + a.revenueCents / 100);
  }
  return weekdayWeights(hist, week);
}

function prizeLabel(prize: SellerChallengePrize | null, mode: SellerChallengeInput["mode"]): string | null {
  if (!prize) return null;
  const value = prize.kind === "MONEY" ? brlCent(prize.amount) : prize.label;
  if (mode === "COLLECTIVE") return `${value} para a equipe`;
  return mode === "MINIMUM" ? `${value} por pessoa` : `1º lugar: ${value}`;
}

/** Meta Geral em andamento nesta loja. O caixa (fora da equipe) entra no bolo e sai da divisao. */
function generalGoal(input: SellerHomeInput, storeId: string): GoalRecord | null {
  const goal = input.goals.find((g) => g.storeId === storeId && g.tierMode === "GENERAL" && goalStatus(g, input.today) === "active");
  return goal ?? null;
}

/** Pessoas da equipe de vendas da loja, com nome para aparecer no podio. */
function salesTeam(input: SellerHomeInput, storeId: string): GoalTeamMember[] {
  return input.team.filter((m) => m.storeId === storeId && m.salesPerson && m.employeeId != null && collaboratorName(m.name));
}

/** Venda da filial num intervalo. Itens null = algum dia com venda sem itens. */
function storeSlice(input: SellerHomeInput, storeId: string, from: string, to: string): { revenue: number; sales: number; items: number | null } {
  let revenue = 0;
  let sales = 0;
  let items = 0;
  let missing = false;
  for (const a of input.dayAggs) {
    if (a.storeId !== storeId || a.brand !== "ALL" || a.day < from || a.day > to) continue;
    revenue += a.revenueCents / 100;
    sales += a.salesCount;
    if (!a.itemCount && a.salesCount > 0) missing = true;
    else items += a.itemCount ?? 0;
  }
  return { revenue, sales, items: missing ? null : items };
}

/** Grupo da pessoa na loja. Sem grupo = so quem tambem esta sem grupo. */
function sellerGroup(input: SellerHomeInput, s: SellerHomeInput["stores"][number]): { shiftId: string | null; name: string | null } | null {
  const mine = input.team.find((m) => m.storeId === s.storeId && m.employeeId === s.employeeId);
  if (!mine) return null;
  return { shiftId: mine.shiftId, name: mine.shiftName };
}

/** Intervalo do seletor. Sem periodo, o mes corrente ate o dia visto. */
function viewed(input: SellerHomeInput): { from: string; to: string } {
  const to = input.period?.to && input.period.to <= input.today ? input.period.to : input.today;
  const from = input.period?.from ?? startOfMonth(to);
  return from <= to ? { from, to } : { from: to, to };
}

/** No modo Geral, a equipe inteira com a mesma parte da filial. Senao, o grupo, no intervalo visto. */
function monthRanking(input: SellerHomeInput, s: SellerHomeInput["stores"][number]): MonthRankingEntry[] {
  const geral = generalGoal(input, s.storeId);
  const team = salesTeam(input, s.storeId);
  const range = viewed(input);
  if (geral && team.length > 0) {
    const from = range.from;
    const start = from > geral.startsOn ? from : geral.startsOn;
    const end = range.to < geral.endsOn ? range.to : geral.endsOn;
    const total = start <= end ? storeSlice(input, s.storeId, start, end) : { revenue: 0, sales: 0, items: 0 };
    const n = team.length;
    const ordered = [...team].sort((a, b) => collaboratorName(a.name).localeCompare(collaboratorName(b.name), "pt-BR"));
    return ordered.map((m) => ({
      position: 1,
      employeeId: m.employeeId,
      name: collaboratorName(m.name),
      revenue: total.revenue / n,
      sales: total.sales / n,
      me: m.employeeId === s.employeeId,
    }));
  }
  return salesRanking(input, s, "group");
}

/** Venda real no intervalo visto. Grupo = colegas do mesmo grupo; loja = equipe de vendas da filial. */
function salesRanking(
  input: SellerHomeInput,
  s: SellerHomeInput["stores"][number],
  scope: "group" | "store",
): MonthRankingEntry[] {
  const range = viewed(input);
  const from = range.from;
  const group = scope === "group" ? sellerGroup(input, s) : null;
  const inScope = (m: GoalTeamMember) =>
    m.storeId === s.storeId && m.salesPerson && (scope === "store" || group == null || m.shiftId === group.shiftId);
  const byEmployee = new Map<number, GoalTeamMember>();
  const byName = new Map<string, GoalTeamMember>();
  const totals = new Map<string, { employeeId: number; name: string; revenue: number; sales: number; me: boolean }>();
  for (const m of input.team) {
    if (!inScope(m) || m.employeeId == null) continue;
    byEmployee.set(m.employeeId, m);
    for (const k of m.nameKeys) if (!byName.has(k)) byName.set(k, m);
    const name = collaboratorName(m.name);
    if (!name) continue;
    totals.set(`e:${m.employeeId}`, { employeeId: m.employeeId, name, revenue: 0, sales: 0, me: m.employeeId === s.employeeId });
  }
  for (const r of input.sellerDayAggs) {
    if (r.storeId !== s.storeId || r.day < from || r.day > range.to) continue;
    const member = r.sellerEmployeeId != null ? byEmployee.get(r.sellerEmployeeId) : byName.get(r.sellerKey);
    if (!member || member.employeeId == null || !inScope(member)) continue;
    const row = totals.get(`e:${member.employeeId}`);
    if (!row) continue;
    row.revenue += r.revenueCents / 100;
    row.sales += r.salesCount;
  }
  const shares = rateioByPerson(input, s.storeId, from, range.to);
  for (const [key, share] of shares) {
    const row = totals.get(key);
    if (!row) continue;
    for (const [day, bit] of share.byDay) {
      if (day < from || day > range.to) continue;
      row.revenue += bit.revenue;
      row.sales += bit.sales;
    }
  }
  const ordered = [...totals.values()].sort((a, b) => b.revenue - a.revenue || b.sales - a.sales || a.name.localeCompare(b.name, "pt-BR"));
  const entries: MonthRankingEntry[] = [];
  ordered.forEach((r, i) => {
    const prev = entries[i - 1];
    const tied = prev && prev.revenue === r.revenue && prev.sales === r.sales;
    entries.push({ position: tied ? prev.position : i + 1, ...r });
  });
  return entries;
}

function storeChallenges(input: SellerHomeInput, s: SellerHomeInput["stores"][number]): SellerChallenge[] {
  const order = { active: 0, upcoming: 1, ended: 2 } as const;
  return (input.challenges ?? [])
    .filter((c) => c.storeId === s.storeId)
    .map((c) => {
      const standing = challengeStanding(c, {
        today: input.today,
        employeeId: s.employeeId,
        team: input.team,
        sellerDays: input.sellerDayAggs,
        products: input.sellerProducts,
        productTypes: input.productTypes,
        productNames: input.productNames,
        storeDays: input.dayAggs,
      });
      return {
        id: c.id,
        name: c.name,
        startsOn: c.startsOn,
        endsOn: c.endsOn,
        status: goalStatus(c, input.today),
        mode: c.mode,
        prize: prizeLabel(c.prize, c.mode),
        rules: sellerChallengeRules(c),
        ...standing,
      };
    })
    .sort((a, b) => order[a.status] - order[b.status] || a.endsOn.localeCompare(b.endsOn) || a.name.localeCompare(b.name, "pt-BR"));
}

/** 1 no individual. Nos outros modos, soma dos dias do grupo ÷ dias da pessoa (igual vira o tamanho do grupo). */
function prizeDivisor(view: GoalCardView, row: SellerRow): number {
  if (view.kind === "individual") return 1;
  const peers = view.sellers.filter((r) => !r.noGoal && (view.kind === "geral" || r.group === row.group));
  const sum = peers.reduce((s, r) => s + r.eligibleDays, 0);
  if (row.eligibleDays > 0 && sum > 0) return sum / row.eligibleDays;
  return groupSize(view, row);
}

function buildHomeGoal(input: SellerHomeInput, s: SellerHomeInput["stores"][number], goal: GoalRecord): SellerHomeGoal {
  const meKey = `e:${s.employeeId}`;
  const viewInput = {
    goal,
    storeNameValue: s.storeName,
    dayAggs: input.dayAggs,
    sellerDayAggs: input.sellerDayAggs,
    namedSellerDayAggs: input.namedSellerDayAggs,
    team: input.team,
    today: input.today,
  };
  const view = buildGoalCardView(viewInput);
  const me = sellerGoalLevels({
    goals: [goal],
    dayAggs: input.dayAggs,
    sellerDayAggs: input.sellerDayAggs,
    namedSellerDayAggs: input.namedSellerDayAggs,
    team: input.team,
    today: input.today,
  }).get(meKey) ?? null;
  const row = view.sellers.find((r) => r.employeeId === meKey);
  const size = row ? prizeDivisor(view, row) : 1;
  let projected: number | null = null;
  if (me) {
    const yesterday = buildGoalCardView({
      ...viewInput,
      dayAggs: input.dayAggs.filter((r) => r.day < input.today),
      sellerDayAggs: input.sellerDayAggs.filter((r) => r.day < input.today),
    });
    const r = yesterday.sellers.find((x) => x.employeeId === meKey);
    const sold = !r ? 0 : me.modo === "individual" ? r.revenueAmount : (r.attainmentPct * r.individualGoalAmount) / 100;
    projected = projectedPrize(goal, me, { today: input.today, weights: storeWeights(input, goal, s.week), soldUntilYesterday: sold, groupSize: size });
  }
  const ranking = buildSellerRanking(view, meKey);
  return {
    id: goal.id,
    name: goal.name,
    startsOn: goal.startsOn,
    endsOn: goal.endsOn,
    mode: goal.tierMode === "INDIVIDUAL" ? "individual" : goal.tierMode === "GENERAL" ? "geral" : "grupo",
    spreadsUnidentified: goalSpreadsUnidentified(goal),
    me,
    nextLevelGain: me ? nextLevelGain(me, size) : null,
    projectedPrize: projected,
    projectedPct: row?.projectedAttainmentPct ?? null,
    ranking: ranking.entries,
    gapPp: ranking.gapPp,
    abovePosition: ranking.abovePosition,
  };
}

function buildStore(input: SellerHomeInput, s: SellerHomeInput["stores"][number]): SellerHomeStore {
  const range = viewed(input);
  const goals = input.goals
    .filter((g) => g.storeId === s.storeId && g.startsOn <= range.to && g.endsOn >= range.from && goalStatus(g, input.today) !== "upcoming")
    .sort((a, b) => {
      const rank = (g: typeof a) => (goalStatus(g, input.today) === "active" ? 0 : 1);
      return rank(a) - rank(b) || a.startsOn.localeCompare(b.startsOn) || a.name.localeCompare(b.name, "pt-BR");
    })
    .map((g) => buildHomeGoal(input, s, g));
  return {
    storeId: s.storeId,
    storeName: s.storeName,
    lastSyncAt: s.lastSyncAt,
    monthRanking: monthRanking(input, s),
    storeRanking: salesRanking(input, s, "store"),
    groupName: sellerGroup(input, s)?.name ?? null,
    challenges: storeChallenges(input, s),
    goals,
    goal: goals[0] ?? null,
  };
}

/** Parte da venda sem vendedor para cada pessoa da loja, nos dias de meta Individual ou Grupo com rateio. */
function rateioByPerson(input: SellerHomeInput, storeId: string, from: string, to: string) {
  if (!input.namedSellerDayAggs) return new Map<string, { byDay: Map<string, { revenue: number; sales: number; items: number; missing: boolean }> }>();
  return unidentifiedShares({
    goals: input.goals,
    team: input.team,
    dayAggs: input.dayAggs,
    namedSellerDayAggs: input.namedSellerDayAggs,
    sellerDayAggs: input.sellerDayAggs,
    storeIds: [storeId],
    from,
    to,
    today: input.today,
  });
}

/** Linhas do proprio vendedor. Na meta Geral, cada dia dentro da meta e a parte igual da filial. Com rateio, soma a parte da venda sem vendedor. */
function sellerDays(input: SellerHomeInput): SellerDay[] {
  const days = new Map<string, SellerDay>();
  for (const s of input.stores) {
    const geral = generalGoal(input, s.storeId);
    const n = salesTeam(input, s.storeId).length;
    const onGoal = (day: string) => geral != null && n > 0 && day >= geral.startsOn && day <= geral.endsOn;
    if (geral && n > 0) {
      for (const a of input.dayAggs) {
        if (a.storeId !== s.storeId || a.brand !== "ALL" || !onGoal(a.day)) continue;
        const key = `${s.storeId}|${a.day}`;
        const d = days.get(key) ?? { storeId: s.storeId, day: a.day, revenue: 0, sales: 0, items: 0 };
        d.revenue += a.revenueCents / 100 / n;
        d.sales += a.salesCount / n;
        d.items = d.items == null || (!a.itemCount && a.salesCount > 0) ? null : d.items + (a.itemCount ?? 0) / n;
        days.set(key, d);
      }
    }
    const byName = new Map<string, GoalTeamMember>();
    for (const m of input.team) if (m.storeId === s.storeId) for (const k of m.nameKeys) if (!byName.has(k)) byName.set(k, m);
    for (const r of input.sellerDayAggs) {
      if (r.storeId !== s.storeId || onGoal(r.day)) continue;
      const mine = r.sellerEmployeeId != null ? r.sellerEmployeeId === s.employeeId : byName.get(r.sellerKey)?.employeeId === s.employeeId;
      if (!mine) continue;
      const key = `${s.storeId}|${r.day}`;
      const d = days.get(key) ?? { storeId: s.storeId, day: r.day, revenue: 0, sales: 0, items: 0 };
      d.revenue += r.revenueCents / 100;
      d.sales += r.salesCount;
      d.items = d.items == null || (!r.itemCount && r.salesCount > 0) ? null : d.items + (r.itemCount ?? 0);
      days.set(key, d);
    }
    let from = input.today;
    let to = input.today;
    for (const a of input.dayAggs) {
      if (a.storeId !== s.storeId || a.brand !== "ALL") continue;
      if (a.day < from) from = a.day;
      if (a.day > to) to = a.day;
    }
    const mine = rateioByPerson(input, s.storeId, from, to).get(`e:${s.employeeId}`);
    if (!mine) continue;
    for (const [day, bit] of mine.byDay) {
      const key = `${s.storeId}|${day}`;
      const d = days.get(key) ?? { storeId: s.storeId, day, revenue: 0, sales: 0, items: 0 };
      d.revenue += bit.revenue;
      d.sales += bit.sales;
      d.items = d.items == null || bit.missing ? null : (d.items ?? 0) + bit.items;
      days.set(key, d);
    }
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day) || a.storeId.localeCompare(b.storeId));
}

export function buildSellerHome(input: SellerHomeInput): { stores: SellerHomeStore[]; myDays: SellerDay[] } {
  return { stores: input.stores.map((s) => buildStore(input, s)), myDays: sellerDays(input) };
}
