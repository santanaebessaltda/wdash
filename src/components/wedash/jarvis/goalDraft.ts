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

/** Checklist antes de gravar o rascunho em Metas — montagem guiada no chat. */
export type GoalAssembly = {
  /** Gestor confirmou o mês (não inferir sozinho e empurrar número). */
  periodConfirmed: boolean;
  /** Já falou valor ou pediu sugestão — aí sim sugerimos/fechamos alvo. */
  valueDiscussed: boolean;
  /** copy = veio de meta anterior; fresh = montar do zero; null = ainda decidindo. */
  path: "copy" | "fresh" | null;
  confirmedGroups: boolean;
  confirmedSpread: boolean;
  confirmedTiers: boolean;
  /** “Pode montar o rascunho?” — obrigatório mesmo após copiar config. */
  confirmedMount: boolean;
};

export type GoalDraft = {
  form: GoalDraftForm;
  /** Janela oferecida (“quer copiar a config do mês X?”); “sim” usa isso. */
  pendingConfigCopy?: { from: string; to: string } | null;
  assembly?: GoalAssembly;
};

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
  const p = norm(text);
  return /suger|propor|ideia de (meta|valor)|quanto (seria|fica|voce|vc)|me (da|dá) (um |uma )?(valor|ideia|numero|número)|pode (suger|calcular|propor)|basead|historico|histórico|nao sei|não sei|sem ideia|voce sugere|você sugere|valor vc sugere|valor voce sugere|da pra melhorar|da para melhorar/.test(
    p,
  );
}

/** Form válido + checklist de montagem confirmado. */
export function goalCanCommit(draft: GoalDraft): boolean {
  const a = draft.assembly ?? emptyGoalAssembly();
  return (
    goalDraftReady(draft.form) &&
    a.confirmedGroups &&
    a.confirmedSpread &&
    a.confirmedTiers &&
    a.confirmedMount
  );
}

/** Aceite curto depois da oferta de copiar config do mês anterior. */
export function looksLikeAcceptConfigCopy(text: string): boolean {
  const p = norm(text).trim();
  if (looksLikeDeclineConfigCopy(text)) return false;
  return (
    /^(sim|pode|quero|copia|ok)(\b|,|$)/.test(p) ||
    /pode copiar|quero (que )?copie|copia (a |a )?config|sim,? (pode|copia|quero)|copia sim|copia isso|copia dela/.test(p)
  );
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
  if (/ratear|rateio|marcar|com rateio|sim.*(rate|identif|vendedor)/.test(p)) return true;
  if (/^(sim|pode|quero|ok)(\b|,|$)/.test(p)) return true;
  if (/^(nao|não)(\b|,|$)/.test(p)) return false;
  return null;
}

export function looksLikeConfirmTiers(text: string): boolean {
  const p = norm(text).trim();
  if (/nao|não|muda|altera|troca|outro nivel|outra escada/.test(p) && !/nao precisa mudar|não precisa mudar/.test(p)) {
    if (/^(nao|não)(\b|,|$)/.test(p)) return false;
    if (/muda|altera|troca/.test(p)) return false;
  }
  return (
    /^(sim|pode|ok|confirma|confirmo|fechado|isso|pode ser)(\b|,|$)/.test(p) ||
    /confirma (a |os )?(escada|niveis|níveis)|escada (ok|boa|fechada)|niveis ok|níveis ok|pode manter/.test(p)
  );
}

