import { describe, expect, it } from "vitest";
import {
  excludeNonSalesPeople,
  goalFromRow,
  sellerDayFromRow,
  teamMemberFromRow,
  type NonSalesPeople,
} from "./goalRows.ts";
import type { SalesSellerDayAgg } from "./goalTypes.ts";

describe("goalFromRow", () => {
  it("converts cents, sorts tiers and keeps the manager prize", () => {
    const goal = goalFromRow({
      id: "g1",
      store_id: "s010",
      name: "Meta setembro",
      starts_on: "2026-09-01",
      ends_on: "2026-09-30",
      target_cents: 15000000,
      tier_mode: "GROUP",
      tiers: [
        { name: "Super", minPct: 120, commissionPct: 2, bonusCents: 5000, managerCommissionPct: 0.5, managerBonusCents: 20000 },
        { name: "Meta", minPct: 100, commissionPct: 1 },
        { name: "  ", minPct: 130, commissionPct: 3 },
      ],
      groups: [
        { shiftId: "sh1", name: "MANHÃ", pct: 60 },
        { shiftId: "sh2", name: "TARDE", pct: 40 },
        { name: "SEM ID", pct: 10 },
      ],
    });
    expect(goal.id).toBe("g1");
    expect(goal.storeId).toBe("s010");
    expect(goal.target).toBe(150000);
    expect(goal.tierMode).toBe("GROUP");
    expect(goal.tiers).toEqual([
      { nome: "Meta", atingimentoMinPct: 100, comissaoPct: 1, bonus: 0 },
      { nome: "Super", atingimentoMinPct: 120, comissaoPct: 2, bonus: 50, gerenciaPct: 0.5, gerenciaBonus: 200 },
    ]);
    expect(goal.groups).toEqual([
      { shiftId: "sh1", name: "MANHÃ", pct: 60 },
      { shiftId: "sh2", name: "TARDE", pct: 40 },
    ]);
  });

  it("keeps GENERAL and ignores nothing else in the row", () => {
    const goal = goalFromRow({
      id: "g3",
      store_id: "s010",
      name: "Meta geral",
      starts_on: "2026-10-01",
      ends_on: "2026-10-31",
      target_cents: 10000,
      tier_mode: "GENERAL",
      tiers: [],
      groups: [],
    });
    expect(goal.tierMode).toBe("GENERAL");
  });

  it("falls back to INDIVIDUAL and empty lists for unknown data", () => {
    const goal = goalFromRow({
      id: "g2",
      store_id: "s114",
      name: "Meta",
      starts_on: "2026-10-01",
      ends_on: "2026-10-31",
      target_cents: 100,
      tier_mode: "X",
      tiers: null,
      groups: "x",
    });
    expect(goal.tierMode).toBe("INDIVIDUAL");
    expect(goal.target).toBe(1);
    expect(goal.tiers).toEqual([]);
    expect(goal.groups).toEqual([]);
  });
});

describe("teamMemberFromRow", () => {
  const base = {
    store_id: "s010",
    millennium_employee_id: 61643,
    millennium_gerador_id: 66161,
    name: "  Gabriela   Souza ",
    name_keys: ["GABRIELA SOUZA"],
    active: true,
    erp_role: "VENDEDOR",
    shift_id: "sh1",
    store_shift: [{ name: "manhã" }],
  };

  it("maps ids, name, shift and sales flag", () => {
    expect(teamMemberFromRow(base)).toEqual({
      storeId: "s010",
      employeeId: 61643,
      geradorId: 66161,
      name: "GABRIELA SOUZA",
      nameKeys: ["GABRIELA SOUZA"],
      salesPerson: true,
      shiftId: "sh1",
      shiftName: "MANHÃ",
    });
  });

  it("is out of the sales team when inactive or with another role", () => {
    expect(teamMemberFromRow({ ...base, erp_role: "GERENCIA" }).salesPerson).toBe(false);
    expect(teamMemberFromRow({ ...base, active: false }).salesPerson).toBe(false);
    expect(teamMemberFromRow({ ...base, erp_role: null }).salesPerson).toBe(true);
  });

  it("handles missing gerador, keys and shift", () => {
    const m = teamMemberFromRow({
      ...base,
      millennium_gerador_id: null,
      name_keys: null,
      shift_id: null,
      store_shift: null,
    });
    expect(m.geradorId).toBeNull();
    expect(m.nameKeys).toEqual([]);
    expect(m.shiftId).toBeNull();
    expect(m.shiftName).toBeNull();
    expect(teamMemberFromRow({ ...base, store_shift: { name: "tarde" } }).shiftName).toBe("TARDE");
  });
});

