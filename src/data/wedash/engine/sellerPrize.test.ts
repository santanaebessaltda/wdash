import { describe, expect, it } from "vitest";
import type { GoalRecord, GoalTeamMember, SalesSellerDayAgg } from "./goalTypes.ts";
import { sellerGoalLevels, type SellerGoalLevel } from "./goalView.ts";
import { nextLevelGain, projectedPrize } from "./sellerPrize.ts";

const goal: GoalRecord = {
  id: "g1",
  storeId: "s1",
  name: "Meta setembro",
  startsOn: "2026-09-01",
  endsOn: "2026-09-30",
  target: 10_000,
  tierMode: "INDIVIDUAL",
  tiers: [
    { name: "Meta", minAttainmentPct: 100, commissionPct: 1, bonus: 50 },
    { name: "Super", minAttainmentPct: 120, commissionPct: 2, bonus: 100 },
    { name: "Hiper", minAttainmentPct: 150, commissionPct: 3, bonus: 150 },
  ],
  groups: [],
};
const group: GoalRecord = { ...goal, tierMode: "GROUP" };

const member = (employeeId: number, name: string): GoalTeamMember => ({
  storeId: "s1",
  employeeId,
  name,
  nameKeys: [name],
  salesPerson: true,
  shiftId: null,
  shiftName: null,
});
const ANA = member(1, "ANA");
const BIA = member(2, "BIA");

const sale = (employeeId: number, brl: number): SalesSellerDayAgg => ({
  tenantId: "t",
  storeId: "s1",
  day: "2026-09-10",
  sellerKey: `K${employeeId}`,
  sellerName: `K${employeeId}`,
  sellerEmployeeId: employeeId,
  brand: "ALL",
  revenueCents: brl * 100,
  salesCount: 1,
  itemCount: 1,
});

const levelOf = (g: GoalRecord, team: GoalTeamMember[], sales: SalesSellerDayAgg[]): SellerGoalLevel =>
  sellerGoalLevels({ goals: [g], dayAggs: [], sellerDayAggs: sales, team, today: "2026-09-15" }).get("e:1")!;

const UNIFORM = [1, 1, 1, 1, 1, 1, 1];

describe("nextLevelGain", () => {
  it("premiação no próximo nível sobre as vendas atuais − premiação agora + bônus do próximo nível", () => {
    const level = levelOf(goal, [ANA], [sale(1, 10_500)]);
    expect(level.prizeAmount).toBeCloseTo(105);
    expect(nextLevelGain(level, 1)).toBeCloseTo(205);
  });

  it("sem vendas: o ganho é o do 1º nível (só o bônus dele)", () => {
    expect(nextLevelGain(levelOf(goal, [ANA], []), 1)).toBeCloseTo(50);
  });

  it("no último nível não há ganho", () => {
    expect(nextLevelGain(levelOf(goal, [ANA], [sale(1, 16_000)]), 1)).toBeNull();
  });

  it("modo Grupo: premiação do grupo dividida pelas pessoas do grupo", () => {
    const level = levelOf(group, [ANA, BIA], [sale(1, 6_000), sale(2, 4_500)]);
    expect(level.prizeAmount).toBeCloseTo(52.5);
    expect(nextLevelGain(level, 2)).toBeCloseTo(152.5);
  });
});

describe("projectedPrize", () => {
  const level = levelOf(goal, [ANA], [sale(1, 7_000)]);

  it("null antes da metade do período; depois, premiação + bônus do nível projetado pelo ritmo", () => {
    expect(projectedPrize(goal, level, { today: "2026-09-15", weights: UNIFORM, soldUntilYesterday: 7_000, groupSize: 1 })).toBeNull();
    expect(projectedPrize(goal, level, { today: "2026-09-16", weights: UNIFORM, soldUntilYesterday: 7_000, groupSize: 1 })).toBeCloseTo(430);
    expect(projectedPrize(goal, level, { today: "2026-09-16", weights: UNIFORM, soldUntilYesterday: 4_000, groupSize: 1 })).toBe(0);
  });

  it("usa o peso dos dias da semana (loja fechada aos domingos)", () => {
    const withoutSunday = [0, 1, 1, 1, 1, 1, 1];
    expect(projectedPrize(goal, level, { today: "2026-09-15", weights: withoutSunday, soldUntilYesterday: 7_000, groupSize: 1 })).toBeNull();
    expect(projectedPrize(goal, level, { today: "2026-09-17", weights: withoutSunday, soldUntilYesterday: 7_000, groupSize: 1 })).toBeCloseTo(410);
  });

  it("modo Grupo: projeta o vendido do grupo e dá a parte da pessoa", () => {
    const g = levelOf(group, [ANA, BIA], [sale(1, 4_000), sale(2, 3_000)]);
    expect(projectedPrize(group, g, { today: "2026-09-16", weights: UNIFORM, soldUntilYesterday: 7_000, groupSize: 2 })).toBeCloseTo(290);
  });
});
