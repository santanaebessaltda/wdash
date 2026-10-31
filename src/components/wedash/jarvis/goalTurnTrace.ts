/**
 * Fase 5 — observabilidade do turno de meta.
 * Trace estruturado + invariantes. Sem mutar comportamento conversacional.
 */
import type { GoalDraft, GoalDraftForm } from "./goalDraft";
import type { GoalTurnIntent, GoalTurnIntentKind } from "./goalTurnIntent";

/** Espelha goalTurnApply — tipagem local evita ciclo de import em runtime. */
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

export type GoalTurnResultStatus =
  | "ok"
  | "failed"
  | "needs_clarify"
  | "consultative"
  | "skipped"
  | "commit_ready";

export type GoalSpeechSource = "motor" | "llm" | null;

export type GoalDraftSnapshot = {
  /** Versão lógica: fingerprint ou hash curto do form. */
  version: string;
  target: number | null;
  tierCount: number;
  tierPcts: number[];
  groupCount: number;
  path: string | null;
  copyStatus: "ok" | "failed" | null;
  originGoalId: string | null;
  originFrom: string | null;
  pendingAwaiting: boolean;
  pendingAuthorized: boolean;
  fingerprint: string | null;
};

export type GoalTurnStageTiming = {
  classifyMs: number;
  executeMs: number;
  invariantMs: number;
  totalMs: number;
};

export type GoalInvariantId =
  | "copy_claim_without_ok"
  | "save_claim_without_success"
  | "consult_mutated_draft"
  | "tiers_changed_without_intent"
  | "commit_without_pending"
  | "commit_fingerprint_mismatch"
  | "duplicate_turn_reexec"
  | "speech_values_diverge"
  | "llm_speech_after_mutation";

export type GoalInvariantViolation = {
  id: GoalInvariantId;
  detail: string;
};

export type GoalTurnTrace = {
  turnId: string;
  sessionKey: string;
  /** Prefixo do tenant — nunca o UUID completo se evitável; aqui hash curto. */
  tenantKey: string;
  /** Prefixo seguro da filial (não PII). */
  storeKey: string;
  intentKind: GoalTurnIntentKind;
  operationRequested: GoalTurnOperation;
  operationExecuted: GoalTurnOperation;
  before: GoalDraftSnapshot;
  after: GoalDraftSnapshot;
  toolResult: GoalTurnResultStatus;
  speechSource: GoalSpeechSource;
  finalStatus: "ok" | "failed" | "invariant_blocked" | "skipped" | "commit_ready" | "consultative";
  timings: GoalTurnStageTiming;
  violations: GoalInvariantViolation[];
  at: string;
};

function shortKey(id: string | null | undefined, n = 8): string {
  if (!id) return "-";
  const t = id.trim();
  if (t.length <= n) return t;
  return t.slice(0, n);
}

/** Fingerprint leve só para trace (não é o pendingCommit). */
export function draftVersionKey(form: GoalDraftForm): string {
  const tiers = form.tiers.map((t) => t.minAttainmentPct).join(",");
  const groups = form.groups.map((g) => `${g.shiftId}:${g.pct}`).join(",");
  return `${form.storeId?.slice(0, 8) ?? ""}|${form.startsOn}|${form.target}|${form.tiers.length}|${tiers}|${groups}`;
}

export function snapshotDraft(draft: GoalDraft | null): GoalDraftSnapshot {
  if (!draft) {
    return {
      version: "empty",
      target: null,
      tierCount: 0,
      tierPcts: [],
      groupCount: 0,
      path: null,
      copyStatus: null,
      originGoalId: null,
      originFrom: null,
      pendingAwaiting: false,
      pendingAuthorized: false,
      fingerprint: null,
    };
  }
  const form = draft.form;
  return {
    version: draftVersionKey(form),
    target: form.target,
    tierCount: form.tiers.length,
    tierPcts: form.tiers.map((t) => t.minAttainmentPct),
    groupCount: form.groups.length,
    path: draft.assembly?.path ?? null,
    copyStatus: draft.copyStatus ?? null,
    originGoalId: draft.copiedFrom?.goalId ? shortKey(draft.copiedFrom.goalId, 12) : null,
    originFrom: draft.copiedFrom?.from ?? null,
    pendingAwaiting: draft.pendingCommit?.awaitingConfirm === true,
    pendingAuthorized: draft.pendingCommit?.authorized === true,
    fingerprint: draft.pendingCommit?.fingerprint
      ? shortKey(draft.pendingCommit.fingerprint, 16)
      : null,
  };
}