export function looksLikeConfirmMount(text: string): boolean {
  const p = norm(text).trim();
  if (looksLikeDeclineConfigCopy(text) && !/monta/.test(p)) return false;
  return (
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
  /** Blocos curtos pra bolhas no chat. */
  chatBlocks: string[];
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Sugere meta: histórico × crescimento observado × sazonal; compara meta anterior. */
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
  const prevYoyFrom = shiftMonthStart(yoyFrom, -12);
  const prevYoyTo = endOfMonth(prevYoyFrom);

  try {
    const [lastRows, yoyRows, prevYoyRows, priorGoal] = await Promise.all([
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
      fetchSalesDayAggs({
        tenantId: ctx.tenantId,
        storeIds: [storeId],
        from: prevYoyFrom,
        to: prevYoyTo,
      }),
      findPriorGoalForStore(ctx, storeId, targetFrom),
    ]);
    const lastCents = preferAllBrand(lastRows).reduce((s, r) => s + r.revenueCents, 0);
    const yoyCents = preferAllBrand(yoyRows).reduce((s, r) => s + r.revenueCents, 0);
    const prevYoyCents = preferAllBrand(prevYoyRows).reduce((s, r) => s + r.revenueCents, 0);

    let baseCents = 0;
    const baseBits: string[] = [];
    if (yoyCents > 0) {
      baseBits.push(`mesmo mês ano passado (${brlCent(yoyCents / 100)})`);
    }
    if (lastCents > 0) {
      baseBits.push(`mês recente (${brlCent(lastCents / 100)})`);
    }
    if (yoyCents > 0 && lastCents > 0) {
      baseCents = (yoyCents + lastCents) / 2;
    } else if (yoyCents > 0) {
      baseCents = yoyCents;
    } else if (lastCents > 0) {
      baseCents = lastCents;
    } else {
      return null;
    }

    // Crescimento (ou queda) do mesmo mês: ano passado vs dois anos atrás.
    let growthPct = 0.05;
    let growthLabel = "coloquei +5% de folga de crescimento";
    if (prevYoyCents > 0 && yoyCents > 0) {
      const observed = (yoyCents - prevYoyCents) / prevYoyCents;
      growthPct = clamp(observed, -0.12, 0.22);
      const rounded = Math.round(growthPct * 100);
      growthLabel =
        rounded === 0
          ? "no mesmo mês o faturamento ficou estável ano a ano"
          : rounded > 0
            ? `nesse mês o faturamento cresceu cerca de ${rounded}% vs o ano anterior; usei isso de referência`
            : `nesse mês o faturamento caiu cerca de ${Math.abs(rounded)}% vs o ano anterior; usei isso de referência`;
    }

    const growth = 1 + growthPct;
    const raw = (baseCents / 100) * growth * bias.factor;
    const amount = Math.round(raw / 100) * 100;
    if (amount <= 0) return null;

    const sazonalPct = Math.round((bias.factor - 1) * 100);
    const sazonalBit =
      bias.factor === 1
        ? "sem ajuste sazonal forte"
        : `ajuste sazonal ${sazonalPct > 0 ? "+" : ""}${sazonalPct}%`;
    const rationale = `${baseBits.join(" + ")}; ${growthLabel}; ${sazonalBit}`;

    const chatBlocks: string[] = [
      `Eu iria de ${brlCent(amount)}.`,
      `${baseBits.join("; ")}. ${growthLabel.charAt(0).toUpperCase()}${growthLabel.slice(1)}.`,
    ];
    if (priorGoal && priorGoal.target > 0) {
      const deltaPct = Math.round(((amount - priorGoal.target) / priorGoal.target) * 100);
      chatBlocks.push(
        `Na meta de ${monthYearTitle(priorGoal.from)} vocês tinham ${brlCent(priorGoal.target)}` +
          (deltaPct === 0
            ? ". Fico na mesma faixa."
            : deltaPct > 0
              ? `. Isso aqui fica uns ${deltaPct}% acima.`
              : `. Isso aqui fica uns ${Math.abs(deltaPct)}% abaixo.`),
      );
    } else if (bias.events.length > 0 && sazonalPct !== 0) {
      chatBlocks.push(`Sazonal do mês: ${sazonalBit}.`);
    }
    chatBlocks.push("Faz sentido pra você, ou prefere outro número?");

    return { amount, rationale, seasonalSummary: bias.summary, chatBlocks };
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
    return form.startsOn
      ? `${monthYearTitle(form.startsOn)}, fechado. Qual filial?`
      : "Qual filial a gente usa?";
  }
  if (!a.valueDiscussed || form.target == null) {
    const month = form.startsOn ? monthYearTitle(form.startsOn) : "esse mês";
    return `${month} então.\n\nQual valor de meta você quer? Ou prefere que eu sugira com o histórico?`;
  }
  if (a.path === null) {
    return `Ficou ${brlCent(form.target!)}.\n\nCopia a escada da meta anterior dessa filial, ou monta do zero?`;
  }
  if (a.path === "fresh" && !a.confirmedGroups) {
    return "Divisão por grupo: rateia entre os grupos, ou loja inteira?";
  }
  if (a.path === "fresh" && !a.confirmedSpread) {
    return "Venda sem vendedor identificado: rateia na equipe do dia, ou deixa de fora?";
  }
  if (a.path === "fresh" && !a.confirmedTiers) {
    return `Escada: ${formatTiersBrief(form.tiers)}. Serve?`;
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
  const payload = {
    nome: form.name || "Nova meta",
    filial: storeName || form.storeId || "?",
    periodo: period,
    alvo_centavos: form.target,
    alvo_formatado: form.target != null ? brlCent(form.target) : null,
    modo: form.tierMode,
    niveis: formatTiersBrief(form.tiers),
    grupos: form.groups.length,
    rateio_sem_id: form.spreadUnidentified,
    faltando: missing,
    periodConfirmed: a.periodConfirmed,
    valueDiscussed: a.valueDiscussed,
    path: a.path,
    confirmedGroups: a.confirmedGroups,
    confirmedSpread: a.confirmedSpread,
    confirmedTiers: a.confirmedTiers,
    confirmedMount: a.confirmedMount,
    pode_gravar_rascunho: goalCanCommit(draft),
    pendingConfigCopy: draft.pendingConfigCopy,
    checklist_pendente: pending,
    proximo_passo_sugerido: nextHint,
    instrucao:
      "Avance UM item do checklist_pendente por turno (fale humano). Sempre chame draft_goal neste fio. Nunca diga 'vou preparar/montar' sem ter chamado draft_goal. commit_draft so se pode_gravar_rascunho.",
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
  if (!a.valueDiscussed || form.target == null) pending.push("valor-alvo (R$)");
  if (a.periodConfirmed && form.storeId && a.valueDiscussed && form.target != null) {
    if (a.path === null) pending.push("copiar escada/config da meta anterior ou montar do zero");
    if (a.path === "fresh") {
      if (!a.confirmedGroups) pending.push("divisão: grupos vs loja inteira");
      if (!a.confirmedSpread) pending.push("venda sem vendedor identificado (rateio ou fora)");
      if (!a.confirmedTiers) {
        pending.push(`escada/níveis (inclui nível desafio %): ${formatTiersBrief(form.tiers)}`);
      }
    }
    if (!a.confirmedMount) pending.push("confirmação para salvar o rascunho em Metas");
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

export async function discussGoal(
  question: string,
  ctx: JarvisContext,
  prev: GoalDraft | null,
): Promise<{ reply: string; draft: GoalDraft; voice: GoalDiscussVoice }> {
  const prevStarts = prev?.form.startsOn ?? null;
  let form = prev?.form ?? emptyGoalForm(ctx.stores.length === 1 ? ctx.stores[0]!.id : "");
  let assembly: GoalAssembly = { ...(prev?.assembly ?? emptyGoalAssembly()) };
  const lastUser = lastUserUtterance(question);
  const qn = norm(lastUser);
  const periodSaidNow = parseGoalPeriod(lastUser, ctx.today) != null;
  const lockedTarget = parseGoalTarget(question);
  const asksSuggestion = looksLikeAskValueSuggestion(lastUser);

  form = mergeGoalUtterance(form, question, ctx);

  // Periodo mudou (ex.: maio → novembro): nao reaproveitar valor do mes antigo.
  if (prevStarts && form.startsOn && prevStarts !== form.startsOn && lockedTarget == null) {
    form = { ...form, target: null };
    assembly = { ...emptyGoalAssembly(), periodConfirmed: periodSaidNow };
  } else if (form.target != null && asksSuggestion && lockedTarget == null) {
    form = { ...form, target: null };
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
  if (!form.storeId && ctx.stores.length === 1) form = { ...form, storeId: ctx.stores[0]!.id };
  if (!form.storeId && (ctx.network.length > 1 || ctx.stores.length > 1)) {
    const draftStore: GoalDraft = { form, pendingConfigCopy: null, assembly };
    return {
      reply: formatGoalFactsForModel(draftStore, ""),
      draft: draftStore,
      voice: "silent",
    };
  }

  const isConfirm =
    /autorizo|pode criar|ok pode|ok(,| )?vamos criar|salva(r)? (o )?rascunho|pode montar|monta (o )?rascunho/.test(qn) ||
    /^(ok[, ]*)?(cria(r)?|vamos criar) (essa |a |o )?meta( agora| ja| já)?[!?.]*$/.test(qn);

  // Ainda sem valor: nao despeja sugestão; a IA pergunta.
  if (lockedTarget == null && !asksSuggestion && !assembly.valueDiscussed && form.target == null && !isConfirm) {
    const bias = seasonalBiasForPeriod(form.startsOn!, form.endsOn!);
    const draftVal: GoalDraft = {
      form: { ...form, target: null },
      pendingConfigCopy: null,
      assembly,
    };
    const storeVal =
      ctx.network.find((s) => s.id === form.storeId)?.tradeName ??
      ctx.stores.find((s) => s.id === form.storeId)?.tradeName ??
      "";
    return {
      reply: formatGoalFactsForModel(draftVal, storeVal, [
        bias.events.length
          ? `sazonal_do_mes: ${bias.events
              .slice(0, 3)
              .map((e) => e.name)
              .join(", ")}`
          : "",
      ]),
      draft: draftVal,
      voice: "silent",
    };
  }

  if (asksSuggestion || lockedTarget != null) {
    assembly = { ...assembly, valueDiscussed: true };
  }

  // Copia de config so se o Gestor pediu (ou aceitou a oferta).
  let sourceWin = parseConfigSourceMonth(question, ctx.today, form.startsOn);
  if (!sourceWin && prev?.pendingConfigCopy && looksLikeAcceptConfigCopy(lastUser)) {
    sourceWin = prev.pendingConfigCopy;
  }
  let copiedLadder = false;
  let skipAssemblyParse = false;
  if (sourceWin) {
    const before = JSON.stringify({ tiers: form.tiers, groups: form.groups, tierMode: form.tierMode });
    const pool = ctx.network.length > 0 ? ctx.network : ctx.stores;
    const matched = matchStoresInText(question, pool);
    const source = pickConfigSourceStore(question, matched);
    form = await copyGoalLadderFromPeriod(form, ctx, sourceWin, source?.id);
    copiedLadder =
      JSON.stringify({ tiers: form.tiers, groups: form.groups, tierMode: form.tierMode }) !== before;
    if (looksLikeGoalLadderTalk(question) && /10\s*%|por cento a mais|nivel desafio|meta desafio/.test(norm(question))) {
      form = { ...form, tiers: applyChallengeTierPct(form.tiers, 110) };
    }
    assembly = {
      ...assembly,
      path: "copy",
      confirmedGroups: true,
      confirmedSpread: true,
      confirmedTiers: true,
      confirmedMount: false,
    };
    skipAssemblyParse = true;
  } else if (prev?.pendingConfigCopy && looksLikeDeclineConfigCopy(lastUser)) {
    assembly = {
      ...emptyGoalAssembly(),
      periodConfirmed: true,
      valueDiscussed: true,
      path: "fresh",
    };
    skipAssemblyParse = true;
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
      form = { ...form, target: suggested.amount };
      suggestionBlocks = suggested.chatBlocks;
      assembly = { ...assembly, valueDiscussed: true };
    }
  }
  // Alvo falado pelo Gestor ("270 mil") sempre ganha da sugestao automatica / R$ antigo no historico.
  if (lockedTarget != null) {
    form = { ...form, target: lockedTarget };
    assembly = { ...assembly, valueDiscussed: true };
  }

  form = ensureGoalName(form);
  const basicsReady = goalDraftReady(form);

  let pendingConfigCopy: GoalDraft["pendingConfigCopy"] = null;
  let configOffer: string | null = null;
  if (
    basicsReady &&
    assembly.valueDiscussed &&
    assembly.path == null &&
    !copiedLadder &&
    form.storeId &&
    form.startsOn
  ) {
    const prior = await findPriorGoalForStore(ctx, form.storeId, form.startsOn);
    if (prior && !looksLikeDeclineConfigCopy(lastUser)) {
      pendingConfigCopy = { from: prior.from, to: prior.to };
      configOffer =
        `Em ${monthYearTitle(prior.from)} essa filial já tinha meta (${brlCent(prior.target)}` +
        (prior.groups > 0 ? `, ${prior.groups} grupos` : "") +
        `). Quer aproveitar a mesma escada/bônus/grupos, ou montamos do zero?`;
      skipAssemblyParse = true;
    } else {
      assembly = { ...assembly, path: "fresh" };
      skipAssemblyParse = true;
    }
  }

  // Montagem guiada (fresh): grupos → rateio → níveis → confirma montar.
  if (basicsReady && assembly.path === "fresh" && !pendingConfigCopy && !skipAssemblyParse) {
    if (!assembly.confirmedGroups) {
      const choice = parseGroupsDistributionChoice(lastUser);
      if (choice != null) {
        if (choice) form = { ...form, tierMode: form.tierMode === "GENERAL" ? "GROUP" : form.tierMode };
        assembly = { ...assembly, confirmedGroups: true };
      }
    } else if (!assembly.confirmedSpread) {
      const choice = parseSpreadUnidentifiedChoice(lastUser);
      if (choice != null) {
        form = { ...form, spreadUnidentified: choice };
        assembly = { ...assembly, confirmedSpread: true };
      }
    } else if (!assembly.confirmedTiers) {
      if (looksLikeConfirmTiers(lastUser)) {
        assembly = { ...assembly, confirmedTiers: true };
      }
    }
  }

  if (
    basicsReady &&
    !skipAssemblyParse &&
    assembly.path != null &&
    assembly.confirmedGroups &&
    assembly.confirmedSpread &&
    assembly.confirmedTiers &&
    !assembly.confirmedMount &&
    looksLikeConfirmMount(lastUser)
  ) {
    assembly = { ...assembly, confirmedMount: true };
  }

  const storeName =
    ctx.network.find((s) => s.id === form.storeId)?.tradeName ??
    ctx.stores.find((s) => s.id === form.storeId)?.tradeName ??
    "";

  const draftOut: GoalDraft = { form, pendingConfigCopy, assembly };
  const extras: string[] = [];
  if (suggestionBlocks.length > 0) {
    extras.push(`sugestao_calculada:\n${suggestionBlocks.join("\n")}`);
  }
  if (copiedLadder && sourceWin) {
    extras.push(`config_copiada_de: ${monthYearTitle(sourceWin.from)}`);
  }
  if (configOffer) extras.push(`oferta_copiar_config: ${configOffer}`);
  return {
    reply: formatGoalFactsForModel(draftOut, storeName, extras),
    draft: draftOut,
    voice: "silent",
  };
}
