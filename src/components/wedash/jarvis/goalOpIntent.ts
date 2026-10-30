/**
 * P1 — Interpretação semântica estruturada de operações de meta.
 * O LLM (ou o interpretador estrutural de fallback) produz GoalOpIntent.
 * Só o motor determinístico aplica / calcula / valida. Sem mutação pelo modelo.
 */
import { brlCent } from "@/lib/format";
import type { Tier } from "@/data/wedash/engine/goalTypes";
import { simulateLevelAtStoreTarget } from "./goalConfigIntel";
import type { GoalDraft, GoalDraftForm } from "./goalDraft";

export type GoalOpKind =
  | "question"
  | "analysis"
  | "proposal"
  | "correction"
  | "confirmation"
  | "change_request"
  | "inspect";

export type GoalOpEntity =
  | "store_target"
  | "tier_revenue"
  | "group"
  | "commission"
  | "bonus"
  | "period_destination"
  | "period_origin"
  | "ladder"
  | null;

/** Papel do R$ citado. */
export type GoalAmountRole = "store_base" | "tier_threshold" | "unknown" | null;

export type GoalTierRef = {
  /** 1-based; -1 = último nível da escada real. */
  byIndex?: number | null;
  byName?: string | null;
  byPct?: number | null;
};

export type GoalPeriodRole = "origin" | "destination" | "mention" | null;

export type GoalOpIntent = {
  kind: GoalOpKind;
  entity: GoalOpEntity;
  amountCents: number | null;
  amountRole: GoalAmountRole;
  tierRef: GoalTierRef | null;
  periodRole: GoalPeriodRole;
  /** YYYY-MM quando o mês for relevante. */
  periodMonth: string | null;
  /** Autoriza aplicar alteração no rascunho (não gravação). */
  authorizeApply: boolean;
  /** Autoriza gravação — P0 continua a exigir pendingCommit. */
  authorizeSave: boolean;
  /** Só interno — nunca vazar na fala. */
  confidence: "high" | "medium" | "low";
  ambiguity: string | null;
  notes: string | null;
};

export type GoalOpIntentContext = {
  form: Pick<GoalDraftForm, "tiers" | "target" | "startsOn" | "endsOn">;
  copiedFrom?: { from: string; to: string } | null;
  copyStatus?: "ok" | "failed" | null;
  today?: string;
};

export type ResolvedTier = {
  index: number;
  tier: Tier;
};

export type TierRevenueProposal = {
  amountAtLevel: number;
  attainmentPct: number;
  tierName: string;
  tierIndex: number;
  proposedBase: number;
  levelsImpact: { name: string; pct: number; threshold: number }[];
};

const KINDS = new Set<GoalOpKind>([
  "question",
  "analysis",
  "proposal",
  "correction",
  "confirmation",
  "change_request",
  "inspect",
]);

const ENTITIES = new Set<string>([
  "store_target",
  "tier_revenue",
  "group",
  "commission",
  "bonus",
  "period_destination",
  "period_origin",
  "ladder",
]);

