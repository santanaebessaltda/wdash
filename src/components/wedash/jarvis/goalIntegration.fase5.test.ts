/**
 * Fase 5 — conversa completa (integração) com trace + invariantes.
 * Gravação: só shouldCommit / pendingCommit (sem saveGoal real).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalRecord } from "@/data/wedash/engine/goalTypes";
import { applyGoalTurn } from "./goalTurnApply";
import { emptyGoalAssembly, emptyGoalForm, type GoalDraft } from "./goalDraft";
import {
  setGoalTurnTraceSink,
  type GoalTurnTrace,
} from "./goalTurnTrace";

const OCTOBER_TIERS = [
  { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50 },
  { name: "Super", minAttainmentPct: 75, commissionPct: 2, bonus: 50 },
  { name: "Hiper", minAttainmentPct: 100, commissionPct: 2.5, bonus: 50 },
  { name: "Desafio", minAttainmentPct: 110, commissionPct: 3, bonus: 50 },
] as const;

const octoberGoal: GoalRecord = {
  id: "goal-oct-f5",
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
  tenantId: "tenant-f5-test",
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

describe("Fase 5 integracao conversa novembro + outubro", () => {
  const traces: GoalTurnTrace[] = [];

  beforeEach(() => {
    traces.length = 0;
    setGoalTurnTraceSink((t) => traces.push(t));
    vi.clearAllMocks();
  });

  it("fluxo completo 1–10 com traces e sem violacao", async () => {
    // 1–2 criar / aceitar valor
    let turn = await applyGoalTurn("Pode ser", ctx, proposalDraft(500_000), {
      turnId: "f5-1",
      sessionKey: "f5-sess",
    });
    expect(turn.draft.form.target).toBe(500_000);
    expect(turn.draft.form.tiers).toEqual([]);
    expect(turn.invariantBlocked).not.toBe(true);

    // 3 copiar outubro
    turn = await applyGoalTurn("Copiar outubro", ctx, turn.draft, {
      turnId: "f5-3",
      sessionKey: "f5-sess",
    });
    expect(turn.draft.copyStatus).toBe("ok");
    expect(turn.draft.form.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);
    expect(turn.speechSource).toBe("motor");

    // 4 niveis
    turn = await applyGoalTurn("Quais são os níveis?", ctx, turn.draft, {
      turnId: "f5-4",
      sessionKey: "f5-sess",
    });
    expect(turn.operation).toBe("inspect");
    expect(turn.mutates).toBe(false);
    expect(turn.speech ?? "").toMatch(/50%/);

    // 5 bonus e grupos
    turn = await applyGoalTurn("Quais são os bônus?", ctx, turn.draft, { turnId: "f5-5a" });
    expect(turn.mutates).toBe(false);
    turn = await applyGoalTurn("Como ficaram os grupos?", ctx, turn.draft, { turnId: "f5-5b" });
    expect(turn.speech ?? "").toMatch(/Turno|45%|55%/);

    // 6 pesos (consulta — sem exigir tool de vendas real)
    turn = await applyGoalTurn("O que acha dos pesos dos turnos?", ctx, turn.draft, {
      turnId: "f5-6",
    });
    expect(turn.draft.form.tiers).toHaveLength(4);

    // 7 alterar so o valor
    turn = await applyGoalTurn("R$ 510.000", ctx, turn.draft, { turnId: "f5-7" });
    expect(turn.draft.form.target).toBe(510_000);
    expect(turn.draft.form.tiers.map((t) => t.minAttainmentPct)).toEqual([50, 75, 100, 110]);

    // 8 pedir confirmacao
    turn = await applyGoalTurn("salvar o rascunho", ctx, turn.draft, { turnId: "f5-8" });
    expect(turn.draft.pendingCommit?.awaitingConfirm).toBe(true);
    expect(turn.shouldCommit).toBe(false);
    const summary = turn.speech;
    expect(summary ?? "").toMatch(/Posso salvar|510/);

    // 9 confirmar versao
    const blob = `user: salvar o rascunho\njarvis: ${summary}\nuser: Sim`;
    turn = await applyGoalTurn(blob, ctx, turn.draft, { turnId: "f5-9" });
    expect(turn.shouldCommit).toBe(true);
    expect(turn.draft.pendingCommit?.authorized).toBe(true);
    expect(turn.draft.form.target).toBe(510_000);

    // 10 resultado “persistido” = estado autorizado (sem chamar saveGoal em teste)
    expect(turn.draft.form.tiers).toHaveLength(4);
    expect(turn.invariantBlocked).not.toBe(true);

    // Traces: correlacao e sem PII pesada
    expect(traces.length).toBeGreaterThanOrEqual(8);
    expect(traces.every((t) => t.sessionKey === "f5-sess" || t.turnId.startsWith("f5-"))).toBe(true);
    expect(traces.every((t) => t.violations.length === 0)).toBe(true);
    const dumped = JSON.stringify(traces);
    expect(dumped).not.toMatch(/sbp_|password|Bearer /i);
  });

  it("dupla chamada mesmo turnId nao reaplica", async () => {
    const first = await applyGoalTurn("Pode ser", ctx, proposalDraft(500_000), {
      turnId: "f5-dup",
    });
    const second = await applyGoalTurn("Pode ser", ctx, first.draft, { turnId: "f5-dup" });
    expect(second.skipped).toBe(true);
    expect(second.trace?.finalStatus).toBe("skipped");
    expect(second.draft.form.target).toBe(500_000);
  });

  it("falha de ferramenta / copia vazia nao afirma sucesso", async () => {
    const accepted = await applyGoalTurn("Pode ser", ctx, proposalDraft(500_000), {
      turnId: "f5-fail-a",
    });
    const failed = await applyGoalTurn("Copiar a configuração de janeiro", ctx, accepted.draft, {
      turnId: "f5-fail-b",
    });
    expect(failed.status).toBe("failed");
    expect(failed.draft.copyStatus).toBe("failed");
    expect(failed.speech ?? "").not.toMatch(/Pronto — trouxe/);
    expect(failed.trace?.violations.every((v) => v.id !== "copy_claim_without_ok")).toBe(true);
  });
});
