import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal } from "@/components/ui";
import { AreaLineChart } from "@/components/charts";
import {
  buildTeamMemberDetail,
  productsFetchRange,
  resolvePeriod,
  TEAM_WITHOUT_SHIFT,
  type Scope,
  type TeamAggInput,
  type TeamMemberDetail,
} from "@/data/wedash/dashboard";
import { excludeNonSalesPeople, fetchNamedSellerDayAggs, fetchSalesDayAggs, fetchSalesOrigins, fetchSalesSellerDayAggs, fetchSellerShifts } from "@/data/wedash/salesRepo";
import { unionOriginKeys } from "@/data/wedash/engine/salesOrigin";
import { getSupabase } from "@/lib/supabase";
import { calendarTodayIso } from "@/data/wedash/clock";
import { dayInGeneralGoal } from "@/data/wedash/engine/goalView";
import { personShareDays, teamViewWithGoalShare } from "@/data/wedash/engine/generalRanking";
import type { GoalRecord, GoalTeamMember } from "@/data/wedash/engine/goalTypes";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { DetailSkeleton, MetricDetail, pctFmt } from "@/pages/dashboard/ProductDetail";
import { brlCent, shortDate, num, comparedWithTip } from "@/lib/format";
import { cn } from "@/lib/cn";
import { GOAL_STATUS_LABEL, type SellerGoalLevel } from "@/data/wedash/goalView";
import { GoalLevelSummary } from "@/components/wedash/GoalLevelsBar";

/** Tudo o que a tela Equipe le  -  tambem usado pelo detalhe aberto da Visao geral. */
export async function fetchTeamAggInput(tenantId: string, scope: Scope, storeIds = scope.storeIds): Promise<TeamAggInput> {
  const range = productsFetchRange(scope);
  const client = getSupabase();
  const sellerQuery = { tenantId, storeIds, from: range.from, to: range.to };
  const [dayAggs, namedSellerDayAggs, origins, sellerShifts] = await Promise.all([
    fetchSalesDayAggs({ tenantId, storeIds, from: range.from, to: range.to, brand: null }),
    fetchNamedSellerDayAggs(sellerQuery),
    client ? fetchSalesOrigins(client, tenantId) : Promise.resolve(null),
    fetchSellerShifts(tenantId),
  ]);
  const sellerDayAggs = origins ? excludeNonSalesPeople(namedSellerDayAggs, unionOriginKeys(origins)) : await fetchSalesSellerDayAggs(sellerQuery);
  return { dayAggs, sellerDayAggs, namedSellerDayAggs, ...(origins ? { origins } : {}), sellerShifts };
}

type Selection = { key: string; name: string };

/**
 * Detalhe de uma pessoa da equipe.
 * Com `data` usa os dados da tela; sem `data` busca os dados da Equipe so ao abrir.
 * `turno` = filtro de turno da tela (participacao relativa ao turno, igual a tabela).
 * `niveisMeta` = nivel de meta por pessoa (mesma chave da tabela / Destaques)  ->  secao Meta.
 */
