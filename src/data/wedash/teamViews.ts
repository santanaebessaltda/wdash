/**
 * Camada de visoes da aba Equipe (EQUIP-01..07). Mesma arquitetura da Visao
 * geral: `montarEquipeView(escopo)` calcula tudo e a pagina so monta blocos.
 * Fica em arquivo proprio porque vendas.ts consome o cadastro de colaboradores
 * (equipe.ts) no boot  -  importar a camada de views daqui evita ciclo.
 *
 * Regra AD-046: meta, escada, premiacao e desafios sao SEMPRE do mes da
 * competencia (mes corrente, ou mes passado se o filtro for "Mes passado") e
 * permanecem visiveis. Os 4 KPIs de desempenho obedecem ao periodo filtrado.
 * Quando o periodo = competencia, um aviso deixa o recorte explicito.
 */
import { eligibleSeller, collaboratorsOfStore, collaboratorById, type Collaborator } from "./team";
import { goalOfStore, goalsOfStore, type Tier, type GoalBrand } from "./goals";
import {
  challengeManagerTarget,
  challengeIsIndex,
  challengesInScope,
  averageProgress,
  challengeFloor,
  cappedManagerProgress,
  individualProgress,
  type Challenge,
} from "./challenges";
import { TODAY_ISO, CURRENT_HOUR } from "./clock";
import { dayAggregate, salesDay, storeOpen, sumAggregates, type Aggregate } from "./sales";
import { storeById, stores, groups, type Store } from "./stores";
import { brlK, revenueCurve, seriesAxisForPeriod, kpiDelta, previousPeriod, resolvePeriod, seriesAxisLabel, type Scope, type ResolvedPeriod, type BlockState } from "./dashboard";
import { brl, shortDate, isoToDate, endOfMonth, shortHour, eachDay, monthYear, num, dayCountLabel, addDays } from "@/lib/format";
import type { TintKey } from "@/pages/dashboards/icons";
import type { GoalCardView, NetworkGlobalGoal, SellerRow } from "./engine/goalTypes";

export type { GoalCardView, NetworkGlobalGoal, SellerRow } from "./engine/goalTypes";

const STORE_TINTS: TintKey[] = ["acc", "ok", "info", "warn", "bad"];

