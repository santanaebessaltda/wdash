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
import { DetalheSkeleton, MetricaDetalhe, pctFmt } from "@/pages/dashboard/ProductDetail";
import { brlCent, dataCurta, num, tipRelacao } from "@/lib/format";
import { cn } from "@/lib/cn";
import { GOAL_STATUS_LABEL, type SellerGoalLevel } from "@/data/wedash/goalView";
import { GoalLevelSummary } from "@/components/wedash/GoalLevelsBar";

/** Tudo o que a tela Equipe lê — também usado pelo detalhe aberto da Visão geral. */
export async function fetchTeamAggInput(tenantId: string, escopo: Scope): Promise<TeamAggInput> {
  const periodo = resolvePeriod(escopo.periodo, calendarTodayIso());
  const range = productsFetchRange(escopo);
  const storeIds = escopo.filialIds;
  const [dayAggs, sellerDayAggs, sellerShifts] = await Promise.all([
    fetchSalesDayAggs({ tenantId, storeIds, from: periodo.inicio, to: periodo.fim, brand: null }),
    fetchSalesSellerDayAggs({ tenantId, storeIds, from: range.from, to: range.to }),
    fetchSellerShifts(tenantId),
  ]);
  return { dayAggs, sellerDayAggs, sellerShifts };
}

type Selecao = { key: string; nome: string };

/**
 * Detalhe de uma pessoa da equipe.
 * Com `data` usa os dados da tela; sem `data` busca os dados da Equipe só ao abrir.
 * `turno` = filtro de turno da tela (participação relativa ao turno, igual à tabela).
 * `niveisMeta` = nível de meta por pessoa (mesma chave da tabela / Destaques) → seção Meta.
 */
