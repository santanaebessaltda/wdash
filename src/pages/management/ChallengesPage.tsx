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
  type ChallengeView,
} from "@/data/wedash/challengeView";
import { calendarTodayIso } from "@/data/wedash/clock";
import { resolvePeriod } from "@/data/wedash/dashboard";
import { storesForSession, type Store } from "@/data/wedash/stores";
import { dataCompleta, deIso, fimDoMes, paraIso } from "@/lib/format";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import {
  CHALLENGE_STATUS_ORDER,
  CHALLENGE_STATUS_VARIANT,
  challengeHeadline,
  HeadlineText,
  mainPrizeLabel,
} from "@/pages/challenges/shared";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { applyPeriodDateChange, dateRangeFromPeriod, periodActivePresetId, periodDisplayLabel } from "@/pages/dashboard/periodPicker";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useScope } from "@/pages/dashboard/useScope";
import { FlameIcon, TrophyIcon } from "@/pages/dashboards/icons";
import { IconCopy, IconTrash } from "@/pages/ecommerce/icons";
import { SectionHeader, useScopedStores } from "@/pages/operation/shared";
import { Icon, icons } from "@/pages/users/Icons";
import { paths } from "@/router/paths";

type Loaded = { challenges: ChallengeRecord[]; aggs: ChallengeAggInput };

/** Desafios podem ser cadastrados para frente: o calendario vai ate o fim do mes daqui a 12 meses. */
function maxPickerDate(today: string): Date {
  const d = deIso(today);
  return deIso(fimDoMes(paraIso(new Date(d.getFullYear(), d.getMonth() + 12, 1))));
}

/** Gestao > Desafios  -  1 card por desafio (lojas do StorePicker x periodo do filtro). */
export function ChallengesPage() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { session, lojas, loading: lojasLoading } = useScopedStores();
  const { escopo, mudar } = useScope();
  const today = calendarTodayIso();
  const periodo = resolvePeriod(escopo.periodo, today);
  const storeIds = useMemo(() => lojas.map((l) => l.id), [lojas]);
  const storeKey = storeIds.join(",");

  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [confirmar, setConfirmar] = useState<ChallengeRecord | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [duplicar, setDuplicar] = useState<ChallengeRecord | null>(null);
  const hasOtherStores = storesForSession(session.stores).length > 1;

  useEffect(() => {
    const onSync = () => setReload((n) => n + 1);
    window.addEventListener(SALES_SYNCED_EVENT, onSync);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSync);
  }, []);

  const filtroKey = `${session.tenantId}|${storeKey}|${periodo.inicio}|${periodo.fim}`;
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    if (lojasLoading) return;
    let cancelled = false;
    (async () => {
      // Venda nova (SALES_SYNCED_EVENT) recarrega sem skeleton; so filtro novo mostra o skeleton.
      if (loadedKey.current !== filtroKey) setLoading(true);
      const challenges = await fetchChallenges({ tenantId: session.tenantId, storeIds, from: periodo.inicio, to: periodo.fim });
      const aggs =
        challenges.length > 0
          ? await fetchChallengeInput({ tenantId: session.tenantId, challenges, today })
          : emptyChallengeAggInput();
      if (!cancelled) {
        setData({ challenges, aggs });
        loadedKey.current = filtroKey;
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.tenantId, storeKey, periodo.inicio, periodo.fim, lojasLoading, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const showSkeleton = useMinSkeleton(loading || lojasLoading);

  const cards = useMemo(() => {
    if (!data) return [];
    const byId = new Map(lojas.map((l) => [l.id, l]));
    return data.challenges
      .map((c) => ({ challenge: c, view: buildChallengeView({ challenge: c, aggs: data.aggs, today }), loja: byId.get(c.storeId) }))
      .sort(
        (a, b) =>
          CHALLENGE_STATUS_ORDER[a.view.status] - CHALLENGE_STATUS_ORDER[b.view.status] ||
          (a.view.status === "ended"
            ? b.challenge.endsOn.localeCompare(a.challenge.endsOn)
            : a.challenge.startsOn.localeCompare(b.challenge.startsOn)) ||
          (a.loja?.fantasia ?? "").localeCompare(b.loja?.fantasia ?? "", "pt-BR") ||
          a.challenge.name.localeCompare(b.challenge.name, "pt-BR"),
      );
  }, [data, lojas, today]);

  const dateRange = useMemo(() => dateRangeFromPeriod(escopo.periodo), [escopo.periodo]);
  function onDateChange(r: DateRange, meta?: DateRangeChangeMeta) {
    mudar(applyPeriodDateChange(escopo, r, meta));
  }

  async function excluir() {
    if (!confirmar) return;
    setExcluindo(true);
    const res = await deleteChallenge(session.tenantId, confirmar.id);
    setExcluindo(false);
    if (!res.ok) {
      show("Não foi possível excluir o desafio. Tente novamente.", "danger");
      return;
    }
    setConfirmar(null);
    show("Desafio excluído.", "success");
    setReload((n) => n + 1);
  }

  return (
    <div>
      <SectionHeader
        section="Gestão"
        title="Desafios"
        subtitle="Crie desafios de curto prazo para engajar a equipe e acompanhar resultados."
        actions={
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <DateRangePicker
              value={dateRange}
              onChange={onDateChange}
              displayLabel={periodDisplayLabel(escopo.periodo)}
              activePresetId={periodActivePresetId(escopo.periodo)}
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map(({ challenge, view, loja }) => (
              <ChallengeCard
                key={challenge.id}
                challenge={challenge}
                view={view}
                loja={loja}
                mostraLoja={lojas.length > 1}
                onDetail={() => navigate(paths.management.challengeDetail(challenge.id))}
                onCopy={() => setDuplicar(challenge)}
                onDelete={() => setConfirmar(challenge)}
              />
            ))}
          </div>
        )}
      </div>

      <DuplicateChoiceModal
        open={duplicar !== null}
        onClose={() => setDuplicar(null)}
        kind="desafio"
        name={duplicar?.name ?? null}
        hasOtherStores={hasOtherStores}
        onChoose={(choice) => {
          if (!duplicar) return;
          const id = duplicar.id;
          setDuplicar(null);
          navigate(choice === "store" ? paths.management.challengeCopyStore(id) : paths.management.challengeCopy(id));
        }}
      />

      <Modal
        open={confirmar !== null}
        onClose={() => !excluindo && setConfirmar(null)}
        title="Excluir desafio?"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmar(null)} disabled={excluindo}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void excluir()} disabled={excluindo}>
              {excluindo ? "Excluindo…" : "Excluir desafio"}
            </Button>
          </>
        }
      >
        {confirmar && (
          <p className="text-[13px] leading-relaxed text-t1">
            O desafio <span className="font-bold text-t0">{confirmar.name}</span>, de {dataCompleta(confirmar.startsOn)} a{" "}
            {dataCompleta(confirmar.endsOn)}, será excluído. Essa ação não pode ser desfeita.
          </p>
        )}
      </Modal>
    </div>
  );
}

