import { describe, expect, it, vi, afterEach } from "vitest";
import { emptyGoalAssembly, emptyGoalForm, type GoalDraft } from "./goalDraft";
import {
  checkGoalTurnInvariants,
  emitGoalTurnTrace,
  setGoalTurnTraceSink,
  snapshotDraft,
  speechClaimsCopyOk,
  speechClaimsSaved,
  speakInvariantSafe,
  type GoalTurnTrace,
} from "./goalTurnTrace";
import type { GoalTurnIntent } from "./goalTurnIntent";

function intent(kind: GoalTurnIntent["kind"]): GoalTurnIntent {
  return {
    kind,
    path: kind === "select_path" ? "copy" : null,
    affirmation: "none",
    value: null,
    originMonth: null,
    mutates: kind === "select_path" || kind === "accept_value" || kind === "confirm_save",
    reason: "test",
  };
}

function draft(partial?: Partial<GoalDraft>): GoalDraft {
  return {
    form: {
      ...emptyGoalForm("a"),
      target: 500_000,
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      tiers: [
        { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: 50 },
        { name: "Super", minAttainmentPct: 75, commissionPct: 2, bonus: 50 },
      ],
    },
    assembly: { ...emptyGoalAssembly(), path: "copy", valueDiscussed: true },
    copyStatus: "ok",
    ...partial,
  };
}

describe("Fase 5 goalTurnTrace", () => {
  afterEach(() => {
    setGoalTurnTraceSink(null);
  });

  it("speechClaimsCopyOk / Saved", () => {
    expect(speechClaimsCopyOk("Pronto — trouxe a escada de outubro no rascunho.")).toBe(true);
    expect(speechClaimsCopyOk("Não consegui copiar a configuração.")).toBe(false);
    expect(speechClaimsSaved("Pronto — salvei “Meta Novembro” como rascunho")).toBe(true);
  });

  it("invariante: fala de copia sem copyStatus ok", () => {
    const before = snapshotDraft(draft({ copyStatus: null }));
    const after = snapshotDraft(draft({ copyStatus: "failed", form: { ...emptyGoalForm("a"), tiers: [] } }));
    const v = checkGoalTurnInvariants({
      intent: intent("select_path"),
      operation: "copy_ladder",
      before,
      after,
      result: {
        speech: "Pronto — trouxe a configuração de outubro no rascunho.",
        speechSource: "motor",
        shouldCommit: false,
        skipped: false,
        mutates: true,
        status: "failed",
        allowLlm: false,
      },
    });
    expect(v.some((x) => x.id === "copy_claim_without_ok")).toBe(true);
    expect(speakInvariantSafe(v)).toMatch(/inconsist|copia|rascunho/i);
  });

  it("invariante: inspect nao pode mudar tiers", () => {
    const before = snapshotDraft(draft());
    const after = snapshotDraft(
      draft({
        form: {
          ...emptyGoalForm("a"),
          target: 500_000,
          tiers: [{ name: "X", minAttainmentPct: 100, commissionPct: 1, bonus: 0 }],
        },
      }),
    );
    const v = checkGoalTurnInvariants({
      intent: intent("inspect"),
      operation: "inspect",
      before,
      after,
      result: {
        speech: "Tem 1 nível",
        speechSource: "motor",
        shouldCommit: false,
        skipped: false,
        mutates: false,
        status: "ok",
        allowLlm: false,
      },
    });
    expect(v.some((x) => x.id === "consult_mutated_draft" || x.id === "tiers_changed_without_intent")).toBe(
      true,
    );
  });

  it("invariante: accept_value nao inventa tiers", () => {
    const before = snapshotDraft({
      form: { ...emptyGoalForm("a"), target: null, tiers: [] },
      assembly: emptyGoalAssembly(),
      copyStatus: null,
    });
    const after = snapshotDraft({
      form: {
        ...emptyGoalForm("a"),
        target: 500_000,
        tiers: [
          { name: "N1", minAttainmentPct: 100, commissionPct: 1.5, bonus: 0 },
          { name: "N2", minAttainmentPct: 120, commissionPct: 2, bonus: 0 },
        ],
      },
      assembly: { ...emptyGoalAssembly(), path: null },
      copyStatus: null,
    });
    const v = checkGoalTurnInvariants({
      intent: intent("accept_value"),
      operation: "accept_value",
      before,
      after,
      result: {
        speech: "Apliquei",
        speechSource: "motor",
        shouldCommit: false,
        skipped: false,
        mutates: true,
        status: "ok",
        allowLlm: false,
      },
    });
    expect(v.some((x) => x.id === "tiers_changed_without_intent")).toBe(true);
  });

  it("emitGoalTurnTrace usa sink", () => {
    const seen: GoalTurnTrace[] = [];
    setGoalTurnTraceSink((t) => seen.push(t));
    emitGoalTurnTrace({
      turnId: "t1",
      sessionKey: "s",
      tenantKey: "ten",
      storeKey: "sto",
      intentKind: "inspect",
      operationRequested: "inspect",
      operationExecuted: "inspect",
      before: snapshotDraft(null),
      after: snapshotDraft(null),
      toolResult: "ok",
      speechSource: "motor",
      finalStatus: "ok",
      timings: { classifyMs: 1, executeMs: 2, invariantMs: 1, totalMs: 4 },
      violations: [],
      at: new Date().toISOString(),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.turnId).toBe("t1");
  });

  it("sink nao recebe mensagem completa do usuario", () => {
    const spy = vi.fn();
    setGoalTurnTraceSink(spy);
    emitGoalTurnTrace({
      turnId: "t2",
      sessionKey: "s",
      tenantKey: "ten",
      storeKey: "sto",
      intentKind: "accept_value",
      operationRequested: "accept_value",
      operationExecuted: "accept_value",
      before: snapshotDraft(null),
      after: snapshotDraft(draft()),
      toolResult: "ok",
      speechSource: "motor",
      finalStatus: "ok",
      timings: { classifyMs: 0, executeMs: 0, invariantMs: 0, totalMs: 0 },
      violations: [],
      at: new Date().toISOString(),
    });
    const payload = JSON.stringify(spy.mock.calls[0]![0]);
    expect(payload).not.toMatch(/password|token|Bearer|sbp_/i);
    expect(payload).not.toMatch(/user: /);
  });
});
