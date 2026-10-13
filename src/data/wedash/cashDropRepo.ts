import { depositBlock, type CashDropKind } from "./cashDropMath";

export type CashDropLineRow = {
  id: string;
  day: string;
  amountCents: number;
  document: string;
  note: string;
  kind: CashDropKind;
};

export type CashDropDepositDay = { day: string; depositId: string };

export type CashDropShortageRow = { day: string; amountCents: number; note: string };

export async function fetchCashDropMonth(
  tenantId: string,
  storeId: string,
  from: string,
  to: string,
): Promise<{ lines: CashDropLineRow[]; deposits: CashDropDepositDay[]; shortages: CashDropShortageRow[] }> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { lines: [], deposits: [], shortages: [] };
  const [lines, days, gaps] = await Promise.all([
    sb
      .from("sangria_line")
      .select("id, day, amount_cents, document, note, kind")
      .eq("tenant_id", tenantId)
      .eq("store_id", storeId)
      .gte("day", from)
      .lte("day", to)
      .order("amount_cents", { ascending: false }),
    sb.from("sangria_deposit_day").select("day, deposit_id").eq("tenant_id", tenantId).eq("store_id", storeId).gte("day", from).lte("day", to),
    sb
      .from("sangria_shortage")
      .select("day, amount_cents, note")
      .eq("tenant_id", tenantId)
      .eq("store_id", storeId)
      .gte("day", from)
      .lte("day", to),
  ]);
  if (lines.error) throw new Error(lines.error.message);
  if (days.error) throw new Error(days.error.message);
  if (gaps.error) throw new Error(gaps.error.message);
  return {
    lines: (lines.data ?? []).map((row) => ({
      id: String(row.id),
      day: String(row.day).slice(0, 10),
      amountCents: Number(row.amount_cents) || 0,
      document: String(row.document ?? ""),
      note: String(row.note ?? ""),
      kind: row.kind === "purchase" ? "purchase" : "deposit",
    })),
    deposits: (days.data ?? []).map((row) => ({ day: String(row.day).slice(0, 10), depositId: String(row.deposit_id) })),
    shortages: (gaps.data ?? []).map((row) => ({
      day: String(row.day).slice(0, 10),
      amountCents: Number(row.amount_cents) || 0,
      note: String(row.note ?? ""),
    })),
  };
}

export async function saveCashDropShortage(
  tenantId: string,
  storeId: string,
  day: string,
  amountCents: number,
  note: string,
): Promise<void> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return;
  if (amountCents <= 0) {
    const { error } = await sb.from("sangria_shortage").delete().eq("store_id", storeId).eq("day", day);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await sb.from("sangria_shortage").upsert(
    { tenant_id: tenantId, store_id: storeId, day, amount_cents: amountCents, note },
    { onConflict: "store_id,day" },
  );
  if (error) throw new Error(error.message);
}

export async function saveCashDropLine(id: string, patch: { kind?: CashDropKind; note?: string }): Promise<void> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("sangria_line").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function saveCashDropLines(rows: Array<{ id: string; kind: CashDropKind; note: string }>): Promise<void> {
  await Promise.all(rows.map((row) => saveCashDropLine(row.id, { kind: row.kind, note: row.note })));
}

export async function fetchDepositDayCount(depositId: string): Promise<number> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return 0;
  const { count, error } = await sb.from("sangria_deposit_day").select("day", { count: "exact", head: true }).eq("deposit_id", depositId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function createCashDropDeposit(
  tenantId: string,
  storeId: string,
  days: string[],
  taken: ReadonlySet<string>,
): Promise<string> {
  const block = depositBlock(days, taken);
  if (block) throw new Error(block);
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) throw new Error("Não foi possível marcar como recebido. Tente novamente.");
  const { data, error } = await sb.from("sangria_deposit").insert({ tenant_id: tenantId, store_id: storeId }).select("id").single();
  if (error || !data) throw new Error(error?.message || "Não foi possível marcar como recebido. Tente novamente.");
  const id = String(data.id);
  const { error: dayErr } = await sb.from("sangria_deposit_day").insert(
    days.map((day) => ({ deposit_id: id, tenant_id: tenantId, store_id: storeId, day })),
  );
  if (dayErr) {
    await sb.from("sangria_deposit").delete().eq("id", id);
    throw new Error(dayErr.message.includes("duplicate") ? "Um desses dias já está num recebimento." : "Não foi possível marcar como recebido. Tente novamente.");
  }
  return id;
}

export async function undoCashDropDeposit(depositId: string): Promise<void> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("sangria_deposit").delete().eq("id", depositId);
  if (error) throw new Error(error.message);
}
