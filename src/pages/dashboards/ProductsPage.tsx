import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Card, CardTitle, StatCard, DateRangePicker, PageHeader, Button, Pagination, ThSort, type SortDir } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { TABLE_PAGE_SIZE } from "@/lib/usePagedRows";
import { BarChart, DonutChart } from "@/components/charts";
import { scopeFilterKey, useScope } from "@/pages/dashboard/useScope";
import {
  buildProductsView,
  resolvePeriod,
  type AbcClass,
  type ProductLineRow,
  type ProductsAggInput,
  type ProductsKpi,
} from "@/data/wedash/dashboard";
import { fetchSalesCoverage } from "@/data/wedash/salesRepo";
import { queryStoreIds } from "@/data/wedash/stores";
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
import { ExportDialog } from "@/components/wedash/ExportDialog";
import { ReportHeader, useExportPdf } from "@/pages/dashboard/ReportHeader";
import { usePrintMode } from "@/lib/printMode";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { ProductsWithoutCostNotice } from "@/pages/dashboard/ProductsWithoutCostNotice";
import { ProductsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { useFilterSkeleton } from "@/lib/useFilterSkeleton";
import { brlCent, isoToDate, num, comparedWithTip, profitBrl } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { DateRange, DateRangeChangeMeta } from "@/components/ui/DateRangePicker";
import { PALETTE, PRODUCT_AVATAR_TONES, kpiTone, profitText, variationColor } from "@/pages/dashboard/palette";
import {
  applyPeriodDateChange,
  dateRangeFromPeriod,
  periodActivePresetId,
  periodDisplayLabel,
} from "@/pages/dashboard/periodPicker";

const SCROLL_TABLE = "w-full min-w-[820px] border-collapse text-sm";

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

type SortKey = "name" | "revenue" | "items" | "cmv" | "profit" | "marginPct" | "variationPct";

function lineCmv(line: ProductLineRow): number | null {
  return line.profit == null ? null : line.revenue - line.profit;
}

const COLORS_ABC: Record<AbcClass, string> = {
  A: PALETTE.pink,
  B: PALETTE.purple,
  C: PALETTE.blue,
};

const filterInputClass =
  "h-8 rounded-[var(--radius-vela-sm)] border border-line bg-bg-inset px-3 text-xs font-semibold text-t0 transition-colors hover:border-acc focus:border-acc focus:outline-none";

function Variation({ v }: { v: number | null }) {
  if (v == null) return <span className="text-t2">—</span>;
  const r = Math.round(v);
  return (
    <span className="font-bold" style={{ color: variationColor(r) }}>
      {r >= 0 ? "+" : ""}
      {r}%
    </span>
  );
}

export default function ProductsPage() {
  const session = useActiveSession();
  const { scope, setScope } = useScope();
  const exportPdf = useExportPdf("Produtos");
  const [aggs, setAggs] = useState<ProductsAggInput>({ dayAggs: [] });
  const [coverageFrom, setCoverageFrom] = useState<Date | null>(null);
  const filterKey = scopeFilterKey(scope);
  const { pending, showSkeleton, settle } = useFilterSkeleton(filterKey);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [lineSearch, setLineSearch] = useState("");
  const [lineSortKey, setLineSortKey] = useState<SortKey>("revenue");
  const [lineSortDir, setLineSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [linePage, setLinePage] = useState(1);
  const printing = usePrintMode();
  // Catalogo de lojas (custos) hidratado depois do 1 render  ->  recalcula.
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
        fetchProductsAggInput(session.tenantId, scope, queryStoreIds(session.role, scope.storeIds, session.stores)),
        fetchSalesCoverage(session.tenantId, queryStoreIds(session.role, scope.storeIds, session.stores)),
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

  const lineRows = useMemo(() => {
    let list = view.lines;
    const q = lineSearch.trim().toLowerCase();
    if (q) list = list.filter((l) => l.name.toLowerCase().includes(q));
    const dir = lineSortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (lineSortKey === "name") return a.name.localeCompare(b.name, "pt-BR") * dir;
      const va = lineSortKey === "cmv" ? lineCmv(a) : a[lineSortKey];
      const vb = lineSortKey === "cmv" ? lineCmv(b) : b[lineSortKey];
      if (va == null && vb == null) return b.revenue - a.revenue;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }, [view.lines, lineSearch, lineSortKey, lineSortDir]);

  const lineTotal = useMemo(() => {
    const revenue = lineRows.reduce((s, l) => s + l.revenue, 0);
    const items = lineRows.reduce((s, l) => s + l.items, 0);
    const complete = lineRows.length > 0 && lineRows.every((l) => l.profit != null);
    const cmv = complete ? lineRows.reduce((s, l) => s + (lineCmv(l) ?? 0), 0) : null;
    const profit = complete ? lineRows.reduce((s, l) => s + (l.profit ?? 0), 0) : null;
    const revenueCmp = lineRows.reduce((s, l) => s + l.revenueCmp, 0);
    const revenuePrev = lineRows.reduce((s, l) => s + l.revenuePrev, 0);
    return {
      revenue,
      items,
      cmv,
      profit,
      variationPct: revenueCmp > 0 && revenuePrev > 0 ? ((revenueCmp - revenuePrev) / revenuePrev) * 100 : null,
      marginPct: profit != null && revenue > 0 ? (profit / revenue) * 100 : null,
    };
  }, [lineRows]);

  const pageSize = TABLE_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(tableLines.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = printing ? tableLines : tableLines.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const lineTotalPages = Math.max(1, Math.ceil(lineRows.length / pageSize));
  const linePageSafe = Math.min(linePage, lineTotalPages);
  const linePageRows = printing ? lineRows : lineRows.slice((linePageSafe - 1) * pageSize, linePageSafe * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, sortKey, sortDir, scope]);

  useEffect(() => {
    setLinePage(1);
  }, [lineSearch, lineSortKey, lineSortDir, scope]);

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

  function toggleLineSort(key: SortKey) {
    if (lineSortKey === key) {
      setLineSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setLineSortKey(key);
      setLineSortDir(key === "name" ? "asc" : "desc");
    }
  }

  const totalCategories = view.categories.reduce((s, c) => s + c.revenue, 0);
  const tipVariation = `Faturamento do produto ${comparedWithTip(view.vsVariation).replace(/^Em/, "em").replace(/\.$/, "")}.`;
  const tipVariationTotal = `Faturamento total dos produtos do filtro ${comparedWithTip(view.vsVariation).replace(/^Em/, "em")}`;
  const tipVariationLine = `Faturamento da linha ${comparedWithTip(view.vsVariation).replace(/^Em/, "em").replace(/\.$/, "")}.`;
  const tipVariationLineTotal = `Faturamento total das linhas do filtro ${comparedWithTip(view.vsVariation).replace(/^Em/, "em")}`;
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
          <KpiCard key={kpi.label} kpi={kpi} Icon={KPI_ICONS[i] ?? IconRevenue} />
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
            <BarChart
              data={view.categories.map((c) => ({ label: c.name, value: c.revenue }))}
              height={220}
              color={PALETTE.pink}
              hoverColor={PALETTE.pinkHover}
              formatValue={brlCent}
              onSelect={(_, i) => {
                const c = view.categories[i];
                if (c) open({ kind: "category", categoryId: c.categoryId, name: c.name });
              }}
            />
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

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card className="flex min-w-0 flex-col overflow-hidden">
          <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <CardTitle className="min-w-0 sm:truncate">Desempenho por linha de produto</CardTitle>
              <TipHelp label={"Agrupa produtos da mesma linha, mesmo quando existem em diferentes tipos, como colônia, body splash, body cream ou roll-on.\n\nExemplo: Obsessed, Obsessed Deluxe e Obsessed Intense pertencem à linha OBSESSED.\n\nQuando aparecer “—”, faltam dados de custo para calcular o CMV, o lucro bruto ou a margem."} />
            </div>
            {view.lines.length > 0 && (
              <input
                type="search"
                placeholder="Buscar por linha…"
                value={lineSearch}
                onChange={(e) => setLineSearch(e.target.value)}
                className={cn(filterInputClass, "w-full print:hidden sm:w-44 sm:shrink-0")}
              />
            )}
          </div>
          {lineRows.length === 0 ? (
            view.lines.length === 0 ? (
              <EmptyBlock />
            ) : (
              <EmptyBlock
                icon="🔍"
                title="Nenhuma linha encontrada"
                description="Tente buscar por outro nome."
                action={
                  <Button variant="outline" size="sm" onClick={() => setLineSearch("")}>
                    Limpar busca
                  </Button>
                }
              />
            )
          ) : (
          <div className="min-w-0 overflow-x-auto">
            <table className={SCROLL_TABLE}>
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
                  <th className="px-1 pb-3 text-left font-bold">#</th>
                  <ThSort label="Linha" active={lineSortKey === "name"} dir={lineSortDir} onClick={() => toggleLineSort("name")} align="left" className="px-1 pb-3" />
                  <ThSort label="Itens vendidos" active={lineSortKey === "items"} dir={lineSortDir} onClick={() => toggleLineSort("items")} className="px-1 pb-3" />
                  <ThSort label="Faturamento" active={lineSortKey === "revenue"} dir={lineSortDir} onClick={() => toggleLineSort("revenue")} className="px-1 pb-3" />
                  <ThSort label="CMV" active={lineSortKey === "cmv"} dir={lineSortDir} onClick={() => toggleLineSort("cmv")} className="px-1 pb-3" />
                  <ThSort label="Lucro bruto" active={lineSortKey === "profit"} dir={lineSortDir} onClick={() => toggleLineSort("profit")} className="px-1 pb-3" />
                  <ThSort label="Margem" active={lineSortKey === "marginPct"} dir={lineSortDir} onClick={() => toggleLineSort("marginPct")} className="px-1 pb-3" />
                  <ThSort label="Variação" active={lineSortKey === "variationPct"} dir={lineSortDir} onClick={() => toggleLineSort("variationPct")} className="px-1 pb-3" />
                </tr>
              </thead>
              <tbody>
                {linePageRows.map((l, i) => {
                  const idx = printing ? i : (linePageSafe - 1) * pageSize + i;
                  const cmv = lineCmv(l);
                  return (
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
                    className="cursor-pointer border-b border-line transition-colors hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none"
                  >
                    <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{idx + 1}</td>
                    <td className="px-1 py-3">
                      <ProductNameCell
                        name={l.name}
                        idx={idx}
                        tones={PRODUCT_AVATAR_TONES}
                        sub={`${l.products} produto${l.products === 1 ? "" : "s"} · ${l.kinds.length} tipo${l.kinds.length === 1 ? "" : "s"}`}
                      />
                    </td>
                    <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{num(l.items)}</td>
                    <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(l.revenue)}</td>
                    <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", cmv == null ? "text-t2" : "text-t0")}>{moneyOrDash(cmv)}</td>
                    <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", profitText(l.profit))}>{profitBrl(l.profit)}</td>
                    <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", l.marginPct == null ? "text-t2" : "text-t0")}>
                      {pctFmt(l.marginPct)}
                    </td>
                    <td className="px-1 py-3 text-right font-mono text-[13px]">
                      <Tooltip label={tipVariationLine}>
                        <span>
                          <Variation v={l.variationPct} />
                        </span>
                      </Tooltip>
                    </td>
                  </tr>
                  );
                })}
                <tr className="bg-bg-inset">
                  <td />
                  <td className="px-1 py-3 text-[13px] font-extrabold text-t0">
                    Total do filtro
                    <span className="mt-0.5 block text-[11px] font-semibold text-t2">
                      {num(lineRows.length)} linha{lineRows.length === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{num(lineTotal.items)}</td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{brlCent(lineTotal.revenue)}</td>
                  <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-extrabold", lineTotal.cmv == null ? "text-t2" : "text-t0")}>
                    {moneyOrDash(lineTotal.cmv)}
                  </td>
                  <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-extrabold", profitText(lineTotal.profit))}>
                    {profitBrl(lineTotal.profit)}
                  </td>
                  <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-extrabold", lineTotal.marginPct == null ? "text-t2" : "text-t0")}>
                    {pctFmt(lineTotal.marginPct)}
                  </td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold">
                    <Tooltip label={tipVariationLineTotal}>
                      <span>
                        <Variation v={lineTotal.variationPct} />
                      </span>
                    </Tooltip>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          )}
          {lineRows.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
              <span className="text-[12.5px] text-t2">
                Mostrando {linePageRows.length} de {num(lineRows.length)} linhas
              </span>
              {lineTotalPages > 1 && <Pagination page={linePageSafe} totalPages={lineTotalPages} onChange={setLinePage} />}
            </div>
          )}
        </Card>

        <Card className="flex min-w-0 flex-col overflow-hidden">
        <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <CardTitle className="min-w-0 sm:truncate">Desempenho por produto</CardTitle>
            <TipHelp label={tipCmvProduct} />
          </div>
          {view.products.length > 0 && (
            <input
              type="search"
              placeholder="Buscar por produto ou código…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(filterInputClass, "w-full print:hidden sm:w-44 sm:shrink-0")}
            />
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
          <div className="min-w-0 overflow-x-auto">
            <table className={SCROLL_TABLE}>
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
                        <ProductNameCell name={p.name} idx={idx} sub={p.code} tones={PRODUCT_AVATAR_TONES} />
                      </td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{num(p.items)}</td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(p.revenue)}</td>
                      <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", p.cmv == null ? "text-t2" : "text-t0")}>{moneyOrDash(p.cmv)}</td>
                      <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", profitText(p.profit))}>{profitBrl(p.profit)}</td>
                      <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", p.marginPct == null ? "text-t2" : "text-t0")}>
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
                    Total do filtro
                    <span className="mt-0.5 block text-[11px] font-semibold text-t2">
                      {num(tableLines.length)} produto{tableLines.length === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{num(tableTotal.items)}</td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{brlCent(tableTotal.revenue)}</td>
                  <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-extrabold", tableTotal.cmv == null ? "text-t2" : "text-t0")}>
                    {moneyOrDash(tableTotal.cmv)}
                  </td>
                  <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-extrabold", profitText(tableTotal.profit))}>
                    {profitBrl(tableTotal.profit)}
                  </td>
                  <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-extrabold", tableTotal.marginPct == null ? "text-t2" : "text-t0")}>
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
      </div>
      </>
      )}

      {detailModal}
    </div>
  );
}

function KpiCard({ kpi, Icon }: { kpi: ProductsKpi; Icon: () => React.JSX.Element }) {
  const tone = kpiTone(kpi.label);
  return (
    <StatCard
      label={kpi.label}
      value={kpi.value}
      icon={<Icon />}
      iconColor={tone.iconColor}
      iconBg={tone.iconBg}
      delta={kpi.delta}
      sub={kpi.sub}
      tooltip={kpi.tooltip}
    />
  );
}
