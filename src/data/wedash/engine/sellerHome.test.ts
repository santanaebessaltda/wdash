import { describe, expect, it } from "vitest";
import type { GoalRecord, GoalTeamMember, SalesSellerDayAgg } from "./goalTypes.ts";
import { sellerGoalLevels } from "./goalView.ts";
import type { StoreWeekHours } from "./goalWeights.ts";
import { brlCent } from "./format.ts";
import { buildSellerHome, type SellerHomeInput } from "./sellerHome.ts";

const OPEN = { open: "10:00", close: "22:00" };
const ALL_DAYS: StoreWeekHours = { 0: OPEN, 1: OPEN, 2: OPEN, 3: OPEN, 4: OPEN, 5: OPEN, 6: OPEN };
const NO_SUNDAY: StoreWeekHours = { ...ALL_DAYS, 0: null };

const goal: GoalRecord = {
  id: "g1",
  storeId: "s1",
  name: "Meta setembro",
  startsOn: "2026-09-01",
  endsOn: "2026-09-30",
  target: 10_000,
  tierMode: "INDIVIDUAL",
  tiers: [
    { nome: "Meta", atingimentoMinPct: 100, comissaoPct: 1, bonus: 50 },
    { nome: "Super", atingimentoMinPct: 120, comissaoPct: 2, bonus: 100 },
    { nome: "Hiper", atingimentoMinPct: 150, comissaoPct: 3, bonus: 150 },
  ],
  groups: [
    { shiftId: "m", name: "M", pct: 60 },
    { shiftId: "t", name: "T", pct: 40 },
  ],
};

const member = (employeeId: number, name: string, shiftId: string | null, storeId = "s1"): GoalTeamMember => ({
  storeId,
  employeeId,
  name,
  nameKeys: [name],
  salesPerson: true,
  shiftId,
  shiftName: shiftId ? shiftId.toUpperCase() : null,
});

const sale = (employeeId: number | null, key: string, day: string, reais: number, storeId = "s1", itemCount = 3): SalesSellerDayAgg => ({
  tenantId: "t",
  storeId,
  day,
  sellerKey: key,
  sellerName: key,
  sellerEmployeeId: employeeId,
  brand: "ALL",
  revenueCents: reais * 100,
  salesCount: 2,
  itemCount,
});

const team = [member(1, "ANA", "m"), member(2, "BIA", "m"), member(3, "CAU", "t"), member(4, "DUDA", null)];
const sales = [
  sale(1, "ANA", "2026-09-10", 2_400),
  sale(1, "ANA", "2026-09-15", 1_200),
  sale(2, "BIA", "2026-09-10", 3_000),
  sale(3, "CAU", "2026-09-10", 2_000),
  sale(4, "DUDA", "2026-09-10", 1_000),
];

const input = (over: Partial<SellerHomeInput> = {}, employeeId = 1): SellerHomeInput => ({
  today: "2026-09-15",
  stores: [{ storeId: "s1", storeName: "LOJA 1", lastSyncAt: "2026-09-15T13:00:00Z", employeeId, week: ALL_DAYS }],
  goals: [goal],
  dayAggs: [],
  sellerDayAggs: sales,
  team,
  ...over,
});

