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
import { categorias, stores, productStores, tarefas, groups, storeOperatingCostsConfigured, type Division, type Store } from "./stores";
import { goalOfStore } from "./goals";
import { productsOfCategory } from "./products";
import { buildProductLineIndex } from "./productLines";
import { NOW, UPDATED_AT, TODAY_ISO, CURRENT_HOUR, SYNC_INTERVAL_MIN, LAST_SYNC, calendarTodayIso, calendarCurrentHour } from "./clock";
import { effectiveWeekHours, hourAxisRange, unionOpenWindow, type Dow } from "./storeHours";
import { hourShares, periodDailyGoal, weekdayWeights } from "./goalCurve";
import { sellerGoalLevels } from "./goalView";
import { dayAggregate, salesDay, salesDays, storeOpen, dayWeight, sumAggregates, type Aggregate } from "./sales";
import { brl, brlCent, fullDate, shortDate, dayAxisLabel, dayPointDetail, isoToDate, delta as fmtDelta, hourSpan, endOfMonth, shortHour, startOfMonth, eachDay, labelUpper, monthYear, shortMonth, pct, addDays } from "@/lib/format";
import type { TintKey } from "@/pages/dashboards/icons";
import { buildStoreInsight } from "./insight";
import { brandFromProductCode } from "./costTableFill";

/** Linhas dos cards de ranking: Destaques da equipe, Top produtos e Top linhas. */
export const TOP_CARD_SIZE = 10;

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
  vendaNecessaria: BlockState;
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
  faltaRestante: number;
  daysRemaining: number;
  diaReferencia: string;
  cumpridaHoje: boolean;
  metaMesAtingida: boolean;
  noGoal: boolean;
}

export interface GapView {
  exibir: boolean;
  efeitoFluxo: number;
  efeitoTicket: number;
  gapTotal: number;
  alavancaDominante: "fluxo" | "ticket" | null;
  noGoal: boolean;
}

export interface MixView {
  itens: { categoria: string; division: string; margem: number; receita: number; pct: number }[];
  period: string;
}

/** Linha da visao de grupo (LOJA-05): status do trilho por loja + se tem meta. */
export interface StoreSummaryView {
  storeId: string;
  name: string;
  pctTrilho: number | null;
  status: TrackStatus;
  temMeta: boolean;
}

const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const TIP_CMV = "Custo das mercadorias vendidas no período.";
const TIP_CMV_INDISPONIVEL = "O CMV não está disponível para este período.";
const TIP_LUCRO_BRUTO = "Valor que permanece após descontar do faturamento o CMV e os impostos considerados pela operação.";
const TIP_MARGEM = "Percentual do faturamento que permanece como lucro bruto após CMV e impostos.";
const TIP_CMV_WPINK = "Custo das mercadorias WPINK vendidas no período.";
const TIP_CMV_WPINK_INDISPONIVEL = "O CMV WPINK não está disponível para este período.";
const TIP_LUCRO_BRUTO_WPINK = "Valor que permanece do faturamento WPINK após descontar CMV e impostos.";
const TIP_MARGEM_WPINK = "Percentual do faturamento WPINK que permanece como lucro bruto após CMV e impostos.";
const DIA_SEMANA_PASSADO = [
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
  const mes = Math.floor(d.getMonth() / 3) * 3; // 0,3,6,9
  return `${d.getFullYear()}-${String(mes + 1).padStart(2, "0")}-01`;
}

function startOfHalf(todayIso: string): string {
  const d = isoToDate(todayIso);
  const mes = d.getMonth() < 6 ? 0 : 6;
  return `${d.getFullYear()}-${String(mes + 1).padStart(2, "0")}-01`;
}

export function resolvePeriod(p: Period, todayIso: string = TODAY_ISO): ResolvedPeriod {
  const todayDate = isoToDate(todayIso);
  const mesPassadoRef = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1);
  const mesPassadoIso = `${mesPassadoRef.getFullYear()}-${String(mesPassadoRef.getMonth() + 1).padStart(2, "0")}-01`;
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
      start = mesPassadoIso;
      end = endOfMonth(mesPassadoIso);
      break;
    case "custom":
      start = p.start ?? addDays(todayIso, -6);
      end = p.end ?? todayIso;
      if (end > todayIso) end = todayIso;
      if (start > end) start = end;
      break;
  }
  const dias = eachDay(start, end).length;
  const spansMonths = start.slice(0, 7) !== end.slice(0, 7);
  const granularity: Granularity =
    dias === 1 ? "day" : p.kind === "thisMonth" || p.kind === "lastMonth" ? "month" : "period";
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
  tom: "warning" | "danger" | "info";
}

/** Um indicador do topo, no formato do KpiTile do template. */
export interface KpiValor {
  amount: string;
  delta?: { value: string; positive: boolean; /** Rotulo curto da base, ex.: "ago" / "Segunda passada" */ vs?: string };
  /** Serie curta para o traco de tendencia. So o Faturamento usa. */
  serie?: number[];
  /** So o Faturamento sobrescreve rotulo e subtitulo  -  os outros usam o texto fixo do componente. */
  label?: string;
  sub?: string;
}

/** Segundo tile da fileira: Meta do mes (dia), Projecao (mes) ou Participacao da marca (recorte por marca). Mesmo lugar, papel diferente conforme o contexto. */
export interface GoalProjectionTile {
  kind: "meta" | "projecao" | "participacao" | "unavailable";
  label: string;
  valorPrincipal: string;
  barPct: number;
  detail: string;
}

/** Card lateral da rede: so enquanto a meta esta em jogo (nao fechada, nao batida antes da hora). */
export interface RitmoCard {
  realizadoDia: string;
  necessarioDia: string;
  projecaoLinha: string;
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
  atingimentoTexto: string;
  barPct: number;
  /** Cor de identidade da loja, estavel independente da ordenacao por desempenho. */
  tint: TintKey;
  variacaoDia: { value: string; positive: boolean } | null;
  variacaoDiaValor: number | null;
}

/** Loja fora do ritmo da propria meta: quem precisa de atencao, nao quem vendeu mais. */
export interface AttentionPoint {
  storeId: string;
  name: string;
  atingimentoTexto: string;
  status: string;
  faltaPorDia: string;
  veredito: "nao_atinge" | "incerto";
}

export interface HourChart {
  horas: number[];
  valores: number[];
  /** Mesmo dia da semana anterior (semana passada), alinhado por hora  -  AD-048. */
  anterior: number[] | null;
  rotuloAnterior: string;
  horaAtual: number | null;
}

/** Por hora, empilhado por loja  -  so na rede, periodo de um dia. Acima de 5 lojas, colapsa: uma cor so, soma simples. */
export interface NetworkHourChart {
  horas: number[];
  series: { storeId: string; name: string; tint: TintKey; valores: number[] }[];
  horaAtual: number | null;
  colapsado: boolean;
}

export interface EvolutionChart {
  rotulos: string[];
  valores: number[];
  anterior: number[] | null;
  rotuloAnterior: string;
}

export interface ProfitItem {
  label: string;
  amount: string;
  pct: string;
}

export interface CategoryRow {
  categoriaId: number;
  name: string;
  receita: string;
  margem: string;
  margemPct: string;
  /** Relativa a maior margem em R$ do grupo  -  pra desenhar a barra da lista. */
  barPct: number;
}

export interface GroupRow {
  id: string;
  name: string;
  horario: string;
  estado: "encerrado" | "andamento" | "naoComecou";
  feitas: number;
  total: number;
  tarefas: { title: string; feita: boolean }[];
}

/** Checklist do dia: um grupo por linha, cada um com o proprio estado e lista de tarefas. */
export interface DayChecklist {
  dataTexto: string;
  groups: GroupRow[];
}

export interface ProjectionView {
  amount: number | null;
  disponivel: boolean;
  encerrada: boolean;
  /** Indice de desempenho da competencia (realizado  meta acumulada), usado para escalar a curva restante. */
  indice: number | null;
  /** Meta mensal em R$  -  para a UI desenhar a barra sem duplicar o pct (AD-029). */
  goalAmount: number;
}

/** Periodo com agregados consolidados para a comparacao unica (LOJA-06 AC 1-3). */
export interface PeriodAggregateComparison {
  start: string;
  end: string;
  revenue: number;
  salesCount: number;
  itens: number;
}

export interface ComparisonView {
  atual: PeriodAggregateComparison;
  anterior: PeriodAggregateComparison;
  rotuloAtual: string;
  rotuloAnterior: string;
}

export interface StoreView {
  scope: Scope;
  period: ResolvedPeriod;
  atualizadoAs: string;
  proximoSyncMin: number;
  scopeView: "network" | "day" | "period";
  alertas: SystemAlert[];
  leitura: string | null;
  notices: string[];
  comparacao: ComparisonView | null;
  trilho: TrackView | null;
  vendaNecessaria: RequiredSalesView | null;
  projection: ProjectionView | null;
  diagnostico: GapView | null;
  mix: MixView | null;
  storeRows: StoreSummaryView[];
  states: StoreBlockStates;
  kpiRevenue: KpiValor;
  kpiTicket: KpiValor;
  kpiPA: KpiValor;
  kpiSalesCount: KpiValor;
  tileMeta: GoalProjectionTile | null;
  ritmo: RitmoCard | null;
  ritmoAviso: string | null;
  regua: RulerRow[] | null;
  /** Titulo da regua: "Desempenho das lojas" (rede) ou "Desempenho da loja" (uma loja). */
  reguaTitulo: string;
  pontosAtencao: AttentionPoint[] | null;
  graficoHora: HourChart | null;
  graficoHoraRede: NetworkHourChart | null;
  evolucao: EvolutionChart | null;
  checklist: DayChecklist | null;
  lucroBruto: { itens: ProfitItem[]; aviso: string; divisaoLinha: string | null } | null;
  categorias: CategoryRow[] | null;
}

/* ---------- Helpers ---------- */

function storesInScope(scope: Scope): Store[] {
  // Array vazio = "Todas as lojas"  ->  consolida a rede (ERP hidratado, sem misturar mock).
  const catalog = productStores();
  return scope.storeIds.length === 0
    ? catalog
    : catalog.filter((f) => scope.storeIds.includes(f.id));
}

/** `horaMax` recorta so o ultimo dia (`fim`)  -  dia equivalente ao "hoje" em andamento. */
function periodAggregate(f: Store, start: string, end: string, division: Division | null, horaMax?: number): Aggregate {
  return sumAggregates(salesDays(f.id, start, end).map((d) => dayAggregate(d, division, d.data === end ? horaMax : undefined)));
}

