import { describe, expect, it } from "vitest";
import { rankingOutsideGeneralGoal, TEAM_UNATTRIBUTED_SALE, teamViewWithGoalShare, withActiveRoster } from "./generalRanking";
import type { GoalRecord, GoalTeamMember, SalesDayAgg, SalesSellerDayAgg } from "./goalTypes";
import type { TeamMemberRow } from "../dashboard";

const period = { kind: "custom" as const, start: "2026-10-01", end: "2026-10-31" };

const general: GoalRecord = {
  id: "g1",
  storeId: "f1",
  name: "Meta Outubro",
  startsOn: "2026-10-01",
  endsOn: "2026-10-31",
  target: 100_000,
  tierMode: "GENERAL",
  tiers: [{ name: "Meta", minAttainmentPct: 100, commissionPct: 1, bonus: 0 }],
  groups: [],
};

function sale(storeId: string, name: string, cents: number): SalesSellerDayAgg {
  return {
    tenantId: "t",
    storeId,
    day: "2026-10-10",
    sellerKey: name,
    sellerName: name,
    brand: "ALL",
    revenueCents: cents,
    salesCount: 1,
    itemCount: 1,
  };
}

describe("rankingOutsideGeneralGoal", () => {
  it("deixa o ranking vazio quando a filial do período está em meta Geral", () => {
    const out = rankingOutsideGeneralGoal(
      { storeIds: ["f1"], period, division: null },
      { dayAggs: [], sellerDayAggs: [sale("f1", "Ana", 15_000)] },
      [general],
      "2026-10-20",
    );
    expect(out.people).toEqual([]);
    expect(out.kpis[0]?.amount).toBe("R$\u00a0150,00");
  });

  it("em todas as lojas mantém quem vendeu fora da meta Geral", () => {
    const out = rankingOutsideGeneralGoal(
      { storeIds: ["f1", "f2"], period, division: null },
      { dayAggs: [], sellerDayAggs: [sale("f1", "Ana", 15_000), sale("f2", "Bia", 8_000)] },
      [general],
      "2026-10-20",
    );
    expect(out.people.map((person) => person.name)).toEqual(["Bia"]);
    expect(out.people[0]?.revenue).toBe(80);
  });

  it("não mexe no ranking quando a meta não é geral", () => {
    const out = rankingOutsideGeneralGoal(
      { storeIds: ["f1"], period, division: null },
      { dayAggs: [], sellerDayAggs: [sale("f1", "Ana", 15_000)] },
      [{ ...general, tierMode: "INDIVIDUAL" }],
      "2026-10-20",
    );
    expect(out.people.map((person) => person.name)).toEqual(["Ana"]);
  });

  it("meta Geral que ainda não começou continua no ranking", () => {
    const out = rankingOutsideGeneralGoal(
      { storeIds: ["f1"], period, division: null },
      { dayAggs: [], sellerDayAggs: [sale("f1", "Ana", 15_000)] },
      [general],
      "2026-09-20",
    );
    expect(out.people.map((person) => person.name)).toEqual(["Ana"]);
  });
});

const scope = { storeIds: ["f1"], period, division: null };

function member(employeeId: number, name: string): GoalTeamMember {
  return { storeId: "f1", employeeId, name, nameKeys: [name.toLowerCase()], salesPerson: true, shiftId: null, shiftName: null };
}

function seller(name: string, employeeId: number, cents: number): SalesSellerDayAgg {
  return { ...sale("f1", name, cents), sellerEmployeeId: employeeId };
}

function storeDay(cents: number, sales: number, items: number): SalesDayAgg {
  return { tenantId: "t", storeId: "f1", day: "2026-10-10", brand: "ALL", revenueCents: cents, salesCount: sales, itemCount: items };
}

