import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Badge, Card, CardHeader, CardTitle, StatCard, DateRangePicker, PageHeader, Button, Pagination, ThSort, type SortDir } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { TABLE_PAGE_SIZE } from "@/lib/usePagedRows";
import { BarChart, DonutChart } from "@/components/charts";
import { useScope } from "@/pages/dashboard/useScope";
import {
  buildProductsView,
  resolvePeriod,
  type AbcClass,
  type ProductItemRow,
  type ProductLineRow,
  type ProductsAggInput,
  type ProductsKpi,
} from "@/data/wedash/dashboard";
import { fetchSalesCoverage } from "@/data/wedash/salesRepo";
import { ProductNameCell } from "@/components/wedash/ProductNameCell";
import {
  BadgeVsAnterior,
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
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { brlCent, deIso, num, tipRelacao } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { DateRange, DateRangeChangeMeta } from "@/components/ui/DateRangePicker";
import {
  applyPeriodDateChange,
  dateRangeFromPeriod,
  periodActivePresetId,
  periodDisplayLabel,
} from "@/pages/dashboard/periodPicker";

/** Icones dos KPIs  -  Fat/Lucro/Margem iguais ao Financeiro; Itens proprio da tela. */
const IconFat = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
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
const IconItens = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);
const KPI_ICONS = [IconFat, IconLucro, IconMargem, IconItens];

/** Heroes por metrica: Fat/Lucro/Margem iguais ao Financeiro; Itens = warn. */
const KPI_COLORS = [
  { iconColor: "var(--acc)", iconBg: "var(--acc-soft)" },
  { iconColor: "var(--ok)", iconBg: "var(--ok-soft)" },
  { iconColor: "var(--info)", iconBg: "rgba(59,130,246,0.12)" },
  { iconColor: "var(--warn)", iconBg: "rgba(245,158,11,0.12)" },
];

type SortKey = "nome" | "faturamento" | "itens" | "cmv" | "lucro" | "margemPct" | "variacaoPct";
type TopProdSort = "nome" | "itens" | "faturamento" | "lucro" | "margem";

const CORES_ABC: Record<AbcClass, string> = {
  A: "var(--bad)",
  B: "var(--warn)",
  C: "var(--ok)",
};

const filtroInputClass =
  "h-8 rounded-[var(--radius-vela-sm)] border border-line bg-bg-3 px-3 text-xs font-semibold text-t0 transition-colors hover:border-acc focus:border-acc focus:outline-none";

const corLucro = (v: number | null) => (v == null ? "text-t2" : v < 0 ? "text-bad" : "text-ok");

