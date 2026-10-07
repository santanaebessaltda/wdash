import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { paths } from "@/router/paths";
import { Card, CardHeader, CardTitle, StatCard, DateRangePicker, PageHeader, Button, DataTable, Badge, type DataTableColumn } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { AreaLineChart, DonutChart } from "@/components/charts";
import { useScope } from "@/pages/dashboard/useScope";
import {
  buildFinanceView,
  financeFetchRange,
  productsFetchRange,
  resolvePeriod,
  type FinanceAggInput,
  type FinanceKpi,
  type MonthlyEvolutionRow,
  type FixedCostRow,
} from "@/data/wedash/dashboard";
import {
  fetchSalesCoverage,
  fetchSalesDayAggs,
  fetchSalesHourAggs,
  fetchSalesPaymentDayAggs,
  fetchSalesProductCostDayAggs,
  fetchProductNames,
} from "@/data/wedash/salesRepo";
import { ProductsWithoutCostNotice } from "@/pages/dashboard/ProductsWithoutCostNotice";
import type { SalesHourAgg } from "@/data/wedash/salesTypes";
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
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { FinanceSkeleton } from "@/components/wedash/LoadingSkeletons";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { brlCent, deIso, labelUpper, tipDelta } from "@/lib/format";
import { cn } from "@/lib/cn";
import { TINT } from "@/pages/dashboards/icons";
import type { DateRange, DateRangeChangeMeta } from "@/components/ui/DateRangePicker";
import {
  applyPeriodDateChange,
  dateRangeFromPeriod,
  periodActivePresetId,
  periodDisplayLabel,
} from "@/pages/dashboard/periodPicker";

/** Icones dos KPIs  -  Faturamento/CMV iguais a Visao Geral; Lucro/Margem proprios. */
const IconFat = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);
const IconCmv = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="21" r="1" />
    <circle cx="19" cy="21" r="1" />
    <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
  </svg>
);
const IconLucro = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <polyline points="16 7 22 7 22 13" />
  </svg>
);
const IconMargem = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="5" x2="5" y2="19" />
    <circle cx="6.5" cy="6.5" r="2.5" />
    <circle cx="17.5" cy="17.5" r="2.5" />
  </svg>
);

const TipHelp = ({ label }: { label: string }) => (
  <Tooltip label={label}>
    <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 hover:text-t1 transition-colors">
      ?
    </span>
  </Tooltip>
);

/** Badge de delta  -  so % no chip; base do comparativo no tooltip (igual StatCard). */
function BadgeVsAnterior({ delta }: { delta?: { value: string; positive: boolean; vs?: string; diff?: string; anterior?: string } }) {
  if (!delta) return null;
  const badge = (
    <Badge variant={delta.positive ? "success" : "danger"}>
      {delta.positive ? "+" : "−"}
      {delta.value}
    </Badge>
  );
  const tip = tipDelta(delta);
  return tip ? <Tooltip label={tip}>{badge}</Tooltip> : badge;
}

const KPI_ICONS = [IconFat, IconCmv, IconLucro, IconMargem];

/** Mesma paleta da Visao Geral: Faturamento, CMV, Lucro, Margem. */
const KPI_COLORS = [
  { iconColor: "var(--acc)", iconBg: "var(--acc-soft)" },
  { iconColor: "var(--warn)", iconBg: "rgba(245,158,11,0.12)" },
  { iconColor: "var(--ok)", iconBg: "var(--ok-soft)" },
  { iconColor: "var(--info)", iconBg: "rgba(59,130,246,0.12)" },
];

const evolucaoColumns: DataTableColumn<MonthlyEvolutionRow>[] = [
  {
    key: "mes",
    header: "Mês",
    sortable: true,
    sortValue: (r) => r.mes,
    render: (r) => <span className="font-bold text-t0">{r.mes}</span>,
  },
  {
    key: "faturamento",
    header: "Faturamento",
    align: "right",
    sortable: true,
    sortValue: (r) => r.faturamento,
    render: (r) => <span className="font-semibold tabular-nums">{brlCent(r.faturamento)}</span>,
  },
  {
    key: "cmv",
    header: "CMV",
    align: "right",
    hideBelow: "sm",
    sortable: true,
    sortValue: (r) => r.custo,
    render: (r) => <span className="tabular-nums text-t1">{brlCent(r.custo)}</span>,
  },
  {
    key: "lucro",
    header: "Lucro bruto",
    align: "right",
    sortable: true,
    sortValue: (r) => r.lucro,
    render: (r) => <span className="font-extrabold tabular-nums text-ok">{brlCent(r.lucro)}</span>,
  },
  {
    key: "margem",
    header: "Margem",
    align: "right",
    hideBelow: "md",
    sortable: true,
    sortValue: (r) => r.margemPct,
    render: (r) => <span className="tabular-nums text-t1">{r.margemPct.toFixed(1)}%</span>,
  },
  {
    key: "ticket",
    header: "Ticket médio",
    align: "right",
    hideBelow: "md",
    sortable: true,
    sortValue: (r) => r.ticketMedio,
    render: (r) => <span className="tabular-nums text-t1">{brlCent(r.ticketMedio)}</span>,
  },
];