describe("teamViewWithGoalShare", () => {
  const group: GoalRecord = { ...general, tierMode: "GROUP", spreadUnidentified: true };
  const team = [member(1, "Ana"), member(2, "Bia")];

  it("divide a venda sem vendedor no ranking e nos KPIs, e não no grupo", () => {
    const ana = seller("Ana", 1, 10_000);
    const out = teamViewWithGoalShare(
      scope,
      { dayAggs: [storeDay(30_000, 3, 3)], sellerDayAggs: [ana], namedSellerDayAggs: [ana] },
      [group],
      team,
      "2026-10-20",
    );
    expect(out.people.map((person) => [person.name, person.revenue, person.sales])).toEqual([
      ["Ana", 200, 2],
      ["BIA", 100, 1],
    ]);
    expect(out.people.reduce((sum, person) => sum + person.revenue, 0)).toBe(300);
    expect(out.kpis[0]?.amount).toBe("R$\u00a0300,00");
    expect(out.kpis[0]?.sub).toBe("2 pessoas · média de R$\u00a0150,00");
    expect(out.kpis[1]?.amount).toBe("3");
    expect(out.shifts.filter((shift) => shift.name !== TEAM_UNATTRIBUTED_SALE).reduce((sum, shift) => sum + shift.revenue, 0)).toBe(100);
    expect(out.shifts.find((shift) => shift.name === TEAM_UNATTRIBUTED_SALE)?.revenue).toBe(200);
  });

  it("não mostra sem grupo identificado quando a venda inteira tem vendedor", () => {
    const cents: number[] = [];
    for (let index = 0; index < 200; index += 1) cents.push(index % 2 ? 1 : 3);
    const total = cents.reduce((sum, value) => sum + value, 0);
    const sellers = cents.map((value, index) => seller(`P${index}`, index + 1, value));
    const out = teamViewWithGoalShare(
      scope,
      { dayAggs: [storeDay(total, sellers.length, sellers.length)], sellerDayAggs: sellers, namedSellerDayAggs: sellers },
      [],
      [],
      "2026-10-20",
    );
    expect(out.composition.unidentified).toBe(0);
    expect(out.shifts.some((shift) => shift.name === TEAM_UNATTRIBUTED_SALE)).toBe(false);
  });

  it("sem o rateio, a venda sem vendedor fica fora do ranking e dos KPIs", () => {
    const ana = seller("Ana", 1, 10_000);
    const out = teamViewWithGoalShare(
      scope,
      { dayAggs: [storeDay(30_000, 3, 3)], sellerDayAggs: [ana], namedSellerDayAggs: [ana] },
      [{ ...group, spreadUnidentified: false }],
      team,
      "2026-10-20",
    );
    // Bia ativa sem venda entra a R$ 0 no fim; o KPI continua só com quem vendeu.
    expect(out.people.map((person) => [person.name, person.revenue])).toEqual([
      ["Ana", 100],
      ["Bia", 0],
    ]);
    expect(out.kpis[0]?.amount).toBe("R$\u00a0100,00");
    expect(out.kpis[0]?.sub).toBe("1 pessoa · média de R$\u00a0100,00");
  });

  it("pessoa admitida sem venda aparece no ranking a R$ 0", () => {
    const ana = seller("Ana", 1, 10_000);
    const out = teamViewWithGoalShare(
      scope,
      { dayAggs: [storeDay(10_000, 1, 1)], sellerDayAggs: [ana], namedSellerDayAggs: [ana] },
      [{ ...group, spreadUnidentified: false }],
      [member(1, "Ana"), member(3, "Patricia")],
      "2026-10-20",
    );
    expect(out.people.map((person) => [person.name, person.revenue, person.sales])).toEqual([
      ["Ana", 100, 1],
      ["Patricia", 0, 0],
    ]);
    expect(out.kpis[0]?.sub).toBe("1 pessoa · média de R$\u00a0100,00");
  });

  it("na meta Geral o ranking divide o total da filial e a média conta a equipe", () => {
    const out = teamViewWithGoalShare(
      scope,
      { dayAggs: [storeDay(8_000, 2, 2)], sellerDayAggs: [] },
      [general],
      [member(1, "Ana"), member(2, "Bia")],
      "2026-10-20",
    );
    expect(out.people.map((person) => [person.name, person.revenue, person.sales])).toEqual([
      ["ANA", 40, 1],
      ["BIA", 40, 1],
    ]);
    expect(out.kpis[0]?.amount).toBe("R$\u00a080,00");
    expect(out.kpis[0]?.sub).toBe("2 pessoas · média de R$\u00a040,00");
    expect(out.kpis[1]?.amount).toBe("2");
    expect(out.kpis[2]?.amount).toBe("R$\u00a040,00");
  });

  it("a venda do usuário da filial não entra no rateio", () => {
    const ana = seller("Ana", 1, 10_000);
    const branch = seller("Caixa", 9, 5_000);
    const out = teamViewWithGoalShare(
      scope,
      { dayAggs: [storeDay(30_000, 3, 3)], sellerDayAggs: [ana], namedSellerDayAggs: [ana, branch] },
      [group],
      team,
      "2026-10-20",
    );
    expect(out.people.map((person) => [person.name, person.revenue])).toEqual([
      ["Ana", 175],
      ["BIA", 75],
    ]);
    expect(out.kpis[0]?.amount).toBe("R$\u00a0250,00");
  });
});

describe("withActiveRoster", () => {
  const row = (name: string, revenue: number, key = `e:${name}`): TeamMemberRow => ({
    key,
    name,
    storeIds: ["f1"],
    storeRows: ["Loja"],
    revenue,
    sales: revenue > 0 ? 1 : 0,
    items: revenue > 0 ? 1 : 0,
    averageTicket: revenue,
    pa: revenue > 0 ? 1 : null,
    participationPct: 0,
    variationPct: null,
    revenueCmp: 0,
    revenuePrev: 0,
  });

  it("coloca a pessoa ativa sem venda no fim e ignora desligada", () => {
    const out = withActiveRoster(
      [row("Ana", 100, "e:1")],
      [
        member(1, "Ana"),
        member(2, "Patricia"),
        { ...member(3, "Janiely"), salesPerson: false, active: false },
      ],
      ["f1"],
      new Map([["f1", "Loja"]]),
      "2026-10-31",
    );
    expect(out.map((person) => [person.name, person.revenue])).toEqual([
      ["Ana", 100],
      ["Patricia", 0],
    ]);
  });
});
