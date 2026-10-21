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
  ALL: "Tudo o que vender",
};

export const CHALLENGE_MODE_LABEL: Record<ChallengeMode, string> = {
  CONTEST: "Quem fizer mais",
  MINIMUM: "Quem atingir o mínimo",
};

export interface ChallengeParticipant {
  key: string;
  name: string;
  group: string | null;
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
   * Índice: índice da equipe contra o período anterior, só quando há meta da gerência.
   */
  teamAverage: number | null;
  management: ChallengeManagerResult | null;
  /** Dias com venda da loja e sem itens por pessoa (produtos/categorias escolhidos). */
  daysIncomplete: string[];
}

const usesMinSales = (m: ChallengeMetric) => m === "PA" || m === "TICKET" || m === "INDEX";
const round2 = (v: number) => Math.round(v * 100) / 100;

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
      const codigos = new Set(c.products.map((p) => p.code));
      const kinds = new Set(c.categories.map((t) => t.typeId));
      const conta = (code: string) =>
        c.scope === "PRODUCTS" ? codigos.has(code) : kinds.has(aggs.typeByCode.get(code) ?? Number.NaN);
      for (const r of aggs.sellerProducts) {
        if (!inPeriod(r)) continue;
        const member = byGenerator.get(r.sellerGeneratorId) ?? byName.get(r.sellerKey);
        if (!onRoster(member, r.day)) continue;
        const a = acc(member, r.sellerKey, r.sellerName);
        if (conta(r.productCode)) {
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

  // P.A. oscila ate o ultimo dia: ninguem "atinge" enquanto o desafio esta aberto.
  const paEmProgress = c.metric === "PA" && status === "active";

  const participants: ChallengeParticipant[] = base.map(({ a, result }) => {
    const position = positionOf.get(a.key) ?? null;
    let winner = false;
    let prize: ChallengePrize | null = null;
    if (status !== "upcoming" && !paEmProgress) {
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
      else if (paEmProgress && alcancaTarget(a, result) && (c.mode === "MINIMUM" || (position != null && position <= c.prizes.length))) {
        gap = "O P.A. só vale no fim do desafio";
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

  let management: ChallengeManagerResult | null = null;
  const managerGoal = c.managerTarget;
  if (c.managerPrize && managerGoal != null && c.metric === "INDEX") {
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
    const result = index == null ? null : round2(index);
    management = {
      result,
      target: managerGoal,
      periodPrevious: janelas.previous,
      atingiu: result != null && result >= managerGoal - 1e-9,
      prize: c.managerPrize,
    };
  } else if (c.managerPrize && managerGoal != null) {
    const result = teamAverageOf();
    management = {
      result,
      target: managerGoal,
      periodPrevious: null,
      atingiu: (c.metric !== "PA" || status === "ended") && result != null && result > 0 && result >= managerGoal - 1e-9,
      prize: c.managerPrize,
    };
  }

  const daysIncomplete: string[] = [];
  if (byProduct && status !== "upcoming") {
    const withItems = new Set(aggs.sellerProducts.filter(inPeriod).map((r) => r.day));
    for (const day of eachDay(c.startsOn, until)) {
      if (aggs.storeSaleDays.has(`${c.storeId}|${day}`) && !withItems.has(day)) daysIncomplete.push(day);
    }
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
    participants,
    reachedCount: c.mode === "MINIMUM" ? participants.filter((p) => p.winner).length : 0,
    teamAverage: c.metric === "INDEX" ? (management?.result ?? null) : teamAverageOf(),
    management,
    daysIncomplete,
  };
}

export interface ChallengeWinner {
  /** `e:código` ou `n:nome` — mesma chave do participante, para a foto. */
  key: string;
  name: string;
  group: string | null;
  /** "1 lugar"  |  "Atingiu" */
  rank: string;
  prize: ChallengePrize;
}

export interface ChallengePayout {
  vencedores: ChallengeWinner[];
  management: ChallengePrize | null;
  /**  premios em R$ (pessoas + gerencia). */
  totalBrl: number;
  /** Outros premios (texto livre), um por vencedor (+ gerencia). */
  especie: string[];
}

export function challengePayout(view: ChallengeView): ChallengePayout {
  const vencedores: ChallengeWinner[] = view.participants
    .filter((p) => p.winner && p.prize)
    .map((p) => ({
      key: p.key,
      name: p.name,
      group: p.group,
      rank: p.position != null ? `${p.position}º lugar` : "Atingiu",
      prize: p.prize!,
    }));
  const management = view.management?.atingiu ? view.management.prize : null;
  const prizes = [...vencedores.map((w) => w.prize), ...(management ? [management] : [])];
  return {
    vencedores,
    management,
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
    prizes: c.prizes.map((p) => ({ ...p })),
    managerPrize: c.managerPrize ? { ...c.managerPrize } : null,
  };
}

/** Copia para "Duplicar para outra loja": mesmas datas e nome; a loja e escolhida no editor. */
export function copyChallengeToStore(c: ChallengeRecord): ChallengeInput {
  const { id: _id, ...rest } = c;
  return {
    ...rest,
    products: c.products.map((p) => ({ ...p })),
    categories: c.categories.map((t) => ({ ...t })),
    prizes: c.prizes.map((p) => ({ ...p })),
    managerPrize: c.managerPrize ? { ...c.managerPrize } : null,
  };
}
