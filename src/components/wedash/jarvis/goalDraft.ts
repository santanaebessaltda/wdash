import { endOfMonth, startOfMonth } from "@/data/wedash/engine/format";
import type { GoalGroup, Tier } from "@/data/wedash/engine/goalTypes";
import { fetchGoals } from "@/data/wedash/goalsRepo";
import { fetchSalesDayAggs } from "@/data/wedash/salesRepo";
import { brlCent, monthYearTitle } from "@/lib/format";
import { matchStoresInText, type JarvisContext } from "./context";
import { looksLikeGoalLadderTalk } from "./respond";

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

/** Copia modo/escada/rateio/gerência da meta publicada do mês de referência. */
export async function copyGoalLadderFromPeriod(
  form: GoalDraftForm,
  ctx: JarvisContext,
  win: { from: string; to: string },
): Promise<GoalDraftForm> {
  const storeId = form.storeId || (ctx.stores.length === 1 ? ctx.stores[0]!.id : "");
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

  const stores = matchStoresInText(text, ctx.stores);
  if (stores.length === 1) next.storeId = stores[0]!.id;
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

/** Sugere meta ≈ faturamento do mês passado + 10% (arredondado). */
export async function suggestGoalTarget(ctx: JarvisContext, storeId: string): Promise<number | null> {
  if (!storeId) return null;
  const last = shiftMonthStart(ctx.today, -1);
  try {
    const rows = await fetchSalesDayAggs({
      tenantId: ctx.tenantId,
      storeIds: [storeId],
      from: last,
      to: endOfMonth(last),
    });
    const cents = preferAllBrand(rows).reduce((s, r) => s + r.revenueCents, 0);
    if (cents <= 0) return null;
    const suggested = Math.round((cents / 100) * 1.1);
    return Math.round(suggested / 100) * 100;
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
    return `${base} Fechado para mim — diga Autorizo ou toque em Autorizar para eu criar.`;
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
    form = await copyGoalLadderFromPeriod(form, ctx, sourceWin);
    copiedLadder = JSON.stringify(form.tiers) !== before;
    if (looksLikeGoalLadderTalk(question) && /10\s*%|por cento a mais|nivel desafio|meta desafio/.test(norm(question))) {
      form = { ...form, tiers: applyChallengeTierPct(form.tiers, 110) };
    }
  }

  if (form.target == null && form.storeId && /suger|propor|basead|historico|histórico|mes passado|mês passado/.test(norm(question))) {
    const suggested = await suggestGoalTarget(ctx, form.storeId);
    if (suggested != null) form = { ...form, target: suggested };
  }

  if (!form.startsOn) {
    const startsOn = shiftMonthStart(ctx.today, 1);
    form = ensureGoalName({ ...form, startsOn, endsOn: endOfMonth(startsOn) });
  }

  const storeName = ctx.stores.find((s) => s.id === form.storeId)?.tradeName ?? "";
  let reply = formatGoalProposal(form, storeName);
  if (copiedLadder) {
    reply = `Mantive a escada/modo da meta de ${monthYearTitle(sourceWin!.from)} e só ajustei o que você pediu. ${reply}`;
  } else if (form.target != null && /suger|propor|basead|historico|histórico/.test(norm(question))) {
    reply = `Sugeri ${brlCent(form.target)} com base no mês passado (+10%). ${reply}`;
  }
  return { reply, draft: { form } };
}
