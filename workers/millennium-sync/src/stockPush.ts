/**
 * Alerta de estoque: na primeira rodada automática do dia, só quando o produto
 * passa a ficar abaixo do mínimo. Continua abaixo, não repete. Voltou ao mínimo
 * e caiu de novo, avisa outra vez.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { localClock } from "./autoRefresh.ts";
import { notifyScoped, type SalesPushStore } from "./salesPush.ts";

const BODY_LIMIT = 180;

export type PurchaseTotalLine = { code: string; description: string; total: number };

export type StockShort = { code: string; name: string; total: number; min: number };

const daySubject = (storeId: string, day: string) => `day|${storeId}|${day}`;
const productSubject = (storeId: string, code: string) => `prod|${storeId}|${code}`;

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asStr(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function rowsOf(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const key of ["value", "Value", "data", "Data", "RAW_DATA"]) {
    if (Array.isArray(o[key])) return o[key] as Record<string, unknown>[];
  }
  return [];
}

/** Variantes do Saldo Atual e Futuro, uma linha por código + cor + estampa + tamanho. */
export function parsePurchaseTotals(payload: unknown): PurchaseTotalLine[] {
  const out: PurchaseTotalLine[] = [];
  for (const raw of rowsOf(payload)) {
    const code = asStr(raw.COD_PRODUTO);
    if (!code) continue;
    const balance = asNum(raw.SALDO) ?? 0;
    const openOrder = asNum(raw.QUANTIDADE_PEDIDO) ?? 0;
    out.push({
      code,
      description: asStr(raw.DESCRICAO1),
      total: asNum(raw.TOTAL) ?? balance + openOrder,
    });
  }
  return out;
}

