import { describe, expect, it } from "vitest";
import { rankingOutsideGeneralGoal } from "./generalRanking";
import type { GoalRecord } from "./goalTypes";
import type { SalesSellerDayAgg } from "./goalTypes";

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
