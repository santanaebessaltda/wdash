import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalRecord } from "@/data/wedash/engine/goalTypes";
import { createPendingCommit } from "./goalContract";
import {
  defaultGoalTiers,
  emptyGoalAssembly,
  emptyGoalForm,
  type GoalDraft,
} from "./goalDraft";
import { applyGoalTurn } from "./goalTurnApply";

const OCTOBER_TIERS = [
  { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50 },
  { name: "Super", minAttainmentPct: 75, commissionPct: 2, bonus: 50 },
  { name: "Hiper", minAttainmentPct: 100, commissionPct: 2.5, bonus: 50 },
  { name: "Desafio", minAttainmentPct: 110, commissionPct: 3, bonus: 50 },
] as const;

const octoberGoal: GoalRecord = {
  id: "goal-oct-f4",
  storeId: "a",
  name: "Meta Outubro 2026",
  startsOn: "2026-10-01",
  endsOn: "2026-10-31",
  target: 420_000,
  tierMode: "GROUP",
  spreadUnidentified: true,
  tiers: OCTOBER_TIERS.map((t) => ({ ...t })),
  groups: [
    { shiftId: "m", name: "Turno 1", pct: 45 },
    { shiftId: "t", name: "Turno 2", pct: 55 },
  ],
  published: true,
};

vi.mock("@/data/wedash/goalsRepo", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/data/wedash/goalsRepo")>();
  return {
    ...mod,
    fetchGoals: async (q: { storeIds: string[]; from: string; to: string }) => {
      const overlapsOct =
        q.storeIds.includes("a") && q.from <= "2026-10-31" && q.to >= "2026-10-01";
      return overlapsOct ? [octoberGoal] : [];
    },
  };
});

const ctx = {
  tenantId: "t",
  membershipId: "m1",
  storeIds: ["a"],
  stores: [
    { id: "a", name: "CAMPO GRANDE", tradeName: "Shopping Campo Grande", code: "00010" },
  ],
  network: [
    { id: "a", name: "CAMPO GRANDE", tradeName: "Shopping Campo Grande", code: "00010" },
  ],
  today: "2026-10-31",
  managerFirstName: "Romeu",
};