function qty(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

/** Produtos com mínimo gravado cujo total (somando as variantes) ficou abaixo. O maior buraco vem primeiro. */
export function productsBelowMin(lines: PurchaseTotalLine[], mins: Map<string, number>): StockShort[] {
  const byCode = new Map<string, { description: string; total: number }>();
  for (const line of lines) {
    const prev = byCode.get(line.code);
    if (prev) prev.total += line.total;
    else byCode.set(line.code, { description: line.description, total: line.total });
  }
  const out: StockShort[] = [];
  for (const [code, row] of byCode) {
    const min = mins.get(code);
    if (min == null || min <= 0 || row.total >= min) continue;
    out.push({ code, name: row.description || code, total: row.total, min });
  }
  out.sort((a, b) => b.min - b.total - (a.min - a.total) || a.name.localeCompare(b.name, "pt-BR"));
  return out;
}

/** `already` são os códigos já avisados enquanto estavam abaixo. Some do conjunto quando volta ao mínimo. */
export function planStockAlerts(
  lines: PurchaseTotalLine[],
  mins: Map<string, number>,
  already: Set<string>,
): { alert: StockShort[]; rearm: string[] } {
  const below = productsBelowMin(lines, mins);
  const belowCodes = new Set(below.map((product) => product.code));
  const present = new Set(lines.map((line) => line.code));
  const rearm: string[] = [];
  for (const code of already) {
    if (belowCodes.has(code)) continue;
    const min = mins.get(code);
    if (min == null || min <= 0 || present.has(code)) rearm.push(code);
  }
  return { alert: below.filter((product) => !already.has(product.code)), rearm };
}

export function formatStockPush(stores: Array<{ name: string; products: StockShort[] }>): { title: string; body: string } | null {
  const listed = stores.filter((store) => store.products.length > 0);
  if (listed.length === 0) return null;
  const count = listed.reduce((sum, store) => sum + store.products.length, 0);
  const title = `Estoque · ${count} abaixo do mínimo`;
  const items = listed.flatMap((store) =>
    store.products.map((product, index) => ({
      header: index === 0 ? store.name : null,
      line: `${product.name} · ${qty(product.total)} de ${qty(product.min)}`,
    })),
  );
  const lines: string[] = [];
  let shown = 0;
  for (const item of items) {
    const chunk = [item.header, item.line].filter(Boolean) as string[];
    const next = [...lines, ...chunk].join("\n");
    if (next.length > BODY_LIMIT && shown > 0) break;
    lines.push(...chunk);
    shown += 1;
  }
  const hidden = count - shown;
  if (hidden > 0) lines.push(`e mais ${hidden} ${hidden === 1 ? "produto" : "produtos"}`);
  return { title, body: lines.join("\n") };
}

export async function notifyStockLow(
  sb: SupabaseClient,
  args: {
    tenantId: string;
    session: string;
    stores: Array<SalesPushStore & { millenniumStoreId: number }>;
    fetchReport: (millenniumStoreId: number) => Promise<unknown>;
    now?: Date;
  },
): Promise<void> {
  if (args.stores.length === 0) return;
  const now = args.now ?? new Date();
  const due = args.stores.map((store) => ({
    store,
    day: localClock(now, store.timezone || "America/Campo_Grande").day,
  }));
  const daySubjects = due.map(({ store, day }) => daySubject(store.id, day));
  const { data: dayMarks, error: dayErr } = await sb
    .from("notification_mark")
    .select("subject")
    .eq("tenant_id", args.tenantId)
    .eq("kind", "stock_low")
    .in("subject", daySubjects);
  if (dayErr) throw dayErr;
  const done = new Set((dayMarks ?? []).map((row) => row.subject as string));
  const pending = due.filter(({ store, day }) => !done.has(daySubject(store.id, day)));
  if (pending.length === 0) return;

  const ids = pending.map(({ store }) => store.id);
  const pendingIds = new Set(ids);
  const [{ data: minRows, error: minErr }, { data: prodMarks, error: prodErr }] = await Promise.all([
    sb.from("store_purchase_min").select("store_id, product_code, min_qty").eq("tenant_id", args.tenantId).in("store_id", ids),
    sb.from("notification_mark").select("subject").eq("tenant_id", args.tenantId).eq("kind", "stock_low").like("subject", "prod|%"),
  ]);
  if (minErr) throw minErr;
  if (prodErr) throw prodErr;

  const minsByStore = new Map<string, Map<string, number>>();
  for (const row of minRows ?? []) {
    const storeId = row.store_id as string;
    const mins = minsByStore.get(storeId) ?? new Map<string, number>();
    mins.set(String(row.product_code), Number(row.min_qty) || 0);
    minsByStore.set(storeId, mins);
  }
  const alreadyByStore = new Map<string, Set<string>>();
  for (const row of prodMarks ?? []) {
    const match = /^prod\|([^|]+)\|(.*)$/.exec(String(row.subject));
    if (!match || !pendingIds.has(match[1])) continue;
    const codes = alreadyByStore.get(match[1]) ?? new Set<string>();
    codes.add(match[2]);
    alreadyByStore.set(match[1], codes);
  }

  const alerts: Array<{ id: string; name: string; timezone: string; day: string; products: StockShort[]; rearm: string[] }> = [];
  for (const { store, day } of pending) {
    const mins = minsByStore.get(store.id) ?? new Map<string, number>();
    const already = alreadyByStore.get(store.id) ?? new Set<string>();
    if (mins.size === 0) {
      alerts.push({ id: store.id, name: store.name, timezone: store.timezone, day, products: [], rearm: [...already] });
      continue;
    }
    try {
      const payload = await args.fetchReport(store.millenniumStoreId);
      const plan = planStockAlerts(parsePurchaseTotals(payload), mins, already);
      alerts.push({
        id: store.id,
        name: store.name,
        timezone: store.timezone,
        day,
        products: plan.alert,
        rearm: plan.rearm,
      });
    } catch (e) {
      console.warn(`  AVISO estoque da filial ${store.name} não entrou no push: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (alerts.length === 0) return;

  const announced = alerts.filter((store) => store.products.length > 0);
  if (announced.length > 0) {
    const byId = new Map(announced.map((store) => [store.id, store]));
    await notifyScoped(sb, {
      tenantId: args.tenantId,
      stores: announced.map((store) => ({ id: store.id, name: store.name, timezone: store.timezone })),
      pref: "stock",
      url: "/purchase-order",
      text: (stores) => formatStockPush(stores.flatMap((store) => {
        const alert = byId.get(store.id);
        return alert ? [{ name: alert.name, products: alert.products }] : [];
      })),
    });
  }

  const rows = alerts.flatMap((store) => [
    { tenant_id: args.tenantId, kind: "stock_low", subject: daySubject(store.id, store.day), level: 1 },
    ...store.products.map((product) => ({
      tenant_id: args.tenantId,
      kind: "stock_low",
      subject: productSubject(store.id, product.code),
      level: 1,
    })),
  ]);
  const { error } = await sb.from("notification_mark").upsert(rows, { onConflict: "tenant_id,kind,subject" });
  if (error) throw error;

  const rearm = alerts.flatMap((store) => store.rearm.map((code) => productSubject(store.id, code)));
  if (rearm.length === 0) return;
  const { error: dropErr } = await sb
    .from("notification_mark")
    .delete()
    .eq("tenant_id", args.tenantId)
    .eq("kind", "stock_low")
    .in("subject", rearm);
  if (dropErr) throw dropErr;
}
