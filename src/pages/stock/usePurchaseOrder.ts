import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui";
import { addDays } from "@/data/wedash/autoRefresh";
import { calendarTodayIso } from "@/data/wedash/clock";
import { buildPurchaseOrderView, parseMinInput, type PurchaseStockRow } from "@/data/wedash/purchaseOrder";
import { PURCHASE_SYNC_ERROR, fetchPurchaseMins, fetchPurchaseStock, fetchSold30, fetchSoldEver, savePurchaseMin, syncPurchaseStockNow } from "@/data/wedash/purchaseRepo";
import type { StockCatalogItem } from "@/data/wedash/stockProducts";
import { fetchCostPrices, fetchStockCatalog } from "@/data/wedash/stockRepo";
import { refreshStatusLine, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { fetchErpConnection } from "@/pages/dashboard/ErpStatusNotice";
import { SAVE_ERROR_MSG } from "@/pages/operation/shared";

const PURCHASE_MAX_AGE_MS = 30 * 60 * 1000;

/** Janela da coluna de vendidos. O padrão continua 30 dias (D-N a D-1). */
export const SOLD_WINDOWS = [30, 60, 90] as const;
export type SoldWindow = (typeof SOLD_WINDOWS)[number];

type Loaded = {
  storeId: string;
  rows: PurchaseStockRow[];
  syncedAt: string | null;
  mins: Map<string, number>;
  sold30: Map<string, number>;
  soldWindow: SoldWindow;
  soldEver: Set<string> | null;
  catalog: Map<string, StockCatalogItem>;
  costs: Map<string, number>;
};

function hora(iso: string): string {
  const d = new Date(iso);
  const h = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (d.toDateString() === new Date().toDateString()) return `às ${h}`;
  return `em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${h}`;
}

const isStale = (syncedAt: string | null, now: number) => !syncedAt || now - Date.parse(syncedAt) > PURCHASE_MAX_AGE_MS;

/**
 * Pedido de compra de uma loja: saldo guardado + minimos + vendidos em 30 dias (D-30 a D-1) + codigos ja vendidos (Novo).
 * Ao abrir (e ao trocar de loja), busca o saldo no Millennium se a ultima busca tem mais de 30 min;
 * o Atualizar do topo forca a busca.
 */
export function usePurchaseOrder(tenantId: string, storeId: string | null, costTableId: number | null) {
  const { show } = useToast();
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [factor, setFactor] = useState(1);
  const [soldDays, setSoldDays] = useState<SoldWindow>(30);
  const [now, setNow] = useState(() => Date.now());
  const soldDaysRef = useRef(soldDays);
  soldDaysRef.current = soldDays;
  const storeRef = useRef(storeId);
  storeRef.current = storeId;
  /** Loja com busca em andamento (trocar de loja no meio libera a busca da nova). */
  const syncRef = useRef<string | null>(null);

  const load = useCallback(
    async (id: string, tableId: number | null): Promise<Loaded> => {
      const hoje = calendarTodayIso();
      const days = soldDaysRef.current;
      const [stock, mins, sold30, soldEver, catalog, priceTables] = await Promise.all([
        fetchPurchaseStock(tenantId, id),
        fetchPurchaseMins(tenantId, id),
        fetchSold30(tenantId, id, addDays(hoje, -days), addDays(hoje, -1)),
        fetchSoldEver(tenantId, id, hoje),
        fetchStockCatalog(),
        tableId == null ? Promise.resolve(new Map<number, Map<string, number>>()) : fetchCostPrices([tableId]),
      ]);
      return {
        storeId: id,
        rows: stock.rows,
        syncedAt: stock.syncedAt,
        mins,
        sold30,
        soldWindow: days,
        soldEver,
        catalog,
        costs: tableId == null ? new Map() : (priceTables.get(tableId) ?? new Map()),
      };
    },
    [tenantId],
  );

  /** Busca no Millennium e rele o saldo. `false` = nao buscou (integracao desligada / outra busca rodando). */
  const sync = useCallback(
    async (id: string): Promise<boolean> => {
      if (syncRef.current === id) return false;
      syncRef.current = id;
      try {
        // Integracao desligada / senha invalida: o aviso fixo da tela ja explica  -  sem busca e sem alerta.
        const conexao = await fetchErpConnection(tenantId);
        if (conexao === "disconnected" || conexao === "password") return false;
        setSyncing(true);
        const r = await syncPurchaseStockNow([id]);
        if (storeRef.current !== id) return true;
        if (!r.ok || r.failedStores.includes(id)) {
          setSyncError(r.ok ? PURCHASE_SYNC_ERROR : r.message);
          return true;
        }
        setSyncError(null);
        const stock = await fetchPurchaseStock(tenantId, id);
        if (storeRef.current !== id) return true;
        setData((d) => (d && d.storeId === id ? { ...d, rows: stock.rows, syncedAt: stock.syncedAt } : d));
        setNow(Date.now());
        return true;
      } finally {
        if (syncRef.current === id) {
          syncRef.current = null;
          setSyncing(false);
        }
      }
    },
    [tenantId],
  );

  useEffect(() => {
    if (!storeId) {
      setLoading(false);
      setSyncError(null);
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSyncError(null);
    (async () => {
      try {
        const d = await load(storeId, costTableId);
        if (cancelled) return;
        setData(d);
        setNow(Date.now());
        if (!isStale(d.syncedAt, Date.now())) {
          setLoading(false);
          return;
        }
        // 1 busca da loja (nada guardado): skeleton ate terminar; senao mostra o guardado e busca por tras.
        if (d.syncedAt) setLoading(false);
        await sync(storeId);
        if (!cancelled) setLoading(false);
      } catch (e) {
        console.warn("usePurchaseOrder:", e);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, costTableId, load, sync]);

  useEffect(() => {
    const id = storeId;
    if (!id || !data || data.storeId !== id || data.soldWindow === soldDays) return;
    let cancelled = false;
    (async () => {
      try {
        const hoje = calendarTodayIso();
        const sold = await fetchSold30(tenantId, id, addDays(hoje, -soldDays), addDays(hoje, -1));
        if (cancelled || storeRef.current !== id) return;
        setData((d) => (d && d.storeId === id ? { ...d, sold30: sold, soldWindow: soldDays } : d));
      } catch (e) {
        console.warn("usePurchaseOrder sold window:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [soldDays, storeId, tenantId, data]);

  const saldoIso = data && data.storeId === storeId ? data.syncedAt : null;
  useScreenRefresh({
    label: "Atualizar o saldo do pedido",
    tip: "Busca no Millennium o saldo do pedido de compra desta loja.",
    status: data ? refreshStatusLine("Saldo atualizado", "Saldo ainda não atualizado", saldoIso) : undefined,
    run: async () => {
      if (storeRef.current) await sync(storeRef.current);
    },
  });

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const current = data && data.storeId === storeId ? data : null;

  const view = useMemo(
    () =>
      current
        ? buildPurchaseOrderView({
            stock: current.rows,
            mins: current.mins,
            sold30: current.sold30,
            soldEver: current.soldEver,
            factor,
            todayIso: calendarTodayIso(),
            costs: current.costs,
          })
        : null,
    [current, factor],
  );

  /** Grava o minimo digitado. `false` = valor recusado ou gravacao falhou (o campo volta ao ultimo gravado). */
  const saveMin = useCallback(
    async (code: string, raw: string): Promise<boolean> => {
      const id = storeRef.current;
      if (!id || !current) return false;
      const parsed = parseMinInput(raw);
      if (!parsed.ok) {
        show("Use um número inteiro entre 0 e 99.999.", "danger");
        return false;
      }
      const before = current.mins.has(code) ? current.mins.get(code)! : null;
      if (before === parsed.value) return true;
      const apply = (value: number | null) =>
        setData((d) => {
          if (!d || d.storeId !== id) return d;
          const mins = new Map(d.mins);
          if (value == null) mins.delete(code);
          else mins.set(code, value);
          return { ...d, mins };
        });
      apply(parsed.value);
      const ok = await savePurchaseMin(tenantId, id, code, parsed.value);
      if (!ok) {
        apply(before);
        show(SAVE_ERROR_MSG, "danger");
      }
      return ok;
    },
    [current, show, tenantId],
  );

  const syncedAt = current?.syncedAt ?? null;

  return {
    view,
    catalog: current?.catalog ?? null,
    mins: current?.mins ?? null,
    loading: storeId != null && (loading || current == null),
    syncing,
    syncError,
    syncedAt,
    stale: !syncing && syncedAt != null && isStale(syncedAt, now),
    staleTexto: syncedAt ? `O saldo foi atualizado ${hora(syncedAt)}. O pedido pode usar quantidades desatualizadas.` : null,
    factor,
    setFactor,
    soldDays,
    setSoldDays,
    saveMin,
  };
}