describe("buildSellerHome", () => {
  it("active goal with the seller in a group: premiação, nível, falta, ganho e ranking", () => {
    const [store] = buildSellerHome(input()).stores;
    const g = store!.goal!;
    expect(g.me).toMatchObject({ nivel: "Super", nivelNumero: 2, grupo: "M", premiacao: 72, bonus: 150 });
    expect(g.me!.proximo).toMatchObject({ nome: "Hiper", numero: 3, falta: 900 });
    expect(g.nextLevelGain).toBeCloseTo(186);
    expect(g.projectedPrize).toBeNull();
    expect(g.ranking.map((e) => [e.position, e.name, e.me])).toEqual([
      [1, "ANA", true],
      [2, "BIA", false],
      [3, "CAU", false],
    ]);
    expect(g.gapPp).toBeNull();
  });

  it("me equals sellerGoalLevels for the same person (Meta do detalhe da pessoa)", () => {
    const i = input();
    const expected = sellerGoalLevels({ goals: i.goals, dayAggs: i.dayAggs, sellerDayAggs: i.sellerDayAggs, team: i.team, today: i.today }).get("e:1");
    expect(buildSellerHome(i).stores[0]!.goal!.me).toEqual(expected);
  });

  it("projection uses sales through yesterday and the store weekdays", () => {
    const i = input({
      today: "2026-09-17",
      stores: [{ storeId: "s1", storeName: "LOJA 1", lastSyncAt: null, employeeId: 1, week: NO_SUNDAY }],
      sellerDayAggs: [sale(1, "ANA", "2026-09-10", 2_800), sale(1, "ANA", "2026-09-17", 1_000)],
    });
    expect(buildSellerHome(i).stores[0]!.goal!.projectedPrize).toBeCloseTo(456);
  });

  it("seller outside the goal groups: me = null and the ranking is still shown", () => {
    const g = buildSellerHome(input({}, 4)).stores[0]!.goal!;
    expect(g.me).toBeNull();
    expect(g.nextLevelGain).toBeNull();
    expect(g.ranking.map((e) => e.name)).toEqual(["ANA", "BIA", "CAU"]);
    expect(g.ranking.some((e) => e.me)).toBe(false);
  });

  it("no active goal: goal = null, and the month podium still lists who sold", () => {
    const store = buildSellerHome(input({ goals: [] })).stores[0]!;
    expect(store.goal).toBeNull();
    expect(store.groupName).toBe("M");
    expect(store.monthRanking.map((e) => [e.position, e.name, e.revenue, e.sales, e.me])).toEqual([
      [1, "ANA", 3600, 4, true],
      [2, "BIA", 3000, 2, false],
    ]);
    const withQuiet = buildSellerHome(input({ goals: [], team: [...team, member(5, "EVA", "m")] })).stores[0]!;
    expect(withQuiet.monthRanking.map((e) => [e.name, e.sales])).toEqual([
      ["ANA", 4],
      ["BIA", 2],
      ["EVA", 0],
    ]);
    const upcoming = { ...goal, startsOn: "2026-10-01", endsOn: "2026-10-31" };
    expect(buildSellerHome(input({ goals: [upcoming] })).stores[0]!.goal).toBeNull();
  });

  it("challenges overlapping the month keep ended ones and label the prize", () => {
    const store = buildSellerHome(
      input({
        challenges: [
          { id: "c1", storeId: "s1", name: "Semana 1", startsOn: "2026-09-01", endsOn: "2026-09-07", mode: "CONTEST", prize: { kind: "MONEY", amount: 50 } },
          { id: "c2", storeId: "s1", name: "Semana 3", startsOn: "2026-09-15", endsOn: "2026-09-21", mode: "MINIMUM", prize: { kind: "ITEM", label: "Combo" } },
          { id: "c3", storeId: "s2", name: "Outra loja", startsOn: "2026-09-01", endsOn: "2026-09-30", mode: "CONTEST", prize: null },
        ],
      }),
    ).stores[0]!;
    expect(store.challenges.map((c) => [c.name, c.status, c.prize])).toEqual([
      ["Semana 3", "active", "Combo por pessoa"],
      ["Semana 1", "ended", `1º lugar: ${brlCent(50)}`],
    ]);
    expect(store.challenges[0]!.rules[0]).toMatch(/atingirem o mínimo/i);
    expect(store.challenges[1]!.rules.some((r) => r.startsWith("Prêmios:"))).toBe(true);
  });

  it("goal ended yesterday: goal = null", () => {
    const ended = { ...goal, startsOn: "2026-08-15", endsOn: "2026-09-14" };
    expect(buildSellerHome(input({ goals: [ended] })).stores[0]!.goal).toBeNull();
  });

  it("two stores: one entry per store, each with its own goal", () => {
    const g2: GoalRecord = { ...goal, id: "g2", storeId: "s2", name: "Meta loja 2", groups: [] };
    const out = buildSellerHome(
      input({
        stores: [
          { storeId: "s1", storeName: "LOJA 1", lastSyncAt: null, employeeId: 1, week: ALL_DAYS },
          { storeId: "s2", storeName: "LOJA 2", lastSyncAt: null, employeeId: 9, week: ALL_DAYS },
        ],
        goals: [goal, g2],
        team: [...team, member(9, "ANA", null, "s2")],
      }),
    );
    expect(out.stores.map((s) => [s.storeId, s.storeName, s.goal?.name])).toEqual([
      ["s1", "LOJA 1", "Meta setembro"],
      ["s2", "LOJA 2", "Meta loja 2"],
    ]);
  });

  it("myDays has only the seller's rows (by código or by the registered name), summed per store and day", () => {
    const out = buildSellerHome(
      input({
        stores: [
          { storeId: "s1", storeName: "LOJA 1", lastSyncAt: null, employeeId: 1, week: ALL_DAYS },
          { storeId: "s2", storeName: "LOJA 2", lastSyncAt: null, employeeId: 9, week: ALL_DAYS },
        ],
        team: [...team, member(9, "ANA", null, "s2")],
        sellerDayAggs: [
          ...sales,
          sale(null, "ANA", "2026-09-10", 100),
          sale(9, "ANA", "2026-09-11", 500, "s2", 0),
          sale(5, "ANA", "2026-09-11", 700, "s2"),
        ],
      }),
    );
    expect(out.myDays).toEqual([
      { storeId: "s1", day: "2026-09-10", revenue: 2_500, sales: 4, items: 6 },
      { storeId: "s2", day: "2026-09-11", revenue: 500, sales: 2, items: null },
      { storeId: "s1", day: "2026-09-15", revenue: 1_200, sales: 2, items: 3 },
    ]);
  });
});
