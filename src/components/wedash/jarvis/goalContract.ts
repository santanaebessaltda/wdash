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

/**
 * Postura semântica sobre o valor da meta (proposta vs rascunho).
 * Um classificador — não uma regex isolada por frase comercial.
 */
export type GoalValueStance =
  | "consultative"
  | "change_proposal"
  | "explicit_accept"
  | "refuse"
  | "counter_amount"
  | "ask_info"
  | "proceed"
  | "neutral";

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

/**
 * Classifica a postura do Gestor sobre o valor — antes de mutar ou avançar etapa.
 * Consultiva / info / alteração ≠ aceite do proposedTarget.
 */
export function classifyGoalValueStance(text: string): GoalValueStance {
  const p = norm(text).trim();
  if (!p) return "neutral";

  const hasAmount = /r\$\s*[\d.]+|\d[\d.]*\s*mil\b/.test(p);

  // Pedido de detalhe antes de decidir.
  if (
    /por que (esse|este|esse valor|essa)|como (voce |vc )?(chegou|calcul|montou)|me (explica|detalha)|mais (detalhe|info|informacao|informação)|de onde (veio|saiu)|mostra (o |a )?(conta|calculo|cálculo|base)|quero (entender|ver) (melhor |mais )?(o |a )?(valor|calculo|cálculo|proposta)/.test(
      p,
    )
  ) {
    return "ask_info";
  }

  // Opinião sobre pesos/turnos não é postura de valor da meta.
  if (
    /(peso|pesos|turno|turnos|divisao|distribui)/.test(p) &&
    !/(meta|valor|r\$|sobra|folga|aumentar|diminuir)\b/.test(p)
  ) {
    return "neutral";
  }

  // Opinião / estratégia — mesmo citando aumentar/diminuir.
  const asksOpinion =
    /o que (voce|vc) acha|o que acha|voce acha|vc acha|acha (que|melhor)|vale a pena|faz sentido|deveria|me (aconselha|orienta|sugere)|na sua (opiniao|opinião)|concorda|e ai|e aí/.test(
      p,
    ) || /\?\s*$/.test(text.trim()) && /(aument|diminu|subir|baixar|sobra|folga|meio do mes|meio do mês)/.test(p);

  const talksBufferOrAdjust =
    /(sobra|folga|colchao|colchão|folga|buffer|a mais|um pouco mais|um pouco menos|aumentar|diminuir|subir|baixar|reduzir|no meio do mes|no meio do mês|se precisar)/.test(
      p,
    );

  if (asksOpinion || (talksBufferOrAdjust && !hasAmount && !looksLikeNaturalAffirmation(text))) {
    // “quero 260 mil” é contraproposta; “queria sobra, o que acha?” é consultiva.
    if (hasAmount && /(quero|vamos de|fica|deixar|meta de|colocar)\b/.test(p) && !asksOpinion) {
      return "counter_amount";
    }
    if (asksOpinion || /\?\s*$/.test(text.trim()) || /o que (voce|vc) acha|acha\??/.test(p)) {
      return "consultative";
    }
    if (talksBufferOrAdjust) return "change_proposal";
  }

  if (
    /nao quero (essa|esse|a recomend|a proposta)|outra (faixa|proposta|valor)|muito (alto|baixa|baixo)|discordo|prefiro outra|nao topa|não topa/.test(
      p,
    )
  ) {
    return "refuse";
  }

  if (hasAmount && /(quero|vamos de|fica|deixar|meta de|coloca[r]?|definir)\b/.test(p)) {
    return "counter_amount";
  }

  // Aceite explícito / referência contextual à proposta — antes de “pode seguir”.
  // Ex.: “Gostei dessa última proposta. Vamos com ela.” (sem repetir o R$).
  if (looksLikeNaturalAffirmation(text)) return "explicit_accept";
  if (
    /aceito (a |o )?(proposta|recomend|valor|meta)|vamos (de |com )?(a )?recomend|fica a recomend|pode (ser|ficar) (a |o )?(recomend|proposta)|fechado (nessa|nessa faixa|no valor)|quero (a |o )?recomend|aplica (a |o )?recomend|usa (a |o )?recomend|vamos com (essa|esse|ela|ele|isso|a recomend|o valor|a proposta)|aplica esse valor|quero esse valor|fica (nesse|com )?(esse |ela |isso )?valor|aplica (esse |o )?valor|mesma faixa|seguir a (mesma )?faixa|seguir a recomend|vamos (na|com a) (mesma )?faixa|topa a recomend|vamos de (a )?conservador|vamos de (a )?desafiad|prefiro a (conservador|recomend|desafiad)|aceito a (conservador|recomend|desafiad)/.test(
      p,
    ) ||
    /gostei (dessa|desta|da|desse|deste)|essa (ultima|última )?proposta|aquela proposta|a (ultima|última )proposta|topa (essa|isso|ela|a proposta)|fica (com |nessa |com essa )?(ela|isso|essa|a proposta)|quero (essa|ela|isso|a proposta)|pode (ser|ficar) (essa|ela|isso)|fechado (nessa|com essa|com ela)/.test(
      p,
    )
  ) {
    return "explicit_accept";
  }

  if (looksLikeProceedToSaveOffer(text)) {
    return "proceed";
  }

  return "neutral";
}

