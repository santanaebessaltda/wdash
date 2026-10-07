/** Pacote da tela Inicio do vendedor. O podio do mes traz o faturamento da equipe; a premiacao da meta continua so da propria pessoa. */
import { brlCent, collaboratorName, inicioDoMes, somarDias } from "./format.ts";
import type { GoalRecord, GoalTeamMember, SalesDayAgg, SalesSellerDayAgg } from "./goalTypes.ts";
import { buildGoalCardView, goalStatus, sellerGoalLevels, type SellerGoalLevel } from "./goalView.ts";
import { weekdayWeights, type StoreWeekHours } from "./goalWeights.ts";
import { buildSellerRanking, groupSize, type SellerRankingEntry } from "./sellerRanking.ts";
import {
  challengeStanding,
  sellerChallengeRules,
  type SellerChallengeMetric,
  type SellerChallengeScope,
  type SellerProductDay,
} from "./sellerChallenge.ts";
import { nextLevelGain, projectedPrize } from "./sellerPrize.ts";

/** Semanas de historico da loja antes da meta para o peso por dia da semana (as mesmas da curva da meta). */
const HISTORY_WEEKS = 6;

export interface SellerHomeStore {
  storeId: string;
  storeName: string;
  lastSyncAt: string | null;
  goal: null | {
    name: string;
    startsOn: string;
    endsOn: string;
    mode: "individual" | "grupo";
    /** null = fora dos grupos da meta. */
    me: SellerGoalLevel | null;
    nextLevelGain: number | null;
    projectedPrize: number | null;
    ranking: SellerRankingEntry[];
    gapPp: number | null;
    abovePosition: number | null;
  };
  /** Podio do mes no grupo da pessoa (dia 1 ate hoje), por faturamento, com ou sem meta. */
  monthRanking: MonthRankingEntry[];
  /** Nome do grupo da pessoa; null quando ela esta sem grupo. */
  groupName: string | null;
  /** Desafios da loja que cruzam o mes corrente. */
  challenges: SellerChallenge[];
}

/** Uma linha do podio do mes. `revenue` em reais. */
export interface MonthRankingEntry {
  position: number;
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
  mode: "CONTEST" | "MINIMUM";
  prize: SellerChallengePrize | null;
  /** Ausente = itens de tudo o que a pessoa vendeu (desafios antigos do teste). */
  metric?: SellerChallengeMetric;
  scope?: SellerChallengeScope;
  productCodes?: string[];
  categoryIds?: number[];
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
  name: string;
  stores: SellerHomeStore[];
  myDays: SellerDay[];
  numbersPeriod: { from: string; to: string };
}

export interface SellerHomeInput {
  today: string;
  /** Lojas do vendedor com o codigo dele no Millennium; `week` = horario efetivo (sem horario = todos os dias abertos). */
  stores: { storeId: string; storeName: string; lastSyncAt: string | null; employeeId: number; week: StoreWeekHours }[];
  goals: GoalRecord[];
  /** Faturamento das lojas, das 6 semanas antes da meta ate hoje. */
  dayAggs: SalesDayAgg[];
  /** Vendas por pessoa ja sem gerencia (`excludeNonSalesPeople`). */
  sellerDayAggs: SalesSellerDayAgg[];
  team: GoalTeamMember[];
  challenges?: SellerChallengeInput[];
  /** Itens por pessoa x produto, para desafios de produtos ou categorias. */
  sellerProducts?: SellerProductDay[];
  /** COD_PRODUTO  ->  tipo, para desafios de categorias. */
  productTypes?: { code: string; typeId: number }[];
}

function storeWeights(input: SellerHomeInput, goal: GoalRecord, week: StoreWeekHours): number[] {
  const from = somarDias(goal.startsOn, -HISTORY_WEEKS * 7);
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
  return mode === "MINIMUM" ? `${value} por pessoa` : `1º lugar: ${value}`;
}

/** Grupo da pessoa na loja. Sem grupo = so quem tambem esta sem grupo. */
function sellerGroup(input: SellerHomeInput, s: SellerHomeInput["stores"][number]): { shiftId: string | null; name: string | null } | null {
  const mine = input.team.find((m) => m.storeId === s.storeId && m.employeeId === s.employeeId);
  if (!mine) return null;
  return { shiftId: mine.shiftId, name: mine.shiftName };
}

