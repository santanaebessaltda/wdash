import { endOfMonth } from "@/data/wedash/engine/format";
import { fetchSalesDayAggs } from "@/data/wedash/salesRepo";
import type { SalesDayAgg } from "@/data/wedash/salesTypes";
import { brlCent } from "@/lib/format";
import { matchStoresInText, scopeLabel, type JarvisContext, type JarvisStoreRef } from "./context";

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

/**
 * Interpreta período na pergunta.
 * "hoje" ≠ "este mês" (antes "hoje" caía no MTD e errava o número).
 */
export function resolveSalesWindow(question: string, today: string): SalesWindow {
  const p = question
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

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

export async function loadSalesBrief(ctx: JarvisContext, question: string): Promise<string> {
  const matched = matchStoresInText(question, ctx.stores);
  const stores = matched.length > 0 ? matched : ctx.stores;
  const window = resolveSalesWindow(question, ctx.today);
  try {
    const rows = await fetchSalesDayAggs({
      tenantId: ctx.tenantId,
      storeIds: stores.map((s) => s.id),
      from: window.from,
      to: window.to,
    });
    const brief = buildSalesBrief(rows, window, stores, ctx.stores);
    return formatSalesBrief(brief, { concise: window.label === "hoje" || window.label === "esta semana" });
  } catch (e) {
    console.warn("jarvis salesBrief:", e);
    return "Não consegui ler as vendas agora. Tente de novo em instantes ou abra a Visão geral.";
  }
}
