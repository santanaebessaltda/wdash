import { describe, expect, it } from "vitest";
import {
  buildChallengeView,
  challengeCardSummary,
  challengePayout,
  copyChallenge,
  copyChallengeToStore,
  metricValueLabel,
  performanceIndex,
  prizeLabel,
} from "./challengeView";
import { emptyChallengeAggInput, managerIndexWindows, type ChallengeAggInput, type ChallengeRecord } from "./challengesRepo";
import type { GoalTeamMember } from "./goalsRepo";
import type { SalesSellerDayAgg, SalesSellerProductDayAgg } from "./salesTypes";

const challenge = (over: Partial<ChallengeRecord> = {}): ChallengeRecord => ({
  id: "c1",
  storeId: "s1",
  name: "Body Splash — quem vender mais",
  startsOn: "2026-10-05",
  endsOn: "2026-10-11",
  metric: "QUANTITY",
  scope: "PRODUCTS",
  mode: "CONTEST",
  products: [{ code: "BS1", name: "BODY SPLASH 1" }],
  categories: [],
  target: null,
  minSales: null,
  prizes: [{ kind: "MONEY", amount: 100 }],
  managerPrize: null,
  managerTarget: null,
  ...over,
});

const member = (employeeId: number, name: string, over: Partial<GoalTeamMember> = {}): GoalTeamMember => ({
  storeId: "s1",
  employeeId,
  generatorId: employeeId + 1000,
  name,
  nameKeys: [name],
  salesPerson: true,
  shiftId: null,
  shiftName: null,
  ...over,
});

const item = (
  generatorId: number,
  productCode: string,
  itemCount: number,
  over: Partial<SalesSellerProductDayAgg> = {},
): SalesSellerProductDayAgg => ({
  tenantId: "t1",
  storeId: "s1",
  day: "2026-10-06",
  sellerGeneratorId: generatorId,
  sellerKey: "",
  sellerName: "",
  productCode,
  productId: 1,
  itemCount,
  revenueCents: itemCount * 5_000,
  ...over,
});

const sellerDay = (
  employeeId: number | null,
  salesCount: number,
  itemCount: number | undefined,
  revenueCents: number,
  over: Partial<SalesSellerDayAgg> = {},
): SalesSellerDayAgg => ({
  tenantId: "t1",
  storeId: "s1",
  day: "2026-10-06",
  sellerKey: over.sellerKey ?? "",
  sellerName: over.sellerName ?? "",
  sellerEmployeeId: employeeId,
  brand: "ALL",
  revenueCents,
  salesCount,
  itemCount,
  ...over,
});

const team = [member(1, "ANA"), member(2, "BIA"), member(3, "CAROL")];

const input = (over: Partial<ChallengeAggInput> = {}): ChallengeAggInput => ({
  ...emptyChallengeAggInput(),
  team,
  ...over,
});

const build = (c: ChallengeRecord, aggs: ChallengeAggInput, today = "2026-10-08") =>
  buildChallengeView({ challenge: c, aggs, today });

const byName = (v: ReturnType<typeof build>) => Object.fromEntries(v.participants.map((p) => [p.name, p]));

