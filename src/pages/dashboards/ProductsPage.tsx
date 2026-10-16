import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Badge, Card, CardHeader, CardTitle, StatCard, DateRangePicker, PageHeader, Button, Pagination, ThSort, type SortDir } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { TABLE_PAGE_SIZE } from "@/lib/usePagedRows";
import { BarChart, DonutChart } from "@/components/charts";
import { scopeFilterKey, useScope } from "@/pages/dashboard/useScope";
import {
  buildProductsView,
  resolvePeriod,
  TOP_CARD_SIZE,
  type AbcClass,
  type ProductItemRow,
  type ProductLineRow,
  type ProductsAggInput,
  type ProductsKpi,
} from "@/data/wedash/dashboard";
import { fetchSalesCoverage } from "@/data/wedash/salesRepo";
import { ProductNameCell } from "@/components/wedash/ProductNameCell";
import {
  BadgeVsPrevious,
  TipHelp,
  fetchProductsAggInput,
  moneyOrDash,
  pctFmt,
  useProductDetail,
} from "@/pages/dashboard/ProductDetail";
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
import { usePrintMode } from "@/lib/printMode";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { ProductsWithoutCostNotice } from "@/pages/dashboard/ProductsWithoutCostNotice";
import { ProductsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { useFilterSkeleton } from "@/lib/useFilterSkeleton";
import { brlCent, isoToDate, num, comparedWithTip } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { DateRange, DateRangeChangeMeta } from "@/components/ui/DateRangePicker";
import {
  applyPeriodDateChange,
  dateRangeFromPeriod,
  periodActivePresetId,
  periodDisplayLabel,
} from "@/pages/dashboard/periodPicker";

/** Icones dos KPIs  -  Fat/Lucro/Margem iguais ao Financeiro; Itens proprio da tela. */
const IconRevenue = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
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
const IconItems = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);
const KPI_ICONS = [IconRevenue, IconProfit, IconMargin, IconItems];

/** Heroes por metrica: Fat/Lucro/Margem iguais ao Financeiro; Itens = warn. */
const KPI_COLORS = [
  { iconColor: "var(--acc)", iconBg: "var(--acc-soft)" },
  { iconColor: "var(--ok)", iconBg: "var(--ok-soft)" },
  { iconColor: "var(--info)", iconBg: "rgba(59,130,246,0.12)" },
  { iconColor: "var(--warn)", iconBg: "rgba(245,158,11,0.12)" },
];

type SortKey = "name" | "revenue" | "items" | "cmv" | "profit" | "marginPct" | "variationPct";
type TopProdSort = "name" | "items" | "revenue" | "profit" | "margin";

const COLORS_ABC: Record<AbcClass, string> = {
  A: "var(--bad)",
  B: "var(--warn)",
  C: "var(--ok)",
};

const filterInputClass =
  "h-8 rounded-[var(--radius-vela-sm)] border border-line bg-bg-3 px-3 text-xs font-semibold text-t0 transition-colors hover:border-acc focus:border-acc focus:outline-none";

const colorProfit = (v: number | null) => (v == null ? "text-t2" : v < 0 ? "text-bad" : "text-ok");

function Variation({ v }: { v: number | null }) {
  if (v == null) return <span className="text-t2">—</span>;
  const r = Math.round(v);
  return (
    <span className="font-bold" style={{ color: r >= 0 ? "var(--ok)" : "var(--bad)" }}>
      {r >= 0 ? "+" : ""}
      {r}%
    </span>
  );
}

