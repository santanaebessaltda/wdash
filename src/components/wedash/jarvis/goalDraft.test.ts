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
  looksLikeBareCopyAccept,
  looksLikeChooseCopyPath,
  looksLikeChooseFreshPath,
  looksLikeChooseRecommendedPath,
  looksLikeConfirmMount,
  looksLikeDeclineConfigCopy,
  looksLikeExplicitConfigCopy,
  looksLikeGoalConversation,
  looksLikeAskGroupWeightAdvice,
  looksLikeInspectGoalDraft,
  looksLikeLeakedGoalFacts,
  looksLikeLadderCopyCorrection,
  looksLikeLostGoalReply,
  looksLikeStallingGoalReply,
  naturalGoalAskFromDraft,
  persistGoalDraftSession,
  loadGoalDraftSession,
  clearGoalDraftSession,
  formatGoalFactsForModel,
  mergeGoalUtterance,
  parseConfigSourceMonth,
  parseGoalAssemblyPath,
  parseGoalPeriod,
  parseGoalTarget,
  parseGroupsDistributionChoice,
  parseSpreadUnidentifiedChoice,
  pickConfigSourceStore,
  pickGoalTargetStore,
  speakGoalAssemblyPathOffer,
  speakGoalDraftConfig,
  speakGoalWeightAdvice,
  validateGoalDraft,
  discussGoal,
  goalAssemblyPendingSteps,
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
    expect(parseConfigSourceMonth("Vamos copiar a mesma escada do mes de Outubro", "2026-10-29")).toEqual({
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
    expect(looksLikeAcceptConfigCopy("Vamos copiar a mesma escada do mes de Outubro")).toBe(true);
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
    // P0: confirmedMount sozinho não autoriza gravação — precisa pendingCommit.authorized.
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
    ).toBe(false);
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
    expect(ask).toMatch(/proposta|historico|sazonal/);
    expect(ask).not.toMatch(/m[eê]s\?|qual m[eê]s/);
  });

  it("checklist depois do valor ainda pede caminho de montagem (nao so R$)", () => {
    const draft = {
      form: {
        ...emptyGoalForm("a"),
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 250_000,
      },
      pendingConfigCopy: null,
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
      },
    };
    const pending = goalAssemblyPendingSteps(draft);
    expect(pending[0]).toMatch(/caminho|recomenda|zero|copiar/i);
    expect(pending[0]).toMatch(/aceitar valor/i);
  });

  it("discussGoal aceita copiar escada de outubro e sai do passo de copia", async () => {
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        name: "Novembro 2026",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 250_000,
      },
      pendingConfigCopy: { from: "2026-10-01", to: "2026-10-31" },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: null as const,
      },
    };
    const q = "Vamos copiar a mesma escada do mes de Outubro";
    expect(looksLikeExplicitConfigCopy(q)).toBe(true);
    expect(parseGoalAssemblyPath(q)).toBe("copy");
    const { draft } = await discussGoal(q, ctx, prev);
    expect(draft.assembly?.path).toBe("copy");
    // Sem meta no banco de teste → copyStatus failed (não finge 2 níveis ok).
    expect(draft.copyStatus).toBe("failed");
    expect(goalAssemblyPendingSteps(draft).some((p) => /buscar|falhou|cópia/i.test(p))).toBe(true);
  });

  it('discussGoal "Sim" solto com path null nao seleciona copia', async () => {
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        name: "Novembro 2026",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 250_000,
      },
      pendingConfigCopy: { from: "2026-10-01", to: "2026-10-31" },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: null as const,
      },
    };
    const { draft } = await discussGoal("Sim", ctx, prev);
    expect(draft.assembly?.path).toBeNull();
    expect(draft.copyStatus == null || draft.copyStatus !== "ok").toBe(true);
    expect(goalAssemblyPendingSteps(draft)[0]).toMatch(/caminho|recomenda|zero/i);
  });

  it("discussGoal copia outubro + ultimo nivel R$ nao aplica 260k como meta-base sem escada", async () => {
    const blob = [
      "user: Preciso da meta de novembro",
      "jarvis: Qual valor?",
      "user: Acho que a gente pode copiar a mesma configuração de Outubro, e deixar o ultimo nivel com R$ 260.000,00",
    ].join("\n");
    const { draft, spokenReply } = await discussGoal(blob, ctx, null);
    expect(draft.form.startsOn).toBe("2026-11-01");
    // P1: R$ no nível ≠ meta-base; sem escada real não inventa % nem aplica 260k.
    expect(draft.form.target).not.toBe(260_000);
    expect(draft.proposedTarget == null || draft.proposedTarget !== 260_000).toBe(true);
    expect(draft.assembly?.periodConfirmed).toBe(true);
    // Fala determinística pede escada real ou propõe base — nunca afirma que aplicou 260k.
    if (spokenReply) {
      expect(spokenReply).not.toMatch(/Apliquei R\$ 260/);
      expect(spokenReply).toMatch(/escada|referência|referencia|nível|nivel|aplicar|meta-base|260/i);
    }
  });

  it("detecta resposta que promete e nao avanca", () => {
    expect(
      looksLikeStallingGoalReply(
        "Beleza! Vamos copiar a configuração de outubro. Vou montar isso. Um momento.",
      ),
    ).toBe(true);
    expect(looksLikeStallingGoalReply("Ficou R$ 260.000,00. Posso salvar o rascunho?")).toBe(false);
  });

  it("detecta correcao de escada/grupos copiados", () => {
    expect(
      looksLikeLadderCopyCorrection("Nas configurações de Outubro tem mais de 2 niveis, e tem divisão por grupo"),
    ).toBe(true);
  });

  it("frase completa: novembro + copia outubro + desafio 10% + valor", async () => {
    const { draft } = await discussGoal(
      "Monte a meta de novembro copiando outubro, desafio 10% a mais, meta de 420 mil",
      ctx,
      null,
    );
    expect(draft.form.startsOn).toBe("2026-11-01");
    expect(draft.form.target).toBe(420_000);
    expect(draft.userLockedTarget).toBe(true);
    expect(draft.assembly?.periodConfirmed).toBe(true);
    // Sem meta no banco de teste a cópia falha, mas a intenção path=copy fica marcada.
    expect(draft.assembly?.path).toBe("copy");
    expect(draft.copyStatus === "failed" || draft.copyStatus === "ok").toBe(true);
  });

  it("Sim solto nao copia; copiar outubro sim, sem reaproveitar R$ do historico", async () => {
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        name: "Novembro 2026",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 250_000,
      },
      pendingConfigCopy: { from: "2026-10-01", to: "2026-10-31" },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: null as const,
      },
      userLockedTarget: true,
    };
    const bare = await discussGoal(
      ["user: meta de 250 mil", "jarvis: como prefere seguir?", "user: Sim"].join("\n"),
      ctx,
      prev,
    );
    expect(bare.draft.form.target).toBe(250_000);
    expect(bare.draft.assembly?.path).toBeNull();

    const { draft } = await discussGoal(
      ["user: meta de 250 mil", "jarvis: como prefere seguir?", "user: Copiar outubro"].join("\n"),
      ctx,
      prev,
    );
    expect(draft.form.target).toBe(250_000);
    expect(draft.assembly?.path).toBe("copy");
  });

  it("troca de mes zera alvo sem R$ novo", async () => {
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        startsOn: "2026-10-01",
        endsOn: "2026-10-31",
        target: 200_000,
      },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
      },
      userLockedTarget: true,
    };
    const { draft } = await discussGoal("Na verdade quero a meta de novembro", ctx, prev);
    expect(draft.form.startsOn).toBe("2026-11-01");
    expect(draft.form.target).toBeNull();
    expect(draft.userLockedTarget).toBe(false);
  });

  it("substitui valor recomendado pelo falado pelo gestor", async () => {
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 300_000,
      },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: "copy" as const,
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
      },
      userLockedTarget: false,
      copyStatus: "ok" as const,
    };
    const { draft } = await discussGoal("Vamos de 450 mil", ctx, prev);
    expect(draft.form.target).toBe(450_000);
    expect(draft.userLockedTarget).toBe(true);
  });

  it("turnId idempotente nao reaplica", async () => {
    const first = await discussGoal("Meta de novembro, 250 mil", ctx, null, { turnId: "turn-1" });
    expect(first.draft.lastAppliedTurnId).toBe("turn-1");
    const second = await discussGoal("Meta de novembro, 250 mil", ctx, first.draft, { turnId: "turn-1" });
    expect(second.skipped).toBe(true);
    expect(second.draft.form.target).toBe(first.draft.form.target);
  });

  it("persiste e recupera rascunho na sessao", () => {
    clearGoalDraftSession();
    const draft = {
      form: {
        ...emptyGoalForm("a"),
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 420_000,
      },
      assembly: { ...emptyGoalAssembly(), periodConfirmed: true, valueDiscussed: true },
      lastAppliedTurnId: "x",
    };
    persistGoalDraftSession(draft);
    const loaded = loadGoalDraftSession();
    expect(loaded?.form.target).toBe(420_000);
    expect(loaded?.lastAppliedTurnId).toBe("x");
    clearGoalDraftSession();
    expect(loadGoalDraftSession()).toBeNull();
  });

  it("goalCanCommit exige pendingCommit.authorized (P0)", () => {
    const form = {
      ...emptyGoalForm("a"),
      name: "Novembro 2026",
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      target: 420_000,
    };
    const assembly = {
      ...emptyGoalAssembly(),
      periodConfirmed: true,
      valueDiscussed: true,
      path: "copy" as const,
      confirmedGroups: true,
      confirmedSpread: true,
      confirmedTiers: true,
      confirmedMount: true,
    };
    expect(goalCanCommit({ form, assembly })).toBe(false);
  });
});