export function useTeamMemberDetail({
  scope,
  data,
  tenantId,
  shift,
  goalLevels,
  goalShare,
}: {
  scope: Scope;
  data?: TeamAggInput;
  tenantId?: string;
  shift?: string | null;
  goalLevels?: Map<string, SellerGoalLevel>;
  /** Equipe: o detalhe usa o mesmo rateio do ranking. A Visão geral não passa. */
  goalShare?: { goals: GoalRecord[]; team: GoalTeamMember[]; storeNames?: Map<string, string> };
}): { open: (key: string, name: string) => void; modal: ReactNode } {
  const [picked, setPicked] = useState<Selection | null>(null);
  const open = useCallback((key: string, name: string) => setPicked({ key, name }), []);

  useEffect(() => {
    setPicked(null);
  }, [scope]);

  const [storesTick, setStoresTick] = useState(0);
  useEffect(() => {
    const onStores = () => setStoresTick((n) => n + 1);
    window.addEventListener("wedash:stores", onStores);
    return () => window.removeEventListener("wedash:stores", onStores);
  }, []);

  const lazy = useLazyTeamData(scope, tenantId, !data && picked != null);
  const source = data ?? lazy;

  const detail = useMemo(() => {
    if (!picked || !source) return null;
    const today = calendarTodayIso();
    const extraByDay = goalShare ? personShareDays(scope, source, goalShare.goals, goalShare.team, today, picked.key) : undefined;
    const built = buildTeamMemberDetail(scope, source, picked.key, {
      shift,
      extraByDay,
      fallbackName: picked.name,
      omitDay: goalShare ? (storeId, day) => dayInGeneralGoal(goalShare.goals, storeId, day, today) : undefined,
    });
    if (!built || !goalShare) return built;
    const row = teamViewWithGoalShare(scope, source, goalShare.goals, goalShare.team, today, goalShare.storeNames).people.find((person) => person.key === picked.key);
    if (!row) return built;
    return {
      ...built,
      revenue: row.revenue,
      sales: row.sales,
      items: row.items,
      averageTicket: row.averageTicket,
      pa: row.pa,
      participationPct: row.participationPct,
      variationPct: row.variationPct,
      revenueCmp: row.revenueCmp,
      revenuePrev: row.revenuePrev,
      storeIds: row.storeIds,
      storeRows: row.storeRows,
      name: row.name,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, source, scope, shift, storesTick, goalShare]);

  const modal = (
    <TeamMemberDetailModal
      open={picked != null}
      loading={picked != null && !source}
      title={picked?.name}
      detail={detail}
      goal={picked ? goalLevels?.get(picked.key) : undefined}
      shiftFilter={shift ?? null}
      period={resolvePeriod(scope.period, calendarTodayIso()).label}
      onClose={() => setPicked(null)}
    />
  );
  return { open, modal };
}

/** Busca os dados da Equipe na 1 abertura; mantem ate mudar o filtro ou chegar venda nova. */
function useLazyTeamData(scope: Scope, tenantId: string | undefined, enabled: boolean): TeamAggInput | null {
  const [data, setData] = useState<TeamAggInput | null>(null);
  const gen = useRef(0);

  useEffect(() => {
    gen.current++;
    setData(null);
  }, [scope, tenantId]);

  useEffect(() => {
    if (!enabled || !tenantId) return;
    const onSynced = () => {
      const g = ++gen.current;
      fetchTeamAggInput(tenantId, scope)
        .then((d) => {
          if (g === gen.current) setData(d);
        })
        .catch((e) => console.error("Team member detail load:", e));
    };
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [enabled, tenantId, scope]);

  useEffect(() => {
    if (!enabled || !tenantId || data) return;
    const g = ++gen.current;
    fetchTeamAggInput(tenantId, scope)
      .then((d) => {
        if (g === gen.current) setData(d);
      })
      .catch((e) => {
        console.error("Team member detail load:", e);
        if (g === gen.current) setData({ dayAggs: [] });
      });
  }, [enabled, tenantId, data, scope]);

  return data;
}

function GoalInfo({ label, mono, className, children }: { label: string; mono?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[11px] font-semibold text-t2">{label}</p>
      <p className={cn("mt-0.5 text-[13px] font-bold text-t0", mono && "font-mono tabular-nums")}>{children}</p>
    </div>
  );
}

/** Meta da pessoa: do inicio da meta ate hoje (nao segue o filtro de periodo do modal). */
function GoalSection({ goal }: { goal: SellerGoalLevel }) {
  const group = goal.modo === "grupo";
  const geral = goal.modo === "geral";
  const currentLevel = goal.levelNumber != null ? goal.marcos[goal.levelNumber - 1] : undefined;
  const total = goal.prizeAmount + goal.bonus;
  const situacao =
    goal.status === "active"
      ? goal.daysRemaining === 1
        ? "último dia"
        : `faltam ${goal.daysRemaining} dias`
      : GOAL_STATUS_LABEL[goal.status].toLowerCase();
  const prizeTip = [
    currentLevel
      ? geral
        ? `${num(currentLevel.commissionPct, 1)}% sobre o total vendido da filial, dividido igualmente entre as pessoas.`
        : group
          ? `${num(currentLevel.commissionPct, 1)}% sobre as vendas do grupo, dividido igualmente entre as pessoas.`
          : `${num(currentLevel.commissionPct, 1)}% sobre tudo o que a pessoa vendeu na meta.`
      : "Ainda abaixo do 1º nível.",
    goal.bonus > 0 ? `Inclui ${brlCent(goal.bonus)} de bônus dos níveis alcançados.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className="text-[13px] font-bold text-t0">Meta</h4>
        <span className="text-[11.5px] font-semibold text-t2">
          {goal.metaName} · {shortDate(goal.start)} a {shortDate(goal.end)} · {situacao}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <MetricDetail label={geral ? "Meta da filial" : group ? "Meta do grupo" : "Meta individual"} amount={brlCent(goal.goalAmount)} />
        <MetricDetail
          label={geral ? "Vendas da filial" : group ? "Vendas do grupo" : "Vendas na meta"}
          amount={brlCent(goal.achieved)}
          tip="Do início da meta até hoje. Não segue o período escolhido na tela."
        />
        <MetricDetail label="Premiação até agora" amount={brlCent(total)} destaque={total > 0} tip={prizeTip} />
      </div>
      <div className="mt-2.5 rounded-xl border border-line bg-bg-inset p-3">
        <GoalLevelSummary pct={goal.attainmentPct} level={goal.level} levelNumber={goal.levelNumber} marcos={goal.marcos} rolagem />
        <div className="mt-3 border-t border-line pt-3">
          {goal.next ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
              <GoalInfo label="Próximo nível" className="col-span-2 sm:col-span-1">
                N{goal.next.number} · {goal.next.name}
              </GoalInfo>
              <GoalInfo label="Falta para o próximo nível" mono>
                {brlCent(goal.next.gap)}
              </GoalInfo>
              <GoalInfo label="Ao chegar">
                {num(goal.next.commissionPct, 1)}% de premiação
                {goal.next.bonus > 0 && <span className="block text-[12px] font-semibold text-t2">+ {brlCent(goal.next.bonus)} de bônus</span>}
              </GoalInfo>
            </div>
          ) : (
            <p className="text-[12.5px] font-semibold text-ok">Chegou ao último nível da meta.</p>
          )}
          {group && goal.group && (
            <p className="mt-2.5 text-[11.5px] text-t2">
              Meta por grupo: o grupo <span className="font-semibold text-t1">{goal.group}</span> sobe de nível junto, pela soma das vendas.
            </p>
          )}
          {geral && (
            <p className="mt-2.5 text-[11.5px] text-t2">
              Meta geral: a equipe sobe de nível junta, pelo total vendido da loja. A premiação é dividida igualmente.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function TeamMemberDetailModal({
  open,
  loading,
  title,
  detail,
  goal,
  shiftFilter,
  period,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  title?: string;
  detail: TeamMemberDetail | null;
  goal?: SellerGoalLevel;
  shiftFilter: string | null;
  period: string;
  onClose: () => void;
}) {
  const cmp = detail?.comparison;
  const shift = detail?.shift ?? TEAM_WITHOUT_SHIFT;
  const subtitle = detail
    ? [detail.storeRows.length === 1 ? detail.storeRows[0] : detail.storeRows.length > 1 ? `${detail.storeRows.length} filiais` : "", shift, period]
        .filter(Boolean)
        .join(" · ")
    : "";
  const base = shiftFilter ? `do grupo ${shiftFilter}` : "da equipe";
  return (
    <Modal open={open} onClose={onClose} title={detail?.name ?? title} size="lg">
      {loading ? (
        <DetailSkeleton />
      ) : !detail ? (
        <div className="flex min-h-[220px] flex-col">
          <EmptyBlock />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="-mt-1 text-[12px] font-semibold text-t2">{subtitle}</p>

          <div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <MetricDetail label="Faturamento" amount={brlCent(detail.revenue)} delta={cmp?.revenue} />
              <MetricDetail label="Nº de vendas" amount={num(detail.sales)} delta={cmp?.sales} />
              <MetricDetail label="Ticket médio" amount={brlCent(detail.averageTicket)} delta={cmp?.ticket} />
              <MetricDetail
                label="P.A."
                amount={detail.pa == null ? "—" : num(detail.pa, 2)}
                delta={cmp?.pa}
                tip="Média de itens por venda."
              />
              <MetricDetail label="Itens vendidos" amount={detail.pa == null ? "—" : num(detail.items)} />
              <MetricDetail
                label="Participação"
                amount={pctFmt(detail.participationPct)}
                tip={`Participação da pessoa no faturamento ${base} no período.`}
              />
            </div>
            <p className="mt-2.5 text-[11.5px] text-t2">
              {cmp
                ? `Variação ${comparedWithTip(cmp.vs).replace(/^Em/, "em")}`
                : "Sem vendas no período anterior para comparar."}
              {detail.pa == null && " P.A. e itens vendidos ficam indisponíveis quando faltam dados de itens no período."}
            </p>
          </div>

          {goal && <GoalSection goal={goal} />}

          {detail.series && (
            <section>
              <h4 className="mb-2 text-[13px] font-bold text-t0">
                Faturamento {detail.seriesGranularity === "month" ? "por mês" : "por dia"}
              </h4>
              <AreaLineChart
                data={detail.series.map((d) => d.revenue)}
                labels={detail.series.map((d) => d.label)}
                tooltipLabels={detail.series.map((d) => d.detail ?? d.label)}
                formatValue={brlCent}
                height={200}
                showAxisLabels
              />
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