describe("buildChallengeView — participantes e resultado", () => {
  it("Produtos: soma só os produtos escolhidos, por pessoa (gerador → cadastro)", () => {
    const v = build(
      challenge({ products: [{ code: "BS1", name: "A" }, { code: "BS2", name: "B" }] }),
      input({ sellerProducts: [item(1001, "BS1", 3), item(1001, "BS2", 2), item(1001, "OUTRO", 9), item(1002, "BS1", 1)] }),
    );
    const p = byName(v);
    expect(p.ANA.result).toBe(5);
    expect(p.BIA.result).toBe(1);
    expect(p.CAROL.result).toBe(0);
    expect(v.participants).toHaveLength(3);
  });

  it("Categorias: soma os itens cujo tipo no catálogo está entre os escolhidos", () => {
    const v = build(
      challenge({ scope: "CATEGORIES", products: [], categories: [{ typeId: 14, name: "BODY SPLASH" }] }),
      input({
        sellerProducts: [item(1001, "BS1", 3), item(1001, "PERF", 4), item(1002, "BS2", 2)],
        typeByCode: new Map([
          ["BS1", 14],
          ["BS2", 14],
          ["PERF", 13],
        ]),
      }),
    );
    expect(byName(v).ANA.result).toBe(3);
    expect(byName(v).BIA.result).toBe(2);
  });

  it("Valor dos produtos escolhidos = R$ desses produtos, por pessoa", () => {
    const v = build(
      challenge({ metric: "VALUE", products: [{ code: "BS1", name: "A" }] }),
      input({ sellerProducts: [item(1001, "BS1", 3), item(1001, "OUTRO", 9), item(1002, "BS1", 1, { revenueCents: 4_990 })] }),
    );
    expect(byName(v).ANA.result).toBe(150);
    expect(byName(v).BIA.result).toBe(49.9);
  });

  it("Tudo o que vender: Quantidade = itens das vendas; Valor = faturamento da pessoa", () => {
    const aggs = input({
      sellerDays: [sellerDay(1, 10, 19, 92_300), sellerDay(1, 5, 8, 40_000, { day: "2026-10-07" }), sellerDay(2, 3, 6, 30_000)],
      sellerProducts: [item(1001, "BS1", 99)],
    });
    const qty = byName(build(challenge({ scope: "ALL", products: [] }), aggs));
    expect(qty.ANA.result).toBe(27);
    expect(qty.BIA.result).toBe(6);
    const amount = byName(build(challenge({ metric: "VALUE", scope: "ALL", products: [] }), aggs));
    expect(amount.ANA.result).toBe(1323);
    expect(amount.BIA.result).toBe(300);
  });

  it("Quantidade de tudo sem itens gravados em algum dia com venda = \"—\" e não concorre", () => {
    const v = build(
      challenge({ scope: "ALL", products: [] }),
      input({ sellerDays: [sellerDay(1, 10, 20, 100_000), sellerDay(1, 4, 0, 30_000, { day: "2026-10-07" }), sellerDay(2, 5, 7, 40_000)] }),
    );
    expect(byName(v).ANA.result).toBeNull();
    expect(byName(v).ANA.winner).toBe(false);
    expect(byName(v).BIA.winner).toBe(true);
  });

  it("P.A. = itens ÷ vendas e Ticket = faturamento ÷ vendas (2 casas)", () => {
    const aggs = input({
      sellerDays: [sellerDay(1, 10, 19, 92_300), sellerDay(1, 5, 8, 40_000, { day: "2026-10-07" }), sellerDay(2, 3, 6, 30_000)],
    });
    const pa = byName(build(challenge({ metric: "PA", products: [], minSales: 1 }), aggs));
    expect(pa.ANA.result).toBe(1.8);
    expect(pa.ANA.sales).toBe(15);
    expect(pa.BIA.result).toBe(2);
    const ticket = byName(build(challenge({ metric: "TICKET", products: [], minSales: 1 }), aggs));
    expect(ticket.ANA.result).toBe(88.2);
  });

  it("Índice de desempenho: 50% faturamento + 25% ticket + 25% P.A., vs a média simples de quem vendeu (média dos índices = 100)", () => {
    const v = build(
      challenge({ metric: "INDEX", scope: "ALL", products: [], minSales: 1, target: 100 }),
      input({ sellerDays: [sellerDay(1, 10, 20, 100_000), sellerDay(2, 20, 30, 120_000)] }),
    );
    const p = byName(v);
    expect(p.ANA.result).toBe(105.28);
    expect(p.BIA.result).toBe(94.72);
    expect((p.ANA.result ?? 0) + (p.BIA.result ?? 0)).toBeCloseTo(200);
    expect(p.CAROL.result).toBe(0);
    expect(p.ANA.winner).toBe(false);
    expect(p.ANA.gap).toBe("O índice só vale no fim do desafio");
    const end = byName(
      build(
        challenge({ metric: "INDEX", scope: "ALL", products: [], minSales: 1, target: 100 }),
        input({ sellerDays: [sellerDay(1, 10, 20, 100_000), sellerDay(2, 20, 30, 120_000)] }),
        "2026-10-12",
      ),
    );
    expect(end.ANA.winner).toBe(true);
    expect(end.ANA.gap).toBeNull();
    expect(metricValueLabel("INDEX", 111.9)).toBe("111,9");
  });

  it("Índice de desempenho: situação em pontos", () => {
    const aggs = input({ sellerDays: [sellerDay(1, 10, 20, 100_000), sellerDay(2, 20, 30, 120_000)] });
    const disputa = byName(build(challenge({ metric: "INDEX", scope: "ALL", products: [], minSales: 1 }), aggs));
    expect(disputa.BIA.gap).toBe("Faltam 10,6 pontos para o 1º lugar");
    const floor = byName(build(challenge({ metric: "INDEX", scope: "ALL", products: [], minSales: 1, target: 100 }), aggs));
    expect(floor.BIA.gap).toBe("Faltam 5,3 pontos para o mínimo");
  });

  it("Índice de desempenho = \"—\" para todos se alguém que vendeu tem dia sem itens", () => {
    const v = build(
      challenge({ metric: "INDEX", scope: "ALL", products: [], minSales: 1 }),
      input({ sellerDays: [sellerDay(1, 10, 20, 100_000), sellerDay(2, 5, 0, 40_000)] }),
    );
    expect(byName(v).ANA.result).toBeNull();
    expect(byName(v).BIA.result).toBeNull();
    expect(v.participants.some((x) => x.winner)).toBe(false);
  });

  it("Índice: gerência pelo índice da equipe × o mesmo nº de dias antes do desafio (em andamento, até ontem)", () => {
    const aggs = input({
      sellerDays: [
        sellerDay(1, 10, 20, 100_000),
        sellerDay(2, 20, 30, 120_000),
        // hoje (parcial) nao entra
        sellerDay(1, 50, 50, 900_000, { day: "2026-10-08" }),
        sellerDay(1, 10, 15, 80_000, { day: "2026-09-29" }),
        sellerDay(2, 10, 20, 120_000, { day: "2026-09-29" }),
        // fora dos 3 dias comparados (28/09 a 30/09)
        sellerDay(2, 50, 50, 900_000, { day: "2026-10-02" }),
      ],
    });
    const c = (managerTarget: number) =>
      challenge({ metric: "INDEX", scope: "ALL", products: [], minSales: 1, managerPrize: { kind: "MONEY", amount: 80 }, managerTarget });
    // 100 x (0,5 x 110.000/100.000 + 0,25 x 8.000/10.000 + 0,25 x 1,75/1,75) = 100
    expect(build(c(100), aggs).management).toMatchObject({
      result: 100,
      target: 100,
      periodPrevious: { from: "2026-09-28", to: "2026-10-04" },
      atingiu: false,
    });
    expect(build(c(100), aggs).teamAverage).toBe(100);
    expect(build(challenge({ metric: "INDEX", scope: "ALL", products: [] }), aggs).teamAverage).toBeNull();
    expect(build(c(101), aggs).management).toMatchObject({ result: 100, atingiu: false });
    expect(build(c(100), aggs, "2026-10-05").management).toMatchObject({ result: null, atingiu: false });
    const closed = build(
      challenge({
        metric: "INDEX",
        scope: "ALL",
        products: [],
        startsOn: "2026-10-05",
        endsOn: "2026-10-06",
        managerPrize: { kind: "MONEY", amount: 80 },
        managerTarget: 150,
      }),
      input({
        sellerDays: [
          sellerDay(1, 10, 20, 200_000, { day: "2026-10-05" }),
          sellerDay(1, 10, 20, 100_000, { day: "2026-10-03" }),
        ],
      }),
      "2026-10-06",
    );
    expect(closed.management).toMatchObject({ result: 175, atingiu: false });
    expect(build(
      challenge({
        metric: "INDEX",
        scope: "ALL",
        products: [],
        startsOn: "2026-10-05",
        endsOn: "2026-10-06",
        managerPrize: { kind: "MONEY", amount: 80 },
        managerTarget: 150,
      }),
      input({
        sellerDays: [
          sellerDay(1, 10, 20, 200_000, { day: "2026-10-05" }),
          sellerDay(1, 10, 20, 100_000, { day: "2026-10-03" }),
        ],
      }),
      "2026-10-07",
    ).management).toMatchObject({ result: 175, atingiu: true });
    const withoutPrevious = input({ sellerDays: [sellerDay(1, 10, 20, 100_000)] });
    expect(build(c(100), withoutPrevious).management?.result).toBeNull();
  });

  it("managerIndexWindows: período anterior inteiro e janelas comparadas até ontem", () => {
    const c = { startsOn: "2026-10-05", endsOn: "2026-10-11" };
    expect(managerIndexWindows(c, "2026-10-08")).toEqual({
      previous: { from: "2026-09-28", to: "2026-10-04" },
      current: { from: "2026-10-05", to: "2026-10-07" },
      comparado: { from: "2026-09-28", to: "2026-09-30" },
    });
    expect(managerIndexWindows(c, "2026-10-20").comparado).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(managerIndexWindows(c, "2026-10-05").current).toBeNull();
  });

  it("performanceIndex: na média da equipe = 100", () => {
    expect(performanceIndex({ revenue: 90_000, sales: 10, items: 17.5 }, { revenueAverage: 90_000, ticket: 9_000, pa: 1.75 })).toBeCloseTo(100);
    expect(performanceIndex({ revenue: 0, sales: 0, items: 0 }, { revenueAverage: 1, ticket: 1, pa: 1 })).toBe(0);
  });

  it("P.A. sem itens gravados em algum dia com venda = \"—\" e não concorre", () => {
    const v = build(
      challenge({ metric: "PA", products: [], minSales: 1 }),
      input({ sellerDays: [sellerDay(1, 10, 20, 100_000), sellerDay(1, 4, 0, 30_000, { day: "2026-10-07" }), sellerDay(2, 5, 7, 40_000)] }),
    );
    const p = byName(v);
    expect(p.ANA.result).toBeNull();
    expect(p.ANA.winner).toBe(false);
    expect(p.ANA.position).toBeNull();
    expect(p.BIA.position).toBe(1);
    expect(p.BIA.winner).toBe(false);
    expect(p.BIA.gap).toBe("O P.A. só vale no fim do desafio");
    const end = byName(
      build(
        challenge({ metric: "PA", products: [], minSales: 1 }),
        input({ sellerDays: [sellerDay(1, 10, 20, 100_000), sellerDay(1, 4, 0, 30_000, { day: "2026-10-07" }), sellerDay(2, 5, 7, 40_000)] }),
        "2026-10-12",
      ),
    );
    expect(end.BIA.winner).toBe(true);
  });

  it("mínimo proporcional aos dias presentes; disputa continua pelo valor bruto", () => {
    const days = [
      sellerDay(1, 1, 30, 1, { day: "2026-10-06" }),
      sellerDay(2, 1, 30, 1, { day: "2026-10-09" }),
    ];
    const minimum = build(
      challenge({ mode: "MINIMUM", metric: "QUANTITY", scope: "ALL", products: [], target: 70, prizes: [{ kind: "MONEY", amount: 50 }] }),
      input({
        team: [member(1, "ANA"), member(2, "BIA", { admittedOn: "2026-10-09" })],
        sellerDays: days,
      }),
      "2026-10-12",
    );
    const p = byName(minimum);
    expect(p.ANA.winner).toBe(false);
    expect(p.BIA.winner).toBe(true);
    expect(p.BIA.eligibleDays).toBe(3);
    expect(p.BIA.periodDays).toBe(7);
    const contest = build(
      challenge({ mode: "CONTEST", metric: "QUANTITY", scope: "ALL", products: [], target: null }),
      input({
        team: [member(1, "ANA"), member(2, "BIA", { admittedOn: "2026-10-09" })],
        sellerDays: days,
      }),
      "2026-10-12",
    );
    expect(byName(contest).ANA.result).toBe(30);
    expect(byName(contest).BIA.result).toBe(30);
    expect(byName(contest).ANA.position).toBe(1);
  });

  it("pessoa desligada que vendeu continua na tabela; quem não é da equipe e não vendeu fica de fora", () => {
    const v = build(
      challenge(),
      input({
        team: [...team, member(4, "DORA", { salesPerson: false }), member(5, "EVA", { salesPerson: false })],
        sellerProducts: [item(1004, "BS1", 2)],
      }),
    );
    expect(v.participants.map((p) => p.name).sort()).toEqual(["ANA", "BIA", "CAROL", "DORA"]);
    expect(byName(v).DORA.result).toBe(2);
  });

  it("pessoa sem cadastro entra pelo nome do relatório", () => {
    const v = build(challenge(), input({ sellerProducts: [item(9999, "BS1", 4, { sellerKey: "JULIA SOUZA", sellerName: "Julia Souza" })] }));
    expect(byName(v)["JULIA SOUZA"]?.result).toBe(4);
  });

  it("só conta a loja e o período do desafio", () => {
    const v = build(
      challenge(),
      input({
        sellerProducts: [
          item(1001, "BS1", 3),
          item(1001, "BS1", 5, { storeId: "s2" }),
          item(1001, "BS1", 7, { day: "2026-10-04" }),
        ],
      }),
    );
    expect(byName(v).ANA.result).toBe(3);
  });

  it("loja sem equipe e sem vendas = nenhum participante", () => {
    expect(build(challenge(), input({ team: [] })).participants).toEqual([]);
  });

  it("A começar: participantes sem resultado e prazo \"Começa em DD/MM\"", () => {
    const v = build(challenge(), input({ sellerProducts: [item(1001, "BS1", 3)] }), "2026-10-01");
    expect(v.status).toBe("upcoming");
    expect(v.prazo).toBe("Começa em 05/10");
    expect(v.participants.every((p) => p.result == null && !p.winner && p.gap == null)).toBe(true);
    expect(v.participants.map((p) => p.name)).toEqual(["ANA", "BIA", "CAROL"]);
  });
});

