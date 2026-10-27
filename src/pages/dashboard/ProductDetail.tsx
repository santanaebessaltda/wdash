import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge, Modal, Pagination, ProgressBar, Skeleton, ThSort, type SortDir } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { AreaLineChart } from "@/components/charts";
import { ProductNameCell } from "@/components/wedash/ProductNameCell";
import { PRODUCT_AVATAR_TONES, PALETTE, profitText } from "@/pages/dashboard/palette";
import {
  buildAbcClassDetail,
  buildCategoryDetail,
  buildProductDetail,
  buildProductLineDetail,
  buildProductsView,
  financeFetchRange,
  previousPeriod,
  resolvePeriod,
  type AbcClass,
  type ProductDetail,
  type ProductDetailCategory,
  type ProductDetailItem,
  type ProductsAggInput,
  type ProductsView,
  type Scope,
} from "@/data/wedash/dashboard";
import { rollupCategoryDays } from "@/data/wedash/categoryRollup";
import {
  fetchProductCatalogDescriptions,
  fetchProductCatalogTypes,
  fetchProductTypeNames,
  fetchSalesDayAggs,
  fetchSalesHourAggs,
  fetchSalesProductCostPeriodAggs,
  fetchSalesProductPeriodAggs,
} from "@/data/wedash/salesRepo";
import type { SalesHourAgg } from "@/data/wedash/salesTypes";
import { calendarTodayIso } from "@/data/wedash/clock";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { brlCent, num, deltaTip, comparedWithTip, profitBrl } from "@/lib/format";
import { cn } from "@/lib/cn";
import { usePagedRows } from "@/lib/usePagedRows";

type Delta = { value: string; positive: boolean; vs?: string; diff?: string; previous?: string };

export const TipHelp = ({ label }: { label: string }) => (
  <Tooltip label={label}>
    <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 hover:text-t1 transition-colors">
      ?
    </span>
  </Tooltip>
);

/** Badge de delta  -  so % no chip; base do comparativo no tooltip (igual StatCard). */
export function BadgeVsPrevious({ delta, metric }: { delta?: Delta; metric?: string }) {
  if (!delta) return null;
  const badge = (
    <Badge variant={delta.positive ? "success" : "danger"}>
      {delta.positive ? "+" : "−"}
      {delta.value}
    </Badge>
  );
  const tip = deltaTip(delta, metric);
  return tip ? <Tooltip label={tip}>{badge}</Tooltip> : badge;
}

export const pctFmt = (v: number | null, casas = 1) => (v == null ? "—" : `${v.toFixed(casas).replace(".", ",")}%`);
export const moneyOrDash = (v: number | null) => (v == null ? "—" : brlCent(v));

/* ---------- Dados ---------- */

/** KPIs / evolucao (dia + hora). Junto com o catalogo no carregamento da tela. */
export async function fetchProductsKpiAggs(
  tenantId: string,
  scope: Scope,
  storeIds = scope.storeIds,
): Promise<Pick<ProductsAggInput, "dayAggs" | "hourAggs" | "prevHourAggs">> {
  const period = resolvePeriod(scope.period, calendarTodayIso());
  const range = financeFetchRange(scope);
  const [dayAggs, hourAggs, prevHourAggs] = await Promise.all([
    fetchSalesDayAggs({ tenantId, storeIds, from: range.from, to: range.to, brand: null }),
    period.start === period.end
      ? fetchSalesHourAggs({ tenantId, storeIds, day: period.start, brand: null })
      : Promise.resolve([] as SalesHourAgg[]),
    range.prevHourDay
      ? fetchSalesHourAggs({ tenantId, storeIds, day: range.prevHourDay, brand: null })
      : Promise.resolve([] as SalesHourAgg[]),
  ]);
  return { dayAggs, hourAggs, prevHourAggs };
}

/**
 * SKU, CMV, categorias e catalogo.
 * Totais do periodo no Postgres (igual Visao geral) — dia a dia em rede/mes
 * estoura e deixava os cards de baixo vazios com KPI ja preenchido.
 */
