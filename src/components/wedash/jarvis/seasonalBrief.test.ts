import { describe, expect, it } from "vitest";
import {
  buildSeasonalBrief,
  detectSeasonalEventMention,
  formatSeasonalBrief,
  looksLikeAskSeasonalInclusion,
  seasonalBiasForPeriod,
  speakSeasonalBiasBreakdown,
  speakSeasonalInclusionAnswer,
} from "./seasonalBrief";

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

  it("justificativa prioriza Black Friday antes dos feriados (nao slice por data)", () => {
    const bias = seasonalBiasForPeriod("2026-11-01", "2026-11-30");
    const speak = speakSeasonalBiasBreakdown(bias);
    expect(speak.toLowerCase()).toMatch(/black friday/);
    expect(speak.indexOf("Black Friday")).toBeLessThan(speak.indexOf("Feriados"));
    expect(speak).toMatch(/\+12%/);
    expect(speak).toMatch(/Finados/);
    // Fator: +12% BF −1%×3 feriados = +9%
    expect(Math.round((bias.factor - 1) * 100)).toBe(9);
  });

  it("mes sem data comercial forte fica perto de 1", () => {
    const bias = seasonalBiasForPeriod("2026-04-01", "2026-04-30");
    expect(bias.factor).toBeLessThanOrEqual(1.05);
  });
});

describe("pergunta sazonal vs proposta (qualquer data)", () => {
  it("detecta Black Friday, Natal e pergunta generica de inclusao", () => {
    expect(detectSeasonalEventMention("E a Black Friday, já entrou?")).toBe("Black Friday");
    expect(detectSeasonalEventMention("O Natal já está no ajuste?")).toBe("Natal");
    expect(detectSeasonalEventMention("Finados puxa pra baixo?")).toBe("Finados");
    expect(looksLikeAskSeasonalInclusion("E a Black Friday, já entrou?")).toBe(true);
    expect(looksLikeAskSeasonalInclusion("O Natal já está no ajuste?")).toBe(true);
    expect(looksLikeAskSeasonalInclusion("esse ajuste sazonal já entrou?")).toBe(true);
    expect(looksLikeAskSeasonalInclusion("vamos de 250 mil")).toBe(false);
  });

  it("explica inclusao sem sugerir novo R$ e distingue limiar 110%", () => {
    const bias = seasonalBiasForPeriod("2026-11-01", "2026-11-30");
    const text = speakSeasonalInclusionAnswer({
      bias,
      eventName: "Black Friday",
      proposedAmount: 244_600,
      appliedTarget: 244_600,
      tierThresholdAmount: 260_000,
      tierPct: 110,
      tierBase: 236_364,
    });
    expect(text.toLowerCase()).toMatch(/já entrou|ja entrou/);
    expect(text).toMatch(/Black Friday/);
    expect(text).toMatch(/\+12%/);
    expect(text).toMatch(/244/);
    expect(text).toMatch(/não somo|nao somo/i);
    expect(text).not.toMatch(/260\.?000.*recomendo|recomendo.*260/i);
    expect(text).toMatch(/110%/);
    expect(text).toMatch(/236/);
    expect(text).toMatch(/meta-base|análise comercial|analise comercial/i);
  });

  it("Natal em dezembro: mesma logica de inclusao", () => {
    const bias = seasonalBiasForPeriod("2026-12-01", "2026-12-31");
    expect(detectSeasonalEventMention("O Natal já contou nessa meta?")).toBe("Natal");
    const text = speakSeasonalInclusionAnswer({
      bias,
      eventName: "Natal",
      proposedAmount: 300_000,
      appliedTarget: null,
    });
    expect(text).toMatch(/Natal/);
    expect(text).toMatch(/\+15%/);
    expect(text).toMatch(/já entrou|ja entrou/i);
    expect(text).toMatch(/não somo|nao somo/i);
    expect(text).not.toMatch(/recomendo R\$|vamos subir/i);
  });
});
