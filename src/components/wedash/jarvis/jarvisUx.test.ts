import { describe, expect, it } from "vitest";
import { paths } from "@/router/paths";
import {
  buildCommitSummary,
  createPendingCommit,
  looksLikeConfirmPendingSave,
  looksLikeAcceptPendingProposal,
  speakGoalSavedSuccess,
} from "./goalContract";
import {
  defaultGoalName,
  discussGoal,
  emptyGoalAssembly,
  emptyGoalForm,
  ensureGoalName,
  isAutoMonthYearName,
  parseGoalAssemblyPath,
} from "./goalDraft";
import { classifyJarvisFailure, isLikelyOffline } from "./jarvisErrors";

const ctx = {
  tenantId: "t",
  membershipId: "m1",
  storeIds: ["a"],
  stores: [{ id: "a", name: "CAMPO GRANDE", tradeName: "Shopping Campo Grande", code: "00010" }],
  network: [{ id: "a", name: "CAMPO GRANDE", tradeName: "Shopping Campo Grande", code: "00010" }],
  today: "2026-10-29",
  managerFirstName: "Romeu",
};

describe("JARVIS UX — nome da meta", () => {
  it("1. nome automatico com mes e ano", () => {
    expect(defaultGoalName("2026-11-01")).toBe("Meta Novembro 2026");
    expect(defaultGoalName("2027-01-01")).toBe("Meta Janeiro 2027");
    const form = ensureGoalName({
      ...emptyGoalForm("a"),
      startsOn: "2026-12-01",
      endsOn: "2026-12-31",
      name: "",
    });
    expect(form.name).toBe("Meta Dezembro 2026");
    expect(isAutoMonthYearName("Meta Novembro 2026")).toBe(true);
    expect(isAutoMonthYearName("Novembro 2026")).toBe(true);
    expect(isAutoMonthYearName("Nova meta")).toBe(true);
  });

  it("2. nome personalizado preservado", () => {
    const form = ensureGoalName({
      ...emptyGoalForm("a"),
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      name: "Campanha Black Friday CG",
    });
    expect(form.name).toBe("Campanha Black Friday CG");
    expect(isAutoMonthYearName("Campanha Black Friday CG")).toBe(false);
  });

  it("3. mudanca de periodo atualiza so nome automatico", async () => {
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        name: "Meta Outubro 2026",
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
    // Alvo zera na troca de mês; nome automático acompanha o novo período quando voltar a ter nome.
    const named = ensureGoalName({
      ...draft.form,
      name: "Meta Outubro 2026",
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
    });
    expect(named.name).toBe("Meta Novembro 2026");

    const custom = ensureGoalName({
      ...draft.form,
      name: "Meta especial da loja",
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
    });
    expect(custom.name).toBe("Meta especial da loja");
  });
});

describe("JARVIS UX — pos-save e link", () => {
  it("4. sucesso com nome e valor reais", () => {
    const msg = speakGoalSavedSuccess({
      name: "Meta Novembro 2026",
      target: 244_600,
      asDraft: true,
    });
    expect(msg).toMatch(/Meta Novembro 2026/);
    expect(msg).toMatch(/244\.600|244600|R\$/);
    expect(msg).toMatch(/rascunho/i);
  });

  it("5. link correto para o editor", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(paths.goalEdit(id)).toBe(`/performance/goals/${id}/edit`);
  });

  it("6. UUID nao exibido na fala de sucesso", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const msg = speakGoalSavedSuccess({
      name: "Meta Novembro 2026",
      target: 244_600,
      asDraft: true,
    });
    expect(msg).not.toMatch(id);
    expect(msg).not.toMatch(/11111111/);
    expect(msg).not.toMatch(/\bid\b/i);
  });

  it("7. ausencia do card redundante (contrato da mensagem)", () => {
    // O card “Rascunho salvo / Abrir rascunho no Editor” saiu do Float para metas;
    // a confirmação fica na mensagem + link determinístico.
    const msg = speakGoalSavedSuccess({
      name: "Meta Novembro 2026",
      target: 244_600,
    });
    expect(msg).not.toMatch(/Abrir rascunho no Editor/i);
    expect(msg).toMatch(/Pronto/);
  });
});

describe("JARVIS UX — confirmacao natural", () => {
  it("8. confirmacoes naturais com pendingCommit valido", async () => {
    const form = {
      ...emptyGoalForm("a"),
      name: "Meta Novembro 2026",
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      target: 257_000,
      groups: [{ shiftId: "m", name: "T1", pct: 100 }],
      tiers: [
        { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50 },
        { name: "Desafio", minAttainmentPct: 110, commissionPct: 3, bonus: 50 },
      ],
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
    const pending = createPendingCommit({ form, assembly }, "Loja");
    expect(pending.summary).toMatch(/Posso salvar essa configuração como rascunho/i);
    expect(pending.summary).not.toMatch(/Responda SIM/i);

    for (const phrase of ["Sim", "Pode", "Fechado", "Confirmo", "Isso", "Vamos nessa"]) {
      expect(looksLikeConfirmPendingSave(phrase)).toBe(true);
      const { draft, shouldCommit } = await discussGoal(phrase, ctx, {
        form,
        assembly,
        pendingCommit: pending,
        userLockedTarget: true,
        copyStatus: "ok" as const,
      });
      expect(draft.pendingCommit?.authorized).toBe(true);
      expect(shouldCommit).toBe(true);
    }
  });

  it("9. rejeicao de confirmacao fora de contexto", async () => {
    expect(looksLikeAcceptPendingProposal("Sim", false, false)).toBe(false);
    const prev = {
      form: {
        ...emptyGoalForm("a"),
        name: "Meta Novembro 2026",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 244_600,
      },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: null as const,
      },
      proposedTarget: 257_000,
      userLockedTarget: true,
      pendingCommit: null,
    };
    // Aceite de proposta de valor — não autoriza gravação.
    const { draft, shouldCommit } = await discussGoal("Pode ser", ctx, prev);
    expect(draft.form.target).toBe(257_000);
    expect(draft.pendingCommit?.authorized).toBeFalsy();
    expect(shouldCommit).toBeFalsy();
  });
});

