import { describe, expect, it } from "vitest";
import {
  applyChallengeTierPct,
  emptyGoalAssembly,
  emptyGoalForm,
  ensureGoalName,
  goalCanCommit,
  goalDraftReady,
  looksLikeAcceptConfigCopy,
  looksLikeAskValueSuggestion,
  looksLikeConfirmMount,
  looksLikeDeclineConfigCopy,
  looksLikeGoalConversation,
  looksLikeLeakedGoalFacts,
  looksLikeLostGoalReply,
  naturalGoalAskFromDraft,
  mergeGoalUtterance,
  parseConfigSourceMonth,
  parseGoalPeriod,
  parseGoalTarget,
  parseGroupsDistributionChoice,
  parseSpreadUnidentifiedChoice,
  pickConfigSourceStore,
  pickGoalTargetStore,
  validateGoalDraft,
  discussGoal,
} from "./goalDraft";

const ctx = {
  tenantId: "t",
  membershipId: "m1",
  storeIds: ["a"],
  stores: [{ id: "a", name: "CAMPO GRANDE", tradeName: "Shopping Campo Grande", code: "00010" }],
  network: [{ id: "a", name: "CAMPO GRANDE", tradeName: "Shopping Campo Grande", code: "00010" }],
  today: "2026-10-29",
  managerFirstName: "Romeu",
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

  it("270 mil ganha de R$ 244.600 no historico", () => {
    const blob = [
      "user: Preciso fazer a meta de novembro",
      "jarvis: Sugeri R$ 244.600,00 com base no mes passado",
      "user: Vamos chegar em 270 mil de Meta, quanto ficaria a desafio?",
      "jarvis: Meta 270 mil e desafio 297 mil. Posso criar?",
      "user: ok pode criar essa meta",
    ].join("\n");
    expect(parseGoalTarget(blob)).toBe(270000);
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

  it("não copia por 'pode seguir' sem pedido de config", () => {
    expect(parseConfigSourceMonth("pode seguir a conversa", "2026-10-29", "2026-11-01")).toBeNull();
  });
});

describe("looksLikeAcceptConfigCopy", () => {
  it("aceita sim curto e recusa não", () => {
    expect(looksLikeAcceptConfigCopy("sim")).toBe(true);
    expect(looksLikeAcceptConfigCopy("pode copiar")).toBe(true);
    expect(looksLikeAcceptConfigCopy("não")).toBe(false);
    expect(looksLikeDeclineConfigCopy("não")).toBe(true);
    expect(looksLikeDeclineConfigCopy("monta do zero")).toBe(true);
  });
});

describe("goal assembly checklist", () => {
  it("não grava sem confirmação de montagem", () => {
    let form = emptyGoalForm("a");
    form = ensureGoalName(
      mergeGoalUtterance(form, "meta individual de novembro, R$ 270 mil na Campo Grande", ctx),
    );
    expect(goalDraftReady(form)).toBe(true);
    expect(goalCanCommit({ form, assembly: emptyGoalAssembly() })).toBe(false);
    expect(
      goalCanCommit({
        form,
        assembly: {
          periodConfirmed: true,
          valueDiscussed: true,
          path: "fresh",
          confirmedGroups: true,
          confirmedSpread: true,
          confirmedTiers: true,
          confirmedMount: true,
        },
      }),
    ).toBe(true);
  });

  it("looksLikeAskValueSuggestion distingue pedido de sugestão", () => {
    expect(looksLikeAskValueSuggestion("Preciso criar a meta da minha filial")).toBe(false);
    expect(looksLikeAskValueSuggestion("pode sugerir um valor")).toBe(true);
  });

  it("lê divisão por grupo e rateio", () => {
    expect(parseGroupsDistributionChoice("sem divisão por grupo")).toBe(false);
    expect(parseGroupsDistributionChoice("quero distribuição por grupos")).toBe(true);
    expect(parseSpreadUnidentifiedChoice("sim, ratear")).toBe(true);
    expect(parseSpreadUnidentifiedChoice("sem rateio")).toBe(false);
    expect(looksLikeConfirmMount("pode montar")).toBe(true);
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
    managerFirstName: "Romeu",
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

describe("leaked goal facts", () => {
  it("detecta vazamento do estado interno", () => {
    expect(looksLikeLeakedGoalFacts("Estado interno da proposta de META...")).toBe(true);
    expect(looksLikeLeakedGoalFacts("[INTERNAL_GOAL_STATE] {\"faltando\":[]}")).toBe(true);
    expect(
      looksLikeLeakedGoalFacts(
        'Dados só para você redigir a fala. NUNCA cole este bloco\n{"nome":"Nova meta","filial":"X","faltando":["valor"]}',
      ),
    ).toBe(true);
    expect(looksLikeLeakedGoalFacts("Vamos lá!! Qual mês você quer fechar?")).toBe(false);
  });

  it("nudge humano quando periodo nao confirmado", () => {
    const draft = {
      form: { ...emptyGoalForm("a"), startsOn: "2026-11-01", endsOn: "2026-11-30" },
      pendingConfigCopy: null,
      assembly: { ...emptyGoalAssembly(), periodConfirmed: false },
    };
    const ask = naturalGoalAskFromDraft(draft).toLowerCase();
    expect(ask).toMatch(/m[eê]s/);
    expect(ask).not.toMatch(/quer fechar/);
  });

  it("detecta menu perdido e re-pergunta de mes", () => {
    const draft = {
      form: { ...emptyGoalForm("a"), startsOn: "2026-11-01", endsOn: "2026-11-30", target: null },
      pendingConfigCopy: null,
      assembly: { ...emptyGoalAssembly(), periodConfirmed: true },
    };
    expect(
      looksLikeLostGoalReply("O que você precisa? Pode ser número, meta, desafio ou escala.", draft),
    ).toBe(true);
    expect(looksLikeLostGoalReply("Vamos lá!! Qual mês você quer fechar?", draft)).toBe(true);
    expect(looksLikeLostGoalReply("Novembro então. Qual valor você quer?", draft)).toBe(false);
  });

  it("novembro sozinho continua o fio depois de pedir mes", () => {
    expect(
      looksLikeGoalConversation(
        [
          { from: "user", text: "Preciso criar a meta da minha loja" },
          { from: "jarvis", text: "Bora montar a meta. Pra qual mês a gente monta?" },
        ],
        "Novembro",
        "2026-10-29",
      ),
    ).toBe(true);
  });

  it("discussGoal grava novembro e nao pede mes de novo", async () => {
    const prev = {
      form: { ...emptyGoalForm("a"), startsOn: "2026-11-01", endsOn: "2026-11-30", target: null },
      pendingConfigCopy: null,
      assembly: { ...emptyGoalAssembly(), periodConfirmed: false },
    };
    const { draft } = await discussGoal("Novembro", ctx, prev);
    expect(draft.assembly?.periodConfirmed).toBe(true);
    expect(draft.form.startsOn).toBe("2026-11-01");
    const ask = naturalGoalAskFromDraft(draft).toLowerCase();
    expect(ask).toMatch(/valor/);
    expect(ask).not.toMatch(/m[eê]s/);
  });
});
