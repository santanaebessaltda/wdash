import { describe, expect, it } from "vitest";
import { parsePurchaseStock, purchaseRegistry } from "./purchaseStock.ts";

const row = (o: Record<string, unknown>) => ({
  CODE_PRODUCT: "526",
  DESCRICAO1: "BODY SPLASH VF GOLDEN",
  COR: "000",
  ESTAMPA: "000",
  TAMANHO: "U",
  SALDO: 10,
  QUANTITY_ORDER: 24,
  TOTAL: 34,
  QUANTITY_MULTIPLA: 12,
  BLOCKED_PURCHASE: false,
  DATA_REGISTRATION: "2024-06-05T03:00:00.000Z",
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
      row({ CODE_PRODUCT: "A", SALDO: null, QUANTITY_ORDER: null, TOTAL: null }),
      row({ CODE_PRODUCT: "B", SALDO: -3, QUANTITY_ORDER: 12, TOTAL: undefined }),
    ]);
    expect([a.balance, a.openOrder, a.total]).toEqual([0, 0, 0]);
    expect(b.total).toBe(9);
  });

  it("múltipla nula, zero ou negativa = null; texto numérico vira número", () => {
    const rows = parsePurchaseStock([
      row({ CODE_PRODUCT: "A", QUANTITY_MULTIPLA: null }),
      row({ CODE_PRODUCT: "B", QUANTITY_MULTIPLA: 0 }),
      row({ CODE_PRODUCT: "C", QUANTITY_MULTIPLA: -6 }),
      row({ CODE_PRODUCT: "D", QUANTITY_MULTIPLA: "24" }),
    ]);
    expect(rows.map((r) => r.multiple)).toEqual([null, null, null, 24]);
  });

  it("bloqueado só com true; qualquer outro valor = liberado", () => {
    const rows = parsePurchaseStock([
      row({ CODE_PRODUCT: "A", BLOCKED_PURCHASE: true }),
      row({ CODE_PRODUCT: "B", BLOCKED_PURCHASE: null }),
      row({ CODE_PRODUCT: "C", BLOCKED_PURCHASE: "N" }),
    ]);
    expect(rows.map((r) => r.blocked)).toEqual([true, false, false]);
  });

  it("data de cadastro em Brasília (UTC − 3h); nula ou inválida = null", () => {
    const rows = parsePurchaseStock([
      row({ CODE_PRODUCT: "A", DATA_REGISTRATION: "2026-10-01T02:59:00.000Z" }),
      row({ CODE_PRODUCT: "B", DATA_REGISTRATION: null }),
      row({ CODE_PRODUCT: "C", DATA_REGISTRATION: "ontem" }),
    ]);
    expect(rows.map((r) => r.registeredAt)).toEqual(["2026-09-30", null, null]);
  });

  it("posição = ordem do retorno; linhas sem código ficam de fora", () => {
    const rows = parsePurchaseStock([row({ CODE_PRODUCT: "Z" }), row({ CODE_PRODUCT: "" }), row({ CODE_PRODUCT: "A" })]);
    expect(rows.map((r) => [r.code, r.position])).toEqual([
      ["Z", 0],
      ["A", 1],
    ]);
  });

  it("mesma variante repetida soma as quantidades e mantém a 1ª posição; variante diferente fica separada", () => {
    const rows = parsePurchaseStock([
      row({ CODE_PRODUCT: "A", SALDO: 2, QUANTITY_ORDER: 0, TOTAL: 2 }),
      row({ CODE_PRODUCT: "B" }),
      row({ CODE_PRODUCT: "A", SALDO: 3, QUANTITY_ORDER: 12, TOTAL: 15 }),
      row({ CODE_PRODUCT: "A", COR: "001" }),
    ]);
    expect(rows.map((r) => [r.code, r.color, r.position, r.balance, r.openOrder, r.total])).toEqual([
      ["A", "000", 0, 5, 12, 17],
      ["B", "000", 1, 10, 24, 34],
      ["A", "001", 2, 10, 24, 34],
    ]);
  });

  it("resposta vazia ou fora do formato = lista vazia", () => {
    expect(parsePurchaseStock(null)).toEqual([]);
    expect(parsePurchaseStock({ error: "x" })).toEqual([]);
  });
});

describe("purchaseRegistry", () => {
  it("1 cadastro por código (o da 1ª variante)", () => {
    const rows = parsePurchaseStock([
      row({ CODE_PRODUCT: "A", QUANTITY_MULTIPLA: 12 }),
      row({ CODE_PRODUCT: "A", COR: "001", QUANTITY_MULTIPLA: 24 }),
      row({ CODE_PRODUCT: "B", BLOCKED_PURCHASE: true, DATA_REGISTRATION: null }),
    ]);
    expect(purchaseRegistry(rows)).toEqual([
      { code: "A", registeredAt: "2024-06-05", purchaseMultiple: 12, purchaseBlocked: false },
      { code: "B", registeredAt: null, purchaseMultiple: 12, purchaseBlocked: true },
    ]);
  });
});
