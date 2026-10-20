import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Alert, Badge, Button, Card, CardTitle, ThSort, type SortDir } from "@/components/ui";
import { statusBadgeVariant } from "@/lib/status";
import { StockProductsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { ProductNameCell } from "@/components/wedash/ProductNameCell";
import { Tooltip } from "@/components/ui/Tooltip";
import { productBrand, stockCostAmount, stockStatus, type StockProductRow, type StockStatus } from "@/data/wedash/stockProducts";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { exportPdf, reportFileTitle, usePrintMode } from "@/lib/printMode";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { TABLE_PAGE_SIZE } from "@/lib/usePagedRows";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { ErpStatusNotice } from "@/pages/dashboard/ErpStatusNotice";
import { ExportDialog } from "@/components/wedash/ExportDialog";
import { ReportHeader, pickedStoreFile, reportFileParts, useExportPdf, useReportFileTitle } from "@/pages/dashboard/ReportHeader";
import { storeListSubtitle } from "@/data/wedash/stores";
import { SectionHeader } from "@/pages/operation/shared";
import { HeaderFilter, HeaderSearch } from "@/pages/dashboard/HeaderFilter";
import { STOCK_STATUS_LABEL, downloadInventoryXlsx, stockTransferNote } from "./inventoryExport";
import {
  TableFooter,
  TipHelp,
  HeaderFilters,
  localQty,
  money,
  qty,
  stockLocations,
} from "./shared";
import { useStockData } from "./useStockData";

type StatusFilter = "todos" | StockStatus;
type BrandFilter = "" | "WEPINK" | "WPINK";
type SortKey = "name" | "estoque" | "receber" | "totalGeral" | "custo" | "valor" | "status" | `local:${string}`;

/** Ordenar por Status: do maior para o menor = o mais grave primeiro. */
const STATUS_WEIGHT: Record<StockStatus, number> = { negative: 2, awaiting: 1, ok: 0 };

export function InventoryPage() {
  const [printIds, setPrintIds] = useState<string[] | null>(null);
  const { storeRows, storeKey, view, loading, syncing, atualizadoText } = useStockData(printIds);
  const [search, setSearch] = useState("");
  const [statusPicked, setStatus] = useState<StatusFilter>("todos");
  const [brand, setBrand] = useState<BrandFilter>("");
  const [category, setCategory] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const printing = usePrintMode();
  const showSkeleton = useMinSkeleton(loading);
  const exportScreenPdf = useExportPdf("Estoque", null, { period: false });
  const fileTitle = useReportFileTitle("Estoque", null, { period: false });
  const shownCount = printIds && printIds.length > 0 && printIds.length < storeRows.length ? printIds.length : storeRows.length;
  const multipleStores = shownCount > 1;
  const exportStores =
    storeRows.length > 1 ? storeRows.map((store) => ({ id: store.id, name: store.tradeName, detail: storeListSubtitle(store) })) : undefined;
  const showBrand = storeRows.some((s) => s.hasWpink);
  const activeBrand: BrandFilter = showBrand ? brand : "";

  const withStatus = useMemo(() => (view?.rows ?? []).map((r) => ({ r, status: stockStatus(r) })), [view]);
  const count = (s: StockStatus) => withStatus.filter((x) => x.status === s).length;
  const nNegative = count("negative");
  const statusOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: "todos", label: "Todos os status" },
    ...(Object.keys(STOCK_STATUS_LABEL) as StockStatus[])
      .map((s) => ({ value: s, label: `${STOCK_STATUS_LABEL[s]} (${count(s)})`, n: count(s) }))
      .filter((o) => o.n > 0)
      .map(({ value, label }) => ({ value, label })),
  ];
  const status = statusOptions.some((o) => o.value === statusPicked) ? statusPicked : "todos";
  const categories = view?.categories ?? [];

  const locations = useMemo(() => (view ? stockLocations(view.rows) : []), [view]);
  const showsTotal = locations.length !== 1;

  const lines = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = withStatus.filter(
      ({ r, status: s }) =>
        (status === "todos" || s === status) &&
        (!activeBrand || productBrand(r.code) === activeBrand) &&
        (!category || r.category === category) &&
        (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)),
    );
    const dir = sortDir === "asc" ? 1 : -1;
    const amount = ({ r, status: s }: (typeof out)[number]): number =>
      sortKey === "status" ? STATUS_WEIGHT[s] : sortKey.startsWith("local:") ? localQty(r, sortKey.slice(6)) : r.stock;
    out.sort((a, b) => {
      if (sortKey === "name") return a.r.name.localeCompare(b.r.name, "pt-BR") * dir;
      if (sortKey === "receber" || sortKey === "totalGeral") {
        const pick = (r: StockProductRow) => (sortKey === "receber" ? r.aReceive : r.totalGeral);
        const av = pick(a.r);
        const bv = pick(b.r);
        if (av == null && bv == null) return a.r.name.localeCompare(b.r.name, "pt-BR");
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * dir || a.r.name.localeCompare(b.r.name, "pt-BR");
      }
      if (sortKey === "custo" || sortKey === "valor") {
        const pick = (r: StockProductRow) => (sortKey === "custo" ? stockCostAmount(r).unit : stockCostAmount(r).amount);
        const av = pick(a.r);
        const bv = pick(b.r);
        if (av == null && bv == null) return a.r.name.localeCompare(b.r.name, "pt-BR");
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * dir || a.r.name.localeCompare(b.r.name, "pt-BR");
      }
      return (amount(a) - amount(b)) * dir || a.r.name.localeCompare(b.r.name, "pt-BR");
    });
    return out;
  }, [withStatus, search, status, activeBrand, category, sortKey, sortDir]);

  useEffect(() => setPage(1), [search, status, activeBrand, category, sortKey, sortDir, storeKey]);

  const totalPages = Math.max(1, Math.ceil(lines.length / TABLE_PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = printing ? lines : lines.slice((pageSafe - 1) * TABLE_PAGE_SIZE, pageSafe * TABLE_PAGE_SIZE);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "name" ? "asc" : "desc");
    }
  };

  const totais = useMemo(
    () => ({
      locations: locations.map((name) => lines.reduce((s, { r }) => s + localQty(r, name), 0)),
      stock: lines.reduce((s, { r }) => s + r.stock, 0),
      receive: lines.every(({ r }) => r.aReceive == null) ? null : lines.reduce((s, { r }) => s + (r.aReceive ?? 0), 0),
      totalGeral: lines.every(({ r }) => r.totalGeral == null) ? null : lines.reduce((s, { r }) => s + (r.totalGeral ?? 0), 0),
      amount: lines.reduce((s, { r }) => s + (stockCostAmount(r).amount ?? 0), 0),
      hasAmount: lines.some((x) => stockCostAmount(x.r).amount != null),
    }),
    [lines, locations],
  );

  const statusLabel = statusOptions.find((o) => o.value === status)?.label ?? "Todos os status";
  const exportSnap = useRef({ lines, locations });
  exportSnap.current = { lines, locations };

  function exportInventory(format: "pdf" | "xlsx" | "csv", storeIds?: string[]) {
    const ids = storeIds && storeIds.length > 0 && storeIds.length < storeRows.length ? storeIds : null;
    if (format === "xlsx") {
      if (!ids) {
        downloadInventoryXlsx(lines, locations, fileTitle());
        return;
      }
      flushSync(() => setPrintIds(ids));
      const snap = exportSnap.current;
      downloadInventoryXlsx(
        snap.lines,
        snap.locations,
        reportFileTitle(reportFileParts("Estoque", pickedStoreFile(storeRows, ids), "", null, false)),
      );
      flushSync(() => setPrintIds(null));
      return;
    }
    if (format !== "pdf") return;
    if (!ids) {
      exportScreenPdf();
      return;
    }
    flushSync(() => setPrintIds(ids));
    exportPdf(reportFileParts("Estoque", pickedStoreFile(storeRows, ids), "", null, false));
    const done = () => {
      window.removeEventListener("afterprint", done);
      setPrintIds(null);
    };
    window.addEventListener("afterprint", done);
  }

  return (
    <div className="flex flex-col p-4 sm:p-6 print:p-0">
      <ReportHeader
        period={false}
        atualizado={atualizadoText}
        filters={[
          ...(status !== "todos" ? [{ label: "Status", amount: statusLabel }] : []),
          ...(activeBrand ? [{ label: "Marca", amount: activeBrand }] : []),
          ...(category ? [{ label: "Categoria", amount: category }] : []),
        ]}
        pickedIds={printIds}
      />
      <SectionHeader
        section="Estoque"
        title="Estoque"
        subtitle="Acompanhe o saldo de cada produto, o que está a receber e o total dos dois."
        actions={
          <HeaderFilters>
            <HeaderSearch value={search} onChange={setSearch} placeholder="Buscar por produto ou código…" width={240} />
            <HeaderFilter label="Status" value={status} onChange={setStatus} options={statusOptions} />
            {showBrand && (
              <HeaderFilter
                label="Marca"
                value={brand}
                onChange={setBrand}
                options={[
                  { value: "", label: "Todas as marcas" },
                  { value: "WEPINK", label: "WEPINK" },
                  { value: "WPINK", label: "WPINK" },
                ]}
              />
            )}
            {categories.length > 1 && (
              <HeaderFilter
                label="Categoria"
                value={category}
                onChange={setCategory}
                options={[{ value: "", label: "Todas as categorias" }, ...categories.map((c) => ({ value: c, label: c }))]}
              />
            )}
            <ExportDialog formats={["pdf", "xlsx"]} stores={exportStores} disabled={!view} onExport={exportInventory} />
          </HeaderFilters>
        }
        notices={
          <>
            <ErpStatusNotice dado="estoque" className="" />
            {!showSkeleton && view && nNegative > 0 && (
              <Alert
                variant="warning"
                title={nNegative === 1 ? "1 produto está com estoque negativo no Millennium" : `${nNegative} produtos estão com estoque negativo no Millennium`}
              >
                Confira as entradas e saídas desses produtos.
              </Alert>
            )}
          </>
        }
      />

      {showSkeleton || !view ? (
        <StockProductsSkeleton />
      ) : (
        <Card className="print-flow flex flex-col">
          <CardTitle className="mb-4">Produtos</CardTitle>
          {lines.length === 0 ? (
            <div className="flex flex-1">
              {view.rows.length === 0 ? (
                syncing ? (
                  <EmptyBlock icon="📦" title="Buscando estoque" description="Buscando os saldos no Millennium…" />
                ) : (
                  <EmptyBlock
                    icon="📦"
                    title="Nenhum saldo encontrado"
                    description={multipleStores ? "Nenhum produto com saldo nas filiais selecionadas." : "Nenhum produto com saldo nesta filial."}
                  />
                )
              ) : (
                <EmptyBlock
                  icon="🔍"
                  title="Nenhum produto encontrado"
                  description="Tente buscar por outro nome ou código ou altere os filtros."
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSearch("");
                        setStatus("todos");
                        setBrand("");
                        setCategory("");
                      }}
                    >
                      Limpar filtros
                    </Button>
                  }
                />
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-[11px] tracking-wide text-t2">
                    <th className="w-11 whitespace-nowrap px-1 pb-3 text-center font-bold">#</th>
                    <ThSort label="Produto" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} align="left" className="w-full px-1 pb-3" />
                    {locations.map((name) => (
                      <ThSort
                        key={name}
                        label={name}
                        active={sortKey === `local:${name}`}
                        dir={sortDir}
                        onClick={() => toggleSort(`local:${name}`)}
                        className="w-0 whitespace-nowrap px-4 pb-3"
                      />
                    ))}
                    {showsTotal && (
                      <ThSort label="Total" active={sortKey === "estoque"} dir={sortDir} onClick={() => toggleSort("estoque")} className="w-0 whitespace-nowrap px-4 pb-3" />
                    )}
                    <ThSort label="A receber" active={sortKey === "receber"} dir={sortDir} onClick={() => toggleSort("receber")} className="w-0 whitespace-nowrap px-4 pb-3" />
                    <ThSort label="Total geral" active={sortKey === "totalGeral"} dir={sortDir} onClick={() => toggleSort("totalGeral")} className="w-0 whitespace-nowrap px-4 pb-3" />
                    <ThSort label="Preço de custo" active={sortKey === "custo"} dir={sortDir} onClick={() => toggleSort("custo")} className="w-0 whitespace-nowrap px-4 pb-3" />
                    <ThSort label="Valor" active={sortKey === "valor"} dir={sortDir} onClick={() => toggleSort("valor")} className="w-0 whitespace-nowrap pb-3 pl-4 pr-8" />
                    <ThSort label="Status" active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")} align="left" className="w-0 whitespace-nowrap pb-3 pl-8 pr-1" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(({ r, status: s }, i) => {
                    const idx = (printing ? 0 : (pageSafe - 1) * TABLE_PAGE_SIZE) + i;
                    return (
                      <tr key={r.code} className="border-b border-line">
                        <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{idx + 1}</td>
                        <td className="px-1 py-3">
                          <ProductNameCell name={r.name} idx={idx} sub={[r.code, r.category].filter(Boolean).join(" · ")} />
                        </td>
                        {locations.map((name) => (
                          <td key={name} className="whitespace-nowrap px-4 py-3 text-right">
                            <Qty v={localQty(r, name)} />
                          </td>
                        ))}
                        {showsTotal && (
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <Qty v={r.stock} />
                          </td>
                        )}
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <Qty v={r.aReceive} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <Qty v={r.totalGeral} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <UnitCost r={r} />
                        </td>
                        <td className="whitespace-nowrap py-3 pl-4 pr-8 text-right">
                          <Money v={stockCostAmount(r).amount} />
                        </td>
                        <td className="whitespace-nowrap py-3 pl-8 pr-1">
                          <StatusCell r={r} status={s} multipleStores={multipleStores} />
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
                        {num(lines.length)} produto{lines.length === 1 ? "" : "s"}
                      </span>
                    </td>
                    {totais.locations.map((v, i) => (
                      <td key={locations[i]} className="whitespace-nowrap px-4 py-3 text-right">
                        <Qty v={v} total />
                      </td>
                    ))}
                    {showsTotal && (
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Qty v={totais.stock} total />
                      </td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Qty v={totais.receive} total />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Qty v={totais.totalGeral} total />
                    </td>
                    <td />
                    <td className="whitespace-nowrap py-3 pl-4 pr-8 text-right">
                      <Money v={totais.hasAmount ? totais.amount : null} total />
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {lines.length > 0 && <TableFooter shown={pageRows.length} total={lines.length} page={pageSafe} totalPages={totalPages} onPage={setPage} />}
        </Card>
      )}
    </div>
  );
}

export default InventoryPage;

/** Saldo em mono negrito (como os numeros do Desempenho por produto): negativo em vermelho, zero em cinza. */
function Qty({ v, total = false }: { v: number | null; total?: boolean }) {
  if (v == null) return <span className={cn("font-mono text-[13px] text-t2", total ? "font-extrabold" : "font-bold")}>—</span>;
  return (
    <span className={cn("whitespace-nowrap font-mono text-[13px] tabular-nums", total ? "font-extrabold" : "font-bold", v < 0 ? "text-bad" : v === 0 ? "text-t2" : "text-t0")}>
      {qty(v)}
    </span>
  );
}

function Money({ v, total = false }: { v: number | null; total?: boolean }) {
  if (v == null) return <span className={cn("font-mono text-[13px] text-t2", total ? "font-extrabold" : "font-bold")}>—</span>;
  return (
    <span className={cn("whitespace-nowrap font-mono text-[13px] tabular-nums", total ? "font-extrabold" : "font-bold", v < 0 ? "text-bad" : "text-t0")}>
      {money(v)}
    </span>
  );
}

function UnitCost({ r }: { r: StockProductRow }) {
  const cost = stockCostAmount(r);
  if (cost.amount != null && cost.unit == null) return <span className="text-[13px] font-semibold text-t2">Varia</span>;
  return <Money v={cost.unit} />;
}

function StatusCell({ r, status, multipleStores }: { r: StockProductRow; status: StockStatus; multipleStores: boolean }) {
  const badge = <Badge variant={statusBadgeVariant(STOCK_STATUS_LABEL[status])}>{STOCK_STATUS_LABEL[status]}</Badge>;
  if (status !== "awaiting") return badge;
  const tip = stockTransferNote(r, multipleStores);
  return (
    <>
      <Tooltip label={tip}>
        <span tabIndex={0} className="cursor-help rounded-[999px] outline-none focus-visible:ring-2 focus-visible:ring-acc">
          {badge}
        </span>
      </Tooltip>
      {/* No papel nao ha tooltip: a instrucao vai escrita abaixo do badge. */}
      <p className="mt-1 hidden whitespace-pre-line text-[11px] leading-4 text-t2 print:block">{tip}</p>
    </>
  );
}
