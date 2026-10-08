import { describe, expect, it, vi } from "vitest";
import {
  chunkByCalendarMonths,
  closeHour,
  closeWindow,
  collapseDaysToWindows,
  dailyCloseEnabled,
  daysNeedingHeavySync,
  endOfDayInTz,
  historyFloor,
  hourInTz,
  isCloseWindow,
  isContentionError,
  missingDays,
  nextFallbackMaxDays,
  nextHistoryWindow,
  runSyncJob,
  seedWindow,
  shouldBuildProductBrandMap,
  splitFailedWindow,
  storeFetchConcurrency,
  type SyncJob,
  type SyncJobDeps,
  type SyncStore,
} from "./runSyncJob";
import { createListaMemo, listaFingerprint } from "./listaFingerprint";

const stores: SyncStore[] = [
  {
    id: "s1",
    millenniumStoreId: 1,
    code: "00010",
    timezone: "America/Campo_Grande",
  },
  {
    id: "s2",
    millenniumStoreId: 2,
    code: "00114",
    timezone: "America/Campo_Grande",
  },
];

function baseJob(partial: Partial<SyncJob> = {}): SyncJob {
  return {
    id: "job-1",
    tenantId: "t1",
    credentialId: "c1",
    kind: "LIGHT",
    status: "QUEUED",
    payload: {},
    ...partial,
  };
}

function makeDeps(overrides: Partial<SyncJobDeps> = {}): SyncJobDeps & {
  calls: { logout: number; login: number; fetch: string[] };
} {
  const calls = { logout: 0, login: 0, fetch: [] as string[] };
  const deps: SyncJobDeps & { calls: typeof calls } = {
    calls,
    hasRunningForCredential: vi.fn().mockResolvedValue(false),
    markJobRunning: vi.fn().mockResolvedValue(undefined),
    markJobFinished: vi.fn().mockResolvedValue(undefined),
    loadCredential: vi.fn().mockResolvedValue({
      id: "c1",
      tenantId: "t1",
      username: "u",
      password: "p",
      status: "VALID",
    }),
    listStores: vi.fn().mockResolvedValue(stores),
    listExistingDays: vi.fn().mockResolvedValue([]),
    listDaysWithCmv: vi.fn().mockResolvedValue([]),
    listDaysWithProduct: vi.fn().mockResolvedValue([]),
    listDaysPaymentComplete: vi.fn().mockResolvedValue([]),
    earliestSalesDay: vi.fn().mockResolvedValue(null),
    login: vi.fn().mockImplementation(async () => {
      calls.login += 1;
      return { ok: true as const, session: "sess-1" };
    }),
    logout: vi.fn().mockImplementation(async () => {
      calls.logout += 1;
    }),
    resolveEventoIds: vi.fn().mockResolvedValue([17, 24, 22, 107]),
    fetchSalesLista: vi.fn().mockImplementation(async (p: { storeId: string; eventoIds: number[]; millenniumStoreId?: number | null }) => {
      calls.fetch.push(
        p.millenniumStoreId == null ? `ALL:${p.storeId || "-"}` : p.storeId,
      );
      expect(p.eventoIds.length).toBeGreaterThan(0);
      return [];
    }),
    fetchFilialGeradorMap: vi.fn().mockResolvedValue(new Map([["00010", 126], ["00114", 41562]])),
    fetchProductBrandMap: vi.fn().mockResolvedValue({
      map: new Map(),
      geradorIdsWithWpink: new Set(),
    }),
    fetchBrandRevenueReport: vi.fn().mockResolvedValue([]),
    fetchConsultaDetMov: vi.fn().mockResolvedValue([]),
    listCouponBrands: vi.fn().mockResolvedValue([]),
    upsertCouponBrands: vi.fn().mockResolvedValue(undefined),
    fetchRelatorioMargem: vi.fn().mockResolvedValue([]),
    fetchCouponReport: vi.fn().mockResolvedValue([]),
    upsertDayAggs: vi.fn().mockResolvedValue(undefined),
    patchDayCmv: vi.fn().mockResolvedValue(undefined),
    replaceProductDayAggs: vi.fn().mockResolvedValue(undefined),
    replaceProductCostDayAggs: vi.fn().mockResolvedValue(undefined),
    replacePaymentDayAggs: vi.fn().mockResolvedValue(undefined),
    replaceSellerDayAggs: vi.fn().mockResolvedValue(undefined),
    upsertHourAggs: vi.fn().mockResolvedValue(undefined),
    setStoresHasWpink: vi.fn().mockResolvedValue(undefined),
    insertSyncRun: vi.fn().mockResolvedValue(undefined),
    updateCredential: vi.fn().mockResolvedValue(undefined),
    getStoredSession: vi.fn().mockResolvedValue(null),
    setStoredSession: vi.fn().mockResolvedValue(undefined),
    enqueueMonthFillDay: vi.fn().mockResolvedValue(true),
    now: () => new Date("2026-09-19T15:00:00.000Z"),
    ...overrides,
  };
  return deps;
}

describe("fechamento noturno (CLOSE)", () => {
  it("closeWindow = ontem; + anteontem se a noite anterior não fechou", () => {
    expect(closeWindow("2026-09-24", true)).toEqual({ from: "2026-09-23", to: "2026-09-23" });
    expect(closeWindow("2026-09-24", false)).toEqual({ from: "2026-09-22", to: "2026-09-23" });
    expect(closeWindow("2026-10-01", true)).toEqual({ from: "2026-09-30", to: "2026-09-30" });
  });

  it("endOfDayInTz = 23:59:30 local", () => {
    expect(endOfDayInTz("2026-09-23", "America/Campo_Grande").toISOString()).toBe("2026-09-24T03:59:30.000Z");
    expect(endOfDayInTz("2026-09-23", "America/Sao_Paulo").toISOString()).toBe("2026-09-24T02:59:30.000Z");
  });

  it("hourInTz / closeHour / dailyCloseEnabled", () => {
    expect(hourInTz(new Date("2026-09-24T07:00:00.000Z"), "America/Campo_Grande")).toBe(3);
    expect(hourInTz(new Date("2026-09-24T04:00:00.000Z"), "America/Sao_Paulo")).toBe(1);
    expect(closeHour({})).toBe(3);
    expect(closeHour({ CLOSE_HOUR: "5" })).toBe(5);
    expect(closeHour({ CLOSE_HOUR: "x" })).toBe(3);
    expect(dailyCloseEnabled({})).toBe(true);
    expect(dailyCloseEnabled({ CLOSE_HOUR: "off" })).toBe(false);
    expect(dailyCloseEnabled({ CLOSE_HOUR: "4" })).toBe(true);
  });

  it("isCloseWindow = 6h a partir de CLOSE_HOUR (fora disso espera a próxima noite)", () => {
    expect(isCloseWindow(2, 3)).toBe(false);
    expect(isCloseWindow(3, 3)).toBe(true);
    expect(isCloseWindow(8, 3)).toBe(true);
    expect(isCloseWindow(9, 3)).toBe(false);
    expect(isCloseWindow(14, 3)).toBe(false);
    expect(isCloseWindow(1, 22)).toBe(true);
  });
});

