import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { paths } from "@/router/paths";
import { Button, Card, CardHeader, CardTitle, DateRangePicker, PageHeader, Pagination, StatCard, Tabs, ThSort, type SortDir } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { DonutChart } from "@/components/charts";
import { scopeFilterKey, useScope } from "@/pages/dashboard/useScope";
import {
  resolvePeriod,
  TEAM_WITHOUT_SHIFT,
  type Scope,
  type TeamAggInput,
  type TeamMemberRow,
} from "@/data/wedash/dashboard";
import { fetchNamedSellerDayAggs, fetchSalesCoverage, fetchSalesDayAggs, fetchSalesSellerDayAggs } from "@/data/wedash/salesRepo";
import { fetchGoals, fetchGoalTeam, type GoalRecord, type GoalTeamMember } from "@/data/wedash/goalsRepo";
import { buildGoalCardView, goalStatus, sellerGoalLevels } from "@/data/wedash/goalView";
import { TEAM_UNATTRIBUTED_SALE, teamViewWithGoalShare } from "@/data/wedash/engine/generalRanking";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import type { SalesDayAgg, SalesSellerDayAgg } from "@/data/wedash/salesTypes";
import { storesForSession } from "@/data/wedash/stores";
import { teamChallengesReturn, teamGoalsReturn } from "@/pages/goals/backPath";
import { GoalCard } from "./blocks";
import {
  emptyChallengeAggInput,
  fetchChallengeInput,
  fetchChallenges,
  type ChallengeAggInput,
  type ChallengeRecord,
} from "@/data/wedash/challengesRepo";
import { buildChallengeView, type ChallengeStatus } from "@/data/wedash/challengeView";
import { ChallengeMiniCard } from "@/pages/challenges/ChallengeMiniCard";
import { CHALLENGE_STATUS_ORDER } from "@/pages/challenges/shared";
import { fetchTeamAggInput, useTeamMemberDetail } from "@/pages/dashboard/TeamMemberDetail";
import { calendarTodayIso } from "@/data/wedash/clock";
import { matchesCodeOrName } from "@/lib/personSearch";
import { goalWeightFrom } from "@/data/wedash/engine/goalProjection";
import { defaultWeekHours, effectiveWeekHours } from "@/data/wedash/storeHours";
import { useActiveSession } from "@/session/SessionProvider";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useMonthFill } from "@/pages/dashboard/useMonthFill";
import { useDeepHistoryFill } from "@/pages/dashboard/useDeepHistoryFill";
import { MonthFillNotice, pickerMinDate } from "@/pages/dashboard/MonthFillNotice";
import { DeepHistoryNotice } from "@/pages/dashboard/DeepHistoryNotice";
import { InitialSyncNotice } from "@/pages/dashboard/InitialSyncNotice";
import { StoreHoursNotice } from "@/pages/dashboard/StoreHoursNotice";
import { ErpStatusNotice } from "@/pages/dashboard/ErpStatusNotice";
import { ExportDialog } from "@/components/wedash/ExportDialog";
import { ReportHeader, useExportPdf } from "@/pages/dashboard/ReportHeader";
import { usePrintMode } from "@/lib/printMode";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { TeamSkeleton } from "@/components/wedash/LoadingSkeletons";
import { useFilterSkeleton } from "@/lib/useFilterSkeleton";
import { FlameIcon, TargetIcon, TrophyIcon } from "@/pages/dashboards/icons";
import { RankingBlock } from "@/pages/live/blocks";
import type { RankingRow } from "@/data/wedash/live";
import { TABLE_PAGE_SIZE } from "@/lib/usePagedRows";
import { brlCent, isoToDate, labelUpper, num, comparedWithTip } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { DateRange, DateRangeChangeMeta } from "@/components/ui/DateRangePicker";
import {
  applyPeriodDateChange,
  dateRangeFromPeriod,
  periodActivePresetId,
  periodDisplayLabel,
} from "@/pages/dashboard/periodPicker";
type GoalsData = { goals: GoalRecord[]; dayAggs: SalesDayAgg[]; sellerAggs: SalesSellerDayAgg[]; namedAggs: SalesSellerDayAgg[]; team: GoalTeamMember[] };
const GOALS_EMPTY: GoalsData = { goals: [], dayAggs: [], sellerAggs: [], namedAggs: [], team: [] };

