import type { SupabaseClient } from "@supabase/supabase-js";
import { stoneFileReady } from "../../../src/data/wedash/stoneClock.ts";
import { closeSaleDays } from "../../../src/data/wedash/cashCloseView.ts";
import { addDaysIso, ymdInTz, type SyncStore } from "./runSyncJob.ts";
import { cieloEstablishment, parseCieloEdi, type CieloCardRow, type CieloPixRow } from "./cieloEdi.ts";
import { buildCieloSecrets, fetchCieloFiles, type CieloSecrets } from "./cieloClient.ts";
import { decryptPassword } from "./decrypt.ts";

type CieloStore = { storeId: string; tenantId: string; code: string; timezone: string; establishment: string };

function brl(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const reais = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}R$ ${reais},${frac}`;
}

async function saleDays(sb: SupabaseClient, storeId: string, from: string, to: string) {
  const { data, error } = await sb
    .from("cash_close_day")
    .select("day, payment_method, closing_cents")
    .eq("store_id", storeId)
    .gte("day", from)
    .lte("day", to);
  if (error) throw error;
  return closeSaleDays(
    (data ?? []).map((row) => ({
      day: String(row.day),
      paymentMethod: String(row.payment_method ?? ""),
      closingCents: Number(row.closing_cents) || 0,
    })),
  );
}

async function receivedDays(
  sb: SupabaseClient,
  storeId: string,
  from: string,
  to: string,
): Promise<Map<string, { card: boolean; pix: boolean }>> {
  const { data, error } = await sb
    .from("cielo_day_file")
    .select("day, kind")
    .eq("store_id", storeId)
    .gte("day", from)
    .lte("day", to);
  if (error) throw error;
  const map = new Map<string, { card: boolean; pix: boolean }>();
  for (const row of data ?? []) {
    const day = String(row.day).slice(0, 10);
    const cur = map.get(day) ?? { card: false, pix: false };
    if (row.kind === "card") cur.card = true;
    if (row.kind === "pix") cur.pix = true;
    map.set(day, cur);
  }
  return map;
}

async function replaceCards(sb: SupabaseClient, args: { tenantId: string; storeId: string; day: string; rows: CieloCardRow[] }) {
  const { error: delErr } = await sb
    .from("cielo_capture")
    .delete()
    .eq("tenant_id", args.tenantId)
    .eq("store_id", args.storeId)
    .eq("day", args.day);
  if (delErr) throw delErr;
  const payload = args.rows.map((row) => ({
    tenant_id: args.tenantId,
    store_id: args.storeId,
    day: args.day,
    acquirer_key: row.acquirerKey,
    payment_method: row.paymentMethod,
    captured_cents: row.capturedCents,
    occurred_at: row.occurredAt,
  }));
  for (let i = 0; i < payload.length; i += 400) {
    const { error } = await sb.from("cielo_capture").upsert(payload.slice(i, i + 400), {
      onConflict: "tenant_id,store_id,acquirer_key",
    });
    if (error) throw error;
  }
}

async function replacePix(sb: SupabaseClient, args: { tenantId: string; storeId: string; day: string; rows: CieloPixRow[] }) {
  const { error: delErr } = await sb
    .from("cielo_pix")
    .delete()
    .eq("tenant_id", args.tenantId)
    .eq("store_id", args.storeId)
    .eq("day", args.day);
  if (delErr) throw delErr;
  const payload = args.rows.map((row) => ({
    tenant_id: args.tenantId,
    store_id: args.storeId,
    day: args.day,
    pix_id: row.pixId,
    paid_cents: row.paidCents,
    occurred_at: row.occurredAt,
  }));
  for (let i = 0; i < payload.length; i += 400) {
    const { error } = await sb.from("cielo_pix").upsert(payload.slice(i, i + 400), {
      onConflict: "tenant_id,store_id,pix_id",
    });
    if (error) throw error;
  }
}

async function markReceived(
  sb: SupabaseClient,
  args: { tenantId: string; storeId: string; day: string; kind: "card" | "pix" },
) {
  const { error } = await sb.from("cielo_day_file").upsert(
    {
      tenant_id: args.tenantId,
      store_id: args.storeId,
      day: args.day,
      kind: args.kind,
      status: "received",
      received_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,store_id,day,kind" },
  );
  if (error) throw error;
}

async function loadTenantSecrets(sb: SupabaseClient, tenantId: string, erpSecret: string): Promise<CieloSecrets | null> {
  const { data, error } = await sb
    .from("tenant_cielo")
    .select("merchant_code, client_id, secret_ciphertext, hmac_ciphertext, cert_ciphertext, key_ciphertext")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return null;
  try {
    const [clientSecret, hmac, cert, key] = await Promise.all([
      decryptPassword(String(data.secret_ciphertext), erpSecret),
      decryptPassword(String(data.hmac_ciphertext), erpSecret),
      decryptPassword(String(data.cert_ciphertext), erpSecret),
      decryptPassword(String(data.key_ciphertext), erpSecret),
    ]);
    return buildCieloSecrets({
      clientId: String(data.client_id ?? ""),
      clientSecret,
      hmac,
      cert,
      key,
      merchantCode: String(data.merchant_code ?? ""),
    });
  } catch {
    return null;
  }
}

/**
 * Um arquivo da matriz cobre todas as filiais daquela empresa. Baixa o dia uma vez e separa pelo estabelecimento.
 * Sem acesso cadastrado, avisa e deixa o dia pendente.
 */
export async function pullCieloClose(
  sb: SupabaseClient,
  args: { tenantId: string; stores: SyncStore[]; from: string; to: string; now: Date; erpSecret: string },
  problems: string[],
): Promise<void> {
  const ids = args.stores.map((store) => store.id);
  if (ids.length === 0 || args.from > args.to) return;
  const { data, error } = await sb
    .from("store_cielo")
    .select("store_id, tenant_id, establishment_code")
    .eq("tenant_id", args.tenantId)
    .in("store_id", ids);
  if (error) {
    problems.push("Não foi possível ler a conexão da Cielo.");
    return;
  }
  const byId = new Map(args.stores.map((store) => [store.id, store]));
  const linked: CieloStore[] = [];
  for (const row of data ?? []) {
    const store = byId.get(String(row.store_id));
    const establishment = cieloEstablishment(String(row.establishment_code ?? ""));
    if (!store || !establishment) continue;
    linked.push({
      storeId: store.id,
      tenantId: String(row.tenant_id),
      code: store.code,
      timezone: store.timezone,
      establishment,
    });
  }
  if (linked.length === 0) return;
  const secrets = await loadTenantSecrets(sb, args.tenantId, args.erpSecret);
  if (!secrets) {
    console.warn("AVISO Cielo: esta empresa ainda não cadastrou o certificado e a chave");
    return;
  }

  const endByStore = new Map<string, string>();
  for (const store of linked) {
    const today = ymdInTz(args.now, store.timezone);
    const end = args.to < today ? args.to : addDaysIso(today, -1);
    if (args.from <= end) endByStore.set(store.storeId, end);
  }
  if (endByStore.size === 0) return;

  type Need = { card: boolean; pix: boolean };
  const needs = new Map<string, Map<string, Need>>();
  for (const store of linked) {
    const end = endByStore.get(store.storeId);
    if (!end) continue;
    const files = await receivedDays(sb, store.storeId, args.from, end);
    const sales = await saleDays(sb, store.storeId, args.from, end);
    const days = new Map<string, Need>();
    for (let day = args.from; day <= end; day = addDaysIso(day, 1)) {
      if (!stoneFileReady(day, args.now)) continue;
      const file = files.get(day);
      const card = !file?.card && sales.card.has(day);
      const pix = !file?.pix && sales.pix.has(day);
      if (!sales.any.has(day)) {
        if (!file?.card || !file?.pix) console.log(`  ${store.code} ${day}: sem venda no Millennium`);
        continue;
      }
      if (!file?.card && !sales.card.has(day)) console.log(`  ${store.code} ${day}: sem venda de cartão no Millennium`);
      if (!file?.pix && !sales.pix.has(day)) console.log(`  ${store.code} ${day}: sem venda de Pix no Millennium`);
      if (card || pix) days.set(day, { card, pix });
    }
    needs.set(store.storeId, days);
  }

  const days = new Set<string>();
  for (const storeDays of needs.values()) {
    for (const day of storeDays.keys()) days.add(day);
  }
  const ordered = [...days].sort();
  for (const day of ordered) {
    const wantCard = linked.some((store) => needs.get(store.storeId)?.get(day)?.card);
    const wantPix = linked.some((store) => needs.get(store.storeId)?.get(day)?.pix);
    if (wantCard) await pullKind(sb, linked, needs, day, 3, secrets, problems);
    if (wantPix) await pullKind(sb, linked, needs, day, 16, secrets, problems);
  }
}

async function pullKind(
  sb: SupabaseClient,
  linked: CieloStore[],
  needs: Map<string, Map<string, { card: boolean; pix: boolean }>>,
  day: string,
  fileType: 3 | 16,
  secrets: CieloSecrets,
  problems: string[],
) {
  const kind = fileType === 3 ? "card" : "pix";
  let texts: string[];
  try {
    texts = await fetchCieloFiles({ secrets, day, fileType });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    console.warn(`  AVISO Cielo ${day} ${kind}: ${msg || "falha ao buscar"}`);
    problems.push(
      kind === "card"
        ? `Não foi possível buscar o cartão da Cielo em ${day}.`
        : `Não foi possível buscar o Pix da Cielo em ${day}.`,
    );
    return;
  }
  if (texts.length === 0) {
    console.log(`  Cielo ${day}: ${kind === "card" ? "cartão" : "Pix"} ainda não publicado`);
    return;
  }
  const parsed = texts.map((text) => parseCieloEdi(text));
  const cards = parsed.flatMap((file) => file.cards).filter((row) => row.day === day);
  const pix = parsed.flatMap((file) => file.pix).filter((row) => row.day === day);
  for (const store of linked) {
    const need = needs.get(store.storeId)?.get(day);
    if (kind === "card" && !need?.card) continue;
    if (kind === "pix" && !need?.pix) continue;
    try {
      if (kind === "card") {
        const rows = cards.filter((row) => row.establishment === store.establishment);
        await replaceCards(sb, { tenantId: store.tenantId, storeId: store.storeId, day, rows });
        await markReceived(sb, { tenantId: store.tenantId, storeId: store.storeId, day, kind: "card" });
        const total = rows.reduce((sum, row) => sum + row.capturedCents, 0);
        console.log(`  Cielo ${store.code} ${day}: cartão (${rows.length}) · ${brl(total)}`);
      } else {
        const rows = pix.filter((row) => row.establishment === store.establishment);
        await replacePix(sb, { tenantId: store.tenantId, storeId: store.storeId, day, rows });
        await markReceived(sb, { tenantId: store.tenantId, storeId: store.storeId, day, kind: "pix" });
        const total = rows.reduce((sum, row) => sum + row.paidCents, 0);
        console.log(`  Cielo ${store.code} ${day}: Pix (${rows.length}) · ${brl(total)}`);
      }
    } catch (e) {
      console.warn(`  AVISO [${store.code}] Cielo ${day}: ${e instanceof Error ? e.message : String(e)}`);
      problems.push(`Não foi possível gravar o arquivo da Cielo em ${day}.`);
    }
  }
}
