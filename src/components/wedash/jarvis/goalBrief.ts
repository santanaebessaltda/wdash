import { endOfMonth, startOfMonth } from "@/data/wedash/engine/format";
import { fetchGoals } from "@/data/wedash/goalsRepo";
import { fetchSalesDayAggs } from "@/data/wedash/salesRepo";
import { brlCent, monthYearTitle } from "@/lib/format";
import { matchStoresInText, scopeLabel, type JarvisContext, type JarvisStoreRef } from "./context";
import { parseGoalPeriod } from "./goalDraft";

function preferAllBrand<T extends { brand: string }>(rows: T[]): T[] {
  const all = rows.filter((r) => r.brand === "ALL");
  return all.length > 0 ? all : rows.filter((r) => r.brand !== "ALL");
}

function windowFromQuestion(question: string, today: string): { from: string; to: string; label: string } {
  const period = parseGoalPeriod(question, today);
  if (period) {
    return {
      from: period.startsOn,
      to: period.endsOn,
      label: monthYearTitle(period.startsOn),
    };
  }
  const from = startOfMonth(today);
  return { from, to: endOfMonth(from), label: monthYearTitle(from) };
}

/**
 * Lê metas publicadas que cruzam o mês pedido (padrão: mês civil de hoje)
 * e, se houver vendas no período até hoje, mostra o realizado.
 */
export async function loadGoalBrief(ctx: JarvisContext, question: string): Promise<string> {
  const named = matchStoresInText(question, ctx.stores);
  const stores: JarvisStoreRef[] = named.length > 0 ? named : ctx.stores;
  if (stores.length === 0) {
    return "Não achei filial no seu acesso pra olhar a meta.";
  }

  const win = windowFromQuestion(question, ctx.today);
  const goals = await fetchGoals({
    tenantId: ctx.tenantId,
    storeIds: stores.map((s) => s.id),
    from: win.from,
    to: win.to,
  });

  if (goals.length === 0) {
    return `Não achei meta publicada em ${win.label} para ${scopeLabel(stores, ctx.stores)}. Quer que a gente monte uma?`;
  }

  // Uma meta por loja (a mais recente que cruza o período).
  const byStore = new Map<string, (typeof goals)[0]>();
  for (const g of goals) {
    if (!byStore.has(g.storeId)) byStore.set(g.storeId, g);
  }
  const picked = [...byStore.values()];

  const salesTo = ctx.today < win.to ? ctx.today : win.to;
  const salesFrom = win.from;
  let revenueByStore = new Map<string, number>();
  try {
    const rows = await fetchSalesDayAggs({
      tenantId: ctx.tenantId,
      storeIds: picked.map((g) => g.storeId),
      from: salesFrom,
      to: salesTo,
      brand: null,
    });
    revenueByStore = new Map();
    for (const r of preferAllBrand(rows)) {
      revenueByStore.set(r.storeId, (revenueByStore.get(r.storeId) ?? 0) + r.revenueCents / 100);
    }
  } catch {
    /* só a meta basta */
  }

  const lines = picked.map((g) => {
    const storeName =
      stores.find((s) => s.id === g.storeId)?.tradeName ||
      ctx.stores.find((s) => s.id === g.storeId)?.tradeName ||
      "Filial";
    const sold = revenueByStore.get(g.storeId);
    const pct =
      sold != null && g.target > 0 ? Math.round((sold / g.target) * 1000) / 10 : null;
    const pctLabel =
      pct != null ? pct.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 }) : null;
    const progress =
      sold != null
        ? ` · realizado até ${salesTo === ctx.today ? "hoje" : salesTo.slice(8)}: ${brlCent(sold)}${
            pctLabel != null ? ` (${pctLabel}% da meta)` : ""
          }`
        : "";
    return `${storeName}: meta ${brlCent(g.target)} (${g.startsOn.slice(8)}/${g.startsOn.slice(5, 7)} a ${g.endsOn.slice(8)}/${g.endsOn.slice(5, 7)})${progress}.`;
  });

  if (picked.length === 1) {
    return lines[0]!.replace(/^[^:]+: /, (m) => `Em ${m}`);
  }
  return `Metas em ${win.label}:\n` + lines.map((l) => `· ${l}`).join("\n");
}