/** Aceite explícito da recomendação (formulações longas + naturais). */
export function looksLikeAcceptProposal(text: string): boolean {
  return classifyGoalValueStance(text) === "explicit_accept";
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
  return classifyGoalValueStance(text) === "explicit_accept";
}

/** Cenário nomeado na fala (conservadora / recomendada / desafiadora). */
export function parseNamedGoalScenario(
  text: string,
): "conservative" | "recommended" | "challenging" | null {
  const p = norm(text).trim();
  if (/conservador/.test(p)) return "conservative";
  if (/desafiad/.test(p)) return "challenging";
  if (/recomendad|mesma faixa|faixa recomend/.test(p)) return "recommended";
  return null;
}

/**
 * Decisão única de valor para o motor (`discussGoal`).
 * Stance interpreta; o motor só aplica o que esta decisão autoriza.
 *
 * - `uttered` → R$ na fala do Gestor (nunca amountCents inventado pelo LLM)
 * - `pending_proposal` / `named_scenario` → aceite validado da proposta pendente
 * - `none` + `keepDiscussing` → consultiva/info (sem mutar)
 */
export type GoalValueApplySource = "uttered" | "pending_proposal" | "named_scenario" | "none";

export type GoalValueDecision = {
  stance: GoalValueStance;
  utteredAmount: number | null;
  namedScenario: "conservative" | "recommended" | "challenging" | null;
  applySource: GoalValueApplySource;
  /** Valor a promover a form.target neste turno (se applySource ≠ none). */
  applyAmount: number | null;
  /** Permanecer na etapa de valor (consultiva / info / alteração sem R$). */
  keepDiscussing: boolean;
};

export function resolveGoalValueDecision(opts: {
  text: string;
  utteredAmount: number | null;
  proposedTarget: number | null;
  proposalAwaiting: boolean;
  saveAwaiting: boolean;
  scenarios?: { kind: string; amount: number }[] | null;
}): GoalValueDecision {
  const stance = classifyGoalValueStance(opts.text);
  const namedScenario = parseNamedGoalScenario(opts.text);
  const scenarioAmount =
    namedScenario != null && opts.scenarios?.length
      ? (opts.scenarios.find((s) => s.kind === namedScenario)?.amount ?? null)
      : null;

  const keepDiscussing =
    stance === "consultative" ||
    stance === "ask_info" ||
    (stance === "change_proposal" && opts.utteredAmount == null);

  if (keepDiscussing) {
    return {
      stance,
      utteredAmount: opts.utteredAmount,
      namedScenario,
      applySource: "none",
      applyAmount: null,
      keepDiscussing: true,
    };
  }

  // Aceite: cenário nomeado tem prioridade sobre a recomendada genérica.
  if (
    stance === "explicit_accept" &&
    scenarioAmount != null &&
    !opts.saveAwaiting
  ) {
    return {
      stance,
      utteredAmount: opts.utteredAmount,
      namedScenario,
      applySource: "named_scenario",
      applyAmount: scenarioAmount,
      keepDiscussing: false,
    };
  }

  // Aceite contextual da proposta pendente — sem exigir R$ na fala.
  if (
    stance === "explicit_accept" &&
    opts.proposalAwaiting &&
    opts.proposedTarget != null &&
    !opts.saveAwaiting &&
    !looksLikeRequestSave(opts.text)
  ) {
    return {
      stance,
      utteredAmount: opts.utteredAmount,
      namedScenario,
      applySource: "pending_proposal",
      applyAmount: opts.proposedTarget,
      keepDiscussing: false,
    };
  }

  // Contraproposta / R$ explícito na fala.
  if (
    opts.utteredAmount != null &&
    stance !== "refuse" &&
    (stance === "counter_amount" || stance === "neutral" || stance === "proceed" || stance === "explicit_accept")
  ) {
    return {
      stance,
      utteredAmount: opts.utteredAmount,
      namedScenario,
      applySource: "uttered",
      applyAmount: opts.utteredAmount,
      keepDiscussing: false,
    };
  }

  return {
    stance,
    utteredAmount: opts.utteredAmount,
    namedScenario,
    applySource: "none",
    applyAmount: null,
    keepDiscussing: false,
  };
}

