import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { paths } from "@/router/paths";
import { HeaderFilter } from "@/pages/dashboard/HeaderFilter";
import { Button, Card, CardHeader, CardTitle, DateRangePicker, PageHeader, Pagination, StatCard, Tabs, ThSort, type SortDir } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { DonutChart } from "@/components/charts";
import { useScope } from "@/pages/dashboard/useScope";
import {
  buildTeamDashboardView,
  resolvePeriod,
  TEAM_SEM_TURNO,
  type Scope,
  type TeamAggInput,
  type TeamMemberRow,
} from "@/data/wedash/dashboard";
import { fetchSalesCoverage, fetchSalesDayAggs, fetchSalesSellerDayAggs } from "@/data/wedash/salesRepo";
import { fetchGoals, fetchGoalTeam, type GoalRecord, type GoalTeamMember } from "@/data/wedash/goalsRepo";
import { buildGoalCardView, goalStatus, sellerGoalLevels, type SellerGoalLevel } from "@/data/wedash/goalView";
import { GoalLevelSummary } from "@/components/wedash/GoalLevelsBar";
import { AvatarIniciais } from "@/components/wedash/InitialsAvatar";
import type { SalesDayAgg, SalesSellerDayAgg } from "@/data/wedash/salesTypes";
import { storesForSession } from "@/data/wedash/stores";
import { GoalCard } from "./blocks";
import {
  emptyChallengeAggInput,
  fetchChallengeInput,
  fetchChallenges,
  type ChallengeAggInput,
  type ChallengeRecord,
} from "@/data/wedash/challengesRepo";
import { buildChallengeView } from "@/data/wedash/challengeView";
import { ChallengeMiniCard } from "@/pages/challenges/ChallengeMiniCard";
import { CHALLENGE_STATUS_ORDER } from "@/pages/challenges/shared";
import { fetchTeamAggInput, useTeamMemberDetail } from "@/pages/dashboard/TeamMemberDetail";
import { calendarTodayIso } from "@/data/wedash/clock";
import { useActiveSession } from "@/session/SessionProvider";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useMonthFill } from "@/pages/dashboard/useMonthFill";
import { useDeepHistoryFill } from "@/pages/dashboard/useDeepHistoryFill";
import { MonthFillNotice, pickerMinDate } from "@/pages/dashboard/MonthFillNotice";
import { DeepHistoryNotice } from "@/pages/dashboard/DeepHistoryNotice";
import { InitialSyncNotice } from "@/pages/dashboard/InitialSyncNotice";
import { StoreHoursNotice } from "@/pages/dashboard/StoreHoursNotice";
import { ErpStatusNotice } from "@/pages/dashboard/ErpStatusNotice";
import { ReportHeader, useExportPdf } from "@/pages/dashboard/ReportHeader";
import { usePrintMode } from "@/lib/printMode";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { TeamSkeleton } from "@/components/wedash/LoadingSkeletons";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { FlameIcon, TargetIcon, TrophyIcon } from "@/pages/dashboards/icons";
import { RankingBlock } from "@/pages/live/blocks";
import type { RankingRow } from "@/data/wedash/live";
import { TABLE_PAGE_SIZE } from "@/lib/usePagedRows";
import { brlCent, deIso, labelUpper, num, tipRelacao } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { DateRange, DateRangeChangeMeta } from "@/components/ui/DateRangePicker";
import {
  applyPeriodDateChange,
  dateRangeFromPeriod,
  periodActivePresetId,
  periodDisplayLabel,
} from "@/pages/dashboard/periodPicker";

type GoalsData = { goals: GoalRecord[]; dayAggs: SalesDayAgg[]; sellerAggs: SalesSellerDayAgg[]; team: GoalTeamMember[] };
const GOALS_VAZIO: GoalsData = { goals: [], dayAggs: [], sellerAggs: [], team: [] };

