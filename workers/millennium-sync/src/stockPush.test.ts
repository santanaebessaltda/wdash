import { describe, expect, it } from "vitest";
import { formatStockPush, parsePurchaseTotals, planStockAlerts, productsBelowMin } from "./stockPush.ts";

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
    expect(shorts).toEqual([{ code: "A1", name: "ÓLEO", total: 2, min: 6 }]);
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

describe("planStockAlerts", () => {
  const lines = [
    { code: "A1", description: "ÓLEO", total: 2 },
    { code: "B2", description: "BODY", total: 6 },
  ];
  const mins = new Map([
    ["A1", 6],
    ["B2", 4],
  ]);

  it("avisa só quem acabou de ficar abaixo", () => {
    const plan = planStockAlerts(lines, mins, new Set(["A1"]));
    expect(plan.alert).toEqual([]);
    expect(plan.rearm).toEqual([]);
  });

  it("rearma quando o total volta ao mínimo e avisa de novo na queda seguinte", () => {
    const recovered = planStockAlerts(lines, mins, new Set(["B2"]));
    expect(recovered.rearm).toEqual(["B2"]);
    expect(recovered.alert.map((product) => product.code)).toEqual(["A1"]);

    const again = planStockAlerts(
      [{ code: "B2", description: "BODY", total: 1 }],
      new Map([["B2", 4]]),
      new Set(),
    );
    expect(again.alert.map((product) => product.name)).toEqual(["BODY"]);
  });

  it("mínimo novo que deixa o produto abaixo entra no próximo aviso", () => {
    const plan = planStockAlerts(lines, new Map([["B2", 8]]), new Set());
    expect(plan.alert.map((product) => product.code)).toEqual(["B2"]);
  });

  it("produto que sumiu do relatório continua armado", () => {
    const plan = planStockAlerts([], new Map([["A1", 6]]), new Set(["A1"]));
    expect(plan.alert).toEqual([]);
    expect(plan.rearm).toEqual([]);
  });

  it("tirar o mínimo rearma o produto", () => {
    const plan = planStockAlerts(lines, new Map(), new Set(["A1"]));
    expect(plan.rearm).toEqual(["A1"]);
  });
});

describe("formatStockPush", () => {
  it("uma filial abre com o nome e uma linha por produto", () => {
    const text = formatStockPush([
      {
        name: "LOJAWEPINK.CENTRO.CAMPOGRANDE",
        products: [
          { code: "A1", name: "ÓLEO", total: 2, min: 6 },
          { code: "B2", name: "BODY", total: 0, min: 4 },
        ],
      },
    ]);
    expect(plain(text?.title)).toBe("Estoque · 2 abaixo do mínimo");
    expect(plain(text?.body)).toBe(
      ["LOJAWEPINK.CENTRO.CAMPOGRANDE", "ÓLEO · 2 de 6", "BODY · 0 de 4"].join("\n"),
    );
  });

  it("filial sem produto abaixo não entra no texto", () => {
    expect(formatStockPush([{ name: "CENTRO", products: [] }])).toBeNull();
  });

  it("quando não cabe, o resto vira e mais N produtos", () => {
    const product = (letter: string) => ({ code: letter, name: letter.repeat(70), total: 0, min: 10 });
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
