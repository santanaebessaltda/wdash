import { describe, expect, it } from "vitest";
import { buildSeasonalBrief, formatSeasonalBrief } from "./seasonalBrief";

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