function Variacao({ v }: { v: number | null }) {
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
  const { escopo, mudar } = useScope();
  const [aggs, setAggs] = useState<ProductsAggInput>({ dayAggs: [] });
  const [coverageFrom, setCoverageFrom] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinSkeleton(loading);
  const [busca, setBusca] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("faturamento");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [topProdSort, setTopProdSort] = useState<TopProdSort>("faturamento");
  const [topProdDir, setTopProdDir] = useState<SortDir>("desc");
  const [topLinhaSort, setTopLinhaSort] = useState<TopProdSort>("faturamento");
  const [topLinhaDir, setTopLinhaDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const printing = usePrintMode();
  const exportar = useExportPdf("Produtos");
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
    try {
      const [next, cov] = await Promise.all([
        fetchProductsAggInput(session.tenantId, escopo),
        fetchSalesCoverage(session.tenantId, escopo.filialIds),
      ]);
      if (gen !== reloadGen.current) return;
      setAggs(next);
      setCoverageFrom(cov.from ? deIso(cov.from) : null);
    } catch (e) {
      if (gen !== reloadGen.current) return;
      console.error("Products reload:", e);
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
    () => buildProductsView(escopo, aggs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [escopo, aggs, storesTick],
  );

  const dateRange = useMemo(() => dateRangeFromPeriod(escopo.periodo), [escopo.periodo]);
  const periodoAtual = resolvePeriod(escopo.periodo, calendarTodayIso());
  const monthFill = useMonthFill();
  const deepHistoryFill = useDeepHistoryFill();
  function onDateChange(r: DateRange, meta?: DateRangeChangeMeta) {
    mudar(applyPeriodDateChange(escopo, r, meta));
  }

  // A metrica escolhe QUAIS 5 entram (sempre os maiores); a direcao so reordena os 5.
  // "Produto" (nome) reordena o Top 5 por faturamento.
  const topProdutos = useMemo(() => {
    const metrica = (p: ProductItemRow) =>
      topProdSort === "itens"
        ? p.itens
        : topProdSort === "lucro"
          ? (p.lucro ?? -Infinity)
          : topProdSort === "margem"
            ? (p.margemPct ?? -Infinity)
            : p.faturamento;
    const top5 = [...view.produtos].sort((a, b) => metrica(b) - metrica(a) || b.faturamento - a.faturamento).slice(0, 5);
    if (topProdSort === "nome") {
      const dir = topProdDir === "asc" ? 1 : -1;
      return top5.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") * dir);
    }
    return topProdDir === "asc" ? top5.reverse() : top5;
  }, [view.produtos, topProdSort, topProdDir]);

  function toggleTopProdSort(key: TopProdSort) {
    if (topProdSort === key) {
      setTopProdDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTopProdSort(key);
      setTopProdDir(key === "nome" ? "asc" : "desc");
    }
  }

  // Mesma regra do Top produtos: a metrica escolhe as 5 linhas; a direcao so reordena.
  const topLinhas = useMemo(() => {
    const metrica = (l: ProductLineRow) =>
      topLinhaSort === "itens"
        ? l.itens
        : topLinhaSort === "lucro"
          ? (l.lucro ?? -Infinity)
          : topLinhaSort === "margem"
            ? (l.margemPct ?? -Infinity)
            : l.faturamento;
    const top5 = [...view.linhas].sort((a, b) => metrica(b) - metrica(a) || b.faturamento - a.faturamento).slice(0, 5);
    if (topLinhaSort === "nome") {
      const dir = topLinhaDir === "asc" ? 1 : -1;
      return top5.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") * dir);
    }
    return topLinhaDir === "asc" ? top5.reverse() : top5;
  }, [view.linhas, topLinhaSort, topLinhaDir]);

  function toggleTopLinhaSort(key: TopProdSort) {
    if (topLinhaSort === key) {
      setTopLinhaDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTopLinhaSort(key);
      setTopLinhaDir(key === "nome" ? "asc" : "desc");
    }
  }

  const linhasTabela = useMemo(() => {
    let lista = view.produtos;
    const q = busca.trim().toLowerCase();
    if (q) lista = lista.filter((p) => p.nome.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...lista].sort((a, b) => {
      if (sortKey === "nome") return a.nome.localeCompare(b.nome, "pt-BR") * dir;
      const va = a[sortKey];
      const vb = b[sortKey];
      // Sem dado (" - ") sempre no fim, nas duas direcoes.
      if (va == null && vb == null) return b.faturamento - a.faturamento;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }, [view.produtos, busca, sortKey, sortDir]);

  const totalTabela = useMemo(() => {
    const faturamento = linhasTabela.reduce((s, p) => s + p.faturamento, 0);
    const itens = linhasTabela.reduce((s, p) => s + p.itens, 0);
    const completo = linhasTabela.length > 0 && linhasTabela.every((p) => p.cmv != null);
    const cmv = completo ? linhasTabela.reduce((s, p) => s + (p.cmv ?? 0), 0) : null;
    const lucro = completo ? linhasTabela.reduce((s, p) => s + (p.lucro ?? 0), 0) : null;
    const fatCmp = linhasTabela.reduce((s, p) => s + p.faturamentoCmp, 0);
    const fatAnt = linhasTabela.reduce((s, p) => s + p.faturamentoAnt, 0);
    return {
      faturamento,
      itens,
      cmv,
      lucro,
      variacaoPct: fatCmp > 0 && fatAnt > 0 ? ((fatCmp - fatAnt) / fatAnt) * 100 : null,
      margemPct: lucro != null && faturamento > 0 ? (lucro / faturamento) * 100 : null,
    };
  }, [linhasTabela]);

  const pageSize = TABLE_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(linhasTabela.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = printing ? linhasTabela : linhasTabela.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  useEffect(() => {
    setPage(1);
  }, [busca, sortKey, sortDir, escopo]);

  const detalheData = useMemo(() => ({ aggs, view }), [aggs, view]);
  const { abrir, modal: detalheModal } = useProductDetail({ escopo, data: detalheData });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "nome" ? "asc" : "desc");
    }
  }

  const totalCategorias = view.categorias.reduce((s, c) => s + c.faturamento, 0);
  const tipVariacao = `Faturamento do produto ${tipRelacao(view.vsVariacao).replace(/^Em/, "em").replace(/\.$/, "")}.`;
  const tipVariacaoTotal = `Faturamento total dos produtos do filtro ${tipRelacao(view.vsVariacao).replace(/^Em/, "em")}`;
  const tipCmvProduto = view.temCustoProduto
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
                displayLabel={periodDisplayLabel(escopo.periodo)}
                activePresetId={periodActivePresetId(escopo.periodo)}
                minDate={pickerMinDate(coverageFrom, monthFill)}
              />
              <Button variant="primary" onClick={exportar}>
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
          produtos={view.productsWithoutCost}
          storeIds={escopo.filialIds}
          from={periodoAtual.inicio}
          to={periodoAtual.fim}
        />
      )}

      {showSkeleton ? (
        <ProductsSkeleton />
      ) : (
      <>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {view.kpis.map((kpi, i) => (
          <KpiCard key={kpi.label} kpi={kpi} Icon={KPI_ICONS[i] ?? IconFat} colorIdx={i} />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card padding="lg" className="flex flex-col">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Faturamento por categoria</CardTitle>
              {view.categorias.length > 0 && (
                <p className="mt-1.5 font-mono text-2xl font-extrabold text-t0">{brlCent(totalCategorias)}</p>
              )}
            </div>
            {view.categorias.length > 0 && <BadgeVsAnterior delta={view.deltaCategorias} metrica="Faturamento das categorias" />}
          </div>
          {view.categorias.length === 0 ? (
            <EmptyBlock />
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[420px]">
                <BarChart
                  data={view.categorias.map((c) => ({ label: c.nome, value: c.faturamento }))}
                  height={220}
                  formatValue={brlCent}
                  onSelect={(_, i) => {
                    const c = view.categorias[i];
                    if (c) abrir({ tipo: "categoria", categoriaId: c.categoriaId, nome: c.nome });
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
          {view.curvaAbcCategorias.itens.length === 0 ? (
            <EmptyBlock />
          ) : (
            (() => {
              const classes = view.curvaAbcCategorias.resumo.filter((r) => r.faturamento > 0);
              const total = classes.reduce((s, r) => s + r.faturamento, 0) || 1;
              return (
                <div className="flex flex-1 flex-col justify-center px-1 pb-1 pt-3">
                  <div className="mx-auto my-2">
                    <DonutChart
                      segments={classes.map((r) => ({
                        label: `Classe ${r.classe}`,
                        value: r.faturamento,
                        color: CORES_ABC[r.classe],
                      }))}
                      centerLabel="Total"
                      centerValue={brlCent(total)}
                    />
                  </div>
                  <div className="mt-2 flex flex-col gap-1">
                    {classes.map((r) => {
                      const pct = Math.round((r.faturamento / total) * 100);
                      const nomes = view.curvaAbcCategorias.itens.filter((i) => i.classe === r.classe).map((i) => i.nome);
                      return (
                        <button
                          key={r.classe}
                          type="button"
                          onClick={() => abrir({ tipo: "classe", classe: r.classe })}
                          className="-mx-2 flex items-start gap-2.5 rounded-[var(--radius-vela-sm)] px-2 py-1.5 text-left transition-colors hover:bg-bg-3"
                        >
                          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: CORES_ABC[r.classe] }} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="text-[12.5px] font-semibold text-t1">Classe {r.classe}</span>
                              <span className="ml-auto shrink-0 font-mono text-[12.5px] font-bold text-t0">{brlCent(r.faturamento)}</span>
                              <span className="min-w-[32px] shrink-0 text-right text-[11.5px] font-semibold text-t2">{pct}%</span>
                            </div>
                            <p className="mt-0.5 text-[11.5px] leading-snug text-t2">{nomes.join(" · ")}</p>
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
            <Badge variant="accent">Top 5</Badge>
          </CardHeader>
          {topLinhas.length === 0 ? (
            <EmptyBlock />
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
                  <th className="px-1 pb-3 text-left font-bold">#</th>
                  <ThSort label="Linha" active={topLinhaSort === "nome"} dir={topLinhaDir} onClick={() => toggleTopLinhaSort("nome")} align="left" className="px-1 pb-3" />
                  <ThSort label="Itens vendidos" active={topLinhaSort === "itens"} dir={topLinhaDir} onClick={() => toggleTopLinhaSort("itens")} className="px-1 pb-3" />
                  <ThSort label="Faturamento" active={topLinhaSort === "faturamento"} dir={topLinhaDir} onClick={() => toggleTopLinhaSort("faturamento")} className="px-1 pb-3" />
                  <ThSort label="Lucro bruto" active={topLinhaSort === "lucro"} dir={topLinhaDir} onClick={() => toggleTopLinhaSort("lucro")} className="px-1 pb-3" />
                  <ThSort label="Margem" active={topLinhaSort === "margem"} dir={topLinhaDir} onClick={() => toggleTopLinhaSort("margem")} className="px-1 pb-3" />
                </tr>
              </thead>
              <tbody>
                {topLinhas.map((l, idx) => (
                  <tr
                    key={l.nome}
                    tabIndex={0}
                    onClick={() => abrir({ tipo: "linha", nome: l.nome })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        abrir({ tipo: "linha", nome: l.nome });
                      }
                    }}
                    className="cursor-pointer border-b border-line transition-colors last:border-b-0 hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none"
                  >
                    <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{idx + 1}</td>
                    <td className="px-1 py-3">
                      <ProductNameCell
                        nome={l.nome}
                        idx={idx}
                        sub={
                          <Tooltip label={l.tipos.join(" · ")}>
                            <p className="truncate text-[11px] text-t2">
                              {l.produtos} produto{l.produtos === 1 ? "" : "s"} · {l.tipos.length} tipo{l.tipos.length === 1 ? "" : "s"}
                            </p>
                          </Tooltip>
                        }
                      />
                    </td>
                    <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{num(l.itens)}</td>
                    <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(l.faturamento)}</td>
                    <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", corLucro(l.lucro))}>{moneyOrDash(l.lucro)}</td>
                    <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", l.margemPct == null ? "text-t2" : "text-ok")}>
                      {pctFmt(l.margemPct)}
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
            <Badge variant="accent">Top 5</Badge>
          </CardHeader>
          {topProdutos.length === 0 ? (
            <EmptyBlock />
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
                  <th className="px-1 pb-3 text-left font-bold">#</th>
                  <ThSort label="Produto" active={topProdSort === "nome"} dir={topProdDir} onClick={() => toggleTopProdSort("nome")} align="left" className="px-1 pb-3" />
                  <ThSort label="Itens vendidos" active={topProdSort === "itens"} dir={topProdDir} onClick={() => toggleTopProdSort("itens")} className="px-1 pb-3" />
                  <ThSort label="Faturamento" active={topProdSort === "faturamento"} dir={topProdDir} onClick={() => toggleTopProdSort("faturamento")} className="px-1 pb-3" />
                  <ThSort label="Lucro bruto" active={topProdSort === "lucro"} dir={topProdDir} onClick={() => toggleTopProdSort("lucro")} className="px-1 pb-3" />
                  <ThSort label="Margem" active={topProdSort === "margem"} dir={topProdDir} onClick={() => toggleTopProdSort("margem")} className="px-1 pb-3" />
                </tr>
              </thead>
              <tbody>
                {topProdutos.map((p, idx) => (
                  <tr
                    key={p.chave}
                    tabIndex={0}
                    onClick={() => abrir({ tipo: "produto", chave: p.chave, nome: p.nome })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        abrir({ tipo: "produto", chave: p.chave, nome: p.nome });
                      }
                    }}
                    className="cursor-pointer border-b border-line transition-colors last:border-b-0 hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none"
                  >
                    <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{idx + 1}</td>
                    <td className="px-1 py-3">
                      <ProductNameCell nome={p.nome} idx={idx} sub={p.codigo} />
                    </td>
                    <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{num(p.itens)}</td>
                    <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(p.faturamento)}</td>
                    <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", corLucro(p.lucro))}>{moneyOrDash(p.lucro)}</td>
                    <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", p.margemPct == null ? "text-t2" : "text-ok")}>
                      {pctFmt(p.margemPct)}
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
            <TipHelp label={tipCmvProduto} />
          </div>
          {view.produtos.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <input
              type="search"
              placeholder="Buscar por produto ou código…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className={cn(filtroInputClass, "sm:w-56")}
            />
          </div>
          )}
        </div>

        {linhasTabela.length === 0 ? (
          view.produtos.length === 0 ? (
            <EmptyBlock />
          ) : (
            <EmptyBlock
              icon="🔍"
              title="Nenhum produto encontrado"
              description="Tente buscar por outro nome ou código."
              action={
                <Button variant="outline" size="sm" onClick={() => setBusca("")}>
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
                  <ThSort label="Produto" active={sortKey === "nome"} dir={sortDir} onClick={() => toggleSort("nome")} align="left" className="px-1 pb-3" />
                  <ThSort label="Itens vendidos" active={sortKey === "itens"} dir={sortDir} onClick={() => toggleSort("itens")} className="px-1 pb-3" />
                  <ThSort label="Faturamento" active={sortKey === "faturamento"} dir={sortDir} onClick={() => toggleSort("faturamento")} className="px-1 pb-3" />
                  <ThSort label="CMV" active={sortKey === "cmv"} dir={sortDir} onClick={() => toggleSort("cmv")} className="px-1 pb-3" />
                  <ThSort label="Lucro bruto" active={sortKey === "lucro"} dir={sortDir} onClick={() => toggleSort("lucro")} className="px-1 pb-3" />
                  <ThSort label="Margem" active={sortKey === "margemPct"} dir={sortDir} onClick={() => toggleSort("margemPct")} className="px-1 pb-3" />
                  <ThSort label="Variação" active={sortKey === "variacaoPct"} dir={sortDir} onClick={() => toggleSort("variacaoPct")} className="px-1 pb-3" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p, i) => {
                  const idx = printing ? i : (pageSafe - 1) * pageSize + i;
                  return (
                    <tr
                      key={p.chave}
                      tabIndex={0}
                      onClick={() => abrir({ tipo: "produto", chave: p.chave, nome: p.nome })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          abrir({ tipo: "produto", chave: p.chave, nome: p.nome });
                        }
                      }}
                      className="cursor-pointer border-b border-line transition-colors hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none"
                    >
                      <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{idx + 1}</td>
                      <td className="px-1 py-3">
                        <ProductNameCell nome={p.nome} idx={idx} sub={p.codigo} />
                      </td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{num(p.itens)}</td>
                      <td className="px-1 py-3 text-right font-mono text-[13px] font-bold text-t0">{brlCent(p.faturamento)}</td>
                      <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", p.cmv == null ? "text-t2" : "text-t0")}>{moneyOrDash(p.cmv)}</td>
                      <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", corLucro(p.lucro))}>{moneyOrDash(p.lucro)}</td>
                      <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-bold", p.margemPct == null ? "text-t2" : "text-ok")}>
                        {pctFmt(p.margemPct)}
                      </td>
                      <td className="px-1 py-3 text-right font-mono text-[13px]">
                        <Tooltip label={tipVariacao}>
                          <span>
                            <Variacao v={p.variacaoPct} />
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
                      {num(linhasTabela.length)} produto{linhasTabela.length === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{num(totalTabela.itens)}</td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold text-t0">{brlCent(totalTabela.faturamento)}</td>
                  <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-extrabold", totalTabela.cmv == null ? "text-t2" : "text-t0")}>
                    {moneyOrDash(totalTabela.cmv)}
                  </td>
                  <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-extrabold", corLucro(totalTabela.lucro))}>
                    {moneyOrDash(totalTabela.lucro)}
                  </td>
                  <td className={cn("px-1 py-3 text-right font-mono text-[13px] font-extrabold", totalTabela.margemPct == null ? "text-t2" : "text-ok")}>
                    {pctFmt(totalTabela.margemPct)}
                  </td>
                  <td className="px-1 py-3 text-right font-mono text-[13px] font-extrabold">
                    <Tooltip label={tipVariacaoTotal}>
                      <span>
                        <Variacao v={totalTabela.variacaoPct} />
                      </span>
                    </Tooltip>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {linhasTabela.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
            <span className="text-[12.5px] text-t2">
              Mostrando {pageRows.length} de {num(linhasTabela.length)} produtos
            </span>
            {totalPages > 1 && <Pagination page={pageSafe} totalPages={totalPages} onChange={setPage} />}
          </div>
        )}
      </Card>
      </>
      )}

      {detalheModal}
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