/**
 * Resposta consultiva sobre valor — não muta rascunho nem avança etapa.
 */
export function speakConsultativeTargetAdvice(opts: {
  utterance: string;
  proposed: number | null;
  applied: number | null;
  challenging?: number | null;
  conservative?: number | null;
  seasonalSummary?: string | null;
  rationale?: string | null;
}): string {
  const p = norm(opts.utterance);
  const base = opts.proposed ?? opts.applied;
  const baseLabel = base != null ? brlCent(base) : null;
  const wantsUp = /(aument|subir|sobra|folga|a mais|mais alto|colchao|colchão)/.test(p);
  const wantsDown = /(diminu|baixar|reduzir|abaixar|mais baixo)/.test(p);
  const midMonth = /meio do mes|meio do mês|no meio/.test(p);

  const lines: string[] = [];
  if (wantsUp && baseLabel) {
    const chal = opts.challenging != null ? brlCent(opts.challenging) : null;
    lines.push(
      `Faz sentido pensar numa sobra em cima de ${baseLabel}: dá folga se a Black Friday ou o ritmo vierem mais fortes.`,
    );
    lines.push(
      `O risco é a equipe sentir a meta inflada e desanimar se o mês abrir fraco. ` +
        (chal
          ? `Se quiser folga já no número, a faixa desafiadora fica em ${chal}.`
          : `Se quiser folga, me diga quanto a mais (ex.: +5% ou um R$).`),
    );
  } else if (wantsDown && baseLabel) {
    const cons = opts.conservative != null ? brlCent(opts.conservative) : null;
    lines.push(
      `Reduzir em relação a ${baseLabel} protege o moral da equipe se o mês vier apertado.`,
    );
    lines.push(
      `O risco é deixar dinheiro na mesa se a sazonalidade puxar forte. ` +
        (cons ? `A faixa conservadora fica em ${cons}.` : `Se quiser baixar, me diga o R$.`),
    );
  } else if (baseLabel) {
    lines.push(
      `Sobre ${baseLabel}: é a faixa que eu trabalharia com o histórico e o calendário que temos.`,
    );
  } else {
    lines.push(`Ainda não fechei um número no rascunho — posso te dar uma proposta fundamentada.`);
  }

  if (midMonth) {
    lines.push(
      `Ajustar no meio do mês é válido: começa com uma base sólida e revisa com o realizado das primeiras semanas, sem travar a loja agora.`,
    );
  }

  if (opts.seasonalSummary?.trim()) {
    lines.push(`Calendário no cálculo: ${opts.seasonalSummary.trim()}.`);
  } else if (opts.rationale?.trim()) {
    lines.push(`Base: ${opts.rationale.trim()}.`);
  }

  lines.push(
    `Isso é só opinião — não apliquei nada no rascunho. Quer manter a proposta, subir/baixar com um R$, ou ver outro cenário?`,
  );
  return lines.join("\n\n");
}

