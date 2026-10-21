import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, DateRangePicker, Modal, ProgressBar, progressTextClass, useToast } from "@/components/ui";
import { PersonAvatarGroup } from "@/components/wedash/PersonAvatar";
import { BranchBadge, PeriodBadge, RecordStatusBadge } from "@/components/wedash/RecordBadges";
import { Tooltip } from "@/components/ui/Tooltip";
import type { DateRange, DateRangeChangeMeta } from "@/components/ui/DateRangePicker";
import { DuplicateChoiceModal } from "@/components/wedash/DuplicateChoiceModal";
import { GoalCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { calendarTodayIso } from "@/data/wedash/clock";
import { goalWeightFrom } from "@/data/wedash/engine/goalProjection";
import { effectiveWeekHours } from "@/data/wedash/storeHours";
import { buildGoalSummary, GOAL_STATUS_LABEL, prazoRemaining, type GoalStatus, type GoalSummary } from "@/data/wedash/goalView";
import { deleteGoal, fetchGoalTeam, fetchGoals, type GoalRecord, type GoalTeamMember } from "@/data/wedash/goalsRepo";
import { fetchSalesDayAggs } from "@/data/wedash/salesRepo";
import type { SalesDayAgg } from "@/data/wedash/salesTypes";
import { storesForSession, type Store } from "@/data/wedash/stores";
import { brlCent, fullDate, endOfMonth, num, dateToIso, isoToDate } from "@/lib/format";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import {
  applyPeriodDateChange,
  dateRangeFromManagementPeriod,
  managementScheduleWindow,
  periodActivePresetId,
  periodDisplayLabel,
} from "@/pages/dashboard/periodPicker";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useScope } from "@/pages/dashboard/useScope";
import { TargetIcon } from "@/pages/dashboards/icons";
import { IconCopy, IconTrash } from "@/pages/ecommerce/icons";
import { SectionHeader, useScopedStores } from "@/pages/operation/shared";
import { Icon, icons } from "@/pages/users/Icons";
import { paths } from "@/router/paths";

const STATUS_ORDER: Record<GoalStatus, number> = { active: 0, upcoming: 1, ended: 2 };

type Loaded = { goals: GoalRecord[]; dayAggs: SalesDayAgg[]; team: GoalTeamMember[] };

/** Metas podem ser cadastradas para frente: o calendario vai ate o fim do mes daqui a 12 meses. */
function maxPickerDate(today: string): Date {
  const d = isoToDate(today);
  return isoToDate(endOfMonth(dateToIso(new Date(d.getFullYear(), d.getMonth() + 12, 1))));
}

