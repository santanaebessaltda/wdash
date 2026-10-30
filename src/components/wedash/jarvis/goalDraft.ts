import { endOfMonth, startOfMonth } from "@/data/wedash/engine/format";
import type { GoalGroup, Tier } from "@/data/wedash/engine/goalTypes";
import { fetchGoals } from "@/data/wedash/goalsRepo";
import { fetchSalesDayAggs } from "@/data/wedash/salesRepo";
import { brlCent, monthYearTitle } from "@/lib/format";
import { matchStoresInText, type JarvisContext, type JarvisStoreRef } from "./context";
import { looksLikeGoalLadderTalk } from "./respond";
import { seasonalBiasForPeriod } from "./seasonalBrief";

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

export type GoalDraft = { form: GoalDraftForm };

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

/** Competência civil a partir do texto (próximo mês, novembro, este mês…). */
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
  if (/mes passado/.test(p)) {
    const startsOn = shiftMonthStart(today, -1);
    return { startsOn, endsOn: endOfMonth(startsOn) };
  }
  for (const [name, month] of Object.entries(MONTH_NAMES)) {
    if (!p.includes(name)) continue;
    // Evita tratar “config de outubro” como período da meta nova.
    if (
      new RegExp(
        `(configura|igual|copiar|seguir|mesma|mesmo|escada|nivel).{0,40}${name}|${name}.{0,20}(configura|escada|nivel)`,
      ).test(p) &&
      !new RegExp(`meta (de |do |para |em )?${name}|${name} (com |de )?meta|competencia.{0,10}${name}`).test(p)
    ) {
      continue;
    }
    const yearMatch = p.match(new RegExp(`${name}\\s+(?:de\\s+)?(20\\d{2})`));
    const y = yearMatch ? Number(yearMatch[1]) : Number(today.slice(0, 4));
    const startsOn = `${y}-${pad(month)}-01`;
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
  const m =
    text.match(/meta\s+(?:de\s+)?r\$\s*([\d.]+(?:,\d{1,2})?)/i) ??
    text.match(/r\$\s*([\d.]+(?:,\d{1,2})?)/i) ??
    text.match(/([\d.]+(?:,\d{1,2})?)\s*(?:mil\b)/i) ??
    text.match(/(?:alvo|faturamento|meta)\s+(?:de\s+)?([\d.]+(?:,\d{1,2})?)\s*reais?/i);
  if (!m) return null;
  let raw = m[1]!;
  // "R$ 180 mil" e "180 mil" → milhão de reais em linguagem falada.
  const mil = new RegExp(`${m[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*mil\\b`, "i").test(text);
  if (raw.includes(",")) raw = raw.replace(/\./g, "").replace(",", ".");
  else raw = raw.replace(/\./g, "");
  let n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (mil) n *= 1000;
  return Math.round(n);
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
  if (f.name.trim()) return f;
  if (f.startsOn) return { ...f, name: monthYearTitle(f.startsOn) };
  return { ...f, name: "Nova meta" };
}

/**
 * Degrau “Desafio” no % pedido (padrão 110 = meta + 10%).
 * Mantém só níveis abaixo desse % e o degrau Desafio (escada crescente).
 */
export function applyChallengeTierPct(tiers: Tier[], pct: number): Tier[] {
  if (tiers.length === 0) {
    return [{ name: "Desafio", minAttainmentPct: pct, commissionPct: 3, bonus: 0 }];
  }
  const cloned = tiers.map((t) => ({ ...t }));
  const below = cloned.filter((t) => t.minAttainmentPct < pct && !/desafio/i.test(t.name));
  const prevDesafio = cloned.find((t) => /desafio/i.test(t.name));
  const template = prevDesafio ?? cloned[cloned.length - 1]!;
  const desafio: Tier = {
    ...template,
    name: "Desafio",
    minAttainmentPct: pct,
  };
  return [...below, desafio];
}

/**
 * Mês de onde copiar escada/modo (“mesma configuração de outubro”).
 * Diferente do período da meta nova.
 */