/** Metas das lojas do filtro que cruzam o periodo; vendas do inicio de cada meta ate hoje (igual ao detalhe da meta). */
async function fetchGoalsData(tenantId: string, escopo: Scope, sessionStores: string[]): Promise<GoalsData> {
  const hoje = calendarTodayIso();
  const periodo = resolvePeriod(escopo.periodo, hoje);
  const storeIds = escopo.filialIds.length > 0 ? escopo.filialIds : storesForSession(sessionStores).map((s) => s.id);
  const goals = await fetchGoals({ tenantId, storeIds, from: periodo.inicio, to: periodo.fim });
  if (goals.length === 0) return GOALS_VAZIO;
  const lojas = [...new Set(goals.map((g) => g.storeId))];
  const from = goals.reduce((m, g) => (g.startsOn < m ? g.startsOn : m), goals[0]!.startsOn);
  const fim = goals.reduce((m, g) => (g.endsOn > m ? g.endsOn : m), goals[0]!.endsOn);
  const to = fim < hoje ? fim : hoje;
  const query = { tenantId, storeIds: lojas, from, to };
  const [dayAggs, sellerAggs, team] = await Promise.all([
    from <= to ? fetchSalesDayAggs({ ...query, brand: "ALL" }) : Promise.resolve([]),
    from <= to ? fetchSalesSellerDayAggs(query) : Promise.resolve([]),
    fetchGoalTeam(tenantId, lojas),
  ]);
  return { goals, dayAggs, sellerAggs, team };
}

type ChallengesData = { challenges: ChallengeRecord[]; aggs: ChallengeAggInput };
const CHALLENGES_VAZIO: ChallengesData = { challenges: [], aggs: emptyChallengeAggInput() };

/** Desafios das lojas do filtro cujo periodo cruza o filtro da tela (em andamento, a comecar e encerrados). */
async function fetchPeriodChallenges(tenantId: string, escopo: Scope, sessionStores: string[]): Promise<ChallengesData> {
  const hoje = calendarTodayIso();
  const periodo = resolvePeriod(escopo.periodo, hoje);
  const storeIds = escopo.filialIds.length > 0 ? escopo.filialIds : storesForSession(sessionStores).map((s) => s.id);
  const challenges = await fetchChallenges({ tenantId, storeIds, from: periodo.inicio, to: periodo.fim });
  if (challenges.length === 0) return CHALLENGES_VAZIO;
  return { challenges, aggs: await fetchChallengeInput({ tenantId, challenges, today: hoje }) };
}

const IconFat = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);
const IconVendas = () => (
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
const IconItens = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);
const KPI_ICONS = [IconFat, IconVendas, IconTicket, IconItens];

const KPI_COLORS = [
  { iconColor: "var(--acc)", iconBg: "var(--acc-soft)" },
  { iconColor: "var(--ok)", iconBg: "var(--ok-soft)" },
  { iconColor: "var(--info)", iconBg: "rgba(59,130,246,0.12)" },
  { iconColor: "var(--warn)", iconBg: "rgba(245,158,11,0.12)" },
];

const CORES_TURNO = ["var(--acc)", "var(--info)", "var(--ok)", "var(--warn)", "var(--bad)"];
/** Fatia neutra (sem turno / fora da equipe)  -  nao compete com as demais. */
const COR_NEUTRA = "color-mix(in srgb, var(--t2) 40%, transparent)";
const PODE_CONFIGURAR_LOJA = new Set(["OWNER", "MANAGER", "ADMIN_GLOBAL"]);

type SortKey = "nome" | "faturamento" | "vendas" | "averageTicket" | "pa" | "participacaoPct" | "variacaoPct";

const TipHelp = ({ label }: { label: string }) => (
  <Tooltip label={label}>
    <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 hover:text-t1 transition-colors">
      ?
    </span>
  </Tooltip>
);

const filtroInputClass =
  "h-8 rounded-[var(--radius-vela-sm)] border border-line bg-bg-3 px-3 text-xs font-semibold text-t0 transition-colors hover:border-acc focus:border-acc focus:outline-none";

const pctFmt = (v: number | null, casas = 1) => (v == null ? "—" : `${num(v, casas)}%`);
const paFmt = (v: number | null) => (v == null ? "—" : num(v, 2));

