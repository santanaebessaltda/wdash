import { describe, expect, it } from "vitest";
import {
  brandDayAggsFromMargemLines,
  brandFromCodProduto,
  cmvCentsFromMargemLines,
  milleniumMargemDataRange,
  parseRelatorioMargemPayload,
  productCostDayAggsFromMargemLines,
} from "./millenniumMargem.ts";

describe("productCostDayAggsFromMargemLines", () => {
  it("agrega por COD_PRODUTO e ignora linha sem código", () => {
    const rows = productCostDayAggsFromMargemLines(
      [
        { codProduto: "375", qty: 1, custoFranquias: 10, custoTotal: 10, totalVenda: 100 },
        { codProduto: "375 ", qty: 2, custoFranquias: 10, custoTotal: 20, totalVenda: 190.5 },
        { codProduto: "WP002", qty: 1, custoFranquias: 20, custoTotal: 20, totalVenda: 50.42 },
        { codProduto: "", qty: 1, custoFranquias: 5, custoTotal: 5, totalVenda: 9 },
      ],
      { tenantId: "t1", storeId: "s1", day: "2026-09-24" },
    );
    expect(rows).toEqual([
      { tenantId: "t1", storeId: "s1", day: "2026-09-24", productCode: "375", itemCount: 3, revenueCents: 29050, cmvCents: 3000 },
      { tenantId: "t1", storeId: "s1", day: "2026-09-24", productCode: "WP002", itemCount: 1, revenueCents: 5042, cmvCents: 2000 },
    ]);
  });
});

describe("parseRelatorioMargemPayload", () => {
  it("maps CUSTO_FRANQUIAS / QTDE / CUSTO_TOTAL", () => {
    const lines = parseRelatorioMargemPayload([
      {
        COD_PRODUTO: "375",
        QTDE_VENDIDA: 7,
        CUSTO_FRANQUIAS: 48.35,
        CUSTO_TOTAL: 338.45,
        TOTALVENDA: 747.75,
        PERC_MARGEM: 45.26,
      },
      {
        COD_PRODUTO: "100",
        QTDE_VENDIDA: 2,
        CUSTO_FRANQUIAS: 10,
        // CUSTO_TOTAL omitido  ->  deriva
        TOTALVENDA: 50,
      },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      codProduto: "375",
      qty: 7,
      custoFranquias: 48.35,
      custoTotal: 338.45,
    });
    expect(lines[1].custoTotal).toBe(20);
  });

  it("sums CMV cents from CUSTO_TOTAL (imposto 0)", () => {
    const lines = parseRelatorioMargemPayload([
      { COD_PRODUTO: "a", QTDE_VENDIDA: 1, CUSTO_FRANQUIAS: 10, CUSTO_TOTAL: 10 },
      { COD_PRODUTO: "b", QTDE_VENDIDA: 2, CUSTO_FRANQUIAS: 5.5, CUSTO_TOTAL: 11 },
    ]);
    expect(cmvCentsFromMargemLines(lines)).toBe(2100);
  });
});

describe("brandFromCodProduto / brandDayAggsFromMargemLines", () => {
  it("maps WP* → WPINK and rest → WEPINK", () => {
    expect(brandFromCodProduto("WP002")).toBe("WPINK");
    expect(brandFromCodProduto("wp055")).toBe("WPINK");
    expect(brandFromCodProduto("375")).toBe("WEPINK");
    expect(brandFromCodProduto("PSWP-ATH001")).toBe("WEPINK");
  });

  it("splits TOTALVENDA and CUSTO_TOTAL by COD prefix into day aggs", () => {
    const lines = parseRelatorioMargemPayload([
      { COD_PRODUTO: "375", QTDE_VENDIDA: 1, CUSTO_TOTAL: 10, TOTALVENDA: 100 },
      { COD_PRODUTO: "WP002", QTDE_VENDIDA: 1, CUSTO_TOTAL: 20, TOTALVENDA: 50.42 },
      { COD_PRODUTO: "BSPX-ATH-001", QTDE_VENDIDA: 1, CUSTO_TOTAL: 5, TOTALVENDA: 80 },
    ]);
    const aggs = brandDayAggsFromMargemLines(lines, {
      tenantId: "t1",
      storeId: "s1",
      day: "2026-09-05",
    });
    expect(aggs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          brand: "WEPINK",
          revenueCents: 18000,
          cmvCents: 1500,
          day: "2026-09-05",
        }),
        expect.objectContaining({
          brand: "WPINK",
          revenueCents: 5042,
          cmvCents: 2000,
          day: "2026-09-05",
        }),
      ]),
    );
  });
});

describe("milleniumMargemDataRange", () => {
  it("uses inclusive DATAF (same calendar end day, not Lista +1)", () => {
    expect(milleniumMargemDataRange("2026-09-01", "2026-09-01")).toEqual({
      datai: "2026-09-01T04:00:00.000Z",
      dataf: "2026-09-01T04:00:00.000Z",
    });
    expect(milleniumMargemDataRange("2026-09-01", "2026-09-22")).toEqual({
      datai: "2026-09-01T04:00:00.000Z",
      dataf: "2026-09-22T04:00:00.000Z",
    });
  });
});
