import { describe, expect, it } from "vitest";
import { missingCloseDays, monthCloseSpan, monthCloseSpanFor } from "./cashCloseMonth";

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
