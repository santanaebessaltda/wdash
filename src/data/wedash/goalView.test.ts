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

const day = (storeId: string, d: string, reais: number, brand: SalesDayAgg["brand"] = "ALL"): SalesDayAgg => ({
  tenantId: "t",
  storeId,
  day: d,
  brand,
  revenueCents: reais * 100,
  salesCount: 1,
  itemCount: 1,
});

const seller = (d: string, key: string, reais: number, employeeId: number | null): SalesSellerDayAgg => ({
  tenantId: "t",
  storeId: "s1",
  day: d,
  sellerKey: key,
  sellerName: key,
  sellerEmployeeId: employeeId,
  brand: "ALL",
  revenueCents: reais * 100,
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
    const comGerencia: GoalRecord = {
      ...goal,
      tiers: [
        { ...goal.tiers[0]!, managerPct: 0.5, managerBonus: 100 },
        { ...goal.tiers[1]!, managerPct: 1, managerBonus: 200 },
      ],
    };
    const below = goalManagerPrize(comGerencia, 4_000)!;
    expect(below.nivel).toBeNull();
    expect(below.prizeAmount).toBe(0);
    expect(below.proximo).toMatchObject({ numero: 1, falta: 1_000 });
    const n1 = goalManagerPrize(comGerencia, 6_000)!;
    expect(n1).toMatchObject({ nivelNumero: 1, pct: 0.5, prizeAmount: 30, bonus: 100 });
    expect(n1.proximo).toMatchObject({ numero: 2, falta: 4_000, pct: 1 });
    const n2 = goalManagerPrize(comGerencia, 12_000)!;
    expect(n2).toMatchObject({ nivelNumero: 2, prizeAmount: 120, bonus: 300, proximo: null });
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
    expect(s.projectedPct).toBeCloseTo(120);
    expect(s.daysRemaining).toBe(16);
    expect(buildGoalSummary(goal, aggs, "2026-09-10").projectedPct).toBeNull();
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
    expect(card.qtdVendedoras).toBe(3);
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
    const por = new Map(card.sellers.map((l) => [l.name, l]));
    const ana = por.get("ANA")!;
    expect(ana.individualGoalAmount).toBeCloseTo(3000);
    expect(ana.currentTierName).toBe("Hiper");
    expect(ana.accruedPrize).toBeCloseTo(60);
    expect(ana.bonusReached).toBe(50);
    expect(por.get("CAU")!.individualGoalAmount).toBeCloseTo(4000);
    expect(por.get("DUDA")!.noGoal).toBe(true);
    expect(card.qtdGrupos).toBe(2);
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
    expect(card.qtdGrupos).toBe(0);
    const por = new Map(card.sellers.map((l) => [l.name, l]));
    const ana = por.get("ANA")!;
    const bia = por.get("BIA")!;
    const cau = por.get("CAU")!;
    const duda = por.get("DUDA")!;
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
    const por = new Map(card.sellers.map((l) => [l.name, l]));
    const ana = por.get("ANA")!;
    const bia = por.get("BIA")!;
    // Manha: meta 6.000, vendeu 4.000 (67%)  ->  Meta: 1% x 4.000 = 40  2 pessoas.
    expect(ana.currentTierName).toBe("Meta");
    expect(ana.accruedPrize).toBeCloseTo(20);
    expect(bia.accruedPrize).toBeCloseTo(20);
    expect(bia.bonusReached).toBe(20);
    // Tarde: meta 4.000, vendeu 4.000 (100%)  ->  Hiper: 2% x 4.000 = 80; bonus 20 + 50.
    const cau = por.get("CAU")!;
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
    expect(levels.get("e:1")).toMatchObject({ nivel: "Hiper", nivelNumero: 2 });
    expect(levels.get("n:ANA")?.nivel).toBe("Hiper");
    expect(levels.get("e:2")).toMatchObject({ nivel: null, nivelNumero: null });
    expect(levels.get("e:2")!.attainmentPct).toBeCloseTo(100 / 3);
    expect(levels.has("e:4")).toBe(false);
    // Detalhe da pessoa: Manha = 6.000  2 = 3.000 cada.
    expect(levels.get("e:1")).toMatchObject({
      metaNome: "Meta Setembro",
      status: "active",
      daysRemaining: 1,
      modo: "individual",
      group: "MANHA",
      goalAmount: 3000,
      achieved: 3000,
      proximo: null,
      prizeAmount: 60,
      bonus: 50,
    });
    expect(levels.get("e:2")!.proximo).toMatchObject({ name: "Meta", numero: 1, falta: 500, commissionPct: 1 });
    expect(levels.get("e:2")!.prizeAmount).toBe(0);
  });
});