function divSeguro(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

/* ------------------------- Elegibilidade e meta individual (EQUIP-03) ------------------------- */

/** Vendedora elegivel presente na loja no dia (admissao  dia < inatividade). */
export function presentOnDay(c: Collaborator, iso: string): boolean {
  if (!eligibleSeller(c)) return false;
  if (c.hiredAt > iso) return false;
  if (c.inactiveAt && c.inactiveAt <= iso) return false;
  return true;
}

/** Dias abertos da loja em que a vendedora estava presente, dentro do intervalo. */
function eligibleDays(c: Collaborator, branch: Store, start: string, end: string): string[] {
  const first = c.hiredAt > start ? c.hiredAt : start;
  const last = c.inactiveAt && c.inactiveAt <= end ? addDays(c.inactiveAt, -1) : end;
  if (first > last) return [];
  return eachDay(first, last).filter((iso) => storeOpen(branch, iso));
}

/** Vendedoras elegiveis presentes na loja no mes (base de listas e somas). */
export function sellersOfStore(storeId: string, competence: string): Collaborator[] {
  const firstMonth = `${competence}-01`;
  return collaboratorsOfStore(storeId).filter((c) => presentOnDay(c, firstMonth) || presentOnDay(c, TODAY_ISO));
}

export interface IndividualGoal {
  amount: number;
  /** Admissao ou inatividade no meio do mes: meta proporcional aos dias elegiveis. */
  proportional: boolean;
  eligibleDays: number;
  /** Dias abertos da loja no mes inteiro  -  base da proporcionalidade. */
  openDaysInMonth: number;
}

/**
 * Meta individual derivada: meta da loja distribuida pelo peso de venda das
 * elegiveis. Periodo parcial (admissao/inatividade no meio do mes): o peso
 * fica proporcional aos dias elegiveis e a meta e redistribuida entre todas  - 
 * a soma das individuais fecha com a meta da loja em qualquer composicao.
 */
export function individualGoal(c: Collaborator, storeId: string, competence: string): IndividualGoal | null {
  const goal = goalOfStore(storeId, competence);
  if (!goal) return null;
  const branch = storeById(storeId);
  const firstMonth = `${competence}-01`;
  const lastMonth = endOfMonth(firstMonth);
  const eligibleMonth = sellersOfStore(storeId, competence);
  if (eligibleMonth.length === 0) return null;

  const openDaysInMonth = eachDay(firstMonth, lastMonth).filter((iso) => storeOpen(branch, iso)).length;
  const days = eligibleDays(c, branch, firstMonth, lastMonth);
  const weightAdjusted = c.saleWeight * (openDaysInMonth > 0 ? days.length / openDaysInMonth : 0);
  const sumWeightsAdjusted = eligibleMonth.reduce((s, x) => {
    const d = eligibleDays(x, branch, firstMonth, lastMonth);
    return s + x.saleWeight * (openDaysInMonth > 0 ? d.length / openDaysInMonth : 0);
  }, 0);
  if (sumWeightsAdjusted <= 0) return null;
  const amount = (goal.storeAmount * weightAdjusted) / sumWeightsAdjusted;
  return { amount, proportional: days.length < openDaysInMonth, eligibleDays: days.length, openDaysInMonth };
}

/* ------------------------- Agregado por vendedora (EQUIP-02) ------------------------- */

export interface SellerAggregate {
  employeeId: string;
  revenue: number;
  salesCount: number;
  items: number;
  daysWorked: number;
}

/** Agregado da vendedora no periodo (respeitando a fracao do dia de hoje). */
export function sellerAggregateForPeriod(c: Collaborator, storeId: string, start: string, end: string): SellerAggregate {
  const out = { employeeId: c.id, revenue: 0, salesCount: 0, items: 0, daysWorked: 0 };
  for (const iso of eachDay(start, end)) {
    if (!presentOnDay(c, iso)) continue;
    const day = salesDay(storeId, iso);
    if (!day) continue;
    // Hoje incompleto: o gerador ja trunca porHora na hora atual; o total do
    // dia, nao. Recorte a fatia da vendedora pela fracao do dia realizada.
    const hourMax = iso === TODAY_ISO ? CURRENT_HOUR : undefined;
    const dayTotal = dayAggregate(day, null, hourMax);
    const ofDay = day.bySeller[c.id];
    if (!ofDay || dayTotal.revenue <= 0) continue;
    const fr = dayTotal.revenue / day.total.revenue;
    const revenue = Math.round(ofDay.revenue * fr);
    const salesCount = Math.round(ofDay.salesCount * fr);
    const items = Math.round(ofDay.items * fr);
    if (revenue > 0 || salesCount > 0) out.daysWorked += 1;
    out.revenue += revenue;
    out.salesCount += salesCount;
    out.items += items;
  }
  return out;
}

/* ------------------------- Escada de degraus (EQUIP-04) ------------------------- */

export interface LadderRow {
  /** Degrau alcancado (maior minPct  atingimento); null antes do primeiro. */
  tier: Tier | null;
  /** Premiacao da escada: realizado x pct do degrau  100 (paga como premiacao, AD-041). */
  prizeAmount: number;
  /** Bonus do degrau  -  so entra quando o degrau e alcancado. */
  bonus: number;
  /** Proximo degrau, quanto falta e o que ele passa a pagar; null no ultimo. */
  next: { name: string; gapAmount: number; prizePct: number; bonus: number; minAttainmentPct: number } | null;
}

/** Escada de degraus da Meta customizada da filial (nao a padrao global). */
export function tiersOfStore(storeId: string, competence: string): Tier[] {
  return goalOfStore(storeId, competence)?.tiers ?? [];
}

/**
 * Posicao na escada: degrau alcancado pelo atingimento individual, premiacao
 * acumulada e bonus, e quanto falta pro proximo degrau. Sem degrau a
 * premiacao e 0  -  a vendedora so premia ao entrar no primeiro degrau.
 * (O usuario paga tudo como premiacao, nao como comissao  -  AD-041.)
 */
export function sellerLadder(
  achieved: number,
  personGoal: IndividualGoal | null,
  tiers: Tier[],
): LadderRow | null {
  if (!personGoal || personGoal.amount <= 0) return null;
  const atingPct = (achieved / personGoal.amount) * 100;
  let tier: Tier | null = null;
  for (const d of tiers) {
    if (atingPct >= d.minAttainmentPct) tier = d;
    else break;
  }
  const idx = tier ? tiers.indexOf(tier) : -1;
  const prizeAmount = tier ? (achieved * tier.commissionPct) / 100 : 0;
  const bonus = tier ? tier.bonus : 0;
  const following = idx + 1 < tiers.length ? tiers[idx + 1] : null;
  const next = following
    ? {
        name: following.name,
        gapAmount: Math.max(0, (personGoal.amount * following.minAttainmentPct) / 100 - achieved),
        prizePct: following.commissionPct,
        bonus: following.bonus,
        minAttainmentPct: following.minAttainmentPct,
      }
    : null;
  return { tier, prizeAmount, bonus, next };
}

/* ------------------------- Tipos da visao ------------------------- */

export interface TeamKpiValue {
  amount: string;
  delta: { value: string; positive: boolean; vs?: string } | undefined;
  /** Linha auxiliar sob o valor (mesmo padrao VG/Fin/Prod). */
  sub?: string;
  /** Serie diaria (reservada; KPIs da Equipe nao renderizam sparkline). */
  series?: number[];
}

export interface ChallengeParticipantView {
  employeeId: string;
  name: string;
  /** Fantasia da loja  -  util na visao rede. */
  store: string;
  /** Nome do grupo (Grupo 1/Grupo 2) ou " - " se sem grupo. */
  group: string;
  progress: number;
  /** Piso/alvo contra o qual a barra e medida. */
  target: number;
  progressPct: number;
  /** Ex.: "8/15 un"  |  "1,85/1,90"  |  "R$ 178/R$ 185". */
  progressLabel: string;
  status: "reached" | "near" | "below" | "notStarted";
}

export interface ChallengeView {
  id: string;
  name: string;
  /** Objetivo + meta + minimo + premio concatenados (estilo Projects.desc). */
  description: string;
  objective: string;
  /** Ex.: "15 un" / "1,90" / "R$ 185"  -  so o valor (o verbo fica no objetivo). */
  goalLabel: string;
  /** Valor minimo configurado (null = sem piso explicito). */
  minimum: number | null;
  /** Se ha minimo discriminado no card (minimo != null). */
  hasMinimum: boolean;
  kind: Challenge["kind"];
  /** Cor do icone de fogo no card (CSS color / token). */
  colorIcon: string;
  individualTarget: number;
  unit: Challenge["unit"];
  /** Premio da vendedora que fechar. */
  prize: number;
  /** Premio do gerente se a regra de N vendedoras fechar. */
  prizeManager: number;
  /** Quantas vendedoras precisam atingir (parametrizacao do gerente). */
  minimumSellersAtingindo: number;
  participants: number;
  engaged: number;
  /**
   * Progresso agregado: un/R$ = soma capped (regra A); pa/ticket = media da equipe.
   */
  aggregatedProgress: number;
  /**
   * Alvo agregado: un/R$ = piso x N gerente; pa/ticket = o proprio piso (ex.: 1,90).
   */
  targetAgregado: number;
  progressPct: number;
  /** Ex.: "6/9 un"  -  progresso da meta do gerente. */
  aggregatedProgressLabel: string;
  /** Quantas participantes ja atingiram o alvo individual. */
  reachedCount: number;
  projectedAgregado: number;
  fechaNoPace: boolean;
  withoutEngagement: boolean;
  kindText: string;
  /** Dias restantes (ativo), dias ate comecar (agendado) ou 0 (encerrado). */
  daysRemaining: number;
  /** Rotulo do badge de prazo: "15d"  |  "Em 5d"  |  "Encerrado". */
  prazoLabel: string;
  /** Janela do desafio, ex.: "01/09  -  15/09". */
  janelaLabel: string;
  /** Tom do prazo: ok=ativo, muted=a comecar, bad=encerrado. */
  prazoTone: "ok" | "bad" | "muted";
  /** Status temporal do desafio. */
  statusLabel: "Ativo" | "Encerrado" | "A começar";
  statusVariant: "success" | "danger" | "neutral" | "warning" | "info";
  /** Loja dona (`null` = rede). */
  storeId: string | null;
  /** Rotulo curto da loja (ex.: "Campo Grande") ou "Rede". */
  storeLabel: string;
  /** Exibir loja no card (visao Todas as lojas). */
  showStore: boolean;
  /** Todos os participantes, ordenados: atingiu  ->  quase  ->  abaixo  ->  nao comecou. */
  ranking: ChallengeParticipantView[];
}

export interface StoreTeamSummary {
  storeId: string;
  name: string;
  tint: TintKey;
  revenue: string;
  ticket: string;
  pa: string;
  projectedPrize: string;
  /** Meta da loja na competencia (0 se sem meta). */
  goalAmount: number;
  /** Realizado da loja no periodo. */
  achievedAmount: number;
  /** Meta da loja / meta global x 100 (0 se meta global = 0). */
  networkGoalPct: number;
  best: { name: string; attainmentPct: number } | null;
  worst: { name: string; attainmentPct: number } | null;
}

export interface TeamBlockStates {
  kpis: BlockState;
  reading: BlockState;
  sellers: BlockState;
  challenges: BlockState;
}

export interface TeamView {
  scope: Scope;
  period: ResolvedPeriod;
  scopeView: "store" | "network";
  competence: string;
  /** Ha meta na competencia: escada/premiacao/desafios entram (AD-046  -  independente do filtro de periodo). */
  activeGoal: boolean;
  competenceNotice: string | null;
  notices: string[];
  kpiRevenue: TeamKpiValue;
  kpiSalesCount: TeamKpiValue;
  kpiTicket: TeamKpiValue;
  kpiPA: TeamKpiValue;
  /**
   * Premiacao projetada  -  VERBA UNICA (decisao do usuario: paga tudo como
   * premiacao, nunca como comissao): escada de metas + premios dos desafios
   * que fecham. null sem meta ativa (vira 4 KPIs).
   */
  kpiPrize: TeamKpiValue | null;
  networkGoal: NetworkGlobalGoal | null;
  /** Uma entrada por meta ativa no escopo (loja principal + metas de marca, etc.). */
  goalCardsList: GoalCardView[];
  reading: string | null;
  /** Serie acumulada Realizado x Meta (mesmo padrao da Visao Geral). */
  revenueEvolution?: { label: string; achieved: number; goal: number }[];
  /** Subtitulo do eixo (ex.: "Este mes  |  por dia"). */
  seriesLabel?: string;
  /** Grupos da loja/rede (ex.: Grupo 1, Grupo 2) para o filtro do header. */
  availableGroups: { id: string; name: string }[];
  sellers: SellerRow[] | null;
  storeRows: StoreTeamSummary[] | null;
  challenges: ChallengeView[] | null;
  states: TeamBlockStates;
}

/* ------------------------- Loja: KPIs e lista ------------------------- */

/** Agregado da loja no periodo, com o dia de hoje truncado na hora atual. */
function storeAggregate(storeId: string, start: string, end: string): Aggregate {
  return sumAggregates(
    eachDay(start, end).map((iso) => {
      const day = salesDay(storeId, iso);
      if (!day) return { revenue: 0, salesCount: 0, items: 0 };
      return dayAggregate(day, null, iso === TODAY_ISO ? CURRENT_HOUR : undefined);
    }),
  );
}

/** Tendencia: ultimos 7 dias vs. 7 anteriores da vendedora; 5% = estavel. */
function sellerTrend(c: Collaborator, storeId: string, endIso: string): SellerRow["trend"] {
  const sum = (start: string, end: string) =>
    eachDay(start, end).reduce((s, iso) => s + sellerAggregateForPeriod(c, storeId, iso, iso).revenue, 0);
  const ultimos = sum(addDays(endIso, -6), endIso);
  const previous = sum(addDays(endIso, -13), addDays(endIso, -7));
  if (previous <= 0 || ultimos <= 0) return "flat";
  const v = ((ultimos - previous) / previous) * 100;
  if (v > 5) return "up";
  if (v < -5) return "down";
  return "flat";
}

/**
 * Fatores relativos de ritmo entre vendedoras (demo do ranking).
 * So redistribuem o faturamento **ja gerado**  -  a soma das linhas permanece
 * igual a soma bruta, entao Progresso da Meta ( linhas) fecha com o ranking.
 * f1 (Shopping CG) no mock de set/26 esta no Hiper (N3 100% da meta);
 * fatores espalham vendedoras entre N1 - N4 (Desafio = 110%).
 */
const DEMO_FACTOR_PACE: Record<string, number> = {
  // f1  -  Campo Grande (loja no Hiper / N3)
  c01: 1.25,
  c02: 1.15,
  c03: 1.08,
  c04: 1.0,
  c05: 0.9,
  c07: 0.8,
  c08: 0.55,
  // f2  -  Tres Lagoas (ritmo normal)
  c11: 1.65,
  c12: 1.4,
  c13: 1.2,
  c14: 1.0,
  c15: 0.8,
  c16: 0.9,
  c17: 0.65,
  c18: 0.45,
};

function sellersView(storeId: string, period: ResolvedPeriod, activeGoal: boolean, competence: string): SellerRow[] {
  const branch = storeById(storeId);
  const storeAgg = storeAggregate(storeId, period.start, period.end);
  const storeAvgItems = divSeguro(storeAgg.items, storeAgg.salesCount);
  const tiers = tiersOfStore(storeId, competence);
  const eligible = sellersOfStore(storeId, competence);

  // 1 passagem: agregado real por vendedora (fonte unica de R$).
  const gross = eligible.map((c) => {
    const ag = sellerAggregateForPeriod(c, storeId, period.start, period.end);
    return { c, ag };
  });
  const sumGross = gross.reduce((s, x) => s + x.ag.revenue, 0);
  const sumWeight = gross.reduce((s, x) => {
    const revenue = Math.max(0, x.ag.revenue);
    const factor = DEMO_FACTOR_PACE[x.c.id] ?? 1;
    return s + revenue * factor;
  }, 0);

  return gross
    .map(({ c, ag: agRaw }) => {
    const personGoal = activeGoal ? individualGoal(c, storeId, competence) : null;

    // Redistribui o mesmo bolo: fat_i = soma x (fat_bruta x fator) / (...).
    let revenue = agRaw.revenue;
    let salesCount = agRaw.salesCount;
    let items = agRaw.items;
    if (sumGross > 0 && sumWeight > 0) {
      const factor = DEMO_FACTOR_PACE[c.id] ?? 1;
      const revenueTarget = Math.round((sumGross * Math.max(0, agRaw.revenue) * factor) / sumWeight);
      if (agRaw.revenue > 0 && revenueTarget !== agRaw.revenue) {
        const scale = revenueTarget / agRaw.revenue;
        revenue = revenueTarget;
        salesCount = Math.max(revenueTarget > 0 ? 1 : 0, Math.round(agRaw.salesCount * scale));
        items = Math.max(salesCount, Math.round(agRaw.items * scale));
      } else if (agRaw.revenue === 0 && revenueTarget > 0) {
        revenue = revenueTarget;
        salesCount = Math.max(1, Math.round(revenueTarget / 120));
        items = Math.round(salesCount * 1.5);
      }
    }

    const ticket = divSeguro(revenue, salesCount);
    const pa = divSeguro(items, salesCount);
    const trend = sellerTrend(c, storeId, period.end);

    // Projecao do fechamento individual: realizado escalado pela fracao da
    // curva de receita ja decorrida da competencia (mesma base do Dashboard).
    const closed = endOfMonth(`${competence}-01`) < TODAY_ISO;
    let finalProjection = 0;
    if (personGoal && personGoal.amount > 0 && !closed) {
      const curve = revenueCurve([branch], competence);
      let accumulatedShare = 0;
      for (const iso of eachDay(`${competence}-01`, TODAY_ISO)) accumulatedShare += curve.weight(iso);
      if (accumulatedShare > 0) finalProjection = revenue / accumulatedShare;
    }
    const atingProjPct = personGoal && personGoal.amount > 0 ? (finalProjection / personGoal.amount) * 100 : 0;

    // Escada no MTD = o que ja garantiu (mesma base do Progresso da Meta).
    // Projecao alimenta so premiacao projetada / atingimentoProjetadoPct.
    const ladderToDate = personGoal ? sellerLadder(revenue, personGoal, tiers) : null;
    const ladderPace =
      personGoal && !closed && finalProjection > 0 ? sellerLadder(finalProjection, personGoal, tiers) : null;
    const ladderShown = ladderToDate;

    const projectedTier = ladderPace?.tier ?? null;

    // Premiacao projetada individual (EQUIP-04): projecao x pct do degrau
    // projetado + bonus ja garantido. Mes fechado: o que de fato veio.
    const projectedIndividualPrize =
      personGoal && personGoal.amount > 0
        ? closed
          ? (ladderToDate?.prizeAmount ?? 0) + (ladderToDate?.bonus ?? 0)
          : finalProjection > 0
            ? (finalProjection * (projectedTier?.commissionPct ?? 0)) / 100 + (ladderToDate?.bonus ?? 0)
            : null
        : null;

    // Ponto de atencao  -  um por vendedora, prioridade do mockup: P.A. 5%
    // abaixo da media da loja  ->  tendencia caindo (com leitura de ritmo).
    let attention: SellerRow["attention"] = null;
    if (personGoal && personGoal.amount > 0) {
      const paBelowPct = storeAvgItems > 0 && pa > 0 && pa < storeAvgItems * 0.95 ? (pa / storeAvgItems - 1) * 100 : null;
      if (paBelowPct !== null) {
        attention = { kind: "pa", text: `P.A. ${num(pa, 2)}`, detail: `${num(Math.abs(paBelowPct), 0)}% abaixo` };
      } else if (trend === "down") {
        attention =
          atingProjPct < 100
            ? { kind: "ritmo", text: "Ritmo", detail: `projeta ${num(atingProjPct, 0)}% da meta` }
            : { kind: "ritmo", text: "Ritmo", detail: "caindo, mas fecha no ritmo" };
      }
    }

    const storeGoal = activeGoal ? goalOfStore(storeId, competence)?.storeAmount ?? 0 : 0;
    const levelIdx = ladderShown?.tier ? tiers.indexOf(ladderShown.tier) : -1;

    return {
      employeeId: c.id,
      name: c.name,
      storeId,
      storeName: branch.tradeName,
      group: c.groupId ? groups.find((t) => t.id === c.groupId)?.name ?? "Sem grupo" : "Sem grupo",
      revenueAmount: revenue,
      revenue: brl(revenue),
      salesCount,
      ticketAmount: ticket,
      ticket: brl(ticket),
      paAmount: pa,
      pa: num(pa, 2),
      daysWorked: agRaw.daysWorked,
      trend,
      individualGoalAmount: personGoal?.amount ?? 0,
      proportionalGoal: personGoal?.proportional ?? false,
      eligibleDays: personGoal?.eligibleDays ?? 0,
      periodDays: personGoal?.openDaysInMonth ?? 0,
      attainmentPct: personGoal && personGoal.amount > 0 ? (revenue / personGoal.amount) * 100 : 0,
      barPct:
        personGoal && personGoal.amount > 0
          ? Math.min(100, (revenue / personGoal.amount) * 100 / Math.max(...tiers.map((d) => d.minAttainmentPct), 100) * 100)
          : 0,
      storeGoalPct: storeGoal > 0 ? (revenue / storeGoal) * 100 : 0,
      // Marcos da escada para a barra segmentada do mockup (posicao % de cada
      // degrau + % de premiacao que ele paga acima dele).
      ladderMarks: tiers.map((d) => ({ name: d.name, pct: d.minAttainmentPct, prizePct: d.commissionPct, bonus: d.bonus })),
      currentTierName: ladderShown?.tier?.name ?? null,
      currentLevel: levelIdx >= 0 ? levelIdx + 1 : null,
      nextTier: ladderShown?.next ?? null,
      accruedPrize: ladderToDate?.prizeAmount ?? 0,
      commissionPct: ladderShown?.tier?.commissionPct ?? 0,
      projectedIndividualPrize,
      /** Atingimento projetado pelo ritmo da competencia (100 = fecha). */
      projectedAttainmentPct: personGoal && personGoal.amount > 0 && !closed && finalProjection > 0 ? atingProjPct : null,
      bonusReached: ladderToDate?.bonus ?? 0,
      attention,
      noGoal: !personGoal || personGoal.amount <= 0,
    };
    })
    // Ordena por atingimento (meta ativa) ou faturamento; zeros no fim.
    .sort((a, b) => {
      const ka = activeGoal && !a.noGoal ? a.attainmentPct : a.revenueAmount;
      const kb = activeGoal && !b.noGoal ? b.attainmentPct : b.revenueAmount;
      return kb - ka;
    });
}

/* ------------------------- Desafios (EQUIP-05) ------------------------- */

const KIND_TEXT: Record<Challenge["kind"], string> = {
  product: "Produto",
  quantity: "Quantidade",
  revenue: "Faturamento",
  pa: "P.A.",
  ticket: "Ticket médio",
};

/** Icone de fogo em todos os cards  -  so a cor muda (por desafio ou tipo). */
const COLOR_ICON_CHALLENGE: Record<string, string> = {
  "d-perfumaria": "var(--acc)",
  "d-bodycream": "var(--warn)",
  "d-pa": "var(--info)",
  "d-ticket": "var(--ok)",
};

const COLOR_ICON_KIND: Record<Challenge["kind"], string> = {
  product: "var(--acc)",
  quantity: "var(--warn)",
  revenue: "#9d86ff",
  pa: "var(--info)",
  ticket: "var(--ok)",
};

function challengeAmountLabel(v: number, d: Challenge): string {
  if (d.kind === "ticket" || d.kind === "revenue" || d.unit === "R$") return brlK(v);
  if (d.kind === "pa" || d.unit === "x") return num(v, v % 1 !== 0 ? 2 : 0);
  return num(Math.round(v), 0);
}

function progressLabel(progress: number, floor: number, d: Challenge): string {
  const a = challengeAmountLabel(progress, d);
  const b = challengeAmountLabel(floor, d);
  if (d.unit === "un") return `${a}/${b} un`;
  return `${a}/${b}`;
}

function statusParticipante(progress: number, target: number): ChallengeParticipantView["status"] {
  if (progress <= 0) return "notStarted";
  if (progress >= target) return "reached";
  if (target > 0 && progress / target >= 0.8) return "near";
  return "below";
}

const STATUS_ORDER: Record<ChallengeParticipantView["status"], number> = {
  reached: 0,
  near: 1,
  below: 2,
  notStarted: 3,
};

/** Veredito de ritmo + status temporal pela janela inicio/fim do desafio. */
function challengeView(
  d: Challenge,
  daysElapsed: number,
  daysTotais: number,
  scopedStoreIds: string[],
  showStore: boolean,
): ChallengeView {
  const ids = d.participants.filter((id) => {
    const c = collaboratorById(id);
    return c && scopedStoreIds.includes(c.storeId);
  });
  const lines: ChallengeParticipantView[] = ids.map((id) => {
    const c = collaboratorById(id);
    const progress = individualProgress(d, id);
    const floor = challengeFloor(d);
    const groupName = c?.groupId ? groups.find((t) => t.id === c.groupId)?.name ?? "—" : "—";
    const storeNameValue = c ? storeById(c.storeId).tradeName : "—";
    return {
      employeeId: id,
      name: c?.name ?? id,
      store: storeNameValue,
      group: groupName,
      progress,
      target: floor,
      progressPct: floor > 0 ? Math.min(100, (progress / floor) * 100) : 0,
      progressLabel: progressLabel(progress, floor, d),
      status: statusParticipante(progress, floor),
    };
  });
  const floor = challengeFloor(d);
  const reachedCount = lines.filter((p) => p.status === "reached").length;
  const minimumManager = Math.min(d.minimumSellersAtingindo, ids.length);
  const progressValues = lines.map((p) => p.progress);
  /** Indices (P.A./ticket): media vs piso. Un/R$: soma capped (regra A). */
  const aggregatedProgress = challengeIsIndex(d)
    ? averageProgress(progressValues)
    : cappedManagerProgress(progressValues, floor);
  const targetAgregado = challengeManagerTarget(d, ids.length);
  const projected = daysElapsed > 0 ? (aggregatedProgress / daysElapsed) * daysTotais : 0;
  const withoutEngagement = aggregatedProgress <= 0;
  const ranking = [...lines].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.progress - a.progress || b.progressPct - a.progressPct,
  );
  const goalLabel =
    d.kind === "pa"
      ? num(d.individualTarget, 2)
      : d.kind === "ticket" || d.unit === "R$" || d.kind === "revenue"
        ? brlK(d.individualTarget)
        : `${num(d.kind === "product" ? floor : d.individualTarget, 0)} un`;
  const minimumLabel =
    d.minimum == null
      ? null
      : d.unit === "un"
        ? `${num(d.minimum, 0)} un`
        : d.kind === "ticket" || d.unit === "R$"
          ? brlK(d.minimum)
          : num(d.minimum, d.minimum % 1 !== 0 ? 2 : 0);

  let statusLabel: ChallengeView["statusLabel"];
  let statusVariant: ChallengeView["statusVariant"];
  let prazoTone: ChallengeView["prazoTone"];
  let daysRemaining: number;
  let prazoLabel: string;
  if (TODAY_ISO < d.start) {
    statusLabel = "A começar";
    statusVariant = "info";
    prazoTone = "muted";
    daysRemaining = eachDay(TODAY_ISO, d.start).length - 1;
    prazoLabel = daysRemaining <= 0 ? "Hoje" : `Em ${dayCountLabel(daysRemaining)}`;
  } else if (TODAY_ISO > d.end) {
    statusLabel = "Encerrado";
    statusVariant = "neutral";
    prazoTone = "bad";
    daysRemaining = 0;
    prazoLabel = "Encerrado";
  } else {
    statusLabel = "Ativo";
    statusVariant = "success";
    prazoTone = "ok";
    daysRemaining = eachDay(TODAY_ISO, d.end).length;
    prazoLabel = dayCountLabel(daysRemaining);
  }

  const fechaNoPace =
    withoutEngagement || statusLabel !== "Ativo"
      ? false
      : reachedCount >= minimumManager || projected >= targetAgregado;
  const description =
    minimumLabel != null
      ? `Meta: ${goalLabel} · Mínimo: ${minimumLabel} · Prêmio: ${brl(d.prize)}`
      : `Meta: ${goalLabel} · Prêmio: ${brl(d.prize)}`;
  const storeLabel = d.storeId
    ? storeById(d.storeId).tradeName.replace(/^Shopping\s+/i, "")
    : "Rede";
  return {
    id: d.id,
    name: d.name,
    description,
    objective: d.objective,
    goalLabel,
    minimum: d.minimum,
    hasMinimum: d.minimum != null,
    kind: d.kind,
    colorIcon: COLOR_ICON_CHALLENGE[d.id] ?? COLOR_ICON_KIND[d.kind],
    individualTarget: d.individualTarget,
    unit: d.unit,
    prize: d.prize,
    prizeManager: d.prizeManager,
    minimumSellersAtingindo: minimumManager,
    participants: ids.length,
    engaged: lines.filter((p) => p.status !== "notStarted").length,
    aggregatedProgress,
    targetAgregado,
    progressPct: targetAgregado > 0 ? (aggregatedProgress / targetAgregado) * 100 : 0,
    aggregatedProgressLabel: progressLabel(aggregatedProgress, targetAgregado, d),
    reachedCount,
    projectedAgregado: projected,
    fechaNoPace,
    withoutEngagement,
    kindText: KIND_TEXT[d.kind],
    daysRemaining,
    prazoLabel,
    janelaLabel: `${shortDate(d.start)} – ${shortDate(d.end)}`,
    prazoTone,
    statusLabel,
    statusVariant,
    storeId: d.storeId,
    storeLabel,
    showStore,
    ranking,
  };
}

