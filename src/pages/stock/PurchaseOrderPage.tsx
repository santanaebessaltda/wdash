import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Alert, Badge, Button, Card, CardTitle, Dropdown, FormField, Modal, Select, ThSort, useToast, type DropdownItem, type SortDir } from "@/components/ui";
import { StockProductsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { ProductNameCell } from "@/components/wedash/ProductNameCell";
import {
  PURCHASE_FACTORS,
  PURCHASE_FILE_HEADER,
  PURCHASE_FILE_TEXT_COLUMNS,
  filterPurchaseRows,
  purchaseMinsToCopy,
  purchaseLineCents,
  purchaseOrderFileName,
  purchaseOrderFileRows,
  purchaseOrderTotalCents,
  type PurchaseFilter,
  type PurchaseOrderRow,
} from "@/data/wedash/purchaseOrder";
import { PURCHASE_SYNC_BUSY, PURCHASE_SYNC_ERROR, PURCHASE_SYNC_OFFLINE, PURCHASE_SYNC_TITLE, fetchPurchaseStock, savePurchaseMins } from "@/data/wedash/purchaseRepo";
import { storesForSession } from "@/data/wedash/stores";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { buildXlsx } from "@/lib/xlsx";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { ErpStatusNotice } from "@/pages/dashboard/ErpStatusNotice";
import { HeaderFilter, HeaderSearch } from "@/pages/dashboard/HeaderFilter";
import { SectionHeader, SelectStoreCard, useScopedStores } from "@/pages/operation/shared";
import { HeaderFilters, TableFooter, TipHelp, money, qty } from "./shared";
import { SOLD_WINDOWS, usePurchaseOrder } from "./usePurchaseOrder";

const PAGE_SIZE = 50;

type SortKey = "name" | "minimo" | "saldo" | "pedidosAbertos" | "total" | "vendidos30" | "multipla" | "novo" | "bloqueado" | "aPedir";

const NUM_COLS: Array<{ key: "saldo" | "pedidosAbertos" | "total" | "vendidos30" | "multipla"; label: string }> = [
  { key: "saldo", label: "Saldo" },
  { key: "pedidosAbertos", label: "Pedidos em aberto" },
  { key: "total", label: "Total em estoque" },
  { key: "vendidos30", label: "Vendidos em 30 dias" },
  { key: "multipla", label: "Múltiplo de compra" },
];

function sortValue(r: PurchaseOrderRow, k: Exclude<SortKey, "name">): number {
  if (k === "minimo") return r.minimum ?? -1;
  if (k === "aPedir") return r.aRequest ?? -1;
  if (k === "novo") return r.isNew ? 1 : 0;
  if (k === "bloqueado") return r.blocked ? 1 : 0;
  return r[k];
}

function YesNo({ yes }: { yes: boolean }) {
  return yes ? <Badge variant="accent">Sim</Badge> : <Badge variant="neutral">Não</Badge>;
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
  const { session, storeRows, loading: storesLoading } = useScopedStores();
  const { show } = useToast();
  const store = storeRows.length === 1 ? storeRows[0] : null;
  const po = usePurchaseOrder(session.tenantId, store?.id ?? null, store?.costTableId ?? null);
  const { view } = po;
  const [search, setSearch] = useState("");
  const [filterPicked, setFilter] = useState<PurchaseFilter>("todos");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [summaryOrder, setSummaryOrder] = useState<PurchaseOrderRow[] | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [destinationId, setDestinationId] = useState("");
  const [copiando, setCopiando] = useState(false);
  const showSkeleton = useMinSkeleton(storesLoading || (store != null && po.loading));

  const counts = view?.counts ?? { onOrder: 0, withoutMinimum: 0, novos: 0 };
  const filterOptions: Array<{ value: PurchaseFilter; label: string }> = [
    { value: "todos", label: "Todos os produtos" },
    { value: "pedido", label: `Vai para o pedido (${counts.onOrder})` },
    { value: "semMinimo", label: `Sem mínimo (${counts.withoutMinimum})` },
    { value: "novos", label: `Novos (${counts.novos})` },
  ];
  const filter = filterPicked;

  const lines = useMemo(() => {
    const out = filterPurchaseRows(view?.rows ?? [], { search, filter });
    const dir = sortDir === "asc" ? 1 : -1;
    const byName = (a: PurchaseOrderRow, b: PurchaseOrderRow) => a.name.localeCompare(b.name, "pt-BR");
    return out.sort((a, b) => (sortKey === "name" ? byName(a, b) * dir : (sortValue(a, sortKey) - sortValue(b, sortKey)) * dir || byName(a, b)));
  }, [view, search, filter, sortKey, sortDir]);

  useEffect(() => setPage(1), [search, filter, sortKey, sortDir, store?.id]);
  useEffect(() => {
    setSummaryOrder(null);
  }, [store?.id]);

  const totalPages = Math.max(1, Math.ceil(lines.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = lines.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const totais = useMemo(
    () => ({
      saldo: lines.reduce((s, r) => s + r.saldo, 0),
      pedidosAbertos: lines.reduce((s, r) => s + r.pedidosAbertos, 0),
      total: lines.reduce((s, r) => s + r.total, 0),
      vendidos30: lines.reduce((s, r) => s + r.vendidos30, 0),
      aRequest: lines.reduce((s, r) => s + (r.aRequest ?? 0), 0),
    }),
    [lines],
  );

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "name" ? "asc" : "desc");
    }
  };

  const openSummary = () => {
    if (!view) return;
    const products = view.rows.filter((r) => r.onOrder).sort((a, b) => a.position - b.position);
    if (products.length === 0) {
      show("Nenhum produto precisa ser incluído no pedido.", "warning");
      return;
    }
    setSummaryOrder(products);
  };

  const generateOrder = () => {
    if (!view || !summaryOrder || summaryOrder.length === 0) return;
    const rows = purchaseOrderFileRows({ ...view, rows: summaryOrder });
    if (rows.length === 0) {
      show("Nenhum produto precisa ser incluído no pedido.", "warning");
      setSummaryOrder(null);
      return;
    }
    downloadFile(buildXlsx([[...PURCHASE_FILE_HEADER], ...rows], { textColumns: PURCHASE_FILE_TEXT_COLUMNS }), purchaseOrderFileName(new Date()));
    show(`Pedido gerado com ${rows.length} produto${rows.length === 1 ? "" : "s"}.`, "success");
    setSummaryOrder(null);
  };

  const network = storesForSession(session.stores);
  const otherStores = store ? network.filter((s) => s.id !== store.id) : network;
  const all = destinationId === "" && otherStores.length > 1;
  const destination = otherStores.find((s) => s.id === destinationId) ?? null;

  const openCopy = () => {
    setDestinationId(otherStores.length > 1 ? "" : (otherStores[0]?.id ?? ""));
    setCopyOpen(true);
  };

  const copyMinimums = async () => {
    if (!store || !po.mins || po.mins.size === 0) return;
    const targets = all ? otherStores : destination ? [destination] : [];
    if (targets.length === 0) return;
    setCopiando(true);
    try {
      let copiadas = 0;
      let withoutSaldo = 0;
      let withoutProduct = 0;
      let falhas = 0;
      for (const target of targets) {
        const stock = await fetchPurchaseStock(session.tenantId, target.id);
        if (stock.rows.length === 0) {
          withoutSaldo += 1;
          continue;
        }
        const { updates } = purchaseMinsToCopy(po.mins, new Set(stock.rows.map((row) => row.code)));
        if (updates.length === 0) {
          withoutProduct += 1;
          continue;
        }
        const ok = await savePurchaseMins(session.tenantId, target.id, updates);
        if (!ok) falhas += 1;
        else copiadas += 1;
      }
      if (copiadas === 0 && falhas > 0) {
        show("Não foi possível copiar os mínimos.", "danger");
        return;
      }
      if (copiadas === 0 && withoutSaldo > 0) {
        show("Essas filiais ainda não abriram o pedido. Abra o pedido de cada uma e copie de novo.", "warning");
        return;
      }
      if (copiadas === 0) {
        show("Nenhuma outra filial tem os mesmos produtos desta.", "warning");
        return;
      }
      const storeText = copiadas === 1 ? "1 filial" : `${copiadas} filiais`;
      const partes = [`Mínimos copiados para ${storeText}.`];
      if (withoutSaldo > 0) partes.push(`${withoutSaldo} ainda não abriram o pedido.`);
      if (withoutProduct > 0) partes.push(`${withoutProduct} não têm estes produtos.`);
      if (falhas > 0) partes.push(`${falhas} não puderam ser gravadas.`);
      show(partes.join(" "), withoutSaldo > 0 || withoutProduct > 0 || falhas > 0 ? "warning" : "success");
      setCopyOpen(false);
    } finally {
      setCopiando(false);
    }
  };

  const clearSearch = () => {
    setSearch("");
    setFilter("todos");
  };

  const summary = view?.summary ?? { products: 0, items: 0 };

  return (
    <div className="flex flex-col p-4 sm:p-6">
      <SectionHeader
        section="Gestão"
        title="Pedido de compra"
        subtitle="Prepare o pedido de compra de cada filial."
        actions={
          <HeaderFilters>
            <HeaderSearch value={search} onChange={setSearch} placeholder="Buscar por produto ou código…" width={240} />
            <div className="flex gap-1 rounded-[11px] border border-line bg-bg-2 p-1" role="group" aria-label="Vendidos">
              {SOLD_WINDOWS.map((days) => (
                <button
                  key={days}
                  type="button"
                  aria-pressed={po.soldDays === days}
                  onClick={() => po.setSoldDays(days)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition-colors",
                    po.soldDays === days ? "bg-acc text-white" : "text-t1 hover:text-t0",
                  )}
                >
                  {days} dias
                </button>
              ))}
            </div>
            <HeaderFilter label="Status dos produtos" lead="Status" value={filter} onChange={setFilter} options={filterOptions} />
            <span className="inline-flex items-center gap-1.5">
              <HeaderFilter
                label="Multiplicador do pedido"
                lead="Multiplicador"
                value={String(po.factor)}
                onChange={(v) => po.setFactor(Number(v))}
                options={PURCHASE_FACTORS.map((f) => ({ value: String(f), label: `${f}x` }))}
              />
              <TipHelp label="Multiplica o mínimo de cada produto. A quantidade a pedir desconta o total em estoque e arredonda para o múltiplo de compra." />
            </span>
            <ActionsOrder
              withoutStore={store == null && storeRows.length > 1}
              canGenerate={store != null && Boolean(view) && !po.syncing && !copiando}
              canCopy={otherStores.length > 1 || (store != null && otherStores.length > 0)}
              copyLiberado={store != null && Boolean(view) && !po.syncing && !copiando && (po.mins?.size ?? 0) > 0}
              withoutMinimum={store != null && (po.mins?.size ?? 0) === 0}
              onGenerate={openSummary}
              onCopy={openCopy}
            />
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
            {!po.syncError && po.stale && po.staleText && <Alert variant="warning" title={po.staleText} />}
          </>
        }
      />

      <div className="mt-8">
      {showSkeleton ? (
        <StockProductsSkeleton />
      ) : !store ? (
        storeRows.length === 0 ? (
          <Card className="flex flex-col">
            <EmptyBlock icon="🏬" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : (
          <div className="max-w-[720px]">
            <SelectStoreCard />
          </div>
        )
      ) : (
        <Card className="flex flex-col">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <span className="inline-flex items-center gap-1.5">
              <CardTitle>Produtos</CardTitle>
              <TipHelp label="Novo: produto cadastrado no Millennium há menos de 30 dias ou que a filial ainda não vendeu. A segunda regra só é usada quando há histórico suficiente desde a inauguração ou dos últimos 12 meses. Produtos bloqueados para compra não aparecem." />
            </span>
            {view && view.rows.length > 0 && (
              <span className="text-[12.5px] font-semibold text-t1">
                {num(summary.products)} produto{summary.products === 1 ? "" : "s"} · {num(summary.items)} ite{summary.items === 1 ? "m" : "ns"} no pedido
              </span>
            )}
          </div>
          {lines.length === 0 ? (
            <div className="flex flex-1">
              {!view || view.rows.length === 0 ? (
                po.syncing ? (
                  <EmptyBlock icon="📦" title="Buscando saldo" description="Buscando o saldo no Millennium…" />
                ) : (
                  <EmptyBlock icon="📦" title="Nenhum produto disponível para pedido" description="O Millennium não retornou produtos liberados para compra nesta filial." />
                )
              ) : (
                <EmptyBlock
                  icon="🔍"
                  title="Nenhum produto encontrado"
                  description="Tente buscar por outro nome ou código ou altere os filtros."
                  action={
                    <Button variant="outline" size="sm" onClick={clearSearch}>
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
                    <ThSort label="Produto" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} align="left" className="px-1 pb-3" />
                    <ThSort label="Mínimo" active={sortKey === "minimo"} dir={sortDir} onClick={() => toggleSort("minimo")} className="px-1 pb-3" />
                    {NUM_COLS.map((c) => (
                      <ThSort
                        key={c.key}
                        label={c.key === "vendidos30" ? `Vendidos em ${po.soldDays} dias` : c.label}
                        active={sortKey === c.key}
                        dir={sortDir}
                        onClick={() => toggleSort(c.key)}
                        className="px-1 pb-3"
                      />
                    ))}
                    <ThSort label="Novo" active={sortKey === "novo"} dir={sortDir} onClick={() => toggleSort("novo")} align="center" className="px-1 pb-3" />
                    <ThSort label="Bloqueado" active={sortKey === "bloqueado"} dir={sortDir} onClick={() => toggleSort("bloqueado")} align="center" className="px-1 pb-3" />
                    <ThSort label="A pedir" active={sortKey === "aPedir"} dir={sortDir} onClick={() => toggleSort("aPedir")} className="px-1 pb-3" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, i) => {
                    const idx = (pageSafe - 1) * PAGE_SIZE + i;
                    const category = po.catalog?.get(r.code)?.category;
                    return (
                      <tr key={r.code} className={cn("border-b border-line", r.onOrder && "bg-warn-soft")}>
                        <td className={cn("px-1 py-3 text-center text-[13px] font-extrabold text-t2", r.onOrder && "shadow-[inset_3px_0_0_var(--warn)]")}>{idx + 1}</td>
                        <td className="px-1 py-3">
                          <ProductNameCell
                            name={r.name}
                            idx={idx}
                            upper
                            sub={
                              <div className="min-w-0">
                                <p className="truncate text-[11px] uppercase text-t2">{[r.code, category].filter(Boolean).join(" · ")}</p>
                                {r.variasVariantes && !r.blocked && <p className="mt-0.5 text-[11px] font-semibold text-warn">Este produto tem mais de uma cor ou tamanho. Faça o pedido diretamente no Millennium.</p>}
                              </div>
                            }
                          />
                        </td>
                        <td className="px-1 py-2 text-right">
                          {!r.canRequest ? (
                            <span className="inline-block w-20 pr-2 text-right font-mono text-[13px] font-bold text-t2">{r.minimum == null ? "—" : r.minimum}</span>
                          ) : (
                            <MinInput value={r.minimum} idx={i} label={`Mínimo de ${r.name}`} onSave={(raw) => po.saveMin(r.code, raw)} />
                          )}
                        </td>
                        {NUM_COLS.map((c) => (
                          <td key={c.key} className="px-1 py-3 text-right">
                            <Qty v={r[c.key]} />
                          </td>
                        ))}
                        <td className="px-1 py-3 text-center">
                          <YesNo yes={r.isNew} />
                        </td>
                        <td className="px-1 py-3 text-center">
                          <YesNo yes={r.blocked} />
                        </td>
                        <td className="px-1 py-3 text-right">
                          {r.aRequest == null ? <span className="font-mono text-[13px] font-bold text-t2">—</span> : <Qty v={r.aRequest} strong={r.aRequest > 0} />}
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
                      <Qty v={totais.aRequest} total />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {lines.length > 0 && <TableFooter shown={pageRows.length} total={lines.length} page={pageSafe} totalPages={totalPages} onPage={setPage} />}
        </Card>
      )}
      </div>
      <Modal
        open={summaryOrder != null}
        onClose={() => setSummaryOrder(null)}
        title="Resumo do pedido"
        size="lg"
        bodyClassName="flex flex-col overflow-hidden p-0"
        footer={
          <>
            <span className="mr-auto min-w-0 text-[13px] font-extrabold text-t0">
              Total {money(brl(purchaseOrderTotalCents(summaryOrder ?? [])))}
            </span>
            <Button variant="outline" onClick={() => setSummaryOrder(null)}>
              Cancelar
            </Button>
            <Button onClick={generateOrder}>Gerar planilha</Button>
          </>
        }
      >
        {summaryOrder && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 space-y-3 px-5 pt-5">
              <p className="text-[13px] leading-relaxed text-t1">
                {store ? `${store.branchCode} · ${store.tradeName}. ` : ""}
                Multiplicador {po.factor}x.{" "}
                {summaryOrder.length === 1 ? "1 produto" : `${num(summaryOrder.length)} produtos`}
                {" · "}
                {num(summaryOrder.reduce((s, r) => s + (r.aRequest ?? 0), 0))} itens.
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3">
              <ul className="overflow-hidden rounded-[var(--radius-vela-lg)] border border-line">
                {summaryOrder.map((r) => (
                  <li key={r.code} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold text-t0">{r.name}</p>
                      <p className="truncate text-[11px] text-t2">{r.code}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-[13px] font-extrabold tabular-nums text-t0">{money(brl(purchaseLineCents(r)))}</p>
                      <p className="whitespace-nowrap font-mono text-[11px] tabular-nums text-t2">
                        {qty(r.aRequest ?? 0)} × {money(r.costCents == null ? null : r.costCents / 100)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={copyOpen && store != null && (all || destination != null)}
        onClose={() => {
          if (!copiando) setCopyOpen(false);
        }}
        title="Copiar mínimos"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCopyOpen(false)} disabled={copiando}>
              Cancelar
            </Button>
            <Button onClick={() => void copyMinimums()} disabled={copiando || (!all && !destination)}>
              {copiando ? "Copiando…" : "Copiar mínimos"}
            </Button>
          </>
        }
      >
        {store && (all || destination) && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-relaxed text-t1">Copie os mínimos de {store.tradeName} para outra filial ou para todas.</p>
            <FormField label="Copiar para">
              <Select value={all ? "" : (destination?.id ?? "")} onChange={(e) => setDestinationId(e.target.value)} disabled={copiando}>
                {otherStores.length > 1 && <option value="">Todas as outras filiais</option>}
                {otherStores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.branchCode} · {s.tradeName}
                  </option>
                ))}
              </Select>
            </FormField>
            <p className="text-[13px] leading-relaxed text-t2">
              {all
                ? "Os mínimos dos produtos em comum serão atualizados nas outras filiais. Os demais não serão alterados."
                : "Os mínimos dos produtos em comum serão substituídos. Os demais não serão alterados."}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ActionsOrder({
  withoutStore,
  canGenerate,
  canCopy,
  copyLiberado,
  withoutMinimum,
  onGenerate,
  onCopy,
}: {
  withoutStore: boolean;
  canGenerate: boolean;
  canCopy: boolean;
  copyLiberado: boolean;
  withoutMinimum: boolean;
  onGenerate: () => void;
  onCopy: () => void;
}) {
  const items: DropdownItem[] = [
    {
      label: "Gerar pedido",
      description: withoutStore ? "Selecione uma filial no topo para gerar o pedido." : "Abre o resumo e baixa a planilha desta filial.",
      disabled: withoutStore || !canGenerate,
      onClick: onGenerate,
    },
  ];
  if (canCopy) {
    items.push({
      label: "Copiar mínimos para outra filial",
      description: withoutStore
        ? "Selecione uma filial no topo para copiar os mínimos."
        : withoutMinimum
          ? "Cadastre pelo menos um mínimo nesta filial para poder copiar."
          : "Copia os mínimos desta filial. Não copia o arquivo do pedido.",
      disabled: withoutStore || !copyLiberado,
      onClick: onCopy,
    });
  }
  return (
    <Dropdown
      align="right"
      portal
      menuClassName="min-w-[280px]"
      items={items}
      trigger={
        <Button type="button" variant="primary" size="md" iconRight={<ChevronDown />}>
          Ações
        </Button>
      }
    />
  );
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export default PurchaseOrderPage;

const brl = (cents: number | null) => (cents == null ? null : cents / 100);

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

/** Minimo editavel: grava ao sair do campo; Enter desce para o minimo da linha de baixo; Esc desfaz. */
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