describe("sellerDayFromRow", () => {
  it("maps numbers and keeps null ids", () => {
    expect(
      sellerDayFromRow({
        tenant_id: "t1",
        store_id: "s010",
        day: "2026-09-12",
        seller_key: "GABRIELA SOUZA",
        seller_name: "Gabriela Souza",
        seller_employee_id: null,
        seller_gerador_id: 66161,
        brand: "ALL",
        revenue_cents: 12345,
        sales_count: 3,
        item_count: null,
      }),
    ).toEqual({
      tenantId: "t1",
      storeId: "s010",
      day: "2026-09-12",
      sellerKey: "GABRIELA SOUZA",
      sellerName: "GABRIELA SOUZA",
      sellerEmployeeId: null,
      sellerGeradorId: 66161,
      brand: "ALL",
      revenueCents: 12345,
      salesCount: 3,
      itemCount: 0,
    });
  });

  it("uses the key when the name is empty", () => {
    const r = sellerDayFromRow({
      tenant_id: "t1",
      store_id: "s010",
      day: "2026-09-12",
      seller_key: "NORTE.SUL",
      seller_name: "",
      seller_employee_id: 40587,
      seller_gerador_id: null,
      brand: "ALL",
      revenue_cents: 100,
      sales_count: 1,
      item_count: 2,
    });
    expect(r.sellerName).toBe("NORTE.SUL");
    expect(r.sellerEmployeeId).toBe(40587);
    expect(r.itemCount).toBe(2);
  });
});

describe("excludeNonSalesPeople", () => {
  const row = (over: Partial<SalesSellerDayAgg>): SalesSellerDayAgg => ({
    tenantId: "t1",
    storeId: "s114",
    day: "2026-08-02",
    sellerKey: "X",
    sellerName: "X",
    sellerEmployeeId: null,
    sellerGeradorId: null,
    brand: "ALL",
    revenueCents: 100,
    salesCount: 1,
    ...over,
  });
  const people: NonSalesPeople = {
    employeeIds: new Set([40587]),
    geradorIds: new Set([42345]),
    storeNameKeys: new Set(["s114|NORTE.SUL"]),
  };

  it("drops by employee code", () => {
    const out = excludeNonSalesPeople(
      [row({ sellerKey: "NORTE.SUL", sellerEmployeeId: 40587 }), row({ sellerKey: "ANA", sellerEmployeeId: 1 })],
      people,
    );
    expect(out.map((r) => r.sellerKey)).toEqual(["ANA"]);
  });

  it("drops by gerador", () => {
    const out = excludeNonSalesPeople(
      [row({ sellerKey: "NORTE.SUL", sellerGeradorId: 42345 }), row({ sellerKey: "ANA", sellerGeradorId: 7 })],
      people,
    );
    expect(out.map((r) => r.sellerKey)).toEqual(["ANA"]);
  });

  it("drops by store and name only in that store", () => {
    const out = excludeNonSalesPeople(
      [row({ sellerKey: "NORTE.SUL" }), row({ sellerKey: "NORTE.SUL", storeId: "s010" })],
      people,
    );
    expect(out.map((r) => `${r.storeId}:${r.sellerKey}`)).toEqual(["s010:NORTE.SUL"]);
  });
});