function openDaysInPeriod(competence: string, scopedStoreIds: string[]): { elapsedOpenDays: number; totais: number } {
  const first = `${competence}-01`;
  const last = endOfMonth(first);
  const openOnes = eachDay(first, last).filter((iso) => scopedStoreIds.some((id) => storeOpen(storeById(id), iso)));
  const elapsedOpenDays = openOnes.filter((iso) => iso <= TODAY_ISO).length;
  return { elapsedOpenDays, totais: openOnes.length };
}

/** Lista da Equipe/Ao vivo: so desafios vigentes (status Ativo). Encerrados e "a comecar" ficam de fora. */
function challengesViewForCompetence(competence: string, scopedStoreIds: string[]): ChallengeView[] {
  const { elapsedOpenDays, totais } = openDaysInPeriod(competence, scopedStoreIds);
  const showStore = scopedStoreIds.length > 1;
  return challengesInScope(competence, scopedStoreIds)
    .map((d) => challengeView(d, elapsedOpenDays, totais, scopedStoreIds, showStore))
    .filter((d) => d.statusLabel === "Ativo")
    .sort(
      (a, b) =>
        a.daysRemaining - b.daysRemaining ||
        a.storeLabel.localeCompare(b.storeLabel, "pt-BR") ||
        a.name.localeCompare(b.name, "pt-BR"),
    );
}

