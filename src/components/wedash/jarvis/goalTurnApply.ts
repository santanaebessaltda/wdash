/**
 * Fase 4 — execução única do turno de meta.
 * Fase 5 — trace + invariantes (sem mudar o contrato conversacional).
 * classifyTurn → discussGoal → GoalTurnResult (fala vs mutação separadas).
 */
import type { JarvisContext } from "./context";
import {
  discussGoal,
  naturalGoalAskFromDraft,
  type DiscussGoalOpts,
  type GoalDraft,
} from "./goalDraft";
import { interpretGoalOpStructural, type GoalOpIntent } from "./goalOpIntent";
import {
  classifyGoalTurn,
  type GoalTurnIntent,
  type GoalTurnIntentKind,
} from "./goalTurnIntent";
import {
  buildGoalTurnTrace,
  checkGoalTurnInvariants,
  emitGoalTurnTrace,
  snapshotDraft,
  speakInvariantSafe,
  type GoalTurnTrace,
} from "./goalTurnTrace";

export type GoalTurnResultStatus =
  | "ok"
  | "failed"
  | "needs_clarify"
  | "consultative"
  | "skipped"
  | "commit_ready";

export type GoalTurnOperation =
  | "inspect"
  | "confirm_save"
  | "acknowledge_copy"
  | "clarify_choice"
  | "accept_value"
  | "consult_value"
  | "copy_ladder"
  | "select_recommended"
  | "select_fresh"
  | "request_save"
  | "agree_no_op"
  | "none";

export type GoalTurnResult = {
  intent: GoalTurnIntent;
  operation: GoalTurnOperation;
  status: GoalTurnResultStatus;
  draft: GoalDraft;
  /** Texto denso para tool / contexto do LLM (não é fala ao Gestor). */
  facts: string;
  /**
   * Fala ancorada no motor. Se presente e `allowLlm` é false,
   * o Provider NÃO chama o chat.
   */
  speech: string | null;
  /** Consultiva / neutra: LLM pode redigir com facts + análises. */
  allowLlm: boolean;
  shouldCommit: boolean;
  skipped: boolean;
  mutates: boolean;
  /** Origem da fala quando speech ≠ null. */
  speechSource: "motor" | null;
  /** Fase 5: trace emitido (também em console / sink). */
  trace?: GoalTurnTrace;
  /** Fase 5: invariante bloqueou a fala original. */
  invariantBlocked?: boolean;
};

export type ApplyGoalTurnOpts = DiscussGoalOpts & {
  /** Já resolvido pelo Provider (LLM interpret_goal_op); senão estrutural. */
  intent?: GoalOpIntent | null;
  /** Correlação de sessão (sem PII). */
  sessionKey?: string;
};

function operationFrom(
  intent: GoalTurnIntent,
  opts: { copyJustApplied?: boolean; copyStatus?: GoalDraft["copyStatus"] },
): GoalTurnOperation {
  if (intent.kind === "select_path") {
    if (intent.path === "copy") return "copy_ladder";
    if (intent.path === "recommended") return "select_recommended";
    if (intent.path === "fresh") return "select_fresh";
  }
  if (intent.kind === "confirm_save") return "confirm_save";
  if (intent.kind === "acknowledge_copy") return "acknowledge_copy";
  if (intent.kind === "clarify_choice") return "clarify_choice";
  if (intent.kind === "accept_value") return "accept_value";
  if (intent.kind === "consult_value") return "consult_value";
  if (intent.kind === "inspect") return "inspect";
  if (intent.kind === "request_save") return "request_save";
  if (intent.kind === "agree_no_op") return "agree_no_op";
  if (opts.copyJustApplied) return "copy_ladder";
  return "none";
}

function statusFrom(
  intent: GoalTurnIntent,
  opts: {
    skipped?: boolean;
    shouldCommit?: boolean;
    copyStatus?: GoalDraft["copyStatus"];
    speech: string | null;
  },
): GoalTurnResultStatus {
  if (opts.skipped) return "skipped";
  if (opts.shouldCommit) return "commit_ready";
  if (intent.kind === "clarify_choice") return "needs_clarify";
  if (intent.kind === "consult_value") return "consultative";
  if (intent.kind === "select_path" && intent.path === "copy" && opts.copyStatus === "failed") {
    return "failed";
  }
  if (intent.kind === "agree_no_op" || (intent.kind === "unknown" && !intent.mutates)) {
    return "consultative";
  }
  return "ok";
}

/** Intenções em que a fala do motor é obrigatória (números / estado). */
function requiresMotorSpeech(kind: GoalTurnIntentKind): boolean {
  return (
    kind === "inspect" ||
    kind === "confirm_save" ||
    kind === "acknowledge_copy" ||
    kind === "clarify_choice" ||
    kind === "accept_value" ||
    kind === "select_path" ||
    kind === "request_save"
  );
}

