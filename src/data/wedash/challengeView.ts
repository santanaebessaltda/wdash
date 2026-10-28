import { brlCent, collaboratorName, shortDate, isoToDate, eachDay, num, addDays } from "@/lib/format";
import {
  managerIndexWindows,
  usesScope,
  type ChallengeAggInput,
  type DayRange,
  type ChallengeInput,
  type ChallengeMetric,
  type ChallengeMode,
  type ChallengePrize,
  type ChallengeRecord,
  type ChallengeScope,
} from "./challengesRepo";
import type { GoalTeamMember } from "./goalsRepo";
import type { SalesSellerDayAgg } from "./salesTypes";
import { goalStatus, prazoRemaining, type GoalStatus } from "./goalView";
import { presenceDays, scaledMinimum } from "./engine/presence";
import { productInLines } from "./productLines";

export type ChallengeStatus = GoalStatus;

export const CHALLENGE_STATUS_LABEL: Record<ChallengeStatus, string> = {
  active: "Em andamento",
  upcoming: "A começar",
  ended: "Encerrado",
};

export const CHALLENGE_METRIC_LABEL: Record<ChallengeMetric, string> = {
  QUANTITY: "Itens vendidos",
  VALUE: "Faturamento",
  PA: "P.A.",
  TICKET: "Ticket médio",
  INDEX: "Índice de desempenho",
};

/** Pesos do Indice de desempenho (somam 1). */
export const INDEX_WEIGHTS = { revenue: 0.5, ticket: 0.25, pa: 0.25 } as const;

export interface IndexTeamBase {
  /** Faturamento medio por pessoa (so quem vendeu). */
  revenueAverage: number;
  /** Media dos tickets individuais (nao o ticket consolidado: quem vende mais nao pesa mais). */
  ticket: number;
  /** Media dos P.A.s individuais. */
  pa: number;
}

/** Medias simples entre quem vendeu  ->  a media dos indices dessas pessoas e exatamente 100. */
export function indexTeamBase(people: { revenue: number; sales: number; items: number }[]): IndexTeamBase | null {
  const withSale = people.filter((p) => p.sales > 0);
  if (withSale.length === 0) return null;
  const media = (f: (p: (typeof withSale)[number]) => number) => withSale.reduce((s, p) => s + f(p), 0) / withSale.length;
  return {
    revenueAverage: media((p) => p.revenue),
    ticket: media((p) => p.revenue / p.sales),
    pa: media((p) => p.items / p.sales),
  };
}

/** Faturamento em R$ ou centavos  -  so precisa ser a mesma unidade da base. */
export function performanceIndex(p: { revenue: number; sales: number; items: number }, base: IndexTeamBase): number {
  if (p.sales <= 0) return 0;
  const parte = (v: number, ref: number) => (ref > 0 ? v / ref : 0);
  const w = INDEX_WEIGHTS;
  return (
    100 *
    (w.revenue * parte(p.revenue, base.revenueAverage) +
      w.ticket * parte(p.revenue / p.sales, base.ticket) +
      w.pa * parte(p.items / p.sales, base.pa))
  );
}

export interface IndexPersonTotals {
  revenue: number;
  sales: number;
  items: number;
  withoutItems: boolean;
}

/**
 * Indice da equipe (gerencia): mesma formula, com as medias da equipe agora x as do periodo anterior.
 * 100 = igual ao periodo anterior. Sem venda em algum lado ou com dia sem itens = null (nada estimado).
 */
export function teamIndex(current: IndexPersonTotals[], previous: IndexPersonTotals[]): number | null {
  if ([...current, ...previous].some((p) => p.sales > 0 && p.withoutItems)) return null;
  const a = indexTeamBase(current);
  const b = indexTeamBase(previous);
  if (!a || !b) return null;
  const parte = (v: number, ref: number) => (ref > 0 ? v / ref : 0);
  const w = INDEX_WEIGHTS;
  return (
    100 *
    (w.revenue * parte(a.revenueAverage, b.revenueAverage) +
      w.ticket * parte(a.ticket, b.ticket) +
      w.pa * parte(a.pa, b.pa))
  );
}

