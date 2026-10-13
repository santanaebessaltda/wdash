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
  if (c.dataAdmissao > iso) return false;
  if (c.dataInatividade && c.dataInatividade <= iso) return false;
  return true;
}

/** Dias abertos da loja em que a vendedora estava presente, dentro do intervalo. */
function eligibleDays(c: Collaborator, branch: Store, start: string, end: string): string[] {
  const primeiro = c.dataAdmissao > start ? c.dataAdmissao : start;
  const ultimo = c.dataInatividade && c.dataInatividade <= end ? addDays(c.dataInatividade, -1) : end;
  if (primeiro > ultimo) return [];
  return eachDay(primeiro, ultimo).filter((iso) => storeOpen(branch, iso));
}

/** Vendedoras elegiveis presentes na loja no mes (base de listas e somas). */
export function sellersOfStore(storeId: string, competence: string): Collaborator[] {
  const primeiroMes = `${competence}-01`;
  return collaboratorsOfStore(storeId).filter((c) => presentOnDay(c, primeiroMes) || presentOnDay(c, TODAY_ISO));
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
  const primeiroMes = `${competence}-01`;
  const ultimoMes = endOfMonth(primeiroMes);
  const elegiveisMes = sellersOfStore(storeId, competence);
  if (elegiveisMes.length === 0) return null;

  const openDaysInMonth = eachDay(primeiroMes, ultimoMes).filter((iso) => storeOpen(branch, iso)).length;
  const dias = eligibleDays(c, branch, primeiroMes, ultimoMes);
  const pesoAjustado = c.pesoVenda * (openDaysInMonth > 0 ? dias.length / openDaysInMonth : 0);
  const somaPesosAjustados = elegiveisMes.reduce((s, x) => {
    const d = eligibleDays(x, branch, primeiroMes, ultimoMes);
    return s + x.pesoVenda * (openDaysInMonth > 0 ? d.length / openDaysInMonth : 0);
  }, 0);
  if (somaPesosAjustados <= 0) return null;
  const amount = (goal.storeAmount * pesoAjustado) / somaPesosAjustados;
  return { amount, proportional: dias.length < openDaysInMonth, eligibleDays: dias.length, openDaysInMonth };
}

/* ------------------------- Agregado por vendedora (EQUIP-02) ------------------------- */

export interface SellerAggregate {
  employeeId: string;
  revenue: number;
  salesCount: number;
  itens: number;
  daysWorked: number;
}

/** Agregado da vendedora no periodo (respeitando a fracao do dia de hoje). */
export function sellerAggregateForPeriod(c: Collaborator, storeId: string, start: string, end: string): SellerAggregate {
  const out = { employeeId: c.id, revenue: 0, salesCount: 0, itens: 0, daysWorked: 0 };
  for (const iso of eachDay(start, end)) {
    if (!presentOnDay(c, iso)) continue;
    const dia = salesDay(storeId, iso);
    if (!dia) continue;
    // Hoje incompleto: o gerador ja trunca porHora na hora atual; o total do
    // dia, nao. Recorte a fatia da vendedora pela fracao do dia realizada.
    const horaMax = iso === TODAY_ISO ? CURRENT_HOUR : undefined;
    const dayTotal = dayAggregate(dia, null, horaMax);
    const doDia = dia.bySeller[c.id];
    if (!doDia || dayTotal.revenue <= 0) continue;
    const fr = dayTotal.revenue / dia.total.revenue;
    const revenue = Math.round(doDia.revenue * fr);
    const salesCount = Math.round(doDia.salesCount * fr);
    const itens = Math.round(doDia.itens * fr);
    if (revenue > 0 || salesCount > 0) out.daysWorked += 1;
    out.revenue += revenue;
    out.salesCount += salesCount;
    out.itens += itens;
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
  proximo: { name: string; gapAmount: number; prizePct: number; bonus: number; minAttainmentPct: number } | null;
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
  const seguinte = idx + 1 < tiers.length ? tiers[idx + 1] : null;
  const proximo = seguinte
    ? {
        name: seguinte.name,
        gapAmount: Math.max(0, (personGoal.amount * seguinte.minAttainmentPct) / 100 - achieved),
        prizePct: seguinte.commissionPct,
        bonus: seguinte.bonus,
        minAttainmentPct: seguinte.minAttainmentPct,
      }
    : null;
  return { tier, prizeAmount, bonus, proximo };
}

/* ------------------------- Tipos da visao ------------------------- */

export interface TeamKpiValue {
  amount: string;
  delta: { value: string; positive: boolean; vs?: string } | undefined;
  /** Linha auxiliar sob o valor (mesmo padrao VG/Fin/Prod). */
  sub?: string;
  /** Serie diaria (reservada; KPIs da Equipe nao renderizam sparkline). */
  serie?: number[];
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
  alvo: number;
  progressoPct: number;
  /** Ex.: "8/15 un"  |  "1,85/1,90"  |  "R$ 178/R$ 185". */
  progressoRotulo: string;
  status: "atingiu" | "quase" | "below" | "nao_comecou";
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
  temMinimo: boolean;
  kind: Challenge["kind"];
  /** Cor do icone de fogo no card (CSS color / token). */
  corIcone: string;
  individualTarget: number;
  unit: Challenge["unit"];
  /** Premio da vendedora que fechar. */
  prize: number;
  /** Premio do gerente se a regra de N vendedoras fechar. */
  premioGerente: number;
  /** Quantas vendedoras precisam atingir (parametrizacao do gerente). */
  minimoVendedorasAtingindo: number;
  participants: number;
  engajadas: number;
  /**
   * Progresso agregado: un/R$ = soma capped (regra A); pa/ticket = media da equipe.
   */
  progressoAgregado: number;
  /**
   * Alvo agregado: un/R$ = piso x N gerente; pa/ticket = o proprio piso (ex.: 1,90).
   */
  alvoAgregado: number;
  progressoPct: number;
  /** Ex.: "6/9 un"  -  progresso da meta do gerente. */
  progressoAgregadoRotulo: string;
  /** Quantas participantes ja atingiram o alvo individual. */
  atingiram: number;
  projetadoAgregado: number;
  fechaNoRitmo: boolean;
  semEngajamento: boolean;
  tipoTexto: string;
  /** Dias restantes (ativo), dias ate comecar (agendado) ou 0 (encerrado). */
  daysRemaining: number;
  /** Rotulo do badge de prazo: "15d"  |  "Em 5d"  |  "Encerrado". */
  prazoRotulo: string;
  /** Janela do desafio, ex.: "01/09  -  15/09". */
  janelaRotulo: string;
  /** Tom do prazo: ok=ativo, muted=a comecar, bad=encerrado. */
  prazoTom: "ok" | "bad" | "muted";
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
  melhor: { name: string; attainmentPct: number } | null;
  pior: { name: string; attainmentPct: number } | null;
}

export interface TeamBlockStates {
  kpis: BlockState;
  leitura: BlockState;
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
  leitura: string | null;
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
      const dia = salesDay(storeId, iso);
      if (!dia) return { revenue: 0, salesCount: 0, itens: 0 };
      return dayAggregate(dia, null, iso === TODAY_ISO ? CURRENT_HOUR : undefined);
    }),
  );
}