describe("P0 proposta 244600 vs 257000", () => {
  it("sugestao nao aplica form.target automaticamente", async () => {
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        name: "Novembro 2026",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 244_600,
      },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: "copy" as const,
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
      },
      userLockedTarget: true,
      proposedTarget: null as number | null,
      copyStatus: "ok" as const,
    };
    // Sem DB real suggest pode falhar — se pedir recomendacao com lock, nao deve zerar target sem aceite.
    const { draft } = await discussGoal("qual valor voce recomenda?", ctx, prev);
    // Com userLockedTarget e asksSuggestion: proposed pode mudar, form.target permanece ate aceite explicito
    // (asksSuggestion + locked null clears only when !userLocked in older path; agora nao sobrescreve).
    expect(draft.form.target).toBe(244_600);
  });

  it("aceito a recomendada aplica proposedTarget", async () => {
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        name: "Novembro 2026",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 244_600,
      },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: "copy" as const,
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
      },
      userLockedTarget: true,
      proposedTarget: 257_000,
      copyStatus: "ok" as const,
    };
    const { draft, spokenReply } = await discussGoal("aceito a recomendada", ctx, prev);
    expect(draft.form.target).toBe(257_000);
    expect(draft.userLockedTarget).toBe(true);
    expect(spokenReply).toMatch(/257|Apliquei/i);
  });

  it.each(["Pode ser", "Fechado", "Vamos nessa", "Sim"])(
    "aceite natural %s aplica proposta sem autorizar gravação",
    async (phrase) => {
      const prev = {
        form: {
          ...emptyGoalForm("a"),
          name: "Novembro 2026",
          startsOn: "2026-11-01",
          endsOn: "2026-11-30",
          target: 244_600,
        },
        assembly: {
          ...emptyGoalAssembly(),
          periodConfirmed: true,
          valueDiscussed: true,
          path: "copy" as const,
          confirmedGroups: true,
          confirmedSpread: true,
          confirmedTiers: true,
        },
        userLockedTarget: true,
        proposedTarget: 257_000,
        copyStatus: "ok" as const,
        pendingCommit: null,
      };
      const { draft, spokenReply, shouldCommit } = await discussGoal(phrase, ctx, prev);
      expect(draft.form.target).toBe(257_000);
      expect(draft.pendingCommit?.authorized).toBeFalsy();
      expect(shouldCommit).toBeFalsy();
      expect(spokenReply).toMatch(/Apliquei|257/i);
    },
  );

  it("sim sem proposta pendente nao aplica valor", async () => {
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        name: "Novembro 2026",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 244_600,
      },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: "copy" as const,
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
      },
      userLockedTarget: true,
      proposedTarget: 244_600, // já igual ao aplicado — nada pendente
      copyStatus: "ok" as const,
    };
    const { draft, shouldCommit } = await discussGoal("Sim", ctx, prev);
    expect(draft.form.target).toBe(244_600);
    expect(shouldCommit).toBeFalsy();
  });

  it("SIM com save aguardando confirma gravação e nao troca pelo proposed", async () => {
    const form = {
      ...emptyGoalForm("a"),
      name: "Novembro 2026",
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      target: 244_600,
      groups: [{ shiftId: "m", name: "T1", pct: 100 }],
    };
    const { createPendingCommit } = await import("./goalContract");
    const pending = createPendingCommit(
      {
        form,
        assembly: {
          ...emptyGoalAssembly(),
          periodConfirmed: true,
          valueDiscussed: true,
          path: "copy",
          confirmedGroups: true,
          confirmedSpread: true,
          confirmedTiers: true,
          confirmedMount: true,
        },
      },
      "Loja",
    );
    const prev = {
      form,
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: "copy" as const,
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
        confirmedMount: true,
      },
      pendingCommit: pending,
      userLockedTarget: true,
      proposedTarget: 257_000,
      copyStatus: "ok" as const,
    };
    const { draft, shouldCommit } = await discussGoal("Sim", ctx, prev);
    expect(draft.form.target).toBe(244_600);
    expect(draft.pendingCommit?.authorized).toBe(true);
    expect(shouldCommit).toBe(true);
  });

  it("simulacao com 257 nao muda rascunho 244600", async () => {
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        name: "Novembro 2026",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 244_600,
        groups: [
          { shiftId: "m", name: "Turno 1", pct: 45 },
          { shiftId: "t", name: "Turno 2", pct: 55 },
        ],
        tiers: [
          { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50 },
          { name: "Super", minAttainmentPct: 75, commissionPct: 2, bonus: 50 },
        ],
      },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: "copy" as const,
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
      },
      userLockedTarget: true,
      proposedTarget: 257_000,
      copyStatus: "ok" as const,
    };
    const { draft, spokenReply } = await discussGoal(
      "Como ficariam os níveis com R$ 257 mil?",
      ctx,
      prev,
    );
    expect(draft.form.target).toBe(244_600);
    expect(spokenReply).toMatch(/257/);
    expect(spokenReply).toMatch(/não alterei|nao alterei|aplicado continua/i);
  });

  it("pergunta sazonal (Black Friday) explica inclusao e nao empurra 260k", async () => {
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        name: "Novembro 2026",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 244_600,
        tiers: [
          { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50 },
          { name: "Super", minAttainmentPct: 75, commissionPct: 2, bonus: 50 },
          { name: "Hiper", minAttainmentPct: 100, commissionPct: 2.5, bonus: 50 },
          { name: "Meta desafio", minAttainmentPct: 110, commissionPct: 3, bonus: 50 },
        ],
      },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: "copy" as const,
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
      },
      userLockedTarget: true,
      proposedTarget: 244_600,
      proposal: {
        amount: 244_600,
        scenarios: [],
        evidence: [],
        caveats: [],
        confidence: "medium" as const,
        rationale: "teste",
        seasonalSummary: "",
        chatBlocks: [],
      },
      tierRevenueHint: {
        amountAtLevel: 260_000,
        attainmentPct: 110,
        proposedBase: 236_364,
        tierName: "Meta desafio",
      },
      copyStatus: "ok" as const,
    };
    const { draft, spokenReply } = await discussGoal(
      "E a Black Friday, já entrou no ajuste?",
      ctx,
      prev,
    );
    expect(draft.form.target).toBe(244_600);
    expect(spokenReply).toMatch(/já entrou|ja entrou/i);
    expect(spokenReply).toMatch(/Black Friday/);
    expect(spokenReply).toMatch(/\+12%/);
    expect(spokenReply).toMatch(/não somo|nao somo/i);
    expect(spokenReply).toMatch(/110%/);
    expect(spokenReply).toMatch(/236/);
    expect(spokenReply).not.toMatch(/recomendo R\$ 260|vamos de 260|subir (pra|para) 260/i);
  });

  it("pode seguir com config pronta cria pending e fala resumo (nao grava)", async () => {
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        name: "Novembro 2026",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 244_600,
        groups: [
          { shiftId: "m", name: "Turno 1", pct: 45 },
          { shiftId: "t", name: "Turno 2", pct: 55 },
        ],
        tiers: [
          { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50 },
          { name: "Desafio", minAttainmentPct: 110, commissionPct: 3, bonus: 50 },
        ],
      },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: "copy" as const,
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
      },
      userLockedTarget: true,
      copyStatus: "ok" as const,
      pendingCommit: null,
    };
    const { draft, spokenReply, shouldCommit } = await discussGoal("pode seguir", ctx, prev);
    expect(draft.pendingCommit?.awaitingConfirm).toBe(true);
    expect(draft.pendingCommit?.authorized).toBe(false);
    expect(shouldCommit).toBeFalsy();
    expect(spokenReply).toMatch(/Posso salvar|rascunho/i);
    expect(spokenReply).toMatch(/244/);
  });

  it("SIM sem pending (LLM pediu sozinho) autoriza gravação se config pronta", async () => {
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        name: "Novembro 2026",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 244_600,
        groups: [{ shiftId: "m", name: "T1", pct: 100 }],
        tiers: [
          { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50 },
          { name: "Desafio", minAttainmentPct: 110, commissionPct: 3, bonus: 50 },
        ],
      },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: "copy" as const,
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
        confirmedMount: true,
      },
      userLockedTarget: true,
      copyStatus: "ok" as const,
      pendingCommit: null,
    };
    const { draft, shouldCommit, spokenReply } = await discussGoal("SIM", ctx, prev);
    expect(draft.pendingCommit?.authorized).toBe(true);
    expect(shouldCommit).toBe(true);
    expect(spokenReply).toBeNull();
  });

  it("vamos seguir a mesma faixa aceita proposta sem escolher caminho", async () => {
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        name: "Novembro 2026",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: null as number | null,
      },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: null as "copy" | "recommended" | "fresh" | null,
      },
      proposedTarget: 244_600,
      userLockedTarget: false,
      pendingCommit: null,
    };
    const { draft, spokenReply } = await discussGoal("Vamos seguir a mesma faixa", ctx, prev);
    expect(draft.form.target).toBe(244_600);
    expect(draft.assembly?.path).toBeNull();
    expect(draft.copyStatus == null || draft.copyStatus !== "ok").toBe(true);
    expect(spokenReply).toMatch(/244\.600|244600|Apliquei|escolha abaixo|recomenda/i);
    expect(spokenReply).not.toMatch(/Vou seguir com (isso|a c[oó]pia)|copiar a escada/i);
    expect(spokenReply).not.toMatch(/· Copiar[\s\S]*· Criar do zero/);
  });

  it("pedir salvar cria pendingCommit sem shouldCommit", async () => {
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        name: "Novembro 2026",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 257_000,
        groups: [{ shiftId: "m", name: "T1", pct: 100 }],
      },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: "copy" as const,
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
        confirmedMount: true,
      },
      userLockedTarget: true,
      copyStatus: "ok" as const,
    };
    const { draft, shouldCommit, spokenReply } = await discussGoal(
      "pode salvar o rascunho",
      ctx,
      prev,
    );
    expect(draft.pendingCommit?.awaitingConfirm).toBe(true);
    expect(draft.pendingCommit?.authorized).toBe(false);
    expect(shouldCommit).toBe(false);
    expect(spokenReply).toMatch(/257|Confira|SIM/i);
  });

  it("SIM apos pending autoriza shouldCommit", async () => {
    const form = {
      ...emptyGoalForm("a"),
      name: "Novembro 2026",
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      target: 257_000,
      groups: [{ shiftId: "m", name: "T1", pct: 100 }],
    };
    const { createPendingCommit } = await import("./goalContract");
    const pending = createPendingCommit(
      {
        form,
        assembly: {
          ...emptyGoalAssembly(),
          periodConfirmed: true,
          valueDiscussed: true,
          path: "copy",
          confirmedGroups: true,
          confirmedSpread: true,
          confirmedTiers: true,
          confirmedMount: true,
        },
      },
      "Loja",
    );
    const prev = {
      form,
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: "copy" as const,
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
        confirmedMount: true,
      },
      pendingCommit: pending,
      userLockedTarget: true,
      copyStatus: "ok" as const,
    };
    const { draft, shouldCommit } = await discussGoal("Sim", ctx, prev);
    expect(draft.pendingCommit?.authorized).toBe(true);
    expect(shouldCommit).toBe(true);
  });

  it("deixar 45 e 55 nao cria pendingCommit de save", async () => {
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        name: "Novembro 2026",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 244_600,
        groups: [
          { shiftId: "m", name: "Turno 1", pct: 45 },
          { shiftId: "t", name: "Turno 2", pct: 55 },
        ],
      },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: "copy" as const,
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
      },
      userLockedTarget: true,
      copyStatus: "ok" as const,
      pendingCommit: null,
    };
    const { draft, shouldCommit } = await discussGoal(
      "Vamos deixar 45 e 55% mesmo",
      ctx,
      prev,
    );
    expect(draft.pendingCommit).toBeNull();
    expect(shouldCommit).toBeFalsy();
  });
});