function ChallengeCard({
  challenge: c,
  view,
  loja,
  mostraLoja,
  onDetail,
  onCopy,
  onDelete,
}: {
  challenge: ChallengeRecord;
  view: ChallengeView;
  loja: Store | undefined;
  mostraLoja: boolean;
  onDetail: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const periodo = `${dataCompleta(c.startsOn)} a ${dataCompleta(c.endsOn)}`;
  const destaque = challengeHeadline(c, view);
  const premio = mainPrizeLabel(c);

  const acao = (fn: () => void) => (e: MouseEvent) => {
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
      className="flex cursor-pointer flex-col rounded-2xl border border-line bg-bg-2 p-5 shadow-[var(--shadow-vela)] transition-colors hover:border-line-2 focus-visible:border-acc focus-visible:outline-none"
    >
      <div className="mb-3.5 flex items-center gap-3.5">
        <div className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-[14px] bg-acc-soft text-acc">
          <FlameIcon size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-t0">{c.name}</p>
          <p className="mt-0.5 truncate text-[12.5px] text-t2">
            {periodo}
            {mostraLoja && loja ? ` · ${loja.fantasia}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 self-start">
          <Tooltip label="Duplicar desafio">
            <button
              type="button"
              onClick={acao(onCopy)}
              aria-label="Duplicar desafio"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-t2 transition-colors hover:border-acc hover:text-acc"
            >
              <IconCopy width={12} height={12} />
            </button>
          </Tooltip>
          <Tooltip label="Excluir desafio">
            <button
              type="button"
              onClick={acao(onDelete)}
              aria-label="Excluir desafio"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-t2 transition-colors hover:border-bad hover:text-bad"
            >
              <IconTrash width={12} height={12} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-[13px] text-t1">
          <HeadlineText headline={destaque} />
        </p>
        {premio && (
          <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-t1">
            <TrophyIcon size={13} className="text-warn" />
            {premio}
          </span>
        )}
      </div>
      <p className="mt-2 text-[11.5px] text-t2">{view.prazo}</p>

      <div className="flex-1" />
      <div className="mt-4 flex flex-wrap gap-1.5">
        <Badge variant={CHALLENGE_STATUS_VARIANT[view.status]}>{CHALLENGE_STATUS_LABEL[view.status]}</Badge>
        <Badge variant="neutral">{CHALLENGE_METRIC_LABEL[c.metric]}</Badge>
        <Badge variant="neutral">{CHALLENGE_MODE_LABEL[c.mode]}</Badge>
      </div>
    </div>
  );
}

export default ChallengesPage;
