/**
 * Andamento do desafio para uma pessoa so.
 * A conta e a mesma de `buildChallengeView` (posicao, minimo, vendas minimas).
 * O pacote da tela Inicio leva so a linha da propria pessoa.
 */
import { brlCent, num } from "./format.ts";
import type { GoalTeamMember, SalesSellerDayAgg } from "./goalTypes.ts";
import { goalStatus } from "./goalView.ts";

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
  sellerGeradorId: number;
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
  prizes?: { kind: string }[];
  prize?: { kind: string } | null;
}

interface Acc {
  key: string;
  itens: number;
  valorCents: number;
  vendas: number;
  itensVendas: number;
  faturamentoCents: number;
  semItens: boolean;
}

const usesScope = (m: SellerChallengeMetric) => m === "QUANTITY" || m === "VALUE";
const usesMinSales = (m: SellerChallengeMetric) => m === "PA" || m === "TICKET" || m === "INDEX";
const round2 = (v: number) => Math.round(v * 100) / 100;

function resultLabel(metric: SellerChallengeMetric, value: number): string {
  if (metric === "PA") return num(value, 2);
  if (metric === "INDEX") return num(value, 1);
  if (metric === "TICKET" || metric === "VALUE") return brlCent(value);
  const inteiro = Number.isInteger(value);
  return `${num(value, inteiro ? 0 : 1)} ${value === 1 ? "item" : "itens"}`;
}

