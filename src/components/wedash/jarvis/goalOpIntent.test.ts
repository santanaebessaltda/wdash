import { describe, expect, it } from "vitest";
import {
  buildTierRevenueProposal,
  emptyGoalOpIntent,
  interpretGoalOpStructural,
  planGoalOpFromIntent,
  resolveTierFromLadder,
  scrubTechnicalSpeech,
  storeBaseFromTierRevenue,
  validateGoalOpIntent,
} from "./goalOpIntent";
import { discussGoal, emptyGoalAssembly, emptyGoalForm } from "./goalDraft";
import type { JarvisContext } from "./context";
import { createPendingCommit } from "./goalContract";

const OCTOBER_TIERS = [
  { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50 },
  { name: "Super meta", minAttainmentPct: 75, commissionPct: 2, bonus: 50 },
  { name: "Hiper meta", minAttainmentPct: 100, commissionPct: 2.5, bonus: 50 },
  { name: "Meta desafio", minAttainmentPct: 110, commissionPct: 3, bonus: 50 },
];

const ctx: JarvisContext = {
  today: "2026-10-30",
  tenantId: "t",
  membershipId: "m",
  managerFirstName: "Romeu",
  stores: [{ id: "a", name: "Loja", tradeName: "Loja", code: "1" }],
  network: [{ id: "a", name: "Loja", tradeName: "Loja", code: "1" }],
};

function draftWithOctoberLadder(target: number | null = 244_600) {
  const form = emptyGoalForm("a");
  form.name = "Novembro 2026";
  form.startsOn = "2026-11-01";
  form.endsOn = "2026-11-30";
  form.target = target;
  form.tiers = OCTOBER_TIERS.map((t) => ({ ...t }));
  form.groups = [
    { shiftId: "m", name: "Turno 1", pct: 45 },
    { shiftId: "t", name: "Turno 2", pct: 55 },
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
    },
    userLockedTarget: target != null,
    proposedTarget: null as number | null,
    copyStatus: "ok" as const,
    copiedFrom: { from: "2026-10-01", to: "2026-10-31" },
    pendingCommit: null,
  };
}

describe("P1 GoalOpIntent schema", () => {
  it("valida schema e rejeita lixo", () => {
    expect(validateGoalOpIntent(null)).toBeNull();
    expect(validateGoalOpIntent({ kind: "nope" })).toBeNull();
    const ok = validateGoalOpIntent({
      kind: "proposal",
      entity: "tier_revenue",
      amountCents: 260_000,
      amountRole: "tier_threshold",
      tierRef: { byPct: 110, byName: "desafio", byIndex: -1 },
      periodRole: null,
      periodMonth: null,
      authorizeApply: false,
      authorizeSave: false,
      confidence: "high",
      ambiguity: null,
      notes: null,
    });
    expect(ok?.amountRole).toBe("tier_threshold");
    expect(ok?.amountCents).toBe(260_000);
  });

  it("calcula meta-base a partir do limiar do nível (regra do editor)", () => {
    expect(storeBaseFromTierRevenue(260_000, 110)).toBe(236_364);
    const resolved = resolveTierFromLadder(OCTOBER_TIERS, { byPct: 110 })!;
    const p = buildTierRevenueProposal(260_000, resolved, OCTOBER_TIERS);
    expect(p.proposedBase).toBe(236_364);
    expect(p.levelsImpact[3]?.threshold).toBe(260_000);
    expect(p.levelsImpact.map((l) => l.pct)).toEqual([50, 75, 100, 110]);
  });

  it("resolve quarto nível pela escada real (110%), nao 180%", () => {
    const r = resolveTierFromLadder(OCTOBER_TIERS, { byIndex: 4 });
    expect(r?.tier.minAttainmentPct).toBe(110);
    expect(r?.tier.name).toMatch(/desafio/i);
  });

  it("scrub remove confiança técnica", () => {
    expect(scrubTechnicalSpeech("Recomendo R$ 257 mil (confiança medium).")).toBe(
      "Recomendo R$ 257 mil.",
    );
  });
});