/** Tendencia: ultimos 7 dias vs. 7 anteriores da vendedora; 5% = estavel. */
function sellerTrend(c: Collaborator, storeId: string, fimIso: string): SellerRow["trend"] {
  const soma = (start: string, end: string) =>
    eachDay(start, end).reduce((s, iso) => s + sellerAggregateForPeriod(c, storeId, iso, iso).revenue, 0);
  const ultimos = soma(addDays(fimIso, -6), fimIso);
  const anteriores = soma(addDays(fimIso, -13), addDays(fimIso, -7));
  if (anteriores <= 0 || ultimos <= 0) return "flat";
  const v = ((ultimos - anteriores) / anteriores) * 100;
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
const DEMO_FATOR_RITMO: Record<string, number> = {
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
  const storeAvgItems = divSeguro(storeAgg.itens, storeAgg.salesCount);
  const tiers = tiersOfStore(storeId, competence);
  const elegiveis = sellersOfStore(storeId, competence);

  // 1 passagem: agregado real por vendedora (fonte unica de R$).
  const brutos = elegiveis.map((c) => {
    const ag = sellerAggregateForPeriod(c, storeId, period.start, period.end);
    return { c, ag };
  });
  const somaBruta = brutos.reduce((s, x) => s + x.ag.revenue, 0);
  const somaPeso = brutos.reduce((s, x) => {
    const fat = Math.max(0, x.ag.revenue);
    const fator = DEMO_FATOR_RITMO[x.c.id] ?? 1;
    return s + fat * fator;
  }, 0);

  return brutos
    .map(({ c, ag: agRaw }) => {
    const personGoal = activeGoal ? individualGoal(c, storeId, competence) : null;

    // Redistribui o mesmo bolo: fat_i = soma x (fat_bruta x fator) / (...).
    let revenue = agRaw.revenue;
    let salesCount = agRaw.salesCount;
    let itens = agRaw.itens;
    if (somaBruta > 0 && somaPeso > 0) {
      const fator = DEMO_FATOR_RITMO[c.id] ?? 1;
      const fatAlvo = Math.round((somaBruta * Math.max(0, agRaw.revenue) * fator) / somaPeso);
      if (agRaw.revenue > 0 && fatAlvo !== agRaw.revenue) {
        const escala = fatAlvo / agRaw.revenue;
        revenue = fatAlvo;
        salesCount = Math.max(fatAlvo > 0 ? 1 : 0, Math.round(agRaw.salesCount * escala));
        itens = Math.max(salesCount, Math.round(agRaw.itens * escala));
      } else if (agRaw.revenue === 0 && fatAlvo > 0) {
        revenue = fatAlvo;
        salesCount = Math.max(1, Math.round(fatAlvo / 120));
        itens = Math.round(salesCount * 1.5);
      }
    }

    const ticket = divSeguro(revenue, salesCount);
    const pa = divSeguro(itens, salesCount);
    const trend = sellerTrend(c, storeId, period.end);

    // Projecao do fechamento individual: realizado escalado pela fracao da
    // curva de receita ja decorrida da competencia (mesma base do Dashboard).
    const closed = endOfMonth(`${competence}-01`) < TODAY_ISO;
    let finalProjection = 0;
    if (personGoal && personGoal.amount > 0 && !closed) {
      const curva = revenueCurve([branch], competence);
      let accumulatedShare = 0;
      for (const iso of eachDay(`${competence}-01`, TODAY_ISO)) accumulatedShare += curva.peso(iso);
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
      const paAbaixoPct = storeAvgItems > 0 && pa > 0 && pa < storeAvgItems * 0.95 ? (pa / storeAvgItems - 1) * 100 : null;
      if (paAbaixoPct !== null) {
        attention = { kind: "pa", text: `P.A. ${num(pa, 2)}`, detail: `${num(Math.abs(paAbaixoPct), 0)}% abaixo` };
      } else if (trend === "down") {
        attention =
          atingProjPct < 100
            ? { kind: "ritmo", text: "Ritmo", detail: `projeta ${num(atingProjPct, 0)}% da meta` }
            : { kind: "ritmo", text: "Ritmo", detail: "caindo, mas fecha no ritmo" };
      }
    }

    const storeGoal = activeGoal ? goalOfStore(storeId, competence)?.storeAmount ?? 0 : 0;
    const nivelIdx = ladderShown?.tier ? tiers.indexOf(ladderShown.tier) : -1;

    return {
      employeeId: c.id,
      name: c.name,
      storeId,
      storeName: branch.fantasia,
      group: c.grupoId ? groups.find((t) => t.id === c.grupoId)?.name ?? "Sem grupo" : "Sem grupo",
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
      currentLevel: nivelIdx >= 0 ? nivelIdx + 1 : null,
      nextTier: ladderShown?.proximo ?? null,
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

const TIPO_TEXTO: Record<Challenge["kind"], string> = {
  produto: "Produto",
  quantidade: "Quantidade",
  faturamento: "Faturamento",
  pa: "P.A.",
  ticket: "Ticket médio",
};

/** Icone de fogo em todos os cards  -  so a cor muda (por desafio ou tipo). */
const COR_ICONE_DESAFIO: Record<string, string> = {
  "d-perfumaria": "var(--acc)",
  "d-bodycream": "var(--warn)",
  "d-pa": "var(--info)",
  "d-ticket": "var(--ok)",
};

const COR_ICONE_TIPO: Record<Challenge["kind"], string> = {
  produto: "var(--acc)",
  quantidade: "var(--warn)",
  faturamento: "#9d86ff",
  pa: "var(--info)",
  ticket: "var(--ok)",
};

function challengeAmountLabel(v: number, d: Challenge): string {
  if (d.kind === "ticket" || d.kind === "faturamento" || d.unit === "R$") return brlK(v);
  if (d.kind === "pa" || d.unit === "x") return num(v, v % 1 !== 0 ? 2 : 0);
  return num(Math.round(v), 0);
}

function progressLabel(progress: number, piso: number, d: Challenge): string {
  const a = challengeAmountLabel(progress, d);
  const b = challengeAmountLabel(piso, d);
  if (d.unit === "un") return `${a}/${b} un`;
  return `${a}/${b}`;
}

function statusParticipante(progress: number, alvo: number): ChallengeParticipantView["status"] {
  if (progress <= 0) return "nao_comecou";
  if (progress >= alvo) return "atingiu";
  if (alvo > 0 && progress / alvo >= 0.8) return "quase";
  return "below";
}

const ORDEM_STATUS: Record<ChallengeParticipantView["status"], number> = {
  atingiu: 0,
  quase: 1,
  below: 2,
  nao_comecou: 3,
};

/** Veredito de ritmo + status temporal pela janela inicio/fim do desafio. */
function desafioView(
  d: Challenge,
  diasDecorridos: number,
  diasTotais: number,
  scopedStoreIds: string[],
  showStore: boolean,
): ChallengeView {
  const ids = d.participants.filter((id) => {
    const c = collaboratorById(id);
    return c && scopedStoreIds.includes(c.storeId);
  });
  const linhas: ChallengeParticipantView[] = ids.map((id) => {
    const c = collaboratorById(id);
    const progress = individualProgress(d, id);
    const piso = challengeFloor(d);
    const grupoNome = c?.grupoId ? groups.find((t) => t.id === c.grupoId)?.name ?? "—" : "—";
    const storeNameValue = c ? storeById(c.storeId).fantasia : "—";
    return {
      employeeId: id,
      name: c?.name ?? id,
      store: storeNameValue,
      group: grupoNome,
      progress,
      alvo: piso,
      progressoPct: piso > 0 ? Math.min(100, (progress / piso) * 100) : 0,
      progressoRotulo: progressLabel(progress, piso, d),
      status: statusParticipante(progress, piso),
    };
  });
  const piso = challengeFloor(d);
  const atingiram = linhas.filter((p) => p.status === "atingiu").length;
  const minimoGerente = Math.min(d.minimoVendedorasAtingindo, ids.length);
  const progressos = linhas.map((p) => p.progress);
  /** Indices (P.A./ticket): media vs piso. Un/R$: soma capped (regra A). */
  const progressoAgregado = challengeIsIndex(d)
    ? averageProgress(progressos)
    : cappedManagerProgress(progressos, piso);
  const alvoAgregado = challengeManagerTarget(d, ids.length);
  const projetado = diasDecorridos > 0 ? (progressoAgregado / diasDecorridos) * diasTotais : 0;
  const semEngajamento = progressoAgregado <= 0;
  const ranking = [...linhas].sort(
    (a, b) => ORDEM_STATUS[a.status] - ORDEM_STATUS[b.status] || b.progress - a.progress || b.progressoPct - a.progressoPct,
  );
  const goalLabel =
    d.kind === "pa"
      ? num(d.individualTarget, 2)
      : d.kind === "ticket" || d.unit === "R$" || d.kind === "faturamento"
        ? brlK(d.individualTarget)
        : `${num(d.kind === "produto" ? piso : d.individualTarget, 0)} un`;
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
  let prazoTom: ChallengeView["prazoTom"];
  let daysRemaining: number;
  let prazoRotulo: string;
  if (TODAY_ISO < d.start) {
    statusLabel = "A começar";
    statusVariant = "info";
    prazoTom = "muted";
    daysRemaining = eachDay(TODAY_ISO, d.start).length - 1;
    prazoRotulo = daysRemaining <= 0 ? "Hoje" : `Em ${dayCountLabel(daysRemaining)}`;
  } else if (TODAY_ISO > d.end) {
    statusLabel = "Encerrado";
    statusVariant = "neutral";
    prazoTom = "bad";
    daysRemaining = 0;
    prazoRotulo = "Encerrado";
  } else {
    statusLabel = "Ativo";
    statusVariant = "success";
    prazoTom = "ok";
    daysRemaining = eachDay(TODAY_ISO, d.end).length;
    prazoRotulo = dayCountLabel(daysRemaining);
  }

  const fechaNoRitmo =
    semEngajamento || statusLabel !== "Ativo"
      ? false
      : atingiram >= minimoGerente || projetado >= alvoAgregado;
  const description =
    minimumLabel != null
      ? `Meta: ${goalLabel} · Mínimo: ${minimumLabel} · Prêmio: ${brl(d.prize)}`
      : `Meta: ${goalLabel} · Prêmio: ${brl(d.prize)}`;
  const storeLabel = d.storeId
    ? storeById(d.storeId).fantasia.replace(/^Shopping\s+/i, "")
    : "Rede";
  return {
    id: d.id,
    name: d.name,
    description,
    objective: d.objective,
    goalLabel,
    minimum: d.minimum,
    temMinimo: d.minimum != null,
    kind: d.kind,
    corIcone: COR_ICONE_DESAFIO[d.id] ?? COR_ICONE_TIPO[d.kind],
    individualTarget: d.individualTarget,
    unit: d.unit,
    prize: d.prize,
    premioGerente: d.premioGerente,
    minimoVendedorasAtingindo: minimoGerente,
    participants: ids.length,
    engajadas: linhas.filter((p) => p.status !== "nao_comecou").length,
    progressoAgregado,
    alvoAgregado,
    progressoPct: alvoAgregado > 0 ? (progressoAgregado / alvoAgregado) * 100 : 0,
    progressoAgregadoRotulo: progressLabel(progressoAgregado, alvoAgregado, d),
    atingiram,
    projetadoAgregado: projetado,
    fechaNoRitmo,
    semEngajamento,
    tipoTexto: TIPO_TEXTO[d.kind],
    daysRemaining,
    prazoRotulo,
    janelaRotulo: `${shortDate(d.start)} – ${shortDate(d.end)}`,
    prazoTom,
    statusLabel,
    statusVariant,
    storeId: d.storeId,
    storeLabel,
    showStore,
    ranking,
  };
}

function openDaysInPeriod(competence: string, scopedStoreIds: string[]): { elapsedOpenDays: number; totais: number } {
  const primeiro = `${competence}-01`;
  const ultimo = endOfMonth(primeiro);
  const openOnes = eachDay(primeiro, ultimo).filter((iso) => scopedStoreIds.some((id) => storeOpen(storeById(id), iso)));
  const elapsedOpenDays = openOnes.filter((iso) => iso <= TODAY_ISO).length;
  return { elapsedOpenDays, totais: openOnes.length };
}

/** Lista da Equipe/Ao vivo: so desafios vigentes (status Ativo). Encerrados e "a comecar" ficam de fora. */
function challengesViewForCompetence(competence: string, scopedStoreIds: string[]): ChallengeView[] {
  const { elapsedOpenDays, totais } = openDaysInPeriod(competence, scopedStoreIds);
  const showStore = scopedStoreIds.length > 1;
  return challengesInScope(competence, scopedStoreIds)
    .map((d) => desafioView(d, elapsedOpenDays, totais, scopedStoreIds, showStore))
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
  const primeiro = `${competence}-01`;
  const closed = endOfMonth(primeiro) < TODAY_ISO;

  if (closed) {
    return sellers.reduce((s, l) => s + l.accruedPrize + l.bonusReached, 0);
  }

  const curva = revenueCurve([branch], competence);
  let accumulatedShare = 0;
  for (const iso of eachDay(primeiro, TODAY_ISO)) accumulatedShare += curva.peso(iso);
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
        const projetado = (p / elapsedOpenDays) * totais;
        if (projetado >= d.individualTarget) total += d.prize;
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
  const escada = ladderPrize(storeId, competence, sellers);
  const challenges = challengePrizes(competence, [storeId]);
  if (escada === null) return challenges > 0 ? challenges : null;
  return escada + challenges;
}

/* ------------------------- Leitura da IA (EQUIP-06) ------------------------- */

/**
 * Leitura da aba: no produto o LLM redige a partir dos numeros; aqui a frase
 * e montada por regra. Desativada na UI por enquanto (EQUIP-06)  -  mantida
 * exportada para reativar sem reescrever a logica.
 */
export function buildTeamInsight(v: TeamView): string | null {
  const partes: string[] = [];
  const linhas = v.sellers ?? [];

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
    const emRisco = linhas.filter((l) => l.attainmentPct < 100 && l.trend === "down");
    if (emRisco.length > 0) {
      const nomes = emRisco.map((l) => firstName(l.name)).join(", ");
      const acao = emRisco.length === 1 ? `Vale uma conversa hoje com ${firstName(emRisco[0].name)}` : "Vale conversar com cada pessoa hoje";
      partes.push(`${nomes} ${emRisco.length === 1 ? "está" : "estão"} abaixo da meta individual e caindo. ${acao}.`);
    }
  }
  return partes.length > 0 ? partes.join(" ") : null;
}

function firstName(nomeCompleto: string): string {
  return nomeCompleto.split(" ")[0];
}

function buildGoalBand(achieved: number, total: number, competence: string, storesInScope: Store[]): NetworkGlobalGoal | null {
  if (total <= 0) return null;
  const primeiro = `${competence}-01`;
  const ultimo = endOfMonth(primeiro);
  const pct = (achieved / total) * 100;
  const closed = ultimo < TODAY_ISO;
  let projectedPct = pct;
  if (!closed) {
    const curva = revenueCurve(storesInScope, competence);
    let accumulatedShare = 0;
    for (const iso of eachDay(primeiro, TODAY_ISO)) accumulatedShare += curva.peso(iso);
    if (accumulatedShare > 0) projectedPct = (achieved / accumulatedShare / total) * 100;
  }
  const remainingOpen = eachDay(TODAY_ISO, ultimo).filter((iso) => storesInScope.some((f) => storeOpen(f, iso)));
  const goalName =
    storesInScope.map((f) => goalOfStore(f.id, competence)?.name).find((n): n is string => Boolean(n)) ?? monthYear(primeiro);
  return {
    competenceText: goalName,
    achieved,
    total,
    pct,
    projectedPct,
    daysRemaining: closed ? 0 : remainingOpen.length,
    start: primeiro,
    end: ultimo,
  };
}

/**
 * Faixa da meta com o faturamento da loja (inclui venda sem vendedora e gerencia, que ficam fora do
 * ranking) + quanto disso nao esta na equipe.
 */
function bandWithOutsideTeam(
  band: NetworkGlobalGoal | null,
  somaEquipe: number,
): NetworkGlobalGoal | null {
  if (!band) return null;
  const fora = Math.round((band.achieved - somaEquipe) * 100) / 100;
  return fora > 0 ? { ...band, outsideTeam: fora } : band;
}

/** Faturamento da competencia filtrado por marca (1 marca) ou total (null). */
function achievedCompetence(storeId: string, competence: string, brand: GoalBrand | null): number {
  const primeiro = `${competence}-01`;
  const ultimo = endOfMonth(primeiro);
  const fimReal = ultimo < TODAY_ISO ? ultimo : TODAY_ISO;
  return sumAggregates(
    eachDay(primeiro, fimReal).map((iso) => {
      const dia = salesDay(storeId, iso);
      if (!dia) return { revenue: 0, salesCount: 0, itens: 0 };
      return dayAggregate(dia, brand, iso === TODAY_ISO ? CURRENT_HOUR : undefined);
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
    const lista = sellersByBranch.get(storeId) ?? [];
    const groupCount = groupsForBranch(storeId).length;
    for (const m of goalsOfStore(storeId, competence)) {
      const singleBrand = m.brands.length === 1 ? m.brands[0] : null;
      const achieved = achievedCompetence(storeId, competence, singleBrand);
      const band = singleBrand
        ? buildGoalBand(achieved, m.storeAmount, competence, [branch])
        : bandWithOutsideTeam(
            buildGoalBand(achieved, m.storeAmount, competence, [branch]),
            lista.reduce((s, l) => s + l.revenueAmount, 0),
          );
      if (!band) continue;
      band.competenceText = m.name;
      cards.push({
        id: m.id,
        name: m.name,
        kind: m.kind,
        storeNameValue: branch.fantasia,
        brands: m.brands,
        qtdGrupos: groupCount,
        qtdVendedoras: lista.length,
        qtdNiveis: m.tiers.length,
        tiers: m.tiers,
        band,
        sellers: lista,
      });
    }
  }
  return cards;
}

/* ------------------------- Evolucao Fat vs Meta (padrao Visao Geral) ------------------------- */

const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function storesDayRevenue(storeIds: string[], iso: string): number {
  return sumAggregates(
    storeIds.map((id) => {
      const dia = salesDay(id, iso);
      return dia ? dayAggregate(dia, null, iso === TODAY_ISO ? CURRENT_HOUR : undefined) : { revenue: 0, salesCount: 0, itens: 0 };
    }),
  ).revenue;
}

function fatHoraFiliais(storeIds: string[], iso: string, h: number): number {
  let fat = 0;
  for (const id of storeIds) {
    const a = salesDay(id, iso)?.porHora[h];
    if (a) fat += a.revenue;
  }
  return fat;
}

function mesesEntre(start: string, end: string): string[] {
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
): { pontos: { label: string; achieved: number; goal: number }[]; seriesLabel: string } | undefined {
  const eixo = seriesAxisForPeriod(period);
  const seriesLabel = seriesAxisLabel(period, eixo);
  const pontos: { label: string; achieved: number; goal: number }[] = [];

  if (eixo === "hour") {
    const fs = storeIds.map((id) => storeById(id)).filter((f): f is Store => Boolean(f));
    if (fs.length === 0) return undefined;
    const abertura = Math.min(...fs.map((f) => f.abertura));
    const fechamento = Math.max(...fs.map((f) => f.fechamento));
    const horas: number[] = [];
    for (let h = abertura; h < fechamento; h++) horas.push(h);
    const horasVisiveis = period.isToday ? horas.filter((h) => h <= CURRENT_HOUR) : horas;
    if (horasVisiveis.length < 2) return undefined;
    const goalByHour = metaTotal > 0 && horas.length > 0 ? metaTotal / horas.length : 0;
    let acumR = 0;
    let acumM = 0;
    for (const h of horasVisiveis) {
      acumR += fatHoraFiliais(storeIds, period.start, h);
      acumM += goalByHour;
      pontos.push({ label: shortHour(h), achieved: acumR, goal: acumM });
    }
  } else if (eixo === "month") {
    const meses = mesesEntre(period.start, period.end);
    if (meses.length < 2) return undefined;
    const goalByMonth = metaTotal > 0 ? metaTotal / meses.length : 0;
    let acumR = 0;
    let acumM = 0;
    for (const mes of meses) {
      const monthStart = `${mes}-01`;
      const fimMes = endOfMonth(monthStart);
      const ini = monthStart < period.start ? period.start : monthStart;
      const end = fimMes > period.end ? period.end : fimMes;
      for (const iso of eachDay(ini, end)) {
        acumR += storesDayRevenue(storeIds, iso);
      }
      acumM += goalByMonth;
      pontos.push({ label: monthYear(monthStart).split(" de ")[0], achieved: acumR, goal: acumM });
    }
  } else {
    const dias = eachDay(period.start, period.end);
    if (dias.length < 2) return undefined;
    const goalByDay = metaTotal > 0 ? metaTotal / dias.length : 0;
    let acumR = 0;
    let acumM = 0;
    for (const iso of dias) {
      acumR += storesDayRevenue(storeIds, iso);
      acumM += goalByDay;
      const d = isoToDate(iso);
      pontos.push({
        label: `${String(d.getDate()).padStart(2, "0")} ${MESES_CURTOS[d.getMonth()]}`,
        achieved: acumR,
        goal: acumM,
      });
    }
  }

  return pontos.length > 1 ? { pontos, seriesLabel } : undefined;
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
  const ant = previousPeriod(period);
  // KPIs de desempenho: periodo filtrado (AD-046).
  const atual = storeAggregate(storeId, period.start, period.end);
  const anterior = sumAggregates(
    eachDay(ant.start, ant.end).map((iso) => {
      const dia = salesDay(storeId, iso);
      if (!dia) return { revenue: 0, salesCount: 0, itens: 0 };
      const horaMax = iso === ant.end && ant.horaMax !== undefined ? ant.horaMax : undefined;
      return dayAggregate(dia, null, horaMax);
    }),
  );

  const temComparacao = anterior.salesCount > 0;
  const vsLabel = temComparacao ? ant.label : undefined;
  const ticket = divSeguro(atual.revenue, atual.salesCount);
  const pa = divSeguro(atual.itens, atual.salesCount);
  const ticketAnt = divSeguro(anterior.revenue, anterior.salesCount);
  const paAnt = divSeguro(anterior.itens, anterior.salesCount);

  // Series diarias para sparklines nos KPIs
  const periodDays = eachDay(period.start, period.end);
  const serieFat: number[] = [];
  const serieAtend: number[] = [];
  const serieTicket: number[] = [];
  const seriePA: number[] = [];
  for (const iso of periodDays) {
    const dia = salesDay(storeId, iso);
    if (!dia) {
      serieFat.push(0);
      serieAtend.push(0);
      serieTicket.push(0);
      seriePA.push(0);
      continue;
    }
    const ag = dayAggregate(dia, null, iso === TODAY_ISO ? CURRENT_HOUR : undefined);
    serieFat.push(ag.revenue);
    serieAtend.push(ag.salesCount);
    serieTicket.push(divSeguro(ag.revenue, ag.salesCount));
    seriePA.push(divSeguro(ag.itens, ag.salesCount));
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

  const nDias = periodDays.length;
  const evolucao = buildRevenueVsGoal([storeId], period, storeGoalAmount);
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
      amount: brlK(atual.revenue),
      delta: temComparacao ? kpiDelta(atual.revenue, anterior.revenue, vsLabel) : undefined,
      sub: storeGoalAmount > 0 ? `Meta: ${brlK(storeGoalAmount)}` : undefined,
      serie: serieFat.length > 1 ? serieFat : undefined,
    },
    kpiSalesCount: {
      amount: num(atual.salesCount),
      delta: temComparacao ? kpiDelta(atual.salesCount, anterior.salesCount, vsLabel, "vendas") : undefined,
      sub: nDias > 1 ? `Média de ${num(atual.salesCount / nDias, 0)}/dia` : undefined,
      serie: serieAtend.length > 1 ? serieAtend : undefined,
    },
    kpiTicket: {
      amount: brl(ticket),
      delta: temComparacao ? kpiDelta(ticket, ticketAnt, vsLabel) : undefined,
      serie: serieTicket.length > 1 ? serieTicket : undefined,
    },
    kpiPA: {
      amount: num(pa, 2),
      delta: temComparacao ? kpiDelta(pa, paAnt, vsLabel, "pa") : undefined,
      serie: seriePA.length > 1 ? seriePA : undefined,
    },
    kpiPrize: prizeAmount === null ? null : { amount: brl(prizeAmount), delta: undefined },
    networkGoal,
    goalCardsList,
    leitura: null,
    revenueEvolution: evolucao?.pontos,
    seriesLabel: evolucao?.seriesLabel,
    availableGroups: groupsForBranch(storeId),
    sellers,
    storeRows: null,
    challenges,
    states: {
      kpis: "available",
      leitura: "noData",
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
    const linhas = storeValue.sellers ?? [];
    sellersFlat.push(...linhas);
    sellersByBranch.set(f.id, linhas);
    const withGoal = activeGoal ? linhas.filter((l) => !l.noGoal) : [];
    const ordenadas = [...withGoal].sort((a, b) => b.attainmentPct - a.attainmentPct);
    const melhor = ordenadas.length > 0 ? { name: firstName(ordenadas[0].name), attainmentPct: ordenadas[0].attainmentPct } : null;
    const pior = ordenadas.length > 0 ? { name: firstName(ordenadas[ordenadas.length - 1].name), attainmentPct: ordenadas[ordenadas.length - 1].attainmentPct } : null;
    const goalAmount = goalOfStore(f.id, competence)?.storeAmount ?? 0;
    const achievedAmount = linhas.reduce((s, l) => s + l.revenueAmount, 0);
    return {
      storeId: f.id,
      name: f.fantasia,
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
      melhor,
      pior,
    };
  });

  // Flat da rede: mesma regra de ordenacao da loja (atingimento / faturamento).
  sellersFlat.sort((a, b) => {
    const ka = activeGoal && !a.noGoal ? a.attainmentPct : a.revenueAmount;
    const kb = activeGoal && !b.noGoal ? b.attainmentPct : b.revenueAmount;
    return kb - ka;
  });

  // KPIs da rede: soma das lojas (ticket e P.A. recalculados sobre a soma).
  const atual = sumAggregates(stores.map((f) => storeAggregate(f.id, period.start, period.end)));
  const ant = previousPeriod(period);
  const anterior = sumAggregates(
    eachDay(ant.start, ant.end).map((iso) => {
      const horaMax = iso === ant.end && ant.horaMax !== undefined ? ant.horaMax : undefined;
      return sumAggregates(stores.map((f) => {
        const dia = salesDay(f.id, iso);
        return dia ? dayAggregate(dia, null, horaMax) : { revenue: 0, salesCount: 0, itens: 0 };
      }));
    }),
  );
  const temComparacao = anterior.salesCount > 0;
  const vsLabel = temComparacao ? ant.label : undefined;

  // Series diarias para sparklines nos KPIs da rede
  const networkPeriodDays = eachDay(period.start, period.end);
  const serieFatRede: number[] = [];
  const serieAtendRede: number[] = [];
  const serieTicketRede: number[] = [];
  const seriePARede: number[] = [];
  for (const iso of networkPeriodDays) {
    const agDia = sumAggregates(stores.map((f) => {
      const dia = salesDay(f.id, iso);
      return dia ? dayAggregate(dia, null, iso === TODAY_ISO ? CURRENT_HOUR : undefined) : { revenue: 0, salesCount: 0, itens: 0 };
    }));
    serieFatRede.push(agDia.revenue);
    serieAtendRede.push(agDia.salesCount);
    serieTicketRede.push(divSeguro(agDia.revenue, agDia.salesCount));
    seriePARede.push(divSeguro(agDia.itens, agDia.salesCount));
  }

  const challenges = activeGoal ? challengesViewForCompetence(competence, stores.map((f) => f.id)) : null;
  const withoutChallenges = activeGoal && (challenges === null || challenges.length === 0);

// Premiacao da rede = escada de metas de cada loja + desafios uma unica
// vez (desafio e da competencia inteira, nao por loja).
let premiacaoRede: number | null = null;
if (activeGoal) {
  let parteEscada = 0;
  for (const f of stores) {
    const storeValue = storeView({ ...scope, storeIds: [f.id] }, period, goalPeriod, competence, activeGoal);
    const storeLadder = ladderPrize(f.id, competence, storeValue.sellers ?? []);
    if (storeLadder !== null) parteEscada += storeLadder;
  }
  const challengesPart = challengePrizes(competence, stores.map((f) => f.id));
  premiacaoRede = parteEscada > 0 || challengesPart > 0 ? parteEscada + challengesPart : null;
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

  const evolucaoRede = buildRevenueVsGoal(
    stores.map((f) => f.id),
    period,
    activeGoal ? globalGoalTotal : 0,
  );

  const nDiasRede = networkPeriodDays.length;
  const paRede = divSeguro(atual.itens, atual.salesCount);
  const ticketRede = divSeguro(atual.revenue, atual.salesCount);
  const paRedeAnt = divSeguro(anterior.itens, anterior.salesCount);
  const ticketRedeAnt = divSeguro(anterior.revenue, anterior.salesCount);

  return {
    scope,
    period,
    scopeView: "network",
    competence,
    activeGoal,
    competenceNotice: null,
    notices: [],
    kpiRevenue: {
      amount: brlK(atual.revenue),
      delta: temComparacao ? kpiDelta(atual.revenue, anterior.revenue, vsLabel) : undefined,
      sub: globalGoalTotal > 0 ? `Meta: ${brlK(globalGoalTotal)}` : undefined,
      serie: serieFatRede.length > 1 ? serieFatRede : undefined,
    },
    kpiSalesCount: {
      amount: num(atual.salesCount),
      delta: temComparacao ? kpiDelta(atual.salesCount, anterior.salesCount, vsLabel, "vendas") : undefined,
      sub: nDiasRede > 1 ? `Média de ${num(atual.salesCount / nDiasRede, 0)}/dia` : undefined,
      serie: serieAtendRede.length > 1 ? serieAtendRede : undefined,
    },
    kpiTicket: {
      amount: brl(ticketRede),
      delta: temComparacao ? kpiDelta(ticketRede, ticketRedeAnt, vsLabel) : undefined,
      serie: serieTicketRede.length > 1 ? serieTicketRede : undefined,
    },
    kpiPA: {
      amount: num(paRede, 2),
      delta: temComparacao ? kpiDelta(paRede, paRedeAnt, vsLabel, "pa") : undefined,
      serie: seriePARede.length > 1 ? seriePARede : undefined,
    },
    kpiPrize: premiacaoRede === null ? null : { amount: brl(premiacaoRede), delta: undefined },
    networkGoal,
    goalCardsList,
    leitura: null,
    revenueEvolution: evolucaoRede?.pontos,
    seriesLabel: evolucaoRede?.seriesLabel,
    availableGroups: groupsInScope([]),
    sellers: sellersFlat,
    storeRows: storeRows,
    challenges,
    states: {
      kpis: "available",
      leitura: "noData",
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
  const ehRede = scope.storeIds.length === 0;
  const storesInScope = ehRede ? stores : scope.storeIds.map((id) => storeById(id)).filter(Boolean) as Store[];
  // Meta ativa = existe meta cadastrada na competencia (nao depende mais do filtro).
  const activeGoal = storesInScope.some((f) => Boolean(goalOfStore(f.id, competence)));

  const v = ehRede ? networkView(scope, period, goalPeriod, competence, activeGoal) : storeView(scope, period, goalPeriod, competence, activeGoal);

  if (activeGoal && !periodMatchesCompetence(period, competence)) {
    v.competenceNotice = `Os indicadores seguem o período selecionado. Metas, premiações e desafios consideram a competência ${monthYear(`${competence}-01`)}.`;
  } else if (activeGoal && period.kind === "lastMonth") {
    v.competenceNotice = `Metas e premiações referentes à competência ${monthYear(`${competence}-01`)}.`;
  }

  v.leitura = null;
  v.states.leitura = "noData";
  return v;
}