function nowMs(): number {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

/**
 * Executa o turno de meta uma vez: classifica → motor → resultado estruturado.
 * Idempotente por `turnId` (eager Provider + draft_goal).
 */
export async function applyGoalTurn(
  question: string,
  ctx: JarvisContext,
  prev: GoalDraft | null,
  opts?: ApplyGoalTurnOpts,
): Promise<GoalTurnResult> {
  const t0 = nowMs();
  const beforeSnap = snapshotDraft(prev);

  const lastUser = (() => {
    const t = question.trim();
    if (!/user:/i.test(t)) return t;
    const parts = t.split(/\n(?=user:|jarvis:)/i).filter((p) => /^user:/i.test(p.trim()));
    const last = parts[parts.length - 1] ?? t;
    return last.replace(/^user:\s*/i, "").trim();
  })();

  const form = prev?.form ?? {
    name: "",
    storeId: ctx.stores.length === 1 ? ctx.stores[0]!.id : "",
    startsOn: null,
    endsOn: null,
    target: null,
    tierMode: "INDIVIDUAL" as const,
    spreadUnidentified: false,
    tiers: [],
    groups: [],
    managerOn: false,
  };

  const tClassify0 = nowMs();
  const opIntent: GoalOpIntent =
    opts?.intent ??
    interpretGoalOpStructural(lastUser, {
      form,
      copiedFrom: prev?.copiedFrom ?? null,
      copyStatus: prev?.copyStatus ?? null,
      today: ctx.today,
    });

  const intent = classifyGoalTurn({
    message: lastUser,
    draft: prev,
    historyOrJarvis: question,
    opIntent,
  });
  const classifyMs = Math.max(0, Math.round(nowMs() - tClassify0));

  const operationRequested = operationFrom(intent, {
    copyStatus: prev?.copyStatus ?? null,
  });

  const tExec0 = nowMs();
  const discussed = await discussGoal(question, ctx, prev, {
    ...opts,
    intent: opIntent,
  });
  const executeMs = Math.max(0, Math.round(nowMs() - tExec0));

  const operation = operationFrom(intent, {
    copyJustApplied: discussed.copyJustApplied,
    copyStatus: discussed.draft.copyStatus,
  });

  const mutates = intent.mutates && !discussed.skipped;
  let speech = discussed.spokenReply ?? null;
  let allowLlm = false;

  if (discussed.shouldCommit) {
    speech = null;
    allowLlm = false;
  } else if (discussed.skipped) {
    speech = null;
    allowLlm = true;
  } else if (intent.kind === "consult_value" || intent.kind === "agree_no_op") {
    allowLlm = true;
    speech = null;
  } else if (requiresMotorSpeech(intent.kind)) {
    if (!speech && mutates) {
      speech = naturalGoalAskFromDraft(discussed.draft);
    }
    allowLlm = !speech;
  } else if (speech) {
    allowLlm = false;
  } else {
    allowLlm = true;
  }

  const status = statusFrom(intent, {
    skipped: discussed.skipped,
    shouldCommit: discussed.shouldCommit,
    copyStatus: discussed.draft.copyStatus,
    speech,
  });

  let result: GoalTurnResult = {
    intent,
    operation,
    status,
    draft: discussed.draft,
    facts: discussed.reply,
    speech,
    allowLlm,
    shouldCommit: discussed.shouldCommit === true,
    skipped: discussed.skipped === true,
    mutates,
    speechSource: speech ? "motor" : null,
  };

  const tInv0 = nowMs();
  const afterSnap = snapshotDraft(result.draft);
  const violations = checkGoalTurnInvariants({
    intent,
    operation,
    before: beforeSnap,
    after: afterSnap,
    result,
    turnAlreadyApplied: discussed.skipped === true,
  });
  const invariantMs = Math.max(0, Math.round(nowMs() - tInv0));

  let invariantBlocked = false;
  if (violations.length > 0) {
    invariantBlocked = true;
    result = {
      ...result,
      speech: speakInvariantSafe(violations),
      speechSource: "motor",
      allowLlm: false,
      shouldCommit: false,
      invariantBlocked: true,
      status: result.status === "commit_ready" ? "failed" : result.status,
    };
  }

  const timings = {
    classifyMs,
    executeMs,
    invariantMs,
    totalMs: Math.max(0, Math.round(nowMs() - t0)),
  };

  const trace = buildGoalTurnTrace({
    turnId: opts?.turnId?.trim() || `anon-${Date.now().toString(36)}`,
    sessionKey: opts?.sessionKey,
    tenantId: ctx.tenantId,
    storeId: result.draft.form.storeId || form.storeId || null,
    intent,
    operationRequested,
    operationExecuted: operation,
    before: beforeSnap,
    after: snapshotDraft(result.draft),
    toolResult: result.status,
    speechSource: result.speechSource,
    violations,
    timings,
    skipped: result.skipped,
    shouldCommit: result.shouldCommit,
  });
  emitGoalTurnTrace(trace);

  return { ...result, trace, invariantBlocked };
}
