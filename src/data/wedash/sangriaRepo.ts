import { depositBlock, type SangriaKind } from "./sangriaMath";

export type SangriaLineRow = {
  id: string;
  day: string;
  amountCents: number;
  document: string;
  note: string;
  kind: SangriaKind;
};

export type SangriaDepositDay = { day: string; depositId: string };

export async function fetchSangriaMonth(
  tenantId: string,
  storeId: string,
  from: string,
  to: string,
): Promise<{ lines: SangriaLineRow[]; deposits: SangriaDepositDay[] }> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { lines: [], deposits: [] };
  const [lines, days] = await Promise.all([
    sb
      .from("sangria_line")
      .select("id, day, amount_cents, document, note, kind")
      .eq("tenant_id", tenantId)
      .eq("store_id", storeId)
      .gte("day", from)
      .lte("day", to)
      .order("amount_cents", { ascending: false }),
    sb.from("sangria_deposit_day").select("day, deposit_id").eq("tenant_id", tenantId).eq("store_id", storeId).gte("day", from).lte("day", to),
  ]);
  if (lines.error) throw new Error(lines.error.message);
  if (days.error) throw new Error(days.error.message);
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
  };
}

export async function saveSangriaLine(id: string, patch: { kind?: SangriaKind; note?: string }): Promise<void> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("sangria_line").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function createSangriaDeposit(
  tenantId: string,
  storeId: string,
  days: string[],
  taken: ReadonlySet<string>,
): Promise<string> {
  const block = depositBlock(days, taken);
  if (block) throw new Error(block);
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) throw new Error("Não foi possível fazer o depósito. Tente novamente.");
  const { data, error } = await sb.from("sangria_deposit").insert({ tenant_id: tenantId, store_id: storeId }).select("id").single();
  if (error || !data) throw new Error(error?.message || "Não foi possível fazer o depósito. Tente novamente.");
  const id = String(data.id);
  const { error: dayErr } = await sb.from("sangria_deposit_day").insert(
    days.map((day) => ({ deposit_id: id, tenant_id: tenantId, store_id: storeId, day })),
  );
  if (dayErr) {
    await sb.from("sangria_deposit").delete().eq("id", id);
    throw new Error(dayErr.message.includes("duplicate") ? "Um desses dias já está num depósito." : "Não foi possível fazer o depósito. Tente novamente.");
  }
  return id;
}

export async function undoSangriaDeposit(depositId: string): Promise<void> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("sangria_deposit").delete().eq("id", depositId);
  if (error) throw new Error(error.message);
}
