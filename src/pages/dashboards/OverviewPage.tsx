import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { paths } from "@/router/paths";
import { GoalLevelSummary } from "@/components/wedash/GoalLevelsBar";
import { ProductNameCell } from "@/components/wedash/ProductNameCell";
import { Avatar, Badge, Card, CardHeader, CardTitle, ProgressBar, RadialProgress, StatCard, DateRangePicker, PageHeader, Button, ThSort, type SortDir } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { AreaLineChart, BarChart, DonutChart } from "@/components/charts";
import { useScope } from "@/pages/dashboard/useScope";
import { buildOverviewView, resolvePeriod, previousPeriod, type OverviewKpi } from "@/data/wedash/dashboard";
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
import { brlCent, deIso, labelUpper, num, tipDelta, titleName } from "@/lib/format";
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
type TopProdSort = "nome" | "itens" | "faturamento" | "lucro" | "variacao";

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
const CORES_LOJAS = ["var(--acc)", "var(--info)", "var(--ok)", "var(--warn)", "var(--bad)"];
/** Fatia neutra "Demais lojas" (1 loja no StorePicker)  -  nao compete com a cor da loja. */
const COR_DEMAIS_LOJAS = "color-mix(in srgb, var(--t2) 40%, transparent)";

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
  metrica,
}: {
  delta?: { value: string; positive: boolean; vs?: string; diff?: string; anterior?: string };
  metrica?: string;
}) {
  if (!delta) return null;
  const badge = (
    <Badge variant={delta.positive ? "success" : "danger"}>
      {delta.positive ? "+" : "−"}
      {delta.value}
    </Badge>
  );
  const tip = tipDelta(delta, metrica);
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
  const { escopo, mudar } = useScope();
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
    const periodo = resolvePeriod(escopo.periodo, calendarTodayIso());
    const ant = previousPeriod(periodo);
    const singleDay = periodo.inicio === periodo.fim;
    const goalDays = goalHistoryDayRange(periodo.inicio);
    const hoje = calendarTodayIso();
    const goalStoreIds =
      escopo.filialIds.length > 0 ? escopo.filialIds : storesForSession(session.stores).map((s) => s.id);
    const goalsP = fetchGoals({ tenantId: session.tenantId, storeIds: goalStoreIds, from: periodo.inicio, to: periodo.fim });
    // Atingimento da meta = do inicio de cada meta ate hoje (pode sair do periodo da tela).
    // Nivel de meta no Destaques da equipe = mesma janela, por pessoa.
    const vazio = { days: [] as SalesDayAgg[], sellers: [] as SalesSellerDayAgg[], team: [] as GoalTeamMember[] };
    const goalDataP = goalsP.then(async (gs) => {
      if (gs.length === 0) return vazio;
      const from = gs.reduce((m, g) => (g.startsOn < m ? g.startsOn : m), gs[0]!.startsOn);
      const fim = gs.reduce((m, g) => (g.endsOn > m ? g.endsOn : m), gs[0]!.endsOn);
      const to = fim < hoje ? fim : hoje;
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
          from: periodo.inicio,
          to: periodo.fim,
          brand: null,
        }),
        singleDay
          ? fetchSalesHourAggs({
              tenantId: session.tenantId,
              storeIds: escopo.filialIds,
              day: periodo.inicio,
              brand: null,
            })
          : Promise.resolve([] as SalesHourAgg[]),
        fetchSalesCategoryDayAggs({
          tenantId: session.tenantId,
          storeIds: escopo.filialIds,
          from: periodo.inicio,
          to: periodo.fim,
          brand: null,
        }),
        fetchSalesCategoryCatalog({
          tenantId: session.tenantId,
          storeIds: escopo.filialIds,
          brand: null,
        }),
        fetchSalesPaymentDayAggs({
          tenantId: session.tenantId,
          storeIds: escopo.filialIds,
          from: periodo.inicio,
          to: periodo.fim,
        }),
        fetchSalesSellerDayAggs({
          tenantId: session.tenantId,
          storeIds: escopo.filialIds,
          from: periodo.inicio,
          to: periodo.fim,
        }),
        fetchSalesProductDayAggs({
          tenantId: session.tenantId,
          storeIds: escopo.filialIds,
          from: ant.inicio < periodo.inicio ? ant.inicio : periodo.inicio,
          to: periodo.fim,
        }),
        fetchSalesProductCostDayAggs({
          tenantId: session.tenantId,
          storeIds: escopo.filialIds,
          from: periodo.inicio,
          to: periodo.fim,
        }),
        fetchSyncWatermark(session.tenantId),
        fetchSalesCoverage(session.tenantId, escopo.filialIds),
        fetchSalesDayAggs({
          tenantId: session.tenantId,
          storeIds: escopo.filialIds,
          from: goalDays.from,
          to: goalDays.to,
          brand: "ALL",
        }),
        singleDay
          ? fetchSalesHourAggs({
              tenantId: session.tenantId,
              storeIds: escopo.filialIds,
              day: goalHistorySameWeekdays(periodo.inicio),
              brand: "ALL",
            })
          : Promise.resolve([] as SalesHourAgg[]),
        fetchSalesDayAggs({
          tenantId: session.tenantId,
          storeIds: escopo.filialIds,
          from: ant.inicio,
          to: ant.fim,
          brand: null,
        }),
        periodo.terminaHoje
          ? fetchSalesHourAggs({
              tenantId: session.tenantId,
              storeIds: escopo.filialIds,
              day: ant.fim,
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
      setCoverageFrom(cov.from ? deIso(cov.from) : null);
    } catch (e) {
      if (gen !== reloadGen.current) return;
      console.error("Overview reloadAggs:", e);
    }
  }, [escopo, session.tenantId, session.stores]);

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
      void fetchSalesCoverage(session.tenantId, escopo.filialIds).then((cov) => {
        setCoverageFrom(cov.from ? deIso(cov.from) : null);
      });
    }, 30_000);
    return () => window.clearInterval(id);
  }, [session.tenantId, escopo.filialIds]);

  const view = useMemo(
    () =>
      buildOverviewView(escopo, {
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
    [escopo, dayAggs, hourAggs, categoryDayAggs, categoryCatalog, paymentDayAggs, sellerDayAggs, sellerShifts, productDayAggs, productCostDayAggs, goalHistoryDayAggs, goalHistoryHourAggs, prevDayAggs, prevHourAggs, goals, goalDayAggs, goalSellerDayAggs, goalTeam, storesTick],
  );

  // A metrica escolhe QUAIS 5 entram (sempre os maiores); a direcao so reordena os 5.
  // "Produto" (nome) reordena o Top 5 por faturamento.
  const topProdutosOrdenados = useMemo(() => {
    type P = (typeof view.topProdutos)[number];
    const metrica = (p: P) =>
      topProdSort === "itens"
        ? (p.itens ?? 0)
        : topProdSort === "lucro"
          ? (p.lucro ?? -Infinity)
          : topProdSort === "variacao"
            ? (p.trend ?? -Infinity)
            : p.valor;
    const top5 = [...view.topProdutos]
      .sort((a, b) => metrica(b) - metrica(a) || b.valor - a.valor)
      .slice(0, 5);
    if (topProdSort === "nome") {
      const dir = topProdDir === "asc" ? 1 : -1;
      return top5.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") * dir);
    }
    return topProdDir === "asc" ? top5.reverse() : top5;
  }, [view.topProdutos, topProdSort, topProdDir]);

  function toggleTopProdSort(key: TopProdSort) {
    if (topProdSort === key) {
      setTopProdDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTopProdSort(key);
      setTopProdDir(key === "nome" ? "asc" : "desc");
    }
  }

  // Resolve o DateRange a partir do escopo  -  sempre mostra algo selecionado.
  const dateRange = useMemo(() => dateRangeFromPeriod(escopo.periodo), [escopo.periodo]);
  const periodoAtual = resolvePeriod(escopo.periodo, calendarTodayIso());
  const monthFill = useMonthFill();
  const deepHistoryFill = useDeepHistoryFill();
  const printing = usePrintMode();
  const exportar = useExportPdf("Visão geral");
  const firstSteps = useFirstSteps(escopo.filialIds);
  const { abrir: abrirDetalhe, modal: detalheModal } = useProductDetail({ escopo, tenantId: session.tenantId });
  const niveisMeta = useMemo(
    () => new Map(view.topVendedoras.flatMap((v) => (v.key && v.meta ? [[v.key, v.meta] as const] : []))),
    [view.topVendedoras],
  );
  const { abrir: abrirPessoa, modal: pessoaModal } = useTeamMemberDetail({ escopo, tenantId: session.tenantId, niveisMeta });
  function onDateChange(r: DateRange, meta?: DateRangeChangeMeta) {
    mudar(applyPeriodDateChange(escopo, r, meta));
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
                displayLabel={periodDisplayLabel(escopo.periodo)}
                activePresetId={periodActivePresetId(escopo.periodo)}
                minDate={pickerMinDate(coverageFrom, monthFill)}
              />
              <Button variant="secondary" onClick={exportar}>
                Exportar
              </Button>
            </div>
          </div>
        }
      />

      <ErpStatusNotice />
      <InitialSyncNotice />
      <MonthFillNotice fill={monthFill} inicio={periodoAtual.inicio} fim={periodoAtual.fim} />
      <DeepHistoryNotice
        fill={deepHistoryFill}
        monthFill={monthFill}
        inicio={periodoAtual.inicio}
        fim={periodoAtual.fim}
      />
      {/* O horario de funcionamento ja e um dos primeiros passos. */}
      {firstSteps.status === "hidden" && <StoreHoursNotice />}
      {firstSteps.status === "visible" && (
        <FirstStepsCard steps={firstSteps.steps} doneCount={firstSteps.doneCount} tenantId={firstSteps.tenantId} />
      )}

      {showSkeleton ? (
        <OverviewSkeleton weekdays={periodoAtual.inicio !== periodoAtual.fim} />
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
          const meta = view.gauges.find((g) => g.nome === "Meta") ?? view.gauges[0];
          const fatAcum = view.evolucao[view.evolucao.length - 1]?.realizado ?? 0;
          const pct = meta ? Math.round(meta.pct) : 0;
          const realizado = meta?.realizado ?? fatAcum;
          const alvo = meta?.alvo ?? 0;
          const faltamValor = meta ? Math.max(0, meta.alvo - meta.realizado) : 0;
          const metaEncerrada = view.projecaoFechamento === "Meta encerrada";
          const projecaoValor =
            meta && !metaEncerrada ? (view.projecaoFechamento?.replace(/^Projeção:\s*/i, "") ?? "—") : "—";
          if (!meta) {
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
                {view.metaDescricao && <p className="mt-0.5 text-[11px] font-semibold text-t2">{view.metaDescricao}</p>}
              </div>
              <div className="relative mx-auto mb-4 h-[150px] w-[150px]">
                <RadialProgress value={pct} size={150} stroke={15} trackColor="var(--bg-inset)" label="da meta" />
              </div>
              <div className="flex flex-col gap-2.5">
                <div className="flex justify-between">
                  <span className="text-[12.5px] text-t2">Realizado</span>
                  <span className="text-[13px] font-bold text-t0">{brlCent(realizado)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[12.5px] text-t2">Meta</span>
                  <span className={`text-[13px] font-bold ${meta && pct < 100 ? "text-warn" : meta ? "text-ok" : "text-t2"}`}>
                    {meta ? brlCent(alvo) : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[12.5px] text-t2">Faltam</span>
                  <span className={`text-[13px] font-bold ${meta && faltamValor > 0 ? "text-warn" : meta ? "text-ok" : "text-t2"}`}>
                    {!meta ? "—" : faltamValor <= 0 ? "Meta atingida" : brlCent(faltamValor)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[12.5px] text-t2">Projeção</span>
                  <span className="text-right">
                    <span className={`block text-[13px] font-bold ${meta && !metaEncerrada ? "text-t0" : "text-t2"}`}>{projecaoValor}</span>
                    {metaEncerrada && <span className="block text-[11px] font-semibold text-t2">Meta encerrada</span>}
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
                (view.evolucao[view.evolucao.length - 1]?.realizado ?? 0) + (view.evolucao[view.evolucao.length - 1]?.meta ?? 0) > 0 && (
              <>
              <p className="mt-0.5 text-[11px] font-semibold text-t2">{view.seriesLabel}</p>
              <div className="mt-2.5 flex flex-wrap gap-5">
                <div>
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                    <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--ok)]" />Realizado
                  </span>
                  <p className="mt-0.5 font-mono text-base font-extrabold text-t0">
                    {brlCent(view.evolucao[view.evolucao.length - 1]?.realizado ?? 0)}
                  </p>
                </div>
                <div>
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                    <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--warn)]" />Meta
                  </span>
                  <p className="mt-0.5 font-mono text-base font-extrabold text-t0">
                    {brlCent(view.evolucao[view.evolucao.length - 1]?.meta ?? 0)}
                  </p>
                </div>
              </div>
              </>
              )}
            </div>
            {view.gauges.length > 0 && <BadgeVsAnterior delta={view.deltaFaturamento} />}
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
                  realizado: e.realizado - (prev?.realizado ?? 0),
                  meta: e.meta - (prev?.meta ?? 0),
                };
              })
              .filter((e) => !e.ancora);
            if (serie.every((e) => e.realizado === 0 && e.meta === 0)) {
              return <EmptyBlock />;
            }
            return (
              <AreaLineChart
                data={serie.map((e) => (e.futuro ? null : e.realizado))}
                compareData={serie.map((e) => e.meta)}
                labels={serie.map((e) => e.label)}
                tooltipLabels={serie.map((e) => e.faixa)}
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
            <BadgeVsAnterior delta={view.deltaFaturamento} metrica="Faturamento total" />
          </div>
          {view.categoriaVsMeta.filter((c) => c.realizado > 0).length === 0 ? (
            <EmptyBlock />
          ) : (
            <BarChart
              data={view.categoriaVsMeta
                .filter((c) => c.realizado > 0)
                .map((c) => ({
                  label: c.categoria,
                  value: c.realizado,
                }))}
              height={220}
              color="var(--acc)"
              formatValue={brlCent}
              onSelect={(d) => abrirDetalhe({ tipo: "categoria", nome: d.label })}
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
                {!view.diaVsMeta.every((d) => d.realizado === 0 && d.meta === 0) && (
                <div className="mt-2.5 flex flex-wrap gap-5">
                  <div>
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                      <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--info)]" />Realizado
                    </span>
                    <p className="mt-0.5 font-mono text-base font-extrabold text-t0">
                      {brlCent(view.diaVsMeta.reduce((s, d) => s + d.realizado, 0))}
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
                      {brlCent(view.diaVsMeta.reduce((s, d) => s + d.meta, 0))}
                    </p>
                  </div>
                </div>
                )}
              </div>
              <BadgeVsAnterior delta={view.deltaFaturamento} metrica="Faturamento total" />
            </div>
            {view.diaVsMeta.every((d) => d.realizado === 0 && d.meta === 0) ? (
              <EmptyBlock />
            ) : (
            <BarChart
              data={view.diaVsMeta.map((d) => ({
                label: d.dia,
                value: d.realizado,
                goal: d.meta > 0 ? d.meta : undefined,
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
            <CardTitle>Ranking de lojas</CardTitle>
            {escopo.filialIds.length === 1 && view.rankingLojas.length > 0 && (view.rankingRedeTotal ?? 0) > 0 && (
              <Badge variant="accent">
                Rede: {brlCent(view.rankingRedeTotal ?? 0)}
              </Badge>
            )}
          </CardHeader>
          {view.rankingLojas.length === 0 ? (
            <EmptyBlock />
          ) : (
            (() => {
              const totalRede =
                (view.rankingRedeTotal ?? view.rankingLojas.reduce((s, l) => s + l.valor, 0)) || 1;
              const umaLoja = escopo.filialIds.length === 1;
              const valorLoja = view.rankingLojas[0]?.valor ?? 0;
              const valorDemais = umaLoja ? Math.max(0, totalRede - valorLoja) : 0;
              // 1 loja: fatia da loja x "Demais lojas" (resto da rede)  -  mostra o peso real na rede.
              const demais: (typeof view.rankingLojas)[number] | null =
                umaLoja && valorDemais > 0
                  ? {
                      nome: `Demais lojas${view.rankingDemaisLojas ? ` (${view.rankingDemaisLojas})` : ""}`,
                      valor: valorDemais,
                    }
                  : null;
              const donutSegments = [
                ...view.rankingLojas.map((l, i) => ({
                  label: l.nome,
                  value: l.valor,
                  color: CORES_LOJAS[i % CORES_LOJAS.length],
                })),
                ...(demais ? [{ label: demais.nome, value: demais.valor, color: COR_DEMAIS_LOJAS }] : []),
              ];
              return (
                <>
                  <div className="flex flex-1 flex-col items-center justify-center py-2">
                    <DonutChart
                      segments={donutSegments}
                      size={148}
                      thickness={20}
                      centerLabel={umaLoja ? "da rede" : "Total"}
                      centerValue={
                        umaLoja
                          ? `${Math.round((valorLoja / totalRede) * 100)}%`
                          : brlCent(totalRede)
                      }
                    />
                  </div>
                  <div className="mt-4 flex flex-col gap-3">
                    {[...view.rankingLojas, ...(demais ? [demais] : [])].map((loja, idx) => {
                      const pctRede = Math.round(
                        loja.pctRede ?? (totalRede > 0 ? (loja.valor / totalRede) * 100 : 0),
                      );
                      const pctBar = Math.min(100, Math.max(0, pctRede));
                      const cor = loja === demais ? COR_DEMAIS_LOJAS : CORES_LOJAS[idx % CORES_LOJAS.length];
                      return (
                        <div key={"id" in loja && loja.id ? String(loja.id) : `${loja.nome}-${idx}`} className="min-w-0 rounded-xl bg-bg-inset p-3">
                          <div className="mb-1.5 flex min-w-0 items-baseline gap-2">
                            <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] font-bold text-t0">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: cor }} />
                              <span className="min-w-0 truncate uppercase" title={loja.nome}>{loja.nome}</span>
                            </span>
                            <span className="shrink-0 font-mono text-[13px] font-extrabold tabular-nums text-t0">
                              {brlCent(loja.valor)}
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
              <Badge variant="accent">Top 5</Badge>
            </div>
          </CardHeader>
          {view.topVendedoras.length === 0 ? (
            <EmptyBlock />
          ) : (
          <div className="flex flex-col gap-1 px-2 pb-3">
            {view.topVendedoras.map((v, idx) => {
              const hasMeta = v.meta != null || v.pctMeta != null;
              const pct = v.meta?.atingimentoPct ?? v.pctMeta ?? 0;
              const key = v.key;
              const abrir = key ? () => abrirPessoa(key, v.nome) : undefined;
              return (
                <div
                  key={v.nome}
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
                  <Avatar name={v.nome} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-[13px] font-bold text-t0">{v.nome}</span>
                      <span className="shrink-0 font-mono text-[13px] font-extrabold text-ok">{brlCent(v.valor)}</span>
                    </div>
                    {!v.meta && hasMeta && <ProgressBar value={Math.min(100, pct)} height={5} />}
                    <div className={`flex flex-wrap items-center gap-x-1.5 text-[11px] text-t2 ${hasMeta && !v.meta ? "mt-0.5" : ""}`}>
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
                      {hasMeta && !v.meta && (
                        <>
                          <span>·</span>
                          <span className={pct >= 100 ? "font-semibold text-ok" : ""}>{Math.round(pct)}% da meta</span>
                        </>
                      )}
                    </div>
                    {v.meta && (
                      <div className="mt-2">
                        <GoalLevelSummary
                          pct={pct}
                          nivel={v.meta.nivel}
                          nivelNumero={v.meta.nivelNumero}
                          marcos={v.meta.marcos}
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
              <Badge variant="accent">Top 5</Badge>
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
                    active={topProdSort === "nome"}
                    dir={topProdDir}
                    onClick={() => toggleTopProdSort("nome")}
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
                  const abrir = chave ? () => abrirDetalhe({ tipo: "produto", chave, nome: p.nome }) : undefined;
                  return (
                    <tr
                      key={p.nome}
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
                        <ProductNameCell nome={p.nome} idx={idx} sub={p.categoria} upper />
                      </td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{p.itens != null ? p.itens.toLocaleString("pt-BR") : (p.sub?.replace(" itens", "") ?? "—")}</td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(p.valor)}</td>
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
      value={kpi.valor}
      icon={<Icon />}
      iconColor={c.iconColor}
      iconBg={c.iconBg}
      delta={kpi.delta}
      sub={kpi.sub}
      tooltip={kpi.tooltip}
    />
  );
}