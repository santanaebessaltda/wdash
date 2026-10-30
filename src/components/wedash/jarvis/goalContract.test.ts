import { describe, expect, it } from "vitest";
import {
  applyProposedTarget,
  createPendingCommit,
  goalDraftFingerprint,
  hasProposalAwaitingAccept,
  looksLikeAcceptPendingProposal,
  looksLikeAcceptProposal,
  looksLikeAskValueSuggestionP0,
  looksLikeConfirmPendingSave,
  looksLikeNaturalAffirmation,
  looksLikeRequestSave,
  looksLikeSimulateLevelsAtAmount,
  looksLikeValueInconsistency,
  pendingCommitStillValid,
  speakSimulateLevels,
  speakValueInconsistency,
} from "./goalContract";
import {
  emptyGoalAssembly,
  emptyGoalForm,
  goalCanCommit,
  goalCanPersist,
  goalConfigReadyForSaveOffer,
} from "./goalDraft";

function baseDraft(target: number | null = 244_600) {
  const form = emptyGoalForm("a");
  form.name = "Novembro 2026";
  form.startsOn = "2026-11-01";
  form.endsOn = "2026-11-30";
  form.target = target;
  form.groups = [
    { shiftId: "m", name: "Turno 1", pct: 45 },
    { shiftId: "t", name: "Turno 2", pct: 55 },
  ];
  form.tiers = [
    { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50 },
    { name: "Super", minAttainmentPct: 75, commissionPct: 2, bonus: 50 },
    { name: "Hiper", minAttainmentPct: 100, commissionPct: 2.5, bonus: 50 },
    { name: "Desafio", minAttainmentPct: 110, commissionPct: 3, bonus: 50 },
  ];
  return {
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
    proposedTarget: 257_000 as number | null,
    proposal: null,
    pendingCommit: null,
    userLockedTarget: target != null,
  };
}

describe("P0 contrato proposta vs aplicado", () => {
  it("recomenda detecta pedido de sugestao", () => {
    expect(looksLikeAskValueSuggestionP0("qual valor você recomenda?")).toBe(true);
  });

  it("aceite natural da proposta pendente", () => {
    expect(looksLikeNaturalAffirmation("Pode ser")).toBe(true);
    expect(looksLikeNaturalAffirmation("Fechado")).toBe(true);
    expect(looksLikeNaturalAffirmation("Vamos nessa")).toBe(true);
    expect(looksLikeNaturalAffirmation("Sim")).toBe(true);
    expect(looksLikeNaturalAffirmation("Vamos deixar 45 e 55% mesmo")).toBe(false);
    expect(looksLikeAcceptProposal("aceito a recomendada")).toBe(true);

    const awaiting = hasProposalAwaitingAccept({
      form: { target: 244_600 },
      proposedTarget: 257_000,
    });
    expect(awaiting).toBe(true);
    expect(looksLikeAcceptPendingProposal("Pode ser", true, false)).toBe(true);
    expect(looksLikeAcceptPendingProposal("Pode ser", true, true)).toBe(false); // save aguardando
    expect(looksLikeAcceptPendingProposal("Sim", false, false)).toBe(false); // sem proposta
    expect(looksLikeAcceptPendingProposal("pode salvar o rascunho", true, false)).toBe(false);
  });

  it("applyProposedTarget seta form.target e limpa pendingCommit", () => {
    const d = applyProposedTarget(baseDraft(244_600), 257_000);
    expect(d.form.target).toBe(257_000);
    expect(d.userLockedTarget).toBe(true);
    expect(d.pendingCommit).toBeNull();
  });

  it("simulacao nao depende de mutar o draft", () => {
    const d = baseDraft(244_600);
    const text = speakSimulateLevels(d, 257_000);
    expect(text).toMatch(/257/);
    expect(text).toMatch(/não alterei|nao alterei/i);
    expect(d.form.target).toBe(244_600);
    expect(looksLikeSimulateLevelsAtAmount("Como ficariam os níveis com R$ 257 mil?")).toBe(true);
  });

  it("inconsistencia explica proposto vs aplicado", () => {
    const d = baseDraft(244_600);
    expect(
      looksLikeValueInconsistency("Você falou R$ 257 mil, mas a meta está R$ 244.600"),
    ).toBe(true);
    const text = speakValueInconsistency(d);
    expect(text).toMatch(/244/);
    expect(text).toMatch(/257/);
    expect(text).toMatch(/aplicado/i);
  });
});

describe("P0 pendingCommit", () => {
  it("fingerprint muda invalida confirmacao", () => {
    const d = baseDraft(244_600);
    const pending = createPendingCommit(d, "Loja");
    const withPending = { ...d, pendingCommit: pending };
    expect(pendingCommitStillValid(withPending)).toBe(true);
    const changed = {
      ...withPending,
      form: { ...withPending.form, target: 257_000 },
    };
    expect(pendingCommitStillValid(changed)).toBe(false);
    expect(goalDraftFingerprint(d.form)).not.toBe(goalDraftFingerprint(changed.form));
  });

  it("goalCanPersist exige authorized", () => {
    const d = baseDraft(244_600);
    expect(goalConfigReadyForSaveOffer(d)).toBe(true);
    expect(goalCanPersist(d)).toBe(false);
    expect(goalCanCommit(d)).toBe(false);
    const pending = createPendingCommit(d, "Loja");
    const awaiting = { ...d, pendingCommit: pending };
    expect(goalCanPersist(awaiting)).toBe(false);
    const auth = {
      ...awaiting,
      pendingCommit: { ...pending, awaitingConfirm: false, authorized: true },
    };
    expect(goalCanPersist(auth)).toBe(true);
  });

  it("confirmacao de pesos nao e request save", () => {
    expect(looksLikeRequestSave("Vamos deixar 45 e 55% mesmo")).toBe(false);
    expect(looksLikeConfirmPendingSave("Sim")).toBe(true);
    expect(looksLikeRequestSave("pode salvar o rascunho")).toBe(true);
  });
});
