import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui";
import { buildStockProductsView, type StockCatalogItem, type StockInput } from "@/data/wedash/stockProducts";
import { fetchIncomingQty } from "@/data/wedash/purchaseRepo";
import { fetchCostPrices, fetchStockCatalog, fetchStoreStock, syncStockNow } from "@/data/wedash/stockRepo";
import type { Store } from "@/data/wedash/stores";
import { filterCacheGet, filterCacheSet } from "@/lib/filterCache";
import { useFilterSkeleton } from "@/lib/useFilterSkeleton";
import { refreshMomentTitle, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { fetchErpConnection } from "@/pages/dashboard/ErpStatusNotice";
import { useScopedStores } from "@/pages/operation/shared";

const STOCK_MAX_AGE_MS = 30 * 60 * 1000;

type StockLoaded = {
  catalog: Map<string, StockCatalogItem>;
  stock: StockInput["stock"];
  costPrices: Map<number, Map<string, number>>;
  syncedAt: Map<string, string | null>;
  incoming: Map<string, number>;
  incomingSyncedAt: Map<string, string | null>;
};

/** Formato JSON do filterCache (Map nao serializa). */
type StockCache = {
  catalog: Array<[string, StockCatalogItem]>;
  stock: StockInput["stock"];
  costPrices: Array<[number, Array<[string, number]>]>;
  syncedAt: Array<[string, string | null]>;
  incoming: Array<[string, number]>;
  incomingSyncedAt: Array<[string, string | null]>;
};

function toCache(d: StockLoaded): StockCache {
  return {
    catalog: [...d.catalog.entries()],
    stock: d.stock,
    costPrices: [...d.costPrices.entries()].map(([id, prices]) => [id, [...prices.entries()]]),
    syncedAt: [...d.syncedAt.entries()],
    incoming: [...d.incoming.entries()],
    incomingSyncedAt: [...d.incomingSyncedAt.entries()],
  };
}

function fromCache(c: StockCache): StockLoaded {
  return {
    catalog: new Map(c.catalog),
    stock: c.stock,
    costPrices: new Map(c.costPrices.map(([id, prices]) => [id, new Map(prices)])),
    syncedAt: new Map(c.syncedAt),
    incoming: new Map(c.incoming),
    incomingSyncedAt: new Map(c.incomingSyncedAt),
  };
}

function cacheReady(c: StockCache | null): c is StockCache {
  return (
    c != null &&
    Array.isArray(c.catalog) &&
    Array.isArray(c.stock) &&
    Array.isArray(c.costPrices) &&
    Array.isArray(c.syncedAt) &&
    Array.isArray(c.incoming) &&
    Array.isArray(c.incomingSyncedAt)
  );
}

function clockLabel(iso: string): string {
  const d = new Date(iso);
  const h = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (d.toDateString() === new Date().toDateString()) return `às ${h}`;
  return `em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${h}`;
}

async function loadAll(tenantId: string, storeRows: Store[]): Promise<StockLoaded> {
  const tableIds = [...new Set(storeRows.map((s) => s.costTableId).filter((id): id is number => id != null))];
  const storeIds = storeRows.map((s) => s.id);
  const [catalog, stock, costPrices, incoming] = await Promise.all([
    fetchStockCatalog(),
    fetchStoreStock(tenantId, storeIds),
    fetchCostPrices(tableIds),
    fetchIncomingQty(tenantId, storeIds),
  ]);
  return { catalog, stock: stock.rows, costPrices, syncedAt: stock.syncedAt, incoming: incoming.qty, incomingSyncedAt: incoming.syncedAt };
}

/** Estoque das lojas do escopo. Pacote + settle como o Dashboard; busca Millennium se >30 min. */
export function useStockData() {
  const { show } = useToast();
  const { session, storeRows, loading: storesLoading } = useScopedStores();
  const storeKey = storeRows.map((s) => s.id).join(",");
  const filterKey = `stock:${session.tenantId}:${storeKey}`;
  const { showSkeleton, settle } = useFilterSkeleton(filterKey);
  const [data, setData] = useState<StockLoaded | null>(null);
  const [viewStores, setViewStores] = useState<Store[]>(storeRows);
  const [syncing, setSyncing] = useState(false);
  const syncRef = useRef(false);
  const storesRef = useRef(storeRows);
  storesRef.current = storeRows;
  const reloadGen = useRef(0);

  const applyPackage = useCallback((key: string, stores: Store[], loaded: StockLoaded) => {
    filterCacheSet(key, toCache(loaded));
    setData(loaded);
    setViewStores(stores);
    settle(key);
  }, [settle]);

  const reload = useCallback(async () => {
    const gen = ++reloadGen.current;
    const key = filterKey;
    const storesAtLoad = storesRef.current;
    const cached = filterCacheGet<StockCache>(key);
    if (cacheReady(cached)) {
      applyPackage(key, storesAtLoad, fromCache(cached));
    }
    try {
      const loaded = await loadAll(session.tenantId, storesAtLoad);
      if (gen !== reloadGen.current) return null;
      applyPackage(key, storesAtLoad, loaded);
      return loaded;
    } catch (e) {
      if (gen !== reloadGen.current) return null;
      console.warn("useStockData:", e);
      // Sem pacote: libera o skeleton para nao ficar eterno (igual falha de rede no Dashboard).
      if (!cacheReady(cached)) {
        setData(null);
        setViewStores(storesAtLoad);
        settle(key);
      }
      return null;
    }
  }, [session.tenantId, filterKey, applyPackage, settle]);

  const syncIfStale = useCallback(
    async (d: StockLoaded, opts: { force?: boolean } = {}) => {
      if (syncRef.current) return;
      const now = Date.now();
      const stale = (at: string | null | undefined) => opts.force || !at || now - Date.parse(at) > STOCK_MAX_AGE_MS;
      const stockIds = storesRef.current.map((s) => s.id).filter((id) => stale(d.syncedAt.get(id)));
      const purchaseIds = storesRef.current.map((s) => s.id).filter((id) => stale(d.incomingSyncedAt.get(id)));
      if (stockIds.length === 0 && purchaseIds.length === 0) return;

      syncRef.current = true;
      try {
        // Integracao desligada / senha invalida: o aviso fixo da tela ja explica  -  sem busca e sem toast.
        const conexao = await fetchErpConnection(session.tenantId);
        if (conexao === "disconnected" || conexao === "password") return;
        setSyncing(true);
        const r = await syncStockNow({ stockStoreIds: stockIds, purchaseStoreIds: purchaseIds });
        if (!r.ok) {
          show(r.message, "danger");
          return;
        }
        if (r.failed.length > 0) show("Não foi possível buscar todo o estoque. Alguns valores podem estar desatualizados.", "warning");
        if (r.purchaseFailedStores.length > 0) show("Não foi possível buscar o que está a receber. Essa coluna pode estar desatualizada.", "warning");
        await reload();
      } finally {
        syncRef.current = false;
        setSyncing(false);
      }
    },
    [reload, show, session.tenantId],
  );

  useEffect(() => {
    if (storesLoading) return;
    let cancelled = false;
    (async () => {
      const d = await reload();
      if (cancelled || !d) return;
      void syncIfStale(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [storeKey, storesLoading, reload, syncIfStale]);

  const dataRef = useRef(data);
  dataRef.current = data;
  const syncedTimes = viewStores.map((s) => data?.syncedAt.get(s.id) ?? null);
  const oldestSync = syncedTimes.every((t) => t != null)
    ? syncedTimes.reduce<string | null>((m, t) => (m == null || Date.parse(t!) < Date.parse(m) ? t : m), null)
    : null;
  useScreenRefresh({
    label: "Atualizar o estoque",
    tip: "Busca no Millennium o estoque e as quantidades a receber das filiais desta tela.",
    status: refreshMomentTitle(data ? oldestSync : undefined),
    busyLabel: "Buscando estoque…",
    run: async () => {
      const current = dataRef.current;
      if (current) await syncIfStale(current, { force: true });
    },
  });

  const view = useMemo(
    () =>
      data
        ? buildStockProductsView({
            stores: viewStores,
            catalog: data.catalog,
            stock: data.stock,
            costPrices: data.costPrices,
            incoming: data.incoming,
            incomingKnown: new Set([...data.incomingSyncedAt].filter(([, at]) => at != null).map(([id]) => id)),
            salePrices: new Map(),
            saleTableId: null,
            charged: [],
          })
        : null,
    [data, viewStores],
  );

  const atualizadoText = syncing
    ? "Buscando estoque…"
    : oldestSync
      ? `Estoque atualizado ${clockLabel(oldestSync)}`
      : "Estoque ainda não atualizado";

  return {
    storeRows,
    storeKey,
    view,
    /** Cabeçalho na hora; tabela em skeleton ate o pacote do filtro (1ª carga e troca de filial). */
    showSkeleton: storesLoading || showSkeleton,
    syncing,
    atualizadoText,
  };
}
