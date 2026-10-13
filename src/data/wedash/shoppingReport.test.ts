import { describe, expect, it } from "vitest";
import { formatAllosAmount, informedLaunchValues, monthReport, type SalesWindow } from "./shoppingReport";

const today = "2026-10-13";

function week(days: Array<[string, number | null, number]>, kind: SalesWindow["kind"] = "informed"): SalesWindow {
  return {
    kind,
    days: days.map(([date, fieldCents, soldCents]) => ({ date, fieldCents, soldCents })),
  };
}

describe("informedLaunchValues", () => {
  it("fills every blank past day and keeps a value already in the form", () => {
    const windows = [
      week([
        ["2026-10-11", null, 10000],
        ["2026-10-12", 8000, 9000],
        ["2026-10-13", null, 5000],
        ["2026-10-14", null, 0],
      ]),
    ];
    expect(informedLaunchValues(windows, today)).toEqual([
      { date: "2026-10-11", cents: 10000 },
      { date: "2026-10-12", cents: 8000 },
      { date: "2026-10-13", cents: null },
      { date: "2026-10-14", cents: null },
    ]);
  });

  it("fills blank past days in an older window too", () => {
    const windows = [week([["2026-10-04", null, 675680]]), week([["2026-10-11", null, 1000]])];
    expect(informedLaunchValues(windows, today).map((day) => day.cents)).toEqual([675680, 1000]);
  });

  it("sends 0,00 when a closed day had no sales", () => {
    const windows = [week([["2026-10-12", null, 0]])];
    expect(informedLaunchValues(windows, today)).toEqual([{ date: "2026-10-12", cents: 0 }]);
  });

  it("does not write the Online line", () => {
    const windows = [week([["2026-10-12", null, 5000]], "online")];
    expect(informedLaunchValues(windows, today)).toEqual([]);
  });
});

describe("monthReport", () => {
  it("subtracts sold from launched and counts a missing launch as zero", () => {
    const report = monthReport(
      [
        { date: "2026-10-11", soldCents: 10000, launchedCents: 12000 },
        { date: "2026-10-12", soldCents: 5000, launchedCents: null },
        { date: "2026-10-13", soldCents: 9999, launchedCents: null },
      ],
      today,
    );
    expect(report).toEqual({
      soldCents: 15000,
      launchedCents: 12000,
      differenceCents: -3000,
      blankDays: 1,
    });
  });
});

describe("formatAllosAmount", () => {
  it("uses the shopping form's thousands and decimal marks", () => {
    expect(formatAllosAmount(675680)).toBe("6.756,80");
    expect(formatAllosAmount(0)).toBe("0,00");
  });
});
