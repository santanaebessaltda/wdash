import type { SupabaseClient } from "@supabase/supabase-js";
import { nextNote, type ParsedSangria } from "../../../src/data/wedash/sangriaMath.ts";

/** Grava os lançamentos da janela. Mantém a marca e o texto que a pessoa editou. */
export async function upsertSangriaLines(
  sb: SupabaseClient,
  args: { tenantId: string; storeId: string; lines: ParsedSangria[] },
): Promise<void> {
  if (args.lines.length === 0) return;
  const ids = args.lines.map((line) => line.erpLancamento);
  const { data, error } = await sb
    .from("sangria_line")
    .select("erp_lancamento, note, erp_note, kind")
    .eq("tenant_id", args.tenantId)
    .in("erp_lancamento", ids);
  if (error) throw error;
  const saved = new Map(
    (data ?? []).map((row) => [
      Number(row.erp_lancamento),
      { note: String(row.note ?? ""), erpNote: String(row.erp_note ?? ""), kind: String(row.kind ?? "deposit") },
    ]),
  );
  const rows = args.lines.map((line) => {
    const prev = saved.get(line.erpLancamento);
    return {
      tenant_id: args.tenantId,
      store_id: args.storeId,
      erp_lancamento: line.erpLancamento,
      day: line.day,
      amount_cents: line.amountCents,
      document: line.document,
      erp_note: line.note,
      note: prev ? nextNote(prev.note, prev.erpNote, line.note) : line.note,
      kind: prev?.kind === "purchase" ? "purchase" : "deposit",
    };
  });
  const { error: upErr } = await sb.from("sangria_line").upsert(rows, { onConflict: "tenant_id,erp_lancamento" });
  if (upErr) throw upErr;
}
