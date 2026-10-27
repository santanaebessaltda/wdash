import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, DateRangePicker, Modal, ProgressBar, ProgressStanding, progressTextClass, useToast } from "@/components/ui";
import { PersonAvatarGroup } from "@/components/wedash/PersonAvatar";
import { BranchBadge, PeriodBadge, RecordStatusBadge, UnidentifiedSalesBadge } from "@/components/wedash/RecordBadges";
import { Tooltip } from "@/components/ui/Tooltip";
import type { DateRange, DateRangeChangeMeta } from "@/components/ui/DateRangePicker";
import { DuplicateChoiceModal } from "@/components/wedash/DuplicateChoiceModal";
import { GoalCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { calendarTodayIso } from "@/data/wedash/clock";
import { goalWeightFrom } from "@/data/wedash/engine/goalProjection";
import { effectiveWeekHours } from "@/data/wedash/storeHours";
import { buildGoalSummary, GOAL_STATUS_LABEL, goalLevelAmount, goalLevelPct, goalSpreadsUnidentified, prazoRemaining, type GoalStatus, type GoalSummary } from "@/data/wedash/goalView";
import { deleteGoal, fetchGoalTeam, fetchGoals, type GoalRecord, type GoalTeamMember } from "@/data/wedash/goalsRepo";
import { isDraft, publishDraftsInWindow, publishNotice, enqueuePlanNotice } from "@/data/wedash/planNotice";
import { fetchSalesDayAggs } from "@/data/wedash/salesRepo";
import type { SalesDayAgg } from "@/data/wedash/salesTypes";
import { storesForSession, type Store } from "@/data/wedash/stores";
import { brlCent, fullDate, endOfMonth, num, dateToIso, isoToDate } from "@/lib/format";
import { filterCacheGet, filterCacheSet } from "@/lib/filterCache";
import { useFilterSkeleton } from "@/lib/useFilterSkeleton";
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
import { isOwner } from "@/layout/nav-wedash";
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
  const manage = isOwner(session.role);
  const { scope, setScope } = useScope();
  const today = calendarTodayIso();
  const janela = useMemo(() => managementScheduleWindow(scope.period, today), [scope.period, today]);
  const storeIds = useMemo(() => storeRows.map((l) => l.id), [storeRows]);
  const storeKey = storeIds.join(",");

  const [data, setData] = useState<Loaded | null>(null);
  const [reload, setReload] = useState(0);
  const [confirm, setConfirm] = useState<GoalRecord | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [duplicate, setDuplicate] = useState<GoalRecord | null>(null);
  const [publishing, setPublishing] = useState(false);
  const hasOtherStores = storesForSession(session.stores).length > 1;
  const filterKey = `goals:${session.tenantId}:${storeKey}:${janela.from}:${janela.to}`;
  const { showSkeleton: filterSkeleton, settle } = useFilterSkeleton(filterKey);
  const reloadGen = useRef(0);

  useEffect(() => {
    const onSync = () => setReload((n) => n + 1);
    window.addEventListener(SALES_SYNCED_EVENT, onSync);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSync);
  }, []);

  useEffect(() => {
    if (storesLoading) return;
    const gen = ++reloadGen.current;
    const key = filterKey;
    const cached = filterCacheGet<Loaded>(key);
    if (cached && Array.isArray(cached.goals) && Array.isArray(cached.dayAggs) && Array.isArray(cached.team)) {
      setData(cached);
      settle(key);
    }
    let cancelled = false;
    void (async () => {
      try {
        const goals = await fetchGoals({ tenantId: session.tenantId, storeIds, from: janela.from, to: janela.to, includeDrafts: true });
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
        if (cancelled || gen !== reloadGen.current) return;
        const loaded = { goals, dayAggs, team };
        filterCacheSet(key, loaded);
        setData(loaded);
        settle(key);
      } catch (e) {
        if (cancelled || gen !== reloadGen.current) return;
        console.warn("GoalsPage:", e);
        if (!(cached && Array.isArray(cached.goals))) {
          setData({ goals: [], dayAggs: [], team: [] });
          settle(key);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.tenantId, storeKey, janela.from, janela.to, storesLoading, reload, filterKey, settle, storeIds, today]);

  const showSkeleton = storesLoading || filterSkeleton;

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
          (isDraft(a.summary.goal.published) ? 0 : 1) - (isDraft(b.summary.goal.published) ? 0 : 1) ||
          STATUS_ORDER[a.summary.status] - STATUS_ORDER[b.summary.status] ||
          b.summary.goal.startsOn.localeCompare(a.summary.goal.startsOn) ||
          (a.store?.tradeName ?? "").localeCompare(b.store?.tradeName ?? "", "pt-BR"),
      );
  }, [data, storeRows, today]);

  const dateRange = useMemo(() => dateRangeFromManagementPeriod(scope.period), [scope.period]);
  function onDateChange(r: DateRange, goal?: DateRangeChangeMeta) {
    setScope(applyPeriodDateChange(scope, r, goal));
  }

  async function publishWindow() {
    setPublishing(true);
    const res = await publishDraftsInWindow({
      tenantId: session.tenantId,
      storeIds,
      from: janela.from,
      to: janela.to,
      storeName: (storeId) => storeRows.find((store) => store.id === storeId)?.tradeName ?? "Filial",
    });
    setPublishing(false);
    if (!res.ok) {
      show("Não foi possível publicar. Tente novamente.", "danger");
      return;
    }
    show(res.count === 0 ? "Nenhum rascunho neste período." : "Rascunhos publicados.", "success");
    setReload((n) => n + 1);
  }

  async function publishOne(goal: GoalRecord) {
    const storeName = storeRows.find((store) => store.id === goal.storeId)?.tradeName ?? "Filial";
    const { getSupabase } = await import("@/lib/supabase");
    const sb = getSupabase();
    if (!sb) return;
    const now = new Date().toISOString();
    const { data, error } = await sb.from("goal").update({ published_at: now, updated_at: now }).eq("id", goal.id).is("published_at", null).select("id");
    if (error) {
      show("Não foi possível publicar. Tente novamente.", "danger");
      return;
    }
    if (!data?.length) {
      setReload((n) => n + 1);
      return;
    }
    await enqueuePlanNotice(
      session.tenantId,
      goal.storeId,
      publishNotice([{ kind: "goal", name: goal.name, storeName, startsOn: goal.startsOn, endsOn: goal.endsOn, targetLabel: brlCent(goal.target) }]),
    );
    show("Meta publicada.", "success");
    setReload((n) => n + 1);
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
        subtitle="Gerencie metas, distribuição e premiação da equipe."
        actions={
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <DateRangePicker
              value={dateRange}
              onChange={onDateChange}
              displayLabel={periodDisplayLabel(scope.period)}
              activePresetId={periodActivePresetId(scope.period)}
              maxDate={maxPickerDate(today)}
            />
            {manage ? (
            <>
            {cards.some((card) => isDraft(card.summary.goal.published)) ? (
              <Button variant="outline" onClick={() => void publishWindow()} disabled={publishing}>
                {publishing ? "Publicando…" : "Publicar rascunhos"}
              </Button>
            ) : null}
            <Button icon={<Icon d={icons.plus} size={14} />} onClick={() => navigate(paths.goalNew)}>
              Nova meta
            </Button>
            </>
            ) : null}
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
              description={manage ? "Cadastre uma meta para acompanhar o atingimento e a premiação da equipe." : "Quando houver uma meta neste período, ela aparece aqui."}
              action={
                manage ? (
                <Button size="sm" onClick={() => navigate(paths.goalNew)}>
                  Criar meta
                </Button>
                ) : undefined
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
                manage={manage}
                onCopy={() => setDuplicate(summary.goal)}
                onDelete={() => setConfirm(summary.goal)}
                onPublish={() => void publishOne(summary.goal)}
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
  manage,
  onCopy,
  onDelete,
  onPublish,
}: {
  summary: GoalSummary;
  store: Store | undefined;
  showsStore: boolean;
  team: { name: string; employeeId: number; storeId: string }[];
  onDetail: () => void;
  manage: boolean;
  onCopy: () => void;
  onDelete: () => void;
  onPublish: () => void;
}) {
  const { goal: g, status, achieved, pct, projectedPct, daysRemaining, currentLevel, levelNumber } = summary;
  const levels = g.tiers.map((tier) => tier.minAttainmentPct);
  const storeGoal = goalLevelAmount(g.target, levels);
  const levelPct = goalLevelPct(pct, levels);
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
          : pct < 100
            ? ""
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
            <RecordStatusBadge label={isDraft(g.published) ? "Rascunho" : GOAL_STATUS_LABEL[status]} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <PeriodBadge from={g.startsOn} to={g.endsOn} />
            {showsStore && store ? <BranchBadge name={store.tradeName} /> : null}
            {goalSpreadsUnidentified(g) ? <UnidentifiedSalesBadge /> : null}
          </div>
        </div>
        {manage ? (
        <div className="flex shrink-0 items-center gap-1.5 self-start">
          {isDraft(g.published) ? (
            <Tooltip label="Publicar meta">
              <button
                type="button"
                onClick={action(onPublish)}
                aria-label="Publicar meta"
                className="inline-flex h-7 items-center rounded-lg px-2 text-[12px] font-bold text-acc hover:bg-acc-soft"
              >
                Publicar
              </button>
            </Tooltip>
          ) : null}
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
        ) : null}
      </div>

      <div className="flex items-baseline justify-between gap-2">
        {status === "upcoming" ? (
          <span className="font-mono text-[13px] font-extrabold text-t0">{brlCent(storeGoal)}</span>
        ) : (
          <span className={`font-mono text-[13px] font-extrabold ${achieved < 0 ? "text-bad" : "text-t0"}`}>{brlCent(achieved)}</span>
        )}
        <span className="text-right text-[11.5px] text-t2">
          {status === "upcoming" ? (
            "Meta da filial"
          ) : (
            <span className="inline-flex flex-col items-end gap-0.5">
              <span>
                <span className={`font-mono font-bold ${progressTextClass(levelPct)}`}>{num(levelPct, 1)}%</span> de {brlCent(storeGoal)}
              </span>
              {status === "ended" && levelPct < 100 ? <ProgressStanding ok={false}>Não atingiu</ProgressStanding> : null}
            </span>
          )}
        </span>
      </div>
      <div className="mt-2">
        <ProgressBar value={status === "upcoming" ? 0 : levelPct} height={5} />
      </div>
      {footer ? <p className="mt-2 text-[11.5px] text-t2">{footer}</p> : null}

      <div className="flex-1" />
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="min-w-0 text-[12px] text-t2">
          {g.tiers.length} {g.tiers.length === 1 ? "nível" : "níveis"}
          <span className="mx-1.5">·</span>
          {team.length} na equipe
        </p>
        {team.length > 0 && (
          <div className="shrink-0">
            <PersonAvatarGroup people={team} max={3} />
          </div>
        )}
      </div>
    </div>
  );
}
