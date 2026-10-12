/**
 * Fechamento da madrugada: um resumo do dinheiro (digitado − Millennium).
 * Sem valor digitado e com movimento, diz "sem total real". Cartão e Pix ficam de fora
 * da conta, e o texto do push não explica isso.
 * Quando todas as linhas cabem, a ordem é a do acesso. Quando o texto estoura,
 * entra primeiro o que pede atenção: faltou, sem total real, sobrou, sem diferença.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyScoped, type SalesPushStore } from "./salesPush.ts";

const BODY_LIMIT = 180;

function money(cents: number): string {
  return (Math.abs(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function isCash(method: string): boolean {
  const s = method.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
  return s.includes("DINHEIRO");
}

function closeLine(row: { name: string; diffCents: number | null }): string {
  if (row.diffCents == null) return `${row.name} · sem total real`;
  if (row.diffCents < 0) return `${row.name} · faltou ${money(row.diffCents)}`;
  if (row.diffCents > 0) return `${row.name} · sobrou ${money(row.diffCents)}`;
  return `${row.name} · sem diferença`;
}

/** 0 = faltou, 1 = sem total real, 2 = sobrou, 3 = sem diferença. */
function attentionRank(diffCents: number | null): number {
  if (diffCents != null && diffCents < 0) return 0;
  if (diffCents == null) return 1;
  if (diffCents > 0) return 2;
  return 3;
}

function fitLines(rows: Array<{ name: string; diffCents: number | null }>): { body: string; shown: number } {
  let body = "";
  let shown = 0;
  for (const row of rows) {
    const line = closeLine(row);
    const next = body ? `${body}\n${line}` : line;
    if (next.length > BODY_LIMIT) break;
    body = next;
    shown += 1;
  }
  return { body, shown };
}

export function formatCashClosePush(day: string, rows: Array<{ name: string; diffCents: number | null }>): { title: string; body: string } | null {
  if (rows.length === 0) return null;
  const [year, month, date] = day.split("-");
  const label = date && month && year ? `${date}/${month}` : day;
  const title = `Fechamento · ${label}`;
  const inOrder = fitLines(rows);
  const ordered =
    inOrder.shown === rows.length
      ? rows
      : rows
          .map((row, index) => ({ row, index }))
          .sort((a, b) => attentionRank(a.row.diffCents) - attentionRank(b.row.diffCents) || a.index - b.index)
          .map((item) => item.row);
  const fitted = inOrder.shown === rows.length ? inOrder : fitLines(ordered);
  const rest = rows.length - fitted.shown;
  const more = rest > 0 ? `e mais ${rest} ${rest === 1 ? "filial" : "filiais"}` : "";
  const body = [fitted.body, more].filter(Boolean).join("\n");
  return { title, body };
}

export async function notifyCashClose(
  sb: SupabaseClient,
  args: { tenantId: string; day: string; stores: SalesPushStore[] },
): Promise<void> {
  if (args.stores.length === 0) return;
  const { data: sent, error: sentErr } = await sb
    .from("notification_mark")
    .select("subject")
    .eq("tenant_id", args.tenantId)
    .eq("kind", "cash_close")
    .eq("subject", args.day)
    .maybeSingle();
  if (sentErr) throw sentErr;
  if (sent) return;

  const ids = args.stores.map((store) => store.id);
  const [{ data: lines, error: lineErr }, { data: reviews, error: reviewErr }] = await Promise.all([
    sb.from("cash_close_day").select("store_id, payment_method, closing_cents").eq("tenant_id", args.tenantId).eq("day", args.day).in("store_id", ids),
    sb.from("cash_close_review").select("store_id, cash_typed_cents").eq("tenant_id", args.tenantId).eq("day", args.day).in("store_id", ids),
  ]);
  if (lineErr) throw lineErr;
  if (reviewErr) throw reviewErr;

  const system = new Map<string, number>();
  for (const line of lines ?? []) {
    if (!isCash(String(line.payment_method ?? ""))) continue;
    const id = line.store_id as string;
    system.set(id, (system.get(id) ?? 0) + (Number(line.closing_cents) || 0));
  }
  const typed = new Map<string, number | null>();
  for (const review of reviews ?? []) {
    typed.set(review.store_id as string, review.cash_typed_cents == null ? null : Number(review.cash_typed_cents));
  }

  const rows = args.stores.flatMap((store) => {
    const hasLine = (lines ?? []).some((line) => line.store_id === store.id);
    if (!hasLine && !typed.has(store.id)) return [];
    const systemCents = system.get(store.id) ?? 0;
    const typedCents = typed.has(store.id) ? typed.get(store.id)! : null;
    if (typedCents == null) return [{ id: store.id, name: store.name, diffCents: systemCents > 0 ? null : 0 }];
    return [{ id: store.id, name: store.name, diffCents: typedCents - systemCents }];
  });

  await notifyScoped(sb, {
    tenantId: args.tenantId,
    stores: args.stores,
    pref: "cashClose",
    url: "/cash-close",
    text: (stores) => {
      const ids = new Set(stores.map((store) => store.id));
      return formatCashClosePush(args.day, rows.filter((row) => ids.has(row.id)));
    },
  });

  const { error } = await sb.from("notification_mark").upsert(
    { tenant_id: args.tenantId, kind: "cash_close", subject: args.day, level: 1 },
    { onConflict: "tenant_id,kind,subject" },
  );
  if (error) throw error;
}
