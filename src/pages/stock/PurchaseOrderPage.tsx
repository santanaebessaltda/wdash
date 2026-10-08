import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Alert, Badge, Button, Card, CardTitle, ThSort, useToast, type SortDir } from "@/components/ui";
import { StockProductsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { ProductNameCell } from "@/components/wedash/ProductNameCell";
import {
  PURCHASE_FACTORS,
  PURCHASE_FILE_HEADER,
  PURCHASE_FILE_TEXT_COLUMNS,
  filterPurchaseRows,
  purchaseOrderFileName,
  purchaseOrderFileRows,
  type PurchaseFilter,
  type PurchaseOrderRow,
} from "@/data/wedash/purchaseOrder";
import { PURCHASE_SYNC_BUSY, PURCHASE_SYNC_ERROR, PURCHASE_SYNC_OFFLINE, PURCHASE_SYNC_TITLE } from "@/data/wedash/purchaseRepo";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { buildXlsx } from "@/lib/xlsx";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { ErpStatusNotice } from "@/pages/dashboard/ErpStatusNotice";
import { HeaderFilter, HeaderSearch } from "@/pages/dashboard/HeaderFilter";
import { SectionHeader, useScopedStores } from "@/pages/operation/shared";
import { HeaderFilters, TableFooter, TipHelp, UpdatedLine, qty } from "./shared";
import { usePurchaseOrder } from "./usePurchaseOrder";

const PAGE_SIZE = 50;

type SortKey = "nome" | "minimo" | "saldo" | "pedidosAbertos" | "total" | "vendidos30" | "multipla" | "novo" | "bloqueado" | "aPedir";

const NUM_COLS: Array<{ key: "saldo" | "pedidosAbertos" | "total" | "vendidos30" | "multipla"; label: string }> = [
  { key: "saldo", label: "Saldo" },
  { key: "pedidosAbertos", label: "Pedidos em aberto" },
  { key: "total", label: "Total em estoque" },
  { key: "vendidos30", label: "Vendidos em 30 dias" },
  { key: "multipla", label: "Múltiplo de compra" },
];

function sortValue(r: PurchaseOrderRow, k: Exclude<SortKey, "nome">): number {
  if (k === "minimo") return r.minimo ?? -1;
  if (k === "aPedir") return r.aPedir ?? -1;
  if (k === "novo") return r.novo ? 1 : 0;
  if (k === "bloqueado") return r.bloqueado ? 1 : 0;
  return r[k];
}

function downloadFile(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function PurchaseOrderPage() {
  const { session, lojas, loading: lojasLoading } = useScopedStores();
  const { show } = useToast();
  const [lojaSel, setLojaSel] = useState("");
  const loja = lojas.find((s) => s.id === lojaSel) ?? lojas[0] ?? null;
  const po = usePurchaseOrder(session.tenantId, loja?.id ?? null);
  const { view } = po;
  const [busca, setBusca] = useState("");
  const [filtroSel, setFiltro] = useState<PurchaseFilter>("todos");
  const [sortKey, setSortKey] = useState<SortKey>("nome");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const showSkeleton = useMinSkeleton(lojasLoading || po.loading);

  const contagens = view?.contagens ?? { noPedido: 0, semMinimo: 0, novos: 0 };
  const filtroOpcoes: Array<{ value: PurchaseFilter; label: string }> = [
    { value: "todos", label: "Todos os produtos" },
    { value: "pedido", label: `Vai para o pedido (${contagens.noPedido})` },
    { value: "semMinimo", label: `Sem mínimo (${contagens.semMinimo})` },
    { value: "novos", label: `Novos (${contagens.novos})` },
  ];
  const filtro = filtroSel;

  const linhas = useMemo(() => {
    const out = filterPurchaseRows(view?.rows ?? [], { busca, filtro });
    const dir = sortDir === "asc" ? 1 : -1;
    const byName = (a: PurchaseOrderRow, b: PurchaseOrderRow) => a.nome.localeCompare(b.nome, "pt-BR");
    return out.sort((a, b) => (sortKey === "nome" ? byName(a, b) * dir : (sortValue(a, sortKey) - sortValue(b, sortKey)) * dir || byName(a, b)));
  }, [view, busca, filtro, sortKey, sortDir]);

  useEffect(() => setPage(1), [busca, filtro, sortKey, sortDir, loja?.id]);

  const totalPages = Math.max(1, Math.ceil(linhas.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = linhas.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const totais = useMemo(
    () => ({
      saldo: linhas.reduce((s, r) => s + r.saldo, 0),
      pedidosAbertos: linhas.reduce((s, r) => s + r.pedidosAbertos, 0),
      total: linhas.reduce((s, r) => s + r.total, 0),
      vendidos30: linhas.reduce((s, r) => s + r.vendidos30, 0),
      aPedir: linhas.reduce((s, r) => s + (r.aPedir ?? 0), 0),
    }),
    [linhas],
  );

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "nome" ? "asc" : "desc");
    }
  };

  const gerarPedido = () => {
    if (!view) return;
    const rows = purchaseOrderFileRows(view);
    if (rows.length === 0) {
      show("Nenhum produto precisa ser incluído no pedido.", "warning");
      return;
    }
    downloadFile(buildXlsx([[...PURCHASE_FILE_HEADER], ...rows], { textColumns: PURCHASE_FILE_TEXT_COLUMNS }), purchaseOrderFileName(new Date()));
    show(`Pedido gerado com ${rows.length} produto${rows.length === 1 ? "" : "s"}.`, "success");
  };

  const limparBusca = () => {
    setBusca("");
    setFiltro("todos");
  };

  const resumo = view?.resumo ?? { produtos: 0, itens: 0 };

  return (
    <div className="flex flex-col p-4 sm:p-6">
      <SectionHeader
        section="Gestão"
        title="Pedido de compra"
        subtitle="Prepare o pedido de compra de cada loja."
        actions={
          <HeaderFilters
            updated={
              loja && (
                <UpdatedLine
                  text={po.atualizadoTexto}
                  tip="O saldo é buscado no Millennium ao abrir esta tela, quando a última busca tem mais de 30 minutos, e quando você usa Atualizar."
                />
              )
            }
          >
            {lojas.length > 1 && (
              <HeaderFilter
                label="Loja"
                value={loja?.id ?? ""}
                onChange={setLojaSel}
                options={lojas.map((s) => ({ value: s.id, label: `${s.codFilial} · ${s.fantasia}` }))}
              />
            )}
            <HeaderSearch value={busca} onChange={setBusca} placeholder="Buscar por produto ou código…" width={240} />
            <HeaderFilter label="Filtro" value={filtro} onChange={setFiltro} options={filtroOpcoes} />
            <span className="inline-flex items-center gap-1.5">
              <HeaderFilter
                label="Multiplicador do pedido"
                lead="Multiplicador do pedido"
                value={String(po.factor)}
                onChange={(v) => po.setFactor(Number(v))}
                options={PURCHASE_FACTORS.map((f) => ({ value: String(f), label: `${f}x` }))}
              />
              <TipHelp label="Multiplica o mínimo de cada produto. A quantidade a pedir desconta o total em estoque e arredonda para o múltiplo de compra." />
            </span>
            <Button variant="primary" size="md" onClick={gerarPedido} disabled={!view || po.syncing}>
              Gerar pedido
            </Button>
          </HeaderFilters>
        }
        notices={
          <>
            <ErpStatusNotice dado="estoque" className="" />
            {po.syncError &&
              (po.syncError === PURCHASE_SYNC_OFFLINE ? (
                <Alert variant="danger" title={po.syncError} />
              ) : (
                <Alert variant="danger" title={PURCHASE_SYNC_TITLE}>
                  {po.syncError === PURCHASE_SYNC_BUSY ? (
                    <>
                      {PURCHASE_SYNC_BUSY}
                      <span className="mt-0.5 block">{PURCHASE_SYNC_ERROR}</span>
                    </>
                  ) : (
                    po.syncError
                  )}
                </Alert>
              ))}
            {!po.syncError && po.stale && po.staleTexto && <Alert variant="warning" title={po.staleTexto} />}
          </>
        }
      />

      <div className="mt-8">
      {showSkeleton ? (
        <StockProductsSkeleton />
      ) : !loja ? (
        <Card className="flex flex-col">
          <EmptyBlock icon="🏬" title="Nenhuma loja disponível" description="Não há lojas disponíveis para este acesso." />
        </Card>
      ) : (
        <Card className="flex flex-col">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <span className="inline-flex items-center gap-1.5">
              <CardTitle>Produtos</CardTitle>
              <TipHelp label="Novo: produto cadastrado no Millennium há menos de 30 dias ou que a loja ainda não vendeu. A segunda regra só é usada quando há histórico suficiente desde a inauguração ou dos últimos 12 meses. Produtos bloqueados para compra não aparecem." />
            </span>
            {view && view.rows.length > 0 && (
              <span className="text-[12.5px] font-semibold text-t1">
                {num(resumo.produtos)} produto{resumo.produtos === 1 ? "" : "s"} · {num(resumo.itens)} ite{resumo.itens === 1 ? "m" : "ns"} no pedido
              </span>
            )}
          </div>
          {linhas.length === 0 ? (
            <div className="flex flex-1">
              {!view || view.rows.length === 0 ? (
                po.syncing ? (
                  <EmptyBlock icon="📦" title="Buscando saldo" description="Buscando o saldo no Millennium…" />
                ) : (
                  <EmptyBlock icon="📦" title="Nenhum produto disponível para pedido" description="O Millennium não retornou produtos liberados para compra nesta loja." />
                )
              ) : (
                <EmptyBlock
                  icon="🔍"
                  title="Nenhum produto encontrado"
                  description="Tente buscar por outro nome ou código ou altere os filtros."
                  action={
                    <Button variant="outline" size="sm" onClick={limparBusca}>
                      Limpar filtros
                    </Button>
                  }
                />
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1160px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
                    <th className="px-1 pb-3 text-left font-bold">#</th>
                    <ThSort label="Produto" active={sortKey === "nome"} dir={sortDir} onClick={() => toggleSort("nome")} align="left" className="px-1 pb-3" />
                    <ThSort label="Mínimo" active={sortKey === "minimo"} dir={sortDir} onClick={() => toggleSort("minimo")} className="px-1 pb-3" />
                    {NUM_COLS.map((c) => (
                      <ThSort key={c.key} label={c.label} active={sortKey === c.key} dir={sortDir} onClick={() => toggleSort(c.key)} className="px-1 pb-3" />
                    ))}
                    <ThSort label="Novo" active={sortKey === "novo"} dir={sortDir} onClick={() => toggleSort("novo")} align="center" className="px-1 pb-3" />
                    <ThSort label="Bloqueado" active={sortKey === "bloqueado"} dir={sortDir} onClick={() => toggleSort("bloqueado")} align="center" className="px-1 pb-3" />
                    <ThSort label="A pedir" active={sortKey === "aPedir"} dir={sortDir} onClick={() => toggleSort("aPedir")} className="px-1 pb-3" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, i) => {
                    const idx = (pageSafe - 1) * PAGE_SIZE + i;
                    const categoria = po.catalog?.get(r.code)?.category;
                    return (
                      <tr key={r.code} className={cn("border-b border-line", r.noPedido && "bg-warn-soft")}>
                        <td className={cn("px-1 py-3 text-center text-[13px] font-extrabold text-t2", r.noPedido && "shadow-[inset_3px_0_0_var(--warn)]")}>{idx + 1}</td>
                        <td className="px-1 py-3">
                          <ProductNameCell
                            nome={r.nome}
                            idx={idx}
                            upper
                            sub={
                              <div className="min-w-0">
                                <p className="truncate text-[11px] uppercase text-t2">{[r.code, categoria].filter(Boolean).join(" · ")}</p>
                                {r.variasVariantes && !r.bloqueado && <p className="mt-0.5 text-[11px] font-semibold text-warn">Este produto tem mais de uma cor ou tamanho. Faça o pedido diretamente no Millennium.</p>}
                              </div>
                            }
                          />
                        </td>
                        <td className="px-1 py-2 text-right">
                          {!r.podePedir ? (
                            <span className="inline-block w-20 pr-2 text-right font-mono text-[13px] font-bold text-t2">{r.minimo == null ? "—" : r.minimo}</span>
                          ) : (
                            <MinInput value={r.minimo} idx={i} label={`Mínimo de ${r.nome}`} onSave={(raw) => po.saveMin(r.code, raw)} />
                          )}
                        </td>
                        {NUM_COLS.map((c) => (
                          <td key={c.key} className="px-1 py-3 text-right">
                            <Qty v={r[c.key]} />
                          </td>
                        ))}
                        <td className="px-1 py-3 text-center">
                          {r.novo ? <Badge variant="accent">Sim</Badge> : <span className="text-[13px] font-semibold text-t2">Não</span>}
                        </td>
                        <td className="px-1 py-3 text-center">
                          {r.bloqueado ? <Badge variant="warning">Sim</Badge> : <span className="text-[13px] font-semibold text-t2">Não</span>}
                        </td>
                        <td className="px-1 py-3 text-right">
                          {r.aPedir == null ? <span className="font-mono text-[13px] font-bold text-t2">—</span> : <Qty v={r.aPedir} strong={r.aPedir > 0} />}
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
                        {num(linhas.length)} produto{linhas.length === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td />
                    <td className="px-1 py-3 text-right">
                      <Qty v={totais.saldo} total />
                    </td>
                    <td className="px-1 py-3 text-right">
                      <Qty v={totais.pedidosAbertos} total />
                    </td>
                    <td className="px-1 py-3 text-right">
                      <Qty v={totais.total} total />
                    </td>
                    <td className="px-1 py-3 text-right">
                      <Qty v={totais.vendidos30} total />
                    </td>
                    <td />
                    <td />
                    <td />
                    <td className="px-1 py-3 text-right">
                      <Qty v={totais.aPedir} total />
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
    </div>
  );
}

export default PurchaseOrderPage;

function Qty({ v, total = false, strong = false }: { v: number; total?: boolean; strong?: boolean }) {
  return (
    <span
      className={cn(
        "whitespace-nowrap font-mono text-[13px] tabular-nums",
        total || strong ? "font-extrabold" : "font-bold",
        v < 0 ? "text-bad" : v === 0 ? "text-t2" : "text-t0",
      )}
    >
      {qty(v)}
    </span>
  );
}

const fmtMin = (v: number | null) => (v == null ? "" : String(v));

/** Mínimo editável: grava ao sair do campo; Enter desce para o mínimo da linha de baixo; Esc desfaz. */
function MinInput({ value, idx, label, onSave }: { value: number | null; idx: number; label: string; onSave: (raw: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(fmtMin(value));
  const cancelRef = useRef(false);
  useEffect(() => setDraft(fmtMin(value)), [value]);

  const commit = async () => {
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }
    if (draft.trim() === fmtMin(value)) return;
    const ok = await onSave(draft);
    if (!ok) setDraft(fmtMin(value));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const inputs = [...document.querySelectorAll<HTMLInputElement>("input[data-min-idx]")];
      const next = inputs[inputs.indexOf(e.currentTarget) + 1];
      if (next) next.focus();
      else e.currentTarget.blur();
    } else if (e.key === "Escape") {
      cancelRef.current = true;
      setDraft(fmtMin(value));
      e.currentTarget.blur();
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      data-min-idx={idx}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={onKeyDown}
      onFocus={(e) => e.currentTarget.select()}
      className="h-8 w-20 rounded-[var(--radius-vela-sm)] border border-line bg-bg-inset px-2 text-right font-mono text-[13px] font-bold text-t0 outline-none transition-colors placeholder:text-t2 focus:border-acc"
    />
  );
}