describe("seedWindow / missingDays / history", () => {
  it("SEED window is current month start → today", () => {
    expect(seedWindow("2026-09-19")).toEqual({ from: "2026-09-01", to: "2026-09-19" });
    expect(seedWindow("2026-01-01")).toEqual({ from: "2026-01-01", to: "2026-01-01" });
  });

  it("splitFailedWindow ladder: >15 → 15d, >7 → 7d, else 1d", () => {
    expect(nextFallbackMaxDays("2026-08-01", "2026-08-31")).toBe(15);
    expect(splitFailedWindow("2026-08-01", "2026-08-31")).toEqual([
      { from: "2026-08-01", to: "2026-08-15" },
      { from: "2026-08-16", to: "2026-08-30" },
      { from: "2026-08-31", to: "2026-08-31" },
    ]);
    expect(nextFallbackMaxDays("2026-08-01", "2026-08-15")).toBe(7);
    expect(splitFailedWindow("2026-08-01", "2026-08-07")).toEqual([
      { from: "2026-08-01", to: "2026-08-01" },
      { from: "2026-08-02", to: "2026-08-02" },
      { from: "2026-08-03", to: "2026-08-03" },
      { from: "2026-08-04", to: "2026-08-04" },
      { from: "2026-08-05", to: "2026-08-05" },
      { from: "2026-08-06", to: "2026-08-06" },
      { from: "2026-08-07", to: "2026-08-07" },
    ]);
    expect(nextFallbackMaxDays("2026-08-01", "2026-08-01")).toBeNull();
    expect(splitFailedWindow("2026-08-01", "2026-08-01")).toEqual([]);
  });

  it("historyFloor is max(opened_at, 1º do mês N meses antes do atual)", () => {
    expect(historyFloor("2026-09-21", null, 24)).toBe("2024-09-01");
    expect(historyFloor("2026-09-21", "2025-03-01", 24)).toBe("2025-03-01");
    expect(historyFloor("2026-09-21", "2020-01-01", 24)).toBe("2024-09-01");
    expect(historyFloor("2026-09-21", null, 2)).toBe("2026-07-01");
    expect(historyFloor("2026-01-31", null, 2)).toBe("2025-11-01");
  });
  it("com teto de 2 meses busca julho e para (set/26)", () => {
    const base = { today: "2026-09-24", openedAt: null, seedFrom: "2026-08-01", months: 2 };
    expect(nextHistoryWindow({ ...base, earliestExisting: "2026-08-01" })).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(nextHistoryWindow({ ...base, earliestExisting: "2026-07-01" })).toBeNull();
  });

  it("nextHistoryWindow walks one calendar month back, clamped to floor", () => {
    expect(
      nextHistoryWindow({
        today: "2026-09-21",
        openedAt: null,
        earliestExisting: "2026-08-01",
        seedFrom: "2026-08-01",
      }),
    ).toEqual({ from: "2026-07-01", to: "2026-07-31" });

    expect(
      nextHistoryWindow({
        today: "2026-09-21",
        openedAt: "2026-07-15",
        earliestExisting: "2026-08-01",
        seedFrom: "2026-08-01",
      }),
    ).toEqual({ from: "2026-07-15", to: "2026-07-31" });

    expect(
      nextHistoryWindow({
        today: "2026-09-21",
        openedAt: "2026-08-01",
        earliestExisting: "2026-08-01",
        seedFrom: "2026-08-01",
      }),
    ).toBeNull();
  });

  it("chunkByCalendarMonths splits Aug→Sep mid-month", () => {
    expect(chunkByCalendarMonths("2026-08-01", "2026-09-19")).toEqual([
      { from: "2026-08-01", to: "2026-08-31" },
      { from: "2026-09-01", to: "2026-09-19" },
    ]);
  });

  it("FORCE always includes today even when already present", () => {
    const days = missingDays("2026-09-01", "2026-09-10", ["2026-09-01", "2026-09-19"], {
      today: "2026-09-19",
      alwaysToday: true,
    });
    expect(days).toContain("2026-09-19");
    expect(days).toContain("2026-09-02");
    expect(days).not.toContain("2026-09-01");
  });

  it("FORCE CMV e produtos = buracos + hoje", async () => {
    const deps = {
      listDaysWithCmv: vi.fn().mockResolvedValue(["2026-09-01", "2026-09-02", "2026-09-03"]),
      listDaysWithProduct: vi.fn().mockResolvedValue(["2026-09-01", "2026-09-02"]),
    };
    const cmv = await daysNeedingHeavySync(deps, {
      kind: "FORCE",
      tenantId: "t1",
      storeId: "s1",
      from: "2026-09-01",
      to: "2026-09-05",
      today: "2026-09-19",
      which: "cmv",
    });
    expect(cmv).toEqual(["2026-09-04", "2026-09-05", "2026-09-19"]);
    const cat = await daysNeedingHeavySync(deps, {
      kind: "FORCE",
      tenantId: "t1",
      storeId: "s1",
      from: "2026-09-01",
      to: "2026-09-05",
      today: "2026-09-19",
      which: "product",
    });
    expect(cat).toEqual(["2026-09-03", "2026-09-04", "2026-09-05", "2026-09-19"]);
  });

  it("RANGE only returns gaps", () => {
    const days = missingDays("2026-09-01", "2026-09-05", ["2026-09-02", "2026-09-03"], {
      today: "2026-09-19",
      alwaysToday: false,
    });
    expect(days).toEqual(["2026-09-01", "2026-09-04", "2026-09-05"]);
  });

  it("collapseDaysToWindows merges contiguous days", () => {
    expect(collapseDaysToWindows(["2026-09-01", "2026-09-02", "2026-09-05"])).toEqual([
      { from: "2026-09-01", to: "2026-09-02" },
      { from: "2026-09-05", to: "2026-09-05" },
    ]);
  });
});

