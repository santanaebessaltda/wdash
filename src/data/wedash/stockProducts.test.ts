import { describe, expect, it } from "vitest";
import { buildStockProductsView, composePrice, productBrand, stockCostAmount, stockStatus, stockTransfers, suggestSaleTable } from "./stockProducts";
import { EMPTY_STORE_COSTS, type Store } from "./stores";

const store = (over: Partial<Store> & Pick<Store, "id">): Store =>
  ({
    millenniumFilial: 1,
    codFilial: "00001",
    nome: "LOJA",
    fantasia: "LOJA",
    cnpj: "",
    cidade: "",
    uf: "",
    tipo: "F",
    pointType: "SHOPPING",
    temWpink: true,
    fuso: "America/Campo_Grande",
    horas: [],
    abertura: 10,
    fechamento: 22,
    diasFechados: [],
    dataInauguracao: "",
    costTableId: 104,
    custos: {
      ...EMPTY_STORE_COSTS,
      icmsWepinkPct: 10,
      icmsWpinkPct: 10,
      icmsStWepinkPct: 20,
      icmsStWpinkPct: 20,
      royaltiesWepinkPct: 5,
      royaltiesWpinkPct: 3,
      marketingWepinkPct: 2,
      rentWepinkPct: 8,
      rentWpinkPct: 8,
    },
    ...over,
  }) as Store;

describe("composePrice", () => {
  it("custo + ICMS ST sobre o custo; ICMS, franquia e aluguel sobre o preço", () => {
    const c = composePrice(store({ id: "a" }), "BSP-001", 10000, 3000);
    expect(c.icmsSt).toBeCloseTo(6);
    expect(c.custoAquisicao).toBeCloseTo(36);
    expect(c.pctTotal).toBe(25);
    expect(c.impostos).toBeCloseTo(16);
    expect(c.franquiaAluguel).toBeCloseTo(15);
    expect(c.custoTotal).toBeCloseTo(61);
    expect(c.lucro).toBeCloseTo(39);
    expect(c.margemPct).toBeCloseTo(39);
    expect(c.precoMinimo).toBeCloseTo(48);
  });

  it("loja de rua ignora o aluguel percentual; WP* usa royalties WPINK", () => {
    const c = composePrice(store({ id: "a", pointType: "RUA" }), "WP014", 10000, 3000);
    expect(c.despesas.map((d) => d.label)).toEqual(["ICMS", "Royalties"]);
    expect(c.pctTotal).toBe(13);
    expect(productBrand("WP014")).toBe("WPINK");
    expect(productBrand("BSPPAR-ATH-001")).toBe("WEPINK");
  });

  it("produto WP usa o ICMS e o ICMS ST da WPINK", () => {
    const base = store({ id: "a" });
    const c = composePrice(
      store({
        id: "a",
        custos: { ...base.custos!, icmsWepinkPct: 10, icmsWpinkPct: 4, icmsStWepinkPct: 20, icmsStWpinkPct: 8 },
      }),
      "WP014",
      10000,
      3000,
    );
    expect(c.despesas.find((d) => d.label === "ICMS")?.pct).toBe(4);
    expect(c.icmsStPct).toBe(8);
    const wepink = composePrice(store({ id: "a", custos: { ...base.custos!, icmsWepinkPct: 10, icmsWpinkPct: 4 } }), "BSP-001", 10000, 3000);
    expect(wepink.despesas.find((d) => d.label === "ICMS")?.pct).toBe(10);
  });

  it("sem custo = sem lucro; sem preço = sem custo total", () => {
    expect(composePrice(store({ id: "a" }), "X", 10000, null).lucro).toBeNull();
    const semPreco = composePrice(store({ id: "a" }), "X", null, 3000);
    expect(semPreco.custoTotal).toBeNull();
    expect(semPreco.precoMinimo).toBeCloseTo(48);
  });
});

