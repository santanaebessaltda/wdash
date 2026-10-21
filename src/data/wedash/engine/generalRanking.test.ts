import { describe, expect, it } from "vitest";
import { rankingOutsideGeneralGoal, teamViewWithGoalShare } from "./generalRanking";
import type { GoalRecord, GoalTeamMember, SalesDayAgg, SalesSellerDayAgg } from "./goalTypes";

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
    expect(out.kpis[1]?.amount).toBe("3");
    expect(out.shifts.reduce((sum, shift) => sum + shift.revenue, 0)).toBe(100);
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
    expect(out.people.map((person) => person.name)).toEqual(["Ana"]);
    expect(out.people[0]?.revenue).toBe(100);
    expect(out.kpis[0]?.amount).toBe("R$\u00a0100,00");
  });

  it("na meta Geral o ranking fica vazio e o KPI é o total da filial", () => {
    const out = teamViewWithGoalShare(scope, { dayAggs: [storeDay(8_000, 1, 1)], sellerDayAggs: [] }, [general], [], "2026-10-20");
    expect(out.people).toEqual([]);
    expect(out.kpis[0]?.amount).toBe("R$\u00a080,00");
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