export async function fetchProductsCatalogAggs(
  tenantId: string,
  scope: Scope,
  storeIds = scope.storeIds,
): Promise<
  Pick<
    ProductsAggInput,
    "productDayAggs" | "productCostDayAggs" | "categoryDayAggs" | "catalogDescriptions" | "catalogTypes"
  >
> {
  const period = resolvePeriod(scope.period, calendarTodayIso());
  const prev = previousPeriod(period);
  const q = (from: string, to: string) => ({ tenantId, storeIds, from, to });
  const [
    productsCurrent,
    productsPrev,
    costsCurrent,
    costsPrev,
    catalogDescriptions,
    catalogTypes,
    typeNames,
  ] = await Promise.all([
    fetchSalesProductPeriodAggs(q(period.start, period.end)),
    fetchSalesProductPeriodAggs(q(prev.start, prev.end)),
    fetchSalesProductCostPeriodAggs(q(period.start, period.end)),
    fetchSalesProductCostPeriodAggs(q(prev.start, prev.end)),
    fetchProductCatalogDescriptions(),
    fetchProductCatalogTypes(),
    fetchProductTypeNames(),
  ]);
  const productDayAggs = [...productsCurrent, ...productsPrev];
  const productCostDayAggs = [...costsCurrent, ...costsPrev];
  const categoryDayAggs = rollupCategoryDays({
    products: productDayAggs,
    costs: productCostDayAggs,
    typeByProductId: catalogTypes,
    typeNameById: typeNames,
  });
  return { productDayAggs, productCostDayAggs, categoryDayAggs, catalogDescriptions, catalogTypes };
}

export async function fetchProductsAggInput(tenantId: string, scope: Scope, storeIds = scope.storeIds): Promise<ProductsAggInput> {
  const [kpi, catalog] = await Promise.all([
    fetchProductsKpiAggs(tenantId, scope, storeIds),
    fetchProductsCatalogAggs(tenantId, scope, storeIds),
  ]);
  return { ...kpi, ...catalog };
}

export interface ProductsDetailData {
  aggs: ProductsAggInput;
  view: ProductsView;
}

/** O que abrir no detalhe  -  por chave, para outras telas abrirem sem ter as linhas da tela Produtos. */
export type ProductSelection =
  | { kind: "product"; rowKey: string; name: string }
  | { kind: "line"; name: string }
  | { kind: "category"; name: string; categoryId?: number }
  | { kind: "class"; productClass: AbcClass };

const nameSelection = (s: ProductSelection) => (s.kind === "class" ? `Classe ${s.productClass}` : s.name);

function buildDetail(scope: Scope, { aggs, view }: ProductsDetailData, s: ProductSelection): ProductDetail | null {
  switch (s.kind) {
    case "product": {
      const row = view.products.find((p) => p.rowKey === s.rowKey);
      return row ? buildProductDetail(scope, aggs, row) : null;
    }
    case "line": {
      const row = view.lines.find((l) => l.name === s.name);
      return row ? buildProductLineDetail(scope, aggs, row) : null;
    }
    case "category": {
      const row = view.curveAbcCategories.items.find((c) =>
        s.categoryId != null ? c.categoryId === s.categoryId : c.name === s.name,
      );
      return row ? buildCategoryDetail(scope, aggs, row) : null;
    }
    case "class":
      return buildAbcClassDetail(scope, aggs, view, s.productClass);
  }
}

/**
 * Detalhe de produto / linha / categoria / classe com navegacao em pilha (" <-  Voltar").
 * Com `data` usa os dados da tela; sem `data` busca os dados de Produtos so ao abrir.
 */