describe("buildStockProductsView", () => {
  it("soma o estoque das lojas, lista negativos e usa a média quando o custo varia", () => {
    const a = store({ id: "a", fantasia: "A" });
    const b = store({ id: "b", fantasia: "B", costTableId: 105 });
    const view = buildStockProductsView({
      stores: [a, b],
      catalog: new Map([["P1", { code: "P1", name: "PRODUTO 1", category: "PERFUMARIA" }]]),
      stock: [
        { storeId: "a", code: "P1", qty: 5 },
        { storeId: "b", code: "P1", qty: 3 },
        { storeId: "b", code: "P2", qty: -2 },
      ],
      costPrices: new Map([
        [104, new Map([["P1", 3000]])],
        [105, new Map([["P1", 4000]])],
      ]),
      salePrices: new Map([[7, new Map([["P1", 10000]])]]),
      saleTableId: 7,
      charged: [{ storeId: "a", code: "P1", revenueCents: 18000, items: 2 }],
    });
    const p1 = view.rows.find((r) => r.codigo === "P1")!;
    expect(p1.estoque).toBe(8);
    expect(p1.variaPorLoja).toBe(true);
    expect(p1.custo).toBeCloseTo(35);
    expect(p1.precoPraticado).toBeCloseTo(90);
    expect(view.negativos).toEqual([{ codigo: "P2", nome: "P2", quantidade: -2, lojas: ["B"] }]);
    expect(stockCostAmount(p1)).toEqual({ amount: 5 * 30 + 3 * 40, unit: null });
    expect(stockCostAmount(view.rows.find((r) => r.codigo === "P2")!)).toEqual({ amount: null, unit: null });
  });

  it("local negativo com outro local positivo = transferência; total = soma dos locais", () => {
    const view = buildStockProductsView({
      stores: [store({ id: "a" })],
      catalog: new Map(),
      stock: [
        { storeId: "a", code: "OLEBOS", qty: 73, locations: { ESTOQUE: 144, QUIOSQUE: -71 } },
        { storeId: "a", code: "X", qty: -3, locations: { QUIOSQUE: -3 } },
      ],
      costPrices: new Map(),
      salePrices: new Map(),
      saleTableId: null,
      charged: [],
    });
    const p = view.rows.find((r) => r.codigo === "OLEBOS")!;
    expect(p.estoque).toBe(73);
    expect(p.transferir).toBe(71);
    expect(p.lojas[0].locais).toEqual([
      { nome: "ESTOQUE", qtd: 144 },
      { nome: "QUIOSQUE", qtd: -71 },
    ]);
    expect(p.lojas[0].transferencias).toEqual([{ de: "ESTOQUE", para: "QUIOSQUE", qtd: 71 }]);
    expect(view.rows.find((r) => r.codigo === "X")!.transferir).toBe(0);
  });

  it("negativo = total da loja abaixo de zero; aguardando = local negativo com um local pai positivo; senão ok", () => {
    const view = buildStockProductsView({
      stores: [store({ id: "a" }), store({ id: "b" })],
      catalog: new Map(),
      stock: [
        { storeId: "a", code: "P1", qty: 4 },
        { storeId: "b", code: "P1", qty: -1 },
        { storeId: "a", code: "P2", qty: 3, locations: { ESTOQUE: 5, QUIOSQUE: -2 } },
        { storeId: "a", code: "P3", qty: 2 },
        { storeId: "a", code: "P5", qty: 10, locations: { Estoque: 4, "PONTO DE VENDA": 6 } },
        { storeId: "b", code: "P6", qty: 3, locations: { Estoque: 3 } },
        { storeId: "a", code: "P7", qty: -10, locations: { Estoque: 10, "PONTO DE VENDA": -20 } },
        { storeId: "a", code: "P8", qty: 2, locations: { Shop010: 5, "PONTO DE VENDA": -3 } },
        { storeId: "a", code: "P9", qty: 4, locations: { Estoque: 6, Shop010: -2 } },
        { storeId: "a", code: "P10", qty: 1, locations: { "PONTO DE VENDA": 3, Shop010: -2 } },
        { storeId: "a", code: "P11", qty: 2, locations: { Estoque: -1, "PONTO DE VENDA": 3 } },
      ],
      costPrices: new Map(),
      salePrices: new Map(),
      saleTableId: null,
      charged: [{ storeId: "a", code: "P4", revenueCents: 5000, items: 1 }],
    });
    const status = (c: string) => stockStatus(view.rows.find((r) => r.codigo === c)!);
    expect(status("P1")).toBe("negativo");
    expect(status("P2")).toBe("aguardando");
    expect(status("P3")).toBe("ok");
    expect(status("P5")).toBe("ok");
    expect(status("P6")).toBe("ok");
    expect(status("P7")).toBe("negativo");
    expect(status("P8")).toBe("aguardando");
    expect(status("P9")).toBe("aguardando");
    expect(status("P10")).toBe("ok");
    expect(status("P11")).toBe("ok");
    expect(view.rows.some((r) => r.codigo === "P4")).toBe(false);
  });
});

describe("stockTransfers", () => {
  it("Loja recebe de qualquer local, no máximo o que eles têm (maior saldo primeiro)", () => {
    expect(
      stockTransfers([
        { nome: "ESTOQUE", qtd: 10 },
        { nome: "SHOP010", qtd: 5 },
        { nome: "QUIOSQUE", qtd: -20 },
      ]),
    ).toEqual([
      { de: "ESTOQUE", para: "QUIOSQUE", qtd: 10 },
      { de: "SHOP010", para: "QUIOSQUE", qtd: 5 },
    ]);
  });

  it("local intermediário só recebe do Estoque, antes da Loja", () => {
    expect(
      stockTransfers([
        { nome: "Estoque", qtd: 8 },
        { nome: "Shop010", qtd: -3 },
        { nome: "PONTO DE VENDA", qtd: -10 },
      ]),
    ).toEqual([
      { de: "Estoque", para: "Shop010", qtd: 3 },
      { de: "Estoque", para: "PONTO DE VENDA", qtd: 5 },
    ]);
    expect(stockTransfers([{ nome: "PONTO DE VENDA", qtd: 3 }, { nome: "Shop010", qtd: -2 }])).toEqual([]);
    expect(stockTransfers([{ nome: "Estoque", qtd: -1 }, { nome: "PONTO DE VENDA", qtd: 3 }])).toEqual([]);
  });
});

describe("suggestSaleTable", () => {
  it("sugere a mais usada no período; usadas = ordem de uso no período", () => {
    const r = suggestSaleTable([
      { day: "2026-09-27", tableId: 1, items: 50 },
      { day: "2026-09-28", tableId: 2, items: 10 },
      { day: "2026-09-28", tableId: 3, items: 12 },
    ]);
    expect(r.sugerida).toBe(1);
    expect(r.usadas).toEqual([1, 3, 2]);
  });
});
