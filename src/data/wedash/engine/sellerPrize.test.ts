import { describe, expect, it } from "vitest";
import type { GoalRecord, GoalTeamMember, SalesSellerDayAgg } from "./goalTypes.ts";
import { sellerGoalLevels, type SellerGoalLevel } from "./goalView.ts";
import { goalCeiling, nextLevelGain, projectedPrize } from "./sellerPrize.ts";

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

const ladder = goal.tiers.map((tier) => ({
  name: tier.name,
  minAttainmentPct: tier.minAttainmentPct,
  commissionPct: tier.commissionPct,
  bonus: tier.bonus,
}));

describe("goalCeiling", () => {
  const open = {
    open: true,
    achieved: 10_500,
    goalAmount: 10_000,
    prizeNow: 105,
    bonusNow: 50,
    currentPct: 1,
    groupSize: 1,
    tiers: ladder,
  };

  it("usa só o percentual do último nível e soma os bônus que ainda faltam", () => {
    const ceiling = goalCeiling(open);
    expect(ceiling.upside).toBeCloseTo(595);
    expect(ceiling.next).toMatchObject({ name: "Super", number: 2, gap: 1_500, prizeGain: 135, bonusGain: 100 });
  });

  it("sem vendas, o teto é a premiação do último nível mais todos os bônus", () => {
    const ceiling = goalCeiling({ ...open, achieved: 0, prizeNow: 0, bonusNow: 0, currentPct: 0 });
    expect(ceiling.upside).toBeCloseTo(750);
    expect(ceiling.next).toMatchObject({ name: "Meta", number: 1, gap: 10_000, prizeGain: 100, bonusGain: 50 });
  });

  it("no último nível não há mais nada a conquistar", () => {
    expect(goalCeiling({ ...open, achieved: 16_000, prizeNow: 480, bonusNow: 300, currentPct: 3 })).toEqual({ upside: 0, next: null });
  });

  it("meta encerrada não entra no potencial", () => {
    expect(goalCeiling({ ...open, open: false })).toEqual({ upside: 0, next: null });
  });

  it("modo Grupo: a parte dela no percentual final, e o bônus na fração que ela já recebe", () => {
    const ceiling = goalCeiling({ ...open, prizeNow: 52.5, bonusNow: 25, groupSize: 2 });
    expect(ceiling.upside).toBeCloseTo(297.5);
    expect(ceiling.next?.prizeGain).toBeCloseTo(67.5);
    expect(ceiling.next?.bonusGain).toBeCloseTo(50);
  });
});