export function useProductDetail({
  scope,
  data,
  tenantId,
}: {
  scope: Scope;
  data?: ProductsDetailData;
  tenantId?: string;
}): { open: (s: ProductSelection) => void; modal: ReactNode } {
  const [pilha, setPilha] = useState<ProductSelection[]>([]);
  const top = pilha.at(-1) ?? null;
  const open = useCallback((s: ProductSelection) => setPilha([s]), []);
  const empilhar = (s: ProductSelection) => setPilha((p) => [...p, s]);

  useEffect(() => {
    setPilha([]);
  }, [scope]);

  // Custos das lojas chegam depois do 1 render  ->  recalcula.
  const [storesTick, setStoresTick] = useState(0);
  useEffect(() => {
    const onStores = () => setStoresTick((n) => n + 1);
    window.addEventListener("wedash:stores", onStores);
    return () => window.removeEventListener("wedash:stores", onStores);
  }, []);

  const lazy = useLazyProductsData(scope, tenantId, !data && top != null);
  const source = data ?? lazy;

  const detail = useMemo(
    () => (top && source ? buildDetail(scope, source, top) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [top, source, scope, storesTick],
  );

  const modal = (
    <ProductDetailModal
      open={top != null}
      loading={top != null && !source}
      title={top ? nameSelection(top) : undefined}
      detail={detail}
      period={resolvePeriod(scope.period, calendarTodayIso()).label}
      onClose={() => setPilha([])}
      onProduct={(rowKey) => {
        const row = source?.view.products.find((p) => p.rowKey === rowKey);
        if (row) empilhar({ kind: "product", rowKey, name: row.name });
      }}
      onCategory={(id) => {
        const row = source?.view.curveAbcCategories.items.find((c) => c.categoryId === id);
        if (row) empilhar({ kind: "category", categoryId: id, name: row.name });
      }}
      backTo={pilha.length > 1 ? nameSelection(pilha[pilha.length - 2]) : undefined}
      onBack={() => setPilha((p) => p.slice(0, -1))}
    />
  );

  return { open, modal };
}

/** Busca os dados de Produtos na 1 abertura; mantem ate mudar o filtro ou chegar venda nova. */
function useLazyProductsData(scope: Scope, tenantId: string | undefined, enabled: boolean): ProductsDetailData | null {
  const [data, setData] = useState<ProductsDetailData | null>(null);
  const gen = useRef(0);

  useEffect(() => {
    gen.current++;
    setData(null);
  }, [scope, tenantId]);

  useEffect(() => {
    if (!enabled || !tenantId) return;
    const onSynced = () => {
      const g = ++gen.current;
      fetchProductsAggInput(tenantId, scope)
        .then((aggs) => {
          if (g === gen.current) setData({ aggs, view: buildProductsView(scope, aggs) });
        })
        .catch((e) => console.error("Product detail load:", e));
    };
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [enabled, tenantId, scope]);

  useEffect(() => {
    if (!enabled || !tenantId || data) return;
    const g = ++gen.current;
    fetchProductsAggInput(tenantId, scope)
      .then((aggs) => {
        if (g === gen.current) setData({ aggs, view: buildProductsView(scope, aggs) });
      })
      .catch((e) => {
        console.error("Product detail load:", e);
        if (g !== gen.current) return;
        const empty: ProductsAggInput = { dayAggs: [] };
        setData({ aggs: empty, view: buildProductsView(scope, empty) });
      });
  }, [enabled, tenantId, data, scope]);

  return data;
}

/* ---------- Modal ---------- */

type TopSort = "name" | "items" | "revenue" | "profit" | "margin";

const amountOfSort = (r: { items: number; revenue: number; profit: number | null; marginPct: number | null }, sort: TopSort) =>
  sort === "items" ? r.items : sort === "profit" ? r.profit : sort === "margin" ? r.marginPct : r.revenue;

function ProfitCell({ v }: { v: number | null }) {
  return (
    <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", profitText(v))}>
      {profitBrl(v)}
    </td>
  );
}

export function MetricDetail({
  label,
  amount,
  delta,
  destaque,
  amountClass,
  tip,
}: {
  label: string;
  amount: string;
  delta?: Delta;
  destaque?: boolean;
  amountClass?: string;
  tip?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-bg-inset p-3">
      <p className="flex items-center gap-1 text-[11.5px] font-semibold text-t2">
        {label}
        {tip && <TipHelp label={tip} />}
      </p>
      <p className={cn("mt-1 font-mono text-[15px] font-extrabold tabular-nums", amount === "—" ? "text-t2" : amountClass ? amountClass : destaque ? "text-ok" : "text-t0")}>
        {amount}
      </p>
      {delta && (
        <div className="mt-1.5">
          <BadgeVsPrevious delta={delta} />
        </div>
      )}
    </div>
  );
}

const SCROLL_TABLE = "w-full min-w-[620px] border-collapse text-sm";

/** Mesmo padrao da tabela Top produtos (#  |  Produto  |  Itens  |  Faturamento  |  Lucro bruto  |  Margem); clique abre o produto. */
function ProductsOfGroup({
  products,
  onProduct,
  paginate = false,
}: {
  products: ProductDetailItem[];
  onProduct: (rowKey: string) => void;
  /** 10 por página. A lista de produtos da categoria usa isso. */
  paginate?: boolean;
}) {
  const [sort, setSort] = useState<TopSort>("revenue");
  const [dir, setDir] = useState<SortDir>("desc");
  const lines = useMemo(() => {
    const d = dir === "asc" ? 1 : -1;
    return [...products].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "pt-BR") * d;
      const va = amountOfSort(a, sort);
      const vb = amountOfSort(b, sort);
      if (va == null && vb == null) return b.revenue - a.revenue;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * d || b.revenue - a.revenue;
    });
  }, [products, sort, dir]);
  const paged = usePagedRows(lines, `${lines.length}|${sort}|${dir}`);
  const shown = paginate ? paged.pageRows : lines;
  const rankBase = paginate ? (paged.page - 1) * paged.pageSize : 0;
  const toggle = (k: TopSort) => {
    if (sort === k) setDir((x) => (x === "asc" ? "desc" : "asc"));
    else {
      setSort(k);
      setDir(k === "name" ? "asc" : "desc");
    }
  };
  return (
    <div className="mt-2">
      <div className="min-w-0 overflow-x-auto">
      <table className={SCROLL_TABLE}>
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
            <th className="px-1 pb-3 text-left font-bold">#</th>
            <ThSort label="Produto" active={sort === "name"} dir={dir} onClick={() => toggle("name")} align="left" className="px-1 pb-3" />
            <ThSort label="Itens vendidos" active={sort === "items"} dir={dir} onClick={() => toggle("items")} className="px-1 pb-3" />
            <ThSort label="Faturamento" active={sort === "revenue"} dir={dir} onClick={() => toggle("revenue")} className="px-1 pb-3" />
            <ThSort label="Lucro bruto" active={sort === "profit"} dir={dir} onClick={() => toggle("profit")} className="px-1 pb-3" />
            <ThSort label="Margem" active={sort === "margin"} dir={dir} onClick={() => toggle("margin")} className="px-1 pb-3" />
          </tr>
        </thead>
        <tbody>
        {shown.map((p, idx) => {
          const rank = rankBase + idx;
          return (
            <tr
              key={p.rowKey}
              tabIndex={0}
              onClick={() => onProduct(p.rowKey)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onProduct(p.rowKey);
                }
              }}
              className="cursor-pointer border-b border-line transition-colors hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none"
            >
              <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{rank + 1}</td>
              <td className="px-1 py-3">
                <ProductNameCell name={p.name} idx={rank} sub={p.code} tones={PRODUCT_AVATAR_TONES} />
              </td>
              <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{num(p.items)}</td>
              <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(p.revenue)}</td>
              <ProfitCell v={p.profit} />
              <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", p.marginPct == null ? "text-t2" : "text-t0")}>
                {pctFmt(p.marginPct)}
              </td>
            </tr>
          );
        })}
        </tbody>
      </table>
      </div>
      {paginate && paged.totalPages > 1 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12.5px] text-t2">
            Mostrando {paged.pageRows.length} de {paged.total} produtos
          </span>
          <Pagination page={paged.page} totalPages={paged.totalPages} onChange={paged.setPage} />
        </div>
      ) : null}
    </div>
  );
}

