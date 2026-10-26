import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { paths } from "@/router/paths";
import { ProductNameCell } from "@/components/wedash/ProductNameCell";
import { Avatar, Badge, Card, CardHeader, CardTitle, RadialProgress, StatCard, DateRangePicker, PageHeader, Button, ThSort, type SortDir } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { AreaLineChart, BarChart, DonutChart } from "@/components/charts";
import { isOwner } from "@/layout/nav-wedash";
import { queryStoreIds } from "@/data/wedash/stores";
import { scopeFilterKey, useScope } from "@/pages/dashboard/useScope";
import { buildOverviewView, resolvePeriod, previousPeriod, OVERVIEW_PRODUCTS_TOP, OVERVIEW_TEAM_TOP, type OverviewKpi } from "@/data/wedash/dashboard";
import {
  fetchSalesDayAggs,
  fetchSalesHourAggs,
  fetchSalesCategoryDayAggs,
  fetchSalesCategoryCatalog,
  fetchSalesPaymentDayAggs,
  fetchNamedSellerDayAggs,
  fetchSalesSellerDayAggs,
  fetchSalesProductDayAggs,
  fetchSalesProductCostDayAggs,
  fetchSalesCoverage,
  fetchSellerAvatars,
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
  SellerAvatarRef,
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
import { ExportDialog } from "@/components/wedash/ExportDialog";
import { ReportHeader, useExportPdf } from "@/pages/dashboard/ReportHeader";
import { usePrintMode } from "@/lib/printMode";
import { cn } from "@/lib/cn";
import { useProductDetail } from "@/pages/dashboard/ProductDetail";
import { useTeamMemberDetail } from "@/pages/dashboard/TeamMemberDetail";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { PRODUCT_AVATAR_TONES, colorsByAmount, kpiTone, nextSeriesColor, paymentColor } from "@/pages/dashboard/palette";
import { OverviewSkeleton } from "@/components/wedash/LoadingSkeletons";
import { useFilterSkeleton } from "@/lib/useFilterSkeleton";
import { calendarTodayIso } from "@/data/wedash/clock";
import { goalHistoryDayRange, goalHistorySameWeekdays } from "@/data/wedash/goalCurve";
import { goalWeightFrom } from "@/data/wedash/engine/goalProjection";
import { fetchGoals, fetchGoalTeam, type GoalRecord, type GoalTeamMember } from "@/data/wedash/goalsRepo";
import { storesForSession } from "@/data/wedash/stores";
import {
  applyPeriodDateChange,
  dateRangeFromPeriod,
  periodActivePresetId,
  periodDisplayLabel,
} from "@/pages/dashboard/periodPicker";
type TopProdSort = "name" | "items" | "revenue" | "profit" | "variation";
type TeamSort = "name" | "revenue" | "sales" | "averageTicket" | "pa";

const IconRevenue = () => (
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
const IconSales = () => (
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

const KPI_ICONS = [IconRevenue, IconCmv, IconSales, IconTicket];

/** # e nome/produto parados no scroll horizontal. A largura do # (w-8) e o left-8 da coluna seguinte. */
const RANK_STICKY = "sticky left-0 z-20 w-8 min-w-8 max-w-8";
const NAME_STICKY = "sticky left-8 z-10 min-w-0";
const STICKY_BG = "bg-bg-2 transition-colors group-hover:bg-bg-3 group-focus-visible:bg-bg-3";
/** No card estreito o nome nao ocupa a tela inteira, para sobrar numero ao lado. */
const NAME_CLIP = "min-w-0 max-w-[9.5rem] sm:max-w-[12.5rem] lg:max-w-[14rem] xl:max-w-none";

/** Loja principal (+N). So com mais de uma filial no filtro, igual ao ranking da Equipe. */
function storesLabel(storeRows: string[]): string | null {
  if (storeRows.length === 0) return null;
  return storeRows.length > 1 ? `${storeRows[0]} · +${storeRows.length - 1}` : storeRows[0]!;
}

/**
 * Badge de delta  -  so % no chip; base do comparativo no tooltip (igual StatCard).
 * `metrica` nomeia o que o badge compara quando o titulo do card fala de outra coisa
 * ("Faturamento total em relacao ao mes passado: R$ ...").
 */
function BadgeVsPrevious({
  delta,
  metric,
}: {
  delta?: { value: string; positive: boolean; vs?: string; diff?: string; previous?: string };
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
  const exportPdf = useExportPdf("Visão geral");
  const [dayAggs, setDayAggs] = useState<SalesDayAgg[]>([]);
  const [hourAggs, setHourAggs] = useState<SalesHourAgg[]>([]);
  const [categoryDayAggs, setCategoryDayAggs] = useState<SalesCategoryDayAgg[]>([]);
  const [categoryCatalog, setCategoryCatalog] = useState<SalesCategoryRef[]>([]);
  const [paymentDayAggs, setPaymentDayAggs] = useState<SalesPaymentDayAgg[]>([]);
  const [sellerDayAggs, setSellerDayAggs] = useState<SalesSellerDayAgg[]>([]);
  const [sellerShifts, setSellerShifts] = useState<SellerShiftRef[]>([]);
  const [sellerAvatars, setSellerAvatars] = useState<SellerAvatarRef[]>([]);
  const [productDayAggs, setProductDayAggs] = useState<SalesProductDayAgg[]>([]);
  const [productCostDayAggs, setProductCostDayAggs] = useState<SalesProductCostDayAgg[]>([]);
  const filterKey = scopeFilterKey(scope);
  const { showSkeleton, settle } = useFilterSkeleton(filterKey);
  const [watermark, setWatermark] = useState<Date | null>(null);
  const [coverageFrom, setCoverageFrom] = useState<Date | null>(null);
  const [goalHistoryDayAggs, setGoalHistoryDayAggs] = useState<SalesDayAgg[]>([]);
  const [goalHistoryHourAggs, setGoalHistoryHourAggs] = useState<SalesHourAgg[]>([]);
  const [prevDayAggs, setPrevDayAggs] = useState<SalesDayAgg[]>([]);
  const [prevHourAggs, setPrevHourAggs] = useState<SalesHourAgg[]>([]);
  const [goals, setGoals] = useState<GoalRecord[]>([]);
  const [goalDayAggs, setGoalDayAggs] = useState<SalesDayAgg[]>([]);
  const [goalSellerDayAggs, setGoalSellerDayAggs] = useState<SalesSellerDayAgg[]>([]);
  const [goalNamedSellerDayAggs, setGoalNamedSellerDayAggs] = useState<SalesSellerDayAgg[]>([]);
  const [goalTeam, setGoalTeam] = useState<GoalTeamMember[]>([]);
  // Catalogo de lojas (horario/fuso) hidratado depois do 1 render  ->  recalcula eixos.
  const [storesTick, setStoresTick] = useState(0);
  useEffect(() => {
    const onStores = () => setStoresTick((n) => n + 1);
    window.addEventListener("wedash:stores", onStores);
    return () => window.removeEventListener("wedash:stores", onStores);
  }, []);
  const [topProdSort, setTopProdSort] = useState<TopProdSort>("revenue");
  const [topProdDir, setTopProdDir] = useState<SortDir>("desc");
  const [teamSort, setTeamSort] = useState<TeamSort>("revenue");
  const [teamDir, setTeamDir] = useState<SortDir>("desc");
  /** So a leitura mais recente aplica setState (evita corrida stale sobrescrever pos-FORCE). */
  const reloadGen = useRef(0);

  const reloadAggs = useCallback(async () => {
    const gen = ++reloadGen.current;
    const key = filterKey;
    const period = resolvePeriod(scope.period, calendarTodayIso());
    const prev = previousPeriod(period);
    const singleDay = period.start === period.end;
    const goalDays = goalHistoryDayRange(period.start);
    const today = calendarTodayIso();
    const owner = isOwner(session.role);
    const asked = queryStoreIds(session.role, scope.storeIds, session.stores);
    const rankingIds = owner ? [] : queryStoreIds(session.role, [], session.stores);
    const goalStoreIds =
      scope.storeIds.length > 0 ? scope.storeIds : storesForSession(session.stores).map((s) => s.id);
    const goalsP = fetchGoals({ tenantId: session.tenantId, storeIds: goalStoreIds, from: period.start, to: period.end });
    // Atingimento da meta = do inicio de cada meta ate hoje (pode sair do periodo da tela).
    // Secao Meta do detalhe da pessoa = mesma janela, por pessoa.
    const empty = { days: [] as SalesDayAgg[], sellers: [] as SalesSellerDayAgg[], named: [] as SalesSellerDayAgg[], team: [] as GoalTeamMember[] };
    const goalDataP = goalsP.then(async (gs) => {
      if (gs.length === 0) return empty;
      const from = gs.reduce((m, g) => (g.startsOn < m ? g.startsOn : m), gs[0]!.startsOn);
      const end = gs.reduce((m, g) => (g.endsOn > m ? g.endsOn : m), gs[0]!.endsOn);
      const to = end < today ? end : today;
      // 6 semanas antes do inicio: peso de cada dia da semana na projecao (a mesma do detalhe da meta).
      const historyFrom = goalWeightFrom(from);
      if (historyFrom > to) return empty;
      const storeIds = [...new Set(gs.map((g) => g.storeId))];
      const people = from <= to;
      const [days, sellers, named, team] = await Promise.all([
        fetchSalesDayAggs({ tenantId: session.tenantId, storeIds, from: historyFrom, to, brand: "ALL" }),
        people ? fetchSalesSellerDayAggs({ tenantId: session.tenantId, storeIds, from, to }) : Promise.resolve([]),
        people ? fetchNamedSellerDayAggs({ tenantId: session.tenantId, storeIds, from, to }) : Promise.resolve([]),
        fetchGoalTeam(session.tenantId, storeIds),
      ]);
      return { days, sellers, named, team };
    });
    try {
      const [days, hours, cats, catalog, payments, sellers, products, productCosts, wm, cov, goalHistDays, goalHistHours, prevDays, prevHours, shifts, avatars, goalsLoaded, goalAggs] = await Promise.all([
        fetchSalesDayAggs({
          tenantId: session.tenantId,
          // Gestor: a rede, para a fatia "Demais filiais". Gerente: só as filiais do vínculo.
          storeIds: rankingIds,
          from: period.start,
          to: period.end,
          brand: null,
        }),
        singleDay
          ? fetchSalesHourAggs({
              tenantId: session.tenantId,
              storeIds: asked,
              day: period.start,
              brand: null,
            })
          : Promise.resolve([] as SalesHourAgg[]),
        fetchSalesCategoryDayAggs({
          tenantId: session.tenantId,
          storeIds: asked,
          from: prev.start < period.start ? prev.start : period.start,
          to: period.end,
          brand: null,
        }),
        fetchSalesCategoryCatalog({
          tenantId: session.tenantId,
          storeIds: asked,
          brand: null,
        }),
        fetchSalesPaymentDayAggs({
          tenantId: session.tenantId,
          storeIds: asked,
          from: period.start,
          to: period.end,
        }),
        fetchSalesSellerDayAggs({
          tenantId: session.tenantId,
          storeIds: asked,
          from: period.start,
          to: period.end,
        }),
        fetchSalesProductDayAggs({
          tenantId: session.tenantId,
          storeIds: asked,
          from: prev.start < period.start ? prev.start : period.start,
          to: period.end,
        }),
        fetchSalesProductCostDayAggs({
          tenantId: session.tenantId,
          storeIds: asked,
          from: period.start,
          to: period.end,
        }),
        fetchSyncWatermark(session.tenantId).catch(() => null),
        fetchSalesCoverage(session.tenantId, asked),
        fetchSalesDayAggs({
          tenantId: session.tenantId,
          storeIds: asked,
          from: goalDays.from,
          to: goalDays.to,
          brand: "ALL",
        }),
        singleDay
          ? fetchSalesHourAggs({
              tenantId: session.tenantId,
              storeIds: asked,
              day: goalHistorySameWeekdays(period.start),
              brand: "ALL",
            })
          : Promise.resolve([] as SalesHourAgg[]),
        fetchSalesDayAggs({
          tenantId: session.tenantId,
          storeIds: asked,
          from: prev.start,
          to: prev.end,
          brand: null,
        }),
        period.endsToday
          ? fetchSalesHourAggs({
              tenantId: session.tenantId,
              storeIds: asked,
              day: prev.end,
              brand: null,
            })
          : Promise.resolve([] as SalesHourAgg[]),
        fetchSellerShifts(session.tenantId),
        fetchSellerAvatars(session.tenantId),
        goalsP,
        goalDataP,
      ]);
      if (gen !== reloadGen.current) return;
      setGoals(goalsLoaded);
      setGoalDayAggs(goalAggs.days);
      setGoalSellerDayAggs(goalAggs.sellers);
      setGoalNamedSellerDayAggs(goalAggs.named);
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
      setSellerAvatars(avatars);
      setProductDayAggs(products);
      setProductCostDayAggs(productCosts);
      setWatermark(wm);
      setCoverageFrom(cov.from ? isoToDate(cov.from) : null);
      settle(key);
    } catch (e) {
      if (gen !== reloadGen.current) return;
      console.error("Overview reloadAggs:", e);
      settle(key);
    }
  }, [scope, session.role, session.stores, session.tenantId, filterKey, settle]);

  useEffect(() => {
    const onSynced = () => void reloadAggs();
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [reloadAggs]);

  // Filial e período ligam o skeleton no mesmo render (useFilterSkeleton).
  // Venda nova e a hidratação do catálogo recarregam em silêncio.
  useEffect(() => {
    void reloadAggs();
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
      void fetchSalesCoverage(session.tenantId, queryStoreIds(session.role, scope.storeIds, session.stores)).then((cov) => {
        setCoverageFrom(cov.from ? isoToDate(cov.from) : null);
      });
    }, 30_000);
    return () => window.clearInterval(id);
  }, [session.role, session.stores, session.tenantId, scope.storeIds]);

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
        sellerAvatars,
        productDayAggs,
        productCostDayAggs,
        goalHistoryDayAggs,
        goalHistoryHourAggs,
        prevDayAggs,
        prevHourAggs,
        goals,
        goalDayAggs,
        goalSellerDayAggs,
        goalNamedSellerDayAggs,
        goalTeam,
        rankingStoreIds: isOwner(session.role) ? undefined : queryStoreIds(session.role, [], session.stores),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, session.role, session.stores, dayAggs, hourAggs, categoryDayAggs, categoryCatalog, paymentDayAggs, sellerDayAggs, sellerShifts, sellerAvatars, productDayAggs, productCostDayAggs, goalHistoryDayAggs, goalHistoryHourAggs, prevDayAggs, prevHourAggs, goals, goalDayAggs, goalSellerDayAggs, goalNamedSellerDayAggs, goalTeam, storesTick],
  );

  // A metrica escolhe quais entram (sempre os maiores); a direcao so reordena esses.
  // "Produto" (nome) reordena o Top por faturamento.
  const topProductsOrdenados = useMemo(() => {
    type P = (typeof view.topProducts)[number];
    const metric = (p: P) =>
      topProdSort === "items"
        ? (p.items ?? 0)
        : topProdSort === "profit"
          ? (p.profit ?? -Infinity)
          : topProdSort === "variation"
            ? (p.trend ?? -Infinity)
            : p.amount;
    const top = [...view.topProducts]
      .sort((a, b) => metric(b) - metric(a) || b.amount - a.amount)
      .slice(0, OVERVIEW_PRODUCTS_TOP);
    if (topProdSort === "name") {
      const dir = topProdDir === "asc" ? 1 : -1;
      return top.sort((a, b) => a.name.localeCompare(b.name, "pt-BR") * dir);
    }
    return topProdDir === "asc" ? top.reverse() : top;
  }, [view.topProducts, topProdSort, topProdDir]);

  function toggleTopProdSort(key: TopProdSort) {
    if (topProdSort === key) {
      setTopProdDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTopProdSort(key);
      setTopProdDir(key === "name" ? "asc" : "desc");
    }
  }

  // Mesma regra do Top produtos: a metrica escolhe o Top N; a direcao so reordena.
  // "Nome" reordena o Top por faturamento.
  const topSellersOrdenados = useMemo(() => {
    type S = (typeof view.topSellers)[number];
    const metric = (v: S) =>
      teamSort === "sales"
        ? (v.sales ?? 0)
        : teamSort === "averageTicket"
          ? (v.averageTicket ?? 0)
          : teamSort === "pa"
            ? (v.pa ?? -Infinity)
            : v.amount;
    const top = [...view.topSellers]
      .sort((a, b) => metric(b) - metric(a) || b.amount - a.amount)
      .slice(0, OVERVIEW_TEAM_TOP);
    if (teamSort === "name") {
      const dir = teamDir === "asc" ? 1 : -1;
      return top.sort((a, b) => a.name.localeCompare(b.name, "pt-BR") * dir);
    }
    return teamDir === "asc" ? top.reverse() : top;
  }, [view.topSellers, teamSort, teamDir]);

  const teamTotal = useMemo(() => {
    const people = view.topSellers;
    const revenue = people.reduce((sum, person) => sum + person.amount, 0);
    const sales = people.reduce((sum, person) => sum + (person.sales ?? 0), 0);
    const complete = people.every((person) => person.pa != null || (person.sales ?? 0) === 0);
    const items = complete ? people.reduce((sum, person) => sum + (person.pa ?? 0) * (person.sales ?? 0), 0) : 0;
    return {
      count: people.length,
      revenue,
      sales,
      averageTicket: sales > 0 ? revenue / sales : 0,
      pa: complete && sales > 0 ? items / sales : null,
    };
  }, [view.topSellers]);

  const productTotal = useMemo(() => {
    const products = view.topProducts;
    const items = products.reduce((sum, product) => sum + (product.items ?? 0), 0);
    const revenue = products.reduce((sum, product) => sum + product.amount, 0);
    const complete = products.length > 0 && products.every((product) => product.profit != null);
    const revenuePrev = products.reduce((sum, product) => sum + (product.revenuePrev ?? 0), 0);
    return {
      count: products.length,
      items,
      revenue,
      profit: complete ? products.reduce((sum, product) => sum + (product.profit ?? 0), 0) : null,
      variation: revenue > 0 && revenuePrev > 0 ? Math.round(((revenue - revenuePrev) / revenuePrev) * 100) : null,
    };
  }, [view.topProducts]);

  function toggleTeamSort(key: TeamSort) {
    if (teamSort === key) {
      setTeamDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTeamSort(key);
      setTeamDir(key === "name" ? "asc" : "desc");
    }
  }

  // Resolve o DateRange a partir do escopo  -  sempre mostra algo selecionado.
  const dateRange = useMemo(() => dateRangeFromPeriod(scope.period), [scope.period]);
  const currentPeriod = resolvePeriod(scope.period, calendarTodayIso());
  const monthFill = useMonthFill();
  const deepHistoryFill = useDeepHistoryFill();
  const printing = usePrintMode();
  const showSellerStore = (scope.storeIds.length === 0 ? storesForSession(session.stores).length : scope.storeIds.length) > 1;
  const firstSteps = useFirstSteps(scope.storeIds);
  const { open: openDetail, modal: detailModal } = useProductDetail({ scope, tenantId: session.tenantId });
  const goalLevels = useMemo(
    () => new Map(view.topSellers.flatMap((v) => (v.key && v.goal ? [[v.key, v.goal] as const] : []))),
    [view.topSellers],
  );
  const { open: openPerson, modal: personModal } = useTeamMemberDetail({ scope, tenantId: session.tenantId, goalLevels });
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
              <ExportDialog formats={["pdf"]} onExport={() => exportPdf()} />
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
          <KpiCard key={kpi.label} kpi={kpi} Icon={KPI_ICONS[i]} />
        ))}
      </div>

      {/* Linha: Atingimento da Meta + Faturamento vs Meta */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.6fr]">
        {(() => {
          const goal = view.gauges.find((g) => g.name === "Meta") ?? view.gauges[0];
          const revenueAcum = view.evolution[view.evolution.length - 1]?.achieved ?? 0;
          const pct = goal ? Math.round(goal.pct) : 0;
          const achieved = goal?.achieved ?? revenueAcum;
          const target = goal?.target ?? 0;
          const missingAmount = goal ? Math.max(0, goal.target - goal.achieved) : 0;
          const closedGoal = view.projectionClosing === "Meta encerrada";
          const projectionAmount =
            goal && !closedGoal ? (view.projectionClosing?.replace(/^Projeção:\s*/i, "") ?? "—") : "—";
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
                <RadialProgress
                  value={pct}
                  size={150}
                  stroke={15}
                  color="var(--palette-pink)"
                  trackColor="var(--palette-track)"
                  valueClassName="text-t0"
                  label="da meta"
                />
              </div>
              <div className="flex flex-col gap-2.5">
                <div className="flex justify-between">
                  <span className="text-[12.5px] text-t2">Realizado</span>
                  <span className="text-[13px] font-bold text-t0">{brlCent(achieved)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[12.5px] text-t2">Meta</span>
                  <span className={`text-[13px] font-bold ${goal ? "text-palette-amber" : "text-t2"}`}>
                    {goal ? brlCent(target) : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[12.5px] text-t2">Faltam</span>
                  <span className={`text-[13px] font-bold ${goal ? "text-palette-amber" : "text-t2"}`}>
                    {!goal ? "—" : missingAmount <= 0 ? "Meta atingida" : brlCent(missingAmount)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[12.5px] text-t2">Projeção</span>
                  <span className="text-right">
                    <span className={`block text-[13px] font-bold ${goal && !closedGoal ? "text-t0" : "text-t2"}`}>{projectionAmount}</span>
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
                (view.evolution[view.evolution.length - 1]?.achieved ?? 0) + (view.evolution[view.evolution.length - 1]?.goal ?? 0) > 0 && (
              <>
              <p className="mt-0.5 text-[11px] font-semibold text-t2">{view.seriesLabel}</p>
              <div className="mt-2.5 flex flex-wrap gap-5">
                <div>
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                    <span className="h-2.5 w-2.5 rounded-[3px] bg-palette-pink" />Realizado
                  </span>
                  <p className="mt-0.5 font-mono text-base font-extrabold text-t0">
                    {brlCent(view.evolution[view.evolution.length - 1]?.achieved ?? 0)}
                  </p>
                </div>
                <div>
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                    <span className="h-2.5 w-2.5 rounded-[3px] bg-palette-amber" />Meta
                  </span>
                  <p className="mt-0.5 font-mono text-base font-extrabold text-t0">
                    {brlCent(view.evolution[view.evolution.length - 1]?.goal ?? 0)}
                  </p>
                </div>
              </div>
              </>
              )}
            </div>
            {view.gauges.length > 0 && <BadgeVsPrevious delta={view.revenueDelta} />}
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
            const series = view.evolution
              .map((e, i) => {
                const prev = view.evolution[i - 1];
                return {
                  ...e,
                  achieved: e.achieved - (prev?.achieved ?? 0),
                  goal: e.goal - (prev?.goal ?? 0),
                };
              })
              .filter((e) => !e.anchor);
            if (series.every((e) => e.achieved === 0 && e.goal === 0)) {
              return <EmptyBlock />;
            }
            return (
              <AreaLineChart
                data={series.map((e) => (e.future ? null : e.achieved))}
                compareData={series.map((e) => e.goal)}
                labels={series.map((e) => e.label)}
                tooltipLabels={series.map((e) => e.band)}
                color="var(--palette-pink)"
                compareColor="var(--palette-amber)"
                name="Realizado"
                compareName="Meta"
                areaOpacity={0.18}
                formatValue={brlCent}
                showAxisLabels
              />
            );
          })()}
        </Card>
      </div>

      {/* Linha: Categoria vs Meta + Dia da Semana vs Meta (Dia some em periodo de 1 dia) */}
      <div className={`mt-4 grid grid-cols-1 gap-4 ${view.dayVsMeta.length > 0 ? "lg:grid-cols-2" : ""}`}>
        <Card padding="lg" className="flex flex-col">
          {(() => {
            const bars = view.categoryVsGoal.filter((c) => c.achieved > 0);
            const totalCategories = bars.reduce((s, c) => s + c.achieved, 0);
            return (
              <>
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <CardTitle>Faturamento por categoria</CardTitle>
                      <Tooltip label="Veja como o faturamento está distribuído entre as categorias de produtos.">
                        <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 hover:text-t1 transition-colors">
                          ?
                        </span>
                      </Tooltip>
                    </div>
                    {bars.length > 0 && (
                      <p className="mt-1.5 font-mono text-2xl font-extrabold text-t0">{brlCent(totalCategories)}</p>
                    )}
                  </div>
                  {bars.length > 0 && (
                    <BadgeVsPrevious delta={view.deltaCategories} metric="Faturamento das categorias" />
                  )}
                </div>
                {bars.length === 0 ? (
                  <EmptyBlock />
                ) : (
                  <BarChart
                    data={bars.map((c) => ({
                      label: c.category,
                      value: c.achieved,
                    }))}
                    height={220}
                    color="var(--palette-pink)"
                    hoverColor="var(--palette-pink-2)"
                    formatValue={brlCent}
                    onSelect={(d) => openDetail({ kind: "category", name: d.label })}
                  />
                )}
              </>
            );
          })()}
        </Card>
        {view.dayVsMeta.length > 0 && (
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
                {!view.dayVsMeta.every((d) => d.achieved === 0 && d.goal === 0) && (
                <div className="mt-2.5 flex flex-wrap gap-5">
                  <div>
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                      <span className="h-2.5 w-2.5 rounded-[3px] bg-palette-blue" />Realizado
                    </span>
                    <p className="mt-0.5 font-mono text-base font-extrabold text-t0">
                      {brlCent(view.dayVsMeta.reduce((s, d) => s + d.achieved, 0))}
                    </p>
                  </div>
                  <div>
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                      <span
                        className="inline-block w-3 border-t-2 border-dashed border-palette-amber"
                        aria-hidden
                      />
                      Meta
                    </span>
                    <p className="mt-0.5 font-mono text-base font-extrabold text-t0">
                      {brlCent(view.dayVsMeta.reduce((s, d) => s + d.goal, 0))}
                    </p>
                  </div>
                </div>
                )}
              </div>
              <BadgeVsPrevious delta={view.revenueDelta} metric="Faturamento total" />
            </div>
            {view.dayVsMeta.every((d) => d.achieved === 0 && d.goal === 0) ? (
              <EmptyBlock />
            ) : (
            <BarChart
              data={view.dayVsMeta.map((d) => ({
                label: d.day,
                value: d.achieved,
                goal: d.goal > 0 ? d.goal : undefined,
              }))}
              height={220}
              color="var(--palette-blue)"
              goalColor="var(--palette-amber)"
              formatValue={brlCent}
            />
            )}
          </Card>
        )}
      </div>

      {/* Linha: Ranking de Lojas + Formas de Pagamento.
          O gestor compara com a rede. O gerente vê o ranking só das filiais dele. */}
      {(() => {
        const compareNetwork = isOwner(session.role) && scope.storeIds.length === 1 && (view.otherStoresRanking ?? 0) > 0;
        const shareLabel = isOwner(session.role) ? "da rede" : "do total";
        return (
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader className="items-center">
            <CardTitle>Ranking de filiais</CardTitle>
            {compareNetwork && (
              <Badge variant="neutral">
                Rede: {brlCent(view.rankingNetworkTotal ?? 0)}
              </Badge>
            )}
          </CardHeader>
          {view.storesRanking.length === 0 ? (
            <EmptyBlock />
          ) : (
            (() => {
              const totalNetwork =
                (view.rankingNetworkTotal ?? view.storesRanking.reduce((s, l) => s + l.amount, 0)) || 1;
              const storeAmount = view.storesRanking[0]?.amount ?? 0;
              const amountRest = compareNetwork ? Math.max(0, totalNetwork - storeAmount) : 0;
              // Gestor com 1 loja: fatia da loja x "Demais filiais" (resto da rede).
              const rest: (typeof view.storesRanking)[number] | null =
                compareNetwork && amountRest > 0
                  ? {
                      name: `Demais filiais${view.otherStoresRanking ? ` (${view.otherStoresRanking})` : ""}`,
                      amount: amountRest,
                    }
                  : null;
              const rankingColors = colorsByAmount(view.storesRanking.map((store) => ({ amount: store.amount })));
              const restColor = nextSeriesColor(rankingColors);
              const donutSegments = [
                ...view.storesRanking.map((l, i) => ({
                  label: l.name,
                  value: l.amount,
                  color: rankingColors[i],
                })),
                ...(rest ? [{ label: rest.name, value: rest.amount, color: restColor }] : []),
              ];
              return (
                <>
                  <div className="flex flex-1 flex-col items-center justify-center py-2">
                    <DonutChart
                      segments={donutSegments}
                      size={148}
                      thickness={20}
                      centerLabel={compareNetwork ? "da rede" : "Total"}
                      centerValue={
                        compareNetwork
                          ? `${Math.round((storeAmount / totalNetwork) * 100)}%`
                          : brlCent(totalNetwork)
                      }
                    />
                  </div>
                  <div className="mt-4 flex flex-col gap-3">
                    {[...view.storesRanking, ...(rest ? [rest] : [])].map((store, idx) => {
                      const pctNetwork = Math.round(
                        store.pctNetwork ?? (totalNetwork > 0 ? (store.amount / totalNetwork) * 100 : 0),
                      );
                      const pctBar = Math.min(100, Math.max(0, pctNetwork));
                      const color = store === rest ? restColor : rankingColors[idx];
                      return (
                        <div key={"id" in store && store.id ? String(store.id) : `${store.name}-${idx}`} className="min-w-0 rounded-xl bg-bg-inset p-3">
                          <div className="mb-1.5 flex min-w-0 items-baseline gap-2">
                            <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] font-bold text-t0">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: color }} />
                              <span className="min-w-0 truncate uppercase" title={store.name}>{store.name}</span>
                            </span>
                            <span className="shrink-0 font-mono text-[13px] font-extrabold tabular-nums text-t0">
                              {brlCent(store.amount)}
                            </span>
                          </div>
                          <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-bg-2">
                            <div className="h-full rounded-full" style={{ width: `${pctBar}%`, background: color }} />
                          </div>
                          <span className="text-[11px] font-semibold text-t2">
                            {pctBar}% {shareLabel}
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
                        color: paymentColor(f.method),
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
                          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: paymentColor(f.method) }} />
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
        );
      })()}

      {/* Par: Top Vendedoras + Top Produtos */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex min-w-0 flex-col overflow-hidden">
          <CardHeader>
            <div className="flex w-full items-center justify-between gap-1.5">
              <CardTitle>Destaques da equipe</CardTitle>
              <Badge variant="accent">Top {OVERVIEW_TEAM_TOP}</Badge>
            </div>
          </CardHeader>
          {topSellersOrdenados.length === 0 ? (
            <EmptyBlock />
          ) : (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm [&_tbody_tr:last-child_td]:border-b-0 [&_td]:border-b [&_td]:border-line [&_th]:border-b [&_th]:border-line">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-t2">
                  <th className={cn(RANK_STICKY, STICKY_BG, "px-1 pb-3 text-left font-bold")}>#</th>
                  <ThSort
                    label="Nome"
                    active={teamSort === "name"}
                    dir={teamDir}
                    onClick={() => toggleTeamSort("name")}
                    align="left"
                    className={cn(NAME_STICKY, STICKY_BG, "px-1 pb-3")}
                  />
                  <ThSort
                    label="Faturamento"
                    active={teamSort === "revenue"}
                    dir={teamDir}
                    onClick={() => toggleTeamSort("revenue")}
                    className="px-1 pb-3"
                  />
                  <ThSort
                    label="Nº de vendas"
                    active={teamSort === "sales"}
                    dir={teamDir}
                    onClick={() => toggleTeamSort("sales")}
                    className="px-1 pb-3"
                  />
                  <ThSort
                    label="Ticket médio"
                    active={teamSort === "averageTicket"}
                    dir={teamDir}
                    onClick={() => toggleTeamSort("averageTicket")}
                    className="px-1 pb-3"
                  />
                  <ThSort
                    label="P.A."
                    active={teamSort === "pa"}
                    dir={teamDir}
                    onClick={() => toggleTeamSort("pa")}
                    className="px-1 pb-3"
                  />
                </tr>
              </thead>
              <tbody>
                {topSellersOrdenados.map((v, idx) => {
                  const key = v.key;
                  const open = key ? () => openPerson(key, v.name) : undefined;
                  const store = showSellerStore ? storesLabel(v.storeRows) : null;
                  return (
                    <tr
                      key={key ?? v.name}
                      tabIndex={open ? 0 : undefined}
                      onClick={open}
                      onKeyDown={(e) => {
                        if (open && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          open();
                        }
                      }}
                      className={cn(
                        open && "group cursor-pointer transition-colors hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none",
                      )}
                    >
                      <td className={cn(RANK_STICKY, STICKY_BG, "px-1 py-3 text-center text-[13px] font-extrabold text-t2")}>{idx + 1}</td>
                      <td className={cn(NAME_STICKY, STICKY_BG, "px-1 py-3")}>
                        <div className={cn("flex min-w-0 items-center gap-2.5", NAME_CLIP)}>
                          <Avatar name={v.name} src={v.avatarUrl} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-bold text-t0">{v.name}</p>
                            {store &&
                              (v.storeRows.length > 1 ? (
                                <Tooltip label={v.storeRows.slice(1).join(" · ")}>
                                  <p className="truncate text-[11px] text-t2">{store}</p>
                                </Tooltip>
                              ) : (
                                <p className="truncate text-[11px] text-t2">{store}</p>
                              ))}
                          </div>
                        </div>
                      </td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(v.amount)}</td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{num(v.sales ?? 0)}</td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(v.averageTicket ?? 0)}</td>
                      <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", v.pa == null ? "text-t2" : "text-t0")}>
                        {v.pa == null ? (
                          <Tooltip label="O P.A. não está disponível para este período.">
                            <span>—</span>
                          </Tooltip>
                        ) : (
                          num(v.pa, 2)
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-bg-inset">
                  <td className={cn(RANK_STICKY, "bg-bg-inset")} />
                  <td className={cn(NAME_STICKY, "bg-bg-inset px-1 py-3 text-[13px] font-extrabold text-t0")}>
                    <div className={NAME_CLIP}>
                      Total do filtro
                      <span className="mt-0.5 block text-[11px] font-semibold text-t2">
                        {num(teamTotal.count)} {teamTotal.count === 1 ? "pessoa" : "pessoas"}
                      </span>
                    </div>
                  </td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{brlCent(teamTotal.revenue)}</td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{num(teamTotal.sales)}</td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{brlCent(teamTotal.averageTicket)}</td>
                  <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-extrabold", teamTotal.pa == null ? "text-t2" : "text-t0")}>
                    {teamTotal.pa == null ? "—" : num(teamTotal.pa, 2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          )}
        </Card>
        <Card className="flex min-w-0 flex-col overflow-hidden">
          <CardHeader>
            <div className="flex w-full items-center justify-between gap-1.5">
              <CardTitle>Top produtos</CardTitle>
              <Badge variant="accent">Top {OVERVIEW_PRODUCTS_TOP}</Badge>
            </div>
          </CardHeader>
          {topProductsOrdenados.length === 0 ? (
            <EmptyBlock />
          ) : (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[620px] border-separate border-spacing-0 text-sm [&_tbody_tr:last-child_td]:border-b-0 [&_td]:border-b [&_td]:border-line [&_th]:border-b [&_th]:border-line">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-t2">
                  <th className={cn(RANK_STICKY, STICKY_BG, "px-1 pb-3 text-left font-bold")}>#</th>
                  <ThSort
                    label="Produto"
                    active={topProdSort === "name"}
                    dir={topProdDir}
                    onClick={() => toggleTopProdSort("name")}
                    align="left"
                    className={cn(NAME_STICKY, STICKY_BG, "px-1 pb-3")}
                  />
                  <ThSort
                    label="Itens vendidos"
                    active={topProdSort === "items"}
                    dir={topProdDir}
                    onClick={() => toggleTopProdSort("items")}
                    className="px-1 pb-3"
                  />
                  <ThSort
                    label="Faturamento"
                    active={topProdSort === "revenue"}
                    dir={topProdDir}
                    onClick={() => toggleTopProdSort("revenue")}
                    className="px-1 pb-3"
                  />
                  <ThSort
                    label="Lucro bruto"
                    active={topProdSort === "profit"}
                    dir={topProdDir}
                    onClick={() => toggleTopProdSort("profit")}
                    className="px-1 pb-3"
                  />
                  <ThSort
                    label="Variação"
                    active={topProdSort === "variation"}
                    dir={topProdDir}
                    onClick={() => toggleTopProdSort("variation")}
                    className="px-1 pb-3"
                  />
                </tr>
              </thead>
              <tbody>
                {topProductsOrdenados.map((p, idx) => {
                  const rowKey = p.rowKey;
                  const open = rowKey ? () => openDetail({ kind: "product", rowKey, name: p.name }) : undefined;
                  return (
                    <tr
                      key={p.name}
                      tabIndex={open ? 0 : undefined}
                      onClick={open}
                      onKeyDown={(e) => {
                        if (open && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          open();
                        }
                      }}
                      className={cn(
                        open && "group cursor-pointer transition-colors hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none",
                      )}
                    >
                      <td className={cn(RANK_STICKY, STICKY_BG, "px-1 py-3 text-center text-[13px] font-extrabold text-t2")}>{idx + 1}</td>
                      <td className={cn(NAME_STICKY, STICKY_BG, "px-1 py-3")}>
                        <div className={NAME_CLIP}>
                          <ProductNameCell name={p.name} idx={idx} sub={p.category} upper tones={PRODUCT_AVATAR_TONES} />
                        </div>
                      </td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{p.items != null ? p.items.toLocaleString("pt-BR") : (p.sub?.replace(" itens", "") ?? "—")}</td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(p.amount)}</td>
                      <td
                        className={cn(
                          "px-1 py-3 text-right font-mono text-[13px] font-bold",
                          p.profit == null ? "text-t2" : p.profit < 0 ? "text-palette-red" : "text-palette-green",
                        )}
                      >
                        {p.profit == null ? "—" : brlCent(p.profit)}
                      </td>
                      <td className="px-1 py-3 text-right text-xs font-bold" style={{ color: p.trend != null ? (p.trend >= 0 ? "var(--palette-green)" : "var(--palette-red)") : undefined }}>
                        {p.trend != null ? `${p.trend >= 0 ? "+" : ""}${p.trend}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-bg-inset">
                  <td className={cn(RANK_STICKY, "bg-bg-inset")} />
                  <td className={cn(NAME_STICKY, "bg-bg-inset px-1 py-3 text-[13px] font-extrabold text-t0")}>
                    <div className={NAME_CLIP}>
                      Total do filtro
                      <span className="mt-0.5 block text-[11px] font-semibold text-t2">
                        {num(productTotal.count)} produto{productTotal.count === 1 ? "" : "s"}
                      </span>
                    </div>
                  </td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{num(productTotal.items)}</td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{brlCent(productTotal.revenue)}</td>
                  <td
                    className={cn(
                      "px-1 py-3 text-right font-mono text-[13px] font-extrabold",
                      productTotal.profit == null ? "text-t2" : productTotal.profit < 0 ? "text-palette-red" : "text-palette-green",
                    )}
                  >
                    {productTotal.profit == null ? "—" : brlCent(productTotal.profit)}
                  </td>
                  <td
                    className="px-1 py-3 text-right text-xs font-extrabold"
                    style={{ color: productTotal.variation != null ? (productTotal.variation >= 0 ? "var(--palette-green)" : "var(--palette-red)") : undefined }}
                  >
                    {productTotal.variation != null ? `${productTotal.variation >= 0 ? "+" : ""}${productTotal.variation}%` : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          )}
        </Card>
      </div>
      </>
      )}

      {detailModal}
      {personModal}
    </div>
  );
}

function KpiCard({ kpi, Icon }: { kpi: OverviewKpi; Icon: () => React.JSX.Element }) {
  const tone = kpiTone(kpi.label);
  return (
    <StatCard
      label={kpi.label}
      value={kpi.amount}
      icon={<Icon />}
      iconColor={tone.iconColor}
      iconBg={tone.iconBg}
      delta={kpi.delta}
      sub={kpi.sub}
      tooltip={kpi.tooltip}
      valueClassName="text-t0"
    />
  );
}
