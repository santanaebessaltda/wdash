import { describe, expect, it } from "vitest";
import {
  emptyScheduleForm,
  parseScheduleMonth,
  parseSchedulePattern,
  scheduleDraftReady,
  validateScheduleDraft,
} from "./scheduleDraft";

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
