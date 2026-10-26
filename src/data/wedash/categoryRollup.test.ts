import { describe, expect, it } from "vitest";
import { categoryCatalogFromTypes, rollupCategoryDays } from "./categoryRollup";
import type { SalesProductCostDayAgg, SalesProductDayAgg } from "./salesTypes";

const tenant = "t1";
const store = "s1";

function product(partial: Partial<SalesProductDayAgg> & Pick<SalesProductDayAgg, "productId" | "productCode" | "revenueCents">): SalesProductDayAgg {
  return {
    tenantId: tenant,
    storeId: store,
    day: "2026-10-20",
    productName: partial.productCode,
    brand: "ALL",
    itemCount: 1,
    ...partial,
  };
}

function cost(productCode: string, revenueCents: number): SalesProductCostDayAgg {
  return {
    tenantId: tenant,
    storeId: store,
    day: "2026-10-20",
    productCode,
    itemCount: 1,
    revenueCents,
    cmvCents: 0,
  };
}

describe("rollupCategoryDays", () => {
  const types = { 10: 1, 11: 1, 12: 2 };
  const names = { 1: "Perfumaria", 2: "Body" };

  it("sem margem usa o preço do produto e soma os itens do tipo", () => {
    const rows = rollupCategoryDays({
      products: [
        product({ productId: 10, productCode: "A", revenueCents: 1000, itemCount: 2 }),
        product({ productId: 12, productCode: "B", revenueCents: 500, itemCount: 1 }),
      ],
      costs: [],
      typeByProductId: types,
      typeNameById: names,
    });
    const perfumaria = rows.find((r) => r.categoryId === 1);
    expect(perfumaria).toMatchObject({ revenueCents: 1000, itemCount: 2, categoryName: "Perfumaria", brand: "ALL" });
    expect(rows.find((r) => r.categoryId === 2)?.revenueCents).toBe(500);
  });

  it("com margem, só o menor product_id do código leva o TOTALVENDA", () => {
    const rows = rollupCategoryDays({
      products: [
        product({ productId: 11, productCode: "A", revenueCents: 100, itemCount: 1 }),
        product({ productId: 10, productCode: "A", revenueCents: 999, itemCount: 4 }),
      ],
      costs: [cost("A", 4_000)],
      typeByProductId: types,
      typeNameById: names,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ categoryId: 1, revenueCents: 4_000, itemCount: 5 });
  });

  it("produto fora do catálogo cai em INDEFINIDO", () => {
    const rows = rollupCategoryDays({
      products: [product({ productId: 99, productCode: "Z", revenueCents: 300 })],
      costs: [],
      typeByProductId: types,
      typeNameById: names,
    });
    expect(rows[0]).toMatchObject({ categoryId: -2_000_000_000, categoryName: "INDEFINIDO", revenueCents: 300 });
  });
});

describe("categoryCatalogFromTypes", () => {
  it("lista cada tipo do catálogo uma vez, em ordem", () => {
    expect(categoryCatalogFromTypes({ 10: 2, 11: 1, 12: 2 }, { 1: "Perfumaria", 2: "Body" })).toEqual([
      { categoryId: 2, categoryName: "Body", brand: "ALL" },
      { categoryId: 1, categoryName: "Perfumaria", brand: "ALL" },
    ]);
  });
});
