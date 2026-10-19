import { describe, expect, it } from "vitest";
import {
  buildGoalCardView,
  buildGoalSummary,
  copyGoalName,
  goalManagerPrize,
  goalStatus,
  nextGoalPeriod,
  sellerGoalLevels,
} from "./goalView";
import type { GoalRecord, GoalTeamMember } from "./goalsRepo";
import type { SalesDayAgg, SalesSellerDayAgg } from "./salesTypes";

const goal: GoalRecord = {
  id: "g1",
  storeId: "s1",
  name: "Meta Setembro",
  startsOn: "2026-09-01",
  endsOn: "2026-09-30",
  target: 10_000,
  tierMode: "INDIVIDUAL",
  tiers: [
    { name: "Meta", minAttainmentPct: 50, commissionPct: 1, bonus: 0 },
    { name: "Hiper", minAttainmentPct: 100, commissionPct: 2, bonus: 50 },
  ],
  groups: [],
};

const day = (storeId: string, d: string, brl: number, brand: SalesDayAgg["brand"] = "ALL"): SalesDayAgg => ({
  tenantId: "t",
  storeId,
  day: d,
  brand,
  revenueCents: brl * 100,
  salesCount: 1,
  itemCount: 1,
});

const seller = (d: string, key: string, brl: number, employeeId: number | null): SalesSellerDayAgg => ({
  tenantId: "t",
  storeId: "s1",
  day: d,
  sellerKey: key,
  sellerName: key,
  sellerEmployeeId: employeeId,
  brand: "ALL",
  revenueCents: brl * 100,
  salesCount: 2,
  itemCount: 3,
});