export default function ProductsPage() {
  const session = useActiveSession();
  const { scope, setScope } = useScope();
  const [aggs, setAggs] = useState<ProductsAggInput>({ dayAggs: [] });
  const [coverageFrom, setCoverageFrom] = useState<Date | null>(null);
  const filterKey = scopeFilterKey(scope);
  const { pending, showSkeleton, settle } = useFilterSkeleton(filterKey);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [topProdSort, setTopProdSort] = useState<TopProdSort>("revenue");
  const [topProdDir, setTopProdDir] = useState<SortDir>("desc");
  const [topLineSort, setTopLineSort] = useState<TopProdSort>("revenue");
  const [topLineDir, setTopLineDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const printing = usePrintMode();
  const exportValue = useExportPdf("Produtos");
  // Catalogo de lojas (custos/impostos) hidratado depois do 1 render  ->  recalcula.
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
    const key = filterKey;
    try {
      const [next, cov] = await Promise.all([
        fetchProductsAggInput(session.tenantId, scope),
        fetchSalesCoverage(session.tenantId, scope.storeIds),
      ]);
      if (gen !== reloadGen.current) return;
      setAggs(next);
      setCoverageFrom(cov.from ? isoToDate(cov.from) : null);
      settle(key);
    } catch (e) {
      if (gen !== reloadGen.current) return;
      console.error("Products reload:", e);
      settle(key);
    }
  }, [scope, session.tenantId, filterKey, settle]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onSynced = () => void reload();
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [reload]);

  const view = useMemo(
    () => buildProductsView(scope, aggs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, aggs, storesTick],
  );

  const dateRange = useMemo(() => dateRangeFromPeriod(scope.period), [scope.period]);
  const currentPeriod = resolvePeriod(scope.period, calendarTodayIso());
  const monthFill = useMonthFill();
  const deepHistoryFill = useDeepHistoryFill();
  function onDateChange(r: DateRange, goal?: DateRangeChangeMeta) {
    setScope(applyPeriodDateChange(scope, r, goal));
  }

  // A metrica escolhe quais entram (sempre os maiores); a direcao so reordena esses.
  // "Produto" (nome) reordena o Top por faturamento.
  const topProducts = useMemo(() => {
    const metric = (p: ProductItemRow) =>
      topProdSort === "items"
        ? p.items
        : topProdSort === "profit"
          ? (p.profit ?? -Infinity)
          : topProdSort === "margin"
            ? (p.marginPct ?? -Infinity)
            : p.revenue;
    const top = [...view.products].sort((a, b) => metric(b) - metric(a) || b.revenue - a.revenue).slice(0, TOP_CARD_SIZE);
    if (topProdSort === "name") {
      const dir = topProdDir === "asc" ? 1 : -1;
      return top.sort((a, b) => a.name.localeCompare(b.name, "pt-BR") * dir);
    }
    return topProdDir === "asc" ? top.reverse() : top;
  }, [view.products, topProdSort, topProdDir]);

  function toggleTopProdSort(key: TopProdSort) {
    if (topProdSort === key) {
      setTopProdDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTopProdSort(key);
      setTopProdDir(key === "name" ? "asc" : "desc");
    }
  }

  // Mesma regra do Top produtos: a metrica escolhe as linhas; a direcao so reordena.
  const topLines = useMemo(() => {
    const metric = (l: ProductLineRow) =>
      topLineSort === "items"
        ? l.items
        : topLineSort === "profit"
          ? (l.profit ?? -Infinity)
          : topLineSort === "margin"
            ? (l.marginPct ?? -Infinity)
            : l.revenue;
    const top = [...view.lines].sort((a, b) => metric(b) - metric(a) || b.revenue - a.revenue).slice(0, TOP_CARD_SIZE);
    if (topLineSort === "name") {
      const dir = topLineDir === "asc" ? 1 : -1;
      return top.sort((a, b) => a.name.localeCompare(b.name, "pt-BR") * dir);
    }
    return topLineDir === "asc" ? top.reverse() : top;
  }, [view.lines, topLineSort, topLineDir]);

  function toggleTopLineSort(key: TopProdSort) {
    if (topLineSort === key) {
      setTopLineDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTopLineSort(key);
      setTopLineDir(key === "name" ? "asc" : "desc");
    }
  }

  const tableLines = useMemo(() => {
    let list = view.products;
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name, "pt-BR") * dir;
      const va = a[sortKey];
      const vb = b[sortKey];
      // Sem dado (" - ") sempre no fim, nas duas direcoes.
      if (va == null && vb == null) return b.revenue - a.revenue;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }, [view.products, search, sortKey, sortDir]);

  const tableTotal = useMemo(() => {
    const revenue = tableLines.reduce((s, p) => s + p.revenue, 0);
    const items = tableLines.reduce((s, p) => s + p.items, 0);
    const complete = tableLines.length > 0 && tableLines.every((p) => p.cmv != null);
    const cmv = complete ? tableLines.reduce((s, p) => s + (p.cmv ?? 0), 0) : null;
    const profit = complete ? tableLines.reduce((s, p) => s + (p.profit ?? 0), 0) : null;
    const revenueCmp = tableLines.reduce((s, p) => s + p.revenueCmp, 0);
    const revenuePrev = tableLines.reduce((s, p) => s + p.revenuePrev, 0);
    return {
      revenue,
      items,
      cmv,
      profit,
      variationPct: revenueCmp > 0 && revenuePrev > 0 ? ((revenueCmp - revenuePrev) / revenuePrev) * 100 : null,
      marginPct: profit != null && revenue > 0 ? (profit / revenue) * 100 : null,
    };
  }, [tableLines]);

  const pageSize = TABLE_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(tableLines.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = printing ? tableLines : tableLines.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, sortKey, sortDir, scope]);

  const detailData = useMemo(() => ({ aggs, view }), [aggs, view]);
  const { open, modal: detailModal } = useProductDetail({ scope, data: detailData });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  const totalCategories = view.categories.reduce((s, c) => s + c.revenue, 0);
  const tipVariation = `Faturamento do produto ${comparedWithTip(view.vsVariation).replace(/^Em/, "em").replace(/\.$/, "")}.`;
  const tipVariationTotal = `Faturamento total dos produtos do filtro ${comparedWithTip(view.vsVariation).replace(/^Em/, "em")}`;
  const tipCmvProduct = view.hasCostProduct
    ? "Acompanhe faturamento, CMV, lucro bruto e margem de cada produto no período.\n\nQuando aparecer “—”, faltam dados de custo para calcular o indicador corretamente."
    : "O CMV por produto não está disponível para este período.";

  return (
    <div className="flex flex-col p-4 sm:p-6 print:p-0">
      <ReportHeader />
      <PageHeader
        crumbs={[{ label: "Dashboard", to: "/dashboard/visao-geral" }, { label: "Produtos" }]}
        title="Produtos"
        subtitle="Acompanhe vendas, margem e desempenho dos produtos."
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
              <Button variant="primary" onClick={exportValue}>
                Exportar
              </Button>
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
      {!pending && (
        <ProductsWithoutCostNotice
          products={view.productsWithoutCost}
          storeIds={scope.storeIds}
          from={currentPeriod.start}
          to={currentPeriod.end}
        />
      )}

      {showSkeleton ? (
        <ProductsSkeleton />
      ) : (
      <>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {view.kpis.map((kpi, i) => (
          <KpiCard key={kpi.label} kpi={kpi} Icon={KPI_ICONS[i] ?? IconRevenue} colorIdx={i} />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card padding="lg" className="flex flex-col">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Faturamento por categoria</CardTitle>
              {view.categories.length > 0 && (
                <p className="mt-1.5 font-mono text-2xl font-extrabold text-t0">{brlCent(totalCategories)}</p>
              )}
            </div>
            {view.categories.length > 0 && <BadgeVsPrevious delta={view.deltaCategories} metric="Faturamento das categorias" />}
          </div>
          {view.categories.length === 0 ? (
            <EmptyBlock />
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[420px]">
                <BarChart
                  data={view.categories.map((c) => ({ label: c.name, value: c.revenue }))}
                  height={220}
                  formatValue={brlCent}
                  onSelect={(_, i) => {
                    const c = view.categories[i];
                    if (c) open({ kind: "category", categoryId: c.categoryId, name: c.name });
                  }}
                />
              </div>
            </div>
          )}
        </Card>

        <Card padding="lg" className="flex flex-col">
          <div className="mb-1 flex items-center gap-1.5">
            <CardTitle>Curva ABC por categoria</CardTitle>
            <TipHelp label={"Classifica as categorias pela participação acumulada no faturamento:\nClasse A: até 80%\nClasse B: de 80% a 95%\nClasse C: restante"} />
          </div>
          {view.curveAbcCategories.items.length === 0 ? (
            <EmptyBlock />
          ) : (
            (() => {
              const classes = view.curveAbcCategories.summary.filter((r) => r.revenue > 0);
              const total = classes.reduce((s, r) => s + r.revenue, 0) || 1;
              return (
                <div className="flex flex-1 flex-col justify-center px-1 pb-1 pt-3">
                  <div className="mx-auto my-2">
                    <DonutChart
                      segments={classes.map((r) => ({
                        label: `Classe ${r.productClass}`,
                        value: r.revenue,
                        color: COLORS_ABC[r.productClass],
                      }))}
                      centerLabel="Total"
                      centerValue={brlCent(total)}
                    />
                  </div>
                  <div className="mt-2 flex flex-col gap-1">
                    {classes.map((r) => {
                      const pct = Math.round((r.revenue / total) * 100);
                      const names = view.curveAbcCategories.items.filter((i) => i.productClass === r.productClass).map((i) => i.name);
                      return (
                        <button
                          key={r.productClass}
                          type="button"
                          onClick={() => open({ kind: "class", productClass: r.productClass })}
                          className="-mx-2 flex items-start gap-2.5 rounded-[var(--radius-vela-sm)] px-2 py-1.5 text-left transition-colors hover:bg-bg-3"
                        >
                          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: COLORS_ABC[r.productClass] }} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="text-[12.5px] font-semibold text-t1">Classe {r.productClass}</span>
                              <span className="ml-auto shrink-0 font-mono text-[12.5px] font-bold text-t0">{brlCent(r.revenue)}</span>
                              <span className="min-w-[32px] shrink-0 text-right text-[11.5px] font-semibold text-t2">{pct}%</span>
                            </div>
                            <p className="mt-0.5 text-[11.5px] leading-snug text-t2">{names.join(" · ")}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader>
            <div className="flex items-center gap-1.5">
              <CardTitle>Top linhas de produto</CardTitle>
              <TipHelp label={"Agrupa produtos da mesma linha, mesmo quando existem em diferentes tipos, como colônia, body splash, body cream ou roll-on.\n\nExemplo: Obsessed, Obsessed Deluxe e Obsessed Intense pertencem à linha OBSESSED."} />
            </div>
            <Badge variant="accent">Top {TOP_CARD_SIZE}</Badge>
          </CardHeader>
          {topLines.length === 0 ? (
            <EmptyBlock />
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
                  <th className="px-1 pb-3 text-left font-bold">#</th>
                  <ThSort label="Linha" active={topLineSort === "name"} dir={topLineDir} onClick={() => toggleTopLineSort("name")} align="left" className="px-1 pb-3" />
                  <ThSort label="Itens vendidos" active={topLineSort === "items"} dir={topLineDir} onClick={() => toggleTopLineSort("items")} className="px-1 pb-3" />
                  <ThSort label="Faturamento" active={topLineSort === "revenue"} dir={topLineDir} onClick={() => toggleTopLineSort("revenue")} className="px-1 pb-3" />
                  <ThSort label="Lucro bruto" active={topLineSort === "profit"} dir={topLineDir} onClick={() => toggleTopLineSort("profit")} className="px-1 pb-3" />
                  <ThSort label="Margem" active={topLineSort === "margin"} dir={topLineDir} onClick={() => toggleTopLineSort("margin")} className="px-1 pb-3" />
                </tr>
              </thead>
              <tbody>
                {topLines.map((l, idx) => (
                  <tr
                    key={l.name}
                    tabIndex={0}
                    onClick={() => open({ kind: "line", name: l.name })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        open({ kind: "line", name: l.name });
                      }
                    }}
                    className="cursor-pointer border-b border-line transition-colors last:border-b-0 hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none"
                  >
                    <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{idx + 1}</td>
                    <td className="px-1 py-3">
                      <ProductNameCell
                        name={l.name}
                        idx={idx}
                        sub={
                          <Tooltip label={l.kinds.join(" · ")}>
                            <p className="truncate text-[11px] text-t2">
                              {l.products} produto{l.products === 1 ? "" : "s"} · {l.kinds.length} tipo{l.kinds.length === 1 ? "" : "s"}
                            </p>
                          </Tooltip>
                        }
                      />
                    </td>
                    <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{num(l.items)}</td>
                    <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(l.revenue)}</td>
                    <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", colorProfit(l.profit))}>{moneyOrDash(l.profit)}</td>
                    <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", l.marginPct == null ? "text-t2" : "text-ok")}>
                      {pctFmt(l.marginPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Top produtos</CardTitle>
            <Badge variant="accent">Top {TOP_CARD_SIZE}</Badge>
          </CardHeader>
          {topProducts.length === 0 ? (
            <EmptyBlock />
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
                  <th className="px-1 pb-3 text-left font-bold">#</th>
                  <ThSort label="Produto" active={topProdSort === "name"} dir={topProdDir} onClick={() => toggleTopProdSort("name")} align="left" className="px-1 pb-3" />
                  <ThSort label="Itens vendidos" active={topProdSort === "items"} dir={topProdDir} onClick={() => toggleTopProdSort("items")} className="px-1 pb-3" />
                  <ThSort label="Faturamento" active={topProdSort === "revenue"} dir={topProdDir} onClick={() => toggleTopProdSort("revenue")} className="px-1 pb-3" />
                  <ThSort label="Lucro bruto" active={topProdSort === "profit"} dir={topProdDir} onClick={() => toggleTopProdSort("profit")} className="px-1 pb-3" />
                  <ThSort label="Margem" active={topProdSort === "margin"} dir={topProdDir} onClick={() => toggleTopProdSort("margin")} className="px-1 pb-3" />
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p, idx) => (
                  <tr
                    key={p.rowKey}
                    tabIndex={0}
                    onClick={() => open({ kind: "product", rowKey: p.rowKey, name: p.name })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        open({ kind: "product", rowKey: p.rowKey, name: p.name });
                      }
                    }}
                    className="cursor-pointer border-b border-line transition-colors last:border-b-0 hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none"
                  >
                    <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{idx + 1}</td>
                    <td className="px-1 py-3">
                      <ProductNameCell name={p.name} idx={idx} sub={p.code} />
                    </td>
                    <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{num(p.items)}</td>
                    <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(p.revenue)}</td>
                    <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", colorProfit(p.profit))}>{moneyOrDash(p.profit)}</td>
                    <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", p.marginPct == null ? "text-t2" : "text-ok")}>
                      {pctFmt(p.marginPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </Card>
      </div>

      {/* Desempenho por produto  -  mesma lista do Top produtos; clique abre o detalhe */}
      <Card className="mt-4 flex flex-col">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex items-center gap-1.5">
            <CardTitle>Desempenho por produto</CardTitle>
            <TipHelp label={tipCmvProduct} />
          </div>
          {view.products.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <input
              type="search"
              placeholder="Buscar por produto ou código…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(filterInputClass, "sm:w-56")}
            />
          </div>
          )}
        </div>

        {tableLines.length === 0 ? (
          view.products.length === 0 ? (
            <EmptyBlock />
          ) : (
            <EmptyBlock
              icon="🔍"
              title="Nenhum produto encontrado"
              description="Tente buscar por outro nome ou código."
              action={
                <Button variant="outline" size="sm" onClick={() => setSearch("")}>
                  Limpar busca
                </Button>
              }
            />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
                  <th className="px-1 pb-3 text-left font-bold">#</th>
                  <ThSort label="Produto" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} align="left" className="px-1 pb-3" />
                  <ThSort label="Itens vendidos" active={sortKey === "items"} dir={sortDir} onClick={() => toggleSort("items")} className="px-1 pb-3" />
                  <ThSort label="Faturamento" active={sortKey === "revenue"} dir={sortDir} onClick={() => toggleSort("revenue")} className="px-1 pb-3" />
                  <ThSort label="CMV" active={sortKey === "cmv"} dir={sortDir} onClick={() => toggleSort("cmv")} className="px-1 pb-3" />
                  <ThSort label="Lucro bruto" active={sortKey === "profit"} dir={sortDir} onClick={() => toggleSort("profit")} className="px-1 pb-3" />
                  <ThSort label="Margem" active={sortKey === "marginPct"} dir={sortDir} onClick={() => toggleSort("marginPct")} className="px-1 pb-3" />
                  <ThSort label="Variação" active={sortKey === "variationPct"} dir={sortDir} onClick={() => toggleSort("variationPct")} className="px-1 pb-3" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p, i) => {
                  const idx = printing ? i : (pageSafe - 1) * pageSize + i;
                  return (
                    <tr
                      key={p.rowKey}
                      tabIndex={0}
                      onClick={() => open({ kind: "product", rowKey: p.rowKey, name: p.name })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          open({ kind: "product", rowKey: p.rowKey, name: p.name });
                        }
                      }}
                      className="cursor-pointer border-b border-line transition-colors hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none"
                    >
                      <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{idx + 1}</td>
                      <td className="px-1 py-3">
                        <ProductNameCell name={p.name} idx={idx} sub={p.code} />
                      </td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{num(p.items)}</td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(p.revenue)}</td>
                      <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", p.cmv == null ? "text-t2" : "text-t0")}>{moneyOrDash(p.cmv)}</td>
                      <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", colorProfit(p.profit))}>{moneyOrDash(p.profit)}</td>
                      <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", p.marginPct == null ? "text-t2" : "text-ok")}>
                        {pctFmt(p.marginPct)}
                      </td>
                      <td className="px-1 py-3 text-right font-mono text-[13px]">
                        <Tooltip label={tipVariation}>
                          <span>
                            <Variation v={p.variationPct} />
                          </span>
                        </Tooltip>
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-bg-inset">
                  <td />
                  <td className="px-1 py-3 text-[13px] font-extrabold text-t0">
                    <span className="inline-flex items-center gap-1">
                      Total do filtro
                      <TipHelp label="Soma todos os produtos encontrados no filtro, inclusive os que não aparecem nesta página." />
                    </span>
                    <span className="mt-0.5 block text-[11px] font-semibold text-t2">
                      {num(tableLines.length)} produto{tableLines.length === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{num(tableTotal.items)}</td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{brlCent(tableTotal.revenue)}</td>
                  <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-extrabold", tableTotal.cmv == null ? "text-t2" : "text-t0")}>
                    {moneyOrDash(tableTotal.cmv)}
                  </td>
                  <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-extrabold", colorProfit(tableTotal.profit))}>
                    {moneyOrDash(tableTotal.profit)}
                  </td>
                  <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-extrabold", tableTotal.marginPct == null ? "text-t2" : "text-ok")}>
                    {pctFmt(tableTotal.marginPct)}
                  </td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold">
                    <Tooltip label={tipVariationTotal}>
                      <span>
                        <Variation v={tableTotal.variationPct} />
                      </span>
                    </Tooltip>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {tableLines.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
            <span className="text-[12.5px] text-t2">
              Mostrando {pageRows.length} de {num(tableLines.length)} produtos
            </span>
            {totalPages > 1 && <Pagination page={pageSafe} totalPages={totalPages} onChange={setPage} />}
          </div>
        )}
      </Card>
      </>
      )}

      {detailModal}
    </div>
  );
}

function KpiCard({ kpi, Icon, colorIdx = 0 }: { kpi: ProductsKpi; Icon: () => React.JSX.Element; colorIdx?: number }) {
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