describe("continuidade copia outubro → novembro", () => {
  function octoberCopiedDraft() {
    const form = emptyGoalForm("a");
    form.name = "Novembro 2026";
    form.startsOn = "2026-11-01";
    form.endsOn = "2026-11-30";
    form.target = 244_600;
    form.tierMode = "GROUP";
    form.managerOn = true;
    form.groups = [
      { shiftId: "m", name: "Turno 1", pct: 45 },
      { shiftId: "t", name: "Turno 2", pct: 55 },
    ];
    form.tiers = [
      { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50, managerPct: 0.5 },
      { name: "Super meta", minAttainmentPct: 75, commissionPct: 2, bonus: 50 },
      { name: "Hiper meta", minAttainmentPct: 100, commissionPct: 2.5, bonus: 50 },
      { name: "Meta desafio", minAttainmentPct: 110, commissionPct: 3, bonus: 50 },
    ];
    return {
      form,
      pendingConfigCopy: null,
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: "copy" as const,
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
        confirmedMount: false,
      },
      copyStatus: "ok" as const,
      copiedFrom: {
        goalId: "goal-oct",
        storeId: "a",
        from: "2026-10-01",
        to: "2026-10-31",
        name: "Outubro 2026",
        tiers: 4,
        groups: 2,
      },
      copyIntent: "exact" as const,
      userLockedTarget: true,
    };
  }

  it("detecta pergunta de inspecao", () => {
    expect(looksLikeInspectGoalDraft("Como ficou?")).toBe(true);
    expect(looksLikeInspectGoalDraft("Mostre os níveis")).toBe(true);
    expect(looksLikeInspectGoalDraft("Pode copiar")).toBe(false);
    expect(looksLikeBareCopyAccept("Sim")).toBe(true);
  });

  it("pergunta de pesos nao e inspecao nem re-copia", () => {
    const q = "Essa divisão de peso por grupo você acha que mantém?";
    expect(looksLikeAskGroupWeightAdvice(q)).toBe(true);
    expect(looksLikeInspectGoalDraft(q)).toBe(false);
    expect(looksLikeAcceptConfigCopy(q)).toBe(false);
  });

  it("speakGoalDraftConfig mostra 4 niveis e 2 grupos do rascunho", () => {
    const text = speakGoalDraftConfig(octoberCopiedDraft(), { facet: "copyJustApplied" });
    expect(text).toMatch(/outubro/i);
    expect(text).toMatch(/novembro/i);
    expect(text).toMatch(/244/);
    expect(text).toMatch(/50%/);
    expect(text).toMatch(/75%/);
    expect(text).toMatch(/110%/);
    expect(text).toMatch(/Turno 1 45%/);
    expect(text).not.toMatch(/85%/);
    expect(text).not.toMatch(/publicada em novembro/i);
  });

  it("pergunta de pesos nao reabre 'Copiei a configuração'", async () => {
    const prev = octoberCopiedDraft();
    const { draft, spokenReply } = await discussGoal(
      "Essa divisão de peso por grupo você acha que mantém?",
      ctx,
      prev,
    );
    expect(draft.copyStatus).toBe("ok");
    expect(draft.form.groups.map((g) => g.pct)).toEqual([45, 55]);
    expect(spokenReply).toBeTruthy();
    expect(spokenReply!).toMatch(/peso|turno|mant/i);
    expect(spokenReply!).not.toMatch(/^Copiei a configuração|^Pronto — trouxe/i);
    expect(spokenReply!).toMatch(/inalterada|mantive|não alterei|nao alterei|recomendo|participação|participacao/i);
    // Análise sem dados de venda no teste ainda assim não reexecuta cópia.
    expect(speakGoalWeightAdvice(draft, null)).not.toMatch(/Copiei a configuração/);
  });

  it('"Como ficou?" preserva copia e expoe niveis no estado interno', async () => {
    const prev = octoberCopiedDraft();
    const { draft, reply } = await discussGoal("Como ficou?", ctx, prev);
    expect(draft.copyStatus).toBe("ok");
    expect(draft.form.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);
    expect(draft.form.groups.map((g) => g.pct)).toEqual([45, 55]);
    expect(draft.copiedFrom?.from).toBe("2026-10-01");
    expect(draft.form.startsOn).toBe("2026-11-01");
    expect(draft.form.target).toBe(244_600);
    expect(reply).toMatch(/niveis_detalhe|config_no_rascunho|50/);
    expect(reply).not.toMatch(/config_copia_falhou/);
    const spoken = speakGoalDraftConfig(draft);
    expect(spoken).toMatch(/50%/);
  });

  it('"Sim" apos copia ok nao zera a escada', async () => {
    const prev = octoberCopiedDraft();
    const { draft } = await discussGoal("Sim", ctx, prev);
    expect(draft.copyStatus).toBe("ok");
    expect(draft.form.tiers).toHaveLength(4);
    expect(draft.form.tiers[0]?.minAttainmentPct).toBe(50);
    expect(draft.copiedFrom?.goalId).toBe("goal-oct");
  });

  it("formatGoalFacts inclui origem e niveis — nao so resumo curto", () => {
    const facts = formatGoalFactsForModel(octoberCopiedDraft(), "Campo Grande");
    expect(facts).toMatch(/copiedFrom/);
    expect(facts).toMatch(/niveis_detalhe/);
    expect(facts).toMatch(/"atingimento":50/);
    expect(facts).toMatch(/2026-10-01/);
  });

  it("persistencia guarda copiedFrom e niveis", () => {
    clearGoalDraftSession();
    persistGoalDraftSession(octoberCopiedDraft());
    const loaded = loadGoalDraftSession();
    expect(loaded?.copyStatus).toBe("ok");
    expect(loaded?.copiedFrom?.from).toBe("2026-10-01");
    expect(loaded?.form.tiers).toHaveLength(4);
    clearGoalDraftSession();
  });

  it("turno seguinte ainda responde niveis sem buscar destino", async () => {
    const afterCopy = octoberCopiedDraft();
    const t2 = await discussGoal("Como ficou?", ctx, afterCopy, { turnId: "t2" });
    const t3 = await discussGoal("Mostre os níveis", ctx, t2.draft, { turnId: "t3" });
    expect(t3.draft.copyStatus).toBe("ok");
    expect(t3.draft.form.tiers).toHaveLength(4);
    expect(speakGoalDraftConfig(t3.draft, { facet: "levels" })).toMatch(/Meta desafio/);
    expect(speakGoalDraftConfig(t3.draft, { facet: "levels" })).toMatch(/110%/);
  });
});

