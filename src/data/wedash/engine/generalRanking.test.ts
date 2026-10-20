import { describe, expect, it } from "vitest";
import type { TeamDashboardView, TeamMemberRow } from "../dashboard";
import { rankingWithGeneralShare } from "./generalRanking";
import type { GoalRecord, GoalTeamMember, SalesDayAgg } from "./goalTypes";

const goal: GoalRecord = {
  id: "g1",
  storeId: "s1",
  name: "Meta Outubro",
  startsOn: "2026-10-01",
  endsOn: "2026-10-31",
  target: 100_000,
  tierMode: "GENERAL",
  tiers: [{ name: "Meta", minAttainmentPct: 100, commissionPct: 1, bonus: 0 }],
  groups: [],
};

function member(employeeId: number, name: string, salesPerson = true): GoalTeamMember {
  return {
    storeId: "s1",
    employeeId,
    name,
    nameKeys: [name],
    salesPerson,
    admittedOn: null,
    departedOn: null,
    shiftId: null,
    shiftName: null,
  };
}

function day(brl: number, salesCount: number, itemCount: number): SalesDayAgg {
  return {
    tenantId: "t",
    storeId: "s1",
    day: "2026-10-10",
    brand: "ALL",
    revenueCents: brl * 100,
    salesCount,
    itemCount,
  };
}

function view(people: TeamMemberRow[] = []): TeamDashboardView {
  return {
    scope: { storeIds: ["s1"], period: { kind: "thisMonth" }, division: null },
    period: {
      kind: "thisMonth",
      start: "2026-10-01",
      end: "2026-10-31",
      granularity: "day",
      spansMonths: false,
      isToday: false,
      endsToday: true,
    },
    kpis: [],
    people,
    shifts: [],
    shiftsConfigured: false,
    availableShifts: [],
    shiftFilter: null,
    composition: { team: 0, excluded: 8000, unidentified: 8000, branchUser: 0, management: 0, total: 8000 },
    vsVariation: "",
    multiStore: false,
  };
}

describe("rankingWithGeneralShare", () => {
  it("divide o total da filial entre a equipe quando a venda não tem vendedor", () => {
    const out = rankingWithGeneralShare(view(), {
      goals: [goal],
      team: [member(1, "Ana"), member(2, "Bia"), member(9, "Caixa", false)],
      dayAggs: [day(8000, 8, 16)],
      today: "2026-10-20",
      storeNames: new Map([["s1", "Centro"]]),
    });
    expect(out.people.map((person) => [person.name, person.revenue, person.sales, person.pa])).toEqual([
      ["ANA", 4000, 4, 2],
      ["BIA", 4000, 4, 2],
    ]);
    expect(out.people.every((person) => person.participationPct === 50)).toBe(true);
  });

  it("não mexe no ranking quando a meta não é geral", () => {
    const person: TeamMemberRow = {
      key: "e:1",
      name: "ANA",
      storeIds: ["s1"],
      storeRows: ["Centro"],
      revenue: 100,
      sales: 1,
      items: 1,
      averageTicket: 100,
      pa: 1,
      participationPct: 100,
      variationPct: null,
      revenueCmp: 0,
      revenuePrev: 0,
    };
    const out = rankingWithGeneralShare(view([person]), {
      goals: [{ ...goal, tierMode: "INDIVIDUAL" }],
      team: [member(1, "Ana"), member(2, "Bia")],
      dayAggs: [day(8000, 8, 16)],
      today: "2026-10-20",
      storeNames: new Map([["s1", "Centro"]]),
    });
    expect(out.people).toEqual([person]);
  });
});