/** Pedido de mais detalhe sobre a proposta — sem mutar. */
export function speakProposalMoreInfo(opts: {
  proposed: number | null;
  rationale?: string | null;
  seasonalSummary?: string | null;
  evidenceLabels?: string[];
}): string {
  const head =
    opts.proposed != null
      ? `A proposta ${brlCent(opts.proposed)} ainda não está no rascunho.`
      : `Ainda não há proposta de valor neste fio.`;
  const bits: string[] = [head];
  if (opts.rationale?.trim()) bits.push(`Como cheguei: ${opts.rationale.trim()}.`);
  if (opts.seasonalSummary?.trim()) bits.push(`Sazonal: ${opts.seasonalSummary.trim()}.`);
  if (opts.evidenceLabels?.length) {
    bits.push(`Evidências: ${opts.evidenceLabels.slice(0, 4).join("; ")}.`);
  }
  bits.push(`Quer aceitar essa faixa, escolher outro cenário, ou mandar o R$ que prefere?`);
  return bits.join("\n\n");
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

/**
 * Papel de uma afirmação curta — derivado do ESTADO pendente, não de regex isolada.
 * Uma interpretação por turno; o motor aplica no máximo um efeito.
 */
export type GoalAffirmationRole =
  | "confirm_save"
  | "acknowledge_copy"
  | "clarify_choice"
  | "none";

/** Última fala do JARVIS no blob de histórico (se houver). */
export function lastJarvisUtterance(text: string): string | null {
  if (!/jarvis:/i.test(text)) return null;
  const parts = text.split(/\n(?=user:|jarvis:)/i).filter((p) => /^jarvis:/i.test(p.trim()));
  const last = parts[parts.length - 1];
  if (!last) return null;
  return last.replace(/^jarvis:\s*/i, "").trim() || null;
}

/** Resumo inequívoco de gravação já apresentado (“Posso salvar…?”). */
export function looksLikeSaveConfirmPrompt(text: string | null | undefined): boolean {
  if (!text) return false;
  const p = norm(text);
  return /posso salvar|salvar essa configura|como rascunho\?/.test(p);
}

/**
 * Oferta com duas (ou mais) alternativas — “Sim” isolado não escolhe.
 * Ex.: revisar ou salvar; olhar níveis ou seguir.
 */
export function looksLikeAmbiguousChoicePrompt(text: string | null | undefined): boolean {
  if (!text) return false;
  const p = norm(text);
  if (looksLikeSaveConfirmPrompt(text) && !/\bou\b/.test(p)) return false;
  return (
    /\bou\b/.test(p) &&
    /(revis|olhar|nivel|niveis|grupo|premia|bonus|bônus|salva|grav|seguir|seguimos)/.test(p)
  );
}

/**
 * Resolve o que um “Sim/Pode/…” pode fazer neste estado.
 * Não autoriza gravação sem pendingCommit.awaitingConfirm + fingerprint válido.
 */
export function resolveGoalAffirmationRole(opts: {
  text: string;
  draft: {
    copyStatus?: "ok" | "failed" | null;
    assembly?: { path?: string | null; confirmedMount?: boolean } | null;
    pendingCommit?: GoalPendingCommit | null;
    form: GoalDraftForm;
  } | null;
  /** Blob completo ou só a última fala do JARVIS. */
  historyOrJarvis?: string | null;
}): GoalAffirmationRole {
  const { text, draft } = opts;
  if (!draft) return "none";
  if (!looksLikeConfirmPendingSave(text) && !looksLikeRequestSave(text)) return "none";

  const jarvis =
    opts.historyOrJarvis && /jarvis:/i.test(opts.historyOrJarvis)
      ? lastJarvisUtterance(opts.historyOrJarvis)
      : (opts.historyOrJarvis ?? null);

  const awaiting =
    draft.pendingCommit?.awaitingConfirm === true &&
    pendingCommitStillValid({
      form: draft.form,
      pendingCommit: draft.pendingCommit,
    } as GoalDraft);

  if (awaiting) {
    // “Quer revisar ou salvar?” com pending aberto → Sim não basta.
    if (looksLikeAmbiguousChoicePrompt(jarvis) && !looksLikeSaveConfirmPrompt(jarvis)) {
      return "clarify_choice";
    }
    return "confirm_save";
  }

  // Pós-cópia sem resumo de gravação: afirmação só reconhece / reapresenta o estado.
  if (
    draft.copyStatus === "ok" &&
    draft.assembly?.path === "copy" &&
    !draft.pendingCommit?.awaitingConfirm
  ) {
    if (looksLikeAmbiguousChoicePrompt(jarvis)) return "clarify_choice";
    if (looksLikeConfirmPendingSave(text) && !looksLikeRequestSave(text)) {
      return "acknowledge_copy";
    }
  }

  // Sem decisão pendente: afirmação isolada não muta.
  return "none";
}

export function speakClarifyGoalChoice(): string {
  return (
    `Não ficou claro o que você quer.\n\n` +
    `Diga objetivamente: revisar a configuração (níveis, grupos ou premiação) ou salvar o rascunho.`
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
  // Aceite da recomendada ≠ pedido de nova sugestão.
  if (
    /aceito (a |o )?(proposta|recomend)|topa a recomend|vamos (de |com )?(a )?recomend|aplica (a |o )?recomend/.test(
      p,
    )
  ) {
    return false;
  }
  return (
    /suger|propor|recomend|ideia de (meta|valor)|quanto (seria|fica|voce|vc)|me (da|dá) (um |uma )?(valor|ideia|numero|número)|pode (suger|calcular|propor|recomend)|basead|historico|histórico|nao sei|não sei|sem ideia|voce sugere|você sugere|valor vc sugere|valor voce sugere|da pra melhorar|da para melhorar|qual valor|estudar|melhor (meta|valor)|analisar (as )?vendas|definir (a |o )?(melhor )?meta|chegar (n|num)a (melhor )?meta/.test(
      p,
    )
  );
}

/** LLM ofereceu salvar/copiar config sem o rascunho estar pronto para isso. */
export function looksLikePrematureSaveOffer(text: string): boolean {
  const p = norm(text);
  return /posso salvar|salvar (a |o )?(mesma )?configura|mesma configura[cç][aã]o como rascunho|grava(r)? (o )?rascunho (igual|igualzinho|da mesma)|copiar (tudo|a config) (pra|para) (essa|esta|a) loja/.test(
    p,
  );
}
