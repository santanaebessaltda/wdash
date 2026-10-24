/**
 * Camada de visoes da Visao geral. Faz o papel do backend: recebe o escopo
 * (filial, periodo, divisao) e devolve os blocos com numeros prontos.
 *
 * AD-047  -  adaptar, nao esconder: o grafico principal e por hora (1 dia) ou
 * por dia (periodo > 1 dia), inclusive na rede. A regua sempre aparece:
 * % da meta, % da marca na rede, ou participacao da marca na loja unica.
 * AD-048  -  KPIs com subtitulo so do proprio indicador; grafico compara
 * periodos no mesmo eixo (padrao Finance / Revenue vs expenses).
 */
import { rentSeasonFactor } from "./rentSeason";
import { categories, stores, productStores, tasks, groups, storeOperatingCostsConfigured, unknownProductStore, type Division, type Store } from "./stores";
import { goalOfStore } from "./goals";
import { productsOfCategory } from "./products";
import { buildProductLineIndex } from "./productLines";
import { NOW, UPDATED_AT, TODAY_ISO, CURRENT_HOUR, SYNC_INTERVAL_MIN, LAST_SYNC, calendarTodayIso, calendarCurrentHour } from "./clock";
import { defaultWeekHours, effectiveWeekHours, hourAxisRange, unionOpenWindow, type Dow } from "./storeHours";
import { hourShares, periodDailyGoal, weekdayWeights } from "./goalCurve";
import { goalStoreClosing } from "./engine/goalProjection";
import { dayInGeneralGoal, sellerGoalLevels } from "./goalView";
import { sellerOrigin } from "./engine/salesOrigin";
import { dayAggregate, salesDay, salesDays, storeOpen, dayWeight, sumAggregates, type Aggregate } from "./sales";
import { brl, brlCent, fullDate, shortDate, dayAxisLabel, dayPointDetail, isoToDate, delta as fmtDelta, hourSpan, endOfMonth, shortHour, startOfMonth, eachDay, labelUpper, monthYear, shortMonth, pct, addDays } from "@/lib/format";
import type { TintKey } from "@/pages/dashboards/icons";
import { buildStoreInsight } from "./insight";

/** Destaques da equipe na Visão geral. */
export const OVERVIEW_TEAM_TOP = 5;

/** Top produtos na Visão geral. */
export const OVERVIEW_PRODUCTS_TOP = 5;

export type PeriodType =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "thisMonth"
  | "thisQuarter"
  | "thisHalf"
  | "thisYear"
  /** Legados (URL antiga / testes)  -  ainda resolvem. */
  | "last7Days"
  | "lastMonth"
  | "custom";

/** Uma cor por loja, fixa pela posicao no cadastro: a loja nao muda de cor conforme o desempenho, como nao muda o "Desktop"/"Mobile" da demo. */
const STORE_TINTS: TintKey[] = ["acc", "ok", "info", "warn", "bad"];

export interface Period {
  kind: PeriodType;
  start?: string;
  end?: string;
}

export type Granularity = "day" | "period" | "month";

export interface ResolvedPeriod {
  kind: PeriodType;
  start: string;
  end: string;
  granularity: Granularity;
  spansMonths: boolean;
  isToday: boolean;
  /** Ultimo dia do periodo = hoje (dia ainda em andamento). */
  endsToday: boolean;
  openMonth: boolean;
  label: string;
}

export interface Scope {
  /**
   * Lojas selecionadas (multi-select). Array vazio = "Todas as lojas"
   * (consolida a rede). Um id = visao detalhada daquela loja. Varios =
   * soma daquelas lojas. Substitui o antigo `filialId: string | "todas"`.
   */
  storeIds: string[];
  period: Period;
  division: Division | null;
}

export const periodLabels: Record<PeriodType, string> = {
  today: "Hoje",
  thisWeek: "Esta semana",
  thisMonth: "Este mês",
  thisQuarter: "Este trimestre",
  thisHalf: "Este semestre",
  thisYear: "Este ano",
  yesterday: "Ontem",
  "last7Days": "7 dias",
  lastMonth: "Mês passado",
  custom: "Personalizado",
};

/** Presets do DateRangePicker (ordem dos pills). */
export const PERIOD_PRESETS: PeriodType[] = [
  "today",
  "yesterday",
  "thisWeek",
  "thisMonth",
  "thisQuarter",
  "thisHalf",
  "thisYear",
];

/* ---------- Tipos do motor de trilho ---------- */

export type BlockState = "available" | "loading" | "noData" | "unavailable";

export interface StoreBlockStates {
  kpis: BlockState;
  trilho: BlockState;
  saleRequired: BlockState;
  projection: BlockState;
  diagnostico: BlockState;
  mix: BlockState;
  storeRows: BlockState;
}

export type TrackStatus = "onTrack" | "attention" | "below" | "goalHit" | "goalMissed";

export interface TrackView {
  status: TrackStatus;
  /** Percentual do trilho (realizado  meta x fracao acumulada da curva), null em competencia encerrada. */
  pctTrilho: number | null;
  competence: string;
}

export interface RequiredSalesView {
  /** (faltaRestante x pesoHoje   pesosRestantes)  realizadoHoje */
  amount: number | null;
  achievedToday: number;
  gapRemaining: number;
  daysRemaining: number;
  dayReference: string;
  cumpridaToday: boolean;
  metaMonthAtingida: boolean;
  noGoal: boolean;
}

export interface GapView {
  display: boolean;
  efeitoFluxo: number;
  efeitoTicket: number;
  gapTotal: number;
  alavancaDominante: "fluxo" | "ticket" | null;
  noGoal: boolean;
}

export interface MixView {
  items: { category: string; division: string; margin: number; revenue: number; pct: number }[];
  period: string;
}

/** Linha da visao de grupo (LOJA-05): status do trilho por loja + se tem meta. */
export interface StoreSummaryView {
  storeId: string;
  name: string;
  pctTrilho: number | null;
  status: TrackStatus;
  hasMeta: boolean;
}

const DAYS_WEEK = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const TIP_CMV = "Custo das mercadorias vendidas no período.";
const TIP_CMV_INDISPONIVEL = "O CMV não está disponível para este período.";
const TIP_PROFIT_GROSS = "Valor que permanece após descontar o CMV do faturamento.";
const TIP_MARGIN = "Percentual do faturamento que permanece como lucro bruto após o CMV.";
const TIP_CMV_WPINK = "Custo das mercadorias WPINK vendidas no período.";
const TIP_CMV_WPINK_INDISPONIVEL = "O CMV WPINK não está disponível para este período.";
const TIP_PROFIT_GROSS_WPINK = "Valor que permanece do faturamento WPINK após descontar o CMV.";
const TIP_MARGIN_WPINK = "Percentual do faturamento WPINK que permanece como lucro bruto após o CMV.";
const DAY_WEEK_PAST = [
  "o domingo passado",
  "a segunda-feira passada",
  "a terça-feira passada",
  "a quarta-feira passada",
  "a quinta-feira passada",
  "a sexta-feira passada",
  "o sábado passado",
];

/** Segunda-feira da semana ISO (PT-BR) que contem `hojeIso`. */
function startOfWeekDate(todayIso: string): string {
  const d = isoToDate(todayIso);
  const dow = d.getDay(); // 0=dom ... 6=sab
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(todayIso, diff);
}

function startOfQuarter(todayIso: string): string {
  const d = isoToDate(todayIso);
  const month = Math.floor(d.getMonth() / 3) * 3; // 0,3,6,9
  return `${d.getFullYear()}-${String(month + 1).padStart(2, "0")}-01`;
}

function startOfHalf(todayIso: string): string {
  const d = isoToDate(todayIso);
  const month = d.getMonth() < 6 ? 0 : 6;
  return `${d.getFullYear()}-${String(month + 1).padStart(2, "0")}-01`;
}

export function resolvePeriod(p: Period, todayIso: string = TODAY_ISO): ResolvedPeriod {
  const todayDate = isoToDate(todayIso);
  const monthPastRef = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1);
  const monthPastIso = `${monthPastRef.getFullYear()}-${String(monthPastRef.getMonth() + 1).padStart(2, "0")}-01`;
  let start: string;
  let end: string;
  switch (p.kind) {
    case "today":
      start = end = todayIso;
      break;
    case "yesterday":
      start = end = addDays(todayIso, -1);
      break;
    case "last7Days":
      start = addDays(todayIso, -6);
      end = todayIso;
      break;
    case "thisWeek":
      start = startOfWeekDate(todayIso);
      end = todayIso;
      break;
    case "thisMonth":
      start = startOfMonth(todayIso);
      end = todayIso;
      break;
    case "thisQuarter":
      start = startOfQuarter(todayIso);
      end = todayIso;
      break;
    case "thisHalf":
      start = startOfHalf(todayIso);
      end = todayIso;
      break;
    case "thisYear":
      start = `${todayDate.getFullYear()}-01-01`;
      end = todayIso;
      break;
    case "lastMonth":
      start = monthPastIso;
      end = endOfMonth(monthPastIso);
      break;
    case "custom":
      start = p.start ?? addDays(todayIso, -6);
      end = p.end ?? todayIso;
      if (end > todayIso) end = todayIso;
      if (start > end) start = end;
      break;
  }
  const days = eachDay(start, end).length;
  const spansMonths = start.slice(0, 7) !== end.slice(0, 7);
  const granularity: Granularity =
    days === 1 ? "day" : p.kind === "thisMonth" || p.kind === "lastMonth" ? "month" : "period";
  const isToday = start === todayIso && end === todayIso;
  const endsToday = end === todayIso;
  const openMonth = granularity === "month" && !spansMonths && start.slice(0, 7) === todayIso.slice(0, 7);

  let label: string;
  if (
    p.kind !== "custom" &&
    p.kind !== "last7Days" &&
    p.kind !== "thisMonth" &&
    p.kind !== "lastMonth"
  ) {
    label = periodLabels[p.kind];
  } else if (granularity === "day") label = isToday ? "Hoje" : shortDate(start);
  else if (p.kind === "thisMonth" || p.kind === "lastMonth") label = monthYear(start);
  else label = `${shortDate(start)} a ${shortDate(end)}`;

  return { kind: p.kind, start, end, granularity, spansMonths, isToday, endsToday, openMonth, label };
}

/* ---------- Tipos dos blocos ---------- */

export interface SystemAlert {
  id: string;
  text: string;
  tone: "warning" | "danger" | "info";
}

/** Um indicador do topo, no formato do KpiTile do template. */
export interface KpiAmount {
  amount: string;
  delta?: { value: string; positive: boolean; /** Rotulo curto da base, ex.: "ago" / "Segunda passada" */ vs?: string };
  /** Serie curta para o traco de tendencia. So o Faturamento usa. */
  series?: number[];
  /** So o Faturamento sobrescreve rotulo e subtitulo  -  os outros usam o texto fixo do componente. */
  label?: string;
  sub?: string;
}

/** Segundo tile da fileira: Meta do mes (dia), Projecao (mes) ou Participacao da marca (recorte por marca). Mesmo lugar, papel diferente conforme o contexto. */
export interface GoalProjectionTile {
  kind: "meta" | "projecao" | "participacao" | "unavailable";
  label: string;
  amountPrincipal: string;
  barPct: number;
  detail: string;
}

/** Card lateral da rede: so enquanto a meta esta em jogo (nao fechada, nao batida antes da hora). */
export interface PaceCard {
  achievedDay: string;
  requiredDay: string;
  projectionLine: string;
  /** Projecao sobre meta, 0-100, pra desenhar a barra. */
  barPct: number;
}

export interface RulerRow {
  storeId: string;
  name: string;
  revenue: string;
  revenueAmount: number;
  attainmentPct: number;
  /** Ja inclui o sufixo pronto: "42% da meta" ou "23% da marca". */
  attainmentText: string;
  barPct: number;
  /** Cor de identidade da loja, estavel independente da ordenacao por desempenho. */
  tint: TintKey;
  variationDay: { value: string; positive: boolean } | null;
  variationDayAmount: number | null;
}

/** Loja fora do ritmo da propria meta: quem precisa de atencao, nao quem vendeu mais. */
export interface AttentionPoint {
  storeId: string;
  name: string;
  attainmentText: string;
  status: string;
  gapByDay: string;
  veredito: "nao_atinge" | "incerto";
}

export interface HourChart {
  hours: number[];
  amounts: number[];
  /** Mesmo dia da semana anterior (semana passada), alinhado por hora  -  AD-048. */
  previous: number[] | null;
  labelPrevious: string;
  hourCurrent: number | null;
}

/** Por hora, empilhado por loja  -  so na rede, periodo de um dia. Acima de 5 lojas, colapsa: uma cor so, soma simples. */
export interface NetworkHourChart {
  hours: number[];
  series: { storeId: string; name: string; tint: TintKey; amounts: number[] }[];
  hourCurrent: number | null;
  colapsado: boolean;
}

export interface EvolutionChart {
  rotulos: string[];
  amounts: number[];
  previous: number[] | null;
  labelPrevious: string;
}

export interface ProfitItem {
  label: string;
  amount: string;
  pct: string;
}

export interface CategoryRow {
  categoryId: number;
  name: string;
  revenue: string;
  margin: string;
  marginPct: string;
  /** Relativa a maior margem em R$ do grupo  -  pra desenhar a barra da lista. */
  barPct: number;
}

export interface GroupRow {
  id: string;
  name: string;
  schedule: string;
  status: "ended" | "inProgress" | "notStarted";
  done: number;
  total: number;
  tasks: { title: string; done: boolean }[];
}

/** Checklist do dia: um grupo por linha, cada um com o proprio estado e lista de tarefas. */
export interface DayChecklist {
  dataText: string;
  groups: GroupRow[];
}

export interface ProjectionView {
  amount: number | null;
  available: boolean;
  closed: boolean;
  /** Indice de desempenho da competencia (realizado  meta acumulada), usado para escalar a curva restante. */
  index: number | null;
  /** Meta mensal em R$  -  para a UI desenhar a barra sem duplicar o pct (AD-029). */
  goalAmount: number;
}

/** Periodo com agregados consolidados para a comparacao unica (LOJA-06 AC 1-3). */
export interface PeriodAggregateComparison {
  start: string;
  end: string;
  revenue: number;
  salesCount: number;
  items: number;
}

export interface ComparisonView {
  current: PeriodAggregateComparison;
  previous: PeriodAggregateComparison;
  labelCurrent: string;
  labelPrevious: string;
}

export interface StoreView {
  scope: Scope;
  period: ResolvedPeriod;
  atualizadoAs: string;
  nextSyncMin: number;
  scopeView: "network" | "day" | "period";
  alerts: SystemAlert[];
  reading: string | null;
  notices: string[];
  comparison: ComparisonView | null;
  trilho: TrackView | null;
  saleRequired: RequiredSalesView | null;
  projection: ProjectionView | null;
  diagnostico: GapView | null;
  mix: MixView | null;
  storeRows: StoreSummaryView[];
  states: StoreBlockStates;
  kpiRevenue: KpiAmount;
  kpiTicket: KpiAmount;
  kpiPA: KpiAmount;
  kpiSalesCount: KpiAmount;
  tileMeta: GoalProjectionTile | null;
  pace: PaceCard | null;
  paceNotice: string | null;
  regua: RulerRow[] | null;
  /** Titulo da regua: "Desempenho das lojas" (rede) ou "Desempenho da loja" (uma loja). */
  reguaTitle: string;
  pointsAttention: AttentionPoint[] | null;
  chartHour: HourChart | null;
  chartHourNetwork: NetworkHourChart | null;
  evolution: EvolutionChart | null;
  checklist: DayChecklist | null;
  profitGross: { items: ProfitItem[]; notice: string; divisionLine: string | null } | null;
  categories: CategoryRow[] | null;
}

/* ---------- Helpers ---------- */

function storesInScope(scope: Scope): Store[] {
  // Array vazio = "Todas as lojas"  ->  consolida a rede (ERP hidratado, sem misturar mock).
  // Id explícito fora do catálogo (link público) continua no escopo: o ranking lê os agregados dele.
  const catalog = productStores();
  if (scope.storeIds.length === 0) return catalog;
  const byId = new Map(catalog.map((store) => [store.id, store]));
  return scope.storeIds.map((id) => byId.get(id) ?? unknownProductStore(id));
}

/** `horaMax` recorta so o ultimo dia (`fim`)  -  dia equivalente ao "hoje" em andamento. */
function periodAggregate(f: Store, start: string, end: string, division: Division | null, hourMax?: number): Aggregate {
  return sumAggregates(salesDays(f.id, start, end).map((d) => dayAggregate(d, division, d.data === end ? hourMax : undefined)));
}