export const CHALLENGE_SCOPE_LABEL: Record<ChallengeScope, string> = {
  PRODUCTS: "Produtos escolhidos",
  CATEGORIES: "Categorias escolhidas",
  LINES: "Agregações escolhidas",
  ALL: "Tudo o que vender",
};

/** Produto entra no desafio de quantidade ou valor. */
function productCounts(c: ChallengeRecord, aggs: ChallengeAggInput, code: string, fallbackName?: string): boolean {
  if (c.scope === "PRODUCTS") return c.products.some((product) => product.code === code);
  if (c.scope === "CATEGORIES") return c.categories.some((category) => category.typeId === aggs.typeByCode.get(code));
  if (c.scope === "LINES") return productInLines(aggs.nameByCode.get(code) || fallbackName, c.lines);
  return false;
}

export const CHALLENGE_MODE_LABEL: Record<ChallengeMode, string> = {
  CONTEST: "Quem fizer mais",
  MINIMUM: "Quem atingir o mínimo",
  COLLECTIVE: "A equipe junta",
};

export interface ChallengeParticipant {
  key: string;
  name: string;
  group: string | null;
  /** CARGO no Millennium. Null = sem cargo gravado. */
  role: string | null;
  /** null = a comecar ou P.A. sem itens gravados (" - "). */
  result: number | null;
  sales: number;
  /** Disputa: posicao entre quem concorre (empate compartilha). */
  position: number | null;
  /** Disputa: venceu  |  Minimo: atingiu. */
  winner: boolean;
  prize: ChallengePrize | null;
  /** So em andamento. */
  gap: string | null;
  /** Dias do desafio em que a pessoa participa. */
  eligibleDays: number;
  periodDays: number;
}

export interface ChallengeCollectiveResult {
  /** Total da filial. Índice: a filial contra o período anterior. */
  result: number | null;
  target: number;
  periodPrevious: { from: string; to: string } | null;
  atingiu: boolean;
  prize: ChallengePrize;
  /** Vendedores que dividem o prêmio em R$. */
  recipients: { key: string; name: string; group: string | null; role: string | null }[];
}

export interface ChallengeManagerResult {
  /** Media da equipe (Indice: indice da equipe x periodo anterior). */
  result: number | null;
  target: number;
  /** So no Indice: periodo anterior inteiro usado na comparacao. */
  periodPrevious: { from: string; to: string } | null;
  atingiu: boolean;
  prize: ChallengePrize;
}

export interface ChallengeView {
  mode: ChallengeMode;
  status: ChallengeStatus;
  prazo: string;
  /** Encerrado ontem: o ultimo dia fecha na madrugada e ainda pode mudar. */
  emClosing: boolean;
  participants: ChallengeParticipant[];
  /** Minimo: quantas pessoas atingiram. */
  reachedCount: number;
  /**
   * Média da equipe, a mesma conta da gerência.
   * Itens e faturamento: soma ÷ pessoas (quem zerou entra).
   * P.A.: itens ÷ vendas. Ticket: faturamento ÷ vendas.
   * Índice: índice da equipe contra o período anterior, quando há meta da gerência ou do operador de caixa.
   */
  teamAverage: number | null;
  management: ChallengeManagerResult | null;
  /** Mesma conta da gerência, com meta e prêmio próprios. */
  cashier: ChallengeManagerResult | null;
  /** A filial contra um mínimo. Null nos outros modos. */
  collective: ChallengeCollectiveResult | null;
  /** Dias com venda da loja e sem itens por pessoa (produtos/categorias escolhidos). */
  daysIncomplete: string[];
}

const usesMinSales = (m: ChallengeMetric) => m === "PA" || m === "TICKET" || m === "INDEX";
/** P.A., ticket e índice mudam até o último dia: o prêmio só existe com o período fechado. */
const settlesAtEnd = (m: ChallengeMetric) => m === "PA" || m === "TICKET" || m === "INDEX";
const round2 = (v: number) => Math.round(v * 100) / 100;

function pendingAtEnd(metric: ChallengeMetric): string {
  if (metric === "TICKET") return "O ticket médio só vale no fim do desafio";
  if (metric === "INDEX") return "O índice só vale no fim do desafio";
  return "O P.A. só vale no fim do desafio";
}

function daysBetween(start: string, end: string): number {
  return Math.round((isoToDate(end).getTime() - isoToDate(start).getTime()) / 86_400_000) + 1;
}

