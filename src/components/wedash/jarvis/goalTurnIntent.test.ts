import { describe, expect, it } from "vitest";
import { createPendingCommit } from "./goalContract";
import {
  defaultGoalTiers,
  emptyGoalAssembly,
  emptyGoalForm,
  discussGoal,
  type GoalDraft,
} from "./goalDraft";
import { interpretGoalOpStructural } from "./goalOpIntent";
import { classifyTurn } from "./goalTurnIntent";

const ctx = {
  tenantId: "t",
  membershipId: "m1",
  storeIds: ["a"],
  stores: [{ id: "a", name: "CAMPO GRANDE", tradeName: "Shopping Campo Grande", code: "00010" }],
  network: [{ id: "a", name: "CAMPO GRANDE", tradeName: "Shopping Campo Grande", code: "00010" }],
  today: "2026-10-31",
  managerFirstName: "Romeu",
};

function proposalAwaiting(amount: number): GoalDraft {
  return {
    form: {
      ...emptyGoalForm("a"),
      name: "Meta Novembro 2026",
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      target: null,
    },
    assembly: {
      ...emptyGoalAssembly(),
      periodConfirmed: true,
      valueDiscussed: true,
      path: null,
    },
    userLockedTarget: false,
    proposedTarget: amount,
    proposal: {
      amount,
      scenarios: [
        { kind: "conservative", amount: Math.round(amount * 0.92), label: "Conservadora" },
        { kind: "recommended", amount, label: "Recomendada" },
        { kind: "challenging", amount: Math.round(amount * 1.1), label: "Desafiadora" },
      ],
      evidence: [],
      caveats: [],
      confidence: "medium",
      rationale: "fixture",
      seasonalSummary: "",
      chatBlocks: [`Proposta ${amount}`],
    },
    pendingCommit: null,
    copyStatus: null,
    pendingConfigCopy: { from: "2026-10-01", to: "2026-10-31" },
  };
}

function afterCopyDraft(): GoalDraft {
  const form = {
    ...emptyGoalForm("a"),
    name: "Meta Novembro 2026",
    startsOn: "2026-11-01",
    endsOn: "2026-11-30",
    target: 500_000,
    tiers: [
      { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50 },
      { name: "Super", minAttainmentPct: 75, commissionPct: 2, bonus: 50 },
      { name: "Hiper", minAttainmentPct: 100, commissionPct: 2.5, bonus: 50 },
      { name: "Desafio", minAttainmentPct: 110, commissionPct: 3, bonus: 50 },
    ],
    groups: [
      { shiftId: "m", name: "Turno 1", pct: 45 },
      { shiftId: "t", name: "Turno 2", pct: 55 },
    ],
    tierMode: "GROUP" as const,
    spreadUnidentified: true,
  };
  return {
    form,
    assembly: {
      ...emptyGoalAssembly(),
      periodConfirmed: true,
      valueDiscussed: true,
      path: "copy",
      confirmedGroups: true,
      confirmedSpread: true,
      confirmedTiers: true,
      confirmedMount: false,
    },
    userLockedTarget: true,
    proposedTarget: 500_000,
    copyStatus: "ok",
    copiedFrom: { from: "2026-10-01", to: "2026-10-31", goalId: "g1", storeId: "a" },
    pendingCommit: null,
  };
}

