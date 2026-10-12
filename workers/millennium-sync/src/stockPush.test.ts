import { describe, expect, it } from "vitest";
import { formatStockPush, parsePurchaseTotals, productsBelowMin } from "./stockPush.ts";

const plain = (value: string | undefined) => value?.replaceAll("\u00a0", " ");

describe("parsePurchaseTotals", () => {
  it("lê o total do relatório e, sem ele, soma saldo e pedido", () => {
    const lines = parsePurchaseTotals({
      value: [
        { COD_PRODUTO: "A1", DESCRICAO1: "ÓLEO", SALDO: 2, QUANTIDADE_PEDIDO: 1, TOTAL: 3 },
        { COD_PRODUTO: "B2", DESCRICAO1: "BODY", SALDO: 4, QUANTIDADE_PEDIDO: 2 },
        { COD_PRODUTO: "  ", DESCRICAO1: "SEM CÓDIGO", TOTAL: 9 },
      ],
    });
    expect(lines).toEqual([
      { code: "A1", description: "ÓLEO", total: 3 },
      { code: "B2", description: "BODY", total: 6 },
    ]);
  });
});

describe("productsBelowMin", () => {
  it("soma as variantes e deixa de fora quem está no mínimo ou sem mínimo", () => {
    const mins = new Map([
      ["A1", 6],
      ["B2", 4],
      ["C3", 0],
    ]);
    const shorts = productsBelowMin(
      [
        { code: "A1", description: "ÓLEO", total: 1 },
        { code: "A1", description: "ÓLEO", total: 1 },
        { code: "B2", description: "BODY", total: 4 },
        { code: "C3", description: "SEM", total: 0 },
        { code: "D4", description: "FORA", total: 0 },
      ],
      mins,
    );
    expect(shorts).toEqual([{ name: "ÓLEO", total: 2, min: 6 }]);
  });

  it("ordena pelo maior buraco", () => {
    const mins = new Map([
      ["A", 10],
      ["B", 8],
    ]);
    const shorts = productsBelowMin(
      [
        { code: "A", description: "PERTO", total: 9 },
        { code: "B", description: "LONGE", total: 1 },
      ],
      mins,
    );
    expect(shorts.map((row) => row.name)).toEqual(["LONGE", "PERTO"]);
  });
});

describe("formatStockPush", () => {
  it("uma filial abre com o nome e uma linha por produto", () => {
    const text = formatStockPush([
      {
        name: "LOJAWEPINK.CENTRO.CAMPOGRANDE",
        products: [
          { name: "ÓLEO", total: 2, min: 6 },
          { name: "BODY", total: 0, min: 4 },
        ],
      },
    ]);
    expect(plain(text?.title)).toBe("Estoque · 2 abaixo do mínimo");
    expect(plain(text?.body)).toBe(
      ["LOJAWEPINK.CENTRO.CAMPOGRANDE", "ÓLEO · 2 · mínimo 6", "BODY · 0 · mínimo 4"].join("\n"),
    );
  });

  it("filial sem produto abaixo não entra no texto", () => {
    expect(formatStockPush([{ name: "CENTRO", products: [] }])).toBeNull();
  });

  it("quando não cabe, o resto vira e mais N produtos", () => {
    const product = (letter: string) => ({ name: letter.repeat(70), total: 0, min: 10 });
    const text = formatStockPush([
      { name: "LOJAWEPINK.CENTRO.CAMPOGRANDE", products: [product("A"), product("B"), product("C")] },
      { name: "SB EMPREENDIMENTOS", products: [product("D")] },
    ]);
    const body = plain(text?.body) ?? "";
    expect(text?.title).toBe("Estoque · 4 abaixo do mínimo");
    expect(body.startsWith("LOJAWEPINK.CENTRO.CAMPOGRANDE\n" + "A".repeat(70))).toBe(true);
    expect(body.includes("B".repeat(70))).toBe(false);
    expect(body.includes("SB EMPREENDIMENTOS")).toBe(false);
    expect(body.endsWith("e mais 3 produtos")).toBe(true);
  });
});