/** Categorias de uma classe da Curva ABC  -  padrao da tabela Top produtos; clique abre a categoria. */
function CategoriesOfClass({
  categories,
  onCategory,
}: {
  categories: ProductDetailCategory[];
  onCategory: (categoryId: number) => void;
}) {
  const [sort, setSort] = useState<TopSort>("revenue");
  const [dir, setDir] = useState<SortDir>("desc");
  const lines = useMemo(() => {
    const d = dir === "asc" ? 1 : -1;
    return [...categories].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "pt-BR") * d;
      const va = amountOfSort(a, sort);
      const vb = amountOfSort(b, sort);
      if (va == null && vb == null) return b.revenue - a.revenue;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * d || b.revenue - a.revenue;
    });
  }, [categories, sort, dir]);
  const toggle = (k: TopSort) => {
    if (sort === k) setDir((x) => (x === "asc" ? "desc" : "asc"));
    else {
      setSort(k);
      setDir(k === "name" ? "asc" : "desc");
    }
  };
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
            <th className="px-1 pb-3 text-left font-bold">#</th>
            <ThSort label="Categoria" active={sort === "name"} dir={dir} onClick={() => toggle("name")} align="left" className="px-1 pb-3" />
            <ThSort label="Itens vendidos" active={sort === "items"} dir={dir} onClick={() => toggle("items")} className="px-1 pb-3" />
            <ThSort label="Faturamento" active={sort === "revenue"} dir={dir} onClick={() => toggle("revenue")} className="px-1 pb-3" />
            <ThSort label="Lucro bruto" active={sort === "profit"} dir={dir} onClick={() => toggle("profit")} className="px-1 pb-3" />
            <ThSort label="Margem" active={sort === "margin"} dir={dir} onClick={() => toggle("margin")} className="px-1 pb-3" />
            <th className="px-1 pb-3 text-right font-bold">
              <span className="inline-flex items-center gap-1">
                Participação
                <TipHelp label="Participação da categoria no faturamento de todas as categorias e, abaixo, o acumulado que define a classe (A até 80%, B até 95%)." />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((c, idx) => (
            <tr
              key={c.categoryId}
              tabIndex={0}
              onClick={() => onCategory(c.categoryId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onCategory(c.categoryId);
                }
              }}
              className="cursor-pointer border-b border-line transition-colors last:border-b-0 hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none"
            >
              <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{idx + 1}</td>
              <td className="px-1 py-3">
                <ProductNameCell name={c.name} idx={idx} tones={PRODUCT_AVATAR_TONES} />
              </td>
              <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{num(c.items)}</td>
              <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(c.revenue)}</td>
              <ProfitCell v={c.profit} />
              <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", c.marginPct == null ? "text-t2" : "text-t0")}>
                {pctFmt(c.marginPct)}
              </td>
              <td className="px-1 py-3 text-right">
                <p className="font-mono text-[13px] font-bold text-t0">{pctFmt(c.pct)}</p>
                <p className="text-[11px] text-t2">acum. {pctFmt(c.pctAccumulated)}</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-3.5 w-48" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-[74px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[200px] rounded-xl" />
    </div>
  );
}

