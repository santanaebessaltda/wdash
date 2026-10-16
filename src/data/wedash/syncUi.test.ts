import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  canForceSyncRefresh,
  FORCE_ALL_KEY,
  forceCooldownForScopeSec,
  forcePendingStorageKey,
  forceRefreshRetryAfterSec,
  formatForceCooldownLabel,
  formatSyncWatermarkLabel,
  lastForceAtFromRetryAfter,
  clearPendingForce,
  clearAllPendingForce,
  readPendingForce,
  writePendingForce,
} from "./syncUi";
import { fetchSalesDayAggs, type SalesQueryClient } from "./salesRepo";

describe("syncUi watermark label (SYNC-10)", () => {
  it("shows pending when never synced", () => {
    expect(formatSyncWatermarkLabel(null)).toBe("Aguardando primeiro sync");
    expect(formatSyncWatermarkLabel(null, { loading: true })).toBe("Sincronizando dados…");
  });

  it("shows clock time of last_light_sync_at (same day)", () => {
    const now = new Date("2026-09-19T12:10:00.000Z");
    const wm = new Date("2026-09-19T10:19:00.000Z");
    expect(formatSyncWatermarkLabel(wm, { now, timeZone: "America/Sao_Paulo" })).toBe("Atualizado às 07:19");
  });

  it("adds the date when the sync was on another day", () => {
    const now = new Date("2026-09-19T12:10:00.000Z");
    const wm = new Date("2026-09-18T21:40:00.000Z");
    expect(formatSyncWatermarkLabel(wm, { now, timeZone: "America/Sao_Paulo" })).toBe(
      "Atualizado em 18/09 às 18:40",
    );
  });
});

describe("force refresh role + rate limit (SYNC-11)", () => {
  const FIVE_MIN = 5 * 60 * 1000;

  it("allows OWNER/MANAGER only", () => {
    expect(canForceSyncRefresh("OWNER")).toBe(true);
    expect(canForceSyncRefresh("MANAGER")).toBe(true);
    expect(canForceSyncRefresh("SELLER")).toBe(false);
    expect(canForceSyncRefresh("ADMIN_GLOBAL")).toBe(false);
  });

  it("rejects second force within 5 minutes (when cooldown on)", () => {
    const last = new Date("2026-09-19T12:00:00.000Z");
    expect(forceRefreshRetryAfterSec(last, new Date("2026-09-19T12:02:00.000Z"), FIVE_MIN)).toBe(180);
    expect(forceRefreshRetryAfterSec(last, new Date("2026-09-19T12:05:00.000Z"), FIVE_MIN)).toBeNull();
    expect(forceRefreshRetryAfterSec(null, new Date(), FIVE_MIN)).toBeNull();
  });

  it("cooldown off (FORCE_COOLDOWN_MS=0) never blocks", () => {
    const last = new Date();
    expect(forceRefreshRetryAfterSec(last, new Date(), 0)).toBeNull();
    expect(forceCooldownForScopeSec({ [FORCE_ALL_KEY]: last.toISOString() }, [], new Date(), 0)).toBeNull();
  });

  it("per-store cooldown: other stores stay free; Todas blocked by any (option A)", () => {
    const now = new Date("2026-09-19T12:02:00.000Z");
    const map = {
      s010: "2026-09-19T12:00:00.000Z",
    };
    expect(forceCooldownForScopeSec(map, ["s010"], now, FIVE_MIN)).toBe(180);
    expect(forceCooldownForScopeSec(map, ["s020"], now, FIVE_MIN)).toBeNull();
    expect(forceCooldownForScopeSec(map, [], now, FIVE_MIN)).toBe(180); // Todas
  });

  it("FORCE Todas (__all__) blocks every store", () => {
    const now = new Date("2026-09-19T12:02:00.000Z");
    const map = { [FORCE_ALL_KEY]: "2026-09-19T12:00:00.000Z" };
    expect(forceCooldownForScopeSec(map, ["s010"], now, FIVE_MIN)).toBe(180);
    expect(forceCooldownForScopeSec(map, [], now, FIVE_MIN)).toBe(180);
  });

  it("formats cooldown mm:ss", () => {
    expect(formatForceCooldownLabel(65)).toBe("1:05");
    expect(formatForceCooldownLabel(9)).toBe("9s");
    expect(formatForceCooldownLabel(300)).toBe("5:00");
  });

  it("hydrates lastForceAt from retryAfterSec", () => {
    const now = new Date("2026-09-19T12:05:00.000Z");
    const last = lastForceAtFromRetryAfter(120, now, FIVE_MIN);
    expect(forceRefreshRetryAfterSec(last, now, FIVE_MIN)).toBe(120);
    expect(now.getTime() - last.getTime()).toBe(FIVE_MIN - 120_000);
  });
});

describe("dashboard read path never hits Millennium (SYNC-05)", () => {
  it("salesRepo reads only Postgres table names, never VENDAS/Millennium URLs", async () => {
    const tables: string[] = [];
    const client: SalesQueryClient = {
      from(table: string) {
        tables.push(table);
        const builder = {
          select() {
            return builder;
          },
          eq() {
            return builder;
          },
          gte() {
            return builder;
          },
          lte() {
            return builder;
          },
          in() {
            return builder;
          },
          order() {
            return builder;
          },
          then(resolve: (v: { data: unknown[]; error: null }) => void) {
            resolve({ data: [], error: null });
          },
        };
        return builder;
      },
    };
    await fetchSalesDayAggs(
      { tenantId: "t1", storeIds: [], from: "2026-09-01", to: "2026-09-30" },
      client,
    );
    expect(tables).toEqual(["sales_day_agg"]);
    expect(tables.join(",")).not.toMatch(/VENDAS|millennium|MILLENNIUM/i);
  });
});

describe("pending FORCE (Atualizando persiste ao fechar PWA)", () => {
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
      key: (i: number) => [...mem.keys()][i] ?? null,
      get length() {
        return mem.size;
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads/writes/clears pending job", () => {
    const key = forcePendingStorageKey("t1");
    const job = {
      jobId: "job-abc",
      storeIds: ["s1"],
      enqueuedAt: "2026-09-23T14:00:00.000Z",
    };
    writePendingForce("t1", job);
    expect(readPendingForce("t1")).toEqual(job);
    clearPendingForce("t1");
    expect(readPendingForce("t1")).toBeNull();
    expect(mem.has(key)).toBe(false);
  });

  it("logout clears every pending refresh", () => {
    writePendingForce("t1", { jobId: "a", storeIds: [], enqueuedAt: "2026-09-23T14:00:00.000Z" });
    writePendingForce("t2", { jobId: "b", storeIds: ["s1"], enqueuedAt: "2026-09-23T14:00:00.000Z" });
    mem.set("wedash.other", "keep");
    clearAllPendingForce();
    expect(readPendingForce("t1")).toBeNull();
    expect(readPendingForce("t2")).toBeNull();
    expect(mem.get("wedash.other")).toBe("keep");
  });
});
