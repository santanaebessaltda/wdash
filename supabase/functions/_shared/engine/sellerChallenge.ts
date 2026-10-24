/**
 * Andamento do desafio para uma pessoa so.
 * A conta e a mesma de `buildChallengeView` (posicao, minimo, vendas minimas).
 * O pacote da tela Inicio leva so a linha da propria pessoa.
 */
import { brlCent, eachDay, num } from "./format.ts";
import type { GoalTeamMember, SalesSellerDayAgg } from "./goalTypes.ts";
import { goalStatus } from "./goalView.ts";
import { presenceDays, scaledMinimum } from "./presence.ts";

export type SellerChallengeMetric = "QUANTITY" | "VALUE" | "PA" | "TICKET" | "INDEX";
export type SellerChallengeScope = "PRODUCTS" | "CATEGORIES" | "ALL";

export const SELLER_CHALLENGE_METRIC_LABEL: Record<SellerChallengeMetric, string> = {
  QUANTITY: "Itens vendidos",
  VALUE: "Faturamento",
  PA: "P.A.",
  TICKET: "Ticket médio",
  INDEX: "Índice de desempenho",
};

export interface SellerProductDay {
  storeId: string;
  day: string;
  sellerGeneratorId: number;
  sellerKey: string;
  sellerName: string;
  productCode: string;
  itemCount: number;
  revenueCents: number;
}

export interface SellerChallengeStanding {
  metricLabel: string;
  /** null = a comecar, ou indisponivel (ver `unavailable`). */
  result: string | null;
  position: number | null;
  won: boolean;
  /** So em andamento. Mesma frase do detalhe do desafio. */
  gap: string | null;
  unavailable: boolean;
  /** 0 - 100 rumo ao que falta (minimo, posicao de cima ou vendas para participar). null quando nao ha regua. */
  progressPct: number | null;
}

type ChallengePrizeShape = { kind: string; amount?: number; label?: string };

interface ChallengeShape {
  storeId: string;
  startsOn: string;
  endsOn: string;
  mode: "CONTEST" | "MINIMUM";
  metric?: SellerChallengeMetric;
  scope?: SellerChallengeScope;
  productCodes?: string[];
  categoryIds?: number[];
  target?: number | null;
  minSales?: number | null;
  prizes?: ChallengePrizeShape[];
  prize?: ChallengePrizeShape | null;
}

const ORDINAL = ["1º", "2º", "3º"] as const;

const METRIC_HOW: Record<SellerChallengeMetric, string> = {
  QUANTITY: "O resultado é a quantidade de itens que você vender no período.",
  VALUE: "O resultado é o faturamento das suas vendas no período.",
  PA: "O resultado é o seu P.A. (itens por venda), calculado no fim do desafio. Até lá, o número pode mudar.",
  TICKET: "O resultado é o seu ticket médio (valor médio por venda), calculado no fim do desafio. Até lá, o número pode mudar.",
  INDEX:
    "O índice compara seu faturamento, ticket e P.A. com a média da filial no período (100 = na média). Ele só vale no fim do desafio. Até lá, o número pode mudar.",
};

function prizeText(p: ChallengePrizeShape): string {
  if (p.kind === "MONEY") return brlCent(p.amount ?? 0);
  const label = (p.label ?? "").trim();
  return label || "Prêmio";
}

function metricFloorLabel(metric: SellerChallengeMetric, value: number): string {
  if (metric === "PA") return num(value, 2);
  if (metric === "INDEX") return num(value, 1);
  if (metric === "TICKET" || metric === "VALUE") return brlCent(value);
  const integer = Number.isInteger(value);
  return `${num(value, integer ? 0 : 1)} ${value === 1 ? "item" : "itens"}`;
}

/** Piso do desafio no mesmo formato do resultado ("10 itens", "R$ 100,00"). */
export function challengeFloorLabel(metric: SellerChallengeMetric, value: number): string {
  return metricFloorLabel(metric, value);
}

/**
 * Regras do desafio em linguagem da vendedora (card Início).
 * Ordem: como ganha → o que conta → piso / vendas mínimas → prêmios.
 */
