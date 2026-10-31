import { describe, expect, it, vi } from "vitest";
import {
  discussSchedule,
  emptyScheduleForm,
  parseScheduleMonth,
  parseSchedulePattern,
  scheduleDraftReady,
  validateScheduleDraft,
} from "./scheduleDraft";

vi.mock("@/data/wedash/stores", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/data/wedash/stores")>();
  return {
    ...mod,
    fetchStoreSellers: async () => new Map(),
    storesForSession: () => [],
  };
});

describe("parseScheduleMonth", () => {
  it("próximo mês e nome", () => {
    expect(parseScheduleMonth("escala do próximo mês", "2026-10-29")).toBe("2026-11-01");
    expect(parseScheduleMonth("escala de novembro", "2026-10-29")).toBe("2026-11-01");
  });
});

describe("parseSchedulePattern", () => {
  it("reconhece modelos", () => {
    expect(parseSchedulePattern("modelo 6x1")).toBe("6x1");
    expect(parseSchedulePattern("escala 5×2")).toBe("5x2");
    expect(parseSchedulePattern("doze por trinta e seis 12x36")).toBe("12x36");
  });
});

describe("validateScheduleDraft", () => {
  it("exige equipe", () => {
    const form = emptyScheduleForm("a");
    form.monthStart = "2026-11-01";
    expect(validateScheduleDraft(form).people).toBeTruthy();
    form.people = [{ id: "1", name: "Ana", sex: "woman" }];
    expect(scheduleDraftReady(form)).toBe(true);
  });
});

describe("Topbar Todas — escala pede filial", () => {
  it("nao inventa a primeira loja", async () => {
    const storeA = {
      id: "a",
      name: "CAMPO GRANDE",
      tradeName: "Shopping Campo Grande",
      code: "00010",
    };
    const storeB = { id: "b", name: "CENTRO", tradeName: "Loja Centro", code: "00386" };
    const { draft, spokenReply } = await discussSchedule("Montar escala de novembro", {
      tenantId: "t",
      membershipId: "m1",
      storeIds: [],
      stores: [storeA, storeB],
      network: [storeA, storeB],
      today: "2026-10-29",
      managerFirstName: "Romeu",
    }, null);
    expect(draft.form.storeId).toBe("");
    expect(spokenReply).toMatch(/todas as lojas|filial/i);
  });
});
