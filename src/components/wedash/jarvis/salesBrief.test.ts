import { describe, expect, it } from "vitest";
import type { SalesDayAgg } from "@/data/wedash/salesTypes";
import { buildSalesBrief, formatSalesBrief, resolveSalesWindow } from "./salesBrief";

const stores = [
  { id: "a", name: "CAMPO GRANDE", tradeName: "Shopping Campo Grande", code: "00010" },
  { id: "b", name: "TRES LAGOAS", tradeName: "Shopping Três Lagoas", code: "00114" },
];

function day(over: Partial<SalesDayAgg> & Pick<SalesDayAgg, "day" | "storeId">): SalesDayAgg {
  return {
    tenantId: "t",
    brand: "ALL",
    revenueCents: 10_000_00,
    salesCount: 40,
    itemCount: 80,
    cmvCents: 0,
    ...over,
  };
}

describe("resolveSalesWindow", () => {
  it("padrão = últimos 3 meses até hoje", () => {
    const w = resolveSalesWindow("como estão as vendas", "2026-10-29");
    expect(w.from).toBe("2026-08-01");
    expect(w.to).toBe("2026-10-29");
  });

  it("este mês", () => {
    const w = resolveSalesWindow("faturamento deste mês", "2026-10-29");
    expect(w.from).toBe("2026-10-01");
    expect(w.to).toBe("2026-10-29");
  });

  it("mês passado", () => {
    const w = resolveSalesWindow("vendas do mês passado", "2026-10-29");
    expect(w.from).toBe("2026-09-01");
    expect(w.to).toBe("2026-09-30");
  });
});

describe("buildSalesBrief", () => {
  it("soma ALL e formata sem inventar", () => {
    const brief = buildSalesBrief(
      [
        day({ day: "2026-10-01", storeId: "a", revenueCents: 200, salesCount: 2, itemCount: 4 }),
        day({ day: "2026-10-01", storeId: "a", brand: "WEPINK", revenueCents: 99_900, salesCount: 9, itemCount: 9 }),
        day({ day: "2026-10-02", storeId: "b", revenueCents: 100, salesCount: 1, itemCount: 1 }),
      ],
      { from: "2026-10-01", to: "2026-10-02", label: "este mês até hoje" },
      stores,
      stores,
    );
    expect(brief.revenue).toBe(3);
    expect(brief.salesCount).toBe(3);
    expect(brief.ticket).toBe(1);
    expect(brief.pa).toBeCloseTo(5 / 3, 5);
    const text = formatSalesBrief(brief);
    expect(text).toMatch(/R\$/);
    expect(text).toMatch(/autoriz/);
  });
});