function divSeguro(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

function pctDelta(atual: number, anterior: number): number {
  if (anterior === 0) return 0;
  return ((atual - anterior) / anterior) * 100;
}

/** Delta pronto para o KpiTile do template: sem sinal no texto, a seta ja indica. */
/** Unidade do valor comparado no tooltip do badge: R$ (padrao) ou quantidade com unidade (nunca o numero solto). */
export type DeltaUnit = "brl" | "itens" | "vendas" | "pa";

function anteriorComUnidade(v: number, unit: Exclude<DeltaUnit, "brl">): string {
  if (unit === "pa") return `${num(v, 2)} ${v === 1 ? "item" : "itens"} por venda`;
  const n = num(v, Number.isInteger(v) ? 0 : 2);
  if (unit === "itens") return `${n} ${v === 1 ? "item" : "itens"}`;
  return `${n} ${v === 1 ? "venda" : "vendas"}`;
}

export function kpiDelta(atual: number, anterior: number, vs?: string, unit: DeltaUnit = "brl"): { value: string; positive: boolean; vs?: string; diff?: string; anterior?: string } | undefined {
  const monetario = unit === "brl";
  if (anterior <= 0) return undefined;
  const v = pctDelta(atual, anterior);
  const casas = Math.abs(v) < 10 ? 1 : 0;
  if (num(Math.abs(v), casas) === num(0, casas)) return undefined;
  const diferenca = Math.abs(atual - anterior);
  return {
    value: fmtDelta(v, casas).replace(/^[+−]/, ""),
    positive: v >= 0,
    ...(vs ? { vs } : {}),
    ...(monetario && diferenca > 0 ? { diff: brl(diferenca) } : {}),
    // Valor do periodo comparado (tooltip do badge).
    anterior: unit === "brl" ? brlCent(anterior) : anteriorComUnidade(anterior, unit),
  };
}

/** Delta em pontos percentuais (margem etc.). Omite ~0 p.p.  -  mesmo criterio do kpiDelta. */
export function kpiDeltaPp(atual: number, anterior: number, vs?: string): { value: string; positive: boolean; vs?: string; anterior?: string } | undefined {
  const diff = Math.abs(atual - anterior);
  if (num(diff, 1) === num(0, 1)) return undefined;
  return {
    value: `${num(diff, 1)} p.p.`,
    positive: atual >= anterior,
    ...(vs ? { vs } : {}),
    anterior: `${num(anterior, 1)}%`,
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
    const abertura = Math.min(...fs.map((f) => f.abertura));
    const fechamento = Math.max(...fs.map((f) => f.fechamento));
    const horas: number[] = [];
    for (let h = abertura; h < fechamento; h++) horas.push(h);
    let pontos = horas.map((h) =>
      fs.reduce(
        (soma, f) => {
          const dia = salesDay(f.id, period.start);
          const a = dia?.porHora[h];
          if (!a) return soma;
          if (!division) return { revenue: soma.revenue + a.revenue, salesCount: soma.salesCount + a.salesCount, itens: soma.itens + a.itens };
          const fr = dia!.total.revenue > 0 ? dia!.byDivision[division].revenue / dia!.total.revenue : 0;
          return { revenue: soma.revenue + Math.round(a.revenue * fr), salesCount: soma.salesCount + Math.round(a.salesCount * fr), itens: soma.itens + Math.round(a.itens * fr) };
        },
        { revenue: 0, salesCount: 0, itens: 0 },
      ),
    );
    if (period.isToday) {
      const idx = horas.indexOf(CURRENT_HOUR);
      if (idx >= 0) pontos = pontos.slice(0, idx + 1);
    }
    return pontos;
  }
  const dias = eachDay(period.start, period.end);
  return dias.map((iso) => sumAggregates(fs.map((f) => dayAggregate(salesDay(f.id, iso)!, division))));
}

/** Uma serie por metrica, derivada dos mesmos pontos (por hora no dia, por dia nos demais periodos). */
function trendSeries(fs: Store[], period: ResolvedPeriod, division: Division | null): { revenue?: number[]; ticket?: number[]; pa?: number[]; salesCount?: number[] } {
  const pontos = aggregatedTrendSeries(fs, period, division);
  if (pontos.length < 2) return {};
  return {
    revenue: pontos.map((p) => p.revenue),
    ticket: pontos.map((p) => divSeguro(p.revenue, p.salesCount)),
    pa: pontos.map((p) => divSeguro(p.itens, p.salesCount)),
    salesCount: pontos.map((p) => p.salesCount),
  };
}

/** Expectativa para um dia: media do mesmo dia da semana nas 4 semanas anteriores. */
function expectedDayAmount(f: Store, iso: string, division: Division | null): number {
  if (!storeOpen(f, iso)) return 0;
  let soma = 0;
  let n = 0;
  for (let k = 1; k <= 4; k++) {
    const ref = addDays(iso, -7 * k);
    const d = salesDay(f.id, ref);
    if (d && ref !== TODAY_ISO) {
      soma += dayAggregate(d, division).revenue;
      n++;
    }
  }
  return n ? soma / n : 0;
}

/** R$ 85,3k  -  valor curto, pra nao quebrar componente. R$ 1,2M a partir de 1 milhao. Abaixo de R$ 10.000, valor cheio  -  R$ 3.022, nao R$ 3k, que esconderia precisao que cabe na tela. Sem ",0" a toa: so mostra casa decimal quando ela diz algo (283k, nao 283,0k). */
/** Formata numero inteiro com separador de milhar (ex.: 5778  ->  "5.778"). */
export function num(v: number, casas?: number): string {
  if (casas !== undefined) return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  return Math.round(v).toLocaleString("pt-BR");
}

export function brlK(v: number): string {
  const abs = Math.abs(v);
  const compacto = (dividido: number) => dividido.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  if (abs >= 1_000_000) return `R$ ${compacto(v / 1_000_000)}M`;
  if (abs >= 10_000) return `R$ ${compacto(v / 1000)}k`;
  return brl(v);
}


interface CalculatedGoal {
  amount: number;
  achieved: number;
  attainmentPct: number;
  necessarioDia: number | null;
  daysRemaining: number;
  diaDoMes: number;
  diasNoMes: number;
  projection: number | null;
  pessimista: number | null;
  otimista: number | null;
  veredito: "atinge" | "incerto" | "nao_atinge" | null;
  fechada: boolean;
}

/** Meta do mes. Sempre mensal, mesmo quando o periodo exibido e diferente. */
function calculateGoal(fs: Store[], competence: string): CalculatedGoal | null {
  const goalStores = fs.map((f) => goalOfStore(f.id, competence)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (goalStores.length === 0) return null;

  const primeiroDia = `${competence}-01`;
  const ultimoDia = endOfMonth(primeiroDia);
  const fechada = ultimoDia < TODAY_ISO;
  const fimReal = fechada ? ultimoDia : TODAY_ISO;

  const amount = goalStores.reduce((s, m) => s + m.storeAmount, 0);
  const achieved = fs.reduce((s, f) => s + periodAggregate(f, primeiroDia, fimReal, null).revenue, 0);
  const daysRemaining = fechada ? 0 : monthDaysRemaining(fs);
  const necessarioDia = fechada || daysRemaining === 0 || achieved >= amount ? null : (amount - achieved) / daysRemaining;
  const attainmentPct = divSeguro(achieved, amount) * 100;

  // Projecao so a partir do dia 7: cinco dias nao projetam trinta.
  const diaDoMes = isoToDate(fechada ? ultimoDia : TODAY_ISO).getDate();
  let projection: number | null = null;
  let pessimista: number | null = null;
  let otimista: number | null = null;
  let veredito: CalculatedGoal["veredito"] = null;

  if (fechada) {
    veredito = attainmentPct >= 100 ? "atinge" : "nao_atinge";
  } else if (diaDoMes >= 7) {
    let futuro = 0;
    for (const iso of eachDay(addDays(TODAY_ISO, 1), ultimoDia)) {
      for (const f of fs) futuro += expectedDayAmount(f, iso, null);
    }
    let restoHoje = 0;
    for (const f of fs) {
      const feito = dayAggregate(salesDay(f.id, TODAY_ISO)!, null).revenue;
      restoHoje += Math.max(0, expectedDayAmount(f, TODAY_ISO, null) - feito);
    }
    // A faixa se estreita conforme o mes avanca: menos dias por vir, menos incerteza.
    const fracaoRestante = divSeguro(futuro + restoHoje, achieved + futuro + restoHoje);
    const amplitude = 0.06 + 0.22 * fracaoRestante;
    projection = achieved + futuro + restoHoje;
    pessimista = achieved + (futuro + restoHoje) * (1 - amplitude);
    otimista = achieved + (futuro + restoHoje) * (1 + amplitude);
    veredito = pessimista >= amount ? "atinge" : otimista < amount ? "nao_atinge" : "incerto";
  }

  return { amount, achieved, attainmentPct, necessarioDia, daysRemaining, diaDoMes, diasNoMes: isoToDate(ultimoDia).getDate(), projection, pessimista, otimista, veredito, fechada };
}

/** "abaixo do ritmo" / "no ritmo" / "acima do ritmo": realizado por dia contra o necessario por dia, a mesma conta em todo lugar que fala de ritmo. */
function statusRitmo(m: CalculatedGoal): string {
  const emJogo = m.necessarioDia !== null;
  const ritmoDiario = m.diaDoMes > 0 ? m.achieved / m.diaDoMes : 0;
  if (m.fechada) return m.attainmentPct >= 100 ? "meta batida" : "meta não batida";
  if (!emJogo) return "meta batida";
  if (ritmoDiario >= m.necessarioDia! * 1.05) return "acima do ritmo";
  if (ritmoDiario >= m.necessarioDia!) return "no ritmo";
  return "abaixo do ritmo";
}

/** Periodo anterior comparavel, com o rotulo que a tela exibe. */
/**
 * Periodo anterior equivalente. Se o periodo atual termina hoje, `horaMax` vale so para o ultimo
 * dia (`fim`) do anterior  -  o dia equivalente entra ate a hora atual, os demais inteiros.
 */
export function previousPeriod(
  period: ResolvedPeriod,
  horaAtual: number = CURRENT_HOUR,
): { start: string; end: string; label: string; horaMax?: number } {
  const horaMax = period.endsToday ? horaAtual : undefined;
  if (period.granularity === "day") {
    const ref = addDays(period.start, -7);
    return { start: ref, end: ref, label: DIA_SEMANA_PASSADO[isoToDate(ref).getDay()], horaMax };
  }
  if (period.granularity === "month") {
    const ini = isoToDate(period.start);
    const mesAnt = new Date(ini.getFullYear(), ini.getMonth() - 1, 1);
    const start = `${mesAnt.getFullYear()}-${String(mesAnt.getMonth() + 1).padStart(2, "0")}-01`;
    const end = period.openMonth ? addDays(start, isoToDate(period.end).getDate() - 1) : endOfMonth(start);
    return { start, end, label: "o mês passado", horaMax: period.openMonth ? horaMax : undefined };
  }
  if (period.kind === "thisWeek") {
    return { start: addDays(period.start, -7), end: addDays(period.end, -7), label: "a semana passada", horaMax };
  }
  const n = eachDay(period.start, period.end).length;
  const end = addDays(period.start, -1);
  return { start: addDays(end, -(n - 1)), end, label: `os ${n} dias anteriores`, horaMax };
}

/** "15/09/2026" para um unico dia, "01/09/2026  -  07/09/2026" para um intervalo. */
function formatRange(start: string, end: string): string {
  return start === end ? fullDate(start) : `${fullDate(start)} – ${fullDate(end)}`;
}

interface AggregatedCost {
  cmv: number;
  porCategoria: Record<number, { revenue: number; cmv: number }>;
}

function periodCost(fs: Store[], start: string, end: string, division: Division | null): AggregatedCost {
  const out: AggregatedCost = { cmv: 0, porCategoria: {} };
  for (const f of fs) {
    for (const d of salesDays(f.id, start, end)) {
      for (const [id, c] of Object.entries(d.porCategoria)) {
        const cat = categorias.find((x) => x.id === Number(id));
        if (!cat || (division && cat.division !== division)) continue;
        const acc = (out.porCategoria[cat.id] ??= { revenue: 0, cmv: 0 });
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
  const alertas: SystemAlert[] = [];
  const minutosSemSync = Math.floor((NOW.getTime() - LAST_SYNC.getTime()) / 60000);
  if (minutosSemSync > 60) {
    const h = Math.floor(minutosSemSync / 60);
    alertas.push({ id: "sync", tom: "warning", text: `Dados de ${UPDATED_AT}. Sync não roda há ${h}h${String(minutosSemSync % 60).padStart(2, "0")}.` });
  }
  for (const f of fs.filter((x) => x.id === "f2")) {
    alertas.push({ id: `nota-${f.id}`, tom: "info", text: `${f.fantasia} tem 8 produtos com nota de entrada pendente.` });
  }
  return alertas;
}

/* ---------- Motor de trilho ---------- */

/** Curva de pesos normalizados: `peso(iso)` soma 1 nos dias abertos; `pesoBruto` e o valor pre-normalizacao. */
export interface RevenueCurve {
  peso: (iso: string) => number;
  pesoBruto: (iso: string) => number;
  soma: number;
}

/**
 * curvaReceita (AD-034): pesos diarios normalizados (soma = 1 nos dias abertos)
 * derivados do historico real de faturamento  -  media simples das quatro
 * ocorrencias equivalentes anteriores do mesmo dia da semana; menos ocorrencias
 * usa o que houver; nenhuma usa `pesoDia` como base.
 */
export function revenueCurve(fs: Store[], competence: string): RevenueCurve {
  const primeiroDia = `${competence}-01`;
  const ultimoDia = endOfMonth(primeiroDia);
  const pesos = new Map<string, number>();
  let soma = 0;
  for (const iso of eachDay(primeiroDia, ultimoDia)) {
    let bruto = 0;
    let abertas = 0;
    for (const f of fs) {
      if (!storeOpen(f, iso)) continue;
      const ocas = ocorrenciasAnteriores(f, iso, 4);
      bruto += ocas.length > 0 ? ocas.reduce((s, d) => s + d.total.revenue, 0) / ocas.length : dayWeight(f, iso);
      abertas++;
    }
    if (abertas === 0) continue; // nenhuma loja abre nesse dia
    pesos.set(iso, bruto);
    soma += bruto;
  }
  return {
    soma,
    peso: (iso: string) => (soma > 0 ? (pesos.get(iso) ?? 0) / soma : 0),
    pesoBruto: (iso: string) => pesos.get(iso) ?? 0,
  };
}

/** As ultimas `n` ocorrencias anteriores do mesmo dia da semana, com loja aberta (AD-034). */
function ocorrenciasAnteriores(f: Store, iso: string, n: number): DiaVendasVendas[] {
  const out: DiaVendasVendas[] = [];
  for (let i = 7; out.length < n && i <= 28; i += 7) {
    const ref = addDays(iso, -i);
    const d = salesDay(f.id, ref);
    // So contam ocorrencias com loja aberta e registro no historico (undefined antes do inicio).
    if (d && storeOpen(f, ref)) out.push(d);
  }
  return out;
}

/** Tipo minimo de DiaVendas usado pelas curvas. */
interface DiaVendasVendas {
  data: string;
  total: { revenue: number; salesCount: number };
}

/** Meta acumulada esperada ate hoje: meta mensal x fracao acumulada da curvaReceita (LOJA-01 AC 2-7). */
function goalThroughToday(fs: Store[], competence: string, goalAmount: number, todayIso: string): number {
  const curva = revenueCurve(fs, competence);
  const primeiroDia = `${competence}-01`;
  let fração = 0;
  for (const iso of eachDay(primeiroDia, todayIso)) fração += curva.peso(iso);
  return goalAmount * fração;
}

/** Status do trilho do mes (LOJA-01). */
function calculateTrack(fs: Store[], competence: string): TrackView | null {
  const goalStores = fs.map((f) => goalOfStore(f.id, competence)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (goalStores.length === 0) return null;
  const amount = goalStores.reduce((s, m) => s + m.storeAmount, 0);

  const primeiroDia = `${competence}-01`;
  const ultimoDia = endOfMonth(primeiroDia);
  const fechada = ultimoDia < TODAY_ISO;
  const fimReal = fechada ? ultimoDia : TODAY_ISO;
  const achieved = fs.reduce((s, f) => s + periodAggregate(f, primeiroDia, fimReal, null).revenue, 0);

  const goalAccumulated = goalThroughToday(fs, competence, amount, fimReal);

  let status: TrackStatus;
  let pctTrilho: number | null;
  if (fechada) {
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
  if (goalStores.length === 0) return { amount: null, achievedToday: 0, faltaRestante: 0, daysRemaining: 0, diaReferencia: TODAY_ISO, cumpridaHoje: false, metaMesAtingida: false, noGoal: true };

  const amount = goalStores.reduce((s, m) => s + m.storeAmount, 0);
  const primeiroDia = `${competence}-01`;
  const ultimoDia = endOfMonth(primeiroDia);
  const fechada = ultimoDia < TODAY_ISO;
  const fimReal = fechada ? ultimoDia : TODAY_ISO;
  const achieved = fs.reduce((s, f) => s + periodAggregate(f, primeiroDia, fimReal, null).revenue, 0);
  if (fechada) return null;

  const achievedToday = fs.reduce((s, f) => s + (salesDay(f.id, TODAY_ISO) ? dayAggregate(salesDay(f.id, TODAY_ISO)!, null).revenue : 0), 0);
  const faltaRestante = amount - achieved;
  const curva = revenueCurve(fs, competence);
  const remainingOpen = eachDay(TODAY_ISO, ultimoDia).filter((iso) => fs.some((f) => storeOpen(f, iso)));
  if (remainingOpen.length === 0) return null;

  // Dia de referencia: hoje se aberto, senao o proximo dia aberto (LOJA-02 AC 5).
  const diaRef = fs.some((f) => storeOpen(f, TODAY_ISO)) ? TODAY_ISO : remainingOpen[0];
  const todayWeight = curva.peso(diaRef);
  const somaPesosRest = remainingOpen.reduce((s, iso) => s + curva.peso(iso), 0);
  const faltaRestanteRef = amount - achieved; // gap absoluto no mes (sem descontar a projecao futura)
  const necessarioBruto = somaPesosRest > 0 ? (faltaRestanteRef * todayWeight) / somaPesosRest : 0;
  const todayAmount = Math.max(0, necessarioBruto - (diaRef === TODAY_ISO ? achievedToday : 0));

  return {
    amount: todayAmount,
    achievedToday,
    faltaRestante,
    daysRemaining: remainingOpen.length,
    diaReferencia: diaRef,
    cumpridaHoje: todayAmount === 0 && achieved > 0,
    metaMesAtingida: achieved >= amount,
    noGoal: false,
  };
}

/** Projecao de fechamento (LOJA-03): indice da competencia x curva restante, com gate do dia 7. */
function calculateProjection(fs: Store[], competence: string): ProjectionView {
  const goalStores = fs.map((f) => goalOfStore(f.id, competence)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const amount = goalStores.reduce((s, m) => s + m.storeAmount, 0);
  if (goalStores.length === 0) return { amount: null, disponivel: false, encerrada: false, indice: null, goalAmount: 0 };

  const primeiroDia = `${competence}-01`;
  const ultimoDia = endOfMonth(primeiroDia);
  const fechada = ultimoDia < TODAY_ISO;
  const fimReal = fechada ? ultimoDia : TODAY_ISO;
  const achieved = fs.reduce((s, f) => s + periodAggregate(f, primeiroDia, fimReal, null).revenue, 0);

  if (fechada) return { amount: achieved, disponivel: false, encerrada: true, indice: null, goalAmount: amount };

  const diaDoMes = isoToDate(fimReal).getDate();
  if (diaDoMes < 7) return { amount: null, disponivel: false, encerrada: false, indice: null, goalAmount: amount };

  const goalAccumulated = goalThroughToday(fs, competence, amount, fimReal);
  const indice = goalAccumulated > 0 ? achieved / goalAccumulated : 0;
  const fracaoRestante = 1 - goalThroughToday(fs, competence, 1, fimReal);
  const projection = achieved + amount * fracaoRestante * indice;
  return { amount: projection, disponivel: true, encerrada: false, indice, goalAmount: amount };
}

/** curvaAtendimentos (AD-034): pesos diarios normalizados a partir do historico de atendimentos. */
function salesCurve(fs: Store[], competence: string): RevenueCurve {
  const primeiroDia = `${competence}-01`;
  const ultimoDia = endOfMonth(primeiroDia);
  const pesos = new Map<string, number>();
  let soma = 0;
  for (const iso of eachDay(primeiroDia, ultimoDia)) {
    let bruto = 0;
    let abertas = 0;
    for (const f of fs) {
      if (!storeOpen(f, iso)) continue;
      const ocas = ocorrenciasAnteriores(f, iso, 4);
      bruto += ocas.length > 0 ? ocas.reduce((s, d) => s + d.total.salesCount, 0) / ocas.length : dayWeight(f, iso);
      abertas++;
    }
    if (abertas === 0) continue;
    pesos.set(iso, bruto);
    soma += bruto;
  }
  return {
    soma,
    peso: (iso: string) => (soma > 0 ? (pesos.get(iso) ?? 0) / soma : 0),
    pesoBruto: (iso: string) => pesos.get(iso) ?? 0,
  };
}

/** Diagnostica a lacuna de receita entre fluxo e ticket (LOJA-04 AC 1-9). */
function calculateGap(fs: Store[], competence: string, pctTrilho: number | null): GapView {
  const goalStores = fs.map((f) => goalOfStore(f.id, competence)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (goalStores.length === 0) return { exibir: false, efeitoFluxo: 0, efeitoTicket: 0, gapTotal: 0, alavancaDominante: null, noGoal: true };

  const goal = goalStores.reduce((s, m) => s + m.storeAmount, 0);
  const primeiroDia = `${competence}-01`;
  const ultimoDia = endOfMonth(primeiroDia);
  const fechada = ultimoDia < TODAY_ISO;
  const fimReal = fechada ? ultimoDia : TODAY_ISO;

  // Atendimentos esperados no mes: soma da curvaAtendimentos (peso normalizado x faturamento? Nao - 
  // e o total esperado de atendimentos do mes). O total esperado = (media diaria x dias abertos).
  const cA = salesCurve(fs, competence);
  const cR = revenueCurve(fs, competence);
  // Total esperado do mes = soma dos pesos brutos de atendimentos (cada dia = media de 4 semanas).
  const totalEsperadoMes = cA.soma; // soma dos pesos brutos = media diaria x n dias  -  ja e n atendimentos esperados.
  const goalTicket = totalEsperadoMes > 0 ? goal / totalEsperadoMes : 0;

  // Atendimentos esperados ate hoje = total mensal x fracao acumulada da curvaReceita.
  const fracaoAcumReceita = eachDay(primeiroDia, fimReal).reduce((s, iso) => s + cR.peso(iso), 0);
  const expectedSalesThroughToday = totalEsperadoMes * fracaoAcumReceita;

  // Atendimentos realizados ate hoje.
  const actualSalesThroughToday = fs.reduce((s, f) => s + periodAggregate(f, primeiroDia, fimReal, null).salesCount, 0);

  // Ticket realizado ate hoje.
  const realizadoReceita = fs.reduce((s, f) => s + periodAggregate(f, primeiroDia, fimReal, null).revenue, 0);
  const actualTicketThroughToday = actualSalesThroughToday > 0 ? realizadoReceita / actualSalesThroughToday : 0;

  // Efeitos (LOJA-04 AC 5-6); interacao ja contida no efeito fluxo.
  const efeitoFluxo = (expectedSalesThroughToday - actualSalesThroughToday) * goalTicket;
  const efeitoTicket = (goalTicket - actualTicketThroughToday) * actualSalesThroughToday;
  const gapTotal = goal * fracaoAcumReceita - realizadoReceita;

  // Alavanca dominante (AC 8-9): apenas efeitos positivos; maior  60% da soma dos positivos.
  const positivos = [efeitoFluxo, efeitoTicket].filter((e) => e > 0);
  const somaPositivos = positivos.reduce((s, e) => s + e, 0);
  let alavancaDominante: GapView["alavancaDominante"] = null;
  if (somaPositivos > 0 && positivos.length > 0) {
    const maior = Math.max(...positivos);
    if (maior >= 0.6 * somaPositivos) alavancaDominante = efeitoFluxo >= efeitoTicket ? "fluxo" : "ticket";
  }

  // Exibe apenas quando pctTrilho < 90 (AD-033).
  return {
    exibir: pctTrilho !== null && pctTrilho < 90,
    efeitoFluxo,
    efeitoTicket,
    gapTotal,
    alavancaDominante,
    noGoal: false,
  };
}

/** Mix do periodo/marca selecionados: participacao por categoria com margem (LOJA-04 AC 10). */
function buildMix(fs: Store[], start: string, end: string, division: Division | null, rotuloPeriodo: string): MixView {
  const categorySummary = new Map<number, { receita: number; cmv: number }>();
  for (const f of fs) {
    for (const d of salesDays(f.id, start, end)) {
      for (const [id, c] of Object.entries(d.porCategoria)) {
        const cat = categorias.find((x) => x.id === Number(id));
        if (!cat || (division && cat.division !== division)) continue;
        let acc = categorySummary.get(cat.id);
        if (!acc) {
          acc = { receita: 0, cmv: 0 };
          categorySummary.set(cat.id, acc);
        }
        acc.receita += c.revenue;
        acc.cmv += c.cmv;
      }
    }
  }
  const total = [...categorySummary.values()].reduce((s, c) => s + c.receita, 0);
  const itens = [...categorySummary.entries()]
    .map(([id, c]) => {
      const cat = categorias.find((x) => x.id === id)!;
      const margem = c.receita - c.cmv;
      return { categoria: cat.name, division: cat.division, margem, receita: c.receita, pct: total > 0 ? (c.receita / total) * 100 : 0 };
    })
    .sort((a, b) => b.receita - a.receita);
  return { itens, period: rotuloPeriodo };
}

/** Visao de grupo (LOJA-05): status do trilho por loja na competencia. */
function buildGroupStores(fs: Store[], competence: string): StoreSummaryView[] {
  return fs.map((f) => {
    const trilho = calculateTrack([f], competence);
    return {
      storeId: f.id,
      name: f.fantasia,
      pctTrilho: trilho?.pctTrilho ?? null,
      status: trilho?.status ?? "below",
      temMeta: Boolean(goalOfStore(f.id, competence)),
    };
  });
}

export function buildStoreView(scope: Scope): StoreView {
  const period = resolvePeriod(scope.period);
  const fs = storesInScope(scope);
  const division = scope.division;
  const todas = scope.storeIds.length === 0 || scope.storeIds.length > 1;
  const unica = todas ? null : fs[0];
  const scopeView: StoreView["scopeView"] = todas ? "network" : period.granularity === "day" ? "day" : "period";

  const atual = sumAggregates(fs.map((f) => periodAggregate(f, period.start, period.end, division)));
  const ant = previousPeriod(period);
  const anterior = sumAggregates(fs.map((f) => periodAggregate(f, ant.start, ant.end, division, ant.horaMax)));

  const ticket = divSeguro(atual.revenue, atual.salesCount);
  const pa = divSeguro(atual.itens, atual.salesCount);
  const ticketAnt = divSeguro(anterior.revenue, anterior.salesCount);
  const paAnt = divSeguro(anterior.itens, anterior.salesCount);

  const temComparacao = anterior.salesCount > 0;
  const vsLabel = temComparacao ? ant.label : undefined;
  const series = trendSeries(fs, period, division);
  const kpiTicket: KpiValor = { amount: brl(ticket), delta: temComparacao ? kpiDelta(ticket, ticketAnt, vsLabel) : undefined, serie: series.ticket };
  const kpiPA: KpiValor = { amount: num(pa, 2), delta: temComparacao ? kpiDelta(pa, paAnt, vsLabel, "pa") : undefined, serie: series.pa };

  // Meta e sempre mensal. Divisao ou periodo cruzando meses desligam.
  const competence = period.granularity === "month" ? period.start.slice(0, 7) : TODAY_ISO.slice(0, 7);
  const noGoalInPeriod = period.spansMonths && period.granularity !== "month";
  const goalCalc = division || noGoalInPeriod ? null : calculateGoal(fs, competence);

  // Subtitulos: cada KPI fala so do proprio indicador (AD-048).
  // Faturamento NAO repete atendimentos nem "precisa R$/dia" (regua/meta cobrem ritmo).
  const periodDayCount = eachDay(period.start, period.end).length;
  let subFaturamento: string | undefined;
  if (!division && goalCalc) {
    if (goalCalc.attainmentPct >= 100) subFaturamento = "meta do mês atingida";
    else if (period.granularity === "month") subFaturamento = `${pct(goalCalc.attainmentPct)} da meta`;
    else subFaturamento = `${pct(goalCalc.attainmentPct)} da meta do mês`;
  } else if (period.granularity !== "day" && periodDayCount > 0) {
    subFaturamento = `média ${brlK(atual.revenue / periodDayCount)}/dia`;
  }

  const kpiSalesCount: KpiValor = {
    amount: num(atual.salesCount),
    delta: temComparacao ? kpiDelta(atual.salesCount, anterior.salesCount, vsLabel, "vendas") : undefined,
    serie: series.salesCount,
    sub: period.granularity !== "day" && periodDayCount > 0 ? `média ${num(atual.salesCount / periodDayCount, 0)}/dia` : undefined,
  };

  const kpiRevenue: KpiValor = {
    amount: brlK(atual.revenue),
    delta: temComparacao ? kpiDelta(atual.revenue, anterior.revenue, vsLabel) : undefined,
    serie: series.revenue,
    // O periodo ja esta no filtro logo acima do card; sem sufixo " |  HOJE".
    // A marca selecionada continua no rotulo porque muda o dado.
    label: `FATURAMENTO${division ? ` ${division}` : ""}`,
    sub: subFaturamento,
  };

  // Segundo tile: Participacao da marca quando filtrado, Meta/Projecao quando nao.
  let tileMeta: GoalProjectionTile | null = null;
  if (division) {
    const totalTudo = sumAggregates(fs.map((f) => periodAggregate(f, period.start, period.end, null))).revenue;
    const participacaoPct = totalTudo > 0 ? (atual.revenue / totalTudo) * 100 : 0;
    tileMeta = {
      kind: "participacao",
      label: "PARTICIPAÇÃO",
      valorPrincipal: pct(participacaoPct),
      barPct: Math.min(100, participacaoPct),
      detail: `do faturamento da ${scopeView === "network" ? "rede" : "loja"}`,
    };
  } else if (noGoalInPeriod) {
    tileMeta = { kind: "unavailable", label: "META DO MÊS", valorPrincipal: "—", barPct: 0, detail: "meta é mensal" };
  } else if (goalCalc) {
    if (period.granularity === "month") {
      if (!goalCalc.fechada && goalCalc.projection === null) {
        tileMeta = { kind: "projecao", label: "PROJEÇÃO", valorPrincipal: "—", barPct: 0, detail: "Projeção disponível a partir do dia 7" };
      } else {
        const valorFinal = goalCalc.fechada ? goalCalc.achieved : goalCalc.projection!;
        const pctFinal = goalCalc.amount > 0 ? (valorFinal / goalCalc.amount) * 100 : 0;
        tileMeta = {
          kind: "projecao",
          label: "PROJEÇÃO",
          valorPrincipal: brlK(valorFinal),
          barPct: Math.min(100, pctFinal),
          detail: `${pct(pctFinal)} da meta · ${statusRitmo(goalCalc)}`,
        };
      }
    } else {
      tileMeta = {
        kind: "meta",
        label: "META DO MÊS",
        valorPrincipal: pct(goalCalc.attainmentPct),
        barPct: Math.min(100, goalCalc.attainmentPct),
        detail: `${brlK(goalCalc.achieved)} de ${brlK(goalCalc.amount)} · ${statusRitmo(goalCalc)}`,
      };
    }
  }

  // Ritmo da meta: aparece em qualquer visao (rede ou loja) sempre que houver
  // uma meta mensal aplicavel  -  some so com marca filtrada ou periodo cruzando
  // meses (metaCalc ja vem null nesses dois casos). Sem meta cadastrada, uma
  // linha de aviso no lugar do card. Mes fechado: "Projecao" vira "Fechou em".
  let ritmo: RitmoCard | null = null;
  let ritmoAviso: string | null = null;
  if (!division && !noGoalInPeriod) {
    if (!goalCalc) {
      ritmoAviso = `Sem meta cadastrada para ${monthYear(`${competence}-01`).split(" de ")[0]}.`;
    } else {
      const ritmoDiario = goalCalc.diaDoMes > 0 ? goalCalc.achieved / goalCalc.diaDoMes : 0;
      const necessarioTexto = goalCalc.necessarioDia !== null ? brlK(goalCalc.necessarioDia) : goalCalc.attainmentPct >= 100 ? "Meta batida" : "—";
      const barPct = goalCalc.fechada
        ? Math.min(100, goalCalc.attainmentPct)
        : goalCalc.projection !== null && goalCalc.amount > 0
          ? Math.min(100, (goalCalc.projection / goalCalc.amount) * 100)
          : 0;
      ritmo = {
        realizadoDia: brlK(ritmoDiario),
        necessarioDia: necessarioTexto,
        barPct,
        projecaoLinha: goalCalc.fechada ? `Fechou em ${brlK(goalCalc.achieved)}` : goalCalc.projection !== null ? `Projeção ${brlK(goalCalc.projection)}` : "Projeção disponível a partir do dia 7",
      };
    }
  }

  const notices: string[] = [];
  if (noGoalInPeriod) notices.push("Meta e lucro bruto são mensais e não aparecem neste período.");
  if (division) notices.push(`Marca ${division} selecionada. Meta e projeção são da filial inteira e não aparecem no recorte por marca.`);

  /* --- Regua de lojas e pontos de atencao --- */
  let regua: RulerRow[] | null = null;
  let pontosAtencao: AttentionPoint[] | null = null;
  let reguaTitulo: string = "Desempenho das filiais";
  // Sempre adaptamos ao filtro (AD-047): rede = uma linha por loja; loja unica =
  // painel de meta (ou de participacao da marca, se houver marca). Nunca some.
  if (scopeView === "network" || unica) {
    const variacaoBadge = (v: number | null): { value: string; positive: boolean } | null => {
      if (v === null) return null;
      if (Math.abs(v) < 0.5) return { value: "=", positive: true };
      return { value: fmtDelta(v, Math.abs(v) < 10 ? 1 : 0).replace(/^[+−]/, ""), positive: v >= 0 };
    };
    const variacaoDoDia = (f: Store) => {
      const todayStore = dayAggregate(salesDay(f.id, TODAY_ISO)!, division).revenue;
      const refIso = addDays(TODAY_ISO, -7);
      const diaRef = salesDay(f.id, refIso);
      const refF = diaRef ? dayAggregate(diaRef, division, CURRENT_HOUR).revenue : 0;
      return refF > 0 ? pctDelta(todayStore, refF) : null;
    };

    if (unica && division) {
      // Loja + marca: painel da participacao da marca no faturamento da loja.
      const brandRevenue = periodAggregate(unica, period.start, period.end, division).revenue;
      const storeRevenue = periodAggregate(unica, period.start, period.end, null).revenue;
      const participacao = storeRevenue > 0 ? (brandRevenue / storeRevenue) * 100 : 0;
      const indiceCor = stores.findIndex((x) => x.id === unica.id);
      reguaTitulo = `Desempenho · ${division === "WPINK" ? "Wpink" : "Wepink"}`;
      regua = [
        {
          storeId: unica.id,
          name: unica.fantasia,
          revenue: brlK(brandRevenue),
          revenueAmount: brandRevenue,
          attainmentPct: participacao,
          atingimentoTexto: `${pct(participacao)} da filial`,
          barPct: Math.min(100, participacao),
          tint: STORE_TINTS[indiceCor % STORE_TINTS.length],
          variacaoDia: variacaoBadge(variacaoDoDia(unica)),
          variacaoDiaValor: variacaoDoDia(unica),
        },
      ];
      pontosAtencao = null;
    } else if (division) {
      // Rede + marca: a barra vira participacao daquela loja no total da marca.
      const receitas = fs.map((f) => ({ f, receita: periodAggregate(f, period.start, period.end, division).revenue }));
      const brandTotal = receitas.reduce((s, r) => s + r.receita, 0);
      regua = receitas
        .map(({ f, receita }) => {
          const participacao = brandTotal > 0 ? (receita / brandTotal) * 100 : 0;
          const indiceCor = stores.findIndex((x) => x.id === f.id);
          return { storeId: f.id, name: f.fantasia, receita, participacao, tint: STORE_TINTS[indiceCor % STORE_TINTS.length], variacaoDiaValor: variacaoDoDia(f) };
        })
        .sort((a, b) => b.participacao - a.participacao)
        .map((b) => ({
          storeId: b.storeId,
          name: b.name,
          revenue: brlK(b.receita),
          revenueAmount: b.receita,
          attainmentPct: b.participacao,
          atingimentoTexto: `${pct(b.participacao)} da marca`,
          barPct: Math.min(100, b.participacao),
          tint: b.tint,
          variacaoDia: variacaoBadge(b.variacaoDiaValor),
          variacaoDiaValor: b.variacaoDiaValor,
        }));
      pontosAtencao = null;
    } else {
      // Titulo no singular quando o escopo tem uma loja so (painel de meta dela);
      // plural na rede. Nao ha variacao de hoje nem ordenacao na loja unica.
      reguaTitulo = fs.length > 1 ? "Desempenho das filiais" : "Desempenho da filial";
      const base = fs.map((f) => {
        const m = calculateGoal([f], competence);
        const attainment = m?.attainmentPct ?? 0;
        const indiceCor = stores.findIndex((x) => x.id === f.id);
        return { storeId: f.id, name: f.fantasia, attainment, tint: STORE_TINTS[indiceCor % STORE_TINTS.length], variacaoDiaValor: variacaoDoDia(f), m };
      });

      regua = [...base]
        .sort((a, b) => a.attainment - b.attainment)
        .map((b) => ({
          storeId: b.storeId,
          name: b.name,
          revenue: brlK(b.m?.achieved ?? 0),
          revenueAmount: b.m?.achieved ?? 0,
          attainmentPct: b.attainment,
          atingimentoTexto: `${pct(b.attainment)} da meta`,
          barPct: Math.min(100, b.attainment),
          tint: b.tint,
          variacaoDia: variacaoBadge(b.variacaoDiaValor),
          variacaoDiaValor: b.variacaoDiaValor,
        }));

      // Ordenada por desempenho (regua), nao por faturamento: quem esta pior no
      // ritmo da propria meta aparece primeiro, seja loja grande ou pequena.
      pontosAtencao = base
        .filter((b) => b.m?.veredito === "nao_atinge" || b.m?.veredito === "incerto")
        .sort((a, b) => a.attainment - b.attainment)
        .map((b) => ({
          storeId: b.storeId,
          name: b.name,
          atingimentoTexto: pct(b.attainment),
          status: statusRitmo(b.m!),
          faltaPorDia: b.m?.necessarioDia !== null && b.m?.necessarioDia !== undefined ? brlK(b.m.necessarioDia) : "Meta batida",
          veredito: b.m!.veredito as "nao_atinge" | "incerto",
        }));
    }
  }

  /* --- Por hora: loja unica OU rede (soma)  -  mesmo grafico AreaLine com comparacao (AD-048) --- */
  let graficoHora: HourChart | null = null;
  if (period.granularity === "day" && fs.length > 0) {
    const refIso = addDays(period.start, -7);
    const aberturaMin = Math.min(...fs.map((f) => f.abertura));
    const fechamentoMax = Math.max(...fs.map((f) => f.fechamento));
    const horas: number[] = [];
    for (let h = aberturaMin; h < fechamentoMax; h++) horas.push(h);

    const fatiaHora = (storeId: string, iso: string, h: number) => {
      const d = salesDay(storeId, iso);
      const a = d?.porHora[h];
      if (!a) return 0;
      if (!division) return a.revenue;
      const fr = d!.total.revenue > 0 ? d!.byDivision[division].revenue / d!.total.revenue : 0;
      return Math.round(a.revenue * fr);
    };
    const somaHora = (iso: string, h: number) => fs.reduce((s, f) => s + fatiaHora(f.id, iso, h), 0);

    const valores = horas.map((h) => somaHora(period.start, h));
    const valoresAnt = horas.map((h) => {
      if (period.isToday && h > CURRENT_HOUR) return 0;
      return somaHora(refIso, h);
    });
    const totalRef = valoresAnt.reduce((s, v) => s + v, 0);

    graficoHora = {
      horas,
      valores,
      anterior: totalRef > 0 ? valoresAnt : null,
      rotuloAnterior: `${DIAS_SEMANA[isoToDate(refIso).getDay()]} passada`,
      horaAtual: period.isToday ? CURRENT_HOUR : null,
    };
  }

  /* Rede por loja empilhada: nao usada na Visao geral  -  o grafico principal unificou em AreaLine (AD-048). */
  const graficoHoraRede: NetworkHourChart | null = null;

  /* --- Evolucao diaria: periodo > 1 dia (loja unica OU rede)  -  AD-047 --- */
  let evolucao: EvolutionChart | null = null;
  if (period.granularity !== "day") {
    const dias = eachDay(period.start, period.end);
    const diasAnt = eachDay(ant.start, ant.end);
    const valores = dias.map((iso) => sumAggregates(fs.map((f) => dayAggregate(salesDay(f.id, iso)!, division))).revenue);
    const anteriores = diasAnt.map((iso) => sumAggregates(fs.map((f) => (salesDay(f.id, iso) ? dayAggregate(salesDay(f.id, iso)!, division) : { revenue: 0, salesCount: 0, itens: 0 }))).revenue);
    evolucao = {
      rotulos: dias.map((iso) => dayAxisLabel(iso, period)),
      valores,
      anterior: anteriores.length === valores.length ? anteriores : null,
      rotuloAnterior: ant.label,
    };
  }

  /* --- Checklist do dia: todos os grupos da loja, em Hoje ou Ontem --- */
  let checklist: DayChecklist | null = null;
  if (unica && (period.kind === "today" || period.kind === "yesterday")) {
    const groupsForStore = groups.filter((x) => x.storeId === unica.id).sort((a, b) => a.horaInicio - b.horaInicio);
    if (groupsForStore.length > 0) {
      // Mock de conclusao: grupo encerrado sai como tudo feito, grupo em
      // andamento usa uma marcacao fixa por grupo, grupo futuro nada feito.
      const feitasEmAndamento: Record<string, string[]> = { "t-f1-manha": ["tf1", "tf2", "tf3", "tf5"], "t-f2-tarde": ["tf14"] };
      const linhas: GroupRow[] = groupsForStore.map((t) => {
        const estado: GroupRow["estado"] = period.kind === "yesterday" ? "encerrado" : CURRENT_HOUR >= t.horaFim ? "encerrado" : CURRENT_HOUR >= t.horaInicio ? "andamento" : "naoComecou";
        const tarefasDoGrupo = tarefas.filter((x) => x.grupoId === t.id).sort((a, b) => a.ordem - b.ordem);
        const feitasIds = estado === "andamento" ? (feitasEmAndamento[t.id] ?? []) : estado === "encerrado" ? tarefasDoGrupo.map((x) => x.id) : [];
        const itens = tarefasDoGrupo.map((x) => ({ title: x.title, feita: feitasIds.includes(x.id) }));
        return {
          id: t.id,
          name: t.name,
          horario: `${Math.max(t.horaInicio, unica.abertura)}h às ${Math.min(t.horaFim, unica.fechamento)}h`,
          estado,
          feitas: itens.filter((i) => i.feita).length,
          total: itens.length,
          tarefas: itens,
        };
      });
      checklist = { dataTexto: shortDate(period.start), groups: linhas };
    }
  }

  /* --- Lucro bruto e categorias: periodo de mes, dentro de uma loja. Continuam filtrados por marca. --- */
  let lucroBruto: StoreView["lucroBruto"] = null;
  let cats: CategoryRow[] | null = null;
  if (scopeView === "period" && period.granularity === "month") {
    const custo = periodCost(fs, period.start, period.end, division);
    const lucro = atual.revenue - custo.cmv;

    let divisaoLinha: string | null = null;
    if (unica?.temWpink && !division) {
      const wepink = periodAggregate(unica, period.start, period.end, "WEPINK").revenue;
      const wpink = periodAggregate(unica, period.start, period.end, "WPINK").revenue;
      const brandTotal = wepink + wpink;
      if (brandTotal > 0) divisaoLinha = `Wepink ${brlK(wepink)} · ${pct((wepink / brandTotal) * 100, 0)} — Wpink ${brlK(wpink)} · ${pct((wpink / brandTotal) * 100, 0)}`;
    }

    lucroBruto = {
      itens: [
        { label: "Faturamento", amount: brl(atual.revenue), pct: "100%" },
        { label: "CMV", amount: brl(custo.cmv), pct: pct(divSeguro(custo.cmv, atual.revenue) * 100) },
        { label: "Lucro bruto", amount: brl(lucro), pct: pct(divSeguro(lucro, atual.revenue) * 100) },
      ],
      aviso: "Configure aluguel e custo fixo para ver a margem de contribuição.",
      divisaoLinha,
    };

    const catsBase = Object.entries(custo.porCategoria)
      .map(([id, v]) => {
        const cat = categorias.find((c) => c.id === Number(id))!;
        const margem = v.revenue - v.cmv;
        return { categoriaId: cat.id, name: cat.name, margemValor: margem, receita: brl(v.revenue), margem: brl(margem), margemPct: pct(divSeguro(margem, v.revenue) * 100) };
      })
      .sort((a, b) => b.margemValor - a.margemValor)
      .slice(0, 4);
    const maiorMargem = Math.max(...catsBase.map((c) => c.margemValor), 1);
    cats = catsBase.map(({ categoriaId, name, receita, margem, margemPct, margemValor }) => ({
      categoriaId,
      name,
      receita,
      margem,
      margemPct,
      barPct: Math.max(0, Math.round((margemValor / maiorMargem) * 100)),
    }));
  }

  // Motor de trilho: sempre da competencia do periodo (AD-023).
  const trackCompetence = period.granularity === "month" ? period.start.slice(0, 7) : TODAY_ISO.slice(0, 7);
  const trilho = calculateTrack(fs, trackCompetence);
  const vendaNecessaria = trilho ? salesNeededToday(fs, trackCompetence) : null;

  const view: StoreView = {
    scope,
    period,
    atualizadoAs: UPDATED_AT,
    proximoSyncMin: Math.max(0, SYNC_INTERVAL_MIN - Math.floor((NOW.getTime() - LAST_SYNC.getTime()) / 60000)),
    scopeView,
    alertas: buildAlerts(fs),
    leitura: null,
    notices,
    comparacao: temComparacao
      ? {
          atual: { start: period.start, end: period.end, revenue: atual.revenue, salesCount: atual.salesCount, itens: atual.itens },
          anterior: { start: ant.start, end: ant.end, revenue: anterior.revenue, salesCount: anterior.salesCount, itens: anterior.itens },
          rotuloAtual: formatRange(period.start, period.end),
          rotuloAnterior: formatRange(ant.start, ant.end),
        }
      : null,
    trilho,
    vendaNecessaria,
    projection: calculateProjection(fs, trackCompetence),
    diagnostico: calculateGap(fs, trackCompetence, trilho?.pctTrilho ?? null),
    mix: scopeView === "period" ? buildMix(fs, period.start, period.end, division, period.label) : null,
    storeRows: todas && period.granularity === "month" ? buildGroupStores(fs, trackCompetence) : [],
    states: {
      kpis: "available",
      trilho: trilho ? "available" : "noData",
      vendaNecessaria: vendaNecessaria ? "available" : "noData",
      projection: trilho && vendaNecessaria ? "available" : trilho ? "noData" : "unavailable",
      diagnostico: trilho?.status === "below" ? "available" : "noData",
      mix: scopeView === "period" ? "available" : "noData",
      storeRows: todas && period.granularity === "month" ? "available" : "noData",
    },
    kpiRevenue,
    kpiTicket,
    kpiPA,
    kpiSalesCount,
    tileMeta,
    ritmo,
    ritmoAviso,
    regua,
    reguaTitulo,
    pontosAtencao,
    graficoHora,
    graficoHoraRede,
    evolucao,
    checklist,
    lucroBruto,
    categorias: cats,
  };
  view.leitura = buildStoreInsight(view);
  return view;
}

/* ================================================================
 * TELA FINANCEIRO  -  camada de dados (montarFinanceiroView)
 * ================================================================ */

export interface FinanceKpi {
  label: string;
  value: string;
  delta?: { value: string; positive: boolean; vs?: string; anterior?: string };
  serie?: number[];
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
  kpiItens?: FinanceKpi;
  /** Faturamento do periodo (R$)  -  aviso "sem vendas" independente do eixo. */
  periodRevenue?: number;
  /** Produtos vendidos no periodo com custo R$ 0 no Millennium (maior faturamento primeiro). */
  productsWithoutCost?: ProductWithoutCost[];
}

const CORES_FORMAS: Record<string, string> = {
  Pix: "var(--ok)",
  "Cartão de crédito": "var(--acc)",
  "Cartão de débito": "var(--info)",
  Dinheiro: "var(--warn)",
};

/** Percentuais mockados de custos variaveis sobre faturamento (parametrizacao futura). */
const PCT_CUSTOS_FIXOS = {
  aluguelShopping: 5,
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
  const c = f.custos;
  return {
    aluguelFixo: c?.rentMin ?? mockFixedRent(f),
    aluguelWepinkPct: c?.rentWepinkPct ?? PCT_CUSTOS_FIXOS.aluguelShopping,
    aluguelWpinkPct: c?.rentWpinkPct ?? PCT_CUSTOS_FIXOS.aluguelShopping,
    royaltiesWepinkPct: c?.royaltiesWepinkPct ?? PCT_CUSTOS_FIXOS.royaltiesWepink,
    royaltiesWpinkPct: c?.royaltiesWpinkPct ?? PCT_CUSTOS_FIXOS.royaltiesWpink,
    mktWepinkPct: c?.marketingWepinkPct ?? PCT_CUSTOS_FIXOS.taxaMktWepink,
    mktWpinkPct: c?.marketingWpinkPct ?? PCT_CUSTOS_FIXOS.taxaMktWpink,
  };
}

/** "(5%)" quando todas as lojas usam o mesmo %; vazio se variam. */
function rateSuffix(valores: number[]): string {
  const unicos = [...new Set(valores)];
  return unicos.length === 1 ? ` (${String(unicos[0]).replace(".", ",")}%)` : "";
}

const PRESETS_MENSAIS = new Set<PeriodType>(["thisMonth", "lastMonth", "thisQuarter", "thisHalf", "thisYear"]);
const MESES_ANTERIORES_EVOLUCAO = 5;

/**
 * Meses da Evolucao mensal. Periodo mensal pelo calendario (preset de mes/trimestre/semestre/ano
 * ou personalizado do dia 1 ao fim do mes / hoje)  -  nunca por contagem de dias (fevereiro tem 28).
 * 1 mes so  ->  ele + 5 anteriores (comparacao); varios meses ou eixo por mes  ->  meses do periodo.
 */
export function monthlyEvolutionMonths(
  period: ResolvedPeriod,
  seriesAxis: SeriesAxis,
): { meses: string[]; comAnteriores: boolean } {
  const ofPeriod = monthsBetween(period.start, period.end);
  const mensal =
    PRESETS_MENSAIS.has(period.kind) ||
    (period.kind === "custom" &&
      period.start !== period.end &&
      period.start.endsWith("-01") &&
      (period.end === endOfMonth(period.end) || period.endsToday));
  if (mensal && ofPeriod.length === 1) {
    const [y, m] = ofPeriod[0]!.split("-").map(Number) as [number, number];
    const meses: string[] = [];
    for (let i = MESES_ANTERIORES_EVOLUCAO; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1);
      meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return { meses, comAnteriores: true };
  }
  if (mensal || seriesAxis === "month") return { meses: ofPeriod, comAnteriores: false };
  return { meses: [], comAnteriores: false };
}

/** Nome do mes na Evolucao mensal; ano so se a lista atravessa anos; recorte "(01 a 26)" em mes parcial. */
function monthEvolutionLabel(mes: string, meses: string[], ini?: string, end?: string): string {
  const name = monthYear(`${mes}-01`);
  const base = meses[0]!.slice(0, 4) === meses[meses.length - 1]!.slice(0, 4) ? name.split(" de ")[0]! : name;
  if (!ini || !end || (ini === `${mes}-01` && end === endOfMonth(`${mes}-01`))) return base;
  return `${base} · ${ini.slice(8)} a ${end.slice(8)}`;
}

function evolutionCaption(period: ResolvedPeriod, comAnteriores: boolean): string {
  return comAnteriores ? `${monthYear(period.start)} e meses anteriores` : period.label;
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

function monthAggregate(fs: Store[], mes: string, division: Division | null): Aggregate & { cmv: number; porMeio: Record<string, number> } {
  const start = `${mes}-01`;
  const end = endOfMonth(start);
  const agg = sumAggregates(fs.map((f) => periodAggregate(f, start, end, division)));
  const custo = periodCost(fs, start, end, division).cmv;
  // Soma das formas de pagamento no mes.
  const dias = eachDay(start, end);
  const porMeio: Record<string, number> = {};
  for (const f of fs) {
    for (const diaIso of dias) {
      const dv = salesDay(f.id, diaIso);
      if (!dv) continue;
      for (const [meio, val] of Object.entries(dv.porMeio)) {
        porMeio[meio] = (porMeio[meio] ?? 0) + val;
      }
    }
  }
  return { ...agg, cmv: custo, porMeio };
}

export function buildFinanceView(scope: Scope, aggs?: FinanceAggInput | null): FinanceView {
  if (aggs) return buildFinanceViewFromAggs(scope, aggs);
  const period = resolvePeriod(scope.period);
  const fs = storesInScope(scope);
  const division = scope.division;

  // Atual e anterior para deltas dos KPIs.
  const atual = sumAggregates(fs.map((f) => periodAggregate(f, period.start, period.end, division)));
  const custoAtual = periodCost(fs, period.start, period.end, division).cmv;
  const ant = previousPeriod(period);
  const anterior = sumAggregates(fs.map((f) => periodAggregate(f, ant.start, ant.end, division, ant.horaMax)));
  const custoAnterior = periodCost(fs, ant.start, ant.end, division).cmv;

  const lucroAtual = atual.revenue - custoAtual;
  const lucroAnterior = anterior.revenue - custoAnterior;
  const margemAtual = divSeguro(lucroAtual, atual.revenue) * 100;
  const margemAnterior = divSeguro(lucroAnterior, anterior.revenue) * 100;

  const temComp = anterior.salesCount > 0;
  const vsLabel = temComp ? ant.label : undefined;

  // Series de tendencia (ultimos 7 pontos do periodo, ou 7 dias se periodo curto).
  const revenueSeries = (trendSeries(fs, period, division).revenue ?? []).slice(-7);
  const serieCmv = revenueSeries.map((_, i) => {
    const frac = custoAtual / (atual.revenue || 1);
    return Math.round(revenueSeries[i] * frac);
  });
  const serieLucro = revenueSeries.map((v, i) => v - serieCmv[i]);
  const serieMargem = revenueSeries.map((v, i) => v > 0 ? ((v - serieCmv[i]) / v) * 100 : 0);

  const kpis: FinanceKpi[] = [
    {
      label: "Faturamento",
      value: brlCent(atual.revenue),
      delta: temComp ? kpiDelta(atual.revenue, anterior.revenue, vsLabel) : undefined,
      serie: revenueSeries,
    },
    {
      label: "CMV",
      value: brlCent(custoAtual),
      sub: `${(divSeguro(custoAtual, atual.revenue) * 100).toFixed(0)}% do faturamento`,
      delta: temComp ? kpiDelta(custoAtual, custoAnterior, vsLabel) : undefined,
      serie: serieCmv,
      tooltip: TIP_CMV,
    },
    {
      label: "Lucro bruto",
      value: brlCent(lucroAtual),
      delta: temComp ? kpiDelta(lucroAtual, lucroAnterior, vsLabel) : undefined,
      serie: serieLucro,
      tooltip: TIP_LUCRO_BRUTO,
    },
    {
      label: "Margem",
      value: pct(margemAtual),
      delta: temComp ? kpiDeltaPp(margemAtual, margemAnterior, vsLabel) : undefined,
      serie: serieMargem,
      tooltip: TIP_MARGEM,
    },
  ];

  // Serie de tendencia: eixo hora / dia / mes conforme o periodo filtrado.
  const seriesAxis = seriesAxisForPeriod(period);
  const seriesLabel = seriesAxisLabel(period, seriesAxis);
  const resultIsProrated = seriesAxis !== "month";

  // Faturamento por marca (sempre calculado; donut so quando filtro = todas).
  const fatWepink = sumAggregates(fs.map((f) => periodAggregate(f, period.start, period.end, "WEPINK"))).revenue;
  const fatWpink = sumAggregates(fs.map((f) => periodAggregate(f, period.start, period.end, "WPINK"))).revenue;
  const allBrandsRevenue = fatWepink + fatWpink;

  // Custos por loja (Configuracoes > Lojas): aluguel fixo compartilhado; % so sobre a(s) marca(s) do filtro.
  const incluiWepink = !division || division === "WEPINK";
  const incluiWpink = !division || division === "WPINK";
  const storesCosts = fs.map((f) => ({
    c: storeCostSnapshot(f),
    wepink: incluiWepink ? periodAggregate(f, period.start, period.end, "WEPINK").revenue : 0,
    wpink: incluiWpink ? periodAggregate(f, period.start, period.end, "WPINK").revenue : 0,
  }));
  const somaPct = (fn: (l: (typeof storesCosts)[number]) => number) =>
    Math.round(storesCosts.reduce((s, l) => s + fn(l), 0));
  const aluguelFixo = storesCosts.reduce((s, l) => s + l.c.aluguelFixo, 0);
  const aluguelPct = somaPct((l) => (l.wepink * l.c.aluguelWepinkPct + l.wpink * l.c.aluguelWpinkPct) / 100);
  const royaltiesWepink = somaPct((l) => (l.wepink * l.c.royaltiesWepinkPct) / 100);
  const royaltiesWpink = somaPct((l) => (l.wpink * l.c.royaltiesWpinkPct) / 100);
  const taxaMktWepink = somaPct((l) => (l.wepink * l.c.mktWepinkPct) / 100);
  const taxaMktWpink = somaPct((l) => (l.wpink * l.c.mktWpinkPct) / 100);
  const pctAluguel = rateSuffix(
    storesCosts.flatMap((l) => [
      ...(incluiWepink ? [l.c.aluguelWepinkPct] : []),
      ...(incluiWpink && l.wpink > 0 ? [l.c.aluguelWpinkPct] : []),
    ]),
  );
  const custosAgg = {
    aluguelFixo,
    aluguelPct,
    royaltiesWepink,
    royaltiesWpink,
    taxaMktWepink,
    taxaMktWpink,
  };
  const totalCustosFixos =
    custosAgg.aluguelFixo +
    custosAgg.aluguelPct +
    custosAgg.royaltiesWepink +
    custosAgg.royaltiesWpink +
    custosAgg.taxaMktWepink +
    custosAgg.taxaMktWpink;

  const costProfitSeries: CostProfitMonth[] = [];
  const operatingResult: OpResultMonth[] = [];

  if (seriesAxis === "hour") {
    const abertura = Math.min(...fs.map((f) => f.abertura));
    const fechamento = Math.max(...fs.map((f) => f.fechamento));
    const horas: number[] = [];
    for (let h = abertura; h < fechamento; h++) horas.push(h);
    const horasVisiveis = period.isToday ? horas.filter((h) => h <= CURRENT_HOUR) : horas;
    const diaFat = atual.revenue;
    const diaCmv = custoAtual;
    const ratioCmv = divSeguro(diaCmv, diaFat);
    const custoHora = totalCustosFixos / daysInMonth(period.start.slice(0, 7)) / (horas.length || 1);
    for (const h of horasVisiveis) {
      const fatH = fs.reduce((s, f) => {
        const a = salesDay(f.id, period.start)?.porHora[h];
        if (!a) return s;
        if (!division) return s + a.revenue;
        const dia = salesDay(f.id, period.start)!;
        const fr = dia.total.revenue > 0 ? dia.byDivision[division].revenue / dia.total.revenue : 0;
        return s + Math.round(a.revenue * fr);
      }, 0);
      const cmv = Math.round(fatH * ratioCmv);
      const lucro = fatH - cmv;
      const label = shortHour(h);
      costProfitSeries.push({ label, cost: cmv, profit: lucro, marginPct: divSeguro(lucro, fatH) * 100, revenue: fatH });
      const resultado = lucro - custoHora;
      operatingResult.push({
        label,
        profit: lucro,
        result: resultado,
        operatingMarginPct: divSeguro(resultado, fatH) * 100,
        revenue: fatH,
      });
    }
  } else if (seriesAxis === "day") {
    for (const iso of eachDay(period.start, period.end)) {
      const agg = sumAggregates(fs.map((f) => {
        const d = salesDay(f.id, iso);
        return d ? dayAggregate(d, division) : { revenue: 0, salesCount: 0, itens: 0 };
      }));
      const cmv = periodCost(fs, iso, iso, division).cmv;
      const lucro = agg.revenue - cmv;
      const label = dayAxisLabel(iso, period);
      const detail = dayPointDetail(iso);
      const custoDia = totalCustosFixos / daysInMonth(iso.slice(0, 7));
      costProfitSeries.push({
        label,
        cost: cmv,
        profit: lucro,
        marginPct: divSeguro(lucro, agg.revenue) * 100,
        revenue: agg.revenue,
        rangeLabel: detail,
      });
      const resultado = lucro - custoDia;
      operatingResult.push({
        label,
        profit: lucro,
        result: resultado,
        operatingMarginPct: divSeguro(resultado, agg.revenue) * 100,
        revenue: agg.revenue,
        rangeLabel: detail,
      });
    }
  } else {
    for (const mes of monthsBetween(period.start, period.end)) {
      const agg = monthAggregate(fs, mes, division);
      const lucro = agg.revenue - agg.cmv;
      const label = monthYear(`${mes}-01`).split(" de ")[0];
      costProfitSeries.push({
        label,
        cost: agg.cmv,
        profit: lucro,
        marginPct: divSeguro(lucro, agg.revenue) * 100,
        revenue: agg.revenue,
      });
      const resultado = lucro - totalCustosFixos;
      operatingResult.push({
        label,
        profit: lucro,
        result: resultado,
        operatingMarginPct: divSeguro(resultado, agg.revenue) * 100,
        revenue: agg.revenue,
      });
    }
  }

  const resultadoAtual = lucroAtual - totalCustosFixos;
  const resultadoAnterior = lucroAnterior - totalCustosFixos;
  const resultDelta = temComp ? kpiDelta(resultadoAtual, resultadoAnterior, vsLabel) : undefined;

  // Formas de pagamento no periodo.
  const periodDays = eachDay(period.start, period.end);
  const totaisForma: Record<string, number> = {};
  for (const f of fs) {
    for (const diaIso of periodDays) {
      const dv = salesDay(f.id, diaIso);
      if (!dv) continue;
      for (const [meio, val] of Object.entries(dv.porMeio)) {
        totaisForma[meio] = (totaisForma[meio] ?? 0) + val;
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
      color: CORES_FORMAS[method] ?? "var(--t2)",
    }));

  // Mini-DRE  ->  Resultado Operacional. Linhas de marca so aparecem no filtro correspondente.
  const brandRows: FixedCostRow[] = [];
  if (incluiWepink) {
    brandRows.push(
      { label: `Royalties WEPINK${rateSuffix(storesCosts.map((l) => l.c.royaltiesWepinkPct))}`, amount: custosAgg.royaltiesWepink },
      { label: `Taxa de marketing WEPINK${rateSuffix(storesCosts.map((l) => l.c.mktWepinkPct))}`, amount: custosAgg.taxaMktWepink },
    );
  }
  if (incluiWpink) {
    brandRows.push(
      { label: `Royalties WPINK${rateSuffix(storesCosts.map((l) => l.c.royaltiesWpinkPct))}`, amount: custosAgg.royaltiesWpink },
      { label: `Taxa de marketing WPINK${rateSuffix(storesCosts.map((l) => l.c.mktWpinkPct))}`, amount: custosAgg.taxaMktWpink },
    );
  }
  const franchiseFixedCosts: FixedCostRow[] = [
    { label: "Lucro bruto", amount: lucroAtual },
    { label: "Aluguel fixo", amount: custosAgg.aluguelFixo },
    { label: `Aluguel variável${pctAluguel}`, amount: custosAgg.aluguelPct },
    ...brandRows,
    { label: "Total de custos", amount: totalCustosFixos, isTotal: true },
    { label: "Resultado operacional", amount: resultadoAtual, isResult: true },
  ];

  const revenueByBrand: RevenueByBrand[] | null = division
    ? null
    : [
        { brand: "WEPINK", amount: fatWepink, pct: allBrandsRevenue > 0 ? (fatWepink / allBrandsRevenue) * 100 : 0, color: "var(--wepink)" },
        { brand: "WPINK", amount: fatWpink, pct: allBrandsRevenue > 0 ? (fatWpink / allBrandsRevenue) * 100 : 0, color: "var(--wpink)" },
      ].filter((m) => m.amount > 0);

  const evo = monthlyEvolutionMonths(period, seriesAxis);
  const monthlyEvolutionLabel = evolutionCaption(period, evo.comAnteriores);
  const monthlyEvolution: MonthlyEvolutionRow[] = evo.meses.map((mes) => {
    const agg = monthAggregate(fs, mes, division);
    const lucro = agg.revenue - agg.cmv;
    return {
      label: monthEvolutionLabel(mes, evo.meses),
      revenue: agg.revenue,
      cost: agg.cmv,
      profit: lucro,
      marginPct: divSeguro(lucro, agg.revenue) * 100,
      averageTicket: divSeguro(agg.revenue, agg.salesCount),
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
    showMonthlyEvolution: evo.meses.length > 0,
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
  aluguelPct: number;
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
  fixos: number;
  outras: number;
  /** Aluguel minimo rateado no periodo. */
  aluguelMinBase: number;
  /** Quanto falta para o % chegar no minimo: max(0, minimo  aluguel %), por loja no periodo. */
  aluguelMin: number;
};
type FinLine = FinMoney & FinCosts & FinMonthly & { icms: number; icmsSt: number };

const FIN_ZERO: FinMoney = { rev: 0, cmv: 0, sales: 0, items: 0 };
const FIN_LINE_ZERO: FinLine = {
  ...FIN_ZERO,
  aluguelPct: 0,
  royWepink: 0,
  royWpink: 0,
  mktWepink: 0,
  mktWpink: 0,
  variaveis: 0,
  fixos: 0,
  outras: 0,
  aluguelMinBase: 0,
  aluguelMin: 0,
  icms: 0,
  icmsSt: 0,
};

/** Lucro bruto = Faturamento  CMV  impostos (ICMS sobre o faturamento, ICMS ST sobre o CMV). */
function finLucro(l: FinLine): number {
  return l.rev - l.cmv - l.icms - l.icmsSt;
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
  return l.aluguelPct + l.aluguelMin + l.royWepink + l.royWpink + l.mktWepink + l.mktWpink + l.variaveis + l.fixos + l.outras;
}

/** Custos mensais (fixos, outras despesas, complemento do aluguel minimo)  -  rateados nas horas abertas. */
function finMonthlyCosts(l: FinMonthly): number {
  return l.fixos + l.outras + l.aluguelMin;
}

/** Custos da loja para dados reais: campo sem configuracao = 0 (nao inventa R$). */
function storeCostRates(f: Store) {
  const c = f.custos;
  const rua = f.pointType === "RUA";
  return {
    aluguelMin: c?.rentMin ?? 0,
    aluguelWepinkPct: rua ? 0 : (c?.rentWepinkPct ?? 0),
    aluguelWpinkPct: rua ? 0 : (c?.rentWpinkPct ?? 0),
    royaltiesWepinkPct: c?.royaltiesWepinkPct ?? 0,
    royaltiesWpinkPct: c?.royaltiesWpinkPct ?? 0,
    mktWepinkPct: c?.marketingWepinkPct ?? 0,
    mktWpinkPct: c?.marketingWpinkPct ?? 0,
    icmsWepinkPct: f.custos?.icmsWepinkPct ?? 0,
    icmsWpinkPct: f.custos?.icmsWpinkPct ?? 0,
    icmsStWepinkPct: f.custos?.icmsStWepinkPct ?? 0,
    icmsStWpinkPct: f.custos?.icmsStWpinkPct ?? 0,
  };
}

function productTaxAmount(
  taxa: { icmsWepinkPct: number; icmsWpinkPct: number; icmsStWepinkPct: number; icmsStWpinkPct: number },
  code: string,
  receita: number,
  cmv: number,
): number {
  const wpink = brandFromProductCode(code) === "WPINK";
  return (receita * (wpink ? taxa.icmsWpinkPct : taxa.icmsWepinkPct) + cmv * (wpink ? taxa.icmsStWpinkPct : taxa.icmsStWepinkPct)) / 100;
}

/** Financeiro a partir dos agregados do sync (sem fixture). Custos % por marca; aluguel fixo rateado por dia/hora. */
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
    const cmvW = incluiWepink ? wepink.cmv : 0;
    const cmvP = incluiWpink ? wpink.cmv : 0;
    const diasMes = daysInMonth(iso.slice(0, 7));
    const aluguelPct = (w * c.aluguelWepinkPct + p * c.aluguelWpinkPct) / 100;
    const aluguelMinBase = c.aluguelMin / diasMes;
    return {
      ...m,
      aluguelPct,
      royWepink: (w * c.royaltiesWepinkPct) / 100,
      royWpink: (p * c.royaltiesWpinkPct) / 100,
      mktWepink: (w * c.mktWepinkPct) / 100,
      mktWpink: (p * c.mktWpinkPct) / 100,
      variaveis: 0,
      fixos: 0,
      outras: 0,
      aluguelMinBase,
      aluguelMin: Math.max(0, aluguelMinBase - aluguelPct),
      icms: (w * c.icmsWepinkPct + p * c.icmsWpinkPct) / 100,
      icmsSt: (cmvW * c.icmsStWepinkPct + cmvP * c.icmsStWpinkPct) / 100,
    };
  }

  /** Soma loja x mes: o aluguel do mes e o maior entre o minimo (rateado nos dias do recorte) e o %, nao dia a dia. */
  function sumDays(dias: string[]): FinLine {
    const porMes = new Map<string, string[]>();
    for (const iso of dias) {
      const mes = iso.slice(0, 7);
      porMes.set(mes, [...(porMes.get(mes) ?? []), iso]);
    }
    let acc = FIN_LINE_ZERO;
    for (const f of fs) {
      for (const diasMes of porMes.values()) {
        let store = FIN_LINE_ZERO;
        for (const iso of diasMes) store = finAdd(store, storeDay(f, iso));
        acc = finAdd(acc, { ...store, aluguelMin: Math.max(0, store.aluguelMinBase - store.aluguelPct) });
      }
    }
    return acc;
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
  const atual = sumDays(periodDays);

  // Periodo anterior equivalente. Terminando hoje, o ultimo dia do anterior entra ate a hora atual (precisa das horas).
  const ant = previousPeriod(period, calendarCurrentHour());
  const diasAnt = eachDay(ant.start, ant.end);
  let anterior: FinLine | null = sumDays(diasAnt);
  if (ant.horaMax != null) {
    let parcial = sumDays(diasAnt.slice(0, -1));
    let faltaHora = false;
    for (const f of fs) {
      const dia = storeDay(f, ant.end);
      const horas = storeHours(input.prevHourAggs ?? [], f, dia, ant.end);
      if (horas.size === 0 && dia.rev > 0) faltaHora = true;
      let rev = 0;
      let sales = 0;
      let items = 0;
      for (const [h, m] of horas) {
        if (h > ant.horaMax) continue;
        rev += m.rev;
        sales += m.sales;
        items += m.items;
      }
      const frac = dia.rev > 0 ? rev / dia.rev : 0;
      const escalado = finScale(dia, frac);
      parcial = finAdd(parcial, {
        ...escalado,
        rev,
        sales,
        items,
        fixos: dia.fixos,
        outras: dia.outras,
        aluguelMinBase: dia.aluguelMinBase,
        aluguelMin: Math.max(0, dia.aluguelMinBase - escalado.aluguelPct),
      });
    }
    anterior = faltaHora ? null : parcial;
  }

  // Sem venda no periodo atual nao e queda de 100%  -  e falta de dado (sem badge).
  const temComp = anterior != null && anterior.rev > 0 && atual.rev > 0;
  const vsLabel = temComp ? ant.label : undefined;
  const antLine = anterior ?? FIN_LINE_ZERO;

  const lucroAtual = finLucro(atual);
  const impostosAtual = atual.icms + atual.icmsSt;
  const margemAtual = divSeguro(lucroAtual, atual.rev) * 100;
  const temCmv = atual.cmv > 0;
  // CMV nao existe por hora: terminando hoje, CMV/lucro/margem/resultado comparam sem o dia de hoje nos dois lados.
  const cutsAtToday = ant.horaMax != null;
  const atualCmp = cutsAtToday ? sumDays(periodDays.slice(0, -1)) : atual;
  const antCmp = cutsAtToday ? sumDays(diasAnt.slice(0, -1)) : antLine;
  const vsCmv = cutsAtToday ? `${ant.label}, até o mesmo dia` : ant.label;
  const cmvComparavel = temComp && temCmv && atualCmp.cmv > 0 && antCmp.cmv > 0;
  const lucroAtualCmp = finLucro(atualCmp);
  const lucroAnteriorCmp = finLucro(antCmp);
  const margemAtualCmp = divSeguro(lucroAtualCmp, atualCmp.rev) * 100;
  const margemAnteriorCmp = divSeguro(lucroAnteriorCmp, antCmp.rev) * 100;

  const kpis: FinanceKpi[] = [
    {
      label: "Faturamento",
      value: brlCent(atual.rev),
      delta: temComp ? kpiDelta(atual.rev, antLine.rev, vsLabel) : undefined,
    },
    {
      label: "CMV",
      value: temCmv ? brlCent(atual.cmv) : "—",
      sub: temCmv ? `${(divSeguro(atual.cmv, atual.rev) * 100).toFixed(0)}% do faturamento` : undefined,
      delta: cmvComparavel ? kpiDelta(atualCmp.cmv, antCmp.cmv, vsCmv) : undefined,
      tooltip: temCmv ? TIP_CMV : TIP_CMV_INDISPONIVEL,
    },
    {
      label: "Lucro bruto",
      value: temCmv ? brlCent(lucroAtual) : "—",
      sub: temCmv && impostosAtual > 0 ? `Impostos: ${brlCent(impostosAtual)}` : undefined,
      delta: cmvComparavel ? kpiDelta(lucroAtualCmp, lucroAnteriorCmp, vsCmv) : undefined,
      tooltip: TIP_LUCRO_BRUTO,
    },
    {
      label: "Margem",
      value: temCmv ? pct(margemAtual) : "—",
      delta: cmvComparavel ? kpiDeltaPp(margemAtualCmp, margemAnteriorCmp, vsCmv) : undefined,
      tooltip: TIP_MARGEM,
    },
  ];

  const seriesAxis = seriesAxisForPeriod(period);
  const seriesLabel = seriesAxisLabel(period, seriesAxis);
  const resultIsProrated = seriesAxis !== "month";

  const costProfitSeries: CostProfitMonth[] = [];
  const operatingResult: OpResultMonth[] = [];
  const pushPonto = (label: string, l: FinLine, futuro = false, band?: string) => {
    const lucro = finLucro(l);
    const resultado = lucro - finOperatingCosts(l);
    const f = { ...(futuro ? { future: true } : {}), ...(band ? { rangeLabel: band } : {}) };
    costProfitSeries.push({ label, cost: l.cmv, profit: lucro, marginPct: divSeguro(lucro, l.rev) * 100, revenue: l.rev, ...f });
    operatingResult.push({ label, profit: lucro, result: resultado, operatingMarginPct: divSeguro(resultado, l.rev) * 100, revenue: l.rev, ...f });
  };

  if (seriesAxis === "hour") {
    const iso = period.start;
    const dow = isoToDate(iso).getDay() as Dow;
    const porHora = new Map<number, FinLine>();
    for (const f of fs) {
      const dia = storeDay(f, iso);
      const horas = storeHours(input.hourAggs ?? [], f, dia, iso);
      const cmvRatio = divSeguro(dia.cmv, dia.rev);
      const costRatio = dia.rev > 0 ? 1 / dia.rev : 0;
      for (const [h, m] of horas) {
        const cur = porHora.get(h) ?? FIN_LINE_ZERO;
        porHora.set(h, finAdd(cur, {
          ...FIN_LINE_ZERO,
          ...m,
          cmv: m.rev * cmvRatio,
          aluguelPct: m.rev * dia.aluguelPct * costRatio,
          royWepink: m.rev * dia.royWepink * costRatio,
          royWpink: m.rev * dia.royWpink * costRatio,
          mktWepink: m.rev * dia.mktWepink * costRatio,
          mktWpink: m.rev * dia.mktWpink * costRatio,
          variaveis: m.rev * dia.variaveis * costRatio,
          icms: m.rev * dia.icms * costRatio,
          icmsSt: m.rev * dia.icmsSt * costRatio,
        }));
      }
    }
    const comVenda = [...porHora.entries()].filter(([, l]) => l.rev > 0).map(([h]) => h);
    // Mesmo eixo do Faturamento x meta; hoje, as horas que ainda nao chegaram ficam sem linha.
    const { first, last, win } = hourAxisRange(fs.map((f) => f.horas), dow, comVenda);
    const horasAbertas = Math.max(1, win.fechamento - win.abertura);
    const mensalHora = finMonthlyCosts(atual) / horasAbertas;
    const nowH = calendarCurrentHour();
    // O total do grafico e o faturamento do dia. Hora 0 (cupom sem hora) fica de fora do eixo.
    let somaRev = 0;
    for (let h = first; h <= last; h++) somaRev += porHora.get(h)?.rev ?? 0;
    const fatorRev = atual.rev > 0 && somaRev > 0 ? atual.rev / somaRev : 1;
    const diaSemMensal: FinLine = { ...atual, fixos: 0, outras: 0, aluguelMinBase: 0, aluguelMin: 0 };
    for (let h = first; h <= last; h++) {
      const base = porHora.get(h) ?? FIN_LINE_ZERO;
      const l = somaRev === 0 && atual.rev > 0 && h === first
        ? diaSemMensal
        : fatorRev === 1 ? base : finScale(base, fatorRev);
      const futuro = period.isToday && h > nowH && l.rev <= 0;
      const dentro = !futuro && h >= win.abertura && h < win.fechamento;
      pushPonto(
        shortHour(h),
        { ...l, fixos: dentro ? mensalHora : 0, outras: 0, aluguelMinBase: 0, aluguelMin: 0 },
        futuro,
        hourSpan(h, period.isToday && h === nowH),
      );
    }
  } else if (seriesAxis === "day") {
    // Complemento do aluguel minimo e do mes: dividido igualmente pelos dias do mes no periodo.
    const complementoDia = new Map<string, number>();
    for (const mes of new Set(periodDays.map((iso) => iso.slice(0, 7)))) {
      const diasDoMes = periodDays.filter((iso) => iso.startsWith(mes));
      complementoDia.set(mes, sumDays(diasDoMes).aluguelMin / diasDoMes.length);
    }
    for (const iso of periodDays) {
      pushPonto(dayAxisLabel(iso, period), { ...sumDays([iso]), aluguelMin: complementoDia.get(iso.slice(0, 7)) ?? 0 }, false, dayPointDetail(iso));
    }
  } else {
    for (const mes of monthsBetween(period.start, period.end)) {
      const ini = `${mes}-01` < period.start ? period.start : `${mes}-01`;
      const fimMes = endOfMonth(`${mes}-01`);
      const end = fimMes > period.end ? period.end : fimMes;
      pushPonto(monthYear(`${mes}-01`).split(" de ")[0], sumDays(eachDay(ini, end)));
    }
  }

  const totalCustos = finOperatingCosts(atual);
  const resultadoAtual = lucroAtual - totalCustos;
  const resultadoAtualCmp = lucroAtualCmp - finOperatingCosts(atualCmp);
  const resultadoAnteriorCmp = lucroAnteriorCmp - finOperatingCosts(antCmp);
  const resultDelta = cmvComparavel ? kpiDelta(resultadoAtualCmp, resultadoAnteriorCmp, vsCmv) : undefined;

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
      color: CORES_FORMAS[method] ?? FORMAS_FALLBACK[i % FORMAS_FALLBACK.length]!,
    }));

  // Mini-DRE. Linhas WPINK so se alguma loja do escopo tem a marca.
  const custos = fs.map((f) => storeCostRates(f));
  const temWpink = fs.some((f) => f.temWpink);
  const brandRows: FixedCostRow[] = [];
  if (incluiWepink) {
    brandRows.push(
      { label: `Royalties WEPINK${rateSuffix(custos.map((c) => c.royaltiesWepinkPct))}`, amount: atual.royWepink },
      { label: `Taxa de marketing WEPINK${rateSuffix(custos.map((c) => c.mktWepinkPct))}`, amount: atual.mktWepink },
    );
  }
  if (incluiWpink && temWpink) {
    const cw = fs.filter((f) => f.temWpink).map((f) => storeCostRates(f));
    brandRows.push(
      { label: `Royalties WPINK${rateSuffix(cw.map((c) => c.royaltiesWpinkPct))}`, amount: atual.royWpink },
      { label: `Taxa de marketing WPINK${rateSuffix(cw.map((c) => c.mktWpinkPct))}`, amount: atual.mktWpink },
    );
  }
  // Aluguel do mes = maior entre o fixo e o %: mostra o fixo e, se o % passar dele, so o excedente.
  const aluguelFixo = atual.aluguelMinBase;
  const aluguelExcedente = Math.max(0, atual.aluguelPct + atual.aluguelMin - aluguelFixo);
  const rentRateLabel = `${aluguelFixo > 0 ? "Aluguel percentual excedente" : "Aluguel percentual"}${rateSuffix(custos.map((c) => c.aluguelWepinkPct))}`;
  const franchiseFixedCosts: FixedCostRow[] = [
    { label: "Lucro bruto", amount: lucroAtual },
    ...(aluguelFixo > 0 ? [{ label: "Aluguel", amount: aluguelFixo }] : []),
    ...(aluguelExcedente >= 0.005 ? [{ label: rentRateLabel, amount: aluguelExcedente }] : []),
    ...brandRows,
    { label: "Total de custos", amount: totalCustos, isTotal: true },
    { label: "Resultado operacional", amount: resultadoAtual, isResult: true },
  ];

  let revenueByBrand: RevenueByBrand[] | null = null;
  if (!division) {
    let fatWepink = 0;
    let fatWpink = 0;
    for (const f of fs) {
      for (const iso of periodDays) {
        const cell = cells.get(`${f.id}|${iso}`);
        fatWepink += cell?.WEPINK?.rev ?? 0;
        fatWpink += cell?.WPINK?.rev ?? 0;
      }
    }
    const tot = fatWepink + fatWpink;
    revenueByBrand = temWpink
      ? [
          { brand: "WEPINK", amount: fatWepink, pct: tot > 0 ? (fatWepink / tot) * 100 : 0, color: "var(--wepink)" },
          { brand: "WPINK", amount: fatWpink, pct: tot > 0 ? (fatWpink / tot) * 100 : 0, color: "var(--wpink)" },
        ].filter((m) => m.amount > 0)
      : null;
  }

  // Evolucao mensal: periodo mensal (calendario)  -  meses do filtro, recortados nas pontas; 1 mes so = + 5 anteriores inteiros.
  const evo = monthlyEvolutionMonths(period, seriesAxis);
  const monthlyEvolution: MonthlyEvolutionRow[] = evo.meses
    .map((mes) => {
      const iniMes = mes === period.start.slice(0, 7) ? period.start : `${mes}-01`;
      const fimMes = endOfMonth(`${mes}-01`);
      const fimCorte = [fimMes, period.end, today].sort()[0]!;
      const l = sumDays(eachDay(iniMes, fimCorte));
      const lucro = finLucro(l);
      return {
        label: monthEvolutionLabel(mes, evo.meses, iniMes, fimCorte),
        revenue: l.rev,
        cost: l.cmv,
        profit: lucro,
        marginPct: divSeguro(lucro, l.rev) * 100,
        averageTicket: divSeguro(l.rev, l.sales),
      };
    })
    .filter((r) => r.revenue > 0);

  const costDays = new Set<string>();
  const semCusto = new Map<string, ProductWithoutCost>();
  for (const r of input.productCostDayAggs ?? []) {
    if (!storeById.has(r.storeId)) continue;
    costDays.add(`${r.storeId}|${r.day}`);
    if (r.day < period.start || r.day > period.end || r.revenueCents <= 0 || r.cmvCents !== 0) continue;
    const codigo = r.productCode.trim();
    if (!codigo) continue;
    const p = semCusto.get(codigo) ?? { code: codigo, name: input.productNames?.[codigo] ?? "", items: 0, revenue: 0 };
    p.items += r.itemCount;
    p.revenue += r.revenueCents / 100;
    semCusto.set(codigo, p);
  }
  const productsWithoutCost = [...semCusto.values()].sort((a, b) => b.revenue - a.revenue);

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
    showMonthlyEvolution: evo.meses.length > 0,
    monthlyEvolutionLabel: evolutionCaption(period, evo.comAnteriores),
    periodRevenue: atual.rev,
    kpiItens: {
      label: "Itens vendidos",
      value: num(Math.round(atual.items)),
      delta:
        temComp && antLine.items > 0 && atual.items > 0
          ? kpiDelta(Math.round(atual.items), Math.round(antLine.items), vsLabel, "itens")
          : undefined,
    },
    kpisWpink: buildFinanceWpinkKpis({
      mostrar: fs.some((f) => f.temWpink),
      atual: wpinkTotals(input.dayAggs, storeById, period.start, period.end, costDays),
      anterior: wpinkPrevTotals(input.dayAggs, input.prevHourAggs ?? [], storeById, ant),
      faturamentoTotal: atual.rev,
      vsLabel: ant.label,
      cmvCompare: {
        atual: wpinkTotals(input.dayAggs, storeById, period.start, cutsAtToday ? addDays(period.end, -1) : period.end, costDays),
        anterior: wpinkTotals(input.dayAggs, storeById, ant.start, cutsAtToday ? addDays(ant.end, -1) : ant.end, costDays),
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
  const ant = previousPeriod(period);
  const evo = monthlyEvolutionMonths(period, seriesAxisForPeriod(period));
  const from = [period.start, ant.start, ...(evo.comAnteriores ? [`${evo.meses[0]}-01`] : [])].sort()[0]!;
  const to = period.end > today ? period.end : today;
  const prevHourDay = period.endsToday ? ant.end : null;
  return { from, to, prevHourDay };
}

/* ================================================================
 * TELA PRODUTOS  -  camada de dados (agregados reais do sync)
 * ================================================================ */

export type ProductsKpi = FinanceKpi;

export interface CategoryRevenue {
  categoriaId: number;
  name: string;
  revenue: number;
  itens: number;
}

/** Linha da tabela de produtos (relatorio {E7A5C5C7} + CMV do RELATORIOMARGEM por COD_PRODUTO). */
export interface ProductItemRow {
  /** `COD_PRODUTO` ou `#productId` (sem codigo)  -  abre o detalhe. */
  chave: string;
  codigo: string;
  name: string;
  revenue: number;
  itens: number;
  precoMedio: number;
  /** Participacao no faturamento dos produtos do periodo (0 - 100). */
  participacaoPct: number;
  /** null = algum dia com venda do produto sem custo gravado (nada estimado). */
  cmv: number | null;
  lucro: number | null;
  margemPct: number | null;
  /** Faturamento vs periodo anterior (%); null sem base de comparacao. */
  variacaoPct: number | null;
  /** Faturamento nos dois lados do comparativo (mesmo recorte da Variacao)  -  variacao do total. */
  faturamentoCmp: number;
  faturamentoAnt: number;
}

export type AbcClass = "A" | "B" | "C";

/** Categoria na curva ABC (Pareto): ordenada por faturamento desc. */
export interface AbcCategory {
  categoriaId: number;
  name: string;
  revenue: number;
  pct: number;
  pctAcumulado: number;
  classe: AbcClass;
}

export interface AbcCurveSummary {
  classe: AbcClass;
  qtdCategorias: number;
  /** Participacao da classe no faturamento total (0 - 100). */
  pctReceita: number;
  /** Soma do faturamento das categorias da classe. */
  revenue: number;
}

export interface AbcCurveCategories {
  itens: AbcCategory[];
  summary: AbcCurveSummary[];
}

export interface ProductsView {
  scope: Scope;
  period: ResolvedPeriod;
  /** Faturamento  |  Lucro bruto  |  Margem  |  Itens vendidos (mesmas regras do Financeiro). */
  kpis: ProductsKpi[];
  kpisWpink: OverviewKpiWpink[];
  temVendas: boolean;
  categorias: CategoryRevenue[];
  deltaCategorias?: { value: string; positive: boolean; vs?: string; anterior?: string };
  /** Curva ABC (Pareto) das categorias  -  cortes 80% / 95%. */
  curvaAbcCategorias: AbcCurveCategories;
  produtos: ProductItemRow[];
  /** Linhas de produto (fragrancia), ranking completo por faturamento. */
  linhas: ProductLineRow[];
  /** Faturamento de produtos sem linha (skincare, cabelo, maquiagem, suplementos, kits). */
  semLinhaFaturamento: number;
  /** Algum produto do periodo tem CMV gravado. */
  temCustoProduto: boolean;
  /** Base da coluna Variacao (tooltip). */
  vsVariacao: string;
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
  itens: number;
  /** Produtos da linha vendidos no periodo. */
  produtos: number;
  /** Tipos vendidos (desodorante colonia, body splash...), do maior faturamento para o menor. */
  tipos: string[];
  participacaoPct: number;
  /** null = algum produto da linha sem custo gravado. */
  lucro: number | null;
  /** null = algum produto da linha sem custo gravado. */
  margemPct: number | null;
  variacaoPct: number | null;
  /** Chaves (`ProductItemRow.chave`) de todos os produtos da linha  -  abre o detalhe. */
  chaves: string[];
}

/** Classifica categorias em A/B/C (80%/95% acumulado), ja ordenadas por fat. desc. */
export function classifyAbcCurve(cats: Array<{ categoriaId: number; name: string; revenue: number }>): AbcCurveCategories {
  const total = cats.reduce((s, c) => s + c.revenue, 0) || 1;
  let acum = 0;
  const itens: AbcCategory[] = cats.map((c) => {
    const pct = (c.revenue / total) * 100;
    const antes = acum;
    acum += pct;
    const classe: AbcClass = antes < 80 ? "A" : antes < 95 ? "B" : "C";
    return {
      categoriaId: c.categoriaId,
      name: c.name,
      revenue: c.revenue,
      pct,
      pctAcumulado: acum,
      classe,
    };
  });
  const classes: AbcClass[] = ["A", "B", "C"];
  const summary: AbcCurveSummary[] = classes.map((classe) => {
    const doGrupo = itens.filter((i) => i.classe === classe);
    const revenue = doGrupo.reduce((s, i) => s + i.revenue, 0);
    return {
      classe,
      qtdCategorias: doGrupo.length,
      pctReceita: doGrupo.reduce((s, i) => s + i.pct, 0),
      revenue,
    };
  });
  return { itens, summary };
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
function productDaySaleReais(
  row: { storeId: string; day: string; productCode: string; revenueCents: number },
  marginSales: Map<string, number>,
  used: Set<string>,
): number | null {
  const code = row.productCode.trim();
  const k = productDayKey(row.storeId, row.day, code);
  const margem = code ? marginSales.get(k) : undefined;
  if (margem != null && margem > 0) {
    if (used.has(k)) return null;
    used.add(k);
    return margem;
  }
  return row.revenueCents / 100;
}

/** Janela de leitura de categorias/produtos: periodo anterior + periodo atual. */
export function productsFetchRange(scope: Scope): { from: string; to: string } {
  const period = resolvePeriod(scope.period, calendarTodayIso());
  const ant = previousPeriod(period);
  return { from: ant.start < period.start ? ant.start : period.start, to: period.end };
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

  const ant = previousPeriod(period, calendarCurrentHour());
  const cutsAtToday = ant.horaMax != null;
  const fimCmp = cutsAtToday ? addDays(period.end, -1) : period.end;
  const antFimCmp = cutsAtToday ? addDays(ant.end, -1) : ant.end;
  const vsCmp = cutsAtToday ? `${ant.label}, até o mesmo dia` : ant.label;
  const noAtual = (d: string) => d >= period.start && d <= period.end;
  const noAtualCmp = (d: string) => d >= period.start && d <= fimCmp;
  const noAntCmp = (d: string) => d >= ant.start && d <= antFimCmp;

  const kpiPorLabel = (label: string) => fin.kpis.find((k) => k.label === label);
  const kpis = [kpiPorLabel("Faturamento"), kpiPorLabel("Lucro bruto"), kpiPorLabel("Margem"), fin.kpiItens].filter(
    (k): k is ProductsKpi => Boolean(k),
  );

  // Categorias (itens vendidos x catalogo)  -  chave = PRODUTO_TIPO; nome = o do dia mais recente.
  const catAcc = new Map<number, { name: string; nomeDia: string; fat: number; itens: number; fatCmp: number; fatAnt: number }>();
  for (const r of input.categoryDayAggs ?? []) {
    if (!storeById.has(r.storeId)) continue;
    const acc = catAcc.get(r.categoryId) ?? { name: "", nomeDia: "", fat: 0, itens: 0, fatCmp: 0, fatAnt: 0 };
    if (r.categoryName && r.day >= acc.nomeDia) {
      acc.name = r.categoryName;
      acc.nomeDia = r.day;
    }
    const v = r.revenueCents / 100;
    if (noAtual(r.day)) {
      acc.fat += v;
      acc.itens += r.itemCount;
    }
    if (noAtualCmp(r.day)) acc.fatCmp += v;
    if (noAntCmp(r.day)) acc.fatAnt += v;
    catAcc.set(r.categoryId, acc);
  }
  const categorias: CategoryRevenue[] = [...catAcc.entries()]
    .filter(([, c]) => c.fat > 0)
    .map(([id, c]) => ({ categoriaId: id, name: labelUpper(c.name || `Tipo ${id}`), revenue: c.fat, itens: c.itens }))
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "pt-BR"));
  const catCmp = [...catAcc.values()].reduce((s, c) => s + c.fatCmp, 0);
  const catAnt = [...catAcc.values()].reduce((s, c) => s + c.fatAnt, 0);
  const deltaCategorias = catCmp > 0 && catAnt > 0 ? kpiDelta(catCmp, catAnt, vsCmp) : undefined;

  // CMV por produto (RELATORIOMARGEM)  -  loja x dia x COD_PRODUTO.
  const custoKey = (storeId: string, day: string, code: string) => `${storeId}|${day}|${code}`;
  const custos = new Map<string, number>();
  for (const r of input.productCostDayAggs ?? []) {
    if (!storeById.has(r.storeId) || !noAtual(r.day)) continue;
    const k = custoKey(r.storeId, r.day, r.productCode.trim());
    custos.set(k, (custos.get(k) ?? 0) + r.cmvCents / 100);
  }
  const vendasMargem = productDaySaleMap((input.productCostDayAggs ?? []).filter((r) => storeById.has(r.storeId)));
  const vendasUsadas = new Set<string>();
  const storeCosts = new Map<string, ReturnType<typeof storeCostRates>>();
  const storeCost = (storeId: string) => {
    let c = storeCosts.get(storeId);
    if (!c) {
      c = storeCostRates(storeById.get(storeId)!);
      storeCosts.set(storeId, c);
    }
    return c;
  };

  type ProdAcc = {
    name: string;
    nomeDia: string;
    fat: number;
    itens: number;
    cmv: number;
    impostos: number;
    semCusto: boolean;
    fatCmp: number;
    fatAnt: number;
  };
  const prodAcc = new Map<string, ProdAcc>();
  const custosUsados = new Set<string>();
  for (const r of input.productDayAggs ?? []) {
    if (!storeById.has(r.storeId)) continue;
    const code = r.productCode.trim();
    const key = code || `#${r.productId}`;
    const acc = prodAcc.get(key) ?? {
      name: "",
      nomeDia: "",
      fat: 0,
      itens: 0,
      cmv: 0,
      impostos: 0,
      semCusto: false,
      fatCmp: 0,
      fatAnt: 0,
    };
    if (r.productName && r.day >= acc.nomeDia) {
      acc.name = r.productName;
      acc.nomeDia = r.day;
    }
    const v = productDaySaleReais(r, vendasMargem, vendasUsadas);
    if (v == null) {
      prodAcc.set(key, acc);
      continue;
    }
    if (noAtual(r.day)) {
      acc.fat += v;
      acc.itens += r.itemCount;
      const taxa = storeCost(r.storeId);
      acc.impostos += productTaxAmount(taxa, code, v, 0);
      if (v > 0) {
        const k = custoKey(r.storeId, r.day, code);
        const cmv = code ? custos.get(k) : undefined;
        if (cmv == null) acc.semCusto = true;
        else if (!custosUsados.has(k)) {
          custosUsados.add(k);
          acc.cmv += cmv;
          acc.impostos += productTaxAmount(taxa, code, 0, cmv);
        }
      }
    }
    if (noAtualCmp(r.day)) acc.fatCmp += v;
    if (noAntCmp(r.day)) acc.fatAnt += v;
    prodAcc.set(key, acc);
  }

  const totalProdutos = [...prodAcc.values()].reduce((s, p) => s + p.fat, 0);
  const produtos: ProductItemRow[] = [...prodAcc.entries()]
    .filter(([, p]) => p.fat > 0)
    .map(([key, p]) => {
      const cmv = p.semCusto ? null : p.cmv;
      const lucro = cmv == null ? null : p.fat - cmv - p.impostos;
      return {
        chave: key,
        codigo: key.startsWith("#") ? "" : key,
        name: labelUpper(p.name || key),
        revenue: p.fat,
        itens: p.itens,
        precoMedio: divSeguro(p.fat, p.itens),
        participacaoPct: divSeguro(p.fat, totalProdutos) * 100,
        cmv,
        lucro,
        margemPct: lucro == null ? null : divSeguro(lucro, p.fat) * 100,
        variacaoPct: p.fatAnt > 0 && p.fatCmp > 0 ? ((p.fatCmp - p.fatAnt) / p.fatAnt) * 100 : null,
        faturamentoCmp: p.fatCmp,
        faturamentoAnt: p.fatAnt,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "pt-BR"));

  // Linhas de produto: fragrancia da descricao (catalogo = nome estavel da linha).
  const lineIndex = buildProductLineIndex([
    ...(input.catalogDescriptions ?? []),
    ...[...prodAcc.values()].map((p) => p.name).filter(Boolean),
  ]);
  type LineAcc = {
    fat: number;
    itens: number;
    produtos: number;
    lucro: number;
    semCusto: boolean;
    fatCmp: number;
    fatAnt: number;
    tipos: Map<string, number>;
    chaves: string[];
  };
  const lineAcc = new Map<string, LineAcc>();
  let semLinhaFaturamento = 0;
  for (const [chave, p] of prodAcc) {
    const l = p.name ? lineIndex.lineOf(p.name) : null;
    if (!l) {
      semLinhaFaturamento += p.fat;
      continue;
    }
    const acc = lineAcc.get(l.line) ?? {
      fat: 0,
      itens: 0,
      produtos: 0,
      lucro: 0,
      semCusto: false,
      fatCmp: 0,
      fatAnt: 0,
      tipos: new Map<string, number>(),
      chaves: [],
    };
    acc.chaves.push(chave);
    acc.fatCmp += p.fatCmp;
    acc.fatAnt += p.fatAnt;
    if (p.fat > 0) {
      acc.fat += p.fat;
      acc.itens += p.itens;
      acc.produtos += 1;
      acc.tipos.set(l.kind, (acc.tipos.get(l.kind) ?? 0) + p.fat);
      if (p.semCusto) acc.semCusto = true;
      else acc.lucro += p.fat - p.cmv - p.impostos;
    }
    lineAcc.set(l.line, acc);
  }
  const linhas: ProductLineRow[] = [...lineAcc.entries()]
    .filter(([, l]) => l.fat > 0)
    .map(([name, l]) => ({
      name,
      revenue: l.fat,
      itens: l.itens,
      produtos: l.produtos,
      tipos: [...l.tipos.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
      participacaoPct: divSeguro(l.fat, totalProdutos) * 100,
      lucro: l.semCusto ? null : l.lucro,
      margemPct: l.semCusto ? null : divSeguro(l.lucro, l.fat) * 100,
      variacaoPct: l.fatAnt > 0 && l.fatCmp > 0 ? ((l.fatCmp - l.fatAnt) / l.fatAnt) * 100 : null,
      chaves: l.chaves,
    }))
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "pt-BR"));

  return {
    scope: esc,
    period,
    kpis,
    kpisWpink: fin.kpisWpink,
    temVendas: (fin.periodRevenue ?? 0) > 0,
    categorias,
    deltaCategorias,
    curvaAbcCategorias: classifyAbcCurve(categorias),
    produtos,
    linhas,
    semLinhaFaturamento,
    temCustoProduto: produtos.some((p) => p.cmv != null),
    vsVariacao: vsCmp,
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
  itens: number;
  /** Fatia do faturamento do produto no escopo (0 - 100). */
  pct: number;
}

export interface ProductDetailItem {
  chave: string;
  codigo: string;
  name: string;
  revenue: number;
  itens: number;
  /** Fatia do faturamento da linha (0 - 100). */
  pct: number;
  /** null = algum dia com venda do produto sem custo (nada estimado). */
  lucro: number | null;
  margemPct: number | null;
}

export interface ProductDetailCategory {
  categoriaId: number;
  name: string;
  itens: number;
  revenue: number;
  lucro: number | null;
  margemPct: number | null;
  /** Participacao no faturamento de todas as categorias (0 - 100). */
  pct: number;
  pctAcumulado: number;
}

export interface ProductDetail {
  kind: "produto" | "linha" | "categoria" | "classe";
  /** Produto = `ProductItemRow.chave`; linha = nome; categoria = id; classe = A/B/C. */
  chave: string;
  codigo: string;
  name: string;
  revenue: number;
  itens: number;
  precoMedio: number;
  participacaoPct: number;
  cmv: number | null;
  lucro: number | null;
  margemPct: number | null;
  /** Faturamento/itens por dia (2 - 31 dias) ou por mes (> 31); null em 1 dia (sem dado por hora). */
  serie: { label: string; detail?: string; revenue: number; itens: number }[] | null;
  seriesGranularity: "day" | "month";
  /** So com mais de 1 loja no escopo. */
  storeRows: ProductDetailStore[];
  /** Mesmo recorte da coluna Variacao (periodo terminando hoje = ate ontem nos dois lados). */
  comparativo: {
    vs: string;
    revenue?: ReturnType<typeof kpiDelta>;
    itens?: ReturnType<typeof kpiDelta>;
    margem?: ReturnType<typeof kpiDeltaPp>;
  } | null;
  /** Linha: produtos vendidos no periodo (maior faturamento primeiro). Produto: vazio. */
  produtos: ProductDetailItem[];
  /** Linha: tipos vendidos (desodorante colonia, body splash...). */
  tipos: string[];
  /** Classe da Curva ABC: categorias da classe. */
  categorias: ProductDetailCategory[];
  /** Categoria: classe dela na Curva ABC. */
  classe?: AbcClass;
}

type ItemsDetail = Omit<ProductDetail, "kind" | "chave" | "codigo" | "name" | "participacaoPct" | "tipos" | "categorias" | "classe">;

/** Mesma chave do `buildProductsView`: `COD_PRODUTO` ou `#productId`. */
const productRowKey = (r: { productCode: string; productId: number }) => r.productCode.trim() || `#${r.productId}`;

/** Detalhe de um conjunto de produtos  -  mesmas regras de custo/impostos do `buildProductsView`. */
function buildItemsDetail(
  scope: Scope,
  input: ProductsAggInput,
  chaves: Set<string>,
  opts: { margemPorProduto?: boolean } = {},
): ItemsDetail {
  const margemPorProduto = opts.margemPorProduto ?? true;
  const esc: Scope = { ...scope, division: null };
  const period = resolvePeriod(esc.period, calendarTodayIso());
  const storeById = new Map(storesInScope(esc).map((f) => [f.id, f]));

  const ant = previousPeriod(period, calendarCurrentHour());
  const cutsAtToday = ant.horaMax != null;
  const fimCmp = cutsAtToday ? addDays(period.end, -1) : period.end;
  const antFimCmp = cutsAtToday ? addDays(ant.end, -1) : ant.end;
  const vsCmp = cutsAtToday ? `${ant.label}, até o mesmo dia` : ant.label;
  const noAtual = (d: string) => d >= period.start && d <= period.end;
  const noAtualCmp = (d: string) => d >= period.start && d <= fimCmp;
  const noAntCmp = (d: string) => d >= ant.start && d <= antFimCmp;

  const linhas = (input.productDayAggs ?? []).filter((r) => storeById.has(r.storeId) && chaves.has(productRowKey(r)));

  const custoKey = (storeId: string, day: string, code: string) => `${storeId}|${day}|${code}`;
  const custos = new Map<string, number>();
  for (const r of input.productCostDayAggs ?? []) {
    const code = r.productCode.trim();
    if (!storeById.has(r.storeId) || !code || !chaves.has(code)) continue;
    const k = custoKey(r.storeId, r.day, code);
    custos.set(k, (custos.get(k) ?? 0) + r.cmvCents / 100);
  }
  const vendasMargem = productDaySaleMap(
    (input.productCostDayAggs ?? []).filter((r) => storeById.has(r.storeId) && chaves.has(r.productCode.trim())),
  );
  const taxas = new Map<string, ReturnType<typeof storeCostRates>>();
  const storeRate = (storeId: string) => {
    let t = taxas.get(storeId);
    if (!t) {
      t = storeCostRates(storeById.get(storeId)!);
      taxas.set(storeId, t);
    }
    return t;
  };

  const acumular = (no: (d: string) => boolean, chave?: string) => {
    let fat = 0;
    let itens = 0;
    let cmv = 0;
    let impostos = 0;
    let semCusto = false;
    const usados = new Set<string>();
    const vendasUsadas = new Set<string>();
    for (const r of linhas) {
      if (!no(r.day) || (chave != null && productRowKey(r) !== chave)) continue;
      const v = productDaySaleReais(r, vendasMargem, vendasUsadas);
      if (v == null) continue;
      fat += v;
      itens += r.itemCount;
      const taxa = storeRate(r.storeId);
      const code = r.productCode.trim();
      impostos += productTaxAmount(taxa, code, v, 0);
      if (v > 0) {
        const k = custoKey(r.storeId, r.day, code);
        const c = code ? custos.get(k) : undefined;
        if (c == null) semCusto = true;
        else if (!usados.has(k)) {
          usados.add(k);
          cmv += c;
          impostos += productTaxAmount(taxa, code, 0, c);
        }
      }
    }
    const lucro = semCusto ? null : fat - cmv - impostos;
    return {
      fat,
      itens,
      cmv: semCusto ? null : cmv,
      lucro,
      margemPct: lucro == null || fat <= 0 ? null : divSeguro(lucro, fat) * 100,
    };
  };

  const atual = acumular(noAtual);

  let serie: ProductDetail["serie"] = null;
  const dias = eachDay(period.start, period.end);
  const seriesGranularity: ProductDetail["seriesGranularity"] = dias.length > 31 ? "month" : "day";
  if (dias.length > 1) {
    const porDia = new Map<string, { revenue: number; itens: number }>();
    const vendasUsadas = new Set<string>();
    for (const r of linhas) {
      if (!noAtual(r.day)) continue;
      const v = productDaySaleReais(r, vendasMargem, vendasUsadas);
      if (v == null) continue;
      const k = seriesGranularity === "month" ? r.day.slice(0, 7) : r.day;
      const acc = porDia.get(k) ?? { revenue: 0, itens: 0 };
      acc.revenue += v;
      acc.itens += r.itemCount;
      porDia.set(k, acc);
    }
    const eixo = seriesGranularity === "month" ? [...new Set(dias.map((d) => d.slice(0, 7)))] : dias;
    const variosAnos = period.start.slice(0, 4) !== period.end.slice(0, 4);
    serie = eixo.map((k) => ({
      label:
        seriesGranularity === "month"
          ? `${shortMonth(`${k}-01`)}${variosAnos ? `/${k.slice(2, 4)}` : ""}`
          : dayAxisLabel(k, period),
      ...(seriesGranularity === "day" ? { detail: dayPointDetail(k) } : {}),
      revenue: porDia.get(k)?.revenue ?? 0,
      itens: porDia.get(k)?.itens ?? 0,
    }));
  }

  let storeRows: ProductDetailStore[] = [];
  if (storeById.size > 1) {
    const byStore = new Map<string, { revenue: number; itens: number }>();
    const vendasUsadas = new Set<string>();
    for (const r of linhas) {
      if (!noAtual(r.day)) continue;
      const v = productDaySaleReais(r, vendasMargem, vendasUsadas);
      if (v == null) continue;
      const acc = byStore.get(r.storeId) ?? { revenue: 0, itens: 0 };
      acc.revenue += v;
      acc.itens += r.itemCount;
      byStore.set(r.storeId, acc);
    }
    storeRows = [...byStore.entries()]
      .filter(([, l]) => l.revenue > 0)
      .map(([id, l]) => ({
        storeId: id,
        name: storeById.get(id)!.fantasia,
        revenue: l.revenue,
        itens: l.itens,
        pct: divSeguro(l.revenue, atual.fat) * 100,
      }))
      .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "pt-BR"));
  }

  const porProduto = new Map<string, { name: string; nomeDia: string; revenue: number; itens: number }>();
  const vendasUsadas = new Set<string>();
  for (const r of linhas) {
    const key = productRowKey(r);
    const acc = porProduto.get(key) ?? { name: "", nomeDia: "", revenue: 0, itens: 0 };
    if (r.productName && r.day >= acc.nomeDia) {
      acc.name = r.productName;
      acc.nomeDia = r.day;
    }
    if (noAtual(r.day)) {
      const v = productDaySaleReais(r, vendasMargem, vendasUsadas);
      if (v == null) {
        porProduto.set(key, acc);
        continue;
      }
      acc.revenue += v;
      acc.itens += r.itemCount;
    }
    porProduto.set(key, acc);
  }
  const produtos: ProductDetailItem[] = [...porProduto.entries()]
    .filter(([, p]) => p.revenue > 0)
    .map(([key, p]) => {
      const custo = margemPorProduto ? acumular(noAtual, key) : null;
      return {
        chave: key,
        codigo: key.startsWith("#") ? "" : key,
        name: labelUpper(p.name || key),
        revenue: p.revenue,
        itens: p.itens,
        pct: divSeguro(p.revenue, atual.fat) * 100,
        lucro: custo?.lucro ?? null,
        margemPct: custo?.margemPct ?? null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "pt-BR"));

  const cmpAtual = acumular(noAtualCmp);
  const cmpAnt = acumular(noAntCmp);
  const comparativo: ProductDetail["comparativo"] =
    cmpAtual.fat > 0 && cmpAnt.fat > 0
      ? {
          vs: vsCmp,
          revenue: kpiDelta(cmpAtual.fat, cmpAnt.fat, vsCmp),
          itens: kpiDelta(cmpAtual.itens, cmpAnt.itens, vsCmp, "itens"),
          margem:
            cmpAtual.margemPct != null && cmpAnt.margemPct != null
              ? kpiDeltaPp(cmpAtual.margemPct, cmpAnt.margemPct, vsCmp)
              : undefined,
        }
      : null;

  return {
    revenue: atual.fat,
    itens: atual.itens,
    precoMedio: divSeguro(atual.fat, atual.itens),
    cmv: atual.cmv,
    lucro: atual.lucro,
    margemPct: atual.margemPct,
    serie,
    seriesGranularity,
    storeRows,
    comparativo,
    produtos,
  };
}

/** Detalhe de 1 produto (chave da `ProductItemRow`). */
export function buildProductDetail(
  scope: Scope,
  input: ProductsAggInput,
  produto: Pick<ProductItemRow, "chave" | "codigo" | "name" | "participacaoPct">,
): ProductDetail {
  const d = buildItemsDetail(scope, input, new Set([produto.chave]));
  return {
    ...d,
    kind: "produto",
    chave: produto.chave,
    codigo: produto.codigo,
    name: d.produtos[0]?.name ?? produto.name,
    participacaoPct: produto.participacaoPct,
    produtos: [],
    tipos: [],
    categorias: [],
  };
}

/** Detalhe de uma linha de produto (fragrancia)  -  soma dos produtos dela + lista dos produtos. */
export function buildProductLineDetail(
  scope: Scope,
  input: ProductsAggInput,
  linha: Pick<ProductLineRow, "name" | "chaves" | "tipos" | "participacaoPct">,
): ProductDetail {
  const d = buildItemsDetail(scope, input, new Set(linha.chaves));
  return {
    ...d,
    kind: "linha",
    chave: linha.name,
    codigo: "",
    name: linha.name,
    participacaoPct: linha.participacaoPct,
    tipos: linha.tipos,
    categorias: [],
  };
}

/** Mesmo join da `sales_category_day_view`: produto fora do catalogo = INDEFINIDO. */
const CATEGORIA_INDEFINIDA = -2000000000;

function productKeysByCategory(input: ProductsAggInput): Map<number, Set<string>> {
  const tipos = input.catalogTypes ?? {};
  const out = new Map<number, Set<string>>();
  for (const r of input.productDayAggs ?? []) {
    const cat = tipos[r.productId] ?? CATEGORIA_INDEFINIDA;
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
  categoria: Pick<AbcCategory, "categoriaId" | "name" | "pct" | "classe">,
): ProductDetail {
  const chaves = productKeysByCategory(input).get(categoria.categoriaId) ?? new Set<string>();
  const d = buildItemsDetail(scope, input, chaves);
  return {
    ...d,
    kind: "categoria",
    chave: String(categoria.categoriaId),
    codigo: "",
    name: categoria.name,
    participacaoPct: categoria.pct,
    tipos: [],
    categorias: [],
    classe: categoria.classe,
  };
}

/** Detalhe de uma classe da Curva ABC  -  soma das categorias dela + lista das categorias. */
export function buildAbcClassDetail(
  scope: Scope,
  input: ProductsAggInput,
  view: Pick<ProductsView, "curvaAbcCategorias" | "categorias">,
  classe: AbcClass,
): ProductDetail {
  const porCategoria = productKeysByCategory(input);
  const daClasse = view.curvaAbcCategorias.itens.filter((i) => i.classe === classe);
  const chaves = new Set<string>();
  for (const c of daClasse) for (const k of porCategoria.get(c.categoriaId) ?? []) chaves.add(k);
  const d = buildItemsDetail(scope, input, chaves, { margemPorProduto: false });
  const categorias: ProductDetailCategory[] = daClasse.map((c) => {
    const det = buildItemsDetail(scope, input, porCategoria.get(c.categoriaId) ?? new Set<string>(), { margemPorProduto: false });
    return {
      categoriaId: c.categoriaId,
      name: c.name,
      itens: view.categorias.find((x) => x.categoriaId === c.categoriaId)?.itens ?? det.itens,
      revenue: c.revenue,
      lucro: det.lucro,
      margemPct: det.margemPct,
      pct: c.pct,
      pctAcumulado: c.pctAcumulado,
    };
  });
  return {
    ...d,
    kind: "classe",
    chave: classe,
    codigo: "",
    name: `Classe ${classe}`,
    participacaoPct: view.curvaAbcCategorias.summary.find((r) => r.classe === classe)?.pctReceita ?? 0,
    produtos: [],
    tipos: [],
    categorias,
  };
}

/**
 * Turno da pessoa (Configuracoes > Lojas): liga pelo codigo da funcionaria  ->  gerador  ->  nome,
 * na ordem das lojas recebida (maior venda primeiro). Rotulo "Manha  |  09:00 - 15:00".
 */
function sellerShiftResolver(shifts: import("./salesTypes").SellerShiftRef[] = []) {
  const porFunc = new Map<string, string>();
  const porGerador = new Map<number, string>();
  const porNome = new Map<string, string>();
  for (const s of shifts) {
    const label = `${s.name} · ${s.start}–${s.end}`;
    if (s.employeeId != null) porFunc.set(`${s.storeId}|${s.employeeId}`, label);
    if (s.geradorId != null) porGerador.set(s.geradorId, label);
    for (const k of s.nameKeys) porNome.set(`${s.storeId}|${k}`, label);
  }
  return (p: { employeeId: number | null; geradorId: number | null; sellerKeys: Set<string>; storeRows: string[] }): string | undefined => {
    for (const store of p.storeRows) {
      const f = p.employeeId != null ? porFunc.get(`${store}|${p.employeeId}`) : undefined;
      if (f) return f;
    }
    if (p.geradorId != null && porGerador.has(p.geradorId)) return porGerador.get(p.geradorId);
    for (const store of p.storeRows) {
      for (const k of p.sellerKeys) {
        const n = porNome.get(`${store}|${k}`);
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
  delta?: { value: string; positive: boolean; vs?: string; diff?: string; anterior?: string };
  tooltip?: string;
}

export interface TeamMemberRow {
  key: string;
  name: string;
  /** Lojas onde vendeu no periodo, da que mais faturou para a que menos. */
  storeRows: string[];
  /** "Manha  |  09:00 - 15:00"; ausente = sem turno definido. */
  turno?: string;
  revenue: number;
  vendas: number;
  itens: number;
  averageTicket: number;
  /** Itens por venda; null se algum dia com venda nao tem itens gravados (nada estimado). */
  pa: number | null;
  participacaoPct: number;
  /** Faturamento vs periodo anterior (sem hora: terminando hoje, ate ontem nos dois lados). */
  variacaoPct: number | null;
  /** Lados da variacao  -  o Total da tabela soma e compara ponderado. */
  faturamentoCmp: number;
  faturamentoAnt: number;
}

export interface TeamShiftSlice {
  name: string;
  revenue: number;
  pessoas: number;
}

export interface TeamDashboardView {
  scope: Scope;
  period: ResolvedPeriod;
  /** KPIs e tabela ja filtrados pelo turno escolhido. */
  kpis: TeamKpi[];
  pessoas: TeamMemberRow[];
  /** Toda a equipe (sem filtro de turno). Maior faturamento primeiro; "Sem turno definido" sempre por ultimo. */
  turnos: TeamShiftSlice[];
  /** Alguma pessoa das lojas do escopo tem turno cadastrado. */
  turnosConfigurados: boolean;
  /** Opcoes do filtro de turno (nome do turno; "Sem turno definido" se alguem vendeu sem turno). */
  availableShifts: string[];
  /** Turno aplicado (null = todos; valor fora das opcoes vira null). */
  turnoFiltro: string | null;
  /** Faturamento das lojas = equipe + vendas sem vendedor identificado ou realizadas pela gerencia; `turno` = parte da equipe no turno filtrado. */
  composicao: { team: number; fora: number; total: number; turno?: number };
  vsVariacao: string;
  /** Mais de 1 loja no escopo  ->  mostra a loja de cada pessoa. */
  multiLoja: boolean;
}

export type TeamAggInput = {
  dayAggs: import("./salesTypes").SalesDayAgg[];
  sellerDayAggs?: import("./salesTypes").SalesSellerDayAgg[];
  sellerShifts?: import("./salesTypes").SellerShiftRef[];
};

export const TEAM_SEM_TURNO = "Sem grupo definido";

/** Nome do turno a partir do rotulo "Manha  |  09:00 - 15:00" (sem turno = TEAM_SEM_TURNO). */
export function teamShiftName(turno?: string): string {
  return turno ? (turno.split(" · ")[0] ?? turno) : TEAM_SEM_TURNO;
}

/**
 * Equipe a partir dos agregados do sync (sales_seller_day_agg, sem gerencia / conta de freelancer).
 * Sem dado por hora: periodo terminando hoje compara ate ontem nos dois lados; em "Hoje" fica sem badge.
 * `opts.turno` filtra KPIs e tabela pelo nome do turno (turno atual da pessoa vale tambem para o periodo anterior).
 */
export function buildTeamDashboardView(
  scope: Scope,
  input: TeamAggInput = { dayAggs: [] },
  opts: { turno?: string | null } = {},
): TeamDashboardView {
  const esc: Scope = { ...scope, division: null };
  const period = resolvePeriod(esc.period, calendarTodayIso());
  const fs = storesInScope(esc);
  const storeIds = new Set(fs.map((f) => f.id));
  const storeName = new Map(fs.map((f) => [f.id, f.fantasia]));

  const ant = previousPeriod(period, calendarCurrentHour());
  const cutsAtToday = ant.horaMax != null;
  const fimCmp = cutsAtToday ? addDays(period.end, -1) : period.end;
  const antFimCmp = cutsAtToday ? addDays(ant.end, -1) : ant.end;
  const vsCmp = cutsAtToday ? `${ant.label}, até o mesmo dia` : ant.label;
  const noAtual = (d: string) => d >= period.start && d <= period.end;
  const noAtualCmp = (d: string) => d >= period.start && d <= fimCmp;
  const noAntCmp = (d: string) => d >= ant.start && d <= antFimCmp;

  type Tot = { fat: number; vendas: number; itens: number; semItens: boolean };
  const novoTot = (): Tot => ({ fat: 0, vendas: 0, itens: 0, semItens: false });
  const somar = (t: Tot, r: { fat: number; vendas: number; itens: number; semItens: boolean }) => {
    t.fat += r.fat;
    t.vendas += r.vendas;
    t.itens += r.itens;
    if (r.semItens) t.semItens = true;
  };
  const linha = (r: import("./salesTypes").SalesSellerDayAgg) => ({
    fat: r.revenueCents / 100,
    vendas: r.salesCount,
    itens: r.itemCount ?? 0,
    semItens: r.salesCount > 0 && !(r.itemCount && r.itemCount > 0),
  });

  type Acc = {
    name: string;
    nomeDia: string;
    atual: Tot;
    cmp: Tot;
    ant: Tot;
    fatPorLoja: Map<string, number>;
    employeeId: number | null;
    geradorId: number | null;
    sellerKeys: Set<string>;
  };
  const acc = new Map<string, Acc>();
  for (const r of input.sellerDayAggs ?? []) {
    if (!storeIds.has(r.storeId)) continue;
    const key = r.sellerEmployeeId != null ? `e:${r.sellerEmployeeId}` : `n:${r.sellerKey}`;
    const a = acc.get(key) ?? {
      name: r.sellerName,
      nomeDia: r.day,
      atual: novoTot(),
      cmp: novoTot(),
      ant: novoTot(),
      fatPorLoja: new Map<string, number>(),
      employeeId: r.sellerEmployeeId ?? null,
      geradorId: null,
      sellerKeys: new Set<string>(),
    };
    a.sellerKeys.add(r.sellerKey);
    if (r.sellerGeradorId != null) a.geradorId = r.sellerGeradorId;
    if (r.day > a.nomeDia) {
      a.name = r.sellerName;
      a.nomeDia = r.day;
    }
    const l = linha(r);
    if (noAtual(r.day)) {
      somar(a.atual, l);
      a.fatPorLoja.set(r.storeId, (a.fatPorLoja.get(r.storeId) ?? 0) + r.revenueCents);
    }
    if (noAtualCmp(r.day)) somar(a.cmp, l);
    if (noAntCmp(r.day)) somar(a.ant, l);
    acc.set(key, a);
  }

  const turnoDe = sellerShiftResolver(input.sellerShifts);
  const todas = [...acc.entries()].map(([key, a]) => {
    const storeIdList = [...a.fatPorLoja.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
    const turno = turnoDe({
      employeeId: a.employeeId,
      geradorId: a.geradorId,
      sellerKeys: a.sellerKeys,
      // Sem venda no periodo (so no anterior): liga pelo codigo/nome em qualquer loja do escopo.
      storeRows: storeIdList.length > 0 ? storeIdList : [...storeIds],
    });
    return { key, a, storeIdList, turno };
  });
  const comVenda = todas.filter(({ a }) => a.atual.fat > 0 || a.atual.vendas > 0);

  // Opcoes do filtro: turnos cadastrados nas lojas do escopo (ordem de inicio) + "Sem turno definido".
  const startByName = new Map<string, string>();
  for (const s of input.sellerShifts ?? []) {
    if (!storeIds.has(s.storeId)) continue;
    const atual = startByName.get(s.name);
    if (atual == null || s.start < atual) startByName.set(s.name, s.start);
  }
  const availableShifts = [...startByName.entries()]
    .sort((x, y) => x[1].localeCompare(y[1]) || x[0].localeCompare(y[0], "pt-BR"))
    .map(([name]) => name);
  if (availableShifts.length > 0 && comVenda.some((p) => !p.turno)) availableShifts.push(TEAM_SEM_TURNO);
  const turnoFiltro = opts.turno && availableShifts.includes(opts.turno) ? opts.turno : null;
  const noFiltro = (turno?: string) => !turnoFiltro || teamShiftName(turno) === turnoFiltro;

  const filtradas = todas.filter((p) => noFiltro(p.turno));
  const totAtual = novoTot();
  const totCmp = novoTot();
  const totAnt = novoTot();
  for (const { a } of filtradas) {
    somar(totAtual, a.atual);
    somar(totCmp, a.cmp);
    somar(totAnt, a.ant);
  }

  const pessoas: TeamMemberRow[] = filtradas
    .filter(({ a }) => a.atual.fat > 0 || a.atual.vendas > 0)
    .map(({ key, a, storeIdList, turno }) => ({
      key,
      name: a.name,
      storeRows: storeIdList.map((id) => storeName.get(id)).filter((n): n is string => Boolean(n)),
      turno,
      revenue: a.atual.fat,
      vendas: a.atual.vendas,
      itens: a.atual.itens,
      averageTicket: divSeguro(a.atual.fat, a.atual.vendas),
      pa: a.atual.semItens || a.atual.vendas === 0 ? null : a.atual.itens / a.atual.vendas,
      participacaoPct: divSeguro(a.atual.fat, totAtual.fat) * 100,
      variacaoPct: a.ant.fat > 0 && a.cmp.fat > 0 ? ((a.cmp.fat - a.ant.fat) / a.ant.fat) * 100 : null,
      faturamentoCmp: a.cmp.fat,
      faturamentoAnt: a.ant.fat,
    }))
    .sort((x, y) => y.revenue - x.revenue || x.name.localeCompare(y.name, "pt-BR"));

  // Turnos (toda a equipe): soma por rotulo; sem turno por ultimo.
  const porTurno = new Map<string, TeamShiftSlice>();
  let equipeTotal = 0;
  for (const { a, turno } of comVenda) {
    equipeTotal += a.atual.fat;
    const name = turno ?? TEAM_SEM_TURNO;
    const s = porTurno.get(name) ?? { name, revenue: 0, pessoas: 0 };
    s.revenue += a.atual.fat;
    s.pessoas += 1;
    porTurno.set(name, s);
  }
  const turnos = [...porTurno.values()]
    .filter((s) => s.revenue > 0)
    .sort((a, b) => {
      if (a.name === TEAM_SEM_TURNO) return 1;
      if (b.name === TEAM_SEM_TURNO) return -1;
      return b.revenue - a.revenue;
    });
  const turnosConfigurados = (input.sellerShifts ?? []).some((s) => storeIds.has(s.storeId));

  const storeCount = input.dayAggs
    .filter((r) => r.brand === "ALL" && storeIds.has(r.storeId) && noAtual(r.day))
    .reduce((s, r) => s + r.revenueCents / 100, 0);
  const fora = Math.max(0, storeCount - equipeTotal);

  // Comparativos: so com venda no periodo atual (nunca 100%) e dado nos dois lados.
  const comparavel = totAtual.fat > 0 && totCmp.vendas > 0 && totAnt.vendas > 0;
  const ticketCmp = divSeguro(totCmp.fat, totCmp.vendas);
  const ticketAnt = divSeguro(totAnt.fat, totAnt.vendas);
  const n = pessoas.length;
  const ticket = divSeguro(totAtual.fat, totAtual.vendas);
  const pa = totAtual.semItens || totAtual.vendas === 0 ? null : totAtual.itens / totAtual.vendas;
  const paComparavel = comparavel && !totCmp.semItens && !totAnt.semItens;

  const kpis: TeamKpi[] = [
    {
      label: "Faturamento da equipe",
      amount: brlCent(totAtual.fat),
      sub: n > 0 ? `${n} ${n === 1 ? "pessoa" : "pessoas"} · média de ${brlCent(totAtual.fat / n)}` : undefined,
      delta: comparavel ? kpiDelta(totCmp.fat, totAnt.fat, vsCmp) : undefined,
      tooltip: "Faturamento das vendas atribuídas à equipe. Não inclui vendas sem vendedor identificado ou realizadas pela gerência.",
    },
    {
      label: "Nº de vendas",
      amount: num(totAtual.vendas),
      sub: totAtual.vendas > 0 && !totAtual.semItens ? `${num(totAtual.itens)} itens vendidos` : undefined,
      delta: comparavel ? kpiDelta(totCmp.vendas, totAnt.vendas, vsCmp, "vendas") : undefined,
    },
    {
      label: "Ticket médio",
      amount: brlCent(ticket),
      delta: comparavel ? kpiDelta(ticketCmp, ticketAnt, vsCmp) : undefined,
    },
    {
      label: "P.A.",
      amount: pa == null ? (totAtual.vendas > 0 ? "—" : num(0, 2)) : num(pa, 2),
      sub: "Itens por venda",
      delta: paComparavel ? kpiDelta(totCmp.itens / totCmp.vendas, totAnt.itens / totAnt.vendas, vsCmp, "pa") : undefined,
      tooltip: pa == null && totAtual.vendas > 0 ? "O P.A. não está disponível para este período." : undefined,
    },
  ];

  return {
    scope: esc,
    period,
    kpis,
    pessoas,
    turnos,
    turnosConfigurados,
    availableShifts,
    turnoFiltro,
    composicao: {
      team: equipeTotal,
      fora,
      total: equipeTotal + fora,
      ...(turnoFiltro ? { turno: totAtual.fat } : {}),
    },
    vsVariacao: vsCmp,
    multiLoja: fs.length > 1,
  };
}

export interface TeamMemberDetail extends TeamMemberRow {
  serie: { label: string; detail?: string; revenue: number; vendas: number }[] | null;
  seriesGranularity: "day" | "month";
  comparativo: {
    vs: string;
    revenue?: TeamKpi["delta"];
    vendas?: TeamKpi["delta"];
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
  opts: { turno?: string | null } = {},
): TeamMemberDetail | null {
  const view = buildTeamDashboardView(scope, input, opts);
  const row = view.pessoas.find((p) => p.key === key);
  if (!row) return null;

  const period = view.period;
  const fs = storesInScope(view.scope);
  const storeName = new Map(fs.map((f) => [f.id, f.fantasia]));
  const ant = previousPeriod(period, calendarCurrentHour());
  const cutsAtToday = ant.horaMax != null;
  const fimCmp = cutsAtToday ? addDays(period.end, -1) : period.end;
  const antFimCmp = cutsAtToday ? addDays(ant.end, -1) : ant.end;
  const vsCmp = cutsAtToday ? `${ant.label}, até o mesmo dia` : ant.label;
  const noAtual = (d: string) => d >= period.start && d <= period.end;
  const noAtualCmp = (d: string) => d >= period.start && d <= fimCmp;
  const noAntCmp = (d: string) => d >= ant.start && d <= antFimCmp;

  const linhas = (input.sellerDayAggs ?? []).filter(
    (r) => storeName.has(r.storeId) && (r.sellerEmployeeId != null ? `e:${r.sellerEmployeeId}` : `n:${r.sellerKey}`) === key,
  );

  type Tot = { fat: number; vendas: number; itens: number; semItens: boolean };
  const somar = (no: (d: string) => boolean): Tot => {
    const t: Tot = { fat: 0, vendas: 0, itens: 0, semItens: false };
    for (const r of linhas) {
      if (!no(r.day)) continue;
      t.fat += r.revenueCents / 100;
      t.vendas += r.salesCount;
      t.itens += r.itemCount ?? 0;
      if (r.salesCount > 0 && !(r.itemCount && r.itemCount > 0)) t.semItens = true;
    }
    return t;
  };
  const cmp = somar(noAtualCmp);
  const antT = somar(noAntCmp);
  const comparavel = row.revenue > 0 && cmp.vendas > 0 && antT.vendas > 0;
  const paComparavel = comparavel && !cmp.semItens && !antT.semItens;
  const comparativo: TeamMemberDetail["comparativo"] = comparavel
    ? {
        vs: vsCmp,
        revenue: kpiDelta(cmp.fat, antT.fat, vsCmp),
        vendas: kpiDelta(cmp.vendas, antT.vendas, vsCmp, "vendas"),
        ticket: kpiDelta(divSeguro(cmp.fat, cmp.vendas), divSeguro(antT.fat, antT.vendas), vsCmp),
        pa: paComparavel ? kpiDelta(cmp.itens / cmp.vendas, antT.itens / antT.vendas, vsCmp, "pa") : undefined,
      }
    : null;

  let serie: TeamMemberDetail["serie"] = null;
  const dias = eachDay(period.start, period.end);
  const seriesGranularity: TeamMemberDetail["seriesGranularity"] = dias.length > 31 ? "month" : "day";
  if (dias.length > 1) {
    const porDia = new Map<string, { revenue: number; vendas: number }>();
    for (const r of linhas) {
      if (!noAtual(r.day)) continue;
      const k = seriesGranularity === "month" ? r.day.slice(0, 7) : r.day;
      const acc = porDia.get(k) ?? { revenue: 0, vendas: 0 };
      acc.revenue += r.revenueCents / 100;
      acc.vendas += r.salesCount;
      porDia.set(k, acc);
    }
    const eixo = seriesGranularity === "month" ? [...new Set(dias.map((d) => d.slice(0, 7)))] : dias;
    const variosAnos = period.start.slice(0, 4) !== period.end.slice(0, 4);
    serie = eixo.map((k) => ({
      label: seriesGranularity === "month" ? `${shortMonth(`${k}-01`)}${variosAnos ? `/${k.slice(2, 4)}` : ""}` : dayAxisLabel(k, period),
      ...(seriesGranularity === "day" ? { detail: dayPointDetail(k) } : {}),
      revenue: porDia.get(k)?.revenue ?? 0,
      vendas: porDia.get(k)?.vendas ?? 0,
    }));
  }

  return { ...row, serie, seriesGranularity, comparativo };
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
  serie?: number[];
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
  delta?: { value: string; positive: boolean; vs?: string; diff?: string; anterior?: string };
}

export interface GoalGauge {
  name: string;
  pct: number;
  alvo: number;
  achieved: number;
}

export interface CategoryVsGoal {
  categoria: string;
  /** Reservado p/ meta por categoria (CRUD Metas). Hoje sempre 0 neste card. */
  goal: number;
  achieved: number;
}

export interface DayVsGoal {
  dia: string;
  goal: number;
  achieved: number;
}

export interface EvolutionPoint {
  label: string;
  achieved: number;
  goal: number;
  projection: number | null;
  /** Ponto-ancora R$ 0 na abertura (eixo hora "acumulado ate")  -  fora do modo por periodo. */
  ancora?: boolean;
  /** Hora de hoje que ainda nao chegou: so a meta (o realizado para em "Agora"). */
  futuro?: boolean;
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
  averageTicket?: number;
  goalPct?: number;
  /** Itens por venda; ausente se algum dia com venda nao tem itens gravados (nada estimado). */
  pa?: number;
  /** Lojas onde vendeu no periodo, da que mais faturou para a que menos. */
  storeRows: string[];
  /** Turno cadastrado em Configuracoes > Lojas ("Manha  |  09:00 - 15:00"); ausente = sem turno. */
  turno?: string;
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
  projecaoFechamento: string | null;
  /** Qual meta o card Atingimento mostra (nome + datas, ou soma de N lojas). */
  goalDescription?: string | null;
  /** Delta do faturamento vs periodo anterior (badge dos cards de grafico). */
  revenueDelta?: { value: string; positive: boolean; vs?: string };
  seriesAxis: SeriesAxis;
  seriesLabel: string;
  categoryVsGoal: CategoryVsGoal[];
  /** Vazio quando periodo = 1 dia (card oculto na UI). */
  diaVsMeta: DayVsGoal[];
  evolucao: EvolutionPoint[];
  paymentMethods: PaymentMethodRevenue[];
  topSellers: TopSeller[];
  /** Ranking completo (maior faturamento primeiro)  -  a tela escolhe a metrica e corta o Top N.
   *  `chave` = mesma do `ProductItemRow` (abre o detalhe do produto). */
  /** `lucro`: null = algum dia com venda sem custo gravado; ausente = fixture. */
  topProdutos: (TopItem & { chave?: string; sub?: string; itens?: number; categoria?: string; trend?: number; lucro?: number | null })[];
  storesRanking: (TopItem & { id?: string; goalPct?: number; pctRede?: number; trend?: number })[];
  /** Faturamento da rede no periodo (badge do Ranking  -  independente do StorePicker). */
  rankingRedeTotal?: number;
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
  /** Faturamento do inicio das metas ate hoje (card Atingimento da meta, que ignora o filtro de periodo). */
  goalDayAggs?: import("./salesTypes").SalesDayAgg[];
  /** Vendas por pessoa do inicio das metas ate hoje (nivel de meta no Destaques da equipe). */
  goalSellerDayAggs?: import("./salesTypes").SalesSellerDayAgg[];
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
): { rows: R[]; cmvIncompleto: boolean; vendasIncompletas: boolean } {
  const out = rows.filter((r) => r.brand === "WPINK");
  const comVenda = out.filter((r) => r.revenueCents > 0);
  return {
    rows: out,
    cmvIncompleto: comVenda.some((r) => !r.cmvCents && !costDays?.has(`${r.storeId}|${r.day}`)),
    vendasIncompletas: comVenda.some((r) => r.salesCount <= 0),
  };
}

/** Totais WPINK; `null` = dado incompleto em algum dia com venda WPINK (nada e estimado). */
/** `impostos` = ICMS (faturamento) + ICMS ST (CMV) das lojas; 0 sem configuracao. */
type WpinkTotals = { fat: number; cmv: number | null; vendas: number | null; itens: number | null; impostos: number };

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
    (acc, d) => {
      const c = inScope.get?.(d.storeId)?.custos;
      const cmv = d.cmvCents ?? 0;
      return {
        rev: acc.rev + d.revenueCents,
        cmv: acc.cmv + cmv,
        sales: acc.sales + d.salesCount,
        items: acc.items + d.itemCount,
        tax: acc.tax + (d.revenueCents * (c?.icmsWpinkPct ?? 0) + cmv * (c?.icmsStWpinkPct ?? 0)) / 100,
      };
    },
    { rev: 0, cmv: 0, sales: 0, items: 0, tax: 0 },
  );
  return {
    fat: s.rev / 100,
    cmv: w.cmvIncompleto ? null : s.cmv / 100,
    vendas: w.vendasIncompletas ? null : s.sales,
    itens: w.vendasIncompletas ? null : s.items,
    impostos: s.tax / 100,
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
  ant: { start: string; end: string; horaMax?: number },
): WpinkTotals | null {
  if (ant.horaMax == null) return wpinkTotals(dayRows, inScope, ant.start, ant.end);
  const horaMax = ant.horaMax;
  const doDia = hourRows.filter((h) => h.brand === "WPINK" && inScope.has(h.storeId) && h.day === ant.end);
  const storesWithHour = new Set(doDia.map((h) => h.storeId));
  const faltaHora = dayRows.some(
    (d) => d.brand === "WPINK" && inScope.has(d.storeId) && d.day === ant.end && d.revenueCents > 0 && !storesWithHour.has(d.storeId),
  );
  if (faltaHora) return null;
  const hrs = doDia.filter((h) => h.hour <= horaMax);
  const cheios = wpinkTotals(dayRows, inScope, ant.start, addDays(ant.end, -1));
  const vendasHora = hrs.reduce((s, h) => s + h.salesCount, 0);
  const itensHora = hrs.reduce((s, h) => s + h.itemCount, 0);
  return {
    fat: cheios.fat + hrs.reduce((s, h) => s + h.revenueCents, 0) / 100,
    cmv: null,
    vendas: cheios.vendas == null ? null : cheios.vendas + vendasHora,
    itens: cheios.itens == null ? null : cheios.itens + itensHora,
    impostos: 0,
  };
}

/** Faixa WPINK do Financeiro: Faturamento  |  CMV  |  Lucro bruto  |  Margem (+ badge vs periodo anterior). */
function buildFinanceWpinkKpis(p: {
  mostrar: boolean;
  atual: WpinkTotals;
  anterior: WpinkTotals | null;
  faturamentoTotal: number;
  vsLabel: string;
  /** Base dos badges de CMV/lucro/margem (terminando hoje = sem o dia de hoje nos dois lados). */
  cmvCompare: { atual: WpinkTotals; anterior: WpinkTotals; vsLabel: string };
}): OverviewKpiWpink[] {
  if (!p.mostrar) return [];
  const { atual, anterior } = p;
  const temComp = anterior != null && anterior.fat > 0 && atual.fat > 0;
  const vs = temComp ? p.vsLabel : undefined;
  const cmv = atual.cmv != null && atual.fat > 0 ? atual.cmv : null;
  const lucro = cmv != null ? atual.fat - cmv - atual.impostos : 0;
  const margem = divSeguro(lucro, atual.fat) * 100;
  const c = p.cmvCompare;
  const cmvA = c.atual.cmv != null && c.atual.cmv > 0 && c.atual.fat > 0 ? c.atual.cmv : null;
  const cmvB = c.anterior.cmv != null && c.anterior.cmv > 0 && c.anterior.fat > 0 ? c.anterior.cmv : null;
  const cmvComp = temComp && cmv != null && cmvA != null && cmvB != null;
  const lucroA = cmvA != null ? c.atual.fat - cmvA - c.atual.impostos : 0;
  const lucroB = cmvB != null ? c.anterior.fat - cmvB - c.anterior.impostos : 0;
  const margemA = divSeguro(lucroA, c.atual.fat) * 100;
  const margemB = divSeguro(lucroB, c.anterior.fat) * 100;
  return [
    {
      label: "Faturamento WPINK",
      amount: brlCent(atual.fat),
      sub: p.faturamentoTotal > 0 ? `${Math.round((atual.fat / p.faturamentoTotal) * 100)}% do faturamento` : undefined,
      tint: "acc",
      delta: temComp ? kpiDelta(atual.fat, anterior.fat, vs) : undefined,
    },
    {
      label: "CMV WPINK",
      amount: cmv != null ? brlCent(cmv) : "—",
      sub: cmv != null && atual.fat > 0 ? `${Math.round((cmv / atual.fat) * 100)}% do faturamento WPINK` : undefined,
      tooltip: cmv != null ? TIP_CMV_WPINK : TIP_CMV_WPINK_INDISPONIVEL,
      tint: "warn",
      delta: cmvComp ? kpiDelta(cmvA, cmvB, c.vsLabel) : undefined,
    },
    {
      label: "Lucro bruto WPINK",
      amount: cmv != null ? brlCent(lucro) : "—",
      sub: cmv != null && atual.impostos > 0 ? `Impostos: ${brlCent(atual.impostos)}` : undefined,
      tooltip: TIP_LUCRO_BRUTO_WPINK,
      tint: "ok",
      delta: cmvComp ? kpiDelta(lucroA, lucroB, c.vsLabel) : undefined,
    },
    {
      label: "Margem WPINK",
      amount: cmv != null ? pct(margem) : "—",
      tooltip: TIP_MARGEM_WPINK,
      tint: "info",
      delta: cmvComp ? kpiDeltaPp(margemA, margemB, c.vsLabel) : undefined,
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
  const daysRede = byBrand(input.dayAggs);
  // Escopo do StorePicker  -  KPIs / graficos.
  let days =
    scope.storeIds.length > 0
      ? daysRede.filter((d) => scopedStoreIds.has(d.storeId))
      : daysRede;

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

  const atualAgg = sumDays(days);

  /**
   * Sem horaxmarca (FORCE sem DetMov ainda): rateia horas ALL pelo share
   * marca/ALL de cada loja  -  mantem o grafico Faturamento x meta no filtro WPINK/WEPINK.
   */
  let hours = hoursRaw;
  if (brand && hours.length === 0 && atualAgg.revenueCents > 0) {
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

  const revenue = atualAgg.revenueCents / 100;
  let salesCount = atualAgg.salesCount;
  let itens = atualAgg.itemCount;

  // Relatorio de marca grava so receita (counts=0). Ate o proximo FORCE/SEED
  // com counts preenchidos, deriva de horas ou rateia do ALL.
  if (brand && salesCount === 0 && atualAgg.revenueCents > 0) {
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
      itens = fromHours.itemCount;
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
          itens = allSum.itemCount;
        } else {
          const share = atualAgg.revenueCents / allSum.revenueCents;
          salesCount = Math.max(0, Math.round(allSum.salesCount * share));
          itens = Math.max(0, Math.round(allSum.itemCount * share));
        }
      }
    }
  }

  const ticket = salesCount > 0 ? revenue / salesCount : 0;

  // Quick stats WPINK  -  so se alguma loja do escopo tem a marca.
  const showWpinkStrip = fs.some((f) => f.temWpink);
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
  const wpinkFat = wpinkSum.revenueCents / 100;
  // CMV WPINK so quando todos os dias com venda WPINK tem CMV (senao soma parcial engana).
  const wpinkCmv = wpink.cmvIncompleto ? 0 : wpinkSum.cmvCents / 100;
  const wpinkVendas = wpink.vendasIncompletas ? 0 : wpinkSum.salesCount;
  const wpinkItens = wpink.vendasIncompletas ? 0 : wpinkSum.itemCount;
  const wpinkTicket = wpinkVendas > 0 ? wpinkFat / wpinkVendas : 0;
  const cmvTotalCents = days.reduce((s, d) => s + (d.cmvCents ?? 0), 0);
  const tipCmv = cmvTotalCents <= 0 ? TIP_CMV_INDISPONIVEL : TIP_CMV;
  const tipCmvWpink = wpinkCmv <= 0 ? TIP_CMV_INDISPONIVEL : TIP_CMV;
  const kpisWpink: OverviewKpiWpink[] = showWpinkStrip
    ? [
        {
          label: "Faturamento WPINK",
          amount: brlCent(wpinkFat),
          sub: revenue > 0 ? `${Math.round((wpinkFat / revenue) * 100)}% do faturamento` : undefined,
          tint: "acc",
        },
        {
          label: "CMV WPINK",
          amount: wpinkCmv > 0 ? brlCent(wpinkCmv) : "—",
          sub:
            wpinkCmv > 0 && wpinkFat > 0
              ? `${Math.round((wpinkCmv / wpinkFat) * 100)}% do faturamento`
              : undefined,
          tooltip: tipCmvWpink,
          tint: "warn",
        },
        {
          label: "Nº de vendas WPINK",
          amount: wpink.vendasIncompletas ? "—" : num(wpinkVendas),
          sub: wpink.vendasIncompletas ? undefined : `${num(wpinkItens)} itens`,
          tint: "ok",
        },
        {
          label: "Ticket médio WPINK",
          amount: wpink.vendasIncompletas ? "—" : brlCent(wpinkTicket),
          sub:
            wpinkVendas > 0
              ? `P.A. ${num(divSeguro(wpinkItens, wpinkVendas), 2)}`
              : undefined,
          tint: "info",
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
  const serieFat = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)
    .slice(-7);

  // Comparativo: periodo anterior equivalente. Terminando hoje, o ultimo dia do anterior entra ate a hora atual.
  const antBase = previousPeriod(period, calendarCurrentHour());
  const antHoraMax = antBase.horaMax;
  const inScope = (storeId: string) => scope.storeIds.length === 0 || scopedStoreIds.has(storeId);
  const prevDays = preferAllBrand(
    (input.prevDayAggs ?? []).filter((d) => inScope(d.storeId) && d.day >= antBase.start && d.day <= antBase.end),
  );
  const somaPrev = (rows: typeof prevDays) =>
    rows.reduce(
      (acc, d) => ({
        fatCents: acc.fatCents + d.revenueCents,
        cmvCents: acc.cmvCents + (d.cmvCents ?? 0),
        vendas: acc.vendas + d.salesCount,
        itens: acc.itens + d.itemCount,
      }),
      { fatCents: 0, cmvCents: 0, vendas: 0, itens: 0 },
    );
  let anterior: { fatCents: number; cmvCents: number; vendas: number; itens: number } | null = null;
  if (antHoraMax == null) {
    anterior = somaPrev(prevDays);
  } else {
    const prevHours = preferAllBrand(
      (input.prevHourAggs ?? []).filter((h) => inScope(h.storeId) && h.day === antBase.end),
    );
    const storesWithHour = new Set(prevHours.map((h) => h.storeId));
    // Loja que vendeu no dia equivalente sem horas gravadas  ->  sem comparativo (nunca dia cheio x parcial).
    const faltaHora = prevDays.some((d) => d.day === antBase.end && d.revenueCents > 0 && !storesWithHour.has(d.storeId));
    if (!faltaHora) {
      anterior = somaPrev(prevDays.filter((d) => d.day < antBase.end));
      for (const h of prevHours) {
        if (h.hour > antHoraMax) continue;
        anterior.fatCents += h.revenueCents;
        anterior.vendas += h.salesCount;
        anterior.itens += h.itemCount;
      }
    }
  }
  // Sem venda no periodo atual (ex.: hoje antes do Atualizar) nao e queda de 100%  -  e falta de dado.
  const temComp = anterior != null && anterior.fatCents > 0 && revenue > 0;
  const vsLabel = temComp ? antBase.label : undefined;
  const antFat = (anterior?.fatCents ?? 0) / 100;
  const antVendas = anterior?.vendas ?? 0;
  const antTicket = antVendas > 0 ? antFat / antVendas : 0;
  const revenueDelta = temComp ? kpiDelta(revenue, antFat, vsLabel) : undefined;

  // CMV nao existe por hora: terminando hoje, compara sem o dia de hoje nos dois lados.
  const cutsAtToday = antHoraMax != null;
  const vsCmv = cutsAtToday ? `${antBase.label}, até o mesmo dia` : antBase.label;
  const cmvAtualCmp = (cutsAtToday ? days.filter((d) => d.day < period.end) : days).reduce((s, d) => s + (d.cmvCents ?? 0), 0) / 100;
  const cmvAntCmp = somaPrev(cutsAtToday ? prevDays.filter((d) => d.day < antBase.end) : prevDays).cmvCents / 100;
  const deltaCmv = cmvTotalCents > 0 && cmvAtualCmp > 0 && cmvAntCmp > 0 ? kpiDelta(cmvAtualCmp, cmvAntCmp, vsCmv) : undefined;

  // Faixa WPINK: mesmo periodo anterior (ultimo dia = horas WPINK ate a hora atual; sem horas  ->  sem badge).
  const antW = kpisWpink.length > 0
    ? wpinkPrevTotals(input.prevDayAggs ?? [], input.prevHourAggs ?? [], { has: inScope }, antBase)
    : null;
  if (antW && antW.fat > 0 && wpinkFat > 0) {
    const vsW = antBase.label;
    const antWTicket = antW.vendas != null && antW.vendas > 0 ? antW.fat / antW.vendas : 0;
    const [kFat, , kVendas, kTicket] = kpisWpink;
    if (kFat) kFat.delta = kpiDelta(wpinkFat, antW.fat, vsW);
    if (kVendas && !wpink.vendasIncompletas && antW.vendas != null && antW.vendas > 0) {
      kVendas.delta = kpiDelta(wpinkVendas, antW.vendas, vsW, "vendas");
    }
    if (kTicket && wpinkTicket > 0 && antWTicket > 0) kTicket.delta = kpiDelta(wpinkTicket, antWTicket, vsW);
  }
  const kCmvW = kpisWpink[1];
  if (kCmvW && wpinkCmv > 0) {
    const scopeW = { has: inScope };
    const fimAtual = cutsAtToday ? addDays(period.end, -1) : period.end;
    const fimAnt = cutsAtToday ? addDays(antBase.end, -1) : antBase.end;
    const cmvW = wpinkTotals(input.dayAggs, scopeW, period.start, fimAtual).cmv;
    const cmvWAnt = wpinkTotals(input.prevDayAggs ?? [], scopeW, antBase.start, fimAnt).cmv;
    if (cmvW != null && cmvW > 0 && cmvWAnt != null && cmvWAnt > 0) kCmvW.delta = kpiDelta(cmvW, cmvWAnt, vsCmv);
  }

  const kpis: OverviewKpi[] = [
    {
      label: "Faturamento",
      amount: brlCent(revenue),
      delta: revenueDelta,
      serie: serieFat,
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
      sub: `${num(itens)} itens vendidos`,
      delta: temComp ? kpiDelta(salesCount, antVendas, vsLabel, "vendas") : undefined,
    },
    {
      label: "Ticket médio",
      amount: brlCent(ticket),
      sub: salesCount > 0 ? `P.A. ${num(divSeguro(itens, salesCount), 2)}` : undefined,
      delta: temComp && ticket > 0 ? kpiDelta(ticket, antTicket, vsLabel) : undefined,
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
    fs.map((f) => [f.id, weekdayWeights(histDayByStore.get(f.id) ?? new Map(), effectiveWeekHours(f.horas))]),
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
  let realizadoMeta = 0;
  let projetado = 0;
  let projecaoCompleta = true;
  for (const g of goalsInPeriod) {
    metaTotal += g.target;
    if (g.startsOn > todayIso) continue;
    const pesos = weekdayWeightsByStore.get(g.storeId) ?? [];
    let achieved = 0;
    let realizadoAteOntem = 0;
    let esperadoAteOntem = 0;
    for (const iso of eachDay(g.startsOn, g.endsOn < todayIso ? g.endsOn : todayIso)) {
      const v = soldByStoreDay.get(`${g.storeId}|${iso}`) ?? 0;
      achieved += v;
      if (iso < todayIso) {
        realizadoAteOntem += v;
        esperadoAteOntem += periodDailyGoal(g.target, g.startsOn, g.endsOn, iso, pesos);
      }
    }
    realizadoMeta += achieved;
    if (g.endsOn < todayIso) projetado += achieved;
    // Projecao = ritmo dos dias fechados x meta; so depois de metade da meta esperada ter passado.
    else if (esperadoAteOntem >= g.target / 2) projetado += (realizadoAteOntem / esperadoAteOntem) * g.target;
    else projecaoCompleta = false;
  }
  const goalAttainment = metaTotal > 0 ? (realizadoMeta / metaTotal) * 100 : 0;
  const faltam = metaTotal > 0 ? Math.max(0, metaTotal - realizadoMeta) : 0;
  let projecaoFechamento: string | null = null;
  if (goalsInPeriod.length > 0 && goalsInPeriod.every((g) => g.endsOn < todayIso)) projecaoFechamento = "Meta encerrada";
  else if (goalsInPeriod.some((g) => g.startsOn <= todayIso) && projecaoCompleta) projecaoFechamento = brlCent(projetado);
  const gauges: GoalGauge[] =
    metaTotal > 0 ? [{ name: "Meta", pct: goalAttainment, alvo: metaTotal, achieved: realizadoMeta }] : [];

  const evolucao: EvolutionPoint[] = [];
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
      let shares = hourShares(hist, f.horas, goalDow);
      if (shares.size === 0) shares = hourShares(hist, effectiveWeekHours(f.horas), goalDow);
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
    const vendidas = [...byHour.entries()].filter(([, v]) => v > 0).map(([h]) => h);
    const nowH = calendarCurrentHour();
    const goalHours = [...goalByHourMap.entries()].filter(([, v]) => v > 0).map(([h]) => h);
    const { first, last } = hourAxisRange(
      (winStores.length > 0 ? winStores : fs).map((f) => f.horas),
      goalDow,
      vendidas,
      goalHours,
    );
    const horas: number[] = [];
    for (let h = first; h <= last; h++) horas.push(h);
    // Realizado do card = faturamento do dia. A curva segue as horas do expediente;
    // venda na hora 0 (cupom sem hora) nao entra na soma nem alarga o eixo.
    const diaReais = byDay.get(period.start) ?? 0;
    let somaHoras = 0;
    for (const h of horas) somaHoras += byHour.get(h) ?? 0;
    const fatorHora = diaReais > 0 && somaHoras > 0 ? diaReais / somaHoras : 1;
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
    evolucao.push({ label: shortHour(first), achieved: 0, goal: 0, projection: null, ancora: true });
    let acum = 0;
    let acumM = 0;
    for (const h of horas) {
      let realizadoH = (byHour.get(h) ?? 0) * fatorHora;
      if (somaHoras === 0 && diaReais > 0 && h === first) realizadoH = diaReais;
      acum += realizadoH;
      acumM += goalOnAxis(h);
      const emAndamento = period.isToday && h === nowH;
      evolucao.push({
        label: emAndamento ? "Agora" : shortHour(h),
        band: hourSpan(h, emAndamento),
        achieved: acum,
        goal: acumM,
        projection: null,
        ...(period.isToday && h > nowH ? { futuro: true } : {}),
      });
    }
  } else {
    let acum = 0;
    let acumM = 0;
    const periodDays = eachDay(period.start, period.end);
    const mesesLbl = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    const diario = seriesAxis === "day";
    for (const iso of periodDays) {
      acum += byDay.get(iso) ?? 0;
      acumM += fs.reduce((s, f) => s + storeGoalDay(f, iso), 0);
      const d = isoToDate(iso);
      evolucao.push({
        label: diario ? dayAxisLabel(iso, period) : `${String(d.getDate()).padStart(2, "0")} ${mesesLbl[d.getMonth()]}`,
        ...(diario ? { band: dayPointDetail(iso) } : {}),
        achieved: acum,
        goal: acumM,
        projection: null,
      });
    }
  }

  const remainingToGoal = faltam > 0 ? `Faltam ${brlCent(faltam)} para atingir a meta` : metaTotal > 0 ? "Meta atingida" : null;

  // Faturamento por categoria  -  mix do periodo + catalogo historico (zeros).
  // Meta por categoria fica p/ CRUD de Metas; nao inventar Goal aqui.
  const catAcc = new Map<string, { achieved: number }>();
  for (const ref of input.categoryCatalog ?? []) {
    if (brand && ref.brand !== brand && ref.brand !== "ALL") continue;
    const name = ref.categoryName || `Tipo ${ref.categoryId}`;
    if (!catAcc.has(labelUpper(name))) catAcc.set(labelUpper(name), { achieved: 0 });
  }
  for (const row of input.categoryDayAggs ?? []) {
    if (brand && row.brand !== brand && row.brand !== "ALL") continue;
    if (brand && row.brand === "ALL") continue;
    const name = row.categoryName || `Tipo ${row.categoryId}`;
    const key = labelUpper(name);
    const cur = catAcc.get(key) ?? { achieved: 0 };
    cur.achieved += row.revenueCents / 100;
    catAcc.set(key, cur);
  }
  const categoryVsGoal: CategoryVsGoal[] = [...catAcc.entries()]
    .map(([categoria, c]) => ({
      categoria,
      achieved: c.achieved,
      goal: 0,
    }))
    .sort((a, b) => b.achieved - a.achieved || a.categoria.localeCompare(b.categoria, "pt-BR"));

  // Ranking de lojas  -  totais da rede; lista pode filtrar 1 loja, mas %/badge = rede.
  const byStore = new Map<string, number>();
  for (const d of daysRede) {
    byStore.set(d.storeId, (byStore.get(d.storeId) ?? 0) + d.revenueCents / 100);
  }
  const rankingRedeTotal = [...byStore.values()].reduce((s, v) => s + v, 0);
  const catalog = productStores();
  const storesRanking: (TopItem & { id?: string; goalPct?: number; pctRede?: number; trend?: number })[] = [...byStore.entries()]
    .map(([id, amount]) => {
      const f = catalog.find((x) => x.id === id) ?? fs.find((x) => x.id === id);
      const periodGoal = f
        ? eachDay(period.start, period.end).reduce((s, iso) => s + storeGoalDay(f, iso), 0)
        : 0;
      return {
        id,
        name: labelUpper(f?.fantasia ?? id.slice(0, 8)),
        amount,
        goalPct: periodGoal > 0 ? (amount / periodGoal) * 100 : undefined,
        pctRede: rankingRedeTotal > 0 ? (amount / rankingRedeTotal) * 100 : undefined,
      };
    })
    .filter((row) => {
      if (row.amount <= 0) return false;
      if (scope.storeIds.length === 1) return row.id === scope.storeIds[0];
      return true;
    })
    .sort((a, b) => b.amount - a.amount);
  const otherStoresRanking =
    scope.storeIds.length === 1
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
      color: CORES_FORMAS[method] ?? FORMAS_FALLBACK[i % FORMAS_FALLBACK.length]!,
    }));

  // Top vendedoras  -  VENDEDOR_MILLENNIUM (sem % meta ate CRUD de Metas).
  // Com codigo do ERP agrupa pela funcionaria (nome trocado no ERP nao divide a pessoa); nome = o do dia mais recente.
  type VendAcc = {
    name: string;
    nomeDia: string;
    fat: number;
    vendas: number;
    itens: number;
    semItens: boolean;
    fatPorLoja: Map<string, number>;
    employeeId: number | null;
    geradorId: number | null;
    sellerKeys: Set<string>;
  };
  const vendMap = new Map<string, VendAcc>();
  for (const row of input.sellerDayAggs ?? []) {
    if (scope.storeIds.length > 0 && !scopedStoreIds.has(row.storeId)) continue;
    const key = row.sellerEmployeeId != null ? `e:${row.sellerEmployeeId}` : `n:${row.sellerKey}`;
    const acc = vendMap.get(key) ?? {
      name: row.sellerName,
      nomeDia: row.day,
      fat: 0,
      vendas: 0,
      itens: 0,
      semItens: false,
      fatPorLoja: new Map<string, number>(),
      employeeId: row.sellerEmployeeId ?? null,
      geradorId: null,
      sellerKeys: new Set<string>(),
    };
    acc.sellerKeys.add(row.sellerKey);
    if (row.sellerGeradorId != null) acc.geradorId = row.sellerGeradorId;
    if (row.day > acc.nomeDia) {
      acc.name = row.sellerName;
      acc.nomeDia = row.day;
    }
    acc.fat += row.revenueCents / 100;
    acc.vendas += row.salesCount;
    acc.itens += row.itemCount ?? 0;
    if (row.salesCount > 0 && !(row.itemCount && row.itemCount > 0)) acc.semItens = true;
    acc.fatPorLoja.set(row.storeId, (acc.fatPorLoja.get(row.storeId) ?? 0) + row.revenueCents);
    vendMap.set(key, acc);
  }
  const storeName = new Map(fs.map((f) => [f.id, f.fantasia]));
  const storesForSeller = (v: VendAcc): string[] =>
    [...v.fatPorLoja.entries()]
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => storeName.get(id))
      .filter((n): n is string => Boolean(n));

  const turnoDe = sellerShiftResolver(input.sellerShifts);
  const sellerShift = (v: VendAcc): string | undefined =>
    turnoDe({
      employeeId: v.employeeId,
      geradorId: v.geradorId,
      sellerKeys: v.sellerKeys,
      storeRows: [...v.fatPorLoja.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
    });

  const goalLevels = sellerGoalLevels({
    goals: goalsInPeriod,
    dayAggs: input.goalDayAggs ?? [],
    sellerDayAggs: input.goalSellerDayAggs ?? [],
    team: input.goalTeam ?? [],
    today: todayIso,
  });
  const topSellers: TopSeller[] = [...vendMap.entries()]
    .sort((a, b) => b[1].fat - a[1].fat)
    .slice(0, TOP_CARD_SIZE)
    .map(([key, v]) => {
      const goal = goalLevels.get(key);
      return {
        key,
        name: v.name,
        amount: v.fat,
        sub: `${v.vendas} venda${v.vendas === 1 ? "" : "s"}`,
        averageTicket: v.vendas > 0 ? v.fat / v.vendas : 0,
        ...(!v.semItens && v.vendas > 0 ? { pa: v.itens / v.vendas } : {}),
        storeRows: storesForSeller(v),
        turno: sellerShift(v),
        ...(goal ? { goal } : {}),
      };
    });

  // Top produtos  -  agrupado por `COD_PRODUTO` (igual a tela Produtos); variacao vs periodo anterior.
  // Lucro bruto = faturamento  CMV (RELATORIOMARGEM)  ICMS  ICMS ST da loja; sem custo num dia = null.
  const antPeriod = previousPeriod(period);
  const storeById = new Map(fs.map((f) => [f.id, f]));
  const custoKey = (storeId: string, day: string, code: string) => `${storeId}|${day}|${code}`;
  const custos = new Map<string, number>();
  for (const r of input.productCostDayAggs ?? []) {
    if (r.day < period.start || r.day > period.end) continue;
    const k = custoKey(r.storeId, r.day, r.productCode.trim());
    custos.set(k, (custos.get(k) ?? 0) + r.cmvCents / 100);
  }
  const taxas = new Map<string, ReturnType<typeof storeCostRates>>();
  const storeRate = (storeId: string) => {
    const f = storeById.get(storeId);
    if (!f) return null;
    let t = taxas.get(storeId);
    if (!t) {
      t = storeCostRates(f);
      taxas.set(storeId, t);
    }
    return t;
  };
  const custosUsados = new Set<string>();
  const vendasMargem = productDaySaleMap(input.productCostDayAggs);
  const vendasUsadas = new Set<string>();
  const prodMap = new Map<
    string,
    { name: string; codigo: string; fat: number; itens: number; cmv: number; impostos: number; semCusto: boolean }
  >();
  const prodMapAnt = new Map<string, number>();
  for (const row of input.productDayAggs ?? []) {
    if (scope.storeIds.length > 0 && !scopedStoreIds.has(row.storeId)) continue;
    const key = productRowKey(row);
    const v = productDaySaleReais(row, vendasMargem, vendasUsadas);
    if (v == null) continue;
    if (row.day >= period.start && row.day <= period.end) {
      const acc = prodMap.get(key) ?? { name: row.productName, codigo: "", fat: 0, itens: 0, cmv: 0, impostos: 0, semCusto: false };
      acc.fat += v;
      acc.itens += row.itemCount;
      if (row.productName) acc.name = row.productName;
      const code = row.productCode?.trim() ?? "";
      if (code) acc.codigo = code;
      const taxa = storeRate(row.storeId);
      if (!taxa) acc.semCusto = true;
      else {
        acc.impostos += productTaxAmount(taxa, code, v, 0);
        if (v > 0) {
          const k = custoKey(row.storeId, row.day, code);
          const cmv = code ? custos.get(k) : undefined;
          if (cmv == null) acc.semCusto = true;
          else if (!custosUsados.has(k)) {
            custosUsados.add(k);
            acc.cmv += cmv;
            acc.impostos += productTaxAmount(taxa, code, 0, cmv);
          }
        }
      }
      prodMap.set(key, acc);
    } else if (row.day >= antPeriod.start && row.day <= antPeriod.end) {
      prodMapAnt.set(key, (prodMapAnt.get(key) ?? 0) + v);
    }
  }
  const topProdutos: OverviewView["topProdutos"] = [...prodMap.entries()]
    .sort((a, b) => b[1].fat - a[1].fat)
    .map(([key, p]) => {
      const ant = prodMapAnt.get(key) ?? 0;
      const trendPct = ant > 0 ? Math.round(((p.fat - ant) / ant) * 100) : undefined;
      return {
        chave: key,
        name: labelUpper(p.name),
        amount: p.fat,
        sub: `${p.itens} itens`,
        itens: p.itens,
        trend: trendPct,
        lucro: p.semCusto ? null : p.fat - p.cmv - p.impostos,
      };
    });

  return {
    scope,
    period,
    kpis,
    kpisWpink,
    gauges,
    remainingToGoal,
    projecaoFechamento,
    goalDescription,
    seriesAxis,
    seriesLabel,
    categoryVsGoal,
    diaVsMeta: [],
    evolucao,
    paymentMethods,
    topSellers,
    topProdutos,
    storesRanking,
    rankingRedeTotal,
    otherStoresRanking,
    revenueDelta,
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
  const atual = sumAggregates(fs.map((f) => periodAggregate(f, period.start, period.end, division)));
  const custoAtual = periodCost(fs, period.start, period.end, division).cmv;
  const lucroAtual = atual.revenue - custoAtual;
  void lucroAtual; // reservado para KPIs futuros de margem/lucro
  // Periodo anterior para deltas
  const ant = previousPeriod(period);
  const anterior = sumAggregates(fs.map((f) => periodAggregate(f, ant.start, ant.end, division)));
  const custoAnterior = periodCost(fs, ant.start, ant.end, division).cmv;
  void custoAnterior; // reservado para KPIs futuros de margem/lucro
  const ticketAtual = divSeguro(atual.revenue, atual.salesCount);
  const ticketAnterior = divSeguro(anterior.revenue, anterior.salesCount);
  const temComp = anterior.salesCount > 0;
  const vsLabel = temComp ? ant.label : undefined;

  const showWpinkStrip = fs.some((f) => f.temWpink);
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
            atual.revenue > 0
              ? `${Math.round((wpinkAgg.revenue / atual.revenue) * 100)}% do faturamento`
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
          tint: "warn",
        },
        {
          label: "Nº de vendas WPINK",
          amount: num(wpinkAgg.salesCount),
          sub: `${num(wpinkAgg.itens)} itens`,
          tint: "ok",
        },
        {
          label: "Ticket médio WPINK",
          amount: brlCent(wpinkTicketFix),
          sub:
            wpinkAgg.salesCount > 0
              ? `P.A. ${num(divSeguro(wpinkAgg.itens, wpinkAgg.salesCount), 2)}`
              : undefined,
          tint: "info",
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
  const goalAttainment = metaTotal > 0 ? (atual.revenue / metaTotal) * 100 : 0;
  const faltam = metaTotal > 0 ? Math.max(0, metaTotal - atual.revenue) : 0;

  // Projecao de fechamento (curva de receita)
  const curva = revenueCurve(fs, competence);
  let accumulatedShare = 0;
  for (const iso of eachDay(`${competence}-01`, TODAY_ISO)) accumulatedShare += curva.peso(iso);
  const projetado = accumulatedShare > 0 ? atual.revenue / accumulatedShare : 0;
  const projPct = metaTotal > 0 ? (projetado / metaTotal) * 100 : 0;

  // Serie de tendencia (7 pontos)
  const serieFat = trendSeries(fs, period, division).revenue?.slice(-7) ?? [];

  // KPIs com drill-down
  const kpis: OverviewKpi[] = [
    {
      label: "Faturamento",
      amount: brlCent(atual.revenue),
      sub: metaTotal > 0 ? `Meta: ${brlCent(metaTotal)}` : undefined,
      delta: temComp ? kpiDelta(atual.revenue, anterior.revenue, vsLabel) : undefined,
      serie: serieFat,
    },
    {
      label: "CMV",
      amount: brlCent(custoAtual),
      sub: `${(divSeguro(custoAtual, atual.revenue) * 100).toFixed(0)}% do faturamento`,
      delta: temComp ? kpiDelta(custoAtual, custoAnterior, vsLabel) : undefined,
      tooltip: tipCmv,
    },
    {
      label: "Nº de vendas",
      amount: num(atual.salesCount),
      sub: `${num(atual.itens)} itens vendidos`,
      delta: temComp ? kpiDelta(atual.salesCount, anterior.salesCount, vsLabel, "vendas") : undefined,
    },
    {
      label: "Ticket médio",
      amount: brlCent(ticketAtual),
      sub: `P.A. ${num(divSeguro(atual.itens, atual.salesCount), 2)}`,
      delta: temComp ? kpiDelta(ticketAtual, ticketAnterior, vsLabel) : undefined,
    },
  ];

  // Gauges: Meta / Super Meta / Hiper Meta (degraus da primeira filial com meta)
  const storeWithGoal = fs.find((f) => Boolean(goalOfStore(f.id, competence)));
  const tiers = storeWithGoal ? goalOfStore(storeWithGoal.id, competence)?.tiers ?? [] : [];
  const gauges: GoalGauge[] = tiers.slice(0, 3).map((d: { name: string; minAttainmentPct: number }) => ({
    name: d.name,
    pct: Math.min(100, (atual.revenue / (metaTotal * d.minAttainmentPct / 100)) * 100),
    alvo: Math.round(metaTotal * d.minAttainmentPct / 100),
    achieved: atual.revenue,
  }));
  // Fallback se nao houver degraus mas houver meta
  if (gauges.length === 0 && metaTotal > 0) {
    gauges.push({ name: "Meta", pct: Math.min(100, goalAttainment), alvo: metaTotal, achieved: atual.revenue });
  }

  const remainingToGoal = faltam > 0 ? `Faltam ${brlCent(faltam)} para atingir a meta do mês` : metaTotal > 0 ? "Meta atingida" : null;
  const projecaoFechamento = projetado > 0 ? `Projeção: ${brlCent(projetado)} · ${projPct.toFixed(0)}% da meta` : null;

  // Faturamento por categoria (fixture): todas as categorias da marca, mesmo com R$ 0.
  const catMap = new Map<number, { revenue: number }>();
  for (const cat of categorias) {
    if (division && cat.division !== division) continue;
    catMap.set(cat.id, { revenue: 0 });
  }
  for (const f of fs) {
    for (const d of salesDays(f.id, period.start, period.end)) {
      for (const [id, c] of Object.entries(d.porCategoria)) {
        const cat = categorias.find((x) => x.id === Number(id));
        if (!cat || (division && cat.division !== division)) continue;
        const acc = catMap.get(cat.id) ?? { revenue: 0 };
        acc.revenue += c.revenue;
        catMap.set(cat.id, acc);
      }
    }
  }
  const categoryVsGoal: CategoryVsGoal[] = [...catMap.entries()]
    .map(([id, c]) => {
      const cat = categorias.find((x) => x.id === id)!;
      return { categoria: labelUpper(cat.name), goal: 0, achieved: c.revenue };
    })
    .sort((a, b) => b.achieved - a.achieved || a.categoria.localeCompare(b.categoria, "pt-BR"));

  // Faturamento por Dia da Semana vs Meta  -  oculto em periodo de 1 dia.
  const seriesAxis = seriesAxisForPeriod(period);
  const seriesLabel = seriesAxisLabel(period, seriesAxis);
  const diasSemanaNomes = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const dowToIdx = (dow: number) => (dow === 0 ? 6 : dow - 1);
  let diaVsMeta: DayVsGoal[] = [];
  if (seriesAxis !== "hour") {
    const diaAgg: Record<number, { fat: number; count: number }> = {};
    for (const iso of eachDay(period.start, period.end)) {
      const idx = dowToIdx(isoToDate(iso).getDay());
      if (!diaAgg[idx]) diaAgg[idx] = { fat: 0, count: 0 };
      for (const f of fs) {
        const dv = salesDay(f.id, iso);
        if (!dv) continue;
        if (division) {
          const divAg = dv.byDivision[division];
          diaAgg[idx].fat += divAg?.revenue ?? 0;
        } else {
          diaAgg[idx].fat += dv.total.revenue;
        }
      }
      diaAgg[idx].count += 1;
    }
    const dailyGoal = metaTotal > 0 ? metaTotal / 7 : 0;
    diaVsMeta = diasSemanaNomes.map((name, i) => ({
      dia: name,
      goal: dailyGoal,
      achieved: diaAgg[i] ? diaAgg[i].fat / (diaAgg[i].count || 1) : 0,
    }));
  }

  // Evolucao Fat vs Meta  -  eixo hora / dia / mes conforme o periodo.
  const periodDays = eachDay(period.start, period.end);
  const evolucao: EvolutionPoint[] = [];
  if (seriesAxis === "hour") {
    const dow = isoToDate(period.start).getDay() as Dow;
    const win = unionOpenWindow(
      fs.map((f) => effectiveWeekHours(f.horas)),
      dow,
    );
    const horas: number[] = [];
    for (let h = win.abertura; h < win.fechamento; h++) horas.push(h);
    const horasVisiveis = period.isToday ? horas.filter((h) => h <= CURRENT_HOUR) : horas;
    const goalByHour = metaTotal > 0 && horas.length > 0 ? metaTotal / horas.length : 0;
    let acumR = 0;
    let acumM = 0;
    for (const h of horasVisiveis) {
      let fatH = 0;
      for (const f of fs) {
        const a = salesDay(f.id, period.start)?.porHora[h];
        if (!a) continue;
        if (!division) fatH += a.revenue;
        else {
          const dia = salesDay(f.id, period.start)!;
          const fr = dia.total.revenue > 0 ? dia.byDivision[division].revenue / dia.total.revenue : 0;
          fatH += Math.round(a.revenue * fr);
        }
      }
      acumR += fatH;
      acumM += goalByHour;
      evolucao.push({ label: shortHour(h), achieved: acumR, goal: acumM, projection: null });
    }
  } else if (seriesAxis === "month") {
    let acumR = 0;
    let acumM = 0;
    const meses = monthsBetween(period.start, period.end);
    const goalByMonth = metaTotal > 0 && meses.length > 0 ? metaTotal / meses.length : 0;
    for (const mes of meses) {
      const agg = monthAggregate(fs, mes, division);
      acumR += agg.revenue;
      acumM += goalByMonth;
      const label = monthYear(`${mes}-01`).split(" de ")[0];
      evolucao.push({ label, achieved: acumR, goal: acumM, projection: null });
    }
  } else {
    let acumRealizado = 0;
    let acumMeta = 0;
    const goalByDay = metaTotal > 0 ? metaTotal / periodDays.length : 0;
    for (const iso of periodDays) {
      let fatDia = 0;
      for (const f of fs) {
        const dv = salesDay(f.id, iso);
        if (!dv) continue;
        if (division) fatDia += dv.byDivision[division]?.revenue ?? 0;
        else fatDia += dv.total.revenue;
      }
      acumRealizado += fatDia;
      acumMeta += goalByDay;
      evolucao.push({
        label: dayAxisLabel(iso, period),
        band: dayPointDetail(iso),
        achieved: acumRealizado,
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
      for (const [meio, val] of Object.entries(dv.porMeio)) {
        totaisForma[meio] = (totaisForma[meio] ?? 0) + val;
      }
    }
  }
  const totalFormas = Object.values(totaisForma).reduce((s, v) => s + v, 0) || 1;
  const CORES_FORMAS: Record<string, string> = {
    Pix: "var(--ok)",
    "Cartão de crédito": "var(--acc)",
    "Cartão de débito": "var(--info)",
    Dinheiro: "var(--warn)",
  };
  const paymentMethods: PaymentMethodRevenue[] = Object.entries(totaisForma)
    .sort((a, b) => b[1] - a[1])
    .map(([method, amount]) => ({
      method,
      amount,
      pct: (amount / totalFormas) * 100,
      color: CORES_FORMAS[method] ?? "var(--t2)",
    }));

  // Top vendedoras (com % da meta individual)
  const vendMap = new Map<string, { name: string; fat: number; vendas: number; itens: number; store: string }>();
  for (const f of fs) {
    const cols = collaboratorsOfStore(f.id);
    for (const iso of periodDays) {
      const dv = salesDay(f.id, iso);
      if (!dv) continue;
      for (const [colId, ag] of Object.entries(dv.bySeller)) {
        const col = cols.find((c) => c.id === colId);
        if (!col) continue;
        const acc = vendMap.get(colId) ?? { name: col.name, fat: 0, vendas: 0, itens: 0, store: f.fantasia };
        acc.fat += ag.revenue;
        acc.vendas += ag.salesCount;
        acc.itens += ag.itens;
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
    .sort((a, b) => b.fat - a.fat)
    .slice(0, TOP_CARD_SIZE)
    .map((v) => ({
      name: v.name,
      amount: v.fat,
      sub: `${v.vendas} vendas · ${individualGoal > 0 ? Math.round((v.fat / individualGoal) * 100) : 0}% da meta`,
      averageTicket: v.vendas > 0 ? v.fat / v.vendas : 0,
      goalPct: individualGoal > 0 ? Math.min(100, (v.fat / individualGoal) * 100) : 0,
      ...(v.vendas > 0 ? { pa: v.itens / v.vendas } : {}),
      storeRows: v.store ? [v.store] : [],
    }));

  // Top produtos (com categoria e trend)
  const prodMap = new Map<string, { name: string; fat: number; itens: number; categoriaNome: string }>();
  for (const [catId, c] of catMap.entries()) {
    const cat = categorias.find((x) => x.id === catId);
    if (!cat) continue;
    const prods = productsOfCategory(cat.id, `${period.start}|${division ?? ""}`, c.revenue, 0, 0);
    for (const p of prods) {
      const acc = prodMap.get(p.codProduto) ?? { name: p.name, fat: 0, itens: 0, categoriaNome: cat.name };
      acc.fat += p.receita;
      acc.itens += p.itens;
      prodMap.set(p.codProduto, acc);
    }
  }
  // Calcular trend comparando com periodo anterior
  const prodMapAnt = new Map<string, number>();
  for (const [catId, c] of catMap.entries()) {
    const prodsAnt = productsOfCategory(catId, `${ant.start}|${division ?? ""}`, c.revenue * 0.85, 0, 0);
    for (const p of prodsAnt) {
      prodMapAnt.set(p.codProduto, (prodMapAnt.get(p.codProduto) ?? 0) + p.receita);
    }
  }
  const topProdutos: (TopItem & { sub?: string; itens?: number; categoria?: string; trend?: number })[] = [...prodMap.entries()]
    .map(([cod, p]) => {
      const fatAnt = prodMapAnt.get(cod) ?? 0;
      const trendPct = fatAnt > 0 ? ((p.fat - fatAnt) / fatAnt) * 100 : null;
      return {
        name: labelUpper(p.name),
        amount: p.fat,
        sub: `${p.itens} itens`,
        itens: p.itens,
        categoria: labelUpper(p.categoriaNome),
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
    const fatAnterior = periodAggregate(f, ant.start, ant.end, division).revenue;
    const trend = fatAnterior > 0 ? Math.round(((periodRevenue - fatAnterior) / fatAnterior) * 100) : undefined;
    return {
      name: labelUpper(f.fantasia),
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
    projecaoFechamento,
    revenueDelta: temComp ? kpiDelta(atual.revenue, anterior.revenue, vsLabel) : undefined,
    seriesAxis,
    seriesLabel,
    categoryVsGoal,
    diaVsMeta,
    evolucao,
    paymentMethods,
    topSellers,
    topProdutos,
    storesRanking,
  };
}