export function sellerChallengeRules(challenge: ChallengeShape): string[] {
  const metric = challenge.metric ?? "QUANTITY";
  const scope = challenge.scope ?? "ALL";
  const target = challenge.target ?? null;
  const prizes = challenge.prizes?.length ? challenge.prizes : challenge.prize ? [challenge.prize] : [];
  const rules: string[] = [];

  if (challenge.mode === "MINIMUM") {
    rules.push("Todas as pessoas que atingirem o mínimo ganham o prêmio.");
  } else {
    rules.push(
      "Ganha quem tiver o melhor resultado. Em empate, as empatadas recebem o prêmio da posição e a seguinte é pulada.",
    );
  }

  rules.push(METRIC_HOW[metric]);

  if (usesScope(metric)) {
    if (scope === "PRODUCTS") {
      const n = challenge.productCodes?.length ?? 0;
      rules.push(n > 0 ? `Contam só os ${n} ${n === 1 ? "produto escolhido" : "produtos escolhidos"} pelo gestor.` : "Contam só os produtos escolhidos pelo gestor.");
    } else if (scope === "CATEGORIES") {
      const n = challenge.categoryIds?.length ?? 0;
      rules.push(n > 0 ? `Contam só as ${n} ${n === 1 ? "categoria escolhida" : "categorias escolhidas"} pelo gestor.` : "Contam só as categorias escolhidas pelo gestor.");
    } else {
      rules.push("Conta tudo o que você vender na loja.");
    }
  }

  if (usesMinSales(metric) && challenge.minSales != null && challenge.minSales >= 1) {
    const n = Math.round(challenge.minSales);
    rules.push(n === 1 ? "Precisa de pelo menos 1 venda para participar." : `Precisa de pelo menos ${num(n)} vendas para participar.`);
  }

  if (target != null && target > 0) {
    const floor = metricFloorLabel(metric, target);
    rules.push(
      challenge.mode === "MINIMUM"
        ? `Mínimo para ganhar: ${floor}.`
        : `Para receber prêmio na disputa, precisa de pelo menos ${floor}.`,
    );
  }

  if (prizes.length > 0) {
    if (challenge.mode === "MINIMUM") {
      rules.push(`Prêmio: ${prizeText(prizes[0]!)} por pessoa.`);
    } else {
      const list = prizes
        .slice(0, ORDINAL.length)
        .map((p, i) => `${ORDINAL[i]} ${prizeText(p)}`)
        .join(" · ");
      rules.push(`Prêmios: ${list}.`);
    }
  }

  return rules;
}

interface Acc {
  key: string;
  items: number;
  amountCents: number;
  sales: number;
  itemsSales: number;
  revenueCents: number;
  withoutItems: boolean;
}

const usesScope = (m: SellerChallengeMetric) => m === "QUANTITY" || m === "VALUE";
const usesMinSales = (m: SellerChallengeMetric) => m === "PA" || m === "TICKET" || m === "INDEX";
const settlesAtEnd = (m: SellerChallengeMetric) => m === "PA" || m === "TICKET" || m === "INDEX";
const round2 = (v: number) => Math.round(v * 100) / 100;

function pendingAtEnd(metric: SellerChallengeMetric): string {
  if (metric === "TICKET") return "O ticket médio só vale no fim do desafio";
  if (metric === "INDEX") return "O índice só vale no fim do desafio";
  return "O P.A. só vale no fim do desafio";
}

function resultLabel(metric: SellerChallengeMetric, value: number): string {
  if (metric === "PA") return num(value, 2);
  if (metric === "INDEX") return num(value, 1);
  if (metric === "TICKET" || metric === "VALUE") return brlCent(value);
  const integer = Number.isInteger(value);
  return `${num(value, integer ? 0 : 1)} ${value === 1 ? "item" : "itens"}`;
}