function ProductDetailModal({
  open,
  loading,
  title,
  detail,
  period,
  onClose,
  onProduct,
  onCategory,
  backTo,
  onBack,
}: {
  open: boolean;
  loading: boolean;
  title?: string;
  detail: ProductDetail | null;
  period: string;
  onClose: () => void;
  onProduct: (rowKey: string) => void;
  onCategory: (categoryId: number) => void;
  /** Nome do detalhe anterior (aberto a partir dele). */
  backTo?: string;
  onBack: () => void;
}) {
  const cmp = detail?.comparison;
  const kind = detail?.kind ?? "product";
  const article = { product: "do produto", line: "da linha", category: "da categoria", class: "da classe" }[kind];
  const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;
  const subtitle = !detail
    ? ""
    : kind === "line"
      ? ["Linha de produto", plural(detail.products.length, "produto"), period].join(" · ")
      : kind === "category"
        ? ["Categoria", detail.productClass ? `Classe ${detail.productClass}` : "", plural(detail.products.length, "produto"), period]
            .filter(Boolean)
            .join(" · ")
        : kind === "class"
          ? ["Curva ABC", plural(detail.categories.length, "category"), period].join(" · ")
          : [detail.code, period].filter(Boolean).join(" · ");
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
          <div className="-mt-1">
            {backTo && (
              <button type="button" onClick={onBack} className="mb-1.5 text-[12px] font-semibold text-acc hover:underline">
                ← Voltar para {backTo}
              </button>
            )}
            <p className="text-[12px] font-semibold text-t2">{subtitle}</p>
          </div>

          <div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <MetricDetail label="Faturamento" amount={brlCent(detail.revenue)} delta={cmp?.revenue} />
              <MetricDetail label="Itens vendidos" amount={num(detail.items)} delta={cmp?.items} />
              <MetricDetail label="Preço médio" amount={brlCent(detail.priceAverage)} />
              <MetricDetail
                label="Participação"
                amount={pctFmt(detail.participationPct)}
                tip={`Participação ${article} no faturamento de todos os produtos do período.`}
              />
              <MetricDetail label="CMV" amount={moneyOrDash(detail.cmv)} />
              <MetricDetail label="Lucro bruto" amount={profitBrl(detail.profit)} amountClass={profitText(detail.profit)} />
              <MetricDetail label="Margem" amount={pctFmt(detail.marginPct)} delta={cmp?.margin} />
            </div>
            <p className="mt-2.5 text-[11.5px] text-t2">
              {cmp
                ? `Variação ${comparedWithTip(cmp.vs).replace(/^Em/, "em")}`
                : `Sem vendas ${article} no período anterior para comparar.`}
              {detail.cmv == null && " CMV, lucro e margem ficam indisponíveis quando faltam dados de custo no período."}
            </p>
          </div>

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
                color={PALETTE.pink}
                name="Faturamento"
                areaOpacity={0.18}
                showAxisLabels
              />
            </section>
          )}

          {(kind === "line" || kind === "category") && detail.products.length > 0 && (
            <section>
              <h4 className="text-[13px] font-bold text-t0">Produtos {article}</h4>
              {detail.kinds.length > 0 && <p className="mt-0.5 text-[11.5px] text-t2">{detail.kinds.join(" · ")}</p>}
              <ProductsOfGroup key={`${kind}-${detail.rowKey}`} products={detail.products} onProduct={onProduct} paginate={kind === "category"} />
            </section>
          )}

          {kind === "class" && detail.categories.length > 0 && (
            <section>
              <h4 className="text-[13px] font-bold text-t0">Categorias da classe</h4>
              <CategoriesOfClass key={detail.rowKey} categories={detail.categories} onCategory={onCategory} />
            </section>
          )}

          {detail.storeRows.length > 0 && (
            <section>
              <h4 className="mb-3 text-[13px] font-bold text-t0">Vendas por loja</h4>
              <div className="flex flex-col gap-3">
                {detail.storeRows.map((l) => (
                  <div key={l.storeId}>
                    <div className="mb-1.5 flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-t1">{l.name}</span>
                      <span className="shrink-0 text-[11.5px] text-t2">
                        {num(l.items)} ite{l.items === 1 ? "m" : "ns"}
                      </span>
                      <span className="shrink-0 font-mono text-[12.5px] font-bold text-t0">{brlCent(l.revenue)}</span>
                      <span className="min-w-[40px] shrink-0 text-right text-[11.5px] font-semibold text-t2">{pctFmt(l.pct, 0)}</span>
                    </div>
                    <ProgressBar value={l.pct} color="var(--acc)" height={6} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
