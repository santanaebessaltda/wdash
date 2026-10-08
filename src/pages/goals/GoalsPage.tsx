import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AvatarGroup, Badge, Button, Card, DateRangePicker, Modal, ProgressBar, progressTextClass, useToast } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import type { DateRange, DateRangeChangeMeta } from "@/components/ui/DateRangePicker";
import { DuplicateChoiceModal } from "@/components/wedash/DuplicateChoiceModal";
import { GoalCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { calendarTodayIso } from "@/data/wedash/clock";
import { buildGoalSummary, GOAL_STATUS_LABEL, goalTeamNames, prazoRestante, type GoalStatus, type GoalSummary } from "@/data/wedash/goalView";
import { deleteGoal, fetchGoalTeam, fetchGoals, type GoalRecord, type GoalTeamMember } from "@/data/wedash/goalsRepo";
import { fetchSalesDayAggs } from "@/data/wedash/salesRepo";
import type { SalesDayAgg } from "@/data/wedash/salesTypes";
import { storesForSession, type Store } from "@/data/wedash/stores";
import { brlCent, dataCompleta, fimDoMes, num, paraIso, deIso } from "@/lib/format";
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
const STATUS_VARIANT: Record<GoalStatus, "success" | "info" | "neutral"> = { active: "success", upcoming: "info", ended: "neutral" };

type Loaded = { goals: GoalRecord[]; dayAggs: SalesDayAgg[]; team: GoalTeamMember[] };

/** Metas podem ser cadastradas para frente: o calendario vai ate o fim do mes daqui a 12 meses. */
function maxPickerDate(today: string): Date {
  const d = deIso(today);
  return deIso(fimDoMes(paraIso(new Date(d.getFullYear(), d.getMonth() + 12, 1))));
}

/** Gestao > Metas  -  1 card por meta (loja do StorePicker x periodo do filtro). */
export default function GoalsPage() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { session, lojas, loading: lojasLoading } = useScopedStores();
  const { escopo, mudar } = useScope();
  const today = calendarTodayIso();
  const janela = useMemo(() => managementScheduleWindow(escopo.periodo, today), [escopo.periodo, today]);
  const storeIds = useMemo(() => lojas.map((l) => l.id), [lojas]);
  const storeKey = storeIds.join(",");

  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [confirmar, setConfirmar] = useState<GoalRecord | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [duplicar, setDuplicar] = useState<GoalRecord | null>(null);
  const hasOtherStores = storesForSession(session.stores).length > 1;

  useEffect(() => {
    const onSync = () => setReload((n) => n + 1);
    window.addEventListener(SALES_SYNCED_EVENT, onSync);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSync);
  }, []);

  const filtroKey = `${session.tenantId}|${storeKey}|${janela.from}|${janela.to}`;
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    if (lojasLoading) return;
    let cancelled = false;
    (async () => {
      // Venda nova (SALES_SYNCED_EVENT) recarrega sem skeleton; so filtro novo mostra o skeleton.
      if (loadedKey.current !== filtroKey) setLoading(true);
      const goals = await fetchGoals({ tenantId: session.tenantId, storeIds, from: janela.from, to: janela.to });
      let dayAggs: SalesDayAgg[] = [];
      let team: GoalTeamMember[] = [];
      if (goals.length > 0) {
        const goalStores = [...new Set(goals.map((g) => g.storeId))];
        const from = goals.reduce((m, g) => (g.startsOn < m ? g.startsOn : m), goals[0].startsOn);
        const lastEnd = goals.reduce((m, g) => (g.endsOn > m ? g.endsOn : m), goals[0].endsOn);
        const to = lastEnd < today ? lastEnd : today;
        [dayAggs, team] = await Promise.all([
          from <= to
            ? fetchSalesDayAggs({ tenantId: session.tenantId, storeIds: goalStores, from, to, brand: "ALL" })
            : Promise.resolve([]),
          fetchGoalTeam(session.tenantId, goalStores),
        ]);
      }
      if (!cancelled) {
        setData({ goals, dayAggs, team });
        loadedKey.current = filtroKey;
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.tenantId, storeKey, janela.from, janela.to, lojasLoading, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const showSkeleton = useMinSkeleton(loading || lojasLoading);

  const cards = useMemo(() => {
    if (!data) return [];
    const byId = new Map(lojas.map((l) => [l.id, l]));
    return data.goals
      .map((g) => ({
        summary: buildGoalSummary(g, data.dayAggs, today),
        loja: byId.get(g.storeId),
        equipe: goalTeamNames(g.storeId, data.team),
      }))
      .sort(
        (a, b) =>
          STATUS_ORDER[a.summary.status] - STATUS_ORDER[b.summary.status] ||
          b.summary.goal.startsOn.localeCompare(a.summary.goal.startsOn) ||
          (a.loja?.fantasia ?? "").localeCompare(b.loja?.fantasia ?? "", "pt-BR"),
      );
  }, [data, lojas, today]);

  const dateRange = useMemo(() => dateRangeFromManagementPeriod(escopo.periodo), [escopo.periodo]);
  function onDateChange(r: DateRange, meta?: DateRangeChangeMeta) {
    mudar(applyPeriodDateChange(escopo, r, meta));
  }

  async function excluir() {
    if (!confirmar) return;
    setExcluindo(true);
    const res = await deleteGoal(session.tenantId, confirmar.id);
    setExcluindo(false);
    if (!res.ok) {
      show("Não foi possível excluir a meta. Tente novamente.", "danger");
      return;
    }
    setConfirmar(null);
    show("Meta excluída.", "success");
    setReload((n) => n + 1);
  }

  return (
    <div>
      <SectionHeader
        section="Gestão"
        title="Metas"
        subtitle="Gerencie metas, distribuição da equipe e níveis de premiação."
        actions={
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <DateRangePicker
              value={dateRange}
              onChange={onDateChange}
              displayLabel={periodDisplayLabel(escopo.periodo)}
              activePresetId={periodActivePresetId(escopo.periodo)}
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
            {cards.map(({ summary, loja, equipe }) => (
              <GoalCard
                key={summary.goal.id}
                summary={summary}
                loja={loja}
                mostraLoja={lojas.length > 1}
                equipe={equipe}
                onDetail={() => navigate(paths.goalDetail(summary.goal.id))}
                onCopy={() => setDuplicar(summary.goal)}
                onDelete={() => setConfirmar(summary.goal)}
              />
            ))}
          </div>
        )}
      </div>

      <DuplicateChoiceModal
        open={duplicar !== null}
        onClose={() => setDuplicar(null)}
        kind="meta"
        name={duplicar?.name ?? null}
        hasOtherStores={hasOtherStores}
        onChoose={(choice) => {
          if (!duplicar) return;
          const id = duplicar.id;
          setDuplicar(null);
          navigate(choice === "store" ? paths.goalCopyStore(id) : paths.goalCopy(id));
        }}
      />

      <Modal
        open={confirmar !== null}
        onClose={() => !excluindo && setConfirmar(null)}
        title="Excluir meta?"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmar(null)} disabled={excluindo}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void excluir()} disabled={excluindo}>
              {excluindo ? "Excluindo…" : "Excluir meta"}
            </Button>
          </>
        }
      >
        {confirmar && (
          <p className="text-[13px] leading-relaxed text-t1">
            A meta <span className="font-bold text-t0">{confirmar.name}</span>, de {dataCompleta(confirmar.startsOn)} a {dataCompleta(confirmar.endsOn)}, será
            excluída. Essa ação não pode ser desfeita.
          </p>
        )}
      </Modal>
    </div>
  );
}

