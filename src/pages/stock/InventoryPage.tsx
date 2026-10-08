import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, CardTitle, ThSort, type SortDir } from "@/components/ui";
import type { StatusVariant } from "@/lib/status";
import { StockProductsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { ProductNameCell } from "@/components/wedash/ProductNameCell";
import { Tooltip } from "@/components/ui/Tooltip";
import { productBrand, stockCostAmount, stockStatus, type StockProductRow, type StockStatus } from "@/data/wedash/stockProducts";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { usePrintMode } from "@/lib/printMode";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { TABLE_PAGE_SIZE } from "@/lib/usePagedRows";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { ErpStatusNotice } from "@/pages/dashboard/ErpStatusNotice";
import { ReportHeader, useExportPdf } from "@/pages/dashboard/ReportHeader";
import { SectionHeader } from "@/pages/operation/shared";
import { HeaderFilter, HeaderSearch } from "@/pages/dashboard/HeaderFilter";
import {
  ExportButton,
  TableFooter,
  TipHelp,
  UpdatedLine,
  HeaderFilters,
  localQty,
  money,
  qty,
  stockLocations,
} from "./shared";
import { useStockData } from "./useStockData";

type StatusFiltro = "todos" | StockStatus;
type BrandFiltro = "" | "WEPINK" | "WPINK";
type SortKey = "nome" | "estoque" | "custo" | "valor" | "status" | `local:${string}`;

const STATUS_BADGE: Record<StockStatus, { label: string; variant: StatusVariant }> = {
  negativo: { label: "Negativo", variant: "danger" },
  aguardando: { label: "Aguardando transferência", variant: "warning" },
  ok: { label: "Regular", variant: "success" },
};

/** "Transferir 71 de ESTOQUE para PONTO DE VENDA.", uma linha por transferencia ("LOJA X: transferir ..." quando ha varias lojas). */
function transferTip(r: StockProductRow, variasLojas: boolean): string {
  return r.lojas
    .flatMap((l) =>
      l.transferencias.map((t) => {
        const acao = `transferir ${qty(t.qtd)} de ${t.de} para ${t.para}.`;
        return variasLojas ? `${l.store.fantasia}: ${acao}` : acao.charAt(0).toUpperCase() + acao.slice(1);
      }),
    )
    .join("\n");
}

/** Ordenar por Status: do maior para o menor = o mais grave primeiro. */
const STATUS_PESO: Record<StockStatus, number> = { negativo: 2, aguardando: 1, ok: 0 };

export function InventoryPage() {
  const { lojas, storeKey, view, loading, syncing, atualizadoTexto } = useStockData();
  const [busca, setBusca] = useState("");
  const [statusSel, setStatus] = useState<StatusFiltro>("todos");
  const [marca, setMarca] = useState<BrandFiltro>("");
  const [categoria, setCategoria] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("nome");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const printing = usePrintMode();
  const showSkeleton = useMinSkeleton(loading);
  const exportar = useExportPdf("Estoque", null, { periodo: false });
  const variasLojas = lojas.length > 1;
  const showBrand = lojas.some((s) => s.temWpink);
  const marcaAtiva: BrandFiltro = showBrand ? marca : "";

  const comStatus = useMemo(() => (view?.rows ?? []).map((r) => ({ r, status: stockStatus(r) })), [view]);
  const contagem = (s: StockStatus) => comStatus.filter((x) => x.status === s).length;
  const nNegativo = contagem("negativo");
  const statusOpcoes: Array<{ value: StatusFiltro; label: string }> = [
    { value: "todos", label: "Todos os status" },
    ...(Object.keys(STATUS_BADGE) as StockStatus[])
      .map((s) => ({ value: s, label: `${STATUS_BADGE[s].label} (${contagem(s)})`, n: contagem(s) }))
      .filter((o) => o.n > 0)
      .map(({ value, label }) => ({ value, label })),
  ];
  const status = statusOpcoes.some((o) => o.value === statusSel) ? statusSel : "todos";
  const categorias = view?.categorias ?? [];

  const locais = useMemo(() => (view ? stockLocations(view.rows) : []), [view]);
  const mostraTotal = locais.length !== 1;

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const out = comStatus.filter(
      ({ r, status: s }) =>
        (status === "todos" || s === status) &&
        (!marcaAtiva || productBrand(r.codigo) === marcaAtiva) &&
        (!categoria || r.categoria === categoria) &&
        (!q || r.nome.toLowerCase().includes(q) || r.codigo.toLowerCase().includes(q)),
    );
    const dir = sortDir === "asc" ? 1 : -1;
    const valor = ({ r, status: s }: (typeof out)[number]): number =>
      sortKey === "status" ? STATUS_PESO[s] : sortKey.startsWith("local:") ? localQty(r, sortKey.slice(6)) : r.estoque;
    out.sort((a, b) => {
      if (sortKey === "nome") return a.r.nome.localeCompare(b.r.nome, "pt-BR") * dir;
      if (sortKey === "custo" || sortKey === "valor") {
        const pick = (r: StockProductRow) => (sortKey === "custo" ? stockCostAmount(r).unit : stockCostAmount(r).amount);
        const av = pick(a.r);
        const bv = pick(b.r);
        if (av == null && bv == null) return a.r.nome.localeCompare(b.r.nome, "pt-BR");
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * dir || a.r.nome.localeCompare(b.r.nome, "pt-BR");
      }
      return (valor(a) - valor(b)) * dir || a.r.nome.localeCompare(b.r.nome, "pt-BR");
    });
    return out;
  }, [comStatus, busca, status, marcaAtiva, categoria, sortKey, sortDir]);

  useEffect(() => setPage(1), [busca, status, marcaAtiva, categoria, sortKey, sortDir, storeKey]);

  const totalPages = Math.max(1, Math.ceil(linhas.length / TABLE_PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = printing ? linhas : linhas.slice((pageSafe - 1) * TABLE_PAGE_SIZE, pageSafe * TABLE_PAGE_SIZE);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "nome" ? "asc" : "desc");
    }
  };

  const totais = useMemo(
    () => ({
      locais: locais.map((nome) => linhas.reduce((s, { r }) => s + localQty(r, nome), 0)),
      estoque: linhas.reduce((s, { r }) => s + r.estoque, 0),
      valor: linhas.reduce((s, { r }) => s + (stockCostAmount(r).amount ?? 0), 0),
      temValor: linhas.some((x) => stockCostAmount(x.r).amount != null),
    }),
    [linhas, locais],
  );

  const statusLabel = statusOpcoes.find((o) => o.value === status)?.label ?? "Todos os status";

  return (
    <div className="flex flex-col p-4 sm:p-6 print:p-0">
      <ReportHeader
        periodo={false}
        atualizado={atualizadoTexto}
        filtros={[
          ...(status !== "todos" ? [{ label: "Status", valor: statusLabel }] : []),
          ...(marcaAtiva ? [{ label: "Marca", valor: marcaAtiva }] : []),
          ...(categoria ? [{ label: "Categoria", valor: categoria }] : []),
        ]}
      />
      <SectionHeader
        section="Estoque"
        title="Estoque"
        subtitle="Acompanhe o saldo de cada produto por local de estoque."
        actions={
          <HeaderFilters
            updated={<UpdatedLine text={atualizadoTexto} tip="O estoque é buscado no Millennium ao abrir esta tela, quando a última busca tem mais de 30 minutos, e quando você usa Atualizar." />}
          >
            <HeaderSearch value={busca} onChange={setBusca} placeholder="Buscar por produto ou código…" width={240} />
            <HeaderFilter label="Status" value={status} onChange={setStatus} options={statusOpcoes} />
            {showBrand && (
              <HeaderFilter
                label="Marca"
                value={marca}
                onChange={setMarca}
                options={[
                  { value: "", label: "Todas as marcas" },
                  { value: "WEPINK", label: "WEPINK" },
                  { value: "WPINK", label: "WPINK" },
                ]}
              />
            )}
            {categorias.length > 1 && (
              <HeaderFilter
                label="Categoria"
                value={categoria}
                onChange={setCategoria}
                options={[{ value: "", label: "Todas as categorias" }, ...categorias.map((c) => ({ value: c, label: c }))]}
              />
            )}
            <ExportButton onClick={exportar} />
          </HeaderFilters>
        }
        notices={
          <>
            <ErpStatusNotice dado="estoque" className="" />
            {!showSkeleton && view && nNegativo > 0 && (
              <Alert
                variant="warning"
                title={nNegativo === 1 ? "1 produto está com estoque negativo no Millennium" : `${nNegativo} produtos estão com estoque negativo no Millennium`}
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
        <Card className="flex flex-col">
          <CardTitle className="mb-4">Produtos</CardTitle>
          {linhas.length === 0 ? (
            <div className="flex flex-1">
              {view.rows.length === 0 ? (
                syncing ? (
                  <EmptyBlock icon="📦" title="Buscando estoque" description="Buscando os saldos no Millennium…" />
                ) : (
                  <EmptyBlock
                    icon="📦"
                    title="Nenhum saldo encontrado"
                    description={variasLojas ? "Nenhum produto com saldo nas lojas selecionadas." : "Nenhum produto com saldo nesta loja."}
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
                        setBusca("");
                        setStatus("todos");
                        setMarca("");
                        setCategoria("");
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
                  <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
                    <th className="w-11 whitespace-nowrap px-1 pb-3 text-center font-bold">#</th>
                    <ThSort label="Status" active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")} align="left" className="w-0 whitespace-nowrap pb-3 pl-1 pr-4" />
                    <ThSort label="Produto" active={sortKey === "nome"} dir={sortDir} onClick={() => toggleSort("nome")} align="left" className="w-full px-1 pb-3" />
                    {locais.map((nome) => (
                      <ThSort
                        key={nome}
                        label={nome}
                        active={sortKey === `local:${nome}`}
                        dir={sortDir}
                        onClick={() => toggleSort(`local:${nome}`)}
                        className="w-0 whitespace-nowrap px-3 pb-3"
                      />
                    ))}
                    {mostraTotal && (
                      <ThSort label="Total" active={sortKey === "estoque"} dir={sortDir} onClick={() => toggleSort("estoque")} className="w-0 whitespace-nowrap px-3 pb-3" />
                    )}
                    <ThSort label="Preço de custo" active={sortKey === "custo"} dir={sortDir} onClick={() => toggleSort("custo")} className="w-0 whitespace-nowrap px-3 pb-3" />
                    <ThSort label="Valor" active={sortKey === "valor"} dir={sortDir} onClick={() => toggleSort("valor")} className="w-0 whitespace-nowrap px-3 pb-3" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(({ r, status: s }, i) => {
                    const idx = (printing ? 0 : (pageSafe - 1) * TABLE_PAGE_SIZE) + i;
                    return (
                      <tr key={r.codigo} className="border-b border-line">
                        <td className="px-1 py-3 text-center text-[13px] font-extrabold text-t2">{idx + 1}</td>
                        <td className="whitespace-nowrap py-3 pl-1 pr-4">
                          <StatusCell r={r} status={s} variasLojas={variasLojas} />
                        </td>
                        <td className="px-1 py-3">
                          <ProductNameCell nome={r.nome} idx={idx} sub={[r.codigo, r.categoria].filter(Boolean).join(" · ")} />
                        </td>
                        {locais.map((nome) => (
                          <td key={nome} className="whitespace-nowrap px-3 py-3 text-right">
                            <Qty v={localQty(r, nome)} />
                          </td>
                        ))}
                        {mostraTotal && (
                          <td className="whitespace-nowrap px-3 py-3 text-right">
                            <Qty v={r.estoque} />
                          </td>
                        )}
                        <td className="whitespace-nowrap px-3 py-3 text-right">
                          <UnitCost r={r} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right">
                          <Money v={stockCostAmount(r).amount} />
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-bg-inset">
                    <td />
                    <td />
                    <td className="px-1 py-3 text-[13px] font-extrabold text-t0">
                      <span className="inline-flex items-center gap-1">
                        Total do filtro
                        <TipHelp label="Soma todos os produtos encontrados no filtro, inclusive os que não aparecem nesta página." />
                      </span>
                      <span className="mt-0.5 block text-[11px] font-semibold text-t2">
                        {num(linhas.length)} produto{linhas.length === 1 ? "" : "s"}
                      </span>
                    </td>
                    {totais.locais.map((v, i) => (
                      <td key={locais[i]} className="whitespace-nowrap px-3 py-3 text-right">
                        <Qty v={v} total />
                      </td>
                    ))}
                    {mostraTotal && (
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <Qty v={totais.estoque} total />
                      </td>
                    )}
                    <td />
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      <Money v={totais.temValor ? totais.valor : null} total />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {linhas.length > 0 && <TableFooter shown={pageRows.length} total={linhas.length} page={pageSafe} totalPages={totalPages} onPage={setPage} />}
        </Card>
      )}
    </div>
  );
}

export default InventoryPage;

/** Saldo em mono negrito (como os numeros do Desempenho por produto): negativo em vermelho, zero em cinza. */
function Qty({ v, total = false }: { v: number; total?: boolean }) {
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

function StatusCell({ r, status, variasLojas }: { r: StockProductRow; status: StockStatus; variasLojas: boolean }) {
  const badge = <Badge variant={STATUS_BADGE[status].variant}>{STATUS_BADGE[status].label}</Badge>;
  if (status !== "aguardando") return badge;
  const tip = transferTip(r, variasLojas);
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
