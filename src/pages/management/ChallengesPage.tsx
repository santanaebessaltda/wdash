import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, DateRangePicker, Modal, useToast } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import type { DateRange, DateRangeChangeMeta } from "@/components/ui/DateRangePicker";
import { DuplicateChoiceModal } from "@/components/wedash/DuplicateChoiceModal";
import { ChallengeCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import {
  deleteChallenge,
  emptyChallengeAggInput,
  fetchChallengeInput,
  fetchChallenges,
  type ChallengeAggInput,
  type ChallengeRecord,
} from "@/data/wedash/challengesRepo";
import {
  buildChallengeView,
  CHALLENGE_METRIC_LABEL,
  CHALLENGE_MODE_LABEL,
  CHALLENGE_STATUS_LABEL,
  type ChallengeStatus,
  type ChallengeView,
} from "@/data/wedash/challengeView";
import { calendarTodayIso } from "@/data/wedash/clock";
import { storesForSession, type Store } from "@/data/wedash/stores";
import { BranchBadge, DeadlineBadge, PeriodBadge, PrizeBadge, RecordStatusBadge } from "@/components/wedash/RecordBadges";
import { cn } from "@/lib/cn";
import { fullDate, isoToDate, endOfMonth, dateToIso } from "@/lib/format";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import {
  CHALLENGE_STATUS_ORDER,
  challengeHeadline,
  challengeMinimumLabel,
  HeadlineText,
  mainPrizeLabel,
} from "@/pages/challenges/shared";
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
import { FlameIcon } from "@/pages/dashboards/icons";
import { IconCopy, IconTrash } from "@/pages/ecommerce/icons";
import { SectionHeader, useScopedStores } from "@/pages/operation/shared";
import { Icon, icons } from "@/pages/users/Icons";
import { paths } from "@/router/paths";

type Loaded = { challenges: ChallengeRecord[]; aggs: ChallengeAggInput };

/** Desafios podem ser cadastrados para frente: o calendario vai ate o fim do mes daqui a 12 meses. */
function maxPickerDate(today: string): Date {
  const d = isoToDate(today);
  return isoToDate(endOfMonth(dateToIso(new Date(d.getFullYear(), d.getMonth() + 12, 1))));
}

/** Performance > Desafios — 1 card por desafio das filiais do seletor, no período do filtro. */
export function ChallengesPage() {
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
  const [confirm, setConfirm] = useState<ChallengeRecord | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [duplicate, setDuplicate] = useState<ChallengeRecord | null>(null);
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
      const challenges = await fetchChallenges({ tenantId: session.tenantId, storeIds, from: janela.from, to: janela.to });
      const aggs =
        challenges.length > 0
          ? await fetchChallengeInput({ tenantId: session.tenantId, challenges, today })
          : emptyChallengeAggInput();
      if (!cancelled) {
        setData({ challenges, aggs });
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
    return data.challenges
      .map((c) => ({ challenge: c, view: buildChallengeView({ challenge: c, aggs: data.aggs, today }), store: byId.get(c.storeId) }))
      .sort(
        (a, b) =>
          CHALLENGE_STATUS_ORDER[a.view.status] - CHALLENGE_STATUS_ORDER[b.view.status] ||
          (a.view.status === "ended"
            ? b.challenge.endsOn.localeCompare(a.challenge.endsOn)
            : a.challenge.startsOn.localeCompare(b.challenge.startsOn)) ||
          (a.store?.tradeName ?? "").localeCompare(b.store?.tradeName ?? "", "pt-BR") ||
          a.challenge.name.localeCompare(b.challenge.name, "pt-BR"),
      );
  }, [data, storeRows, today]);

  const dateRange = useMemo(() => dateRangeFromManagementPeriod(scope.period), [scope.period]);
  const statusSections = useMemo(() => {
    const titles: Record<ChallengeStatus, string> = {
      active: "Em andamento",
      upcoming: "A começar",
      ended: "Encerrados",
    };
    const present = (["active", "upcoming", "ended"] as const).filter((status) =>
      cards.some((card) => card.view.status === status),
    );
    return { titles, present, split: present.length > 1 };
  }, [cards]);

  function onDateChange(r: DateRange, goal?: DateRangeChangeMeta) {
    setScope(applyPeriodDateChange(scope, r, goal));
  }

  async function exclude() {
    if (!confirm) return;
    setExcluindo(true);
    const res = await deleteChallenge(session.tenantId, confirm.id);
    setExcluindo(false);
    if (!res.ok) {
      show("Não foi possível excluir o desafio. Tente novamente.", "danger");
      return;
    }
    setConfirm(null);
    show("Desafio excluído.", "success");
    setReload((n) => n + 1);
  }

  return (
    <div>
      <SectionHeader
        section="Performance"
        title="Desafios"
        subtitle="Crie desafios de curto prazo para engajar a equipe e acompanhar resultados."
        actions={
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <DateRangePicker
              value={dateRange}
              onChange={onDateChange}
              displayLabel={periodDisplayLabel(scope.period)}
              activePresetId={periodActivePresetId(scope.period)}
              maxDate={maxPickerDate(today)}
            />
            <Button icon={<Icon d={icons.plus} size={14} />} onClick={() => navigate(paths.management.challengeNew)}>
              Novo desafio
            </Button>
          </div>
        }
      />

      <div className="mt-6">
        {showSkeleton ? (
          <ChallengeCardsSkeleton count={3} />
        ) : cards.length === 0 ? (
          <Card className="flex min-h-[280px] flex-col">
            <EmptyBlock
              icon="🔥"
              title="Nenhum desafio no período"
              description="Crie um desafio para engajar a equipe e acompanhar resultados em um período curto."
              action={
                <Button size="sm" onClick={() => navigate(paths.management.challengeNew)}>
                  Criar desafio
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            {statusSections.present.map((status) => (
              <div key={status}>
                {statusSections.split && (
                  <p className="mb-3 text-[12px] font-bold uppercase tracking-wide text-t2">
                    {statusSections.titles[status]}
                  </p>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {cards
                    .filter((card) => card.view.status === status)
                    .map(({ challenge, view, store }) => (
                      <ChallengeCard
                        key={challenge.id}
                        challenge={challenge}
                        view={view}
                        store={store}
                        showsStore={storeRows.length > 1}
                        onDetail={() => navigate(paths.management.challengeDetail(challenge.id))}
                        onCopy={() => setDuplicate(challenge)}
                        onDelete={() => setConfirm(challenge)}
                      />
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <DuplicateChoiceModal
        open={duplicate !== null}
        onClose={() => setDuplicate(null)}
        kind="desafio"
        name={duplicate?.name ?? null}
        hasOtherStores={hasOtherStores}
        onChoose={(choice) => {
          if (!duplicate) return;
          const id = duplicate.id;
          setDuplicate(null);
          navigate(choice === "store" ? paths.management.challengeCopyStore(id) : paths.management.challengeCopy(id));
        }}
      />

      <Modal
        open={confirm !== null}
        onClose={() => !excluindo && setConfirm(null)}
        title="Excluir desafio?"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={excluindo}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void exclude()} disabled={excluindo}>
              {excluindo ? "Excluindo…" : "Excluir desafio"}
            </Button>
          </>
        }
      >
        {confirm && (
          <p className="text-[13.5px] leading-relaxed text-t1">
            O desafio <span className="font-bold text-t0">{confirm.name}</span>, de {fullDate(confirm.startsOn)} a{" "}
            {fullDate(confirm.endsOn)}, será excluído. Essa ação não pode ser desfeita.
          </p>
        )}
      </Modal>
    </div>
  );
}

function ChallengeCard({
  challenge: c,
  view,
  store,
  showsStore,
  onDetail,
  onCopy,
  onDelete,
}: {
  challenge: ChallengeRecord;
  view: ChallengeView;
  store: Store | undefined;
  showsStore: boolean;
  onDetail: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const destaque = challengeHeadline(c, view);
  const prize = mainPrizeLabel(c);
  const minimum = challengeMinimumLabel(c);
  const reached = c.mode === "MINIMUM" && view.status !== "upcoming" ? destaque.value : null;
  const ended = view.status === "ended";
  const statusLabel = CHALLENGE_STATUS_LABEL[view.status];

  const action = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`Ver detalhe do desafio ${c.name}`}
      onClick={onDetail}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDetail();
        }
      }}
      className={cn(
        "flex cursor-pointer flex-col rounded-2xl border border-line p-5 shadow-[var(--shadow-vela)] transition-colors hover:border-line-2 focus-visible:border-acc focus-visible:outline-none",
        ended ? "bg-bg-inset" : "bg-bg-2",
      )}
    >
      <div className="mb-3.5 flex items-start gap-3.5">
        <div
          className={cn(
            "flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-[14px]",
            ended ? "bg-bg-3 text-t2" : "bg-acc-soft text-acc",
          )}
        >
          <FlameIcon size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 truncate text-[15px] font-bold text-t0">{c.name}</p>
            <RecordStatusBadge label={statusLabel} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <PeriodBadge from={c.startsOn} to={c.endsOn} />
            {showsStore && store ? <BranchBadge name={store.tradeName} /> : null}
            {prize ? <PrizeBadge label={prize} /> : null}
            {minimum ? (
              <Badge variant="neutral" className="uppercase">
                {minimum}
              </Badge>
            ) : null}
          </div>
          {!ended || reached ? (
            <div className="mt-2 flex w-full flex-wrap items-center justify-end gap-1.5">
              {reached ? (
                <Badge variant="accent" className="uppercase">
                  {reached}
                </Badge>
              ) : null}
              {!ended ? <DeadlineBadge label={view.prazo} /> : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 self-start">
          <Tooltip label="Duplicar desafio">
            <button
              type="button"
              onClick={action(onCopy)}
              aria-label="Duplicar desafio"
              className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-line text-t1 transition-colors hover:bg-bg-3 hover:text-t0"
            >
              <IconCopy width={14} height={14} />
            </button>
          </Tooltip>
          <Tooltip label="Excluir desafio">
            <button
              type="button"
              onClick={action(onDelete)}
              aria-label="Excluir desafio"
              className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-line text-bad transition-colors hover:bg-bad-soft"
            >
              <IconTrash width={14} height={14} />
            </button>
          </Tooltip>
        </div>
      </div>

      {c.mode === "CONTEST" ? (
        <p className="min-w-0 truncate text-[13px] text-t1">
          <HeadlineText headline={destaque} />
        </p>
      ) : null}

      <div className="flex-1" />
      <div className="mt-4 flex flex-wrap gap-1.5">
        <Badge variant="neutral" className="uppercase">
          {CHALLENGE_METRIC_LABEL[c.metric]}
        </Badge>
        <Badge variant="neutral" className="uppercase">
          {CHALLENGE_MODE_LABEL[c.mode]}
        </Badge>
      </div>
    </div>
  );
}

export default ChallengesPage;