describe("buildChallengeView — Disputa e Mínimo", () => {
  it("Disputa: posições com empate compartilhado (1, 1, 3) e empatadas levam o prêmio", () => {
    const v = build(
      challenge({ prizes: [{ kind: "MONEY", amount: 100 }, { kind: "ITEM", label: "Combo KFC" }] }),
      input({ sellerProducts: [item(1001, "BS1", 5), item(1002, "BS1", 5), item(1003, "BS1", 2)] }),
    );
    const p = byName(v);
    expect([p.ANA.position, p.BIA.position, p.CAROL.position]).toEqual([1, 1, 3]);
    expect(p.ANA.prize).toEqual({ kind: "MONEY", amount: 100 });
    expect(p.BIA.prize).toEqual({ kind: "MONEY", amount: 100 });
    expect(p.CAROL.winner).toBe(false);
    expect(v.participants.map((x) => x.name)).toEqual(["ANA", "BIA", "CAROL"]);
  });

  it("Disputa só com prêmio do 1º: o 2º lugar não leva nada", () => {
    const p = byName(build(challenge(), input({ sellerProducts: [item(1001, "BS1", 5), item(1002, "BS1", 3)] })));
    expect(p.ANA.winner).toBe(true);
    expect(p.BIA.position).toBe(2);
    expect(p.BIA.winner).toBe(false);
    expect(p.BIA.prize).toBeNull();
  });

  it("Mínimo: todas que atingem levam o mesmo prêmio; abaixo do alvo não", () => {
    const v = build(
      challenge({ mode: "MINIMUM", target: 4, prizes: [{ kind: "ITEM", label: "Combo KFC" }] }),
      input({ sellerProducts: [item(1001, "BS1", 4), item(1002, "BS1", 6), item(1003, "BS1", 3)] }),
    );
    const p = byName(v);
    expect([p.ANA.winner, p.BIA.winner, p.CAROL.winner]).toEqual([true, true, false]);
    expect(p.ANA.prize).toEqual({ kind: "ITEM", label: "Combo KFC" });
    expect(v.participants.map((x) => x.name)).toEqual(["BIA", "ANA", "CAROL"]);
    expect(v.participants.every((x) => x.position == null)).toBe(true);
  });

  it("Disputa: resultado zero nunca vence", () => {
    const v = build(challenge(), input({ sellerProducts: [] }));
    expect(v.participants.every((p) => !p.winner && p.position == null)).toBe(true);
  });

  it("Disputa: abaixo do piso não leva prêmio mesmo em 1º", () => {
    const v = build(challenge({ target: 10 }), input({ sellerProducts: [item(1001, "BS1", 8)] }));
    expect(byName(v).ANA.position).toBe(1);
    expect(byName(v).ANA.winner).toBe(false);
  });

  it("Disputa de ticket: quem não tem o mínimo de vendas não concorre e não tira o prêmio de quem tem", () => {
    const v = build(
      challenge({ metric: "TICKET", products: [], minSales: 10 }),
      input({ sellerDays: [sellerDay(1, 2, 2, 100_000), sellerDay(2, 12, 15, 120_000)] }),
    );
    const p = byName(v);
    expect(p.ANA.position).toBeNull();
    expect(p.ANA.winner).toBe(false);
    expect(p.ANA.gap).toBe("Faltam 8 vendas para participar");
    expect(p.BIA.position).toBe(1);
    expect(p.BIA.winner).toBe(false);
    expect(p.BIA.gap).toBe("O ticket médio só vale no fim do desafio");
    const end = byName(
      build(
        challenge({ metric: "TICKET", products: [], minSales: 10 }),
        input({ sellerDays: [sellerDay(1, 2, 2, 100_000), sellerDay(2, 12, 15, 120_000)] }),
        "2026-10-12",
      ),
    );
    expect(end.BIA.winner).toBe(true);
    expect(end.BIA.gap).toBeNull();
  });

  it("Mínimo de P.A.: em andamento não marca Atingiu; no fim, 1,90 com 10 vendas atinge e 2,0 com 8 vendas não", () => {
    const c = challenge({ metric: "PA", mode: "MINIMUM", products: [], target: 1.9, minSales: 10, prizes: [{ kind: "MONEY", amount: 50 }] });
    const aggs = input({ sellerDays: [sellerDay(1, 8, 16, 50_000), sellerDay(2, 10, 19, 60_000)] });
    const progress = byName(build(c, aggs));
    expect(progress.ANA.winner).toBe(false);
    expect(progress.ANA.gap).toBe("Faltam 2 vendas para participar");
    expect(progress.BIA.result).toBe(1.9);
    expect(progress.BIA.winner).toBe(false);
    expect(progress.BIA.prize).toBeNull();
    expect(progress.BIA.gap).toBe("O P.A. só vale no fim do desafio");
    expect(build(c, aggs).reachedCount).toBe(0);

    const end = byName(build(c, aggs, "2026-10-12"));
    expect(end.ANA.winner).toBe(false);
    expect(end.BIA.winner).toBe(true);
    expect(end.BIA.prize).toEqual({ kind: "MONEY", amount: 50 });
    expect(build(c, aggs, "2026-10-12").reachedCount).toBe(1);
  });

  it("falta em andamento: Mínimo → para o alvo; Disputa → para a posição de cima ou para o piso", () => {
    const minimum = byName(
      build(
        challenge({ mode: "MINIMUM", target: 15, prizes: [{ kind: "ITEM", label: "Pizza" }] }),
        input({ sellerProducts: [item(1001, "BS1", 12), item(1002, "BS1", 14)] }),
      ),
    );
    expect(minimum.ANA.gap).toBe("Faltam 3 itens para o mínimo");
    expect(minimum.BIA.gap).toBe("Falta 1 item para o mínimo");

    const disputa = byName(build(challenge(), input({ sellerProducts: [item(1001, "BS1", 10), item(1002, "BS1", 7)] })));
    expect(disputa.ANA.gap).toBeNull();
    expect(disputa.BIA.gap).toBe("Faltam 3 itens para o 1º lugar");
    expect(disputa.CAROL.gap).toBe("Faltam 7 itens para o 2º lugar");

    const floor = byName(build(challenge({ target: 12 }), input({ sellerProducts: [item(1001, "BS1", 10)] })));
    expect(floor.ANA.gap).toBe("Faltam 2 itens para o mínimo");

    const ticket = byName(
      build(
        challenge({ metric: "TICKET", mode: "MINIMUM", products: [], target: 100, minSales: 1 }),
        input({ sellerDays: [sellerDay(1, 4, 4, 35_000)] }),
      ),
    );
    expect(ticket.ANA.gap).toBe(`Faltam R$\u00a012,50 de ticket médio para o mínimo`);

    const above = byName(
      build(
        challenge({ metric: "TICKET", mode: "MINIMUM", products: [], target: 80, minSales: 1 }),
        input({ sellerDays: [sellerDay(1, 4, 4, 40_000)] }),
      ),
    );
    expect(above.ANA.result).toBe(100);
    expect(above.ANA.winner).toBe(false);
    expect(above.ANA.gap).toBe("O ticket médio só vale no fim do desafio");
  });

  it("encerrado não mostra o que falta", () => {
    const v = build(challenge(), input({ sellerProducts: [item(1001, "BS1", 10), item(1002, "BS1", 7)] }), "2026-10-15");
    expect(v.participants.every((p) => p.gap == null)).toBe(true);
  });
});

