import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { paths } from "@/router/paths";
import { Card, CardHeader, CardTitle, StatCard, DateRangePicker, PageHeader, Button, Badge, Pagination, ThSort, type SortDir } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { AreaLineChart, DonutChart } from "@/components/charts";
import { scopeFilterKey, useScope } from "@/pages/dashboard/useScope";
import {
  buildFinanceView,
  financeFetchRange,
  productsFetchRange,
  resolvePeriod,
  type FinanceAggInput,
  type FinanceKpi,
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
import { fetchInformedCents } from "@/data/wedash/shoppingRepo";
import { ProductsWithoutCostNotice } from "@/pages/dashboard/ProductsWithoutCostNotice";
import type { SalesHourAgg } from "@/data/wedash/salesTypes";
import { calendarTodayIso } from "@/data/wedash/clock";
import { isOwner } from "@/layout/nav-wedash";
import { queryStoreIds } from "@/data/wedash/stores";
import { useActiveSession } from "@/session/SessionProvider";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useMonthFill } from "@/pages/dashboard/useMonthFill";
import { useDeepHistoryFill } from "@/pages/dashboard/useDeepHistoryFill";
import { MonthFillNotice, pickerMinDate } from "@/pages/dashboard/MonthFillNotice";
import { DeepHistoryNotice } from "@/pages/dashboard/DeepHistoryNotice";
import { InitialSyncNotice } from "@/pages/dashboard/InitialSyncNotice";
import { StoreHoursNotice } from "@/pages/dashboard/StoreHoursNotice";
import { ErpStatusNotice } from "@/pages/dashboard/ErpStatusNotice";
import { ExportDialog } from "@/components/wedash/ExportDialog";
import { ReportHeader, useExportPdf } from "@/pages/dashboard/ReportHeader";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { FinanceSkeleton } from "@/components/wedash/LoadingSkeletons";
import { useFilterSkeleton } from "@/lib/useFilterSkeleton";
import { brlCent, isoToDate, labelUpper, deltaTip, num } from "@/lib/format";
import { usePagedRows } from "@/lib/usePagedRows";
import { cn } from "@/lib/cn";
import { QuickStat } from "@/pages/dashboards/QuickStat";
import type { DateRange, DateRangeChangeMeta } from "@/components/ui/DateRangePicker";
import {
  applyPeriodDateChange,
  dateRangeFromPeriod,
  periodActivePresetId,
  periodDisplayLabel,
} from "@/pages/dashboard/periodPicker";

