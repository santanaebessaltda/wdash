import { describe, expect, it } from "vitest";
import { goalMonthFloor, laterMonth, monthCoveredByGoal, scheduleStartMonth } from "./goalMonths";

const october = { startsOn: "2026-10-01", endsOn: "2026-10-31" };
const september = { startsOn: "2026-09-01", endsOn: "2026-09-30" };

describe("meses com meta", () => {
  it("abre outubro quando o mês atual tem meta", () => {
    expect(scheduleStartMonth("2026-10-25", [october])).toBe("2026-10-01");
  });

  it("abre novembro quando outubro não tem meta", () => {
    expect(scheduleStartMonth("2026-10-25", [])).toBe("2026-11-01");
    expect(monthCoveredByGoal("2026-10-01", [])).toBe(false);
  });

  it("volta só pelos meses seguidos que têm meta", () => {
    expect(goalMonthFloor("2026-10-25", [october, september])).toBe("2026-09-01");
    expect(goalMonthFloor("2026-10-25", [october])).toBe("2026-10-01");
    expect(goalMonthFloor("2026-10-25", [september])).toBe("2026-10-01");
  });

  it("não abre um mês anterior ao dado gravado", () => {
    expect(laterMonth("2026-10-01", "2026-09-01")).toBe("2026-10-01");
  });
});