function gapAmount(metric: SellerChallengeMetric, diff: number): string {
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

function bar(part: number, whole: number): number | null {
  if (!(whole > 0)) return null;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}

/** Linha da pessoa no desafio. `employeeId` = codigo no Millennium. */
export function challengeStanding(
  challenge: ChallengeShape,
  input: {
    today: string;
    employeeId: number;
    team: GoalTeamMember[];
    sellerDays: SalesSellerDayAgg[];
    products?: SellerProductDay[];
    productTypes?: { code: string; typeId: number }[];
  },
): SellerChallengeStanding {
  const metric = challenge.metric ?? "QUANTITY";
  const scope = challenge.scope ?? "ALL";
  const target = challenge.target ?? null;
  const prizeCount = (challenge.prizes ?? (challenge.prize ? [challenge.prize] : [])).length;
  const status = goalStatus(challenge, input.today);
  const empty: SellerChallengeStanding = {
    metricLabel: SELLER_CHALLENGE_METRIC_LABEL[metric],
    result: null,
    position: null,
    won: false,
    gap: null,
    unavailable: false,
    progressPct: null,
  };
  if (status === "upcoming") return empty;

  const until = challenge.endsOn < input.today ? challenge.endsOn : input.today;
  const inPeriod = (r: { storeId: string; day: string }) =>
    r.storeId === challenge.storeId && r.day >= challenge.startsOn && r.day <= until;
  const team = input.team.filter((m) => m.storeId === challenge.storeId);
  const byCode = new Map(team.map((m) => [m.employeeId, m]));
  const byGenerator = new Map<number, GoalTeamMember>();
  for (const m of team) if (m.generatorId != null) byGenerator.set(m.generatorId, m);
  const byName = new Map<string, GoalTeamMember>();
  for (const m of team) for (const k of m.nameKeys) if (!byName.has(k)) byName.set(k, m);

  const periodDays = eachDay(challenge.startsOn, challenge.endsOn).length;
  const lastSale = new Map<number, string>();
  for (const r of input.sellerDays) {
    if (!inPeriod(r) || r.sellerEmployeeId == null || (r.revenueCents <= 0 && r.salesCount <= 0)) continue;
    const prev = lastSale.get(r.sellerEmployeeId);
    if (!prev || r.day > prev) lastSale.set(r.sellerEmployeeId, r.day);
  }
  for (const r of input.products ?? []) {
    if (!inPeriod(r) || r.itemCount <= 0) continue;
    const member = byGenerator.get(r.sellerGeneratorId) ?? byName.get(r.sellerKey);
    if (!member) continue;
    const prev = lastSale.get(member.employeeId);
    if (!prev || r.day > prev) lastSale.set(member.employeeId, r.day);
  }
  const presenceOf = new Map<number, Set<string>>();
  for (const m of team) {
    presenceOf.set(
      m.employeeId,
      new Set(
        presenceDays(
          challenge.startsOn,
          challenge.endsOn,
          { admittedOn: m.admittedOn ?? null, departedOn: m.departedOn ?? null, active: m.salesPerson },
          lastSale.get(m.employeeId) ?? null,
        ),
      ),
    );
  }
  const onRoster = (member: GoalTeamMember | undefined, day: string) =>
    !member || (presenceOf.get(member.employeeId)?.has(day) ?? false);
  const mineMember = byCode.get(input.employeeId);
  const personalTarget =
    challenge.mode === "MINIMUM" && target != null
      ? scaledMinimum(target, presenceOf.get(input.employeeId)?.size ?? (mineMember ? 0 : periodDays), periodDays)
      : target;

  const accs = new Map<string, Acc>();
  const acc = (member: GoalTeamMember | undefined, sellerKey: string): Acc => {
    const key = member ? `e:${member.employeeId}` : `n:${sellerKey}`;
    let row = accs.get(key);
    if (!row) {
      row = { key, items: 0, amountCents: 0, sales: 0, itemsSales: 0, revenueCents: 0, withoutItems: false };
      accs.set(key, row);
    }
    return row;
  };
  for (const m of team) if ((presenceOf.get(m.employeeId)?.size ?? 0) > 0) acc(m, "");

  const byProduct = usesScope(metric) && scope !== "ALL";
  if (byProduct) {
    const codigos = new Set(challenge.productCodes ?? []);
    const kinds = new Set(challenge.categoryIds ?? []);
    const typeByCode = new Map((input.productTypes ?? []).map((t) => [t.code, t.typeId]));
    const conta = (code: string) => (scope === "PRODUCTS" ? codigos.has(code) : kinds.has(typeByCode.get(code) ?? Number.NaN));
    for (const r of input.products ?? []) {
      if (!inPeriod(r) || !conta(r.productCode)) continue;
      const member = byGenerator.get(r.sellerGeneratorId) ?? byName.get(r.sellerKey);
      if (!onRoster(member, r.day)) continue;
      const row = acc(member, r.sellerKey);
      row.items += r.itemCount;
      row.amountCents += r.revenueCents;
    }
  }
  for (const r of input.sellerDays) {
    if (!inPeriod(r)) continue;
    const member =
      (r.sellerEmployeeId != null ? byCode.get(r.sellerEmployeeId) : undefined) ??
      (r.sellerGeneratorId != null ? byGenerator.get(r.sellerGeneratorId) : undefined) ??
      byName.get(r.sellerKey);
    if (!onRoster(member, r.day)) continue;
    const row = acc(member, r.sellerKey);
    row.sales += r.salesCount;
    row.revenueCents += r.revenueCents;
    row.itemsSales += r.itemCount ?? 0;
    if (r.salesCount > 0 && !(r.itemCount && r.itemCount > 0)) row.withoutItems = true;
  }

  const withSale = [...accs.values()].filter((a) => a.sales > 0);
  const indexBlocked = withSale.some((a) => a.withoutItems);
  const indexBase = indexBlocked
    ? null
    : (() => {
        if (withSale.length === 0) return null;
        const media = (f: (a: Acc) => number) => withSale.reduce((s, a) => s + f(a), 0) / withSale.length;
        return {
          revenueAverage: media((a) => a.revenueCents),
          ticket: media((a) => a.revenueCents / a.sales),
          pa: media((a) => a.itemsSales / a.sales),
        };
      })();

  const resultOf = (a: Acc): number | null => {
    if (metric === "INDEX") {
      if (a.sales <= 0) return 0;
      if (!indexBase) return null;
      const parte = (v: number, ref: number) => (ref > 0 ? v / ref : 0);
      return round2(
        100 * (0.5 * parte(a.revenueCents, indexBase.revenueAverage) + 0.25 * parte(a.revenueCents / a.sales, indexBase.ticket) + 0.25 * parte(a.itemsSales / a.sales, indexBase.pa)),
      );
    }
    if (metric === "QUANTITY") return byProduct ? a.items : a.withoutItems ? null : a.itemsSales;
    if (metric === "VALUE") return round2((byProduct ? a.amountCents : a.revenueCents) / 100);
    if (a.sales <= 0) return 0;
    if (metric === "PA") return a.withoutItems ? null : round2(a.itemsSales / a.sales);
    return round2(a.revenueCents / 100 / a.sales);
  };

  const minSales = usesMinSales(metric) && challenge.minSales != null ? Math.max(1, challenge.minSales) : 0;
  const base = [...accs.values()].map((a) => ({ a, result: resultOf(a) }));
  const concorre = (x: { a: Acc; result: number | null }) => x.result != null && x.result > 0 && x.a.sales >= minSales;
  const alcancaTarget = (v: number | null) => v != null && v > 0 && (personalTarget == null || v >= personalTarget - 1e-9);
  const positionOf = new Map<string, number>();
  if (challenge.mode === "CONTEST") {
    const pool = base.filter(concorre).sort((x, y) => (y.result ?? 0) - (x.result ?? 0));
    pool.forEach((x, i) => {
      const previous = pool[i - 1];
      positionOf.set(x.a.key, previous && previous.result === x.result ? positionOf.get(previous.a.key)! : i + 1);
    });
  }
  const aboveOf = (result: number) =>
    base
      .filter((x) => concorre(x) && positionOf.has(x.a.key) && x.result! > result + 1e-9)
      .sort((x, y) => x.result! - y.result!)[0];

  const mine = accs.get(`e:${input.employeeId}`);
  if (!mine) return empty;
  const result = resultOf(mine);
  if (result == null) return { ...empty, unavailable: true };

  const position = positionOf.get(mine.key) ?? null;
  const fechaNoEnd = settlesAtEnd(metric) && status === "active";
  let won = false;
  if (!fechaNoEnd) {
    if (challenge.mode === "CONTEST") won = position != null && position <= prizeCount && alcancaTarget(result);
    else won = alcancaTarget(result) && mine.sales >= minSales && target != null;
  }

  let gap: string | null = null;
  let progressPct: number | null = won ? 100 : null;
  if (status === "active") {
    if (mine.sales < minSales) {
      gap = gapSales(minSales - mine.sales);
      progressPct = bar(mine.sales, minSales);
    } else if (fechaNoEnd && alcancaTarget(result) && (challenge.mode === "MINIMUM" || (position != null && position <= prizeCount))) {
      gap = pendingAtEnd(metric);
      progressPct = personalTarget != null ? bar(result, personalTarget) : null;
    } else if (challenge.mode === "MINIMUM") {
      if (!won && personalTarget != null) {
        gap = `${gapAmount(metric, personalTarget - result)} para o mínimo`;
        progressPct = bar(result, personalTarget);
      }
    } else if (target != null && result < target - 1e-9) {
      gap = `${gapAmount(metric, target - result)} para o mínimo`;
      progressPct = bar(result, target);
    } else {
      const above = aboveOf(result);
      if (above?.result != null) {
        gap = `${gapAmount(metric, above.result - result)} para o ${positionOf.get(above.a.key)}º lugar`;
        progressPct = bar(result, above.result);
      }
    }
  }

  return {
    metricLabel: SELLER_CHALLENGE_METRIC_LABEL[metric],
    result: resultLabel(metric, result),
    position: position,
    won,
    gap,
    unavailable: false,
    progressPct,
  };
}