/**
 * Fonte 1  -  escada de metas da filial (EQUIP-04): realizado de cada vendedora
 * escalado pelo ritmo da loja ate o fim do mes (fracao acumulada da curva  - 
 * equivale a "realizado + restante x indice de desempenho"), pago pelo degrau
 * que a projecao alcanca. Bonus entra uma unica vez, so de degrau ja alcancado
 * (risco D4). Competencia encerrada: premiacao final do mes.
 * null quando nao ha meta na competencia (a escada nao paga nada).
 */
function ladderPrize(storeId: string, competence: string, sellers: SellerRow[]): number | null {
  const goal = goalOfStore(storeId, competence);
  if (!goal) return null;
  const branch = storeById(storeId);
  const first = `${competence}-01`;
  const closed = endOfMonth(first) < TODAY_ISO;

  if (closed) {
    return sellers.reduce((s, l) => s + l.accruedPrize + l.bonusReached, 0);
  }

  const curve = revenueCurve([branch], competence);
  let accumulatedShare = 0;
  for (const iso of eachDay(first, TODAY_ISO)) accumulatedShare += curve.weight(iso);
  if (accumulatedShare <= 0) return null;

  let total = 0;
  for (const l of sellers) {
    if (l.noGoal || l.individualGoalAmount <= 0) continue;
    // Realizado escalado: hoje esta em fracaoAcum do mes  ->  projecao linear
    // pelo mesmo indice de desempenho acumulado do Dashboard (LOJA-03).
    const finalProjection = l.revenueAmount / accumulatedShare;
    const atingPct = (finalProjection / l.individualGoalAmount) * 100;
    let tier: Tier | null = null;
    for (const d of goal.tiers) {
      if (atingPct >= d.minAttainmentPct) tier = d;
      else break;
    }
    const tierPct = tier?.commissionPct ?? 0;
    total += (finalProjection * tierPct) / 100 + l.bonusReached;
  }
  return total;
}

