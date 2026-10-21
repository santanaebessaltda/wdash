import { Fragment, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, CardTitle, ThSort, type SortDir } from "@/components/ui";
import { statusBadgeVariant } from "@/lib/status";
import { StockProductsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { ProductNameCell } from "@/components/wedash/ProductNameCell";
import { Tooltip } from "@/components/ui/Tooltip";
import { productBrand, stockCostAmount, stockStatus, storeStockStatus, type StockProductRow, type StockStatus, type StockStoreDetail } from "@/data/wedash/stockProducts";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { usePrintMode } from "@/lib/printMode";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { TABLE_PAGE_SIZE } from "@/lib/usePagedRows";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { ErpStatusNotice } from "@/pages/dashboard/ErpStatusNotice";
import { ExportDialog } from "@/components/wedash/ExportDialog";
import { ReportHeader, useExportPdf, useReportFileTitle } from "@/pages/dashboard/ReportHeader";
import { SectionHeader } from "@/pages/operation/shared";
import { HeaderFilter, HeaderSearch } from "@/pages/dashboard/HeaderFilter";
import { STOCK_STATUS_LABEL, downloadInventoryXlsx, stockTransferNote } from "./inventoryExport";
import {
  TableFooter,
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
  const { storeRows, storeKey, view, loading, syncing, atualizadoText } = useStockData();
  const [search, setSearch] = useState("");
  const [statusPicked, setStatus] = useState<StatusFilter>("todos");
  const [brand, setBrand] = useState<BrandFilter>("");
  const [category, setCategory] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const printing = usePrintMode();
  const showSkeleton = useMinSkeleton(loading);
  const exportScreenPdf = useExportPdf("Estoque", null, { period: false });
  const fileTitle = useReportFileTitle("Estoque", null, { period: false });
  const multipleStores = storeRows.length > 1;
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
  useEffect(() => setOpened({}), [storeKey]);

  const totalPages = Math.max(1, Math.ceil(lines.length / TABLE_PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = printing ? lines : lines.slice((pageSafe - 1) * TABLE_PAGE_SIZE, pageSafe * TABLE_PAGE_SIZE);

  const toggleGroup = (code: string) => setOpened((current) => ({ ...current, [code]: !current[code] }));

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

  function exportInventory(format: "pdf" | "xlsx" | "csv") {
    if (format === "xlsx") downloadInventoryXlsx(lines, locations, fileTitle());
    else if (format === "pdf") exportScreenPdf();
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
            <ExportDialog formats={["pdf", "xlsx"]} disabled={!view} onExport={exportInventory} />
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
        <Card className="print-flow flex min-w-0 flex-col overflow-hidden print:overflow-visible">
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
            <div className="min-w-0 overflow-x-auto">
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
                    const open = multipleStores && Boolean(opened[r.code]);
                    const branches = multipleStores ? [...r.storeRows].sort((a, b) => branchName(a).localeCompare(branchName(b), "pt-BR")) : [];
                    return (
                      <Fragment key={r.code}>
                        <tr
                          className={cn("border-b border-line", multipleStores && "cursor-pointer bg-bg-3")}
                          onClick={multipleStores ? () => toggleGroup(r.code) : undefined}
                        >
                          <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{idx + 1}</td>
                          <td className="px-1 py-3">
                            {multipleStores ? (
                              <div className="flex min-w-0 items-center gap-2">
                                <button
                                  type="button"
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-t2 outline-none hover:bg-bg-inset focus-visible:ring-2 focus-visible:ring-acc"
                                  aria-expanded={open}
                                  aria-label={open ? `Fechar filiais de ${r.name}` : `Abrir filiais de ${r.name}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleGroup(r.code);
                                  }}
                                >
                                  <Chevron open={open} />
                                </button>
                                <ProductNameCell
                                  name={r.name}
                                  idx={idx}
                                  sub={
                                    <div className="min-w-0">
                                      <p className="truncate text-[11px] text-t2">{[r.code, r.category].filter(Boolean).join(" · ")}</p>
                                      <p className="mt-0.5 text-[11px] font-semibold text-t1">{filialLabel(branches.length)}</p>
                                    </div>
                                  }
                                />
                              </div>
                            ) : (
                              <ProductNameCell name={r.name} idx={idx} sub={[r.code, r.category].filter(Boolean).join(" · ")} />
                            )}
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
                          <td className="whitespace-nowrap py-3 pl-8 pr-1" onClick={(event) => event.stopPropagation()}>
                            <StatusCell r={r} status={s} multipleStores={multipleStores} />
                          </td>
                        </tr>
                        {open &&
                          branches.map((detail) => (
                            <StoreLine key={detail.store.id} detail={detail} product={r} locations={locations} showsTotal={showsTotal} />
                          ))}
                      </Fragment>
                    );
                  })}
                  <tr className="bg-bg-inset">
                    <td />
                    <td className="px-1 py-3 text-[13px] font-extrabold text-t0">
                      Total do filtro
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

function branchName(detail: StockStoreDetail): string {
  return detail.store.tradeName || detail.store.name;
}

function filialLabel(count: number): string {
  return count === 1 ? "1 filial" : `${num(count)} filiais`;
}

function storeLocalQty(detail: StockStoreDetail, name: string): number {
  return detail.locations.find((x) => x.name === name)?.qty ?? 0;
}

function storeAmount(detail: StockStoreDetail): number | null {
  const unit = detail.composition.cost;
  if (unit == null) return null;
  return detail.stock * unit;
}

function storeTotal(detail: StockStoreDetail): number | null {
  return detail.aReceive == null ? null : detail.stock + detail.aReceive;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
      <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Linha da filial, abaixo do produto. Mesmas colunas, sem marca de quantidade. */
function StoreLine({ detail, product, locations, showsTotal }: { detail: StockStoreDetail; product: StockProductRow; locations: string[]; showsTotal: boolean }) {
  const oneStore: StockProductRow = { ...product, storeRows: [detail], stock: detail.stock, aReceive: detail.aReceive, totalGeral: storeTotal(detail) };
  return (
    <tr className="border-b border-line bg-bg-inset">
      <td />
      <td className="border-l-2 border-l-line-2 px-1 py-2.5 pl-16">
        <p className="break-words text-[12.5px] font-semibold leading-5 text-t1">{branchName(detail)}</p>
      </td>
      {locations.map((name) => (
        <td key={name} className="whitespace-nowrap px-4 py-2.5 text-right">
          <Qty v={storeLocalQty(detail, name)} />
        </td>
      ))}
      {showsTotal && (
        <td className="whitespace-nowrap px-4 py-2.5 text-right">
          <Qty v={detail.stock} />
        </td>
      )}
      <td className="whitespace-nowrap px-4 py-2.5 text-right">
        <Qty v={detail.aReceive} />
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right">
        <Qty v={storeTotal(detail)} />
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right">
        <Money v={detail.composition.cost} />
      </td>
      <td className="whitespace-nowrap py-2.5 pl-4 pr-8 text-right">
        <Money v={storeAmount(detail)} />
      </td>
      <td className="whitespace-nowrap py-2.5 pl-8 pr-1">
        <StatusCell r={oneStore} status={storeStockStatus(detail)} multipleStores={false} />
      </td>
    </tr>
  );
}

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