function proposalDraft(amount: number): GoalDraft {
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

describe("Fase 4 applyGoalTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1 — consulta sem mutacao (inspect)", async () => {
    const accepted = await applyGoalTurn("Pode ser", ctx, proposalDraft(500_000), {
      turnId: "f4-1a",
    });
    const copied = await applyGoalTurn("Copiar outubro", ctx, accepted.draft, {
      turnId: "f4-1b",
    });
    expect(copied.draft.copyStatus).toBe("ok");
    const inspect = await applyGoalTurn("Tem quatro níveis?", ctx, copied.draft, {
      turnId: "f4-1c",
    });
    expect(inspect.operation).toBe("inspect");
    expect(inspect.mutates).toBe(false);
    expect(inspect.speech).toMatch(/50%|75%|100%|110%/);
    expect(inspect.allowLlm).toBe(false);
    expect(inspect.draft.form.tiers).toEqual(copied.draft.form.tiers);
  });

  it("2 — operacao sem execucao duplicada (mesmo turnId)", async () => {
    const first = await applyGoalTurn("Pode ser", ctx, proposalDraft(500_000), {
      turnId: "f4-dup",
    });
    expect(first.skipped).toBe(false);
    expect(first.draft.form.target).toBe(500_000);
    const second = await applyGoalTurn("Pode ser", ctx, first.draft, { turnId: "f4-dup" });
    expect(second.skipped).toBe(true);
    expect(second.status).toBe("skipped");
    expect(second.draft.form.target).toBe(500_000);
    expect(second.draft.form.tiers).toEqual([]);
  });

  it("3 — resposta ancorada no estado apos copia", async () => {
    const accepted = await applyGoalTurn("Pode ser", ctx, proposalDraft(500_000), {
      turnId: "f4-3a",
    });
    const copied = await applyGoalTurn("Copiar outubro", ctx, accepted.draft, {
      turnId: "f4-3b",
    });
    expect(copied.operation).toBe("copy_ladder");
    expect(copied.speechSource).toBe("motor");
    expect(copied.speech ?? "").toMatch(/50%|75%|100%|110%/);
    expect(copied.allowLlm).toBe(false);
  });

  it("4 — pergunta consultiva durante montagem nao muta e libera LLM", async () => {
    const accepted = await applyGoalTurn("Pode ser", ctx, proposalDraft(500_000), {
      turnId: "f4-4a",
    });
    const consult = await applyGoalTurn(
      "Vale a pena aumentar a meta? O que você acha?",
      ctx,
      accepted.draft,
      { turnId: "f4-4b" },
    );
    expect(consult.operation).toBe("consult_value");
    expect(consult.status).toBe("consultative");
    expect(consult.mutates).toBe(false);
    expect(consult.allowLlm).toBe(true);
    expect(consult.speech).toBeNull();
    expect(consult.draft.form.target).toBe(500_000);
    expect(consult.draft.assembly?.path).toBeNull();
  });

  it("5 — mudanca de assunto e retorno: inspect nao perde escada", async () => {
    const accepted = await applyGoalTurn("Pode ser", ctx, proposalDraft(500_000), {
      turnId: "f4-5a",
    });
    const copied = await applyGoalTurn("Copiar outubro", ctx, accepted.draft, {
      turnId: "f4-5b",
    });
    const aside = await applyGoalTurn("Como estão as vendas da semana?", ctx, copied.draft, {
      turnId: "f4-5c",
    });
    // Sem path de mutacao: estado preservado.
    expect(aside.draft.form.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);
    const back = await applyGoalTurn("Quais são os níveis?", ctx, aside.draft, {
      turnId: "f4-5d",
    });
    expect(back.operation).toBe("inspect");
    expect(back.speech ?? "").toMatch(/50%/);
  });

  it("6 — copia de configuracao", async () => {
    const accepted = await applyGoalTurn("Pode ser", ctx, proposalDraft(500_000), {
      turnId: "f4-6a",
    });
    const copied = await applyGoalTurn("Quero usar a configuração de outubro", ctx, accepted.draft, {
      turnId: "f4-6b",
    });
    expect(copied.intent.kind).toBe("select_path");
    expect(copied.draft.copyStatus).toBe("ok");
    expect(copied.draft.form.tiers).toHaveLength(4);
  });

  it("7 — inspecao de niveis", async () => {
    const accepted = await applyGoalTurn("Pode ser", ctx, proposalDraft(500_000), {
      turnId: "f4-7a",
    });
    const copied = await applyGoalTurn("Copiar outubro", ctx, accepted.draft, {
      turnId: "f4-7b",
    });
    const levels = await applyGoalTurn("Quais são os níveis?", ctx, copied.draft, {
      turnId: "f4-7c",
    });
    expect(levels.operation).toBe("inspect");
    expect(levels.speech ?? "").not.toMatch(/120%|150%|180%/);
  });

  it("8 — confirmacao e gravacao", async () => {
    const accepted = await applyGoalTurn("Pode ser", ctx, proposalDraft(500_000), {
      turnId: "f4-8a",
    });
    const copied = await applyGoalTurn("Copiar outubro", ctx, accepted.draft, {
      turnId: "f4-8b",
    });
    const offered = await applyGoalTurn("salvar o rascunho", ctx, copied.draft, {
      turnId: "f4-8c",
    });
    expect(offered.operation).toBe("request_save");
    expect(offered.draft.pendingCommit?.awaitingConfirm).toBe(true);
    expect(offered.shouldCommit).toBe(false);
    expect(offered.speech ?? "").toMatch(/Posso salvar/i);

    const blob = `user: salvar o rascunho\njarvis: ${offered.speech}\nuser: Sim`;
    const confirmed = await applyGoalTurn(blob, ctx, offered.draft, { turnId: "f4-8d" });
    expect(confirmed.operation).toBe("confirm_save");
    expect(confirmed.shouldCommit).toBe(true);
    expect(confirmed.status).toBe("commit_ready");
    expect(confirmed.speech).toBeNull();
  });

  it("9 — falha de copia sem fallback de defaults", async () => {
    const accepted = await applyGoalTurn("Pode ser", ctx, proposalDraft(500_000), {
      turnId: "f4-9a",
    });
    const failed = await applyGoalTurn("Copiar a configuração de janeiro", ctx, accepted.draft, {
      turnId: "f4-9b",
    });
    expect(failed.intent.path).toBe("copy");
    expect(failed.status).toBe("failed");
    expect(failed.draft.form.tiers).toEqual([]);
    expect(failed.speech ?? "").not.toMatch(/100%.*120%.*150%.*180%/);
  });

  it("10 — continuidade apos correcao (Sim apos copia nao grava)", async () => {
    const accepted = await applyGoalTurn("Pode ser", ctx, proposalDraft(500_000), {
      turnId: "f4-10a",
    });
    const copied = await applyGoalTurn("Copiar outubro", ctx, accepted.draft, {
      turnId: "f4-10b",
    });
    const ack = await applyGoalTurn("Sim", ctx, copied.draft, { turnId: "f4-10c" });
    expect(ack.operation).toBe("acknowledge_copy");
    expect(ack.shouldCommit).toBe(false);
    expect(ack.mutates).toBe(false);
    expect(ack.speech ?? "").toMatch(/50%|escada|niveis|níveis|rascunho/i);
  });

  it("11 — resposta natural sem avancar checklist (agree_no_op)", async () => {
    const locked: GoalDraft = {
      form: {
        ...emptyGoalForm("a"),
        name: "Meta Novembro 2026",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        target: 500_000,
        tiers: defaultGoalTiers(),
      },
      assembly: {
        ...emptyGoalAssembly(),
        periodConfirmed: true,
        valueDiscussed: true,
        path: "fresh",
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
      },
      userLockedTarget: true,
      proposedTarget: 500_000,
      pendingCommit: null,
      copyStatus: null,
    };
    const agree = await applyGoalTurn("Ok", ctx, locked, { turnId: "f4-11" });
    expect(agree.operation === "agree_no_op" || agree.allowLlm).toBe(true);
    expect(agree.shouldCommit).toBe(false);
    expect(agree.draft.pendingCommit?.awaitingConfirm).not.toBe(true);
  });

  it("fingerprint pendingCommit preservado ate mutacao", async () => {
    const form = {
      ...emptyGoalForm("a"),
      name: "Meta Novembro 2026",
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      target: 500_000,
      tiers: defaultGoalTiers(),
    };
    const pending = createPendingCommit(
      {
        form,
        assembly: {
          ...emptyGoalAssembly(),
          path: "copy",
          confirmedGroups: true,
          confirmedSpread: true,
          confirmedTiers: true,
          confirmedMount: true,
        },
      },
      "Loja",
    );
    const draft: GoalDraft = {
      form,
      assembly: {
        ...emptyGoalAssembly(),
        path: "copy",
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
        confirmedMount: true,
      },
      userLockedTarget: true,
      pendingCommit: pending,
      copyStatus: "ok",
    };
    const confirm = await applyGoalTurn("Fechado", ctx, draft, { turnId: "f4-fp" });
    expect(confirm.shouldCommit).toBe(true);
    expect(confirm.draft.pendingCommit?.fingerprint).toBe(pending.fingerprint);
  });
});
