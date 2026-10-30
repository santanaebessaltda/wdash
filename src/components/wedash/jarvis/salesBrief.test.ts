import { describe, expect, it } from "vitest";
import type { SalesDayAgg } from "@/data/wedash/salesTypes";
import {
  buildSalesBrief,
  formatSalesBrief,
  formatSalesComparison,
  resolveNamedMonth,
  resolveSalesComparison,
  resolveSalesWindow,
} from "./salesBrief";

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

  it("hoje = só o dia (não o mês)", () => {
    const w = resolveSalesWindow("quanto eu vendi hoje", "2026-10-29");
    expect(w.from).toBe("2026-10-29");
    expect(w.to).toBe("2026-10-29");
    expect(w.label).toBe("hoje");
  });

  it("mês passado", () => {
    const w = resolveSalesWindow("vendas do mês passado", "2026-10-29");
    expect(w.from).toBe("2026-09-01");
    expect(w.to).toBe("2026-09-30");
  });

  it("novembro do ano passado", () => {
    const w = resolveSalesWindow("quanto vendi em novembro do ano passado", "2026-10-29");
    expect(w.from).toBe("2025-11-01");
    expect(w.to).toBe("2025-11-30");
    expect(w.label).toMatch(/novembro 2025/i);
  });
});

describe("resolveSalesComparison", () => {
  it("out→nov ano passado com replicar", () => {
    const q =
      "olhar o ano passado quanto eu vendi em Novembro e ver o crescimento ou queda de Outubro pra Novembro e replicar pra cá";
    const cmp = resolveSalesComparison(q, "2026-10-29");
    expect(cmp).not.toBeNull();
    expect(cmp!.base.from).toBe("2025-10-01");
    expect(cmp!.next.from).toBe("2025-11-01");
    expect(cmp!.applyFrom?.from).toBe("2026-10-01");
  });

  it("named month ano passado", () => {
    expect(resolveNamedMonth("novembro do ano passado", "2026-10-29", "novembro")).toEqual({
      year: 2025,
      month: 11,
    });
  });
});

describe("formatSalesComparison", () => {
  it("não mistura rótulos de mês", () => {
    const base = {
      from: "2025-10-01",
      to: "2025-10-31",
      label: "outubro 2025",
      storeLabel: "Loja",
      revenue: 100_000,
      salesCount: 10,
      itemCount: 20,
      ticket: 10_000,
      pa: 2,
      byMonth: [],
    };
    const next = { ...base, from: "2025-11-01", to: "2025-11-30", label: "novembro 2025", revenue: 120_000 };
    const apply = { ...base, from: "2026-10-01", to: "2026-10-31", label: "outubro 2026", revenue: 198_161.49 };
    const text = formatSalesComparison("Loja", base, next, apply);
    expect(text).toMatch(/outubro 2025/);
    expect(text).toMatch(/novembro 2025/);
    expect(text).toMatch(/outubro 2026/);
    expect(text).toMatch(/\+20/);
    expect(text).toMatch(/proje/i);
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
