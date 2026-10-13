import { describe, expect, it } from "vitest";
import type { GoalRecord, GoalTeamMember, SalesSellerDayAgg } from "./goalTypes.ts";
import { buildGoalCardView } from "./goalView.ts";
import { buildSellerRanking, type SellerRanking } from "./sellerRanking.ts";

const goal: GoalRecord = {
  id: "g1",
  storeId: "s1",
  name: "Meta setembro",
  startsOn: "2026-09-01",
  endsOn: "2026-09-30",
  target: 12_000,
  tierMode: "INDIVIDUAL",
  tiers: [
    { name: "Meta", minAttainmentPct: 100, commissionPct: 1, bonus: 50 },
    { name: "Super", minAttainmentPct: 120, commissionPct: 2, bonus: 100 },
  ],
  groups: [],
};

const member = (employeeId: number, name: string, shiftId: string | null = null): GoalTeamMember => ({
  storeId: "s1",
  employeeId,
  name,
  nameKeys: [name],
  salesPerson: true,
  shiftId,
  shiftName: shiftId ? shiftId.toUpperCase() : null,
});

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

const ranking = (g: GoalRecord, team: GoalTeamMember[], sales: SalesSellerDayAgg[], meKey: string): SellerRanking =>
  buildSellerRanking(buildGoalCardView({ goal: g, storeNameValue: "LOJA", dayAggs: [], sellerDayAggs: sales, team, today: "2026-09-15" }), meKey);

const rows = (r: SellerRanking) => r.entries.map((e) => [e.position, e.name, Math.round(e.pct * 100) / 100, e.level, e.me]);

describe("buildSellerRanking", () => {
  it("orders by individual % of the goal, highlights the seller and gives the gap to the person above", () => {
    const team = [member(1, "ANA"), member(2, "BIA"), member(3, "CAU"), member(4, "DUDA")];
    const r = ranking(goal, team, [sale(1, 1_500), sale(2, 3_600), sale(3, 3_000)], "e:1");
    expect(rows(r)).toEqual([
      [1, "BIA", 120, "N2 · Super", false],
      [2, "CAU", 100, "N1 · Meta", false],
      [3, "ANA", 50, null, true],
      [4, "DUDA", 0, null, false],
    ]);
    expect(r.entries.find((e) => e.me)!.position).toBe(3);
    expect(r.entries.length).toBe(4);
    expect(r.gapPp).toBeCloseTo(50);
    expect(r.abovePosition).toBe(2);
  });

  it("gives the same position to the same % (1, 1, 3) and no gap to a seller tied in 1st", () => {
    const g = { ...goal, target: 9_000 };
    const team = [member(1, "ANA"), member(2, "BIA"), member(3, "CAU")];
    const sales = [sale(1, 3_000), sale(2, 3_000), sale(3, 1_500)];
    const third = ranking(g, team, sales, "e:3");
    expect(third.entries.map((e) => e.position)).toEqual([1, 1, 3]);
    expect(third.gapPp).toBeCloseTo(50);
    expect(third.abovePosition).toBe(1);
    const tiedFirst = ranking(g, team, sales, "e:2");
    expect(tiedFirst.gapPp).toBeNull();
    expect(tiedFirst.abovePosition).toBeNull();
  });

  it("Grupo mode ranks by individual % (meta do grupo ÷ pessoas do grupo) and shows the group level", () => {
    const g: GoalRecord = {
      ...goal,
      target: 10_000,
      tierMode: "GROUP",
      groups: [
        { shiftId: "m", name: "MANHÃ", pct: 60 },
        { shiftId: "t", name: "TARDE", pct: 40 },
      ],
    };
    const team = [member(1, "ANA", "m"), member(2, "BIA", "m"), member(3, "CAU", "t"), member(4, "DUDA")];
    const r = ranking(g, team, [sale(1, 1_500), sale(2, 4_500), sale(3, 2_000), sale(4, 5_000)], "e:1");
    expect(rows(r)).toEqual([
      [1, "BIA", 150, "N1 · Meta", false],
      [2, "ANA", 50, "N1 · Meta", true],
      [2, "CAU", 50, null, false],
    ]);
    expect(r.gapPp).toBeCloseTo(100);
    expect(r.abovePosition).toBe(1);
  });

  it("entries carry no R$ value: only position and pct are numbers", () => {
    const team = [member(1, "ANA"), member(2, "BIA")];
    const r = ranking(goal, team, [sale(1, 4_000), sale(2, 2_000)], "e:1");
    for (const e of r.entries) {
      expect(Object.keys(e).sort()).toEqual(["level", "me", "name", "pct", "position"]);
      expect(Object.entries(e).filter(([, v]) => typeof v === "number").map(([k]) => k).sort()).toEqual(["pct", "position"]);
    }
  });

  it("seller alone in the goal is 1º de 1 with no gap", () => {
    const r = ranking({ ...goal, target: 3_000 }, [member(1, "ANA")], [sale(1, 1_000)], "e:1");
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ position: 1, me: true });
    expect(r.gapPp).toBeNull();
    expect(r.abovePosition).toBeNull();
  });
});
