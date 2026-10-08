import type { SupabaseClient } from "@supabase/supabase-js";
import { parseStonePixCsv, type StonePixRow } from "./stonePix.ts";

function digits(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

export async function ingestStonePixCsv(
  sb: SupabaseClient,
  args: { document: string; day: string; csv: string },
): Promise<{ code: string; rows: number } | null> {
  const document = digits(args.document);
  const { data: stones, error: stoneErr } = await sb.from("store_stone").select("store_id, tenant_id");
  if (stoneErr) throw stoneErr;
  const ids = (stones ?? []).map((s) => s.store_id as string);
  if (ids.length === 0) return null;
  const { data: stores, error: storeErr } = await sb
    .from("store")
    .select("id, tenant_id, code, tax_id, active")
    .in("id", ids);
  if (storeErr) throw storeErr;
  const matches = (stores ?? []).filter((s) => s.active !== false && digits(s.tax_id as string | null) === document);
  if (matches.length !== 1) {
    console.warn(
      `AVISO PIX Stone ${args.day}: documento com ${matches.length} loja(s) — CSV não gravado`,
    );
    return null;
  }
  const store = matches[0]!;
  const storeId = store.id as string;
  const tenantId = store.tenant_id as string;
  const code = (store.code as string | null) || storeId.slice(0, 8);
  const parsed = parseStonePixCsv(args.csv);
  await replaceStonePix(sb, { tenantId, storeId, day: args.day, rows: parsed });
  await markStoneFile(sb, {
    tenantId,
    storeId,
    day: args.day,
    kind: "pix",
    status: "received",
    receivedAt: new Date().toISOString(),
  });
  console.log(`PIX Stone ${code} ${args.day}: ${parsed.length} evento(s)`);
  return { code, rows: parsed.length };
}

export async function replaceStonePix(
  sb: SupabaseClient,
  args: { tenantId: string; storeId: string; day: string; rows: StonePixRow[] },
): Promise<void> {
  const { error: delErr } = await sb
    .from("stone_pix")
    .delete()
    .eq("tenant_id", args.tenantId)
    .eq("store_id", args.storeId)
    .eq("day", args.day);
  if (delErr) throw delErr;
  const payload = args.rows.map((r) => ({
    tenant_id: args.tenantId,
    store_id: args.storeId,
    day: args.day,
    event_id: r.eventId,
    e2e_id: r.e2eId,
    status: r.status,
    paid_cents: r.paidCents,
    canceled_cents: r.canceledCents,
    fee_cents: r.feeCents,
    occurred_at: r.occurredAt,
    terminal_serial: r.terminalSerial,
  }));
  for (let i = 0; i < payload.length; i += 400) {
    const { error } = await sb.from("stone_pix").upsert(payload.slice(i, i + 400), {
      onConflict: "tenant_id,store_id,event_id",
    });
    if (error) throw error;
  }
}

export async function markStoneFile(
  sb: SupabaseClient,
  args: {
    tenantId: string;
    storeId: string;
    day: string;
    kind: "card" | "pix";
    status: "requested" | "received";
    requestedAt?: string | null;
    receivedAt?: string | null;
  },
): Promise<void> {
  const row = {
    tenant_id: args.tenantId,
    store_id: args.storeId,
    day: args.day,
    kind: args.kind,
    status: args.status,
    requested_at: args.requestedAt ?? null,
    received_at: args.receivedAt ?? null,
  };
  const inserted = await sb.from("stone_day_file").insert(row);
  if (!inserted.error) return;
  if (inserted.error.code !== "23505") throw inserted.error;
  // received não volta para requested se o CSV chegar no meio do pedido.
  const patch =
    args.status === "received"
      ? sb
          .from("stone_day_file")
          .update({ status: "received", received_at: args.receivedAt ?? new Date().toISOString() })
          .eq("tenant_id", args.tenantId)
          .eq("store_id", args.storeId)
          .eq("day", args.day)
          .eq("kind", args.kind)
      : sb
          .from("stone_day_file")
          .update({ status: "requested", requested_at: args.requestedAt ?? new Date().toISOString() })
          .eq("tenant_id", args.tenantId)
          .eq("store_id", args.storeId)
          .eq("day", args.day)
          .eq("kind", args.kind)
          .neq("status", "received");
  const { error } = await patch;
  if (error) throw error;
}