/** Hierarquia visual no padrao Income statement (ProfitLoss). */
function estiloLinhaCusto(linha: FixedCostRow): { bold: boolean; indent: boolean; color?: string; valor: string } {
  if (linha.ehResultado) {
    return {
      bold: true,
      indent: false,
      color: linha.valor < 0 ? "var(--bad)" : "var(--acc)",
      valor: brlCent(linha.valor),
    };
  }
  if (linha.ehTotal) {
    return { bold: true, indent: false, valor: `−${brlCent(linha.valor)}` };
  }
  if (linha.rotulo === "Lucro bruto") {
    return { bold: true, indent: false, color: "var(--ok)", valor: brlCent(linha.valor) };
  }
  return { bold: false, indent: true, valor: `−${brlCent(linha.valor)}` };
}

export default function FinancePage() {
  const session = useActiveSession();
  const navigate = useNavigate();
  const { escopo, mudar } = useScope();
  const [aggs, setAggs] = useState<FinanceAggInput>({ dayAggs: [] });
  const [coverageFrom, setCoverageFrom] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinSkeleton(loading);
  // Catalogo de lojas (horario/custos) hidratado depois do 1 render  ->  recalcula.
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
    const periodo = resolvePeriod(escopo.periodo, calendarTodayIso());
    const range = financeFetchRange(escopo);
    const costRange = productsFetchRange(escopo);
    const storeIds = escopo.filialIds;
    try {
      const [dayAggs, hourAggs, prevHourAggs, paymentDayAggs, productCostDayAggs, cov] = await Promise.all([
        fetchSalesDayAggs({ tenantId: session.tenantId, storeIds, from: range.from, to: range.to, brand: null }),
        periodo.inicio === periodo.fim
          ? fetchSalesHourAggs({ tenantId: session.tenantId, storeIds, day: periodo.inicio, brand: null })
          : Promise.resolve([] as SalesHourAgg[]),
        range.prevHourDay
          ? fetchSalesHourAggs({ tenantId: session.tenantId, storeIds, day: range.prevHourDay, brand: null })
          : Promise.resolve([] as SalesHourAgg[]),
        fetchSalesPaymentDayAggs({ tenantId: session.tenantId, storeIds, from: periodo.inicio, to: periodo.fim }),
        fetchSalesProductCostDayAggs({ tenantId: session.tenantId, storeIds, from: costRange.from, to: costRange.to }),
        fetchSalesCoverage(session.tenantId, storeIds),
      ]);
      const productNames = await fetchProductNames(
        productCostDayAggs
          .filter((r) => r.day >= periodo.inicio && r.day <= periodo.fim && r.revenueCents > 0 && r.cmvCents === 0)
          .map((r) => r.productCode),
      );
      if (gen !== reloadGen.current) return;
      setAggs({ dayAggs, hourAggs, prevHourAggs, paymentDayAggs, productCostDayAggs, productNames });
      setCoverageFrom(cov.from ? deIso(cov.from) : null);
    } catch (e) {
      if (gen !== reloadGen.current) return;
      console.error("Finance reload:", e);
    }
  }, [escopo, session.tenantId]);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  useEffect(() => {
    const onSynced = () => void reload();
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [reload]);

  const view = useMemo(
    () => buildFinanceView({ ...escopo, divisao: null }, aggs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [escopo, aggs, storesTick],
  );

  // Resolve o DateRange a partir do escopo  -  sempre mostra algo selecionado.
  const dateRange = useMemo(() => dateRangeFromPeriod(escopo.periodo), [escopo.periodo]);
  const periodoAtual = resolvePeriod(escopo.periodo, calendarTodayIso());
  const monthFill = useMonthFill();
  const deepHistoryFill = useDeepHistoryFill();
  const exportar = useExportPdf("Financeiro");
  function onDateChange(r: DateRange, meta?: DateRangeChangeMeta) {
    mudar(applyPeriodDateChange(escopo, r, meta));
  }

  return (
    <div className="flex flex-col p-4 sm:p-6 print:p-0">
      <ReportHeader />
      <PageHeader
        crumbs={[{ label: "Dashboard", to: "/dashboard/visao-geral" }, { label: "Financeiro" }]}
        title="Financeiro"
        subtitle="Acompanhe faturamento, custos, margens e resultado da operação."
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
              <Button variant="secondary" onClick={exportar}>
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
      {!loading && (
        <ProductsWithoutCostNotice
          produtos={view.produtosSemCusto}
          storeIds={escopo.filialIds}
          from={periodoAtual.inicio}
          to={periodoAtual.fim}
        />
      )}

      {showSkeleton ? (
        <FinanceSkeleton />
      ) : (
      <>

      {/* KPI row  -  4 cards */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {view.kpis.map((kpi, i) => (
          <KpiCard key={kpi.label} kpi={kpi} Icon={KPI_ICONS[i]} colorIdx={i} />
        ))}
      </div>

      {/* Quick stats WPINK  -  so quando a loja (ou rede) tem a marca */}
      {view.kpisWpink.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {view.kpisWpink.map((kpi, i) => {
            const Icon = KPI_ICONS[i] ?? IconFat;
            const tint = TINT[kpi.tint];
            return (
              <Card key={kpi.label} padding="sm" className="flex items-center gap-3.5">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
                  style={{ background: tint.bg, color: tint.fg }}
                >
                  <Icon />
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-t2">
                    {kpi.label}
                    {kpi.tooltip ? (
                      <Tooltip label={kpi.tooltip} side="bottom">
                        <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 hover:text-t1 transition-colors">
                          ?
                        </span>
                      </Tooltip>
                    ) : null}
                  </p>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                    <p className="truncate font-mono text-lg font-extrabold text-t0">{kpi.valor}</p>
                    <BadgeVsAnterior delta={kpi.delta} />
                  </div>
                  {kpi.sub ? <p className="text-[11px] text-t2">{kpi.sub}</p> : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Par: CMV/Lucro + Resultado operacional */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(() => {
          const serie = view.custoLucroMargem;
          const totalLucro = serie.reduce((s, m) => s + m.lucro, 0);
          const totalCmv = serie.reduce((s, m) => s + m.custo, 0);
          const totalFat = serie.reduce((s, m) => s + m.faturamento, 0);
          const margemPct = totalFat > 0 ? (totalLucro / totalFat) * 100 : 0;
          const deltaLucro = view.kpis.find((k) => k.label === "Lucro bruto")?.delta;
          return (
            <Card padding="lg" className="flex flex-col">
              <div className="mb-4">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <CardTitle>CMV, lucro e margem</CardTitle>
                      <TipHelp label="Compare a evolução do CMV e do lucro bruto e acompanhe a margem do período." />
                    </div>
                    <div className="shrink-0">
                      <BadgeVsAnterior delta={deltaLucro} />
                    </div>
                  </div>
                  {totalFat > 0 && (
                  <>
                  <p className="mt-0.5 text-[11px] font-semibold text-t2">{view.rotuloSerie}</p>
                  <div className="mt-2.5 flex flex-wrap gap-5">
                    <div>
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                        <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--ok)]" />Lucro bruto
                      </span>
                      <p className="mt-0.5 font-mono text-base font-extrabold text-t0">{brlCent(totalLucro)}</p>
                    </div>
                    <div>
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                        <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--bad)]" />CMV
                      </span>
                      <p className="mt-0.5 font-mono text-base font-extrabold text-t0">{brlCent(totalCmv)}</p>
                    </div>
                    <div>
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">Margem</span>
                      <p className="mt-0.5 font-mono text-base font-extrabold text-t0">{margemPct.toFixed(1)}%</p>
                    </div>
                  </div>
                  </>
                  )}
                </div>
              </div>
              {totalFat === 0 ? (
                <EmptyBlock />
              ) : (
                <AreaLineChart
                  data={serie.map((m) => (m.futuro ? null : m.lucro))}
                  compareData={serie.map((m) => (m.futuro ? null : m.custo))}
                  labels={serie.map((m) => m.mes)}
                  tooltipLabels={serie.map((m) => m.faixa)}
                  color="var(--ok)"
                  compareColor="var(--bad)"
                  formatValue={brlCent}
                  showAxisLabels
                />
              )}
            </Card>
          );
        })()}

        {(() => {
          const serie = view.resultadoOperacional;
          const totalLucro = serie.reduce((s, m) => s + m.lucro, 0);
          const totalRes = serie.reduce((s, m) => s + m.resultado, 0);
          const totalFat = serie.reduce((s, m) => s + m.faturamento, 0);
          const margemOpPct = totalFat > 0 ? (totalRes / totalFat) * 100 : 0;
          const tipResultado = view.resultadoRateado
            ? "Em períodos curtos, os custos mensais são distribuídos proporcionalmente por dia ou por hora."
            : "Valor que permanece após descontar do lucro bruto os custos da operação.";
          return (
            <Card padding="lg" className="flex flex-col">
              <div className="mb-4">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <CardTitle>Resultado operacional</CardTitle>
                      <TipHelp label={tipResultado} />
                    </div>
                    <div className="shrink-0">
                      <BadgeVsAnterior delta={view.deltaResultado} />
                    </div>
                  </div>
                  {totalFat > 0 && (
                  <>
                  <p className="mt-0.5 text-[11px] font-semibold text-t2">{view.rotuloSerie}</p>
                  <div className="mt-2.5 flex flex-wrap gap-5">
                    <div>
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                        <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--ok)]" />Lucro bruto
                      </span>
                      <p className="mt-0.5 font-mono text-base font-extrabold text-t0">{brlCent(totalLucro)}</p>
                    </div>
                    <div>
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                        <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--acc)]" />Resultado operacional
                      </span>
                      <p className="mt-0.5 font-mono text-base font-extrabold text-t0">{brlCent(totalRes)}</p>
                    </div>
                    <div>
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">Margem operacional</span>
                      <p className="mt-0.5 font-mono text-base font-extrabold text-t0">{margemOpPct.toFixed(1)}%</p>
                    </div>
                  </div>
                  </>
                  )}
                </div>
              </div>
              {totalFat === 0 ? (
                <EmptyBlock />
              ) : (
                <AreaLineChart
                  data={serie.map((m) => (m.futuro ? null : m.lucro))}
                  compareData={serie.map((m) => (m.futuro ? null : m.resultado))}
                  labels={serie.map((m) => m.mes)}
                  tooltipLabels={serie.map((m) => m.faixa)}
                  color="var(--ok)"
                  compareColor="var(--acc)"
                  formatValue={brlCent}
                  showAxisLabels
                />
              )}
            </Card>
          );
        })()}
      </div>

      {/* Custos antes de Formas (leitura natural apos Resultado / margem op.).
          Com WPINK no escopo: 3 colunas (Custos | Formas | Marcas); senao 2. */}
      <div
        className={cn(
          "mt-4 grid grid-cols-1 gap-4",
          view.faturamentoPorMarca ? "lg:grid-cols-3" : "lg:grid-cols-2",
        )}
      >
        <Card className="flex flex-col">
          <CardHeader>
            <div className="flex items-center gap-1.5">
              <CardTitle>Custos da operação</CardTitle>
              <TipHelp label="Veja os custos descontados do lucro bruto para chegar ao resultado operacional." />
            </div>
          </CardHeader>
          {!view.custosConfigurados ? (
            <EmptyBlock
              icon="🧾"
              title="Custos não configurados"
              description="Configure franquia e aluguel para acompanhar o resultado operacional."
              action={
                <Button size="sm" onClick={() => navigate(paths.operation.franchise)}>
                  Configurar custos
                </Button>
              }
            />
          ) : view.custosFixosFranquia.every((l) => l.valor === 0) ? (
            <EmptyBlock />
          ) : (
          <div className="px-4 pb-4">
            {view.custosFixosFranquia.map((linha) => {
              const estilo = estiloLinhaCusto(linha);
              return (
                <div key={linha.rotulo} className="flex items-center justify-between border-b border-line py-3 last:border-b-0">
                  <span
                    className={cn(
                      estilo.bold ? "text-sm font-extrabold text-t0" : "text-[13px] font-semibold",
                      estilo.indent ? "pl-4 text-t2 sm:pl-5" : "text-t0",
                    )}
                  >
                    {linha.rotulo}
                  </span>
                  <span
                    className={cn("font-mono tabular-nums", estilo.bold ? "text-[15px] font-extrabold" : "text-[13.5px] font-bold")}
                    style={{ color: estilo.color ?? "var(--t0)" }}
                  >
                    {estilo.valor}
                  </span>
                </div>
              );
            })}
          </div>
          )}
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Formas de pagamento</CardTitle>
          </CardHeader>
          {view.formasPagamento.length === 0 ? (
            <EmptyBlock />
          ) : (
            (() => {
              const total = view.formasPagamento.reduce((s, f) => s + f.valor, 0) || 1;
              return (
                <div className="flex flex-1 flex-col justify-center px-4 pb-4">
                  <div className="mx-auto my-2">
                    <DonutChart
                      segments={view.formasPagamento.map((f) => ({
                        label: labelUpper(f.forma),
                        value: f.valor,
                        color: f.cor,
                      }))}
                      centerLabel="Total"
                      centerValue={brlCent(total)}
                    />
                  </div>
                  <div className="mt-2 flex flex-col gap-2">
                    {view.formasPagamento.map((f) => {
                      const pct = Math.round((f.valor / total) * 100);
                      return (
                        <div key={f.forma} className="flex items-center gap-2.5">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: f.cor }} />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-t1">{labelUpper(f.forma)}</span>
                          <span className="shrink-0 font-mono text-[12.5px] font-bold text-t0">{brlCent(f.valor)}</span>
                          <span className="min-w-[32px] shrink-0 text-right text-[11.5px] font-semibold text-t2">{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          )}
        </Card>

        {view.faturamentoPorMarca && (
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle>Faturamento por marca</CardTitle>
            </CardHeader>
            {view.faturamentoPorMarca.length === 0 ? (
              <EmptyBlock />
            ) : (
              (() => {
                const total = view.faturamentoPorMarca.reduce((s, m) => s + m.valor, 0) || 1;
                return (
                  <div className="flex flex-1 flex-col justify-center px-4 pb-4">
                    <div className="mx-auto my-2">
                      <DonutChart
                        segments={view.faturamentoPorMarca.map((m) => ({
                          label: m.marca,
                          value: m.valor,
                          color: m.cor,
                        }))}
                        centerLabel="Total"
                        centerValue={brlCent(total)}
                      />
                    </div>
                    <div className="mt-2 flex flex-col gap-2">
                      {view.faturamentoPorMarca.map((m) => {
                        const pct = Math.round((m.valor / total) * 100);
                        return (
                          <div key={m.marca} className="flex items-center gap-2.5">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: m.cor }} />
                            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-t1">{m.marca}</span>
                            <span className="shrink-0 font-mono text-[12.5px] font-bold text-t0">{brlCent(m.valor)}</span>
                            <span className="min-w-[32px] shrink-0 text-right text-[11.5px] font-semibold text-t2">{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()
            )}
          </Card>
        )}
      </div>

      {/* Evolucao Mensal  -  so com periodo por mes (>31 dias); DataTable (desktop) + cards (mobile) */}
      {view.mostrarEvolucaoMensal && (
      <Card className="mt-4" padding="none">
        <div className="flex items-center gap-1.5 px-5 py-4">
          <div>
            <CardTitle>Evolução mensal</CardTitle>
            {view.evolucaoMensal.length > 0 && (
              <p className="mt-0.5 text-[11px] font-semibold text-t2">{view.rotuloEvolucaoMensal}</p>
            )}
          </div>
        </div>

        {view.evolucaoMensal.length === 0 ? (
          <EmptyBlock />
        ) : (
        <>
        {/* Desktop / tablet  -  DataTable Vela */}
        <div className="hidden p-4 md:block">
          <DataTable columns={evolucaoColumns} data={view.evolucaoMensal} rowKey={(r) => r.mes} paginate="meses" />
        </div>

        {/* Mobile  -  stack em cards (padrao Responsive Tables) */}
        <div className="flex flex-col gap-2.5 p-3.5 md:hidden">
          {view.evolucaoMensal.map((linha) => (
              <div key={linha.mes} className="rounded-xl border border-line bg-bg-inset p-3.5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[13.5px] font-bold text-t0">{linha.mes}</p>
                  <div className="text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-t2">Lucro bruto</p>
                    <span className="text-[13px] font-extrabold tabular-nums text-ok">{brlCent(linha.lucro)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-2.5 text-[11.5px]">
                  <div className="flex justify-between gap-2">
                    <span className="text-t2">Faturamento</span>
                    <span className="font-semibold tabular-nums text-t0">{brlCent(linha.faturamento)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-t2">CMV</span>
                    <span className="font-semibold tabular-nums text-t0">{brlCent(linha.custo)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-t2">Margem</span>
                    <span className="font-semibold tabular-nums text-t0">{linha.margemPct.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-t2">Ticket médio</span>
                    <span className="font-semibold tabular-nums text-t0">{brlCent(linha.ticketMedio)}</span>
                  </div>
                </div>
              </div>
            ))}
        </div>
        </>
        )}
      </Card>
      )}
      </>
      )}
    </div>
  );
}

/** StatCard wrapper com tooltip ? e sparkline de tendencia. */
function KpiCard({ kpi, Icon, colorIdx = 0 }: { kpi: FinanceKpi; Icon: () => React.JSX.Element; colorIdx?: number }) {
  const c = KPI_COLORS[colorIdx % KPI_COLORS.length];
  return (
    <StatCard
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
}