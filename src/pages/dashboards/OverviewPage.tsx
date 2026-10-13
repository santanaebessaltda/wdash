import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { paths } from "@/router/paths";
import { GoalLevelSummary } from "@/components/wedash/GoalLevelsBar";
import { ProductNameCell } from "@/components/wedash/ProductNameCell";
import { Avatar, Badge, Card, CardHeader, CardTitle, ProgressBar, RadialProgress, StatCard, DateRangePicker, PageHeader, Button, ThSort, type SortDir } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { AreaLineChart, BarChart, DonutChart } from "@/components/charts";
import { useScope } from "@/pages/dashboard/useScope";
import { buildOverviewView, resolvePeriod, previousPeriod, TOP_CARD_SIZE, type OverviewKpi } from "@/data/wedash/dashboard";
import {
  fetchSalesDayAggs,
  fetchSalesHourAggs,
  fetchSalesCategoryDayAggs,
  fetchSalesCategoryCatalog,
  fetchSalesPaymentDayAggs,
  fetchSalesSellerDayAggs,
  fetchSalesProductDayAggs,
  fetchSalesProductCostDayAggs,
  fetchSalesCoverage,
  fetchSellerShifts,
  fetchSyncWatermark,
} from "@/data/wedash/salesRepo";
import type {
  SalesCategoryDayAgg,
  SalesCategoryRef,
  SalesDayAgg,
  SalesHourAgg,
  SalesPaymentDayAgg,
  SalesSellerDayAgg,
  SalesProductDayAgg,
  SalesProductCostDayAgg,
  SellerShiftRef,
} from "@/data/wedash/salesTypes";
import { brlCent, isoToDate, labelUpper, num, deltaTip, titleName } from "@/lib/format";
import type { DateRange, DateRangeChangeMeta } from "@/components/ui/DateRangePicker";
import { useActiveSession } from "@/session/SessionProvider";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useMonthFill } from "@/pages/dashboard/useMonthFill";
import { useDeepHistoryFill } from "@/pages/dashboard/useDeepHistoryFill";
import { MonthFillNotice, pickerMinDate } from "@/pages/dashboard/MonthFillNotice";
import { DeepHistoryNotice } from "@/pages/dashboard/DeepHistoryNotice";
import { InitialSyncNotice } from "@/pages/dashboard/InitialSyncNotice";
import { StoreHoursNotice } from "@/pages/dashboard/StoreHoursNotice";
import { ErpStatusNotice } from "@/pages/dashboard/ErpStatusNotice";
import { FirstStepsCard, useFirstSteps } from "@/pages/dashboard/FirstSteps";
import { ReportHeader, useExportPdf } from "@/pages/dashboard/ReportHeader";
import { usePrintMode } from "@/lib/printMode";
import { cn } from "@/lib/cn";
import { useProductDetail } from "@/pages/dashboard/ProductDetail";
import { useTeamMemberDetail } from "@/pages/dashboard/TeamMemberDetail";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { OverviewSkeleton } from "@/components/wedash/LoadingSkeletons";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { calendarTodayIso } from "@/data/wedash/clock";
import { goalHistoryDayRange, goalHistorySameWeekdays } from "@/data/wedash/goalCurve";
import { fetchGoals, fetchGoalTeam, type GoalRecord, type GoalTeamMember } from "@/data/wedash/goalsRepo";
import { storesForSession } from "@/data/wedash/stores";
import {
  applyPeriodDateChange,
  dateRangeFromPeriod,
  periodActivePresetId,
  periodDisplayLabel,
} from "@/pages/dashboard/periodPicker";
type TopProdSort = "name" | "itens" | "faturamento" | "lucro" | "variacao";

/** Ouro / prata / bronze  -  mesmo padrao do Sales leaderboard (Vela). */
const RANK_MEDAL = ["#f7b84e", "#c7cdd6", "#d99a5c"];

const IconFat = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);
const IconCmv = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="21" r="1" />
    <circle cx="19" cy="21" r="1" />
    <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
  </svg>
);
const IconVendas = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const IconTicket = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);

const KPI_ICONS = [IconFat, IconCmv, IconVendas, IconTicket];

/** Cores fixas para as lojas no donut e barras do Ranking de Lojas. */
const STORE_COLORS = ["var(--acc)", "var(--info)", "var(--ok)", "var(--warn)", "var(--bad)"];
/** Fatia neutra "Demais lojas" (1 loja no StorePicker)  -  nao compete com a cor da loja. */
const OTHER_STORES_COLOR = "color-mix(in srgb, var(--t2) 40%, transparent)";

/** Cores distintas para cada KPI card (hero). */
const KPI_COLORS = [
  { iconColor: "var(--acc)", iconBg: "var(--acc-soft)" },
  { iconColor: "var(--warn)", iconBg: "rgba(245,158,11,0.12)" },
  { iconColor: "var(--ok)", iconBg: "var(--ok-soft)" },
  { iconColor: "var(--info)", iconBg: "rgba(59,130,246,0.12)" },
];

/**
 * Badge de delta  -  so % no chip; base do comparativo no tooltip (igual StatCard).
 * `metrica` nomeia o que o badge compara quando o titulo do card fala de outra coisa
 * ("Faturamento total em relacao ao mes passado: R$ ...").
 */