/**
 * Fonte 2  -  desafios (EQUIP-05): premio de cada participante cuja projecao
 * linear do progresso fecha o alvo individual (mesma projecao do
 * `desafioView`). Cada desafio e da loja (ou rede); na visao rede entra
 * uma vez por desafio. Competencia encerrada: premio dos que de fato fecharam.
 */
function challengePrizes(competence: string, scopedStoreIds: string[]): number {
  const { elapsedOpenDays, totais } = openDaysInPeriod(competence, scopedStoreIds);
  let total = 0;
  const closed = endOfMonth(`${competence}-01`) < TODAY_ISO;
  for (const d of challengesInScope(competence, scopedStoreIds)) {
    for (const id of d.participants) {
      const p = individualProgress(d, id);
      if (p <= 0) continue;
      const winsNow = p >= d.individualTarget;
      if (closed) {
        total += winsNow ? d.prize : 0;
      } else if (elapsedOpenDays > 0) {
        const projected = (p / elapsedOpenDays) * totais;
        if (projected >= d.individualTarget) total += d.prize;
      }
    }
  }
  return total;
}

/**
 * KPI da visao loja: escada da loja + desafios. Os desafios sao da
 * competencia inteira; a visao rede soma a escada de todas e os desafios uma
 * unica vez (ver visaoRede).
 */
function projectedPrize(storeId: string, competence: string, sellers: SellerRow[]): number | null {
  const ladder = ladderPrize(storeId, competence, sellers);
  const challenges = challengePrizes(competence, [storeId]);
  if (ladder === null) return challenges > 0 ? challenges : null;
  return ladder + challenges;
}

/* ------------------------- Leitura da IA (EQUIP-06) ------------------------- */

/**
 * Leitura da aba: no produto o LLM redige a partir dos numeros; aqui a frase
 * e montada por regra. Desativada na UI por enquanto (EQUIP-06)  -  mantida
 * exportada para reativar sem reescrever a logica.
 */
export function buildTeamInsight(v: TeamView): string | null {
  const partes: string[] = [];
  const lines = v.sellers ?? [];

  // Linha (a): efeito de ticket/P.A.  -  so quando o delta diz algo.
  const pa = v.kpiPA.delta;
  const ticket = v.kpiTicket.delta;
  if (pa && !pa.positive && ticket && !ticket.positive) {
    partes.push(`A equipe está vendendo menos peças por atendimento (P.A. ${pa.value}): o segundo produto está ficando na prateleira — reforçar a oferta de segunda peça e kit no caixa.`);
  } else if (pa && !pa.positive) {
    partes.push(`P.A. da equipe caiu ${pa.value} contra o período anterior: menos peças por venda, mesmo com o ticket segurando.`);
  }

  // Linha (b): quem esta abaixo da meta e caindo (omitida quando ninguem).
  // So com meta ativa: sem meta no periodo nao existe "abaixo da meta".
  if (v.activeGoal) {
    const emRisco = lines.filter((l) => l.attainmentPct < 100 && l.trend === "down");
    if (emRisco.length > 0) {
      const names = emRisco.map((l) => firstName(l.name)).join(", ");
      const action = emRisco.length === 1 ? `Vale uma conversa hoje com ${firstName(emRisco[0].name)}` : "Vale conversar com cada pessoa hoje";
      partes.push(`${names} ${emRisco.length === 1 ? "está" : "estão"} abaixo da meta individual e caindo. ${action}.`);
    }
  }
  return partes.length > 0 ? partes.join(" ") : null;
}

function firstName(nameComplete: string): string {
  return nameComplete.split(" ")[0];
}

function buildGoalBand(achieved: number, total: number, competence: string, storesInScope: Store[]): NetworkGlobalGoal | null {
  if (total <= 0) return null;
  const first = `${competence}-01`;
  const last = endOfMonth(first);
  const pct = (achieved / total) * 100;
  const closed = last < TODAY_ISO;
  let projectedPct = pct;
  if (!closed) {
    const curve = revenueCurve(storesInScope, competence);
    let accumulatedShare = 0;
    for (const iso of eachDay(first, TODAY_ISO)) accumulatedShare += curve.weight(iso);
    if (accumulatedShare > 0) projectedPct = (achieved / accumulatedShare / total) * 100;
  }
  const remainingOpen = eachDay(TODAY_ISO, last).filter((iso) => storesInScope.some((f) => storeOpen(f, iso)));
  const goalName =
    storesInScope.map((f) => goalOfStore(f.id, competence)?.name).find((n): n is string => Boolean(n)) ?? monthYear(first);
  return {
    competenceText: goalName,
    achieved,
    total,
    pct,
    projectedPct,
    daysRemaining: closed ? 0 : remainingOpen.length,
    start: first,
    end: last,
  };
}