describe("runSyncJob", () => {
  it("refuses to start when another RUNNING job holds the credential", async () => {
    const deps = makeDeps({
      hasRunningForCredential: vi.fn().mockResolvedValue(true),
    });
    const result = await runSyncJob(baseJob(), deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("locked");
    expect(deps.calls.login).toBe(0);
    expect(deps.markJobRunning).not.toHaveBeenCalled();
    // Contencao = falha: job permanece QUEUED (processOneJob para o burst).
    expect(deps.markJobFinished).not.toHaveBeenCalled();
  });

  it("marks job failed on busy login and does not leave a session", async () => {
    const deps = makeDeps({
      login: vi.fn().mockResolvedValue({ ok: false, reason: "busy", raw: "max sessions" }),
    });
    const result = await runSyncJob(baseJob(), deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("busy");
    expect(deps.markJobFinished).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED" }),
    );
    expect(deps.calls.logout).toBe(0);
    expect(deps.insertSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
    );
  });

  it("sets credential INVALID on password failure", async () => {
    const deps = makeDeps({
      login: vi.fn().mockResolvedValue({ ok: false, reason: "password", raw: "senha inválida" }),
    });
    const result = await runSyncJob(baseJob(), deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("password");
    expect(deps.updateCredential).toHaveBeenCalledWith(
      expect.objectContaining({ status: "INVALID" }),
    );
  });

  it("keeps tenant session after job (no logout) even if upsert throws", async () => {
    const deps = makeDeps({
      upsertDayAggs: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const result = await runSyncJob(baseJob(), deps);
    expect(result.ok).toBe(false);
    expect(deps.calls.logout).toBe(0);
    expect(deps.setStoredSession).toHaveBeenCalledWith("c1", "sess-1");
    expect(deps.markJobFinished).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED" }),
    );
  });

  it("LIGHT fetches all stores in one Lista call (FILIAL null)", async () => {
    const deps = makeDeps();
    const result = await runSyncJob(baseJob({ kind: "LIGHT" }), deps);
    expect(result.ok).toBe(true);
    expect(deps.calls.fetch).toEqual(["ALL:-"]);
    expect(deps.calls.logout).toBe(0);
    expect(deps.setStoredSession).toHaveBeenCalledWith("c1", "sess-1");
    expect(deps.updateCredential).toHaveBeenCalledWith(
      expect.objectContaining({ lastLightSyncAt: expect.any(Date) }),
    );
    expect(deps.markJobFinished).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCEEDED" }),
    );
    expect(deps.upsertDayAggs).toHaveBeenCalled();
  });

  it("reuses stored tenant session without new login", async () => {
    const deps = makeDeps({
      getStoredSession: vi.fn().mockResolvedValue("sess-saved"),
    });
    const result = await runSyncJob(baseJob({ kind: "LIGHT" }), deps);
    expect(result.ok).toBe(true);
    expect(deps.calls.login).toBe(0);
    expect(deps.calls.logout).toBe(0);
  });

  it("SEED busca só hoje, grava 'Atualizado às…' e enfileira a carga do mês a partir de ontem", async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      listStores: vi.fn().mockResolvedValue([stores[0]]),
      fetchSalesLista: vi.fn().mockImplementation(async (p: { from: string; to: string }) => {
        calls.push(`${p.from}→${p.to}`);
        return [];
      }),
      now: () => new Date("2026-09-03T15:00:00.000Z"),
    });
    const result = await runSyncJob(baseJob({ kind: "SEED" }), deps);
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["2026-09-03→2026-09-03"]);
    expect(deps.updateCredential).toHaveBeenCalledWith(
      expect.objectContaining({ lastLightSyncAt: expect.any(Date) }),
    );
    expect(deps.enqueueMonthFillDay).toHaveBeenCalledWith(
      expect.objectContaining({ day: "2026-09-02", fillUntil: "2026-09-01" }),
    );
  });

  it("SEED no dia 1 não enfileira carga do mês", async () => {
    const deps = makeDeps({
      listStores: vi.fn().mockResolvedValue([stores[0]]),
      now: () => new Date("2026-09-01T15:00:00.000Z"),
    });
    const result = await runSyncJob(baseJob({ kind: "SEED" }), deps);
    expect(result.ok).toBe(true);
    expect(deps.enqueueMonthFillDay).not.toHaveBeenCalled();
  });

  it("SEED com SYNC_ONBOARDING=off: sem vendas, mas traz gerador, equipe e produtos", async () => {
    vi.stubEnv("SYNC_ONBOARDING", "off");
    try {
      const fetchStoreSellers = vi.fn().mockResolvedValue([]);
      const syncStoreSellers = vi.fn().mockResolvedValue([]);
      const setStoresGerador = vi.fn().mockResolvedValue(undefined);
      const fetchTypes = vi.fn().mockResolvedValue([{ typeId: 14, description: "BODY SPLASH" }]);
      const markStoresClosed = vi.fn().mockResolvedValue(undefined);
      const deps = makeDeps({
        markStoresClosed,
        loadSellerDirectory: vi.fn().mockResolvedValue({ sellers: [] }),
        fetchStoreSellers,
        syncStoreSellers,
        setStoresGerador,
        catalog: {
          countCatalog: vi.fn().mockResolvedValue(0),
          countCostTables: vi.fn().mockResolvedValue(0),
          knownProductIds: vi.fn().mockResolvedValue(new Set()),
          lookupProducts: vi.fn().mockResolvedValue(new Map()),
          claimRefresh: vi.fn().mockResolvedValue(true),
          releaseRefresh: vi.fn().mockResolvedValue(undefined),
          upsertTypes: vi.fn().mockResolvedValue(undefined),
          upsertProducts: vi.fn().mockResolvedValue(undefined),
          recordMisses: vi.fn().mockResolvedValue(undefined),
          fetchTypes,
          fetchProductsOfType: vi.fn().mockResolvedValue([]),
          storeCostTable: vi.fn().mockResolvedValue(null),
          coveredCostCodes: vi.fn().mockResolvedValue(new Set()),
          recordCostMisses: vi.fn().mockResolvedValue(undefined),
          fetchCostTables: vi.fn().mockResolvedValue([{ tableId: 104, description: "CENTRO-OESTE" }]),
          fetchCostTablePrices: vi.fn().mockResolvedValue(new Map([["WP014", 1000]])),
          saveCostTables: vi.fn().mockResolvedValue(undefined),
          saveCostTablePrices: vi.fn().mockResolvedValue(undefined),
        },
      });
      const result = await runSyncJob(baseJob({ kind: "SEED" }), deps);
      expect(result).toEqual({ ok: true, storesDone: 2 });
      expect(setStoresGerador).toHaveBeenCalledWith([
        { storeId: "s1", geradorId: 126 },
        { storeId: "s2", geradorId: 41562 },
      ]);
      expect(fetchStoreSellers.mock.calls.map((c) => c[0].millenniumStoreId)).toEqual([1, 2]);
      expect(syncStoreSellers).toHaveBeenCalledTimes(2);
      expect(fetchTypes).toHaveBeenCalledTimes(1);
      expect(deps.catalog!.saveCostTablePrices).toHaveBeenCalledWith(104, expect.any(Map));
      expect(deps.fetchSalesLista).not.toHaveBeenCalled();
      expect(deps.enqueueMonthFillDay).not.toHaveBeenCalled();
      expect(markStoresClosed).toHaveBeenCalledWith([
        { storeId: "s1", day: "2026-09-18" },
        { storeId: "s2", day: "2026-09-18" },
      ]);
      expect(deps.markJobFinished).toHaveBeenCalledWith(expect.objectContaining({ status: "SUCCEEDED" }));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("SEED que falha não enfileira a carga do mês", async () => {
    const deps = makeDeps({
      listStores: vi.fn().mockResolvedValue([stores[0]]),
      fetchSalesLista: vi.fn().mockRejectedValue(new Error("timeout")),
      now: () => new Date("2026-09-03T15:00:00.000Z"),
    });
    const result = await runSyncJob(baseJob({ kind: "SEED" }), deps);
    expect(result.ok).toBe(false);
    expect(deps.markJobFinished).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED" }));
    expect(deps.enqueueMonthFillDay).not.toHaveBeenCalled();
  });

  it("carga do mês: dias fechados do mês atual num job só (Lista 1×); encadeia o mês anterior", async () => {
    const windows: string[] = [];
    const deps = makeDeps({
      listStores: vi.fn().mockResolvedValue([stores[0]]),
      fetchSalesLista: vi.fn().mockImplementation(async (p: { from: string; to: string }) => {
        windows.push(`${p.from}→${p.to}`);
        return [];
      }),
      now: () => new Date("2026-09-10T15:00:00.000Z"),
    });
    const result = await runSyncJob(
      baseJob({ kind: "CLOSE", payload: { from: "2026-09-05", to: "2026-09-05", fillUntil: "2026-08-01" } }),
      deps,
    );
    expect(result.ok).toBe(true);
    expect(windows).toEqual(["2026-09-01→2026-09-05"]);
    expect(deps.enqueueMonthFillDay).toHaveBeenCalledWith(
      expect.objectContaining({ day: "2026-08-31", fillUntil: "2026-08-01" }),
    );
    for (const [arg] of (deps.updateCredential as ReturnType<typeof vi.fn>).mock.calls) {
      expect(arg).not.toHaveProperty("lastLightSyncAt");
    }
  });

  it("carga do mês: dia que falha segue para o anterior; no dia 1 para", async () => {
    const deps = makeDeps({
      listStores: vi.fn().mockResolvedValue([stores[0]]),
      fetchSalesLista: vi.fn().mockRejectedValue(new Error("timeout")),
      now: () => new Date("2026-09-10T15:00:00.000Z"),
    });
    const failed = await runSyncJob(
      baseJob({ kind: "CLOSE", payload: { from: "2026-09-05", to: "2026-09-05", fillUntil: "2026-09-01" } }),
      deps,
    );
    expect(failed.ok).toBe(false);
    expect(deps.enqueueMonthFillDay).toHaveBeenCalledWith(expect.objectContaining({ day: "2026-09-04" }));

    const last = makeDeps({
      listStores: vi.fn().mockResolvedValue([stores[0]]),
      now: () => new Date("2026-09-10T15:00:00.000Z"),
    });
    await runSyncJob(
      baseJob({ kind: "CLOSE", payload: { from: "2026-09-01", to: "2026-09-01", fillUntil: "2026-09-01" } }),
      last,
    );
    expect(last.enqueueMonthFillDay).not.toHaveBeenCalled();
  });

  it("carga do mês: senha inválida interrompe a cadeia", async () => {
    const deps = makeDeps({
      login: vi.fn().mockResolvedValue({ ok: false as const, reason: "password" as const, raw: "senha" }),
      now: () => new Date("2026-09-10T15:00:00.000Z"),
    });
    const result = await runSyncJob(
      baseJob({ kind: "CLOSE", payload: { from: "2026-09-05", to: "2026-09-05", fillUntil: "2026-09-01" } }),
      deps,
    );
    expect(result.ok).toBe(false);
    expect(deps.enqueueMonthFillDay).not.toHaveBeenCalled();
  });

  describe("carga do histórico em período", () => {
    const listaRow = (day: string, op: number, nf: string, sellerName: string) => ({
      storeId: "s1",
      occurredAt: new Date(`${day}T14:00:00.000Z`),
      operationCode: String(op),
      revenueCents: 10_000,
      itemQty: 2,
      brand: "ALL" as const,
      sellerName,
      millenniumFilial: 1,
      millenniumOpCode: op,
      nf,
      tipoOperacao: "S",
    });
    const reportLine = (day: string, key: string, productId: number, productCode: string, qty: number, revenueCents: number) => ({
      couponKey: key,
      day,
      productId,
      productCode,
      productName: productCode,
      qty,
      revenueCents,
      sellerGeradorId: 66161,
      sellerName: "GABRIELA SILVA",
    });
    const listaRows = (p: { from: string; to: string }) =>
      [
        listaRow("2026-08-31", 11, "A", "GABRIELA"),
        listaRow("2026-08-31", 12, "B", ""),
        listaRow("2026-08-30", 13, "C", "GABRIELA"),
      ].filter((r) => {
        const day = r.occurredAt.toISOString().slice(0, 10);
        return day >= p.from && day <= p.to;
      });
    const monthDeps = (overrides: Partial<SyncJobDeps> = {}) =>
      makeDeps({
        listStores: vi.fn().mockResolvedValue([stores[0]]),
        fetchSalesLista: vi.fn().mockImplementation(async (p: { from: string; to: string }) => listaRows(p)),
        fetchCouponReport: vi.fn().mockResolvedValue([
          reportLine("2026-08-31", "11|A|S", 9, "WP002", 1, 6_000),
          reportLine("2026-08-30", "13|C|S", 10, "BSPPAR", 2, 8_000),
        ]),
        fetchRelatorioMargem: vi.fn().mockResolvedValue([
          { codProduto: "WP002", qty: 3, custoFranquias: 10, custoTotal: 30, totalVenda: 180 },
          { codProduto: "BSPPAR", qty: 5, custoFranquias: 5, custoTotal: 25, totalVenda: 200 },
        ]),
        fetchConsultaDetMov: vi.fn().mockResolvedValue([
          { productId: 10, revenueCents: 4_000, qty: 1, descProduto: "BODY SPLASH - WEPINK" },
        ]),
        now: () => new Date("2026-09-10T15:00:00.000Z"),
        ...overrides,
      });
    const monthJob = () =>
      baseJob({ kind: "CLOSE", payload: { from: "2026-08-31", to: "2026-08-31", fillUntil: "2026-08-30" } });

    it("Lista, cupom e margem 1× no mês; dias gravados do mais recente; CMV = itens × custo do mês", async () => {
      const deps = monthDeps();
      const result = await runSyncJob(monthJob(), deps);
      expect(result.ok).toBe(true);

      expect(deps.fetchCouponReport).toHaveBeenCalledTimes(1);
      expect(deps.fetchCouponReport).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-08-30", to: "2026-08-31", geradorId: 126 }),
      );
      expect(deps.fetchRelatorioMargem).toHaveBeenCalledTimes(1);
      expect(deps.fetchRelatorioMargem).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-08-30", to: "2026-08-31" }),
      );
      const listaDays = (deps.fetchSalesLista as ReturnType<typeof vi.fn>).mock.calls.map((c) => `${c[0].from}→${c[0].to}`);
      expect(listaDays).toEqual(["2026-08-30→2026-08-31"]);
      expect(deps.fetchConsultaDetMov).toHaveBeenCalledTimes(1);
      const allDays = (deps.upsertDayAggs as ReturnType<typeof vi.fn>).mock.calls
        .flatMap((c) => c[0] as Array<{ day: string; brand: string; salesCount: number }>)
        .filter((d) => d.brand === "ALL");
      expect(allDays.find((d) => d.day === "2026-08-31")?.salesCount).toBe(2);
      expect(allDays.find((d) => d.day === "2026-08-30")?.salesCount).toBe(1);

      // 31: WP002 1 x R$ 10 + BSPPAR (cupom sem vendedora, pelo detalhe) 1 x R$ 5; 30: BSPPAR 2 x R$ 5.
      const cmv = (deps.patchDayCmv as ReturnType<typeof vi.fn>).mock.calls.flatMap((c) => c[0]);
      expect(cmv).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ day: "2026-08-31", cmvCents: 1_500 }),
          expect.objectContaining({ day: "2026-08-30", cmvCents: 1_000 }),
        ]),
      );
      const brandDays = (deps.upsertDayAggs as ReturnType<typeof vi.fn>).mock.calls
        .flatMap((c) => c[0] as Array<{ day: string; brand: string; revenueCents: number }>)
        .filter((d) => d.day === "2026-08-31" && d.brand !== "ALL");
      expect(brandDays.find((d) => d.brand === "WPINK")?.revenueCents).toBe(6_000);
      expect(brandDays.find((d) => d.brand === "WEPINK")?.revenueCents).toBe(4_000);

      // Chegou no limite da carga  ->  nao encadeia.
      expect(deps.enqueueMonthFillDay).not.toHaveBeenCalled();
    });

    it("carga em período grava os itens por pessoa de cada dia", async () => {
      const replaceSellerProductDayAggs = vi.fn().mockResolvedValue(undefined);
      const result = await runSyncJob(monthJob(), monthDeps({ replaceSellerProductDayAggs }));
      expect(result.ok).toBe(true);
      const rows = replaceSellerProductDayAggs.mock.calls.flatMap((c) => c[0].rows);
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ day: "2026-08-31", productCode: "WP002", itemCount: 1 }),
          expect.objectContaining({ day: "2026-08-30", productCode: "BSPPAR", itemCount: 2 }),
        ]),
      );
      expect(rows).toHaveLength(2);
    });

    it("grava no job cada dia concluído (barra de progresso da tela)", async () => {
      const markJobProgress = vi.fn().mockResolvedValue(undefined);
      const deps = monthDeps({ markJobProgress });
      const result = await runSyncJob(monthJob(), deps);
      expect(result.ok).toBe(true);
      expect(markJobProgress.mock.calls.map((c) => c[0].day)).toEqual(["2026-08-31", "2026-08-30"]);
    });

    it("Atualizar na fila: para entre um dia e outro e encadeia o dia seguinte da carga", async () => {
      const deps = monthDeps({ hasPriorityJobQueued: vi.fn().mockResolvedValue(true) });
      const result = await runSyncJob(monthJob(), deps);
      expect(result.ok).toBe(true);
      const upserted = (deps.upsertDayAggs as ReturnType<typeof vi.fn>).mock.calls.flatMap(
        (c) => c[0] as Array<{ day: string }>,
      );
      expect(upserted.some((d) => d.day === "2026-08-30")).toBe(false);
      expect(deps.enqueueMonthFillDay).toHaveBeenCalledWith(
        expect.objectContaining({ day: "2026-08-30", fillUntil: "2026-08-30" }),
      );
    });

    it("histórico antigo (deep): grava o mês e não encadeia (o agendador da madrugada enfileira o próximo)", async () => {
      const deps = monthDeps({ hasPriorityJobQueued: vi.fn().mockResolvedValue(true) });
      const job = baseJob({
        kind: "CLOSE",
        payload: { from: "2026-08-31", to: "2026-08-31", fillUntil: "2026-08-30", deep: true },
      });
      const result = await runSyncJob(job, deps);
      expect(result.ok).toBe(true);
      expect(deps.enqueueMonthFillDay).not.toHaveBeenCalled();
    });

    it("relatório de cupom do mês falhou → volta ao dia a dia", async () => {
      const deps = monthDeps({ fetchCouponReport: vi.fn().mockRejectedValue(new Error("timeout")) });
      const result = await runSyncJob(monthJob(), deps);
      expect(result.ok).toBe(true);
      // Margem: 1x no mes (custo) + 1 por dia (sem relatorio nao da para montar a margem do dia).
      const margemRanges = (deps.fetchRelatorioMargem as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => `${c[0].from}→${c[0].to}`,
      );
      expect(margemRanges).toEqual(expect.arrayContaining(["2026-08-31→2026-08-31", "2026-08-30→2026-08-30"]));
    });

    it("Lista do mês falhou → Lista dia a dia", async () => {
      const fetchSalesLista = vi.fn().mockImplementation(async (p: { from: string; to: string }) => {
        if (p.from !== p.to) throw new Error("Requisição cancelada.");
        return listaRows(p);
      });
      const deps = monthDeps({ fetchSalesLista });
      const result = await runSyncJob(monthJob(), deps);
      expect(result.ok).toBe(true);
      expect(fetchSalesLista.mock.calls.map((c) => `${c[0].from}→${c[0].to}`)).toEqual([
        "2026-08-30→2026-08-31",
        "2026-08-31→2026-08-31",
        "2026-08-30→2026-08-30",
      ]);
    });

    it("mês atual: dias já fechados também vão em período (dia 1 → dia pedido)", async () => {
      const deps = makeDeps({
        listStores: vi.fn().mockResolvedValue([stores[0]]),
        now: () => new Date("2026-09-10T15:00:00.000Z"),
      });
      await runSyncJob(
        baseJob({ kind: "CLOSE", payload: { from: "2026-09-05", to: "2026-09-05", fillUntil: "2026-09-01" } }),
        deps,
      );
      expect(deps.fetchCouponReport).toHaveBeenCalledTimes(1);
      expect(deps.fetchCouponReport).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-09-01", to: "2026-09-05" }));
    });

    it("fechamento noturno (sem fillUntil) segue dia a dia", async () => {
      const deps = makeDeps({
        listStores: vi.fn().mockResolvedValue([stores[0]]),
        now: () => new Date("2026-09-10T15:00:00.000Z"),
      });
      await runSyncJob(baseJob({ kind: "CLOSE", payload: { from: "2026-09-09", to: "2026-09-09" } }), deps);
      expect(deps.fetchCouponReport).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-09-09", to: "2026-09-09" }));
    });
  });

  it("CLOSE: dia de cada loja, relatórios da loja em paralelo", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const events: string[] = [];
    const track = async <T,>(tag: string, value: T): Promise<T> => {
      events.push(`start:${tag}`);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      events.push(`end:${tag}`);
      return value;
    };
    const deps = makeDeps({
      fetchSalesLista: vi.fn().mockImplementation((p: { storeId: string; from: string }) =>
        track(`lista:${p.storeId}:${p.from}`, []),
      ),
      fetchRelatorioMargem: vi.fn().mockImplementation((p: { millenniumStoreId: number }) =>
        track(`margem:${p.millenniumStoreId}`, []),
      ),
      fetchCouponReport: vi.fn().mockImplementation((p: { geradorId: number }) => track(`cupom:${p.geradorId}`, [])),
      now: () => new Date("2026-09-04T07:00:00.000Z"),
    });
    const result = await runSyncJob(
      baseJob({ kind: "CLOSE", payload: { from: "2026-09-01", to: "2026-09-03" } }),
      deps,
    );
    expect(result.ok).toBe(true);
    expect(maxInFlight).toBe(2);
    const listaOrder = events.filter((e) => e.startsWith("start:lista:")).map((e) => e.slice("start:lista:".length));
    expect(listaOrder).toEqual([
      "s1:2026-09-01",
      "s2:2026-09-01",
      "s1:2026-09-02",
      "s2:2026-09-02",
      "s1:2026-09-03",
      "s2:2026-09-03",
    ]);
    // Dia sem venda grava R$ 0 (tela de sincronizacao conta o dia).
    const zeroDays = (deps.upsertDayAggs as ReturnType<typeof vi.fn>).mock.calls
      .flatMap((c) => c[0] as Array<{ storeId: string; day: string; revenueCents: number }>)
      .filter((d) => d.storeId === "s1" && d.revenueCents === 0)
      .map((d) => d.day);
    expect(new Set(zeroDays)).toEqual(new Set(["2026-09-01", "2026-09-02", "2026-09-03"]));
  });

  it("FORCE (Atualizar): relatórios da loja em paralelo, loja seguinte só depois", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const events: string[] = [];
    const track = async <T,>(tag: string, value: T): Promise<T> => {
      events.push(`start:${tag}`);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      events.push(`end:${tag}`);
      return value;
    };
    const deps = makeDeps({
      fetchSalesLista: vi.fn().mockImplementation((p: { storeId: string }) => track(`lista:${p.storeId}`, [])),
      fetchRelatorioMargem: vi.fn().mockImplementation((p: { millenniumStoreId: number }) =>
        track(`margem:${p.millenniumStoreId}`, []),
      ),
      fetchCouponReport: vi.fn().mockImplementation((p: { geradorId: number }) => track(`cupom:${p.geradorId}`, [])),
    });
    const result = await runSyncJob(baseJob({ kind: "FORCE" }), deps);
    expect(result.ok).toBe(true);
    expect(maxInFlight).toBe(2);
    const lastS1 = Math.max(
      ...["lista:s1", "margem:1", "cupom:126"].map((t) => events.indexOf(`end:${t}`)),
    );
    expect(events.indexOf("start:lista:s2")).toBeGreaterThan(lastS1);
  });

  it("FORCE: detalhe do movimento só dos cupons fora do cache; totais somam cache + novos", async () => {
    const at = new Date("2026-09-19T13:00:00.000Z");
    const listaRow = (op: number, nf: string) => ({
      storeId: "s1",
      occurredAt: at,
      operationCode: String(op),
      revenueCents: 10_000,
      itemQty: 2,
      brand: "ALL" as const,
      millenniumFilial: 1,
      millenniumOpCode: op,
      nf,
      tipoOperacao: "S",
    });
    const fetchConsultaDetMov = vi.fn().mockResolvedValue([
      { productId: 9, revenueCents: 3_000, qty: 2, descProduto: "WP002 TESTE" },
    ]);
    const upsertCouponBrands = vi.fn().mockResolvedValue(undefined);
    const upsertHourAggs = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      listStores: vi.fn().mockResolvedValue([stores[0]]),
      fetchSalesLista: vi.fn().mockResolvedValue([listaRow(11, "A"), listaRow(12, "B")]),
      fetchRelatorioMargem: vi.fn().mockResolvedValue([
        { codProduto: "WP002", qty: 1, custoFranquias: 10, custoTotal: 10, totalVenda: 80 },
      ]),
      listCouponBrands: vi.fn().mockResolvedValue([
        {
          couponKey: "11|A|S",
          day: "2026-09-19",
          occurredAt: at,
          wepinkCents: 0,
          wepinkItems: 0,
          wpinkCents: 5_000,
          wpinkItems: 1,
          items: [{ productId: 8, revenueCents: 5_000, qty: 1, descProduto: "WP001 TESTE" }],
        },
      ]),
      fetchConsultaDetMov,
      upsertCouponBrands,
      upsertHourAggs,
    });
    const result = await runSyncJob(baseJob({ kind: "FORCE" }), deps);
    expect(result.ok).toBe(true);
    expect(fetchConsultaDetMov).toHaveBeenCalledTimes(1);
    expect(fetchConsultaDetMov.mock.calls[0][0]).toMatchObject({ codOperacao: 12, nf: "B" });
    expect(upsertCouponBrands.mock.calls[0][0].rows).toEqual([
      expect.objectContaining({ couponKey: "12|B|S", day: "2026-09-19", wpinkCents: 3_000, wpinkItems: 2 }),
    ]);
    const wpinkHourRevenue = upsertHourAggs.mock.calls
      .flatMap((c) => c[0] as Array<{ brand: string; revenueCents: number }>)
      .filter((h) => h.brand === "WPINK")
      .reduce((s, h) => s + h.revenueCents, 0);
    expect(wpinkHourRevenue).toBe(8_000);
  });

  it("FORCE: relatório de cupom dá marca, vendedora (gerador) e top produtos; DetMov só do cupom sem vendedora", async () => {
    const at = new Date("2026-09-19T13:00:00.000Z");
    const listaRow = (op: number, nf: string, sellerName: string) => ({
      storeId: "s1",
      occurredAt: at,
      operationCode: String(op),
      revenueCents: 10_000,
      itemQty: 2,
      brand: "ALL" as const,
      sellerName,
      millenniumFilial: 1,
      millenniumOpCode: op,
      nf,
      tipoOperacao: "S",
    });
    const item = (productCode: string, revenueCents: number) => ({
      couponKey: "11|A|S",
      day: "2026-09-19",
      productId: productCode === "WP002" ? 9 : 10,
      productCode,
      productName: productCode,
      qty: 1,
      revenueCents,
      sellerGeradorId: 66161,
      sellerName: "GABRIELA SILVA",
    });
    const fetchConsultaDetMov = vi.fn().mockResolvedValue([
      { productId: 10, revenueCents: 10_000, qty: 2, descProduto: "BODY SPLASH - WEPINK" },
    ]);
    const replaceSellerDayAggs = vi.fn().mockResolvedValue(undefined);
    const replaceProductDayAggs = vi.fn().mockResolvedValue(undefined);
    const upsertHourAggs = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      listStores: vi.fn().mockResolvedValue([stores[0]]),
      fetchSalesLista: vi.fn().mockResolvedValue([listaRow(11, "A", "GABRIELA DE LIMA"), listaRow(12, "B", "")]),
      fetchRelatorioMargem: vi.fn().mockResolvedValue([
        { codProduto: "WP002", qty: 1, custoFranquias: 10, custoTotal: 10, totalVenda: 60 },
      ]),
      fetchCouponReport: vi.fn().mockResolvedValue([item("WP002", 6_000), item("BSPPAR", 4_000)]),
      fetchConsultaDetMov,
      replaceSellerDayAggs,
      replaceProductDayAggs,
      upsertHourAggs,
    });
    const result = await runSyncJob(baseJob({ kind: "FORCE" }), deps);
    expect(result.ok).toBe(true);
    expect(fetchConsultaDetMov).toHaveBeenCalledTimes(1);
    expect(fetchConsultaDetMov.mock.calls[0][0]).toMatchObject({ codOperacao: 12, nf: "B" });
    const hours = upsertHourAggs.mock.calls.flatMap((c) => c[0] as Array<{ brand: string; revenueCents: number }>);
    expect(hours.filter((h) => h.brand === "WPINK").reduce((s, h) => s + h.revenueCents, 0)).toBe(6_000);
    expect(hours.filter((h) => h.brand === "WEPINK").reduce((s, h) => s + h.revenueCents, 0)).toBe(14_000);
    const sellers = replaceSellerDayAggs.mock.calls.flatMap((c) => c[0].rows);
    expect(sellers).toEqual([
      expect.objectContaining({ sellerName: "Gabriela Silva", sellerGeradorId: 66161, revenueCents: 10_000 }),
    ]);
    const products = replaceProductDayAggs.mock.calls.flatMap((c) => c[0].rows);
    expect(products.map((p: { productCode: string }) => p.productCode).sort()).toEqual(["BSPPAR", "WP002"]);
    // Cupom B (sem vendedora) entra no top produtos pelo detalhe, sem chamada extra.
    expect(products.find((p: { productId: number }) => p.productId === 10)).toMatchObject({
      revenueCents: 14_000,
      itemCount: 3,
    });
  });

  describe("itens por pessoa × produto (desafios)", () => {
    const at = new Date("2026-09-19T13:00:00.000Z");
    const listaRow = (op: number, nf: string, sellerName: string) => ({
      storeId: "s1",
      occurredAt: at,
      operationCode: String(op),
      revenueCents: 10_000,
      itemQty: 2,
      brand: "ALL" as const,
      sellerName,
      millenniumFilial: 1,
      millenniumOpCode: op,
      nf,
      tipoOperacao: "S",
    });
    const item = (productCode: string, qty: number, revenueCents: number) => ({
      couponKey: "11|A|S",
      day: "2026-09-19",
      productId: productCode === "WP002" ? 9 : 10,
      productCode,
      productName: productCode,
      qty,
      revenueCents,
      sellerGeradorId: 66161,
      sellerName: "GABRIELA SILVA",
    });
    const forceDeps = (overrides: Partial<SyncJobDeps> = {}) =>
      makeDeps({
        listStores: vi.fn().mockResolvedValue([stores[0]]),
        fetchSalesLista: vi.fn().mockResolvedValue([listaRow(11, "A", "GABRIELA DE LIMA"), listaRow(12, "B", "")]),
        fetchCouponReport: vi.fn().mockResolvedValue([item("WP002", 1, 6_000), item("BSPPAR", 2, 4_000)]),
        fetchConsultaDetMov: vi.fn().mockResolvedValue([
          { productId: 10, revenueCents: 10_000, qty: 2, descProduto: "BODY SPLASH - WEPINK" },
        ]),
        ...overrides,
      });

    it("FORCE grava os itens de cada pessoa do relatório de cupom; venda sem vendedor fica de fora", async () => {
      const replaceSellerProductDayAggs = vi.fn().mockResolvedValue(undefined);
      const result = await runSyncJob(baseJob({ kind: "FORCE" }), forceDeps({ replaceSellerProductDayAggs }));
      expect(result.ok).toBe(true);
      expect(replaceSellerProductDayAggs).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "t1", storeId: "s1", from: "2026-09-19", to: "2026-09-19" }),
      );
      const rows = replaceSellerProductDayAggs.mock.calls.flatMap((c) => c[0].rows);
      expect(rows).toEqual([
        expect.objectContaining({ day: "2026-09-19", sellerGeradorId: 66161, productCode: "BSPPAR", itemCount: 2, revenueCents: 4_000 }),
        expect.objectContaining({ day: "2026-09-19", sellerGeradorId: 66161, productCode: "WP002", itemCount: 1, revenueCents: 6_000 }),
      ]);
    });

    it("falha ao gravar os itens por pessoa não derruba o job (top produtos segue gravado)", async () => {
      const replaceSellerProductDayAggs = vi.fn().mockRejectedValue(new Error("relation does not exist"));
      const replaceProductDayAggs = vi.fn().mockResolvedValue(undefined);
      const insertSyncLogs = vi.fn().mockResolvedValue(undefined);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await runSyncJob(
        baseJob({ kind: "FORCE" }),
        forceDeps({ replaceSellerProductDayAggs, replaceProductDayAggs, insertSyncLogs }),
      );
      warn.mockRestore();
      expect(result.ok).toBe(true);
      expect(replaceSellerProductDayAggs).toHaveBeenCalled();
      expect(replaceProductDayAggs.mock.calls.flatMap((c) => c[0].rows).length).toBeGreaterThan(0);
      const logs = insertSyncLogs.mock.calls.flatMap((c) => c[0] as Array<{ level: string; source: string }>);
      expect(logs).toContainEqual(expect.objectContaining({ level: "WARN", source: "itens_pessoa" }));
    });

    it("sem a dependência (adaptador antigo) não grava e o job segue", async () => {
      const result = await runSyncJob(baseJob({ kind: "FORCE" }), forceDeps());
      expect(result.ok).toBe(true);
    });
  });

  it("FORCE: cupom sem vendedora em loja sem WPINK → detalhe só para o top produtos, gravado no cache com itens", async () => {
    const at = new Date("2026-09-19T13:00:00.000Z");
    const listaRow = (op: number, nf: string) => ({
      storeId: "s1",
      occurredAt: at,
      operationCode: String(op),
      revenueCents: 10_000,
      itemQty: 2,
      brand: "ALL" as const,
      sellerName: "",
      millenniumFilial: 1,
      millenniumOpCode: op,
      nf,
      tipoOperacao: "S",
    });
    const fetchConsultaDetMov = vi.fn().mockResolvedValue([
      { productId: 10, revenueCents: 10_000, qty: 2, descProduto: "BODY SPLASH - WEPINK" },
    ]);
    const upsertCouponBrands = vi.fn().mockResolvedValue(undefined);
    const replaceProductDayAggs = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      listStores: vi.fn().mockResolvedValue([stores[0]]),
      fetchSalesLista: vi.fn().mockResolvedValue([listaRow(12, "B")]),
      fetchRelatorioMargem: vi.fn().mockResolvedValue([
        { codProduto: "BSPPAR", qty: 2, custoFranquias: 10, custoTotal: 20, totalVenda: 100 },
      ]),
      fetchCouponReport: vi.fn().mockResolvedValue([]),
      fetchConsultaDetMov,
      upsertCouponBrands,
      replaceProductDayAggs,
    });
    const result = await runSyncJob(baseJob({ kind: "FORCE" }), deps);
    expect(result.ok).toBe(true);
    expect(fetchConsultaDetMov).toHaveBeenCalledTimes(1);
    expect(upsertCouponBrands.mock.calls.at(-1)![0].rows[0]).toMatchObject({
      couponKey: "12|B|S",
      items: [expect.objectContaining({ productId: 10 })],
    });
    const products = replaceProductDayAggs.mock.calls.flatMap((c) => c[0].rows);
    expect(products).toEqual([expect.objectContaining({ productId: 10, revenueCents: 10_000, itemCount: 2 })]);
  });

  it("mapa de produtos: fora do SEED/FORCE (marca pela margem WP* + descrição no DetMov)", () => {
    expect(shouldBuildProductBrandMap("SEED", stores, false)).toBe(false);
    expect(shouldBuildProductBrandMap("FORCE", stores, false)).toBe(false);
    expect(shouldBuildProductBrandMap("HISTORY", stores, false)).toBe(true);
  });

  it("gerador salvo na loja → não consulta o lookup filial → gerador", async () => {
    const deps = makeDeps({
      listStores: vi.fn().mockResolvedValue(stores.map((s, i) => ({ ...s, geradorId: [126, 41562][i] }))),
    });
    await runSyncJob(baseJob({ kind: "FORCE" }), deps);
    expect(deps.fetchFilialGeradorMap).not.toHaveBeenCalled();
  });

  it("loja sem gerador salvo → consulta o lookup e grava na loja", async () => {
    const setStoresGerador = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ setStoresGerador });
    await runSyncJob(baseJob({ kind: "FORCE" }), deps);
    expect(deps.fetchFilialGeradorMap).toHaveBeenCalledTimes(1);
    expect(setStoresGerador).toHaveBeenCalledWith([
      { storeId: stores[0]!.id, geradorId: 126 },
      { storeId: stores[1]!.id, geradorId: 41562 },
    ]);
  });

  it("HISTORY: mês que falha é fatiado na hora (não repete a consulta do mês)", async () => {
    const windows: Array<{ from: string; to: string }> = [];
    const deps = makeDeps({
      listStores: vi.fn().mockResolvedValue([stores[0]]),
      earliestSalesDay: vi.fn().mockResolvedValue("2026-08-01"),
      fetchSalesLista: vi.fn().mockImplementation(async (p: { from: string; to: string }) => {
        windows.push({ from: p.from, to: p.to });
        if (p.from !== p.to && p.to === "2026-07-31") throw new Error("Requisição cancelada.");
        return [];
      }),
      now: () => new Date("2026-09-19T15:00:00.000Z"),
    });
    const result = await runSyncJob(baseJob({ kind: "HISTORY" }), deps);
    expect(result.ok).toBe(true);
    expect(windows[0]).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(windows[1]).toEqual({ from: "2026-07-01", to: "2026-07-15" });
  });

  it("HISTORY fetches previous calendar month", async () => {
    const windows: Array<{ from: string; to: string }> = [];
    const deps = makeDeps({
      earliestSalesDay: vi.fn().mockResolvedValue("2026-08-01"),
      fetchSalesLista: vi.fn().mockImplementation(async (p: { from: string; to: string }) => {
        windows.push({ from: p.from, to: p.to });
        return [
          {
            storeId: "s1",
            occurredAt: new Date(`${p.from}T15:00:00.000Z`),
            operationCode: "op1",
            revenueCents: 100,
            itemCount: 1,
            brand: "ALL" as const,
          },
        ];
      }),
      now: () => new Date("2026-09-19T15:00:00.000Z"),
    });
    const result = await runSyncJob(baseJob({ kind: "HISTORY" }), deps);
    expect(result.ok).toBe(true);
    expect(windows.some((w) => w.from === "2026-07-01" && w.to === "2026-07-31")).toBe(true);
  });

  it("FORCE fetches only today (ignores payload range)", async () => {
    const windows: Array<{ from: string; to: string }> = [];
    const deps = makeDeps({
      listExistingDays: vi.fn().mockResolvedValue(["2026-09-01", "2026-09-02"]),
      listDaysPaymentComplete: vi.fn().mockResolvedValue(["2026-09-01", "2026-09-02"]),
      fetchSalesLista: vi.fn().mockImplementation(async (p: { from: string; to: string }) => {
        windows.push({ from: p.from, to: p.to });
        return [];
      }),
      now: () => new Date("2026-09-19T15:00:00.000Z"),
    });
    const result = await runSyncJob(
      baseJob({ kind: "FORCE", payload: { from: "2026-09-01", to: "2026-09-05" } }),
      deps,
    );
    expect(result.ok).toBe(true);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.every((w) => w.from === "2026-09-19" && w.to === "2026-09-19")).toBe(true);
    expect(deps.updateCredential).toHaveBeenCalledWith(
      expect.objectContaining({ lastLightSyncAt: expect.any(Date) }),
    );
  });

  it("CLOSE fetches each payload day with the clock at that day's end, without touching the watermark", async () => {
    const windows: Array<{ from: string; to: string }> = [];
    const deps = makeDeps({
      fetchSalesLista: vi.fn().mockImplementation(async (p: { from: string; to: string }) => {
        windows.push({ from: p.from, to: p.to });
        return [];
      }),
      now: () => new Date("2026-09-24T07:00:00.000Z"),
    });
    const result = await runSyncJob(
      baseJob({ kind: "CLOSE", payload: { from: "2026-09-22", to: "2026-09-23" } }),
      deps,
    );
    expect(result).toEqual({ ok: true, storesDone: 2 });
    expect(windows).toEqual([
      { from: "2026-09-22", to: "2026-09-22" },
      { from: "2026-09-22", to: "2026-09-22" },
      { from: "2026-09-23", to: "2026-09-23" },
      { from: "2026-09-23", to: "2026-09-23" },
    ]);
    expect(deps.markJobRunning).toHaveBeenCalledTimes(1);
    expect(deps.markJobFinished).toHaveBeenCalledTimes(1);
    expect(deps.markJobFinished).toHaveBeenCalledWith({ jobId: "job-1", status: "SUCCEEDED" });
    expect(deps.insertSyncRun).toHaveBeenCalledWith(expect.objectContaining({ kind: "CLOSE", ok: true }));
    for (const [arg] of (deps.updateCredential as ReturnType<typeof vi.fn>).mock.calls) {
      expect(arg).not.toHaveProperty("lastLightSyncAt");
    }
  });

  it("CLOSE fails the job when a day fails", async () => {
    const deps = makeDeps({
      login: vi.fn().mockResolvedValue({ ok: false as const, reason: "password" as const, raw: "senha" }),
      now: () => new Date("2026-09-24T07:00:00.000Z"),
    });
    const result = await runSyncJob(
      baseJob({ kind: "CLOSE", payload: { from: "2026-09-23", to: "2026-09-23" } }),
      deps,
    );
    expect(result.ok).toBe(false);
    expect(deps.markJobFinished).toHaveBeenCalledTimes(1);
    expect(deps.markJobFinished).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED" }));
    expect(deps.updateCredential).toHaveBeenCalledWith(expect.objectContaining({ status: "INVALID" }));
  });

  it("FORCE does not backfill payment holes outside today", async () => {
    const windows: Array<{ from: string; to: string }> = [];
    const deps = makeDeps({
      listExistingDays: vi.fn().mockResolvedValue(["2026-09-01", "2026-09-02", "2026-09-03"]),
      listDaysPaymentComplete: vi.fn().mockResolvedValue(["2026-09-02"]),
      fetchSalesLista: vi.fn().mockImplementation(async (p: { from: string; to: string }) => {
        windows.push({ from: p.from, to: p.to });
        return [];
      }),
      now: () => new Date("2026-09-19T15:00:00.000Z"),
    });
    const result = await runSyncJob(
      baseJob({ kind: "FORCE", payload: { from: "2026-09-01", to: "2026-09-03" } }),
      deps,
    );
    expect(result.ok).toBe(true);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.every((w) => w.from === "2026-09-19" && w.to === "2026-09-19")).toBe(true);
  });

  it("FORCE_LIGHT without payload stays today-only (compat)", async () => {
    const windows: Array<{ from: string; to: string }> = [];
    const deps = makeDeps({
      fetchSalesLista: vi.fn().mockImplementation(async (p: { from: string; to: string }) => {
        windows.push({ from: p.from, to: p.to });
        return [];
      }),
      now: () => new Date("2026-09-19T15:00:00.000Z"),
    });
    const result = await runSyncJob(baseJob({ kind: "FORCE_LIGHT" }), deps);
    expect(result.ok).toBe(true);
    expect(windows[0]).toEqual({ from: "2026-09-19", to: "2026-09-19" });
  });
});