function GoalCard({
  summary,
  loja,
  mostraLoja,
  equipe,
  onDetail,
  onCopy,
  onDelete,
}: {
  summary: GoalSummary;
  loja: Store | undefined;
  mostraLoja: boolean;
  equipe: string[];
  onDetail: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const { goal: g, status, realizado, pct, projetadoPct, diasRestantes, nivelAtual, nivelNumero } = summary;
  const periodo = `${dataCompleta(g.startsOn)} a ${dataCompleta(g.endsOn)}`;
  const prazo = prazoRestante(diasRestantes);
  const rodape =
    status === "active"
      ? projetadoPct != null
        ? `Projeção: ${num(projetadoPct, 0)}% · ${prazo.toLowerCase()}`
        : prazo
      : status === "upcoming"
        ? `Começa em ${dataCompleta(g.startsOn)}`
        : nivelAtual
          ? `Nível final: N${nivelNumero} · ${nivelAtual}`
          : "Nenhum nível atingido";

  const acao = (fn: () => void) => (e: MouseEvent) => {
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
      <div className="mb-3.5 flex items-center gap-3.5">
        <div className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-[14px] bg-acc-soft text-acc">
          <TargetIcon size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-t0">{g.name}</p>
          <p className="mt-0.5 truncate text-[12.5px] text-t2">
            {periodo}
            {mostraLoja && loja ? ` · ${loja.fantasia}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 self-start">
          <Tooltip label="Duplicar meta">
            <button
              type="button"
              onClick={acao(onCopy)}
              aria-label="Duplicar meta"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-t2 transition-colors hover:border-acc hover:text-acc"
            >
              <IconCopy width={12} height={12} />
            </button>
          </Tooltip>
          <Tooltip label="Excluir meta">
            <button
              type="button"
              onClick={acao(onDelete)}
              aria-label="Excluir meta"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-t2 transition-colors hover:border-bad hover:text-bad"
            >
              <IconTrash width={12} height={12} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        {status === "upcoming" ? (
          <span className="font-mono text-[13px] font-extrabold text-t0">{brlCent(g.target)}</span>
        ) : (
          <span className="font-mono text-[13px] font-extrabold text-ok">{brlCent(realizado)}</span>
        )}
        <span className="text-right text-[11.5px] text-t2">
          {status === "upcoming" ? (
            "Meta da loja"
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
      <p className="mt-2 text-[11.5px] text-t2">{rodape}</p>

      <div className="flex-1" />
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          <Badge variant={STATUS_VARIANT[status]}>{GOAL_STATUS_LABEL[status]}</Badge>
          <Badge variant="neutral">{g.tierMode === "INDIVIDUAL" ? "Individual" : g.tierMode === "GENERAL" ? "Geral" : "Grupo"}</Badge>
          <Badge variant="neutral">
            {g.tiers.length} {g.tiers.length === 1 ? "nível" : "níveis"}
          </Badge>
          <Badge variant="neutral">{equipe.length} na equipe</Badge>
        </div>
        {equipe.length > 0 && (
          <div className="shrink-0">
            <AvatarGroup names={equipe} max={3} />
          </div>
        )}
      </div>
    </div>
  );
}
