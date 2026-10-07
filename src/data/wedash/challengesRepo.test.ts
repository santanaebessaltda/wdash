import { describe, expect, it } from "vitest";
import { challengeFromRow, challengeToRow, type ChallengeInput, type ChallengeRow } from "./challengesRepo";

const row = (over: Partial<ChallengeRow> = {}): ChallengeRow => ({
  id: "c1",
  store_id: "s1",
  name: "Body Splash — quem vender mais",
  starts_on: "2026-10-05",
  ends_on: "2026-10-11",
  metric: "QUANTITY",
  scope: "PRODUCTS",
  mode: "CONTEST",
  products: [{ code: "BSPPAR-ATH-001", name: "BODY SPLASH PARIS" }],
  categories: [],
  target: null,
  min_sales: null,
  prizes: [{ kind: "MONEY", cents: 10_000 }, { kind: "ITEM", label: "Combo KFC" }],
  manager_prize: null,
  ...over,
});

describe("challengeFromRow", () => {
  it("lê o desafio com prêmio em R$ (centavos → reais) e em espécie", () => {
    expect(challengeFromRow(row())).toEqual({
      id: "c1",
      storeId: "s1",
      name: "Body Splash — quem vender mais",
      startsOn: "2026-10-05",
      endsOn: "2026-10-11",
      metric: "QUANTITY",
      scope: "PRODUCTS",
      mode: "CONTEST",
      products: [{ code: "BSPPAR-ATH-001", name: "BODY SPLASH PARIS" }],
      categories: [],
      target: null,
      minSales: null,
      prizes: [
        { kind: "MONEY", amount: 100 },
        { kind: "ITEM", label: "Combo KFC" },
      ],
      managerPrize: null,
      managerTarget: null,
    });
  });

  it("numeric do Postgres chega como texto: alvo de P.A. com 2 casas e mínimo de vendas", () => {
    const c = challengeFromRow(
      row({ metric: "PA", mode: "MINIMUM", products: [], target: "1.90", min_sales: 10, prizes: [{ kind: "MONEY", cents: 5_000 }] }),
    );
    expect(c).toMatchObject({ metric: "PA", mode: "MINIMUM", target: 1.9, minSales: 10, prizes: [{ kind: "MONEY", amount: 50 }] });
  });

  it("JSON inválido ou vazio vira lista vazia", () => {
    const c = challengeFromRow(row({ products: null, categories: "x", prizes: { kind: "MONEY" } }));
    expect(c.products).toEqual([]);
    expect(c.categories).toEqual([]);
    expect(c.prizes).toEqual([]);
  });

  it("descarta produto sem código e categoria sem tipo", () => {
    const c = challengeFromRow(
      row({
        products: [{ code: "", name: "X" }, { code: "WP002", name: "WP ULTRA" }, { name: "Y" }],
        categories: [{ typeId: 14, name: "BODY SPLASH" }, { typeId: "abc", name: "Z" }],
      }),
    );
    expect(c.products).toEqual([{ code: "WP002", name: "WP ULTRA" }]);
    expect(c.categories).toEqual([{ typeId: 14, name: "BODY SPLASH" }]);
  });

  it("prêmio inválido no meio corta o pódio dali para frente (não sobe o 3º para 2º)", () => {
    const c = challengeFromRow(
      row({ prizes: [{ kind: "MONEY", cents: 10_000 }, { kind: "MONEY", cents: 0 }, { kind: "ITEM", label: "Pizza" }] }),
    );
    expect(c.prizes).toEqual([{ kind: "MONEY", amount: 100 }]);
  });

  it("descrição do prêmio: vazia é inválida e passa de 60 caracteres é cortada", () => {
    expect(challengeFromRow(row({ prizes: [{ kind: "ITEM", label: "   " }] })).prizes).toEqual([]);
    const longo = "x".repeat(70);
    expect(challengeFromRow(row({ prizes: [{ kind: "ITEM", label: longo }] })).prizes).toEqual([
      { kind: "ITEM", label: "x".repeat(60) },
    ]);
  });

  it("enum desconhecido cai no padrão seguro (Quantidade · Quem fizer mais)", () => {
    const c = challengeFromRow(row({ metric: "INDICE", scope: "???", mode: "???" }));
    expect(c.metric).toBe("QUANTITY");
    expect(c.scope).toBe("ALL");
    expect(c.mode).toBe("CONTEST");
  });

  it("formato antigo: metric PRODUCTS/CATEGORIES vira Quantidade com o mesmo escopo; P.A./ticket = ALL", () => {
    expect(challengeFromRow(row({ metric: "PRODUCTS", scope: null }))).toMatchObject({ metric: "QUANTITY", scope: "PRODUCTS" });
    expect(challengeFromRow(row({ metric: "CATEGORIES", scope: "ALL" }))).toMatchObject({ metric: "QUANTITY", scope: "CATEGORIES" });
    expect(challengeFromRow(row({ metric: "PA", scope: "PRODUCTS" }))).toMatchObject({ metric: "PA", scope: "ALL" });
    expect(challengeFromRow(row({ metric: "VALUE", scope: "CATEGORIES" }))).toMatchObject({ metric: "VALUE", scope: "CATEGORIES" });
  });

  it("prêmio da gerência: objeto válido vira prêmio; inválido vira null", () => {
    expect(challengeFromRow(row({ manager_prize: { kind: "ITEM", label: "Spa" } })).managerPrize).toEqual({
      kind: "ITEM",
      label: "Spa",
    });
    expect(challengeFromRow(row({ manager_prize: { kind: "MONEY", cents: -5 } })).managerPrize).toBeNull();
  });

  it("meta da gerência vem junto do prêmio; sem ela usa o alvo/piso; sem prêmio fica null", () => {
    expect(challengeFromRow(row({ target: "10", manager_prize: { kind: "ITEM", label: "Spa", target: "15" } })).managerTarget).toBe(15);
    expect(challengeFromRow(row({ target: "10", manager_prize: { kind: "ITEM", label: "Spa" } })).managerTarget).toBe(10);
    expect(challengeFromRow(row({ target: "10", manager_prize: { kind: "ITEM", label: "Spa", target: 0 } })).managerTarget).toBe(10);
    expect(challengeFromRow(row({ target: "10", manager_prize: null })).managerTarget).toBeNull();
  });
});