/**
 * Faixa da meta com o faturamento da loja (inclui venda sem vendedora e gerencia, que ficam fora do
 * ranking) + quanto disso nao esta na equipe.
 */
function bandWithOutsideTeam(
  band: NetworkGlobalGoal | null,
  sumTeam: number,
): NetworkGlobalGoal | null {
  if (!band) return null;
  const excluded = Math.round((band.achieved - sumTeam) * 100) / 100;
  return excluded > 0 ? { ...band, outsideTeam: excluded } : band;
}

/** Faturamento da competencia filtrado por marca (1 marca) ou total (null). */
function achievedCompetence(storeId: string, competence: string, brand: GoalBrand | null): number {
  const first = `${competence}-01`;
  const last = endOfMonth(first);
  const endReal = last < TODAY_ISO ? last : TODAY_ISO;
  return sumAggregates(
    eachDay(first, endReal).map((iso) => {
      const day = salesDay(storeId, iso);
      if (!day) return { revenue: 0, salesCount: 0, items: 0 };
      return dayAggregate(day, brand, iso === TODAY_ISO ? CURRENT_HOUR : undefined);
    }),
  ).revenue;
}

/**
 * Cards de meta do escopo: uma entrada por meta cadastrada (loja + marca).
 * Escada reusa as vendedoras da loja; realizado da faixa respeita marcas da meta.
 */
function buildGoalCards(
  storeIds: string[],
  competence: string,
  sellersByBranch: Map<string, SellerRow[]>,
): GoalCardView[] {
  const cards: GoalCardView[] = [];
  for (const storeId of storeIds) {
    const branch = storeById(storeId);
    if (!branch) continue;
    const list = sellersByBranch.get(storeId) ?? [];
    const groupCount = groupsForBranch(storeId).length;
    for (const m of goalsOfStore(storeId, competence)) {
      const singleBrand = m.brands.length === 1 ? m.brands[0] : null;
      const achieved = achievedCompetence(storeId, competence, singleBrand);
      const band = singleBrand
        ? buildGoalBand(achieved, m.storeAmount, competence, [branch])
        : bandWithOutsideTeam(
            buildGoalBand(achieved, m.storeAmount, competence, [branch]),
            list.reduce((s, l) => s + l.revenueAmount, 0),
          );
      if (!band) continue;
      band.competenceText = m.name;
      cards.push({
        id: m.id,
        name: m.name,
        kind: m.kind,
        storeNameValue: branch.tradeName,
        brands: m.brands,
        qtyGroups: groupCount,
        qtySellers: list.length,
        qtyLevels: m.tiers.length,
        spreadsUnidentified: false,
        tiers: m.tiers,
        band,
        sellers: list,
      });
    }
  }
  return cards;
}

/* ------------------------- Evolucao Fat vs Meta (padrao Visao Geral) ------------------------- */

const MONTHS_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function storesDayRevenue(storeIds: string[], iso: string): number {
  return sumAggregates(
    storeIds.map((id) => {
      const day = salesDay(id, iso);
      return day ? dayAggregate(day, null, iso === TODAY_ISO ? CURRENT_HOUR : undefined) : { revenue: 0, salesCount: 0, items: 0 };
    }),
  ).revenue;
}

function revenueHourBranches(storeIds: string[], iso: string, h: number): number {
  let revenue = 0;
  for (const id of storeIds) {
    const a = salesDay(id, iso)?.byHour[h];
    if (a) revenue += a.revenue;
  }
  return revenue;
}