describe("storeFetchConcurrency", () => {
  it("defaults to all stores when STORE_CONCURRENCY unset", () => {
    const prev = process.env.STORE_CONCURRENCY;
    delete process.env.STORE_CONCURRENCY;
    expect(storeFetchConcurrency(3)).toBe(3);
    expect(storeFetchConcurrency(1)).toBe(1);
    if (prev === undefined) delete process.env.STORE_CONCURRENCY;
    else process.env.STORE_CONCURRENCY = prev;
  });

  it("honors positive STORE_CONCURRENCY capped by store count", () => {
    const prev = process.env.STORE_CONCURRENCY;
    process.env.STORE_CONCURRENCY = "2";
    expect(storeFetchConcurrency(3)).toBe(2);
    expect(storeFetchConcurrency(1)).toBe(1);
    if (prev === undefined) delete process.env.STORE_CONCURRENCY;
    else process.env.STORE_CONCURRENCY = prev;
  });

  it("treats 0 / invalid as all stores", () => {
    const prev = process.env.STORE_CONCURRENCY;
    process.env.STORE_CONCURRENCY = "0";
    expect(storeFetchConcurrency(3)).toBe(3);
    process.env.STORE_CONCURRENCY = "abc";
    expect(storeFetchConcurrency(2)).toBe(2);
    if (prev === undefined) delete process.env.STORE_CONCURRENCY;
    else process.env.STORE_CONCURRENCY = prev;
  });
});

