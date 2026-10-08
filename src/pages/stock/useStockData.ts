import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui";
import { buildStockProductsView, type StockCatalogItem, type StockInput } from "@/data/wedash/stockProducts";
import { fetchCostPrices, fetchStockCatalog, fetchStoreStock, syncStockNow } from "@/data/wedash/stockRepo";
import type { Store } from "@/data/wedash/stores";
import { FORCE_REFRESH_CLICK_EVENT } from "@/pages/dashboard/useForceRefresh";
import { fetchErpConnection } from "@/pages/dashboard/ErpStatusNotice";
import { useScopedStores } from "@/pages/operation/shared";

const STOCK_MAX_AGE_MS = 30 * 60 * 1000;

type StockLoaded = {
  catalog: Map<string, StockCatalogItem>;
  stock: StockInput["stock"];
  costPrices: StockInput["costPrices"];
  syncedAt: Map<string, string | null>;
};

function hora(iso: string): string {
  const d = new Date(iso);
  const h = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (d.toDateString() === new Date().toDateString()) return `às ${h}`;
  return `em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${h}`;
}

async function loadAll(tenantId: string, lojas: Store[]): Promise<StockLoaded> {
  const tableIds = [...new Set(lojas.map((s) => s.costTableId).filter((id): id is number => id != null))];
  const [catalog, stock, costPrices] = await Promise.all([
    fetchStockCatalog(),
    fetchStoreStock(
      tenantId,
      lojas.map((s) => s.id),
    ),
    fetchCostPrices(tableIds),
  ]);
  return { catalog, stock: stock.rows, costPrices, syncedAt: stock.syncedAt };
}

/** Estoque das lojas do escopo. Ao abrir, busca no Millennium o estoque com mais de 30 min. */
export function useStockData() {
  const { show } = useToast();
  const { session, lojas, loading: lojasLoading } = useScopedStores();
  const storeKey = lojas.map((s) => s.id).join(",");
  const [data, setData] = useState<StockLoaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const syncRef = useRef(false);
  const lojasRef = useRef(lojas);
  lojasRef.current = lojas;

  const reload = useCallback(async () => {
    const d = await loadAll(session.tenantId, lojasRef.current);
    setData(d);
    return d;
  }, [session.tenantId]);

  const syncIfStale = useCallback(
    async (d: StockLoaded, opts: { force?: boolean } = {}) => {
      if (syncRef.current) return;
      const now = Date.now();
      const stockIds = lojasRef.current
        .map((s) => s.id)
        .filter((id) => {
          const at = d.syncedAt.get(id);
          return opts.force || !at || now - Date.parse(at) > STOCK_MAX_AGE_MS;
        });
      if (stockIds.length === 0) return;

      syncRef.current = true;
      try {
        // Integracao desligada / senha invalida: o aviso fixo da tela ja explica  -  sem busca e sem toast.
        const conexao = await fetchErpConnection(session.tenantId);
        if (conexao === "disconnected" || conexao === "password") return;
        setSyncing(true);
        const r = await syncStockNow({ stockStoreIds: stockIds });
        if (!r.ok) {
          show(r.message, "danger");
          return;
        }
        if (r.failed.length > 0) show("Não foi possível buscar todo o estoque. Alguns valores podem estar desatualizados.", "warning");
        await reload();
      } finally {
        syncRef.current = false;
        setSyncing(false);
      }
    },
    [reload, show, session.tenantId],
  );

  useEffect(() => {
    if (lojasLoading) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const d = await reload();
        if (cancelled) return;
        setLoading(false);
        void syncIfStale(d);
      } catch (e) {
        console.warn("useStockData:", e);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeKey, lojasLoading, reload, syncIfStale]);

  useEffect(() => {
    const onForce = () => {
      if (data) void syncIfStale(data, { force: true });
    };
    window.addEventListener(FORCE_REFRESH_CLICK_EVENT, onForce);
    return () => window.removeEventListener(FORCE_REFRESH_CLICK_EVENT, onForce);
  }, [data, syncIfStale]);

  const view = useMemo(
    () =>
      data
        ? buildStockProductsView({
            stores: lojas,
            catalog: data.catalog,
            stock: data.stock,
            costPrices: data.costPrices,
            salePrices: new Map(),
            saleTableId: null,
            charged: [],
          })
        : null,
    [data, lojas],
  );

  const syncedTimes = lojas.map((s) => data?.syncedAt.get(s.id) ?? null);
  const oldestSync = syncedTimes.every((t) => t != null)
    ? syncedTimes.reduce<string | null>((m, t) => (m == null || Date.parse(t!) < Date.parse(m) ? t : m), null)
    : null;
  const atualizadoTexto = syncing
    ? "Buscando estoque…"
    : oldestSync
      ? `Estoque atualizado ${hora(oldestSync)}`
      : "Estoque ainda não atualizado";

  return {
    lojas,
    storeKey,
    view,
    loading: loading || lojasLoading,
    syncing,
    atualizadoTexto,
  };
}