describe("caminhos de montagem copy | recommended | fresh", () => {
  const valueReady = {
    form: {
      ...emptyGoalForm("a"),
      name: "Novembro 2026",
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      target: 244_600,
    },
    pendingConfigCopy: { from: "2026-10-01", to: "2026-10-31" } as {
      from: string;
      to: string;
    } | null,
    assembly: {
      ...emptyGoalAssembly(),
      periodConfirmed: true,
      valueDiscussed: true,
      path: null as "copy" | "recommended" | "fresh" | null,
    },
    userLockedTarget: true,
    proposedTarget: 244_600,
  };

  const sampleHistory = [
    {
      startsOn: "2026-10-01",
      tierMode: "GROUP" as const,
      tiers: [
        { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50, managerPct: 0.5 },
        { name: "Super", minAttainmentPct: 75, commissionPct: 2, bonus: 50 },
        { name: "Hiper", minAttainmentPct: 100, commissionPct: 2.5, bonus: 50 },
        { name: "Desafio", minAttainmentPct: 110, commissionPct: 3, bonus: 50 },
      ],
      groups: [
        { shiftId: "m", name: "Turno 1", pct: 45 },
        { shiftId: "t", name: "Turno 2", pct: 55 },
      ],
      spreadUnidentified: true,
      name: "Outubro 2026",
    },
    {
      startsOn: "2026-09-01",
      tierMode: "GROUP" as const,
      tiers: [
        { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50, managerPct: 0.5 },
        { name: "Super", minAttainmentPct: 75, commissionPct: 2, bonus: 50 },
        { name: "Hiper", minAttainmentPct: 100, commissionPct: 2.5, bonus: 50 },
        { name: "Desafio", minAttainmentPct: 110, commissionPct: 3, bonus: 50 },
      ],
      groups: [
        { shiftId: "m", name: "Turno 1", pct: 45 },
        { shiftId: "t", name: "Turno 2", pct: 55 },
      ],
      spreadUnidentified: true,
      name: "Setembro 2026",
    },
  ];

  it("1. aceitar valor recomendado nao seleciona caminho", async () => {
    expect(looksLikeExplicitConfigCopy("Vamos seguir a mesma faixa")).toBe(false);
    expect(parseGoalAssemblyPath("Vamos seguir a mesma faixa")).toBeNull();
    const prev = {
      ...valueReady,
      form: { ...valueReady.form, target: null as number | null },
      userLockedTarget: false,
    };
    const { draft, spokenReply } = await discussGoal("Vamos seguir a mesma faixa", ctx, prev);
    expect(draft.form.target).toBe(244_600);
    expect(draft.userLockedTarget).toBe(true);
    expect(draft.assembly?.path).toBeNull();
    expect(spokenReply).toMatch(/Apliquei|244|escolha abaixo|recomenda/i);
    // Não duplica a lista integral das 3 opções no texto.
    expect(spokenReply).not.toMatch(/· Copiar[\s\S]*· Criar com[\s\S]*· Criar do zero/);
  });

  it("2. selecionar copiar usa configuracao anterior", async () => {
    expect(parseGoalAssemblyPath("Copiar outubro")).toBe("copy");
    const { draft } = await discussGoal("Copiar outubro", ctx, valueReady);
    expect(draft.assembly?.path).toBe("copy");
    // Sem meta no banco de teste → failed, mas o caminho ficou copy (não recommended/fresh).
    expect(draft.copyStatus).toBe("failed");
    expect(draft.form.target).toBe(244_600);
  });

  it("3. selecionar recomendado gera proposta nova baseada em dados", async () => {
    expect(parseGoalAssemblyPath("Criar com recomendações")).toBe("recommended");
    const { draft, spokenReply } = await discussGoal("Criar com recomendações", ctx, valueReady, {
      recentConfigs: sampleHistory,
    });
    expect(draft.assembly?.path).toBe("recommended");
    expect(draft.form.target).toBe(244_600);
    expect(draft.form.tiers).toHaveLength(4);
    expect(draft.form.groups).toHaveLength(2);
    expect(draft.assembly?.confirmedTiers).toBe(false);
    expect(draft.copyStatus == null || draft.copyStatus !== "ok").toBe(true);
    expect(spokenReply).toMatch(/recomendad|padr[aã]o|n[aã]o [eé] c[oó]pia/i);
  });

  it("4. selecionar do zero nao copia automaticamente dados anteriores", async () => {
    expect(parseGoalAssemblyPath("Criar do zero")).toBe("fresh");
    const { draft, spokenReply } = await discussGoal("Criar do zero", ctx, valueReady);
    expect(draft.assembly?.path).toBe("fresh");
    expect(draft.form.target).toBe(244_600);
    expect(draft.form.startsOn).toBe("2026-11-01");
    expect(draft.copyStatus).toBeNull();
    expect(draft.copiedFrom).toBeNull();
    expect(draft.form.groups).toHaveLength(0);
    expect(spokenReply).toMatch(/do zero|Estrutura/i);
  });

  it("5. gestor informa configuracao completa em uma unica mensagem", async () => {
    const prev = {
      ...valueReady,
      pendingConfigCopy: null,
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: "fresh" as const,
      },
    };
    const { draft } = await discussGoal(
      "Quero divisão por grupos, com rateio de venda sem vendedor e serve a escada",
      ctx,
      prev,
    );
    expect(draft.assembly?.path).toBe("fresh");
    expect(draft.assembly?.confirmedGroups).toBe(true);
    expect(draft.assembly?.confirmedSpread).toBe(true);
    expect(draft.assembly?.confirmedTiers).toBe(true);
    expect(draft.form.target).toBe(244_600);
  });

  it("6. gestor muda de caminho antes de salvar", async () => {
    const afterRec = await discussGoal("Criar com recomendações", ctx, valueReady, {
      recentConfigs: sampleHistory,
    });
    expect(afterRec.draft.assembly?.path).toBe("recommended");
    expect(afterRec.draft.form.groups.length).toBeGreaterThan(0);
    const switched = await discussGoal("Na verdade criar do zero", ctx, afterRec.draft);
    expect(switched.draft.assembly?.path).toBe("fresh");
    expect(switched.draft.form.target).toBe(244_600);
    expect(switched.draft.form.startsOn).toBe("2026-11-01");
    expect(switched.draft.form.groups).toHaveLength(0);
    expect(switched.draft.copyStatus).toBeNull();
  });

  it("7. gestor solicita recomendacao durante o modo do zero", async () => {
    const fresh = await discussGoal("Criar do zero", ctx, valueReady);
    expect(fresh.draft.assembly?.path).toBe("fresh");
    const { draft, spokenReply } = await discussGoal("Quero suas recomendações", ctx, fresh.draft, {
      recentConfigs: sampleHistory,
    });
    expect(draft.assembly?.path).toBe("recommended");
    expect(draft.form.target).toBe(244_600);
    expect(spokenReply).toMatch(/recomendad|padr[aã]o/i);
  });

  it("8. historico insuficiente no modo recomendado", async () => {
    const { draft, spokenReply } = await discussGoal("Criar com recomendações", ctx, valueReady, {
      recentConfigs: [],
    });
    expect(draft.assembly?.path).toBeNull();
    expect(draft.form.target).toBe(244_600);
    expect(spokenReply).toMatch(/hist[oó]rico insuficiente|do zero|copiar/i);
  });

  it("9. nenhuma alteracao automatica sem autorizacao", async () => {
    const { draft, shouldCommit } = await discussGoal("Criar com recomendações", ctx, valueReady, {
      recentConfigs: sampleHistory,
    });
    expect(draft.assembly?.confirmedMount).toBe(false);
    expect(draft.assembly?.confirmedTiers).toBe(false);
    expect(draft.pendingCommit).toBeFalsy();
    expect(shouldCommit).toBeFalsy();
  });

  it("10. valores aceitos permanecem consistentes em todos os caminhos", async () => {
    const offer = speakGoalAssemblyPathOffer({
      target: 244_600,
      destLabel: "novembro de 2026",
      hasPrior: true,
      priorLabel: "outubro de 2026",
    });
    expect(offer).toMatch(/Apliquei|244/);
    expect(offer).toMatch(/escolha abaixo|recomenda/i);
    expect(offer).not.toMatch(/· Copiar[\s\S]*· Criar do zero/);
    expect(looksLikeChooseCopyPath("Copiar outubro")).toBe(true);
    expect(looksLikeChooseRecommendedPath("Criar com recomendações")).toBe(true);
    expect(looksLikeChooseFreshPath("Criar do zero")).toBe(true);

    for (const msg of ["Copiar outubro", "Criar com recomendações", "Criar do zero"] as const) {
      const { draft } = await discussGoal(msg, ctx, valueReady, {
        recentConfigs: sampleHistory,
      });
      expect(draft.form.target).toBe(244_600);
      expect(draft.form.startsOn).toBe("2026-11-01");
      expect(draft.form.storeId).toBe("a");
    }
  });
});

