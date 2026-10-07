import { describe, expect, it } from "vitest";
import { brlCent } from "./format.ts";
import type { GoalTeamMember, SalesSellerDayAgg } from "./goalTypes.ts";
import { challengeStanding, sellerChallengeRules, type SellerProductDay } from "./sellerChallenge.ts";

const member = (employeeId: number, name: string): GoalTeamMember => ({
  storeId: "s1",
  employeeId,
  geradorId: employeeId + 1000,
  name,
  nameKeys: [name],
  salesPerson: true,
  shiftId: "m",
  shiftName: "M",
});

const day = (employeeId: number, sales: number, items: number, cents: number, iso = "2026-09-10"): SalesSellerDayAgg => ({
  tenantId: "t",
  storeId: "s1",
  day: iso,
  sellerKey: String(employeeId),
  sellerName: String(employeeId),
  sellerEmployeeId: employeeId,
  sellerGeradorId: employeeId + 1000,
  brand: "ALL",
  revenueCents: cents,
  salesCount: sales,
  itemCount: items,
});

const product = (employeeId: number, code: string, items: number): SellerProductDay => ({
  storeId: "s1",
  day: "2026-09-10",
  sellerGeradorId: employeeId + 1000,
  sellerKey: String(employeeId),
  sellerName: String(employeeId),
  productCode: code,
  itemCount: items,
  revenueCents: items * 1000,
});

const team = [member(1, "ANA"), member(2, "BIA")];
const base = {
  storeId: "s1",
  startsOn: "2026-09-01",
  endsOn: "2026-09-30",
  mode: "CONTEST" as const,
  metric: "QUANTITY" as const,
  scope: "ALL" as const,
  prizes: [{ kind: "MONEY" as const, amount: 50 }],
};

describe("challengeStanding", () => {
  it("shows how many items are left to reach the minimum", () => {
    const standing = challengeStanding(
      { ...base, mode: "MINIMUM", target: 15, prizes: [{ kind: "ITEM", amount: 0 }] },
      { today: "2026-09-15", employeeId: 1, team, sellerDays: [day(1, 4, 12, 40_000)] },
    );
    expect(standing.result).toBe("12 itens");
    expect(standing.won).toBe(false);
    expect(standing.gap).toBe("Faltam 3 itens para o mínimo");
    expect(standing.progressPct).toBeCloseTo(80);
  });

  it("shows how many items are left to reach the place above", () => {
    const input = {
      today: "2026-09-15",
      team,
      sellerDays: [] as SalesSellerDayAgg[],
      products: [product(1, "BS1", 10), product(2, "BS1", 7)],
    };
    const challenge = { ...base, scope: "PRODUCTS" as const, productCodes: ["BS1"] };
    const ana = challengeStanding(challenge, { ...input, employeeId: 1 });
    const bia = challengeStanding(challenge, { ...input, employeeId: 2 });
    expect(ana.won).toBe(true);
    expect(ana.position).toBe(1);
    expect(ana.gap).toBeNull();
    expect(ana.progressPct).toBe(100);
    expect(bia.position).toBe(2);
    expect(bia.won).toBe(false);
    expect(bia.gap).toBe("Faltam 3 itens para o 1º lugar");
    expect(bia.result).toBe("7 itens");
  });

  it("hides the result before the challenge starts and hides the gap after it ends", () => {
    const days = [day(1, 2, 4, 10_000, "2026-09-05")];
    const upcoming = challengeStanding({ ...base, startsOn: "2026-09-20" }, { today: "2026-09-15", employeeId: 1, team, sellerDays: days });
    expect(upcoming.result).toBeNull();
    expect(upcoming.gap).toBeNull();
    const ended = challengeStanding({ ...base, endsOn: "2026-09-07" }, { today: "2026-09-15", employeeId: 1, team, sellerDays: days });
    expect(ended.result).toBe("4 itens");
    expect(ended.gap).toBeNull();
    expect(ended.won).toBe(true);
  });

  it("asks for the remaining sales before the person can take part", () => {
    const standing = challengeStanding(
      { ...base, metric: "TICKET", minSales: 10, target: 100 },
      { today: "2026-09-15", employeeId: 1, team, sellerDays: [day(1, 2, 2, 100_000)] },
    );
    expect(standing.gap).toBe("Faltam 8 vendas para participar");
    expect(standing.position).toBeNull();
    expect(standing.result).toBe(brlCent(500));
  });
});

describe("sellerChallengeRules", () => {
  it("explica disputa com produtos, piso e pódio", () => {
    const rules = sellerChallengeRules({
      ...base,
      scope: "PRODUCTS",
      productCodes: ["A", "B"],
      target: 15,
      prizes: [
        { kind: "MONEY", amount: 100 },
        { kind: "MONEY", amount: 50 },
      ],
    });
    expect(rules[0]).toMatch(/melhor resultado/i);
    expect(rules).toContain("O resultado é a quantidade de itens que você vender no período.");
    expect(rules).toContain("Contam só os 2 produtos escolhidos pelo gestor.");
    expect(rules).toContain("Para receber prêmio na disputa, precisa de pelo menos 15 itens.");
    expect(rules.some((r) => r.startsWith("Prêmios:") && r.includes("1º") && r.includes("2º"))).toBe(true);
  });

  it("explica mínimo com P.A. e vendas para participar", () => {
    const rules = sellerChallengeRules({
      ...base,
      mode: "MINIMUM",
      metric: "PA",
      scope: "ALL",
      minSales: 10,
      target: 1.9,
      prizes: [{ kind: "ITEM", label: "Combo" }],
    });
    expect(rules[0]).toMatch(/atingirem o mínimo/i);
    expect(rules).toContain("O resultado é o seu P.A. (itens por venda) no período.");
    expect(rules).toContain("Precisa de pelo menos 10 vendas para participar.");
    expect(rules).toContain("Mínimo para ganhar: 1,90.");
    expect(rules).toContain("Prêmio: Combo por pessoa.");
  });
});
