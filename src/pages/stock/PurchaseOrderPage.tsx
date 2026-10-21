import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Alert, Badge, Button, Card, CardTitle, Checkbox, Dropdown, FormField, Modal, Select, ThSort, useToast, type DropdownItem, type SortDir } from "@/components/ui";
import { StockProductsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { ProductNameCell } from "@/components/wedash/ProductNameCell";
import { StoreDivisionTitle } from "@/components/wedash/StoreDivisionTitle";
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
import { SectionHeader, useScopedStores } from "@/pages/operation/shared";
import { HeaderFilters, TableFooter, TipHelp, money, qty } from "./shared";
import { SOLD_WINDOWS, usePurchaseOrder } from "./usePurchaseOrder";

const PAGE_SIZE = 50;

type SortKey = "store" | "name" | "minimo" | "saldo" | "pedidosAbertos" | "total" | "vendidos30" | "multipla" | "novo" | "bloqueado" | "aPedir";

type OrderLine = PurchaseOrderRow & { storeId: string; storeName: string };

type ProductGroup = {
  code: string;
  name: string;
  multipla: number;
  blocked: boolean;
  variasVariantes: boolean;
  branches: OrderLine[];
};

type OrderGroup = {
  storeId: string;
  branchCode: string;
  storeName: string;
  rows: PurchaseOrderRow[];
};

const NUM_COLS: Array<{ key: "saldo" | "pedidosAbertos" | "total" | "vendidos30" | "multipla"; label: string }> = [
  { key: "saldo", label: "Saldo" },
  { key: "pedidosAbertos", label: "Pedidos em aberto" },
  { key: "total", label: "Total em estoque" },
  { key: "vendidos30", label: "Vendidos em 30 dias" },
  { key: "multipla", label: "Múltiplo de compra" },
];

function sortValue(r: PurchaseOrderRow, k: Exclude<SortKey, "name" | "store">): number {
  if (k === "minimo") return r.minimum ?? -1;
  if (k === "aPedir") return r.aRequest ?? -1;
  if (k === "novo") return r.isNew ? 1 : 0;
  if (k === "bloqueado") return r.blocked ? 1 : 0;
  return r[k];
}

function groupSortValue(group: ProductGroup, key: Exclude<SortKey, "name" | "store">): number {
  if (key === "multipla") return group.multipla;
  if (key === "bloqueado") return group.blocked ? 1 : 0;
  if (key === "novo") return group.branches.some((branch) => branch.isNew) ? 1 : 0;
  return Math.max(...group.branches.map((branch) => sortValue(branch, key)));
}

function groupProducts(lines: OrderLine[], sortKey: SortKey, sortDir: SortDir): ProductGroup[] {
  const byCode = new Map<string, ProductGroup>();
  for (const line of lines) {
    const current = byCode.get(line.code);
    if (current) {
      current.branches.push(line);
      continue;
    }
    byCode.set(line.code, {
      code: line.code,
      name: line.name,
      multipla: line.multipla,
      blocked: line.blocked,
      variasVariantes: line.variasVariantes,
      branches: [line],
    });
  }
  const groups = [...byCode.values()];
  for (const group of groups) group.branches.sort((a, b) => a.storeName.localeCompare(b.storeName, "pt-BR"));
  const dir = sortDir === "asc" ? 1 : -1;
  groups.sort((a, b) => {
    const byName = a.name.localeCompare(b.name, "pt-BR");
    if (sortKey === "name" || sortKey === "store") return byName * dir;
    return (groupSortValue(a, sortKey) - groupSortValue(b, sortKey)) * dir || byName;
  });
  return groups;
}

function productLine(branches: OrderLine[]) {
  const minimums = branches.map((branch) => branch.minimum);
  const requests = branches.map((branch) => branch.aRequest);
  return {
    minimum: minimums.every((value) => value === minimums[0]) ? minimums[0] : null,
    saldo: branches.reduce((sum, branch) => sum + branch.saldo, 0),
    pedidosAbertos: branches.reduce((sum, branch) => sum + branch.pedidosAbertos, 0),
    total: branches.reduce((sum, branch) => sum + branch.total, 0),
    vendidos30: branches.reduce((sum, branch) => sum + branch.vendidos30, 0),
    isNew: branches.some((branch) => branch.isNew),
    aRequest: requests.some((value) => value != null) ? requests.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null,
  };
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
      <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
  const manyStores = storeRows.length > 1;
  const store = storeRows.length === 1 ? storeRows[0] : null;
  const po = usePurchaseOrder(
    session.tenantId,
    storeRows.map((s) => ({ id: s.id, costTableId: s.costTableId ?? null })),
  );
  const [search, setSearch] = useState("");
  const [filterPicked, setFilter] = useState<PurchaseFilter>("todos");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [summaryGroups, setSummaryGroups] = useState<OrderGroup[] | null>(null);
  const [summarySkipped, setSummarySkipped] = useState(0);
  const [exportPick, setExportPick] = useState<string[] | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [destinationId, setDestinationId] = useState("");
  const [copyOriginId, setCopyOriginId] = useState("");
  const [copyDestIds, setCopyDestIds] = useState<string[]>([]);
  const [copiando, setCopiando] = useState(false);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const showSkeleton = useMinSkeleton(storesLoading || (storeRows.length > 0 && po.loading));

  const counts = po.parts.reduce(
    (acc, part) => ({
      onOrder: acc.onOrder + part.view.counts.onOrder,
      withoutMinimum: acc.withoutMinimum + part.view.counts.withoutMinimum,
      novos: acc.novos + part.view.counts.novos,
    }),
    { onOrder: 0, withoutMinimum: 0, novos: 0 },
  );
  const filterOptions: Array<{ value: PurchaseFilter; label: string }> = [
    { value: "todos", label: "Todos os produtos" },
    { value: "pedido", label: `Vai para o pedido (${counts.onOrder})` },
    { value: "semMinimo", label: `Sem mínimo (${counts.withoutMinimum})` },
    { value: "novos", label: `Novos (${counts.novos})` },
  ];
  const filter = filterPicked;

  const scopeKey = storeRows.map((s) => s.id).join("|");
  const lines = useMemo(() => {
    const tagged: OrderLine[] = [];
    for (const rowStore of storeRows) {
      const part = po.parts.find((p) => p.storeId === rowStore.id);
      if (!part) continue;
      for (const row of part.view.rows) tagged.push({ ...row, storeId: rowStore.id, storeName: rowStore.tradeName || rowStore.name });
    }
    const out = filterPurchaseRows(tagged, { search, filter }) as OrderLine[];
    const dir = sortDir === "asc" ? 1 : -1;
    const byName = (a: OrderLine, b: OrderLine) => a.name.localeCompare(b.name, "pt-BR");
    const byStore = (a: OrderLine, b: OrderLine) => a.storeName.localeCompare(b.storeName, "pt-BR") || byName(a, b);
    return out.sort((a, b) => {
      if (sortKey === "store") return byStore(a, b) * dir;
      if (sortKey === "name") return byName(a, b) * dir || a.storeName.localeCompare(b.storeName, "pt-BR");
      return (sortValue(a, sortKey) - sortValue(b, sortKey)) * dir || byStore(a, b);
    });
  }, [po.parts, storeRows, search, filter, sortKey, sortDir]);

  useEffect(() => setPage(1), [search, filter, sortKey, sortDir, scopeKey]);
  useEffect(() => setOpened({}), [search, filter, scopeKey]);
  const groups = useMemo(() => groupProducts(lines, sortKey, sortDir), [lines, sortKey, sortDir]);

  useEffect(() => {
    setSortKey("name");
    setSortDir("asc");
    setOpened({});
    setSummaryGroups(null);
    setSummarySkipped(0);
    setExportPick(null);
  }, [scopeKey]);

  const listCount = groups.length;
  const totalPages = Math.max(1, Math.ceil(listCount / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageGroups = groups.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const isOpen = (group: ProductGroup) => manyStores && Boolean(opened[group.code]);
  const toggleGroup = (code: string, open: boolean) => setOpened((current) => ({ ...current, [code]: !open }));
  const minIndex = new Map<string, number>();
  {
    let next = 0;
    for (const group of pageGroups) {
      const editable = manyStores ? (isOpen(group) ? group.branches : []) : group.branches.slice(0, 1);
      for (const branch of editable) minIndex.set(`${branch.storeId}:${branch.code}`, next++);
    }
  }

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
      setSortDir(k === "name" || k === "store" ? "asc" : "desc");
    }
  };

  const groupsFor = (ids: string[]): { ready: OrderGroup[]; skipped: number } => {
    const ready: OrderGroup[] = [];
    let skipped = 0;
    for (const rowStore of storeRows) {
      if (!ids.includes(rowStore.id)) continue;
      const part = po.parts.find((p) => p.storeId === rowStore.id);
      const rows = (part?.view.rows ?? []).filter((r) => r.onOrder).sort((a, b) => a.position - b.position);
      if (rows.length === 0) {
        skipped += 1;
        continue;
      }
      ready.push({ storeId: rowStore.id, branchCode: rowStore.branchCode, storeName: rowStore.tradeName || rowStore.name, rows });
    }
    return { ready, skipped };
  };

  const openSummary = (ids: string[]) => {
    const { ready, skipped } = groupsFor(ids);
    if (ready.length === 0) {
      show("Nenhum produto precisa ser incluído no pedido.", "warning");
      return;
    }
    setSummarySkipped(skipped);
    setSummaryGroups(ready);
    setExportPick(null);
  };

  const openGenerate = () => {
    if (po.parts.length === 0) return;
    if (manyStores) {
      setExportPick(storeRows.map((s) => s.id));
      return;
    }
    openSummary(storeRows.map((s) => s.id));
  };

  const generateOrder = () => {
    if (!summaryGroups || summaryGroups.length === 0) return;
    const now = new Date();
    const files = summaryGroups.flatMap((group) => {
      const part = po.parts.find((p) => p.storeId === group.storeId);
      if (!part) return [];
      const rows = purchaseOrderFileRows({ ...part.view, rows: group.rows });
      if (rows.length === 0) return [];
      const bytes = buildXlsx([[...PURCHASE_FILE_HEADER], ...rows], { textColumns: PURCHASE_FILE_TEXT_COLUMNS });
      return [{ bytes, name: purchaseOrderFileName(now, manyStores ? group.branchCode : undefined) }];
    });
    if (files.length === 0) {
      show("Nenhum produto precisa ser incluído no pedido.", "warning");
      setSummaryGroups(null);
      return;
    }
    files.forEach((file, i) => window.setTimeout(() => downloadFile(file.bytes, file.name), i * 400));
    const products = files.length === 1 ? summaryGroups[0].rows.length : summaryGroups.reduce((n, group) => n + group.rows.length, 0);
    const partes = [files.length === 1 ? `Pedido gerado com ${products} produto${products === 1 ? "" : "s"}.` : `Pedido gerado com ${files.length} planilhas.`];
    if (summarySkipped === 1) partes.push("1 filial não tinha produtos para incluir.");
    else if (summarySkipped > 1) partes.push(`${summarySkipped} filiais não tinham produtos para incluir.`);
    show(partes.join(" "), summarySkipped > 0 ? "warning" : "success");
    setSummaryGroups(null);
    setSummarySkipped(0);
  };

  const network = storesForSession(session.stores);
  const otherStores = store ? network.filter((s) => s.id !== store.id) : network;
  const all = destinationId === "" && otherStores.length > 1;
  const destination = otherStores.find((s) => s.id === destinationId) ?? null;

  const openCopy = () => {
    if (manyStores) {
      const withMins = storeRows.find((s) => (po.parts.find((p) => p.storeId === s.id)?.mins.size ?? 0) > 0);
      const originId = withMins?.id ?? storeRows[0]?.id ?? "";
      setCopyOriginId(originId);
      setCopyDestIds(storeRows.filter((s) => s.id !== originId).map((s) => s.id));
    } else {
      setDestinationId(otherStores.length > 1 ? "" : (otherStores[0]?.id ?? ""));
    }
    setCopyOpen(true);
  };

  const copyMinimums = async () => {
    const originId = manyStores ? copyOriginId : store?.id;
    const origin = po.parts.find((p) => p.storeId === originId);
    if (!originId || !origin || origin.mins.size === 0) return;
    const targets = manyStores
      ? storeRows.filter((s) => s.id !== originId && copyDestIds.includes(s.id))
      : all
        ? otherStores
        : destination
          ? [destination]
          : [];
    if (targets.length === 0) return;
    setCopiando(true);
    try {
      let copiadas = 0;
      let withoutSaldo = 0;
      let withoutProduct = 0;
      let falhas = 0;
      for (const target of targets) {
        const loaded = po.parts.find((p) => p.storeId === target.id);
        const codes = loaded ? loaded.stockCodes : new Set((await fetchPurchaseStock(session.tenantId, target.id)).rows.map((row) => row.code));
        if (codes.size === 0) {
          withoutSaldo += 1;
          continue;
        }
        const { updates } = purchaseMinsToCopy(origin.mins, codes);
        if (updates.length === 0) {
          withoutProduct += 1;
          continue;
        }
        const ok = await savePurchaseMins(session.tenantId, target.id, updates);
        if (!ok) falhas += 1;
        else {
          copiadas += 1;
          po.applyMins(target.id, updates);
        }
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

  const summary = po.parts.reduce(
    (acc, part) => ({ products: acc.products + part.view.summary.products, items: acc.items + part.view.summary.items }),
    { products: 0, items: 0 },
  );
  const anyRows = po.parts.some((part) => part.view.rows.length > 0);
  const anyMins = po.parts.some((part) => part.mins.size > 0);
  const copyTargets = manyStores ? storeRows.filter((s) => s.id !== copyOriginId && copyDestIds.includes(s.id)) : [];
  const originPart = po.parts.find((p) => p.storeId === (manyStores ? copyOriginId : store?.id));

  return (
    <div className="flex flex-col p-4 sm:p-6">
      <SectionHeader
        section="Pedido de compra"
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
            <HeaderFilter label="Status dos produtos" value={filter} onChange={setFilter} options={filterOptions} />
            <span className="inline-flex items-center gap-1.5">
              <HeaderFilter
                label="Multiplicador do pedido"
                value={String(po.factor)}
                onChange={(v) => po.setFactor(Number(v))}
                options={PURCHASE_FACTORS.map((f) => ({ value: String(f), label: `${f}x` }))}
              />
              <TipHelp label="Multiplica o mínimo de cada produto. A quantidade a pedir desconta o total em estoque e arredonda para o múltiplo de compra." />
            </span>
            <ActionsOrder
              manyStores={manyStores}
              canGenerate={po.parts.length > 0 && !po.syncing && !copiando}
              canCopy={manyStores || otherStores.length > 0}
              copyLiberado={po.parts.length > 0 && !po.syncing && !copiando && anyMins}
              withoutMinimum={po.parts.length > 0 && !anyMins}
              onGenerate={openGenerate}
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
      ) : storeRows.length === 0 ? (
        <Card className="flex flex-col">
          <EmptyBlock icon="🏬" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
        </Card>
      ) : (
        <Card className="flex min-w-0 flex-col overflow-hidden">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <span className="inline-flex items-center gap-1.5">
              <CardTitle>Produtos</CardTitle>
              <TipHelp label="Novo: produto cadastrado no Millennium há menos de 30 dias ou que a filial ainda não vendeu. A segunda regra só é usada quando há histórico suficiente desde a inauguração ou dos últimos 12 meses. Produtos bloqueados para compra não aparecem." />
            </span>
            {anyRows && (
              <span className="text-[12.5px] font-semibold text-t1">
                {num(summary.products)} produto{summary.products === 1 ? "" : "s"} · {num(summary.items)} ite{summary.items === 1 ? "m" : "ns"} no pedido
              </span>
            )}
          </div>
          {lines.length === 0 ? (
            <div className="flex flex-1">
              {!anyRows ? (
                po.syncing ? (
                  <EmptyBlock icon="📦" title="Buscando saldo" description="Buscando o saldo no Millennium…" />
                ) : (
                  <EmptyBlock
                    icon="📦"
                    title="Nenhum produto disponível para pedido"
                    description={manyStores ? "O Millennium não retornou produtos liberados para compra nas filiais selecionadas." : "O Millennium não retornou produtos liberados para compra nesta filial."}
                  />
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
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[1340px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wide text-t2">
                    <th className="px-1 pb-3 text-left font-bold">#</th>
                    <ThSort label="Produto" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} align="left" className="px-1 pb-3" />
                    <ThSort label="Mínimo" active={sortKey === "minimo"} dir={sortDir} onClick={() => toggleSort("minimo")} className="px-1 pb-3" />
                    {NUM_COLS.filter((c) => c.key !== "multipla").map((c) => (
                      <ThSort
                        key={c.key}
                        label={c.key === "vendidos30" ? `Vendidos em ${po.soldDays} dias` : c.label}
                        active={sortKey === c.key}
                        dir={sortDir}
                        onClick={() => toggleSort(c.key)}
                        className="px-1 pb-3"
                      />
                    ))}
                    <ThSort label="Múltiplo" active={sortKey === "multipla"} dir={sortDir} onClick={() => toggleSort("multipla")} className="px-1 pb-3" />
                    <ThSort label="Bloqueado" active={sortKey === "bloqueado"} dir={sortDir} onClick={() => toggleSort("bloqueado")} align="center" className="px-1 pb-3" />
                    <ThSort label="Novo" active={sortKey === "novo"} dir={sortDir} onClick={() => toggleSort("novo")} align="center" className="px-1 pb-3" />
                    <ThSort label="A pedir" active={sortKey === "aPedir"} dir={sortDir} onClick={() => toggleSort("aPedir")} className="px-1 pb-3" />
                  </tr>
                </thead>
                <tbody>
                  {pageGroups.map((group, i) => {
                        const open = isOpen(group);
                        const idx = (pageSafe - 1) * PAGE_SIZE + i;
                        const line = productLine(group.branches);
                        const category = po.parts.find((p) => p.storeId === group.branches[0]?.storeId)?.catalog.get(group.code)?.category;
                        const alone = !manyStores ? group.branches[0] : null;
                        const productSub = [group.code, category].filter(Boolean).join(" · ");
                        const short = group.branches.some((branch) => branch.onOrder);
                        return (
                          <Fragment key={group.code}>
                            <tr
                              className={cn("border-b border-line", manyStores && "cursor-pointer", short && "bg-warn-soft")}
                              onClick={manyStores ? () => toggleGroup(group.code, open) : undefined}
                            >
                              <td className={cn("px-1 py-3 text-center text-[13px] font-extrabold text-t2", short && "shadow-[inset_3px_0_0_var(--warn)]")}>{idx + 1}</td>
                              <td className="px-1 py-3">
                                <div className={cn("flex min-w-0 items-center", manyStores && "gap-2")}>
                                  {manyStores && (
                                    <button
                                      type="button"
                                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-t2 outline-none hover:bg-bg-inset focus-visible:ring-2 focus-visible:ring-acc"
                                      aria-expanded={open}
                                      aria-label={open ? `Fechar filiais de ${group.name}` : `Abrir filiais de ${group.name}`}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        toggleGroup(group.code, open);
                                      }}
                                    >
                                      <Chevron open={open} />
                                    </button>
                                  )}
                                  <ProductNameCell
                                    name={group.name}
                                    idx={idx}
                                    upper
                                    sub={
                                      group.variasVariantes && !group.blocked ? (
                                        <div className="min-w-0">
                                          <p className="truncate text-[11px] uppercase text-t2">{productSub}</p>
                                          <p className="mt-0.5 text-[11px] font-semibold text-warn">Este produto tem mais de uma cor ou tamanho. Faça o pedido diretamente no Millennium.</p>
                                        </div>
                                      ) : (
                                        productSub
                                      )
                                    }
                                  />
                                </div>
                              </td>
                              <td className="px-1 py-3 text-right">
                                {alone ? (
                                  <BranchMinimum branch={alone} idx={minIndex.get(`${alone.storeId}:${alone.code}`) ?? 0} onSave={(raw) => po.saveMin(alone.storeId, alone.code, raw)} />
                                ) : (
                                  <span className="inline-block w-20 pr-2 text-right font-mono text-[13px] font-bold text-t2">{line.minimum == null ? "—" : line.minimum}</span>
                                )}
                              </td>
                              {(["saldo", "pedidosAbertos", "total", "vendidos30"] as const).map((key) => (
                                <td key={key} className="px-1 py-3 text-right">
                                  <Qty v={line[key]} />
                                </td>
                              ))}
                              <td className="px-1 py-3 text-right">
                                <span className="font-mono text-[13px] font-bold text-t0">{group.multipla}</span>
                              </td>
                              <td className="px-1 py-3 text-center">
                                <YesNo yes={group.blocked} />
                              </td>
                              <td className="px-1 py-3 text-center">
                                <YesNo yes={line.isNew} />
                              </td>
                              <td className="px-1 py-3 text-right">
                                {line.aRequest == null ? <span className="font-mono text-[13px] font-bold text-t2">—</span> : <Qty v={line.aRequest} strong={line.aRequest > 0} />}
                              </td>
                            </tr>
                            {open &&
                              group.branches.map((branch) => (
                                <tr
                                  key={`${branch.storeId}:${branch.code}`}
                                  className={cn("group border-b border-line transition-colors", branch.onOrder ? "bg-warn-soft" : "bg-bg-inset hover:bg-acc-soft")}
                                >
                                  <td />
                                  <td className={cn("border-l-2 px-1 py-2.5 pl-16 transition-colors", branch.onOrder ? "border-l-warn" : "border-l-line-2 group-hover:border-l-acc")}>
                                    <p className="break-words text-[12.5px] font-semibold leading-5 text-t1">{branch.storeName}</p>
                                  </td>
                                  <td className="px-1 py-2 text-right">
                                    <BranchMinimum
                                      branch={branch}
                                      idx={minIndex.get(`${branch.storeId}:${branch.code}`) ?? 0}
                                      onSave={(raw) => po.saveMin(branch.storeId, branch.code, raw)}
                                    />
                                  </td>
                                  {NUM_COLS.filter((c) => c.key !== "multipla").map((c) => (
                                    <td key={c.key} className="px-1 py-2.5 text-right">
                                      <Qty v={branch[c.key]} />
                                    </td>
                                  ))}
                                  <td className="px-1 py-2.5 text-right">
                                    <span className="font-mono text-[13px] font-bold text-t0">{branch.multipla}</span>
                                  </td>
                                  <td className="px-1 py-2.5 text-center">
                                    <YesNo yes={branch.blocked} />
                                  </td>
                                  <td className="px-1 py-2.5 text-center">
                                    <YesNo yes={branch.isNew} />
                                  </td>
                                  <td className="px-1 py-2.5 text-right">
                                    {branch.aRequest == null ? <span className="font-mono text-[13px] font-bold text-t2">—</span> : <Qty v={branch.aRequest} strong={branch.aRequest > 0} />}
                                  </td>
                                </tr>
                              ))}
                          </Fragment>
                        );
                      })}
                  <tr className="bg-bg-inset">
                    <td />
                    <td className="px-1 py-3 text-[13px] font-extrabold text-t0">
                      Total do filtro
                      <span className="mt-0.5 block text-[11px] font-semibold text-t2">
                        {num(listCount)} produto{listCount === 1 ? "" : "s"}
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
          {lines.length > 0 && <TableFooter shown={pageGroups.length} total={listCount} page={pageSafe} totalPages={totalPages} onPage={setPage} />}
        </Card>
      )}
      </div>
      <Modal
        open={exportPick != null}
        onClose={() => setExportPick(null)}
        title="Filiais do pedido"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setExportPick(null)}>
              Cancelar
            </Button>
            <Button onClick={() => exportPick && openSummary(exportPick)} disabled={!exportPick || exportPick.length === 0}>
              Continuar
            </Button>
          </>
        }
      >
        {exportPick && (
          <div className="flex flex-col gap-3">
            <p className="text-[13.5px] leading-relaxed text-t1">Cada filial marcada gera uma planilha. O arquivo não junta quantidades de filiais diferentes.</p>
            <Checkbox
              label="Todas as filiais"
              checked={exportPick.length === storeRows.length}
              onChange={() => setExportPick(exportPick.length === storeRows.length ? [] : storeRows.map((s) => s.id))}
            />
            <div className="flex flex-col gap-2">
              {storeRows.map((s) => (
                <Checkbox
                  key={s.id}
                  label={`${s.branchCode} · ${s.tradeName}`}
                  checked={exportPick.includes(s.id)}
                  onChange={() => setExportPick(exportPick.includes(s.id) ? exportPick.filter((id) => id !== s.id) : [...exportPick, s.id])}
                />
              ))}
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={summaryGroups != null}
        onClose={() => setSummaryGroups(null)}
        title="Resumo do pedido"
        size="lg"
        bodyClassName="flex flex-col overflow-hidden p-0"
        footer={
          <>
            <span className="mr-auto min-w-0 text-[13px] font-extrabold text-t0">Total {money(brl(summaryTotalCents(summaryGroups ?? [])))}</span>
            <Button variant="outline" onClick={() => setSummaryGroups(null)}>
              Cancelar
            </Button>
            <Button onClick={generateOrder}>{(summaryGroups?.length ?? 0) > 1 ? "Gerar planilhas" : "Gerar planilha"}</Button>
          </>
        }
      >
        {summaryGroups && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 space-y-3 px-5 pt-5">
              <p className="text-[13.5px] leading-relaxed text-t1">
                {summaryGroups.length === 1 ? `${summaryGroups[0].branchCode} · ${summaryGroups[0].storeName}. ` : `${summaryGroups.length} planilhas. `}
                Multiplicador {po.factor}x. {summaryProductLabel(summaryGroups)}
              </p>
              {summarySkipped > 0 && (
                <p className="text-[13px] leading-relaxed text-t2">
                  {summarySkipped === 1 ? "1 filial marcada não tinha produtos para incluir." : `${summarySkipped} filiais marcadas não tinham produtos para incluir.`}
                </p>
              )}
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-3">
              {summaryGroups.map((group) => (
                <div key={group.storeId}>
                  {summaryGroups.length > 1 && <StoreDivisionTitle className="mb-2">{group.branchCode} · {group.storeName}</StoreDivisionTitle>}
                  <ul className="overflow-hidden rounded-[var(--radius-vela-lg)] border border-line">
                    {group.rows.map((r) => (
                      <li key={`${group.storeId}:${r.code}`} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
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
              ))}
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={copyOpen && (manyStores ? storeRows.length > 1 : store != null && (all || destination != null))}
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
            <Button onClick={() => void copyMinimums()} disabled={copiando || (manyStores ? copyTargets.length === 0 || (originPart?.mins.size ?? 0) === 0 : !all && !destination)}>
              {copiando ? "Copiando…" : "Copiar mínimos"}
            </Button>
          </>
        }
      >
        {manyStores ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13.5px] leading-relaxed text-t1">Escolha a filial de origem e as filiais que recebem os mínimos dela.</p>
            <FormField label="Copiar de">
              <Select
                value={copyOriginId}
                disabled={copiando}
                onChange={(e) => {
                  const next = e.target.value;
                  setCopyOriginId(next);
                  setCopyDestIds((ids) => ids.filter((id) => id !== next));
                }}
              >
                {storeRows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.branchCode} · {s.tradeName}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-bold text-t1">Copiar para</span>
              {storeRows
                .filter((s) => s.id !== copyOriginId)
                .map((s) => (
                  <Checkbox
                    key={s.id}
                    label={`${s.branchCode} · ${s.tradeName}`}
                    disabled={copiando}
                    checked={copyDestIds.includes(s.id)}
                    onChange={() => setCopyDestIds(copyDestIds.includes(s.id) ? copyDestIds.filter((id) => id !== s.id) : [...copyDestIds, s.id])}
                  />
                ))}
            </div>
            <p className="text-[13px] leading-relaxed text-t2">
              {(originPart?.mins.size ?? 0) === 0
                ? "Cadastre pelo menos um mínimo na filial de origem para poder copiar."
                : "Os mínimos dos produtos em comum serão substituídos. Os demais não serão alterados."}
            </p>
          </div>
        ) : (
          store &&
          (all || destination) && (
            <div className="flex flex-col gap-3">
              <p className="text-[13.5px] leading-relaxed text-t1">Copie os mínimos de {store.tradeName} para outra filial ou para todas.</p>
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
          )
        )}
      </Modal>
    </div>
  );
}

function summaryTotalCents(groups: OrderGroup[]): number | null {
  let total = 0;
  let any = false;
  for (const group of groups) {
    const cents = purchaseOrderTotalCents(group.rows);
    if (cents == null) continue;
    any = true;
    total += cents;
  }
  return any ? total : null;
}

function summaryProductLabel(groups: OrderGroup[]): string {
  const products = groups.reduce((n, group) => n + group.rows.length, 0);
  const items = groups.reduce((n, group) => n + group.rows.reduce((s, row) => s + (row.aRequest ?? 0), 0), 0);
  return `${products === 1 ? "1 produto" : `${num(products)} produtos`} · ${num(items)} ite${items === 1 ? "m" : "ns"}.`;
}

function ActionsOrder({
  manyStores,
  canGenerate,
  canCopy,
  copyLiberado,
  withoutMinimum,
  onGenerate,
  onCopy,
}: {
  manyStores: boolean;
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
      description: manyStores ? "Escolhe as filiais e baixa uma planilha para cada uma." : "Abre o resumo e baixa a planilha desta filial.",
      disabled: !canGenerate,
      onClick: onGenerate,
    },
  ];
  if (canCopy) {
    items.push({
      label: manyStores ? "Copiar mínimos" : "Copiar mínimos para outra filial",
      description: withoutMinimum
        ? manyStores
          ? "Cadastre pelo menos um mínimo para poder copiar."
          : "Cadastre pelo menos um mínimo nesta filial para poder copiar."
        : manyStores
          ? "Escolhe a filial de origem e as filiais que recebem os mínimos."
          : "Copia os mínimos desta filial. Não copia o arquivo do pedido.",
      disabled: !copyLiberado,
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

function BranchMinimum({ branch, idx, onSave }: { branch: OrderLine; idx: number; onSave: (raw: string) => Promise<boolean> }) {
  if (!branch.canRequest) {
    return <span className="inline-block w-20 pr-2 text-right font-mono text-[13px] font-bold text-t2">{branch.minimum == null ? "—" : branch.minimum}</span>;
  }
  return <MinInput value={branch.minimum} idx={idx} label={`Mínimo de ${branch.name} em ${branch.storeName}`} onSave={onSave} />;
}

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