describe("goalView", () => {
  it("período da cópia: meses fechados viram os meses seguintes; senão, mesma duração depois do fim", () => {
    expect(nextGoalPeriod("2026-09-01", "2026-09-30")).toEqual({ startsOn: "2026-10-01", endsOn: "2026-10-31" });
    expect(nextGoalPeriod("2026-01-01", "2026-01-31")).toEqual({ startsOn: "2026-02-01", endsOn: "2026-02-28" });
    expect(nextGoalPeriod("2026-12-01", "2026-12-31")).toEqual({ startsOn: "2027-01-01", endsOn: "2027-01-31" });
    expect(nextGoalPeriod("2026-07-01", "2026-09-30")).toEqual({ startsOn: "2026-10-01", endsOn: "2026-12-31" });
    expect(nextGoalPeriod("2026-09-15", "2026-09-21")).toEqual({ startsOn: "2026-09-22", endsOn: "2026-09-28" });
  });

  it("nome da cópia troca o mês (e o ano) mantendo as maiúsculas", () => {
    expect(copyGoalName("Meta setembro 2026", "2026-10-01")).toBe("Meta outubro 2026");
    expect(copyGoalName("META DEZEMBRO DE 2026", "2027-01-01")).toBe("META JANEIRO DE 2027");
    expect(copyGoalName("Meta Setembro", "2026-10-01")).toBe("Meta Outubro");
    expect(copyGoalName("Meta do mês", "2026-10-01")).toBe("Meta do mês (cópia)");
    expect(copyGoalName("Meta julho a setembro", "2026-10-01")).toBe("Meta julho a setembro (cópia)");
  });

  it("premiação da gerência pelo faturamento total da loja", () => {
    expect(goalManagerPrize(goal, 6_000)).toBeNull();
    const withManagement: GoalRecord = {
      ...goal,
      tiers: [
        { ...goal.tiers[0]!, managerPct: 0.5, managerBonus: 100 },
        { ...goal.tiers[1]!, managerPct: 1, managerBonus: 200 },
      ],
    };
    const below = goalManagerPrize(withManagement, 4_000)!;
    expect(below.level).toBeNull();
    expect(below.prizeAmount).toBe(0);
    expect(below.next).toMatchObject({ number: 1, gap: 1_000 });
    const n1 = goalManagerPrize(withManagement, 6_000)!;
    expect(n1).toMatchObject({ levelNumber: 1, pct: 0.5, prizeAmount: 30, bonus: 100 });
    expect(n1.next).toMatchObject({ number: 2, gap: 4_000, pct: 1 });
    const n2 = goalManagerPrize(withManagement, 12_000)!;
    expect(n2).toMatchObject({ levelNumber: 2, prizeAmount: 120, bonus: 300, next: null });
  });

  it("status pelo período", () => {
    expect(goalStatus(goal, "2026-08-31")).toBe("upcoming");
    expect(goalStatus(goal, "2026-09-15")).toBe("active");
    expect(goalStatus(goal, "2026-10-01")).toBe("ended");
  });

  it("resumo soma só o ALL da loja dentro do período", () => {
    const aggs = [
      day("s1", "2026-08-31", 999),
      day("s1", "2026-09-01", 3000),
      day("s1", "2026-09-01", 1000, "WPINK"),
      day("s2", "2026-09-02", 500),
      day("s1", "2026-09-15", 3000),
    ];
    const s = buildGoalSummary(goal, aggs, "2026-09-15");
    expect(s.achieved).toBe(6000);
    expect(s.pct).toBeCloseTo(60);
    expect(s.currentLevel).toBe("Meta");
    // 15/09: 14 dias fechados de 30, ainda antes da metade. 16/09 libera: vendido ate ontem (6.000) x 30/15.
    expect(s.projectedPct).toBeNull();
    expect(s.daysRemaining).toBe(16);
    expect(buildGoalSummary(goal, aggs, "2026-09-10").projectedPct).toBeNull();
    expect(buildGoalSummary(goal, aggs, "2026-09-16").projectedPct).toBeCloseTo(120);
  });

  it("escada individual: meta ÷ pessoas (equipe ativa ∪ quem vendeu)", () => {
    const team: GoalTeamMember[] = [
      { storeId: "s1", employeeId: 1, name: "ANA", nameKeys: ["ANA"], salesPerson: true, shiftId: "m", shiftName: "MANHA" },
      { storeId: "s1", employeeId: 2, name: "BIA", nameKeys: ["BIA"], salesPerson: true, shiftId: null, shiftName: null },
    ];
    const card = buildGoalCardView({
      goal,
      storeNameValue: "LOJA",
      dayAggs: [day("s1", "2026-09-05", 6000)],
      sellerDayAggs: [seller("2026-09-05", "ANA", 3000, null), seller("2026-09-05", "EX", 1000, 9)],
      team,
      today: "2026-09-30",
    });
    expect(card.qtySellers).toBe(3);
    const [ana, ex, bia] = card.sellers;
    expect(ana.name).toBe("ANA");
    expect(ana.group).toBe("MANHA");
    expect(ana.individualGoalAmount).toBeCloseTo(10_000 / 3);
    expect(ana.currentTierName).toBe("Meta");
    expect(ana.accruedPrize).toBeCloseTo(30);
    expect(ex.employeeId).toBe("e:9");
    expect(bia.revenueAmount).toBe(0);
    expect(card.band.outsideTeam).toBe(2000);
  });

  const teamGroups: GoalTeamMember[] = [
    { storeId: "s1", employeeId: 1, name: "ANA", nameKeys: ["ANA"], salesPerson: true, shiftId: "m", shiftName: "MANHA" },
    { storeId: "s1", employeeId: 2, name: "BIA", nameKeys: ["BIA"], salesPerson: true, shiftId: "m", shiftName: "MANHA" },
    { storeId: "s1", employeeId: 3, name: "CAU", nameKeys: ["CAU"], salesPerson: true, shiftId: "t", shiftName: "TARDE" },
    { storeId: "s1", employeeId: 4, name: "DUDA", nameKeys: ["DUDA"], salesPerson: true, shiftId: null, shiftName: null },
  ];
  const groups = [
    { shiftId: "m", name: "MANHA", pct: 60 },
    { shiftId: "t", name: "TARDE", pct: 40 },
  ];
  const groupSales = [
    seller("2026-09-05", "ANA", 3000, 1),
    seller("2026-09-05", "BIA", 1000, 2),
    seller("2026-09-05", "CAU", 4000, 3),
  ];

  it("grupos individual: meta do grupo ÷ pessoas; bônus soma os níveis; sem grupo = sem meta", () => {
    const card = buildGoalCardView({
      goal: { ...goal, groups: groups },
      storeNameValue: "LOJA",
      dayAggs: [day("s1", "2026-09-05", 8000)],
      sellerDayAggs: groupSales,
      team: teamGroups,
      today: "2026-09-30",
    });
    const by = new Map(card.sellers.map((l) => [l.name, l]));
    const ana = by.get("ANA")!;
    expect(ana.individualGoalAmount).toBeCloseTo(3000);
    expect(ana.currentTierName).toBe("Hiper");
    expect(ana.accruedPrize).toBeCloseTo(60);
    expect(ana.bonusReached).toBe(50);
    expect(by.get("CAU")!.individualGoalAmount).toBeCloseTo(4000);
    expect(by.get("DUDA")!.noGoal).toBe(true);
    expect(card.qtyGroups).toBe(2);
  });

  it("modo Geral: sobe pelo total vendido da loja e divide a premiação igualmente", () => {
    const card = buildGoalCardView({
      goal: { ...goal, tierMode: "GENERAL", groups: groups },
      storeNameValue: "LOJA",
      dayAggs: [day("s1", "2026-09-05", 8000)],
      sellerDayAggs: groupSales,
      team: teamGroups,
      today: "2026-09-30",
    });
    expect(card.kind).toBe("geral");
    expect(card.qtyGroups).toBe(0);
    const by = new Map(card.sellers.map((l) => [l.name, l]));
    const ana = by.get("ANA")!;
    const bia = by.get("BIA")!;
    const cau = by.get("CAU")!;
    const duda = by.get("DUDA")!;
    // Loja vendeu 8.000 de 10.000 (80%) → nível Meta (50%). 1% de 8.000 = 80, dividido por 4.
    for (const p of [ana, bia, cau, duda]) {
      expect(p.noGoal).toBe(false);
      expect(p.individualGoalAmount).toBe(10_000);
      expect(p.attainmentPct).toBeCloseTo(80);
      expect(p.currentTierName).toBe("Meta");
      expect(p.accruedPrize).toBeCloseTo(20);
      expect(p.bonusReached).toBe(0);
    }
    expect(ana.revenueAmount).toBe(2000);
    expect(ana.salesCount).toBeCloseTo(1 / 4);
    expect(ana.ticketAmount).toBe(8000);
    expect(card.band.outsideTeam).toBe(0);
  });

  it("grupos modo Grupo: sobe pela soma do grupo e divide a premiação igualmente", () => {
    const card = buildGoalCardView({
      goal: {
        ...goal,
        tierMode: "GROUP",
        groups: groups,
        tiers: [
          { name: "Meta", minAttainmentPct: 50, commissionPct: 1, bonus: 20 },
          { name: "Hiper", minAttainmentPct: 100, commissionPct: 2, bonus: 50 },
        ],
      },
      storeNameValue: "LOJA",
      dayAggs: [day("s1", "2026-09-05", 8000)],
      sellerDayAggs: groupSales,
      team: teamGroups,
      today: "2026-09-30",
    });
    const by = new Map(card.sellers.map((l) => [l.name, l]));
    const ana = by.get("ANA")!;
    const bia = by.get("BIA")!;
    // Manha: meta 6.000, vendeu 4.000 (67%)  ->  Meta: 1% x 4.000 = 40  2 pessoas.
    expect(ana.currentTierName).toBe("Meta");
    expect(ana.accruedPrize).toBeCloseTo(20);
    expect(bia.accruedPrize).toBeCloseTo(20);
    expect(bia.bonusReached).toBe(20);
    // Tarde: meta 4.000, vendeu 4.000 (100%)  ->  Hiper: 2% x 4.000 = 80; bonus 20 + 50.
    const cau = by.get("CAU")!;
    expect(cau.currentTierName).toBe("Hiper");
    expect(cau.accruedPrize).toBeCloseTo(80);
    expect(cau.bonusReached).toBe(70);
  });

  it("nível de cada pessoa para o Destaques da equipe (chave e: e alias pelo nome)", () => {
    const levels = sellerGoalLevels({
      goals: [{ ...goal, groups: groups }, { ...goal, id: "g2", startsOn: "2026-10-01", endsOn: "2026-10-31" }],
      dayAggs: [day("s1", "2026-09-05", 8000)],
      sellerDayAggs: groupSales,
      team: teamGroups,
      today: "2026-09-30",
    });
    expect(levels.get("e:1")).toMatchObject({ level: "Hiper", levelNumber: 2 });
    expect(levels.get("n:ANA")?.level).toBe("Hiper");
    expect(levels.get("e:2")).toMatchObject({ level: null, levelNumber: null });
    expect(levels.get("e:2")!.attainmentPct).toBeCloseTo(100 / 3);
    expect(levels.has("e:4")).toBe(false);
    // Detalhe da pessoa: Manha = 6.000  2 = 3.000 cada.
    expect(levels.get("e:1")).toMatchObject({
      metaName: "Meta Setembro",
      status: "active",
      daysRemaining: 1,
      modo: "individual",
      group: "MANHA",
      goalAmount: 3000,
      achieved: 3000,
      next: null,
      prizeAmount: 60,
      bonus: 50,
    });
    expect(levels.get("e:2")!.next).toMatchObject({ name: "Meta", number: 1, gap: 500, commissionPct: 1 });
    expect(levels.get("e:2")!.prizeAmount).toBe(0);
  });

  it("individual: quem entra no meio leva a parte vezes os dias; quem já estava não sobe", () => {
    const card = buildGoalCardView({
      goal,
      storeNameValue: "LOJA",
      dayAggs: [day("s1", "2026-09-05", 3000), day("s1", "2026-09-20", 1000)],
      sellerDayAggs: [seller("2026-09-05", "ANA", 3000, 1), seller("2026-09-20", "BIA", 1000, 2)],
      team: [
        { storeId: "s1", employeeId: 1, name: "ANA", nameKeys: ["ANA"], salesPerson: true, shiftId: null, shiftName: null },
        { storeId: "s1", employeeId: 2, name: "BIA", nameKeys: ["BIA"], salesPerson: true, shiftId: null, shiftName: null, admittedOn: "2026-09-16" },
      ],
      today: "2026-09-30",
    });
    const by = new Map(card.sellers.map((l) => [l.name, l]));
    expect(by.get("ANA")!.individualGoalAmount).toBeCloseTo(5000);
    expect(by.get("ANA")!.proportionalGoal).toBe(false);
    expect(by.get("ANA")!.accruedPrize).toBeCloseTo(30);
    expect(by.get("BIA")!.individualGoalAmount).toBeCloseTo(2500);
    expect(by.get("BIA")!.eligibleDays).toBe(15);
    expect(by.get("BIA")!.periodDays).toBe(30);
    expect(by.get("BIA")!.proportionalGoal).toBe(true);
  });

  it("geral: cada dia se divide só entre quem já estava", () => {
    const card = buildGoalCardView({
      goal: { ...goal, tierMode: "GENERAL", groups: [] },
      storeNameValue: "LOJA",
      dayAggs: [day("s1", "2026-09-05", 6000), day("s1", "2026-09-20", 3000)],
      sellerDayAggs: [seller("2026-09-05", "ANA", 6000, 1), seller("2026-09-20", "BIA", 1500, 2)],
      team: [
        { storeId: "s1", employeeId: 1, name: "ANA", nameKeys: ["ANA"], salesPerson: true, shiftId: null, shiftName: null },
        { storeId: "s1", employeeId: 2, name: "BIA", nameKeys: ["BIA"], salesPerson: true, shiftId: null, shiftName: null, admittedOn: "2026-09-16" },
      ],
      today: "2026-09-30",
    });
    const by = new Map(card.sellers.map((l) => [l.name, l]));
    expect(by.get("ANA")!.revenueAmount).toBeCloseTo(7500);
    expect(by.get("BIA")!.revenueAmount).toBeCloseTo(1500);
    expect(by.get("ANA")!.accruedPrize).toBeCloseTo(75);
    expect(by.get("BIA")!.accruedPrize).toBeCloseTo(15);
    expect(by.get("ANA")!.attainmentPct).toBeCloseTo(90);
    expect(by.get("BIA")!.individualGoalAmount).toBe(10_000);
  });

  it("grupo: a meta do grupo fica inteira e a premiação pesa pelos dias", () => {
    const card = buildGoalCardView({
      goal: {
        ...goal,
        target: 8_000,
        tierMode: "GROUP",
        tiers: [{ name: "Meta", minAttainmentPct: 50, commissionPct: 1, bonus: 30 }],
      },
      storeNameValue: "LOJA",
      dayAggs: [day("s1", "2026-09-20", 4000)],
      sellerDayAggs: [seller("2026-09-20", "ANA", 3000, 1), seller("2026-09-20", "BIA", 1000, 2)],
      team: [
        { storeId: "s1", employeeId: 1, name: "ANA", nameKeys: ["ANA"], salesPerson: true, shiftId: null, shiftName: null },
        { storeId: "s1", employeeId: 2, name: "BIA", nameKeys: ["BIA"], salesPerson: true, shiftId: null, shiftName: null, admittedOn: "2026-09-16" },
      ],
      today: "2026-09-30",
    });
    const by = new Map(card.sellers.map((l) => [l.name, l]));
    expect(by.get("ANA")!.individualGoalAmount).toBe(8_000);
    expect(by.get("ANA")!.accruedPrize).toBeCloseTo(40 * (30 / 45));
    expect(by.get("BIA")!.accruedPrize).toBeCloseTo(40 * (15 / 45));
    expect(by.get("ANA")!.bonusReached).toBeCloseTo(30);
    expect(by.get("BIA")!.bonusReached).toBeCloseTo(15);
  });

  it("desligada no meio fecha nos dias em que vendeu; inativa sem venda fica de fora", () => {
    const card = buildGoalCardView({
      goal,
      storeNameValue: "LOJA",
      dayAggs: [day("s1", "2026-09-10", 1000)],
      sellerDayAggs: [seller("2026-09-10", "BIA", 1000, 2)],
      team: [
        { storeId: "s1", employeeId: 1, name: "ANA", nameKeys: ["ANA"], salesPerson: true, shiftId: null, shiftName: null },
        { storeId: "s1", employeeId: 2, name: "BIA", nameKeys: ["BIA"], salesPerson: false, shiftId: null, shiftName: null },
        { storeId: "s1", employeeId: 3, name: "CAU", nameKeys: ["CAU"], salesPerson: false, shiftId: null, shiftName: null, departedOn: "2026-08-31" },
      ],
      today: "2026-09-30",
    });
    const by = new Map(card.sellers.map((l) => [l.name, l]));
    expect(by.has("CAU")).toBe(false);
    expect(by.get("BIA")!.eligibleDays).toBe(10);
    expect(by.get("BIA")!.individualGoalAmount).toBeCloseTo((10_000 / 2) * (10 / 30));
    expect(by.get("ANA")!.individualGoalAmount).toBeCloseTo(5000);
  });

  it("rateia só a venda sem vendedor e deixa usuário da filial e gerência de fora", () => {
    const team: GoalTeamMember[] = [
      { storeId: "s1", employeeId: 1, name: "ANA", nameKeys: ["ANA"], salesPerson: true, shiftId: null, shiftName: null },
      { storeId: "s1", employeeId: 2, name: "BIA", nameKeys: ["BIA"], salesPerson: true, shiftId: null, shiftName: null },
      { storeId: "s1", employeeId: 3, name: "LOJA", nameKeys: ["LOJA"], salesPerson: false, branchUser: true, shiftId: null, shiftName: null },
      { storeId: "s1", employeeId: 4, name: "GER", nameKeys: ["GER"], salesPerson: false, shiftId: null, shiftName: null },
    ];
    const named = [
      seller("2026-09-05", "ANA", 40, 1),
      seller("2026-09-05", "LOJA", 20, 3),
      seller("2026-09-05", "GER", 10, 4),
    ];
    const input = {
      goal: { ...goal, spreadUnidentified: true, startsOn: "2026-09-05", endsOn: "2026-09-05" },
      storeNameValue: "LOJA",
      dayAggs: [day("s1", "2026-09-05", 100)],
      sellerDayAggs: [seller("2026-09-05", "ANA", 40, 1)],
      namedSellerDayAggs: named,
      team,
      today: "2026-09-05",
    };
    const card = buildGoalCardView(input);
    const by = new Map(card.sellers.map((l) => [l.name, l]));
    expect(by.has("LOJA")).toBe(false);
    expect(by.has("GER")).toBe(false);
    expect(by.get("ANA")!.revenueAmount).toBeCloseTo(55);
    expect(by.get("BIA")!.revenueAmount).toBeCloseTo(15);
    expect(card.band.outsideBranchUser).toBeCloseTo(20);
    expect(card.band.outsideManagement).toBeCloseTo(10);
    expect(card.band.outsideUnidentified).toBeCloseTo(0);
    expect(card.band.unidentifiedSpread).toBeCloseTo(30);
    expect(card.band.outsideTeam).toBeCloseTo(30);

    const kept = buildGoalCardView({ ...input, goal: { ...input.goal, spreadUnidentified: false } });
    const keptBy = new Map(kept.sellers.map((l) => [l.name, l]));
    expect(keptBy.get("ANA")!.revenueAmount).toBeCloseTo(40);
    expect(keptBy.get("BIA")!.revenueAmount).toBeCloseTo(0);
    expect(kept.band.outsideUnidentified).toBeCloseTo(30);
    expect(kept.band.outsideTeam).toBeCloseTo(60);
  });
});