describe("buildChallengeView — gerência, incompleto e status", () => {
  it("gerência em itens = Σ itens ÷ participantes, contra a meta da gerência (não o alvo das vendedoras)", () => {
    const c = (managerTarget: number) =>
      challenge({
        mode: "MINIMUM",
        target: 3,
        prizes: [{ kind: "MONEY", amount: 20 }],
        managerPrize: { kind: "ITEM", label: "Spa" },
        managerTarget,
      });
    const aggs = input({ sellerProducts: [item(1001, "BS1", 5), item(1002, "BS1", 4)] });
    expect(build(c(3), aggs).management).toEqual({ result: 3, target: 3, periodPrevious: null, atingiu: true, prize: { kind: "ITEM", label: "Spa" } });
    const v = build(c(4), aggs);
    expect(v.management).toMatchObject({ result: 3, target: 4, atingiu: false });
    expect(v.teamAverage).toBe(3);
    expect(v.reachedCount).toBe(2);
    const semGerencia = build(challenge(), aggs);
    expect(semGerencia.management).toBeNull();
    expect(semGerencia.teamAverage).toBe(3);
  });

  it("gerência em Valor = Σ R$ ÷ participantes", () => {
    const v = build(
      challenge({ metric: "VALUE", managerPrize: { kind: "MONEY", amount: 80 }, managerTarget: 100 }),
      input({ sellerProducts: [item(1001, "BS1", 4), item(1002, "BS1", 2)] }),
    );
    expect(v.management).toMatchObject({ result: 100, target: 100, atingiu: true });
  });

  it("gerência em P.A. = Σ itens ÷ Σ vendas da equipe; Atingiu só no fim", () => {
    const c = challenge({ metric: "PA", products: [], minSales: 1, managerPrize: { kind: "MONEY", amount: 80 }, managerTarget: 2 });
    const aggs = input({ sellerDays: [sellerDay(1, 10, 25, 100_000), sellerDay(2, 10, 15, 100_000)] });
    expect(build(c, aggs).management).toMatchObject({ result: 2, target: 2, atingiu: false });
    expect(build(c, aggs, "2026-10-12").management).toMatchObject({ result: 2, target: 2, atingiu: true });
  });

  it("gerência em ticket abaixo da meta não atinge", () => {
    const v = build(
      challenge({
        metric: "TICKET",
        mode: "MINIMUM",
        products: [],
        target: 80,
        minSales: 1,
        managerPrize: { kind: "MONEY", amount: 50 },
        managerTarget: 100,
      }),
      input({ sellerDays: [sellerDay(1, 10, 10, 120_000), sellerDay(2, 10, 10, 60_000)] }),
    );
    expect(v.management).toMatchObject({ result: 90, target: 100, atingiu: false });
    expect(challengePayout(v).management).toBeNull();
  });

  it("gerência em desafio a começar fica sem resultado", () => {
    const v = build(challenge({ managerPrize: { kind: "MONEY", amount: 50 }, managerTarget: 2 }), input(), "2026-10-01");
    expect(v.management).toMatchObject({ result: null, atingiu: false });
  });

  it("gerência sem meta não existe", () => {
    const v = build(challenge({ target: 5, managerPrize: { kind: "MONEY", amount: 80 } }), input());
    expect(v.management).toBeNull();
  });

  it("incompleto: dia com venda da loja e sem itens por pessoa (só Produtos/Categorias, até hoje)", () => {
    const aggs = input({
      sellerProducts: [item(1001, "BS1", 1, { day: "2026-10-06" })],
      storeSaleDays: new Set(["s1|2026-10-05", "s1|2026-10-06", "s1|2026-10-08", "s1|2026-10-09", "s2|2026-10-07"]),
    });
    expect(build(challenge(), aggs).daysIncomplete).toEqual(["2026-10-05", "2026-10-08"]);
    expect(build(challenge({ metric: "PA", products: [], minSales: 1 }), aggs).daysIncomplete).toEqual([]);
    expect(build(challenge({ scope: "ALL", products: [] }), aggs).daysIncomplete).toEqual([]);
  });

  it("prazo e fechamento: em andamento, último dia, encerrado e fechamento em andamento até o dia seguinte", () => {
    const c = challenge();
    expect(build(c, input(), "2026-10-08").prazo).toBe("4 dias restantes");
    expect(build(c, input(), "2026-10-11").prazo).toBe("Último dia");
    const end = build(c, input(), "2026-10-12");
    expect([end.status, end.prazo, end.emClosing]).toEqual(["ended", "Encerrado", true]);
    expect(build(c, input(), "2026-10-13").emClosing).toBe(false);
  });
});

