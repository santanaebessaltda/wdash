import { describe, expect, it } from "vitest";
import { buildSeasonalBrief, formatSeasonalBrief, seasonalBiasForPeriod } from "./seasonalBrief";

describe("buildSeasonalBrief", () => {
  it("lista datas futuras a partir de hoje", () => {
    const rows = buildSeasonalBrief("2026-10-01", 3);
    expect(rows.every((r) => r.date >= "2026-10-01")).toBe(true);
    expect(rows.some((r) => /Black Friday|Natal|Finados|Consciência|Proclamação|Nossa Senhora/i.test(r.name))).toBe(
      true,
    );
  });
});

describe("formatSeasonalBrief", () => {
  it("convida a montar meta/desafio com autorização", () => {
    const text = formatSeasonalBrief(buildSeasonalBrief("2026-10-01", 4), "2026-10-01");
    expect(text.toLowerCase()).toMatch(/autoriz/);
  });
});

describe("seasonalBiasForPeriod", () => {
  it("novembro sobe com Black Friday", () => {
    const bias = seasonalBiasForPeriod("2026-11-01", "2026-11-30");
    expect(bias.events.some((e) => /Black Friday/i.test(e.name))).toBe(true);
    expect(bias.factor).toBeGreaterThan(1);
    expect(bias.summary.toLowerCase()).toMatch(/black friday/);
  });

  it("mes sem data comercial forte fica perto de 1", () => {
    const bias = seasonalBiasForPeriod("2026-04-01", "2026-04-30");
    expect(bias.factor).toBeLessThanOrEqual(1.05);
  });
});
