import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui";
import { addDays } from "@/data/wedash/autoRefresh";
import { calendarTodayIso } from "@/data/wedash/clock";
import { buildPurchaseOrderView, parseMinInput, type PurchaseMinUpdate, type PurchaseOrderView, type PurchaseStockRow } from "@/data/wedash/purchaseOrder";
import { PURCHASE_SYNC_ERROR, fetchPurchaseMins, fetchPurchaseStock, fetchSold30, fetchSoldEver, savePurchaseMin, syncPurchaseStockNow } from "@/data/wedash/purchaseRepo";
import type { StockCatalogItem } from "@/data/wedash/stockProducts";
import { fetchCostPrices, fetchStockCatalog } from "@/data/wedash/stockRepo";
import { filterCacheGet, filterCacheSet } from "@/lib/filterCache";
import { useFilterSkeleton } from "@/lib/useFilterSkeleton";
import { refreshMomentTitle, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { fetchErpConnection } from "@/pages/dashboard/ErpStatusNotice";
import { SAVE_ERROR_MSG } from "@/pages/operation/shared";

const PURCHASE_MAX_AGE_MS = 30 * 60 * 1000;

/** Janela da coluna de vendidos. O padrão continua 30 dias (D-N a D-1). */
export const SOLD_WINDOWS = [30, 60, 90] as const;
export type SoldWindow = (typeof SOLD_WINDOWS)[number];

export type PurchaseStoreScope = { id: string; costTableId: number | null };

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

/** Formato JSON do filterCache (Map/Set nao serializa). */
type PurchaseCachePart = {
  storeId: string;
  rows: PurchaseStockRow[];
  syncedAt: string | null;
  mins: Array<[string, number]>;
  sold30: Array<[string, number]>;
  soldWindow: SoldWindow;
  soldEver: string[] | null;
  catalog: Array<[string, StockCatalogItem]>;
  costs: Array<[string, number]>;
};

type PurchaseCache = { parts: PurchaseCachePart[] };

export type PurchaseOrderPart = {
  storeId: string;
  view: PurchaseOrderView;
  catalog: Map<string, StockCatalogItem>;
  mins: Map<string, number>;
  syncedAt: string | null;
  /** Códigos que a filial tem no saldo. A cópia de mínimos só leva o que está aqui. */
  stockCodes: ReadonlySet<string>;
};

function clockLabel(iso: string): string {
  const d = new Date(iso);
  const h = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (d.toDateString() === new Date().toDateString()) return `às ${h}`;
  return `em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${h}`;
}

const isStale = (syncedAt: string | null, now: number) => !syncedAt || now - Date.parse(syncedAt) > PURCHASE_MAX_AGE_MS;

function oldestIso(stamps: Array<string | null>): string | null {
  let oldest: string | null = null;
  for (const iso of stamps) {
    if (!iso) continue;
    if (!oldest || Date.parse(iso) < Date.parse(oldest)) oldest = iso;
  }
  return oldest;
}

function toCache(parts: Loaded[]): PurchaseCache {
  return {
    parts: parts.map((part) => ({
      storeId: part.storeId,
      rows: part.rows,
      syncedAt: part.syncedAt,
      mins: [...part.mins.entries()],
      sold30: [...part.sold30.entries()],
      soldWindow: part.soldWindow,
      soldEver: part.soldEver ? [...part.soldEver] : null,
      catalog: [...part.catalog.entries()],
      costs: [...part.costs.entries()],
    })),
  };
}

function fromCache(c: PurchaseCache): Loaded[] {
  return c.parts.map((part) => ({
    storeId: part.storeId,
    rows: part.rows,
    syncedAt: part.syncedAt,
    mins: new Map(part.mins),
    sold30: new Map(part.sold30),
    soldWindow: part.soldWindow,
    soldEver: part.soldEver ? new Set(part.soldEver) : null,
    catalog: new Map(part.catalog),
    costs: new Map(part.costs),
  }));
}

function cacheReady(c: PurchaseCache | null): c is PurchaseCache {
  return c != null && Array.isArray(c.parts) && c.parts.every((p) => p != null && typeof p.storeId === "string" && Array.isArray(p.rows));
}

/**
 * Pedido de compra das filiais do seletor: saldo guardado + mínimos + vendidos (D-N a D-1) + códigos já vendidos (Novo).
 * Pacote + settle como Estoque/Dashboard. Ao abrir (e ao trocar o seletor), busca o saldo no Millennium
 * das filiais cuja última busca tem mais de 30 min; o Atualizar do topo força a busca de todas.
 */
export function usePurchaseOrder(tenantId: string, stores: PurchaseStoreScope[]) {
  const { show } = useToast();
  const storeKey = stores.map((s) => `${s.id}:${s.costTableId ?? ""}`).join(",");
  const filterKey = `purchase:${tenantId}:${storeKey}`;
  const { showSkeleton, settle } = useFilterSkeleton(filterKey);
  const [data, setData] = useState<Loaded[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [factor, setFactor] = useState(1);
  const [soldDays, setSoldDays] = useState<SoldWindow>(30);
  const [now, setNow] = useState(() => Date.now());
  const soldDaysRef = useRef(soldDays);
  soldDaysRef.current = soldDays;
  const storesRef = useRef(stores);
  storesRef.current = stores;
  const dataRef = useRef(data);
  dataRef.current = data;
  const filterKeyRef = useRef(filterKey);
  filterKeyRef.current = filterKey;
  /** Trocar o seletor no meio libera a busca da seleção nova. */
  const generation = useRef(0);

  const persist = useCallback((key: string, next: Loaded[]) => {
    filterCacheSet(key, toCache(next));
    setData(next);
  }, []);

  const applyPackage = useCallback(
    (key: string, loaded: Loaded[]) => {
      persist(key, loaded);
      settle(key);
    },
    [persist, settle],
  );

  const loadAll = useCallback(
    async (scope: PurchaseStoreScope[]): Promise<Loaded[]> => {
      const today = calendarTodayIso();
      const days = soldDaysRef.current;
      const tableIds = [...new Set(scope.map((s) => s.costTableId).filter((id): id is number => id != null))];
      const catalogP = fetchStockCatalog();
      const pricesP = tableIds.length ? fetchCostPrices(tableIds) : Promise.resolve(new Map<number, Map<string, number>>());
      const perStore = await Promise.all(
        scope.map(async (s) => {
          const [stock, mins, sold30, soldEver] = await Promise.all([
            fetchPurchaseStock(tenantId, s.id),
            fetchPurchaseMins(tenantId, s.id),
            fetchSold30(tenantId, s.id, addDays(today, -days), addDays(today, -1)),
            fetchSoldEver(tenantId, s.id, today),
          ]);
          return { s, stock, mins, sold30, soldEver };
        }),
      );
      const [catalog, priceTables] = await Promise.all([catalogP, pricesP]);
      return perStore.map(({ s, stock, mins, sold30, soldEver }) => ({
        storeId: s.id,
        rows: stock.rows,
        syncedAt: stock.syncedAt,
        mins,
        sold30,
        soldWindow: days,
        soldEver,
        catalog,
        costs: s.costTableId == null ? new Map() : (priceTables.get(s.costTableId) ?? new Map()),
      }));
    },
    [tenantId],
  );

  /** Busca no Millennium e relê o saldo. `false` = não buscou (integração desligada). */
  const sync = useCallback(
    async (ids: string[], gen: number): Promise<boolean> => {
      if (ids.length === 0) return false;
      try {
        const conexao = await fetchErpConnection(tenantId);
        if (conexao === "disconnected" || conexao === "password") return false;
        if (generation.current !== gen) return false;
        setSyncing(true);
        const r = await syncPurchaseStockNow(ids);
        if (generation.current !== gen) return true;
        if (!r.ok) {
          setSyncError(r.message);
          return true;
        }
        const okIds = ids.filter((id) => !r.failedStores.includes(id));
        setSyncError(r.failedStores.length ? PURCHASE_SYNC_ERROR : null);
        if (okIds.length > 0) {
          const stocks = await Promise.all(okIds.map((id) => fetchPurchaseStock(tenantId, id)));
          if (generation.current !== gen) return true;
          setData((prev) => {
            const next = prev.map((part) => {
              const i = okIds.indexOf(part.storeId);
              if (i < 0) return part;
              return { ...part, rows: stocks[i].rows, syncedAt: stocks[i].syncedAt };
            });
            filterCacheSet(filterKeyRef.current, toCache(next));
            return next;
          });
          setNow(Date.now());
        }
        return true;
      } finally {
        if (generation.current === gen) setSyncing(false);
      }
    },
    [tenantId],
  );

  const reload = useCallback(async () => {
    const gen = ++generation.current;
    const key = filterKey;
    const scope = storesRef.current;
    setSyncError(null);
    if (scope.length === 0) {
      persist(key, []);
      settle(key);
      return null;
    }
    const cached = filterCacheGet<PurchaseCache>(key);
    if (cacheReady(cached)) {
      applyPackage(key, fromCache(cached));
    }
    try {
      const loaded = await loadAll(scope);
      if (gen !== generation.current) return null;
      applyPackage(key, loaded);
      return loaded;
    } catch (e) {
      if (gen !== generation.current) return null;
      console.warn("usePurchaseOrder:", e);
      // Sem pacote: libera o skeleton para nao ficar eterno (igual falha de rede no Dashboard).
      if (!cacheReady(cached)) {
        persist(key, []);
        settle(key);
      }
      return null;
    }
  }, [filterKey, loadAll, applyPackage, persist, settle]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await reload();
      if (cancelled || !loaded) return;
      const staleIds = loaded.filter((d) => isStale(d.syncedAt, Date.now())).map((d) => d.storeId);
      if (staleIds.length > 0) await sync(staleIds, generation.current);
    })();
    return () => {
      cancelled = true;
    };
  }, [storeKey, reload, sync]);

  const windowKey = data.map((p) => `${p.storeId}:${p.soldWindow}`).join("|");
  useEffect(() => {
    const pending = dataRef.current.filter((p) => p.soldWindow !== soldDays);
    if (pending.length === 0) return;
    const gen = generation.current;
    let cancelled = false;
    void (async () => {
      try {
        const today = calendarTodayIso();
        const sold = await Promise.all(pending.map((p) => fetchSold30(tenantId, p.storeId, addDays(today, -soldDays), addDays(today, -1))));
        if (cancelled || generation.current !== gen) return;
        setData((prev) => {
          const next = prev.map((part) => {
            const i = pending.findIndex((p) => p.storeId === part.storeId);
            if (i < 0 || part.soldWindow === soldDays) return part;
            return { ...part, sold30: sold[i], soldWindow: soldDays };
          });
          filterCacheSet(filterKeyRef.current, toCache(next));
          return next;
        });
      } catch (e) {
        console.warn("usePurchaseOrder sold window:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [soldDays, windowKey, tenantId]);

  const parts: PurchaseOrderPart[] = useMemo(
    () =>
      data.map((part) => ({
        storeId: part.storeId,
        view: buildPurchaseOrderView({
          stock: part.rows,
          mins: part.mins,
          sold30: part.sold30,
          soldEver: part.soldEver,
          factor,
          todayIso: calendarTodayIso(),
          costs: part.costs,
        }),
        catalog: part.catalog,
        mins: part.mins,
        syncedAt: part.syncedAt,
        stockCodes: new Set(part.rows.map((row) => row.code)),
      })),
    [data, factor],
  );

  const stamps = data.map((p) => p.syncedAt);
  const statusIso = data.length === 0 ? undefined : stamps.every((iso) => !iso) ? null : oldestIso(stamps);

  useScreenRefresh({
    label: "Atualizar o saldo do pedido",
    tip:
      stores.length > 1
        ? "Busca no Millennium o saldo usado no pedido de compra das filiais desta tela."
        : "Busca no Millennium o saldo usado no pedido de compra desta filial.",
    status: refreshMomentTitle(statusIso),
    busyLabel: "Buscando saldo do pedido…",
    run: async () => {
      const ids = storesRef.current.map((s) => s.id);
      if (ids.length > 0) await sync(ids, generation.current);
    },
  });

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  /** Grava o mínimo digitado na filial da linha. `false` = valor recusado ou gravação falhou (o campo volta ao último gravado). */
  const saveMin = useCallback(
    async (storeId: string, code: string, raw: string): Promise<boolean> => {
      const part = dataRef.current.find((p) => p.storeId === storeId);
      if (!part) return false;
      const parsed = parseMinInput(raw);
      if (!parsed.ok) {
        show("Use um número inteiro entre 0 e 99.999.", "danger");
        return false;
      }
      const before = part.mins.has(code) ? part.mins.get(code)! : null;
      if (before === parsed.value) return true;
      const apply = (value: number | null) =>
        setData((prev) => {
          const next = prev.map((row) => {
            if (row.storeId !== storeId) return row;
            const mins = new Map(row.mins);
            if (value == null) mins.delete(code);
            else mins.set(code, value);
            return { ...row, mins };
          });
          filterCacheSet(filterKeyRef.current, toCache(next));
          return next;
        });
      apply(parsed.value);
      const ok = await savePurchaseMin(tenantId, storeId, code, parsed.value);
      if (!ok) {
        apply(before);
        show(SAVE_ERROR_MSG, "danger");
      }
      return ok;
    },
    [show, tenantId],
  );

  const applyMins = useCallback((storeId: string, updates: PurchaseMinUpdate[]) => {
    setData((prev) => {
      const next = prev.map((part) => {
        if (part.storeId !== storeId) return part;
        const mins = new Map(part.mins);
        for (const update of updates) mins.set(update.code, update.value);
        return { ...part, mins };
      });
      filterCacheSet(filterKeyRef.current, toCache(next));
      return next;
    });
  }, []);

  const staleParts = data.filter((p) => isStale(p.syncedAt, now));
  const staleAt = oldestIso(staleParts.map((p) => p.syncedAt));
  const many = stores.length > 1;
  const staleText =
    staleParts.length === 0
      ? null
      : !staleAt
        ? many
          ? "O saldo de alguma filial ainda não foi atualizado. O pedido pode usar quantidades desatualizadas."
          : null
        : many
          ? `O saldo de alguma filial foi atualizado ${clockLabel(staleAt)}. O pedido pode usar quantidades desatualizadas.`
          : `O saldo foi atualizado ${clockLabel(staleAt)}. O pedido pode usar quantidades desatualizadas.`;

  return {
    parts,
    /** Cabeçalho na hora; tabela em skeleton ate o pacote do filtro (1ª carga e troca de filial). */
    showSkeleton,
    syncing,
    syncError,
    stale: !syncing && staleParts.length > 0 && staleText != null,
    staleText,
    factor,
    setFactor,
    soldDays,
    setSoldDays,
    saveMin,
    applyMins,
  };
}