const AMOUNT_ROLES = new Set<string>(["store_base", "tier_threshold", "unknown"]);
const PERIOD_ROLES = new Set<string>(["origin", "destination", "mention"]);
const CONFIDENCES = new Set<string>(["high", "medium", "low"]);

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Schema guard — rejeita JSON inválido do modelo. */
export function validateGoalOpIntent(raw: unknown): GoalOpIntent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.kind !== "string" || !KINDS.has(o.kind as GoalOpKind)) return null;
  const entity =
    o.entity == null ? null : typeof o.entity === "string" && ENTITIES.has(o.entity) ? o.entity : null;
  if (o.entity != null && entity == null) return null;
  const amountRole =
    o.amountRole == null
      ? null
      : typeof o.amountRole === "string" && AMOUNT_ROLES.has(o.amountRole)
        ? (o.amountRole as GoalAmountRole)
        : null;
  if (o.amountRole != null && amountRole == null) return null;
  const periodRole =
    o.periodRole == null
      ? null
      : typeof o.periodRole === "string" && PERIOD_ROLES.has(o.periodRole)
        ? (o.periodRole as GoalPeriodRole)
        : null;
  if (o.periodRole != null && periodRole == null) return null;
  const confidence =
    typeof o.confidence === "string" && CONFIDENCES.has(o.confidence)
      ? (o.confidence as GoalOpIntent["confidence"])
      : "medium";

  let amountCents: number | null = null;
  if (o.amountCents != null) {
    const n = Number(o.amountCents);
    if (!Number.isFinite(n) || n <= 0) return null;
    amountCents = Math.round(n);
  }

  let tierRef: GoalTierRef | null = null;
  if (o.tierRef != null && typeof o.tierRef === "object") {
    const t = o.tierRef as Record<string, unknown>;
    tierRef = {
      byIndex: t.byIndex == null ? null : Number(t.byIndex),
      byName: t.byName == null ? null : String(t.byName),
      byPct: t.byPct == null ? null : Number(t.byPct),
    };
    if (tierRef.byIndex != null && !Number.isFinite(tierRef.byIndex)) return null;
    if (tierRef.byPct != null && !Number.isFinite(tierRef.byPct)) return null;
  }

  return {
    kind: o.kind as GoalOpKind,
    entity: entity as GoalOpEntity,
    amountCents,
    amountRole,
    tierRef,
    periodRole,
    periodMonth: o.periodMonth == null ? null : String(o.periodMonth),
    authorizeApply: o.authorizeApply === true,
    authorizeSave: o.authorizeSave === true,
    confidence,
    ambiguity: o.ambiguity == null ? null : String(o.ambiguity),
    notes: o.notes == null ? null : String(o.notes),
  };
}

export function emptyGoalOpIntent(partial?: Partial<GoalOpIntent>): GoalOpIntent {
  return {
    kind: "analysis",
    entity: null,
    amountCents: null,
    amountRole: null,
    tierRef: null,
    periodRole: null,
    periodMonth: null,
    authorizeApply: false,
    authorizeSave: false,
    confidence: "medium",
    ambiguity: null,
    notes: null,
    ...partial,
  };
}

