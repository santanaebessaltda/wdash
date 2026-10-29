import { describe, expect, it } from "vitest";
import {
  emptyGoalForm,
  ensureGoalName,
  goalDraftReady,
  mergeGoalUtterance,
  parseGoalPeriod,
  parseGoalTarget,
  validateGoalDraft,
} from "./goalDraft";

const ctx = {
  tenantId: "t",
  storeIds: ["a"],
  stores: [{ id: "a", name: "CAMPO GRANDE", tradeName: "Shopping Campo Grande", code: "00010" }],
  today: "2026-10-29",
};

describe("parseGoalPeriod", () => {
  it("próximo mês", () => {
    expect(parseGoalPeriod("meta do próximo mês", "2026-10-29")).toEqual({
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
    });
  });

  it("nome do mês", () => {
    expect(parseGoalPeriod("meta de novembro", "2026-10-29")?.startsOn).toBe("2026-11-01");
  });
});

describe("parseGoalTarget", () => {
  it("lê R$ e mil", () => {
    expect(parseGoalTarget("meta de R$ 180.000")).toBe(180000);
    expect(parseGoalTarget("meta de 180 mil")).toBe(180000);
  });
});

describe("mergeGoalUtterance", () => {
  it("fecha rascunho mínimo para autorizar", () => {
    let form = emptyGoalForm("a");
    form = mergeGoalUtterance(form, "meta individual de novembro, R$ 180 mil na Campo Grande", ctx);
    form = ensureGoalName(form);
    expect(form.tierMode).toBe("INDIVIDUAL");
    expect(form.startsOn).toBe("2026-11-01");
    expect(form.target).toBe(180000);
    expect(form.storeId).toBe("a");
    expect(goalDraftReady(form)).toBe(true);
    expect(Object.keys(validateGoalDraft(form))).toEqual([]);
  });
});
