import { endOfMonth, startOfMonth } from "@/data/wedash/engine/format";
import type { GoalGroup, Tier } from "@/data/wedash/engine/goalTypes";
import { fetchGoals } from "@/data/wedash/goalsRepo";
import { fetchSalesDayAggs } from "@/data/wedash/salesRepo";
import { brlCent, monthYearTitle } from "@/lib/format";
import {
  friendlyStoreLabel,
  matchStoresInText,
  needsStorePickForWrite,
  speakAskWriteStore,
  type JarvisContext,
  type JarvisStoreRef,
} from "./context";
import { looksLikeGoalLadderTalk } from "./respond";
import {
  detectSeasonalEventMention,
  looksLikeAskSeasonalInclusion,
  seasonalBiasForPeriod,
  speakSeasonalBiasBreakdown,
  speakSeasonalInclusionAnswer,
} from "./seasonalBrief";
import type { TierRevenueProposal } from "./goalOpIntent";
import {
  applyConfigPatternToForm,
  buildGoalConfigSnapshot,
  fetchRecentGoalConfigs,
  inferConfigPatternFromHistory,
  parseGoalCopyIntent,
  suggestGroupWeightsFromSales,
  type ConfigPatternSource,
  type GoalCopyIntent,
} from "./goalConfigIntel";
import {
  clearPendingCommit,
  createPendingCommit,
  hasProposalAwaitingAccept,
  looksLikeAskValueSuggestionP0,
  looksLikeConfirmPendingSave,
  looksLikeProceedToSaveOffer,
  looksLikeRequestSave,
  looksLikeSimulateLevelsAtAmount,
  looksLikeValueInconsistency,
  pendingCommitStillValid,
  resolveGoalValueDecision,
  speakConsultativeTargetAdvice,
  speakProposalMoreInfo,
  speakSimulateLevels,
  speakValueInconsistency,
  type GoalLastSave,
  type GoalPendingCommit,
} from "./goalContract";
import {
  interpretGoalOpStructural,
  planGoalOpFromIntent,
  scrubTechnicalSpeech,
  type GoalOpIntent,
} from "./goalOpIntent";

export type { GoalLastSave, GoalPendingCommit } from "./goalContract";
export { goalDraftFingerprint, pendingCommitStillValid } from "./goalContract";

export type GoalDraftForm = {
  name: string;
  storeId: string;
  startsOn: string | null;
  endsOn: string | null;
  target: number | null;
  tierMode: "INDIVIDUAL" | "GROUP" | "GENERAL";
  spreadUnidentified: boolean;
  /** Escada igual ao default do editor de Metas. */
  tiers: Tier[];
  /** % por grupo (soma 100); vazio = sem rateio por grupo. */
  groups: GoalGroup[];
  managerOn: boolean;
};

/** Caminho de montagem da config — distinto do aceite do valor-alvo. */
export type GoalAssemblyPath = "copy" | "recommended" | "fresh";

/** Checklist antes de gravar o rascunho em Metas — montagem guiada no chat. */
export type GoalAssembly = {
  /** Gestor confirmou o mês (não inferir sozinho e empurrar número). */
  periodConfirmed: boolean;
  /** Já falou valor ou pediu sugestão — aí sim sugerimos/fechamos alvo. */
  valueDiscussed: boolean;
  /**
   * copy = reutiliza config anterior fielmente;
   * recommended = propõe config nova a partir do histórico (não é cópia automática);
   * fresh = gestor monta do zero;
   * null = valor ok, caminho ainda não escolhido.
   */
  path: GoalAssemblyPath | null;
  confirmedGroups: boolean;
  confirmedSpread: boolean;
  confirmedTiers: boolean;
  /** “Pode montar o rascunho?” — obrigatório mesmo após copiar config. */
  confirmedMount: boolean;
};

/** Origem da cópia — nunca confundir com o período de destino da meta nova. */
export type GoalCopiedFrom = {
  goalId: string | null;
  storeId: string;
  from: string;
  to: string;
  name: string;
  tiers: number;
  groups: number;
};

export type GoalDraft = {
  form: GoalDraftForm;
  /** Identifica a operação ativa de montagem (nova a cada filial/meta distinta). */
  operationId?: string;
  /** Janela oferecida (“quer copiar a config do mês X?”); “sim” usa isso. */
  pendingConfigCopy?: { from: string; to: string } | null;
  assembly?: GoalAssembly;
  /** Resultado da última tentativa de copiar escada (ok | failed). */
  copyStatus?: "ok" | "failed" | null;
  /** Meta de origem após cópia ok — estado operacional, não memória de chat. */
  copiedFrom?: GoalCopiedFrom | null;
  /** Idempotência: eager + draft_goal no mesmo turno não reaplicam. */
  lastAppliedTurnId?: string | null;
  /** Gestor falou R$ explícito ou aceitou proposta — form.target é autoritativo. */
  userLockedTarget?: boolean;
  /** Última proposta estruturada do motor (cenários + evidências). NÃO grava sozinha. */
  proposal?: GoalIntelligenceResult | null;
  /** R$ recomendado pelo motor — distinto de form.target até aceite. */
  proposedTarget?: number | null;
  /**
   * Se o Gestor falou R$ como limiar de nível (ex. 260 mil @ 110%),
   * guarda para análises comerciais não tratarem o limiar como meta-base.
   */
  tierRevenueHint?: Pick<
    TierRevenueProposal,
    "amountAtLevel" | "attainmentPct" | "proposedBase" | "tierName"
  > | null;
  /** Confirmação de gravação vinculada à fingerprint do rascunho. */
  pendingCommit?: GoalPendingCommit | null;
  /** Último save bem-sucedido nesta sessão de montagem. */
  lastSave?: GoalLastSave | null;
  /** exact = preservar tudo; reference = pode recomendar ajuste (sem aplicar sozinho). */
  copyIntent?: GoalCopyIntent | null;
  /** Já ofereceu os 3 caminhos nesta sessão de montagem (evita repetir o texto). */
  pathOfferPresented?: boolean;
};