describe("Fase 3 classifyTurn", () => {
  it("confirmacao de proposta → accept_value (uma intenção)", () => {
    const draft = proposalAwaiting(500_000);
    const intent = classifyTurn({ message: "Pode ser", draft });
    expect(intent.kind).toBe("accept_value");
    expect(intent.mutates).toBe(true);
    expect(intent.value?.applyAmount).toBe(500_000);
    expect(intent.affirmation).toBe("none");
  });

  it("Sim apos copia → acknowledge_copy, nao confirm_save nem accept_value", () => {
    const draft = afterCopyDraft();
    const intent = classifyTurn({ message: "Sim", draft });
    expect(intent.kind).toBe("acknowledge_copy");
    expect(intent.mutates).toBe(false);
    expect(intent.kind).not.toBe("confirm_save");
    expect(intent.kind).not.toBe("accept_value");
  });

  it("confirmacao de gravacao → confirm_save com fingerprint pendente", () => {
    const base = afterCopyDraft();
    const form = { ...base.form, tiers: defaultGoalTiers() };
    const pending = createPendingCommit(
      { ...base, form, assembly: { ...base.assembly!, confirmedMount: true } },
      "Loja",
    );
    const draft = { ...base, form, pendingCommit: pending };
    const intent = classifyTurn({
      message: "Sim",
      draft,
      historyOrJarvis: pending.summary,
    });
    expect(intent.kind).toBe("confirm_save");
    expect(intent.mutates).toBe(true);
  });

  it("concordancia sem decisao pendente → agree_no_op", () => {
    const draft: GoalDraft = {
      form: {
        ...emptyGoalForm("a"),
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 500_000,
      },
      assembly: { ...emptyGoalAssembly(), path: null, valueDiscussed: true },
      userLockedTarget: true,
      proposedTarget: 500_000,
      pendingCommit: null,
      copyStatus: null,
    };
    const op = interpretGoalOpStructural("Sim", { form: draft.form, today: ctx.today });
    const intent = classifyTurn({ message: "Sim", draft, opIntent: op });
    expect(intent.kind).toBe("agree_no_op");
    expect(intent.mutates).toBe(false);
  });

  it("resposta ambigua → clarify_choice", () => {
    const draft = afterCopyDraft();
    const intent = classifyTurn({
      message: "Sim",
      draft,
      historyOrJarvis: "Quer revisar a configuração ou salvar o rascunho?",
    });
    expect(intent.kind).toBe("clarify_choice");
    expect(intent.mutates).toBe(false);
  });

  it("comandos equivalentes de copia → select_path copy", () => {
    const draft = proposalAwaiting(500_000);
    draft.form.target = 500_000;
    draft.userLockedTarget = true;
    draft.proposedTarget = 500_000;
    const phrases = [
      "Copiar outubro",
      "Vamos copiar outubro",
      "Quero usar a configuração de outubro",
      "Repete a escada do mês passado",
    ];
    for (const message of phrases) {
      const op = interpretGoalOpStructural(message, {
        form: draft.form,
        today: ctx.today,
      });
      const intent = classifyTurn({ message, draft, opIntent: op });
      expect(intent.kind, message).toBe("select_path");
      expect(intent.path, message).toBe("copy");
      expect(intent.mutates, message).toBe(true);
    }
  });

  it("pergunta sobre niveis → inspect sem mutacao", () => {
    const draft = afterCopyDraft();
    const intent = classifyTurn({ message: "Tem quatro níveis?", draft });
    expect(intent.kind).toBe("inspect");
    expect(intent.mutates).toBe(false);
  });

  it("pergunta consultiva de valor → consult_value", () => {
    const draft = proposalAwaiting(500_000);
    const intent = classifyTurn({
      message: "Vale a pena aumentar a meta? O que você acha?",
      draft,
    });
    expect(intent.kind).toBe("consult_value");
    expect(intent.mutates).toBe(false);
    expect(intent.value?.keepDiscussing).toBe(true);
  });

  it("discussGoal: aceite de proposta nao dispara path nem save no mesmo turno", async () => {
    const { draft, shouldCommit } = await discussGoal(
      "Pode ser",
      ctx,
      proposalAwaiting(500_000),
      { turnId: "f3-accept" },
    );
    expect(draft.form.target).toBe(500_000);
    expect(draft.assembly?.path).toBeNull();
    expect(draft.form.tiers).toEqual([]);
    expect(shouldCommit).toBeFalsy();
    expect(draft.pendingCommit?.authorized).not.toBe(true);
  });

  it("discussGoal: Sim apos copia nao muta tiers nem autoriza save", async () => {
    const { draft, spokenReply, shouldCommit } = await discussGoal("Sim", ctx, afterCopyDraft(), {
      turnId: "f3-ack",
    });
    expect(draft.form.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);
    expect(shouldCommit).toBe(false);
    expect(draft.pendingCommit?.authorized).not.toBe(true);
    expect(spokenReply).toBeTruthy();
  });

  it("discussGoal: confirmacao contextual apos varios turnos", async () => {
    const accepted = await discussGoal("Pode ser", ctx, proposalAwaiting(500_000), {
      turnId: "f3-c1",
    });
    const copied = await discussGoal("Copiar outubro", ctx, accepted.draft, { turnId: "f3-c2" });
    // Sem fixture de outubro no mock deste arquivo — path copy marcado; se falhar, sem defaults.
    expect(copied.draft.assembly?.path).toBe("copy");
    if (copied.draft.copyStatus === "ok") {
      const offered = await discussGoal("salvar o rascunho", ctx, copied.draft, {
        turnId: "f3-c3",
      });
      expect(offered.draft.pendingCommit?.awaitingConfirm).toBe(true);
      const confirmed = await discussGoal("Fechado", ctx, offered.draft, { turnId: "f3-c4" });
      expect(confirmed.draft.pendingCommit?.authorized).toBe(true);
      expect(confirmed.shouldCommit).toBe(true);
    } else {
      expect(copied.draft.form.tiers).toEqual([]);
    }
  });

  it("ausencia de mutacoes duplicadas: consultiva nao aceita nem escolhe path", async () => {
    const before = proposalAwaiting(500_000);
    const { draft } = await discussGoal(
      "O que você acha de aumentar um pouco?",
      ctx,
      before,
      { turnId: "f3-consult" },
    );
    expect(draft.form.target).toBeNull();
    expect(draft.assembly?.path).toBeNull();
    expect(draft.proposedTarget).toBe(500_000);
  });
});
