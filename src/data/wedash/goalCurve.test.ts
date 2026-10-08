import { describe, expect, it } from "vitest";
import { dailyGoal, goalHistorySameWeekdays, hourShares, weekdayWeights } from "./goalCurve";
import { parseWeekHours, type StoreWeekHours } from "./storeHours";

const week10a22: StoreWeekHours = {
  0: null,
  1: { open: "10:00", close: "22:00" },
  2: { open: "10:00", close: "22:00" },
  3: { open: "10:00", close: "22:00" },
  4: { open: "10:00", close: "22:00" },
  5: { open: "10:00", close: "22:00" },
  6: { open: "10:00", close: "22:00" },
};

describe("goalCurve", () => {
  it("sem histórico: divide a meta igual entre os dias abertos do mês", () => {
    const w = weekdayWeights(new Map(), week10a22);
    expect(w[0]).toBe(0);
    // Set/2026: 30 dias, 4 domingos  ->  26 dias abertos.
    expect(dailyGoal(26_000, "2026-09-21", w)).toBeCloseTo(1_000);
    expect(dailyGoal(26_000, "2026-09-20", w)).toBe(0);
  });

  it("sábado que vende o dobro recebe o dobro da meta", () => {
    const hist = new Map<string, number>([
      ["2026-08-24", 100], // seg
      ["2026-08-25", 100],
      ["2026-08-26", 100],
      ["2026-08-27", 100],
      ["2026-08-28", 100],
      ["2026-08-29", 200], // sab
    ]);
    const w = weekdayWeights(hist, week10a22);
    const seg = dailyGoal(100_000, "2026-09-21", w);
    const sab = dailyGoal(100_000, "2026-09-26", w);
    expect(sab / seg).toBeCloseTo(2);
    const total = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`)
      .reduce((s, iso) => s + dailyGoal(100_000, iso, w), 0);
    expect(total).toBeCloseTo(100_000);
  });

  it("hora segue a participação histórica dentro do expediente", () => {
    const shares = hourShares(new Map([[10, 10], [15, 30], [23, 999]]), week10a22, 1);
    expect(shares.size).toBe(12);
    expect(shares.get(15)).toBeCloseTo(0.75);
    expect(shares.get(10)).toBeCloseTo(0.25);
    expect(shares.has(23)).toBe(false);
  });

  it("sem histórico por hora: divide igual pelo expediente", () => {
    const shares = hourShares(new Map(), parseWeekHours({ 1: { open: "09:00", close: "21:00" } }), 1);
    expect(shares.size).toBe(12);
    expect(shares.get(9)).toBeCloseTo(1 / 12);
  });

  it("mesmo dia da semana nas semanas anteriores", () => {
    expect(goalHistorySameWeekdays("2026-09-21").slice(0, 2)).toEqual(["2026-09-14", "2026-09-07"]);
  });
});
