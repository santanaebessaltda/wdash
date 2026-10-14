import { describe, expect, it } from "vitest";
import { parsePurchaseStock, purchaseRegistry } from "./purchaseStock.ts";

const row = (o: Record<string, unknown>) => ({
  COD_PRODUTO: "526",
  DESCRICAO1: "BODY SPLASH VF GOLDEN",
  COR: "000",
  ESTAMPA: "000",
  TAMANHO: "U",
  SALDO: 10,
  QUANTIDADE_PEDIDO: 24,
  TOTAL: 34,
  QUANTIDADE_MULTIPLA: 12,
  BLOQUEADO_COMPRA: false,
  DATA_CADASTRO: "2024-06-05T03:00:00.000Z",
  ...o,
});

describe("parsePurchaseStock (PC-06)", () => {
  it("lê o formato do Millennium (envelope value) com as variantes como texto", () => {
    const [r] = parsePurchaseStock({ value: [row({})] });
    expect(r).toEqual({
      code: "526",
      color: "000",
      print: "000",
      size: "U",
      description: "BODY SPLASH VF GOLDEN",
      balance: 10,
      openOrder: 24,
      total: 34,
      multiple: 12,
      blocked: false,
      registeredAt: "2024-06-05",
      position: 0,
    });
  });

  it("saldo, pedido e total nulos = 0; total ausente = saldo + pedido", () => {
    const [a, b] = parsePurchaseStock([
      row({ COD_PRODUTO: "A", SALDO: null, QUANTIDADE_PEDIDO: null, TOTAL: null }),
      row({ COD_PRODUTO: "B", SALDO: -3, QUANTIDADE_PEDIDO: 12, TOTAL: undefined }),
    ]);
    expect([a.balance, a.openOrder, a.total]).toEqual([0, 0, 0]);
    expect(b.total).toBe(9);
  });

  it("múltipla nula, zero ou negativa = null; texto numérico vira número", () => {
    const rows = parsePurchaseStock([
      row({ COD_PRODUTO: "A", QUANTIDADE_MULTIPLA: null }),
      row({ COD_PRODUTO: "B", QUANTIDADE_MULTIPLA: 0 }),
      row({ COD_PRODUTO: "C", QUANTIDADE_MULTIPLA: -6 }),
      row({ COD_PRODUTO: "D", QUANTIDADE_MULTIPLA: "24" }),
    ]);
    expect(rows.map((r) => r.multiple)).toEqual([null, null, null, 24]);
  });

  it("bloqueado só com true; qualquer outro valor = liberado", () => {
    const rows = parsePurchaseStock([
      row({ COD_PRODUTO: "A", BLOQUEADO_COMPRA: true }),
      row({ COD_PRODUTO: "B", BLOQUEADO_COMPRA: null }),
      row({ COD_PRODUTO: "C", BLOQUEADO_COMPRA: "N" }),
    ]);
    expect(rows.map((r) => r.blocked)).toEqual([true, false, false]);
  });

  it("data de cadastro em Brasília (UTC − 3h); nula ou inválida = null", () => {
    const rows = parsePurchaseStock([
      row({ COD_PRODUTO: "A", DATA_CADASTRO: "2026-10-01T02:59:00.000Z" }),
      row({ COD_PRODUTO: "B", DATA_CADASTRO: null }),
      row({ COD_PRODUTO: "C", DATA_CADASTRO: "ontem" }),
    ]);
    expect(rows.map((r) => r.registeredAt)).toEqual(["2026-09-30", null, null]);
  });

  it("posição = ordem do retorno; linhas sem código ficam de fora", () => {
    const rows = parsePurchaseStock([row({ COD_PRODUTO: "Z" }), row({ COD_PRODUTO: "" }), row({ COD_PRODUTO: "A" })]);
    expect(rows.map((r) => [r.code, r.position])).toEqual([
      ["Z", 0],
      ["A", 1],
    ]);
  });

  it("mesma variante repetida soma as quantidades e mantém a 1ª posição; variante diferente fica separada", () => {
    const rows = parsePurchaseStock([
      row({ COD_PRODUTO: "A", SALDO: 2, QUANTIDADE_PEDIDO: 0, TOTAL: 2 }),
      row({ COD_PRODUTO: "B" }),
      row({ COD_PRODUTO: "A", SALDO: 3, QUANTIDADE_PEDIDO: 12, TOTAL: 15 }),
      row({ COD_PRODUTO: "A", COR: "001" }),
    ]);
    expect(rows.map((r) => [r.code, r.color, r.position, r.balance, r.openOrder, r.total])).toEqual([
      ["A", "000", 0, 5, 12, 17],
      ["B", "000", 1, 10, 24, 34],
      ["A", "001", 2, 10, 24, 34],
    ]);
  });

  it("resposta vazia ou fora do formato = lista vazia", () => {
    expect(parsePurchaseStock(null)).toEqual([]);
    expect(parsePurchaseStock({ erro: "x" })).toEqual([]);
  });
});

describe("purchaseRegistry", () => {
  it("1 cadastro por código (o da 1ª variante)", () => {
    const rows = parsePurchaseStock([
      row({ COD_PRODUTO: "A", QUANTIDADE_MULTIPLA: 12 }),
      row({ COD_PRODUTO: "A", COR: "001", QUANTIDADE_MULTIPLA: 24 }),
      row({ COD_PRODUTO: "B", BLOQUEADO_COMPRA: true, DATA_CADASTRO: null }),
    ]);
    expect(purchaseRegistry(rows)).toEqual([
      { code: "A", registeredAt: "2024-06-05", purchaseMultiple: 12, purchaseBlocked: false },
      { code: "B", registeredAt: null, purchaseMultiple: 12, purchaseBlocked: true },
    ]);
  });
});