function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const yF = Number(end.slice(0, 4));
  const mF = Number(end.slice(5, 7));
  while (y < yF || (y === yF && m <= mF)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Serie acumulada Realizado x Meta  -  mesmo rateio da Visao Geral. */
function buildRevenueVsGoal(
  storeIds: string[],
  period: ResolvedPeriod,
  metaTotal: number,
): { points: { label: string; achieved: number; goal: number }[]; seriesLabel: string } | undefined {
  const eixo = seriesAxisForPeriod(period);
  const seriesLabel = seriesAxisLabel(period, eixo);
  const points: { label: string; achieved: number; goal: number }[] = [];

  if (eixo === "hour") {
    const fs = storeIds.map((id) => storeById(id)).filter((f): f is Store => Boolean(f));
    if (fs.length === 0) return undefined;
    const opening = Math.min(...fs.map((f) => f.opening));
    const closing = Math.max(...fs.map((f) => f.closing));
    const hours: number[] = [];
    for (let h = opening; h < closing; h++) hours.push(h);
    const hoursVisible = period.isToday ? hours.filter((h) => h <= CURRENT_HOUR) : hours;
    if (hoursVisible.length < 2) return undefined;
    const goalByHour = metaTotal > 0 && hours.length > 0 ? metaTotal / hours.length : 0;
    let acumR = 0;
    let acumM = 0;
    for (const h of hoursVisible) {
      acumR += revenueHourBranches(storeIds, period.start, h);
      acumM += goalByHour;
      points.push({ label: shortHour(h), achieved: acumR, goal: acumM });
    }
  } else if (eixo === "month") {
    const months = monthsBetween(period.start, period.end);
    if (months.length < 2) return undefined;
    const goalByMonth = metaTotal > 0 ? metaTotal / months.length : 0;
    let acumR = 0;
    let acumM = 0;
    for (const month of months) {
      const monthStart = `${month}-01`;
      const endMonth = endOfMonth(monthStart);
      const ini = monthStart < period.start ? period.start : monthStart;
      const end = endMonth > period.end ? period.end : endMonth;
      for (const iso of eachDay(ini, end)) {
        acumR += storesDayRevenue(storeIds, iso);
      }
      acumM += goalByMonth;
      points.push({ label: monthYear(monthStart).split(" de ")[0], achieved: acumR, goal: acumM });
    }
  } else {
    const days = eachDay(period.start, period.end);
    if (days.length < 2) return undefined;
    const goalByDay = metaTotal > 0 ? metaTotal / days.length : 0;
    let acumR = 0;
    let acumM = 0;
    for (const iso of days) {
      acumR += storesDayRevenue(storeIds, iso);
      acumM += goalByDay;
      const d = isoToDate(iso);
      points.push({
        label: `${String(d.getDate()).padStart(2, "0")} ${MONTHS_CURTOS[d.getMonth()]}`,
        achieved: acumR,
        goal: acumM,
      });
    }
  }

  return points.length > 1 ? { points, seriesLabel } : undefined;
}

function groupsForBranch(storeId: string): { id: string; name: string }[] {
  return groups.filter((t) => t.storeId === storeId).map((t) => ({ id: t.id, name: t.name }));
}

/** Grupos unicos por nome (rede: Grupo 1/Grupo 2 aparecem em varias lojas). */
function groupsInScope(storeIds: string[]): { id: string; name: string }[] {
  const ids = storeIds.length > 0 ? storeIds : stores.map((f) => f.id);
  const visto = new Map<string, { id: string; name: string }>();
  for (const id of ids) {
    for (const g of groupsForBranch(id)) {
      if (!visto.has(g.name)) visto.set(g.name, { id: g.name, name: g.name });
    }
  }
  return [...visto.values()];
}

/* ------------------------- Visao loja ------------------------- */

function storeView(scope: Scope, period: ResolvedPeriod, goalPeriod: ResolvedPeriod, competence: string, activeGoal: boolean): TeamView {
  const storeId = scope.storeIds.length === 1 ? scope.storeIds[0] : stores[0]?.id ?? "";
  const branch = storeById(storeId);
  const prev = previousPeriod(period);
  // KPIs de desempenho: periodo filtrado (AD-046).
  const current = storeAggregate(storeId, period.start, period.end);
  const previous = sumAggregates(
    eachDay(prev.start, prev.end).map((iso) => {
      const day = salesDay(storeId, iso);
      if (!day) return { revenue: 0, salesCount: 0, items: 0 };
      const hourMax = iso === prev.end && prev.hourMax !== undefined ? prev.hourMax : undefined;
      return dayAggregate(day, null, hourMax);
    }),
  );

  const hasComparison = previous.salesCount > 0;
  const vsLabel = hasComparison ? prev.label : undefined;
  const ticket = divSeguro(current.revenue, current.salesCount);
  const pa = divSeguro(current.items, current.salesCount);
  const ticketPrev = divSeguro(previous.revenue, previous.salesCount);
  const paPrev = divSeguro(previous.items, previous.salesCount);

  // Series diarias para sparklines nos KPIs
  const periodDays = eachDay(period.start, period.end);
  const seriesRevenue: number[] = [];
  const seriesVisits: number[] = [];
  const seriesTicket: number[] = [];
  const seriesPA: number[] = [];
  for (const iso of periodDays) {
    const day = salesDay(storeId, iso);
    if (!day) {
      seriesRevenue.push(0);
      seriesVisits.push(0);
      seriesTicket.push(0);
      seriesPA.push(0);
      continue;
    }
    const ag = dayAggregate(day, null, iso === TODAY_ISO ? CURRENT_HOUR : undefined);
    seriesRevenue.push(ag.revenue);
    seriesVisits.push(ag.salesCount);
    seriesTicket.push(divSeguro(ag.revenue, ag.salesCount));
    seriesPA.push(divSeguro(ag.items, ag.salesCount));
  }

  // Meta/escada/premiacao: sempre janela da competencia (AD-046).
  const sellers = sellersView(storeId, goalPeriod, activeGoal, competence);
  const prizeAmount = activeGoal ? projectedPrize(storeId, competence, sellers) : null;

  const notices: string[] = [];
  if (scope.division && activeGoal) {
    notices.push("O filtro de marca altera os resultados, mas as metas individuais continuam considerando toda a loja.");
  }

  // Faixa de progresso da meta da loja = faturamento da loja (igual a Visao Geral). O que ficou
  // fora do ranking (venda sem vendedora, gerencia) aparece como "foraDaEquipe".
  let networkGoal: NetworkGlobalGoal | null = null;
  const storeGoalAmount = activeGoal ? (goalOfStore(storeId, competence)?.storeAmount ?? 0) : 0;
  if (activeGoal && storeGoalAmount > 0) {
    networkGoal = bandWithOutsideTeam(
      buildGoalBand(achievedCompetence(storeId, competence, null), storeGoalAmount, competence, [branch]),
      sellers.reduce((s, l) => s + l.revenueAmount, 0),
    );
  }

  const goalCardsList = activeGoal
    ? buildGoalCards([storeId], competence, new Map([[storeId, sellers]]))
    : [];

  const nDays = periodDays.length;
  const evolution = buildRevenueVsGoal([storeId], period, storeGoalAmount);
  const challenges = activeGoal ? challengesViewForCompetence(competence, [branch.id]) : null;

  return {
    scope,
    period,
    scopeView: "store",
    competence,
    activeGoal,
    competenceNotice: null, // preenchido em montarEquipeView
    notices,
    kpiRevenue: {
      amount: brlK(current.revenue),
      delta: hasComparison ? kpiDelta(current.revenue, previous.revenue, vsLabel) : undefined,
      sub: storeGoalAmount > 0 ? `Meta: ${brlK(storeGoalAmount)}` : undefined,
      series: seriesRevenue.length > 1 ? seriesRevenue : undefined,
    },
    kpiSalesCount: {
      amount: num(current.salesCount),
      delta: hasComparison ? kpiDelta(current.salesCount, previous.salesCount, vsLabel, "sales") : undefined,
      sub: nDays > 1 ? `Média de ${num(current.salesCount / nDays, 0)}/dia` : undefined,
      series: seriesVisits.length > 1 ? seriesVisits : undefined,
    },
    kpiTicket: {
      amount: brl(ticket),
      delta: hasComparison ? kpiDelta(ticket, ticketPrev, vsLabel) : undefined,
      series: seriesTicket.length > 1 ? seriesTicket : undefined,
    },
    kpiPA: {
      amount: num(pa, 2),
      delta: hasComparison ? kpiDelta(pa, paPrev, vsLabel, "pa") : undefined,
      series: seriesPA.length > 1 ? seriesPA : undefined,
    },
    kpiPrize: prizeAmount === null ? null : { amount: brl(prizeAmount), delta: undefined },
    networkGoal,
    goalCardsList,
    reading: null,
    revenueEvolution: evolution?.points,
    seriesLabel: evolution?.seriesLabel,
    availableGroups: groupsForBranch(storeId),
    sellers,
    storeRows: null,
    challenges,
    states: {
      kpis: "available",
      reading: "noData",
      sellers: sellers.length > 0 ? "available" : "noData",
      challenges: activeGoal ? (challenges !== null && challenges.length > 0 ? "available" : "noData") : "unavailable",
    },
  };
}

/* ------------------------- Visao rede (EQUIP-07) ------------------------- */

function networkView(scope: Scope, period: ResolvedPeriod, goalPeriod: ResolvedPeriod, competence: string, activeGoal: boolean): TeamView {
  // Meta global = soma das metas das lojas do escopo que tem meta (REDE-08).
  const globalGoalTotal = stores.reduce((s, f) => s + (goalOfStore(f.id, competence)?.storeAmount ?? 0), 0);

  const sellersFlat: SellerRow[] = [];
  const sellersByBranch = new Map<string, SellerRow[]>();
  const storeRows: StoreTeamSummary[] = stores.map((f, i) => {
    const storeScope: Scope = { ...scope, storeIds: [f.id] };
    const storeValue = storeView(storeScope, period, goalPeriod, competence, activeGoal);
    const lines = storeValue.sellers ?? [];
    sellersFlat.push(...lines);
    sellersByBranch.set(f.id, lines);
    const withGoal = activeGoal ? lines.filter((l) => !l.noGoal) : [];
    const ordenadas = [...withGoal].sort((a, b) => b.attainmentPct - a.attainmentPct);
    const best = ordenadas.length > 0 ? { name: firstName(ordenadas[0].name), attainmentPct: ordenadas[0].attainmentPct } : null;
    const worst = ordenadas.length > 0 ? { name: firstName(ordenadas[ordenadas.length - 1].name), attainmentPct: ordenadas[ordenadas.length - 1].attainmentPct } : null;
    const goalAmount = goalOfStore(f.id, competence)?.storeAmount ?? 0;
    const achievedAmount = lines.reduce((s, l) => s + l.revenueAmount, 0);
    return {
      storeId: f.id,
      name: f.tradeName,
      tint: STORE_TINTS[i % STORE_TINTS.length],
      revenue: storeValue.kpiRevenue.amount,
      ticket: storeValue.kpiTicket.amount,
      pa: storeValue.kpiPA.amount,
      // Premiacao da loja = so a escada de metas dela; os desafios sao da rede
      // e entram uma vez no KPI da visao rede (nao dobram por loja).
      projectedPrize: storeValue.kpiPrize?.amount ?? "—",
      goalAmount,
      achievedAmount,
      networkGoalPct: globalGoalTotal > 0 ? (goalAmount / globalGoalTotal) * 100 : 0,
      best,
      worst,
    };
  });

  // Flat da rede: mesma regra de ordenacao da loja (atingimento / faturamento).
  sellersFlat.sort((a, b) => {
    const ka = activeGoal && !a.noGoal ? a.attainmentPct : a.revenueAmount;
    const kb = activeGoal && !b.noGoal ? b.attainmentPct : b.revenueAmount;
    return kb - ka;
  });

  // KPIs da rede: soma das lojas (ticket e P.A. recalculados sobre a soma).
  const current = sumAggregates(stores.map((f) => storeAggregate(f.id, period.start, period.end)));
  const prev = previousPeriod(period);
  const previous = sumAggregates(
    eachDay(prev.start, prev.end).map((iso) => {
      const hourMax = iso === prev.end && prev.hourMax !== undefined ? prev.hourMax : undefined;
      return sumAggregates(stores.map((f) => {
        const day = salesDay(f.id, iso);
        return day ? dayAggregate(day, null, hourMax) : { revenue: 0, salesCount: 0, items: 0 };
      }));
    }),
  );
  const hasComparison = previous.salesCount > 0;
  const vsLabel = hasComparison ? prev.label : undefined;

  // Series diarias para sparklines nos KPIs da rede
  const networkPeriodDays = eachDay(period.start, period.end);
  const seriesRevenueNetwork: number[] = [];
  const seriesVisitsNetwork: number[] = [];
  const seriesTicketNetwork: number[] = [];
  const seriesPANetwork: number[] = [];
  for (const iso of networkPeriodDays) {
    const agDay = sumAggregates(stores.map((f) => {
      const day = salesDay(f.id, iso);
      return day ? dayAggregate(day, null, iso === TODAY_ISO ? CURRENT_HOUR : undefined) : { revenue: 0, salesCount: 0, items: 0 };
    }));
    seriesRevenueNetwork.push(agDay.revenue);
    seriesVisitsNetwork.push(agDay.salesCount);
    seriesTicketNetwork.push(divSeguro(agDay.revenue, agDay.salesCount));
    seriesPANetwork.push(divSeguro(agDay.items, agDay.salesCount));
  }

  const challenges = activeGoal ? challengesViewForCompetence(competence, stores.map((f) => f.id)) : null;
  const withoutChallenges = activeGoal && (challenges === null || challenges.length === 0);

// Premiacao da rede = escada de metas de cada loja + desafios uma unica
// vez (desafio e da competencia inteira, nao por loja).
let awardNetwork: number | null = null;
if (activeGoal) {
  let parteLadder = 0;
  for (const f of stores) {
    const storeValue = storeView({ ...scope, storeIds: [f.id] }, period, goalPeriod, competence, activeGoal);
    const storeLadder = ladderPrize(f.id, competence, storeValue.sellers ?? []);
    if (storeLadder !== null) parteLadder += storeLadder;
  }
  const challengesPart = challengePrizes(competence, stores.map((f) => f.id));
  awardNetwork = parteLadder > 0 || challengesPart > 0 ? parteLadder + challengesPart : null;
}

  // Faixa de progresso da meta (rede) = faturamento das lojas (mesma base das lojas / Visao Geral).
  let networkGoal: NetworkGlobalGoal | null = null;
  if (activeGoal && globalGoalTotal > 0) {
    const achieved = stores.reduce((s, f) => s + achievedCompetence(f.id, competence, null), 0);
    networkGoal = bandWithOutsideTeam(
      buildGoalBand(achieved, globalGoalTotal, competence, stores),
      sellersFlat.reduce((s, l) => s + l.revenueAmount, 0),
    );
  }

  const goalCardsList = activeGoal
    ? buildGoalCards(
        stores.map((f) => f.id),
        competence,
        sellersByBranch,
      )
    : [];

  const evolucaoNetwork = buildRevenueVsGoal(
    stores.map((f) => f.id),
    period,
    activeGoal ? globalGoalTotal : 0,
  );

  const nDaysNetwork = networkPeriodDays.length;
  const paNetwork = divSeguro(current.items, current.salesCount);
  const ticketNetwork = divSeguro(current.revenue, current.salesCount);
  const paNetworkPrev = divSeguro(previous.items, previous.salesCount);
  const ticketNetworkPrev = divSeguro(previous.revenue, previous.salesCount);

  return {
    scope,
    period,
    scopeView: "network",
    competence,
    activeGoal,
    competenceNotice: null,
    notices: [],
    kpiRevenue: {
      amount: brlK(current.revenue),
      delta: hasComparison ? kpiDelta(current.revenue, previous.revenue, vsLabel) : undefined,
      sub: globalGoalTotal > 0 ? `Meta: ${brlK(globalGoalTotal)}` : undefined,
      series: seriesRevenueNetwork.length > 1 ? seriesRevenueNetwork : undefined,
    },
    kpiSalesCount: {
      amount: num(current.salesCount),
      delta: hasComparison ? kpiDelta(current.salesCount, previous.salesCount, vsLabel, "sales") : undefined,
      sub: nDaysNetwork > 1 ? `Média de ${num(current.salesCount / nDaysNetwork, 0)}/dia` : undefined,
      series: seriesVisitsNetwork.length > 1 ? seriesVisitsNetwork : undefined,
    },
    kpiTicket: {
      amount: brl(ticketNetwork),
      delta: hasComparison ? kpiDelta(ticketNetwork, ticketNetworkPrev, vsLabel) : undefined,
      series: seriesTicketNetwork.length > 1 ? seriesTicketNetwork : undefined,
    },
    kpiPA: {
      amount: num(paNetwork, 2),
      delta: hasComparison ? kpiDelta(paNetwork, paNetworkPrev, vsLabel, "pa") : undefined,
      series: seriesPANetwork.length > 1 ? seriesPANetwork : undefined,
    },
    kpiPrize: awardNetwork === null ? null : { amount: brl(awardNetwork), delta: undefined },
    networkGoal,
    goalCardsList,
    reading: null,
    revenueEvolution: evolucaoNetwork?.points,
    seriesLabel: evolucaoNetwork?.seriesLabel,
    availableGroups: groupsInScope([]),
    sellers: sellersFlat,
    storeRows: storeRows,
    challenges,
    states: {
      kpis: "available",
      reading: "noData",
      sellers: sellersFlat.length > 0 ? "available" : "noData",
      challenges: activeGoal ? (withoutChallenges ? "noData" : "available") : "unavailable",
    },
  };
}

/* ------------------------- Entrada da aba ------------------------- */

/**
 * Competencia da Equipe (AD-046): mes passado so quando o filtro e
 * "Mes passado"; nos demais casos, mes corrente. Meta/escada/desafios
 * usam essa janela; KPIs usam o periodo filtrado.
 */
function teamCompetence(period: ResolvedPeriod): string {
  return period.kind === "lastMonth" ? period.start.slice(0, 7) : TODAY_ISO.slice(0, 7);
}

/** Periodo resolvido da competencia (mes inteiro ate hoje ou fechado). */
function periodOfCompetence(competence: string): ResolvedPeriod {
  return resolvePeriod(competence === TODAY_ISO.slice(0, 7) ? { kind: "thisMonth" } : { kind: "lastMonth" });
}

/** True quando o filtro ja e exatamente o mes da competencia. */
function periodMatchesCompetence(period: ResolvedPeriod, competence: string): boolean {
  if (period.spansMonths) return false;
  if (period.kind === "thisMonth") return competence === TODAY_ISO.slice(0, 7);
  if (period.kind === "lastMonth") return competence === period.start.slice(0, 7);
  return false;
}

export function buildTeamView(scope: Scope): TeamView {
  const period = resolvePeriod(scope.period);
  const competence = teamCompetence(period);
  const goalPeriod = periodOfCompetence(competence);
  const isNetwork = scope.storeIds.length === 0;
  const storesInScope = isNetwork ? stores : scope.storeIds.map((id) => storeById(id)).filter(Boolean) as Store[];
  // Meta ativa = existe meta cadastrada na competencia (nao depende mais do filtro).
  const activeGoal = storesInScope.some((f) => Boolean(goalOfStore(f.id, competence)));

  const v = isNetwork ? networkView(scope, period, goalPeriod, competence, activeGoal) : storeView(scope, period, goalPeriod, competence, activeGoal);

  if (activeGoal && !periodMatchesCompetence(period, competence)) {
    v.competenceNotice = `Os indicadores seguem o período selecionado. Metas, premiações e desafios consideram a competência ${monthYear(`${competence}-01`)}.`;
  } else if (activeGoal && period.kind === "lastMonth") {
    v.competenceNotice = `Metas e premiações referentes à competência ${monthYear(`${competence}-01`)}.`;
  }

  v.reading = null;
  v.states.reading = "noData";
  return v;
}