describe("challengeToRow", () => {
  const input: ChallengeInput = {
    storeId: "s1",
    name: "  Ticket da semana  ",
    startsOn: "2026-10-05",
    endsOn: "2026-10-11",
    metric: "TICKET",
    scope: "ALL",
    mode: "MINIMUM",
    products: [],
    categories: [],
    target: 92.345,
    minSales: 10,
    prizes: [{ kind: "MONEY", amount: 50.1 }],
    managerPrize: { kind: "ITEM", label: " Combo KFC " },
    managerTarget: 110.004,
  };

  it("grava reais como centavos, nome e descrição sem espaços nas pontas, alvo com 2 casas", () => {
    expect(challengeToRow(input)).toEqual({
      store_id: "s1",
      name: "Ticket da semana",
      starts_on: "2026-10-05",
      ends_on: "2026-10-11",
      metric: "TICKET",
      scope: "ALL",
      mode: "MINIMUM",
      products: [],
      categories: [],
      target: 92.35,
      min_sales: 10,
      prizes: [{ kind: "MONEY", cents: 5010 }],
      manager_prize: { kind: "ITEM", label: "Combo KFC", target: 110 },
    });
  });

  it("ida e volta preserva o desafio", () => {
    const limpo = { ...input, name: "Ticket da semana", managerPrize: { kind: "ITEM" as const, label: "Combo KFC" }, target: 92.35, managerTarget: 110 };
    const back = challengeFromRow({ ...challengeToRow(limpo), id: "c9" } as ChallengeRow);
    expect(back).toEqual({ ...limpo, id: "c9" });
  });

  it("métrica de itens grava o alvo inteiro; sem prêmio da gerência grava null", () => {
    const r = challengeToRow({ ...input, metric: "QUANTITY", scope: "PRODUCTS", products: [{ code: "WP002", name: "WP ULTRA" }], target: 15, managerPrize: null, managerTarget: null });
    expect(r).toMatchObject({ scope: "PRODUCTS", target: 15, manager_prize: null, products: [{ code: "WP002", name: "WP ULTRA" }] });
  });

  it("Índice de desempenho: escopo ALL; modo mínimo preservado; gerência sem índice próprio = sem prêmio", () => {
    expect(
      challengeFromRow(row({ metric: "INDEX", scope: "PRODUCTS", mode: "MINIMUM", target: "90", manager_prize: { kind: "MONEY", cents: 5_000 } })),
    ).toMatchObject({ metric: "INDEX", scope: "ALL", mode: "MINIMUM", managerPrize: null, managerTarget: null });
    const r = challengeToRow({ ...input, metric: "INDEX", mode: "MINIMUM", target: 110.55, managerPrize: { kind: "MONEY", amount: 50 }, managerTarget: 105 });
    expect([r.metric, r.scope, r.mode, r.target]).toEqual(["INDEX", "ALL", "MINIMUM", 110.55]);
    expect(r.manager_prize).toEqual({ kind: "MONEY", cents: 5_000, target: 105 });
    expect(challengeFromRow({ ...r, id: "c1" } as ChallengeRow)).toMatchObject({
      mode: "MINIMUM",
      managerPrize: { kind: "MONEY", amount: 50 },
      managerTarget: 105,
    });
  });

  it("P.A./ticket gravam escopo ALL mesmo se vier outro", () => {
    expect(challengeToRow({ ...input, metric: "PA", scope: "CATEGORIES" }).scope).toBe("ALL");
  });
});
