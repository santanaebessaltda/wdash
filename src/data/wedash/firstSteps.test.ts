import { describe, expect, it } from "vitest";
import { buildFirstSteps, firstStepsCardStatus, storesForFirstStepsView, type FirstStepsInput, type FirstStepsStore } from "./firstSteps";
import { EMPTY_STORE_COSTS, SELLER_ROLE, type StoreCosts } from "./stores";
import { defaultWeekHours } from "./storeHours";

const HOURS = { ...defaultWeekHours(), 1: { open: "10:00", close: "22:00" } } as FirstStepsStore["horas"];
const COSTS_OK: StoreCosts = {
  ...EMPTY_STORE_COSTS,
  royaltiesWepinkPct: 5,
  marketingWepinkPct: 2,
  rentMin: 8000,
};

const store = (id: string, over: Partial<FirstStepsStore> = {}): FirstStepsStore => ({
  id,
  hasWpink: false,
  pointType: "SHOPPING",
  hours: HOURS,
  costs: COSTS_OK,
  ...over,
});

const seller = (shiftId: string | null, over: { active?: boolean; role?: string | null } = {}) => ({
  active: true,
  role: SELLER_ROLE,
  shiftId,
  ...over,
});

function input(over: Partial<FirstStepsInput> = {}): FirstStepsInput {
  return {
    stores: [store("a")],
    sellersByStore: new Map([["a", [seller("g1")]]]),
    shiftIdsByStore: new Map([["a", ["g1"]]]),
    storesWithGoal: new Set(["a"]),
    storesWithChallenge: new Set(["a"]),
    ...over,
  };
}

const step = (i: FirstStepsInput, id: string) => buildFirstSteps(i).find((s) => s.id === id)!;

describe("firstStepsCardStatus", () => {
  it("some quando a lista da tela ou a empresa está 100%", () => {
    expect(firstStepsCardStatus({ owner: true, savedDone: false, loaded: true, viewDone: true, companyDone: false })).toBe("hidden");
    expect(firstStepsCardStatus({ owner: true, savedDone: false, loaded: true, viewDone: false, companyDone: true })).toBe("hidden");
    expect(firstStepsCardStatus({ owner: true, savedDone: true, loaded: false, viewDone: false, companyDone: false })).toBe("hidden");
    expect(firstStepsCardStatus({ owner: false, savedDone: false, loaded: true, viewDone: false, companyDone: false })).toBe("hidden");
  });

  it("enquanto carrega não mostra; com passo pendente mostra", () => {
    expect(firstStepsCardStatus({ owner: true, savedDone: false, loaded: false, viewDone: false, companyDone: false })).toBe("loading");
    expect(firstStepsCardStatus({ owner: true, savedDone: null, loaded: false, viewDone: false, companyDone: false })).toBe("loading");
    expect(firstStepsCardStatus({ owner: true, savedDone: false, loaded: true, viewDone: false, companyDone: false })).toBe("visible");
  });
});

describe("buildFirstSteps", () => {
  it("tudo configurado = 8 passos concluídos, Millennium e vendedores sempre concluídos", () => {
    const steps = buildFirstSteps(input());
    expect(steps.map((s) => s.id)).toEqual(["erp", "sellers", "hours", "groups", "franchise", "rent", "goal", "challenge"]);
    expect(steps.every((s) => s.done)).toBe(true);
    const empty = buildFirstSteps(input({ stores: [store("a", { costs: undefined, hours: defaultWeekHours() })] }));
    expect(empty.find((s) => s.id === "erp")!.done).toBe(true);
    expect(empty.find((s) => s.id === "sellers")!.done).toBe(true);
  });

  it("horário e custos: todas as lojas precisam estar configuradas", () => {
    const i = input({ stores: [store("a"), store("b", { hours: defaultWeekHours() })] });
    expect(step(i, "hours")).toMatchObject({ done: false, detail: "Falta em 1 de 2 filiais" });
    expect(step(input({ stores: [store("a", { hours: defaultWeekHours() })] }), "hours").detail).toBeUndefined();
  });

  it("franquia exige WPINK só se a loja vende WPINK", () => {
    expect(step(input({ stores: [store("a", { hasWpink: true })] }), "franchise").done).toBe(false);
    const wpink = { ...COSTS_OK, royaltiesWpinkPct: 5, marketingWpinkPct: 2 };
    expect(step(input({ stores: [store("a", { hasWpink: true, costs: wpink })] }), "franchise").done).toBe(true);
  });

  it("aluguel: shopping pode ter só o percentual; rua precisa do aluguel mensal", () => {
    const soPct = { ...COSTS_OK, rentMin: null, rentWepinkPct: 8, rentWpinkPct: 8 };
    expect(step(input({ stores: [store("a", { costs: soPct })] }), "rent").done).toBe(true);
    expect(step(input({ stores: [store("a", { costs: soPct, pointType: "STREET" })] }), "rent").done).toBe(false);
  });

  it("grupos: conta vendedores ativos sem grupo; gerência e desligados não contam", () => {
    const i = input({
      sellersByStore: new Map([
        ["a", [seller("g1"), seller(null), seller("x"), seller(null, { active: false }), seller(null, { role: "GERENCIA" })]],
      ]),
    });
    expect(step(i, "groups")).toMatchObject({ done: false, detail: "2 vendedores sem grupo", needsGroups: false });
    const withoutGroups = input({ shiftIdsByStore: new Map() });
    expect(step(withoutGroups, "groups")).toMatchObject({ done: false, detail: "1 vendedor sem grupo", needsGroups: true });
  });

  it("grupos, meta e desafio ignoram loja sem equipe de vendas", () => {
    const i = input({ stores: [store("a"), store("parada")] });
    expect(step(i, "groups").done).toBe(true);
    expect(step(i, "goal").done).toBe(true);
    expect(step(input({ stores: [store("a"), store("b")], sellersByStore: new Map([["a", [seller("g1")]], ["b", [seller(null)]]]) }), "goal")).toMatchObject({
      done: false,
      detail: "Falta em 1 de 2 filiais",
    });
  });

  it("uma loja no filtro conta só o que falta nela", () => {
    const stores = [store("a"), store("b", { hours: defaultWeekHours() })];
    const network = input({ stores });
    expect(step(network, "hours")).toMatchObject({ done: false, detail: "Falta em 1 de 2 filiais" });
    expect(storesForFirstStepsView(stores, []).map((s) => s.id)).toEqual(["a", "b"]);
    const soA = input({ stores: storesForFirstStepsView(stores, ["a"]) });
    expect(step(soA, "hours").done).toBe(true);
    expect(step(soA, "hours").detail).toBeUndefined();
    const soB = input({
      stores: storesForFirstStepsView(stores, ["b"]),
      sellersByStore: new Map([["b", [seller("g1")]]]),
      shiftIdsByStore: new Map([["b", ["g1"]]]),
      storesWithGoal: new Set(["b"]),
      storesWithChallenge: new Set(["b"]),
    });
    expect(buildFirstSteps(soB).filter((s) => !s.done).map((s) => s.id)).toEqual(["hours"]);
  });

  it("sem equipe em nenhuma loja: meta e desafio valem para todas as lojas", () => {
    const i = input({ sellersByStore: new Map(), storesWithGoal: new Set(), storesWithChallenge: new Set(["a"]) });
    expect(step(i, "groups").done).toBe(true);
    expect(step(i, "goal").done).toBe(false);
    expect(step(i, "challenge").done).toBe(true);
  });
});