describe("P1 interpretacao estrutural + discussGoal", () => {
  it('1. "Quero R$ 260 mil como meta principal." → store_base', async () => {
    const intent = interpretGoalOpStructural("Quero R$ 260 mil como meta principal.", {
      form: draftWithOctoberLadder().form,
      today: ctx.today,
    });
    expect(intent.amountRole).toBe("store_base");
    expect(intent.amountCents).toBe(260_000);
    const { draft } = await discussGoal("Quero R$ 260 mil como meta principal.", ctx, draftWithOctoberLadder(), {
      intent,
    });
    expect(draft.form.target).toBe(260_000);
    expect(draft.form.startsOn).toBe("2026-11-01");
  });

  it('2. "Quero R$ 260 mil no nível de desafio de 110%." → proposta, sem aplicar', async () => {
    const intent = interpretGoalOpStructural(
      "Quero R$ 260 mil no nível de desafio de 110%.",
      { form: draftWithOctoberLadder().form, today: ctx.today },
    );
    expect(intent.amountRole).toBe("tier_threshold");
    expect(intent.entity).toBe("tier_revenue");
    const prev = draftWithOctoberLadder(244_600);
    const { draft, spokenReply } = await discussGoal(
      "Quero R$ 260 mil no nível de desafio de 110%.",
      ctx,
      prev,
      { intent },
    );
    expect(draft.form.target).toBe(244_600);
    expect(draft.proposedTarget).toBe(236_364);
    expect(spokenReply).toMatch(/236/);
    expect(spokenReply).toMatch(/260/);
    expect(spokenReply).toMatch(/aplicar|Quer/i);
    expect(draft.pendingCommit?.authorized).toBeFalsy();
  });

  it('3. "Quanto seria a meta se o desafio fosse R$ 260 mil?" → pergunta sem mutar', async () => {
    const intent = interpretGoalOpStructural(
      "Quanto seria a meta se o desafio fosse R$ 260 mil?",
      { form: draftWithOctoberLadder().form, today: ctx.today },
    );
    expect(intent.kind).toBe("question");
    expect(intent.amountRole).toBe("tier_threshold");
    const prev = draftWithOctoberLadder(244_600);
    const { draft, spokenReply } = await discussGoal(
      "Quanto seria a meta se o desafio fosse R$ 260 mil?",
      ctx,
      prev,
      { intent },
    );
    expect(draft.form.target).toBe(244_600);
    expect(draft.proposedTarget).toBeNull();
    expect(spokenReply).toMatch(/236/);
    expect(spokenReply).toMatch(/não alterei|nao alterei/i);
  });

  it('4. "O quarto nível de outubro é 110%." → fato; destino novembro', async () => {
    const intent = interpretGoalOpStructural("O quarto nível de outubro é 110%.", {
      form: draftWithOctoberLadder().form,
      today: ctx.today,
    });
    expect(intent.entity).toBe("ladder");
    expect(intent.periodRole === "mention" || intent.periodRole === "origin").toBe(true);
    const prev = draftWithOctoberLadder(244_600);
    const { draft, spokenReply } = await discussGoal(
      "O quarto nível de outubro é 110%.",
      ctx,
      prev,
      { intent },
    );
    expect(draft.form.startsOn).toBe("2026-11-01");
    expect(draft.form.target).toBe(244_600);
    expect(spokenReply).toMatch(/110%/);
    expect(spokenReply).not.toMatch(/180%/);
    expect(spokenReply).toMatch(/destino|permanece|referência|referencia/i);
  });

  it('5. "Use outubro como referência para novembro." → origem, destino intacto', async () => {
    const intent = interpretGoalOpStructural("Use outubro como referência para novembro.", {
      form: draftWithOctoberLadder().form,
      today: ctx.today,
    });
    expect(intent.entity).toBe("period_origin");
    expect(intent.periodRole).toBe("origin");
    const prev = draftWithOctoberLadder(244_600);
    const { draft } = await discussGoal(
      "Use outubro como referência para novembro.",
      ctx,
      prev,
      { intent },
    );
    expect(draft.form.startsOn).toBe("2026-11-01");
  });

  it('6. "Mude a meta de novembro para dezembro." → destino muda', async () => {
    const intent = interpretGoalOpStructural("Mude a meta de novembro para dezembro.", {
      form: draftWithOctoberLadder().form,
      today: ctx.today,
    });
    expect(intent.entity).toBe("period_destination");
    const prev = draftWithOctoberLadder(244_600);
    const { draft } = await discussGoal(
      "Mude a meta de novembro para dezembro.",
      ctx,
      prev,
      { intent },
    );
    expect(draft.form.startsOn).toBe("2026-12-01");
  });

  it('7. "Como ficam os níveis com esse novo valor?" → inspeção', async () => {
    const intent = interpretGoalOpStructural("Como ficam os níveis com esse novo valor?", {
      form: draftWithOctoberLadder().form,
      today: ctx.today,
    });
    expect(intent.kind).toBe("inspect");
    const prev = draftWithOctoberLadder(236_364);
    prev.proposedTarget = 236_364;
    const { draft, spokenReply } = await discussGoal(
      "Como ficam os níveis com esse novo valor?",
      ctx,
      prev,
      { intent },
    );
    expect(draft.form.target).toBe(236_364);
    expect(spokenReply).toMatch(/nível|Nivel|Meta|%/i);
  });

  it("8. Correção de percentual após interpretação equivocada", async () => {
    const intent = interpretGoalOpStructural(
      "Na verdade o quarto nível de outubro é 110%, não 180%.",
      { form: draftWithOctoberLadder().form, today: ctx.today },
    );
    expect(intent.kind).toBe("correction");
    const plan = planGoalOpFromIntent(intent, {
      form: draftWithOctoberLadder().form,
      copyStatus: "ok",
      today: ctx.today,
    });
    expect(plan.freezeDestinationPeriod).toBe(true);
    expect(plan.spokenReply).toMatch(/110%/);
    expect(plan.spokenReply).not.toMatch(/180%/);
  });

  it("9. Rascunho preservado enquanto proposta de nível não é aceita", async () => {
    const prev = draftWithOctoberLadder(244_600);
    const intent = emptyGoalOpIntent({
      kind: "proposal",
      entity: "tier_revenue",
      amountCents: 260_000,
      amountRole: "tier_threshold",
      tierRef: { byPct: 110 },
      authorizeApply: false,
      confidence: "high",
    });
    const { draft } = await discussGoal("deixar 260 mil no desafio 110%", ctx, prev, { intent });
    expect(draft.form.target).toBe(244_600);
    expect(draft.proposedTarget).toBe(236_364);
  });

  it("10. Confirmação segura de save preservada (P0)", async () => {
    const form = {
      ...emptyGoalForm("a"),
      name: "Novembro 2026",
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      target: 244_600,
      tiers: OCTOBER_TIERS.map((t) => ({ ...t })),
      groups: [{ shiftId: "m", name: "T1", pct: 100 }],
    };
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
      ...draftWithOctoberLadder(244_600),
      form,
      pendingCommit: pending,
      proposedTarget: 257_000,
    };
    const { draft, shouldCommit } = await discussGoal("Sim", ctx, prev);
    expect(draft.form.target).toBe(244_600);
    expect(draft.pendingCommit?.authorized).toBe(true);
    expect(shouldCommit).toBe(true);
  });

  it("sem escada real, último nível com R$ não inventa 180%", async () => {
    const intent = interpretGoalOpStructural(
      "deixar o ultimo nivel com R$ 260.000",
      { form: emptyGoalForm("a"), today: ctx.today },
    );
    expect(intent.amountRole).toBe("tier_threshold");
    const plan = planGoalOpFromIntent(intent, {
      form: emptyGoalForm("a"),
      copyStatus: null,
      today: ctx.today,
    });
    expect(plan.needsLadder).toBe(true);
    expect(plan.blockDirectTargetLock).toBe(true);
    expect(plan.spokenReply).toMatch(/escada|referência|referencia/i);
  });
});