/** Metas das lojas do filtro que cruzam o periodo; vendas do inicio de cada meta ate hoje (igual ao detalhe da meta). */
async function fetchGoalsData(tenantId: string, scope: Scope, sessionStores: string[]): Promise<GoalsData> {
  const today = calendarTodayIso();
  const period = resolvePeriod(scope.period, today);
  const storeIds = scope.storeIds.length > 0 ? scope.storeIds : storesForSession(sessionStores).map((s) => s.id);
  const goals = await fetchGoals({ tenantId, storeIds, from: period.start, to: period.end });
  if (goals.length === 0) return GOALS_EMPTY;
  const storeRows = [...new Set(goals.map((g) => g.storeId))];
  const from = goals.reduce((m, g) => (g.startsOn < m ? g.startsOn : m), goals[0]!.startsOn);
  const end = goals.reduce((m, g) => (g.endsOn > m ? g.endsOn : m), goals[0]!.endsOn);
  const to = end < today ? end : today;
  const historyFrom = goalWeightFrom(from);
  const people = from <= to;
  const [dayAggs, sellerAggs, namedAggs, team] = await Promise.all([
    historyFrom <= to ? fetchSalesDayAggs({ tenantId, storeIds: storeRows, from: historyFrom, to, brand: "ALL" }) : Promise.resolve([]),
    people ? fetchSalesSellerDayAggs({ tenantId, storeIds: storeRows, from, to }) : Promise.resolve([]),
    people ? fetchNamedSellerDayAggs({ tenantId, storeIds: storeRows, from, to }) : Promise.resolve([]),
    fetchGoalTeam(tenantId, storeRows),
  ]);
  return { goals, dayAggs, sellerAggs, namedAggs, team };
}

type ChallengesData = { challenges: ChallengeRecord[]; aggs: ChallengeAggInput };
const CHALLENGES_EMPTY: ChallengesData = { challenges: [], aggs: emptyChallengeAggInput() };

/** Desafios das lojas do filtro cujo periodo cruza o filtro da tela (em andamento, a comecar e encerrados). */
async function fetchPeriodChallenges(tenantId: string, scope: Scope, sessionStores: string[]): Promise<ChallengesData> {
  const today = calendarTodayIso();
  const period = resolvePeriod(scope.period, today);
  const storeIds = scope.storeIds.length > 0 ? scope.storeIds : storesForSession(sessionStores).map((s) => s.id);
  const challenges = await fetchChallenges({ tenantId, storeIds, from: period.start, to: period.end });
  if (challenges.length === 0) return CHALLENGES_EMPTY;
  return { challenges, aggs: await fetchChallengeInput({ tenantId, challenges, today: today }) };
}

const IconRevenue = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);
const IconSales = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);
const IconTicket = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
    <path d="M13 5v2M13 17v2M13 11v2" />
  </svg>
);
const IconItems = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);
const KPI_ICONS = [IconRevenue, IconSales, IconTicket, IconItems];

const KPI_COLORS = [
  { iconColor: "var(--acc)", iconBg: "var(--acc-soft)" },
  { iconColor: "var(--ok)", iconBg: "var(--ok-soft)" },
  { iconColor: "var(--info)", iconBg: "rgba(59,130,246,0.12)" },
  { iconColor: "var(--warn)", iconBg: "rgba(245,158,11,0.12)" },
];

const COLORS_SHIFT = ["var(--acc)", "var(--info)", "var(--ok)", "var(--warn)", "var(--bad)"];
/** Fatia neutra (sem turno / fora da equipe)  -  nao compete com as demais. */
const COLOR_NEUTRA = "color-mix(in srgb, var(--t2) 40%, transparent)";
const CAN_CONFIGURE_STORE = new Set(["OWNER", "MANAGER", "ADMIN_GLOBAL"]);

type SortKey = "name" | "revenue" | "sales" | "averageTicket" | "pa" | "participationPct" | "variationPct";

