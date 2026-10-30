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

export type GoalDraft = {
  form: GoalDraftForm;
  /** Janela oferecida (“quer copiar a config do mês X?”); “sim” usa isso. */
  pendingConfigCopy?: { from: string; to: string } | null;
};

/** Aceite curto depois da oferta de copiar config do mês anterior. */
export function looksLikeAcceptConfigCopy(text: string): boolean {
  const p = norm(text).trim();
  if (/nao|não|deixa|sem copia|sem configurar|agora nao|agora não/.test(p)) return false;
  return (
    /^(sim|pode|quero|copia|ok)(\b|,|$)/.test(p) ||
    /pode copiar|quero (que )?copie|copia (a |a )?config|sim,? (pode|copia|quero)|copia sim|copia isso|copia dela/.test(p)
  );
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

/** Nome automatico tipo "Maio 2026" / "Novembro 2026". */
export function isAutoMonthYearName(name: string): boolean {
  const n = norm(name.trim());
  return Object.keys(MONTH_NAMES).some((m) => new RegExp(`^${m}\\s+20\\d{2}$`).test(n));
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
  // Se o periodo mudou (novembro) mas o nome ficou "Maio 2026", sincroniza.
  if (f.startsOn && (!f.name.trim() || isAutoMonthYearName(f.name))) {
    return { ...f, name: monthYearTitle(f.startsOn) };
  }
  if (f.name.trim()) return f;
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
export function parseConfigSourceMonth(
  text: string,
  today: string,
  targetStartsOn?: string | null,
): { from: string; to: string } | null {
  const p = norm(text);
  // Nao copiar por "pode seguir" / "seguir a conversa" — so pedido explicito de config/escada.
  const wantsCopy =
    /mesma configura|mesma escada|mesmo modo|copiar (a |o )?(configura|escada|meta)|copia (a |o )?(configura|escada|meta)|quero copiar|pode copiar|sim,? copia|copia (sim|isso|dela|de)|igual (a |ao |a meta |ao mes )?de |configura[cç][aã]o de |escada de /.test(
      p,
    ) || /\bcopia\b/.test(p) && /configura|escada|grupo|bonus|bônus|nivel|outubro|mes passado/.test(p);
  if (!wantsCopy) return null;

  if (/mes passado/.test(p)) {
    const base = targetStartsOn || today;
    const from = shiftMonthStart(base, -1);
    return { from, to: endOfMonth(from) };
  }

  for (const [name, month] of Object.entries(MONTH_NAMES)) {
    if (
      !new RegExp(
        `(configura|igual|copiar|copia|seguir|mesma|mesmo|escada|nivel|de).{0,48}${name}|${name}.{0,24}(configura|escada|nivel)`,
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
): Promise<{ from: string; to: string; name: string; tiers: number; groups: number } | null> {
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
      tiers: src.tiers.length,
      groups: src.groups.length,
    };
  } catch {
    return null;
  }
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
    return `${base} Fechado pra mim no chat (so texto). Quando quiser, diga "cria a meta" / Autorizo — eu salvo como rascunho em Metas (igual Salvar rascunho); voce revisa e publica la.`;
  }
  const missing = missingGoalLabels(validateGoalDraft(form));
  return `${base} Ainda falta: ${missing.join(", ")}. Pode falar o valor, a filial ou o mês.`;
}

export async function discussGoal(
  question: string,
  ctx: JarvisContext,
  prev: GoalDraft | null,
): Promise<{ reply: string; draft: GoalDraft }> {
  const prevStarts = prev?.form.startsOn ?? null;
  let form = prev?.form ?? emptyGoalForm(ctx.stores.length === 1 ? ctx.stores[0]!.id : "");
  form = mergeGoalUtterance(form, question, ctx);
  // Periodo mudou (ex.: maio → novembro): nao reaproveitar valor do mes antigo.
  if (prevStarts && form.startsOn && prevStarts !== form.startsOn && parseGoalTarget(question) == null) {
    form = { ...form, target: null };
  } else if (
    form.target != null &&
    /suger|melhorar|quanto (seria|fica)|valor vc sugere|valor voce sugere/.test(norm(question)) &&
    parseGoalTarget(question) == null
  ) {
    form = { ...form, target: null };
  }

  if (!form.startsOn) {
    const startsOn = shiftMonthStart(ctx.today, 1);
    form = ensureGoalName({ ...form, startsOn, endsOn: endOfMonth(startsOn) });
  }

  // Copia de config so se o Gestor pediu (ou aceitou a oferta); senao oferecemos a do mes anterior.
  const qn = norm(question);
  const isConfirm = /autorizo|cria a meta|pode criar|ok pode|vamos criar|salva(r)? (o )?rascunho/.test(qn);
  let sourceWin = parseConfigSourceMonth(question, ctx.today, form.startsOn);
  if (
    !sourceWin &&
    prev?.pendingConfigCopy &&
    looksLikeAcceptConfigCopy(question) &&
    !isConfirm
  ) {
    sourceWin = prev.pendingConfigCopy;
  }
  let copiedLadder = false;
  if (sourceWin) {
    const before = JSON.stringify({ tiers: form.tiers, groups: form.groups, tierMode: form.tierMode });
    const pool = ctx.network.length > 0 ? ctx.network : ctx.stores;
    const matched = matchStoresInText(question, pool);
    const source = pickConfigSourceStore(question, matched);
    form = await copyGoalLadderFromPeriod(form, ctx, sourceWin, source?.id);
    copiedLadder =
      JSON.stringify({ tiers: form.tiers, groups: form.groups, tierMode: form.tierMode }) !== before;
    if (looksLikeGoalLadderTalk(question) && /10\s*%|por cento a mais|nivel desafio|meta desafio/.test(qn)) {
      form = { ...form, tiers: applyChallengeTierPct(form.tiers, 110) };
    }
  }

  const period =
    form.startsOn && form.endsOn ? { from: form.startsOn, to: form.endsOn } : null;
  const bias = period ? seasonalBiasForPeriod(period.from, period.to) : null;
  const lockedTarget = parseGoalTarget(question);
  const wantsValueHelp =
    !isConfirm &&
    lockedTarget == null &&
    (form.target == null ||
      /suger|propor|basead|historico|mes passado|melhorar|subir|aumentar|quanto (seria|fica)|valor da meta|da pra melhorar|da para melhorar/.test(
        qn,
      ));

  let suggestionNote: string | null = null;
  if (wantsValueHelp && form.storeId) {
    const suggested = await suggestGoalTarget(ctx, form.storeId, period);
    if (suggested != null) {
      form = { ...form, target: suggested.amount };
      suggestionNote = `Sugeri ${brlCent(suggested.amount)} (${suggested.rationale}). ${suggested.seasonalSummary}`;
    }
  }
  // Alvo falado pelo Gestor ("270 mil") sempre ganha da sugestao automatica / R$ antigo no historico.
  if (lockedTarget != null) {
    form = { ...form, target: lockedTarget };
  }

  let pendingConfigCopy: GoalDraft["pendingConfigCopy"] = null;
  let configOffer: string | null = null;
  if (!copiedLadder && form.storeId && form.startsOn && !isConfirm) {
    const prior = await findPriorGoalForStore(ctx, form.storeId, form.startsOn);
    if (prior) {
      pendingConfigCopy = { from: prior.from, to: prior.to };
      configOffer =
        `Tem meta em ${monthYearTitle(prior.from)} nessa filial (${prior.tiers} niveis` +
        (prior.groups > 0 ? `, ${prior.groups} grupos` : "") +
        `). Quer que eu copie a configuração (escada, bônus opcional e distribuição por grupo)?`;
    }
  }

  const storeName =
    ctx.network.find((s) => s.id === form.storeId)?.tradeName ??
    ctx.stores.find((s) => s.id === form.storeId)?.tradeName ??
    "";
  let reply = formatGoalProposal(form, storeName);
  if (copiedLadder) {
    reply = `Copiei escada, bônus e grupos da meta de ${monthYearTitle(sourceWin!.from)}. ${reply}`;
  }
  if (suggestionNote) {
    reply = `${suggestionNote} ${reply}`;
  } else if (bias && bias.events.length > 0 && !isConfirm) {
    reply = `${bias.summary} ${reply}`;
  }
  if (configOffer) {
    reply = `${reply} ${configOffer}`;
  }
  return { reply, draft: { form, pendingConfigCopy } };
}