/** Performance > Metas — 1 card por meta das filiais do seletor, no período do filtro. */
export default function GoalsPage() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { session, storeRows, loading: storesLoading } = useScopedStores();
  const { scope, setScope } = useScope();
  const today = calendarTodayIso();
  const janela = useMemo(() => managementScheduleWindow(scope.period, today), [scope.period, today]);
  const storeIds = useMemo(() => storeRows.map((l) => l.id), [storeRows]);
  const storeKey = storeIds.join(",");

  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [confirm, setConfirm] = useState<GoalRecord | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [duplicate, setDuplicate] = useState<GoalRecord | null>(null);
  const hasOtherStores = storesForSession(session.stores).length > 1;

  useEffect(() => {
    const onSync = () => setReload((n) => n + 1);
    window.addEventListener(SALES_SYNCED_EVENT, onSync);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSync);
  }, []);

  const filterKey = `${session.tenantId}|${storeKey}|${janela.from}|${janela.to}`;
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    if (storesLoading) return;
    let cancelled = false;
    (async () => {
      // Venda nova (SALES_SYNCED_EVENT) recarrega sem skeleton; so filtro novo mostra o skeleton.
      if (loadedKey.current !== filterKey) setLoading(true);
      const goals = await fetchGoals({ tenantId: session.tenantId, storeIds, from: janela.from, to: janela.to });
      let dayAggs: SalesDayAgg[] = [];
      let team: GoalTeamMember[] = [];
      if (goals.length > 0) {
        const goalStores = [...new Set(goals.map((g) => g.storeId))];
        const from = goals.reduce((m, g) => (g.startsOn < m ? g.startsOn : m), goals[0].startsOn);
        const lastEnd = goals.reduce((m, g) => (g.endsOn > m ? g.endsOn : m), goals[0].endsOn);
        const to = lastEnd < today ? lastEnd : today;
        const historyFrom = goalWeightFrom(from);
        [dayAggs, team] = await Promise.all([
          historyFrom <= to
            ? fetchSalesDayAggs({ tenantId: session.tenantId, storeIds: goalStores, from: historyFrom, to, brand: "ALL" })
            : Promise.resolve([]),
          fetchGoalTeam(session.tenantId, goalStores),
        ]);
      }
      if (!cancelled) {
        setData({ goals, dayAggs, team });
        loadedKey.current = filterKey;
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.tenantId, storeKey, janela.from, janela.to, storesLoading, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const showSkeleton = useMinSkeleton(loading || storesLoading);

  const cards = useMemo(() => {
    if (!data) return [];
    const byId = new Map(storeRows.map((l) => [l.id, l]));
    return data.goals
      .map((g) => {
        const store = byId.get(g.storeId);
        return {
        summary: buildGoalSummary(g, data.dayAggs, today, store ? effectiveWeekHours(store.hours) : undefined),
        store,
        team: data.team
          .filter((m) => m.storeId === g.storeId && m.salesPerson)
          .map((m) => ({ name: m.name, employeeId: m.employeeId, storeId: m.storeId }))
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
        };
      })
      .sort(
        (a, b) =>
          STATUS_ORDER[a.summary.status] - STATUS_ORDER[b.summary.status] ||
          b.summary.goal.startsOn.localeCompare(a.summary.goal.startsOn) ||
          (a.store?.tradeName ?? "").localeCompare(b.store?.tradeName ?? "", "pt-BR"),
      );
  }, [data, storeRows, today]);

  const dateRange = useMemo(() => dateRangeFromManagementPeriod(scope.period), [scope.period]);
  function onDateChange(r: DateRange, goal?: DateRangeChangeMeta) {
    setScope(applyPeriodDateChange(scope, r, goal));
  }

  async function exclude() {
    if (!confirm) return;
    setExcluindo(true);
    const res = await deleteGoal(session.tenantId, confirm.id);
    setExcluindo(false);
    if (!res.ok) {
      show("Não foi possível excluir a meta. Tente novamente.", "danger");
      return;
    }
    setConfirm(null);
    show("Meta excluída.", "success");
    setReload((n) => n + 1);
  }

  return (
    <div>
      <SectionHeader
        section="Performance"
        title="Metas"
        subtitle="Gerencie metas, distribuição da equipe e níveis de premiação."
        actions={
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <DateRangePicker
              value={dateRange}
              onChange={onDateChange}
              displayLabel={periodDisplayLabel(scope.period)}
              activePresetId={periodActivePresetId(scope.period)}
              maxDate={maxPickerDate(today)}
            />
            <Button icon={<Icon d={icons.plus} size={14} />} onClick={() => navigate(paths.goalNew)}>
              Nova meta
            </Button>
          </div>
        }
      />

      <div className="mt-6">
        {showSkeleton ? (
          <GoalCardsSkeleton count={3} />
        ) : cards.length === 0 ? (
          <Card className="flex min-h-[280px] flex-col">
            <EmptyBlock
              icon="🎯"
              title="Nenhuma meta no período"
              description="Cadastre uma meta para acompanhar o atingimento e a premiação da equipe."
              action={
                <Button size="sm" onClick={() => navigate(paths.goalNew)}>
                  Criar meta
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map(({ summary, store, team }) => (
              <GoalCard
                key={summary.goal.id}
                summary={summary}
                store={store}
                showsStore={storeRows.length > 1}
                team={team}
                onDetail={() => navigate(paths.goalDetail(summary.goal.id))}
                onCopy={() => setDuplicate(summary.goal)}
                onDelete={() => setConfirm(summary.goal)}
              />
            ))}
          </div>
        )}
      </div>

      <DuplicateChoiceModal
        open={duplicate !== null}
        onClose={() => setDuplicate(null)}
        kind="meta"
        name={duplicate?.name ?? null}
        hasOtherStores={hasOtherStores}
        onChoose={(choice) => {
          if (!duplicate) return;
          const id = duplicate.id;
          setDuplicate(null);
          navigate(choice === "store" ? paths.goalCopyStore(id) : paths.goalCopy(id));
        }}
      />

      <Modal
        open={confirm !== null}
        onClose={() => !excluindo && setConfirm(null)}
        title="Excluir meta?"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={excluindo}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void exclude()} disabled={excluindo}>
              {excluindo ? "Excluindo…" : "Excluir meta"}
            </Button>
          </>
        }
      >
        {confirm && (
          <p className="text-[13.5px] leading-relaxed text-t1">
            A meta <span className="font-bold text-t0">{confirm.name}</span>, de {fullDate(confirm.startsOn)} a {fullDate(confirm.endsOn)}, será
            excluída. Essa ação não pode ser desfeita.
          </p>
        )}
      </Modal>
    </div>
  );
}

