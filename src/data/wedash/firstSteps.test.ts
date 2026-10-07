import { describe, expect, it } from "vitest";
import { buildFirstSteps, storesForFirstStepsView, type FirstStepsInput, type FirstStepsStore } from "./firstSteps";
import { EMPTY_STORE_COSTS, SELLER_ROLE, type StoreCosts } from "./stores";
import { defaultWeekHours } from "./storeHours";

const HORAS = { ...defaultWeekHours(), 1: { open: "10:00", close: "22:00" } } as FirstStepsStore["horas"];
const CUSTOS_OK: StoreCosts = {
  ...EMPTY_STORE_COSTS,
  royaltiesWepinkPct: 5,
  marketingWepinkPct: 2,
  rentMin: 8000,
  icmsWepinkPct: 0,
  icmsStWepinkPct: 0,
};

const loja = (id: string, over: Partial<FirstStepsStore> = {}): FirstStepsStore => ({
  id,
  temWpink: false,
  pointType: "SHOPPING",
  horas: HORAS,
  custos: CUSTOS_OK,
  ...over,
});

const vendedor = (shiftId: string | null, over: { active?: boolean; role?: string | null } = {}) => ({
  active: true,
  role: SELLER_ROLE,
  shiftId,
  ...over,
});

function input(over: Partial<FirstStepsInput> = {}): FirstStepsInput {
  return {
    stores: [loja("a")],
    sellersByStore: new Map([["a", [vendedor("g1")]]]),
    shiftIdsByStore: new Map([["a", ["g1"]]]),
    storesWithGoal: new Set(["a"]),
    storesWithChallenge: new Set(["a"]),
    ...over,
  };
}

const passo = (i: FirstStepsInput, id: string) => buildFirstSteps(i).find((s) => s.id === id)!;

describe("buildFirstSteps", () => {
  it("tudo configurado = 9 passos concluídos, Millennium e vendedores sempre concluídos", () => {
    const steps = buildFirstSteps(input());
    expect(steps.map((s) => s.id)).toEqual(["erp", "sellers", "hours", "groups", "franchise", "rent", "taxes", "goal", "challenge"]);
    expect(steps.every((s) => s.done)).toBe(true);
    const vazio = buildFirstSteps(input({ stores: [loja("a", { custos: undefined, horas: defaultWeekHours() })] }));
    expect(vazio.find((s) => s.id === "erp")!.done).toBe(true);
    expect(vazio.find((s) => s.id === "sellers")!.done).toBe(true);
  });

  it("horário e custos: todas as lojas precisam estar configuradas", () => {
    const i = input({ stores: [loja("a"), loja("b", { horas: defaultWeekHours() })] });
    expect(passo(i, "hours")).toMatchObject({ done: false, detail: "Falta em 1 de 2 lojas" });
    expect(passo(input({ stores: [loja("a", { horas: defaultWeekHours() })] }), "hours").detail).toBeUndefined();
  });

  it("franquia exige WPINK só se a loja vende WPINK", () => {
    expect(passo(input({ stores: [loja("a", { temWpink: true })] }), "franchise").done).toBe(false);
    const wpink = { ...CUSTOS_OK, royaltiesWpinkPct: 5, marketingWpinkPct: 2 };
    expect(passo(input({ stores: [loja("a", { temWpink: true, custos: wpink })] }), "franchise").done).toBe(true);
  });

  it("aluguel: shopping pode ter só o percentual; rua precisa do aluguel mensal", () => {
    const soPct = { ...CUSTOS_OK, rentMin: null, rentWepinkPct: 8, rentWpinkPct: 8 };
    expect(passo(input({ stores: [loja("a", { custos: soPct })] }), "rent").done).toBe(true);
    expect(passo(input({ stores: [loja("a", { custos: soPct, pointType: "RUA" })] }), "rent").done).toBe(false);
  });

  it("impostos: 0 preenchido conta; vazio não", () => {
    expect(passo(input(), "taxes").done).toBe(true);
    expect(passo(input({ stores: [loja("a", { custos: { ...CUSTOS_OK, icmsStWepinkPct: null } })] }), "taxes").done).toBe(false);
    expect(passo(input({ stores: [loja("a", { temWpink: true })] }), "taxes").done).toBe(false);
    const wpink = { ...CUSTOS_OK, icmsWpinkPct: 0, icmsStWpinkPct: 0 };
    expect(passo(input({ stores: [loja("a", { temWpink: true, custos: wpink })] }), "taxes").done).toBe(true);
  });

  it("grupos: conta vendedores ativos sem grupo; gerência e desligados não contam", () => {
    const i = input({
      sellersByStore: new Map([
        ["a", [vendedor("g1"), vendedor(null), vendedor("x"), vendedor(null, { active: false }), vendedor(null, { role: "GERENCIA" })]],
      ]),
    });
    expect(passo(i, "groups")).toMatchObject({ done: false, detail: "2 vendedores sem grupo", needsGroups: false });
    const semGrupos = input({ shiftIdsByStore: new Map() });
    expect(passo(semGrupos, "groups")).toMatchObject({ done: false, detail: "1 vendedor sem grupo", needsGroups: true });
  });

  it("grupos, meta e desafio ignoram loja sem equipe de vendas", () => {
    const i = input({ stores: [loja("a"), loja("parada")] });
    expect(passo(i, "groups").done).toBe(true);
    expect(passo(i, "goal").done).toBe(true);
    expect(passo(input({ stores: [loja("a"), loja("b")], sellersByStore: new Map([["a", [vendedor("g1")]], ["b", [vendedor(null)]]]) }), "goal")).toMatchObject({
      done: false,
      detail: "Falta em 1 de 2 lojas",
    });
  });

  it("uma loja no filtro conta só o que falta nela", () => {
    const stores = [loja("a"), loja("b", { horas: defaultWeekHours() })];
    const rede = input({ stores });
    expect(passo(rede, "hours")).toMatchObject({ done: false, detail: "Falta em 1 de 2 lojas" });
    expect(storesForFirstStepsView(stores, []).map((s) => s.id)).toEqual(["a", "b"]);
    const soA = input({ stores: storesForFirstStepsView(stores, ["a"]) });
    expect(passo(soA, "hours").done).toBe(true);
    expect(passo(soA, "hours").detail).toBeUndefined();
    const soB = input({
      stores: storesForFirstStepsView(stores, ["b"]),
      sellersByStore: new Map([["b", [vendedor("g1")]]]),
      shiftIdsByStore: new Map([["b", ["g1"]]]),
      storesWithGoal: new Set(["b"]),
      storesWithChallenge: new Set(["b"]),
    });
    expect(buildFirstSteps(soB).filter((s) => !s.done).map((s) => s.id)).toEqual(["hours"]);
  });

  it("sem equipe em nenhuma loja: meta e desafio valem para todas as lojas", () => {
    const i = input({ sellersByStore: new Map(), storesWithGoal: new Set(), storesWithChallenge: new Set(["a"]) });
    expect(passo(i, "groups").done).toBe(true);
    expect(passo(i, "goal").done).toBe(false);
    expect(passo(i, "challenge").done).toBe(true);
  });
});