describe("postura de valor — consultiva vs aceite (P0+)", () => {
  const pendingProposal = {
    form: {
      ...emptyGoalForm("a"),
      name: "Meta Novembro 2026",
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      target: null as number | null,
    },
    assembly: {
      ...emptyGoalAssembly(),
      periodConfirmed: true,
      valueDiscussed: true,
      path: null as "copy" | "recommended" | "fresh" | null,
    },
    proposedTarget: 244_600 as number | null,
    userLockedTarget: false,
    pendingCommit: null,
    proposal: {
      amount: 244_600,
      scenarios: [
        { kind: "conservative" as const, amount: 225_000, label: "Conservadora" },
        { kind: "recommended" as const, amount: 244_600, label: "Recomendada" },
        { kind: "challenging" as const, amount: 269_000, label: "Desafiadora" },
      ],
      evidence: [{ kind: "observed" as const, label: "YoY novembro" }],
      caveats: [],
      confidence: "medium" as const,
      rationale: "mesmo mês ano passado + ritmo recente; sazonal Black Friday",
      seasonalSummary: "Black Friday embutida",
      chatBlocks: ["Para novembro de 2026, eu trabalharia com R$ 244.600."],
    },
  };

  it("1. pergunta se deve aumentar a meta nao aceita nem avanca", async () => {
    const q =
      "Queria colocar uma sobra a mais... Se precisar eu diminuo no meio do mês, o que você acha?";
    const { draft, spokenReply } = await discussGoal(q, ctx, pendingProposal);
    expect(draft.form.target).toBeNull();
    expect(draft.proposedTarget).toBe(244_600);
    expect(draft.userLockedTarget).toBe(false);
    expect(draft.assembly?.path).toBeNull();
    expect(spokenReply).toMatch(/sobra|folga|não apliquei|nao apliquei|meio do m/i);
    expect(spokenReply).not.toMatch(/escolha abaixo|vamos trabalhar com/i);
    expect(spokenReply).not.toMatch(/^Apliquei /m);
  });

  it("2. considera diminuir no meio do mes permanece na etapa de valor", async () => {
    const { draft, spokenReply } = await discussGoal(
      "E se eu diminuir no meio do mês se precisar?",
      ctx,
      pendingProposal,
    );
    expect(draft.form.target).toBeNull();
    expect(draft.assembly?.path).toBeNull();
    expect(spokenReply).toMatch(/meio do m|ajust/i);
    expect(spokenReply).not.toMatch(/escolha abaixo/i);
    expect(spokenReply).not.toMatch(/^Apliquei /m);
  });

  it("3. aceite explicito aplica proposedTarget e oferece caminho", async () => {
    const { draft, spokenReply } = await discussGoal("Aceito a recomendada", ctx, pendingProposal);
    expect(draft.form.target).toBe(244_600);
    expect(draft.userLockedTarget).toBe(true);
    expect(draft.assembly?.path).toBeNull();
    expect(spokenReply).toMatch(/Apliquei|escolha abaixo/i);
  });

  it("3b. aceite contextual sem repetir R$ aplica a proposta pendente", async () => {
    const prev = {
      ...pendingProposal,
      proposedTarget: 260_000,
      proposal: {
        ...pendingProposal.proposal,
        amount: 260_000,
        scenarios: [
          { kind: "conservative" as const, amount: 240_000, label: "Conservadora" },
          { kind: "recommended" as const, amount: 260_000, label: "Recomendada" },
          { kind: "challenging" as const, amount: 286_000, label: "Desafiadora" },
        ],
      },
    };
    const { draft, spokenReply } = await discussGoal(
      "Gostei dessa última proposta. Vamos com ela.",
      ctx,
      prev,
    );
    expect(draft.form.target).toBe(260_000);
    expect(draft.userLockedTarget).toBe(true);
    expect(draft.assembly?.path).toBeNull();
    expect(spokenReply).toMatch(/Apliquei|260|escolha abaixo/i);
  });

  it("4. contraproposta com R$ aplica o novo valor sem path automatico de copia", async () => {
    const { draft, spokenReply } = await discussGoal("Quero R$ 260 mil", ctx, pendingProposal);
    expect(draft.form.target).toBe(260_000);
    expect(draft.userLockedTarget).toBe(true);
    expect(draft.assembly?.path).toBeNull();
    expect(spokenReply).toMatch(/260|Apliquei|escolha abaixo/i);
  });

  it("5. pede mais informacoes antes de decidir — nao muta", async () => {
    const { draft, spokenReply } = await discussGoal(
      "Me explica como você chegou nesse valor?",
      ctx,
      pendingProposal,
    );
    expect(draft.form.target).toBeNull();
    expect(draft.proposedTarget).toBe(244_600);
    expect(spokenReply).toMatch(/proposta|ainda não|ainda nao|cheguei|evid/i);
    expect(spokenReply).not.toMatch(/escolha abaixo/i);
    expect(spokenReply).not.toMatch(/^Apliquei /m);
  });

  it("6. aceita cenario alternativo (desafiadora)", async () => {
    const { draft } = await discussGoal("Vamos de desafiadora", ctx, pendingProposal);
    expect(draft.form.target).toBe(269_000);
    expect(draft.userLockedTarget).toBe(true);
    expect(draft.assembly?.path).toBeNull();
  });

  it("7. componente/path so apos valor aceito", async () => {
    const consult = await discussGoal("O que você acha de aumentar um pouco?", ctx, pendingProposal);
    expect(consult.draft.form.target).toBeNull();
    expect(consult.draft.userLockedTarget).toBe(false);
    expect(consult.spokenReply).not.toMatch(/escolha abaixo/i);

    const accept = await discussGoal("Pode ser", ctx, pendingProposal);
    expect(accept.draft.form.target).toBe(244_600);
    expect(accept.draft.userLockedTarget).toBe(true);
    expect(accept.spokenReply).toMatch(/escolha abaixo/i);
  });

  it("8. oferta de caminho nao duplica as tres opcoes no texto", async () => {
    const { spokenReply } = await discussGoal("Fechado", ctx, pendingProposal);
    expect(spokenReply).toMatch(/escolha abaixo/i);
    expect(spokenReply).not.toMatch(/· Copiar/);
    expect(spokenReply).not.toMatch(/· Criar com recomendações/);
    expect(spokenReply).not.toMatch(/· Criar do zero/);
  });

  it("9. pergunta consultiva nao modifica o rascunho", async () => {
    const prev = {
      ...pendingProposal,
      form: { ...pendingProposal.form, target: 244_600 },
      userLockedTarget: true,
      pathOfferPresented: true,
      assembly: {
        ...pendingProposal.assembly,
        path: null as "copy" | "recommended" | "fresh" | null,
      },
      pendingConfigCopy: { from: "2026-10-01", to: "2026-10-31" },
    };
    const { draft, spokenReply } = await discussGoal(
      "Vale a pena subir mais a meta?",
      ctx,
      prev,
    );
    expect(draft.form.target).toBe(244_600);
    expect(draft.assembly?.path).toBeNull();
    expect(draft.form.tiers).toEqual(prev.form.tiers);
    expect(spokenReply).toMatch(/não apliquei|nao apliquei|folga|sobra|risco/i);
    expect(spokenReply).not.toMatch(/escolha abaixo/i);
    expect(spokenReply).not.toMatch(/^Apliquei /m);
  });

  it("10. mudanca de caminho invalida confirmacoes anteriores", async () => {
    const ready = {
      form: {
        ...emptyGoalForm("a"),
        name: "Meta Novembro 2026",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 244_600,
        groups: [
          { shiftId: "m", name: "Turno 1", pct: 45 },
          { shiftId: "t", name: "Turno 2", pct: 55 },
        ],
        tiers: [
          { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50 },
          { name: "Desafio", minAttainmentPct: 110, commissionPct: 3, bonus: 50 },
        ],
      },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: "recommended" as const,
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
        confirmedMount: true,
      },
      userLockedTarget: true,
      proposedTarget: 244_600,
      pendingCommit: null as null,
    };
    const { createPendingCommit } = await import("./goalContract");
    const withPending = {
      ...ready,
      pendingCommit: createPendingCommit(ready, "Loja"),
    };
    expect(withPending.pendingCommit?.awaitingConfirm).toBe(true);

    const switched = await discussGoal("Na verdade criar do zero", ctx, withPending);
    expect(switched.draft.assembly?.path).toBe("fresh");
    expect(switched.draft.assembly?.confirmedMount).toBe(false);
    expect(switched.draft.assembly?.confirmedGroups).toBe(false);
    // Fingerprint mudou (grupos zerados) → pending inválido/limpo.
    expect(
      switched.draft.pendingCommit == null ||
        switched.draft.pendingCommit.authorized !== true,
    ).toBe(true);
  });

  it("LLM inventando amountCents sem R$ na fala nao trava form.target", async () => {
    const { emptyGoalOpIntent } = await import("./goalOpIntent");
    const poisoned = emptyGoalOpIntent({
      kind: "confirmation",
      entity: "store_target",
      amountCents: 244_600,
      amountRole: "store_base",
      authorizeApply: true,
      confidence: "high",
      notes: "hallucinated_from_context",
    });
    const q =
      "Queria colocar uma sobra a mais... Se precisar eu diminuo no meio do mês, o que você acha?";
    const { draft, spokenReply } = await discussGoal(q, ctx, pendingProposal, {
      intent: poisoned,
    });
    expect(draft.form.target).toBeNull();
    expect(draft.userLockedTarget).toBe(false);
    expect(spokenReply).not.toMatch(/escolha abaixo/i);
    expect(spokenReply).not.toMatch(/^Apliquei /m);
  });
});