function Variacao({ v }: { v: number | null }) {
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
function partesTurno(turno?: string): { nome: string; horario?: string } {
  if (!turno) return { nome: TEAM_SEM_TURNO };
  const [nome, horario] = turno.split(" · ");
  return { nome: nome ?? turno, horario };
}

/** Loja principal (+N)  -  so com mais de 1 loja no escopo. */
function rotuloLojas(lojas: string[]): string | null {
  if (lojas.length === 0) return null;
  return lojas.length > 1 ? `${lojas[0]} · +${lojas.length - 1}` : lojas[0]!;
}

/**
 * Dashboard > Equipe: desempenho individual da equipe de vendas no periodo.
 * Aba Metas e aba Desafios = o que cruza o periodo do filtro (encerrado continua quando o mes passado esta selecionado).
 */
export function TeamPage() {
  const session = useActiveSession();
  const navigate = useNavigate();
  const { escopo, mudar } = useScope();
  const [aggs, setAggs] = useState<TeamAggInput>({ dayAggs: [] });
  const [coverageFrom, setCoverageFrom] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinSkeleton(loading);
  const [busca, setBusca] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("faturamento");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [turnoSel, setTurnoSel] = useState<string | null>(null);
  const [goalsData, setGoalsData] = useState<GoalsData>(GOALS_VAZIO);
  const [challengesData, setChallengesData] = useState<ChallengesData>(CHALLENGES_VAZIO);
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
    try {
      const [next, cov, metas, desafios] = await Promise.all([
        fetchTeamAggInput(session.tenantId, escopo),
        fetchSalesCoverage(session.tenantId, escopo.filialIds),
        fetchGoalsData(session.tenantId, escopo, session.stores),
        fetchPeriodChallenges(session.tenantId, escopo, session.stores).catch((e: unknown) => {
          console.error("Team challenges:", e);
          return CHALLENGES_VAZIO;
        }),
      ]);
      if (gen !== reloadGen.current) return;
      setAggs(next);
      setCoverageFrom(cov.from ? deIso(cov.from) : null);
      setGoalsData(metas);
      setChallengesData(desafios);
    } catch (e) {
      if (gen !== reloadGen.current) return;
      console.error("Team reload:", e);
    }
  }, [escopo, session.tenantId, session.stores]);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  useEffect(() => {
    const onSynced = () => void reload();
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [reload]);

  const view = useMemo(
    () => buildTeamDashboardView(escopo, aggs, { turno: turnoSel }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [escopo, aggs, storesTick, turnoSel],
  );

  const hojeIso = calendarTodayIso();
  const metaCards = useMemo(() => {
    const nomeLoja = new Map(storesForSession(session.stores).map((s) => [s.id, s.fantasia]));
    const ordem = { active: 0, upcoming: 1, ended: 2 } as const;
    return [...goalsData.goals]
      .sort((a, b) => ordem[goalStatus(a, hojeIso)] - ordem[goalStatus(b, hojeIso)] || b.startsOn.localeCompare(a.startsOn))
      .map((goal) =>
        buildGoalCardView({
          goal,
          lojaNome: nomeLoja.get(goal.storeId) ?? "Loja",
          dayAggs: goalsData.dayAggs,
          sellerDayAggs: goalsData.sellerAggs,
          team: goalsData.team,
          today: hojeIso,
        }),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalsData, session.stores, hojeIso, storesTick]);

  const desafioCards = useMemo(() => {
    const nomeLoja = new Map(storesForSession(session.stores).map((s) => [s.id, s.fantasia]));
    return challengesData.challenges
      .map((challenge) => ({
        challenge,
        view: buildChallengeView({ challenge, aggs: challengesData.aggs, today: hojeIso }),
        lojaNome: nomeLoja.get(challenge.storeId),
      }))
      .sort(
        (a, b) =>
          CHALLENGE_STATUS_ORDER[a.view.status] - CHALLENGE_STATUS_ORDER[b.view.status] ||
          (a.view.status === "ended"
            ? b.challenge.endsOn.localeCompare(a.challenge.endsOn)
            : a.challenge.endsOn.localeCompare(b.challenge.endsOn)) ||
          a.challenge.name.localeCompare(b.challenge.name, "pt-BR"),
      );
  }, [challengesData, session.stores, hojeIso]);
  const mostraLojaDesafio = escopo.filialIds.length === 0 && storesForSession(session.stores).length > 1;

  const niveisMeta = useMemo(
    () =>
      sellerGoalLevels({
        goals: goalsData.goals,
        dayAggs: goalsData.dayAggs,
        sellerDayAggs: goalsData.sellerAggs,
        team: goalsData.team,
        today: hojeIso,
      }),
    [goalsData, hojeIso],
  );
  const temColunaMeta = goalsData.goals.length > 0;

  const dateRange = useMemo(() => dateRangeFromPeriod(escopo.periodo), [escopo.periodo]);
  const periodoAtual = resolvePeriod(escopo.periodo, calendarTodayIso());
  const monthFill = useMonthFill();
  const deepHistoryFill = useDeepHistoryFill();
  function onDateChange(r: DateRange, meta?: DateRangeChangeMeta) {
    mudar(applyPeriodDateChange(escopo, r, meta));
  }

  const linhasTabela = useMemo(() => {
    let lista = view.pessoas;
    const q = busca.trim().toLowerCase();
    if (q) lista = lista.filter((p) => p.nome.toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...lista].sort((a, b) => {
      if (sortKey === "nome") return a.nome.localeCompare(b.nome, "pt-BR") * dir;
      const va = a[sortKey];
      const vb = b[sortKey];
      // Sem dado (" - ") sempre no fim, nas duas direcoes.
      if (va == null && vb == null) return b.faturamento - a.faturamento;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }, [view.pessoas, busca, sortKey, sortDir]);

  const totalTabela = useMemo(() => {
    const faturamento = linhasTabela.reduce((s, p) => s + p.faturamento, 0);
    const vendas = linhasTabela.reduce((s, p) => s + p.vendas, 0);
    const itens = linhasTabela.reduce((s, p) => s + p.itens, 0);
    const completo = linhasTabela.every((p) => p.pa != null || p.vendas === 0);
    const fatCmp = linhasTabela.reduce((s, p) => s + p.faturamentoCmp, 0);
    const fatAnt = linhasTabela.reduce((s, p) => s + p.faturamentoAnt, 0);
    return {
      faturamento,
      vendas,
      averageTicket: vendas > 0 ? faturamento / vendas : 0,
      pa: completo && vendas > 0 ? itens / vendas : null,
      participacaoPct: linhasTabela.reduce((s, p) => s + p.participacaoPct, 0),
      variacaoPct: fatCmp > 0 && fatAnt > 0 ? ((fatCmp - fatAnt) / fatAnt) * 100 : null,
    };
  }, [linhasTabela]);

  const pageSize = TABLE_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(linhasTabela.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = printing ? linhasTabela : linhasTabela.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  useEffect(() => {
    setPage(1);
  }, [busca, sortKey, sortDir, escopo, turnoSel]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "nome" ? "asc" : "desc");
    }
  }

  const exportar = useExportPdf("Equipe", view.turnoFiltro);
  const { abrir: abrirPessoa, modal: pessoaModal } = useTeamMemberDetail({ escopo, data: aggs, turno: view.turnoFiltro, niveisMeta });
  const teclaAbre = (p: TeamMemberRow) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      abrirPessoa(p.key, p.nome);
    }
  };
  const tipVariacao = `Faturamento ${tipRelacao(view.vsVariacao).replace(/^Em/, "em").replace(/\.$/, "")}.`;
  const tipVariacaoTotal = `Faturamento total das pessoas do filtro ${tipRelacao(view.vsVariacao).replace(/^Em/, "em").replace(/\.$/, "")}.`;
  const temVendasEquipe = view.pessoas.length > 0;
  const podeConfigurar = PODE_CONFIGURAR_LOJA.has(session.role);
  const rankPorKey = new Map(view.pessoas.map((p, i) => [p.key, i]));
  const podio: RankingRow[] = view.pessoas.slice(0, 3).map((p, i) => ({
    posicao: i + 1,
    colaboradorId: p.key,
    nome: p.nome,
    vendas: p.vendas,
    faturamento: p.faturamento,
  }));

  return (
    <div className="flex flex-col p-4 sm:p-6 print:p-0">
      <ReportHeader filtros={view.turnosDisponiveis.length > 0 ? [{ label: "Grupo", valor: view.turnoFiltro ?? "Todos os grupos" }] : []} />
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
                displayLabel={periodDisplayLabel(escopo.periodo)}
                activePresetId={periodActivePresetId(escopo.periodo)}
                minDate={pickerMinDate(coverageFrom, monthFill)}
              />
              {view.turnosDisponiveis.length > 0 && (
                <HeaderFilter
                  label="Grupo"
                  value={view.turnoFiltro ?? ""}
                  onChange={(v) => setTurnoSel(v || null)}
                  options={[{ value: "", label: "Todos os grupos" }, ...view.turnosDisponiveis.map((t) => ({ value: t, label: t }))]}
                />
              )}
              <Button variant="primary" onClick={exportar}>
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
      <StoreHoursNotice />

      {showSkeleton ? (
        <TeamSkeleton />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {view.kpis.map((kpi, i) => {
              const c = KPI_COLORS[i % KPI_COLORS.length]!;
              const Icon = KPI_ICONS[i] ?? IconFat;
              return (
                <StatCard
                  key={kpi.label}
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
            })}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Faturamento por turno */}
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle>Faturamento por grupo</CardTitle>
              </CardHeader>
              {!temVendasEquipe ? (
                <EmptyBlock />
              ) : !view.turnosConfigurados ? (
                <EmptyBlock
                  icon="👥"
                  title="Grupos não configurados"
                  description="Cadastre os grupos das lojas e vincule a equipe para comparar o desempenho por grupo."
                  action={
                    podeConfigurar ? (
                      <Button size="sm" onClick={() => navigate(paths.operation.groups)}>
                        Configurar grupos
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                (() => {
                  const total = view.turnos.reduce((s, t) => s + t.faturamento, 0) || 1;
                  let corIdx = 0;
                  const cores = view.turnos.map((t) => (t.nome === TEAM_SEM_TURNO ? COR_NEUTRA : CORES_TURNO[corIdx++ % CORES_TURNO.length]!));
                  return (
                    <div className="flex flex-1 flex-col justify-center px-4 pb-4">
                      <div className="mx-auto my-2">
                        <DonutChart
                          segments={view.turnos.map((t, i) => ({ label: partesTurno(t.nome === TEAM_SEM_TURNO ? undefined : t.nome).nome, value: t.faturamento, color: cores[i]! }))}
                          centerLabel="Total"
                          centerValue={brlCent(total)}
                        />
                      </div>
                      <div className="mt-2 flex flex-col gap-2.5">
                        {view.turnos.map((t, i) => {
                          const pct = Math.round((t.faturamento / total) * 100);
                          const pt = partesTurno(t.nome === TEAM_SEM_TURNO ? undefined : t.nome);
                          return (
                            <div key={t.nome} className="flex items-start gap-2.5">
                              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: cores[i] }} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                  <span className="min-w-0 truncate text-[12.5px] font-semibold text-t1">{pt.nome}</span>
                                  <span className="ml-auto shrink-0 font-mono text-[12.5px] font-bold text-t0">{brlCent(t.faturamento)}</span>
                                  <span className="min-w-[32px] shrink-0 text-right text-[11.5px] font-semibold text-t2">{pct}%</span>
                                </div>
                                <p className="mt-0.5 text-[11.5px] text-t2">
                                  {pt.horario ? `${pt.horario} · ` : ""}
                                  {t.pessoas} {t.pessoas === 1 ? "pessoa" : "pessoas"}
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
                  <TipHelp label="Mostra quanto do faturamento foi atribuído à equipe e quanto veio de vendas sem vendedor identificado ou realizadas pela gerência." />
                </div>
              </CardHeader>
              {view.composicao.total <= 0 ? (
                <EmptyBlock />
              ) : (
                (() => {
                  const { equipe, fora, total, turno } = view.composicao;
                  const fatias = (
                    turno != null && view.turnoFiltro
                      ? [
                          { nome: view.turnoFiltro, valor: turno, cor: "var(--acc)" },
                          { nome: "Demais da equipe", valor: Math.max(0, equipe - turno), cor: "var(--info)" },
                          { nome: "Sem vendedor identificado ou gerência", valor: fora, cor: COR_NEUTRA },
                        ]
                      : [
                          { nome: "Equipe de vendas", valor: equipe, cor: "var(--acc)" },
                          { nome: "Sem vendedor identificado ou gerência", valor: fora, cor: COR_NEUTRA },
                        ]
                  ).filter((f) => f.valor > 0);
                  return (
                    <div className="flex flex-1 flex-col justify-center px-4 pb-4">
                      <div className="mx-auto my-2">
                        <DonutChart
                          segments={fatias.map((f) => ({ label: labelUpper(f.nome), value: f.valor, color: f.cor }))}
                          centerLabel="Total"
                          centerValue={brlCent(total)}
                        />
                      </div>
                      <div className="mt-2 flex flex-col gap-2">
                        {fatias.map((f) => (
                          <div key={f.nome} className="flex items-center gap-2.5">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: f.cor }} />
                            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-t1">{labelUpper(f.nome)}</span>
                            <span className="shrink-0 font-mono text-[12.5px] font-bold text-t0">{brlCent(f.valor)}</span>
                            <span className="min-w-[32px] shrink-0 text-right text-[11.5px] font-semibold text-t2">
                              {Math.round((f.valor / total) * 100)}%
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

          {/* Desempenho da equipe  -  abas Ranking  |  Desafios  |  Metas (mesmo card do Ao vivo) */}
          <Card className="mt-4 min-w-0 overflow-hidden" padding="lg">
            <div className="mb-4 flex items-center gap-1.5">
              <CardTitle>Desempenho da equipe</CardTitle>
              <TipHelp label={"Acompanhe ranking, desafios e metas da equipe no período.\n\nVendas sem vendedor identificado ou realizadas pela gerência não entram no ranking."} />
            </div>
            {printing ? (
              !temVendasEquipe ? <EmptyBlock /> : abaRanking()
            ) : (
            <Tabs
              variant="accent"
              defaultKey="ranking"
              items={[
                {
                  key: "ranking",
                  label: "Ranking",
                  icon: <TrophyIcon size={14} />,
                  content: !temVendasEquipe ? <EmptyBlock /> : abaRanking(),
                },
                {
                  key: "desafios",
                  label: "Desafios",
                  icon: <FlameIcon size={14} />,
                  content:
                    desafioCards.length > 0 ? (
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {desafioCards.map(({ challenge, view: desafio, lojaNome }) => (
                          <ChallengeMiniCard
                            key={challenge.id}
                            challenge={challenge}
                            view={desafio}
                            lojaNome={mostraLojaDesafio ? lojaNome : undefined}
                            onOpen={() => navigate(paths.management.challengeDetail(challenge.id))}
                          />
                        ))}
                      </div>
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
                {
                  key: "metas",
                  label: "Metas",
                  icon: <TargetIcon size={14} />,
                  content:
                    metaCards.length > 0 ? (
                      <div className="flex flex-col gap-4">
                        {metaCards.map((card) => (
                          <GoalCard key={card.id} card={card} metaAtiva hojeIso={hojeIso} />
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
              ]}
            />
            )}
          </Card>
        </>
      )}

      {pessoaModal}
    </div>
  );

  function abaRanking() {
    return (
      <div className="flex flex-col">
        <RankingBlock ranking={podio} formatValor={brlCent} onSelect={(r) => abrirPessoa(r.colaboradorId, r.nome)} />

        <div className="mt-6 mb-4 flex flex-wrap items-center gap-2 sm:justify-end print:hidden">
          <input
            type="search"
            placeholder="Buscar por nome…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className={cn(filtroInputClass, "sm:w-56")}
          />
        </div>

        {linhasTabela.length === 0 ? (
          <SemResultado temDados={temVendasEquipe} onLimpar={() => setBusca("")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
                  <th className="px-1 pb-3 text-left font-bold">#</th>
                  <ThSort label="Nome" active={sortKey === "nome"} dir={sortDir} onClick={() => toggleSort("nome")} align="left" className="px-1 pb-3" />
                  <th className="px-1 pb-3 text-left font-bold">Grupo</th>
                  <ThSort label="Faturamento" active={sortKey === "faturamento"} dir={sortDir} onClick={() => toggleSort("faturamento")} className="px-1 pb-3" />
                  <ThSort label="Nº de vendas" active={sortKey === "vendas"} dir={sortDir} onClick={() => toggleSort("vendas")} className="px-1 pb-3" />
                  <ThSort label="Ticket médio" active={sortKey === "averageTicket"} dir={sortDir} onClick={() => toggleSort("averageTicket")} className="px-1 pb-3" />
                  <ThSort label="P.A." active={sortKey === "pa"} dir={sortDir} onClick={() => toggleSort("pa")} className="px-1 pb-3" />
                  <ThSort label="Participação" active={sortKey === "participacaoPct"} dir={sortDir} onClick={() => toggleSort("participacaoPct")} className="px-1 pb-3" />
                  <ThSort label="Variação" active={sortKey === "variacaoPct"} dir={sortDir} onClick={() => toggleSort("variacaoPct")} className="px-1 pb-3" />
                  {temColunaMeta && <th className="pb-3 pl-5 pr-1 text-left font-bold">Nível da meta</th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => {
                  const rank = rankPorKey.get(p.key) ?? 0;
                  const turno = partesTurno(p.turno);
                  const loja = view.multiLoja ? rotuloLojas(p.lojas) : null;
                  return (
                    <tr
                      key={p.key}
                      tabIndex={0}
                      onClick={() => abrirPessoa(p.key, p.nome)}
                      onKeyDown={teclaAbre(p)}
                      className="cursor-pointer border-b border-line transition-colors hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none"
                    >
                      <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{rank + 1}</td>
                      <td className="px-1 py-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <AvatarIniciais nome={p.nome} idx={rank} />
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-bold text-t0">{p.nome}</p>
                            {loja &&
                              (p.lojas.length > 1 ? (
                                <Tooltip label={p.lojas.slice(1).join(" · ")}>
                                  <p className="truncate text-[11px] text-t2">{loja}</p>
                                </Tooltip>
                              ) : (
                                <p className="truncate text-[11px] text-t2">{loja}</p>
                              ))}
                          </div>
                        </div>
                      </td>
                      <td className="px-1 py-3">
                        <p className={cn("text-[12.5px] font-semibold", p.turno ? "text-t1" : "text-t2")}>{turno.nome}</p>
                        {turno.horario && <p className="text-[11px] text-t2">{turno.horario}</p>}
                      </td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(p.faturamento)}</td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{num(p.vendas)}</td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(p.averageTicket)}</td>
                      <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", p.pa == null ? "text-t2" : "text-t0")}>{paFmt(p.pa)}</td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{pctFmt(p.participacaoPct)}</td>
                      <td className="px-1 py-3 text-right font-mono text-[13px]">
                        <Tooltip label={tipVariacao}>
                          <span>
                            <Variacao v={p.variacaoPct} />
                          </span>
                        </Tooltip>
                      </td>
                      {temColunaMeta && <CelulaNivelMeta nivel={niveisMeta.get(p.key)} completo={!printing} />}
                    </tr>
                  );
                })}
                <tr className="bg-bg-inset">
                  <td />
                  <td className="px-1 py-3 text-[13px] font-extrabold text-t0" colSpan={2}>
                    <span className="inline-flex items-center gap-1">
                      Total do filtro
                      <TipHelp label="Soma todas as pessoas encontradas no filtro, inclusive as que não aparecem nesta página." />
                    </span>
                    <span className="mt-0.5 block text-[11px] font-semibold text-t2">
                      {num(linhasTabela.length)} {linhasTabela.length === 1 ? "pessoa" : "pessoas"}
                    </span>
                  </td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{brlCent(totalTabela.faturamento)}</td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{num(totalTabela.vendas)}</td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{brlCent(totalTabela.averageTicket)}</td>
                  <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-extrabold", totalTabela.pa == null ? "text-t2" : "text-t0")}>
                    {paFmt(totalTabela.pa)}
                  </td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{pctFmt(totalTabela.participacaoPct)}</td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold">
                    <Tooltip label={tipVariacaoTotal}>
                      <span>
                        <Variacao v={totalTabela.variacaoPct} />
                      </span>
                    </Tooltip>
                  </td>
                  {temColunaMeta && <td />}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {linhasTabela.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
            <span className="text-[12.5px] text-t2">
              Mostrando {pageRows.length} de {num(linhasTabela.length)} pessoas
            </span>
            {totalPages > 1 && <Pagination page={pageSafe} totalPages={totalPages} onChange={setPage} />}
          </div>
        )}
      </div>
    );
  }
}

/** Barra da meta da pessoa com os niveis (N1  |  nome (premiacao %)); sem meta = " - ". */
function CelulaNivelMeta({ nivel, completo }: { nivel?: SellerGoalLevel; completo: boolean }) {
  if (!nivel) return <td className="py-3 pl-5 pr-1 text-[13px] text-t2">—</td>;
  return (
    <td className="py-3 pl-5 pr-1 align-middle">
      <GoalLevelSummary pct={nivel.atingimentoPct} nivel={nivel.nivel} nivelNumero={nivel.nivelNumero} marcos={nivel.marcos} completo={completo} />
    </td>
  );
}

function SemResultado({ temDados, onLimpar }: { temDados: boolean; onLimpar: () => void }) {
  if (!temDados) return <EmptyBlock />;
  return (
    <EmptyBlock
      icon="🔍"
      title="Nenhuma pessoa encontrada"
      description="Tente buscar por outro nome."
      action={
        <Button variant="outline" size="sm" onClick={onLimpar}>
          Limpar busca
        </Button>
      }
    />
  );
}