/** Extrai R$ / "N mil" sem decidir o papel semântico. */
export function extractAmountFromText(text: string): number | null {
  const p = norm(text);
  const mil = p.match(/(?:r\$\s*)?([\d.]+(?:,\d{1,2})?)\s*mil\b/);
  if (mil) {
    let r = mil[1]!;
    if (r.includes(",")) r = r.replace(/\./g, "").replace(",", ".");
    else r = r.replace(/\./g, "");
    const n = Number(r) * 1000;
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  const rs = p.match(/r\$\s*([\d.]+(?:,\d{1,2})?)/);
  if (rs) {
    let r = rs[1]!;
    if (r.includes(",")) r = r.replace(/\./g, "").replace(",", ".");
    else r = r.replace(/\./g, "");
    const n = Number(r);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  return null;
}

const ORDINAL_INDEX: Record<string, number> = {
  primeiro: 1,
  "1o": 1,
  "1º": 1,
  segundo: 2,
  "2o": 2,
  "2º": 2,
  terceiro: 3,
  "3o": 3,
  "3º": 3,
  quarto: 4,
  "4o": 4,
  "4º": 4,
  quinto: 5,
  "5o": 5,
  "5º": 5,
};

/**
 * Resolve nível na escada **real** do rascunho (ou origem).
 * Não inventa 180% nem presume último = desafio.
 */
export function resolveTierFromLadder(
  tiers: readonly Tier[],
  ref: GoalTierRef | null | undefined,
): ResolvedTier | null {
  if (!tiers.length) return null;
  if (!ref) return null;

  if (ref.byPct != null && Number.isFinite(ref.byPct)) {
    const pct = Math.round(ref.byPct);
    const i = tiers.findIndex((t) => Math.round(t.minAttainmentPct) === pct);
    if (i >= 0) return { index: i, tier: tiers[i]! };
  }

  if (ref.byName) {
    const n = norm(ref.byName);
    const i = tiers.findIndex((t) => {
      const tn = norm(t.name);
      return tn === n || tn.includes(n) || n.includes(tn);
    });
    if (i >= 0) return { index: i, tier: tiers[i]! };
    if (/desafio/.test(n)) {
      const d = tiers.findIndex((t) => /desafio/i.test(t.name));
      if (d >= 0) return { index: d, tier: tiers[d]! };
    }
  }

  if (ref.byIndex != null && Number.isFinite(ref.byIndex)) {
    const idx = ref.byIndex === -1 ? tiers.length : Math.round(ref.byIndex);
    if (idx >= 1 && idx <= tiers.length) {
      return { index: idx - 1, tier: tiers[idx - 1]! };
    }
  }

  return null;
}

/** Mesma regra do editor: limiar = round(base × pct / 100) → base = round(limiar × 100 / pct). */
export function storeBaseFromTierRevenue(amountAtLevel: number, attainmentPct: number): number | null {
  if (!(amountAtLevel > 0) || !(attainmentPct > 0)) return null;
  return Math.round((amountAtLevel * 100) / attainmentPct);
}

export function buildTierRevenueProposal(
  amountAtLevel: number,
  resolved: ResolvedTier,
  tiers: readonly Tier[],
): TierRevenueProposal {
  const proposedBase = storeBaseFromTierRevenue(amountAtLevel, resolved.tier.minAttainmentPct)!;
  const levelsImpact = tiers.map((t) => ({
    name: t.name,
    pct: t.minAttainmentPct,
    threshold: simulateLevelAtStoreTarget(proposedBase, t).threshold,
  }));
  return {
    amountAtLevel,
    attainmentPct: resolved.tier.minAttainmentPct,
    tierName: resolved.tier.name,
    tierIndex: resolved.index,
    proposedBase,
    levelsImpact,
  };
}

export function speakTierRevenueProposal(p: TierRevenueProposal): string {
  const lines = p.levelsImpact
    .map((l) => `· ${l.name} (${l.pct}%): ${brlCent(l.threshold)}`)
    .join("\n");
  return (
    `Se ${brlCent(p.amountAtLevel)} for o faturamento no nível ${p.tierName} (${p.attainmentPct}%), ` +
    `a meta-base fica ${brlCent(p.proposedBase)}.\n\n` +
    `Com isso, os níveis ficam:\n${lines}\n\n` +
    `Quer aplicar essa meta-base no rascunho?`
  );
}

export function speakTierAmbiguity(amount: number): string {
  return (
    `R$ ${brlCent(amount).replace(/^R\$\s*/, "")} — você quer isso como meta-base da loja, ` +
    `ou como faturamento de um nível específico (ex.: desafio 110%)?`
  );
}

export function speakNeedLadderBeforeLevel(): string {
  return (
    "Ainda não tenho a escada real carregada neste rascunho. " +
    "Quer que eu use a configuração de um mês de referência (ex.: outubro) antes de calcular o nível?"
  );
}

export function speakOriginPeriodFact(
  monthLabel: string,
  tiers: readonly Tier[],
  focusPct?: number | null,
): string {
  if (!tiers.length) {
    return `Não tenho a escada de ${monthLabel} carregada aqui. Posso buscar essa referência.`;
  }
  const list = tiers.map((t, i) => `${i + 1}º ${t.name} ${t.minAttainmentPct}%`).join("; ");
  if (focusPct != null) {
    const hit = tiers.find((t) => Math.round(t.minAttainmentPct) === Math.round(focusPct));
    if (hit) {
      return (
        `Em ${monthLabel}, o nível ${hit.name} está em ${hit.minAttainmentPct}%. ` +
        `Escada completa: ${list}. O destino da meta em elaboração não muda com isso.`
      );
    }
  }
  return `Em ${monthLabel} a escada é: ${list}. Isso é só referência — o período de destino permanece o mesmo.`;
}

/** Remove vazamentos técnicos da fala (confiança, schema, etc.). */
export function scrubTechnicalSpeech(text: string): string {
  return text
    .replace(/\s*\(confiança\s+(high|medium|low|alta|média|media|baixa)\)/gi, "")
    .replace(/\s*confiança\s*:\s*(high|medium|low|alta|média|media|baixa)/gi, "")
    .replace(/\bconfianca:\s*(high|medium|low)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function monthNameToYm(name: string, today: string): string | null {
  const map: Record<string, number> = {
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
  const n = norm(name);
  const m = map[n];
  if (!m) return null;
  const y = Number(today.slice(0, 4));
  return `${y}-${String(m).padStart(2, "0")}`;
}

function detectTierRef(p: string): GoalTierRef | null {
  // “desafio 10% a mais” = ajuste de escada, não limiar de faturamento.
  const ladderPctAdjust = /\d{1,3}\s*%\s*(a mais|acima)|por cento a mais/.test(p);

  const pctHit = p.match(
    /(?:nivel|n[ií]vel|desafio|meta\s+desafio|atingimento)\s*(?:de\s+)?(\d{2,3})\s*%/,
  );
  const pctBare = p.match(/\b(\d{2,3})\s*%/);
  let byPct: number | null = null;
  if (!ladderPctAdjust) {
    byPct = pctHit
      ? Number(pctHit[1])
      : pctBare && /nivel|meta desafio|ultimo|último|quarto|terceiro|110/.test(p)
        ? Number(pctBare[1])
        : null;
  }

  let byIndex: number | null = null;
  if (/ultimo\s+nivel|último\s+nível|ultimo\s+nível|último\s+nivel/.test(p) || /ultimo nivel|ultimo nível/.test(p)) {
    byIndex = -1;
  }
  for (const [word, idx] of Object.entries(ORDINAL_INDEX)) {
    if (new RegExp(`${word}\\s+(nivel|n[ií]vel)`).test(p)) {
      byIndex = idx;
      break;
    }
  }

  let byName: string | null = null;
  // Nome “desafio” só conta se aponta ao nível (não “desafio 10% a mais” sozinho).
  if (
    /meta\s+desafio|nivel\s+desafio|n[ií]vel\s+desafio/.test(p) ||
    (/\bdesafio\b/.test(p) && !ladderPctAdjust && (byPct != null || byIndex != null || /r\$|\d+\s*mil/.test(p)))
  ) {
    byName = "desafio";
  }

  if (byPct == null && byIndex == null && byName == null) return null;
  return { byPct, byIndex, byName };
}

/**
 * Interpretador estrutural (fallback offline / testes).
 * Preenche slots semânticos — não é lista de frases prontas.
 */
export function interpretGoalOpStructural(text: string, ctx: GoalOpIntentContext): GoalOpIntent {
  const p = norm(text);
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);
  const amount = extractAmountFromText(text);
  const tierRef = detectTierRef(p);

  const isQuestion =
    /\?$/.test(text.trim()) ||
    /^(quanto|como|qual|o que|quando|onde)\b/.test(p) ||
    /quanto seria|como ficam|como ficaria|como ficou|seria a meta/.test(p);

  const isCorrection =
    /na verdade|erra(do|ste)?|nao e|não é|voce errou|você errou|corrigindo|quero dizer|quero deixar claro|esclarec/.test(
      p,
    );

  const isConfirm =
    /^(sim|pode|ok|fechado|isso|pode ser|vamos nessa|autorizo)([!.?…]*)$/.test(p.trim()) ||
    /aceito (a |o )?(proposta|recomend)/.test(p);

  // Destino inequívoco: “mude … para dezembro”, “meta de dezembro” como troca.
  const destChange =
    /mud(e|a|ar)\s+(a\s+)?meta/.test(p) ||
    /trocar?\s+(a\s+)?meta/.test(p) ||
    /meta\s+(de|para|em)\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro).{0,40}(em vez|ao inves|no lugar)/.test(
      p,
    ) ||
    /para\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(p) &&
      /mud|troc|passar|passar a meta|destino/.test(p);

  // Origem / referência: “use outubro como referência”, “copiar outubro”, fato sobre outubro.
  const originRef =
    /como referencia|como referência|usar?\s+\w+\s+como|tendo em vista|basead|copiar?\s+(a\s+)?(mesma\s+)?(configura|escada|meta)|vamos copiar|quero copiar|mesma (escada|configura)|igual (a |ao )?/.test(
      p,
    ) ||
    (/(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/.test(p) &&
      /(tinha|tinha o|nivel de|nível de|escada de|configura[cç][aã]o de|referencia|referência)/.test(p));

  let periodMonth: string | null = null;
  let periodRole: GoalPeriodRole = null;
  for (const name of [
    "janeiro",
    "fevereiro",
    "marco",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ]) {
    if (!p.includes(name)) continue;
    periodMonth = monthNameToYm(name, today);
    break;
  }

  if (destChange) {
    periodRole = "destination";
    const m = p.match(
      /para\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/,
    );
    if (m) periodMonth = monthNameToYm(m[1]!, today);
  } else if (originRef) {
    periodRole = "origin";
  } else if (periodMonth && /(tinha|nivel|nível|escada|quarto|terceiro|desafio)/.test(p)) {
    periodRole = "mention";
  }

  // “use outubro como referência para novembro”
  if (
    /referencia|referência|copiar|usar/.test(p) &&
    /para\s+(a\s+)?(meta\s+de\s+)?(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/.test(
      p,
    )
  ) {
    periodRole = "origin";
  }

  // Fato sobre nível de um mês (correção / esclarecimento) — não muda destino.
  // Se há R$ + nível, isso é operação de valor no nível (não só fato histórico).
  if (
    amount == null &&
    (periodRole === "mention" ||
      (periodMonth &&
        tierRef &&
        /(e|é|era|tinha|ficou|esta|está)\s*(em\s*)?\d{2,3}\s*%/.test(p)))
  ) {
    return emptyGoalOpIntent({
      kind: isCorrection ? "correction" : isQuestion ? "question" : "analysis",
      entity: "ladder",
      tierRef,
      periodRole: periodRole ?? "mention",
      periodMonth,
      authorizeApply: false,
      confidence: "high",
      notes: "period_ladder_fact",
    });
  }

  if (destChange && amount == null) {
    return emptyGoalOpIntent({
      kind: "change_request",
      entity: "period_destination",
      periodRole: "destination",
      periodMonth,
      authorizeApply: true,
      confidence: "high",
      notes: "change_destination_period",
    });
  }

  // Referência/cópia sem R$ de nível no mesmo turno.
  if (
    amount == null &&
    periodRole === "origin" &&
    /referencia|referência|copiar|usar|mesma/.test(p)
  ) {
    return emptyGoalOpIntent({
      kind: "change_request",
      entity: "period_origin",
      periodRole: "origin",
      periodMonth,
      authorizeApply: true,
      confidence: "high",
      notes: "set_origin_reference",
    });
  }

  // Inspeção de níveis com valor hipotético (antes de “quanto seria”, que é pergunta de cálculo).
  if (
    /como ficam|como ficaria|como ficou|simula/.test(p) &&
    (/nivel|nível|escada|valor/.test(p) || amount != null)
  ) {
    return emptyGoalOpIntent({
      kind: "inspect",
      entity: "ladder",
      amountCents: amount,
      amountRole: amount != null ? "store_base" : null,
      authorizeApply: false,
      confidence: "high",
      notes: "simulate_levels",
    });
  }

  // “Quanto seria a meta se o desafio fosse R$ X”
  if (
    amount != null &&
    (/quanto seria|seria a meta|meta se|se o desafio|se (a |o )?nivel/.test(p) ||
      (isQuestion && tierRef && !/como ficam|como ficaria/.test(p)))
  ) {
    const role: GoalAmountRole = tierRef ? "tier_threshold" : "unknown";
    return emptyGoalOpIntent({
      kind: "question",
      entity: tierRef ? "tier_revenue" : "store_target",
      amountCents: amount,
      amountRole: role,
      tierRef,
      authorizeApply: false,
      confidence: tierRef ? "high" : "low",
      ambiguity: tierRef ? null : "base_or_level",
      notes: "what_if_tier_revenue",
    });
  }

  const asBasePhrase =
    /meta principal|meta[- ]?base|meta da loja|como meta\b|meta de\s+r\$|meta de\s+\d|quero\s+(a\s+)?meta|vamos de|deixar (a )?meta|, meta de\b/.test(
      p,
    ) ||
    /quero\s+r\$.{0,40}como meta/.test(p) ||
    /,\s*meta de\s+\d/.test(p);

  // R$ no nível (último / desafio / 110%) — mas “meta de X mil” explícita manda.
  if (amount != null && tierRef && !asBasePhrase) {
    return emptyGoalOpIntent({
      kind: isCorrection ? "correction" : isQuestion ? "question" : "proposal",
      entity: "tier_revenue",
      amountCents: amount,
      amountRole: "tier_threshold",
      tierRef,
      periodRole: periodRole === "origin" ? "origin" : periodRole,
      periodMonth,
      authorizeApply: false,
      confidence: "high",
      notes: "amount_at_tier",
    });
  }

  if (amount != null) {
    const ambiguous = !asBasePhrase && /deixar|ficar|colocar|definir|quero/.test(p) && !tierRef;
    return emptyGoalOpIntent({
      kind: isQuestion ? "question" : "proposal",
      entity: "store_target",
      amountCents: amount,
      amountRole: asBasePhrase ? "store_base" : ambiguous ? "unknown" : "store_base",
      authorizeApply: false,
      confidence: asBasePhrase ? "high" : ambiguous ? "low" : "medium",
      ambiguity: asBasePhrase ? null : ambiguous ? "base_or_level" : null,
      notes: asBasePhrase ? "store_base_amount" : "amount_bare",
    });
  }

  if (isConfirm) {
    return emptyGoalOpIntent({
      kind: "confirmation",
      entity: null,
      authorizeApply: true,
      authorizeSave: false,
      confidence: "medium",
      notes: "bare_affirmation",
    });
  }

  return emptyGoalOpIntent({
    kind: isQuestion ? "question" : isCorrection ? "correction" : "analysis",
    entity: null,
    confidence: "low",
    notes: "fallback",
  });
}

export type ApplyGoalOpResult = {
  /** Meta-base proposta (não aplicada). */
  proposedTarget: number | null;
  /** Se true, o motor pode espelhar proposed → form só com aceite P0. */
  tierProposal: TierRevenueProposal | null;
  /** Não alterar form.startsOn / endsOn neste turno. */
  freezeDestinationPeriod: boolean;
  /** Não gravar R$ da fala como form.target neste turno. */
  blockDirectTargetLock: boolean;
  /** Pedir confirmação / esclarecimento. */
  spokenReply: string | null;
  /** Precisa carregar escada real antes. */
  needsLadder: boolean;
};

/**
 * Aplica a intenção no cálculo — gera proposta / fala.
 * Nunca autoriza save. Nunca muta o form aqui (só sinaliza).
 */
export function planGoalOpFromIntent(
  intent: GoalOpIntent,
  ctx: GoalOpIntentContext,
): ApplyGoalOpResult {
  const tiers = ctx.form.tiers;
  const hasRealLadder =
    ctx.copyStatus === "ok" ||
    (tiers.length > 0 && !tiers.every((t, i) => t.minAttainmentPct === [100, 120, 150, 180][i]));

  const freezeDestinationPeriod =
    intent.periodRole === "origin" ||
    intent.periodRole === "mention" ||
    (intent.entity === "ladder" && intent.periodMonth != null);

  const base: ApplyGoalOpResult = {
    proposedTarget: null,
    tierProposal: null,
    freezeDestinationPeriod,
    blockDirectTargetLock: false,
    spokenReply: null,
    needsLadder: false,
  };

  // Fato sobre níveis de um mês de referência.
  if (
    (intent.entity === "ladder" || intent.kind === "correction") &&
    intent.periodRole !== "destination" &&
    (intent.periodMonth || intent.tierRef)
  ) {
    const label = intent.periodMonth
      ? monthLabelFromYm(intent.periodMonth)
      : "a referência";
    const focus = intent.tierRef?.byPct ?? null;
    return {
      ...base,
      freezeDestinationPeriod: true,
      blockDirectTargetLock: true,
      spokenReply: scrubTechnicalSpeech(speakOriginPeriodFact(label, tiers, focus)),
    };
  }

  if (intent.amountRole === "tier_threshold" && intent.amountCents != null) {
    if (!hasRealLadder && intent.tierRef?.byIndex != null) {
      // Índice ordinal sem escada real → perigoso (vira 180% do default).
      return {
        ...base,
        blockDirectTargetLock: true,
        needsLadder: true,
        spokenReply: speakNeedLadderBeforeLevel(),
      };
    }
    const resolved = resolveTierFromLadder(tiers, intent.tierRef);
    if (!resolved) {
      if (!hasRealLadder) {
        return {
          ...base,
          blockDirectTargetLock: true,
          needsLadder: true,
          spokenReply: speakNeedLadderBeforeLevel(),
        };
      }
      return {
        ...base,
        blockDirectTargetLock: true,
        spokenReply:
          "Não achei esse nível na escada do rascunho. Me diga o nome ou o % (ex.: Meta desafio 110%).",
      };
    }
    const proposal = buildTierRevenueProposal(intent.amountCents, resolved, tiers);
    const askApply = intent.kind !== "question";
    const speak = askApply
      ? speakTierRevenueProposal(proposal)
      : `Se o ${proposal.tierName} (${proposal.attainmentPct}%) for ${brlCent(proposal.amountAtLevel)}, a meta-base seria ${brlCent(proposal.proposedBase)}. Não alterei o rascunho.`;
    return {
      ...base,
      proposedTarget: askApply ? proposal.proposedBase : null,
      tierProposal: proposal,
      blockDirectTargetLock: true,
      spokenReply: scrubTechnicalSpeech(speak),
    };
  }

  if (intent.amountRole === "unknown" && intent.amountCents != null) {
    return {
      ...base,
      blockDirectTargetLock: true,
      spokenReply: speakTierAmbiguity(intent.amountCents),
    };
  }

  if (intent.amountRole === "store_base" && intent.amountCents != null) {
    if (intent.kind === "inspect" || intent.kind === "question") {
      return {
        ...base,
        blockDirectTargetLock: true,
        proposedTarget: null,
        spokenReply: null, // discussGoal usa speakSimulateLevels
      };
    }
    // Meta-base explícita do Gestor: o motor pode travar form.target (não é gravação).
    return {
      ...base,
      proposedTarget: intent.amountCents,
      blockDirectTargetLock: false,
      spokenReply: null,
    };
  }

  return base;
}

function monthLabelFromYm(ym: string): string {
  const names = [
    "",
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ];
  const m = Number(ym.slice(5, 7));
  const y = ym.slice(0, 4);
  return `${names[m] ?? ym} ${y}`;
}

/** Snapshot mínimo para o LLM interpretar com contexto real. */
export function goalOpContextForModel(draft: GoalDraft | null, today: string): string {
  if (!draft) return JSON.stringify({ today, draft: null });
  return JSON.stringify({
    today,
    destination: { startsOn: draft.form.startsOn, endsOn: draft.form.endsOn, name: draft.form.name },
    origin: draft.copiedFrom ?? null,
    copyStatus: draft.copyStatus ?? null,
    appliedTarget: draft.form.target,
    proposedTarget: draft.proposedTarget ?? null,
    tiers: draft.form.tiers.map((t, i) => ({
      index: i + 1,
      name: t.name,
      minAttainmentPct: t.minAttainmentPct,
    })),
    pendingCommitAwaiting: draft.pendingCommit?.awaitingConfirm === true,
  });
}