describe("isContentionError", () => {
  it("detects busy / timeout / rate limit", () => {
    expect(isContentionError("Millennium busy")).toBe(true);
    expect(isContentionError("ETIMEDOUT")).toBe(true);
    expect(isContentionError("429 Too Many Requests")).toBe(true);
    expect(isContentionError("invalid password")).toBe(false);
  });
});

describe("Atualizar (manual e automático)", () => {
  const listaDays = (fetchSalesLista: ReturnType<typeof vi.fn>) =>
    fetchSalesLista.mock.calls.map((c) => String((c[0] as { from: string }).from));

  it("fecha antes os dias pendentes (do mais antigo) e depois atualiza hoje", async () => {
    const fetchSalesLista = vi.fn().mockResolvedValue([]);
    const markStoresClosed = vi.fn().mockResolvedValue(undefined);
    const markStoresSynced = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      listStores: vi.fn().mockResolvedValue([{ ...stores[0], lastClosedDay: "2026-09-16" }]),
      fetchSalesLista,
      markStoresClosed,
      markStoresSynced,
    });
    const result = await runSyncJob(baseJob({ kind: "FORCE" }), deps);
    expect(result.ok).toBe(true);
    expect(listaDays(fetchSalesLista)).toEqual(["2026-09-17", "2026-09-18", "2026-09-19"]);
    expect(markStoresClosed.mock.calls.map((c) => c[0])).toEqual([
      [{ storeId: "s1", day: "2026-09-17" }],
      [{ storeId: "s1", day: "2026-09-18" }],
    ]);
    expect(markStoresSynced).toHaveBeenCalledWith(["s1"], expect.any(Date));
    expect(deps.markJobFinished).toHaveBeenCalledTimes(1);
    expect(deps.markJobFinished).toHaveBeenCalledWith({ jobId: "job-1", status: "SUCCEEDED" });
  });

  it("listaFingerprint: ignora a ordem; muda com venda cancelada, valor ou vendedora", () => {
    const r = (op: string, cents: number, sellerName = "ANA") => ({
      operationCode: op,
      occurredAt: new Date("2026-09-19T14:30:00.000Z"),
      revenueCents: cents,
      itemQty: 1,
      storeId: "s1",
      sellerName,
    });
    const base = listaFingerprint("2026-09-19", [r("1", 100), r("2", 50)]);
    expect(listaFingerprint("2026-09-19", [r("2", 50), r("1", 100)])).toBe(base);
    expect(base.startsWith("2026-09-19:2:")).toBe(true);
    expect(listaFingerprint("2026-09-19", [r("1", 100)])).not.toBe(base);
    expect(listaFingerprint("2026-09-19", [r("1", 100), r("2", 60)])).not.toBe(base);
    expect(listaFingerprint("2026-09-19", [r("1", 100), r("2", 50, "BIA")])).not.toBe(base);
  });

  it("Lista igual à da última rodada completa pula cupom e margem; venda nova volta a rodar tudo", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-19T15:00:00.000Z"), toFake: ["Date"] });
    try {
      const sale = (op: string, cents: number) => ({
        operationCode: op,
        occurredAt: new Date("2026-09-19T14:30:00.000Z"),
        revenueCents: cents,
        itemQty: 1,
        storeId: "s1",
        millenniumOpCode: Number(op),
        nf: op,
        tipoOperacao: "S",
      });
      let lista = [sale("1", 100_00)];
      const fetchSalesLista = vi.fn().mockImplementation(async () => lista);
      const fetchCouponReport = vi.fn().mockResolvedValue([]);
      const fetchRelatorioMargem = vi.fn().mockResolvedValue([]);
      const deps = makeDeps({
        listStores: vi.fn().mockResolvedValue([{ ...stores[0], lastClosedDay: "2026-09-18" }]),
        fetchSalesLista,
        fetchCouponReport,
        fetchRelatorioMargem,
        listaMemo: createListaMemo(),
        now: () => new Date(),
      });
      const run = () => runSyncJob(baseJob({ kind: "FORCE" }), deps);

      expect((await run()).ok).toBe(true);
      const coupon1 = fetchCouponReport.mock.calls.length;
      const margem1 = fetchRelatorioMargem.mock.calls.length;
      expect(coupon1).toBe(1);
      expect(margem1).toBeGreaterThan(0);

      expect((await run()).ok).toBe(true);
      expect(fetchSalesLista).toHaveBeenCalledTimes(2);
      expect(fetchCouponReport).toHaveBeenCalledTimes(coupon1);
      expect(fetchRelatorioMargem).toHaveBeenCalledTimes(margem1);

      lista = [...lista, sale("2", 50_00)];
      expect((await run()).ok).toBe(true);
      expect(fetchCouponReport).toHaveBeenCalledTimes(coupon1 + 1);
      expect(fetchRelatorioMargem.mock.calls.length).toBeGreaterThan(margem1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rodada automática sem venda nova marca noSalesChange (sino ignora); venda nova não marca", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-19T15:00:00.000Z"), toFake: ["Date"] });
    try {
      const sale = (op: string, cents: number) => ({
        operationCode: op,
        occurredAt: new Date("2026-09-19T14:30:00.000Z"),
        revenueCents: cents,
        itemQty: 1,
        storeId: "s1",
        millenniumOpCode: Number(op),
        nf: op,
        tipoOperacao: "S",
      });
      let lista = [sale("1", 100_00)];
      const markJobFinished = vi.fn().mockResolvedValue(undefined);
      const deps = makeDeps({
        listStores: vi.fn().mockResolvedValue([{ ...stores[0], lastClosedDay: "2026-09-18" }]),
        fetchSalesLista: vi.fn().mockImplementation(async () => lista),
        fetchCouponReport: vi.fn().mockResolvedValue([]),
        fetchRelatorioMargem: vi.fn().mockResolvedValue([]),
        listaMemo: createListaMemo(),
        markJobFinished,
        now: () => new Date(),
      });
      const run = () => runSyncJob(baseJob({ kind: "FORCE", payload: { auto: true, relogin: true } }), deps);
      const lastFinish = () => markJobFinished.mock.calls.at(-1)![0];

      expect((await run()).ok).toBe(true);
      expect(lastFinish().noSalesChange).toBeUndefined();

      expect((await run()).ok).toBe(true);
      expect(lastFinish()).toMatchObject({ status: "SUCCEEDED", noSalesChange: true });

      lista = [...lista, sale("2", 50_00)];
      expect((await run()).ok).toBe(true);
      expect(lastFinish().noSalesChange).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rodada que fecha o dia (pedido explícito) é sempre completa, mesmo com a Lista igual", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-20T02:40:00.000Z"), toFake: ["Date"] });
    try {
      const fetchCouponReport = vi.fn().mockResolvedValue([]);
      const deps = makeDeps({
        listStores: vi.fn().mockResolvedValue([{ ...stores[0], lastClosedDay: "2026-09-18" }]),
        fetchSalesLista: vi.fn().mockResolvedValue([]),
        fetchCouponReport,
        listaMemo: createListaMemo(),
        now: () => new Date(),
      });
      deps.listaMemo!.set("s1", "2026-09-19:0:x");
      const job = baseJob({ kind: "FORCE", payload: { closeStoreIds: ["s1"] } });
      await runSyncJob(job, deps);
      await runSyncJob(job, deps);
      expect(fetchCouponReport).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hoje não fecha pelo horário; só com pedido explícito", async () => {
    const markStoresClosed = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      listStores: vi.fn().mockResolvedValue([stores[0]]),
      markStoresClosed,
      // 22:40 em Campo Grande.
      now: () => new Date("2026-09-20T02:40:00.000Z"),
    });
    expect((await runSyncJob(baseJob({ kind: "FORCE" }), deps)).ok).toBe(true);
    expect(markStoresClosed).not.toHaveBeenCalled();
    const closeJob = baseJob({ kind: "FORCE", payload: { closeStoreIds: ["s1"] } });
    expect((await runSyncJob(closeJob, deps)).ok).toBe(true);
    expect(markStoresClosed).toHaveBeenCalledWith([{ storeId: "s1", day: "2026-09-19" }]);
  });

  it("automático sem sessão salva pula em silêncio (a próxima rodada faz login)", async () => {
    const insertSyncLogs = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ insertSyncLogs });
    const result = await runSyncJob(baseJob({ kind: "FORCE", payload: { auto: true } }), deps);
    expect(result.ok).toBe(false);
    expect(deps.calls.login).toBe(0);
    expect(deps.fetchSalesLista).not.toHaveBeenCalled();
    const finished = (deps.markJobFinished as ReturnType<typeof vi.fn>).mock.calls[0][0] as { error: string };
    expect(finished.error.startsWith("[auto-sessao]")).toBe(true);
    expect(insertSyncLogs).not.toHaveBeenCalled();
  });

  it("automático com relogin faz login com a senha salva", async () => {
    const deps = makeDeps({ listStores: vi.fn().mockResolvedValue([stores[0]]) });
    const result = await runSyncJob(baseJob({ kind: "FORCE", payload: { auto: true, relogin: true } }), deps);
    expect(result.ok).toBe(true);
    expect(deps.calls.login).toBe(1);
  });

  it("automático: ERP fora do ar não grava Logs nem last_error", async () => {
    const insertSyncLogs = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      listStores: vi.fn().mockResolvedValue([stores[0]]),
      getStoredSession: vi.fn().mockResolvedValue("sess-salva"),
      fetchSalesLista: vi.fn().mockRejectedValue(new Error("fetch failed")),
      insertSyncLogs,
    });
    const result = await runSyncJob(baseJob({ kind: "FORCE", payload: { auto: true } }), deps);
    expect(result.ok).toBe(false);
    expect(insertSyncLogs).not.toHaveBeenCalled();
    const lastErrorCalls = (deps.updateCredential as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[0] as { lastError?: string }).lastError != null,
    );
    expect(lastErrorCalls).toEqual([]);
  });
});