/** Vendedoras do mesmo grupo, do dia 1 ate hoje. Quem ainda nao vendeu entra com zero. */
function monthRanking(input: SellerHomeInput, s: SellerHomeInput["stores"][number]): MonthRankingEntry[] {
  const from = inicioDoMes(input.today);
  const group = sellerGroup(input, s);
  const inGroup = (m: GoalTeamMember) =>
    m.storeId === s.storeId && m.salesPerson && (group == null || m.shiftId === group.shiftId);
  const byEmployee = new Map<number, GoalTeamMember>();
  const totals = new Map<string, { name: string; revenue: number; sales: number; me: boolean }>();
  for (const m of input.team) {
    if (!inGroup(m) || m.employeeId == null) continue;
    byEmployee.set(m.employeeId, m);
    const name = collaboratorName(m.name);
    if (!name) continue;
    totals.set(`e:${m.employeeId}`, { name, revenue: 0, sales: 0, me: m.employeeId === s.employeeId });
  }
  for (const r of input.sellerDayAggs) {
    if (r.storeId !== s.storeId || r.day < from || r.day > input.today || r.sellerEmployeeId == null) continue;
    const member = byEmployee.get(r.sellerEmployeeId);
    if (!member) continue;
    const row = totals.get(`e:${r.sellerEmployeeId}`);
    if (!row) continue;
    row.revenue += r.revenueCents / 100;
    row.sales += r.salesCount;
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
      });
      return {
        id: c.id,
        name: c.name,
        startsOn: c.startsOn,
        endsOn: c.endsOn,
        status: goalStatus(c, input.today),
        prize: prizeLabel(c.prize, c.mode),
        rules: sellerChallengeRules(c),
        ...standing,
      };
    })
    .sort((a, b) => order[a.status] - order[b.status] || a.endsOn.localeCompare(b.endsOn) || a.name.localeCompare(b.name, "pt-BR"));
}

function buildStore(input: SellerHomeInput, s: SellerHomeInput["stores"][number]): SellerHomeStore {
  const base = {
    storeId: s.storeId,
    storeName: s.storeName,
    lastSyncAt: s.lastSyncAt,
    monthRanking: monthRanking(input, s),
    groupName: sellerGroup(input, s)?.name ?? null,
    challenges: storeChallenges(input, s),
  };
  const goal = input.goals.find((g) => g.storeId === s.storeId && goalStatus(g, input.today) === "active");
  if (!goal) return { ...base, goal: null };
  const meKey = `e:${s.employeeId}`;
  const viewInput = { goal, lojaNome: s.storeName, dayAggs: input.dayAggs, sellerDayAggs: input.sellerDayAggs, team: input.team, today: input.today };
  const view = buildGoalCardView(viewInput);
  const me = sellerGoalLevels({ goals: [goal], dayAggs: input.dayAggs, sellerDayAggs: input.sellerDayAggs, team: input.team, today: input.today }).get(meKey) ?? null;
  const row = view.vendedoras.find((r) => r.colaboradorId === meKey);
  const size = row ? groupSize(view, row) : 1;
  let projected: number | null = null;
  if (me) {
    const ontem = buildGoalCardView({ ...viewInput, sellerDayAggs: input.sellerDayAggs.filter((r) => r.day < input.today) });
    const r = ontem.vendedoras.find((x) => x.colaboradorId === meKey);
    const sold = !r ? 0 : me.modo === "individual" ? r.faturamentoValor : (r.atingimentoPct * r.metaIndividualValor) / 100;
    projected = projectedPrize(goal, me, { today: input.today, weights: storeWeights(input, goal, s.week), soldUntilYesterday: sold, groupSize: size });
  }
  const ranking = buildSellerRanking(view, meKey);
  return {
    ...base,
    goal: {
      name: goal.name,
      startsOn: goal.startsOn,
      endsOn: goal.endsOn,
      mode: goal.tierMode === "INDIVIDUAL" ? "individual" : "grupo",
      me,
      nextLevelGain: me ? nextLevelGain(me, size) : null,
      projectedPrize: projected,
      ranking: ranking.entries,
      gapPp: ranking.gapPp,
      abovePosition: ranking.abovePosition,
    },
  };
}

/** Linhas do proprio vendedor (mesma ligacao da meta: codigo, senao nome do cadastro), somadas por loja e dia. */
function sellerDays(input: SellerHomeInput): SellerDay[] {
  const days = new Map<string, SellerDay>();
  for (const s of input.stores) {
    const porNome = new Map<string, GoalTeamMember>();
    for (const m of input.team) if (m.storeId === s.storeId) for (const k of m.nameKeys) if (!porNome.has(k)) porNome.set(k, m);
    for (const r of input.sellerDayAggs) {
      if (r.storeId !== s.storeId) continue;
      const mine = r.sellerEmployeeId != null ? r.sellerEmployeeId === s.employeeId : porNome.get(r.sellerKey)?.employeeId === s.employeeId;
      if (!mine) continue;
      const key = `${s.storeId}|${r.day}`;
      const d = days.get(key) ?? { storeId: s.storeId, day: r.day, revenue: 0, sales: 0, items: 0 };
      d.revenue += r.revenueCents / 100;
      d.sales += r.salesCount;
      d.items = d.items == null || (!r.itemCount && r.salesCount > 0) ? null : d.items + (r.itemCount ?? 0);
      days.set(key, d);
    }
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day) || a.storeId.localeCompare(b.storeId));
}

export function buildSellerHome(input: SellerHomeInput): { stores: SellerHomeStore[]; myDays: SellerDay[] } {
  return { stores: input.stores.map((s) => buildStore(input, s)), myDays: sellerDays(input) };
}