/** 12 itens  |  1 item  |  7,5 itens  |  1,85  |  R$ 92,30  |  112,4 (indice) */
export function metricValueLabel(metric: ChallengeMetric, value: number): string {
  if (metric === "PA") return num(value, 2);
  if (metric === "INDEX") return num(value, 1);
  if (metric === "TICKET" || metric === "VALUE") return brlCent(value);
  const integer = Number.isInteger(value);
  return `${num(value, integer ? 0 : 1)} ${value === 1 ? "item" : "itens"}`;
}

export function prizeLabel(p: ChallengePrize): string {
  return p.kind === "MONEY" ? brlCent(p.amount) : p.label;
}

function gapLabel(metric: ChallengeMetric, diff: number): string {
  if (metric === "PA") return `Falta ${num(diff, 2)} de P.A.`;
  if (metric === "INDEX") {
    const points = Math.max(0.1, Math.ceil(diff * 10 - 1e-9) / 10);
    return points === 1 ? "Falta 1,0 ponto" : `Faltam ${num(points, 1)} pontos`;
  }
  if (metric === "TICKET") return `Faltam ${brlCent(diff)} de ticket médio`;
  if (metric === "VALUE") return `Faltam ${brlCent(diff)}`;
  const n = Math.ceil(diff - 1e-9);
  return n === 1 ? "Falta 1 item" : `Faltam ${num(n)} itens`;
}

const gapSales = (n: number) => (n === 1 ? "Falta 1 venda para participar" : `Faltam ${num(n)} vendas para participar`);

interface Acc {
  key: string;
  name: string;
  group: string | null;
  role: string | null;
  eligibleDays: number;
  /** Itens e R$ dos produtos/categorias escolhidos. */
  items: number;
  amountCents: number;
  sales: number;
  itemsSales: number;
  revenueCents: number;
  withoutItems: boolean;
}

