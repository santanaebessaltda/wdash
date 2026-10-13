import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal } from "@/components/ui";
import { AreaLineChart } from "@/components/charts";
import {
  buildTeamMemberDetail,
  productsFetchRange,
  resolvePeriod,
  TEAM_SEM_TURNO,
  type Scope,
  type TeamAggInput,
  type TeamMemberDetail,
} from "@/data/wedash/dashboard";
import { fetchSalesDayAggs, fetchSalesSellerDayAggs, fetchSellerShifts } from "@/data/wedash/salesRepo";
import { calendarTodayIso } from "@/data/wedash/clock";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { DetalheSkeleton, MetricDetail, pctFmt } from "@/pages/dashboard/ProductDetail";
import { brlCent, shortDate, num, comparedWithTip } from "@/lib/format";
import { cn } from "@/lib/cn";
import { GOAL_STATUS_LABEL, type SellerGoalLevel } from "@/data/wedash/goalView";
import { GoalLevelSummary } from "@/components/wedash/GoalLevelsBar";

/** Tudo o que a tela Equipe le  -  tambem usado pelo detalhe aberto da Visao geral. */
export async function fetchTeamAggInput(tenantId: string, scope: Scope): Promise<TeamAggInput> {
  const period = resolvePeriod(scope.period, calendarTodayIso());
  const range = productsFetchRange(scope);
  const storeIds = scope.storeIds;
  const [dayAggs, sellerDayAggs, sellerShifts] = await Promise.all([
    fetchSalesDayAggs({ tenantId, storeIds, from: period.start, to: period.end, brand: null }),
    fetchSalesSellerDayAggs({ tenantId, storeIds, from: range.from, to: range.to }),
    fetchSellerShifts(tenantId),
  ]);
  return { dayAggs, sellerDayAggs, sellerShifts };
}

type Selecao = { key: string; name: string };

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
  turno,
  goalLevels,
}: {
  scope: Scope;
  data?: TeamAggInput;
  tenantId?: string;
  turno?: string | null;
  goalLevels?: Map<string, SellerGoalLevel>;
}): { abrir: (key: string, name: string) => void; modal: ReactNode } {
  const [sel, setSel] = useState<Selecao | null>(null);
  const abrir = useCallback((key: string, name: string) => setSel({ key, name }), []);

  useEffect(() => {
    setSel(null);
  }, [scope]);

  const [storesTick, setStoresTick] = useState(0);
  useEffect(() => {
    const onStores = () => setStoresTick((n) => n + 1);
    window.addEventListener("wedash:stores", onStores);
    return () => window.removeEventListener("wedash:stores", onStores);
  }, []);

  const lazy = useLazyTeamData(scope, tenantId, !data && sel != null);
  const fonte = data ?? lazy;

  const detail = useMemo(
    () => (sel && fonte ? buildTeamMemberDetail(scope, fonte, sel.key, { turno }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, fonte, scope, turno, storesTick],
  );

  const modal = (
    <TeamMemberDetailModal
      open={sel != null}
      loading={sel != null && !fonte}
      title={sel?.name}
      detail={detail}
      goal={sel ? goalLevels?.get(sel.key) : undefined}
      turnoFiltro={turno ?? null}
      period={resolvePeriod(scope.period, calendarTodayIso()).label}
      onClose={() => setSel(null)}
    />
  );
  return { abrir, modal };
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
  const currentLevel = goal.nivelNumero != null ? goal.marcos[goal.nivelNumero - 1] : undefined;
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
          {goal.metaNome} · {shortDate(goal.start)} a {shortDate(goal.end)} · {situacao}
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
        <GoalLevelSummary pct={goal.attainmentPct} nivel={goal.nivel} nivelNumero={goal.nivelNumero} marcos={goal.marcos} rolagem />
        <div className="mt-3 border-t border-line pt-3">
          {goal.proximo ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
              <GoalInfo label="Próximo nível" className="col-span-2 sm:col-span-1">
                N{goal.proximo.numero} · {goal.proximo.name}
              </GoalInfo>
              <GoalInfo label="Falta para o próximo nível" mono>
                {brlCent(goal.proximo.falta)}
              </GoalInfo>
              <GoalInfo label="Ao chegar">
                {num(goal.proximo.commissionPct, 1)}% de premiação
                {goal.proximo.bonus > 0 && <span className="block text-[12px] font-semibold text-t2">+ {brlCent(goal.proximo.bonus)} de bônus</span>}
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
  turnoFiltro,
  period,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  title?: string;
  detail: TeamMemberDetail | null;
  goal?: SellerGoalLevel;
  turnoFiltro: string | null;
  period: string;
  onClose: () => void;
}) {
  const cmp = detail?.comparativo;
  const turno = detail?.turno ?? TEAM_SEM_TURNO;
  const subtitle = detail
    ? [detail.storeRows.length === 1 ? detail.storeRows[0] : detail.storeRows.length > 1 ? `${detail.storeRows.length} filiais` : "", turno, period]
        .filter(Boolean)
        .join(" · ")
    : "";
  const base = turnoFiltro ? `do grupo ${turnoFiltro}` : "da equipe";
  return (
    <Modal open={open} onClose={onClose} title={detail?.name ?? title} size="lg">
      {loading ? (
        <DetalheSkeleton />
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
              <MetricDetail label="Nº de vendas" amount={num(detail.vendas)} delta={cmp?.vendas} />
              <MetricDetail label="Ticket médio" amount={brlCent(detail.averageTicket)} delta={cmp?.ticket} />
              <MetricDetail
                label="P.A."
                amount={detail.pa == null ? "—" : num(detail.pa, 2)}
                delta={cmp?.pa}
                tip="Média de itens por venda."
              />
              <MetricDetail label="Itens vendidos" amount={detail.pa == null ? "—" : num(detail.itens)} />
              <MetricDetail
                label="Participação"
                amount={pctFmt(detail.participacaoPct)}
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

          {detail.serie && (
            <section>
              <h4 className="mb-2 text-[13px] font-bold text-t0">
                Faturamento {detail.seriesGranularity === "month" ? "por mês" : "por dia"}
              </h4>
              <AreaLineChart
                data={detail.serie.map((d) => d.revenue)}
                labels={detail.serie.map((d) => d.label)}
                tooltipLabels={detail.serie.map((d) => d.detail ?? d.label)}
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
