import { describe, expect, it } from "vitest";
import { detMovLineRevenueCents, parseConsultaDetMovPayload } from "./millenniumDetMov";

describe("parseConsultaDetMovPayload", () => {
  it("maps PRODUTO / PRECO_TOTAL / QUANTIDADE", () => {
    const lines = parseConsultaDetMovPayload([
      {
        PRODUTO: 148,
        DESC_PRODUTO: "BSIF-ATH-001-BODY SPLASH - WEPINK",
        PRECO_TOTAL: 52.9,
        QUANTIDADE: 1,
      },
      {
        PRODUTO: 475,
        DESC_PRODUTO: "WP024-POWER PINK",
        PRECO_TOTAL: 89.9,
        QUANTIDADE: 2,
      },
    ]);
    expect(lines).toEqual([
      {
        productId: 148,
        revenueCents: 5290,
        qty: 1,
        descProduto: "BSIF-ATH-001-BODY SPLASH - WEPINK",
      },
      {
        productId: 475,
        revenueCents: 8990,
        qty: 2,
        descProduto: "WP024-POWER PINK",
      },
    ]);
  });

  it("uses PRECO × QUANTIDADE when PRECO_TOTAL is null", () => {
    expect(
      detMovLineRevenueCents({
        PRECO: 109.9,
        PRECO_APLICADO: null,
        PRECO_TOTAL: null,
        QUANTIDADE: 1,
      }),
    ).toBe(10990);
    expect(
      detMovLineRevenueCents({
        PRECO: 20,
        PRECO_TOTAL: null,
        QUANTIDADE: 3,
      }),
    ).toBe(6000);
  });

  it("keeps PRECO_TOTAL when the ERP sends the line total", () => {
    expect(
      detMovLineRevenueCents({
        PRECO: 10,
        PRECO_APLICADO: 27.95,
        PRECO_TOTAL: 55.9,
        QUANTIDADE: 2,
      }),
    ).toBe(5590);
  });

  it("skips rows without PRODUTO", () => {
    expect(parseConsultaDetMovPayload([{ PRECO_TOTAL: 10, QUANTIDADE: 1 }])).toEqual([]);
  });
});
