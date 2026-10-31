/**
 * Fase 3 — classificação única do turno de meta.
 * Não muta rascunho: só produz GoalTurnIntent para o motor executar.
 *
 * Prioridade (primeira vitória): inspeção → afirmação contextual → valor →
 * caminho → pedido de save → montagem → neutro.
 */
import {
  hasProposalAwaitingAccept,
  looksLikeProceedToSaveOffer,
  looksLikeRequestSave,
  resolveGoalAffirmationRole,
  resolveGoalValueDecision,
  type GoalAffirmationRole,
  type GoalValueDecision,
} from "./goalContract";
import {
  looksLikeAskGroupWeightAdvice,
  looksLikeChooseFreshPath,
  looksLikeChooseRecommendedPath,
  looksLikeExplicitConfigCopy,
  looksLikeInspectGoalDraft,
  parseGoalAssemblyPath,
  parseGoalTarget,
  type GoalAssemblyPath,
  type GoalDraft,
} from "./goalDraft";
import type { GoalOpIntent } from "./goalOpIntent";

export type GoalTurnIntentKind =
  | "inspect"
  | "confirm_save"
  | "acknowledge_copy"
  | "clarify_choice"
  | "accept_value"
  | "consult_value"
  | "select_path"
  | "request_save"
  | "agree_no_op"
  | "unknown";

export type GoalTurnIntent = {
  kind: GoalTurnIntentKind;
  /** Caminho de montagem quando kind=select_path. */
  path: GoalAssemblyPath | null;
  affirmation: GoalAffirmationRole;
  value: GoalValueDecision | null;
  /** Mês de origem (YYYY-MM) quando a intenção é copiar/referenciar. */
  originMonth: string | null;
  /** Se o motor pode mutar o rascunho neste turno. */
  mutates: boolean;
  reason: string;
};

function emptyIntent(
  partial: Partial<GoalTurnIntent> & Pick<GoalTurnIntent, "kind" | "reason">,
): GoalTurnIntent {
  return {
    path: null,
    affirmation: "none",
    value: null,
    originMonth: null,
    mutates: false,
    ...partial,
  };
}

/** Cópia/origem via GoalOpIntent (estrutural ou LLM) — sem regex nova no detector de path. */
function originCopyFromOp(op: GoalOpIntent | null | undefined): {
  wantsCopy: boolean;
  originMonth: string | null;
} {
  if (!op) return { wantsCopy: false, originMonth: null };
  const wantsCopy =
    op.authorizeApply === true &&
    (op.entity === "period_origin" || op.periodRole === "origin") &&
    op.kind !== "question" &&
    op.kind !== "inspect";
  return { wantsCopy, originMonth: wantsCopy ? op.periodMonth : null };
}

/**
 * Classifica o turno: uma intenção operacional validada.
 * Alias público pedido na Fase 3: `classifyTurn`.
 */