describe("fechamento, card e duplicar", () => {
  it("fechamento: empate no 1º soma os dois prêmios; prêmio em espécie fica fora do total", () => {
    const c = challenge({
      prizes: [{ kind: "MONEY", amount: 100 }, { kind: "ITEM", label: "Combo KFC" }],
      target: 1,
      managerPrize: { kind: "MONEY", amount: 30 },
      managerTarget: 1,
    });
    const v = build(c, input({ sellerProducts: [item(1001, "BS1", 5), item(1002, "BS1", 5), item(1003, "BS1", 2)] }), "2026-10-15");
    const pay = challengePayout(v);
    expect(pay.vencedores.map((w) => [w.name, w.rank, prizeLabel(w.prize)])).toEqual([
      ["ANA", "1º lugar", "R$\u00a0100,00"],
      ["BIA", "1º lugar", "R$\u00a0100,00"],
    ]);
    expect(pay.management).toEqual({ kind: "MONEY", amount: 30 });
    expect(pay.totalBrl).toBe(230);
    expect(pay.especie).toEqual([]);
  });

  it("fechamento: Mínimo lista \"Atingiu\" e conta espécie pelo nome", () => {
    const c = challenge({ mode: "MINIMUM", target: 3, prizes: [{ kind: "ITEM", label: "Pizza" }] });
    const v = build(c, input({ sellerProducts: [item(1001, "BS1", 5), item(1002, "BS1", 4)] }), "2026-10-15");
    const pay = challengePayout(v);
    expect(pay.vencedores.map((w) => w.rank)).toEqual(["Ganhou", "Ganhou"]);
    expect(pay.totalBrl).toBe(0);
    expect(pay.especie).toEqual(["Pizza", "Pizza"]);
  });

  it("fechamento sem vencedor", () => {
    expect(challengePayout(build(challenge(), input(), "2026-10-15")).vencedores).toEqual([]);
  });

  it("card: líder(es) na Disputa e \"N atingiram\" no Mínimo", () => {
    const disputa = build(challenge(), input({ sellerProducts: [item(1001, "BS1", 5), item(1002, "BS1", 5)] }));
    expect(challengeCardSummary(disputa)).toEqual({ leader: "ANA e BIA", reachedCount: null });
    expect(challengeCardSummary(build(challenge(), input()))).toEqual({ leader: null, reachedCount: null });
    const minimum = build(
      challenge({ mode: "MINIMUM", target: 3, prizes: [{ kind: "ITEM", label: "Pizza" }] }),
      input({ sellerProducts: [item(1001, "BS1", 5)] }),
    );
    expect(challengeCardSummary(minimum)).toEqual({ leader: null, reachedCount: 1 });
  });

  it("duplicar: período seguinte com a mesma duração e nome \"(cópia)\"", () => {
    const c = challenge({ target: 10, managerPrize: { kind: "ITEM", label: "Spa" }, managerTarget: 15 });
    const { id: _id, ...rest } = c;
    expect(copyChallenge(c)).toEqual({ ...rest, name: "Body Splash — quem vender mais (cópia)", startsOn: "2026-10-12", endsOn: "2026-10-18" });
  });

  it("duplicar para outra loja: mesmas datas e nome", () => {
    const c = challenge({ target: 10, managerPrize: { kind: "ITEM", label: "Spa" }, managerTarget: 15 });
    const { id: _id, ...rest } = c;
    expect(copyChallengeToStore(c)).toEqual({
      ...rest,
      products: c.products.map((p) => ({ ...p })),
      categories: c.categories.map((t) => ({ ...t })),
      prizes: c.prizes.map((p) => ({ ...p })),
      managerPrize: { kind: "ITEM", label: "Spa" },
    });
  });

  it("rótulos de valor por métrica", () => {
    expect(metricValueLabel("QUANTITY", 12)).toBe("12 itens");
    expect(metricValueLabel("QUANTITY", 1)).toBe("1 item");
    expect(metricValueLabel("QUANTITY", 7.5)).toBe("7,5 itens");
    expect(metricValueLabel("VALUE", 1500)).toBe("R$\u00a01.500,00");
    expect(metricValueLabel("PA", 1.85)).toBe("1,85");
    expect(metricValueLabel("TICKET", 92.3)).toBe("R$\u00a092,30");
    expect(prizeLabel({ kind: "ITEM", label: "Combo KFC" })).toBe("Combo KFC");
  });
});
