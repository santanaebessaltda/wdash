import { endOfMonth } from "@/data/wedash/engine/format";
import { fetchSalesDayAggs } from "@/data/wedash/salesRepo";
import type { SalesDayAgg } from "@/data/wedash/salesTypes";
import { brlCent } from "@/lib/format";
import { resolveStoresInQuestion, scopeLabel, type JarvisContext, type JarvisStoreRef } from "./context";

export type SalesWindow = { from: string; to: string; label: string };

export type SalesBrief = {
  from: string;
  to: string;
  label: string;
  storeLabel: string;
  revenue: number;
  salesCount: number;
  itemCount: number;
  ticket: number | null;
  pa: number | null;
  byMonth: { month: string; revenue: number; salesCount: number }[];
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function monthStartOf(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function shiftMonthStart(isoDay: string, delta: number): string {
  const y = Number(isoDay.slice(0, 4));
  const m = Number(isoDay.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
}

function preferAllBrand(rows: SalesDayAgg[]): SalesDayAgg[] {
  const all = rows.filter((r) => r.brand === "ALL");
  return all.length > 0 ? all : rows.filter((r) => r.brand !== "ALL");
}

function weekStartIso(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  const dow = dt.getUTCDay(); // 0=dom
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + mondayOffset);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
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

const MONTH_LABELS = [
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

function normQ(question: string): string {
  return question
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function monthWindow(year: number, month: number): SalesWindow {
  const from = `${year}-${pad(month)}-01`;
  return {
    from,
    to: endOfMonth(from),
    label: `${MONTH_LABELS[month - 1]} ${year}`,
  };
}

/** Ano explícito; “ano passado” = ano civil de `today` − 1 (vale em 2027, 2030…). */
export function resolveNamedMonth(
  question: string,
  today: string,
  monthName: string,
): { year: number; month: number } | null {
  const p = normQ(question);
  const month = MONTH_NAMES[monthName];
  if (!month) return null;
  const yNow = Number(today.slice(0, 4));
  const lastYear = yNow - 1;
  const mNow = Number(today.slice(5, 7));
  const reYear = new RegExp(`${monthName}\\s+(?:de\\s+)?(20\\d{2})`);
  const yHit = p.match(reYear);
  // Ano explícito do Gestor/pedido prevalece (ex.: “novembro 2024”).
  if (yHit) return { year: Number(yHit[1]), month };
  const nearPast = new RegExp(
    `${monthName}.{0,24}ano passado|ano passado.{0,24}${monthName}|${monthName} (do |de )?ano passado`,
  );
  if (nearPast.test(p) || (/ano passado/.test(p) && p.includes(monthName))) {
    return { year: lastYear, month };
  }
  // Mês ainda não chegou neste ano → tipicamente o mesmo mês do ano passado.
  if (month > mNow) return { year: lastYear, month };
  return { year: yNow, month };
}

function firstNamedMonthInText(p: string): string | null {
  let best: { name: string; idx: number } | null = null;
  for (const name of Object.keys(MONTH_NAMES)) {
    const idx = p.indexOf(name);
    if (idx < 0) continue;
    if (!best || idx < best.idx) best = { name, idx };
  }
  return best?.name ?? null;
}

/**
 * Out→nov (ou par “de X pra Y”) no mesmo ano, com opção de replicar no ano atual.
 * Ex.: “novembro ano passado vs outubro, replicar pra cá”.
 */
export function resolveSalesComparison(
  question: string,
  today: string,
): { base: SalesWindow; next: SalesWindow; applyFrom: SalesWindow | null } | null {
  const p = normQ(question);
  const wantsGrowth =
    /crescimento|queda|variacao|replicar|mesmo padrao|de .+ pra |pra (ca|esse|este)\b/.test(p) ||
    /outubro.{0,48}novembro|novembro.{0,48}outubro/.test(p);
  if (!wantsGrowth) return null;

  const pair = p.match(
    /(?:de\s+)?(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*(?:pra|para|a|ate|->)\s*(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/,
  );

  let baseName: string;
  let nextName: string;
  if (pair) {
    baseName = pair[1]!;
    nextName = pair[2]!;
  } else if (/novembro/.test(p) && /outubro/.test(p)) {
    // Pedido típico de meta: out→nov.
    baseName = "outubro";
    nextName = "novembro";
  } else {
    return null;
  }

  const nextRef = resolveNamedMonth(question, today, nextName);
  const baseRef = resolveNamedMonth(question, today, baseName);
  if (!nextRef || !baseRef) return null;

  // Mesmo ano de referência (preferir o do “ano passado” / mês alvo).
  const year = /ano passado/.test(p) ? Number(today.slice(0, 4)) - 1 : nextRef.year;
  const base = monthWindow(year, MONTH_NAMES[baseName]!);
  const next = monthWindow(year, MONTH_NAMES[nextName]!);
  const yNow = Number(today.slice(0, 4));
  const applyFrom =
    /replicar|pra ca|para ca|esse ano|este ano|projet/.test(p) || /meta/.test(p)
      ? monthWindow(yNow, MONTH_NAMES[baseName]!)
      : null;
  return { base, next, applyFrom };
}

/**
 * Interpreta período na pergunta.
 * "hoje" ≠ "este mês" (antes "hoje" caía no MTD e errava o número).
 */
export function resolveSalesWindow(question: string, today: string): SalesWindow {
  const p = normQ(question);

  if (/mes passado|ultimo mes/.test(p)) {
    const from = shiftMonthStart(today, -1);
    return { from, to: endOfMonth(from), label: "mês passado" };
  }
  // "hoje" / "vendi hoje" — só o dia (não misturar com mês/semana).
  if (/\bhoje\b/.test(p) && !/\b(semana|mes)\b/.test(p)) {
    return { from: today, to: today, label: "hoje" };
  }
  if (/esta semana|essa semana|semana atual/.test(p)) {
    return { from: weekStartIso(today), to: today, label: "esta semana" };
  }
  if (/este mes|esse mes|mes atual|mtd/.test(p)) {
    return { from: monthStartOf(today), to: today, label: "este mês até hoje" };
  }

  const named = firstNamedMonthInText(p);
  if (named) {
    const hit = resolveNamedMonth(question, today, named);
    if (hit) return monthWindow(hit.year, hit.month);
  }

  const nMatch = p.match(/ultim[oa]s?\s+(\d+)\s*mes/);
  const months = nMatch ? Math.min(12, Math.max(1, Number(nMatch[1]))) : 3;
  const from = shiftMonthStart(today, -(months - 1));
  return {
    from: monthStartOf(from),
    to: today,
    label: months === 1 ? "este mês até hoje" : `últimos ${months} meses até hoje`,
  };
}

/** Período do Dashboard (URL / sessionStorage) a partir da pergunta. */
export function periodKindFromQuestion(
  question: string,
): "today" | "thisWeek" | "thisMonth" | "lastMonth" | null {
  const p = question
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (/mes passado|ultimo mes/.test(p)) return "lastMonth";
  if (/\bhoje\b/.test(p) && !/\b(semana|mes)\b/.test(p)) return "today";
  if (/esta semana|essa semana|semana atual/.test(p)) return "thisWeek";
  if (/este mes|esse mes|mes atual|mtd/.test(p)) return "thisMonth";
  return null;
}

export function buildSalesBrief(
  rows: SalesDayAgg[],
  window: SalesWindow,
  stores: JarvisStoreRef[],
  allStores: JarvisStoreRef[],
): SalesBrief {
  const scoped = new Set(stores.map((s) => s.id));
  const days = preferAllBrand(rows).filter((r) => scoped.has(r.storeId));
  let revenue = 0;
  let salesCount = 0;
  let itemCount = 0;
  const monthMap = new Map<string, { revenue: number; salesCount: number }>();

  for (const r of days) {
    revenue += r.revenueCents;
    salesCount += r.salesCount;
    itemCount += r.itemCount;
    const key = r.day.slice(0, 7);
    const cur = monthMap.get(key) ?? { revenue: 0, salesCount: 0 };
    cur.revenue += r.revenueCents;
    cur.salesCount += r.salesCount;
    monthMap.set(key, cur);
  }

  const byMonth = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, revenue: v.revenue / 100, salesCount: v.salesCount }));

  return {
    from: window.from,
    to: window.to,
    label: window.label,
    storeLabel: scopeLabel(stores, allStores),
    revenue: revenue / 100,
    salesCount,
    itemCount,
    ticket: salesCount > 0 ? revenue / 100 / salesCount : null,
    pa: salesCount > 0 ? itemCount / salesCount : null,
    byMonth,
  };
}

export function formatSalesBrief(brief: SalesBrief, opts?: { concise?: boolean }): string {
  if (brief.salesCount === 0 && brief.revenue === 0) {
    return `Não achei venda sincronizada em ${brief.storeLabel} (${brief.label}). Vale conferir o sync ou o filtro de filial.`;
  }
  // Resposta curta (voz / “quanto vendi hoje”).
  if (opts?.concise || brief.label === "hoje") {
    return (
      `${brief.label === "hoje" ? "Hoje" : brief.label} em ${brief.storeLabel}: ` +
      `${brlCent(brief.revenue)}, ${brief.salesCount.toLocaleString("pt-BR")} venda${brief.salesCount === 1 ? "" : "s"}.`
    );
  }
  const ticket = brief.ticket != null ? brlCent(brief.ticket) : "—";
  const pa = brief.pa != null ? brief.pa.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";
  const months =
    brief.byMonth.length > 1
      ? ` Por mês: ${brief.byMonth
          .map((m) => `${fmtMonth(m.month)} ${brlCent(m.revenue)} (${m.salesCount} vendas)`)
          .join("; ")}.`
      : "";
  return (
    `Em ${brief.storeLabel}, ${brief.label} (${fmtDate(brief.from)} a ${fmtDate(brief.to)}): ` +
    `faturamento ${brlCent(brief.revenue)}, ${brief.salesCount.toLocaleString("pt-BR")} vendas, ` +
    `ticket médio ${ticket}, P.A. ${pa}.${months} ` +
    `Se quiser, a gente usa isso para discutir meta ou desafio — sem gravar até você autorizar.`
  );
}

function fmtDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${names[Number(m) - 1]}/${y?.slice(2)}`;
}

async function briefForWindow(
  ctx: JarvisContext,
  stores: JarvisStoreRef[],
  window: SalesWindow,
): Promise<SalesBrief> {
  const rows = await fetchSalesDayAggs({
    tenantId: ctx.tenantId,
    storeIds: stores.map((s) => s.id),
    from: window.from,
    to: window.to,
  });
  return buildSalesBrief(rows, window, stores, ctx.stores);
}

/** Comparativo out→nov (etc.) com variação % e projeção opcional. */
export function formatSalesComparison(
  storeLabel: string,
  base: SalesBrief,
  next: SalesBrief,
  applyFrom: SalesBrief | null,
): string {
  const lines: string[] = [
    `COMPARATIVO DE VENDAS em ${storeLabel} (use estes números; NÃO misture mês/ano):`,
    `- ${base.label}: faturamento ${brlCent(base.revenue)}, ${base.salesCount.toLocaleString("pt-BR")} vendas.`,
    `- ${next.label}: faturamento ${brlCent(next.revenue)}, ${next.salesCount.toLocaleString("pt-BR")} vendas.`,
  ];
  if (base.revenue > 0) {
    const pct = ((next.revenue - base.revenue) / base.revenue) * 100;
    const sign = pct > 0 ? "+" : "";
    lines.push(
      `- Variação ${base.label} → ${next.label}: ${sign}${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% (delta ${brlCent(next.revenue - base.revenue)}).`,
    );
    if (applyFrom) {
      const projected = applyFrom.revenue * (1 + pct / 100);
      const nextMonth = Number(applyFrom.from.slice(5, 7));
      const nextYear = Number(applyFrom.from.slice(0, 4));
      const projMonth = nextMonth === 12 ? 1 : nextMonth + 1;
      const projYear = nextMonth === 12 ? nextYear + 1 : nextYear;
      lines.push(`- ${applyFrom.label} (base deste ano): ${brlCent(applyFrom.revenue)}.`);
      lines.push(
        `- Se replicar a mesma variação: projeção ${MONTH_LABELS[projMonth - 1]} ${projYear} ≈ ${brlCent(projected)}.`,
      );
    }
  } else {
    lines.push(`- Sem base em ${base.label} para calcular variação %.`);
  }
  lines.push(
    "Ao falar com o Gestor: cite cada valor com seu mês/ano. Nunca diga que nov passado 'foi' o número de out deste ano.",
  );
  return lines.join("\n");
}

/** Últimos N meses deste ano vs a mesma janela no ano passado. */
export function resolveYoYRecentMonths(
  question: string,
  today: string,
): { current: SalesWindow; prior: SalesWindow } | null {
  const p = normQ(question);
  if (!/ano passado/.test(p)) return null;
  if (!/crescimento|queda|variacao|ultim|meses|historico|ideia/.test(p)) return null;
  // Se já é par out→nov explícito, deixa resolveSalesComparison cuidar.
  if (
    /(?:de\s+)?(outubro|novembro).{0,20}(pra|para|a)\s+(outubro|novembro)/.test(p) &&
    /outubro/.test(p) &&
    /novembro/.test(p)
  ) {
    return null;
  }
  const nMatch = p.match(/ultim[oa]s?\s+(\d+)\s*mes/);
  const months = nMatch ? Math.min(12, Math.max(1, Number(nMatch[1]))) : 3;
  const yNow = Number(today.slice(0, 4));
  const fromCur = monthStartOf(shiftMonthStart(today, -(months - 1)));
  const current: SalesWindow = {
    from: fromCur,
    to: today,
    label: `últimos ${months} meses até ${today} (${yNow})`,
  };
  const fromPrior = `${yNow - 1}-${fromCur.slice(5)}`;
  const toPrior = `${yNow - 1}-${today.slice(5)}`;
  const prior: SalesWindow = {
    from: fromPrior,
    to: toPrior,
    label: `mesmo período em ${yNow - 1}`,
  };
  return { current, prior };
}

export function formatYoYRecent(
  storeLabel: string,
  current: SalesBrief,
  prior: SalesBrief,
  today: string,
): string {
  const lines = [
    `COMPARATIVO em ${storeLabel} (hoje no app: ${today}):`,
    `- ${current.label}: ${brlCent(current.revenue)}, ${current.salesCount.toLocaleString("pt-BR")} vendas.`,
  ];
  if (current.byMonth.length) {
    lines.push(
      `  Por mês: ${current.byMonth.map((m) => `${fmtMonth(m.month)} ${brlCent(m.revenue)}`).join("; ")}.`,
    );
  }
  lines.push(
    `- ${prior.label}: ${brlCent(prior.revenue)}, ${prior.salesCount.toLocaleString("pt-BR")} vendas.`,
  );
  if (prior.byMonth.length) {
    lines.push(
      `  Por mês: ${prior.byMonth.map((m) => `${fmtMonth(m.month)} ${brlCent(m.revenue)}`).join("; ")}.`,
    );
  }
  if (prior.revenue > 0) {
    const pct = ((current.revenue - prior.revenue) / prior.revenue) * 100;
    const sign = pct > 0 ? "+" : "";
    lines.push(
      `- Variação (mesma janela vs período anterior): ${sign}${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%.`,
    );
  }
  lines.push("Cite cada valor com o mês/ano que a tool indicou.");
  return lines.join("\n");
}

export async function loadSalesBrief(
  ctx: JarvisContext,
  question: string,
  userQuestion = "",
): Promise<string> {
  // Pedido do Gestor + do modelo: a tool resolve datas relativas a partir de ctx.today.
  const blob = `${userQuestion}\n${question}`.trim();
  const stores = resolveStoresInQuestion(blob, ctx);
  try {
    const cmp = resolveSalesComparison(blob, ctx.today);
    if (cmp) {
      const base = await briefForWindow(ctx, stores, cmp.base);
      const next = await briefForWindow(ctx, stores, cmp.next);
      const applyFrom = cmp.applyFrom ? await briefForWindow(ctx, stores, cmp.applyFrom) : null;
      return formatSalesComparison(scopeLabel(stores, ctx.stores), base, next, applyFrom);
    }
    const yoy = resolveYoYRecentMonths(blob, ctx.today);
    if (yoy) {
      const current = await briefForWindow(ctx, stores, yoy.current);
      const prior = await briefForWindow(ctx, stores, yoy.prior);
      return formatYoYRecent(scopeLabel(stores, ctx.stores), current, prior, ctx.today);
    }
    const window = resolveSalesWindow(blob, ctx.today);
    const brief = await briefForWindow(ctx, stores, window);
    return formatSalesBrief(brief, { concise: window.label === "hoje" || window.label === "esta semana" });
  } catch (e) {
    console.warn("jarvis salesBrief:", e);
    return "Não consegui ler as vendas agora. Tente de novo em instantes ou abra a Visão geral.";
  }
}