describe("Topbar Todas as lojas — pergunta a filial", () => {
  const storeA = {
    id: "a",
    name: "CAMPO GRANDE",
    tradeName: "Shopping Campo Grande",
    code: "00010",
  };
  const storeB = {
    id: "b",
    name: "CENTRO",
    tradeName: "Loja Centro",
    code: "00386",
  };
  const networkCtx = {
    tenantId: "t",
    membershipId: "m1",
    storeIds: [] as string[],
    stores: [storeA, storeB],
    network: [storeA, storeB],
    today: "2026-10-29",
    managerFirstName: "Romeu",
  };

  it("meta de novembro com rede: nao inventa filial e pergunta", async () => {
    const { draft, spokenReply } = await discussGoal("Criar meta de novembro", networkCtx, null);
    expect(draft.form.storeId).toBe("");
    expect(draft.form.startsOn).toBe("2026-11-01");
    expect(spokenReply).toMatch(/todas as lojas/i);
    expect(spokenReply).toMatch(/filial/i);
  });

  it("cita a loja no texto: usa sem perguntar", async () => {
    const { draft, spokenReply } = await discussGoal(
      "Criar meta de novembro da Loja Centro",
      networkCtx,
      null,
    );
    expect(draft.form.storeId).toBe("b");
    expect(spokenReply ?? "").not.toMatch(/todas as lojas/i);
  });
});
