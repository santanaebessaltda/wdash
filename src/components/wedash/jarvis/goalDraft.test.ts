import { describe, expect, it } from "vitest";
import {
  applyChallengeTierPct,
  emptyGoalForm,
  ensureGoalName,
  goalDraftReady,
  mergeGoalUtterance,
  parseConfigSourceMonth,
  parseGoalPeriod,
  parseGoalTarget,
  pickConfigSourceStore,
  pickGoalTargetStore,
  validateGoalDraft,
} from "./goalDraft";

const ctx = {
  tenantId: "t",
  storeIds: ["a"],
  stores: [{ id: "a", name: "CAMPO GRANDE", tradeName: "Shopping Campo Grande", code: "00010" }],
  network: [{ id: "a", name: "CAMPO GRANDE", tradeName: "Shopping Campo Grande", code: "00010" }],
  today: "2026-10-29",
};

describe("parseGoalPeriod", () => {
  it("próximo mês", () => {
    expect(parseGoalPeriod("meta do próximo mês", "2026-10-29")).toEqual({
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
    });
  });

  it("nome do mês", () => {
    expect(parseGoalPeriod("meta de novembro", "2026-10-29")?.startsOn).toBe("2026-11-01");
  });

  it("novembro ganha de outubro de referencia no mesmo texto", () => {
    const q =
      "Preciso fazer a meta de novembro da minha filial. Qual valor vc sugere tendo em vista a meta de outubro?";
    expect(parseGoalPeriod(q, "2026-10-29")?.startsOn).toBe("2026-11-01");
  });
});

describe("parseGoalTarget", () => {
  it("lê R$ e mil", () => {
    expect(parseGoalTarget("meta de R$ 180.000")).toBe(180000);
    expect(parseGoalTarget("meta de 180 mil")).toBe(180000);
  });
});

describe("mergeGoalUtterance", () => {
  it("fecha rascunho mínimo para autorizar", () => {
    let form = emptyGoalForm("a");
    form = mergeGoalUtterance(form, "meta individual de novembro, R$ 180 mil na Campo Grande", ctx);
    form = ensureGoalName(form);
    expect(form.tierMode).toBe("INDIVIDUAL");
    expect(form.startsOn).toBe("2026-11-01");
    expect(form.target).toBe(180000);
    expect(form.storeId).toBe("a");
    expect(goalDraftReady(form)).toBe(true);
    expect(Object.keys(validateGoalDraft(form))).toEqual([]);
  });

  it("nível desafio +10% ajusta o último degrau para 110%", () => {
    let form = emptyGoalForm("a");
    form = mergeGoalUtterance(
      form,
      "meta 350 mil, nível desafio 10% a mais, mesma configuração de outubro",
      ctx,
    );
    expect(form.tiers[form.tiers.length - 1]?.minAttainmentPct).toBe(110);
    expect(form.tiers[form.tiers.length - 1]?.name).toMatch(/desafio/i);
  });
});

describe("parseConfigSourceMonth", () => {
  it("lê outubro como fonte da escada", () => {
    expect(parseConfigSourceMonth("mesma configuração da meta de outubro", "2026-10-29")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });
});

describe("applyChallengeTierPct", () => {
  it("mantém escada crescente ao baixar o desafio para 110%", () => {
    const tiers = applyChallengeTierPct(
      [
        { name: "N1", minAttainmentPct: 100, commissionPct: 1.5, bonus: 0 },
        { name: "N2", minAttainmentPct: 120, commissionPct: 2, bonus: 0 },
        { name: "N3", minAttainmentPct: 150, commissionPct: 2.5, bonus: 0 },
        { name: "N4", minAttainmentPct: 180, commissionPct: 3, bonus: 0 },
      ],
      110,
    );
    expect(tiers.map((t) => t.minAttainmentPct)).toEqual([100, 110]);
    expect(tiers[1]?.name).toMatch(/desafio/i);
  });
});

describe("fonte vs destino da meta", () => {
  const sb = { id: "sb", name: "SB EMPREENDIMENTOS", tradeName: "SB EMPREENDIMENTOS", code: "00010" };
  const centro = {
    id: "centro",
    name: "LOJAWEPINK.CENTRO.CAMPOGRANDE",
    tradeName: "LOJAWEPINK.CENTRO.CAMPOGRANDE",
    code: "00386",
  };
  const multi = {
    tenantId: "t",
    storeIds: ["centro"],
    stores: [centro],
    network: [sb, centro],
    today: "2026-10-29",
  };
  const q =
    "Quero seguir a mesma configuração de Outubro da filial SB EMPREENDIMENTOS porém aqui pra Loja, Meta Individual";

  it("fonte = SB e destino = CENTRO", () => {
    const matched = [sb, centro];
    expect(pickConfigSourceStore(q, matched)?.id).toBe("sb");
    expect(pickGoalTargetStore(q, matched, sb)?.id).toBe("centro");
  });

  it("merge grava storeId da Loja destino", () => {
    const form = mergeGoalUtterance(emptyGoalForm(""), q, multi);
    expect(form.storeId).toBe("centro");
    expect(form.tierMode).toBe("INDIVIDUAL");
  });
});
