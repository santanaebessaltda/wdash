import { describe, expect, it } from "vitest";
import { clampCloseRange, closeHistoryFloor, missingCloseDays, monthCloseSpan, monthCloseSpanFor, navMonthFloor, sangriaMonthSpan } from "./cashCloseMonth";

describe("monthCloseSpan", () => {
  it("no dia 8 pede do dia 1 até o dia 7", () => {
    expect(monthCloseSpan("2026-10-08")).toEqual({ from: "2026-10-01", to: "2026-10-07" });
  });

  it("no dia 1 ainda não há dia para fechar", () => {
    expect(monthCloseSpan("2026-10-01")).toBeNull();
  });

  it("um mês já passado pede o mês inteiro", () => {
    expect(monthCloseSpanFor("2026-09-15", "2026-10-08")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});

describe("closeHistoryFloor", () => {
  it("conta de outubro começa no dia 1 e ignora setembro", () => {
    expect(closeHistoryFloor("2026-10-10")).toBe("2026-10-01");
    expect(clampCloseRange("2026-09-01", "2026-09-30", "2026-10-01")).toBeNull();
  });

  it("conta de novembro não puxa outubro", () => {
    expect(closeHistoryFloor("2026-11-03")).toBe("2026-11-01");
    expect(clampCloseRange("2026-10-01", "2026-11-10", "2026-11-01")).toEqual({ from: "2026-11-01", to: "2026-11-10" });
  });

  it("conta anterior a outubro também começa em outubro", () => {
    expect(closeHistoryFloor("2026-09-02")).toBe("2026-10-01");
  });
});

describe("sangriaMonthSpan", () => {
  it("no dia 10 pede do dia 1 até hoje", () => {
    expect(sangriaMonthSpan("2026-10-10", "2026-10-10")).toEqual({ from: "2026-10-01", to: "2026-10-10" });
  });

  it("um mês já passado pede o mês inteiro", () => {
    expect(sangriaMonthSpan("2026-11-02", "2026-12-10")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });
});

describe("navMonthFloor", () => {
  it("sem o mês anterior fechado, só deixa o mês atual", () => {
    expect(navMonthFloor("2026-10-10", null, null)).toBe("2026-10-01");
    expect(navMonthFloor("2026-12-10", "2026-10-02", "2026-10-20")).toBe("2026-12-01");
  });

  it("com o mês anterior fechado, abre desde o mais antigo que tem dado", () => {
    expect(navMonthFloor("2026-11-10", "2026-10-01", "2026-10-31")).toBe("2026-10-01");
    expect(navMonthFloor("2026-12-10", "2026-10-01", "2026-11-02")).toBe("2026-10-01");
  });
});

describe("missingCloseDays", () => {
  it("pula o dia que já tem fechamento e não inclui hoje", () => {
    const filled = new Set(["2026-10-02", "2026-10-03"]);
    expect(missingCloseDays("2026-10-01", "2026-10-07", "2026-10-08", filled)).toEqual([
      "2026-10-01",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ]);
  });
});