const TipHelp = ({ label }: { label: string }) => (
  <Tooltip label={label}>
    <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 hover:text-t1 transition-colors">
      ?
    </span>
  </Tooltip>
);

const filterInputClass =
  "h-8 rounded-[var(--radius-vela-sm)] border border-line bg-bg-3 px-3 text-xs font-semibold text-t0 transition-colors hover:border-acc focus:border-acc focus:outline-none";

const pctFmt = (v: number | null, casas = 1) => (v == null ? "—" : `${num(v, casas)}%`);
const paFmt = (v: number | null) => (v == null ? "—" : num(v, 2));

function Variation({ v }: { v: number | null }) {
  if (v == null) return <span className="text-t2">—</span>;
  const r = Math.round(v);
  return (
    <span className="font-bold" style={{ color: r >= 0 ? "var(--ok)" : "var(--bad)" }}>
      {r >= 0 ? "+" : ""}
      {r}%
    </span>
  );
}

/** "Manha  |  09:00 - 15:00"  ->  nome + horario. */
function partesShift(shift?: string): { name: string; schedule?: string } {
  if (!shift) return { name: TEAM_WITHOUT_SHIFT };
  const [name, schedule] = shift.split(" · ");
  return { name: name ?? shift, schedule };
}

/** Loja principal (+N)  -  so com mais de 1 loja no escopo. */
function storesLabel(storeRows: string[]): string | null {
  if (storeRows.length === 0) return null;
  return storeRows.length > 1 ? `${storeRows[0]} · +${storeRows.length - 1}` : storeRows[0]!;
}

/**
 * Dashboard > Equipe: desempenho individual da equipe de vendas no periodo.
 * Aba Metas e aba Desafios = o que cruza o periodo do filtro (encerrado continua quando o mes passado esta selecionado).
 */
