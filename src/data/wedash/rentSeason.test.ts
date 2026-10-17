import { describe, expect, it } from "vitest";
import { parseRentSeasons, rentSeasonFactor, type RentSeason } from "./rentSeason";

const seasons: RentSeason[] = [
  { month: 12, yearMonth: null, factor: 2 },
  { month: 6, yearMonth: null, factor: 1.5 },
  { month: null, yearMonth: "2026-11", factor: 1.5 },
];

describe("rentSeasonFactor", () => {
  it("uses 1 when the month has no exception", () => {
    expect(rentSeasonFactor(seasons, "2026-08")).toBe(1);
    expect(rentSeasonFactor(undefined, "2026-12")).toBe(1);
  });

  it("repeats the month every year and prefers a specific month", () => {
    expect(rentSeasonFactor(seasons, "2027-12")).toBe(2);
    expect(rentSeasonFactor(seasons, "2026-06")).toBe(1.5);
    expect(rentSeasonFactor(seasons, "2026-11")).toBe(1.5);
    expect(rentSeasonFactor([{ month: 11, yearMonth: null, factor: 2 }, seasons[2]!], "2026-11")).toBe(1.5);
  });
});

describe("parseRentSeasons", () => {
  it("drops invalid rows", () => {
    expect(parseRentSeasons([{ month: 12, factor: 2 }, { yearMonth: "2026-11", factor: 1.5 }, { factor: 0 }, null])).toEqual([
      { month: 12, yearMonth: null, factor: 2 },
      { month: null, yearMonth: "2026-11", factor: 1.5 },
    ]);
  });
});