function GoalCard({
  summary,
  store,
  showsStore,
  team,
  onDetail,
  onCopy,
  onDelete,
}: {
  summary: GoalSummary;
  store: Store | undefined;
  showsStore: boolean;
  team: { name: string; employeeId: number; storeId: string }[];
  onDetail: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const { goal: g, status, achieved, pct, projectedPct, daysRemaining, currentLevel, levelNumber } = summary;
  const prazo = prazoRemaining(daysRemaining);
  const footer =
    status === "active"
      ? projectedPct != null
        ? `Projeção: ${num(projectedPct, 0)}% · ${prazo.toLowerCase()}`
        : prazo
      : status === "upcoming"
        ? `Começa em ${fullDate(g.startsOn)}`
        : currentLevel
          ? `Nível final: N${levelNumber} · ${currentLevel}`
          : "Nenhum nível atingido";

  const action = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`Ver detalhe da meta ${g.name}`}
      onClick={onDetail}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDetail();
        }
      }}
      className="flex cursor-pointer flex-col rounded-2xl border border-line bg-bg-2 p-5 shadow-[var(--shadow-vela)] transition-colors hover:border-line-2 focus-visible:border-acc focus-visible:outline-none"
    >
      <div className="mb-3.5 flex items-start gap-3.5">
        <div className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-[14px] bg-acc-soft text-acc">
          <TargetIcon size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 truncate text-[15px] font-bold text-t0">{g.name}</p>
            <RecordStatusBadge label={GOAL_STATUS_LABEL[status]} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <PeriodBadge from={g.startsOn} to={g.endsOn} />
            {showsStore && store ? <BranchBadge name={store.tradeName} /> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 self-start">
          <Tooltip label="Duplicar meta">
            <button
              type="button"
              onClick={action(onCopy)}
              aria-label="Duplicar meta"
              className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-line text-t1 transition-colors hover:bg-bg-3 hover:text-t0"
            >
              <IconCopy width={14} height={14} />
            </button>
          </Tooltip>
          <Tooltip label="Excluir meta">
            <button
              type="button"
              onClick={action(onDelete)}
              aria-label="Excluir meta"
              className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-line text-bad transition-colors hover:bg-bad-soft"
            >
              <IconTrash width={14} height={14} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        {status === "upcoming" ? (
          <span className="font-mono text-[13px] font-extrabold text-t0">{brlCent(g.target)}</span>
        ) : (
          <span className="font-mono text-[13px] font-extrabold text-ok">{brlCent(achieved)}</span>
        )}
        <span className="text-right text-[11.5px] text-t2">
          {status === "upcoming" ? (
            "Meta da filial"
          ) : (
            <>
              <span className={`font-mono font-bold ${progressTextClass(pct)}`}>{num(pct, 1)}%</span> de {brlCent(g.target)}
            </>
          )}
        </span>
      </div>
      <div className="mt-2">
        <ProgressBar value={status === "upcoming" ? 0 : pct} height={5} />
      </div>
      <p className="mt-2 text-[11.5px] text-t2">{footer}</p>

      <div className="flex-1" />
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          <Badge variant="neutral" className="uppercase">{g.tierMode === "INDIVIDUAL" ? "Individual" : g.tierMode === "GENERAL" ? "Geral" : "Grupo"}</Badge>
          <Badge variant="neutral" className="uppercase">
            {g.tiers.length} {g.tiers.length === 1 ? "nível" : "níveis"}
          </Badge>
          <Badge variant="neutral" className="uppercase">{team.length} na equipe</Badge>
        </div>
        {team.length > 0 && (
          <div className="shrink-0">
            <PersonAvatarGroup people={team} max={3} />
          </div>
        )}
      </div>
    </div>
  );
}