export function TeamPage() {
  const session = useActiveSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab");
  const performanceTab = tab === "challenges" || tab === "goals" ? tab : "ranking";
  const { scope, setScope } = useScope();
  const exportPdf = useExportPdf("Equipe");
  const [aggs, setAggs] = useState<TeamAggInput>({ dayAggs: [] });
  const [coverageFrom, setCoverageFrom] = useState<Date | null>(null);
  const filterKey = scopeFilterKey(scope);
  const { showSkeleton, settle } = useFilterSkeleton(filterKey);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [goalsData, setGoalsData] = useState<GoalsData>(GOALS_EMPTY);
  const [challengesData, setChallengesData] = useState<ChallengesData>(CHALLENGES_EMPTY);
  const printing = usePrintMode();
  const [storesTick, setStoresTick] = useState(0);
  useEffect(() => {
    const onStores = () => setStoresTick((n) => n + 1);
    window.addEventListener("wedash:stores", onStores);
    return () => window.removeEventListener("wedash:stores", onStores);
  }, []);

  /** So a leitura mais recente aplica setState. */
  const reloadGen = useRef(0);
  const reload = useCallback(async () => {
    const gen = ++reloadGen.current;
    const key = filterKey;
    try {
      const [next, cov, goals, challenges] = await Promise.all([
        fetchTeamAggInput(session.tenantId, scope),
        fetchSalesCoverage(session.tenantId, scope.storeIds),
        fetchGoalsData(session.tenantId, scope, session.stores),
        fetchPeriodChallenges(session.tenantId, scope, session.stores).catch((e: unknown) => {
          console.error("Team challenges:", e);
          return CHALLENGES_EMPTY;
        }),
      ]);
      if (gen !== reloadGen.current) return;
      setAggs(next);
      setCoverageFrom(cov.from ? isoToDate(cov.from) : null);
      setGoalsData(goals);
      setChallengesData(challenges);
      settle(key);
    } catch (e) {
      if (gen !== reloadGen.current) return;
      console.error("Team reload:", e);
      settle(key);
    }
  }, [scope, session.tenantId, session.stores, filterKey, settle]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onSynced = () => void reload();
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [reload]);

  const view = useMemo(() => {
    const stores = storesForSession(session.stores);
    return teamViewWithGoalShare(
      scope,
      aggs,
      goalsData.goals,
      goalsData.team,
      calendarTodayIso(),
      new Map(stores.map((store) => [store.id, store.tradeName])),
    );
  }, [scope, aggs, goalsData.goals, goalsData.team, session.stores]);

  const todayIso = calendarTodayIso();
  const goalCards = useMemo(() => {
    const stores = storesForSession(session.stores);
    const storeName = new Map(stores.map((s) => [s.id, s.tradeName]));
    const storeHours = new Map(stores.map((s) => [s.id, s.hours]));
    const order = { active: 0, upcoming: 1, ended: 2 } as const;
    return [...goalsData.goals]
      .sort((a, b) => order[goalStatus(a, todayIso)] - order[goalStatus(b, todayIso)] || b.startsOn.localeCompare(a.startsOn))
      .map((goal) =>
        buildGoalCardView({
          goal,
          storeNameValue: storeName.get(goal.storeId) ?? "Filial",
          dayAggs: goalsData.dayAggs,
          sellerDayAggs: goalsData.sellerAggs,
          namedSellerDayAggs: goalsData.namedAggs,
          team: goalsData.team,
          today: todayIso,
          week: effectiveWeekHours(storeHours.get(goal.storeId) ?? defaultWeekHours()),
        }),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalsData, session.stores, todayIso, storesTick]);

  const challengeCards = useMemo(() => {
    const storeName = new Map(storesForSession(session.stores).map((s) => [s.id, s.tradeName]));
    return challengesData.challenges
      .map((challenge) => ({
        challenge,
        view: buildChallengeView({ challenge, aggs: challengesData.aggs, today: todayIso }),
        storeNameValue: storeName.get(challenge.storeId),
      }))
      .sort(
        (a, b) =>
          CHALLENGE_STATUS_ORDER[a.view.status] - CHALLENGE_STATUS_ORDER[b.view.status] ||
          (a.view.status === "ended"
            ? b.challenge.endsOn.localeCompare(a.challenge.endsOn)
            : a.challenge.endsOn.localeCompare(b.challenge.endsOn)) ||
          a.challenge.name.localeCompare(b.challenge.name, "pt-BR"),
      );
  }, [challengesData, session.stores, todayIso]);
  const showChallengeStore = (scope.storeIds.length === 0 ? storesForSession(session.stores).length : scope.storeIds.length) > 1;

  const goalLevels = useMemo(
    () =>
      sellerGoalLevels({
        goals: goalsData.goals,
        dayAggs: goalsData.dayAggs,
        sellerDayAggs: goalsData.sellerAggs,
        namedSellerDayAggs: goalsData.namedAggs,
        team: goalsData.team,
        today: todayIso,
      }),
    [goalsData, todayIso],
  );

  const dateRange = useMemo(() => dateRangeFromPeriod(scope.period), [scope.period]);
  const currentPeriod = resolvePeriod(scope.period, calendarTodayIso());
  const monthFill = useMonthFill();
  const deepHistoryFill = useDeepHistoryFill();
  function onDateChange(r: DateRange, goal?: DateRangeChangeMeta) {
    setScope(applyPeriodDateChange(scope, r, goal));
  }

  const tableLines = useMemo(() => {
    let list = view.people;
    const q = search.trim();
    if (q) list = list.filter((p) => matchesCodeOrName(p.name, p.key.startsWith("e:") ? p.key.slice(2) : "", q));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name, "pt-BR") * dir;
      const va = a[sortKey];
      const vb = b[sortKey];
      // Sem dado (" - ") sempre no fim, nas duas direcoes.
      if (va == null && vb == null) return b.revenue - a.revenue;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }, [view.people, search, sortKey, sortDir]);

  const tableTotal = useMemo(() => {
    const revenue = tableLines.reduce((s, p) => s + p.revenue, 0);
    const sales = tableLines.reduce((s, p) => s + p.sales, 0);
    const items = tableLines.reduce((s, p) => s + p.items, 0);
    const complete = tableLines.every((p) => p.pa != null || p.sales === 0);
    const revenueCmp = tableLines.reduce((s, p) => s + p.revenueCmp, 0);
    const revenuePrev = tableLines.reduce((s, p) => s + p.revenuePrev, 0);
    return {
      revenue,
      sales,
      averageTicket: sales > 0 ? revenue / sales : 0,
      pa: complete && sales > 0 ? items / sales : null,
      participationPct: tableLines.reduce((s, p) => s + p.participationPct, 0),
      variationPct: revenueCmp > 0 && revenuePrev > 0 ? ((revenueCmp - revenuePrev) / revenuePrev) * 100 : null,
    };
  }, [tableLines]);

  // O pódio já mostra o 1º, 2º e 3º. A lista e a busca ficam só com o restante.
  const podiumKeys = useMemo(() => new Set(view.people.slice(0, 3).map((p) => p.key)), [view.people]);
  const hasRankingList = view.people.length > 3;
  const listLines = useMemo(
    () => tableLines.filter((p) => !podiumKeys.has(p.key)),
    [tableLines, podiumKeys],
  );

  const pageSize = TABLE_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(listLines.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = printing ? listLines : listLines.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, sortKey, sortDir, scope]);

  useEffect(() => {
    if (!hasRankingList) setSearch("");
  }, [hasRankingList]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  const { open: openPerson, modal: personModal } = useTeamMemberDetail({
    scope,
    data: aggs,
    goalLevels,
    goalShare: {
      goals: goalsData.goals,
      team: goalsData.team,
      storeNames: new Map(storesForSession(session.stores).map((store) => [store.id, store.tradeName])),
    },
  });
  const teclaAbre = (p: TeamMemberRow) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPerson(p.key, p.name);
    }
  };
  const tipVariation = `Faturamento ${comparedWithTip(view.vsVariation).replace(/^Em/, "em").replace(/\.$/, "")}.`;
  const tipVariationTotal = `Faturamento total das pessoas do filtro ${comparedWithTip(view.vsVariation).replace(/^Em/, "em").replace(/\.$/, "")}.`;
  const hasTeamSales = view.people.length > 0;
  const canConfigure = CAN_CONFIGURE_STORE.has(session.role);
  const rankByKey = new Map(view.people.map((p, i) => [p.key, i]));
  const podio: RankingRow[] = view.people.slice(0, 3).map((p, i) => ({
    position: i + 1,
    employeeId: p.key,
    name: p.name,
    storeId: p.storeIds[0],
    sales: p.sales,
    revenue: p.revenue,
  }));

  return (
    <div className="flex flex-col p-4 sm:p-6 print:p-0">
      <ReportHeader />
      <PageHeader
        crumbs={[{ label: "Dashboard", to: "/dashboard/visao-geral" }, { label: "Equipe" }]}
        title="Equipe"
        subtitle="Acompanhe o desempenho da equipe de vendas."
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
      <StoreHoursNotice />

      {showSkeleton ? (
        <TeamSkeleton />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {view.kpis.map((kpi, i) => {
              const c = KPI_COLORS[i % KPI_COLORS.length]!;
              const Icon = KPI_ICONS[i] ?? IconRevenue;
              return (
                <StatCard
                  key={kpi.label}
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
            })}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Faturamento por turno */}
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle>Faturamento por grupo</CardTitle>
              </CardHeader>
              {view.shifts.length === 0 ? (
                <EmptyBlock />
              ) : !view.shiftsConfigured && !view.shifts.some((shift) => shift.name === TEAM_UNATTRIBUTED_SALE) ? (
                <EmptyBlock
                  icon="👥"
                  title="Grupos não configurados"
                  description="Cadastre os grupos das filiais e vincule a equipe para comparar o desempenho por grupo."
                  action={
                    canConfigure ? (
                      <Button size="sm" onClick={() => navigate(paths.management.team)}>
                        Gerenciar grupos
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                (() => {
                  const total = view.shifts.reduce((s, t) => s + t.revenue, 0) || 1;
                  let colorIdx = 0;
                  const colors = view.shifts.map((t) => (t.name === TEAM_WITHOUT_SHIFT || t.name === TEAM_UNATTRIBUTED_SALE ? COLOR_NEUTRA : COLORS_SHIFT[colorIdx++ % COLORS_SHIFT.length]!));
                  return (
                    <div className="flex flex-1 flex-col justify-center px-4 pb-4">
                      <div className="mx-auto my-2">
                        <DonutChart
                          segments={view.shifts.map((t, i) => ({ label: partesShift(t.name === TEAM_WITHOUT_SHIFT ? undefined : t.name).name, value: t.revenue, color: colors[i]! }))}
                          centerLabel="Total"
                          centerValue={brlCent(total)}
                        />
                      </div>
                      <div className="mt-2 flex flex-col gap-2.5">
                        {view.shifts.map((t, i) => {
                          const pct = Math.round((t.revenue / total) * 100);
                          const pt = partesShift(t.name === TEAM_WITHOUT_SHIFT ? undefined : t.name);
                          return (
                            <div key={t.name} className="flex items-start gap-2.5">
                              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: colors[i] }} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                  <span className="min-w-0 truncate text-[12.5px] font-semibold text-t1">{pt.name}</span>
                                  <span className="ml-auto shrink-0 font-mono text-[12.5px] font-bold text-t0">{brlCent(t.revenue)}</span>
                                  <span className="min-w-[32px] shrink-0 text-right text-[11.5px] font-semibold text-t2">{pct}%</span>
                                </div>
                                <p className="mt-0.5 text-[11.5px] text-t2">
                                  {t.name === TEAM_UNATTRIBUTED_SALE
                                    ? "Venda sem vendedor identificado"
                                    : `${pt.schedule ? `${pt.schedule} · ` : ""}${t.people} ${t.people === 1 ? "pessoa" : "pessoas"}`}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()
              )}
            </Card>

            {/* Composicao do faturamento */}
            <Card className="flex flex-col">
              <CardHeader>
                <div className="flex items-center gap-1.5">
                  <CardTitle>Composição do faturamento</CardTitle>
                  <TipHelp label="Mostra quanto do faturamento foi atribuído à equipe, quanto ficou sem vendedor identificado, quanto foi lançado no usuário da filial e quanto foi da gerência." />
                </div>
              </CardHeader>
              {view.composition.total <= 0 ? (
                <EmptyBlock />
              ) : (
                (() => {
                  const { team, unidentified, branchUser, management, total } = view.composition;
                  const fatias = [
                    { name: "Equipe de vendas", amount: team, color: "var(--acc)" },
                    { name: "Sem vendedor identificado", amount: unidentified, color: COLOR_NEUTRA },
                    { name: "Usuário da filial", amount: branchUser, color: "var(--info)" },
                    { name: "Gerência", amount: management, color: "var(--warn)" },
                  ].filter((f) => f.amount > 0);
                  return (
                    <div className="flex flex-1 flex-col justify-center px-4 pb-4">
                      <div className="mx-auto my-2">
                        <DonutChart
                          segments={fatias.map((f) => ({ label: labelUpper(f.name), value: f.amount, color: f.color }))}
                          centerLabel="Total"
                          centerValue={brlCent(total)}
                        />
                      </div>
                      <div className="mt-2 flex flex-col gap-2">
                        {fatias.map((f) => (
                          <div key={f.name} className="flex items-center gap-2.5">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: f.color }} />
                            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-t1">{labelUpper(f.name)}</span>
                            <span className="shrink-0 font-mono text-[12.5px] font-bold text-t0">{brlCent(f.amount)}</span>
                            <span className="min-w-[32px] shrink-0 text-right text-[11.5px] font-semibold text-t2">
                              {Math.round((f.amount / total) * 100)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()
              )}
            </Card>
          </div>

          {/* Desempenho da equipe  -  abas Ranking  |  Metas  |  Desafios */}
          <Card className="mt-4 min-w-0 overflow-hidden" padding="lg">
            <div className="mb-4 flex items-center gap-1.5">
              <CardTitle>Desempenho da equipe</CardTitle>
              <TipHelp label={"Acompanhe ranking, desafios e metas da equipe no período.\n\nNa meta Individual ou Grupo, com o rateio ligado, a venda sem vendedor entra no faturamento, na média e no ranking. Na meta Geral, o total da filial é dividido entre quem estava na loja e essas pessoas entram no ranking. O faturamento por grupo mostra essa venda à parte, sem distribuir no grupo."} />
            </div>
            {printing ? (
              !hasTeamSales ? <EmptyBlock /> : abaRanking()
            ) : (
            <Tabs
              variant="accent"
              defaultKey={performanceTab}
              items={[
                {
                  key: "ranking",
                  label: "Ranking",
                  icon: <TrophyIcon size={14} />,
                  content: !hasTeamSales ? <EmptyBlock /> : abaRanking(),
                },
                {
                  key: "goals",
                  label: "Metas",
                  icon: <TargetIcon size={14} />,
                  content:
                    goalCards.length > 0 ? (
                      <div className="flex flex-col gap-4">
                        {goalCards.map((card) => (
                          <GoalCard
                            key={card.id}
                            card={card}
                            activeGoal
                            todayIso={todayIso}
                            onOpen={() => navigate(paths.goalDetail(card.id), { state: { from: teamGoalsReturn(location.search) } })}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyBlock
                        icon="🎯"
                        title="Meta não configurada"
                        description="Cadastre uma meta para acompanhar o desempenho da equipe no período."
                        action={
                          <Button size="sm" onClick={() => navigate(paths.goals)}>
                            Criar meta
                          </Button>
                        }
                      />
                    ),
                },
                {
                  key: "challenges",
                  label: "Desafios",
                  icon: <FlameIcon size={14} />,
                  content:
                    challengeCards.length > 0 ? (
                      abaDesafios()
                    ) : (
                      <EmptyBlock
                        icon="🔥"
                        title="Desafio não configurado"
                        description="Crie um desafio para engajar a equipe e acompanhar o progresso de cada pessoa."
                        action={
                          <Button size="sm" onClick={() => navigate(paths.management.challenges)}>
                            Criar desafio
                          </Button>
                        }
                      />
                    ),
                },
              ]}
            />
            )}
          </Card>
        </>
      )}

      {personModal}
    </div>
  );

  function abaDesafios() {
    const titles: Record<ChallengeStatus, string> = {
      active: "Em andamento",
      upcoming: "A começar",
      ended: "Encerrados",
    };
    const present = (["active", "upcoming", "ended"] as const).filter((status) =>
      challengeCards.some((card) => card.view.status === status),
    );
    const split = present.length > 1;
    return (
      <div className="flex flex-col gap-4">
        {present.map((status) => (
          <div key={status}>
            {split && <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-t2">{titles[status]}</p>}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {challengeCards
                .filter((card) => card.view.status === status)
                .map(({ challenge, view: challengeView, storeNameValue }) => (
                  <ChallengeMiniCard
                    key={challenge.id}
                    challenge={challenge}
                    view={challengeView}
                    storeNameValue={showChallengeStore ? storeNameValue : undefined}
                    onOpen={() =>
                      navigate(paths.management.challengeDetail(challenge.id), {
                        state: { from: teamChallengesReturn(location.search) },
                      })
                    }
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function abaRanking() {
    return (
      <div className="flex flex-col">
        <RankingBlock ranking={podio} formatAmount={brlCent} onSelect={(r) => openPerson(r.employeeId, r.name)} />

        {hasRankingList && (
          <div className="mt-6 mb-4 flex flex-wrap items-center gap-2 sm:justify-end print:hidden">
            <input
              type="search"
              placeholder="Buscar por código ou nome…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(filterInputClass, "sm:w-56")}
            />
          </div>
        )}

        {listLines.length === 0 ? (
          search.trim() ? (
            <WithoutResult hasDados={hasTeamSales} onClear={() => setSearch("")} />
          ) : null
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
                  <th className="px-1 pb-3 text-left font-bold">#</th>
                  <ThSort label="Nome" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} align="left" className="px-1 pb-3" />
                  <th className="px-1 pb-3 text-left font-bold">Grupo</th>
                  <ThSort label="Faturamento" active={sortKey === "revenue"} dir={sortDir} onClick={() => toggleSort("revenue")} className="px-1 pb-3" />
                  <ThSort label="Nº de vendas" active={sortKey === "sales"} dir={sortDir} onClick={() => toggleSort("sales")} className="px-1 pb-3" />
                  <ThSort label="Ticket médio" active={sortKey === "averageTicket"} dir={sortDir} onClick={() => toggleSort("averageTicket")} className="px-1 pb-3" />
                  <ThSort label="P.A." active={sortKey === "pa"} dir={sortDir} onClick={() => toggleSort("pa")} className="px-1 pb-3" />
                  <ThSort label="Participação" active={sortKey === "participationPct"} dir={sortDir} onClick={() => toggleSort("participationPct")} className="px-1 pb-3" />
                  <ThSort label="Variação" active={sortKey === "variationPct"} dir={sortDir} onClick={() => toggleSort("variationPct")} className="px-1 pb-3" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => {
                  const rank = rankByKey.get(p.key) ?? 0;
                  const shift = partesShift(p.shift);
                  const store = view.multiStore ? storesLabel(p.storeRows) : null;
                  return (
                    <tr
                      key={p.key}
                      tabIndex={0}
                      onClick={() => openPerson(p.key, p.name)}
                      onKeyDown={teclaAbre(p)}
                      className="cursor-pointer border-b border-line transition-colors hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none"
                    >
                      <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{rank + 1}</td>
                      <td className="px-1 py-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <PersonAvatar name={p.name} employeeId={p.key} storeId={p.storeIds[0]} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-bold text-t0">{p.name}</p>
                            {store &&
                              (p.storeRows.length > 1 ? (
                                <Tooltip label={p.storeRows.slice(1).join(" · ")}>
                                  <p className="truncate text-[11px] text-t2">{store}</p>
                                </Tooltip>
                              ) : (
                                <p className="truncate text-[11px] text-t2">{store}</p>
                              ))}
                          </div>
                        </div>
                      </td>
                      <td className="px-1 py-3">
                        <p className={cn("text-[12.5px] font-semibold", p.shift ? "text-t1" : "text-t2")}>{shift.name}</p>
                        {shift.schedule && <p className="text-[11px] text-t2">{shift.schedule}</p>}
                      </td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(p.revenue)}</td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{num(p.sales)}</td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(p.averageTicket)}</td>
                      <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", p.pa == null ? "text-t2" : "text-t0")}>{paFmt(p.pa)}</td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{pctFmt(p.participationPct)}</td>
                      <td className="px-1 py-3 text-right font-mono text-[13px]">
                        <Tooltip label={tipVariation}>
                          <span>
                            <Variation v={p.variationPct} />
                          </span>
                        </Tooltip>
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-bg-inset">
                  <td />
                  <td className="px-1 py-3 text-[13px] font-extrabold text-t0" colSpan={2}>
                    Total do filtro
                    <span className="mt-0.5 block text-[11px] font-semibold text-t2">
                      {num(tableLines.length)} {tableLines.length === 1 ? "pessoa" : "pessoas"}
                    </span>
                  </td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{brlCent(tableTotal.revenue)}</td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{num(tableTotal.sales)}</td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{brlCent(tableTotal.averageTicket)}</td>
                  <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-extrabold", tableTotal.pa == null ? "text-t2" : "text-t0")}>
                    {paFmt(tableTotal.pa)}
                  </td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{pctFmt(tableTotal.participationPct)}</td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold">
                    <Tooltip label={tipVariationTotal}>
                      <span>
                        <Variation v={tableTotal.variationPct} />
                      </span>
                    </Tooltip>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {listLines.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
            <span className="text-[12.5px] text-t2">
              Mostrando {pageRows.length} de {num(listLines.length)} pessoas
            </span>
            {totalPages > 1 && <Pagination page={pageSafe} totalPages={totalPages} onChange={setPage} />}
          </div>
        )}
      </div>
    );
  }
}

function WithoutResult({ hasDados, onClear }: { hasDados: boolean; onClear: () => void }) {
  if (!hasDados) return <EmptyBlock />;
  return (
    <EmptyBlock
      icon="🔍"
      title="Nenhuma pessoa encontrada"
      description="Tente outro código ou nome."
      action={
        <Button variant="outline" size="sm" onClick={onClear}>
          Limpar busca
        </Button>
      }
    />
  );
}