function normSpeech(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Fala afirma cópia bem-sucedida. */
export function speechClaimsCopyOk(speech: string | null | undefined): boolean {
  if (!speech) return false;
  const p = normSpeech(speech);
  return (
    /pronto.*troux|copiei a configura|trouxe .{0,40}(nivel|niveis|escada)|configura[cç][aã]o de .{0,20}no rascunho/.test(
      p,
    ) && !/nao consegui|não consegui|falhou|nao achei|não achei|copy_miss|sem meta/.test(p)
  );
}

/** Fala afirma gravação concluída. */
export function speechClaimsSaved(speech: string | null | undefined): boolean {
  if (!speech) return false;
  const p = normSpeech(speech);
  return /salvei|gravei|rascunho salvo|meta salva|pronto.*salvei/.test(p);
}

function tiersEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Invariantes pós-turno. Não altera o motor — só detecta inconsistências.
 */
export function checkGoalTurnInvariants(opts: {
  intent: GoalTurnIntent;
  operation: GoalTurnOperation;
  before: GoalDraftSnapshot;
  after: GoalDraftSnapshot;
  result: {
    speech: string | null;
    speechSource: GoalSpeechSource;
    shouldCommit: boolean;
    skipped: boolean;
    mutates: boolean;
    status: GoalTurnResultStatus;
    allowLlm: boolean;
  };
  /** true se discussGoal retornou skipped por turnId. */
  turnAlreadyApplied?: boolean;
}): GoalInvariantViolation[] {
  const v: GoalInvariantViolation[] = [];
  const { intent, operation, before, after, result } = opts;

  if (speechClaimsCopyOk(result.speech) && after.copyStatus !== "ok") {
    v.push({
      id: "copy_claim_without_ok",
      detail: `speech claims copy but copyStatus=${after.copyStatus ?? "null"}`,
    });
  }

  if (speechClaimsSaved(result.speech) && !result.shouldCommit && after.pendingAuthorized !== true) {
    // Fala de save só é válida após authorizeGoal (Provider) — no motor, shouldCommit
    // com speech null é o caminho certo. Se speech afirma save aqui, é vazamento.
    v.push({
      id: "save_claim_without_success",
      detail: "speech claims save before authorizeGoal success",
    });
  }

  const consultLike =
    intent.kind === "inspect" ||
    intent.kind === "consult_value" ||
    intent.kind === "agree_no_op" ||
    intent.kind === "acknowledge_copy" ||
    intent.kind === "clarify_choice";

  if (consultLike && !opts.turnAlreadyApplied) {
    const targetChanged = before.target !== after.target;
    const tiersChanged = !tiersEqual(before.tierPcts, after.tierPcts);
    if (targetChanged || tiersChanged) {
      // acknowledge_copy / inspect não devem mudar target/tiers
      if (intent.kind === "inspect" || intent.kind === "consult_value" || intent.kind === "agree_no_op") {
        v.push({
          id: "consult_mutated_draft",
          detail: `consultative intent ${intent.kind} changed target/tiers`,
        });
      }
    }
  }

  const tiersChanged = !tiersEqual(before.tierPcts, after.tierPcts);
  if (tiersChanged && !opts.turnAlreadyApplied) {
    const pathAllowsTiers =
      operation === "copy_ladder" ||
      operation === "select_recommended" ||
      operation === "select_fresh" ||
      (intent.kind === "select_path" &&
        (intent.path === "copy" || intent.path === "recommended" || intent.path === "fresh"));
    // accept_value alone must not invent tiers (Fase 2)
    if (operation === "accept_value" && intent.kind === "accept_value" && before.tierCount === 0) {
      if (after.tierCount > 0) {
        v.push({
          id: "tiers_changed_without_intent",
          detail: "accept_value introduced tiers without path",
        });
      }
    } else if (!pathAllowsTiers) {
      if (
        intent.kind === "inspect" ||
        intent.kind === "consult_value" ||
        intent.kind === "confirm_save" ||
        intent.kind === "request_save" ||
        intent.kind === "acknowledge_copy" ||
        intent.kind === "agree_no_op"
      ) {
        v.push({
          id: "tiers_changed_without_intent",
          detail: `tiers changed under intent=${intent.kind} op=${operation}`,
        });
      }
    }
  }

  if (result.shouldCommit) {
    if (!after.pendingAuthorized && !after.pendingAwaiting) {
      // commit_ready exige pending autorizado no draft after
      if (!after.fingerprint) {
        v.push({
          id: "commit_without_pending",
          detail: "shouldCommit without pendingCommit",
        });
      }
    }
  }

  if (result.shouldCommit && after.pendingAuthorized) {
    // Fingerprint curto no snapshot — divergência total só se pending sumiu
    if (!after.fingerprint) {
      v.push({
        id: "commit_fingerprint_mismatch",
        detail: "authorized commit missing fingerprint",
      });
    }
  }

  if (opts.turnAlreadyApplied && result.mutates) {
    v.push({
      id: "duplicate_turn_reexec",
      detail: "same turnId reported mutates=true",
    });
  }

  // Residuo típico do editor (100/120/150/180) na fala quando a cópia real é outra.
  if (
    result.speech &&
    after.copyStatus === "ok" &&
    after.tierPcts.length > 0 &&
    result.speechSource === "motor"
  ) {
    const residual = [120, 150, 180].filter((p) => {
      const re = new RegExp(`\\b${p}\\s*%`);
      return re.test(result.speech!) && !after.tierPcts.includes(p);
    });
    if (residual.length >= 2) {
      v.push({
        id: "speech_values_diverge",
        detail: `speech has editor residual ${residual.join(",")} draft=${after.tierPcts.join(",")}`,
      });
    }
  }

  return v;
}

/** Mensagem segura ao gestor quando invariante bloqueia. */
export function speakInvariantSafe(violations: GoalInvariantViolation[]): string {
  const ids = violations.map((v) => v.id);
  if (ids.includes("copy_claim_without_ok") || ids.includes("speech_values_diverge")) {
    return (
      "Encontrei uma inconsistência entre o que ia dizer e o estado real do rascunho.\n\n" +
      "Não afirmei a cópia. Pode pedir de novo para copiar a configuração, ou me perguntar o que está no rascunho agora."
    );
  }
  if (ids.includes("save_claim_without_success") || ids.includes("commit_without_pending")) {
    return (
      "Não confirmei a gravação porque o rascunho ainda não estava autorizado neste turno.\n\n" +
      "Peça para salvar o rascunho e confirme com Sim na versão apresentada."
    );
  }
  if (ids.includes("consult_mutated_draft") || ids.includes("tiers_changed_without_intent")) {
    return (
      "Detectei uma alteração inesperada no rascunho durante uma consulta.\n\n" +
      "Não avancei com essa mudança. Me diga o que quer ajustar, ou peça o estado atual da meta."
    );
  }
  if (ids.includes("duplicate_turn_reexec")) {
    return "Esta operação já tinha sido aplicada neste turno. O rascunho permanece como está.";
  }
  if (ids.includes("llm_speech_after_mutation")) {
    return (
      "A operação já foi aplicada pelo motor. Usei o estado real do rascunho — " +
      "se quiser, peça os níveis, grupos ou para salvar."
    );
  }
  return (
    "Encontrei um problema de consistência neste turno e preferi não seguir com a resposta anterior.\n\n" +
    "Pode tentar de novo ou me pedir o estado atual do rascunho."
  );
}

export type TraceSink = (trace: GoalTurnTrace) => void;

let sink: TraceSink | null = null;

/** Testes / telemetria: injeta sink. null = console.info padrão. */
export function setGoalTurnTraceSink(next: TraceSink | null): void {
  sink = next;
}

export function emitGoalTurnTrace(trace: GoalTurnTrace): void {
  try {
    if (sink) {
      sink(trace);
      return;
    }
    console.info("[jarvis.goal.trace]", {
      turnId: trace.turnId,
      sessionKey: trace.sessionKey,
      tenantKey: trace.tenantKey,
      storeKey: trace.storeKey,
      intent: trace.intentKind,
      opReq: trace.operationRequested,
      opExec: trace.operationExecuted,
      before: {
        v: trace.before.version,
        target: trace.before.target,
        tiers: trace.before.tierCount,
        pcts: trace.before.tierPcts,
        copy: trace.before.copyStatus,
        origin: trace.before.originFrom,
      },
      after: {
        v: trace.after.version,
        target: trace.after.target,
        tiers: trace.after.tierCount,
        pcts: trace.after.tierPcts,
        copy: trace.after.copyStatus,
        origin: trace.after.originFrom,
        pendingAuth: trace.after.pendingAuthorized,
      },
      tool: trace.toolResult,
      speechSource: trace.speechSource,
      status: trace.finalStatus,
      ms: trace.timings,
      violations: trace.violations.map((x) => x.id),
    });
  } catch {
    /* ignore */
  }
}

export function buildGoalTurnTrace(opts: {
  turnId: string;
  sessionKey?: string;
  tenantId: string;
  storeId: string | null;
  intent: GoalTurnIntent;
  operationRequested: GoalTurnOperation;
  operationExecuted: GoalTurnOperation;
  before: GoalDraftSnapshot;
  after: GoalDraftSnapshot;
  toolResult: GoalTurnResultStatus;
  speechSource: GoalSpeechSource;
  violations: GoalInvariantViolation[];
  timings: GoalTurnStageTiming;
  skipped?: boolean;
  shouldCommit?: boolean;
}): GoalTurnTrace {
  let finalStatus: GoalTurnTrace["finalStatus"] = "ok";
  if (opts.violations.length) finalStatus = "invariant_blocked";
  else if (opts.skipped) finalStatus = "skipped";
  else if (opts.shouldCommit) finalStatus = "commit_ready";
  else if (opts.toolResult === "failed") finalStatus = "failed";
  else if (opts.toolResult === "consultative" || opts.toolResult === "needs_clarify") {
    finalStatus = opts.toolResult === "consultative" ? "consultative" : "ok";
  } else if (opts.toolResult === "skipped") finalStatus = "skipped";
  else if (opts.toolResult === "commit_ready") finalStatus = "commit_ready";

  return {
    turnId: opts.turnId || "no-turn-id",
    sessionKey: opts.sessionKey ?? shortKey(opts.turnId, 12),
    tenantKey: shortKey(opts.tenantId, 8),
    storeKey: shortKey(opts.storeId, 8),
    intentKind: opts.intent.kind,
    operationRequested: opts.operationRequested,
    operationExecuted: opts.operationExecuted,
    before: opts.before,
    after: opts.after,
    toolResult: opts.toolResult,
    speechSource: opts.speechSource,
    finalStatus,
    timings: opts.timings,
    violations: opts.violations,
    at: new Date().toISOString(),
  };
}

/**
 * Invariante Provider: LLM não pode “assumir” mutação do turno.
 * Se mutou e a fala veio do LLM, bloqueia e devolve fala segura.
 */
export function assertLlmSpeechAfterMutation(opts: {
  mutates: boolean;
  speechSource: GoalSpeechSource;
  draft: GoalDraft;
}): { ok: true } | { ok: false; speech: string; violation: GoalInvariantViolation } {
  if (opts.mutates && opts.speechSource === "llm") {
    const violation: GoalInvariantViolation = {
      id: "llm_speech_after_mutation",
      detail: "LLM speech after motor mutation in same turn",
    };
    return { ok: false, speech: speakInvariantSafe([violation]), violation };
  }
  return { ok: true };
}