function gapAmount(metric: SellerChallengeMetric, diff: number): string {
  if (metric === "PA") return `Falta ${num(diff, 2)} de P.A.`;
  if (metric === "INDEX") {
    const pontos = Math.max(0.1, Math.ceil(diff * 10 - 1e-9) / 10);
    return pontos === 1 ? "Falta 1,0 ponto" : `Faltam ${num(pontos, 1)} pontos`;
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

  const ate = challenge.endsOn < input.today ? challenge.endsOn : input.today;
  const noPeriodo = (r: { storeId: string; day: string }) =>
    r.storeId === challenge.storeId && r.day >= challenge.startsOn && r.day <= ate;
  const team = input.team.filter((m) => m.storeId === challenge.storeId);
  const porCodigo = new Map(team.map((m) => [m.employeeId, m]));
  const porGerador = new Map<number, GoalTeamMember>();
  for (const m of team) if (m.geradorId != null) porGerador.set(m.geradorId, m);
  const porNome = new Map<string, GoalTeamMember>();
  for (const m of team) for (const k of m.nameKeys) if (!porNome.has(k)) porNome.set(k, m);

  const accs = new Map<string, Acc>();
  const acc = (membro: GoalTeamMember | undefined, sellerKey: string): Acc => {
    const key = membro ? `e:${membro.employeeId}` : `n:${sellerKey}`;
    let row = accs.get(key);
    if (!row) {
      row = { key, itens: 0, valorCents: 0, vendas: 0, itensVendas: 0, faturamentoCents: 0, semItens: false };
      accs.set(key, row);
    }
    return row;
  };
  for (const m of team) if (m.salesPerson) acc(m, "");

  const porProduto = usesScope(metric) && scope !== "ALL";
  if (porProduto) {
    const codigos = new Set(challenge.productCodes ?? []);
    const tipos = new Set(challenge.categoryIds ?? []);
    const typeByCode = new Map((input.productTypes ?? []).map((t) => [t.code, t.typeId]));
    const conta = (code: string) => (scope === "PRODUCTS" ? codigos.has(code) : tipos.has(typeByCode.get(code) ?? Number.NaN));
    for (const r of input.products ?? []) {
      if (!noPeriodo(r) || !conta(r.productCode)) continue;
      const membro = porGerador.get(r.sellerGeradorId) ?? porNome.get(r.sellerKey);
      const row = acc(membro, r.sellerKey);
      row.itens += r.itemCount;
      row.valorCents += r.revenueCents;
    }
  }
  for (const r of input.sellerDays) {
    if (!noPeriodo(r)) continue;
    const membro =
      (r.sellerEmployeeId != null ? porCodigo.get(r.sellerEmployeeId) : undefined) ??
      (r.sellerGeradorId != null ? porGerador.get(r.sellerGeradorId) : undefined) ??
      porNome.get(r.sellerKey);
    const row = acc(membro, r.sellerKey);
    row.vendas += r.salesCount;
    row.faturamentoCents += r.revenueCents;
    row.itensVendas += r.itemCount ?? 0;
    if (r.salesCount > 0 && !(r.itemCount && r.itemCount > 0)) row.semItens = true;
  }

  const comVenda = [...accs.values()].filter((a) => a.vendas > 0);
  const indexBlocked = comVenda.some((a) => a.semItens);
  const indexBase = indexBlocked
    ? null
    : (() => {
        if (comVenda.length === 0) return null;
        const media = (f: (a: Acc) => number) => comVenda.reduce((s, a) => s + f(a), 0) / comVenda.length;
        return {
          faturamentoMedio: media((a) => a.faturamentoCents),
          ticket: media((a) => a.faturamentoCents / a.vendas),
          pa: media((a) => a.itensVendas / a.vendas),
        };
      })();

  const resultadoDe = (a: Acc): number | null => {
    if (metric === "INDEX") {
      if (a.vendas <= 0) return 0;
      if (!indexBase) return null;
      const parte = (v: number, ref: number) => (ref > 0 ? v / ref : 0);
      return round2(
        100 * (0.5 * parte(a.faturamentoCents, indexBase.faturamentoMedio) + 0.25 * parte(a.faturamentoCents / a.vendas, indexBase.ticket) + 0.25 * parte(a.itensVendas / a.vendas, indexBase.pa)),
      );
    }
    if (metric === "QUANTITY") return porProduto ? a.itens : a.semItens ? null : a.itensVendas;
    if (metric === "VALUE") return round2((porProduto ? a.valorCents : a.faturamentoCents) / 100);
    if (a.vendas <= 0) return 0;
    if (metric === "PA") return a.semItens ? null : round2(a.itensVendas / a.vendas);
    return round2(a.faturamentoCents / 100 / a.vendas);
  };

  const minVendas = usesMinSales(metric) && challenge.minSales != null ? Math.max(1, challenge.minSales) : 0;
  const base = [...accs.values()].map((a) => ({ a, resultado: resultadoDe(a) }));
  const concorre = (x: { a: Acc; resultado: number | null }) => x.resultado != null && x.resultado > 0 && x.a.vendas >= minVendas;
  const alcancaAlvo = (v: number | null) => v != null && v > 0 && (target == null || v >= target - 1e-9);
  const posicaoDe = new Map<string, number>();
  if (challenge.mode === "CONTEST") {
    const pool = base.filter(concorre).sort((x, y) => (y.resultado ?? 0) - (x.resultado ?? 0));
    pool.forEach((x, i) => {
      const anterior = pool[i - 1];
      posicaoDe.set(x.a.key, anterior && anterior.resultado === x.resultado ? posicaoDe.get(anterior.a.key)! : i + 1);
    });
  }
  const acimaDe = (resultado: number) =>
    base
      .filter((x) => concorre(x) && posicaoDe.has(x.a.key) && x.resultado! > resultado + 1e-9)
      .sort((x, y) => x.resultado! - y.resultado!)[0];

  const mine = accs.get(`e:${input.employeeId}`);
  if (!mine) return empty;
  const resultado = resultadoDe(mine);
  if (resultado == null) return { ...empty, unavailable: true };

  const posicao = posicaoDe.get(mine.key) ?? null;
  let won = false;
  if (challenge.mode === "CONTEST") won = posicao != null && posicao <= prizeCount && alcancaAlvo(resultado);
  else won = alcancaAlvo(resultado) && mine.vendas >= minVendas && target != null;

  let gap: string | null = null;
  let progressPct: number | null = won ? 100 : null;
  if (status === "active") {
    if (mine.vendas < minVendas) {
      gap = gapSales(minVendas - mine.vendas);
      progressPct = bar(mine.vendas, minVendas);
    } else if (challenge.mode === "MINIMUM") {
      if (!won && target != null) {
        gap = `${gapAmount(metric, target - resultado)} para o mínimo`;
        progressPct = bar(resultado, target);
      }
    } else if (target != null && resultado < target - 1e-9) {
      gap = `${gapAmount(metric, target - resultado)} para o mínimo`;
      progressPct = bar(resultado, target);
    } else {
      const acima = acimaDe(resultado);
      if (acima?.resultado != null) {
        gap = `${gapAmount(metric, acima.resultado - resultado)} para o ${posicaoDe.get(acima.a.key)}º lugar`;
        progressPct = bar(resultado, acima.resultado);
      }
    }
  }

  return {
    metricLabel: SELLER_CHALLENGE_METRIC_LABEL[metric],
    result: resultLabel(metric, resultado),
    position: posicao,
    won,
    gap,
    unavailable: false,
    progressPct,
  };
}