/** Icones dos KPIs  -  Faturamento/CMV iguais a Visao Geral; Lucro/Margem proprios. */
const IconRevenue = () => (
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
const IconProfit = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <polyline points="16 7 22 7 22 13" />
  </svg>
);
const IconMargin = () => (
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
function PriorPeriodBadge({ delta }: { delta?: { value: string; positive: boolean; vs?: string; diff?: string; previous?: string } }) {
  if (!delta) return null;
  const badge = (
    <Badge variant={delta.positive ? "success" : "danger"}>
      {delta.positive ? "+" : "−"}
      {delta.value}
    </Badge>
  );
  const tip = deltaTip(delta);
  return tip ? <Tooltip label={tip}>{badge}</Tooltip> : badge;
}

const KPI_ICONS = [IconRevenue, IconCmv, IconProfit, IconMargin];

/** Lucro, margem e CMV ficam só com o Gestor. */
const STRATEGIC_KPI = new Set(["CMV", "Lucro bruto", "Margem", "CMV WPINK", "Lucro bruto WPINK", "Margem WPINK"]);

/** Mesma paleta da Visao Geral: Faturamento, CMV, Lucro, Margem. */
const KPI_COLORS = [
  { iconColor: "var(--acc)", iconBg: "var(--acc-soft)" },
  { iconColor: "var(--warn)", iconBg: "rgba(245,158,11,0.12)" },
  { iconColor: "var(--ok)", iconBg: "var(--ok-soft)" },
  { iconColor: "var(--info)", iconBg: "rgba(59,130,246,0.12)" },
];

type EvoSort = "month" | "revenue" | "cost" | "profit" | "margin" | "ticket";

/** Hierarquia visual no padrao Income statement (ProfitLoss). */
function costRowStyle(line: FixedCostRow): { bold: boolean; indent: boolean; color?: string; text: string } {
  if (line.isResult) {
    return {
      bold: true,
      indent: false,
      color: line.amount < 0 ? "var(--bad)" : "var(--acc)",
      text: brlCent(line.amount),
    };
  }
  if (line.isTotal) {
    return { bold: true, indent: false, text: `−${brlCent(line.amount)}` };
  }
  if (line.label === "Lucro bruto") {
    return { bold: true, indent: false, color: "var(--ok)", text: brlCent(line.amount) };
  }
  return { bold: false, indent: true, text: `−${brlCent(line.amount)}` };
}

export default function FinancePage() {
  const session = useActiveSession();
  const costs = isOwner(session.role);
  const navigate = useNavigate();
  const { scope, setScope } = useScope();
  const exportPdf = useExportPdf("Financeiro");
  const [aggs, setAggs] = useState<FinanceAggInput>({ dayAggs: [] });
  const [coverageFrom, setCoverageFrom] = useState<Date | null>(null);
  const filterKey = scopeFilterKey(scope);
  const { pending, showSkeleton, settle } = useFilterSkeleton(filterKey);
  // Catalogo de lojas (horario/custos) hidratado depois do 1 render  ->  recalcula.
  const [storesTick, setStoresTick] = useState(0);
  const [evoSort, setEvoSort] = useState<EvoSort>("month");
  const [evoDir, setEvoDir] = useState<SortDir>("asc");
  useEffect(() => {
    const onStores = () => setStoresTick((n) => n + 1);
    window.addEventListener("wedash:stores", onStores);
    return () => window.removeEventListener("wedash:stores", onStores);
  }, []);

  /** So a leitura mais recente aplica setState. */
  const reloadGen = useRef(0);
  const reload = useCallback(async () => {
    const gen = ++reloadGen.current;
    const key = filterKey;
    const period = resolvePeriod(scope.period, calendarTodayIso());
    const range = financeFetchRange(scope);
    const costRange = productsFetchRange(scope);
    const storeIds = queryStoreIds(session.role, scope.storeIds, session.stores);
    try {
      const [dayAggs, hourAggs, prevHourAggs, paymentDayAggs, productCostDayAggs, cov, informedCents] = await Promise.all([
        fetchSalesDayAggs({ tenantId: session.tenantId, storeIds, from: range.from, to: range.to, brand: null }),
        period.start === period.end
          ? fetchSalesHourAggs({ tenantId: session.tenantId, storeIds, day: period.start, brand: null })
          : Promise.resolve([] as SalesHourAgg[]),
        range.prevHourDay
          ? fetchSalesHourAggs({ tenantId: session.tenantId, storeIds, day: range.prevHourDay, brand: null })
          : Promise.resolve([] as SalesHourAgg[]),
        fetchSalesPaymentDayAggs({ tenantId: session.tenantId, storeIds, from: period.start, to: period.end }),
        fetchSalesProductCostDayAggs({ tenantId: session.tenantId, storeIds, from: costRange.from, to: costRange.to }),
        fetchSalesCoverage(session.tenantId, storeIds),
        fetchInformedCents(session.tenantId, storeIds, range.from, range.to).catch(() => ({})),
      ]);
      const productNames = await fetchProductNames(
        productCostDayAggs
          .filter((r) => r.day >= period.start && r.day <= period.end && r.revenueCents > 0 && r.cmvCents === 0)
          .map((r) => r.productCode),
      );
      if (gen !== reloadGen.current) return;
      setAggs({ dayAggs, hourAggs, prevHourAggs, paymentDayAggs, productCostDayAggs, productNames, informedCents });
      setCoverageFrom(cov.from ? isoToDate(cov.from) : null);
      settle(key);
    } catch (e) {
      if (gen !== reloadGen.current) return;
      console.error("Finance reload:", e);
      settle(key);
    }
  }, [scope, session.role, session.stores, session.tenantId, filterKey, settle]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onSynced = () => void reload();
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [reload]);

  const view = useMemo(
    () => buildFinanceView({ ...scope, division: null }, aggs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, aggs, storesTick],
  );

  const evoRows = useMemo(() => {
    const rows = view.monthlyEvolution.map((r, order) => ({ ...r, order }));
    const dir = evoDir === "asc" ? 1 : -1;
    const value = (r: (typeof rows)[number]) => {
      if (evoSort === "month") return r.order;
      if (evoSort === "revenue") return r.revenue;
      if (evoSort === "cost") return r.cost;
      if (evoSort === "profit") return r.profit;
      if (evoSort === "margin") return r.marginPct;
      return r.averageTicket;
    };
    return [...rows].sort((a, b) => (value(a) - value(b)) * dir || a.order - b.order);
  }, [view.monthlyEvolution, evoSort, evoDir]);

  const evoTotal = useMemo(() => {
    let revenue = 0;
    let cost = 0;
    let profit = 0;
    let sales = 0;
    for (const r of view.monthlyEvolution) {
      revenue += r.revenue;
      cost += r.cost;
      profit += r.profit;
      sales += r.salesCount;
    }
    return {
      count: view.monthlyEvolution.length,
      revenue,
      cost,
      profit,
      marginPct: revenue > 0 ? (profit / revenue) * 100 : 0,
      averageTicket: sales > 0 ? revenue / sales : 0,
    };
  }, [view.monthlyEvolution]);

  const evoPage = usePagedRows(evoRows, `${filterKey}|${evoSort}|${evoDir}`);

  function toggleEvoSort(key: EvoSort) {
    if (evoSort === key) {
      setEvoDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setEvoSort(key);
      setEvoDir(key === "month" ? "asc" : "desc");
    }
  }

  // Resolve o DateRange a partir do escopo  -  sempre mostra algo selecionado.
  const dateRange = useMemo(() => dateRangeFromPeriod(scope.period), [scope.period]);
  const kpis = costs ? view.kpis : view.kpis.filter((kpi) => !STRATEGIC_KPI.has(kpi.label));
  const kpisWpink = costs ? view.kpisWpink : view.kpisWpink.filter((kpi) => !STRATEGIC_KPI.has(kpi.label));
  const currentPeriod = resolvePeriod(scope.period, calendarTodayIso());
  const monthFill = useMonthFill();
  const deepHistoryFill = useDeepHistoryFill();
  function onDateChange(r: DateRange, goal?: DateRangeChangeMeta) {
    setScope(applyPeriodDateChange(scope, r, goal));
  }

  return (
    <div className="flex flex-col p-4 sm:p-6 print:p-0">
      <ReportHeader />
      <PageHeader
        crumbs={[{ label: "Dashboard", to: "/dashboard/visao-geral" }, { label: "Financeiro" }]}
        title="Financeiro"
        subtitle={costs ? "Acompanhe faturamento, custos, margens e resultado da operação." : "Acompanhe o faturamento e as vendas da operação."}
        actions={
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
              <DateRangePicker
                value={dateRange}
                onChange={onDateChange}
                displayLabel={periodDisplayLabel(scope.period)}
                activePresetId={periodActivePresetId(scope.period)}
                minDate={pickerMinDate(coverageFrom, monthFill)}
              />
              <ExportDialog formats={["pdf"]} onExport={() => exportPdf()} />
            </div>
          </div>
        }
      />

      <ErpStatusNotice />
      <InitialSyncNotice />
      <MonthFillNotice fill={monthFill} start={currentPeriod.start} end={currentPeriod.end} />
      <DeepHistoryNotice
        fill={deepHistoryFill}
        monthFill={monthFill}
        start={currentPeriod.start}
        end={currentPeriod.end}
      />
      <StoreHoursNotice />
      {costs && !pending && (
        <ProductsWithoutCostNotice
          products={view.productsWithoutCost}
          storeIds={scope.storeIds}
          from={currentPeriod.start}
          to={currentPeriod.end}
        />
      )}

      {showSkeleton ? (
        <FinanceSkeleton />
      ) : (
      <>

      {/* KPI row  -  4 cards. Gerente fica sem CMV, lucro e margem. */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi, i) => (
          <KpiCard key={kpi.label} kpi={kpi} Icon={KPI_ICONS[i]} colorIdx={i} />
        ))}
      </div>

      {/* Quick stats WPINK  -  so quando a loja (ou rede) tem a marca */}
      {kpisWpink.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpisWpink.map((kpi, i) => {
            const Icon = KPI_ICONS[i] ?? IconRevenue;
            return (
              <QuickStat
                key={kpi.label}
                label={kpi.label}
                value={kpi.amount}
                icon={<Icon />}
                tint={kpi.tint}
                tooltip={kpi.tooltip}
                sub={kpi.sub}
                badge={<PriorPeriodBadge delta={kpi.delta} />}
              />
            );
          })}
        </div>
      )}

      {/* Par: CMV/Lucro + Resultado operacional. Só o Gestor. */}
      {costs && (
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(() => {
          const series = view.costProfitSeries;
          const totalProfit = series.reduce((s, m) => s + m.profit, 0);
          const totalCmv = series.reduce((s, m) => s + m.cost, 0);
          const totalRevenue = series.reduce((s, m) => s + m.revenue, 0);
          const marginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
          const deltaProfit = view.kpis.find((k) => k.label === "Lucro bruto")?.delta;
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
                      <PriorPeriodBadge delta={deltaProfit} />
                    </div>
                  </div>
                  {totalRevenue > 0 && (
                  <>
                  <p className="mt-0.5 text-[11px] font-semibold text-t2">{view.seriesLabel}</p>
                  <div className="mt-2.5 flex flex-wrap gap-5">
                    <div>
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                        <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--ok)]" />Lucro bruto
                      </span>
                      <p className="mt-0.5 font-mono text-base font-extrabold text-t0">{brlCent(totalProfit)}</p>
                    </div>
                    <div>
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                        <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--bad)]" />CMV
                      </span>
                      <p className="mt-0.5 font-mono text-base font-extrabold text-t0">{brlCent(totalCmv)}</p>
                    </div>
                    <div>
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">Margem</span>
                      <p className="mt-0.5 font-mono text-base font-extrabold text-t0">{marginPct.toFixed(1)}%</p>
                    </div>
                  </div>
                  </>
                  )}
                </div>
              </div>
              {totalRevenue === 0 ? (
                <EmptyBlock />
              ) : (
                <AreaLineChart
                  data={series.map((m) => (m.future ? null : m.profit))}
                  compareData={series.map((m) => (m.future ? null : m.cost))}
                  labels={series.map((m) => m.label)}
                  tooltipLabels={series.map((m) => m.rangeLabel)}
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
          const series = view.operatingResult;
          const totalProfit = series.reduce((s, m) => s + m.profit, 0);
          const totalRes = series.reduce((s, m) => s + m.result, 0);
          const totalRevenue = series.reduce((s, m) => s + m.revenue, 0);
          const operatingMarginPct = totalRevenue > 0 ? (totalRes / totalRevenue) * 100 : 0;
          const tipResult = view.resultIsProrated
            ? "Em períodos curtos, os custos mensais são distribuídos proporcionalmente por dia ou por hora."
            : "Valor que permanece após descontar do lucro bruto os custos da operação.";
          return (
            <Card padding="lg" className="flex flex-col">
              <div className="mb-4">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <CardTitle>Resultado operacional</CardTitle>
                      <TipHelp label={tipResult} />
                    </div>
                    <div className="shrink-0">
                      <PriorPeriodBadge delta={view.resultDelta} />
                    </div>
                  </div>
                  {totalRevenue > 0 && (
                  <>
                  <p className="mt-0.5 text-[11px] font-semibold text-t2">{view.seriesLabel}</p>
                  <div className="mt-2.5 flex flex-wrap gap-5">
                    <div>
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                        <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--ok)]" />Lucro bruto
                      </span>
                      <p className="mt-0.5 font-mono text-base font-extrabold text-t0">{brlCent(totalProfit)}</p>
                    </div>
                    <div>
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">
                        <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--acc)]" />Resultado operacional
                      </span>
                      <p className="mt-0.5 font-mono text-base font-extrabold text-t0">{brlCent(totalRes)}</p>
                    </div>
                    <div>
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-t1">Margem operacional</span>
                      <p className="mt-0.5 font-mono text-base font-extrabold text-t0">{operatingMarginPct.toFixed(1)}%</p>
                    </div>
                  </div>
                  </>
                  )}
                </div>
              </div>
              {totalRevenue === 0 ? (
                <EmptyBlock />
              ) : (
                <AreaLineChart
                  data={series.map((m) => (m.future ? null : m.profit))}
                  compareData={series.map((m) => (m.future ? null : m.result))}
                  labels={series.map((m) => m.label)}
                  tooltipLabels={series.map((m) => m.rangeLabel)}
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
      )}

      {/* Custos antes de Formas (leitura natural apos Resultado / margem op.).
          Com WPINK no escopo: 3 colunas (Custos | Formas | Marcas); senao 2.
          Gerente não vê o card de custos. */}
      <div
        className={cn(
          "mt-4 grid grid-cols-1 gap-4",
          costs && view.revenueByBrand ? "lg:grid-cols-3" : costs || view.revenueByBrand ? "lg:grid-cols-2" : undefined,
        )}
      >
        {costs && (
        <Card className="flex flex-col">
          <CardHeader>
            <div className="flex items-center gap-1.5">
              <CardTitle>Custos da operação</CardTitle>
              <TipHelp label="Veja os custos descontados do lucro bruto para chegar ao resultado operacional." />
            </div>
          </CardHeader>
          {!view.costsConfigured ? (
            <EmptyBlock
              icon="🧾"
              title="Custos não configurados"
              description="Configure franquia e aluguel para acompanhar o resultado operacional."
              action={
                <Button size="sm" onClick={() => navigate(paths.operation.royalties)}>
                  Configurar custos
                </Button>
              }
            />
          ) : view.franchiseFixedCosts.every((l) => l.amount === 0) ? (
            <EmptyBlock />
          ) : (
          <div className="px-4">
            {view.franchiseFixedCosts.map((line) => {
              const estilo = costRowStyle(line);
              return (
                <div key={line.label} className="flex items-center justify-between border-b border-line py-3 last:border-b-0">
                  <span
                    className={cn(
                      estilo.bold ? "text-sm font-extrabold text-t0" : "text-[13px] font-semibold",
                      estilo.indent ? "pl-4 text-t2 sm:pl-5" : "text-t0",
                    )}
                  >
                    {line.label}
                  </span>
                  <span
                    className={cn("font-mono tabular-nums", estilo.bold ? "text-[15px] font-extrabold" : "text-[13.5px] font-bold")}
                    style={{ color: estilo.color ?? "var(--t0)" }}
                  >
                    {estilo.text}
                  </span>
                </div>
              );
            })}
          </div>
          )}
        </Card>
        )}

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Formas de pagamento</CardTitle>
          </CardHeader>
          {view.paymentMethods.length === 0 ? (
            <EmptyBlock />
          ) : (
            (() => {
              const sum = view.paymentMethods.reduce((s, f) => s + f.amount, 0);
              const total = sum || 1;
              return (
                <div className="flex flex-1 flex-col justify-center px-4 pb-4">
                  <div className="mx-auto my-2">
                    <DonutChart
                      segments={view.paymentMethods.map((f) => ({
                        label: labelUpper(f.method),
                        value: f.amount,
                        color: f.color,
                      }))}
                      centerLabel="Total"
                      centerValue={brlCent(sum)}
                    />
                  </div>
                  <div className="mt-2 flex flex-col gap-2">
                    {view.paymentMethods.map((f) => {
                      const pct = Math.round((f.amount / total) * 100);
                      return (
                        <div key={f.method} className="flex items-center gap-2.5">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: f.color }} />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-t1">{labelUpper(f.method)}</span>
                          <span className="shrink-0 font-mono text-[12.5px] font-bold text-t0">{brlCent(f.amount)}</span>
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

        {view.revenueByBrand && (
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle>Faturamento por marca</CardTitle>
            </CardHeader>
            {view.revenueByBrand.length === 0 ? (
              <EmptyBlock />
            ) : (
              (() => {
                const sum = view.revenueByBrand.reduce((s, m) => s + m.amount, 0);
                const total = sum || 1;
                return (
                  <div className="flex flex-1 flex-col justify-center px-4 pb-4">
                    <div className="mx-auto my-2">
                      <DonutChart
                        segments={view.revenueByBrand.map((m) => ({
                          label: m.brand,
                          value: m.amount,
                          color: m.color,
                        }))}
                        centerLabel="Total"
                        centerValue={brlCent(sum)}
                      />
                    </div>
                    <div className="mt-2 flex flex-col gap-2">
                      {view.revenueByBrand.map((m) => {
                        const pct = Math.round((m.amount / total) * 100);
                        return (
                          <div key={m.brand} className="flex items-center gap-2.5">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: m.color }} />
                            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-t1">{m.brand}</span>
                            <span className="shrink-0 font-mono text-[12.5px] font-bold text-t0">{brlCent(m.amount)}</span>
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

      {/* Evolucao mensal: mesma lista do Estoque (tabela + Total do filtro), no celular tambem. */}
      {view.showMonthlyEvolution && (
      <Card className="mt-4 flex min-w-0 flex-col overflow-hidden">
        <div className="mb-4">
          <CardTitle>Evolução mensal</CardTitle>
          {view.monthlyEvolution.length > 0 && (
            <p className="mt-0.5 text-[11px] font-semibold text-t2">{view.monthlyEvolutionLabel}</p>
          )}
        </div>

        {view.monthlyEvolution.length === 0 ? (
          <EmptyBlock />
        ) : (
        <>
        <div className="min-w-0 overflow-x-auto">
          <table className={cn("w-full border-collapse text-sm", costs ? "min-w-[760px]" : "min-w-[480px]")}>
            <thead>
              <tr className="border-b border-line text-[11px] tracking-wide text-t2">
                <th className="w-11 whitespace-nowrap px-1 pb-3 text-center font-bold">#</th>
                <ThSort label="Mês" active={evoSort === "month"} dir={evoDir} onClick={() => toggleEvoSort("month")} align="left" className="px-1 pb-3" />
                <ThSort label="Faturamento" active={evoSort === "revenue"} dir={evoDir} onClick={() => toggleEvoSort("revenue")} className="px-1 pb-3" />
                {costs && <ThSort label="CMV" active={evoSort === "cost"} dir={evoDir} onClick={() => toggleEvoSort("cost")} className="px-1 pb-3" />}
                {costs && <ThSort label="Lucro bruto" active={evoSort === "profit"} dir={evoDir} onClick={() => toggleEvoSort("profit")} className="px-1 pb-3" />}
                {costs && <ThSort label="Margem" active={evoSort === "margin"} dir={evoDir} onClick={() => toggleEvoSort("margin")} className="px-1 pb-3" />}
                <ThSort label="Ticket médio" active={evoSort === "ticket"} dir={evoDir} onClick={() => toggleEvoSort("ticket")} className="px-1 pb-3" />
              </tr>
            </thead>
            <tbody>
              {evoPage.pageRows.map((line, i) => {
                const idx = (evoPage.page - 1) * evoPage.pageSize + i;
                return (
                  <tr key={line.label} className="border-b border-line">
                    <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{idx + 1}</td>
                    <td className="px-1 py-3 text-[13px] font-bold text-t0">{line.label}</td>
                    <td className="px-1 py-3 text-right"><Mono v={brlCent(line.revenue)} /></td>
                    {costs && <td className="px-1 py-3 text-right"><Mono v={brlCent(line.cost)} /></td>}
                    {costs && <td className="px-1 py-3 text-right"><Mono v={brlCent(line.profit)} tone={line.profit < 0 ? "text-bad" : "text-ok"} /></td>}
                    {costs && <td className="px-1 py-3 text-right"><Mono v={`${line.marginPct.toFixed(1)}%`} /></td>}
                    <td className="px-1 py-3 text-right"><Mono v={brlCent(line.averageTicket)} /></td>
                  </tr>
                );
              })}
              <tr className="bg-bg-inset">
                <td />
                <td className="px-1 py-3 text-[13px] font-extrabold text-t0">
                  Total do filtro
                  <span className="mt-0.5 block text-[11px] font-semibold text-t2">
                    {countNoun(evoTotal.count, "mês", "meses")}
                  </span>
                </td>
                <td className="px-1 py-3 text-right"><Mono v={brlCent(evoTotal.revenue)} total /></td>
                {costs && <td className="px-1 py-3 text-right"><Mono v={brlCent(evoTotal.cost)} total /></td>}
                {costs && (
                <td className="px-1 py-3 text-right">
                  <Mono v={brlCent(evoTotal.profit)} total tone={evoTotal.profit < 0 ? "text-bad" : "text-ok"} />
                </td>
                )}
                {costs && <td className="px-1 py-3 text-right"><Mono v={`${evoTotal.marginPct.toFixed(1)}%`} total /></td>}
                <td className="px-1 py-3 text-right"><Mono v={brlCent(evoTotal.averageTicket)} total /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <span className="text-[12.5px] text-t2">
            Mostrando {evoPage.pageRows.length} de {countNoun(evoTotal.count, "mês", "meses")}
          </span>
          {evoPage.totalPages > 1 && <Pagination page={evoPage.page} totalPages={evoPage.totalPages} onChange={evoPage.setPage} />}
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

function countNoun(n: number, one: string, many: string) {
  return `${num(n)} ${n === 1 ? one : many}`;
}

function Mono({ v, total = false, tone = "text-t0" }: { v: string; total?: boolean; tone?: string }) {
  return <span className={cn("whitespace-nowrap font-mono text-[13px] tabular-nums", total ? "font-extrabold" : "font-bold", tone)}>{v}</span>;
}

/** StatCard wrapper com tooltip ? e sparkline de tendencia. */
function KpiCard({ kpi, Icon, colorIdx = 0 }: { kpi: FinanceKpi; Icon: () => React.JSX.Element; colorIdx?: number }) {
  const c = KPI_COLORS[colorIdx % KPI_COLORS.length];
  return (
    <StatCard
      label={kpi.label}
      value={kpi.value}
      icon={<Icon />}
      iconColor={c.iconColor}
      iconBg={c.iconBg}
      delta={kpi.delta}
      sub={kpi.sub}
      tooltip={kpi.tooltip}
    />
  );
}