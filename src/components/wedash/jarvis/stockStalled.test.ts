import { describe, expect, it } from "vitest";
import { formatStalledBrief, pickStalledProducts } from "./stockStalled";

describe("pickStalledProducts", () => {
  it("marca sem venda e cobertura alta", () => {
    const catalog = new Map([
      ["BS1", { code: "BS1", name: "Cherry" }],
      ["BS2", { code: "BS2", name: "Pink" }],
      ["BS3", { code: "BS3", name: "Fast" }],
    ]);
    const rows = pickStalledProducts({
      storeIds: ["a"],
      catalog,
      stock: [
        { storeId: "a", code: "BS1", qty: 20 },
        { storeId: "a", code: "BS2", qty: 10 },
        { storeId: "a", code: "BS3", qty: 10 },
        { storeId: "a", code: "TINY", qty: 2 },
      ],
      sold: [
        { storeId: "a", productCode: "BS2", itemCount: 2, brand: "ALL" }, // cobertura 10/(2/30)=150
        { storeId: "a", productCode: "BS3", itemCount: 30, brand: "ALL" }, // cobertura 10
      ],
    });
    const codes = rows.map((r) => r.code);
    expect(codes).toContain("BS1");
    expect(codes).toContain("BS2");
    expect(codes).not.toContain("BS3");
    expect(codes).not.toContain("TINY");
  });
});

describe("formatStalledBrief", () => {
  it("pede autorização para desafio", () => {
    const text = formatStalledBrief(
      [{ code: "BS1", name: "Cherry", stock: 20, items30d: 0, coverageDays: null }],
      "Shopping Campo Grande",
      "2026-09-30",
      "2026-10-29",
    );
    expect(text).toMatch(/Cherry/);
    expect(text.toLowerCase()).toMatch(/autoriz/);
  });
});