export function useTeamMemberDetail({
  escopo,
  data,
  tenantId,
  turno,
  niveisMeta,
}: {
  escopo: Scope;
  data?: TeamAggInput;
  tenantId?: string;
  turno?: string | null;
  niveisMeta?: Map<string, SellerGoalLevel>;
}): { abrir: (key: string, nome: string) => void; modal: ReactNode } {
  const [sel, setSel] = useState<Selecao | null>(null);
  const abrir = useCallback((key: string, nome: string) => setSel({ key, nome }), []);

  useEffect(() => {
    setSel(null);
  }, [escopo]);

  const [storesTick, setStoresTick] = useState(0);
  useEffect(() => {
    const onStores = () => setStoresTick((n) => n + 1);
    window.addEventListener("wedash:stores", onStores);
    return () => window.removeEventListener("wedash:stores", onStores);
  }, []);

  const lazy = useLazyTeamData(escopo, tenantId, !data && sel != null);
  const fonte = data ?? lazy;

  const detalhe = useMemo(
    () => (sel && fonte ? buildTeamMemberDetail(escopo, fonte, sel.key, { turno }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, fonte, escopo, turno, storesTick],
  );

  const modal = (
    <TeamMemberDetailModal
      open={sel != null}
      loading={sel != null && !fonte}
      titulo={sel?.nome}
      detalhe={detalhe}
      meta={sel ? niveisMeta?.get(sel.key) : undefined}
      turnoFiltro={turno ?? null}
      periodo={resolvePeriod(escopo.periodo, calendarTodayIso()).rotulo}
      onClose={() => setSel(null)}
    />
  );
  return { abrir, modal };
}

/** Busca os dados da Equipe na 1ª abertura; mantém até mudar o filtro ou chegar venda nova. */
function useLazyTeamData(escopo: Scope, tenantId: string | undefined, enabled: boolean): TeamAggInput | null {
  const [data, setData] = useState<TeamAggInput | null>(null);
  const gen = useRef(0);

  useEffect(() => {
    gen.current++;
    setData(null);
  }, [escopo, tenantId]);

  useEffect(() => {
    const onSynced = () => {
      gen.current++;
      setData(null);
    };
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, []);

  useEffect(() => {
    if (!enabled || !tenantId || data) return;
    const g = ++gen.current;
    fetchTeamAggInput(tenantId, escopo)
      .then((d) => {
        if (g === gen.current) setData(d);
      })
      .catch((e) => {
        console.error("Team member detail load:", e);
        if (g === gen.current) setData({ dayAggs: [] });
      });
  }, [enabled, tenantId, data, escopo]);

  return data;
}

function InfoMeta({ label, mono, className, children }: { label: string; mono?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[11px] font-semibold text-t2">{label}</p>
      <p className={cn("mt-0.5 text-[13px] font-bold text-t0", mono && "font-mono tabular-nums")}>{children}</p>
    </div>
  );
}

/** Meta da pessoa: do início da meta até hoje (não segue o filtro de período do modal). */
function SecaoMeta({ meta }: { meta: SellerGoalLevel }) {
  const grupo = meta.modo === "grupo";
  const nivelAtual = meta.nivelNumero != null ? meta.marcos[meta.nivelNumero - 1] : undefined;
  const total = meta.premiacao + meta.bonus;
  const situacao =
    meta.status === "active"
      ? meta.diasRestantes === 1
        ? "último dia"
        : `faltam ${meta.diasRestantes} dias`
      : GOAL_STATUS_LABEL[meta.status].toLowerCase();
  const tipPremiacao = [
    nivelAtual
      ? grupo
        ? `${num(nivelAtual.comissaoPct, 1)}% sobre as vendas do grupo, dividido igualmente entre as pessoas.`
        : `${num(nivelAtual.comissaoPct, 1)}% sobre tudo o que a pessoa vendeu na meta.`
      : "Ainda abaixo do 1º nível.",
    meta.bonus > 0 ? `Inclui ${brlCent(meta.bonus)} de bônus dos níveis alcançados.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className="text-[13px] font-bold text-t0">Meta</h4>
        <span className="text-[11.5px] font-semibold text-t2">
          {meta.metaNome} · {dataCurta(meta.inicio)} a {dataCurta(meta.fim)} · {situacao}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <MetricaDetalhe label={grupo ? "Meta do grupo" : "Meta individual"} valor={brlCent(meta.metaValor)} />
        <MetricaDetalhe
          label={grupo ? "Vendas do grupo" : "Vendas na meta"}
          valor={brlCent(meta.realizado)}
          tip="Do início da meta até hoje. Não segue o período escolhido na tela."
        />
        <MetricaDetalhe label="Premiação até agora" valor={brlCent(total)} destaque={total > 0} tip={tipPremiacao} />
      </div>
      <div className="mt-2.5 rounded-xl border border-line bg-bg-inset p-3">
        <GoalLevelSummary pct={meta.atingimentoPct} nivel={meta.nivel} nivelNumero={meta.nivelNumero} marcos={meta.marcos} rolagem />
        <div className="mt-3 border-t border-line pt-3">
          {meta.proximo ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
              <InfoMeta label="Próximo nível" className="col-span-2 sm:col-span-1">
                N{meta.proximo.numero} · {meta.proximo.nome}
              </InfoMeta>
              <InfoMeta label="Falta para o próximo nível" mono>
                {brlCent(meta.proximo.falta)}
              </InfoMeta>
              <InfoMeta label="Ao chegar">
                {num(meta.proximo.comissaoPct, 1)}% de premiação
                {meta.proximo.bonus > 0 && <span className="block text-[12px] font-semibold text-t2">+ {brlCent(meta.proximo.bonus)} de bônus</span>}
              </InfoMeta>
            </div>
          ) : (
            <p className="text-[12.5px] font-semibold text-ok">Chegou ao último nível da meta.</p>
          )}
          {grupo && meta.grupo && (
            <p className="mt-2.5 text-[11.5px] text-t2">
              Meta por grupo: o grupo <span className="font-semibold text-t1">{meta.grupo}</span> sobe de nível junto, pela soma das vendas.
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
  titulo,
  detalhe,
  meta,
  turnoFiltro,
  periodo,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  titulo?: string;
  detalhe: TeamMemberDetail | null;
  meta?: SellerGoalLevel;
  turnoFiltro: string | null;
  periodo: string;
  onClose: () => void;
}) {
  const cmp = detalhe?.comparativo;
  const turno = detalhe?.turno ?? TEAM_SEM_TURNO;
  const subtitulo = detalhe
    ? [detalhe.lojas.length === 1 ? detalhe.lojas[0] : detalhe.lojas.length > 1 ? `${detalhe.lojas.length} lojas` : "", turno, periodo]
        .filter(Boolean)
        .join(" · ")
    : "";
  const base = turnoFiltro ? `do grupo ${turnoFiltro}` : "da equipe";
  return (
    <Modal open={open} onClose={onClose} title={detalhe?.nome ?? titulo} size="lg">
      {loading ? (
        <DetalheSkeleton />
      ) : !detalhe ? (
        <div className="flex min-h-[220px] flex-col">
          <EmptyBlock />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="-mt-1 text-[12px] font-semibold text-t2">{subtitulo}</p>

          <div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <MetricaDetalhe label="Faturamento" valor={brlCent(detalhe.faturamento)} delta={cmp?.faturamento} />
              <MetricaDetalhe label="Nº de vendas" valor={num(detalhe.vendas)} delta={cmp?.vendas} />
              <MetricaDetalhe label="Ticket médio" valor={brlCent(detalhe.averageTicket)} delta={cmp?.ticket} />
              <MetricaDetalhe
                label="P.A."
                valor={detalhe.pa == null ? "—" : num(detalhe.pa, 2)}
                delta={cmp?.pa}
                tip="Média de itens por venda."
              />
              <MetricaDetalhe label="Itens vendidos" valor={detalhe.pa == null ? "—" : num(detalhe.itens)} />
              <MetricaDetalhe
                label="Participação"
                valor={pctFmt(detalhe.participacaoPct)}
                tip={`Participação da pessoa no faturamento ${base} no período.`}
              />
            </div>
            <p className="mt-2.5 text-[11.5px] text-t2">
              {cmp
                ? `Variação ${tipRelacao(cmp.vs).replace(/^Em/, "em")}`
                : "Sem vendas no período anterior para comparar."}
              {detalhe.pa == null && " P.A. e itens vendidos ficam indisponíveis quando faltam dados de itens no período."}
            </p>
          </div>

          {meta && <SecaoMeta meta={meta} />}

          {detalhe.serie && (
            <section>
              <h4 className="mb-2 text-[13px] font-bold text-t0">
                Faturamento {detalhe.serieGranularidade === "mes" ? "por mês" : "por dia"}
              </h4>
              <AreaLineChart
                data={detalhe.serie.map((d) => d.faturamento)}
                labels={detalhe.serie.map((d) => d.label)}
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