export function newGoalOperationId(): string {
  return `gop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Pedido explícito de reutilizar config de outra meta/filial. */
export function looksLikeExplicitConfigReuse(text: string): boolean {
  const p = norm(text);
  return (
    /copiar? (a |o )?(mesma )?configura|mesma configura[cç][aã]o|reutilizar (a )?configura|igual (a|ao) (da |de )?(outra |ultima |última )?|copia (pra|para) (a |o )?(mesma |loja)|aproveitar (a )?mesma (configura|escada|meta)/.test(
      p,
    ) || (/mesma (configura|escada|premia)/.test(p) && /copiar|copia|reutilizar|aproveitar|igual/.test(p))
  );
}

/** Intenção de iniciar / mudar para outra meta (nova operação). */
export function looksLikeStartNewGoalOp(text: string): boolean {
  const p = norm(text);
  return (
    /criar (a |da |de |o )?(meta|loja)|montar (a )?meta|nova meta|meta (da|de|pra|para|na)|vamos (criar|montar|fazer) (a |da |de )?meta|agora (vamos |a |da )?meta|outra (loja|filial|meta)/.test(
      p,
    ) || /vamos criar da |criar da loja|meta pra loja|meta para (a )?loja/.test(p)
  );
}

export function emptyGoalAssembly(): GoalAssembly {
  return {
    periodConfirmed: false,
    valueDiscussed: false,
    path: null,
    confirmedGroups: false,
    confirmedSpread: false,
    confirmedTiers: false,
    confirmedMount: false,
  };
}

/** Pediu sugestão de valor (não só “quero criar meta”). */
export function looksLikeAskValueSuggestion(text: string): boolean {
  return looksLikeAskValueSuggestionP0(text);
}

/** Config completa o bastante para oferecer “salvar rascunho?”. */
export function goalConfigReadyForSaveOffer(draft: GoalDraft): boolean {
  const a = draft.assembly ?? emptyGoalAssembly();
  return (
    goalDraftReady(draft.form) &&
    a.confirmedGroups &&
    a.confirmedSpread &&
    a.confirmedTiers &&
    draft.form.target != null
  );
}

/** Único sinal que autoriza saveGoal: pendingCommit.authorized + fingerprint. */
export function goalCanPersist(draft: GoalDraft): boolean {
  const a = draft.assembly ?? emptyGoalAssembly();
  return (
    goalDraftReady(draft.form) &&
    a.confirmedGroups &&
    a.confirmedSpread &&
    a.confirmedTiers &&
    draft.pendingCommit?.authorized === true &&
    pendingCommitStillValid(draft)
  );
}

/** @deprecated use goalCanPersist — nome antigo; agora exige autorização explícita. */
export function goalCanCommit(draft: GoalDraft): boolean {
  return goalCanPersist(draft);
}

/**
 * Intenção explícita de copiar config (escada/grupos/mês de origem).
 * “Mesma faixa” / aceite de valor NÃO entram aqui.
 */
export function looksLikeExplicitConfigCopy(text: string): boolean {
  const p = norm(text).trim();
  if (looksLikeDeclineConfigCopy(text)) return false;
  if (/mesma faixa|seguir a (mesma )?faixa|faixa (recomend|sugerid)/.test(p) && !/escada|config|copia|copiar/.test(p)) {
    return false;
  }
  return (
    /^(copia|copiar)(\b|,|$)/.test(p) ||
    /pode copiar|quero (que )?copie|vamos copiar|quero copiar|copia sim|copia isso|copia dela|copiar outubro|copia (de |do )?outubro|copiando/.test(
      p,
    ) ||
    /copiar (a |o |a mesma |o mesmo )?(escada|config|meta|configura)|copiando .{0,24}(escada|config|meta|outubro)|mesma escada|mesma configura|aproveitar (a )?(mesma )?(escada|config|meta|configura)|repetir (a )?(config|escada|meta)|configura[cç][aã]o (de )?outubro|configura[cç][aã]o anterior/.test(
      p,
    ) ||
    (/\b(copia|copiar|copiando)\b/.test(p) && /escada|config|meta|outubro|mes passado|anterior|mesma/.test(p))
  );
}

/** Aceite de cópia: explícito, ou “sim” curto só depois de path=copy já escolhido. */
export function looksLikeAcceptConfigCopy(text: string): boolean {
  if (looksLikeDeclineConfigCopy(text)) return false;
  return looksLikeExplicitConfigCopy(text) || looksLikeBareCopyAccept(text);
}

/** “Sim/pode/ok” curto — só vale como aceite de cópia se path já for copy. */
export function looksLikeBareCopyAccept(text: string): boolean {
  const p = norm(text).trim();
  return /^(sim|pode|quero|ok)(\b|,|$)/.test(p);
}

/** Escolhe o caminho “copiar configuração”. */
export function looksLikeChooseCopyPath(text: string): boolean {
  return looksLikeExplicitConfigCopy(text);
}

/** Escolhe o caminho “criar com recomendações do JARVIS”. */
export function looksLikeChooseRecommendedPath(text: string): boolean {
  const p = norm(text).trim();
  // Aceite do valor-alvo (“aceito a recomendada”) ≠ caminho de montagem.
  if (
    /aceito (a |o )?(proposta|recomend|valor)|aplica (a |o )?recomend|topa a recomend|mesma faixa|seguir a (mesma )?faixa/.test(
      p,
    ) &&
    !/configura|caminho|criar|montar|grupos|niveis|escada|pesos/.test(p)
  ) {
    return false;
  }
  return (
    /criar com recomenda|montar com recomenda|configura[cç][aã]o recomendad|suas recomenda|recomenda[cç][oõ]es (do |do jarvis )?|caminho recomendad|op[cç][aã]o recomendad|quero (a |sua |a sua )?recomend|vamos (de |com )?(a )?recomendad|usa (sua |a )?recomend|criar recomendad|com as recomenda|com recomenda[cç][oõ]es/.test(
      p,
    ) || /^(recomendad|com recomenda)/.test(p)
  );
}

/** Escolhe o caminho “criar do zero”. */
export function looksLikeChooseFreshPath(text: string): boolean {
  const p = norm(text).trim();
  return /do zero|montar (tudo )?do zero|criar do zero|come[cç]ar do zero|passo a passo|sem copia|nova configura|prefiro montar|quero montar (do zero|eu mesmo)|do absoluto zero/.test(
    p,
  );
}

/** Interpreta escolha explícita de caminho de montagem. null = ainda não escolheu. */
export function parseGoalAssemblyPath(text: string): GoalAssemblyPath | null {
  if (looksLikeChooseFreshPath(text)) return "fresh";
  if (looksLikeChooseRecommendedPath(text)) return "recommended";
  if (looksLikeChooseCopyPath(text)) return "copy";
  return null;
}

/**
 * Introdução curta após aceite do valor — as opções ficam no componente.
 * Não repetir a lista integral no texto (evita duplicidade visual).
 */
export function speakGoalAssemblyPathOffer(opts: {
  target: number;
  destLabel: string;
  priorLabel?: string | null;
  hasPrior: boolean;
}): string {
  const tip = opts.hasPrior
    ? `Minha sugestão: criar com recomendações` +
      (opts.priorLabel ? ` (podemos partir do que já funcionou em ${opts.priorLabel})` : "") +
      `.`
    : `Minha sugestão: criar com recomendações a partir do histórico.`;
  return (
    `Apliquei ${brlCent(opts.target)} no rascunho para ${opts.destLabel}.\n\n` +
    `Agora escolha abaixo como montar a configuração da equipe.\n\n` +
    tip
  );
}

/** Pediu para ver o que está no rascunho (não buscar meta publicada do destino). */
export function looksLikeInspectGoalDraft(text: string): boolean {
  if (looksLikeAskGroupWeightAdvice(text)) return false;
  const p = norm(text).trim();
  return (
    /como (ficou|ficam|esta|saiu|ficaria)/.test(p) ||
    /mostr[ea](r)? (os |as |a |o )?(niveis?|escada|config|grupo|bonus|resumo)/.test(p) ||
    /o que (voce |vc )?(copiou|montou|fez|aplicou)/.test(p) ||
    /quais? (sao|foram) (os )?(niveis?|grupos)/.test(p) ||
    /me (mostra|fala|diz) (a |o |os )?(config|escada|nive|resumo)/.test(p) ||
    /resumo (da |do )?(meta|config|copia)/.test(p) ||
    /^(e )?os niveis\??$|^(e )?a escada\??$|^(e )?os grupos\??$/.test(p)
  );
}

/** Avaliar / manter / mudar pesos dos turnos — análise, não re-cópia. */
export function looksLikeAskGroupWeightAdvice(text: string): boolean {
  const p = norm(text).trim();
  if (!/(peso|pesos|divisao|distribui|turno|turnos|grupo|grupos)/.test(p)) return false;
  return (
    /(acha|acharia|manter|mantem|mantém|recomenda|avalia|analisa|melhor|adequa|faz sentido|continua|ajusta|muda|vale (a pena)?|concorda)/.test(
      p,
    ) || /divisao de peso|pesos? (dos? )?(turno|grupo)/.test(p)
  );
}

export type GoalSpeakFacet = "copyJustApplied" | "full" | "levels" | "groups" | "prize";

export function goalInspectFacet(text: string): GoalSpeakFacet {
  const p = norm(text).trim();
  if (/niveis?|escada|atingimento/.test(p) && !/grupo|peso|turno/.test(p)) return "levels";
  if (/comiss|bonus|bônus|premia|gerencia|gerência/.test(p) && !/grupo|peso|turno/.test(p)) {
    return "prize";
  }
  if (/grupos?|turnos?|pesos?|divisao|distribui/.test(p) && !/niveis?|escada/.test(p)) {
    return "groups";
  }
  return "full";
}

/** Resposta humana a partir do estado operacional (sem LLM). */
export function speakGoalDraftConfig(
  draft: GoalDraft,
  opts?: { facet?: GoalSpeakFacet },
): string {
  const form = draft.form;
  const a = draft.assembly ?? emptyGoalAssembly();
  const facet = opts?.facet ?? "full";
  const dest =
    form.startsOn && form.endsOn
      ? monthYearTitle(form.startsOn)
      : "a meta em elaboração";
  const alvo = form.target != null ? brlCent(form.target) : "valor a definir";
  const snap = buildGoalConfigSnapshot(form, form.target);

  if (draft.copyStatus === "failed") {
    const origin = draft.copiedFrom
      ? monthYearTitle(draft.copiedFrom.from)
      : draft.pendingConfigCopy
        ? monthYearTitle(draft.pendingConfigCopy.from)
        : "a origem pedida";
    return (
      `Não consegui recuperar a configuração de ${origin} para copiar.\n\n` +
      `O rascunho de ${dest} (${alvo}) continua sem essa escada. ` +
      `Confirma a filial e o mês de origem, ou montamos do zero?`
    );
  }

  if (facet === "levels") {
    return (
      `Níveis no rascunho de ${dest}:\n\n` +
      snap.levels
        .map((l) => {
          const b = l.bonus > 0 ? ` · bônus ${brlCent(l.bonus)}` : "";
          return `· ${l.name}: ${l.minAttainmentPct}% de atingimento · ${l.commissionPct}% de comissão${b}`;
        })
        .join("\n")
    );
  }

  if (facet === "groups") {
    if (snap.groups.length === 0) {
      return `Não há grupos no rascunho de ${dest} — a meta está sem rateio por turno.`;
    }
    return (
      `Grupos no rascunho de ${dest} (${alvo}):\n\n` +
      snap.groups
        .map((g) =>
          g.amount != null
            ? `· ${g.name}: ${g.pct}% → ${brlCent(g.amount)}`
            : `· ${g.name}: ${g.pct}%`,
        )
        .join("\n")
    );
  }

  if (facet === "prize") {
    return (
      `Premiação no rascunho de ${dest}:\n\n` +
      snap.levels
        .map((l) => {
          const b = l.bonus > 0 ? ` + bônus ${brlCent(l.bonus)}` : "";
          const m =
            l.managerPct != null
              ? ` · gerência ${l.managerPct}%` +
                (l.managerBonus != null && l.managerBonus > 0
                  ? ` + ${brlCent(l.managerBonus)}`
                  : "")
              : "";
          return `· ${l.name}: comissão ${l.commissionPct}%${b}${m}`;
        })
        .join("\n")
    );
  }

  // Cópia acabou de rodar: resumo único e curto (não despejar tudo de novo nos turnos seguintes).
  if (facet === "copyJustApplied" && draft.copyStatus === "ok") {
    const origin = draft.copiedFrom
      ? monthYearTitle(draft.copiedFrom.from)
      : "a meta de referência";
    const groupsLine =
      snap.groups.length > 0
        ? snap.groups
            .map((g) =>
              g.amount != null
                ? `${g.name} ${g.pct}% (${brlCent(g.amount)})`
                : `${g.name} ${g.pct}%`,
            )
            .join(" · ")
        : "sem grupos";
    const levelsLine = snap.levels
      .map((l) => `${l.name} ${l.minAttainmentPct}%/${l.commissionPct}%`)
      .join(" · ");
    return (
      `Pronto — trouxe a configuração de ${origin} para ${dest} (${alvo}).\n\n` +
      `Escada: ${levelsLine}.\n` +
      `Grupos: ${groupsLine}.\n\n` +
      `Bônus e premiação da gerência vieram junto. A config está no rascunho, ainda sem gravar.\n\n` +
      `Quer olhar os pesos dos turnos, algum nível, ou seguimos?`
    );
  }

  if (draft.copyStatus === "ok" || (a.path === "copy" && form.tiers.length > 0)) {
    const origin = draft.copiedFrom
      ? monthYearTitle(draft.copiedFrom.from)
      : "a meta de referência";
    return (
      `No rascunho de ${dest} (${alvo}), a partir de ${origin}:\n\n` +
      snap.chatBlocks.join("\n\n")
    );
  }

  if (a.path === "fresh" || form.tiers.length > 0) {
    return `No rascunho de ${dest} (${alvo}):\n\n` + snap.chatBlocks.join("\n\n");
  }

  return (
    `Ainda não tenho uma configuração no rascunho de ${dest}. ` +
    `Quer copiar a meta anterior, criar com recomendações ou montar do zero?`
  );
}

/** Análise de pesos — nunca reabre a narrativa de cópia. */
export function speakGoalWeightAdvice(
  draft: GoalDraft,
  advice: {
    chatBlocks: string[];
    caveat: string | null;
    same: boolean;
  } | null,
): string {
  const form = draft.form;
  const current =
    form.groups.length > 0
      ? form.groups.map((g) => `${g.name} ${g.pct}%`).join(" / ")
      : "sem grupos";

  if (form.groups.length < 2) {
    return `Não há dois grupos no rascunho para avaliar pesos. A configuração permanece como está.`;
  }

  if (!advice) {
    return (
      `Eu não manteria ${current} automaticamente sem olhar o desempenho recente dos turnos.\n\n` +
      `Não tenho participação por turno confiável agora — mantive os pesos no rascunho sem alterar.\n\n` +
      `Se quiser, ajustamos na mão (ex.: 40%/60%) ou tentamos de novo quando houver mais vendas ligadas ao turno.`
    );
  }

  const head =
    `Eu não manteria ${current} automaticamente sem verificar o desempenho recente dos turnos.\n\n` +
    advice.chatBlocks.join("\n\n");
  const tail = "\n\nA configuração copiada continua inalterada no rascunho.";
  return head + tail;
}

function logGoalCopy(event: string, payload: Record<string, unknown>): void {
  try {
    console.info(`[jarvis.goal] ${event}`, payload);
  } catch {
    /* ignore */
  }
}

export function looksLikeDeclineConfigCopy(text: string): boolean {
  const p = norm(text).trim();
  return (
    /^(nao|não)(\b|,|$)/.test(p) ||
    /nao (quero )?copiar|não (quero )?copiar|sem copia|monta (do )?zero|nova configura|nao precisa|não precisa|deixa (sem|pra eu)|prefiro montar|quero montar/.test(
      p,
    )
  );
}

/** Resposta à pergunta de distribuição por grupos. null = ainda não deu pra ler. */
export function parseGroupsDistributionChoice(text: string): boolean | null {
  const p = norm(text).trim();
  if (/sem (divisao|distribui|grupo)|nao (quero )?(divis|grupo)|não (quero )?(divis|grupo)|sem grupo|so individual|só individual|nao precisa de grupo|não precisa de grupo/.test(p)) {
    return false;
  }
  if (/com (divisao|distribui|grupo)|por grupo|dividir .{0,20}grupo|quero (a )?divis|quero grupo|distribui.{0,12}grupo/.test(p)) {
    return true;
  }
  if (/^(sim|pode|quero|ok)(\b|,|$)/.test(p)) return true;
  if (/^(nao|não)(\b|,|$)/.test(p)) return false;
  return null;
}

/** Resposta ao rateio de venda sem vendedor identificado. */
export function parseSpreadUnidentifiedChoice(text: string): boolean | null {
  const p = norm(text).trim();
  if (/sem rateio|nao ratear|não ratear|nao (quero )?marcar|não (quero )?marcar|deixa (desligado|off|sem)|nao precisa|não precisa/.test(p)) {
    return false;
  }
  if (/ratear|rateia|rateio|marcar|com rateio|sim.*(rate|identif|vendedor)/.test(p)) return true;
  if (/^(sim|pode|quero|ok)(\b|,|$)/.test(p)) return true;
  if (/^(nao|não)(\b|,|$)/.test(p)) return false;
  return null;
}

export function looksLikeConfirmTiers(text: string): boolean {
  const p = norm(text).trim();
  if (
    /^(nao|não)(\b|,|$)/.test(p) ||
    (/\b(muda|altera|troca)\b/.test(p) &&
      /escada|niveis|níveis/.test(p) &&
      !/nao precisa mudar|não precisa mudar/.test(p))
  ) {
    return false;
  }
  return (
    /^(sim|pode|ok|confirma|confirmo|fechado|isso|pode ser)(\b|,|$)/.test(p) ||
    /confirma (a |os )?(escada|niveis|níveis)|serve (a |os |essa |esta )?(escada|niveis|níveis)|(a |os |essa |esta )?(escada|niveis|níveis) serve|escada (ok|boa|fechada|padrao|padrão)|niveis ok|níveis ok|pode manter|mantem a escada|mantém a escada/.test(
      p,
    )
  );
}

export function looksLikeConfirmMount(text: string): boolean {
  const p = norm(text).trim();
  if (looksLikeDeclineConfigCopy(text) && !/monta/.test(p)) return false;
  return (
    looksLikeProceedToSaveOffer(text) ||
    /^(sim|pode|ok|monta|cria|autorizo|fechado)(\b|,|$)/.test(p) ||
    /pode montar|monta (o )?rascunho|cria (a )?meta|autorizo|vamos (criar|montar)|salva(r)? (o )?rascunho|ok pode/.test(p)
  );
}

export function formatTiersBrief(tiers: Tier[]): string {
  return tiers
    .map((t) => {
      const bonus = t.bonus > 0 ? ` + bônus ${brlCent(t.bonus)}` : "";
      return `${t.name} ${t.minAttainmentPct}% / premiação ${t.commissionPct}%${bonus}`;
    })
    .join("; ");
}

/** Mesmos cortes do editor (`DEFAULT_TIERS` em GoalEditorPage). */
export function defaultGoalTiers(): Tier[] {
  return [
    { name: "Nível 1", minAttainmentPct: 100, commissionPct: 1.5, bonus: 0 },
    { name: "Nível 2", minAttainmentPct: 120, commissionPct: 2, bonus: 0 },
    { name: "Nível 3", minAttainmentPct: 150, commissionPct: 2.5, bonus: 0 },
    { name: "Nível 4", minAttainmentPct: 180, commissionPct: 3, bonus: 0 },
  ];
}

export function emptyGoalForm(storeId: string): GoalDraftForm {
  return {
    name: "",
    storeId,
    startsOn: null,
    endsOn: null,
    target: null,
    tierMode: "INDIVIDUAL",
    spreadUnidentified: false,
    tiers: defaultGoalTiers(),
    groups: [],
    managerOn: false,
  };
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function shiftMonthStart(isoDay: string, delta: number): string {
  const y = Number(isoDay.slice(0, 4));
  const m = Number(isoDay.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
}

const MONTH_NAMES: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

/** Nome automático: "Meta Novembro 2026" (também aceita legado "Novembro 2026" / "Nova meta"). */
export function isAutoMonthYearName(name: string): boolean {
  const n = norm(name.trim());
  if (!n || n === "nova meta") return true;
  return Object.keys(MONTH_NAMES).some(
    (m) =>
      new RegExp(`^meta\\s+${m}\\s+20\\d{2}$`).test(n) || new RegExp(`^${m}\\s+20\\d{2}$`).test(n),
  );
}

/** Padrão determinístico — nunca depende do LLM. */
export function defaultGoalName(startsOn: string): string {
  return `Meta ${monthYearTitle(startsOn)}`;
}

/**
 * Competência civil a partir do texto.
 * Prefere mes-alvo ("meta de novembro") sobre mes de referencia ("tendo em vista a meta de outubro").
 */
export function parseGoalPeriod(text: string, today: string): { startsOn: string; endsOn: string } | null {
  const p = norm(text);
  if (/proximo mes|mes que vem/.test(p)) {
    const startsOn = shiftMonthStart(today, 1);
    return { startsOn, endsOn: endOfMonth(startsOn) };
  }
  if (/este mes|esse mes|mes atual/.test(p)) {
    const startsOn = startOfMonth(today);
    return { startsOn, endsOn: endOfMonth(startsOn) };
  }
  if (/mes passado/.test(p) && !/meta de (janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/.test(p)) {
    const startsOn = shiftMonthStart(today, -1);
    return { startsOn, endsOn: endOfMonth(startsOn) };
  }

  type Hit = { month: number; year: number; score: number };
  const hits: Hit[] = [];
  for (const [name, month] of Object.entries(MONTH_NAMES)) {
    if (!p.includes(name)) continue;
    const yearMatch = p.match(new RegExp(`${name}\\s+(?:de\\s+)?(20\\d{2})`));
    const y = yearMatch ? Number(yearMatch[1]) : Number(today.slice(0, 4));
    let score = 1 + p.lastIndexOf(name) / 10_000;

    // Alvo da meta nova.
    if (
      new RegExp(
        `meta (de |do |para |em |da )?${name}|${name} da (filial|loja)|para (a |o )?(filial|loja).{0,40}${name}|fazer a meta de ${name}|meta de ${name} da`,
      ).test(p)
    ) {
      score += 20;
    }
    // Referencia / copia de config — nao deve ganhar do alvo.
    if (
      new RegExp(
        `(configura|igual|copiar|seguir|mesma|mesmo|escada|nivel|tendo em vista|em vista|basead|historico|vista a meta).{0,48}${name}|${name}.{0,24}(configura|escada|nivel)`,
      ).test(p)
    ) {
      score -= 15;
    }
    hits.push({ month, year: y, score });
  }
  hits.sort((a, b) => b.score - a.score);
  if (hits[0] && hits[0].score > 0) {
    const startsOn = `${hits[0].year}-${pad(hits[0].month)}-01`;
    return { startsOn, endsOn: endOfMonth(startsOn) };
  }

  const range = p.match(/de\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+a\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (range) {
    const y0 = range[3] ? (range[3].length === 2 ? `20${range[3]}` : range[3]) : today.slice(0, 4);
    const y1 = range[6] ? (range[6].length === 2 ? `20${range[6]}` : range[6]) : y0;
    const from = `${y0}-${range[2]!.padStart(2, "0")}-${range[1]!.padStart(2, "0")}`;
    const to = `${y1}-${range[5]!.padStart(2, "0")}-${range[4]!.padStart(2, "0")}`;
    if (from <= to) return { startsOn: from, endsOn: to };
  }
  return null;
}

export function parseGoalTarget(text: string): number | null {
  type Hit = { value: number; score: number };
  const hits: Hit[] = [];

  const push = (raw: string, mil: boolean, score: number, index: number) => {
    let r = raw;
    if (r.includes(",")) r = r.replace(/\./g, "").replace(",", ".");
    else r = r.replace(/\./g, "");
    let n = Number(r);
    if (!Number.isFinite(n) || n <= 0) return;
    if (mil) n *= 1000;
    hits.push({ value: Math.round(n), score: score + index / 100_000 });
  };

  const patterns: { re: RegExp; score: number; milAlways?: boolean }[] = [
    { re: /chegar\s+em\s+(?:r\$\s*)?([\d.]+(?:,\d{1,2})?)\s*mil\b/gi, score: 60, milAlways: true },
    { re: /([\d.]+(?:,\d{1,2})?)\s*mil\s+de\s+meta\b/gi, score: 55, milAlways: true },
    { re: /meta\s+(?:de\s+)?(?:r\$\s*)?([\d.]+(?:,\d{1,2})?)\s*mil\b/gi, score: 50, milAlways: true },
    { re: /(?:alvo|meta)\s+(?:de\s+)?r\$\s*([\d.]+(?:,\d{1,2})?)/gi, score: 35 },
    { re: /r\$\s*([\d.]+(?:,\d{1,2})?)/gi, score: 15 },
    { re: /([\d.]+(?:,\d{1,2})?)\s*mil\b/gi, score: 25, milAlways: true },
  ];

  // Preferir falas do usuario quando o texto e um historico "user: … / jarvis: …".
  const chunks = text.includes("user:")
    ? text.split(/\n(?=user:|jarvis:)/i).map((c) => {
        const user = /^user:/i.test(c.trim());
        return { c, boost: user ? 40 : 0 };
      })
    : [{ c: text, boost: 0 }];

  for (const { c, boost } of chunks) {
    for (const { re, score, milAlways } of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(c)) != null) {
        const mil = milAlways === true || new RegExp(`${m[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*mil\\b`, "i").test(c);
        push(m[1]!, mil, score + boost, m.index);
      }
    }
  }

  if (hits.length === 0) return null;
  hits.sort((a, b) => b.score - a.score);
  return hits[0]!.value;
}

export type GoalFormErrors = {
  name?: string;
  storeId?: string;
  period?: string;
  target?: string;
  tiers?: string;
};

export function validateGoalDraft(f: GoalDraftForm): GoalFormErrors {
  const e: GoalFormErrors = {};
  if (!f.name.trim()) e.name = "nome";
  if (!f.storeId) e.storeId = "filial";
  if (!f.startsOn || !f.endsOn) e.period = "período";
  else if (f.endsOn < f.startsOn) e.period = "período";
  if (f.target == null || f.target <= 0) e.target = "valor da meta";
  let prev = -1;
  for (const t of f.tiers) {
    if (!(t.minAttainmentPct > prev) || !(t.commissionPct > 0)) {
      e.tiers = "escada de premiação";
      break;
    }
    prev = t.minAttainmentPct;
  }
  return e;
}

export function missingGoalLabels(errors: GoalFormErrors): string[] {
  return Object.values(errors);
}

export function goalDraftReady(f: GoalDraftForm): boolean {
  return Object.keys(validateGoalDraft(f)).length === 0;
}

export function ensureGoalName(f: GoalDraftForm): GoalDraftForm {
  // Só sincroniza nome automático com o período. Nome personalizado pelo gestor permanece.
  if (f.startsOn && (!f.name.trim() || isAutoMonthYearName(f.name))) {
    return { ...f, name: defaultGoalName(f.startsOn) };
  }
  if (f.name.trim()) return f;
  return f;
}

/**
 * Ajusta o degrau “Desafio” para o % pedido (padrão 110 = meta + 10%).
 * Preserva a escada copiada: só remove degraus no patamar do Desafio ou acima;
 * não derruba níveis intermediários abaixo do %.
 */
export function applyChallengeTierPct(tiers: Tier[], pct: number): Tier[] {
  if (tiers.length === 0) {
    return [{ name: "Desafio", minAttainmentPct: pct, commissionPct: 3, bonus: 0 }];
  }
  const cloned = tiers.map((t) => ({ ...t }));
  const kept = cloned.filter((t) => t.minAttainmentPct < pct && !/desafio/i.test(t.name));
  const prevDesafio = cloned.find((t) => /desafio/i.test(t.name));
  const aboveOrAt = cloned.filter((t) => t.minAttainmentPct >= pct && !/desafio/i.test(t.name));
  const template = prevDesafio ?? aboveOrAt[aboveOrAt.length - 1] ?? cloned[cloned.length - 1]!;
  const desafio: Tier = {
    ...template,
    name: "Desafio",
    minAttainmentPct: pct,
  };
  return [...kept, desafio];
}

/** Gestor diz que a cópia ficou errada (níveis/grupos). */
export function looksLikeLadderCopyCorrection(text: string): boolean {
  const p = norm(text);
  return (
    /mais de \d|tem mais .{0,24}(nivel|niveis)|divis[aã]o por grupo|modo grupo|por grupo|escada (errada|incompleta|diferente)|configura[cç][aã]o (errada|incompleta|diferente)|nao (foi |eh |é )?(isso|essa|a mesma)|nao (copiou|pegou|trouxe)|esqueceu|faltou .{0,20}(nivel|grupo)|niveis? de outubro|outubro tem/.test(
      p,
    ) ||
    (/\bgrupo\b/.test(p) && /nivel|niveis|escada|configura|outubro/.test(p))
  );
}

/**
 * Mês de onde copiar escada/modo (“mesma configuração de outubro”).
 * Diferente do período da meta nova.
 */
export function parseConfigSourceMonth(
  text: string,
  today: string,
  targetStartsOn?: string | null,
): { from: string; to: string } | null {
  const p = norm(text);
  // Nao copiar por "pode seguir" / "seguir a conversa" — so pedido explicito de config/escada.
  const wantsCopy =
    /mesma configura|mesma escada|mesmo modo|vamos copiar|quero copiar|pode copiar|copiando|sim,? copia|copia (sim|isso|dela|de)|igual (a |ao |a meta |ao mes )?de |configura[cç][aã]o de |escada de /.test(
      p,
    ) ||
    /copiar (a |o |a mesma |o mesmo )?(configura|escada|meta)|copia (a |o |a mesma |o mesmo )?(configura|escada|meta)|copiando .{0,24}(configura|escada|outubro|meta)/.test(
      p,
    ) ||
    (/\b(copia|copiar|copiando)\b/.test(p) &&
      /configura|escada|grupo|bonus|bônus|nivel|outubro|mes passado|mesma/.test(p));
  if (!wantsCopy) return null;

  if (/mes passado/.test(p)) {
    const base = targetStartsOn || today;
    const from = shiftMonthStart(base, -1);
    return { from, to: endOfMonth(from) };
  }

  for (const [name, month] of Object.entries(MONTH_NAMES)) {
    if (
      !new RegExp(
        `(configura|igual|copiar|copia|copiando|seguir|mesma|mesmo|escada|nivel|de).{0,48}${name}|${name}.{0,24}(configura|escada|nivel)`,
      ).test(p)
    ) {
      continue;
    }
    const y = Number((targetStartsOn || today).slice(0, 4));
    const from = `${y}-${pad(month)}-01`;
    return { from, to: endOfMonth(from) };
  }

  // "copia a configuração" sem mes → periodo anterior ao alvo.
  const base = targetStartsOn || today;
  const from = shiftMonthStart(base, -1);
  return { from, to: endOfMonth(from) };
}

/** Filial citada perto de “configuração / outubro / copiar” = fonte da escada. */
export function pickConfigSourceStore(text: string, matched: JarvisStoreRef[]): JarvisStoreRef | null {
  if (matched.length === 0) return null;
  if (matched.length === 1) return matched[0]!;
  const n = norm(text);
  for (const s of matched) {
    const label = norm(s.tradeName || s.name);
    if (label.length < 3) continue;
    const idx = n.indexOf(label);
    if (idx < 0) continue;
    const around = n.slice(Math.max(0, idx - 48), idx + label.length + 16);
    if (/configura|igual|copiar|mesma|seguir|de outubro|da meta|filial/.test(around)) return s;
  }
  return matched[0]!;
}

/** Filial de destino: “aqui pra / para a Loja…” — distinta da fonte. */
export function pickGoalTargetStore(
  text: string,
  matched: JarvisStoreRef[],
  source: JarvisStoreRef | null,
): JarvisStoreRef | null {
  const others = source ? matched.filter((s) => s.id !== source.id) : matched;
  if (others.length === 1) return others[0]!;
  if (others.length === 0) return source ?? matched[0] ?? null;
  const n = norm(text);
  for (const s of others) {
    const label = norm(s.tradeName || s.name);
    const idx = n.indexOf(label);
    if (idx < 0) continue;
    const around = n.slice(Math.max(0, idx - 24), idx + label.length + 8);
    if (/\b(pra|para|aqui|nessa|neste|montar|criar)\b/.test(around)) return s;
  }
  return others[0]!;
}

/** Meta publicada no periodo anterior (pra oferecer copia de config). */
export async function findPriorGoalForStore(
  ctx: JarvisContext,
  storeId: string,
  targetStartsOn: string,
): Promise<{ from: string; to: string; name: string; target: number; tiers: number; groups: number } | null> {
  if (!storeId) return null;
  const from = shiftMonthStart(targetStartsOn, -1);
  const to = endOfMonth(from);
  try {
    const goals = await fetchGoals({
      tenantId: ctx.tenantId,
      storeIds: [storeId],
      from,
      to,
    });
    const src = goals.find((g) => g.storeId === storeId) ?? goals[0];
    if (!src) return null;
    return {
      from: src.startsOn,
      to: src.endsOn,
      name: src.name,
      target: src.target,
      tiers: src.tiers.length,
      groups: src.groups.length,
    };
  } catch {
    return null;
  }
}

export type GoalCopyResult = {
  form: GoalDraftForm;
  ok: boolean;
  tiers: number;
  groups: number;
  tierMode: GoalDraftForm["tierMode"];
  copiedFrom: GoalCopiedFrom | null;
};

/** Copia modo/escada/rateio/gerência da meta do mês de referência (publicada; senão rascunho). */
export async function copyGoalLadderFromPeriod(
  form: GoalDraftForm,
  ctx: JarvisContext,
  win: { from: string; to: string },
  sourceStoreId?: string,
): Promise<GoalCopyResult> {
  const storeId =
    sourceStoreId || form.storeId || (ctx.stores.length === 1 ? ctx.stores[0]!.id : "");
  const fail = (): GoalCopyResult => ({
    form,
    ok: false,
    tiers: form.tiers.length,
    groups: form.groups.length,
    tierMode: form.tierMode,
    copiedFrom: null,
  });
  if (!storeId) return fail();
  try {
    let goals = await fetchGoals({
      tenantId: ctx.tenantId,
      storeIds: [storeId],
      from: win.from,
      to: win.to,
    });
    // Outubro pode estar só como rascunho — ainda assim é a config que o Gestor indica.
    if (goals.length === 0) {
      goals = await fetchGoals({
        tenantId: ctx.tenantId,
        storeIds: [storeId],
        from: win.from,
        to: win.to,
        includeDrafts: true,
      });
    }
    const src = goals.find((g) => g.storeId === storeId) ?? goals[0];
    if (!src) {
      logGoalCopy("copy_miss", {
        storeId,
        originFrom: win.from,
        originTo: win.to,
        destFrom: form.startsOn,
        destTo: form.endsOn,
      });
      return fail();
    }
    const hasManager = src.tiers.some((t) => t.managerPct != null);
    const next: GoalDraftForm = {
      ...form,
      // Destino (novembro) e alvo negociado permanecem; só a estrutura vem da origem.
      tierMode: src.tierMode,
      spreadUnidentified: src.spreadUnidentified === true,
      managerOn: hasManager,
      groups: src.groups.map((g) => ({ shiftId: g.shiftId, name: g.name, pct: g.pct })),
      tiers: src.tiers.map((t) => ({
        name: t.name,
        minAttainmentPct: t.minAttainmentPct,
        commissionPct: t.commissionPct,
        bonus: t.bonus,
        ...(t.managerPct != null ? { managerPct: t.managerPct, managerBonus: t.managerBonus } : {}),
      })),
    };
    const copiedFrom: GoalCopiedFrom = {
      goalId: src.id,
      storeId: src.storeId,
      from: src.startsOn,
      to: src.endsOn,
      name: src.name,
      tiers: next.tiers.length,
      groups: next.groups.length,
    };
    logGoalCopy("copy_ok", {
      sourceGoalId: src.id,
      storeId: src.storeId,
      originFrom: src.startsOn,
      originTo: src.endsOn,
      destFrom: form.startsOn,
      destTo: form.endsOn,
      tiers: copiedFrom.tiers,
      groups: copiedFrom.groups,
      target: form.target,
    });
    return {
      form: next,
      ok: true,
      tiers: next.tiers.length,
      groups: next.groups.length,
      tierMode: next.tierMode,
      copiedFrom,
    };
  } catch (err) {
    logGoalCopy("copy_error", {
      storeId,
      originFrom: win.from,
      message: err instanceof Error ? err.message : "unknown",
    });
    return fail();
  }
}

export function mergeGoalUtterance(form: GoalDraftForm, text: string, ctx: JarvisContext): GoalDraftForm {
  // Só a última fala do Gestor — o histórico no blob não pode reaplicar mês/modo.
  const utter = lastUserUtterance(text);
  const p = norm(utter);
  const next: GoalDraftForm = {
    ...form,
    tiers: form.tiers.map((t) => ({ ...t })),
  };

  const pool = ctx.network.length > 0 ? ctx.network : ctx.stores;
  const stores = matchStoresInText(utter, pool);
  const source = pickConfigSourceStore(utter, stores);
  const targetStore = pickGoalTargetStore(utter, stores, source);
  if (targetStore) next.storeId = targetStore.id;
  else if (stores.length === 1) next.storeId = stores[0]!.id;
  else if (!next.storeId && ctx.stores.length === 1) next.storeId = ctx.stores[0]!.id;

  if (/geral|loja inteira|meta da loja|premia[cç][aã]o se divide/.test(p)) next.tierMode = "GENERAL";
  else if (/por grupo|modo grupo|meta do grupo/.test(p)) next.tierMode = "GROUP";
  else if (/individual|por pessoa|cada vendedora/.test(p)) next.tierMode = "INDIVIDUAL";

  if (/ratear|rateio|sem vendedor|nao identificado|não identificado/.test(p)) next.spreadUnidentified = true;
  if (/sem rateio|nao ratear|não ratear/.test(p)) next.spreadUnidentified = false;

  if (/gerencia|gerência/.test(p) && /premia|bonus|bônus/.test(p)) next.managerOn = true;

  // Período: última fala primeiro; se o form ainda não tem mês, olha o blob (ex.: "novembro" num turno anterior).
  const period =
    parseGoalPeriod(utter, ctx.today) ??
    (!form.startsOn && /user:/i.test(text) ? parseGoalPeriod(text, ctx.today) : null);
  if (period) {
    next.startsOn = period.startsOn;
    next.endsOn = period.endsOn;
  }

  const target = parseGoalTarget(utter);
  if (target != null) next.target = target;

  if (
    looksLikeGoalLadderTalk(utter) &&
    /10\s*%|por cento a mais|\d+\s*%\s*(a mais)?|nivel desafio|meta desafio/.test(p) &&
    !/ultimo nivel.{0,48}(r\$|\d)/.test(p)
  ) {
    next.tiers = applyChallengeTierPct(next.tiers, 110);
  }

  const name = utter.match(/(?:chamar|nome(?:ar)?|titulo|título)\s+(?:de\s+|como\s+)?["“]?([^"”\n]{3,80})["”]?/i);
  if (name?.[1]) next.name = name[1].trim().slice(0, 80);

  return ensureGoalName(next);
}

function preferAllBrand<T extends { brand: string }>(rows: T[]): T[] {
  const all = rows.filter((r) => r.brand === "ALL");
  return all.length > 0 ? all : rows.filter((r) => r.brand !== "ALL");
}

export type GoalEvidenceKind = "observed" | "estimate" | "hypothesis";

export type GoalEvidence = {
  kind: GoalEvidenceKind;
  label: string;
  /** Valor em R$ (não centavos) quando aplicável. */
  amount?: number;
};

export type GoalScenarioKind = "conservative" | "recommended" | "challenging";

export type GoalScenario = {
  kind: GoalScenarioKind;
  amount: number;
  label: string;
};

export type GoalIntelligenceResult = {
  /** Alias do cenário recomendado (compat). */
  amount: number;
  scenarios: GoalScenario[];
  evidence: GoalEvidence[];
  caveats: string[];
  confidence: "high" | "medium" | "low";
  rationale: string;
  seasonalSummary: string;
  chatBlocks: string[];
};

/** @deprecated use GoalIntelligenceResult */
export type GoalTargetSuggestion = GoalIntelligenceResult;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function roundHundred(n: number): number {
  return Math.round(n / 100) * 100;
}

function sumRevenueCents(rows: { brand: string; revenueCents: number }[]): number {
  return preferAllBrand(rows).reduce((s, r) => s + r.revenueCents, 0);
}

function sumSalesStats(rows: { brand: string; revenueCents: number; salesCount: number; itemCount: number }[]): {
  revenueCents: number;
  salesCount: number;
  itemCount: number;
  ticket: number | null;
  pa: number | null;
} {
  const pref = preferAllBrand(rows);
  const revenueCents = pref.reduce((s, r) => s + r.revenueCents, 0);
  const salesCount = pref.reduce((s, r) => s + r.salesCount, 0);
  const itemCount = pref.reduce((s, r) => s + r.itemCount, 0);
  return {
    revenueCents,
    salesCount,
    itemCount,
    ticket: salesCount > 0 ? revenueCents / 100 / salesCount : null,
    pa: salesCount > 0 ? itemCount / salesCount : null,
  };
}

/**
 * Motor de metas: períodos equivalentes, 3 cenários, evidências tipadas.
 * Não inventa métrica sem dado; marca hipótese quando usa folga default.
 */
export async function suggestGoalTarget(
  ctx: JarvisContext,
  storeId: string,
  period?: { from: string; to: string } | null,
): Promise<GoalIntelligenceResult | null> {
  if (!storeId) return null;
  const targetFrom = period?.from ?? shiftMonthStart(ctx.today, 1);
  const targetTo = period?.to ?? endOfMonth(targetFrom);
  const bias = seasonalBiasForPeriod(targetFrom, targetTo);

  const m1 = shiftMonthStart(ctx.today, -1);
  const m2 = shiftMonthStart(ctx.today, -2);
  const m3 = shiftMonthStart(ctx.today, -3);
  const yoyFrom = shiftMonthStart(targetFrom, -12);
  const yoyTo = endOfMonth(yoyFrom);
  const prevYoyFrom = shiftMonthStart(yoyFrom, -12);
  const prevYoyTo = endOfMonth(prevYoyFrom);

  try {
    const [m1Rows, m2Rows, m3Rows, yoyRows, prevYoyRows, priorGoal] = await Promise.all([
      fetchSalesDayAggs({ tenantId: ctx.tenantId, storeIds: [storeId], from: m1, to: endOfMonth(m1) }),
      fetchSalesDayAggs({ tenantId: ctx.tenantId, storeIds: [storeId], from: m2, to: endOfMonth(m2) }),
      fetchSalesDayAggs({ tenantId: ctx.tenantId, storeIds: [storeId], from: m3, to: endOfMonth(m3) }),
      fetchSalesDayAggs({ tenantId: ctx.tenantId, storeIds: [storeId], from: yoyFrom, to: yoyTo }),
      fetchSalesDayAggs({ tenantId: ctx.tenantId, storeIds: [storeId], from: prevYoyFrom, to: prevYoyTo }),
      findPriorGoalForStore(ctx, storeId, targetFrom),
    ]);

    const last = sumSalesStats(m1Rows);
    const mid = sumRevenueCents(m2Rows);
    const old = sumRevenueCents(m3Rows);
    const yoyCents = sumRevenueCents(yoyRows);
    const prevYoyCents = sumRevenueCents(prevYoyRows);

    const evidence: GoalEvidence[] = [];
    const caveats: string[] = [];

    const daysWithSales = preferAllBrand(m1Rows).filter((r) => r.revenueCents > 0).length;
    const uniqueDays = new Set(
      preferAllBrand(m1Rows)
        .filter((r) => r.revenueCents > 0)
        .map((r) => r.day),
    ).size;
    const activeDays = uniqueDays || daysWithSales;

    if (yoyCents > 0) {
      evidence.push({
        kind: "observed",
        label: `Faturamento ${monthYearTitle(yoyFrom)} (mesmo mês ano passado)`,
        amount: yoyCents / 100,
      });
    } else {
      caveats.push(
        `Sem YoY de ${monthYearTitle(yoyFrom)} nesta filial — não uso comparação ano passado inexistente.`,
      );
    }
    if (last.revenueCents > 0) {
      evidence.push({
        kind: "observed",
        label: `Faturamento ${monthYearTitle(m1)} (mês recente)`,
        amount: last.revenueCents / 100,
      });
      if (activeDays > 0 && activeDays < 20) {
        evidence.push({
          kind: "observed",
          label: `${activeDays} dia(s) com venda em ${monthYearTitle(m1)}`,
        });
        caveats.push(
          `Histórico curto (${activeDays} dias com venda): a recomendação usa ritmo observado, não projeção YoY.`,
        );
      }
    }
    if (last.ticket != null) {
      evidence.push({
        kind: "observed",
        label: `Ticket médio ${monthYearTitle(m1)} ≈ ${brlCent(last.ticket)}`,
        amount: last.ticket,
      });
    }
    if (last.pa != null) {
      evidence.push({
        kind: "observed",
        label: `P.A. ${monthYearTitle(m1)} ≈ ${last.pa.toFixed(2)}`,
      });
    }

    // Base: só combina períodos equivalentes (mesmo mês YoY + ritmo recente).
    let baseCents = 0;
    const baseBits: string[] = [];
    if (yoyCents > 0) {
      baseBits.push(`mesmo mês ano passado (${brlCent(yoyCents / 100)})`);
    }
    if (last.revenueCents > 0) {
      baseBits.push(`mês recente (${brlCent(last.revenueCents / 100)})`);
    }
    if (yoyCents > 0 && last.revenueCents > 0) {
      baseCents = (yoyCents + last.revenueCents) / 2;
      evidence.push({
        kind: "estimate",
        label: "Base = média do mesmo mês YoY com o mês recente",
        amount: baseCents / 100,
      });
    } else if (yoyCents > 0) {
      baseCents = yoyCents;
      caveats.push("Sem mês recente completo; base só no mesmo mês do ano passado.");
    } else if (last.revenueCents > 0) {
      baseCents = last.revenueCents;
      caveats.push("Sem série YoY do mês-alvo; base só no mês recente.");
    } else {
      return null;
    }

    // Crescimento só entre o MESMO mês em anos consecutivos (nunca trimestre × mês).
    let growthPct = 0.05;
    let growthLabel = "folga hipotética de +5% (sem série YoY do mês-alvo)";
    let growthKind: GoalEvidenceKind = "hypothesis";
    if (prevYoyCents > 0 && yoyCents > 0) {
      const observed = (yoyCents - prevYoyCents) / prevYoyCents;
      growthPct = clamp(observed, -0.12, 0.22);
      growthKind = "observed";
      const rounded = Math.round(growthPct * 100);
      growthLabel =
        rounded === 0
          ? "no mesmo mês o faturamento ficou estável ano a ano"
          : rounded > 0
            ? `crescimento YoY do mesmo mês ≈ ${rounded}%`
            : `queda YoY do mesmo mês ≈ ${Math.abs(rounded)}%`;
    } else {
      caveats.push("Crescimento YoY do mês-alvo indisponível; usei hipótese +5% limitada.");
    }
    evidence.push({ kind: growthKind, label: growthLabel });

    // Tendência dos últimos 3 meses (observado) — só ajusta leve se coerente, sem misturar com YoY.
    if (last.revenueCents > 0 && mid > 0 && old > 0) {
      const recentTrend = (last.revenueCents - old) / old;
      evidence.push({
        kind: "observed",
        label: `Tendência 3 meses (receita): ${recentTrend >= 0 ? "+" : ""}${Math.round(recentTrend * 100)}%`,
      });
      if (Math.abs(recentTrend) >= 0.08) {
        growthPct = clamp(growthPct + clamp(recentTrend * 0.25, -0.04, 0.04), -0.12, 0.25);
        evidence.push({
          kind: "estimate",
          label: "Ajuste leve da tendência recente sobre o fator de crescimento",
        });
      }
    }

    const sazonalPct = Math.round((bias.factor - 1) * 100);
    const sazonalBit =
      bias.factor === 1
        ? "sem ajuste sazonal forte"
        : `ajuste sazonal ${sazonalPct > 0 ? "+" : ""}${sazonalPct}%`;
    if (bias.lines.length > 0) {
      evidence.push({
        kind: bias.factor === 1 ? "observed" : "estimate",
        label: `Calendário: ${speakSeasonalBiasBreakdown(bias)}`,
      });
    }

    const recommended = roundHundred((baseCents / 100) * (1 + growthPct) * bias.factor);
    if (recommended <= 0) return null;

    const conservative = roundHundred(recommended * 0.92);
    const challenging = roundHundred(recommended * 1.1);
    const scenarios: GoalScenario[] = [
      { kind: "conservative", amount: conservative, label: "Conservadora" },
      { kind: "recommended", amount: recommended, label: "Recomendada" },
      { kind: "challenging", amount: challenging, label: "Desafiadora" },
    ];

    if (priorGoal && priorGoal.target > 0) {
      evidence.push({
        kind: "observed",
        label: `Meta cadastrada ${monthYearTitle(priorGoal.from)}`,
        amount: priorGoal.target,
      });
      const deltaPct = Math.round(((recommended - priorGoal.target) / priorGoal.target) * 100);
      evidence.push({
        kind: "estimate",
        label:
          deltaPct === 0
            ? "Recomendada na mesma faixa da meta anterior"
            : deltaPct > 0
              ? `Recomendada ~${deltaPct}% acima da meta anterior`
              : `Recomendada ~${Math.abs(deltaPct)}% abaixo da meta anterior`,
      });
    }

    let confidence: GoalIntelligenceResult["confidence"] = "medium";
    if (yoyCents > 0 && last.revenueCents > 0 && prevYoyCents > 0) confidence = "high";
    else if (yoyCents === 0 || last.revenueCents === 0) confidence = "low";
    if (caveats.length >= 2) confidence = confidence === "high" ? "medium" : "low";

    const rationale = `${baseBits.join(" + ")}; ${growthLabel}; ${sazonalBit}`;
    // Primeira fala: valor + motivos comerciais + decisão. Detalhe técnico fica em evidence (sob demanda).
    const reasons: string[] = [];
    if (priorGoal && priorGoal.target > 0) {
      const deltaPct = Math.round(((recommended - priorGoal.target) / priorGoal.target) * 100);
      reasons.push(
        deltaPct === 0
          ? `fica na mesma faixa da meta de ${monthYearTitle(priorGoal.from)} (${brlCent(priorGoal.target)})`
          : deltaPct > 0
            ? `fica ~${deltaPct}% acima da meta de ${monthYearTitle(priorGoal.from)} (${brlCent(priorGoal.target)})`
            : `fica ~${Math.abs(deltaPct)}% abaixo da meta de ${monthYearTitle(priorGoal.from)} (${brlCent(priorGoal.target)})`,
      );
    }
    if (yoyCents > 0) {
      reasons.push(`olha o mesmo mês do ano passado (${brlCent(yoyCents / 100)})`);
    }
    if (bias.lines.length > 0 && sazonalPct !== 0) {
      reasons.push(`já embute ${sazonalBit}`);
    } else if (last.revenueCents > 0) {
      reasons.push(`cruza o ritmo recente de ${monthYearTitle(m1)}`);
    }
    const reasonLine =
      reasons.length > 0
        ? `Por quê: ${reasons.slice(0, 3).join("; ")}.`
        : `${growthLabel.charAt(0).toUpperCase()}${growthLabel.slice(1)}.`;
    const chatBlocks: string[] = [
      `Para ${monthYearTitle(targetFrom)}, eu trabalharia com ${brlCent(recommended)}.`,
      reasonLine,
      `Decisão: essa é a faixa recomendada. Ainda não apliquei no rascunho.`,
    ];
    if (caveats.length) {
      chatBlocks.push(`Atenção: ${caveats[0]}`);
    }
    chatBlocks.push(
      `Aceita a recomendada, prefere conservadora (${brlCent(conservative)}) / desafiadora (${brlCent(challenging)}), ou manda outro R$? ` +
        `Se quiser, te abro a conta completa.`,
    );

    return {
      amount: recommended,
      scenarios,
      evidence,
      caveats,
      confidence,
      rationale,
      seasonalSummary: bias.summary,
      chatBlocks,
    };
  } catch {
    return null;
  }
}

/** Detecta se o modelo colou o estado interno da tool na bolha (bug). */
export function looksLikeLeakedGoalFacts(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (
    /\[INTERNAL_GOAL_STATE\]|Estado interno da proposta|INTERNAL_GOAL|alvo_centavos|periodConfirmed|valueDiscussed|proximo_passo_sugerido|NUNCA cole este bloco|Dados s[oó] para voc[eê] redigir/.test(
      t,
    )
  ) {
    return true;
  }
  // JSON de meta vazado (chaves tipicas juntas).
  if (/"nome"\s*:/.test(t) && /"filial"\s*:/.test(t) && /"faltando"\s*:/.test(t)) return true;
  return /faltando:/.test(t) && /valueDiscussed:/.test(t);
}

/** Meta / desafio / escala são por filial — com Topbar em Todas, pergunta. */
export function speakAskGoalStore(
  ctx: JarvisContext,
  opts?: { monthLabel?: string | null },
): string {
  return speakAskWriteStore(ctx, "meta", opts);
}

function speakAskGoalStoreFromDraft(draft: GoalDraft): string {
  const month = draft.form.startsOn ? monthYearTitle(draft.form.startsOn) : null;
  return month
    ? `${month}, fechado.\n\nDe qual filial quer montar a meta?`
    : "De qual filial quer montar a meta?";
}

/** Fala humana de emergência quando o modelo vazou o estado interno ou perdeu o fio. */
export function naturalGoalAskFromDraft(draft: GoalDraft): string {
  const form = draft.form;
  const a = draft.assembly ?? emptyGoalAssembly();
  if (!a.periodConfirmed) {
    const tip = form.startsOn ? monthYearTitle(form.startsOn) : null;
    return tip
      ? `Bora montar a meta.\n\nPra qual mês? Eu pensaria em ${tip}. Serve, ou é outro?`
      : `Bora montar a meta.\n\nPra qual mês a gente monta?`;
  }
  if (!form.storeId) {
    return speakAskGoalStoreFromDraft(draft);
  }
  if (!a.valueDiscussed || form.target == null || !draft.userLockedTarget) {
    const month = form.startsOn ? monthYearTitle(form.startsOn) : "esse mês";
    if (draft.proposedTarget != null && form.target == null) {
      return (
        `${month}: tenho proposta de ${brlCent(draft.proposedTarget)}, ainda fora do rascunho.\n\n` +
        `Aceita a recomendada, prefere outro cenário, ou manda o R$ que quer?`
      );
    }
    return `${month} na mesa.\n\nDeixa eu cruzar histórico e sazonal e já te trago uma proposta — sem você precisar chutar número.`;
  }
  if (a.path === null) {
    return speakGoalAssemblyPathOffer({
      target: form.target!,
      destLabel: form.startsOn ? monthYearTitle(form.startsOn) : "a meta",
      hasPrior: draft.pendingConfigCopy != null,
      priorLabel: draft.pendingConfigCopy
        ? monthYearTitle(draft.pendingConfigCopy.from)
        : null,
    });
  }
  if (a.path === "recommended" && !a.confirmedTiers) {
    return (
      `Proposta recomendada no rascunho — ainda sem gravar.\n\n` +
      speakGoalDraftConfig(draft, { facet: "full" }) +
      `\n\nConfirma essa configuração, ou quer ajustar algo?`
    );
  }
  if ((a.path === "fresh" || a.path === "recommended") && !a.confirmedGroups) {
    return "Estrutura: meta individual, por grupos ou geral da loja?";
  }
  if ((a.path === "fresh" || a.path === "recommended") && !a.confirmedSpread) {
    return "Venda sem vendedor identificado: rateia na equipe do dia, ou deixa de fora?";
  }
  if (a.path === "fresh" && !a.confirmedTiers) {
    return `Escada: ${formatTiersBrief(form.tiers)}. Serve?`;
  }
  if (draft.copyStatus === "failed" || (a.path === "copy" && draft.copyStatus === "ok" && !a.confirmedMount)) {
    return speakGoalDraftConfig(draft);
  }
  if (!a.confirmedMount) {
    return "Se estiver bom, diga que pode montar o rascunho.";
  }
  return "Me fala mais um detalhe pra gente fechar a meta.";
}

/** Histórico recente ainda é o fio de montar meta (não menu genérico). */
export function looksLikeGoalConversation(
  recent: { from: string; text: string }[],
  q: string,
  today: string,
): boolean {
  const qn = norm(q);
  if (/\bmeta\b/.test(qn) && !/meta cadastrada|qual (e|é) a meta|quanto (e|é) a meta/.test(qn)) {
    return true;
  }
  if (looksLikeAskValueSuggestion(q) || looksLikeGoalLadderTalk(q)) return true;

  const lastJarvis = [...recent].reverse().find((m) => m.from === "jarvis");
  if (!lastJarvis) return false;
  const jn = norm(lastJarvis.text);
  const jarvisOnGoal =
    /\bmeta\b/.test(jn) ||
    /pra qual m[eê]s|qual m[eê]s|montar a meta|bora montar|qual valor|sugira|filial|escada|rascunho|copiar|grupos|rateio/.test(
      jn,
    );
  if (!jarvisOnGoal) return false;

  if (parseGoalPeriod(q, today) != null) return true;
  if (parseGoalTarget(q) != null) return true;
  if (/^(isso|esse|essa|ok|sim|pode|proximo|próximo|topa|fechado)(\b|!|\?|,|$)/.test(qn)) return true;
  if (qn.length > 0 && qn.length < 40) return true;
  return false;
}

/** Modelo esqueceu o fio (menu) ou perguntou mês de novo com período já confirmado. */
export function looksLikeLostGoalReply(text: string, draft: GoalDraft): boolean {
  const n = norm(text);
  if (/pode ser n[uú]mero.? meta.? desafio|n[uú]mero, meta, desafio ou escala/.test(n)) return true;
  if (/^o que voc[eê] precisa\b/.test(n) && /meta|desafio|escala/.test(n)) return true;
  const a = draft.assembly ?? emptyGoalAssembly();
  if (a.periodConfirmed && /qual m[eê]s|m[eê]s (a gente |voc[eê] )?quer fechar|pra qual m[eê]s/.test(n)) {
    return true;
  }
  return false;
}

/** Prometeu montar e parou (“vou montar”, “um momento”) sem avançar o passo. */
export function looksLikeStallingGoalReply(text: string): boolean {
  const n = norm(text);
  return (
    /vou (montar|preparar|ajustar|criar|fazer)|um momento|so um segundo|só um segundo|aguarde|ja volto|já volto|deixa eu (montar|preparar|ajustar)/.test(
      n,
    ) && !/pode (montar|salvar|gravar)|posso (montar|salvar|gravar)|rascunho (pronto|salvo)|ficou r\$/.test(n)
  );
}

/** Resumo interno para a IA (nunca mostrar no chat). */
export function formatGoalFactsForModel(
  draft: GoalDraft,
  storeName: string,
  extras: string[] = [],
): string {
  const form = draft.form;
  const a = draft.assembly ?? emptyGoalAssembly();
  const period =
    form.startsOn && form.endsOn
      ? `${form.startsOn} a ${form.endsOn}`
      : "a definir";
  const missing = !goalDraftReady(form) ? missingGoalLabels(validateGoalDraft(form)) : [];
  const pending = goalAssemblyPendingSteps(draft);
  const nextHint = nextAssemblyHint(form, a);
  const snap = buildGoalConfigSnapshot(form, form.target);
  const payload = {
    nome: form.name || (form.startsOn ? defaultGoalName(form.startsOn) : "Meta"),
    filial: storeName || form.storeId || "?",
    periodo: period,
    periodo_destino: period,
    alvo_centavos: form.target,
    alvo_formatado: form.target != null ? brlCent(form.target) : null,
    proposedTarget: draft.proposedTarget ?? null,
    proposedTarget_formatado:
      draft.proposedTarget != null ? brlCent(draft.proposedTarget) : null,
    pendingCommit: draft.pendingCommit
      ? {
          versionId: draft.pendingCommit.versionId,
          awaitingConfirm: draft.pendingCommit.awaitingConfirm,
          authorized: draft.pendingCommit.authorized,
          target: draft.pendingCommit.target,
        }
      : null,
    modo: form.tierMode,
    niveis: formatTiersBrief(form.tiers),
    niveis_detalhe: snap.levels.map((l) => ({
      nome: l.name,
      atingimento: l.minAttainmentPct,
      comissao: l.commissionPct,
      bonus: l.bonus,
      gerencia_pct: l.managerPct,
    })),
    grupos: form.groups.length,
    grupos_detalhe: snap.groups,
    rateio_sem_id: form.spreadUnidentified,
    faltando: missing,
    periodConfirmed: a.periodConfirmed,
    valueDiscussed: a.valueDiscussed,
    path: a.path,
    confirmedGroups: a.confirmedGroups,
    confirmedSpread: a.confirmedSpread,
    confirmedTiers: a.confirmedTiers,
    confirmedMount: a.confirmedMount,
    pode_gravar_rascunho: goalCanPersist(draft),
    pendingConfigCopy: draft.pendingConfigCopy,
    copyStatus: draft.copyStatus ?? null,
    copyIntent: draft.copyIntent ?? null,
    copiedFrom: draft.copiedFrom
      ? {
          goalId: draft.copiedFrom.goalId,
          origem: `${draft.copiedFrom.from} a ${draft.copiedFrom.to}`,
          nome: draft.copiedFrom.name,
          tiers: draft.copiedFrom.tiers,
          groups: draft.copiedFrom.groups,
        }
      : null,
    userLockedTarget: draft.userLockedTarget === true,
    confianca_proposta: draft.proposal?.confidence ?? null,
    escada_resumo: `${form.tiers.length} niveis · modo ${form.tierMode} · ${form.groups.length} grupos`,
    config_no_rascunho: snap.chatBlocks,
    checklist_pendente: pending,
    proximo_passo_sugerido: nextHint,
    instrucao:
      "FONTE DA VERDADE = alvo_centavos (aplicado) e proposedTarget (so proposta). Nunca diga que aplicou proposedTarget sem aceite. Aceitar valor NÃO escolhe caminho de montagem. Se path=null, ofereça os 3 caminhos e espere escolha explícita — NÃO anuncie nem execute cópia sozinho. commit_draft SO se pode_gravar_rascunho (pendingCommit.authorized). Nao invente R$.",
    extras: extras.map((e) => e.trim()).filter(Boolean),
  };
  // Sem prosa em PT: o modelo copia texto longo. Sinal curto + JSON.
  return `[INTERNAL_GOAL_STATE] ${JSON.stringify(payload)}`;
}

/** @deprecated use formatGoalFactsForModel — mantido para testes/legado. */
export function formatGoalProposal(form: GoalDraftForm, storeName: string, assembly?: GoalAssembly | null): string {
  return formatGoalFactsForModel(
    { form, pendingConfigCopy: null, assembly: assembly ?? emptyGoalAssembly() },
    storeName,
  );
}

/**
 * O que ainda falta combinar na meta (além do R$). Ordem = fluxo natural no chat.
 * A IA deve avançar um item por vez via draft_goal — nunca só “vou preparar”.
 */
export function goalAssemblyPendingSteps(draft: GoalDraft): string[] {
  const form = draft.form;
  const a = draft.assembly ?? emptyGoalAssembly();
  const pending: string[] = [];
  if (!a.periodConfirmed) pending.push("mês/período da meta");
  if (!form.storeId) pending.push("filial");
  if (!a.valueDiscussed && form.target == null && draft.proposedTarget == null) {
    pending.push("proposta de valor-alvo (R$) — JARVIS calcula e propõe");
  } else if (form.target == null && draft.proposedTarget != null) {
    pending.push(
      `aceitar proposta ${brlCent(draft.proposedTarget)} ou informar outro R$ (proposta ainda não está no rascunho)`,
    );
  } else if (!a.valueDiscussed || form.target == null) {
    pending.push("definir valor-alvo (R$) no rascunho");
  }
  if (a.periodConfirmed && form.storeId && a.valueDiscussed && form.target != null) {
    if (a.path === null) {
      pending.push(
        "escolher caminho: copiar config anterior, criar com recomendações do JARVIS, ou montar do zero (aceitar valor ≠ escolher caminho)",
      );
    }
    if (draft.copyStatus === "failed") {
      pending.push("buscar de novo a escada/grupos do mês indicado (cópia falhou)");
    }
    if (a.path === "recommended" && !a.confirmedTiers) {
      pending.push("confirmar configuração recomendada (não é cópia automática)");
    }
    if (a.path === "fresh") {
      if (!a.confirmedGroups) pending.push("estrutura: individual / grupos / geral");
      if (!a.confirmedSpread) pending.push("venda sem vendedor identificado (rateio ou fora)");
      if (!a.confirmedTiers) {
        pending.push(`escada/níveis (inclui nível desafio %): ${formatTiersBrief(form.tiers)}`);
      }
    }
    if (a.path === "copy" && draft.copyStatus === "ok" && !a.confirmedMount) {
      pending.push(
        `conferir escada copiada (${form.tiers.length} níveis · ${form.tierMode} · ${form.groups.length} grupos) e salvar rascunho`,
      );
    } else if (
      a.path != null &&
      !a.confirmedMount &&
      draft.copyStatus !== "failed" &&
      !(a.path === "recommended" && !a.confirmedTiers)
    ) {
      pending.push("confirmação para salvar o rascunho em Metas");
    }
  }
  return pending;
}

function nextAssemblyHint(form: GoalDraftForm, assembly: GoalAssembly): string | null {
  const pending = goalAssemblyPendingSteps({
    form,
    pendingConfigCopy: null,
    assembly,
  });
  if (!pending.length) return null;
  return `perguntar/confirmar o proximo (um so): ${pending[0]}`;
}

/** silent = a IA fala; reply/facts so alimentam a tool. */
export type GoalDiscussVoice = "silent";

/** Ultima fala do user — o historico no Autorizar nao pode confirmar o checklist sozinho. */
export function lastUserUtterance(text: string): string {
  if (!/user:/i.test(text)) return text.trim();
  const parts = text.split(/\n(?=user:|jarvis:)/i).filter((p) => /^user:/i.test(p.trim()));
  const last = parts[parts.length - 1] ?? text;
  return last.replace(/^user:\s*/i, "").trim();
}

export type DiscussGoalOpts = {
  /** Mesmo id no eager + draft_goal → segunda chamada é no-op. */
  turnId?: string;
  /**
   * Intenção estruturada (LLM ou teste). Se omitida, usa interpretador estrutural.
   * O modelo NÃO muta o rascunho — só o motor aplica o plano.
   */
  intent?: GoalOpIntent | null;
  /**
   * Fontes de histórico para o caminho “recommended” (testes / injeção).
   * Se omitido, busca metas recentes da filial.
   */
  recentConfigs?: ConfigPatternSource[] | null;
  /** Escolha estruturada do componente (não depende do LLM). */
  forcedPath?: GoalAssemblyPath | null;
};

export type DiscussGoalResult = {
  reply: string;
  draft: GoalDraft;
  voice: GoalDiscussVoice;
  skipped?: boolean;
  /** Fala determinística deste turno (cópia / inspeção / pesos) — o Provider usa em vez do LLM. */
  spokenReply?: string | null;
  /** true só quando a cópia rodou neste turno (ok ou failed). */
  copyJustApplied?: boolean;
  /** Provider deve chamar authorizeGoal sem reinterpretar (pendingCommit.authorized). */
  shouldCommit?: boolean;
};

export async function discussGoal(
  question: string,
  ctx: JarvisContext,
  prev: GoalDraft | null,
  opts?: DiscussGoalOpts,
): Promise<DiscussGoalResult> {
  const turnId = opts?.turnId?.trim() || null;
  if (turnId && prev?.lastAppliedTurnId === turnId) {
    const storeName =
      ctx.network.find((s) => s.id === prev.form.storeId)?.tradeName ??
      ctx.stores.find((s) => s.id === prev.form.storeId)?.tradeName ??
      "";
    return {
      reply: formatGoalFactsForModel(prev, storeName, [
        "turno_ja_aplicado: true",
        "instrucao_fala: Estado ja atualizado neste turno. Fale o proximo passo; nao diga que vai montar de novo.",
      ]),
      draft: prev,
      voice: "silent",
      skipped: true,
      spokenReply: null,
      copyJustApplied: false,
    };
  }

  const prevStarts = prev?.form.startsOn ?? null;
  const prevEnds = prev?.form.endsOn ?? null;
  let form = prev?.form ?? emptyGoalForm(ctx.stores.length === 1 ? ctx.stores[0]!.id : "");
  let assembly: GoalAssembly = { ...(prev?.assembly ?? emptyGoalAssembly()) };
  let userLockedTarget = prev?.userLockedTarget === true;
  let proposal: GoalIntelligenceResult | null = prev?.proposal ?? null;
  const lastUser = lastUserUtterance(question);
  const qn = norm(lastUser);

  // P1: intenção semântica → plano determinístico (antes de mutar com R$/mês).
  const opIntent: GoalOpIntent =
    opts?.intent ??
    interpretGoalOpStructural(lastUser, {
      form,
      copiedFrom: prev?.copiedFrom ?? null,
      copyStatus: prev?.copyStatus ?? null,
      today: ctx.today,
    });
  const opPlan = planGoalOpFromIntent(opIntent, {
    form,
    copiedFrom: prev?.copiedFrom ?? null,
    copyStatus: prev?.copyStatus ?? null,
    today: ctx.today,
  });

  const periodSaidNow =
    !opPlan.freezeDestinationPeriod && parseGoalPeriod(lastUser, ctx.today) != null;
  // R$ só conta se veio na FALA do Gestor — nunca amountCents inventado pelo interpret_goal_op.
  const utteredAmount = parseGoalTarget(lastUser);
  // Decisão única de valor (stance → o que o motor pode aplicar). Aceite contextual
  // usa proposedTarget; R$ livre só se estiver na fala.
  const proposalAwaitingEarly = hasProposalAwaitingAccept({
    form: { target: form.target },
    proposedTarget: prev?.proposedTarget ?? null,
  });
  const valueDecision = resolveGoalValueDecision({
    text: lastUser,
    utteredAmount,
    proposedTarget: prev?.proposedTarget ?? null,
    proposalAwaiting: proposalAwaitingEarly,
    saveAwaiting: prev?.pendingCommit?.awaitingConfirm === true,
    scenarios: prev?.proposal?.scenarios ?? null,
  });
  const valueStance = valueDecision.stance;
  // Contraproposta com R$ na fala trava meta-base mesmo se o LLM marcou amountRole=unknown.
  const counterLocksBase =
    valueDecision.applySource === "uttered" &&
    utteredAmount != null &&
    opIntent.amountRole !== "tier_threshold";
  const blockDirectLock = opPlan.blockDirectTargetLock && !counterLocksBase;
  // lockedTarget = só R$ falado (applySource uttered). Aceite de proposta NÃO passa por aqui.
  const lockedTarget =
    blockDirectLock || opIntent.amountRole === "tier_threshold"
      ? null
      : valueDecision.applySource === "uttered"
        ? valueDecision.applyAmount
        : null;
  // “Aceito a recomendada” contém “recomend” — não é pedido de nova sugestão.
  const asksSuggestion =
    looksLikeAskValueSuggestion(lastUser) &&
    !valueDecision.keepDiscussing &&
    valueStance !== "explicit_accept";

  form = mergeGoalUtterance(form, question, ctx);
  // Consultiva / info: merge não pode “aceitar” valor por eco de R$ antigo no blob.
  if (valueDecision.keepDiscussing && utteredAmount == null) {
    form = { ...form, target: prev?.form.target ?? null };
  }

  // Nova operação: outra filial / “criar meta da Loja X” — NÃO herda valor/níveis/confirmações.
  const prevStoreId = prev?.form.storeId || "";
  const storeChanged =
    !!form.storeId && !!prevStoreId && form.storeId !== prevStoreId;
  const explicitReuse = looksLikeExplicitConfigReuse(lastUser);
  const startNewOp =
    looksLikeStartNewGoalOp(lastUser) &&
    (storeChanged || prev?.lastSave != null || prev?.pendingCommit?.authorized === true);
  let operationId = prev?.operationId || newGoalOperationId();
  let resetForNewStore = false;
  if ((storeChanged || startNewOp) && !explicitReuse) {
    const keepStore = form.storeId || prevStoreId;
    const keepStarts = form.startsOn || prev?.form.startsOn || null;
    const keepEnds =
      form.endsOn ||
      (keepStarts ? endOfMonth(keepStarts) : null) ||
      prev?.form.endsOn ||
      null;
    form = {
      ...emptyGoalForm(keepStore),
      startsOn: keepStarts,
      endsOn: keepEnds,
      name: keepStarts ? defaultGoalName(keepStarts) : "",
    };
    assembly = {
      ...emptyGoalAssembly(),
      periodConfirmed: Boolean(keepStarts && (periodSaidNow || prev?.assembly?.periodConfirmed)),
      valueDiscussed: false,
      path: null,
    };
    userLockedTarget = false;
    proposal = null;
    operationId = newGoalOperationId();
    resetForNewStore = true;
  }

  // Origem/menção de mês NÃO pode alterar o destino (novembro permanece novembro).
  if (opPlan.freezeDestinationPeriod && prevStarts && !resetForNewStore) {
    form = { ...form, startsOn: prevStarts, endsOn: prevEnds };
  }
  // Troca inequívoca de destino (ex.: novembro → dezembro).
  if (
    opIntent.entity === "period_destination" &&
    opIntent.periodMonth &&
    opIntent.authorizeApply
  ) {
    const startsOn = `${opIntent.periodMonth}-01`;
    form = ensureGoalName({ ...form, startsOn, endsOn: endOfMonth(startsOn) });
  }
  // Simulação / nível absoluto: merge não pode gravar o R$ em form.target.
  if (
    (looksLikeSimulateLevelsAtAmount(lastUser) || blockDirectLock) &&
    prev?.form.target != null
  ) {
    form = { ...form, target: prev.form.target };
  } else if (blockDirectLock && prev?.form.target == null) {
    form = { ...form, target: null };
  }

  // Periodo mudou (ex.: maio → novembro): nao reaproveitar valor do mes antigo.
  if (prevStarts && form.startsOn && prevStarts !== form.startsOn && lockedTarget == null) {
    form = { ...form, target: null };
    assembly = { ...emptyGoalAssembly(), periodConfirmed: periodSaidNow };
    userLockedTarget = false;
    proposal = null;
  }
  // R$ como meta-base explícita — nunca quando o R$ é limiar de nível.
  if (lockedTarget != null && !looksLikeSimulateLevelsAtAmount(lastUser) && !blockDirectLock) {
    form = { ...form, target: lockedTarget };
    userLockedTarget = true;
  }

  if (periodSaidNow) assembly = { ...assembly, periodConfirmed: true };
  // Aceite curto do mês sugerido (“esse”, “próximo”, “pode ser”).
  if (
    !assembly.periodConfirmed &&
    form.startsOn &&
    /^(esse|essa|isso|proximo|próximo|pode ser|fechado|ok|sim)(\b|,|$)/.test(qn)
  ) {
    assembly = { ...assembly, periodConfirmed: true };
  }
  // Continuação do fio (copiar escada / valor / R$ no nível) com mês já no form (histórico).
  if (
    !assembly.periodConfirmed &&
    form.startsOn &&
    (looksLikeAcceptConfigCopy(lastUser) ||
      parseConfigSourceMonth(lastUser, ctx.today, form.startsOn) != null ||
      lockedTarget != null ||
      looksLikeGoalLadderTalk(lastUser) ||
      looksLikeAskValueSuggestion(lastUser))
  ) {
    assembly = { ...assembly, periodConfirmed: true };
  }

  // Nao inventar mês sozinho — tipa proximo mes; a IA pergunta.
  if (!assembly.periodConfirmed) {
    if (!form.startsOn) {
      const tipStarts = shiftMonthStart(ctx.today, 1);
      form = ensureGoalName({ ...form, startsOn: tipStarts, endsOn: endOfMonth(tipStarts), target: null });
    }
    if (!form.storeId && ctx.stores.length === 1) form = { ...form, storeId: ctx.stores[0]!.id };
    const draftEarly: GoalDraft = {
      form: { ...form, target: null },
      pendingConfigCopy: null,
      assembly: { ...assembly, periodConfirmed: false, valueDiscussed: false },
      lastAppliedTurnId: turnId,
      userLockedTarget: false,
      proposal: null,
      copyStatus: null,
      copiedFrom: null,
    };
    const storeEarly =
      ctx.network.find((s) => s.id === draftEarly.form.storeId)?.tradeName ??
      ctx.stores.find((s) => s.id === draftEarly.form.storeId)?.tradeName ??
      "";
    return {
      reply: formatGoalFactsForModel(draftEarly, storeEarly, [
        `mes_sugerido_label: ${monthYearTitle(form.startsOn!)}`,
      ]),
      draft: draftEarly,
      voice: "silent",
    };
  }

  form = ensureGoalName(form);
  // Uma loja no filtro → usa sem perguntar. Rede / várias → exige escolha explícita.
  if (!form.storeId && ctx.stores.length === 1) form = { ...form, storeId: ctx.stores[0]!.id };
  if (!form.storeId && needsStorePickForWrite(ctx)) {
    const draftStore: GoalDraft = {
      form,
      pendingConfigCopy: null,
      assembly,
      lastAppliedTurnId: turnId,
      userLockedTarget,
      proposal,
      copyStatus: prev?.copyStatus ?? null,
      copiedFrom: prev?.copiedFrom ?? null,
      copyIntent: prev?.copyIntent ?? null,
    };
    const monthLabel = form.startsOn ? monthYearTitle(form.startsOn) : null;
    const ask = speakAskGoalStore(ctx, { monthLabel });
    return {
      reply: formatGoalFactsForModel(draftStore, "", [
        "instrucao_fala: Falta a filial. Pergunte de qual loja — nao invente filial nem siga sem storeId.",
      ]),
      draft: draftStore,
      voice: "silent",
      spokenReply: ask,
    };
  }

  const isConfirm =
    /autorizo|pode criar|ok pode|ok(,| )?vamos criar|salva(r)? (o )?rascunho|pode montar|monta (o )?rascunho/.test(qn) ||
    /^(ok[, ]*)?(cria(r)?|vamos criar) (essa |a |o )?meta( agora| ja| já)?[!?.]*$/.test(qn);

  // Sem valor ainda: PROPÕE sem aplicar em form.target (P0).
  // Nova operação (troca de filial): não auto-propõe nem herda copyStatus — fala intro e segue.
  if (
    !resetForNewStore &&
    lockedTarget == null &&
    !userLockedTarget &&
    !asksSuggestion &&
    !assembly.valueDiscussed &&
    form.target == null &&
    !isConfirm
  ) {
    const periodEarly =
      form.startsOn && form.endsOn ? { from: form.startsOn, to: form.endsOn } : null;
    const suggestedEarly =
      form.storeId ? await suggestGoalTarget(ctx, form.storeId, periodEarly) : null;
    if (suggestedEarly) {
      assembly = { ...assembly, valueDiscussed: true };
      proposal = suggestedEarly;
      const storeEarly =
        ctx.network.find((s) => s.id === form.storeId)?.tradeName ??
        ctx.stores.find((s) => s.id === form.storeId)?.tradeName ??
        "";
      const draftProp: GoalDraft = {
        form: { ...form, target: null },
        pendingConfigCopy: null,
        assembly,
        proposal: suggestedEarly,
        proposedTarget: suggestedEarly.amount,
        userLockedTarget: false,
        pendingCommit: null,
        lastAppliedTurnId: turnId,
        copyStatus: prev?.copyStatus ?? null,
        copiedFrom: prev?.copiedFrom ?? null,
        copyIntent: prev?.copyIntent ?? null,
      };
      return {
        reply: formatGoalFactsForModel(draftProp, storeEarly, [
          `proposta_meta:\n${suggestedEarly.chatBlocks.join("\n")}`,
          `cenarios: ${suggestedEarly.scenarios.map((s) => `${s.label}=${brlCent(s.amount)}`).join(" · ")}`,
          `confianca: ${suggestedEarly.confidence}`,
          `racional: ${suggestedEarly.rationale}`,
          "instrucao_fala: Apresente a RECOMENDADA como proposta. Deixe claro que ainda NAO entrou no rascunho. Pergunte se aceita (ex.: aceito a recomendada) ou diga outro R$. Nao diga que ja aplicou.",
        ]),
        draft: draftProp,
        voice: "silent",
        spokenReply: scrubTechnicalSpeech(suggestedEarly.chatBlocks.join("\n\n")),
      };
    }
    const bias = seasonalBiasForPeriod(form.startsOn!, form.endsOn!);
    const draftVal: GoalDraft = {
      form: { ...form, target: null },
      pendingConfigCopy: null,
      assembly,
      lastAppliedTurnId: turnId,
      userLockedTarget: false,
      proposal: null,
    };
    const storeVal =
      ctx.network.find((s) => s.id === form.storeId)?.tradeName ??
      ctx.stores.find((s) => s.id === form.storeId)?.tradeName ??
      "";
    return {
      reply: formatGoalFactsForModel(draftVal, storeVal, [
        bias.lines.length ? `sazonal_do_mes: ${speakSeasonalBiasBreakdown(bias)}` : "",
        "instrucao_fala: Sem base pra calcular ainda. Peca so o dado que falta (filial/periodo), nunca 'qual valor voce quer'.",
      ]),
      draft: draftVal,
      voice: "silent",
    };
  }

  if (asksSuggestion || lockedTarget != null) {
    assembly = { ...assembly, valueDiscussed: true };
  }
  // Nova sugestão: só atualiza proposedTarget — não sobrescreve form.target.
  // Nova operação / troca de filial: não herda proposta nem locks da meta anterior.
  let proposedTarget: number | null = resetForNewStore ? null : (prev?.proposedTarget ?? null);
  if (resetForNewStore) {
    proposal = null;
  }
  if (asksSuggestion && lockedTarget == null && form.storeId && form.startsOn) {
    const suggested = await suggestGoalTarget(ctx, form.storeId, {
      from: form.startsOn,
      to: form.endsOn!,
    });
    if (suggested) {
      proposal = suggested;
      proposedTarget = suggested.amount;
      // Não toca form.target nem userLockedTarget.
    }
  }
  // Proposta vinda de faturamento-em-nível (P1) — sem aplicar.
  let tierRevenueHint = prev?.tierRevenueHint ?? null;
  if (opPlan.proposedTarget != null && opPlan.blockDirectTargetLock) {
    proposedTarget = opPlan.proposedTarget;
    if (opPlan.tierProposal) {
      tierRevenueHint = {
        amountAtLevel: opPlan.tierProposal.amountAtLevel,
        attainmentPct: opPlan.tierProposal.attainmentPct,
        proposedBase: opPlan.tierProposal.proposedBase,
        tierName: opPlan.tierProposal.tierName,
      };
    }
  }
  if (lockedTarget != null && opIntent.amountRole === "store_base") {
    tierRevenueHint = null;
  }

  // Aplicação de valor: só via valueDecision (aceite de proposta / cenário / R$ falado).
  // Aceite contextual NÃO exige R$ na fala — usa proposedTarget. Nunca autoriza gravação.
  let justAcceptedProposal = false;
  {
    const saveAwaiting = prev?.pendingCommit?.awaitingConfirm === true;
    const applyDecision = resolveGoalValueDecision({
      text: lastUser,
      utteredAmount,
      proposedTarget,
      proposalAwaiting: hasProposalAwaitingAccept({ form, proposedTarget }),
      saveAwaiting,
      scenarios: proposal?.scenarios ?? null,
    });
    if (
      lockedTarget == null &&
      (applyDecision.applySource === "pending_proposal" ||
        applyDecision.applySource === "named_scenario") &&
      applyDecision.applyAmount != null
    ) {
      form = { ...form, target: applyDecision.applyAmount };
      proposedTarget = applyDecision.applyAmount;
      userLockedTarget = true;
      assembly = { ...assembly, valueDiscussed: true };
      justAcceptedProposal = true;
    }
  }
  if (lockedTarget != null) {
    proposedTarget = lockedTarget;
  }

  // Caminho de montagem (copy | recommended | fresh) — separado do aceite do valor.
  const pathChoice = opts?.forcedPath ?? parseGoalAssemblyPath(lastUser);
  const switchingPath =
    pathChoice != null && assembly.path != null && pathChoice !== assembly.path;
  let pathOfferPresented = prev?.pathOfferPresented === true;
  // Troca de caminho invalida confirmações de montagem / gravação da config anterior.
  if (switchingPath) {
    assembly = {
      ...assembly,
      confirmedGroups: false,
      confirmedSpread: false,
      confirmedTiers: false,
      confirmedMount: false,
    };
  }

  // Copia: só com intenção explícita de copiar / path=copy — nunca por aceite de valor.
  // freezeDestinationPeriod bloqueia reentrada por FATO de escada; pedido explícito de cópia passa.
  const skipCopyReentry =
    opPlan.freezeDestinationPeriod &&
    (opIntent.entity === "ladder" || opIntent.periodRole === "mention") &&
    pathChoice !== "copy" &&
    !looksLikeExplicitConfigCopy(lastUser);
  const selectingCopy =
    !resetForNewStore &&
    !skipCopyReentry &&
    !justAcceptedProposal &&
    (pathChoice === "copy" ||
      looksLikeExplicitConfigCopy(lastUser) ||
      (looksLikeBareCopyAccept(lastUser) &&
        prev?.assembly?.path === "copy" &&
        prev.copyStatus !== "ok" &&
        prev.pendingConfigCopy != null));

  let sourceWin = skipCopyReentry
    ? null
    : selectingCopy
      ? parseConfigSourceMonth(lastUser, ctx.today, form.startsOn)
      : null;
  if (
    !sourceWin &&
    selectingCopy &&
    opIntent.periodMonth &&
    (opIntent.entity === "period_origin" ||
      (opIntent.periodRole === "origin" && /copiar|copia|mesma configura|referencia|referência/.test(qn)))
  ) {
    const from = `${opIntent.periodMonth}-01`;
    sourceWin = { from, to: endOfMonth(from) };
  }
  if (!sourceWin && !skipCopyReentry && looksLikeLadderCopyCorrection(lastUser)) {
    sourceWin =
      prev?.pendingConfigCopy ??
      (prev?.copiedFrom
        ? { from: prev.copiedFrom.from, to: prev.copiedFrom.to }
        : null);
    if (!sourceWin && /outubro/.test(qn)) {
      const y = Number((form.startsOn || ctx.today).slice(0, 4));
      const from = `${y}-10-01`;
      sourceWin = { from, to: endOfMonth(from) };
    }
    if (!sourceWin && form.storeId && form.startsOn) {
      const prior = await findPriorGoalForStore(ctx, form.storeId, form.startsOn);
      if (prior) sourceWin = { from: prior.from, to: prior.to };
    }
  }
  if (!sourceWin && selectingCopy) {
    sourceWin = prev?.pendingConfigCopy ?? null;
    if (!sourceWin && form.storeId && form.startsOn) {
      const prior = await findPriorGoalForStore(ctx, form.storeId, form.startsOn);
      if (prior) sourceWin = { from: prior.from, to: prior.to };
    }
  }
  // Já tem cópia ok e o Gestor só inspeciona — nunca rebuscar destino (novembro).
  if (
    sourceWin &&
    prev?.copyStatus === "ok" &&
    looksLikeInspectGoalDraft(lastUser) &&
    !looksLikeLadderCopyCorrection(lastUser)
  ) {
    sourceWin = null;
  }

  let copiedLadder = false;
  let copyStatus: GoalDraft["copyStatus"] = switchingPath && pathChoice !== "copy"
    ? null
    : (prev?.copyStatus ?? null);
  let copiedFrom: GoalCopiedFrom | null =
    switchingPath && pathChoice !== "copy" ? null : (prev?.copiedFrom ?? null);
  let copyIntent: GoalCopyIntent | null =
    switchingPath && pathChoice !== "copy" ? null : (prev?.copyIntent ?? null);
  let configSnapshotBlocks: string[] = [];
  let weightAdviceBlocks: string[] = [];
  let patternBlocks: string[] = [];
  let pathOfferBlocks: string[] = [];
  let recommendedJustApplied = false;
  let skipAssemblyParse = false;

  const selectingRecommended =
    !resetForNewStore &&
    !justAcceptedProposal &&
    (pathChoice === "recommended" ||
      (assembly.path === "fresh" && looksLikeChooseRecommendedPath(lastUser)));
  const selectingFresh =
    !resetForNewStore &&
    !justAcceptedProposal &&
    (pathChoice === "fresh" ||
      (assembly.path == null &&
        looksLikeDeclineConfigCopy(lastUser) &&
        /monta (do )?zero|sem copia|nova configura|prefiro montar|quero montar|do zero/.test(qn)));

  if (sourceWin && (selectingCopy || looksLikeLadderCopyCorrection(lastUser))) {
    const pool = ctx.network.length > 0 ? ctx.network : ctx.stores;
    const matched = matchStoresInText(lastUser, pool);
    const source = pickConfigSourceStore(lastUser, matched);
    copyIntent = parseGoalCopyIntent(lastUser);
    const copied = await copyGoalLadderFromPeriod(form, ctx, sourceWin, source?.id);
    form = copied.form;
    copiedLadder = copied.ok;
    copyStatus = copied.ok ? "ok" : "failed";
    if (copied.ok && copied.copiedFrom) copiedFrom = copied.copiedFrom;
    if (
      copied.ok &&
      looksLikeGoalLadderTalk(lastUser) &&
      /10\s*%|por cento a mais|\d+\s*%\s*(a mais)?|nivel desafio|meta desafio/.test(qn) &&
      !/ultimo nivel.{0,48}(r\$|\d)/.test(qn)
    ) {
      form = { ...form, tiers: applyChallengeTierPct(form.tiers, 110) };
    }
    if (copied.ok) {
      const snap = buildGoalConfigSnapshot(form, form.target);
      configSnapshotBlocks = snap.chatBlocks;
      if (form.groups.length >= 2 && form.storeId) {
        const weights = await suggestGroupWeightsFromSales(ctx, form.storeId, form.groups);
        if (weights?.chatBlocks.length) {
          weightAdviceBlocks =
            copyIntent === "exact"
              ? [
                  ...weights.chatBlocks.slice(0, 2),
                  "Como pediu cópia fiel, mantive os pesos originais no rascunho. " +
                    (weights.caveat
                      ? "Se quiser, no próximo passo avaliamos a distribuição com base nas vendas."
                      : "Os pesos batem com a participação recente."),
                ]
              : weights.chatBlocks;
        }
      }
      assembly = {
        ...assembly,
        path: "copy",
        confirmedGroups: true,
        confirmedSpread: true,
        confirmedTiers: true,
        confirmedMount: false,
      };
    } else if (prev?.copyStatus === "ok" && prev.form.tiers.length > 0 && !switchingPath) {
      form = prev.form;
      copyStatus = "ok";
      copiedFrom = prev.copiedFrom ?? copiedFrom;
      assembly = prev.assembly ?? assembly;
      logGoalCopy("copy_retry_kept_prev", {
        originFrom: sourceWin.from,
        destFrom: form.startsOn,
      });
    } else {
      assembly = {
        ...assembly,
        path: "copy",
        confirmedGroups: false,
        confirmedSpread: false,
        confirmedTiers: false,
        confirmedMount: false,
      };
    }
    skipAssemblyParse = true;
  } else if (selectingCopy && !sourceWin) {
    // Pediu copiar mas não achou janela — marca falha; não finge escada default.
    copyStatus = "failed";
    assembly = {
      ...assembly,
      path: "copy",
      confirmedGroups: false,
      confirmedSpread: false,
      confirmedTiers: false,
      confirmedMount: false,
    };
    skipAssemblyParse = true;
  } else if (selectingRecommended) {
    copyStatus = null;
    copiedFrom = null;
    copyIntent = null;
    assembly = {
      ...assembly,
      path: "recommended",
      confirmedGroups: false,
      confirmedSpread: false,
      confirmedTiers: false,
      confirmedMount: false,
    };
    skipAssemblyParse = true;
    const recent =
      opts?.recentConfigs != null
        ? opts.recentConfigs
        : form.storeId && form.startsOn
          ? await fetchRecentGoalConfigs(ctx, form.storeId, form.startsOn)
          : [];
    const inferred = inferConfigPatternFromHistory(recent);
    if (inferred) {
      form = applyConfigPatternToForm(form, inferred.pattern);
      patternBlocks = [
        ...inferred.chatBlocks,
        "Isso é proposta recomendada a partir do histórico — não é cópia fiel de um mês. Confirme ou ajuste antes de gravar.",
      ];
      configSnapshotBlocks = buildGoalConfigSnapshot(form, form.target).chatBlocks;
      recommendedJustApplied = true;
      if (form.groups.length >= 2 && form.storeId) {
        const weights = await suggestGroupWeightsFromSales(ctx, form.storeId, form.groups);
        if (weights?.chatBlocks.length) {
          weightAdviceBlocks = [
            ...weights.chatBlocks,
            "Pesos sugeridos pela venda recente — ainda não aplicados no rascunho.",
          ];
        }
      }
      assembly = {
        ...assembly,
        path: "recommended",
        confirmedGroups: form.groups.length > 0,
        confirmedSpread: true,
        confirmedTiers: false,
        confirmedMount: false,
      };
    } else {
      patternBlocks = [
        "Não tenho histórico suficiente nesta filial para montar uma configuração recomendada com confiança.",
        "Prefere copiar uma meta específica (se houver) ou montar do zero comigo, passo a passo?",
      ];
      assembly = {
        ...assembly,
        path: null,
        confirmedGroups: false,
        confirmedSpread: false,
        confirmedTiers: false,
        confirmedMount: false,
      };
    }
  } else if (selectingFresh) {
    // Do zero: não aplica padrão histórico sozinho (isso é o caminho recommended).
    const keepTarget = form.target;
    const keepStarts = form.startsOn;
    const keepEnds = form.endsOn;
    const keepStore = form.storeId;
    const keepName = form.name;
    form = {
      ...emptyGoalForm(keepStore),
      name: keepName,
      startsOn: keepStarts,
      endsOn: keepEnds,
      target: keepTarget,
    };
    form = ensureGoalName(form);
    assembly = {
      ...emptyGoalAssembly(),
      periodConfirmed: true,
      valueDiscussed: keepTarget != null,
      path: "fresh",
    };
    copyStatus = null;
    copiedFrom = null;
    copyIntent = null;
    skipAssemblyParse = false; // permite parsear grupos/níveis na mesma fala
  }

  const period =
    form.startsOn && form.endsOn ? { from: form.startsOn, to: form.endsOn } : null;

  let suggestionBlocks: string[] = [];
  const wantsValueHelp =
    !isConfirm &&
    lockedTarget == null &&
    assembly.path == null &&
    asksSuggestion &&
    form.storeId;

  if (wantsValueHelp) {
    const suggested = await suggestGoalTarget(ctx, form.storeId, period);
    if (suggested != null) {
      suggestionBlocks = suggested.chatBlocks;
      assembly = { ...assembly, valueDiscussed: true };
      proposal = suggested;
      proposedTarget = suggested.amount;
      // P0: não escreve form.target.
    }
  }
  // Alvo falado pelo Gestor ("270 mil") — não aplica se for limiar de nível / simulação.
  if (
    lockedTarget != null &&
    !looksLikeSimulateLevelsAtAmount(lastUser) &&
    !blockDirectLock
  ) {
    form = { ...form, target: lockedTarget };
    assembly = { ...assembly, valueDiscussed: true };
    userLockedTarget = true;
    proposedTarget = lockedTarget;
  }

  form = ensureGoalName(form);
  const basicsReady = goalDraftReady(form);

  let pendingConfigCopy: GoalDraft["pendingConfigCopy"] =
    assembly.path === "copy" && copyStatus === "ok" ? null : (prev?.pendingConfigCopy ?? null);
  let pathOfferPriorLabel: string | null = null;
  // Oferta de caminho: só após valor EFETIVAMENTE aceito (não basta proposedTarget).
  const valueJustLocked =
    justAcceptedProposal ||
    (lockedTarget != null && form.target === lockedTarget && userLockedTarget);
  const mayOfferAssemblyPath =
    basicsReady &&
    assembly.valueDiscussed &&
    assembly.path == null &&
    userLockedTarget &&
    form.target != null &&
    !copiedLadder &&
    form.storeId &&
    form.startsOn &&
    !valueDecision.keepDiscussing;
  if (mayOfferAssemblyPath && form.storeId && form.startsOn && form.target != null) {
    const storeId = form.storeId;
    const startsOn = form.startsOn;
    const prior = await findPriorGoalForStore(ctx, storeId, startsOn);
    if (prior) {
      // Referência disponível para o caminho copy — NÃO seleciona path nem executa cópia.
      pendingConfigCopy = { from: prior.from, to: prior.to };
      pathOfferPriorLabel = monthYearTitle(prior.from);
    } else {
      pendingConfigCopy = null;
    }
    // Texto só no turno em que o valor acaba de ser aceito/travado — componente cobre o resto.
    if (valueJustLocked || !pathOfferPresented) {
      pathOfferBlocks = [
        speakGoalAssemblyPathOffer({
          target: form.target,
          destLabel: monthYearTitle(startsOn),
          hasPrior: prior != null,
          priorLabel: pathOfferPriorLabel,
        }),
      ];
    }
  }

  // Confirma proposta do caminho recommended.
  if (
    basicsReady &&
    assembly.path === "recommended" &&
    !assembly.confirmedTiers &&
    !recommendedJustApplied &&
    /^(sim|pode|ok|fechado|confirma|confirmo|serve|topa)(\b|,|$)/.test(qn)
  ) {
    assembly = {
      ...assembly,
      confirmedGroups: true,
      confirmedSpread: true,
      confirmedTiers: true,
      confirmedMount: false,
    };
    skipAssemblyParse = true;
  }

  // Montagem guiada (fresh): estrutura → rateio → níveis — vários slots na mesma fala.
  if (basicsReady && assembly.path === "fresh" && !skipAssemblyParse) {
    if (!assembly.confirmedGroups) {
      const choice = parseGroupsDistributionChoice(lastUser);
      if (choice != null) {
        if (choice) {
          form = {
            ...form,
            tierMode: form.tierMode === "GENERAL" ? "GROUP" : form.tierMode === "INDIVIDUAL" ? "GROUP" : form.tierMode,
          };
        }
        assembly = { ...assembly, confirmedGroups: true };
      }
    }
    if (assembly.confirmedGroups && !assembly.confirmedSpread) {
      const choice = parseSpreadUnidentifiedChoice(lastUser);
      if (choice != null) {
        form = { ...form, spreadUnidentified: choice };
        assembly = { ...assembly, confirmedSpread: true };
      }
    }
    if (assembly.confirmedGroups && assembly.confirmedSpread && !assembly.confirmedTiers) {
      if (looksLikeConfirmTiers(lastUser)) {
        assembly = { ...assembly, confirmedTiers: true };
      }
    }
  }

  // Pediu análise dos pesos — calcula (não aplica) para a fala determinística.
  let weightAdviceForSpeak: {
    chatBlocks: string[];
    caveat: string | null;
    same: boolean;
  } | null = null;
  if (looksLikeAskGroupWeightAdvice(lastUser) && form.groups.length >= 2 && form.storeId) {
    const weights = await suggestGroupWeightsFromSales(ctx, form.storeId, form.groups);
    if (weights) {
      weightAdviceBlocks = weights.chatBlocks;
      const same =
        weights.current.length === weights.suggested.length &&
        weights.current.every((c, i) => c.pct === weights.suggested[i]?.pct);
      weightAdviceForSpeak = {
        chatBlocks: weights.chatBlocks,
        caveat: weights.caveat,
        same,
      };
    }
  }

  // Gestor autoriza aplicar pesos recomendados (não acontece sozinho).
  if (
    form.groups.length >= 2 &&
    form.storeId &&
    /aplica (a |os )?(peso|pesos|recomend|distribu)|usa (a |os )?peso|quero (a )?recomend|pode (mudar|ajustar) (os )?peso/.test(
      qn,
    )
  ) {
    const weights = await suggestGroupWeightsFromSales(ctx, form.storeId, form.groups);
    if (weights && weights.suggested.length === form.groups.length) {
      form = {
        ...form,
        groups: form.groups.map((g, i) => ({
          ...g,
          pct: weights.suggested[i]?.pct ?? g.pct,
        })),
      };
      weightAdviceBlocks = [
        `Apliquei os pesos recomendados: ${weights.suggested.map((s) => `${s.name} ${s.pct}%`).join(" / ")}.`,
      ];
      const snap = buildGoalConfigSnapshot(form, form.target);
      configSnapshotBlocks = snap.chatBlocks;
      weightAdviceForSpeak = {
        chatBlocks: weightAdviceBlocks,
        caveat: null,
        same: false,
      };
    }
  }

  // confirmedMount = config ok para OFERTAR save — não autoriza DB.
  if (
    basicsReady &&
    !skipAssemblyParse &&
    assembly.path != null &&
    assembly.confirmedGroups &&
    assembly.confirmedSpread &&
    assembly.confirmedTiers &&
    !assembly.confirmedMount &&
    looksLikeConfirmMount(lastUser) &&
    !looksLikeRequestSave(lastUser)
  ) {
    assembly = { ...assembly, confirmedMount: true };
  }
  if (
    basicsReady &&
    assembly.path != null &&
    assembly.confirmedGroups &&
    assembly.confirmedSpread &&
    assembly.confirmedTiers &&
    looksLikeRequestSave(lastUser)
  ) {
    assembly = { ...assembly, confirmedMount: true };
  }

  const storeRef =
    ctx.network.find((s) => s.id === form.storeId) ??
    ctx.stores.find((s) => s.id === form.storeId) ??
    null;
  const storeName = storeRef ? friendlyStoreLabel(storeRef) : "";

  // Inspecionar rascunho: snapshot sempre no estado (mesmo sem cópia neste turno).
  if (
    (copyStatus === "ok" || looksLikeInspectGoalDraft(lastUser)) &&
    configSnapshotBlocks.length === 0
  ) {
    configSnapshotBlocks = buildGoalConfigSnapshot(form, form.target).chatBlocks;
  }

  if (resetForNewStore) {
    copyStatus = null;
    copiedFrom = null;
    copyIntent = null;
    pendingConfigCopy = null;
    pathOfferPresented = false;
    tierRevenueHint = null;
    configSnapshotBlocks = [];
    patternBlocks = [];
    weightAdviceBlocks = [];
  }

  let draftOut: GoalDraft = {
    form,
    operationId: operationId || newGoalOperationId(),
    pendingConfigCopy: resetForNewStore ? null : pendingConfigCopy,
    assembly,
    copyStatus: resetForNewStore ? null : (copyStatus ?? null),
    copiedFrom: resetForNewStore ? null : copiedFrom,
    lastAppliedTurnId: turnId,
    userLockedTarget,
    proposal,
    proposedTarget,
    tierRevenueHint,
    pendingCommit: resetForNewStore ? null : (prev?.pendingCommit ?? null),
    // lastSave = histórico consultivo da operação anterior; não é config aplicada.
    lastSave: prev?.lastSave ?? null,
    copyIntent,
    pathOfferPresented:
      assembly.path != null ? false : pathOfferPresented || pathOfferBlocks.length > 0,
  };

  // Qualquer mudança de fingerprint invalida confirmação pendente.
  if (draftOut.pendingCommit && !pendingCommitStillValid(draftOut)) {
    draftOut = clearPendingCommit(draftOut);
  }
  if (resetForNewStore) {
    draftOut = { ...draftOut, pendingCommit: null, pathOfferPresented: false };
  }

  let shouldCommit = false;
  let justPresentedCommit = false;
  const hadAwaitingCommit = prev?.pendingCommit?.awaitingConfirm === true;
  const saveReady =
    goalConfigReadyForSaveOffer(draftOut) && !looksLikeAskGroupWeightAdvice(lastUser);

  if (
    // 1) SIM com pending aguardando → autoriza gravação (P0).
    hadAwaitingCommit &&
    draftOut.pendingCommit &&
    (looksLikeConfirmPendingSave(lastUser) || looksLikeRequestSave(lastUser)) &&
    pendingCommitStillValid(draftOut) &&
    !looksLikeAskGroupWeightAdvice(lastUser) &&
    !justAcceptedProposal
  ) {
    draftOut = {
      ...draftOut,
      pendingCommit: {
        ...draftOut.pendingCommit,
        awaitingConfirm: false,
        authorized: true,
      },
      assembly: { ...assembly, confirmedMount: true },
    };
    shouldCommit = goalCanPersist(draftOut);
  } else if (
    // 2) SIM sem pending (LLM pediu confirmação sozinho) + config já “pronta pra gravar”
    // no turno anterior → autoriza. Não confundir com aceite de proposta de valor.
    !hadAwaitingCommit &&
    !draftOut.pendingCommit &&
    !justAcceptedProposal &&
    prev?.assembly?.confirmedMount === true &&
    saveReady &&
    looksLikeConfirmPendingSave(lastUser) &&
    form.target != null
  ) {
    const pending = createPendingCommit(draftOut, storeName);
    draftOut = {
      ...draftOut,
      pendingCommit: {
        ...pending,
        awaitingConfirm: false,
        authorized: true,
      },
      assembly: { ...assembly, confirmedMount: true },
    };
    shouldCommit = goalCanPersist(draftOut);
  } else if (
    // 3) Pediu salvar / “pode seguir” → apresenta resumo e AGUARDA SIM (não grava neste turno).
    saveReady &&
    (looksLikeRequestSave(lastUser) || looksLikeProceedToSaveOffer(lastUser)) &&
    !looksLikeConfirmPendingSave(lastUser) // “sim” solto cai no ramo 1/2
  ) {
    const pending = createPendingCommit(draftOut, storeName);
    draftOut = {
      ...draftOut,
      pendingCommit: pending,
      assembly: { ...assembly, confirmedMount: true },
    };
    justPresentedCommit = true;
  }
  logGoalCopy("turn_state", {
    turnId,
    copyStatus,
    path: assembly.path,
    destFrom: form.startsOn,
    originFrom: copiedFrom?.from ?? null,
    tiers: form.tiers.length,
    groups: form.groups.length,
    target: form.target,
    inspect: looksLikeInspectGoalDraft(lastUser),
  });
  const extras: string[] = [];
  if (suggestionBlocks.length > 0) {
    extras.push(`sugestao_calculada:\n${suggestionBlocks.join("\n")}`);
  }
  if (proposal && proposedTarget != null) {
    extras.push(
      `proposta_meta:\n${proposal.chatBlocks.join("\n")}`,
      `proposedTarget: ${brlCent(proposedTarget)} (NAO e form.target ate aceite)`,
      `alvo_aplicado: ${form.target != null ? brlCent(form.target) : "null"}`,
      `cenarios: ${proposal.scenarios.map((s) => `${s.label}=${brlCent(s.amount)}`).join(" · ")}`,
      `confianca: ${proposal.confidence}`,
    );
  }
  if (userLockedTarget && form.target != null) {
    extras.push(
      `alvo_travado_pelo_gestor: ${brlCent(form.target)}`,
      "instrucao_fala: O Gestor definiu/aceitou este R$ no rascunho. Nao substitua pela proposta.",
    );
  }
  if (draftOut.pendingCommit?.awaitingConfirm) {
    extras.push(
      `pending_commit: version=${draftOut.pendingCommit.versionId} target=${brlCent(draftOut.pendingCommit.target)}`,
      "instrucao_fala: Ja apresentou o resumo. Espere SIM para gravar. Nao chame commit_draft ainda.",
    );
  }
  if (copiedLadder && sourceWin) {
    extras.push(
      `config_copiada_de: ${monthYearTitle(sourceWin.from)} · intent=${copyIntent ?? "exact"} · ${form.tiers.length} niveis · modo ${form.tierMode} · ${form.groups.length} grupos` +
        (copiedFrom?.goalId ? ` · sourceGoalId=${copiedFrom.goalId}` : ""),
    );
    extras.push(
      "instrucao_fala: Mostre o resumo real (grupos com R$, niveis com %, bonus, gerencia). Nao diga so 'copiei'. Nao invente %. Nao busque meta do periodo de destino.",
    );
  }
  if (looksLikeInspectGoalDraft(lastUser)) {
    extras.push(
      "instrucao_fala: O Gestor perguntou um detalhe do rascunho. Responda SO ao aspecto pedido (niveis/grupos/premiação). PROIBIDO recomeçar com 'Copiei a configuração…'. PROIBIDO buscar meta do destino.",
    );
  }
  if (looksLikeAskGroupWeightAdvice(lastUser)) {
    extras.push(
      "instrucao_fala: O Gestor perguntou sobre PESOS. Analise/recomende com pesos_turno_analise. Nao repita o resumo de copia. Nao altere pesos sozinho.",
    );
  }
  if (patternBlocks.length) {
    extras.push(`padrao_historico:\n${patternBlocks.join("\n")}`);
    extras.push(
      "instrucao_fala: Diferencie herdado, recomendado e alteracao sugerida. Nao diga que copiou. Confirme a escada antes de gravar.",
    );
  }
  if (configSnapshotBlocks.length) {
    extras.push(`config_no_rascunho:\n${configSnapshotBlocks.join("\n")}`);
  }
  if (weightAdviceBlocks.length) {
    extras.push(`pesos_turno_analise:\n${weightAdviceBlocks.join("\n")}`);
  }
  if (copyStatus === "failed" && sourceWin) {
    extras.push(
      `config_copia_falhou: nao achei meta de ORIGEM em ${monthYearTitle(sourceWin.from)} (nao e o mes de destino ${form.startsOn ? monthYearTitle(form.startsOn) : "?"}). Nao invente escada.`,
    );
  }
  if (pathOfferBlocks.length) {
    extras.push(`oferta_caminho_montagem:\n${pathOfferBlocks.join("\n")}`);
    extras.push(
      "instrucao_fala: path ainda null. Introdução CURTA — o componente mostra as opções. NÃO liste as 3 opções no texto. NÃO execute cópia.",
    );
  }
  if (valueDecision.keepDiscussing) {
    extras.push(
      "instrucao_fala: Postura consultiva/info — responda a estratégia, NÃO aplique proposedTarget, NÃO avance para caminho de montagem, NÃO diga 'vamos trabalhar com' como se tivesse aceitado.",
    );
  }
  if (assembly.path === null && form.target != null && userLockedTarget) {
    extras.push(
      "instrucao_fala: Valor já aceito no rascunho. Próximo passo = escolha de caminho (copy|recommended|fresh) via componente, não reabrir valor nem anunciar cópia.",
    );
  } else if (form.target == null && proposedTarget != null) {
    extras.push(
      "instrucao_fala: Há proposta pendente. NÃO diga que aplicou. Espere aceite explícito ou outro R$.",
    );
  }

  let spokenReply: string | null = null;
  const copyJustApplied = Boolean(sourceWin && (copiedLadder || copyStatus === "failed"));
  if (opPlan.spokenReply && !counterLocksBase && !valueDecision.keepDiscussing) {
    // P1: resposta ao ponto (nível / origem / ambiguidade) antes do fluxo de montagem.
    // Contraproposta com R$ na fala / consultiva: o motor de valor manda na fala.
    spokenReply = scrubTechnicalSpeech(opPlan.spokenReply);
  } else if (
    form.startsOn &&
    form.endsOn &&
    looksLikeAskSeasonalInclusion(
      lastUser,
      seasonalBiasForPeriod(form.startsOn, form.endsOn),
    )
  ) {
    // Qualquer data sazonal (Natal, BF, feriado…): explicar o cálculo — não empurrar outro R$.
    const biasNow = seasonalBiasForPeriod(form.startsOn, form.endsOn);
    const hint = draftOut.tierRevenueHint;
    spokenReply = scrubTechnicalSpeech(
      speakSeasonalInclusionAnswer({
        bias: biasNow,
        eventName: detectSeasonalEventMention(lastUser, biasNow),
        proposedAmount: draftOut.proposal?.amount ?? draftOut.proposedTarget ?? null,
        appliedTarget: form.target,
        tierThresholdAmount: hint?.amountAtLevel ?? null,
        tierPct: hint?.attainmentPct ?? null,
        tierBase: hint?.proposedBase ?? null,
      }),
    );
  } else if (looksLikeValueInconsistency(lastUser)) {
    spokenReply = speakValueInconsistency(draftOut);
  } else if (looksLikeSimulateLevelsAtAmount(lastUser) || opIntent.notes === "simulate_levels") {
    const simAmount =
      opIntent.amountCents ?? parseGoalTarget(lastUser) ?? proposedTarget ?? form.target;
    if (simAmount != null) {
      spokenReply = speakSimulateLevels(draftOut, simAmount);
    }
  } else if (shouldCommit) {
    spokenReply = null; // Provider grava e fala o resultado real
  } else if (
    justPresentedCommit ||
    (draftOut.pendingCommit?.awaitingConfirm &&
      (looksLikeRequestSave(lastUser) || looksLikeProceedToSaveOffer(lastUser)))
  ) {
    // Sempre o resumo determinístico — LLM não inventa “Confirma com SIM” sem pending.
    spokenReply = draftOut.pendingCommit?.summary ?? null;
  } else if (resetForNewStore && form.storeId && !asksSuggestion) {
    const month = form.startsOn ? monthYearTitle(form.startsOn) : null;
    spokenReply = scrubTechnicalSpeech(
      `Ok — vamos montar a meta` +
        (month ? ` de ${month}` : "") +
        ` para ${storeName || "essa filial"}.\n\n` +
        `Começamos do zero nesta loja (sem herdar valor nem premiação da meta anterior). ` +
        `Quer que eu analise as vendas e te proponha um valor, ou você já tem um R$ em mente?`,
    );
  } else if (
    valueDecision.keepDiscussing &&
    valueStance !== "ask_info" &&
    !looksLikeAskGroupWeightAdvice(lastUser)
  ) {
    const chal = proposal?.scenarios.find((s) => s.kind === "challenging")?.amount ?? null;
    const cons = proposal?.scenarios.find((s) => s.kind === "conservative")?.amount ?? null;
    spokenReply = scrubTechnicalSpeech(
      speakConsultativeTargetAdvice({
        utterance: lastUser,
        proposed: proposedTarget,
        applied: form.target,
        challenging: chal,
        conservative: cons,
        seasonalSummary: proposal?.seasonalSummary ?? null,
        rationale: proposal?.rationale ?? null,
      }),
    );
  } else if (valueStance === "ask_info" && !looksLikeAskGroupWeightAdvice(lastUser)) {
    spokenReply = scrubTechnicalSpeech(
      speakProposalMoreInfo({
        proposed: proposedTarget,
        rationale: proposal?.rationale ?? null,
        seasonalSummary: proposal?.seasonalSummary ?? null,
        evidenceLabels: proposal?.evidence?.map((e) => e.label) ?? [],
      }),
    );
  } else if (
    asksSuggestion &&
    proposedTarget != null &&
    suggestionBlocks.length + (proposal?.chatBlocks.length ?? 0) > 0
  ) {
    const blocks = suggestionBlocks.length ? suggestionBlocks : proposal!.chatBlocks;
    spokenReply = scrubTechnicalSpeech(
      `${blocks.join("\n\n")}` +
        (form.target != null ? `\n\n(Aplicado no rascunho continua ${brlCent(form.target)}.)` : ""),
    );
  } else if (looksLikeAskGroupWeightAdvice(lastUser)) {
    spokenReply = speakGoalWeightAdvice(draftOut, weightAdviceForSpeak);
  } else if (copyJustApplied && (copyStatus === "ok" || copyStatus === "failed")) {
    spokenReply = speakGoalDraftConfig(draftOut, {
      facet: copyStatus === "ok" ? "copyJustApplied" : "full",
    });
  } else if (recommendedJustApplied && patternBlocks.length) {
    spokenReply = scrubTechnicalSpeech(
      `Montei uma configuração recomendada para ${form.startsOn ? monthYearTitle(form.startsOn) : "a meta"}` +
        (form.target != null ? ` (${brlCent(form.target)})` : "") +
        `.\n\n` +
        patternBlocks.join("\n\n") +
        (configSnapshotBlocks.length ? `\n\n${configSnapshotBlocks.join("\n\n")}` : "") +
        (weightAdviceBlocks.length ? `\n\n${weightAdviceBlocks.join("\n\n")}` : "") +
        `\n\nNada foi gravado. Confirma essa proposta, ajusta algum ponto, ou prefere outro caminho?`,
    );
  } else if (patternBlocks.length && assembly.path === null && selectingRecommended) {
    spokenReply = scrubTechnicalSpeech(patternBlocks.join("\n\n"));
  } else if (looksLikeInspectGoalDraft(lastUser)) {
    spokenReply = speakGoalDraftConfig(draftOut, { facet: goalInspectFacet(lastUser) });
  } else if (justAcceptedProposal && form.target != null && assembly.path === null) {
    spokenReply =
      pathOfferBlocks[0] ??
      speakGoalAssemblyPathOffer({
        target: form.target,
        destLabel: form.startsOn ? monthYearTitle(form.startsOn) : "a meta",
        hasPrior: pendingConfigCopy != null,
        priorLabel: pendingConfigCopy ? monthYearTitle(pendingConfigCopy.from) : null,
      });
    draftOut = { ...draftOut, pathOfferPresented: true };
  } else if (justAcceptedProposal && form.target != null) {
    spokenReply =
      `Apliquei ${brlCent(form.target)} no rascunho.` +
      (assembly.path != null
        ? `\n\n${buildGoalConfigSnapshot(form, form.target).chatBlocks.join("\n\n")}`
        : "");
  } else if (
    pathOfferBlocks.length > 0 &&
    form.target != null &&
    assembly.path === null &&
    !pathOfferPresented
  ) {
    spokenReply = pathOfferBlocks[0] ?? null;
    draftOut = { ...draftOut, pathOfferPresented: true };
  } else if (selectingFresh && assembly.path === "fresh") {
    spokenReply =
      `Ok — vamos montar do zero para ${form.startsOn ? monthYearTitle(form.startsOn) : "a meta"}` +
      (form.target != null ? ` com ${brlCent(form.target)}` : "") +
      `.\n\n` +
      `Estrutura: meta individual, por grupos ou geral da loja? ` +
      `Se quiser, já me diga grupos, níveis, bônus e rateio na mesma mensagem.`;
  } else if (asksSuggestion && proposedTarget == null && form.storeId) {
    // Pediu análise/sugestão e a consulta não rendeu proposta — desfecho explícito (nunca “vou buscar”).
    spokenReply = scrubTechnicalSpeech(
      `Olhei os dados de ${storeName || "essa filial"}` +
        (form.startsOn ? ` para ${monthYearTitle(form.startsOn)}` : "") +
        `, mas não há base sincronizada suficiente para recomendar um valor com segurança. ` +
        `Pode conferir o sync da loja, me passar um R$ de partida, ou tentar de novo quando houver mais dias com venda.`,
    );
  }

  return {
    reply: formatGoalFactsForModel(draftOut, storeName, extras),
    draft: draftOut,
    voice: "silent",
    spokenReply,
    copyJustApplied,
    shouldCommit,
  };
}

const GOAL_DRAFT_STORAGE_KEY = "wedash.jarvis.goalDraft.v1";
/** Fallback quando sessionStorage não existe (testes / private mode). */
const goalDraftMemory = new Map<string, string>();

function goalDraftStorageGet(): string | null {
  try {
    if (typeof sessionStorage !== "undefined") return sessionStorage.getItem(GOAL_DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return goalDraftMemory.get(GOAL_DRAFT_STORAGE_KEY) ?? null;
}

function goalDraftStorageSet(value: string | null): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      if (value == null) sessionStorage.removeItem(GOAL_DRAFT_STORAGE_KEY);
      else sessionStorage.setItem(GOAL_DRAFT_STORAGE_KEY, value);
      return;
    }
  } catch {
    /* fall through to memory */
  }
  if (value == null) goalDraftMemory.delete(GOAL_DRAFT_STORAGE_KEY);
  else goalDraftMemory.set(GOAL_DRAFT_STORAGE_KEY, value);
}

/** Persiste rascunho de meta na sessão (sobrevive a refresh; Apagar tudo limpa). */
export function persistGoalDraftSession(draft: GoalDraft | null): void {
  if (!draft) {
    goalDraftStorageSet(null);
    return;
  }
  goalDraftStorageSet(JSON.stringify({ v: 1, savedAt: Date.now(), draft }));
}

export function loadGoalDraftSession(): GoalDraft | null {
  try {
    const raw = goalDraftStorageGet();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; draft?: GoalDraft };
    if (parsed?.v !== 1 || !parsed.draft?.form) return null;
    return parsed.draft;
  } catch {
    return null;
  }
}

export function clearGoalDraftSession(): void {
  persistGoalDraftSession(null);
}
