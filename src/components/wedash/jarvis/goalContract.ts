/**
 * Contrato P0: proposta ≠ rascunho aplicado ≠ autorização de gravação.
 * Mutação financeira e commit só por operações determinísticas.
 */
import { brlCent, monthYearTitle } from "@/lib/format";
import { buildGoalConfigSnapshot, simulateLevelAtStoreTarget } from "./goalConfigIntel";
import type { GoalDraft, GoalDraftForm } from "./goalDraft";

export type GoalPendingCommit = {
  versionId: string;
  fingerprint: string;
  target: number;
  summary: string;
  /** Pediu gravação; ainda falta o "sim" desta versão. */
  awaitingConfirm: boolean;
  /** Gestor confirmou esta versão — único sinal que autoriza saveGoal. */
  authorized: boolean;
  presentedAt: string;
};

export type GoalLastSave = {
  id: string;
  target: number;
  name: string;
  at: string;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Impressão digital do que será gravado — muda → invalida confirmação. */
export function goalDraftFingerprint(form: GoalDraftForm): string {
  return JSON.stringify({
    storeId: form.storeId,
    startsOn: form.startsOn,
    endsOn: form.endsOn,
    target: form.target,
    tierMode: form.tierMode,
    spreadUnidentified: form.spreadUnidentified,
    managerOn: form.managerOn,
    tiers: form.tiers.map((t) => ({
      name: t.name,
      minAttainmentPct: t.minAttainmentPct,
      commissionPct: t.commissionPct,
      bonus: t.bonus,
      managerPct: t.managerPct ?? null,
      managerBonus: t.managerBonus ?? null,
    })),
    groups: form.groups.map((g) => ({ shiftId: g.shiftId, name: g.name, pct: g.pct })),
  });
}

export function newCommitVersionId(): string {
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Resumo apresentado ao Gestor antes da confirmação de gravação. */
export function buildCommitSummary(draft: GoalDraft, storeName: string): string {
  const form = draft.form;
  const dest = form.startsOn ? monthYearTitle(form.startsOn) : "?";
  const alvo = form.target != null ? brlCent(form.target) : "?";
  const nome = form.name?.trim() || (form.startsOn ? `Meta ${dest}` : "Meta");
  const snap = buildGoalConfigSnapshot(form, form.target);
  const groups =
    snap.groups.length > 0
      ? snap.groups.map((g) => `${g.name} ${g.pct}%`).join(" / ")
      : "sem grupos";
  const levels = snap.levels
    .map((l) => `${l.name} ${l.minAttainmentPct}%/${l.commissionPct}%`)
    .join(" · ");
  return (
    `Posso salvar essa configuração como rascunho?\n\n` +
    `· Nome: ${nome}\n` +
    `· Filial: ${storeName || form.storeId}\n` +
    `· Período: ${dest}\n` +
    `· Valor: ${alvo}\n` +
    `· Grupos: ${groups}\n` +
    `· Níveis: ${levels}\n\n` +
    `Se mudar qualquer coisa depois, peço confirmação de novo.`
  );
}

/** Mensagem pós-save — só com dados reais do backend (sem UUID na fala). */
export function speakGoalSavedSuccess(opts: {
  name: string;
  target: number;
  asDraft?: boolean;
}): string {
  const status = opts.asDraft !== false ? "rascunho" : "meta publicada";
  return (
    `Pronto — salvei “${opts.name}” como ${status}, com valor ${brlCent(opts.target)}.\n\n` +
    `Você pode revisar e publicar quando quiser.`
  );
}

export function createPendingCommit(draft: GoalDraft, storeName: string): GoalPendingCommit {
  const fingerprint = goalDraftFingerprint(draft.form);
  return {
    versionId: newCommitVersionId(),
    fingerprint,
    target: draft.form.target!,
    summary: buildCommitSummary(draft, storeName),
    awaitingConfirm: true,
    authorized: false,
    presentedAt: new Date().toISOString(),
  };
}

/** Qualquer mutação do form invalida autorização pendente. */
export function clearPendingCommit(draft: GoalDraft): GoalDraft {
  if (!draft.pendingCommit) return draft;
  return { ...draft, pendingCommit: null };
}

export function pendingCommitStillValid(draft: GoalDraft): boolean {
  const p = draft.pendingCommit;
  if (!p || draft.form.target == null) return false;
  return p.fingerprint === goalDraftFingerprint(draft.form);
}

/** Há proposta do motor ainda não aplicada no rascunho. */
export function hasProposalAwaitingAccept(draft: {
  form: { target: number | null };
  proposedTarget?: number | null;
}): boolean {
  return draft.proposedTarget != null && draft.form.target !== draft.proposedTarget;
}

export function looksLikeRequestSave(text: string): boolean {
  const p = norm(text).trim();
  return (
    /salva(r)? (o )?rascunho|grava(r)? (o )?rascunho|pode (salvar|gravar)|autorizo|pode montar|monta (o )?rascunho|cria (a )?meta|vamos (criar|montar|gravar|salvar)|ok pode/.test(
      p,
    ) || /^(salva|grava|autorizo)(\b|,|$)/.test(p)
  );
}

/**
 * Gestor quer avançar para o resumo de gravação (sem necessariamente dizer “salvar”).
 * Ex.: “pode seguir”, “vamos seguir”, “fechado”, “próximo”.
 */
export function looksLikeProceedToSaveOffer(text: string): boolean {
  const p = norm(text).trim();
  if (/nao|não|espera|cancela|ainda nao|ainda não/.test(p)) return false;
  if (looksLikeRequestSave(text)) return true;
  return (
    /^(pode seguir|vamos seguir|seguir|segue|fechado|bora|proximo|próximo|pode ir|vamos)([!.?…]*)$/.test(
      p,
    ) ||
    /pode seguir|vamos seguir|segue (ai|aí|com isso)|pode (ir|avancar|avançar)|vamos (pro|para o) (resumo|rascunho)/.test(
      p,
    )
  );
}

/** Afirmação natural curta (contexto decide se é aceite de proposta ou de gravação). */
export function looksLikeNaturalAffirmation(text: string): boolean {
  const p = norm(text).trim();
  if (!p || looksLikeRequestSave(text)) return false;
  if (/^(nao|não)\b/.test(p)) return false;
  if (/outra|diferente|muda o valor|troca o valor|nao quero|não quero|deixar|peso|turno|grupo|\d+\s*%/.test(p)) {
    return false;
  }
  // Frases curtas / naturais — “pode ser”, “vamos nessa”, “fechado”, “sim”…
  if (p.length > 48) return false;
  return (
    /^(sim|pode|ok|fechado|isso|essa|esse|beleza|show|perfeito|combinado|fechou|bora|topa)([!.?…]*)$/.test(
      p,
    ) ||
    /^(pode ser|vamos nessa|vamos nisso|vamos com essa|vamos com isso|fechado nessa|fechado nisso|pode ficar|fica assim|pode aplicar|aplica isso|aplica esse)([!.?…]*)$/.test(
      p,
    ) ||
    /^(sim|pode|ok|fechado|isso)[,!]?\s+(pode ser|vamos|fechado|isso)\s*[!.?…]*$/.test(p)
  );
}

/** Aceite explícito da recomendação (formulações longas + naturais). */
export function looksLikeAcceptProposal(text: string): boolean {
  const p = norm(text).trim();
  if (/^(nao|não)\b/.test(p)) return false;
  if (/outra|diferente|muda o valor|troca o valor/.test(p) && !/nao precisa|não precisa/.test(p)) {
    return false;
  }
  if (looksLikeNaturalAffirmation(text)) return true;
  return /aceito (a |o )?(proposta|recomend|valor|meta)|vamos (de |com )?(a )?recomend|fica a recomend|pode (ser|ficar) (a |o )?(recomend|proposta)|fechado (nessa|nessa faixa|no valor)|quero (a |o )?recomend|aplica (a |o )?recomend|usa (a |o )?recomend|vamos com (essa|esse|a recomend|o valor)|aplica esse valor|quero esse valor|fica (nesse|com )?(esse )?valor|aplica (esse |o )?valor|mesma faixa|seguir a (mesma )?faixa|seguir a recomend|vamos (na|com a) (mesma )?faixa|topa a recomend/.test(
    p,
  );
}

/**
 * Aceita a proposta pendente com linguagem natural.
 * Nunca se `saveAwaiting` — nesse caso o SIM é da gravação, não do valor.
 * Aceitar proposta NUNCA autoriza gravação.
 */
export function looksLikeAcceptPendingProposal(
  text: string,
  proposalAwaiting: boolean,
  saveAwaiting: boolean,
): boolean {
  if (!proposalAwaiting || saveAwaiting) return false;
  if (looksLikeRequestSave(text)) return false;
  return looksLikeAcceptProposal(text);
}

/** @deprecated use looksLikeAcceptPendingProposal */
export function looksLikeAcceptProposalBare(text: string, hasProposed: boolean): boolean {
  return looksLikeAcceptPendingProposal(text, hasProposed, false);
}

/**
 * Confirmação natural da gravação — só vale com pendingCommit.awaitingConfirm.
 * Exemplos: Sim, Pode, Fechado, Confirmo, Isso, Vamos nessa.
 * “Pode salvar” / “salvar rascunho” entram via looksLikeRequestSave no motor (quando awaiting).
 */
export function looksLikeConfirmPendingSave(text: string): boolean {
  const p = norm(text).trim();
  if (!p || p.length > 64) return false;
  if (/nao|não|espera|ainda nao|ainda não|cancela|outra|diferente|muda|troca/.test(p)) {
    return false;
  }
  if (looksLikeNaturalAffirmation(text)) return true;
  return (
    /^(sim|ok|fechado|autorizo|confirma|confirmo|pode|isso|essa|esse|beleza|combinado|fechou|bora|topa)([!.?…]*)$/.test(
      p,
    ) ||
    /^(pode ser|vamos nessa|vamos nisso|confirmo|pode ficar|isso mesmo)([!.?…]*)$/.test(p)
  );
}

/** Simular níveis com outro R$ — sem mutar o rascunho. */
export function looksLikeSimulateLevelsAtAmount(text: string): boolean {
  const p = norm(text).trim();
  return (
    /como (ficaria|ficariam|fica|ficam).{0,40}(nivel|niveis|escada)/.test(p) ||
    /(nivel|niveis|escada).{0,40}(com|a|se ).{0,20}(r\$|mil)/.test(p) ||
    /simula.{0,20}(nivel|niveis|escada|meta)/.test(p)
  );
}

export function looksLikeValueInconsistency(text: string): boolean {
  const p = norm(text).trim();
  return (
    /(suger|falou|disse|anunci|recomend).{0,48}(mas|e )?(salv|grav|esta|está|ficou|meta).{0,24}(r\$|\d)/.test(
      p,
    ) ||
    /(salv|grav).{0,24}(diferente|errado|outra)|diverg|inconsist|nao (foi|eh|é) (o|esse) valor|voce falou.{0,40}mas/.test(
      p,
    )
  );
}

export function speakValueInconsistency(draft: GoalDraft): string {
  const applied = draft.form.target != null ? brlCent(draft.form.target) : "nenhum valor aplicado";
  const proposed =
    draft.proposedTarget != null
      ? brlCent(draft.proposedTarget)
      : draft.proposal?.scenarios.find((s) => s.kind === "recommended")?.amount != null
        ? brlCent(draft.proposal.scenarios.find((s) => s.kind === "recommended")!.amount)
        : null;
  const saved = draft.lastSave
    ? `${brlCent(draft.lastSave.target)} (“${draft.lastSave.name}”)`
    : null;

  const lines = [
    `Estado real agora:`,
    `· Valor aplicado no rascunho: ${applied}`,
    proposed != null ? `· Última proposta do motor (ainda não é o rascunho): ${proposed}` : null,
    saved ? `· Último valor gravado nesta conversa: ${saved}` : `· Ainda não gravei rascunho nesta conversa.`,
    ``,
    proposed != null && draft.form.target != null && proposed !== applied
      ? `A proposta ${proposed} só entra no rascunho se você aceitar explicitamente (ex.: “aceito a recomendada”). Enquanto isso, gravação usaria ${applied}.`
      : `Se quiser trocar o valor aplicado, diga o R$ ou aceite a proposta.`,
  ];
  return lines.filter((l) => l != null).join("\n");
}

export function speakSimulateLevels(draft: GoalDraft, amount: number): string {
  const form = draft.form;
  const lines = form.tiers.map((t) => {
    const sim = simulateLevelAtStoreTarget(amount, t);
    const b = t.bonus > 0 ? ` · bônus ${brlCent(t.bonus)}` : "";
    return `· ${t.name}: limiar ${brlCent(sim.threshold)} · comissão ilustrativa ${brlCent(sim.commissionAtThreshold)}${b}`;
  });
  const applied = form.target != null ? brlCent(form.target) : "sem valor aplicado";
  return (
    `Simulação com ${brlCent(amount)} (não alterei o rascunho; aplicado continua ${applied}):\n\n` +
    lines.join("\n")
  );
}

export function applyProposedTarget(draft: GoalDraft, amount: number): GoalDraft {
  return {
    ...draft,
    form: { ...draft.form, target: amount },
    proposedTarget: amount,
    userLockedTarget: true,
    pendingCommit: null,
  };
}

export function looksLikeAskValueSuggestionP0(text: string): boolean {
  const p = norm(text);
  return (
    /suger|propor|recomend|ideia de (meta|valor)|quanto (seria|fica|voce|vc)|me (da|dá) (um |uma )?(valor|ideia|numero|número)|pode (suger|calcular|propor|recomend)|basead|historico|histórico|nao sei|não sei|sem ideia|voce sugere|você sugere|valor vc sugere|valor voce sugere|da pra melhorar|da para melhorar|qual valor/.test(
      p,
    )
  );
}