export function buildChallengeView(args: {
  challenge: ChallengeRecord;
  aggs: ChallengeAggInput;
  today: string;
}): ChallengeView {
  const { challenge: c, aggs, today } = args;
  const status = goalStatus(c, today);
  const until = c.endsOn < today ? c.endsOn : today;
  const inPeriod = (r: { storeId: string; day: string }) => r.storeId === c.storeId && r.day >= c.startsOn && r.day <= until;

  const team = aggs.team.filter((m) => m.storeId === c.storeId);
  const byCode = new Map(team.map((m) => [m.employeeId, m]));
  const byGenerator = new Map<number, GoalTeamMember>();
  for (const m of team) if (m.generatorId != null) byGenerator.set(m.generatorId, m);
  const byName = new Map<string, GoalTeamMember>();
  for (const m of team) for (const k of m.nameKeys) if (!byName.has(k)) byName.set(k, m);

  const periodDays = eachDay(c.startsOn, c.endsOn).length;
  const lastSale = new Map<number, string>();
  if (status !== "upcoming") {
    for (const r of aggs.sellerDays) {
      if (!inPeriod(r) || r.sellerEmployeeId == null || (r.revenueCents <= 0 && r.salesCount <= 0)) continue;
      const prev = lastSale.get(r.sellerEmployeeId);
      if (!prev || r.day > prev) lastSale.set(r.sellerEmployeeId, r.day);
    }
    for (const r of aggs.sellerProducts) {
      if (!inPeriod(r) || r.itemCount <= 0) continue;
      const member = byGenerator.get(r.sellerGeneratorId) ?? byName.get(r.sellerKey);
      if (!member) continue;
      const prev = lastSale.get(member.employeeId);
      if (!prev || r.day > prev) lastSale.set(member.employeeId, r.day);
    }
  }
  const presenceOf = new Map<number, Set<string>>();
  for (const m of team) {
    presenceOf.set(
      m.employeeId,
      new Set(
        presenceDays(
          c.startsOn,
          c.endsOn,
          { admittedOn: m.admittedOn ?? null, departedOn: m.departedOn ?? null, active: m.salesPerson },
          lastSale.get(m.employeeId) ?? null,
        ),
      ),
    );
  }
  const onRoster = (member: GoalTeamMember | undefined, day: string) =>
    !member || (presenceOf.get(member.employeeId)?.has(day) ?? false);

  const accs = new Map<string, Acc>();
  const acc = (member: GoalTeamMember | undefined, sellerKey: string, sellerName: string): Acc => {
    const key = member ? `e:${member.employeeId}` : `n:${sellerKey}`;
    let a = accs.get(key);
    if (!a) {
      a = {
        key,
        name: collaboratorName(member?.name ?? (sellerName || sellerKey)),
        group: member?.shiftName ?? null,
        role: member?.role ?? null,
        eligibleDays: member ? (presenceOf.get(member.employeeId)?.size ?? 0) : periodDays,
        items: 0,
        amountCents: 0,
        sales: 0,
        itemsSales: 0,
        revenueCents: 0,
        withoutItems: false,
      };
      accs.set(key, a);
    }
    return a;
  };

  for (const m of team) if ((presenceOf.get(m.employeeId)?.size ?? 0) > 0) acc(m, "", m.name);

  const memberOfDay = (r: SalesSellerDayAgg): GoalTeamMember | undefined =>
    (r.sellerEmployeeId != null ? byCode.get(r.sellerEmployeeId) : undefined) ??
    (r.sellerGeneratorId != null ? byGenerator.get(r.sellerGeneratorId) : undefined) ??
    byName.get(r.sellerKey);

  const byProduct = usesScope(c.metric) && c.scope !== "ALL";
  if (status !== "upcoming") {
    if (byProduct) {
      for (const r of aggs.sellerProducts) {
        if (!inPeriod(r)) continue;
        const member = byGenerator.get(r.sellerGeneratorId) ?? byName.get(r.sellerKey);
        if (!onRoster(member, r.day)) continue;
        const a = acc(member, r.sellerKey, r.sellerName);
        if (productCounts(c, aggs, r.productCode)) {
          a.items += r.itemCount;
          a.amountCents += r.revenueCents;
        }
      }
    }
    for (const r of aggs.sellerDays) {
      if (!inPeriod(r)) continue;
      const member = memberOfDay(r);
      if (!onRoster(member, r.day)) continue;
      const a = acc(member, r.sellerKey, r.sellerName);
      a.sales += r.salesCount;
      a.revenueCents += r.revenueCents;
      a.itemsSales += r.itemCount ?? 0;
      if (r.salesCount > 0 && !(r.itemCount && r.itemCount > 0)) a.withoutItems = true;
    }
  }

  const indexBase: IndexTeamBase | null = [...accs.values()].some((a) => a.sales > 0 && a.withoutItems)
    ? null
    : indexTeamBase([...accs.values()].map((a) => ({ revenue: a.revenueCents, sales: a.sales, items: a.itemsSales })));

  const resultOf = (a: Acc): number | null => {
    if (status === "upcoming") return null;
    if (c.metric === "INDEX") {
      if (a.sales <= 0) return 0;
      return indexBase
        ? round2(performanceIndex({ revenue: a.revenueCents, sales: a.sales, items: a.itemsSales }, indexBase))
        : null;
    }
    if (c.metric === "QUANTITY") return byProduct ? a.items : a.withoutItems ? null : a.itemsSales;
    if (c.metric === "VALUE") return round2((byProduct ? a.amountCents : a.revenueCents) / 100);
    if (a.sales <= 0) return 0;
    if (c.metric === "PA") return a.withoutItems ? null : round2(a.itemsSales / a.sales);
    return round2(a.revenueCents / 100 / a.sales);
  };

  const minSales = usesMinSales(c.metric) && c.minSales != null ? Math.max(1, c.minSales) : 0;
  const base = [...accs.values()].map((a) => ({ a, result: resultOf(a) }));
  const concorre = (x: { a: Acc; result: number | null }) =>
    x.result != null && x.result > 0 && x.a.sales >= minSales;
  const floorOf = (a: Acc) => (c.mode === "MINIMUM" && c.target != null ? scaledMinimum(c.target, a.eligibleDays, periodDays) : c.target);
  const alcancaTarget = (a: Acc, v: number | null) => {
    const floor = floorOf(a);
    return v != null && v > 0 && (floor == null || v >= floor - 1e-9);
  };

  const positionOf = new Map<string, number>();
  if (c.mode === "CONTEST" && status !== "upcoming") {
    const pool = base.filter(concorre).sort((x, y) => (y.result ?? 0) - (x.result ?? 0));
    pool.forEach((x, i) => {
      const previous = pool[i - 1];
      positionOf.set(x.a.key, previous && previous.result === x.result ? positionOf.get(previous.a.key)! : i + 1);
    });
  }

  const amountsAbove = base
    .filter((x) => concorre(x) && positionOf.has(x.a.key))
    .map((x) => ({ amount: x.result!, position: positionOf.get(x.a.key)! }));

  // P.A., ticket e índice oscilam até o último dia: ninguém ganha enquanto o desafio está aberto.
  const openUntilEnd = settlesAtEnd(c.metric) && status === "active";

  const participants: ChallengeParticipant[] = base.map(({ a, result }) => {
    const position = positionOf.get(a.key) ?? null;
    let winner = false;
    let prize: ChallengePrize | null = null;
    if (status !== "upcoming" && !openUntilEnd) {
      if (c.mode === "CONTEST") {
        winner = position != null && position <= c.prizes.length && alcancaTarget(a, result);
        prize = winner ? (c.prizes[position! - 1] ?? null) : null;
      } else {
        winner = alcancaTarget(a, result) && a.sales >= minSales && c.target != null;
        prize = winner ? (c.prizes[0] ?? null) : null;
      }
    }

    let gap: string | null = null;
    if (status === "active" && result != null) {
      if (a.sales < minSales) gap = gapSales(minSales - a.sales);
      else if (openUntilEnd && alcancaTarget(a, result) && (c.mode === "MINIMUM" || (position != null && position <= c.prizes.length))) {
        gap = pendingAtEnd(c.metric);
      } else if (c.mode === "MINIMUM") {
        const floor = floorOf(a);
        if (!winner && floor != null) gap = `${gapLabel(c.metric, floor - result)} para o mínimo`;
      } else if (c.target != null && result < c.target - 1e-9) {
        gap = `${gapLabel(c.metric, c.target - result)} para o mínimo`;
      } else {
        const above = amountsAbove
          .filter((v) => v.amount > result + 1e-9)
          .sort((x, y) => x.amount - y.amount)[0];
        if (above) gap = `${gapLabel(c.metric, above.amount - result)} para o ${above.position}º lugar`;
      }
    }

    return {
      key: a.key,
      name: a.name,
      group: a.group,
      role: a.role,
      result,
      sales: a.sales,
      position,
      winner,
      prize,
      gap,
      eligibleDays: a.eligibleDays,
      periodDays,
    };
  });

  participants.sort((x, y) => {
    if (status !== "upcoming") {
      if (c.mode === "CONTEST") {
        const px = x.position ?? Number.POSITIVE_INFINITY;
        const py = y.position ?? Number.POSITIVE_INFINITY;
        if (px !== py) return px - py;
      } else if (x.winner !== y.winner) return x.winner ? -1 : 1;
      const rx = x.result ?? Number.NEGATIVE_INFINITY;
      const ry = y.result ?? Number.NEGATIVE_INFINITY;
      if (rx !== ry) return ry - rx;
    }
    return x.name.localeCompare(y.name, "pt-BR");
  });

  const teamAverageOf = (): number | null => {
    if (status === "upcoming" || c.metric === "INDEX") return null;
    const all = [...accs.values()];
    const sales = all.reduce((s, a) => s + a.sales, 0);
    if (usesScope(c.metric)) {
      const byPerson = all.map(resultOf);
      if (byPerson.some((v) => v == null)) return null;
      return all.length > 0 ? round2(byPerson.reduce<number>((s, v) => s + (v ?? 0), 0) / all.length) : 0;
    }
    if (c.metric === "PA") {
      if (all.some((a) => a.withoutItems)) return null;
      return sales > 0 ? round2(all.reduce((s, a) => s + a.itemsSales, 0) / sales) : 0;
    }
    return sales > 0 ? round2(all.reduce((s, a) => s + a.revenueCents, 0) / 100 / sales) : 0;
  };

  const collectiveMode = c.mode === "COLLECTIVE";
  const storeSold = new Set(aggs.storeSaleDays);
  for (const day of aggs.storeDays) {
    if (day.storeId === c.storeId && day.brand === "ALL" && (day.revenueCents > 0 || day.salesCount > 0)) {
      storeSold.add(`${day.storeId}|${day.day}`);
    }
  }

  const storeSlice = (from: string, to: string) => {
    let revenueCents = 0;
    let sales = 0;
    let items = 0;
    let withoutItems = false;
    const productDays = new Set<string>();
    const byProduct = usesScope(c.metric) && c.scope !== "ALL";
    if (byProduct) {
      for (const row of aggs.storeProducts) {
        if (row.storeId !== c.storeId || row.day < from || row.day > to) continue;
        productDays.add(row.day);
        const chosen = productCounts(c, aggs, row.productCode, row.productName);
        if (!chosen) continue;
        items += row.itemCount;
        revenueCents += row.revenueCents;
      }
    }
    for (const day of aggs.storeDays) {
      if (day.storeId !== c.storeId || day.brand !== "ALL" || day.day < from || day.day > to) continue;
      if (!byProduct) {
        revenueCents += day.revenueCents;
        items += day.itemCount;
      }
      sales += day.salesCount;
      if (day.salesCount > 0 && day.itemCount <= 0) withoutItems = true;
    }
    let incomplete = false;
    if (byProduct && status !== "upcoming") {
      for (const day of eachDay(from, to)) {
        if (storeSold.has(`${c.storeId}|${day}`) && !productDays.has(day)) incomplete = true;
      }
    }
    return { revenueCents, sales, items, withoutItems, incomplete };
  };

  const storeNumber = (from: string, to: string): { result: number | null; sales: number } => {
    if (status === "upcoming") return { result: null, sales: 0 };
    const slice = storeSlice(from, to);
    if (slice.incomplete) return { result: null, sales: slice.sales };
    const chosen = usesScope(c.metric) && c.scope !== "ALL";
    if (c.metric === "QUANTITY") return { result: !chosen && slice.withoutItems ? null : slice.items, sales: slice.sales };
    if (c.metric === "VALUE") return { result: round2(slice.revenueCents / 100), sales: slice.sales };
    if (slice.sales <= 0) return { result: 0, sales: 0 };
    if (c.metric === "PA") return { result: slice.withoutItems ? null : round2(slice.items / slice.sales), sales: slice.sales };
    return { result: round2(slice.revenueCents / 100 / slice.sales), sales: slice.sales };
  };

  let indexBundle: { result: number | null; periodPrevious: { from: string; to: string } | null } | null = null;
  const wantsPeopleIndex =
    !collectiveMode &&
    c.metric === "INDEX" &&
    ((c.managerPrize != null && c.managerTarget != null) || (c.cashierPrize != null && c.cashierTarget != null));
  const wantsStoreIndex = collectiveMode && c.metric === "INDEX";
  if (wantsPeopleIndex) {
    const janelas = managerIndexWindows(c, today);
    const peopleIn = (j: DayRange) => {
      const m = new Map<string, IndexPersonTotals>();
      for (const r of aggs.sellerDays) {
        if (r.storeId !== c.storeId || r.day < j.from || r.day > j.to) continue;
        const member = memberOfDay(r);
        const key = member ? `e:${member.employeeId}` : r.sellerKey ? `n:${r.sellerKey}` : null;
        if (!key) continue;
        const p = m.get(key) ?? { revenue: 0, sales: 0, items: 0, withoutItems: false };
        p.revenue += r.revenueCents;
        p.sales += r.salesCount;
        p.items += r.itemCount ?? 0;
        if (r.salesCount > 0 && !(r.itemCount && r.itemCount > 0)) p.withoutItems = true;
        m.set(key, p);
      }
      return [...m.values()];
    };
    const index =
      status === "upcoming" || !janelas.current || !janelas.comparado
        ? null
        : teamIndex(peopleIn(janelas.current), peopleIn(janelas.comparado));
    indexBundle = { result: index == null ? null : round2(index), periodPrevious: janelas.previous };
  } else if (wantsStoreIndex) {
    const janelas = managerIndexWindows(c, today);
    const asPeople = (from: string, to: string): IndexPersonTotals[] => {
      const slice = storeSlice(from, to);
      if (slice.sales <= 0) return [];
      return [{ revenue: slice.revenueCents, sales: slice.sales, items: slice.items, withoutItems: slice.withoutItems || slice.incomplete }];
    };
    const index =
      status === "upcoming" || !janelas.current || !janelas.comparado
        ? null
        : teamIndex(asPeople(janelas.current.from, janelas.current.to), asPeople(janelas.comparado.from, janelas.comparado.to));
    indexBundle = { result: index == null ? null : round2(index), periodPrevious: janelas.previous };
  }

  const storeNow = collectiveMode && c.metric !== "INDEX" ? storeNumber(c.startsOn, until) : null;

  const roleResult = (prize: ChallengePrize | null, goal: number | null): ChallengeManagerResult | null => {
    if (!prize || goal == null) return null;
    if (c.metric === "INDEX") {
      const result = indexBundle?.result ?? null;
      return {
        result,
        target: goal,
        periodPrevious: indexBundle?.periodPrevious ?? null,
        atingiu: status === "ended" && result != null && result >= goal - 1e-9,
        prize,
      };
    }
    const result = collectiveMode ? (storeNow?.result ?? null) : teamAverageOf();
    return {
      result,
      target: goal,
      periodPrevious: null,
      atingiu: (!settlesAtEnd(c.metric) || status === "ended") && result != null && result > 0 && result >= goal - 1e-9,
      prize,
    };
  };

  const management = roleResult(c.managerPrize, c.managerTarget);
  const cashier = roleResult(c.cashierPrize, c.cashierTarget);

  const daysIncomplete: string[] = [];
  if (byProduct && status !== "upcoming" && !collectiveMode) {
    const withItems = new Set(aggs.sellerProducts.filter(inPeriod).map((r) => r.day));
    for (const day of eachDay(c.startsOn, until)) {
      if (storeSold.has(`${c.storeId}|${day}`) && !withItems.has(day)) daysIncomplete.push(day);
    }
  }
  if (byProduct && status !== "upcoming" && collectiveMode) {
    const withItems = new Set(aggs.storeProducts.filter(inPeriod).map((r) => r.day));
    for (const day of eachDay(c.startsOn, until)) {
      if (storeSold.has(`${c.storeId}|${day}`) && !withItems.has(day)) daysIncomplete.push(day);
    }
  }

  const recipients = team
    .filter((member) => member.salesPerson && (presenceOf.get(member.employeeId)?.size ?? 0) > 0)
    .map((member) => ({
      key: `e:${member.employeeId}`,
      name: collaboratorName(member.name),
      group: member.shiftName ?? null,
      role: member.role ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.key.localeCompare(b.key));

  let collective: ChallengeCollectiveResult | null = null;
  let shown = participants;
  if (collectiveMode && c.target != null && c.prizes[0]) {
    const measured = c.metric === "INDEX" ? { result: indexBundle?.result ?? null, sales: storeSlice(c.startsOn, until).sales } : storeNow;
    const result = measured?.result ?? null;
    const sales = measured?.sales ?? 0;
    const openUntilEndTeam = settlesAtEnd(c.metric) && status === "active";
    collective = {
      result,
      target: c.target,
      periodPrevious: c.metric === "INDEX" ? (indexBundle?.periodPrevious ?? null) : null,
      atingiu:
        status !== "upcoming" &&
        !openUntilEndTeam &&
        result != null &&
        result > 0 &&
        sales >= minSales &&
        result >= c.target - 1e-9,
      prize: c.prizes[0],
      recipients,
    };
    shown = recipients.map((person) => ({
      key: person.key,
      name: person.name,
      group: person.group,
      role: person.role,
      result: null,
      sales: 0,
      position: null,
      winner: false,
      prize: null,
      gap: null,
      eligibleDays: 0,
      periodDays,
    }));
  }

  const prazo =
    status === "active"
      ? prazoRemaining(daysBetween(today, c.endsOn))
      : status === "upcoming"
        ? `Começa em ${shortDate(c.startsOn)}`
        : "Encerrado";

  return {
    mode: c.mode,
    status,
    prazo,
    emClosing: status === "ended" && today <= addDays(c.endsOn, 1),
    participants: shown,
    reachedCount: c.mode === "MINIMUM" ? participants.filter((p) => p.winner).length : 0,
    teamAverage: collective ? collective.result : c.metric === "INDEX" ? (management?.result ?? cashier?.result ?? null) : teamAverageOf(),
    management,
    cashier,
    collective,
    daysIncomplete,
  };
}

export interface ChallengeWinner {
  /** `e:código` ou `n:nome` — mesma chave do participante, para a foto. */
  key: string;
  name: string;
  group: string | null;
  role: string | null;
  /** "1º lugar" | "Ganhou" */
  rank: string;
  prize: ChallengePrize;
}

export interface ChallengePayout {
  vencedores: ChallengeWinner[];
  management: ChallengePrize | null;
  cashier: ChallengePrize | null;
  /** Prêmio da equipe, uma vez. O valor em R$ é dividido na carteira. */
  collective: ChallengePrize | null;
  /** Premios em R$ (pessoas + gerencia + operador de caixa), cada um uma vez. */
  totalBrl: number;
  /** Outros premios (texto livre), um por vencedor, mais gerencia e operador de caixa. */
  especie: string[];
}

export function challengePayout(view: ChallengeView): ChallengePayout {
  const vencedores: ChallengeWinner[] = view.participants
    .filter((p) => p.winner && p.prize)
    .map((p) => ({
      key: p.key,
      name: p.name,
      group: p.group,
      role: p.role,
      rank: p.position != null ? `${p.position}º lugar` : "Ganhou",
      prize: p.prize!,
    }));
  const management = view.management?.atingiu ? view.management.prize : null;
  const cashier = view.cashier?.atingiu ? view.cashier.prize : null;
  const collective = view.collective?.atingiu ? view.collective.prize : null;
  const prizes = [...vencedores.map((w) => w.prize), ...(management ? [management] : []), ...(cashier ? [cashier] : []), ...(collective ? [collective] : [])];
  return {
    vencedores,
    management,
    cashier,
    collective,
    totalBrl: prizes.reduce((s, p) => s + (p.kind === "MONEY" ? p.amount : 0), 0),
    especie: prizes.flatMap((p) => (p.kind === "ITEM" ? [p.label] : [])),
  };
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/** Resumo do card da listagem: lider(es) na Disputa  |  quantas atingiram no Minimo. */
export function challengeCardSummary(view: ChallengeView): { leader: string | null; reachedCount: number | null } {
  if (view.mode === "MINIMUM") return { leader: null, reachedCount: view.status === "upcoming" ? null : view.reachedCount };
  const leaders = view.participants.filter((p) => p.position === 1).map((p) => p.name);
  return { leader: leaders.length > 0 ? joinNames(leaders) : null, reachedCount: null };
}

/** Copia para "Duplicar desafio": comeca no dia seguinte ao fim, com a mesma duracao. */
export function copyChallenge(c: ChallengeRecord): ChallengeInput {
  const { id: _id, ...rest } = c;
  const duration = daysBetween(c.startsOn, c.endsOn);
  const startsOn = addDays(c.endsOn, 1);
  return {
    ...rest,
    name: `${c.name} (cópia)`,
    startsOn,
    endsOn: addDays(startsOn, duration - 1),
    products: c.products.map((p) => ({ ...p })),
    categories: c.categories.map((t) => ({ ...t })),
    lines: c.lines.map((line) => ({ ...line, kinds: [...line.kinds] })),
    prizes: c.prizes.map((p) => ({ ...p })),
    managerPrize: c.managerPrize ? { ...c.managerPrize } : null,
    cashierPrize: c.cashierPrize ? { ...c.cashierPrize } : null,
  };
}

/** Copia para "Duplicar para outra loja": mesmas datas e nome; a loja e escolhida no editor. */
export function copyChallengeToStore(c: ChallengeRecord): ChallengeInput {
  const { id: _id, ...rest } = c;
  return {
    ...rest,
    products: c.products.map((p) => ({ ...p })),
    categories: c.categories.map((t) => ({ ...t })),
    lines: c.lines.map((line) => ({ ...line, kinds: [...line.kinds] })),
    prizes: c.prizes.map((p) => ({ ...p })),
    managerPrize: c.managerPrize ? { ...c.managerPrize } : null,
    cashierPrize: c.cashierPrize ? { ...c.cashierPrize } : null,
  };
}
