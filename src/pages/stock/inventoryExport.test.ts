import { describe, expect, it } from "vitest";
import type { PriceComposition, StockProductRow, StockStoreDetail } from "@/data/wedash/stockProducts";
import type { Store } from "@/data/wedash/stores";
import { readXlsx } from "@/lib/xlsx";
import { buildXlsx } from "@/lib/xlsx";
import { inventoryXlsxRows } from "./inventoryExport";

function detail(
  tradeName: string,
  stock: number,
  locations: Array<{ name: string; qty: number }>,
  cost: number | null,
  transfers: StockStoreDetail["transferencias"] = [],
): StockStoreDetail {
  return {
    store: { tradeName } as Store,
    stock,
    locations,
    transferencias: transfers,
    composition: { cost } as PriceComposition,
    praticado: null,
    vendidos30d: 0,
  };
}

function product(patch: Partial<StockProductRow> & Pick<StockProductRow, "code" | "storeRows">): StockProductRow {
  const stock = patch.storeRows.reduce((s, l) => s + l.stock, 0);
  return {
    name: "Produto",
    category: "Categoria",
    stock,
    transfer: 0,
    cost: null,
    franchiseRent: null,
    costTotal: null,
    price: null,
    profit: null,
    marginPct: null,
    priceMinimum: null,
    shelfPrice: null,
    marginPraticadaPct: null,
    itemsVendidos30d: 0,
    variesByStore: false,
    aReceive: null,
    totalGeral: null,
    ...patch,
  };
}

describe("inventoryXlsxRows", () => {
  it("um local só não ganha coluna Total e o custo igual vira número", () => {
    const rows = inventoryXlsxRows(
      [
        {
          status: "ok",
          r: product({
            code: "001",
            name: "Óleo",
            category: "Corpo",
            aReceive: 4,
            totalGeral: 6,
            storeRows: [detail("LOJA", 2, [{ name: "ESTOQUE", qty: 2 }], 19.9)],
          }),
        },
      ],
      ["ESTOQUE"],
      false,
    );
    expect(rows[0]).toEqual(["Código", "Produto", "Categoria", "ESTOQUE", "A receber", "Total geral", "Preço de custo", "Valor", "Status", "Transferência"]);
    expect(rows[1]).toEqual(["001", "Óleo", "Corpo", 2, 4, 6, 19.9, 39.8, "Regular", ""]);
    expect(rows[2][1]).toBe("Total do filtro");
    expect(rows[2][3]).toBe(2);
    expect(rows[2][7]).toBe(39.8);
  });

  it("mais de um local soma o total e marca custo diferente como Varia", () => {
    const rows = inventoryXlsxRows(
      [
        {
          status: "awaiting",
          r: product({
            code: "002",
            aReceive: null,
            totalGeral: null,
            storeRows: [
              detail("LOJA A", 2, [{ name: "ESTOQUE", qty: 2 }], 10, [{ from: "ESTOQUE", to: "PONTO DE VENDA", qty: 1 }]),
              detail("LOJA B", 3, [{ name: "PONTO DE VENDA", qty: 3 }], 12),
            ],
          }),
        },
      ],
      ["ESTOQUE", "PONTO DE VENDA"],
      true,
    );
    expect(rows[0]).toContain("Total");
    expect(rows[1][3]).toBe(2);
    expect(rows[1][4]).toBe(3);
    expect(rows[1][5]).toBe(5);
    expect(rows[1][6]).toBe("");
    expect(rows[1][8]).toBe("Varia");
    expect(rows[1][9]).toBe(56);
    expect(rows[1][10]).toBe("Aguardando transferência");
    expect(rows[1][11]).toBe("LOJA A: transferir 1 de ESTOQUE para PONTO DE VENDA.");
  });

  it("a planilha gerada relê o cabeçalho e o produto", async () => {
    const rows = inventoryXlsxRows(
      [
        {
          status: "negative",
          r: product({
            code: "003",
            name: "A & B",
            storeRows: [detail("LOJA", -1, [{ name: "ESTOQUE", qty: -1 }], 8)],
          }),
        },
      ],
      ["ESTOQUE"],
      false,
    );
    const read = await readXlsx(buildXlsx(rows, { textColumns: [0, 1, 2], sheetName: "Estoque" }));
    expect(read[0][0]).toBe("Código");
    expect(read[1][0]).toBe("003");
    expect(read[1][1]).toBe("A & B");
    expect(read[1][3]).toBe("-1");
    expect(read[1][8]).toBe("Negativo");
  });
});