export function parseConfigSourceMonth(text: string, today: string): { from: string; to: string } | null {
  const p = norm(text);
  const wantsCopy = /configura|igual|copiar|seguir|mesma|mesmo|basead|como (em|no|na)|escada (de|do|da)/.test(p);
  if (!wantsCopy) return null;

  if (/mes passado/.test(p)) {
    const from = shiftMonthStart(today, -1);
    return { from, to: endOfMonth(from) };
  }

  for (const [name, month] of Object.entries(MONTH_NAMES)) {
    if (
      !new RegExp(
        `(configura|igual|copiar|seguir|mesma|mesmo|escada|nivel|de).{0,48}${name}|${name}.{0,24}(configura|escada|nivel)`,
      ).test(p)
    ) {
      continue;
    }
    const y = Number(today.slice(0, 4));
    const from = `${y}-${pad(month)}-01`;
    return { from, to: endOfMonth(from) };
  }

  const from = shiftMonthStart(today, -1);
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

/** Copia modo/escada/rateio/gerência da meta publicada do mês de referência. */
export async function copyGoalLadderFromPeriod(
  form: GoalDraftForm,
  ctx: JarvisContext,
  win: { from: string; to: string },
  sourceStoreId?: string,
): Promise<GoalDraftForm> {
  const storeId =
    sourceStoreId || form.storeId || (ctx.stores.length === 1 ? ctx.stores[0]!.id : "");
  if (!storeId) return form;
  try {
    const goals = await fetchGoals({
      tenantId: ctx.tenantId,
      storeIds: [storeId],
      from: win.from,
      to: win.to,
    });
    const src = goals.find((g) => g.storeId === storeId) ?? goals[0];
    if (!src) return form;
    const hasManager = src.tiers.some((t) => t.managerPct != null);
    return {
      ...form,
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
  } catch {
    return form;
  }
}

export function mergeGoalUtterance(form: GoalDraftForm, text: string, ctx: JarvisContext): GoalDraftForm {
  const p = norm(text);
  const next: GoalDraftForm = {
    ...form,
    tiers: form.tiers.map((t) => ({ ...t })),
  };

  const pool = ctx.network.length > 0 ? ctx.network : ctx.stores;
  const stores = matchStoresInText(text, pool);
  const source = pickConfigSourceStore(text, stores);
  const targetStore = pickGoalTargetStore(text, stores, source);
  if (targetStore) next.storeId = targetStore.id;
  else if (stores.length === 1) next.storeId = stores[0]!.id;
  else if (!next.storeId && ctx.stores.length === 1) next.storeId = ctx.stores[0]!.id;

  if (/geral|loja inteira|meta da loja|premia[cç][aã]o se divide/.test(p)) next.tierMode = "GENERAL";
  else if (/por grupo|modo grupo|meta do grupo/.test(p)) next.tierMode = "GROUP";
  else if (/individual|por pessoa|cada vendedora/.test(p)) next.tierMode = "INDIVIDUAL";

  if (/ratear|rateio|sem vendedor|nao identificado|não identificado/.test(p)) next.spreadUnidentified = true;
  if (/sem rateio|nao ratear|não ratear/.test(p)) next.spreadUnidentified = false;

  if (/gerencia|gerência/.test(p) && /premia|bonus|bônus/.test(p)) next.managerOn = true;

  const period = parseGoalPeriod(text, ctx.today);
  if (period) {
    next.startsOn = period.startsOn;
    next.endsOn = period.endsOn;
  }

  const target = parseGoalTarget(text);
  if (target != null) next.target = target;

  // “nível desafio / 10% a mais” = último degrau da escada em 110% (não é CRUD Desafio).
  if (looksLikeGoalLadderTalk(text) && /10\s*%|por cento a mais|nivel desafio|meta desafio|ultimo nivel/.test(p)) {
    next.tiers = applyChallengeTierPct(next.tiers, 110);
  }

  const name = text.match(/(?:chamar|nome(?:ar)?|titulo|título)\s+(?:de\s+|como\s+)?["“]?([^"”\n]{3,80})["”]?/i);
  if (name?.[1]) next.name = name[1].trim().slice(0, 80);

  return ensureGoalName(next);
}

function preferAllBrand<T extends { brand: string }>(rows: T[]): T[] {
  const all = rows.filter((r) => r.brand === "ALL");
  return all.length > 0 ? all : rows.filter((r) => r.brand !== "ALL");
}

export type GoalTargetSuggestion = {
  amount: number;
  /** Ex.: "mes passado + sazonal (Black Friday +12%)" */
  rationale: string;
  seasonalSummary: string;
};

/** Sugere meta: base historica × fator sazonal do periodo alvo. */
export async function suggestGoalTarget(
  ctx: JarvisContext,
  storeId: string,
  period?: { from: string; to: string } | null,
): Promise<GoalTargetSuggestion | null> {
  if (!storeId) return null;
  const targetFrom = period?.from ?? shiftMonthStart(ctx.today, 1);
  const targetTo = period?.to ?? endOfMonth(targetFrom);
  const bias = seasonalBiasForPeriod(targetFrom, targetTo);

  const last = shiftMonthStart(ctx.today, -1);
  const yoyFrom = shiftMonthStart(targetFrom, -12);
  const yoyTo = endOfMonth(yoyFrom);

  try {
    const [lastRows, yoyRows] = await Promise.all([
      fetchSalesDayAggs({
        tenantId: ctx.tenantId,
        storeIds: [storeId],
        from: last,
        to: endOfMonth(last),
      }),
      fetchSalesDayAggs({
        tenantId: ctx.tenantId,
        storeIds: [storeId],
        from: yoyFrom,
        to: yoyTo,
      }),
    ]);
    const lastCents = preferAllBrand(lastRows).reduce((s, r) => s + r.revenueCents, 0);
    const yoyCents = preferAllBrand(yoyRows).reduce((s, r) => s + r.revenueCents, 0);

    let baseCents = 0;
    let baseLabel = "";
    if (yoyCents > 0 && lastCents > 0) {
      // Media do mesmo mes ano passado e do mes recente — depois aplica sazonal do alvo.
      baseCents = (yoyCents + lastCents) / 2;
      baseLabel = "media do mesmo mes ano passado e do mes recente";
    } else if (yoyCents > 0) {
      baseCents = yoyCents;
      baseLabel = "mesmo mes ano passado";
    } else if (lastCents > 0) {
      baseCents = lastCents;
      baseLabel = "mes passado";
    } else {
      return null;
    }

    const growth = 1.05; // piso de crescimento alem do sazonal
    const raw = (baseCents / 100) * growth * bias.factor;
    const amount = Math.round(raw / 100) * 100;
    if (amount <= 0) return null;

    const pct = Math.round((bias.factor - 1) * 100);
    const sazonalBit =
      bias.factor === 1
        ? "sem ajuste sazonal forte"
        : `sazonal ${pct > 0 ? "+" : ""}${pct}%`;
    const rationale = `${baseLabel} (+5% crescimento, ${sazonalBit})`;
    return { amount, rationale, seasonalSummary: bias.summary };
  } catch {
    return null;
  }
}

export function formatGoalProposal(form: GoalDraftForm, storeName: string): string {
  const ready = goalDraftReady(form);
  const period =
    form.startsOn && form.endsOn
      ? `${form.startsOn.slice(8, 10)}/${form.startsOn.slice(5, 7)} a ${form.endsOn.slice(8, 10)}/${form.endsOn.slice(5, 7)}`
      : "a definir";
  const mode =
    form.tierMode === "GENERAL" ? "Geral" : form.tierMode === "GROUP" ? "Grupo" : "Individual";
  const base =
    `Rascunho de meta: ${form.name || "(sem nome)"} · ${storeName || "filial?"} · ${period} · ` +
    `${mode} · alvo ${form.target != null ? brlCent(form.target) : "a definir"} · ` +
    `${form.tiers.length} níveis na escada` +
    (form.managerOn ? " · com premiação da gerência" : "") +
    ".";
  if (ready) {
    return `${base} Fechado pra mim no chat (so texto). Quando quiser, diga "cria a meta" / Autorizo que eu gravo o rascunho em Metas.`;
  }
  const missing = missingGoalLabels(validateGoalDraft(form));
  return `${base} Ainda falta: ${missing.join(", ")}. Pode falar o valor, a filial ou o mês.`;
}

export async function discussGoal(
  question: string,
  ctx: JarvisContext,
  prev: GoalDraft | null,
): Promise<{ reply: string; draft: GoalDraft }> {
  let form = prev?.form ?? emptyGoalForm(ctx.stores.length === 1 ? ctx.stores[0]!.id : "");
  form = mergeGoalUtterance(form, question, ctx);

  const sourceWin = parseConfigSourceMonth(question, ctx.today);
  let copiedLadder = false;
  if (sourceWin) {
    const before = JSON.stringify(form.tiers);
    const pool = ctx.network.length > 0 ? ctx.network : ctx.stores;
    const matched = matchStoresInText(question, pool);
    const source = pickConfigSourceStore(question, matched);
    form = await copyGoalLadderFromPeriod(form, ctx, sourceWin, source?.id);
    copiedLadder = JSON.stringify(form.tiers) !== before;
    if (looksLikeGoalLadderTalk(question) && /10\s*%|por cento a mais|nivel desafio|meta desafio/.test(norm(question))) {
      form = { ...form, tiers: applyChallengeTierPct(form.tiers, 110) };
    }
  }

  if (!form.startsOn) {
    const startsOn = shiftMonthStart(ctx.today, 1);
    form = ensureGoalName({ ...form, startsOn, endsOn: endOfMonth(startsOn) });
  }

  const period =
    form.startsOn && form.endsOn ? { from: form.startsOn, to: form.endsOn } : null;
  const bias = period ? seasonalBiasForPeriod(period.from, period.to) : null;
  const qn = norm(question);
  const wantsValueHelp =
    form.target == null ||
    /suger|propor|basead|historico|historico|mes passado|melhorar|subir|aumentar|quanto (seria|fica)|valor da meta|da pra melhorar|da para melhorar/.test(
      qn,
    );

  let suggestionNote: string | null = null;
  if (wantsValueHelp && form.storeId) {
    const suggested = await suggestGoalTarget(ctx, form.storeId, period);
    if (suggested != null) {
      form = { ...form, target: suggested.amount };
      suggestionNote = `Sugeri ${brlCent(suggested.amount)} (${suggested.rationale}). ${suggested.seasonalSummary}`;
    }
  }

  const storeName =
    ctx.network.find((s) => s.id === form.storeId)?.tradeName ??
    ctx.stores.find((s) => s.id === form.storeId)?.tradeName ??
    "";
  let reply = formatGoalProposal(form, storeName);
  if (copiedLadder) {
    reply = `Mantive a escada/modo da meta de ${monthYearTitle(sourceWin!.from)} e so ajustei o que voce pediu. ${reply}`;
  }
  if (suggestionNote) {
    reply = `${suggestionNote} ${reply}`;
  } else if (bias && bias.events.length > 0 && !/autorizo|cria a meta|vamos criar/.test(qn)) {
    reply = `${bias.summary} ${reply}`;
  }
  return { reply, draft: { form } };
}