function divSeguro(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

function pctDelta(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

/** Delta pronto para o KpiTile do template: sem sinal no texto, a seta ja indica. */
/** Unidade do valor comparado no tooltip do badge: R$ (padrao) ou quantidade com unidade (nunca o numero solto). */
export type DeltaUnit = "brl" | "items" | "sales" | "pa";

function previousWithUnit(v: number, unit: Exclude<DeltaUnit, "brl">): string {
  if (unit === "pa") return `${num(v, 2)} ${v === 1 ? "item" : "itens"} por venda`;
  const n = num(v, Number.isInteger(v) ? 0 : 2);
  if (unit === "items") return `${n} ${v === 1 ? "item" : "itens"}`;
  return `${n} ${v === 1 ? "venda" : "vendas"}`;
}

export function kpiDelta(current: number, previous: number, vs?: string, unit: DeltaUnit = "brl"): { value: string; positive: boolean; vs?: string; diff?: string; previous?: string } | undefined {
  const monetario = unit === "brl";
  if (previous <= 0) return undefined;
  const v = pctDelta(current, previous);
  const casas = Math.abs(v) < 10 ? 1 : 0;
  if (num(Math.abs(v), casas) === num(0, casas)) return undefined;
  const difference = Math.abs(current - previous);
  return {
    value: fmtDelta(v, casas).replace(/^[+−]/, ""),
    positive: v >= 0,
    ...(vs ? { vs } : {}),
    ...(monetario && difference > 0 ? { diff: brl(difference) } : {}),
    // Valor do periodo comparado (tooltip do badge).
    previous: unit === "brl" ? brlCent(previous) : previousWithUnit(previous, unit),
  };
}

/** Delta em pontos percentuais (margem etc.). Omite ~0 p.p.  -  mesmo criterio do kpiDelta. */
export function kpiDeltaPp(current: number, previous: number, vs?: string): { value: string; positive: boolean; vs?: string; previous?: string } | undefined {
  const diff = Math.abs(current - previous);
  if (num(diff, 1) === num(0, 1)) return undefined;
  return {
    value: `${num(diff, 1)} p.p.`,
    positive: current >= previous,
    ...(vs ? { vs } : {}),
    previous: `${num(previous, 1)}%`,
  };
}

/** Dias com loja aberta que ainda restam no mes corrente. */
function monthDaysRemaining(fs: Store[]): number {
  return eachDay(addDays(TODAY_ISO, 1), endOfMonth(TODAY_ISO)).filter((iso) => fs.some((f) => storeOpen(f, iso))).length;
}

/**
 * Serie curta de faturamento para o traco de tendencia do KPI: por hora
 * quando o periodo e um dia so (truncada na hora atual, sem horas futuras
 * zeradas que pareceriam queda), por dia nos demais periodos. Serve rede,
 * loja e mes com a mesma funcao, porque soma sobre `fs`.
 */
function aggregatedTrendSeries(fs: Store[], period: ResolvedPeriod, division: Division | null): Aggregate[] {
  if (period.granularity === "day") {
    const opening = Math.min(...fs.map((f) => f.opening));
    const closing = Math.max(...fs.map((f) => f.closing));
    const hours: number[] = [];
    for (let h = opening; h < closing; h++) hours.push(h);
    let points = hours.map((h) =>
      fs.reduce(
        (sum, f) => {
          const day = salesDay(f.id, period.start);
          const a = day?.byHour[h];
          if (!a) return sum;
          if (!division) return { revenue: sum.revenue + a.revenue, salesCount: sum.salesCount + a.salesCount, items: sum.items + a.items };
          const fr = day!.total.revenue > 0 ? day!.byDivision[division].revenue / day!.total.revenue : 0;
          return { revenue: sum.revenue + Math.round(a.revenue * fr), salesCount: sum.salesCount + Math.round(a.salesCount * fr), items: sum.items + Math.round(a.items * fr) };
        },
        { revenue: 0, salesCount: 0, items: 0 },
      ),
    );
    if (period.isToday) {
      const idx = hours.indexOf(CURRENT_HOUR);
      if (idx >= 0) points = points.slice(0, idx + 1);
    }
    return points;
  }
  const days = eachDay(period.start, period.end);
  return days.map((iso) => sumAggregates(fs.map((f) => dayAggregate(salesDay(f.id, iso)!, division))));
}

/** Uma serie por metrica, derivada dos mesmos pontos (por hora no dia, por dia nos demais periodos). */
function trendSeries(fs: Store[], period: ResolvedPeriod, division: Division | null): { revenue?: number[]; ticket?: number[]; pa?: number[]; salesCount?: number[] } {
  const points = aggregatedTrendSeries(fs, period, division);
  if (points.length < 2) return {};
  return {
    revenue: points.map((p) => p.revenue),
    ticket: points.map((p) => divSeguro(p.revenue, p.salesCount)),
    pa: points.map((p) => divSeguro(p.items, p.salesCount)),
    salesCount: points.map((p) => p.salesCount),
  };
}

/** Expectativa para um dia: media do mesmo dia da semana nas 4 semanas anteriores. */
function expectedDayAmount(f: Store, iso: string, division: Division | null): number {
  if (!storeOpen(f, iso)) return 0;
  let sum = 0;
  let n = 0;
  for (let k = 1; k <= 4; k++) {
    const ref = addDays(iso, -7 * k);
    const d = salesDay(f.id, ref);
    if (d && ref !== TODAY_ISO) {
      sum += dayAggregate(d, division).revenue;
      n++;
    }
  }
  return n ? sum / n : 0;
}

/** R$ 85,3k  -  valor curto, pra nao quebrar componente. R$ 1,2M a partir de 1 milhao. Abaixo de R$ 10.000, valor cheio  -  R$ 3.022, nao R$ 3k, que esconderia precisao que cabe na tela. Sem ",0" a toa: so mostra casa decimal quando ela diz algo (283k, nao 283,0k). */
/** Formata numero inteiro com separador de milhar (ex.: 5778  ->  "5.778"). */
export function num(v: number, casas?: number): string {
  if (casas !== undefined) return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  return Math.round(v).toLocaleString("pt-BR");
}

export function brlK(v: number): string {
  const abs = Math.abs(v);
  const compacto = (divided: number) => divided.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  if (abs >= 1_000_000) return `R$ ${compacto(v / 1_000_000)}M`;
  if (abs >= 10_000) return `R$ ${compacto(v / 1000)}k`;
  return brl(v);
}


interface CalculatedGoal {
  amount: number;
  achieved: number;
  attainmentPct: number;
  requiredDay: number | null;
  daysRemaining: number;
  dayOfMonth: number;
  daysNoMonth: number;
  projection: number | null;
  pessimista: number | null;
  otimista: number | null;
  veredito: "atinge" | "incerto" | "nao_atinge" | null;
  closed: boolean;
}

/** Meta do mes. Sempre mensal, mesmo quando o periodo exibido e diferente. */
function calculateGoal(fs: Store[], competence: string): CalculatedGoal | null {
  const goalStores = fs.map((f) => goalOfStore(f.id, competence)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (goalStores.length === 0) return null;

  const firstDay = `${competence}-01`;
  const lastDay = endOfMonth(firstDay);
  const closed = lastDay < TODAY_ISO;
  const endReal = closed ? lastDay : TODAY_ISO;

  const amount = goalStores.reduce((s, m) => s + m.storeAmount, 0);
  const achieved = fs.reduce((s, f) => s + periodAggregate(f, firstDay, endReal, null).revenue, 0);
  const daysRemaining = closed ? 0 : monthDaysRemaining(fs);
  const requiredDay = closed || daysRemaining === 0 || achieved >= amount ? null : (amount - achieved) / daysRemaining;
  const attainmentPct = divSeguro(achieved, amount) * 100;

  // Projecao so a partir do dia 7: cinco dias nao projetam trinta.
  const dayOfMonth = isoToDate(closed ? lastDay : TODAY_ISO).getDate();
  let projection: number | null = null;
  let pessimista: number | null = null;
  let otimista: number | null = null;
  let veredito: CalculatedGoal["veredito"] = null;

  if (closed) {
    veredito = attainmentPct >= 100 ? "atinge" : "nao_atinge";
  } else if (dayOfMonth >= 7) {
    let future = 0;
    for (const iso of eachDay(addDays(TODAY_ISO, 1), lastDay)) {
      for (const f of fs) future += expectedDayAmount(f, iso, null);
    }
    let restoToday = 0;
    for (const f of fs) {
      const feito = dayAggregate(salesDay(f.id, TODAY_ISO)!, null).revenue;
      restoToday += Math.max(0, expectedDayAmount(f, TODAY_ISO, null) - feito);
    }
    // A faixa se estreita conforme o mes avanca: menos dias por vir, menos incerteza.
    const shareRemaining = divSeguro(future + restoToday, achieved + future + restoToday);
    const amplitude = 0.06 + 0.22 * shareRemaining;
    projection = achieved + future + restoToday;
    pessimista = achieved + (future + restoToday) * (1 - amplitude);
    otimista = achieved + (future + restoToday) * (1 + amplitude);
    veredito = pessimista >= amount ? "atinge" : otimista < amount ? "nao_atinge" : "incerto";
  }

  return { amount, achieved, attainmentPct, requiredDay, daysRemaining, dayOfMonth, daysNoMonth: isoToDate(lastDay).getDate(), projection, pessimista, otimista, veredito, closed };
}

/** "abaixo do ritmo" / "no ritmo" / "acima do ritmo": realizado por dia contra o necessario por dia, a mesma conta em todo lugar que fala de ritmo. */
function statusPace(m: CalculatedGoal): string {
  const emJogo = m.requiredDay !== null;
  const paceDaily = m.dayOfMonth > 0 ? m.achieved / m.dayOfMonth : 0;
  if (m.closed) return m.attainmentPct >= 100 ? "meta batida" : "meta não batida";
  if (!emJogo) return "meta batida";
  if (paceDaily >= m.requiredDay! * 1.05) return "acima do ritmo";
  if (paceDaily >= m.requiredDay!) return "no ritmo";
  return "abaixo do ritmo";
}

/** Periodo anterior comparavel, com o rotulo que a tela exibe. */
/**
 * Periodo anterior equivalente. Se o periodo atual termina hoje, `horaMax` vale so para o ultimo
 * dia (`fim`) do anterior  -  o dia equivalente entra ate a hora atual, os demais inteiros.
 */
export function previousPeriod(
  period: ResolvedPeriod,
  hourCurrent: number = CURRENT_HOUR,
): { start: string; end: string; label: string; hourMax?: number } {
  const hourMax = period.endsToday ? hourCurrent : undefined;
  if (period.granularity === "day") {
    const ref = addDays(period.start, -7);
    return { start: ref, end: ref, label: DAY_WEEK_PAST[isoToDate(ref).getDay()], hourMax };
  }
  if (period.granularity === "month") {
    const ini = isoToDate(period.start);
    const monthPrev = new Date(ini.getFullYear(), ini.getMonth() - 1, 1);
    const start = `${monthPrev.getFullYear()}-${String(monthPrev.getMonth() + 1).padStart(2, "0")}-01`;
    const end = period.openMonth ? addDays(start, isoToDate(period.end).getDate() - 1) : endOfMonth(start);
    return { start, end, label: "o mês passado", hourMax: period.openMonth ? hourMax : undefined };
  }
  if (period.kind === "thisWeek") {
    return { start: addDays(period.start, -7), end: addDays(period.end, -7), label: "a semana passada", hourMax };
  }
  const n = eachDay(period.start, period.end).length;
  const end = addDays(period.start, -1);
  return { start: addDays(end, -(n - 1)), end, label: `os ${n} dias anteriores`, hourMax };
}

/** "15/09/2026" para um unico dia, "01/09/2026  -  07/09/2026" para um intervalo. */
function formatRange(start: string, end: string): string {
  return start === end ? fullDate(start) : `${fullDate(start)} – ${fullDate(end)}`;
}

interface AggregatedCost {
  cmv: number;
  byCategory: Record<number, { revenue: number; cmv: number }>;
}

function periodCost(fs: Store[], start: string, end: string, division: Division | null): AggregatedCost {
  const out: AggregatedCost = { cmv: 0, byCategory: {} };
  for (const f of fs) {
    for (const d of salesDays(f.id, start, end)) {
      for (const [id, c] of Object.entries(d.byCategory)) {
        const cat = categories.find((x) => x.id === Number(id));
        if (!cat || (division && cat.division !== division)) continue;
        const acc = (out.byCategory[cat.id] ??= { revenue: 0, cmv: 0 });
        acc.revenue += c.revenue;
        acc.cmv += c.cmv;
        out.cmv += c.cmv;
      }
    }
  }
  return out;
}

/** Alertas de sistema: aparecem acima de tudo e somem quando resolvem. */
function buildAlerts(fs: Store[]): SystemAlert[] {
  const alerts: SystemAlert[] = [];
  const minutosWithoutSync = Math.floor((NOW.getTime() - LAST_SYNC.getTime()) / 60000);
  if (minutosWithoutSync > 60) {
    const h = Math.floor(minutosWithoutSync / 60);
    alerts.push({ id: "sync", tone: "warning", text: `Dados de ${UPDATED_AT}. Sync não roda há ${h}h${String(minutosWithoutSync % 60).padStart(2, "0")}.` });
  }
  for (const f of fs.filter((x) => x.id === "f2")) {
    alerts.push({ id: `nota-${f.id}`, tone: "info", text: `${f.tradeName} tem 8 produtos com nota de entrada pendente.` });
  }
  return alerts;
}

/* ---------- Motor de trilho ---------- */

/** Curva de pesos normalizados: `peso(iso)` soma 1 nos dias abertos; `pesoBruto` e o valor pre-normalizacao. */
export interface RevenueCurve {
  weight: (iso: string) => number;
  weightGross: (iso: string) => number;
  sum: number;
}

/**
 * curvaReceita (AD-034): pesos diarios normalizados (soma = 1 nos dias abertos)
 * derivados do historico real de faturamento  -  media simples das quatro
 * ocorrencias equivalentes anteriores do mesmo dia da semana; menos ocorrencias
 * usa o que houver; nenhuma usa `pesoDia` como base.
 */
export function revenueCurve(fs: Store[], competence: string): RevenueCurve {
  const firstDay = `${competence}-01`;
  const lastDay = endOfMonth(firstDay);
  const weights = new Map<string, number>();
  let sum = 0;
  for (const iso of eachDay(firstDay, lastDay)) {
    let gross = 0;
    let abertas = 0;
    for (const f of fs) {
      if (!storeOpen(f, iso)) continue;
      const ocas = ocorrenciasPrevious(f, iso, 4);
      gross += ocas.length > 0 ? ocas.reduce((s, d) => s + d.total.revenue, 0) / ocas.length : dayWeight(f, iso);
      abertas++;
    }
    if (abertas === 0) continue; // nenhuma loja abre nesse dia
    weights.set(iso, gross);
    sum += gross;
  }
  return {
    sum,
    weight: (iso: string) => (sum > 0 ? (weights.get(iso) ?? 0) / sum : 0),
    weightGross: (iso: string) => weights.get(iso) ?? 0,
  };
}

/** As ultimas `n` ocorrencias anteriores do mesmo dia da semana, com loja aberta (AD-034). */
function ocorrenciasPrevious(f: Store, iso: string, n: number): DaySalesSales[] {
  const out: DaySalesSales[] = [];
  for (let i = 7; out.length < n && i <= 28; i += 7) {
    const ref = addDays(iso, -i);
    const d = salesDay(f.id, ref);
    // So contam ocorrencias com loja aberta e registro no historico (undefined antes do inicio).
    if (d && storeOpen(f, ref)) out.push(d);
  }
  return out;
}

/** Tipo minimo de DiaVendas usado pelas curvas. */
interface DaySalesSales {
  data: string;
  total: { revenue: number; salesCount: number };
}

/** Meta acumulada esperada ate hoje: meta mensal x fracao acumulada da curvaReceita (LOJA-01 AC 2-7). */
function goalThroughToday(fs: Store[], competence: string, goalAmount: number, todayIso: string): number {
  const curve = revenueCurve(fs, competence);
  const firstDay = `${competence}-01`;
  let fração = 0;
  for (const iso of eachDay(firstDay, todayIso)) fração += curve.weight(iso);
  return goalAmount * fração;
}

/** Status do trilho do mes (LOJA-01). */
function calculateTrack(fs: Store[], competence: string): TrackView | null {
  const goalStores = fs.map((f) => goalOfStore(f.id, competence)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (goalStores.length === 0) return null;
  const amount = goalStores.reduce((s, m) => s + m.storeAmount, 0);

  const firstDay = `${competence}-01`;
  const lastDay = endOfMonth(firstDay);
  const closed = lastDay < TODAY_ISO;
  const endReal = closed ? lastDay : TODAY_ISO;
  const achieved = fs.reduce((s, f) => s + periodAggregate(f, firstDay, endReal, null).revenue, 0);

  const goalAccumulated = goalThroughToday(fs, competence, amount, endReal);

  let status: TrackStatus;
  let pctTrilho: number | null;
  if (closed) {
    status = achieved >= amount ? "goalHit" : "goalMissed";
    pctTrilho = null;
  } else {
    const pct = goalAccumulated > 0 ? (achieved / goalAccumulated) * 100 : 0;
    pctTrilho = pct;
    status = pct >= 98 ? "onTrack" : pct >= 90 ? "attention" : "below";
  }
  return { status, pctTrilho, competence };
}

/** Venda necessaria hoje (LOJA-02): (falta x pesoHoje   pesos restantes)  realizadoHoje. */
function salesNeededToday(fs: Store[], competence: string): RequiredSalesView | null {
  const goalStores = fs.map((f) => goalOfStore(f.id, competence)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (goalStores.length === 0) return { amount: null, achievedToday: 0, gapRemaining: 0, daysRemaining: 0, dayReference: TODAY_ISO, cumpridaToday: false, metaMonthAtingida: false, noGoal: true };

  const amount = goalStores.reduce((s, m) => s + m.storeAmount, 0);
  const firstDay = `${competence}-01`;
  const lastDay = endOfMonth(firstDay);
  const closed = lastDay < TODAY_ISO;
  const endReal = closed ? lastDay : TODAY_ISO;
  const achieved = fs.reduce((s, f) => s + periodAggregate(f, firstDay, endReal, null).revenue, 0);
  if (closed) return null;

  const achievedToday = fs.reduce((s, f) => s + (salesDay(f.id, TODAY_ISO) ? dayAggregate(salesDay(f.id, TODAY_ISO)!, null).revenue : 0), 0);
  const gapRemaining = amount - achieved;
  const curve = revenueCurve(fs, competence);
  const remainingOpen = eachDay(TODAY_ISO, lastDay).filter((iso) => fs.some((f) => storeOpen(f, iso)));
  if (remainingOpen.length === 0) return null;

  // Dia de referencia: hoje se aberto, senao o proximo dia aberto (LOJA-02 AC 5).
  const dayRef = fs.some((f) => storeOpen(f, TODAY_ISO)) ? TODAY_ISO : remainingOpen[0];
  const todayWeight = curve.weight(dayRef);
  const sumWeightsRest = remainingOpen.reduce((s, iso) => s + curve.weight(iso), 0);
  const gapRemainingRef = amount - achieved; // gap absoluto no mes (sem descontar a projecao futura)
  const requiredGross = sumWeightsRest > 0 ? (gapRemainingRef * todayWeight) / sumWeightsRest : 0;
  const todayAmount = Math.max(0, requiredGross - (dayRef === TODAY_ISO ? achievedToday : 0));

  return {
    amount: todayAmount,
    achievedToday,
    gapRemaining,
    daysRemaining: remainingOpen.length,
    dayReference: dayRef,
    cumpridaToday: todayAmount === 0 && achieved > 0,
    metaMonthAtingida: achieved >= amount,
    noGoal: false,
  };
}

/** Projecao de fechamento (LOJA-03): indice da competencia x curva restante, com gate do dia 7. */
function calculateProjection(fs: Store[], competence: string): ProjectionView {
  const goalStores = fs.map((f) => goalOfStore(f.id, competence)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const amount = goalStores.reduce((s, m) => s + m.storeAmount, 0);
  if (goalStores.length === 0) return { amount: null, available: false, closed: false, index: null, goalAmount: 0 };

  const firstDay = `${competence}-01`;
  const lastDay = endOfMonth(firstDay);
  const closed = lastDay < TODAY_ISO;
  const endReal = closed ? lastDay : TODAY_ISO;
  const achieved = fs.reduce((s, f) => s + periodAggregate(f, firstDay, endReal, null).revenue, 0);

  if (closed) return { amount: achieved, available: false, closed: true, index: null, goalAmount: amount };

  const dayOfMonth = isoToDate(endReal).getDate();
  if (dayOfMonth < 7) return { amount: null, available: false, closed: false, index: null, goalAmount: amount };

  const goalAccumulated = goalThroughToday(fs, competence, amount, endReal);
  const index = goalAccumulated > 0 ? achieved / goalAccumulated : 0;
  const shareRemaining = 1 - goalThroughToday(fs, competence, 1, endReal);
  const projection = achieved + amount * shareRemaining * index;
  return { amount: projection, available: true, closed: false, index, goalAmount: amount };
}

/** curvaAtendimentos (AD-034): pesos diarios normalizados a partir do historico de atendimentos. */
function salesCurve(fs: Store[], competence: string): RevenueCurve {
  const firstDay = `${competence}-01`;
  const lastDay = endOfMonth(firstDay);
  const weights = new Map<string, number>();
  let sum = 0;
  for (const iso of eachDay(firstDay, lastDay)) {
    let gross = 0;
    let abertas = 0;
    for (const f of fs) {
      if (!storeOpen(f, iso)) continue;
      const ocas = ocorrenciasPrevious(f, iso, 4);
      gross += ocas.length > 0 ? ocas.reduce((s, d) => s + d.total.salesCount, 0) / ocas.length : dayWeight(f, iso);
      abertas++;
    }
    if (abertas === 0) continue;
    weights.set(iso, gross);
    sum += gross;
  }
  return {
    sum,
    weight: (iso: string) => (sum > 0 ? (weights.get(iso) ?? 0) / sum : 0),
    weightGross: (iso: string) => weights.get(iso) ?? 0,
  };
}

/** Diagnostica a lacuna de receita entre fluxo e ticket (LOJA-04 AC 1-9). */
function calculateGap(fs: Store[], competence: string, pctTrilho: number | null): GapView {
  const goalStores = fs.map((f) => goalOfStore(f.id, competence)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (goalStores.length === 0) return { display: false, efeitoFluxo: 0, efeitoTicket: 0, gapTotal: 0, alavancaDominante: null, noGoal: true };

  const goal = goalStores.reduce((s, m) => s + m.storeAmount, 0);
  const firstDay = `${competence}-01`;
  const lastDay = endOfMonth(firstDay);
  const closed = lastDay < TODAY_ISO;
  const endReal = closed ? lastDay : TODAY_ISO;

  // Atendimentos esperados no mes: soma da curvaAtendimentos (peso normalizado x faturamento? Nao - 
  // e o total esperado de atendimentos do mes). O total esperado = (media diaria x dias abertos).
  const cA = salesCurve(fs, competence);
  const cR = revenueCurve(fs, competence);
  // Total esperado do mes = soma dos pesos brutos de atendimentos (cada dia = media de 4 semanas).
  const totalEsperadoMonth = cA.sum; // soma dos pesos brutos = media diaria x n dias  -  ja e n atendimentos esperados.
  const goalTicket = totalEsperadoMonth > 0 ? goal / totalEsperadoMonth : 0;

  // Atendimentos esperados ate hoje = total mensal x fracao acumulada da curvaReceita.
  const shareAcumRevenue = eachDay(firstDay, endReal).reduce((s, iso) => s + cR.weight(iso), 0);
  const expectedSalesThroughToday = totalEsperadoMonth * shareAcumRevenue;

  // Atendimentos realizados ate hoje.
  const actualSalesThroughToday = fs.reduce((s, f) => s + periodAggregate(f, firstDay, endReal, null).salesCount, 0);

  // Ticket realizado ate hoje.
  const achievedRevenue = fs.reduce((s, f) => s + periodAggregate(f, firstDay, endReal, null).revenue, 0);
  const actualTicketThroughToday = actualSalesThroughToday > 0 ? achievedRevenue / actualSalesThroughToday : 0;

  // Efeitos (LOJA-04 AC 5-6); interacao ja contida no efeito fluxo.
  const efeitoFluxo = (expectedSalesThroughToday - actualSalesThroughToday) * goalTicket;
  const efeitoTicket = (goalTicket - actualTicketThroughToday) * actualSalesThroughToday;
  const gapTotal = goal * shareAcumRevenue - achievedRevenue;

  // Alavanca dominante (AC 8-9): apenas efeitos positivos; maior  60% da soma dos positivos.
  const positive = [efeitoFluxo, efeitoTicket].filter((e) => e > 0);
  const sumPositive = positive.reduce((s, e) => s + e, 0);
  let alavancaDominante: GapView["alavancaDominante"] = null;
  if (sumPositive > 0 && positive.length > 0) {
    const higher = Math.max(...positive);
    if (higher >= 0.6 * sumPositive) alavancaDominante = efeitoFluxo >= efeitoTicket ? "fluxo" : "ticket";
  }

  // Exibe apenas quando pctTrilho < 90 (AD-033).
  return {
    display: pctTrilho !== null && pctTrilho < 90,
    efeitoFluxo,
    efeitoTicket,
    gapTotal,
    alavancaDominante,
    noGoal: false,
  };
}

/** Mix do periodo/marca selecionados: participacao por categoria com margem (LOJA-04 AC 10). */
function buildMix(fs: Store[], start: string, end: string, division: Division | null, labelPeriod: string): MixView {
  const categorySummary = new Map<number, { revenue: number; cmv: number }>();
  for (const f of fs) {
    for (const d of salesDays(f.id, start, end)) {
      for (const [id, c] of Object.entries(d.byCategory)) {
        const cat = categories.find((x) => x.id === Number(id));
        if (!cat || (division && cat.division !== division)) continue;
        let acc = categorySummary.get(cat.id);
        if (!acc) {
          acc = { revenue: 0, cmv: 0 };
          categorySummary.set(cat.id, acc);
        }
        acc.revenue += c.revenue;
        acc.cmv += c.cmv;
      }
    }
  }
  const total = [...categorySummary.values()].reduce((s, c) => s + c.revenue, 0);
  const items = [...categorySummary.entries()]
    .map(([id, c]) => {
      const cat = categories.find((x) => x.id === id)!;
      const margin = c.revenue - c.cmv;
      return { category: cat.name, division: cat.division, margin, revenue: c.revenue, pct: total > 0 ? (c.revenue / total) * 100 : 0 };
    })
    .sort((a, b) => b.revenue - a.revenue);
  return { items, period: labelPeriod };
}

/** Visao de grupo (LOJA-05): status do trilho por loja na competencia. */
function buildGroupStores(fs: Store[], competence: string): StoreSummaryView[] {
  return fs.map((f) => {
    const trilho = calculateTrack([f], competence);
    return {
      storeId: f.id,
      name: f.tradeName,
      pctTrilho: trilho?.pctTrilho ?? null,
      status: trilho?.status ?? "below",
      hasMeta: Boolean(goalOfStore(f.id, competence)),
    };
  });
}

export function buildStoreView(scope: Scope): StoreView {
  const period = resolvePeriod(scope.period);
  const fs = storesInScope(scope);
  const division = scope.division;
  const all = scope.storeIds.length === 0 || scope.storeIds.length > 1;
  const sole = all ? null : fs[0];
  const scopeView: StoreView["scopeView"] = all ? "network" : period.granularity === "day" ? "day" : "period";

  const current = sumAggregates(fs.map((f) => periodAggregate(f, period.start, period.end, division)));
  const prev = previousPeriod(period);
  const previous = sumAggregates(fs.map((f) => periodAggregate(f, prev.start, prev.end, division, prev.hourMax)));

  const ticket = divSeguro(current.revenue, current.salesCount);
  const pa = divSeguro(current.items, current.salesCount);
  const ticketPrev = divSeguro(previous.revenue, previous.salesCount);
  const paPrev = divSeguro(previous.items, previous.salesCount);

  const hasComparison = previous.salesCount > 0;
  const vsLabel = hasComparison ? prev.label : undefined;
  const series = trendSeries(fs, period, division);
  const kpiTicket: KpiAmount = { amount: brl(ticket), delta: hasComparison ? kpiDelta(ticket, ticketPrev, vsLabel) : undefined, series: series.ticket };
  const kpiPA: KpiAmount = { amount: num(pa, 2), delta: hasComparison ? kpiDelta(pa, paPrev, vsLabel, "pa") : undefined, series: series.pa };

  // Meta e sempre mensal. Divisao ou periodo cruzando meses desligam.
  const competence = period.granularity === "month" ? period.start.slice(0, 7) : TODAY_ISO.slice(0, 7);
  const noGoalInPeriod = period.spansMonths && period.granularity !== "month";
  const goalCalc = division || noGoalInPeriod ? null : calculateGoal(fs, competence);

  // Subtitulos: cada KPI fala so do proprio indicador (AD-048).
  // Faturamento NAO repete atendimentos nem "precisa R$/dia" (regua/meta cobrem ritmo).
  const periodDayCount = eachDay(period.start, period.end).length;
  let subRevenue: string | undefined;
  if (!division && goalCalc) {
    if (goalCalc.attainmentPct >= 100) subRevenue = "meta do mês atingida";
    else if (period.granularity === "month") subRevenue = `${pct(goalCalc.attainmentPct)} da meta`;
    else subRevenue = `${pct(goalCalc.attainmentPct)} da meta do mês`;
  } else if (period.granularity !== "day" && periodDayCount > 0) {
    subRevenue = `média ${brlK(current.revenue / periodDayCount)}/dia`;
  }

  const kpiSalesCount: KpiAmount = {
    amount: num(current.salesCount),
    delta: hasComparison ? kpiDelta(current.salesCount, previous.salesCount, vsLabel, "sales") : undefined,
    series: series.salesCount,
    sub: period.granularity !== "day" && periodDayCount > 0 ? `média ${num(current.salesCount / periodDayCount, 0)}/dia` : undefined,
  };

  const kpiRevenue: KpiAmount = {
    amount: brlK(current.revenue),
    delta: hasComparison ? kpiDelta(current.revenue, previous.revenue, vsLabel) : undefined,
    series: series.revenue,
    // O periodo ja esta no filtro logo acima do card; sem sufixo " |  HOJE".
    // A marca selecionada continua no rotulo porque muda o dado.
    label: `FATURAMENTO${division ? ` ${division}` : ""}`,
    sub: subRevenue,
  };

  // Segundo tile: Participacao da marca quando filtrado, Meta/Projecao quando nao.
  let tileMeta: GoalProjectionTile | null = null;
  if (division) {
    const totalTudo = sumAggregates(fs.map((f) => periodAggregate(f, period.start, period.end, null))).revenue;
    const participationPct = totalTudo > 0 ? (current.revenue / totalTudo) * 100 : 0;
    tileMeta = {
      kind: "participacao",
      label: "PARTICIPAÇÃO",
      amountPrincipal: pct(participationPct),
      barPct: Math.min(100, participationPct),
      detail: `do faturamento da ${scopeView === "network" ? "rede" : "loja"}`,
    };
  } else if (noGoalInPeriod) {
    tileMeta = { kind: "unavailable", label: "META DO MÊS", amountPrincipal: "—", barPct: 0, detail: "meta é mensal" };
  } else if (goalCalc) {
    if (period.granularity === "month") {
      if (!goalCalc.closed && goalCalc.projection === null) {
        tileMeta = { kind: "projecao", label: "PROJEÇÃO", amountPrincipal: "—", barPct: 0, detail: "Projeção disponível a partir do dia 7" };
      } else {
        const amountFinal = goalCalc.closed ? goalCalc.achieved : goalCalc.projection!;
        const pctFinal = goalCalc.amount > 0 ? (amountFinal / goalCalc.amount) * 100 : 0;
        tileMeta = {
          kind: "projecao",
          label: "PROJEÇÃO",
          amountPrincipal: brlK(amountFinal),
          barPct: Math.min(100, pctFinal),
          detail: `${pct(pctFinal)} da meta · ${statusPace(goalCalc)}`,
        };
      }
    } else {
      tileMeta = {
        kind: "meta",
        label: "META DO MÊS",
        amountPrincipal: pct(goalCalc.attainmentPct),
        barPct: Math.min(100, goalCalc.attainmentPct),
        detail: `${brlK(goalCalc.achieved)} de ${brlK(goalCalc.amount)} · ${statusPace(goalCalc)}`,
      };
    }
  }

  // Ritmo da meta: aparece em qualquer visao (rede ou loja) sempre que houver
  // uma meta mensal aplicavel  -  some so com marca filtrada ou periodo cruzando
  // meses (metaCalc ja vem null nesses dois casos). Sem meta cadastrada, uma
  // linha de aviso no lugar do card. Mes fechado: "Projecao" vira "Fechou em".
  let pace: PaceCard | null = null;
  let paceNotice: string | null = null;
  if (!division && !noGoalInPeriod) {
    if (!goalCalc) {
      paceNotice = `Sem meta cadastrada para ${monthYear(`${competence}-01`).split(" de ")[0]}.`;
    } else {
      const paceDaily = goalCalc.dayOfMonth > 0 ? goalCalc.achieved / goalCalc.dayOfMonth : 0;
      const requiredText = goalCalc.requiredDay !== null ? brlK(goalCalc.requiredDay) : goalCalc.attainmentPct >= 100 ? "Meta batida" : "—";
      const barPct = goalCalc.closed
        ? Math.min(100, goalCalc.attainmentPct)
        : goalCalc.projection !== null && goalCalc.amount > 0
          ? Math.min(100, (goalCalc.projection / goalCalc.amount) * 100)
          : 0;
      pace = {
        achievedDay: brlK(paceDaily),
        requiredDay: requiredText,
        barPct,
        projectionLine: goalCalc.closed ? `Fechou em ${brlK(goalCalc.achieved)}` : goalCalc.projection !== null ? `Projeção ${brlK(goalCalc.projection)}` : "Projeção disponível a partir do dia 7",
      };
    }
  }

  const notices: string[] = [];
  if (noGoalInPeriod) notices.push("Meta e lucro bruto são mensais e não aparecem neste período.");
  if (division) notices.push(`Marca ${division} selecionada. Meta e projeção são da filial inteira e não aparecem no recorte por marca.`);

  /* --- Regua de lojas e pontos de atencao --- */
  let regua: RulerRow[] | null = null;
  let pointsAttention: AttentionPoint[] | null = null;
  let reguaTitle: string = "Desempenho das filiais";
  // Sempre adaptamos ao filtro (AD-047): rede = uma linha por loja; loja unica =
  // painel de meta (ou de participacao da marca, se houver marca). Nunca some.
  if (scopeView === "network" || sole) {
    const variationBadge = (v: number | null): { value: string; positive: boolean } | null => {
      if (v === null) return null;
      if (Math.abs(v) < 0.5) return { value: "=", positive: true };
      return { value: fmtDelta(v, Math.abs(v) < 10 ? 1 : 0).replace(/^[+−]/, ""), positive: v >= 0 };
    };
    const variationOfDay = (f: Store) => {
      const todayStore = dayAggregate(salesDay(f.id, TODAY_ISO)!, division).revenue;
      const refIso = addDays(TODAY_ISO, -7);
      const dayRef = salesDay(f.id, refIso);
      const refF = dayRef ? dayAggregate(dayRef, division, CURRENT_HOUR).revenue : 0;
      return refF > 0 ? pctDelta(todayStore, refF) : null;
    };

    if (sole && division) {
      // Loja + marca: painel da participacao da marca no faturamento da loja.
      const brandRevenue = periodAggregate(sole, period.start, period.end, division).revenue;
      const storeRevenue = periodAggregate(sole, period.start, period.end, null).revenue;
      const participation = storeRevenue > 0 ? (brandRevenue / storeRevenue) * 100 : 0;
      const indexColor = stores.findIndex((x) => x.id === sole.id);
      reguaTitle = `Desempenho · ${division === "WPINK" ? "Wpink" : "Wepink"}`;
      regua = [
        {
          storeId: sole.id,
          name: sole.tradeName,
          revenue: brlK(brandRevenue),
          revenueAmount: brandRevenue,
          attainmentPct: participation,
          attainmentText: `${pct(participation)} da filial`,
          barPct: Math.min(100, participation),
          tint: STORE_TINTS[indexColor % STORE_TINTS.length],
          variationDay: variationBadge(variationOfDay(sole)),
          variationDayAmount: variationOfDay(sole),
        },
      ];
      pointsAttention = null;
    } else if (division) {
      // Rede + marca: a barra vira participacao daquela loja no total da marca.
      const receitas = fs.map((f) => ({ f, revenue: periodAggregate(f, period.start, period.end, division).revenue }));
      const brandTotal = receitas.reduce((s, r) => s + r.revenue, 0);
      regua = receitas
        .map(({ f, revenue }) => {
          const participation = brandTotal > 0 ? (revenue / brandTotal) * 100 : 0;
          const indexColor = stores.findIndex((x) => x.id === f.id);
          return { storeId: f.id, name: f.tradeName, revenue, participation, tint: STORE_TINTS[indexColor % STORE_TINTS.length], variationDayAmount: variationOfDay(f) };
        })
        .sort((a, b) => b.participation - a.participation)
        .map((b) => ({
          storeId: b.storeId,
          name: b.name,
          revenue: brlK(b.revenue),
          revenueAmount: b.revenue,
          attainmentPct: b.participation,
          attainmentText: `${pct(b.participation)} da marca`,
          barPct: Math.min(100, b.participation),
          tint: b.tint,
          variationDay: variationBadge(b.variationDayAmount),
          variationDayAmount: b.variationDayAmount,
        }));
      pointsAttention = null;
    } else {
      // Titulo no singular quando o escopo tem uma loja so (painel de meta dela);
      // plural na rede. Nao ha variacao de hoje nem ordenacao na loja unica.
      reguaTitle = fs.length > 1 ? "Desempenho das filiais" : "Desempenho da filial";
      const base = fs.map((f) => {
        const m = calculateGoal([f], competence);
        const attainment = m?.attainmentPct ?? 0;
        const indexColor = stores.findIndex((x) => x.id === f.id);
        return { storeId: f.id, name: f.tradeName, attainment, tint: STORE_TINTS[indexColor % STORE_TINTS.length], variationDayAmount: variationOfDay(f), m };
      });

      regua = [...base]
        .sort((a, b) => a.attainment - b.attainment)
        .map((b) => ({
          storeId: b.storeId,
          name: b.name,
          revenue: brlK(b.m?.achieved ?? 0),
          revenueAmount: b.m?.achieved ?? 0,
          attainmentPct: b.attainment,
          attainmentText: `${pct(b.attainment)} da meta`,
          barPct: Math.min(100, b.attainment),
          tint: b.tint,
          variationDay: variationBadge(b.variationDayAmount),
          variationDayAmount: b.variationDayAmount,
        }));

      // Ordenada por desempenho (regua), nao por faturamento: quem esta pior no
      // ritmo da propria meta aparece primeiro, seja loja grande ou pequena.
      pointsAttention = base
        .filter((b) => b.m?.veredito === "nao_atinge" || b.m?.veredito === "incerto")
        .sort((a, b) => a.attainment - b.attainment)
        .map((b) => ({
          storeId: b.storeId,
          name: b.name,
          attainmentText: pct(b.attainment),
          status: statusPace(b.m!),
          gapByDay: b.m?.requiredDay !== null && b.m?.requiredDay !== undefined ? brlK(b.m.requiredDay) : "Meta batida",
          veredito: b.m!.veredito as "nao_atinge" | "incerto",
        }));
    }
  }

  /* --- Por hora: loja unica OU rede (soma)  -  mesmo grafico AreaLine com comparacao (AD-048) --- */
  let chartHour: HourChart | null = null;
  if (period.granularity === "day" && fs.length > 0) {
    const refIso = addDays(period.start, -7);
    const openingMin = Math.min(...fs.map((f) => f.opening));
    const closingMax = Math.max(...fs.map((f) => f.closing));
    const hours: number[] = [];
    for (let h = openingMin; h < closingMax; h++) hours.push(h);

    const fatiaHour = (storeId: string, iso: string, h: number) => {
      const d = salesDay(storeId, iso);
      const a = d?.byHour[h];
      if (!a) return 0;
      if (!division) return a.revenue;
      const fr = d!.total.revenue > 0 ? d!.byDivision[division].revenue / d!.total.revenue : 0;
      return Math.round(a.revenue * fr);
    };
    const sumHour = (iso: string, h: number) => fs.reduce((s, f) => s + fatiaHour(f.id, iso, h), 0);

    const amounts = hours.map((h) => sumHour(period.start, h));
    const amountsPrev = hours.map((h) => {
      if (period.isToday && h > CURRENT_HOUR) return 0;
      return sumHour(refIso, h);
    });
    const totalRef = amountsPrev.reduce((s, v) => s + v, 0);

    chartHour = {
      hours,
      amounts,
      previous: totalRef > 0 ? amountsPrev : null,
      labelPrevious: `${DAYS_WEEK[isoToDate(refIso).getDay()]} passada`,
      hourCurrent: period.isToday ? CURRENT_HOUR : null,
    };
  }

  /* Rede por loja empilhada: nao usada na Visao geral  -  o grafico principal unificou em AreaLine (AD-048). */
  const chartHourNetwork: NetworkHourChart | null = null;

  /* --- Evolucao diaria: periodo > 1 dia (loja unica OU rede)  -  AD-047 --- */
  let evolution: EvolutionChart | null = null;
  if (period.granularity !== "day") {
    const days = eachDay(period.start, period.end);
    const daysPrev = eachDay(prev.start, prev.end);
    const amounts = days.map((iso) => sumAggregates(fs.map((f) => dayAggregate(salesDay(f.id, iso)!, division))).revenue);
    const previous = daysPrev.map((iso) => sumAggregates(fs.map((f) => (salesDay(f.id, iso) ? dayAggregate(salesDay(f.id, iso)!, division) : { revenue: 0, salesCount: 0, items: 0 }))).revenue);
    evolution = {
      rotulos: days.map((iso) => dayAxisLabel(iso, period)),
      amounts,
      previous: previous.length === amounts.length ? previous : null,
      labelPrevious: prev.label,
    };
  }

  /* --- Checklist do dia: todos os grupos da loja, em Hoje ou Ontem --- */
  let checklist: DayChecklist | null = null;
  if (sole && (period.kind === "today" || period.kind === "yesterday")) {
    const groupsForStore = groups.filter((x) => x.storeId === sole.id).sort((a, b) => a.hourStart - b.hourStart);
    if (groupsForStore.length > 0) {
      // Mock de conclusao: grupo encerrado sai como tudo feito, grupo em
      // andamento usa uma marcacao fixa por grupo, grupo futuro nada feito.
      const doneEmProgress: Record<string, string[]> = { "t-f1-manha": ["tf1", "tf2", "tf3", "tf5"], "t-f2-tarde": ["tf14"] };
      const lines: GroupRow[] = groupsForStore.map((t) => {
        const status: GroupRow["status"] = period.kind === "yesterday" ? "ended" : CURRENT_HOUR >= t.hourEnd ? "ended" : CURRENT_HOUR >= t.hourStart ? "inProgress" : "notStarted";
        const tasksOfGroup = tasks.filter((x) => x.groupId === t.id).sort((a, b) => a.order - b.order);
        const doneIds = status === "inProgress" ? (doneEmProgress[t.id] ?? []) : status === "ended" ? tasksOfGroup.map((x) => x.id) : [];
        const items = tasksOfGroup.map((x) => ({ title: x.title, done: doneIds.includes(x.id) }));
        return {
          id: t.id,
          name: t.name,
          schedule: `${Math.max(t.hourStart, sole.opening)}h às ${Math.min(t.hourEnd, sole.closing)}h`,
          status,
          done: items.filter((i) => i.done).length,
          total: items.length,
          tasks: items,
        };
      });
      checklist = { dataText: shortDate(period.start), groups: lines };
    }
  }

  /* --- Lucro bruto e categorias: periodo de mes, dentro de uma loja. Continuam filtrados por marca. --- */
  let profitGross: StoreView["profitGross"] = null;
  let cats: CategoryRow[] | null = null;
  if (scopeView === "period" && period.granularity === "month") {
    const cost = periodCost(fs, period.start, period.end, division);
    const profit = current.revenue - cost.cmv;

    let divisionLine: string | null = null;
    if (sole?.hasWpink && !division) {
      const wepink = periodAggregate(sole, period.start, period.end, "WEPINK").revenue;
      const wpink = periodAggregate(sole, period.start, period.end, "WPINK").revenue;
      const brandTotal = wepink + wpink;
      if (brandTotal > 0) divisionLine = `Wepink ${brlK(wepink)} · ${pct((wepink / brandTotal) * 100, 0)} — Wpink ${brlK(wpink)} · ${pct((wpink / brandTotal) * 100, 0)}`;
    }

    profitGross = {
      items: [
        { label: "Faturamento", amount: brl(current.revenue), pct: "100%" },
        { label: "CMV", amount: brl(cost.cmv), pct: pct(divSeguro(cost.cmv, current.revenue) * 100) },
        { label: "Lucro bruto", amount: brl(profit), pct: pct(divSeguro(profit, current.revenue) * 100) },
      ],
      notice: "Configure aluguel e custo fixo para ver a margem de contribuição.",
      divisionLine,
    };

    const catsBase = Object.entries(cost.byCategory)
      .map(([id, v]) => {
        const cat = categories.find((c) => c.id === Number(id))!;
        const margin = v.revenue - v.cmv;
        return { categoryId: cat.id, name: cat.name, marginAmount: margin, revenue: brl(v.revenue), margin: brl(margin), marginPct: pct(divSeguro(margin, v.revenue) * 100) };
      })
      .sort((a, b) => b.marginAmount - a.marginAmount)
      .slice(0, 4);
    const higherMargin = Math.max(...catsBase.map((c) => c.marginAmount), 1);
    cats = catsBase.map(({ categoryId, name, revenue, margin, marginPct, marginAmount }) => ({
      categoryId,
      name,
      revenue,
      margin,
      marginPct,
      barPct: Math.max(0, Math.round((marginAmount / higherMargin) * 100)),
    }));
  }

  // Motor de trilho: sempre da competencia do periodo (AD-023).
  const trackCompetence = period.granularity === "month" ? period.start.slice(0, 7) : TODAY_ISO.slice(0, 7);
  const trilho = calculateTrack(fs, trackCompetence);
  const saleRequired = trilho ? salesNeededToday(fs, trackCompetence) : null;

  const view: StoreView = {
    scope,
    period,
    atualizadoAs: UPDATED_AT,
    nextSyncMin: Math.max(0, SYNC_INTERVAL_MIN - Math.floor((NOW.getTime() - LAST_SYNC.getTime()) / 60000)),
    scopeView,
    alerts: buildAlerts(fs),
    reading: null,
    notices,
    comparison: hasComparison
      ? {
          current: { start: period.start, end: period.end, revenue: current.revenue, salesCount: current.salesCount, items: current.items },
          previous: { start: prev.start, end: prev.end, revenue: previous.revenue, salesCount: previous.salesCount, items: previous.items },
          labelCurrent: formatRange(period.start, period.end),
          labelPrevious: formatRange(prev.start, prev.end),
        }
      : null,
    trilho,
    saleRequired,
    projection: calculateProjection(fs, trackCompetence),
    diagnostico: calculateGap(fs, trackCompetence, trilho?.pctTrilho ?? null),
    mix: scopeView === "period" ? buildMix(fs, period.start, period.end, division, period.label) : null,
    storeRows: all && period.granularity === "month" ? buildGroupStores(fs, trackCompetence) : [],
    states: {
      kpis: "available",
      trilho: trilho ? "available" : "noData",
      saleRequired: saleRequired ? "available" : "noData",
      projection: trilho && saleRequired ? "available" : trilho ? "noData" : "unavailable",
      diagnostico: trilho?.status === "below" ? "available" : "noData",
      mix: scopeView === "period" ? "available" : "noData",
      storeRows: all && period.granularity === "month" ? "available" : "noData",
    },
    kpiRevenue,
    kpiTicket,
    kpiPA,
    kpiSalesCount,
    tileMeta,
    pace,
    paceNotice,
    regua,
    reguaTitle,
    pointsAttention,
    chartHour,
    chartHourNetwork,
    evolution,
    checklist,
    profitGross,
    categories: cats,
  };
  view.reading = buildStoreInsight(view);
  return view;
}

/* ================================================================
 * TELA FINANCEIRO  -  camada de dados (montarFinanceiroView)
 * ================================================================ */

export interface FinanceKpi {
  label: string;
  value: string;
  delta?: { value: string; positive: boolean; vs?: string; previous?: string };
  series?: number[];
  tooltip?: string;
  sub?: string;
}

export interface CostProfitMonth {
  label: string;
  cost: number;
  profit: number;
  marginPct: number;
  revenue: number;
  future?: boolean; // Hora de hoje que ainda nao chegou
  rangeLabel?: string; // Eixo hora: "21h as 22h" (tooltip)
}

export interface OpResultMonth {
  label: string;
  profit: number;
  result: number;
  operatingMarginPct: number;
  revenue: number;
  future?: boolean; // Hora de hoje que ainda nao chegou
  rangeLabel?: string; // Eixo hora: "21h as 22h" (tooltip)
}

export interface PaymentMethodRevenue {
  method: string;
  amount: number;
  pct: number;
  color: string;
}

export interface FixedCostRow {
  label: string;
  amount: number;
  isTotal?: boolean;
  isResult?: boolean;
}

export interface MonthlyEvolutionRow {
  label: string;
  revenue: number;
  cost: number;
  profit: number;
  marginPct: number;
  averageTicket: number;
  /** Vendas do mês. O ticket do total é faturamento / vendas, não a média dos tickets. */
  salesCount: number;
}

export interface RevenueByBrand {
  brand: string;
  amount: number;
  pct: number;
  color: string;
}

export interface FinanceView {
  scope: Scope;
  period: ResolvedPeriod;
  kpis: FinanceKpi[];
  /** Eixo dos cards de tendencia (CMV/Lucro e Resultado). */
  seriesAxis: SeriesAxis;
  /** Ex.: "Hoje  |  por hora". */
  seriesLabel: string;
  /** True quando custos fixos foram rateados no eixo (hora/dia). */
  resultIsProrated: boolean;
  costProfitSeries: CostProfitMonth[];
  operatingResult: OpResultMonth[];
  resultDelta?: { value: string; positive: boolean; vs?: string; diff?: string };
  paymentMethods: PaymentMethodRevenue[];
  /** So quando filtro = todas as marcas; null se WEPINK ou WPINK isolada. */
  revenueByBrand: RevenueByBrand[] | null;
  franchiseFixedCosts: FixedCostRow[];
  /** Alguma loja do escopo tem custo da operacao preenchido (senao o card mostra "Custos nao configurados"). */
  costsConfigured: boolean;
  monthlyEvolution: MonthlyEvolutionRow[];
  /** Card so em periodo mensal (ver `monthlyEvolutionMonths`). */
  showMonthlyEvolution: boolean;
  monthlyEvolutionLabel: string;
  /** Faixa WPINK (Faturamento  |  CMV  |  Lucro  |  Margem)  -  so se alguma loja do escopo tem a marca. */
  kpisWpink: OverviewKpiWpink[];
  /** Itens vendidos (mesma regra de comparativo dos KPIs)  -  usado pela tela Produtos. */
  kpiItems?: FinanceKpi;
  /** Faturamento do periodo (R$)  -  aviso "sem vendas" independente do eixo. */
  periodRevenue?: number;
  /** Produtos vendidos no periodo com custo R$ 0 no Millennium (maior faturamento primeiro). */
  productsWithoutCost?: ProductWithoutCost[];
}

const COLORS_FORMAS: Record<string, string> = {
  Pix: "var(--ok)",
  "Cartão de crédito": "var(--acc)",
  "Cartão de débito": "var(--info)",
  Cash: "var(--warn)",
};

/** Percentuais mockados de custos variaveis sobre faturamento (parametrizacao futura). */
const PCT_COSTS_FIXED = {
  rentShopping: 5,
  royaltiesWepink: 5,
  royaltiesWpink: 5,
  taxaMktWepink: 2,
  taxaMktWpink: 2,
} as const;

/** Aluguel fixo mockado por filial (mensal). Variaveis (% sobre fat) sao calculadas no view. */
function mockFixedRent(f: Store): number {
  const base = f.id === "f1" ? 6100 : 3450;
  return Math.round(18000 * (base / 5000));
}

/** Custos da loja (Configuracoes > Lojas); campo vazio cai no padrao mockado. */
function storeCostSnapshot(f: Store) {
  const c = f.costs;
  return {
    rentFixed: c?.rentMin ?? mockFixedRent(f),
    rentWepinkPct: c?.rentWepinkPct ?? PCT_COSTS_FIXED.rentShopping,
    rentWpinkPct: c?.rentWpinkPct ?? PCT_COSTS_FIXED.rentShopping,
    royaltiesWepinkPct: c?.royaltiesWepinkPct ?? PCT_COSTS_FIXED.royaltiesWepink,
    royaltiesWpinkPct: c?.royaltiesWpinkPct ?? PCT_COSTS_FIXED.royaltiesWpink,
    mktWepinkPct: c?.marketingWepinkPct ?? PCT_COSTS_FIXED.taxaMktWepink,
    mktWpinkPct: c?.marketingWpinkPct ?? PCT_COSTS_FIXED.taxaMktWpink,
  };
}

/** "(5%)" quando todas as lojas usam o mesmo %; vazio se variam. */
function rateSuffix(amounts: number[]): string {
  const unicos = [...new Set(amounts)];
  return unicos.length === 1 ? ` (${String(unicos[0]).replace(".", ",")}%)` : "";
}

const PRESETS_MENSAIS = new Set<PeriodType>(["thisMonth", "lastMonth", "thisQuarter", "thisHalf", "thisYear"]);
const MONTHS_PREVIOUS_EVOLUCAO = 5;

/**
 * Meses da Evolucao mensal. Periodo mensal pelo calendario (preset de mes/trimestre/semestre/ano
 * ou personalizado do dia 1 ao fim do mes / hoje)  -  nunca por contagem de dias (fevereiro tem 28).
 * 1 mes so  ->  ele + 5 anteriores (comparacao); varios meses ou eixo por mes  ->  meses do periodo.
 */
export function monthlyEvolutionMonths(
  period: ResolvedPeriod,
  seriesAxis: SeriesAxis,
): { months: string[]; withPrevious: boolean } {
  const ofPeriod = monthsBetween(period.start, period.end);
  const monthly =
    PRESETS_MENSAIS.has(period.kind) ||
    (period.kind === "custom" &&
      period.start !== period.end &&
      period.start.endsWith("-01") &&
      (period.end === endOfMonth(period.end) || period.endsToday));
  if (monthly && ofPeriod.length === 1) {
    const [y, m] = ofPeriod[0]!.split("-").map(Number) as [number, number];
    const months: string[] = [];
    for (let i = MONTHS_PREVIOUS_EVOLUCAO; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return { months, withPrevious: true };
  }
  if (monthly || seriesAxis === "month") return { months: ofPeriod, withPrevious: false };
  return { months: [], withPrevious: false };
}

/** Nome do mes na Evolucao mensal; ano so se a lista atravessa anos; recorte "(01 a 26)" em mes parcial. */
function monthEvolutionLabel(month: string, months: string[], ini?: string, end?: string): string {
  const name = monthYear(`${month}-01`);
  const base = months[0]!.slice(0, 4) === months[months.length - 1]!.slice(0, 4) ? name.split(" de ")[0]! : name;
  if (!ini || !end || (ini === `${month}-01` && end === endOfMonth(`${month}-01`))) return base;
  return `${base} · ${ini.slice(8)} a ${end.slice(8)}`;
}

function evolutionCaption(period: ResolvedPeriod, withPrevious: boolean): string {
  return withPrevious ? `${monthYear(period.start)} e meses anteriores` : period.label;
}

/** Eixo dos cards de tendencia: 1 dia  ->  hora; 2 - 31 dias  ->  dia; >31 dias  ->  mes. */
export type SeriesAxis = "hour" | "day" | "month";

export function seriesAxisForPeriod(period: ResolvedPeriod): SeriesAxis {
  const n = eachDay(period.start, period.end).length;
  if (n <= 1) return "hour";
  if (n <= 31) return "day";
  return "month";
}

/** Subtitulo dos cards de serie (ex.: "Hoje  |  por hora"). */
export function seriesAxisLabel(period: ResolvedPeriod, eixo: SeriesAxis): string {
  if (eixo === "hour") return `${period.label} · por hora`;
  if (eixo === "day") return `${period.label} · por dia`;
  return `${period.label} · por mês`;
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

function daysInMonth(monthYm: string): number {
  const [y, m] = monthYm.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** Este mês, mês passado e os calendários longos cobram o mínimo cheio. Dia, semana e personalizado rateiam. */
function chargesFullMonthRent(period: ResolvedPeriod): boolean {
  return period.granularity === "month"
    || period.kind === "thisQuarter"
    || period.kind === "thisHalf"
    || period.kind === "thisYear";
}

/** Mínimo do mês no recorte: cheio no mês; nos demais, mínimo × dias do filtro ÷ dias do mês. */
function rentFloor(full: number, days: number, yearMonth: string, period: ResolvedPeriod): number {
  if (days <= 0 || full <= 0) return 0;
  if (chargesFullMonthRent(period)) return full;
  return (full * days) / daysInMonth(yearMonth);
}

function monthAggregate(fs: Store[], month: string, division: Division | null): Aggregate & { cmv: number; byMethod: Record<string, number> } {
  const start = `${month}-01`;
  const end = endOfMonth(start);
  const agg = sumAggregates(fs.map((f) => periodAggregate(f, start, end, division)));
  const cost = periodCost(fs, start, end, division).cmv;
  // Soma das formas de pagamento no mes.
  const days = eachDay(start, end);
  const byMethod: Record<string, number> = {};
  for (const f of fs) {
    for (const dayIso of days) {
      const dv = salesDay(f.id, dayIso);
      if (!dv) continue;
      for (const [method, val] of Object.entries(dv.byMethod)) {
        byMethod[method] = (byMethod[method] ?? 0) + val;
      }
    }
  }
  return { ...agg, cmv: cost, byMethod };
}

export function buildFinanceView(scope: Scope, aggs?: FinanceAggInput | null): FinanceView {
  if (aggs) return buildFinanceViewFromAggs(scope, aggs);
  const period = resolvePeriod(scope.period);
  const fs = storesInScope(scope);
  const division = scope.division;

  // Atual e anterior para deltas dos KPIs.
  const current = sumAggregates(fs.map((f) => periodAggregate(f, period.start, period.end, division)));
  const costCurrent = periodCost(fs, period.start, period.end, division).cmv;
  const prev = previousPeriod(period);
  const previous = sumAggregates(fs.map((f) => periodAggregate(f, prev.start, prev.end, division, prev.hourMax)));
  const costPrevious = periodCost(fs, prev.start, prev.end, division).cmv;

  const profitCurrent = current.revenue - costCurrent;
  const profitPrevious = previous.revenue - costPrevious;
  const marginCurrent = divSeguro(profitCurrent, current.revenue) * 100;
  const marginPrevious = divSeguro(profitPrevious, previous.revenue) * 100;

  const hasComp = previous.salesCount > 0;
  const vsLabel = hasComp ? prev.label : undefined;

  // Series de tendencia (ultimos 7 pontos do periodo, ou 7 dias se periodo curto).
  const revenueSeries = (trendSeries(fs, period, division).revenue ?? []).slice(-7);
  const seriesCmv = revenueSeries.map((_, i) => {
    const frac = costCurrent / (current.revenue || 1);
    return Math.round(revenueSeries[i] * frac);
  });
  const seriesProfit = revenueSeries.map((v, i) => v - seriesCmv[i]);
  const seriesMargin = revenueSeries.map((v, i) => v > 0 ? ((v - seriesCmv[i]) / v) * 100 : 0);

  const kpis: FinanceKpi[] = [
    {
      label: "Faturamento",
      value: brlCent(current.revenue),
      delta: hasComp ? kpiDelta(current.revenue, previous.revenue, vsLabel) : undefined,
      series: revenueSeries,
    },
    {
      label: "CMV",
      value: brlCent(costCurrent),
      sub: `${(divSeguro(costCurrent, current.revenue) * 100).toFixed(0)}% do faturamento`,
      delta: hasComp ? kpiDelta(costCurrent, costPrevious, vsLabel) : undefined,
      series: seriesCmv,
      tooltip: TIP_CMV,
    },
    {
      label: "Lucro bruto",
      value: brlCent(profitCurrent),
      delta: hasComp ? kpiDelta(profitCurrent, profitPrevious, vsLabel) : undefined,
      series: seriesProfit,
      tooltip: TIP_PROFIT_GROSS,
    },
    {
      label: "Margem",
      value: pct(marginCurrent),
      delta: hasComp ? kpiDeltaPp(marginCurrent, marginPrevious, vsLabel) : undefined,
      series: seriesMargin,
      tooltip: TIP_MARGIN,
    },
  ];

  // Serie de tendencia: eixo hora / dia / mes conforme o periodo filtrado.
  const seriesAxis = seriesAxisForPeriod(period);
  const seriesLabel = seriesAxisLabel(period, seriesAxis);
  const resultIsProrated = seriesAxis !== "month";

  // Faturamento por marca (sempre calculado; donut so quando filtro = todas).
  const revenueWepink = sumAggregates(fs.map((f) => periodAggregate(f, period.start, period.end, "WEPINK"))).revenue;
  const revenueWpink = sumAggregates(fs.map((f) => periodAggregate(f, period.start, period.end, "WPINK"))).revenue;
  const allBrandsRevenue = revenueWepink + revenueWpink;

  // Custos por loja (Configuracoes > Lojas): aluguel fixo compartilhado; % so sobre a(s) marca(s) do filtro.
  const incluiWepink = !division || division === "WEPINK";
  const incluiWpink = !division || division === "WPINK";
  const storesCosts = fs.map((f) => ({
    c: storeCostSnapshot(f),
    wepink: incluiWepink ? periodAggregate(f, period.start, period.end, "WEPINK").revenue : 0,
    wpink: incluiWpink ? periodAggregate(f, period.start, period.end, "WPINK").revenue : 0,
  }));
  const sumPct = (fn: (l: (typeof storesCosts)[number]) => number) =>
    Math.round(storesCosts.reduce((s, l) => s + fn(l), 0));
  const rentFixed = storesCosts.reduce((s, l) => s + l.c.rentFixed, 0);
  const rentPct = sumPct((l) => (l.wepink * l.c.rentWepinkPct + l.wpink * l.c.rentWpinkPct) / 100);
  const royaltiesWepink = sumPct((l) => (l.wepink * l.c.royaltiesWepinkPct) / 100);
  const royaltiesWpink = sumPct((l) => (l.wpink * l.c.royaltiesWpinkPct) / 100);
  const taxaMktWepink = sumPct((l) => (l.wepink * l.c.mktWepinkPct) / 100);
  const taxaMktWpink = sumPct((l) => (l.wpink * l.c.mktWpinkPct) / 100);
  const pctRent = rateSuffix(
    storesCosts.flatMap((l) => [
      ...(incluiWepink ? [l.c.rentWepinkPct] : []),
      ...(incluiWpink && l.wpink > 0 ? [l.c.rentWpinkPct] : []),
    ]),
  );
  const costsAgg = {
    rentFixed,
    rentPct,
    royaltiesWepink,
    royaltiesWpink,
    taxaMktWepink,
    taxaMktWpink,
  };
  const totalCostsFixed =
    costsAgg.rentFixed +
    costsAgg.rentPct +
    costsAgg.royaltiesWepink +
    costsAgg.royaltiesWpink +
    costsAgg.taxaMktWepink +
    costsAgg.taxaMktWpink;

  const costProfitSeries: CostProfitMonth[] = [];
  const operatingResult: OpResultMonth[] = [];

  if (seriesAxis === "hour") {
    const opening = Math.min(...fs.map((f) => f.opening));
    const closing = Math.max(...fs.map((f) => f.closing));
    const hours: number[] = [];
    for (let h = opening; h < closing; h++) hours.push(h);
    const hoursVisible = period.isToday ? hours.filter((h) => h <= CURRENT_HOUR) : hours;
    const dayRevenue = current.revenue;
    const dayCmv = costCurrent;
    const ratioCmv = divSeguro(dayCmv, dayRevenue);
    const costHour = totalCostsFixed / daysInMonth(period.start.slice(0, 7)) / (hours.length || 1);
    for (const h of hoursVisible) {
      const revenueH = fs.reduce((s, f) => {
        const a = salesDay(f.id, period.start)?.byHour[h];
        if (!a) return s;
        if (!division) return s + a.revenue;
        const day = salesDay(f.id, period.start)!;
        const fr = day.total.revenue > 0 ? day.byDivision[division].revenue / day.total.revenue : 0;
        return s + Math.round(a.revenue * fr);
      }, 0);
      const cmv = Math.round(revenueH * ratioCmv);
      const profit = revenueH - cmv;
      const label = shortHour(h);
      costProfitSeries.push({ label, cost: cmv, profit: profit, marginPct: divSeguro(profit, revenueH) * 100, revenue: revenueH });
      const result = profit - costHour;
      operatingResult.push({
        label,
        profit: profit,
        result: result,
        operatingMarginPct: divSeguro(result, revenueH) * 100,
        revenue: revenueH,
      });
    }
  } else if (seriesAxis === "day") {
    for (const iso of eachDay(period.start, period.end)) {
      const agg = sumAggregates(fs.map((f) => {
        const d = salesDay(f.id, iso);
        return d ? dayAggregate(d, division) : { revenue: 0, salesCount: 0, items: 0 };
      }));
      const cmv = periodCost(fs, iso, iso, division).cmv;
      const profit = agg.revenue - cmv;
      const label = dayAxisLabel(iso, period);
      const detail = dayPointDetail(iso);
      const costDay = totalCostsFixed / daysInMonth(iso.slice(0, 7));
      costProfitSeries.push({
        label,
        cost: cmv,
        profit: profit,
        marginPct: divSeguro(profit, agg.revenue) * 100,
        revenue: agg.revenue,
        rangeLabel: detail,
      });
      const result = profit - costDay;
      operatingResult.push({
        label,
        profit: profit,
        result: result,
        operatingMarginPct: divSeguro(result, agg.revenue) * 100,
        revenue: agg.revenue,
        rangeLabel: detail,
      });
    }
  } else {
    for (const month of monthsBetween(period.start, period.end)) {
      const agg = monthAggregate(fs, month, division);
      const profit = agg.revenue - agg.cmv;
      const label = monthYear(`${month}-01`).split(" de ")[0];
      costProfitSeries.push({
        label,
        cost: agg.cmv,
        profit: profit,
        marginPct: divSeguro(profit, agg.revenue) * 100,
        revenue: agg.revenue,
      });
      const result = profit - totalCostsFixed;
      operatingResult.push({
        label,
        profit: profit,
        result: result,
        operatingMarginPct: divSeguro(result, agg.revenue) * 100,
        revenue: agg.revenue,
      });
    }
  }

  const resultCurrent = profitCurrent - totalCostsFixed;
  const resultPrevious = profitPrevious - totalCostsFixed;
  const resultDelta = hasComp ? kpiDelta(resultCurrent, resultPrevious, vsLabel) : undefined;

  // Formas de pagamento no periodo.
  const periodDays = eachDay(period.start, period.end);
  const totaisForma: Record<string, number> = {};
  for (const f of fs) {
    for (const dayIso of periodDays) {
      const dv = salesDay(f.id, dayIso);
      if (!dv) continue;
      for (const [method, val] of Object.entries(dv.byMethod)) {
        totaisForma[method] = (totaisForma[method] ?? 0) + val;
      }
    }
  }
  const totalFormas = Object.values(totaisForma).reduce((s, v) => s + v, 0) || 1;
  const paymentMethods: PaymentMethodRevenue[] = Object.entries(totaisForma)
    .sort((a, b) => b[1] - a[1])
    .map(([method, amount]) => ({
      method,
      amount,
      pct: (amount / totalFormas) * 100,
      color: COLORS_FORMAS[method] ?? "var(--t2)",
    }));

  // Mini-DRE  ->  Resultado Operacional. Linhas de marca so aparecem no filtro correspondente.
  const brandRows: FixedCostRow[] = [];
  if (incluiWepink) {
    brandRows.push(
      { label: `Royalties WEPINK${rateSuffix(storesCosts.map((l) => l.c.royaltiesWepinkPct))}`, amount: costsAgg.royaltiesWepink },
      { label: `Taxa de marketing WEPINK${rateSuffix(storesCosts.map((l) => l.c.mktWepinkPct))}`, amount: costsAgg.taxaMktWepink },
    );
  }
  if (incluiWpink) {
    brandRows.push(
      { label: `Royalties WPINK${rateSuffix(storesCosts.map((l) => l.c.royaltiesWpinkPct))}`, amount: costsAgg.royaltiesWpink },
      { label: `Taxa de marketing WPINK${rateSuffix(storesCosts.map((l) => l.c.mktWpinkPct))}`, amount: costsAgg.taxaMktWpink },
    );
  }
  const franchiseFixedCosts: FixedCostRow[] = [
    { label: "Lucro bruto", amount: profitCurrent },
    { label: "Aluguel fixo", amount: costsAgg.rentFixed },
    { label: `Aluguel variável${pctRent}`, amount: costsAgg.rentPct },
    ...brandRows,
    { label: "Total de custos", amount: totalCostsFixed, isTotal: true },
    { label: "Resultado operacional", amount: resultCurrent, isResult: true },
  ];

  const revenueByBrand: RevenueByBrand[] | null = division
    ? null
    : [
        { brand: "WEPINK", amount: revenueWepink, pct: allBrandsRevenue > 0 ? (revenueWepink / allBrandsRevenue) * 100 : 0, color: "var(--wepink)" },
        { brand: "WPINK", amount: revenueWpink, pct: allBrandsRevenue > 0 ? (revenueWpink / allBrandsRevenue) * 100 : 0, color: "var(--wpink)" },
      ].filter((m) => m.amount > 0);

  const evo = monthlyEvolutionMonths(period, seriesAxis);
  const monthlyEvolutionLabel = evolutionCaption(period, evo.withPrevious);
  const monthlyEvolution: MonthlyEvolutionRow[] = evo.months.map((month) => {
    const agg = monthAggregate(fs, month, division);
    const profit = agg.revenue - agg.cmv;
    return {
      label: monthEvolutionLabel(month, evo.months),
      revenue: agg.revenue,
      cost: agg.cmv,
      profit: profit,
      marginPct: divSeguro(profit, agg.revenue) * 100,
      averageTicket: divSeguro(agg.revenue, agg.salesCount),
      salesCount: agg.salesCount,
    };
  });

  return {
    scope,
    period,
    kpis,
    seriesAxis,
    seriesLabel,
    resultIsProrated,
    costProfitSeries,
    operatingResult,
    resultDelta,
    paymentMethods,
    revenueByBrand,
    franchiseFixedCosts,
    costsConfigured: true,
    monthlyEvolution,
    showMonthlyEvolution: evo.months.length > 0,
    monthlyEvolutionLabel,
    kpisWpink: [],
  };
}

/* ---------- Financeiro com agregados reais (sales_day_agg / hour / payment) ---------- */

export type FinanceAggInput = {
  /** Periodo + periodo anterior + ultimos 6 meses, todas as marcas (ALL/WEPINK/WPINK). */
  dayAggs: import("./salesTypes").SalesDayAgg[];
  /** Horas do dia filtrado (periodo de 1 dia). */
  hourAggs?: import("./salesTypes").SalesHourAgg[];
  /** Horas do dia de comparacao  -  hoje compara com a mesma hora da semana passada. */
  prevHourAggs?: import("./salesTypes").SalesHourAgg[];
  /** Formas de pagamento (CONDICAO)  -  so brand=ALL. */
  paymentDayAggs?: import("./salesTypes").SalesPaymentDayAgg[];
  /** CMV por produto (RELATORIOMARGEM) do periodo  -  produtos sem custo no ERP e dias com margem gravada. */
  productCostDayAggs?: import("./salesTypes").SalesProductCostDayAgg[];
  /** COD_PRODUTO  ->  descricao (catalogo), para o aviso de produtos sem custo. */
  productNames?: Record<string, string>;
  /** Dia informado ao shopping, em centavos. Chave `loja|dia`. Sem a chave, o % usa o faturamento. */
  informedCents?: Record<string, number>;
};

/** Produto vendido com custo R$ 0 no Millennium (CMV e margem ficam otimistas). */
export interface ProductWithoutCost {
  code: string;
  name: string;
  items: number;
  revenue: number;
}

type FinMoney = { rev: number; cmv: number; sales: number; items: number };
type FinCell = { ALL?: FinMoney; WEPINK?: FinMoney; WPINK?: FinMoney };
type FinCosts = {
  rentPct: number;
  royWepink: number;
  royWpink: number;
  mktWepink: number;
  mktWpink: number;
  /** Custos variaveis da loja (% do faturamento)  -  hoje sempre 0; volta com a tela de DRE. */
  variaveis: number;
};
/**
 * Custos mensais rateados por dia (nao seguem o faturamento). `fixos`/`outras` hoje sempre 0 por loja
 * (voltam com a tela de DRE); no eixo por hora `fixos` carrega o rateio dos custos mensais.
 */
type FinMonthly = {
  fixed: number;
  others: number;
  /** Aluguel minimo do mes, inteiro (uma vez por loja x mes no recorte). */
  rentMinBase: number;
  /** Quanto falta para o % chegar no minimo: max(0, minimo do mes − aluguel %), por loja no periodo. */
  rentMin: number;
};
type FinLine = FinMoney & FinCosts & FinMonthly;

const FIN_ZERO: FinMoney = { rev: 0, cmv: 0, sales: 0, items: 0 };
const FIN_LINE_ZERO: FinLine = {
  ...FIN_ZERO,
  rentPct: 0,
  royWepink: 0,
  royWpink: 0,
  mktWepink: 0,
  mktWpink: 0,
  variaveis: 0,
  fixed: 0,
  others: 0,
  rentMinBase: 0,
  rentMin: 0,
};

/** Lucro bruto = faturamento − CMV. */
function finProfit(l: FinLine): number {
  return l.rev - l.cmv;
}

function finAdd<T extends Record<string, number>>(a: T, b: T): T {
  const out = { ...a };
  for (const k of Object.keys(b) as (keyof T)[]) out[k] = ((a[k] ?? 0) + (b[k] ?? 0)) as T[keyof T];
  return out;
}

function finScale<T extends Record<string, number>>(a: T, f: number): T {
  const out = { ...a };
  for (const k of Object.keys(a) as (keyof T)[]) out[k] = (a[k] * f) as T[keyof T];
  return out;
}

/** Custos da operacao da linha: aluguel (% + complemento do minimo) + franquia + custos da loja. */
function finOperatingCosts(l: FinCosts & FinMonthly): number {
  return l.rentPct + l.rentMin + l.royWepink + l.royWpink + l.mktWepink + l.mktWpink + l.variaveis + l.fixed + l.others;
}

/** Custos mensais (fixos, outras despesas, complemento do aluguel minimo)  -  rateados nas horas abertas. */
function finMonthlyCosts(l: FinMonthly): number {
  return l.fixed + l.others + l.rentMin;
}

/** Custos da loja para dados reais: campo sem configuracao = 0 (nao inventa R$). */
function storeCostRates(f: Store) {
  const c = f.costs;
  const street = f.pointType === "STREET";
  return {
    rentMin: c?.rentMin ?? 0,
    rentWepinkPct: street ? 0 : (c?.rentWepinkPct ?? 0),
    rentWpinkPct: street ? 0 : (c?.rentWpinkPct ?? 0),
    royaltiesWepinkPct: c?.royaltiesWepinkPct ?? 0,
    royaltiesWpinkPct: c?.royaltiesWpinkPct ?? 0,
    mktWepinkPct: c?.marketingWepinkPct ?? 0,
    mktWpinkPct: c?.marketingWpinkPct ?? 0,
  };
}

/** Financeiro a partir dos agregados do sync (sem fixture). Custos % seguem o faturamento. O aluguel mínimo entra inteiro no mês; no dia, na semana e no período personalizado entra a parte dos dias. */
export function buildFinanceViewFromAggs(scope: Scope, input: FinanceAggInput): FinanceView {
  const today = calendarTodayIso();
  const period = resolvePeriod(scope.period, today);
  const fs = storesInScope(scope);
  const storeById = new Map(fs.map((f) => [f.id, f]));
  const division = scope.division;
  const incluiWepink = !division || division === "WEPINK";
  const incluiWpink = !division || division === "WPINK";

  const cells = new Map<string, FinCell>();
  for (const r of input.dayAggs) {
    if (!storeById.has(r.storeId)) continue;
    const key = `${r.storeId}|${r.day}`;
    const cell = cells.get(key) ?? {};
    const prev = cell[r.brand] ?? FIN_ZERO;
    cell[r.brand] = finAdd(prev, {
      rev: r.revenueCents / 100,
      cmv: (r.cmvCents ?? 0) / 100,
      sales: r.salesCount,
      items: r.itemCount,
    });
    cells.set(key, cell);
  }

  /** Linha lojaxdia no filtro de marca: receita/CMV/contagens + custos % (marca) + aluguel fixo do dia. */
  function storeDay(f: Store, iso: string): FinLine {
    const cell = cells.get(`${f.id}|${iso}`) ?? {};
    const hasSplit = Boolean(cell.WEPINK || cell.WPINK);
    const all = cell.ALL ?? (hasSplit ? finAdd(cell.WEPINK ?? FIN_ZERO, cell.WPINK ?? FIN_ZERO) : FIN_ZERO);
    // Loja sem split de marca (sem WPINK ou split ainda nao rodou)  ->  tudo WEPINK.
    const wepink = cell.WEPINK ?? (hasSplit ? FIN_ZERO : all);
    const wpink = cell.WPINK ?? FIN_ZERO;
    let m = !division ? all : division === "WEPINK" ? wepink : wpink;
    // Relatorio de marca pode vir sem contagens: rateia do ALL pela receita.
    if (division && m.sales === 0 && m.rev > 0 && all.rev > 0) {
      const share = m.rev / all.rev;
      m = { ...m, sales: Math.round(all.sales * share), items: Math.round(all.items * share) };
    }
    const c = storeCostRates(f);
    const w = incluiWepink ? wepink.rev : 0;
    const p = incluiWpink ? wpink.rev : 0;
    const yearMonth = iso.slice(0, 7);
    const daysMonth = daysInMonth(yearMonth);
    const informed = input.informedCents?.[`${f.id}|${iso}`];
    const rentPct =
      f.pointType === "SHOPPING" && !division && informed != null
        ? (informed / 100) * c.rentWepinkPct / 100
        : (w * c.rentWepinkPct + p * c.rentWpinkPct) / 100;
    const rentMinBase = (c.rentMin * rentSeasonFactor(f.costs?.rentSeasons, yearMonth)) / daysMonth;
    return {
      ...m,
      rentPct,
      royWepink: (w * c.royaltiesWepinkPct) / 100,
      royWpink: (p * c.royaltiesWpinkPct) / 100,
      mktWepink: (w * c.mktWepinkPct) / 100,
      mktWpink: (p * c.mktWpinkPct) / 100,
      variaveis: 0,
      fixed: 0,
      others: 0,
      rentMinBase,
      rentMin: Math.max(0, rentMinBase - rentPct),
    };
  }

  /** Aluguel minimo cheio do mes (com temporada). Nao divide pelos dias do filtro. */
  function fullRentMin(f: Store, yearMonth: string): number {
    return storeCostRates(f).rentMin * rentSeasonFactor(f.costs?.rentSeasons, yearMonth);
  }

  /** Soma os dias de uma loja. No mês o mínimo entra inteiro; no dia e nos recortes curtos, só a parte dos dias. */
  function lineFor(f: Store, days: string[]): FinLine {
    const byMonth = new Map<string, string[]>();
    for (const iso of days) {
      const month = iso.slice(0, 7);
      byMonth.set(month, [...(byMonth.get(month) ?? []), iso]);
    }
    let acc = FIN_LINE_ZERO;
    for (const [month, daysMonth] of byMonth) {
      let store = FIN_LINE_ZERO;
      for (const iso of daysMonth) store = finAdd(store, storeDay(f, iso));
      const floor = rentFloor(fullRentMin(f, month), daysMonth.length, month, period);
      acc = finAdd(acc, { ...store, rentMinBase: floor, rentMin: Math.max(0, floor - store.rentPct) });
    }
    return acc;
  }

  /** Soma loja x mês: o aluguel é o maior entre o mínimo do recorte e o % , não dia a dia. */
  function sumDays(days: string[]): FinLine {
    return fs.reduce((acc, f) => finAdd(acc, lineFor(f, days)), FIN_LINE_ZERO);
  }

  /** Horas de uma loja no filtro de marca; sem horaxmarca, usa ALL x participacao da marca no dia. */
  function storeHours(rows: import("./salesTypes").SalesHourAgg[], f: Store, day: FinLine, iso: string): Map<number, FinMoney> {
    const own = rows.filter((h) => h.storeId === f.id && h.day === iso);
    const pick = (brand: string) => own.filter((h) => h.brand === brand);
    let base = division ? pick(division) : pick("ALL");
    let factor = 1;
    if (base.length === 0) {
      if (division) {
        base = pick("ALL");
        const cell = cells.get(`${f.id}|${iso}`) ?? {};
        const allRev = cell.ALL?.rev ?? 0;
        factor = allRev > 0 ? day.rev / allRev : 0;
      } else {
        base = own.filter((h) => h.brand === "WEPINK" || h.brand === "WPINK");
      }
    }
    const out = new Map<number, FinMoney>();
    for (const h of base) {
      const cur = out.get(h.hour) ?? FIN_ZERO;
      out.set(h.hour, finAdd(cur, {
        rev: (h.revenueCents / 100) * factor,
        cmv: 0,
        sales: h.salesCount * factor,
        items: h.itemCount * factor,
      }));
    }
    return out;
  }

  const periodDays = eachDay(period.start, period.end);
  const current = sumDays(periodDays);

  // Periodo anterior equivalente. Terminando hoje, o ultimo dia do anterior entra ate a hora atual (precisa das horas).
  const prev = previousPeriod(period, calendarCurrentHour());
  const daysPrev = eachDay(prev.start, prev.end);
  let previous: FinLine | null = sumDays(daysPrev);
  if (prev.hourMax != null) {
    let partial = sumDays(daysPrev.slice(0, -1));
    let gapHour = false;
    for (const f of fs) {
      const day = storeDay(f, prev.end);
      const hours = storeHours(input.prevHourAggs ?? [], f, day, prev.end);
      if (hours.size === 0 && day.rev > 0) gapHour = true;
      let rev = 0;
      let sales = 0;
      let items = 0;
      for (const [h, m] of hours) {
        if (h > prev.hourMax) continue;
        rev += m.rev;
        sales += m.sales;
        items += m.items;
      }
      const frac = day.rev > 0 ? rev / day.rev : 0;
      const escalado = finScale(day, frac);
      const month = prev.end.slice(0, 7);
      const earlierDays = daysPrev.slice(0, -1).filter((d) => d.startsWith(month));
      const earlierMonth = lineFor(f, earlierDays);
      const floor = rentFloor(fullRentMin(f, month), earlierDays.length + 1, month, period);
      const complement = Math.max(0, floor - (earlierMonth.rentPct + escalado.rentPct));
      partial = finAdd(partial, {
        ...escalado,
        rev,
        sales,
        items,
        fixed: day.fixed,
        others: day.others,
        rentMinBase: Math.max(0, floor - earlierMonth.rentMinBase),
        rentMin: 0,
      });
      partial = { ...partial, rentMin: partial.rentMin - earlierMonth.rentMin + complement };
    }
    previous = gapHour ? null : partial;
  }

  // Sem venda no periodo atual nao e queda de 100%  -  e falta de dado (sem badge).
  const hasComp = previous != null && previous.rev > 0 && current.rev > 0;
  const vsLabel = hasComp ? prev.label : undefined;
  const prevLine = previous ?? FIN_LINE_ZERO;

  const profitCurrent = finProfit(current);
  const marginCurrent = divSeguro(profitCurrent, current.rev) * 100;
  const hasCmv = current.cmv > 0;
  // CMV nao existe por hora: terminando hoje, CMV/lucro/margem/resultado comparam sem o dia de hoje nos dois lados.
  const cutsAtToday = prev.hourMax != null;
  const currentCmp = cutsAtToday ? sumDays(periodDays.slice(0, -1)) : current;
  const prevCmp = cutsAtToday ? sumDays(daysPrev.slice(0, -1)) : prevLine;
  const vsCmv = cutsAtToday ? `${prev.label}, até o mesmo dia` : prev.label;
  const cmvComparavel = hasComp && hasCmv && currentCmp.cmv > 0 && prevCmp.cmv > 0;
  const profitCurrentCmp = finProfit(currentCmp);
  const profitPreviousCmp = finProfit(prevCmp);
  const marginCurrentCmp = divSeguro(profitCurrentCmp, currentCmp.rev) * 100;
  const marginPreviousCmp = divSeguro(profitPreviousCmp, prevCmp.rev) * 100;

  const kpis: FinanceKpi[] = [
    {
      label: "Faturamento",
      value: brlCent(current.rev),
      delta: hasComp ? kpiDelta(current.rev, prevLine.rev, vsLabel) : undefined,
    },
    {
      label: "CMV",
      value: hasCmv ? brlCent(current.cmv) : "—",
      sub: hasCmv ? `${(divSeguro(current.cmv, current.rev) * 100).toFixed(0)}% do faturamento` : undefined,
      delta: cmvComparavel ? kpiDelta(currentCmp.cmv, prevCmp.cmv, vsCmv) : undefined,
      tooltip: hasCmv ? TIP_CMV : TIP_CMV_INDISPONIVEL,
    },
    {
      label: "Lucro bruto",
      value: hasCmv ? brlCent(profitCurrent) : "—",
      delta: cmvComparavel ? kpiDelta(profitCurrentCmp, profitPreviousCmp, vsCmv) : undefined,
      tooltip: TIP_PROFIT_GROSS,
    },
    {
      label: "Margem",
      value: hasCmv ? pct(marginCurrent) : "—",
      delta: cmvComparavel ? kpiDeltaPp(marginCurrentCmp, marginPreviousCmp, vsCmv) : undefined,
      tooltip: TIP_MARGIN,
    },
  ];

  const seriesAxis = seriesAxisForPeriod(period);
  const seriesLabel = seriesAxisLabel(period, seriesAxis);
  const resultIsProrated = seriesAxis !== "month";

  const costProfitSeries: CostProfitMonth[] = [];
  const operatingResult: OpResultMonth[] = [];
  const pushDot = (label: string, l: FinLine, future = false, band?: string) => {
    const profit = finProfit(l);
    const result = profit - finOperatingCosts(l);
    const f = { ...(future ? { future: true } : {}), ...(band ? { rangeLabel: band } : {}) };
    costProfitSeries.push({ label, cost: l.cmv, profit: profit, marginPct: divSeguro(profit, l.rev) * 100, revenue: l.rev, ...f });
    operatingResult.push({ label, profit: profit, result: result, operatingMarginPct: divSeguro(result, l.rev) * 100, revenue: l.rev, ...f });
  };

  if (seriesAxis === "hour") {
    const iso = period.start;
    const dow = isoToDate(iso).getDay() as Dow;
    const byHour = new Map<number, FinLine>();
    for (const f of fs) {
      const day = storeDay(f, iso);
      const hours = storeHours(input.hourAggs ?? [], f, day, iso);
      const cmvRatio = divSeguro(day.cmv, day.rev);
      const costRatio = day.rev > 0 ? 1 / day.rev : 0;
      for (const [h, m] of hours) {
        const cur = byHour.get(h) ?? FIN_LINE_ZERO;
        byHour.set(h, finAdd(cur, {
          ...FIN_LINE_ZERO,
          ...m,
          cmv: m.rev * cmvRatio,
          rentPct: m.rev * day.rentPct * costRatio,
          royWepink: m.rev * day.royWepink * costRatio,
          royWpink: m.rev * day.royWpink * costRatio,
          mktWepink: m.rev * day.mktWepink * costRatio,
          mktWpink: m.rev * day.mktWpink * costRatio,
          variaveis: m.rev * day.variaveis * costRatio,
        }));
      }
    }
    const withSale = [...byHour.entries()].filter(([, l]) => l.rev > 0).map(([h]) => h);
    // Mesmo eixo do Faturamento x meta; hoje, as horas que ainda nao chegaram ficam sem linha.
    const { first, last, win } = hourAxisRange(fs.map((f) => f.hours), dow, withSale);
    const hoursAbertas = Math.max(1, win.closing - win.opening);
    const monthlyHour = finMonthlyCosts(current) / hoursAbertas;
    const nowH = calendarCurrentHour();
    // O total do grafico e o faturamento do dia. Hora 0 (cupom sem hora) fica de fora do eixo.
    let sumRev = 0;
    for (let h = first; h <= last; h++) sumRev += byHour.get(h)?.rev ?? 0;
    const factorRev = current.rev > 0 && sumRev > 0 ? current.rev / sumRev : 1;
    const dayWithoutMonthly: FinLine = { ...current, fixed: 0, others: 0, rentMinBase: 0, rentMin: 0 };
    for (let h = first; h <= last; h++) {
      const base = byHour.get(h) ?? FIN_LINE_ZERO;
      const l = sumRev === 0 && current.rev > 0 && h === first
        ? dayWithoutMonthly
        : factorRev === 1 ? base : finScale(base, factorRev);
      const future = period.isToday && h > nowH && l.rev <= 0;
      const inside = !future && h >= win.opening && h < win.closing;
      pushDot(
        shortHour(h),
        { ...l, fixed: inside ? monthlyHour : 0, others: 0, rentMinBase: 0, rentMin: 0 },
        future,
        hourSpan(h, period.isToday && h === nowH),
      );
    }
  } else if (seriesAxis === "day") {
    // Complemento do aluguel minimo e do mes: dividido igualmente pelos dias do mes no periodo.
    const complementoDay = new Map<string, number>();
    for (const month of new Set(periodDays.map((iso) => iso.slice(0, 7)))) {
      const daysOfMonth = periodDays.filter((iso) => iso.startsWith(month));
      complementoDay.set(month, sumDays(daysOfMonth).rentMin / daysOfMonth.length);
    }
    for (const iso of periodDays) {
      pushDot(dayAxisLabel(iso, period), { ...sumDays([iso]), rentMin: complementoDay.get(iso.slice(0, 7)) ?? 0 }, false, dayPointDetail(iso));
    }
  } else {
    for (const month of monthsBetween(period.start, period.end)) {
      const ini = `${month}-01` < period.start ? period.start : `${month}-01`;
      const endMonth = endOfMonth(`${month}-01`);
      const end = endMonth > period.end ? period.end : endMonth;
      pushDot(monthYear(`${month}-01`).split(" de ")[0], sumDays(eachDay(ini, end)));
    }
  }

  const totalCosts = finOperatingCosts(current);
  const resultCurrent = profitCurrent - totalCosts;
  const resultCurrentCmp = profitCurrentCmp - finOperatingCosts(currentCmp);
  const resultPreviousCmp = profitPreviousCmp - finOperatingCosts(prevCmp);
  const resultDelta = cmvComparavel ? kpiDelta(resultCurrentCmp, resultPreviousCmp, vsCmv) : undefined;

  // Formas de pagamento: sempre total (a Lista nao traz marca).
  const scopedIds = new Set(fs.map((f) => f.id));
  const totaisForma: Record<string, number> = {};
  for (const row of input.paymentDayAggs ?? []) {
    if (!scopedIds.has(row.storeId)) continue;
    if (row.day < period.start || row.day > period.end || row.revenueCents <= 0) continue;
    const forma = row.paymentMethod || "Outros";
    totaisForma[forma] = (totaisForma[forma] ?? 0) + row.revenueCents / 100;
  }
  const totalFormas = Object.values(totaisForma).reduce((s, v) => s + v, 0) || 1;
  const FORMAS_FALLBACK = ["var(--acc)", "var(--info)", "var(--ok)", "var(--warn)", "var(--t2)"];
  const paymentMethods: PaymentMethodRevenue[] = Object.entries(totaisForma)
    .sort((a, b) => b[1] - a[1])
    .map(([method, amount], i) => ({
      method,
      amount,
      pct: (amount / totalFormas) * 100,
      color: COLORS_FORMAS[method] ?? FORMAS_FALLBACK[i % FORMAS_FALLBACK.length]!,
    }));

  // Mini-DRE. Linhas WPINK so se alguma loja do escopo tem a marca.
  const costs = fs.map((f) => storeCostRates(f));
  const hasWpink = fs.some((f) => f.hasWpink);
  const brandRows: FixedCostRow[] = [];
  if (incluiWepink) {
    brandRows.push(
      { label: `Royalties WEPINK${rateSuffix(costs.map((c) => c.royaltiesWepinkPct))}`, amount: current.royWepink },
      { label: `Taxa de marketing WEPINK${rateSuffix(costs.map((c) => c.mktWepinkPct))}`, amount: current.mktWepink },
    );
  }
  if (incluiWpink && hasWpink) {
    const cw = fs.filter((f) => f.hasWpink).map((f) => storeCostRates(f));
    brandRows.push(
      { label: `Royalties WPINK${rateSuffix(cw.map((c) => c.royaltiesWpinkPct))}`, amount: current.royWpink },
      { label: `Taxa de marketing WPINK${rateSuffix(cw.map((c) => c.mktWpinkPct))}`, amount: current.mktWpink },
    );
  }
  // Aluguel do mes = maior entre o fixo e o %: mostra o fixo e, se o % passar dele, so o excedente.
  const rentFixed = current.rentMinBase;
  const rentSurplus = Math.max(0, current.rentPct + current.rentMin - rentFixed);
  const rentRateLabel = `${rentFixed > 0 ? "Aluguel percentual excedente" : "Aluguel percentual"}${rateSuffix(costs.map((c) => c.rentWepinkPct))}`;
  const franchiseFixedCosts: FixedCostRow[] = [
    { label: "Lucro bruto", amount: profitCurrent },
    ...(rentFixed > 0 ? [{ label: "Aluguel", amount: rentFixed }] : []),
    ...(rentSurplus >= 0.005 ? [{ label: rentRateLabel, amount: rentSurplus }] : []),
    ...brandRows,
    { label: "Total de custos", amount: totalCosts, isTotal: true },
    { label: "Resultado operacional", amount: resultCurrent, isResult: true },
  ];

  let revenueByBrand: RevenueByBrand[] | null = null;
  if (!division) {
    let revenueWepink = 0;
    let revenueWpink = 0;
    for (const f of fs) {
      for (const iso of periodDays) {
        const cell = cells.get(`${f.id}|${iso}`);
        revenueWepink += cell?.WEPINK?.rev ?? 0;
        revenueWpink += cell?.WPINK?.rev ?? 0;
      }
    }
    const total = revenueWepink + revenueWpink;
    revenueByBrand = hasWpink
      ? [
          { brand: "WEPINK", amount: revenueWepink, pct: total > 0 ? (revenueWepink / total) * 100 : 0, color: "var(--wepink)" },
          { brand: "WPINK", amount: revenueWpink, pct: total > 0 ? (revenueWpink / total) * 100 : 0, color: "var(--wpink)" },
        ].filter((m) => m.amount > 0)
      : null;
  }

  // Evolucao mensal: periodo mensal (calendario)  -  meses do filtro, recortados nas pontas; 1 mes so = + 5 anteriores inteiros.
  const evo = monthlyEvolutionMonths(period, seriesAxis);
  const monthlyEvolution: MonthlyEvolutionRow[] = evo.months
    .map((month) => {
      const iniMonth = month === period.start.slice(0, 7) ? period.start : `${month}-01`;
      const endMonth = endOfMonth(`${month}-01`);
      const endCorte = [endMonth, period.end, today].sort()[0]!;
      const l = sumDays(eachDay(iniMonth, endCorte));
      const profit = finProfit(l);
      return {
        label: monthEvolutionLabel(month, evo.months, iniMonth, endCorte),
        revenue: l.rev,
        cost: l.cmv,
        profit: profit,
        marginPct: divSeguro(profit, l.rev) * 100,
        averageTicket: divSeguro(l.rev, l.sales),
        salesCount: l.sales,
      };
    })
    .filter((r) => r.revenue > 0);

  const costDays = new Set<string>();
  const withoutCost = new Map<string, ProductWithoutCost>();
  for (const r of input.productCostDayAggs ?? []) {
    if (!storeById.has(r.storeId)) continue;
    costDays.add(`${r.storeId}|${r.day}`);
    if (r.day < period.start || r.day > period.end || r.revenueCents <= 0 || r.cmvCents !== 0) continue;
    const code = r.productCode.trim();
    if (!code) continue;
    const p = withoutCost.get(code) ?? { code: code, name: input.productNames?.[code] ?? "", items: 0, revenue: 0 };
    p.items += r.itemCount;
    p.revenue += r.revenueCents / 100;
    withoutCost.set(code, p);
  }
  const productsWithoutCost = [...withoutCost.values()].sort((a, b) => b.revenue - a.revenue);

  return {
    scope,
    period,
    kpis,
    seriesAxis,
    seriesLabel,
    resultIsProrated,
    costProfitSeries,
    operatingResult,
    resultDelta,
    paymentMethods,
    revenueByBrand,
    franchiseFixedCosts,
    costsConfigured: fs.some(storeOperatingCostsConfigured),
    monthlyEvolution,
    showMonthlyEvolution: evo.months.length > 0,
    monthlyEvolutionLabel: evolutionCaption(period, evo.withPrevious),
    periodRevenue: current.rev,
    kpiItems: {
      label: "Itens vendidos",
      value: num(Math.round(current.items)),
      delta:
        hasComp && prevLine.items > 0 && current.items > 0
          ? kpiDelta(Math.round(current.items), Math.round(prevLine.items), vsLabel, "items")
          : undefined,
    },
    kpisWpink: buildFinanceWpinkKpis({
      show: fs.some((f) => f.hasWpink),
      current: wpinkTotals(input.dayAggs, storeById, period.start, period.end, costDays),
      previous: wpinkPrevTotals(input.dayAggs, input.prevHourAggs ?? [], storeById, prev),
      revenueTotal: current.rev,
      vsLabel: prev.label,
      cmvCompare: {
        current: wpinkTotals(input.dayAggs, storeById, period.start, cutsAtToday ? addDays(period.end, -1) : period.end, costDays),
        previous: wpinkTotals(input.dayAggs, storeById, prev.start, cutsAtToday ? addDays(prev.end, -1) : prev.end, costDays),
        vsLabel: vsCmv,
      },
    }),
    productsWithoutCost,
  };
}

/** Inicio da janela de dias que o Financeiro precisa (periodo anterior e 6 meses de evolucao). */
export function financeFetchRange(scope: Scope): { from: string; to: string; prevHourDay: string | null } {
  const today = calendarTodayIso();
  const period = resolvePeriod(scope.period, today);
  const prev = previousPeriod(period);
  const evo = monthlyEvolutionMonths(period, seriesAxisForPeriod(period));
  const from = [period.start, prev.start, ...(evo.withPrevious ? [`${evo.months[0]}-01`] : [])].sort()[0]!;
  const to = period.end > today ? period.end : today;
  const prevHourDay = period.endsToday ? prev.end : null;
  return { from, to, prevHourDay };
}

/* ================================================================
 * TELA PRODUTOS  -  camada de dados (agregados reais do sync)
 * ================================================================ */

export type ProductsKpi = FinanceKpi;

export interface CategoryRevenue {
  categoryId: number;
  name: string;
  revenue: number;
  items: number;
}

/** Linha da tabela de produtos (relatorio {E7A5C5C7} + CMV do RELATORIOMARGEM por COD_PRODUTO). */
export interface ProductItemRow {
  /** `COD_PRODUTO` ou `#productId` (sem codigo)  -  abre o detalhe. */
  rowKey: string;
  code: string;
  name: string;
  revenue: number;
  items: number;
  priceAverage: number;
  /** Participacao no faturamento dos produtos do periodo (0 - 100). */
  participationPct: number;
  /** null = algum dia com venda do produto sem custo gravado (nada estimado). */
  cmv: number | null;
  profit: number | null;
  marginPct: number | null;
  /** Faturamento vs periodo anterior (%); null sem base de comparacao. */
  variationPct: number | null;
  /** Faturamento nos dois lados do comparativo (mesmo recorte da Variacao)  -  variacao do total. */
  revenueCmp: number;
  revenuePrev: number;
}

export type AbcClass = "A" | "B" | "C";

/** Categoria na curva ABC (Pareto): ordenada por faturamento desc. */
export interface AbcCategory {
  categoryId: number;
  name: string;
  revenue: number;
  pct: number;
  pctAccumulated: number;
  productClass: AbcClass;
}

export interface AbcCurveSummary {
  productClass: AbcClass;
  qtyCategories: number;
  /** Participacao da classe no faturamento total (0 - 100). */
  pctRevenue: number;
  /** Soma do faturamento das categorias da classe. */
  revenue: number;
}

export interface AbcCurveCategories {
  items: AbcCategory[];
  summary: AbcCurveSummary[];
}

export interface ProductsView {
  scope: Scope;
  period: ResolvedPeriod;
  /** Faturamento  |  Lucro bruto  |  Margem  |  Itens vendidos (mesmas regras do Financeiro). */
  kpis: ProductsKpi[];
  kpisWpink: OverviewKpiWpink[];
  hasSales: boolean;
  categories: CategoryRevenue[];
  deltaCategories?: { value: string; positive: boolean; vs?: string; previous?: string };
  /** Curva ABC (Pareto) das categorias  -  cortes 80% / 95%. */
  curveAbcCategories: AbcCurveCategories;
  products: ProductItemRow[];
  /** Linhas de produto (fragrancia), ranking completo por faturamento. */
  lines: ProductLineRow[];
  /** Faturamento de produtos sem linha (skincare, cabelo, maquiagem, suplementos, kits). */
  withoutLineRevenue: number;
  /** Algum produto do periodo tem CMV gravado. */
  hasCostProduct: boolean;
  /** Base da coluna Variacao (tooltip). */
  vsVariation: string;
  /** Produtos vendidos no periodo com custo R$ 0 no Millennium. */
  productsWithoutCost: ProductWithoutCost[];
}

export type ProductsAggInput = FinanceAggInput & {
  categoryDayAggs?: import("./salesTypes").SalesCategoryDayAgg[];
  productDayAggs?: import("./salesTypes").SalesProductDayAgg[];
  productCostDayAggs?: import("./salesTypes").SalesProductCostDayAgg[];
  /** Descricoes do catalogo  -  nome estavel das linhas de produto. */
  catalogDescriptions?: string[];
  /** id do produto no ERP  ->  tipo (categoria)  -  detalhe da Curva ABC. */
  catalogTypes?: Record<number, number>;
};

export interface ProductLineRow {
  name: string;
  revenue: number;
  items: number;
  /** Produtos da linha vendidos no periodo. */
  products: number;
  /** Tipos vendidos (desodorante colonia, body splash...), do maior faturamento para o menor. */
  kinds: string[];
  participationPct: number;
  /** null = algum produto da linha sem custo gravado. */
  profit: number | null;
  /** null = algum produto da linha sem custo gravado. */
  marginPct: number | null;
  variationPct: number | null;
  /** Faturamento nos dois lados do comparativo — variação do total da linha. */
  revenueCmp: number;
  revenuePrev: number;
  /** Chaves (`ProductItemRow.chave`) de todos os produtos da linha  -  abre o detalhe. */
  rowKeys: string[];
}

/** Classifica categorias em A/B/C (80%/95% acumulado), ja ordenadas por fat. desc. */
export function classifyAbcCurve(cats: Array<{ categoryId: number; name: string; revenue: number }>): AbcCurveCategories {
  const total = cats.reduce((s, c) => s + c.revenue, 0) || 1;
  let acum = 0;
  const items: AbcCategory[] = cats.map((c) => {
    const pct = (c.revenue / total) * 100;
    const before = acum;
    acum += pct;
    const productClass: AbcClass = before < 80 ? "A" : before < 95 ? "B" : "C";
    return {
      categoryId: c.categoryId,
      name: c.name,
      revenue: c.revenue,
      pct,
      pctAccumulated: acum,
      productClass,
    };
  });
  const classes: AbcClass[] = ["A", "B", "C"];
  const summary: AbcCurveSummary[] = classes.map((productClass) => {
    const ofGroup = items.filter((i) => i.productClass === productClass);
    const revenue = ofGroup.reduce((s, i) => s + i.revenue, 0);
    return {
      productClass,
      qtyCategories: ofGroup.length,
      pctRevenue: ofGroup.reduce((s, i) => s + i.pct, 0),
      revenue,
    };
  });
  return { items, summary };
}

const productDayKey = (storeId: string, day: string, code: string) => `${storeId}|${day}|${code}`;

/**
 * Venda do produto no dia (RELATORIOMARGEM TOTALVENDA). O cupom, ou o DetMov quando a
 * venda nao veio no relatorio de cupom, as vezes grava preco R$ 0. Com a venda da margem
 * gravada, ela prevalece — e o mesmo numero da Lista. Sem ela, fica o valor do cupom.
 */
function productDaySaleMap(
  rows: Array<{ storeId: string; day: string; productCode: string; revenueCents: number }> | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows ?? []) {
    const code = r.productCode.trim();
    if (!code || r.revenueCents <= 0) continue;
    const k = productDayKey(r.storeId, r.day, code);
    out.set(k, (out.get(k) ?? 0) + r.revenueCents / 100);
  }
  return out;
}

/** null = este dia x produto ja entrou pela margem (nao soma de novo). */
function productDaySaleBrl(
  row: { storeId: string; day: string; productCode: string; revenueCents: number },
  marginSales: Map<string, number>,
  used: Set<string>,
): number | null {
  const code = row.productCode.trim();
  const k = productDayKey(row.storeId, row.day, code);
  const margin = code ? marginSales.get(k) : undefined;
  if (margin != null && margin > 0) {
    if (used.has(k)) return null;
    used.add(k);
    return margin;
  }
  return row.revenueCents / 100;
}

/** Janela de leitura de categorias/produtos: periodo anterior + periodo atual. */
export function productsFetchRange(scope: Scope): { from: string; to: string } {
  const period = resolvePeriod(scope.period, calendarTodayIso());
  const prev = previousPeriod(period);
  return { from: prev.start < period.start ? prev.start : period.start, to: period.end };
}

/**
 * Produtos a partir dos agregados do sync. Sem filtro de marca (tudo ALL).
 * KPIs e faixa WPINK = Financeiro. Categorias e produtos sem hora: terminando hoje,
 * os comparativos usam "ate ontem" nos dois lados.
 */
export function buildProductsView(scope: Scope, input: ProductsAggInput = { dayAggs: [] }): ProductsView {
  const esc: Scope = { ...scope, division: null };
  const fin = buildFinanceViewFromAggs(esc, input);
  const period = fin.period;
  const storeById = new Map(storesInScope(esc).map((f) => [f.id, f]));

  const prev = previousPeriod(period, calendarCurrentHour());
  const cutsAtToday = prev.hourMax != null;
  const endCmp = cutsAtToday ? addDays(period.end, -1) : period.end;
  const prevEndCmp = cutsAtToday ? addDays(prev.end, -1) : prev.end;
  const vsCmp = cutsAtToday ? `${prev.label}, até o mesmo dia` : prev.label;
  const inCurrent = (d: string) => d >= period.start && d <= period.end;
  const inCurrentCmp = (d: string) => d >= period.start && d <= endCmp;
  const inPrevCmp = (d: string) => d >= prev.start && d <= prevEndCmp;

  const kpiByLabel = (label: string) => fin.kpis.find((k) => k.label === label);
  const kpis = [kpiByLabel("Faturamento"), kpiByLabel("Lucro bruto"), kpiByLabel("Margem"), fin.kpiItems].filter(
    (k): k is ProductsKpi => Boolean(k),
  );

  // Categorias (itens vendidos x catalogo)  -  chave = PRODUTO_TIPO; nome = o do dia mais recente.
  const catAcc = new Map<number, { name: string; nameDay: string; revenue: number; items: number; revenueCmp: number; revenuePrev: number }>();
  for (const r of input.categoryDayAggs ?? []) {
    if (!storeById.has(r.storeId)) continue;
    const acc = catAcc.get(r.categoryId) ?? { name: "", nameDay: "", revenue: 0, items: 0, revenueCmp: 0, revenuePrev: 0 };
    if (r.categoryName && r.day >= acc.nameDay) {
      acc.name = r.categoryName;
      acc.nameDay = r.day;
    }
    const v = r.revenueCents / 100;
    if (inCurrent(r.day)) {
      acc.revenue += v;
      acc.items += r.itemCount;
    }
    if (inCurrentCmp(r.day)) acc.revenueCmp += v;
    if (inPrevCmp(r.day)) acc.revenuePrev += v;
    catAcc.set(r.categoryId, acc);
  }
  const categories: CategoryRevenue[] = [...catAcc.entries()]
    .filter(([, c]) => c.revenue > 0)
    .map(([id, c]) => ({ categoryId: id, name: labelUpper(c.name || `Tipo ${id}`), revenue: c.revenue, items: c.items }))
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "pt-BR"));
  const catCmp = [...catAcc.values()].reduce((s, c) => s + c.revenueCmp, 0);
  const catPrev = [...catAcc.values()].reduce((s, c) => s + c.revenuePrev, 0);
  const deltaCategories = catCmp > 0 && catPrev > 0 ? kpiDelta(catCmp, catPrev, vsCmp) : undefined;

  // CMV por produto (RELATORIOMARGEM)  -  loja x dia x COD_PRODUTO.
  const costKey = (storeId: string, day: string, code: string) => `${storeId}|${day}|${code}`;
  const costs = new Map<string, number>();
  for (const r of input.productCostDayAggs ?? []) {
    if (!storeById.has(r.storeId) || !inCurrent(r.day)) continue;
    const k = costKey(r.storeId, r.day, r.productCode.trim());
    costs.set(k, (costs.get(k) ?? 0) + r.cmvCents / 100);
  }
  const salesMargin = productDaySaleMap((input.productCostDayAggs ?? []).filter((r) => storeById.has(r.storeId)));
  const salesUsed = new Set<string>();

  type ProdAcc = {
    name: string;
    nameDay: string;
    revenue: number;
    items: number;
    cmv: number;
    withoutCost: boolean;
    revenueCmp: number;
    revenuePrev: number;
  };
  const prodAcc = new Map<string, ProdAcc>();
  const costsUsed = new Set<string>();
  for (const r of input.productDayAggs ?? []) {
    if (!storeById.has(r.storeId)) continue;
    const code = r.productCode.trim();
    const key = code || `#${r.productId}`;
    const acc = prodAcc.get(key) ?? {
      name: "",
      nameDay: "",
      revenue: 0,
      items: 0,
      cmv: 0,
      withoutCost: false,
      revenueCmp: 0,
      revenuePrev: 0,
    };
    if (r.productName && r.day >= acc.nameDay) {
      acc.name = r.productName;
      acc.nameDay = r.day;
    }
    const v = productDaySaleBrl(r, salesMargin, salesUsed);
    if (v == null) {
      prodAcc.set(key, acc);
      continue;
    }
    if (inCurrent(r.day)) {
      acc.revenue += v;
      acc.items += r.itemCount;
      if (v > 0) {
        const k = costKey(r.storeId, r.day, code);
        const cmv = code ? costs.get(k) : undefined;
        if (cmv == null) acc.withoutCost = true;
        else if (!costsUsed.has(k)) {
          costsUsed.add(k);
          acc.cmv += cmv;
        }
      }
    }
    if (inCurrentCmp(r.day)) acc.revenueCmp += v;
    if (inPrevCmp(r.day)) acc.revenuePrev += v;
    prodAcc.set(key, acc);
  }

  const totalProducts = [...prodAcc.values()].reduce((s, p) => s + p.revenue, 0);
  const products: ProductItemRow[] = [...prodAcc.entries()]
    .filter(([, p]) => p.revenue > 0)
    .map(([key, p]) => {
      const cmv = p.withoutCost ? null : p.cmv;
      const profit = cmv == null ? null : p.revenue - cmv;
      return {
        rowKey: key,
        code: key.startsWith("#") ? "" : key,
        name: labelUpper(p.name || key),
        revenue: p.revenue,
        items: p.items,
        priceAverage: divSeguro(p.revenue, p.items),
        participationPct: divSeguro(p.revenue, totalProducts) * 100,
        cmv,
        profit,
        marginPct: profit == null ? null : divSeguro(profit, p.revenue) * 100,
        variationPct: p.revenuePrev > 0 && p.revenueCmp > 0 ? ((p.revenueCmp - p.revenuePrev) / p.revenuePrev) * 100 : null,
        revenueCmp: p.revenueCmp,
        revenuePrev: p.revenuePrev,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "pt-BR"));

  // Linhas de produto: fragrancia da descricao (catalogo = nome estavel da linha).
  const lineIndex = buildProductLineIndex([
    ...(input.catalogDescriptions ?? []),
    ...[...prodAcc.values()].map((p) => p.name).filter(Boolean),
  ]);
  type LineAcc = {
    revenue: number;
    items: number;
    products: number;
    profit: number;
    withoutCost: boolean;
    revenueCmp: number;
    revenuePrev: number;
    kinds: Map<string, number>;
    rowKeys: string[];
  };
  const lineAcc = new Map<string, LineAcc>();
  let withoutLineRevenue = 0;
  for (const [rowKey, p] of prodAcc) {
    const l = p.name ? lineIndex.lineOf(p.name) : null;
    if (!l) {
      withoutLineRevenue += p.revenue;
      continue;
    }
    const acc = lineAcc.get(l.line) ?? {
      revenue: 0,
      items: 0,
      products: 0,
      profit: 0,
      withoutCost: false,
      revenueCmp: 0,
      revenuePrev: 0,
      kinds: new Map<string, number>(),
      rowKeys: [],
    };
    acc.rowKeys.push(rowKey);
    acc.revenueCmp += p.revenueCmp;
    acc.revenuePrev += p.revenuePrev;
    if (p.revenue > 0) {
      acc.revenue += p.revenue;
      acc.items += p.items;
      acc.products += 1;
      acc.kinds.set(l.kind, (acc.kinds.get(l.kind) ?? 0) + p.revenue);
      if (p.withoutCost) acc.withoutCost = true;
      else acc.profit += p.revenue - p.cmv;
    }
    lineAcc.set(l.line, acc);
  }
  const lines: ProductLineRow[] = [...lineAcc.entries()]
    .filter(([, l]) => l.revenue > 0)
    .map(([name, l]) => ({
      name,
      revenue: l.revenue,
      items: l.items,
      products: l.products,
      kinds: [...l.kinds.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
      participationPct: divSeguro(l.revenue, totalProducts) * 100,
      profit: l.withoutCost ? null : l.profit,
      marginPct: l.withoutCost ? null : divSeguro(l.profit, l.revenue) * 100,
      variationPct: l.revenuePrev > 0 && l.revenueCmp > 0 ? ((l.revenueCmp - l.revenuePrev) / l.revenuePrev) * 100 : null,
      revenueCmp: l.revenueCmp,
      revenuePrev: l.revenuePrev,
      rowKeys: l.rowKeys,
    }))
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "pt-BR"));

  return {
    scope: esc,
    period,
    kpis,
    kpisWpink: fin.kpisWpink,
    hasSales: (fin.periodRevenue ?? 0) > 0,
    categories,
    deltaCategories,
    curveAbcCategories: classifyAbcCurve(categories),
    products,
    lines,
    withoutLineRevenue,
    hasCostProduct: products.some((p) => p.cmv != null),
    vsVariation: vsCmp,
    productsWithoutCost: (fin.productsWithoutCost ?? []).map((p) => ({
      ...p,
      name: p.name || prodAcc.get(p.code)?.name || "",
    })),
  };
}

export interface ProductDetailStore {
  storeId: string;
  name: string;
  revenue: number;
  items: number;
  /** Fatia do faturamento do produto no escopo (0 - 100). */
  pct: number;
}

export interface ProductDetailItem {
  rowKey: string;
  code: string;
  name: string;
  revenue: number;
  items: number;
  /** Fatia do faturamento da linha (0 - 100). */
  pct: number;
  /** null = algum dia com venda do produto sem custo (nada estimado). */
  profit: number | null;
  marginPct: number | null;
}

export interface ProductDetailCategory {
  categoryId: number;
  name: string;
  items: number;
  revenue: number;
  profit: number | null;
  marginPct: number | null;
  /** Participacao no faturamento de todas as categorias (0 - 100). */
  pct: number;
  pctAccumulated: number;
}

export interface ProductDetail {
  kind: "product" | "line" | "category" | "class";
  /** Produto = `ProductItemRow.chave`; linha = nome; categoria = id; classe = A/B/C. */
  rowKey: string;
  code: string;
  name: string;
  revenue: number;
  items: number;
  priceAverage: number;
  participationPct: number;
  cmv: number | null;
  profit: number | null;
  marginPct: number | null;
  /** Faturamento/itens por dia (2 - 31 dias) ou por mes (> 31); null em 1 dia (sem dado por hora). */
  series: { label: string; detail?: string; revenue: number; items: number }[] | null;
  seriesGranularity: "day" | "month";
  /** So com mais de 1 loja no escopo. */
  storeRows: ProductDetailStore[];
  /** Mesmo recorte da coluna Variacao (periodo terminando hoje = ate ontem nos dois lados). */
  comparison: {
    vs: string;
    revenue?: ReturnType<typeof kpiDelta>;
    items?: ReturnType<typeof kpiDelta>;
    margin?: ReturnType<typeof kpiDeltaPp>;
  } | null;
  /** Linha: produtos vendidos no periodo (maior faturamento primeiro). Produto: vazio. */
  products: ProductDetailItem[];
  /** Linha: tipos vendidos (desodorante colonia, body splash...). */
  kinds: string[];
  /** Classe da Curva ABC: categorias da classe. */
  categories: ProductDetailCategory[];
  /** Categoria: classe dela na Curva ABC. */
  productClass?: AbcClass;
}

type ItemsDetail = Omit<ProductDetail, "kind" | "rowKey" | "code" | "name" | "participationPct" | "kinds" | "categories" | "productClass">;

/** Mesma chave do `buildProductsView`: `COD_PRODUTO` ou `#productId`. */
const productRowKey = (r: { productCode: string; productId: number }) => r.productCode.trim() || `#${r.productId}`;

/** Detalhe de um conjunto de produtos — mesmas regras de custo do `buildProductsView`. */
function buildItemsDetail(
  scope: Scope,
  input: ProductsAggInput,
  rowKeys: Set<string>,
  opts: { marginByProduct?: boolean } = {},
): ItemsDetail {
  const marginByProduct = opts.marginByProduct ?? true;
  const esc: Scope = { ...scope, division: null };
  const period = resolvePeriod(esc.period, calendarTodayIso());
  const storeById = new Map(storesInScope(esc).map((f) => [f.id, f]));

  const prev = previousPeriod(period, calendarCurrentHour());
  const cutsAtToday = prev.hourMax != null;
  const endCmp = cutsAtToday ? addDays(period.end, -1) : period.end;
  const prevEndCmp = cutsAtToday ? addDays(prev.end, -1) : prev.end;
  const vsCmp = cutsAtToday ? `${prev.label}, até o mesmo dia` : prev.label;
  const inCurrent = (d: string) => d >= period.start && d <= period.end;
  const inCurrentCmp = (d: string) => d >= period.start && d <= endCmp;
  const inPrevCmp = (d: string) => d >= prev.start && d <= prevEndCmp;

  const lines = (input.productDayAggs ?? []).filter((r) => storeById.has(r.storeId) && rowKeys.has(productRowKey(r)));

  const costKey = (storeId: string, day: string, code: string) => `${storeId}|${day}|${code}`;
  const costs = new Map<string, number>();
  for (const r of input.productCostDayAggs ?? []) {
    const code = r.productCode.trim();
    if (!storeById.has(r.storeId) || !code || !rowKeys.has(code)) continue;
    const k = costKey(r.storeId, r.day, code);
    costs.set(k, (costs.get(k) ?? 0) + r.cmvCents / 100);
  }
  const salesMargin = productDaySaleMap(
    (input.productCostDayAggs ?? []).filter((r) => storeById.has(r.storeId) && rowKeys.has(r.productCode.trim())),
  );

  const acumular = (no: (d: string) => boolean, rowKey?: string) => {
    let revenue = 0;
    let items = 0;
    let cmv = 0;
    let withoutCost = false;
    const used = new Set<string>();
    const salesUsed = new Set<string>();
    for (const r of lines) {
      if (!no(r.day) || (rowKey != null && productRowKey(r) !== rowKey)) continue;
      const v = productDaySaleBrl(r, salesMargin, salesUsed);
      if (v == null) continue;
      revenue += v;
      items += r.itemCount;
      const code = r.productCode.trim();
      if (v > 0) {
        const k = costKey(r.storeId, r.day, code);
        const c = code ? costs.get(k) : undefined;
        if (c == null) withoutCost = true;
        else if (!used.has(k)) {
          used.add(k);
          cmv += c;
        }
      }
    }
    const profit = withoutCost ? null : revenue - cmv;
    return {
      revenue,
      items,
      cmv: withoutCost ? null : cmv,
      profit,
      marginPct: profit == null || revenue <= 0 ? null : divSeguro(profit, revenue) * 100,
    };
  };

  const current = acumular(inCurrent);

  let series: ProductDetail["series"] = null;
  const days = eachDay(period.start, period.end);
  const seriesGranularity: ProductDetail["seriesGranularity"] = days.length > 31 ? "month" : "day";
  if (days.length > 1) {
    const byDay = new Map<string, { revenue: number; items: number }>();
    const salesUsed = new Set<string>();
    for (const r of lines) {
      if (!inCurrent(r.day)) continue;
      const v = productDaySaleBrl(r, salesMargin, salesUsed);
      if (v == null) continue;
      const k = seriesGranularity === "month" ? r.day.slice(0, 7) : r.day;
      const acc = byDay.get(k) ?? { revenue: 0, items: 0 };
      acc.revenue += v;
      acc.items += r.itemCount;
      byDay.set(k, acc);
    }
    const eixo = seriesGranularity === "month" ? [...new Set(days.map((d) => d.slice(0, 7)))] : days;
    const variosAnos = period.start.slice(0, 4) !== period.end.slice(0, 4);
    series = eixo.map((k) => ({
      label:
        seriesGranularity === "month"
          ? `${shortMonth(`${k}-01`)}${variosAnos ? `/${k.slice(2, 4)}` : ""}`
          : dayAxisLabel(k, period),
      ...(seriesGranularity === "day" ? { detail: dayPointDetail(k) } : {}),
      revenue: byDay.get(k)?.revenue ?? 0,
      items: byDay.get(k)?.items ?? 0,
    }));
  }

  let storeRows: ProductDetailStore[] = [];
  if (storeById.size > 1) {
    const byStore = new Map<string, { revenue: number; items: number }>();
    const salesUsed = new Set<string>();
    for (const r of lines) {
      if (!inCurrent(r.day)) continue;
      const v = productDaySaleBrl(r, salesMargin, salesUsed);
      if (v == null) continue;
      const acc = byStore.get(r.storeId) ?? { revenue: 0, items: 0 };
      acc.revenue += v;
      acc.items += r.itemCount;
      byStore.set(r.storeId, acc);
    }
    storeRows = [...byStore.entries()]
      .filter(([, l]) => l.revenue > 0)
      .map(([id, l]) => ({
        storeId: id,
        name: storeById.get(id)!.tradeName,
        revenue: l.revenue,
        items: l.items,
        pct: divSeguro(l.revenue, current.revenue) * 100,
      }))
      .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "pt-BR"));
  }

  const byProduct = new Map<string, { name: string; nameDay: string; revenue: number; items: number }>();
  const salesUsed = new Set<string>();
  for (const r of lines) {
    const key = productRowKey(r);
    const acc = byProduct.get(key) ?? { name: "", nameDay: "", revenue: 0, items: 0 };
    if (r.productName && r.day >= acc.nameDay) {
      acc.name = r.productName;
      acc.nameDay = r.day;
    }
    if (inCurrent(r.day)) {
      const v = productDaySaleBrl(r, salesMargin, salesUsed);
      if (v == null) {
        byProduct.set(key, acc);
        continue;
      }
      acc.revenue += v;
      acc.items += r.itemCount;
    }
    byProduct.set(key, acc);
  }
  const products: ProductDetailItem[] = [...byProduct.entries()]
    .filter(([, p]) => p.revenue > 0)
    .map(([key, p]) => {
      const cost = marginByProduct ? acumular(inCurrent, key) : null;
      return {
        rowKey: key,
        code: key.startsWith("#") ? "" : key,
        name: labelUpper(p.name || key),
        revenue: p.revenue,
        items: p.items,
        pct: divSeguro(p.revenue, current.revenue) * 100,
        profit: cost?.profit ?? null,
        marginPct: cost?.marginPct ?? null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "pt-BR"));

  const cmpCurrent = acumular(inCurrentCmp);
  const cmpPrev = acumular(inPrevCmp);
  const comparison: ProductDetail["comparison"] =
    cmpCurrent.revenue > 0 && cmpPrev.revenue > 0
      ? {
          vs: vsCmp,
          revenue: kpiDelta(cmpCurrent.revenue, cmpPrev.revenue, vsCmp),
          items: kpiDelta(cmpCurrent.items, cmpPrev.items, vsCmp, "items"),
          margin:
            cmpCurrent.marginPct != null && cmpPrev.marginPct != null
              ? kpiDeltaPp(cmpCurrent.marginPct, cmpPrev.marginPct, vsCmp)
              : undefined,
        }
      : null;

  return {
    revenue: current.revenue,
    items: current.items,
    priceAverage: divSeguro(current.revenue, current.items),
    cmv: current.cmv,
    profit: current.profit,
    marginPct: current.marginPct,
    series,
    seriesGranularity,
    storeRows,
    comparison,
    products,
  };
}

/** Detalhe de 1 produto (chave da `ProductItemRow`). */
export function buildProductDetail(
  scope: Scope,
  input: ProductsAggInput,
  product: Pick<ProductItemRow, "rowKey" | "code" | "name" | "participationPct">,
): ProductDetail {
  const d = buildItemsDetail(scope, input, new Set([product.rowKey]));
  return {
    ...d,
    kind: "product",
    rowKey: product.rowKey,
    code: product.code,
    name: d.products[0]?.name ?? product.name,
    participationPct: product.participationPct,
    products: [],
    kinds: [],
    categories: [],
  };
}

/** Detalhe de uma linha de produto (fragrancia)  -  soma dos produtos dela + lista dos produtos. */
export function buildProductLineDetail(
  scope: Scope,
  input: ProductsAggInput,
  line: Pick<ProductLineRow, "name" | "rowKeys" | "kinds" | "participationPct">,
): ProductDetail {
  const d = buildItemsDetail(scope, input, new Set(line.rowKeys));
  return {
    ...d,
    kind: "line",
    rowKey: line.name,
    code: "",
    name: line.name,
    participationPct: line.participationPct,
    kinds: line.kinds,
    categories: [],
  };
}

/** Mesmo join da `sales_category_day_view`: produto fora do catalogo = INDEFINIDO. */
const CATEGORY_UNSET = -2000000000;

function productKeysByCategory(input: ProductsAggInput): Map<number, Set<string>> {
  const kinds = input.catalogTypes ?? {};
  const out = new Map<number, Set<string>>();
  for (const r of input.productDayAggs ?? []) {
    const cat = kinds[r.productId] ?? CATEGORY_UNSET;
    let set = out.get(cat);
    if (!set) {
      set = new Set();
      out.set(cat, set);
    }
    set.add(productRowKey(r));
  }
  return out;
}

/** Detalhe de uma categoria (tipo de produto)  -  soma dos produtos dela + lista dos produtos. */
export function buildCategoryDetail(
  scope: Scope,
  input: ProductsAggInput,
  category: Pick<AbcCategory, "categoryId" | "name" | "pct" | "productClass">,
): ProductDetail {
  const rowKeys = productKeysByCategory(input).get(category.categoryId) ?? new Set<string>();
  const d = buildItemsDetail(scope, input, rowKeys);
  return {
    ...d,
    kind: "category",
    rowKey: String(category.categoryId),
    code: "",
    name: category.name,
    participationPct: category.pct,
    kinds: [],
    categories: [],
    productClass: category.productClass,
  };
}

/** Detalhe de uma classe da Curva ABC  -  soma das categorias dela + lista das categorias. */
export function buildAbcClassDetail(
  scope: Scope,
  input: ProductsAggInput,
  view: Pick<ProductsView, "curveAbcCategories" | "categories">,
  productClass: AbcClass,
): ProductDetail {
  const byCategory = productKeysByCategory(input);
  const ofClass = view.curveAbcCategories.items.filter((i) => i.productClass === productClass);
  const rowKeys = new Set<string>();
  for (const c of ofClass) for (const k of byCategory.get(c.categoryId) ?? []) rowKeys.add(k);
  const d = buildItemsDetail(scope, input, rowKeys, { marginByProduct: false });
  const categories: ProductDetailCategory[] = ofClass.map((c) => {
    const det = buildItemsDetail(scope, input, byCategory.get(c.categoryId) ?? new Set<string>(), { marginByProduct: false });
    return {
      categoryId: c.categoryId,
      name: c.name,
      items: view.categories.find((x) => x.categoryId === c.categoryId)?.items ?? det.items,
      revenue: c.revenue,
      profit: det.profit,
      marginPct: det.marginPct,
      pct: c.pct,
      pctAccumulated: c.pctAccumulated,
    };
  });
  return {
    ...d,
    kind: "class",
    rowKey: productClass,
    code: "",
    name: `Classe ${productClass}`,
    participationPct: view.curveAbcCategories.summary.find((r) => r.productClass === productClass)?.pctRevenue ?? 0,
    products: [],
    kinds: [],
    categories,
  };
}

/**
 * Turno da pessoa (Configuracoes > Lojas): liga pelo codigo da funcionaria  ->  gerador  ->  nome,
 * na ordem das lojas recebida (maior venda primeiro). Rotulo "Manha  |  09:00 - 15:00".
 */
function sellerShiftResolver(shifts: import("./salesTypes").SellerShiftRef[] = []) {
  const byFunc = new Map<string, string>();
  const byGenerator = new Map<number, string>();
  const byName = new Map<string, string>();
  for (const s of shifts) {
    const label = `${s.name} · ${s.start}–${s.end}`;
    if (s.employeeId != null) byFunc.set(`${s.storeId}|${s.employeeId}`, label);
    if (s.generatorId != null) byGenerator.set(s.generatorId, label);
    for (const k of s.nameKeys) byName.set(`${s.storeId}|${k}`, label);
  }
  return (p: { employeeId: number | null; generatorId: number | null; sellerKeys: Set<string>; storeRows: string[] }): string | undefined => {
    for (const store of p.storeRows) {
      const f = p.employeeId != null ? byFunc.get(`${store}|${p.employeeId}`) : undefined;
      if (f) return f;
    }
    if (p.generatorId != null && byGenerator.has(p.generatorId)) return byGenerator.get(p.generatorId);
    for (const store of p.storeRows) {
      for (const k of p.sellerKeys) {
        const n = byName.get(`${store}|${k}`);
        if (n) return n;
      }
    }
    return undefined;
  };
}

/** Foto da pessoa: codigo da funcionaria, gerador, depois nome. Sem foto = iniciais no avatar. */
function sellerAvatarResolver(avatars: import("./salesTypes").SellerAvatarRef[] = []) {
  const byFunc = new Map<number, string>();
  const byGenerator = new Map<number, string>();
  const byName = new Map<string, string>();
  for (const a of avatars) {
    if (a.employeeId != null) byFunc.set(a.employeeId, a.avatarUrl);
    if (a.generatorId != null) byGenerator.set(a.generatorId, a.avatarUrl);
    for (const k of a.nameKeys) byName.set(`${a.storeId}|${k}`, a.avatarUrl);
  }
  return (p: { employeeId: number | null; generatorId: number | null; sellerKeys: Set<string>; storeRows: string[] }): string | undefined => {
    if (p.employeeId != null && byFunc.has(p.employeeId)) return byFunc.get(p.employeeId);
    if (p.generatorId != null && byGenerator.has(p.generatorId)) return byGenerator.get(p.generatorId);
    for (const store of p.storeRows) {
      for (const k of p.sellerKeys) {
        const n = byName.get(`${store}|${k}`);
        if (n) return n;
      }
    }
    return undefined;
  };
}

/* ================================================================
 * TELA EQUIPE  -  camada de dados (agregados reais do sync)
 * ================================================================ */

export interface TeamKpi {
  label: string;
  amount: string;
  sub?: string;
  delta?: { value: string; positive: boolean; vs?: string; diff?: string; previous?: string };
  tooltip?: string;
}

export interface TeamMemberRow {
  key: string;
  name: string;
  /** Lojas onde vendeu no periodo, da que mais faturou para a que menos. */
  storeIds: string[];
  storeRows: string[];
  /** "Manha  |  09:00 - 15:00"; ausente = sem turno definido. */
  shift?: string;
  revenue: number;
  sales: number;
  items: number;
  averageTicket: number;
  /** Itens por venda; null se algum dia com venda nao tem itens gravados (nada estimado). */
  pa: number | null;
  participationPct: number;
  /** Faturamento vs periodo anterior (sem hora: terminando hoje, ate ontem nos dois lados). */
  variationPct: number | null;
  /** Lados da variacao  -  o Total da tabela soma e compara ponderado. */
  revenueCmp: number;
  revenuePrev: number;
}

export interface TeamShiftSlice {
  name: string;
  revenue: number;
  people: number;
}

export interface TeamDashboardView {
  scope: Scope;
  period: ResolvedPeriod;
  /** KPIs e tabela ja filtrados pelo turno escolhido. */
  kpis: TeamKpi[];
  people: TeamMemberRow[];
  /** Toda a equipe (sem filtro de turno). Maior faturamento primeiro; "Sem turno definido" sempre por ultimo. */
  shifts: TeamShiftSlice[];
  /** Alguma pessoa das lojas do escopo tem turno cadastrado. */
  shiftsConfigured: boolean;
  /** Opcoes do filtro de turno (nome do turno; "Sem turno definido" se alguem vendeu sem turno). */
  availableShifts: string[];
  /** Turno aplicado (null = todos; valor fora das opcoes vira null). */
  shiftFilter: string | null;
  /** Faturamento das lojas = equipe + sem vendedor + usuário da filial + gerência. `turno` = parte da equipe no turno filtrado. */
  composition: {
    team: number;
    /** Soma do que ficou fora da equipe. */
    excluded: number;
    unidentified: number;
    branchUser: number;
    management: number;
    total: number;
    shift?: number;
  };
  vsVariation: string;
  /** Mais de 1 loja no escopo  ->  mostra a loja de cada pessoa. */
  multiStore: boolean;
}

export type TeamAggInput = {
  dayAggs: import("./salesTypes").SalesDayAgg[];
  sellerDayAggs?: import("./salesTypes").SalesSellerDayAgg[];
  /** Vendas com nome, para separar sem vendedor, usuário da filial e gerência. */
  namedSellerDayAggs?: import("./salesTypes").SalesSellerDayAgg[];
  origins?: import("./engine/salesOrigin").SalesOriginIndex;
  sellerShifts?: import("./salesTypes").SellerShiftRef[];
};

export const TEAM_WITHOUT_SHIFT = "Sem grupo definido";

/** Nome do turno a partir do rotulo "Manha  |  09:00 - 15:00" (sem turno = TEAM_SEM_TURNO). */
export function teamShiftName(shift?: string): string {
  return shift ? (shift.split(" · ")[0] ?? shift) : TEAM_WITHOUT_SHIFT;
}

/**
 * Equipe a partir dos agregados do sync (sales_seller_day_agg, sem gerencia / conta de freelancer).
 * Sem dado por hora: periodo terminando hoje compara ate ontem nos dois lados; em "Hoje" fica sem badge.
 * `opts.turno` filtra KPIs e tabela pelo nome do turno (turno atual da pessoa vale tambem para o periodo anterior).
 */
export function buildTeamDashboardView(
  scope: Scope,
  input: TeamAggInput = { dayAggs: [] },
  opts: { shift?: string | null } = {},
): TeamDashboardView {
  const esc: Scope = { ...scope, division: null };
  const period = resolvePeriod(esc.period, calendarTodayIso());
  const fs = storesInScope(esc);
  const storeIds = new Set(fs.map((f) => f.id));
  const storeName = new Map(fs.map((f) => [f.id, f.tradeName]));

  const prev = previousPeriod(period, calendarCurrentHour());
  const cutsAtToday = prev.hourMax != null;
  const endCmp = cutsAtToday ? addDays(period.end, -1) : period.end;
  const prevEndCmp = cutsAtToday ? addDays(prev.end, -1) : prev.end;
  const vsCmp = cutsAtToday ? `${prev.label}, até o mesmo dia` : prev.label;
  const inCurrent = (d: string) => d >= period.start && d <= period.end;
  const inCurrentCmp = (d: string) => d >= period.start && d <= endCmp;
  const inPrevCmp = (d: string) => d >= prev.start && d <= prevEndCmp;

  type Total = { revenue: number; sales: number; items: number; withoutItems: boolean };
  const newTotal = (): Total => ({ revenue: 0, sales: 0, items: 0, withoutItems: false });
  const sum = (t: Total, r: { revenue: number; sales: number; items: number; withoutItems: boolean }) => {
    t.revenue += r.revenue;
    t.sales += r.sales;
    t.items += r.items;
    if (r.withoutItems) t.withoutItems = true;
  };
  const line = (r: import("./salesTypes").SalesSellerDayAgg) => ({
    revenue: r.revenueCents / 100,
    sales: r.salesCount,
    items: r.itemCount ?? 0,
    withoutItems: r.salesCount > 0 && !(r.itemCount && r.itemCount > 0),
  });

  type Acc = {
    name: string;
    nameDay: string;
    current: Total;
    cmp: Total;
    prev: Total;
    revenueByStore: Map<string, number>;
    employeeId: number | null;
    generatorId: number | null;
    sellerKeys: Set<string>;
  };
  const acc = new Map<string, Acc>();
  for (const r of input.sellerDayAggs ?? []) {
    if (!storeIds.has(r.storeId)) continue;
    const key = r.sellerEmployeeId != null ? `e:${r.sellerEmployeeId}` : `n:${r.sellerKey}`;
    const a = acc.get(key) ?? {
      name: r.sellerName,
      nameDay: r.day,
      current: newTotal(),
      cmp: newTotal(),
      prev: newTotal(),
      revenueByStore: new Map<string, number>(),
      employeeId: r.sellerEmployeeId ?? null,
      generatorId: null,
      sellerKeys: new Set<string>(),
    };
    a.sellerKeys.add(r.sellerKey);
    if (r.sellerGeneratorId != null) a.generatorId = r.sellerGeneratorId;
    if (r.day > a.nameDay) {
      a.name = r.sellerName;
      a.nameDay = r.day;
    }
    const l = line(r);
    if (inCurrent(r.day)) {
      sum(a.current, l);
      a.revenueByStore.set(r.storeId, (a.revenueByStore.get(r.storeId) ?? 0) + r.revenueCents);
    }
    if (inCurrentCmp(r.day)) sum(a.cmp, l);
    if (inPrevCmp(r.day)) sum(a.prev, l);
    acc.set(key, a);
  }

  const shiftOf = sellerShiftResolver(input.sellerShifts);
  const all = [...acc.entries()].map(([key, a]) => {
    const storeIdList = [...a.revenueByStore.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
    const shift = shiftOf({
      employeeId: a.employeeId,
      generatorId: a.generatorId,
      sellerKeys: a.sellerKeys,
      // Sem venda no periodo (so no anterior): liga pelo codigo/nome em qualquer loja do escopo.
      storeRows: storeIdList.length > 0 ? storeIdList : [...storeIds],
    });
    return { key, a, storeIdList, shift };
  });
  const withSale = all.filter(({ a }) => a.current.revenue > 0 || a.current.sales > 0);

  // Opcoes do filtro: turnos cadastrados nas lojas do escopo (ordem de inicio) + "Sem turno definido".
  const startByName = new Map<string, string>();
  for (const s of input.sellerShifts ?? []) {
    if (!storeIds.has(s.storeId)) continue;
    const current = startByName.get(s.name);
    if (current == null || s.start < current) startByName.set(s.name, s.start);
  }
  const availableShifts = [...startByName.entries()]
    .sort((x, y) => x[1].localeCompare(y[1]) || x[0].localeCompare(y[0], "pt-BR"))
    .map(([name]) => name);
  if (availableShifts.length > 0 && withSale.some((p) => !p.shift)) availableShifts.push(TEAM_WITHOUT_SHIFT);
  const shiftFilter = opts.shift && availableShifts.includes(opts.shift) ? opts.shift : null;
  const inFilter = (shift?: string) => !shiftFilter || teamShiftName(shift) === shiftFilter;

  const filtradas = all.filter((p) => inFilter(p.shift));
  const totalCurrent = newTotal();
  const totalCmp = newTotal();
  const totalPrev = newTotal();
  for (const { a } of filtradas) {
    sum(totalCurrent, a.current);
    sum(totalCmp, a.cmp);
    sum(totalPrev, a.prev);
  }

  const people: TeamMemberRow[] = filtradas
    .filter(({ a }) => a.current.revenue > 0 || a.current.sales > 0)
    .map(({ key, a, storeIdList, shift }) => ({
      key,
      name: a.name,
      storeIds: storeIdList,
      storeRows: storeIdList.map((id) => storeName.get(id)).filter((n): n is string => Boolean(n)),
      shift,
      revenue: a.current.revenue,
      sales: a.current.sales,
      items: a.current.items,
      averageTicket: divSeguro(a.current.revenue, a.current.sales),
      pa: a.current.withoutItems || a.current.sales === 0 ? null : a.current.items / a.current.sales,
      participationPct: divSeguro(a.current.revenue, totalCurrent.revenue) * 100,
      variationPct: a.prev.revenue > 0 && a.cmp.revenue > 0 ? ((a.cmp.revenue - a.prev.revenue) / a.prev.revenue) * 100 : null,
      revenueCmp: a.cmp.revenue,
      revenuePrev: a.prev.revenue,
    }))
    .sort((x, y) => y.revenue - x.revenue || x.name.localeCompare(y.name, "pt-BR"));

  // Turnos (toda a equipe): soma por rotulo; sem turno por ultimo.
  const byShift = new Map<string, TeamShiftSlice>();
  let teamTotal = 0;
  for (const { a, shift } of withSale) {
    teamTotal += a.current.revenue;
    const name = shift ?? TEAM_WITHOUT_SHIFT;
    const s = byShift.get(name) ?? { name, revenue: 0, people: 0 };
    s.revenue += a.current.revenue;
    s.people += 1;
    byShift.set(name, s);
  }
  const shifts = [...byShift.values()]
    .filter((s) => s.revenue > 0)
    .sort((a, b) => {
      if (a.name === TEAM_WITHOUT_SHIFT) return 1;
      if (b.name === TEAM_WITHOUT_SHIFT) return -1;
      return b.revenue - a.revenue;
    });
  const shiftsConfigured = (input.sellerShifts ?? []).some((s) => storeIds.has(s.storeId));

  const storeCount = input.dayAggs
    .filter((r) => r.brand === "ALL" && storeIds.has(r.storeId) && inCurrent(r.day))
    .reduce((s, r) => s + r.revenueCents / 100, 0);
  let branchUser = 0;
  let management = 0;
  if (input.namedSellerDayAggs && input.origins) {
    for (const r of input.namedSellerDayAggs) {
      if (!storeIds.has(r.storeId) || !inCurrent(r.day)) continue;
      const origin = sellerOrigin(r, input.origins);
      if (origin === "branchUser") branchUser += r.revenueCents / 100;
      else if (origin === "management") management += r.revenueCents / 100;
    }
  }
  const attributed = teamTotal + branchUser + management;
  // Soma em reais perde fração de centavo. Abaixo de 1 centavo não é venda sem vendedor.
  const unidentified = Math.max(0, Math.round((storeCount - attributed) * 100) / 100);
  const excluded = unidentified + branchUser + management;

  // Comparativos: so com venda no periodo atual (nunca 100%) e dado nos dois lados.
  const comparavel = totalCurrent.revenue > 0 && totalCmp.sales > 0 && totalPrev.sales > 0;
  const ticketCmp = divSeguro(totalCmp.revenue, totalCmp.sales);
  const ticketPrev = divSeguro(totalPrev.revenue, totalPrev.sales);
  const n = people.length;
  const ticket = divSeguro(totalCurrent.revenue, totalCurrent.sales);
  const pa = totalCurrent.withoutItems || totalCurrent.sales === 0 ? null : totalCurrent.items / totalCurrent.sales;
  const paComparavel = comparavel && !totalCmp.withoutItems && !totalPrev.withoutItems;

  const kpis: TeamKpi[] = [
    {
      label: "Faturamento da equipe",
      amount: brlCent(totalCurrent.revenue),
      sub: n > 0 ? `${n} ${n === 1 ? "pessoa" : "pessoas"} · média de ${brlCent(totalCurrent.revenue / n)}` : undefined,
      delta: comparavel ? kpiDelta(totalCmp.revenue, totalPrev.revenue, vsCmp) : undefined,
      tooltip: "Faturamento das vendas atribuídas à equipe. Não inclui vendas sem vendedor identificado, do usuário da filial ou realizadas pela gerência.",
    },
    {
      label: "Nº de vendas",
      amount: num(totalCurrent.sales),
      sub: totalCurrent.sales > 0 && !totalCurrent.withoutItems ? `${num(totalCurrent.items)} itens vendidos` : undefined,
      delta: comparavel ? kpiDelta(totalCmp.sales, totalPrev.sales, vsCmp, "sales") : undefined,
    },
    {
      label: "Ticket médio",
      amount: brlCent(ticket),
      delta: comparavel ? kpiDelta(ticketCmp, ticketPrev, vsCmp) : undefined,
    },
    {
      label: "P.A.",
      amount: pa == null ? (totalCurrent.sales > 0 ? "—" : num(0, 2)) : num(pa, 2),
      sub: "Itens por venda",
      delta: paComparavel ? kpiDelta(totalCmp.items / totalCmp.sales, totalPrev.items / totalPrev.sales, vsCmp, "pa") : undefined,
      tooltip: pa == null && totalCurrent.sales > 0 ? "O P.A. não está disponível para este período." : undefined,
    },
  ];

  return {
    scope: esc,
    period,
    kpis,
    people,
    shifts,
    shiftsConfigured,
    availableShifts,
    shiftFilter,
    composition: {
      team: teamTotal,
      excluded,
      unidentified,
      branchUser,
      management,
      total: teamTotal + excluded,
      ...(shiftFilter ? { shift: totalCurrent.revenue } : {}),
    },
    vsVariation: vsCmp,
    multiStore: fs.length > 1,
  };
}

export interface TeamMemberDetail extends TeamMemberRow {
  series: { label: string; detail?: string; revenue: number; sales: number }[] | null;
  seriesGranularity: "day" | "month";
  comparison: {
    vs: string;
    revenue?: TeamKpi["delta"];
    sales?: TeamKpi["delta"];
    ticket?: TeamKpi["delta"];
    pa?: TeamKpi["delta"];
  } | null;
}

/**
 * Detalhe de uma pessoa da equipe  -  mesma linha da tabela Desempenho da equipe (mesmo filtro de turno)
 * + faturamento dia a dia e comparativo sem hora (terminando hoje, ate ontem nos dois lados).
 */
export function buildTeamMemberDetail(
  scope: Scope,
  input: TeamAggInput,
  key: string,
  opts: {
    shift?: string | null;
    /** Parte do rateio da venda sem vendedor, por dia. */
    extraByDay?: Map<string, { revenue: number; sales: number; items: number; missing?: boolean }>;
    /** Dia de meta Geral: fica fora do detalhe, como no ranking. */
    omitDay?: (storeId: string, day: string) => boolean;
    fallbackName?: string;
  } = {},
): TeamMemberDetail | null {
  const view = buildTeamDashboardView(scope, input, opts);
  const found = view.people.find((p) => p.key === key);
  const extraByDay = opts.extraByDay ?? new Map();
  if (!found && extraByDay.size === 0) return null;
  const row: TeamMemberRow = found ?? {
    key,
    name: opts.fallbackName ?? key,
    storeIds: [],
    storeRows: [],
    revenue: 0,
    sales: 0,
    items: 0,
    averageTicket: 0,
    pa: null,
    participationPct: 0,
    variationPct: null,
    revenueCmp: 0,
    revenuePrev: 0,
  };

  const period = view.period;
  const fs = storesInScope(view.scope);
  const storeName = new Map(fs.map((f) => [f.id, f.tradeName]));
  const prev = previousPeriod(period, calendarCurrentHour());
  const cutsAtToday = prev.hourMax != null;
  const endCmp = cutsAtToday ? addDays(period.end, -1) : period.end;
  const prevEndCmp = cutsAtToday ? addDays(prev.end, -1) : prev.end;
  const vsCmp = cutsAtToday ? `${prev.label}, até o mesmo dia` : prev.label;
  const inCurrent = (d: string) => d >= period.start && d <= period.end;
  const inCurrentCmp = (d: string) => d >= period.start && d <= endCmp;
  const inPrevCmp = (d: string) => d >= prev.start && d <= prevEndCmp;

  const lines = (input.sellerDayAggs ?? []).filter(
    (r) => storeName.has(r.storeId) && (r.sellerEmployeeId != null ? `e:${r.sellerEmployeeId}` : `n:${r.sellerKey}`) === key && !opts.omitDay?.(r.storeId, r.day),
  );

  type Total = { revenue: number; sales: number; items: number; withoutItems: boolean };
  const sum = (no: (d: string) => boolean): Total => {
    const t: Total = { revenue: 0, sales: 0, items: 0, withoutItems: false };
    for (const r of lines) {
      if (!no(r.day)) continue;
      t.revenue += r.revenueCents / 100;
      t.sales += r.salesCount;
      t.items += r.itemCount ?? 0;
      if (r.salesCount > 0 && !(r.itemCount && r.itemCount > 0)) t.withoutItems = true;
    }
    for (const [day, bit] of extraByDay) {
      if (!no(day)) continue;
      t.revenue += bit.revenue;
      t.sales += bit.sales;
      t.items += bit.items;
      if (bit.missing || (bit.sales > 0 && bit.items <= 0)) t.withoutItems = true;
    }
    return t;
  };
  const currentT = sum(inCurrent);
  if (!found && currentT.revenue <= 0 && currentT.sales <= 0) return null;
  const shown: TeamMemberRow = {
    ...row,
    revenue: currentT.revenue,
    sales: currentT.sales,
    items: currentT.items,
    averageTicket: currentT.sales > 0 ? currentT.revenue / currentT.sales : 0,
    pa: currentT.withoutItems || currentT.sales === 0 ? null : currentT.items / currentT.sales,
  };
  const cmp = sum(inCurrentCmp);
  const prevT = sum(inPrevCmp);
  const comparavel = shown.revenue > 0 && cmp.sales > 0 && prevT.sales > 0;
  const paComparavel = comparavel && !cmp.withoutItems && !prevT.withoutItems;
  const comparison: TeamMemberDetail["comparison"] = comparavel
    ? {
        vs: vsCmp,
        revenue: kpiDelta(cmp.revenue, prevT.revenue, vsCmp),
        sales: kpiDelta(cmp.sales, prevT.sales, vsCmp, "sales"),
        ticket: kpiDelta(divSeguro(cmp.revenue, cmp.sales), divSeguro(prevT.revenue, prevT.sales), vsCmp),
        pa: paComparavel ? kpiDelta(cmp.items / cmp.sales, prevT.items / prevT.sales, vsCmp, "pa") : undefined,
      }
    : null;

  let series: TeamMemberDetail["series"] = null;
  const days = eachDay(period.start, period.end);
  const seriesGranularity: TeamMemberDetail["seriesGranularity"] = days.length > 31 ? "month" : "day";
  if (days.length > 1) {
    const byDay = new Map<string, { revenue: number; sales: number }>();
    for (const r of lines) {
      if (!inCurrent(r.day)) continue;
      const k = seriesGranularity === "month" ? r.day.slice(0, 7) : r.day;
      const acc = byDay.get(k) ?? { revenue: 0, sales: 0 };
      acc.revenue += r.revenueCents / 100;
      acc.sales += r.salesCount;
      byDay.set(k, acc);
    }
    for (const [day, bit] of extraByDay) {
      if (!inCurrent(day)) continue;
      const k = seriesGranularity === "month" ? day.slice(0, 7) : day;
      const acc = byDay.get(k) ?? { revenue: 0, sales: 0 };
      acc.revenue += bit.revenue;
      acc.sales += bit.sales;
      byDay.set(k, acc);
    }
    const eixo = seriesGranularity === "month" ? [...new Set(days.map((d) => d.slice(0, 7)))] : days;
    const variosAnos = period.start.slice(0, 4) !== period.end.slice(0, 4);
    series = eixo.map((k) => ({
      label: seriesGranularity === "month" ? `${shortMonth(`${k}-01`)}${variosAnos ? `/${k.slice(2, 4)}` : ""}` : dayAxisLabel(k, period),
      ...(seriesGranularity === "day" ? { detail: dayPointDetail(k) } : {}),
      revenue: byDay.get(k)?.revenue ?? 0,
      sales: byDay.get(k)?.sales ?? 0,
    }));
  }

  return { ...shown, series, seriesGranularity, comparison };
}

/* ================================================================
 * TELA VISAO GERAL  -  camada de dados (montarVisaoGeralView)
 * ================================================================ */

import { collaboratorsOfStore } from "./team";

export interface OverviewKpi {
  label: string;
  amount: string;
  sub?: string;
  /** @deprecated Prefer `kpisWpink` strip  -  kept optional for compat. */
  subWpink?: string;
  delta?: { value: string; positive: boolean; vs?: string };
  series?: number[];
  tooltip?: string;
  drillTo?: string;
}

/** Quick stats WPINK (estilo Sales overview / Ao vivo)  -  so quando a loja tem WPINK. */
export interface OverviewKpiWpink {
  label: string;
  amount: string;
  sub?: string;
  tooltip?: string;
  tint: "acc" | "ok" | "warn" | "info";
  delta?: { value: string; positive: boolean; vs?: string; diff?: string; previous?: string };
}

export interface GoalGauge {
  name: string;
  pct: number;
  target: number;
  achieved: number;
}

export interface CategoryVsGoal {
  category: string;
  /** Reservado p/ meta por categoria (CRUD Metas). Hoje sempre 0 neste card. */
  goal: number;
  achieved: number;
}

export interface DayVsGoal {
  day: string;
  goal: number;
  achieved: number;
}

export interface EvolutionPoint {
  label: string;
  achieved: number;
  goal: number;
  projection: number | null;
  /** Ponto-ancora R$ 0 na abertura (eixo hora "acumulado ate")  -  fora do modo por periodo. */
  anchor?: boolean;
  /** Hora de hoje que ainda nao chegou: so a meta (o realizado para em "Agora"). */
  future?: boolean;
  /** Tooltip do ponto: faixa da hora ("21h as 22h") ou dia ("11/10 seg"). */
  band?: string;
}

export interface TopItem {
  name: string;
  amount: number;
}

export interface TopSeller extends TopItem {
  /** Mesma chave do `TeamMemberRow.key`  -  abre o detalhe da pessoa. */
  key?: string;
  sub?: string;
  /** Nº de vendas no periodo. */
  sales?: number;
  averageTicket?: number;
  goalPct?: number;
  /** Itens por venda; ausente se algum dia com venda nao tem itens gravados (nada estimado). */
  pa?: number;
  /** Lojas onde vendeu no periodo, da que mais faturou para a que menos. */
  storeRows: string[];
  /** Turno cadastrado em Configuracoes > Lojas ("Manha  |  09:00 - 15:00"); ausente = sem turno. */
  shift?: string;
  /** Foto de perfil da conta WDash; ausente = iniciais no avatar. */
  avatarUrl?: string;
  /** Nivel na meta (Gestao > Metas) do inicio dela ate hoje; ausente = pessoa sem meta. */
  goal?: import("./goalView").SellerGoalLevel;
}

export interface OverviewView {
  scope: Scope;
  period: ResolvedPeriod;
  kpis: OverviewKpi[];
  /**
   * Faixa compacta WPINK (quick stats). Vazia se nenhuma loja do escopo tem WPINK.
   */
  kpisWpink: OverviewKpiWpink[];
  gauges: GoalGauge[];
  remainingToGoal: string | null;
  projectionClosing: string | null;
  /** Qual meta o card Atingimento mostra (nome + datas, ou soma de N lojas). */
  goalDescription?: string | null;
  /** Delta do faturamento vs periodo anterior (badge dos cards de grafico). */
  revenueDelta?: { value: string; positive: boolean; vs?: string };
  /** Soma das categorias vs periodo anterior (card Faturamento por categoria). */
  deltaCategories?: { value: string; positive: boolean; vs?: string; previous?: string };
  seriesAxis: SeriesAxis;
  seriesLabel: string;
  categoryVsGoal: CategoryVsGoal[];
  /** Vazio quando periodo = 1 dia (card oculto na UI). */
  dayVsMeta: DayVsGoal[];
  evolution: EvolutionPoint[];
  paymentMethods: PaymentMethodRevenue[];
  /** Ranking completo (maior faturamento primeiro). A tela escolhe a metrica e corta o Top N. */
  topSellers: TopSeller[];
  /** Ranking completo (maior faturamento primeiro)  -  a tela escolhe a metrica e corta o Top N.
   *  `chave` = mesma do `ProductItemRow` (abre o detalhe do produto). */
  /** `lucro`: null = algum dia com venda sem custo gravado; ausente = fixture. */
  topProducts: (TopItem & { rowKey?: string; sub?: string; items?: number; category?: string; trend?: number; profit?: number | null; revenuePrev?: number })[];
  storesRanking: (TopItem & { id?: string; goalPct?: number; pctNetwork?: number; trend?: number })[];
  /** Faturamento da rede no periodo (badge do Ranking  -  independente do StorePicker). */
  rankingNetworkTotal?: number;
  /** Com 1 loja no StorePicker: quantas outras lojas venderam no periodo (fatia "Demais lojas"). */
  otherStoresRanking?: number;
  /** True when KPIs come from sales_*_agg (possibly empty). */
  fromAggregates?: boolean;
}

export type OverviewAggInput = {
  dayAggs: import("./salesTypes").SalesDayAgg[];
  hourAggs?: import("./salesTypes").SalesHourAgg[];
  categoryDayAggs?: import("./salesTypes").SalesCategoryDayAgg[];
  /** Tipos ja vistos no sync (historico)  -  barras com R$ 0 no periodo. */
  categoryCatalog?: import("./salesTypes").SalesCategoryRef[];
  /** Formas de pagamento (CONDICAO)  -  brand=ALL. */
  paymentDayAggs?: import("./salesTypes").SalesPaymentDayAgg[];
  /** Ranking vendedoras (VENDEDOR_MILLENNIUM)  -  brand=ALL. */
  sellerDayAggs?: import("./salesTypes").SalesSellerDayAgg[];
  /** Turno de cada funcionaria (store_seller.shift_id)  -  popover do Destaques da equipe. */
  sellerShifts?: import("./salesTypes").SellerShiftRef[];
  /** Foto de perfil de quem tem conta WDash (codigo, gerador ou nome). */
  sellerAvatars?: import("./salesTypes").SellerAvatarRef[];
  /**
   * Filiais do ranking. Quando vem preenchido, o card só usa essas lojas,
   * mesmo com a rede inteira nos agregados e com uma loja no seletor.
   */
  rankingStoreIds?: string[];
  /** Top produtos ({E7A5C5C7})  -  brand=ALL. Pode incluir dias do periodo anterior p/ variacao. */
  productDayAggs?: import("./salesTypes").SalesProductDayAgg[];
  /** CMV por produto do periodo (RELATORIOMARGEM)  -  lucro bruto do Top produtos. */
  productCostDayAggs?: import("./salesTypes").SalesProductCostDayAgg[];
  /** Historico antes do periodo (curva da meta por dia da semana)  -  `goalHistoryDayRange`. */
  goalHistoryDayAggs?: import("./salesTypes").SalesDayAgg[];
  /** Mesmo dia da semana nas semanas anteriores (curva da meta por hora)  -  `goalHistorySameWeekdays`. */
  goalHistoryHourAggs?: import("./salesTypes").SalesHourAgg[];
  /** Periodo anterior (`previousPeriod`)  -  badges de comparativo dos KPIs e cards. */
  prevDayAggs?: import("./salesTypes").SalesDayAgg[];
  /** Periodo = hoje: horas do mesmo dia da semana passada (comparativo ate a hora atual). */
  prevHourAggs?: import("./salesTypes").SalesHourAgg[];
  /** Metas (Gestao > Metas) das lojas que cruzam o periodo. */
  goals?: import("./goalsRepo").GoalRecord[];
  /** Faturamento ALL do inicio das metas ate hoje, mais as 6 semanas anteriores (peso da projecao). O card ignora o filtro. */
  goalDayAggs?: import("./salesTypes").SalesDayAgg[];
  /** Vendas por pessoa do inicio das metas ate hoje (secao Meta do detalhe da pessoa). */
  goalSellerDayAggs?: import("./salesTypes").SalesSellerDayAgg[];
  /** As mesmas vendas, com usuário da filial e gerência, para o rateio. */
  goalNamedSellerDayAggs?: import("./salesTypes").SalesSellerDayAgg[];
  /** Equipe das lojas com meta (grupo de cada pessoa na meta). */
  goalTeam?: import("./goalsRepo").GoalTeamMember[];
};

/** Prefere linhas brand=ALL; sem ALL, soma WEPINK+WPINK. */
/**
 * Linhas WPINK do periodo. Dia so com receita (relatorio de marca sem DetMov) deixa
 * CMV / n de vendas incompletos  -  nada e estimado; a UI mostra " - " e sem badge.
 */
function wpinkRows<R extends import("./salesTypes").SalesDayAgg>(
  rows: R[],
  /** `loja|dia` com o relatorio de margem gravado  -  CMV 0 ali e custo R$ 0 no ERP, nao falta de dado. */
  costDays?: ReadonlySet<string>,
): { rows: R[]; cmvIncomplete: boolean; salesIncomplete: boolean } {
  const out = rows.filter((r) => r.brand === "WPINK");
  const withSale = out.filter((r) => r.revenueCents > 0);
  return {
    rows: out,
    cmvIncomplete: withSale.some((r) => !r.cmvCents && !costDays?.has(`${r.storeId}|${r.day}`)),
    salesIncomplete: withSale.some((r) => r.salesCount <= 0),
  };
}

/** Totais WPINK; `null` = dado incompleto em algum dia com venda WPINK (nada e estimado). */
type WpinkTotals = { revenue: number; cmv: number | null; sales: number | null; items: number | null };

type WpinkScope = { has(storeId: string): boolean; get?(storeId: string): Store | undefined };

function wpinkTotals(
  rows: import("./salesTypes").SalesDayAgg[],
  inScope: WpinkScope,
  from: string,
  to: string,
  costDays?: ReadonlySet<string>,
): WpinkTotals {
  const w = wpinkRows(rows.filter((d) => inScope.has(d.storeId) && d.day >= from && d.day <= to), costDays);
  const s = w.rows.reduce(
    (acc, d) => ({
      rev: acc.rev + d.revenueCents,
      cmv: acc.cmv + (d.cmvCents ?? 0),
      sales: acc.sales + d.salesCount,
      items: acc.items + d.itemCount,
    }),
    { rev: 0, cmv: 0, sales: 0, items: 0 },
  );
  return {
    revenue: s.rev / 100,
    cmv: w.cmvIncomplete ? null : s.cmv / 100,
    sales: w.salesIncomplete ? null : s.sales,
    items: w.salesIncomplete ? null : s.items,
  };
}

/**
 * WPINK do periodo anterior. Com `horaMax`, o ultimo dia (`fim`) entra pelas horas WPINK ate a hora
 * atual e os demais inteiros (sem CMV por hora  ->  CMV null). Loja com venda WPINK nesse dia sem
 * horas gravadas  ->  null (sem comparativo).
 */
function wpinkPrevTotals(
  dayRows: import("./salesTypes").SalesDayAgg[],
  hourRows: import("./salesTypes").SalesHourAgg[],
  inScope: { has(storeId: string): boolean },
  prev: { start: string; end: string; hourMax?: number },
): WpinkTotals | null {
  if (prev.hourMax == null) return wpinkTotals(dayRows, inScope, prev.start, prev.end);
  const hourMax = prev.hourMax;
  const ofDay = hourRows.filter((h) => h.brand === "WPINK" && inScope.has(h.storeId) && h.day === prev.end);
  const storesWithHour = new Set(ofDay.map((h) => h.storeId));
  const gapHour = dayRows.some(
    (d) => d.brand === "WPINK" && inScope.has(d.storeId) && d.day === prev.end && d.revenueCents > 0 && !storesWithHour.has(d.storeId),
  );
  if (gapHour) return null;
  const hrs = ofDay.filter((h) => h.hour <= hourMax);
  const cheios = wpinkTotals(dayRows, inScope, prev.start, addDays(prev.end, -1));
  const salesHour = hrs.reduce((s, h) => s + h.salesCount, 0);
  const itemsHour = hrs.reduce((s, h) => s + h.itemCount, 0);
  return {
    revenue: cheios.revenue + hrs.reduce((s, h) => s + h.revenueCents, 0) / 100,
    cmv: null,
    sales: cheios.sales == null ? null : cheios.sales + salesHour,
    items: cheios.items == null ? null : cheios.items + itemsHour,
  };
}

/** Faixa WPINK do Financeiro: Faturamento  |  CMV  |  Lucro bruto  |  Margem (+ badge vs periodo anterior). */
function buildFinanceWpinkKpis(p: {
  show: boolean;
  current: WpinkTotals;
  previous: WpinkTotals | null;
  revenueTotal: number;
  vsLabel: string;
  /** Base dos badges de CMV/lucro/margem (terminando hoje = sem o dia de hoje nos dois lados). */
  cmvCompare: { current: WpinkTotals; previous: WpinkTotals; vsLabel: string };
}): OverviewKpiWpink[] {
  if (!p.show) return [];
  const { current, previous } = p;
  const hasComp = previous != null && previous.revenue > 0 && current.revenue > 0;
  const vs = hasComp ? p.vsLabel : undefined;
  const cmv = current.cmv != null && current.revenue > 0 ? current.cmv : null;
  const profit = cmv != null ? current.revenue - cmv : 0;
  const margin = divSeguro(profit, current.revenue) * 100;
  const c = p.cmvCompare;
  const cmvA = c.current.cmv != null && c.current.cmv > 0 && c.current.revenue > 0 ? c.current.cmv : null;
  const cmvB = c.previous.cmv != null && c.previous.cmv > 0 && c.previous.revenue > 0 ? c.previous.cmv : null;
  const cmvComp = hasComp && cmv != null && cmvA != null && cmvB != null;
  const profitA = cmvA != null ? c.current.revenue - cmvA : 0;
  const profitB = cmvB != null ? c.previous.revenue - cmvB : 0;
  const marginA = divSeguro(profitA, c.current.revenue) * 100;
  const marginB = divSeguro(profitB, c.previous.revenue) * 100;
  return [
    {
      label: "Faturamento WPINK",
      amount: brlCent(current.revenue),
      sub: p.revenueTotal > 0 ? `${Math.round((current.revenue / p.revenueTotal) * 100)}% do faturamento` : undefined,
      tint: "acc",
      delta: hasComp ? kpiDelta(current.revenue, previous.revenue, vs) : undefined,
    },
    {
      label: "CMV WPINK",
      amount: cmv != null ? brlCent(cmv) : "—",
      sub: cmv != null && current.revenue > 0 ? `${Math.round((cmv / current.revenue) * 100)}% do faturamento WPINK` : undefined,
      tooltip: cmv != null ? TIP_CMV_WPINK : TIP_CMV_WPINK_INDISPONIVEL,
      tint: "acc",
      delta: cmvComp ? kpiDelta(cmvA, cmvB, c.vsLabel) : undefined,
    },
    {
      label: "Lucro bruto WPINK",
      amount: cmv != null ? brlCent(profit) : "—",
      tooltip: TIP_PROFIT_GROSS_WPINK,
      tint: "acc",
      delta: cmvComp ? kpiDelta(profitA, profitB, c.vsLabel) : undefined,
    },
    {
      label: "Margem WPINK",
      amount: cmv != null ? pct(margin) : "—",
      tooltip: TIP_MARGIN_WPINK,
      tint: "acc",
      delta: cmvComp ? kpiDeltaPp(marginA, marginB, c.vsLabel) : undefined,
    },
  ];
}

function preferAllBrand<T extends { brand: string }>(rows: T[]): T[] {
  const all = rows.filter((r) => r.brand === "ALL");
  return all.length > 0 ? all : rows.filter((r) => r.brand !== "ALL");
}

/** Overview from real sales aggregates  -  CMV/top produtos stay empty until heavy sync. */
export function buildOverviewViewFromAggs(scope: Scope, input: OverviewAggInput): OverviewView {
  const period = resolvePeriod(scope.period, calendarTodayIso());
  const seriesAxis = seriesAxisForPeriod(period);
  const seriesLabel = seriesAxisLabel(period, seriesAxis);
  // Overview: sempre total (ALL). WPINK na faixa quick stats (se loja tem a marca).
  const brand = null;
  const fs = storesInScope(scope);
  const scopedStoreIds = new Set(fs.map((f) => f.id));

  function byBrand(rows: typeof input.dayAggs) {
    if (brand) return rows.filter((d) => d.brand === brand);
    const all = rows.filter((d) => d.brand === "ALL");
    return all.length > 0 ? all : rows.filter((d) => d.brand === "WEPINK" || d.brand === "WPINK");
  }

  // Rede (todas as lojas do fetch)  -  ranking / badge / % participacao.
  const daysNetwork = byBrand(input.dayAggs);
  // Escopo do StorePicker  -  KPIs / graficos.
  let days =
    scope.storeIds.length > 0
      ? daysNetwork.filter((d) => scopedStoreIds.has(d.storeId))
      : daysNetwork;

  const hoursRaw = (input.hourAggs ?? []).filter((h) => {
    if (scope.storeIds.length > 0 && !scopedStoreIds.has(h.storeId)) return false;
    if (brand) return h.brand === brand;
    const hourPool = input.hourAggs ?? [];
    if (hourPool.some((x) => x.brand === "ALL")) return h.brand === "ALL";
    return h.brand === "WEPINK" || h.brand === "WPINK" || h.brand === "ALL";
  });

  const sumDays = (rows: typeof days) =>
    rows.reduce(
      (acc, r) => {
        acc.revenueCents += r.revenueCents;
        acc.salesCount += r.salesCount;
        acc.itemCount += r.itemCount;
        return acc;
      },
      { revenueCents: 0, salesCount: 0, itemCount: 0 },
    );

  const currentAgg = sumDays(days);

  /**
   * Sem horaxmarca (FORCE sem DetMov ainda): rateia horas ALL pelo share
   * marca/ALL de cada loja  -  mantem o grafico Faturamento x meta no filtro WPINK/WEPINK.
   */
  let hours = hoursRaw;
  if (brand && hours.length === 0 && currentAgg.revenueCents > 0) {
    const scaled: typeof hoursRaw = [];
    const storeIdsForBrand = new Set(
      input.dayAggs
        .filter((d) => {
          if (d.brand !== brand || d.revenueCents <= 0) return false;
          if (scope.storeIds.length > 0 && !scopedStoreIds.has(d.storeId)) return false;
          return true;
        })
        .map((d) => d.storeId),
    );
    for (const storeId of storeIdsForBrand) {
      const brandCents = input.dayAggs
        .filter((d) => d.storeId === storeId && d.brand === brand)
        .reduce((s, d) => s + d.revenueCents, 0);
      const allCents = input.dayAggs
        .filter((d) => d.storeId === storeId && d.brand === "ALL")
        .reduce((s, d) => s + d.revenueCents, 0);
      const share = allCents > 0 ? brandCents / allCents : 0;
      if (share <= 0) continue;
      for (const h of input.hourAggs ?? []) {
        if (h.storeId !== storeId || h.brand !== "ALL") continue;
        scaled.push({
          ...h,
          brand,
          revenueCents: Math.round(h.revenueCents * share),
          salesCount: Math.round(h.salesCount * share),
          itemCount: Math.round(h.itemCount * share),
        });
      }
    }
    hours = scaled;
  }

  const revenue = currentAgg.revenueCents / 100;
  let salesCount = currentAgg.salesCount;
  let items = currentAgg.itemCount;

  // Relatorio de marca grava so receita (counts=0). Ate o proximo FORCE/SEED
  // com counts preenchidos, deriva de horas ou rateia do ALL.
  if (brand && salesCount === 0 && currentAgg.revenueCents > 0) {
    const fromHours = hours.reduce(
      (acc, h) => {
        acc.salesCount += h.salesCount;
        acc.itemCount += h.itemCount;
        return acc;
      },
      { salesCount: 0, itemCount: 0 },
    );
    if (fromHours.salesCount > 0) {
      salesCount = fromHours.salesCount;
      items = fromHours.itemCount;
    } else {
      const allDays = input.dayAggs.filter((d) => {
        if (d.brand !== "ALL") return false;
        if (scope.storeIds.length > 0 && !scopedStoreIds.has(d.storeId)) return false;
        return true;
      });
      const allSum = sumDays(allDays);
      if (allSum.salesCount > 0 && allSum.revenueCents > 0) {
        const otherBrandRev = input.dayAggs
          .filter((d) => {
            if (scope.storeIds.length > 0 && !scopedStoreIds.has(d.storeId)) return false;
            return (d.brand === "WEPINK" || d.brand === "WPINK") && d.brand !== brand;
          })
          .reduce((s, d) => s + d.revenueCents, 0);
        if (otherBrandRev <= 0) {
          salesCount = allSum.salesCount;
          items = allSum.itemCount;
        } else {
          const share = currentAgg.revenueCents / allSum.revenueCents;
          salesCount = Math.max(0, Math.round(allSum.salesCount * share));
          items = Math.max(0, Math.round(allSum.itemCount * share));
        }
      }
    }
  }

  const ticket = salesCount > 0 ? revenue / salesCount : 0;

  // Quick stats WPINK  -  so se alguma loja do escopo tem a marca.
  const showWpinkStrip = fs.some((f) => f.hasWpink);
  const wpink = wpinkRows(
    input.dayAggs.filter((d) => {
      if (scope.storeIds.length > 0 && !scopedStoreIds.has(d.storeId)) return false;
      return d.day >= period.start && d.day <= period.end;
    }),
  );
  const wpinkSum = wpink.rows.reduce(
    (acc, d) => {
      acc.revenueCents += d.revenueCents;
      acc.cmvCents += d.cmvCents ?? 0;
      acc.salesCount += d.salesCount;
      acc.itemCount += d.itemCount;
      return acc;
    },
    { revenueCents: 0, cmvCents: 0, salesCount: 0, itemCount: 0 },
  );
  const wpinkRevenue = wpinkSum.revenueCents / 100;
  // CMV WPINK so quando todos os dias com venda WPINK tem CMV (senao soma parcial engana).
  const wpinkCmv = wpink.cmvIncomplete ? 0 : wpinkSum.cmvCents / 100;
  const wpinkSales = wpink.salesIncomplete ? 0 : wpinkSum.salesCount;
  const wpinkItems = wpink.salesIncomplete ? 0 : wpinkSum.itemCount;
  const wpinkTicket = wpinkSales > 0 ? wpinkRevenue / wpinkSales : 0;
  const cmvTotalCents = days.reduce((s, d) => s + (d.cmvCents ?? 0), 0);
  const tipCmv = cmvTotalCents <= 0 ? TIP_CMV_INDISPONIVEL : TIP_CMV;
  const tipCmvWpink = wpinkCmv <= 0 ? TIP_CMV_INDISPONIVEL : TIP_CMV;
  const kpisWpink: OverviewKpiWpink[] = showWpinkStrip
    ? [
        {
          label: "Faturamento WPINK",
          amount: brlCent(wpinkRevenue),
          sub: revenue > 0 ? `${Math.round((wpinkRevenue / revenue) * 100)}% do faturamento` : undefined,
          tint: "acc",
        },
        {
          label: "CMV WPINK",
          amount: wpinkCmv > 0 ? brlCent(wpinkCmv) : "—",
          sub:
            wpinkCmv > 0 && wpinkRevenue > 0
              ? `${Math.round((wpinkCmv / wpinkRevenue) * 100)}% do faturamento`
              : undefined,
          tooltip: tipCmvWpink,
          tint: "acc",
        },
        {
          label: "Nº de vendas WPINK",
          amount: wpink.salesIncomplete ? "—" : num(wpinkSales),
          sub: wpink.salesIncomplete ? undefined : `${num(wpinkItems)} itens`,
          tint: "acc",
        },
        {
          label: "Ticket médio WPINK",
          amount: wpink.salesIncomplete ? "—" : brlCent(wpinkTicket),
          sub:
            wpinkSales > 0
              ? `P.A. ${num(divSeguro(wpinkItems, wpinkSales), 2)}`
              : undefined,
          tint: "acc",
        },
      ]
    : [];

  // Metas (Gestao > Metas): meta de cada loja num dia = a meta que cobre o dia, distribuida pelos dias dela.
  const todayIso = calendarTodayIso();
  const goals = (input.goals ?? []).filter((g) => scopedStoreIds.has(g.storeId));
  const goalOn = (storeId: string, iso: string) =>
    goals.find((g) => g.storeId === storeId && g.startsOn <= iso && iso <= g.endsOn);
  const goalsInPeriod = goals
    .filter((g) => g.startsOn <= period.end && g.endsOn >= period.start)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const storesWithGoal = new Set(goalsInPeriod.map((g) => g.storeId)).size;
  const goalDescription =
    goalsInPeriod.length === 0
      ? null
      : fs.length > 1
        ? storesWithGoal < fs.length
          ? `${storesWithGoal} de ${fs.length} filiais com meta`
          : `Metas de ${storesWithGoal} filiais`
        : goalsInPeriod.length === 1
          ? `${goalsInPeriod[0]!.name} · ${shortDate(goalsInPeriod[0]!.startsOn)} a ${shortDate(goalsInPeriod[0]!.endsOn)}`
          : `${goalsInPeriod.length} metas consideradas`;

  const byDay = new Map<string, number>();
  for (const d of days) {
    byDay.set(d.day, (byDay.get(d.day) ?? 0) + d.revenueCents / 100);
  }
  const seriesRevenue = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)
    .slice(-7);

  // Comparativo: periodo anterior equivalente. Terminando hoje, o ultimo dia do anterior entra ate a hora atual.
  const prevBase = previousPeriod(period, calendarCurrentHour());
  const prevHourMax = prevBase.hourMax;
  const inScope = (storeId: string) => scope.storeIds.length === 0 || scopedStoreIds.has(storeId);
  const prevDays = preferAllBrand(
    (input.prevDayAggs ?? []).filter((d) => inScope(d.storeId) && d.day >= prevBase.start && d.day <= prevBase.end),
  );
  const sumPrev = (rows: typeof prevDays) =>
    rows.reduce(
      (acc, d) => ({
        revenueCents: acc.revenueCents + d.revenueCents,
        cmvCents: acc.cmvCents + (d.cmvCents ?? 0),
        sales: acc.sales + d.salesCount,
        items: acc.items + d.itemCount,
      }),
      { revenueCents: 0, cmvCents: 0, sales: 0, items: 0 },
    );
  let previous: { revenueCents: number; cmvCents: number; sales: number; items: number } | null = null;
  if (prevHourMax == null) {
    previous = sumPrev(prevDays);
  } else {
    const prevHours = preferAllBrand(
      (input.prevHourAggs ?? []).filter((h) => inScope(h.storeId) && h.day === prevBase.end),
    );
    const storesWithHour = new Set(prevHours.map((h) => h.storeId));
    // Loja que vendeu no dia equivalente sem horas gravadas  ->  sem comparativo (nunca dia cheio x parcial).
    const gapHour = prevDays.some((d) => d.day === prevBase.end && d.revenueCents > 0 && !storesWithHour.has(d.storeId));
    if (!gapHour) {
      previous = sumPrev(prevDays.filter((d) => d.day < prevBase.end));
      for (const h of prevHours) {
        if (h.hour > prevHourMax) continue;
        previous.revenueCents += h.revenueCents;
        previous.sales += h.salesCount;
        previous.items += h.itemCount;
      }
    }
  }
  // Sem venda no periodo atual (ex.: hoje antes do Atualizar) nao e queda de 100%  -  e falta de dado.
  const hasComp = previous != null && previous.revenueCents > 0 && revenue > 0;
  const vsLabel = hasComp ? prevBase.label : undefined;
  const prevRevenue = (previous?.revenueCents ?? 0) / 100;
  const prevSales = previous?.sales ?? 0;
  const prevTicket = prevSales > 0 ? prevRevenue / prevSales : 0;
  const revenueDelta = hasComp ? kpiDelta(revenue, prevRevenue, vsLabel) : undefined;

  // CMV nao existe por hora: terminando hoje, compara sem o dia de hoje nos dois lados.
  const cutsAtToday = prevHourMax != null;
  const vsCmv = cutsAtToday ? `${prevBase.label}, até o mesmo dia` : prevBase.label;
  const cmvCurrentCmp = (cutsAtToday ? days.filter((d) => d.day < period.end) : days).reduce((s, d) => s + (d.cmvCents ?? 0), 0) / 100;
  const cmvPrevCmp = sumPrev(cutsAtToday ? prevDays.filter((d) => d.day < prevBase.end) : prevDays).cmvCents / 100;
  const deltaCmv = cmvTotalCents > 0 && cmvCurrentCmp > 0 && cmvPrevCmp > 0 ? kpiDelta(cmvCurrentCmp, cmvPrevCmp, vsCmv) : undefined;

  // Faixa WPINK: mesmo periodo anterior (ultimo dia = horas WPINK ate a hora atual; sem horas  ->  sem badge).
  const prevW = kpisWpink.length > 0
    ? wpinkPrevTotals(input.prevDayAggs ?? [], input.prevHourAggs ?? [], { has: inScope }, prevBase)
    : null;
  if (prevW && prevW.revenue > 0 && wpinkRevenue > 0) {
    const vsW = prevBase.label;
    const prevWTicket = prevW.sales != null && prevW.sales > 0 ? prevW.revenue / prevW.sales : 0;
    const [kRevenue, , kSales, kTicket] = kpisWpink;
    if (kRevenue) kRevenue.delta = kpiDelta(wpinkRevenue, prevW.revenue, vsW);
    if (kSales && !wpink.salesIncomplete && prevW.sales != null && prevW.sales > 0) {
      kSales.delta = kpiDelta(wpinkSales, prevW.sales, vsW, "sales");
    }
    if (kTicket && wpinkTicket > 0 && prevWTicket > 0) kTicket.delta = kpiDelta(wpinkTicket, prevWTicket, vsW);
  }
  const kCmvW = kpisWpink[1];
  if (kCmvW && wpinkCmv > 0) {
    const scopeW = { has: inScope };
    const endCurrent = cutsAtToday ? addDays(period.end, -1) : period.end;
    const endPrev = cutsAtToday ? addDays(prevBase.end, -1) : prevBase.end;
    const cmvW = wpinkTotals(input.dayAggs, scopeW, period.start, endCurrent).cmv;
    const cmvWPrev = wpinkTotals(input.prevDayAggs ?? [], scopeW, prevBase.start, endPrev).cmv;
    if (cmvW != null && cmvW > 0 && cmvWPrev != null && cmvWPrev > 0) kCmvW.delta = kpiDelta(cmvW, cmvWPrev, vsCmv);
  }

  const kpis: OverviewKpi[] = [
    {
      label: "Faturamento",
      amount: brlCent(revenue),
      delta: revenueDelta,
      series: seriesRevenue,
    },
    {
      label: "CMV",
      amount: (() => {
        if (cmvTotalCents <= 0) return "—";
        return brlCent(cmvTotalCents / 100);
      })(),
      sub: (() => {
        if (cmvTotalCents <= 0) return undefined;
        const cmv = cmvTotalCents / 100;
        const pctCmv = revenue > 0 ? (cmv / revenue) * 100 : 0;
        return `${pctCmv.toFixed(0)}% do faturamento`;
      })(),
      delta: deltaCmv,
      tooltip: tipCmv,
    },
    {
      label: "Nº de vendas",
      amount: num(salesCount),
      sub: `${num(items)} itens vendidos`,
      delta: hasComp ? kpiDelta(salesCount, prevSales, vsLabel, "sales") : undefined,
    },
    {
      label: "Ticket médio",
      amount: brlCent(ticket),
      sub: salesCount > 0 ? `P.A. ${num(divSeguro(items, salesCount), 2)}` : undefined,
      delta: hasComp && ticket > 0 ? kpiDelta(ticket, prevTicket, vsLabel) : undefined,
    },
  ];

  // Curva da meta: meta de cada loja  ->  dia (peso do dia da semana nas datas da meta)  ->  hora (peso da hora).
  const histDayByStore = new Map<string, Map<string, number>>();
  for (const r of preferAllBrand(input.goalHistoryDayAggs ?? [])) {
    const m = histDayByStore.get(r.storeId) ?? new Map<string, number>();
    m.set(r.day, (m.get(r.day) ?? 0) + r.revenueCents / 100);
    histDayByStore.set(r.storeId, m);
  }
  const weekdayWeightsByStore = new Map(
    fs.map((f) => [f.id, weekdayWeights(histDayByStore.get(f.id) ?? new Map(), effectiveWeekHours(f.hours))]),
  );
  const storeGoalDay = (f: Store, iso: string) => {
    const g = goalOn(f.id, iso);
    return g ? periodDailyGoal(g.target, g.startsOn, g.endsOn, iso, weekdayWeightsByStore.get(f.id) ?? []) : 0;
  };

  // Card Atingimento = metas inteiras que cruzam o filtro (ex.: 01/09 a 30/09), com o vendido do inicio de cada
  // meta ate hoje  -  independente do filtro. O dia contra a meta do dia fica no Faturamento x meta.
  const soldByStoreDay = new Map<string, number>();
  for (const d of preferAllBrand(input.goalDayAggs ?? [])) {
    const k = `${d.storeId}|${d.day}`;
    soldByStoreDay.set(k, (soldByStoreDay.get(k) ?? 0) + d.revenueCents / 100);
  }
  let metaTotal = 0;
  let achievedMeta = 0;
  let projected = 0;
  let projectionComplete = true;
  const goalDayRows = preferAllBrand(input.goalDayAggs ?? []);
  for (const g of goalsInPeriod) {
    metaTotal += g.target;
    if (g.startsOn > todayIso) continue;
    let achieved = 0;
    for (const iso of eachDay(g.startsOn, g.endsOn < todayIso ? g.endsOn : todayIso)) {
      achieved += soldByStoreDay.get(`${g.storeId}|${iso}`) ?? 0;
    }
    achievedMeta += achieved;
    if (g.endsOn < todayIso) projected += achieved;
    else {
      // Mesma conta do detalhe da meta: dias fechados x peso do dia da semana, historico antes do inicio.
      const store = fs.find((f) => f.id === g.storeId);
      const closing = goalStoreClosing(
        g,
        goalDayRows.filter((d) => d.storeId === g.storeId),
        todayIso,
        effectiveWeekHours(store?.hours ?? defaultWeekHours()),
      );
      if (closing) projected += closing.amount;
      else projectionComplete = false;
    }
  }
  const goalAttainment = metaTotal > 0 ? (achievedMeta / metaTotal) * 100 : 0;
  const missing = metaTotal > 0 ? Math.max(0, metaTotal - achievedMeta) : 0;
  let projectionClosing: string | null = null;
  if (goalsInPeriod.length > 0 && goalsInPeriod.every((g) => g.endsOn < todayIso)) projectionClosing = "Meta encerrada";
  else if (goalsInPeriod.some((g) => g.startsOn <= todayIso) && projectionComplete) projectionClosing = brlCent(projected);
  const gauges: GoalGauge[] =
    metaTotal > 0 ? [{ name: "Meta", pct: goalAttainment, target: metaTotal, achieved: achievedMeta }] : [];

  const evolution: EvolutionPoint[] = [];
  if (seriesAxis === "hour") {
    const byHour = new Map<number, number>();
    for (const h of hours) {
      byHour.set(h.hour, (byHour.get(h.hour) ?? 0) + h.revenueCents / 100);
    }
    const goalDow = isoToDate(period.start).getDay() as Dow;
    const histHourByStore = new Map<string, Map<number, number>>();
    for (const r of preferAllBrand(input.goalHistoryHourAggs ?? [])) {
      const m = histHourByStore.get(r.storeId) ?? new Map<number, number>();
      m.set(r.hour, (m.get(r.hour) ?? 0) + r.revenueCents / 100);
      histHourByStore.set(r.storeId, m);
    }
    const goalByHourMap = new Map<number, number>();
    for (const f of fs) {
      const dayGoal = storeGoalDay(f, period.start);
      if (dayGoal <= 0) continue;
      // Sem horario: curva pelas horas que venderam no historico; sem historico, 10h - 22h (so a meta).
      const hist = histHourByStore.get(f.id) ?? new Map<number, number>();
      let shares = hourShares(hist, f.hours, goalDow);
      if (shares.size === 0) shares = hourShares(hist, effectiveWeekHours(f.hours), goalDow);
      for (const [h, share] of shares) {
        goalByHourMap.set(h, (goalByHourMap.get(h) ?? 0) + dayGoal * share);
      }
    }
    // Eixo = expediente das lojas no dia (`hourAxisRange`); so lojas com venda no dia entram
    // (evita loja sem venda alargar o eixo). Dia inteiro: hoje, as horas que ainda nao chegaram mostram so a meta.
    const storesWithSales = new Set(
      [...days, ...hours].filter((r) => r.revenueCents > 0).map((r) => r.storeId),
    );
    const winStores = storesWithSales.size > 0 ? fs.filter((f) => storesWithSales.has(f.id)) : fs;
    const sold = [...byHour.entries()].filter(([, v]) => v > 0).map(([h]) => h);
    const nowH = calendarCurrentHour();
    const goalHours = [...goalByHourMap.entries()].filter(([, v]) => v > 0).map(([h]) => h);
    const { first, last } = hourAxisRange(
      (winStores.length > 0 ? winStores : fs).map((f) => f.hours),
      goalDow,
      sold,
      goalHours,
    );
    const axisHours: number[] = [];
    for (let h = first; h <= last; h++) axisHours.push(h);
    // Realizado do card = faturamento do dia. A curva segue as horas do expediente;
    // venda na hora 0 (cupom sem hora) nao entra na soma nem alarga o eixo.
    const dayBrl = byDay.get(period.start) ?? 0;
    let sumHours = 0;
    for (const h of axisHours) sumHours += byHour.get(h) ?? 0;
    const factorHour = dayBrl > 0 && sumHours > 0 ? dayBrl / sumHours : 1;
    // Meta de horas fora do eixo (loja sem venda com expediente mais largo) vai para as pontas.
    const goalOnAxis = (h: number) => {
      let v = goalByHourMap.get(h) ?? 0;
      for (const [mh, mv] of goalByHourMap) {
        if (h === first && mh < first) v += mv;
        if (h === last && mh > last) v += mv;
      }
      return v;
    };
    // Rotulo = inicio da faixa ("10h" = 10:00 - 10:59, hora local da loja); a ancora R$ 0 fica fora do grafico.
    evolution.push({ label: shortHour(first), achieved: 0, goal: 0, projection: null, anchor: true });
    let acum = 0;
    let acumM = 0;
    for (const h of axisHours) {
      let achievedH = (byHour.get(h) ?? 0) * factorHour;
      if (sumHours === 0 && dayBrl > 0 && h === first) achievedH = dayBrl;
      acum += achievedH;
      acumM += goalOnAxis(h);
      const emProgress = period.isToday && h === nowH;
      evolution.push({
        label: emProgress ? "Agora" : shortHour(h),
        band: hourSpan(h, emProgress),
        achieved: acum,
        goal: acumM,
        projection: null,
        ...(period.isToday && h > nowH ? { future: true } : {}),
      });
    }
  } else {
    let acum = 0;
    let acumM = 0;
    const periodDays = eachDay(period.start, period.end);
    const monthsLabel = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    const daily = seriesAxis === "day";
    for (const iso of periodDays) {
      acum += byDay.get(iso) ?? 0;
      acumM += fs.reduce((s, f) => s + storeGoalDay(f, iso), 0);
      const d = isoToDate(iso);
      evolution.push({
        label: daily ? dayAxisLabel(iso, period) : `${String(d.getDate()).padStart(2, "0")} ${monthsLabel[d.getMonth()]}`,
        ...(daily ? { band: dayPointDetail(iso) } : {}),
        achieved: acum,
        goal: acumM,
        projection: null,
      });
    }
  }

  const remainingToGoal = missing > 0 ? `Faltam ${brlCent(missing)} para atingir a meta` : metaTotal > 0 ? "Meta atingida" : null;

  // Faturamento por categoria  -  mix do periodo + catalogo historico (zeros).
  // Meta por categoria fica p/ CRUD de Metas; nao inventar Goal aqui.
  // O fetch inclui o periodo anterior: so o periodo atual vira barra; os dois lados
  // alimentam o badge, com o mesmo recorte da tela Produtos (hoje compara ate ontem).
  const prevCat = previousPeriod(period, calendarCurrentHour());
  const cutsCatToday = prevCat.hourMax != null;
  const endCatCmp = cutsCatToday ? addDays(period.end, -1) : period.end;
  const prevEndCatCmp = cutsCatToday ? addDays(prevCat.end, -1) : prevCat.end;
  const vsCat = cutsCatToday ? `${prevCat.label}, até o mesmo dia` : prevCat.label;
  let catCmp = 0;
  let catPrev = 0;
  const catAcc = new Map<string, { achieved: number }>();
  for (const ref of input.categoryCatalog ?? []) {
    if (brand && ref.brand !== brand && ref.brand !== "ALL") continue;
    const name = ref.categoryName || `Tipo ${ref.categoryId}`;
    if (!catAcc.has(labelUpper(name))) catAcc.set(labelUpper(name), { achieved: 0 });
  }
  for (const row of input.categoryDayAggs ?? []) {
    if (brand && row.brand !== brand && row.brand !== "ALL") continue;
    if (brand && row.brand === "ALL") continue;
    const v = row.revenueCents / 100;
    if (row.day >= period.start && row.day <= period.end) {
      const name = row.categoryName || `Tipo ${row.categoryId}`;
      const key = labelUpper(name);
      const cur = catAcc.get(key) ?? { achieved: 0 };
      cur.achieved += v;
      catAcc.set(key, cur);
    }
    if (row.day >= period.start && row.day <= endCatCmp) catCmp += v;
    if (row.day >= prevCat.start && row.day <= prevEndCatCmp) catPrev += v;
  }
  const deltaCategories = catCmp > 0 && catPrev > 0 ? kpiDelta(catCmp, catPrev, vsCat) : undefined;
  const categoryVsGoal: CategoryVsGoal[] = [...catAcc.entries()]
    .map(([category, c]) => ({
      category,
      achieved: c.achieved,
      goal: 0,
    }))
    .sort((a, b) => b.achieved - a.achieved || a.category.localeCompare(b.category, "pt-BR"));

  // Ranking de lojas. Sem lista fechada: totais da rede; 1 loja no seletor vira fatia da rede.
  // Com lista fechada (gerente): só essas filiais, nomeadas, mesmo com uma no seletor.
  const rankingOnly = input.rankingStoreIds ?? [];
  const rankingClosed = rankingOnly.length > 0;
  const rankingAllowed = rankingClosed ? new Set(rankingOnly) : null;
  const byStore = new Map<string, number>();
  for (const d of daysNetwork) {
    if (rankingAllowed && !rankingAllowed.has(d.storeId)) continue;
    byStore.set(d.storeId, (byStore.get(d.storeId) ?? 0) + d.revenueCents / 100);
  }
  const rankingNetworkTotal = [...byStore.values()].reduce((s, v) => s + v, 0);
  const catalog = productStores();
  const storesRanking: (TopItem & { id?: string; goalPct?: number; pctNetwork?: number; trend?: number })[] = [...byStore.entries()]
    .map(([id, amount]) => {
      const f = catalog.find((x) => x.id === id) ?? fs.find((x) => x.id === id);
      const periodGoal = f
        ? eachDay(period.start, period.end).reduce((s, iso) => s + storeGoalDay(f, iso), 0)
        : 0;
      return {
        id,
        name: labelUpper(f?.tradeName ?? id.slice(0, 8)),
        amount,
        goalPct: periodGoal > 0 ? (amount / periodGoal) * 100 : undefined,
        pctNetwork: rankingNetworkTotal > 0 ? (amount / rankingNetworkTotal) * 100 : undefined,
      };
    })
    .filter((row) => {
      if (row.amount <= 0) return false;
      if (rankingClosed) return rankingAllowed?.has(row.id ?? "") ?? false;
      if (scope.storeIds.length === 1) return row.id === scope.storeIds[0];
      return true;
    })
    .sort((a, b) => b.amount - a.amount);
  const otherStoresRanking =
    !rankingClosed && scope.storeIds.length === 1
      ? [...byStore.entries()].filter(([id, v]) => v > 0 && id !== scope.storeIds[0]).length
      : undefined;

  // Formas: sempre brand=ALL (Lista nao traz marca). Filtra so por loja/periodo.
  const totaisForma: Record<string, number> = {};
  for (const row of input.paymentDayAggs ?? []) {
    if (scope.storeIds.length > 0 && !scopedStoreIds.has(row.storeId)) continue;
    if (row.day < period.start || row.day > period.end) continue;
    if (row.revenueCents <= 0) continue;
    const forma = row.paymentMethod || "Outros";
    totaisForma[forma] = (totaisForma[forma] ?? 0) + row.revenueCents / 100;
  }
  const totalFormas = Object.values(totaisForma).reduce((s, v) => s + v, 0) || 1;
  const FORMAS_FALLBACK = ["var(--acc)", "var(--info)", "var(--ok)", "var(--warn)", "var(--t2)"];
  const paymentMethods: PaymentMethodRevenue[] = Object.entries(totaisForma)
    .sort((a, b) => b[1] - a[1])
    .map(([method, amount], i) => ({
      method,
      amount,
      pct: (amount / totalFormas) * 100,
      color: COLORS_FORMAS[method] ?? FORMAS_FALLBACK[i % FORMAS_FALLBACK.length]!,
    }));

  // Top vendedoras  -  VENDEDOR_MILLENNIUM (sem % meta ate CRUD de Metas).
  // Com codigo do ERP agrupa pela funcionaria (nome trocado no ERP nao divide a pessoa); nome = o do dia mais recente.
  type VendAcc = {
    name: string;
    nameDay: string;
    revenue: number;
    sales: number;
    items: number;
    withoutItems: boolean;
    revenueByStore: Map<string, number>;
    employeeId: number | null;
    generatorId: number | null;
    sellerKeys: Set<string>;
  };
  const vendMap = new Map<string, VendAcc>();
  for (const row of input.sellerDayAggs ?? []) {
    if (scope.storeIds.length > 0 && !scopedStoreIds.has(row.storeId)) continue;
    if (row.day >= period.start && row.day <= period.end && dayInGeneralGoal(goals, row.storeId, row.day, todayIso)) continue;
    const key = row.sellerEmployeeId != null ? `e:${row.sellerEmployeeId}` : `n:${row.sellerKey}`;
    const acc = vendMap.get(key) ?? {
      name: row.sellerName,
      nameDay: row.day,
      revenue: 0,
      sales: 0,
      items: 0,
      withoutItems: false,
      revenueByStore: new Map<string, number>(),
      employeeId: row.sellerEmployeeId ?? null,
      generatorId: null,
      sellerKeys: new Set<string>(),
    };
    acc.sellerKeys.add(row.sellerKey);
    if (row.sellerGeneratorId != null) acc.generatorId = row.sellerGeneratorId;
    if (row.day > acc.nameDay) {
      acc.name = row.sellerName;
      acc.nameDay = row.day;
    }
    acc.revenue += row.revenueCents / 100;
    acc.sales += row.salesCount;
    acc.items += row.itemCount ?? 0;
    if (row.salesCount > 0 && !(row.itemCount && row.itemCount > 0)) acc.withoutItems = true;
    acc.revenueByStore.set(row.storeId, (acc.revenueByStore.get(row.storeId) ?? 0) + row.revenueCents);
    vendMap.set(key, acc);
  }
  const storeName = new Map(fs.map((f) => [f.id, f.tradeName]));
  const storesForSeller = (v: VendAcc): string[] =>
    [...v.revenueByStore.entries()]
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => storeName.get(id))
      .filter((n): n is string => Boolean(n));

  const shiftOf = sellerShiftResolver(input.sellerShifts);
  const avatarOf = sellerAvatarResolver(input.sellerAvatars);
  const sellerShift = (v: VendAcc): string | undefined =>
    shiftOf({
      employeeId: v.employeeId,
      generatorId: v.generatorId,
      sellerKeys: v.sellerKeys,
      storeRows: [...v.revenueByStore.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
    });

  const goalLevels = sellerGoalLevels({
    goals: goalsInPeriod,
    dayAggs: input.goalDayAggs ?? [],
    sellerDayAggs: input.goalSellerDayAggs ?? [],
    namedSellerDayAggs: input.goalNamedSellerDayAggs,
    team: input.goalTeam ?? [],
    today: todayIso,
  });
  // Ranking completo. A tela escolhe a metrica e corta o Top N (igual ao Top produtos).
  const topSellers: TopSeller[] = [...vendMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([key, v]) => {
      const goal = goalLevels.get(key);
      return {
        key,
        name: v.name,
        amount: v.revenue,
        sub: `${v.sales} venda${v.sales === 1 ? "" : "s"}`,
        sales: v.sales,
        averageTicket: v.sales > 0 ? v.revenue / v.sales : 0,
        ...(!v.withoutItems && v.sales > 0 ? { pa: v.items / v.sales } : {}),
        storeRows: storesForSeller(v),
        shift: sellerShift(v),
        avatarUrl: avatarOf({
          employeeId: v.employeeId,
          generatorId: v.generatorId,
          sellerKeys: v.sellerKeys,
          storeRows: [...v.revenueByStore.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
        }),
        ...(goal ? { goal } : {}),
      };
    });

  // Top produtos  -  agrupado por `COD_PRODUTO` (igual a tela Produtos); variacao vs periodo anterior.
  // Lucro bruto = faturamento − CMV (RELATORIOMARGEM). Sem custo num dia = null.
  const prevPeriod = previousPeriod(period);
  const storeById = new Map(fs.map((f) => [f.id, f]));
  const costKey = (storeId: string, day: string, code: string) => `${storeId}|${day}|${code}`;
  const costs = new Map<string, number>();
  for (const r of input.productCostDayAggs ?? []) {
    if (r.day < period.start || r.day > period.end) continue;
    const k = costKey(r.storeId, r.day, r.productCode.trim());
    costs.set(k, (costs.get(k) ?? 0) + r.cmvCents / 100);
  }
  const costsUsed = new Set<string>();
  const salesMargin = productDaySaleMap(input.productCostDayAggs);
  const salesUsed = new Set<string>();
  const prodMap = new Map<
    string,
    { name: string; code: string; revenue: number; items: number; cmv: number; withoutCost: boolean }
  >();
  const prodMapPrev = new Map<string, number>();
  for (const row of input.productDayAggs ?? []) {
    if (scope.storeIds.length > 0 && !scopedStoreIds.has(row.storeId)) continue;
    const key = productRowKey(row);
    const v = productDaySaleBrl(row, salesMargin, salesUsed);
    if (v == null) continue;
    if (row.day >= period.start && row.day <= period.end) {
      const acc = prodMap.get(key) ?? { name: row.productName, code: "", revenue: 0, items: 0, cmv: 0, withoutCost: false };
      acc.revenue += v;
      acc.items += row.itemCount;
      if (row.productName) acc.name = row.productName;
      const code = row.productCode?.trim() ?? "";
      if (code) acc.code = code;
      if (!storeById.has(row.storeId)) acc.withoutCost = true;
      else if (v > 0) {
        const k = costKey(row.storeId, row.day, code);
        const cmv = code ? costs.get(k) : undefined;
        if (cmv == null) acc.withoutCost = true;
        else if (!costsUsed.has(k)) {
          costsUsed.add(k);
          acc.cmv += cmv;
        }
      }
      prodMap.set(key, acc);
    } else if (row.day >= prevPeriod.start && row.day <= prevPeriod.end) {
      prodMapPrev.set(key, (prodMapPrev.get(key) ?? 0) + v);
    }
  }
  const topProducts: OverviewView["topProducts"] = [...prodMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([key, p]) => {
      const prev = prodMapPrev.get(key) ?? 0;
      const trendPct = prev > 0 ? Math.round(((p.revenue - prev) / prev) * 100) : undefined;
      return {
        rowKey: key,
        name: labelUpper(p.name),
        amount: p.revenue,
        sub: `${p.items} itens`,
        items: p.items,
        revenuePrev: prev,
        trend: trendPct,
        profit: p.withoutCost ? null : p.revenue - p.cmv,
      };
    });

  return {
    scope,
    period,
    kpis,
    kpisWpink,
    gauges,
    remainingToGoal,
    projectionClosing,
    goalDescription,
    seriesAxis,
    seriesLabel,
    categoryVsGoal,
    dayVsMeta: [],
    evolution,
    paymentMethods,
    topSellers,
    topProducts,
    storesRanking,
    rankingNetworkTotal,
    otherStoresRanking,
    revenueDelta,
    deltaCategories,
    fromAggregates: true,
  };
}

export function buildOverviewView(scope: Scope, aggs?: OverviewAggInput | null): OverviewView {
  if (aggs) return buildOverviewViewFromAggs(scope, aggs);

  const period = resolvePeriod(scope.period);
  const fs = storesInScope(scope);
  // Overview fixture: mesmo contrato  -  total da operacao (sem filtro de marca).
  const division = null as Division | null;

  // Agregados do periodo
  const current = sumAggregates(fs.map((f) => periodAggregate(f, period.start, period.end, division)));
  const costCurrent = periodCost(fs, period.start, period.end, division).cmv;
  const profitCurrent = current.revenue - costCurrent;
  void profitCurrent; // reservado para KPIs futuros de margem/lucro
  // Periodo anterior para deltas
  const prev = previousPeriod(period);
  const previous = sumAggregates(fs.map((f) => periodAggregate(f, prev.start, prev.end, division)));
  const costPrevious = periodCost(fs, prev.start, prev.end, division).cmv;
  void costPrevious; // reservado para KPIs futuros de margem/lucro
  const ticketCurrent = divSeguro(current.revenue, current.salesCount);
  const ticketPrevious = divSeguro(previous.revenue, previous.salesCount);
  const hasComp = previous.salesCount > 0;
  const vsLabel = hasComp ? prev.label : undefined;

  const showWpinkStrip = fs.some((f) => f.hasWpink);
  const tipCmv = TIP_CMV;
  const wpinkAgg = sumAggregates(fs.map((f) => periodAggregate(f, period.start, period.end, "WPINK")));
  const wpinkCmvFix = periodCost(fs, period.start, period.end, "WPINK").cmv;
  const tipCmvWpink = wpinkCmvFix <= 0 ? TIP_CMV_INDISPONIVEL : TIP_CMV;
  const wpinkTicketFix = divSeguro(wpinkAgg.revenue, wpinkAgg.salesCount);
  const kpisWpink: OverviewKpiWpink[] = showWpinkStrip
    ? [
        {
          label: "Faturamento WPINK",
          amount: brlCent(wpinkAgg.revenue),
          sub:
            current.revenue > 0
              ? `${Math.round((wpinkAgg.revenue / current.revenue) * 100)}% do faturamento`
              : undefined,
          tint: "acc",
        },
        {
          label: "CMV WPINK",
          amount: wpinkCmvFix > 0 ? brlCent(wpinkCmvFix) : "—",
          sub:
            wpinkCmvFix > 0 && wpinkAgg.revenue > 0
              ? `${Math.round((wpinkCmvFix / wpinkAgg.revenue) * 100)}% do faturamento`
              : undefined,
          tooltip: tipCmvWpink,
          tint: "acc",
        },
        {
          label: "Nº de vendas WPINK",
          amount: num(wpinkAgg.salesCount),
          sub: `${num(wpinkAgg.items)} itens`,
          tint: "acc",
        },
        {
          label: "Ticket médio WPINK",
          amount: brlCent(wpinkTicketFix),
          sub:
            wpinkAgg.salesCount > 0
              ? `P.A. ${num(divSeguro(wpinkAgg.items, wpinkAgg.salesCount), 2)}`
              : undefined,
          tint: "acc",
        },
      ]
    : [];

  // Meta da competencia (mes corrente)
  const competence = period.start.slice(0, 7);
  let metaTotal = 0;
  for (const f of fs) {
    const m = goalOfStore(f.id, competence);
    if (m) metaTotal += m.storeAmount;
  }
  const goalAttainment = metaTotal > 0 ? (current.revenue / metaTotal) * 100 : 0;
  const missing = metaTotal > 0 ? Math.max(0, metaTotal - current.revenue) : 0;

  // Projecao de fechamento (curva de receita)
  const curve = revenueCurve(fs, competence);
  let accumulatedShare = 0;
  for (const iso of eachDay(`${competence}-01`, TODAY_ISO)) accumulatedShare += curve.weight(iso);
  const projected = accumulatedShare > 0 ? current.revenue / accumulatedShare : 0;
  const projPct = metaTotal > 0 ? (projected / metaTotal) * 100 : 0;

  // Serie de tendencia (7 pontos)
  const seriesRevenue = trendSeries(fs, period, division).revenue?.slice(-7) ?? [];

  // KPIs com drill-down
  const kpis: OverviewKpi[] = [
    {
      label: "Faturamento",
      amount: brlCent(current.revenue),
      sub: metaTotal > 0 ? `Meta: ${brlCent(metaTotal)}` : undefined,
      delta: hasComp ? kpiDelta(current.revenue, previous.revenue, vsLabel) : undefined,
      series: seriesRevenue,
    },
    {
      label: "CMV",
      amount: brlCent(costCurrent),
      sub: `${(divSeguro(costCurrent, current.revenue) * 100).toFixed(0)}% do faturamento`,
      delta: hasComp ? kpiDelta(costCurrent, costPrevious, vsLabel) : undefined,
      tooltip: tipCmv,
    },
    {
      label: "Nº de vendas",
      amount: num(current.salesCount),
      sub: `${num(current.items)} itens vendidos`,
      delta: hasComp ? kpiDelta(current.salesCount, previous.salesCount, vsLabel, "sales") : undefined,
    },
    {
      label: "Ticket médio",
      amount: brlCent(ticketCurrent),
      sub: `P.A. ${num(divSeguro(current.items, current.salesCount), 2)}`,
      delta: hasComp ? kpiDelta(ticketCurrent, ticketPrevious, vsLabel) : undefined,
    },
  ];

  // Gauges: Meta / Super Meta / Hiper Meta (degraus da primeira filial com meta)
  const storeWithGoal = fs.find((f) => Boolean(goalOfStore(f.id, competence)));
  const tiers = storeWithGoal ? goalOfStore(storeWithGoal.id, competence)?.tiers ?? [] : [];
  const gauges: GoalGauge[] = tiers.slice(0, 3).map((d: { name: string; minAttainmentPct: number }) => ({
    name: d.name,
    pct: Math.min(100, (current.revenue / (metaTotal * d.minAttainmentPct / 100)) * 100),
    target: Math.round(metaTotal * d.minAttainmentPct / 100),
    achieved: current.revenue,
  }));
  // Fallback se nao houver degraus mas houver meta
  if (gauges.length === 0 && metaTotal > 0) {
    gauges.push({ name: "Meta", pct: Math.min(100, goalAttainment), target: metaTotal, achieved: current.revenue });
  }

  const remainingToGoal = missing > 0 ? `Faltam ${brlCent(missing)} para atingir a meta do mês` : metaTotal > 0 ? "Meta atingida" : null;
  const projectionClosing = projected > 0 ? `Projeção: ${brlCent(projected)} · ${projPct.toFixed(0)}% da meta` : null;

  // Faturamento por categoria (fixture): todas as categorias da marca, mesmo com R$ 0.
  const catMap = new Map<number, { revenue: number }>();
  for (const cat of categories) {
    if (division && cat.division !== division) continue;
    catMap.set(cat.id, { revenue: 0 });
  }
  for (const f of fs) {
    for (const d of salesDays(f.id, period.start, period.end)) {
      for (const [id, c] of Object.entries(d.byCategory)) {
        const cat = categories.find((x) => x.id === Number(id));
        if (!cat || (division && cat.division !== division)) continue;
        const acc = catMap.get(cat.id) ?? { revenue: 0 };
        acc.revenue += c.revenue;
        catMap.set(cat.id, acc);
      }
    }
  }
  const categoryVsGoal: CategoryVsGoal[] = [...catMap.entries()]
    .map(([id, c]) => {
      const cat = categories.find((x) => x.id === id)!;
      return { category: labelUpper(cat.name), goal: 0, achieved: c.revenue };
    })
    .sort((a, b) => b.achieved - a.achieved || a.category.localeCompare(b.category, "pt-BR"));

  // Faturamento por Dia da Semana vs Meta  -  oculto em periodo de 1 dia.
  const seriesAxis = seriesAxisForPeriod(period);
  const seriesLabel = seriesAxisLabel(period, seriesAxis);
  const daysWeekNames = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const dowToIdx = (dow: number) => (dow === 0 ? 6 : dow - 1);
  let dayVsMeta: DayVsGoal[] = [];
  if (seriesAxis !== "hour") {
    const dayAgg: Record<number, { revenue: number; count: number }> = {};
    for (const iso of eachDay(period.start, period.end)) {
      const idx = dowToIdx(isoToDate(iso).getDay());
      if (!dayAgg[idx]) dayAgg[idx] = { revenue: 0, count: 0 };
      for (const f of fs) {
        const dv = salesDay(f.id, iso);
        if (!dv) continue;
        if (division) {
          const divAg = dv.byDivision[division];
          dayAgg[idx].revenue += divAg?.revenue ?? 0;
        } else {
          dayAgg[idx].revenue += dv.total.revenue;
        }
      }
      dayAgg[idx].count += 1;
    }
    const dailyGoal = metaTotal > 0 ? metaTotal / 7 : 0;
    dayVsMeta = daysWeekNames.map((name, i) => ({
      day: name,
      goal: dailyGoal,
      achieved: dayAgg[i] ? dayAgg[i].revenue / (dayAgg[i].count || 1) : 0,
    }));
  }

  // Evolucao Fat vs Meta  -  eixo hora / dia / mes conforme o periodo.
  const periodDays = eachDay(period.start, period.end);
  const evolution: EvolutionPoint[] = [];
  if (seriesAxis === "hour") {
    const dow = isoToDate(period.start).getDay() as Dow;
    const win = unionOpenWindow(
      fs.map((f) => effectiveWeekHours(f.hours)),
      dow,
    );
    const hours: number[] = [];
    for (let h = win.opening; h < win.closing; h++) hours.push(h);
    const hoursVisible = period.isToday ? hours.filter((h) => h <= CURRENT_HOUR) : hours;
    const goalByHour = metaTotal > 0 && hours.length > 0 ? metaTotal / hours.length : 0;
    let acumR = 0;
    let acumM = 0;
    for (const h of hoursVisible) {
      let revenueH = 0;
      for (const f of fs) {
        const a = salesDay(f.id, period.start)?.byHour[h];
        if (!a) continue;
        if (!division) revenueH += a.revenue;
        else {
          const day = salesDay(f.id, period.start)!;
          const fr = day.total.revenue > 0 ? day.byDivision[division].revenue / day.total.revenue : 0;
          revenueH += Math.round(a.revenue * fr);
        }
      }
      acumR += revenueH;
      acumM += goalByHour;
      evolution.push({ label: shortHour(h), achieved: acumR, goal: acumM, projection: null });
    }
  } else if (seriesAxis === "month") {
    let acumR = 0;
    let acumM = 0;
    const months = monthsBetween(period.start, period.end);
    const goalByMonth = metaTotal > 0 && months.length > 0 ? metaTotal / months.length : 0;
    for (const month of months) {
      const agg = monthAggregate(fs, month, division);
      acumR += agg.revenue;
      acumM += goalByMonth;
      const label = monthYear(`${month}-01`).split(" de ")[0];
      evolution.push({ label, achieved: acumR, goal: acumM, projection: null });
    }
  } else {
    let acumAchieved = 0;
    let acumMeta = 0;
    const goalByDay = metaTotal > 0 ? metaTotal / periodDays.length : 0;
    for (const iso of periodDays) {
      let revenueDay = 0;
      for (const f of fs) {
        const dv = salesDay(f.id, iso);
        if (!dv) continue;
        if (division) revenueDay += dv.byDivision[division]?.revenue ?? 0;
        else revenueDay += dv.total.revenue;
      }
      acumAchieved += revenueDay;
      acumMeta += goalByDay;
      evolution.push({
        label: dayAxisLabel(iso, period),
        band: dayPointDetail(iso),
        achieved: acumAchieved,
        goal: acumMeta,
        projection: null,
      });
    }
  }
  // Formas de pagamento (reusa logica do Financeiro)
  const totaisForma: Record<string, number> = {};
  for (const f of fs) {
    for (const iso of periodDays) {
      const dv = salesDay(f.id, iso);
      if (!dv) continue;
      for (const [method, val] of Object.entries(dv.byMethod)) {
        totaisForma[method] = (totaisForma[method] ?? 0) + val;
      }
    }
  }
  const totalFormas = Object.values(totaisForma).reduce((s, v) => s + v, 0) || 1;
  const COLORS_FORMAS: Record<string, string> = {
    Pix: "var(--ok)",
    "Cartão de crédito": "var(--acc)",
    "Cartão de débito": "var(--info)",
    Cash: "var(--warn)",
  };
  const paymentMethods: PaymentMethodRevenue[] = Object.entries(totaisForma)
    .sort((a, b) => b[1] - a[1])
    .map(([method, amount]) => ({
      method,
      amount,
      pct: (amount / totalFormas) * 100,
      color: COLORS_FORMAS[method] ?? "var(--t2)",
    }));

  // Top vendedoras (com % da meta individual)
  const vendMap = new Map<string, { name: string; revenue: number; sales: number; items: number; store: string }>();
  for (const f of fs) {
    const cols = collaboratorsOfStore(f.id);
    for (const iso of periodDays) {
      const dv = salesDay(f.id, iso);
      if (!dv) continue;
      for (const [colId, ag] of Object.entries(dv.bySeller)) {
        const col = cols.find((c) => c.id === colId);
        if (!col) continue;
        const acc = vendMap.get(colId) ?? { name: col.name, revenue: 0, sales: 0, items: 0, store: f.tradeName };
        acc.revenue += ag.revenue;
        acc.sales += ag.salesCount;
        acc.items += ag.items;
        vendMap.set(colId, acc);
      }
    }
  }
  // Meta individual = meta total da loja / n de vendedoras ativas
  const goalCompetence = period.start.slice(0, 7); // YYYY-MM
  const goalStores = fs.map((f) => goalOfStore(f.id, goalCompetence)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const storeGoalTotal = goalStores.reduce((s, m) => s + m.storeAmount, 0);
  const sellerCount = vendMap.size || 1;
  const individualGoal = storeGoalTotal / sellerCount;
  const topSellers: TopSeller[] = [...vendMap.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .map((v) => ({
      name: v.name,
      amount: v.revenue,
      sub: `${v.sales} vendas · ${individualGoal > 0 ? Math.round((v.revenue / individualGoal) * 100) : 0}% da meta`,
      sales: v.sales,
      averageTicket: v.sales > 0 ? v.revenue / v.sales : 0,
      goalPct: individualGoal > 0 ? Math.min(100, (v.revenue / individualGoal) * 100) : 0,
      ...(v.sales > 0 ? { pa: v.items / v.sales } : {}),
      storeRows: v.store ? [v.store] : [],
    }));

  // Top produtos (com categoria e trend)
  const prodMap = new Map<string, { name: string; revenue: number; items: number; categoryName: string }>();
  for (const [catId, c] of catMap.entries()) {
    const cat = categories.find((x) => x.id === catId);
    if (!cat) continue;
    const prods = productsOfCategory(cat.id, `${period.start}|${division ?? ""}`, c.revenue, 0, 0);
    for (const p of prods) {
      const acc = prodMap.get(p.productCode) ?? { name: p.name, revenue: 0, items: 0, categoryName: cat.name };
      acc.revenue += p.revenue;
      acc.items += p.items;
      prodMap.set(p.productCode, acc);
    }
  }
  // Calcular trend comparando com periodo anterior
  const prodMapPrev = new Map<string, number>();
  for (const [catId, c] of catMap.entries()) {
    const prodsPrev = productsOfCategory(catId, `${prev.start}|${division ?? ""}`, c.revenue * 0.85, 0, 0);
    for (const p of prodsPrev) {
      prodMapPrev.set(p.productCode, (prodMapPrev.get(p.productCode) ?? 0) + p.revenue);
    }
  }
  const topProducts: (TopItem & { sub?: string; items?: number; category?: string; trend?: number; revenuePrev?: number })[] = [...prodMap.entries()]
    .map(([code, p]) => {
      const revenuePrev = prodMapPrev.get(code) ?? 0;
      const trendPct = revenuePrev > 0 ? ((p.revenue - revenuePrev) / revenuePrev) * 100 : null;
      return {
        name: labelUpper(p.name),
        amount: p.revenue,
        sub: `${p.items} itens`,
        items: p.items,
        category: labelUpper(p.categoryName),
        revenuePrev,
        trend: trendPct != null ? Math.round(trendPct) : undefined,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  // Ranking de lojas (faturamento + % da meta + trend)  -  fantasia = mesmo rotulo do StorePicker
  const storesRanking: (TopItem & { goalPct?: number; trend?: number })[] = fs.map((f) => {
    const periodRevenue = periodAggregate(f, period.start, period.end, division).revenue;
    const branchGoal = goalOfStore(f.id, period.start.slice(0, 7));
    const goalPct = branchGoal ? (periodRevenue / branchGoal.storeAmount) * 100 : null;
    // Trend real: faturamento do periodo vs periodo anterior
    const revenuePrevious = periodAggregate(f, prev.start, prev.end, division).revenue;
    const trend = revenuePrevious > 0 ? Math.round(((periodRevenue - revenuePrevious) / revenuePrevious) * 100) : undefined;
    return {
      name: labelUpper(f.tradeName),
      amount: periodRevenue,
      goalPct: goalPct ?? undefined,
      trend,
    };
  }).sort((a, b) => b.amount - a.amount);

  return {
    scope,
    period,
    kpis,
    kpisWpink,
    gauges,
    remainingToGoal,
    projectionClosing,
    revenueDelta: hasComp ? kpiDelta(current.revenue, previous.revenue, vsLabel) : undefined,
    seriesAxis,
    seriesLabel,
    categoryVsGoal,
    dayVsMeta,
    evolution,
    paymentMethods,
    topSellers,
    topProducts,
    storesRanking,
  };
}