function BadgeVsAnterior({
  delta,
  metric,
}: {
  delta?: { value: string; positive: boolean; vs?: string; diff?: string; anterior?: string };
  metric?: string;
}) {
  if (!delta) return null;
  const badge = (
    <Badge variant={delta.positive ? "success" : "danger"}>
      {delta.positive ? "+" : "−"}
      {delta.value}
    </Badge>
  );
  const tip = deltaTip(delta, metric);
  return tip ? <Tooltip label={tip}>{badge}</Tooltip> : badge;
}

/** Titulo da tela inicial pos-login: saudacao com o primeiro nome. */
function welcomeTitle(name: string): string {
  const first = titleName(name).split(" ")[0];
  return first ? `Bem-vindo(a) de volta, ${first} 👋` : "Bem-vindo(a) de volta 👋";
}

export default function OverviewPage() {
  const session = useActiveSession();
  const navigate = useNavigate();
  const { scope, setScope } = useScope();
  const [dayAggs, setDayAggs] = useState<SalesDayAgg[]>([]);
  const [hourAggs, setHourAggs] = useState<SalesHourAgg[]>([]);
  const [categoryDayAggs, setCategoryDayAggs] = useState<SalesCategoryDayAgg[]>([]);
  const [categoryCatalog, setCategoryCatalog] = useState<SalesCategoryRef[]>([]);
  const [paymentDayAggs, setPaymentDayAggs] = useState<SalesPaymentDayAgg[]>([]);
  const [sellerDayAggs, setSellerDayAggs] = useState<SalesSellerDayAgg[]>([]);
  const [sellerShifts, setSellerShifts] = useState<SellerShiftRef[]>([]);
  const [productDayAggs, setProductDayAggs] = useState<SalesProductDayAgg[]>([]);
  const [productCostDayAggs, setProductCostDayAggs] = useState<SalesProductCostDayAgg[]>([]);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinSkeleton(loading);
  const [watermark, setWatermark] = useState<Date | null>(null);
  const [coverageFrom, setCoverageFrom] = useState<Date | null>(null);
  const [goalHistoryDayAggs, setGoalHistoryDayAggs] = useState<SalesDayAgg[]>([]);
  const [goalHistoryHourAggs, setGoalHistoryHourAggs] = useState<SalesHourAgg[]>([]);
  const [prevDayAggs, setPrevDayAggs] = useState<SalesDayAgg[]>([]);
  const [prevHourAggs, setPrevHourAggs] = useState<SalesHourAgg[]>([]);
  const [goals, setGoals] = useState<GoalRecord[]>([]);
  const [goalDayAggs, setGoalDayAggs] = useState<SalesDayAgg[]>([]);
  const [goalSellerDayAggs, setGoalSellerDayAggs] = useState<SalesSellerDayAgg[]>([]);
  const [goalTeam, setGoalTeam] = useState<GoalTeamMember[]>([]);
  // Catalogo de lojas (horario/fuso) hidratado depois do 1 render  ->  recalcula eixos.
  const [storesTick, setStoresTick] = useState(0);
  useEffect(() => {
    const onStores = () => setStoresTick((n) => n + 1);
    window.addEventListener("wedash:stores", onStores);
    return () => window.removeEventListener("wedash:stores", onStores);
  }, []);
  const [topProdSort, setTopProdSort] = useState<TopProdSort>("faturamento");
  const [topProdDir, setTopProdDir] = useState<SortDir>("desc");
  /** So a leitura mais recente aplica setState (evita corrida stale sobrescrever pos-FORCE). */
  const reloadGen = useRef(0);

  const reloadAggs = useCallback(async () => {
    const gen = ++reloadGen.current;
    const period = resolvePeriod(scope.period, calendarTodayIso());
    const ant = previousPeriod(period);
    const singleDay = period.start === period.end;
    const goalDays = goalHistoryDayRange(period.start);
    const today = calendarTodayIso();
    const goalStoreIds =
      scope.storeIds.length > 0 ? scope.storeIds : storesForSession(session.stores).map((s) => s.id);
    const goalsP = fetchGoals({ tenantId: session.tenantId, storeIds: goalStoreIds, from: period.start, to: period.end });
    // Atingimento da meta = do inicio de cada meta ate hoje (pode sair do periodo da tela).
    // Nivel de meta no Destaques da equipe = mesma janela, por pessoa.
    const vazio = { days: [] as SalesDayAgg[], sellers: [] as SalesSellerDayAgg[], team: [] as GoalTeamMember[] };
    const goalDataP = goalsP.then(async (gs) => {
      if (gs.length === 0) return vazio;
      const from = gs.reduce((m, g) => (g.startsOn < m ? g.startsOn : m), gs[0]!.startsOn);
      const end = gs.reduce((m, g) => (g.endsOn > m ? g.endsOn : m), gs[0]!.endsOn);
      const to = end < today ? end : today;
      if (from > to) return vazio;
      const storeIds = [...new Set(gs.map((g) => g.storeId))];
      const [days, sellers, team] = await Promise.all([
        fetchSalesDayAggs({ tenantId: session.tenantId, storeIds, from, to, brand: "ALL" }),
        fetchSalesSellerDayAggs({ tenantId: session.tenantId, storeIds, from, to }),
        fetchGoalTeam(session.tenantId, storeIds),
      ]);
      return { days, sellers, team };
    });
    try {
      const [days, hours, cats, catalog, payments, sellers, products, productCosts, wm, cov, goalHistDays, goalHistHours, prevDays, prevHours, shifts, goalsLoaded, goalAggs] = await Promise.all([
        fetchSalesDayAggs({
          tenantId: session.tenantId,
          // Sempre a rede: Ranking precisa do total/participacao mesmo com 1 loja no StorePicker.
          storeIds: [],
          from: period.start,
          to: period.end,
          brand: null,
        }),
        singleDay
          ? fetchSalesHourAggs({
              tenantId: session.tenantId,
              storeIds: scope.storeIds,
              day: period.start,
              brand: null,
            })
          : Promise.resolve([] as SalesHourAgg[]),
        fetchSalesCategoryDayAggs({
          tenantId: session.tenantId,
          storeIds: scope.storeIds,
          from: period.start,
          to: period.end,
          brand: null,
        }),
        fetchSalesCategoryCatalog({
          tenantId: session.tenantId,
          storeIds: scope.storeIds,
          brand: null,
        }),
        fetchSalesPaymentDayAggs({
          tenantId: session.tenantId,
          storeIds: scope.storeIds,
          from: period.start,
          to: period.end,
        }),
        fetchSalesSellerDayAggs({
          tenantId: session.tenantId,
          storeIds: scope.storeIds,
          from: period.start,
          to: period.end,
        }),
        fetchSalesProductDayAggs({
          tenantId: session.tenantId,
          storeIds: scope.storeIds,
          from: ant.start < period.start ? ant.start : period.start,
          to: period.end,
        }),
        fetchSalesProductCostDayAggs({
          tenantId: session.tenantId,
          storeIds: scope.storeIds,
          from: period.start,
          to: period.end,
        }),
        fetchSyncWatermark(session.tenantId).catch(() => null),
        fetchSalesCoverage(session.tenantId, scope.storeIds),
        fetchSalesDayAggs({
          tenantId: session.tenantId,
          storeIds: scope.storeIds,
          from: goalDays.from,
          to: goalDays.to,
          brand: "ALL",
        }),
        singleDay
          ? fetchSalesHourAggs({
              tenantId: session.tenantId,
              storeIds: scope.storeIds,
              day: goalHistorySameWeekdays(period.start),
              brand: "ALL",
            })
          : Promise.resolve([] as SalesHourAgg[]),
        fetchSalesDayAggs({
          tenantId: session.tenantId,
          storeIds: scope.storeIds,
          from: ant.start,
          to: ant.end,
          brand: null,
        }),
        period.endsToday
          ? fetchSalesHourAggs({
              tenantId: session.tenantId,
              storeIds: scope.storeIds,
              day: ant.end,
              brand: null,
            })
          : Promise.resolve([] as SalesHourAgg[]),
        fetchSellerShifts(session.tenantId),
        goalsP,
        goalDataP,
      ]);
      if (gen !== reloadGen.current) return;
      setGoals(goalsLoaded);
      setGoalDayAggs(goalAggs.days);
      setGoalSellerDayAggs(goalAggs.sellers);
      setGoalTeam(goalAggs.team);
      setDayAggs(days);
      setHourAggs(hours);
      setGoalHistoryDayAggs(goalHistDays);
      setGoalHistoryHourAggs(goalHistHours);
      setPrevDayAggs(prevDays);
      setPrevHourAggs(prevHours);
      setCategoryDayAggs(cats);
      setCategoryCatalog(catalog);
      setPaymentDayAggs(payments);
      setSellerDayAggs(sellers);
      setSellerShifts(shifts);
      setProductDayAggs(products);
      setProductCostDayAggs(productCosts);
      setWatermark(wm);
      setCoverageFrom(cov.from ? isoToDate(cov.from) : null);
    } catch (e) {
      if (gen !== reloadGen.current) return;
      console.error("Overview reloadAggs:", e);
    }
  }, [scope, session.tenantId, session.stores]);

  useEffect(() => {
    const onSynced = () => void reloadAggs();
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [reloadAggs]);

  // So a 1 carga usa `loading` (desabilita o botao). Re-fetch de escopo/aba
  // atualiza os dados em silencio  -  senao o Atualizar "pisca" (disabled:opacity-50).
  const hasLoadedOnce = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!hasLoadedOnce.current) setLoading(true);
      await reloadAggs();
      if (!cancelled) {
        hasLoadedOnce.current = true;
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadAggs]);

  // Enquanto o primeiro sync nao grava watermark, repolha (SEED pode demorar).
  useEffect(() => {
    if (watermark != null) return;
    const id = window.setInterval(() => {
      void reloadAggs();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [watermark, reloadAggs]);

  // Enquanto o historico ainda cresce (HISTORY), repolha cobertura do picker.
  useEffect(() => {
    const id = window.setInterval(() => {
      void fetchSalesCoverage(session.tenantId, scope.storeIds).then((cov) => {
        setCoverageFrom(cov.from ? isoToDate(cov.from) : null);
      });
    }, 30_000);
    return () => window.clearInterval(id);
  }, [session.tenantId, scope.storeIds]);

  const view = useMemo(
    () =>
      buildOverviewView(scope, {
        dayAggs,
        hourAggs,
        categoryDayAggs,
        categoryCatalog,
        paymentDayAggs,
        sellerDayAggs,
        sellerShifts,
        productDayAggs,
        productCostDayAggs,
        goalHistoryDayAggs,
        goalHistoryHourAggs,
        prevDayAggs,
        prevHourAggs,
        goals,
        goalDayAggs,
        goalSellerDayAggs,
        goalTeam,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, dayAggs, hourAggs, categoryDayAggs, categoryCatalog, paymentDayAggs, sellerDayAggs, sellerShifts, productDayAggs, productCostDayAggs, goalHistoryDayAggs, goalHistoryHourAggs, prevDayAggs, prevHourAggs, goals, goalDayAggs, goalSellerDayAggs, goalTeam, storesTick],
  );

  // A metrica escolhe quais entram (sempre os maiores); a direcao so reordena esses.
  // "Produto" (nome) reordena o Top por faturamento.
  const topProdutosOrdenados = useMemo(() => {
    type P = (typeof view.topProdutos)[number];
    const metric = (p: P) =>
      topProdSort === "itens"
        ? (p.itens ?? 0)
        : topProdSort === "lucro"
          ? (p.lucro ?? -Infinity)
          : topProdSort === "variacao"
            ? (p.trend ?? -Infinity)
            : p.amount;
    const top = [...view.topProdutos]
      .sort((a, b) => metric(b) - metric(a) || b.amount - a.amount)
      .slice(0, TOP_CARD_SIZE);
    if (topProdSort === "name") {
      const dir = topProdDir === "asc" ? 1 : -1;
      return top.sort((a, b) => a.name.localeCompare(b.name, "pt-BR") * dir);
    }
    return topProdDir === "asc" ? top.reverse() : top;
  }, [view.topProdutos, topProdSort, topProdDir]);

  function toggleTopProdSort(key: TopProdSort) {
    if (topProdSort === key) {
      setTopProdDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTopProdSort(key);
      setTopProdDir(key === "name" ? "asc" : "desc");
    }
  }

  // Resolve o DateRange a partir do escopo  -  sempre mostra algo selecionado.
  const dateRange = useMemo(() => dateRangeFromPeriod(scope.period), [scope.period]);
  const currentPeriod = resolvePeriod(scope.period, calendarTodayIso());
  const monthFill = useMonthFill();
  const deepHistoryFill = useDeepHistoryFill();
  const printing = usePrintMode();
  const exportar = useExportPdf("Visão geral");
  const firstSteps = useFirstSteps(scope.storeIds);
  const { abrir: abrirDetalhe, modal: detalheModal } = useProductDetail({ scope, tenantId: session.tenantId });
  const goalLevels = useMemo(
    () => new Map(view.topSellers.flatMap((v) => (v.key && v.goal ? [[v.key, v.goal] as const] : []))),
    [view.topSellers],
  );
  const { abrir: abrirPessoa, modal: pessoaModal } = useTeamMemberDetail({ scope, tenantId: session.tenantId, goalLevels });
  function onDateChange(r: DateRange, goal?: DateRangeChangeMeta) {
    setScope(applyPeriodDateChange(scope, r, goal));
  }

  return (
    <div className="flex flex-col p-4 sm:p-6 print:p-0">
      <ReportHeader />
      <PageHeader
        crumbs={[{ label: "Dashboard", to: "/dashboard/visao-geral" }, { label: "Visão geral" }]}
        title={printing ? "Visão geral" : welcomeTitle(session.name)}
        subtitle="Acompanhe os principais indicadores, metas e resultados da operação."
        actions={
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
              <DateRangePicker
                value={dateRange}
                onChange={onDateChange}
                displayLabel={periodDisplayLabel(scope.period)}
                activePresetId={periodActivePresetId(scope.period)}
                minDate={pickerMinDate(coverageFrom, monthFill)}
              />
              <Button variant="primary" onClick={exportar}>
                Exportar
              </Button>
            </div>
          </div>
        }
      />

      <ErpStatusNotice />
      <InitialSyncNotice />
      <MonthFillNotice fill={monthFill} start={currentPeriod.start} end={currentPeriod.end} />
      <DeepHistoryNotice
        fill={deepHistoryFill}
        monthFill={monthFill}
        start={currentPeriod.start}
        end={currentPeriod.end}
      />
      {/* O horario de funcionamento ja e um dos primeiros passos. */}
      {firstSteps.status === "hidden" && <StoreHoursNotice />}
      {firstSteps.status === "visible" && (
        <FirstStepsCard steps={firstSteps.steps} doneCount={firstSteps.doneCount} tenantId={firstSteps.tenantId} />
      )}

      {showSkeleton ? (
        <OverviewSkeleton weekdays={currentPeriod.start !== currentPeriod.end} />
      ) : (
      <>

      {/* KPI row  -  4 cards */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {view.kpis.map((kpi, i) => (
          <KpiCard key={kpi.label} kpi={kpi} Icon={KPI_ICONS[i]} colorIdx={i} />
        ))}
      </div>

      {/* Linha: Atingimento da Meta + Faturamento vs Meta */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.6fr]">
        {(() => {
          const goal = view.gauges.find((g) => g.name === "Meta") ?? view.gauges[0];
          const fatAcum = view.evolucao[view.evolucao.length - 1]?.achieved ?? 0;
          const pct = goal ? Math.round(goal.pct) : 0;
          const achieved = goal?.achieved ?? fatAcum;
          const alvo = goal?.alvo ?? 0;
          const faltamValor = goal ? Math.max(0, goal.alvo - goal.achieved) : 0;
          const closedGoal = view.projecaoFechamento === "Meta encerrada";
          const projecaoValor =
            goal && !closedGoal ? (view.projecaoFechamento?.replace(/^Projeção:\s*/i, "") ?? "—") : "—";
          if (!goal) {
            return (
              <Card className="flex flex-col">
                <div className="mb-4">
                  <CardTitle>Atingimento da meta</CardTitle>
                </div>
                <EmptyBlock
                  icon="🎯"
                  title="Meta não configurada"
                  description="Cadastre uma meta para este período para acompanhar o atingimento e a projeção de fechamento."
                  action={
                    <Button size="sm" onClick={() => navigate(paths.goals)}>
                      Criar meta
                    </Button>
                  }
                />
              </Card>
            );
          }
          return (
            <Card>
              <div className="mb-4">
                <CardTitle>Atingimento da meta</CardTitle>
                {view.goalDescription && <p className="mt-0.5 text-[11px] font-semibold text-t2">{view.goalDescription}</p>}
              </div>
              <div className="relative mx-auto mb-4 h-[150px] w-[150px]">
                <RadialProgress value={pct} size={150} stroke={15} trackColor="var(--bg-inset)" label="da meta" />
              </div>
              <div className="flex flex-col gap-2.5">
                <div className="flex justify-between">
                  <span className="text-[12.5px] text-t2">Realizado</span>
                  <span className="text-[13px] font-bold text-t0">{brlCent(achieved)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[12.5px] text-t2">Meta</span>
                  <span className={`text-[13px] font-bold ${goal && pct < 100 ? "text-warn" : goal ? "text-ok" : "text-t2"}`}>
                    {goal ? brlCent(alvo) : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[12.5px] text-t2">Faltam</span>
                  <span className={`text-[13px] font-bold ${goal && faltamValor > 0 ? "text-warn" : goal ? "text-ok" : "text-t2"}`}>
                    {!goal ? "—" : faltamValor <= 0 ? "Meta atingida" : brlCent(faltamValor)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[12.5px] text-t2">Projeção</span>
                  <span className="text-right">
                    <span className={`block text-[13px] font-bold ${goal && !closedGoal ? "text-t0" : "text-t2"}`}>{projecaoValor}</span>
                    {closedGoal && <span className="block text-[11px] font-semibold text-t2">Meta encerrada</span>}
                  </span>
                </div>
              </div>
            </Card>
          );
        })()}

        <Card padding="lg" className="flex flex-col">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5">
                <CardTitle>Faturamento x meta</CardTitle>
                <Tooltip label="Compare o faturamento realizado com a meta esperada para cada período. A meta é distribuída ao longo do período com base no histórico de vendas da operação.">
                  <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 hover:text-t1 transition-colors">
                    ?
                  </span>
                </Tooltip>
              </div>
              {view.gauges.length > 0 &&
                (view.evolucao[view.evolucao.length - 1]?.achieved ?? 0) + (view.evolucao[view.evolucao.length - 1]?.goal ?? 0) > 0 && (
              <>
              <p className="mt-0.5 text-[11px] font-semibold text-t2">{view.seriesLabel}</p>
              <div className="mt-2.5 flex flex-wrap gap-5">
                <div>
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                    <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--ok)]" />Realizado
                  </span>
                  <p className="mt-0.5 font-mono text-base font-extrabold text-t0">
                    {brlCent(view.evolucao[view.evolucao.length - 1]?.achieved ?? 0)}
                  </p>
                </div>
                <div>
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                    <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--warn)]" />Meta
                  </span>
                  <p className="mt-0.5 font-mono text-base font-extrabold text-t0">
                    {brlCent(view.evolucao[view.evolucao.length - 1]?.goal ?? 0)}
                  </p>
                </div>
              </div>
              </>
              )}
            </div>
            {view.gauges.length > 0 && <BadgeVsAnterior delta={view.revenueDelta} />}
          </div>
          {(() => {
            if (view.gauges.length === 0) {
              return (
                <EmptyBlock
                  icon="🎯"
                  title="Meta não configurada"
                  description="Cadastre uma meta para este período para comparar o faturamento realizado com o esperado."
                  action={
                    <Button size="sm" onClick={() => navigate(paths.goals)}>
                      Criar meta
                    </Button>
                  }
                />
              );
            }
            // evolucao vem acumulada; o grafico mostra o valor de cada hora/dia/mes.
            const serie = view.evolucao
              .map((e, i) => {
                const prev = view.evolucao[i - 1];
                return {
                  ...e,
                  achieved: e.achieved - (prev?.achieved ?? 0),
                  goal: e.goal - (prev?.goal ?? 0),
                };
              })
              .filter((e) => !e.ancora);
            if (serie.every((e) => e.achieved === 0 && e.goal === 0)) {
              return <EmptyBlock />;
            }
            return (
              <AreaLineChart
                data={serie.map((e) => (e.futuro ? null : e.achieved))}
                compareData={serie.map((e) => e.goal)}
                labels={serie.map((e) => e.label)}
                tooltipLabels={serie.map((e) => e.band)}
                color="var(--ok)"
                compareColor="var(--warn)"
                formatValue={brlCent}
                showAxisLabels
              />
            );
          })()}
        </Card>
      </div>

      {/* Linha: Categoria vs Meta + Dia da Semana vs Meta (Dia some em periodo de 1 dia) */}
      <div className={`mt-4 grid grid-cols-1 gap-4 ${view.diaVsMeta.length > 0 ? "lg:grid-cols-2" : ""}`}>
        <Card padding="lg" className="flex flex-col">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5">
                <CardTitle>Faturamento por categoria</CardTitle>
                <Tooltip label="Veja como o faturamento está distribuído entre as categorias de produtos.">
                  <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 hover:text-t1 transition-colors">
                    ?
                  </span>
                </Tooltip>
              </div>
            </div>
            <BadgeVsAnterior delta={view.revenueDelta} metric="Faturamento total" />
          </div>
          {view.categoryVsGoal.filter((c) => c.achieved > 0).length === 0 ? (
            <EmptyBlock />
          ) : (
            <BarChart
              data={view.categoryVsGoal
                .filter((c) => c.achieved > 0)
                .map((c) => ({
                  label: c.categoria,
                  value: c.achieved,
                }))}
              height={220}
              color="var(--acc)"
              formatValue={brlCent}
              onSelect={(d) => abrirDetalhe({ kind: "categoria", name: d.label })}
            />
          )}
        </Card>
        {view.diaVsMeta.length > 0 && (
          <Card padding="lg" className="flex flex-col">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <CardTitle>Dias da semana x meta</CardTitle>
                  <Tooltip label="Compare o faturamento médio de cada dia da semana com a meta prevista para esse dia.">
                    <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 hover:text-t1 transition-colors">
                      ?
                    </span>
                  </Tooltip>
                </div>
                {!view.diaVsMeta.every((d) => d.achieved === 0 && d.goal === 0) && (
                <div className="mt-2.5 flex flex-wrap gap-5">
                  <div>
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                      <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--info)]" />Realizado
                    </span>
                    <p className="mt-0.5 font-mono text-base font-extrabold text-t0">
                      {brlCent(view.diaVsMeta.reduce((s, d) => s + d.achieved, 0))}
                    </p>
                  </div>
                  <div>
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                      <span
                        className="inline-block w-3 border-t-2 border-dashed border-[var(--warn)]"
                        aria-hidden
                      />
                      Meta
                    </span>
                    <p className="mt-0.5 font-mono text-base font-extrabold text-t0">
                      {brlCent(view.diaVsMeta.reduce((s, d) => s + d.goal, 0))}
                    </p>
                  </div>
                </div>
                )}
              </div>
              <BadgeVsAnterior delta={view.revenueDelta} metric="Faturamento total" />
            </div>
            {view.diaVsMeta.every((d) => d.achieved === 0 && d.goal === 0) ? (
              <EmptyBlock />
            ) : (
            <BarChart
              data={view.diaVsMeta.map((d) => ({
                label: d.dia,
                value: d.achieved,
                goal: d.goal > 0 ? d.goal : undefined,
              }))}
              height={220}
              color="var(--info)"
              goalColor="var(--warn)"
              formatValue={brlCent}
            />
            )}
          </Card>
        )}
      </div>

      {/* Linha: Ranking de Lojas + Formas de Pagamento */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader className="items-center">
            <CardTitle>Ranking de filiais</CardTitle>
            {scope.storeIds.length === 1 && view.storesRanking.length > 0 && (view.rankingRedeTotal ?? 0) > 0 && (
              <Badge variant="accent">
                Rede: {brlCent(view.rankingRedeTotal ?? 0)}
              </Badge>
            )}
          </CardHeader>
          {view.storesRanking.length === 0 ? (
            <EmptyBlock />
          ) : (
            (() => {
              const totalRede =
                (view.rankingRedeTotal ?? view.storesRanking.reduce((s, l) => s + l.amount, 0)) || 1;
              const singleStore = scope.storeIds.length === 1;
              const storeAmount = view.storesRanking[0]?.amount ?? 0;
              const valorDemais = singleStore ? Math.max(0, totalRede - storeAmount) : 0;
              // 1 loja: fatia da loja x "Demais lojas" (resto da rede)  -  mostra o peso real na rede.
              const demais: (typeof view.storesRanking)[number] | null =
                singleStore && valorDemais > 0
                  ? {
                      name: `Demais filiais${view.otherStoresRanking ? ` (${view.otherStoresRanking})` : ""}`,
                      amount: valorDemais,
                    }
                  : null;
              const donutSegments = [
                ...view.storesRanking.map((l, i) => ({
                  label: l.name,
                  value: l.amount,
                  color: STORE_COLORS[i % STORE_COLORS.length],
                })),
                ...(demais ? [{ label: demais.name, value: demais.amount, color: OTHER_STORES_COLOR }] : []),
              ];
              return (
                <>
                  <div className="flex flex-1 flex-col items-center justify-center py-2">
                    <DonutChart
                      segments={donutSegments}
                      size={148}
                      thickness={20}
                      centerLabel={singleStore ? "da rede" : "Total"}
                      centerValue={
                        singleStore
                          ? `${Math.round((storeAmount / totalRede) * 100)}%`
                          : brlCent(totalRede)
                      }
                    />
                  </div>
                  <div className="mt-4 flex flex-col gap-3">
                    {[...view.storesRanking, ...(demais ? [demais] : [])].map((store, idx) => {
                      const pctRede = Math.round(
                        store.pctRede ?? (totalRede > 0 ? (store.amount / totalRede) * 100 : 0),
                      );
                      const pctBar = Math.min(100, Math.max(0, pctRede));
                      const cor = store === demais ? OTHER_STORES_COLOR : STORE_COLORS[idx % STORE_COLORS.length];
                      return (
                        <div key={"id" in store && store.id ? String(store.id) : `${store.name}-${idx}`} className="min-w-0 rounded-xl bg-bg-inset p-3">
                          <div className="mb-1.5 flex min-w-0 items-baseline gap-2">
                            <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] font-bold text-t0">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: cor }} />
                              <span className="min-w-0 truncate uppercase" title={store.name}>{store.name}</span>
                            </span>
                            <span className="shrink-0 font-mono text-[13px] font-extrabold tabular-nums text-t0">
                              {brlCent(store.amount)}
                            </span>
                          </div>
                          <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-bg-2">
                            <div className="h-full rounded-full" style={{ width: `${pctBar}%`, background: cor }} />
                          </div>
                          <span className="text-[11px] font-semibold text-t2">
                            {pctBar}% da rede
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()
          )}
        </Card>
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Formas de pagamento</CardTitle>
          </CardHeader>
          {view.paymentMethods.length === 0 ? (
            <EmptyBlock />
          ) : (
            (() => {
              const total = view.paymentMethods.reduce((s, f) => s + f.amount, 0) || 1;
              return (
                <div className="flex flex-1 flex-col justify-center px-4 pb-4">
                  {/* Padrao Expense breakdown  -  igual Financeiro */}
                  <div className="mx-auto my-2">
                    <DonutChart
                      segments={view.paymentMethods.map((f) => ({
                        label: labelUpper(f.method),
                        value: f.amount,
                        color: f.color,
                      }))}
                      centerLabel="Total"
                      centerValue={brlCent(total)}
                    />
                  </div>
                  <div className="mt-2 flex flex-col gap-2">
                    {view.paymentMethods.map((f) => {
                      const pct = Math.round((f.amount / total) * 100);
                      return (
                        <div key={f.method} className="flex items-center gap-2.5">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: f.color }} />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-t1">{labelUpper(f.method)}</span>
                          <span className="shrink-0 font-mono text-[12.5px] font-bold text-t0">{brlCent(f.amount)}</span>
                          <span className="min-w-[32px] shrink-0 text-right text-[11.5px] font-semibold text-t2">{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          )}
        </Card>
      </div>

      {/* Par: Top Vendedoras + Top Produtos */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader>
            <div className="flex w-full items-center justify-between gap-1.5">
              <CardTitle>Destaques da equipe</CardTitle>
              <Badge variant="accent">Top {TOP_CARD_SIZE}</Badge>
            </div>
          </CardHeader>
          {view.topSellers.length === 0 ? (
            <EmptyBlock />
          ) : (
          <div className="flex flex-col gap-1 px-2 pb-3">
            {view.topSellers.map((v, idx) => {
              const hasGoal = v.goal != null || v.goalPct != null;
              const pct = v.goal?.attainmentPct ?? v.goalPct ?? 0;
              const key = v.key;
              const abrir = key ? () => abrirPessoa(key, v.name) : undefined;
              return (
                <div
                  key={v.name}
                  role={abrir ? "button" : undefined}
                  tabIndex={abrir ? 0 : undefined}
                  onClick={abrir}
                  onKeyDown={(e) => {
                    if (abrir && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      abrir();
                    }
                  }}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-2 py-1.5",
                    abrir && "cursor-pointer transition-colors hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none",
                  )}
                >
                  <span
                    className="w-5 shrink-0 text-center text-[13px] font-extrabold"
                    style={{ color: RANK_MEDAL[idx] ?? "var(--t2)" }}
                  >
                    {idx + 1}
                  </span>
                  <Avatar name={v.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-[13px] font-bold text-t0">{v.name}</span>
                      <span className="shrink-0 font-mono text-[13px] font-extrabold text-ok">{brlCent(v.amount)}</span>
                    </div>
                    {!v.goal && hasGoal && <ProgressBar value={Math.min(100, pct)} height={5} />}
                    <div className={`flex flex-wrap items-center gap-x-1.5 text-[11px] text-t2 ${hasGoal && !v.goal ? "mt-0.5" : ""}`}>
                      <span>{v.sub?.split("·")[0]?.trim() ?? ""}</span>
                      {v.averageTicket != null && v.averageTicket > 0 && (
                        <>
                          <span>·</span>
                          <span>Ticket médio {brlCent(v.averageTicket)}</span>
                        </>
                      )}
                      {v.pa != null && (
                        <>
                          <span>·</span>
                          <span>P.A. {num(v.pa, 2)}</span>
                        </>
                      )}
                      {hasGoal && !v.goal && (
                        <>
                          <span>·</span>
                          <span className={pct >= 100 ? "font-semibold text-ok" : ""}>{Math.round(pct)}% da meta</span>
                        </>
                      )}
                    </div>
                    {v.goal && (
                      <div className="mt-2">
                        <GoalLevelSummary
                          pct={pct}
                          nivel={v.goal.nivel}
                          nivelNumero={v.goal.nivelNumero}
                          marcos={v.goal.marcos}
                          completo={!printing}
                          rolagem
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </Card>
        <Card className="flex flex-col">
          <CardHeader>
            <div className="flex w-full items-center justify-between gap-1.5">
              <CardTitle>Top produtos</CardTitle>
              <Badge variant="accent">Top {TOP_CARD_SIZE}</Badge>
            </div>
          </CardHeader>
          {topProdutosOrdenados.length === 0 ? (
            <EmptyBlock />
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
                  <th className="px-1 pb-3 text-left font-bold">#</th>
                  <ThSort
                    label="Produto"
                    active={topProdSort === "name"}
                    dir={topProdDir}
                    onClick={() => toggleTopProdSort("name")}
                    align="left"
                    className="px-1 pb-3"
                  />
                  <ThSort
                    label="Itens vendidos"
                    active={topProdSort === "itens"}
                    dir={topProdDir}
                    onClick={() => toggleTopProdSort("itens")}
                    className="px-1 pb-3"
                  />
                  <ThSort
                    label="Faturamento"
                    active={topProdSort === "faturamento"}
                    dir={topProdDir}
                    onClick={() => toggleTopProdSort("faturamento")}
                    className="px-1 pb-3"
                  />
                  <ThSort
                    label="Lucro bruto"
                    active={topProdSort === "lucro"}
                    dir={topProdDir}
                    onClick={() => toggleTopProdSort("lucro")}
                    className="px-1 pb-3"
                  />
                  <ThSort
                    label="Variação"
                    active={topProdSort === "variacao"}
                    dir={topProdDir}
                    onClick={() => toggleTopProdSort("variacao")}
                    className="px-1 pb-3"
                  />
                </tr>
              </thead>
              <tbody>
                {topProdutosOrdenados.map((p, idx) => {
                  const chave = p.chave;
                  const abrir = chave ? () => abrirDetalhe({ kind: "produto", chave, name: p.name }) : undefined;
                  return (
                    <tr
                      key={p.name}
                      tabIndex={abrir ? 0 : undefined}
                      onClick={abrir}
                      onKeyDown={(e) => {
                        if (abrir && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          abrir();
                        }
                      }}
                      className={cn(
                        "border-b border-line last:border-b-0",
                        abrir && "cursor-pointer transition-colors hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none",
                      )}
                    >
                      <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{idx + 1}</td>
                      <td className="px-1 py-3">
                        <ProductNameCell name={p.name} idx={idx} sub={p.categoria} upper />
                      </td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{p.itens != null ? p.itens.toLocaleString("pt-BR") : (p.sub?.replace(" itens", "") ?? "—")}</td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(p.amount)}</td>
                      <td
                        className={cn(
                          "px-1 py-3 text-right font-mono text-[13px] font-bold",
                          p.lucro == null ? "text-t2" : p.lucro < 0 ? "text-bad" : "text-ok",
                        )}
                      >
                        {p.lucro == null ? "—" : brlCent(p.lucro)}
                      </td>
                      <td className="px-1 py-3 text-right text-xs font-bold" style={{ color: p.trend != null ? (p.trend >= 0 ? "var(--ok)" : "var(--bad)") : undefined }}>
                        {p.trend != null ? `${p.trend >= 0 ? "+" : ""}${p.trend}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </Card>
      </div>
      </>
      )}

      {detalheModal}
      {pessoaModal}
    </div>
  );
}

function KpiCard({ kpi, Icon, colorIdx = 0 }: { kpi: OverviewKpi; Icon: () => React.JSX.Element; colorIdx?: number }) {
  const c = KPI_COLORS[colorIdx % KPI_COLORS.length];
  return (
    <StatCard
      label={kpi.label}
      value={kpi.amount}
      icon={<Icon />}
      iconColor={c.iconColor}
      iconBg={c.iconBg}
      delta={kpi.delta}
      sub={kpi.sub}
      tooltip={kpi.tooltip}
    />
  );
}