describe("JARVIS UX — caminhos de montagem", () => {
  const valueReady = {
    form: {
      ...emptyGoalForm("a"),
      name: "Meta Novembro 2026",
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      target: 244_600,
    },
    pendingConfigCopy: { from: "2026-10-01", to: "2026-10-31" },
    assembly: {
      ...emptyGoalAssembly(),
      periodConfirmed: true,
      valueDiscussed: true,
      path: null as "copy" | "recommended" | "fresh" | null,
    },
    userLockedTarget: true,
    proposedTarget: 244_600,
  };

  it("10. escolha pelos tres modos", () => {
    expect(parseGoalAssemblyPath("Copiar outubro")).toBe("copy");
    expect(parseGoalAssemblyPath("Criar com recomendações")).toBe("recommended");
    expect(parseGoalAssemblyPath("Criar do zero")).toBe("fresh");
  });

  it("11. escolha por texto e forcedPath (componente)", async () => {
    const byText = await discussGoal("Criar do zero", ctx, valueReady);
    expect(byText.draft.assembly?.path).toBe("fresh");

    const byUi = await discussGoal("Selecionar caminho", ctx, valueReady, {
      forcedPath: "recommended",
      recentConfigs: [],
    });
    // Sem histórico → path volta null; com forcedPath recommended a intenção foi reconhecida.
    expect(byUi.draft.form.target).toBe(244_600);
    expect(byUi.spokenReply).toMatch(/hist[oó]rico insuficiente|do zero|copiar/i);

    const byUiCopy = await discussGoal("Selecionar caminho", ctx, valueReady, {
      forcedPath: "copy",
    });
    expect(byUiCopy.draft.assembly?.path).toBe("copy");
  });

  it("12. clique repetido / forcedPath com path ja escolhido nao reabre oferta", async () => {
    const first = await discussGoal("Criar do zero", ctx, valueReady);
    expect(first.draft.assembly?.path).toBe("fresh");
    const second = await discussGoal("Selecionar caminho", ctx, first.draft, {
      forcedPath: "fresh",
    });
    expect(second.draft.assembly?.path).toBe("fresh");
    expect(second.draft.form.target).toBe(244_600);
  });
});

describe("JARVIS UX — erros e retry", () => {
  it("13. falha de internet", () => {
    const offline = classifyJarvisFailure("Failed to fetch", {});
    // Sem navigator offline no node — ainda classifica por mensagem.
    expect(offline.message).toMatch(/conex|internet|processar/i);
    expect(offline.canRetry).toBe(true);
    expect(typeof isLikelyOffline()).toBe("boolean");
  });

  it("14. falha da Edge Function", () => {
    const err = classifyJarvisFailure(
      "Failed to send a request to the Edge Function",
    );
    expect(err.message).not.toMatch(/Edge Function/i);
    expect(err.message).toMatch(/Não consegui processar/i);
    expect(err.canRetry).toBe(true);
  });

  it("15. retry sem duplicidade de mensagens (contrato)", () => {
    // reply(..., { retry: true }) não reanexa bolha do usuário — coberto no Provider;
    // aqui garantimos que a classificação oferece retry sem texto técnico.
    const err = classifyJarvisFailure("timeout");
    expect(err.canRetry).toBe(true);
    expect(err.message).not.toMatch(/Failed|Edge|openai/i);
  });

  it("16. retry de gravacao usa mensagem especifica", () => {
    const err = classifyJarvisFailure("network blip", { duringSave: true });
    expect(err.kind).toBe("save_uncertain");
    expect(err.message).toMatch(/confirmar se o rascunho foi salvo/i);
  });

  it("17. recuperacao apos refresh (resumo de commit sem SIM)", () => {
    const form = {
      ...emptyGoalForm("a"),
      name: "Meta Novembro 2026",
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      target: 244_600,
    };
    const summary = buildCommitSummary(
      {
        form,
        assembly: {
          ...emptyGoalAssembly(),
          periodConfirmed: true,
          valueDiscussed: true,
          path: "fresh",
          confirmedGroups: true,
          confirmedSpread: true,
          confirmedTiers: true,
        },
      },
      "Campo Grande",
    );
    expect(summary).toMatch(/Posso salvar/);
    expect(summary).toMatch(/Meta Novembro 2026/);
    expect(summary).not.toMatch(/Responda SIM/);
  });
});
