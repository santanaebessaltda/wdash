import { describe, expect, it } from "vitest";
import {
  excludeNonSalesPeople,
  fetchMonthFill,
  fetchSalesDayAggs,
  fetchSalesHourAggs,
  fetchSyncWatermark,
  monthFillProgress,
  seedCoverageWindow,
  type SalesQueryClient,
} from "./salesRepo";
import type { SalesDayAgg, SalesHourAgg, SalesSellerDayAgg } from "./salesTypes";

function mockClient(opts: {
  days?: SalesDayAgg[];
  hours?: SalesHourAgg[];
  watermark?: string | null;
}): SalesQueryClient {
  const days = opts.days ?? [];
  const hours = opts.hours ?? [];
  return {
    from(table: string) {
      const state: {
        filters: Record<string, unknown>;
        inFilters: Record<string, string[]>;
      } = { filters: {}, inFilters: {} };

      const builder = {
        select(_cols: string) {
          return builder;
        },
        eq(col: string, val: unknown) {
          state.filters[col] = val;
          return builder;
        },
        gte(col: string, val: unknown) {
          state.filters[`gte:${col}`] = val;
          return builder;
        },
        lte(col: string, val: unknown) {
          state.filters[`lte:${col}`] = val;
          return builder;
        },
        in(col: string, vals: string[]) {
          state.inFilters[col] = vals;
          return builder;
        },
        order() {
          return builder;
        },
        maybeSingle: async () => {
          if (table === "erp_credential") {
            return {
              data: {
                last_light_sync_at: opts.watermark ?? null,
                last_success_at: null,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        then(resolve: (v: { data: unknown; error: null }) => void) {
          if (table === "sales_day_agg") {
            let rows = days.filter((d) => d.tenantId === state.filters.tenant_id);
            if (state.inFilters.store_id) {
              rows = rows.filter((d) => state.inFilters.store_id.includes(d.storeId));
            }
            if (state.filters[`gte:day`]) {
              rows = rows.filter((d) => d.day >= String(state.filters[`gte:day`]));
            }
            if (state.filters[`lte:day`]) {
              rows = rows.filter((d) => d.day <= String(state.filters[`lte:day`]));
            }
            if (state.filters.brand) {
              rows = rows.filter((d) => d.brand === state.filters.brand);
            }
            resolve({
              data: rows.map((d) => ({
                tenant_id: d.tenantId,
                store_id: d.storeId,
                day: d.day,
                brand: d.brand,
                revenue_cents: d.revenueCents,
                sales_count: d.salesCount,
                item_count: d.itemCount,
              })),
              error: null,
            });
            return;
          }
          if (table === "sales_hour_agg") {
            let rows = hours.filter((h) => h.tenantId === state.filters.tenant_id);
            if (state.filters.day) rows = rows.filter((h) => h.day === state.filters.day);
            if (state.inFilters.store_id) {
              rows = rows.filter((h) => state.inFilters.store_id.includes(h.storeId));
            }
            resolve({
              data: rows.map((h) => ({
                tenant_id: h.tenantId,
                store_id: h.storeId,
                day: h.day,
                hour: h.hour,
                brand: h.brand,
                revenue_cents: h.revenueCents,
                sales_count: h.salesCount,
                item_count: h.itemCount,
              })),
              error: null,
            });
            return;
          }
          resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  };
}

describe("carga do mês", () => {
  it("onboarding espera só hoje", () => {
    expect(seedCoverageWindow("2026-09-24")).toEqual({ from: "2026-09-24", to: "2026-09-24", expectedDays: 1 });
  });

  it("conta hoje + dias depois do que está carregando", () => {
    expect(monthFillProgress({ currentDay: "2026-09-23", fillUntil: "2026-09-01" }, "2026-09-24")).toEqual({
      done: 1,
      total: 24,
    });
    expect(monthFillProgress({ currentDay: "2026-09-01", fillUntil: "2026-09-01" }, "2026-09-24")).toEqual({
      done: 23,
      total: 24,
    });
  });

  it("job em período: progresso vem do último dia concluído (progressDay), não do fim do bloco", async () => {
    const jobClient = (payload: Record<string, unknown>) =>
      ({
        from() {
          const b = {
            select: () => b,
            eq: () => b,
            in: () => b,
            not: () => b,
            is: () => b,
            order: () => b,
            limit: () => b,
            maybeSingle: async () => ({ data: { payload }, error: null }),
          };
          return b;
        },
      }) as unknown as SalesQueryClient;

    const block = { from: "2026-08-31", to: "2026-08-31", fillUntil: "2026-08-01" };
    expect(await fetchMonthFill("t1", jobClient(block))).toEqual({ currentDay: "2026-08-31", fillUntil: "2026-08-01" });
    const mid = await fetchMonthFill("t1", jobClient({ ...block, progressDay: "2026-08-15" }));
    expect(mid).toEqual({ currentDay: "2026-08-14", fillUntil: "2026-08-01" });
    // 25/09, carga desde 01/08: 56 dias; faltam 01 - 14/08.
    expect(monthFillProgress(mid!, "2026-09-25")).toEqual({ done: 42, total: 56 });
  });
});

describe("salesRepo", () => {
  it("filters day aggs by tenant, store, date range and brand", async () => {
    const client = mockClient({
      days: [
        {
          tenantId: "t1",
          storeId: "s1",
          day: "2026-09-10",
          brand: "ALL",
          revenueCents: 100_00,
          salesCount: 2,
          itemCount: 3,
        },
        {
          tenantId: "t1",
          storeId: "s2",
          day: "2026-09-10",
          brand: "ALL",
          revenueCents: 50_00,
          salesCount: 1,
          itemCount: 1,
        },
        {
          tenantId: "t1",
          storeId: "s1",
          day: "2026-09-20",
          brand: "ALL",
          revenueCents: 200_00,
          salesCount: 4,
          itemCount: 5,
        },
      ],
    });

    const rows = await fetchSalesDayAggs(
      {
        tenantId: "t1",
        storeIds: ["s1"],
        from: "2026-09-01",
        to: "2026-09-15",
        brand: "ALL",
      },
      client,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].storeId).toBe("s1");
    expect(rows[0].revenueCents).toBe(100_00);
  });

  it("returns empty arrays (not mocks) when DB has no rows", async () => {
    const client = mockClient({ days: [], hours: [] });
    const days = await fetchSalesDayAggs(
      { tenantId: "t1", storeIds: [], from: "2026-09-01", to: "2026-09-30" },
      client,
    );
    const hours = await fetchSalesHourAggs(
      { tenantId: "t1", storeIds: [], day: "2026-09-19" },
      client,
    );
    expect(days).toEqual([]);
    expect(hours).toEqual([]);
  });

  it("reads watermark last_light_sync_at or null", async () => {
    const withTs = mockClient({ watermark: "2026-09-19T12:00:00.000Z" });
    const empty = mockClient({ watermark: null });
    await expect(fetchSyncWatermark("t1", withTs)).resolves.toEqual(
      new Date("2026-09-19T12:00:00.000Z"),
    );
    await expect(fetchSyncWatermark("t1", empty)).resolves.toBeNull();
  });
});

describe("excludeNonSalesPeople", () => {
  const row = (over: Partial<SalesSellerDayAgg>): SalesSellerDayAgg => ({
    tenantId: "t1",
    storeId: "s114",
    day: "2026-08-02",
    sellerKey: "X",
    sellerName: "X",
    sellerEmployeeId: null,
    sellerGeradorId: null,
    brand: "ALL",
    revenueCents: 100,
    salesCount: 1,
    ...over,
  });

  it("drops non-sales people by employee id, gerador or store+name; keeps the team", () => {
    const rows = [
      row({ sellerKey: "NORTE.SUL", sellerEmployeeId: 40587 }),
      row({ sellerKey: "NORTE.SUL", sellerGeradorId: 42345 }),
      row({ sellerKey: "NORTE.SUL" }),
      row({ sellerKey: "NORTE.SUL", storeId: "s010" }),
      row({ sellerKey: "DALINNE", sellerEmployeeId: 162457 }),
    ];
    const out = excludeNonSalesPeople(rows, {
      employeeIds: new Set([40587]),
      geradorIds: new Set([42345]),
      storeNameKeys: new Set(["s114|NORTE.SUL"]),
    });
    expect(out.map((r) => `${r.storeId}:${r.sellerKey}`)).toEqual(["s010:NORTE.SUL", "s114:DALINNE"]);
  });

  it("returns rows untouched when everyone is sales", () => {
    const rows = [row({})];
    const empty = { employeeIds: new Set<number>(), geradorIds: new Set<number>(), storeNameKeys: new Set<string>() };
    expect(excludeNonSalesPeople(rows, empty)).toBe(rows);
  });
});