export function classifyGoalTurn(opts: {
  message: string;
  draft: GoalDraft | null;
  historyOrJarvis?: string | null;
  opIntent?: GoalOpIntent | null;
  utteredAmount?: number | null;
}): GoalTurnIntent {
  const text = opts.message.trim();
  const draft = opts.draft;
  const utteredAmount =
    opts.utteredAmount !== undefined ? opts.utteredAmount : parseGoalTarget(text);

  // 1) Inspeção / consulta de pesos — nunca muta nem compete com afirmação.
  if (looksLikeInspectGoalDraft(text) || looksLikeAskGroupWeightAdvice(text)) {
    return emptyIntent({
      kind: "inspect",
      reason: "inspect_draft",
      mutates: false,
    });
  }
  if (
    opts.opIntent &&
    (opts.opIntent.kind === "inspect" ||
      (opts.opIntent.kind === "question" && opts.opIntent.entity === "ladder")) &&
    opts.opIntent.authorizeApply !== true
  ) {
    return emptyIntent({
      kind: "inspect",
      reason: opts.opIntent.notes ?? "op_inspect",
      mutates: false,
    });
  }

  // 2) Afirmação contextual — um papel só, derivado do estado pendente.
  const affirmation = resolveGoalAffirmationRole({
    text,
    draft,
    historyOrJarvis: opts.historyOrJarvis ?? null,
  });
  if (affirmation === "confirm_save") {
    return emptyIntent({
      kind: "confirm_save",
      affirmation,
      reason: "pending_commit_confirm",
      mutates: true,
    });
  }
  if (affirmation === "clarify_choice") {
    return emptyIntent({
      kind: "clarify_choice",
      affirmation,
      reason: "ambiguous_prompt",
      mutates: false,
    });
  }
  if (affirmation === "acknowledge_copy") {
    return emptyIntent({
      kind: "acknowledge_copy",
      affirmation,
      reason: "ack_copy_no_save",
      mutates: false,
    });
  }

  // 3) Decisão de valor (GoalValueStance só aqui — não disputa mount/save).
  const proposalAwaiting = draft
    ? hasProposalAwaitingAccept({
        form: { target: draft.form.target },
        proposedTarget: draft.proposedTarget ?? null,
      })
    : false;
  const value = resolveGoalValueDecision({
    text,
    utteredAmount,
    proposedTarget: draft?.proposedTarget ?? null,
    proposalAwaiting,
    saveAwaiting: draft?.pendingCommit?.awaitingConfirm === true,
    scenarios: draft?.proposal?.scenarios ?? null,
  });

  if (value.keepDiscussing) {
    return emptyIntent({
      kind: "consult_value",
      value,
      reason: `value_${value.stance}`,
      mutates: false,
    });
  }

  // 4) Caminho de montagem — detectors existentes + origem semântica do opIntent.
  // Frase composta (“copiar outubro, meta 420 mil”) = select_path com value anexado
  // (uma intenção; o motor aplica path + valor sem segunda classificação).
  const pathChoice = parseGoalAssemblyPath(text);
  const origin = originCopyFromOp(opts.opIntent);
  const wantsCopyPath =
    pathChoice === "copy" || looksLikeExplicitConfigCopy(text) || origin.wantsCopy;
  const valueAnnex =
    value.applySource !== "none" && value.applyAmount != null ? value : null;
  if (wantsCopyPath) {
    return emptyIntent({
      kind: "select_path",
      path: "copy",
      value: valueAnnex,
      originMonth: origin.originMonth,
      reason: origin.wantsCopy && pathChoice !== "copy" ? "op_origin_copy" : "path_copy",
      mutates: true,
    });
  }
  if (pathChoice === "recommended" || looksLikeChooseRecommendedPath(text)) {
    return emptyIntent({
      kind: "select_path",
      path: "recommended",
      value: valueAnnex,
      reason: "path_recommended",
      mutates: true,
    });
  }
  if (pathChoice === "fresh" || looksLikeChooseFreshPath(text)) {
    return emptyIntent({
      kind: "select_path",
      path: "fresh",
      value: valueAnnex,
      reason: "path_fresh",
      mutates: true,
    });
  }

  if (valueAnnex) {
    return emptyIntent({
      kind: "accept_value",
      value: valueAnnex,
      reason: `apply_${valueAnnex.applySource}`,
      mutates: true,
    });
  }

  // 5) Pedido explícito de gravação / avançar para oferta de save.
  if (looksLikeRequestSave(text) || looksLikeProceedToSaveOffer(text)) {
    return emptyIntent({
      kind: "request_save",
      reason: looksLikeRequestSave(text) ? "request_save" : "proceed_save_offer",
      mutates: true,
    });
  }

  // 6) Afirmação solta sem decisão pendente — concordar sem mutar.
  if (opts.opIntent?.kind === "confirmation" || affirmation === "none") {
    const bare =
      opts.opIntent?.notes === "bare_affirmation" ||
      /^(sim|pode|ok|fechado|isso|pode ser|vamos nessa)([!.?…]*)$/i.test(text.trim());
    if (bare && !proposalAwaiting && !draft?.pendingCommit?.awaitingConfirm) {
      return emptyIntent({
        kind: "agree_no_op",
        affirmation: "none",
        reason: "bare_agree_no_pending",
        mutates: false,
      });
    }
  }

  return emptyIntent({
    kind: "unknown",
    value,
    reason: "fallback",
    mutates: false,
  });
}

/** Nome canônico da Fase 3. */
export const classifyTurn = classifyGoalTurn;
