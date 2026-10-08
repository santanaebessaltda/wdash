import type { SupabaseClient } from "@supabase/supabase-js";
import { cashCloseBucket } from "../../../src/data/wedash/cashCloseView.ts";
import type { StoneCapture } from "./stoneConciliation.ts";
import { fetchStoneConciliation } from "./stoneConciliation.ts";
import { planStoneClose, type StoneCloseStore, type StoneFileState } from "./stoneClosePlan.ts";
import { markStoneFile } from "./stoneIngest.ts";
import { decryptPassword } from "./decrypt.ts";
import { registerStoneWebhook, requestStonePixFile } from "./stonePix.ts";
import { addDaysIso, closeHour, dailyCloseEnabled, hourInTz, isCloseWindow, ymdInTz } from "./runSyncJob.ts";

function digits(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

export async function replaceCaptures(
  sb: SupabaseClient,
  args: { tenantId: string; storeId: string; day: string; rows: StoneCapture[] },
): Promise<void> {
  const { error: delErr } = await sb
    .from("stone_capture")
    .delete()
    .eq("tenant_id", args.tenantId)
    .eq("store_id", args.storeId)
    .eq("day", args.day);
  if (delErr) throw delErr;
  const payload = args.rows.map((r) => ({
    tenant_id: args.tenantId,
    store_id: args.storeId,
    day: args.day,
    acquirer_key: r.acquirerKey,
    occurred_at: r.occurredAt,
    account_type: r.accountType,
    payment_method: r.paymentMethod,
    brand_id: r.brandId,
    captured_cents: r.capturedCents,
    authorization_code: r.authorizationCode,
    installments: r.installments,
  }));
  for (let i = 0; i < payload.length; i += 400) {
    const { error } = await sb.from("stone_capture").upsert(payload.slice(i, i + 400), {
      onConflict: "tenant_id,store_id,acquirer_key",
    });
    if (error) throw error;
  }
}

/**
 * Dentro da janela da madrugada, completa ontem e anteontem: baixa o cartão
 * se ainda não chegou e pede o CSV do PIX. O CSV em si entra pelo webhook.
 */
export async function runStoneCloseScan(sb: SupabaseClient, erpSecret: string, now = new Date()): Promise<number> {
  if (!dailyCloseEnabled()) return 0;
  const { data: stones, error } = await sb
    .from("store_stone")
    .select("store_id, tenant_id, stone_code, secret_ciphertext, covers");
  if (error) throw error;
  if (!stones?.length) return 0;
  const ids = stones.map((s) => s.store_id as string);
  const { data: stores, error: storeErr } = await sb.from("store").select("id, code, timezone, tax_id, active").in("id", ids);
  if (storeErr) throw storeErr;
  const storeById = new Map((stores ?? []).map((s) => [s.id as string, s]));
  const start = closeHour();
  const plannedStores: StoneCloseStore[] = [];
  const secretByStore = new Map<string, { cipher: string; stoneCode: string }>();
  const daySet = new Set<string>();
  for (const stone of stones) {
    const store = storeById.get(stone.store_id as string);
    if (!store || store.active === false) continue;
    const tz = (store.timezone as string) || "America/Campo_Grande";
    if (!isCloseWindow(hourInTz(now, tz), start)) continue;
    const today = ymdInTz(now, tz);
    const yesterday = addDaysIso(today, -1);
    const before = addDaysIso(yesterday, -1);
    daySet.add(yesterday);
    daySet.add(before);
    secretByStore.set(stone.store_id as string, {
      cipher: stone.secret_ciphertext as string,
      stoneCode: stone.stone_code as string,
    });
    plannedStores.push({
      storeId: stone.store_id as string,
      tenantId: stone.tenant_id as string,
      code: (store.code as string | null) || (stone.store_id as string).slice(0, 8),
      taxDigits: digits(store.tax_id as string | null),
      covers: stone.covers === "all" ? "all" : "online_pix",
      days: [yesterday, before],
      pixDays: [],
    });
  }
  if (plannedStores.length === 0) return 0;
  const { data: closes, error: closeErr } = await sb
    .from("cash_close_day")
    .select("store_id, day, payment_method, closing_cents")
    .in("store_id", plannedStores.map((s) => s.storeId))
    .in("day", [...daySet]);
  if (closeErr) throw closeErr;
  const pixDaysByStore = new Map<string, string[]>();
  for (const row of closes ?? []) {
    if (cashCloseBucket(String(row.payment_method ?? "")) !== "pix" || Number(row.closing_cents) <= 0) continue;
    const id = row.store_id as string;
    const day = String(row.day).slice(0, 10);
    const list = pixDaysByStore.get(id) ?? [];
    if (!list.includes(day)) list.push(day);
    pixDaysByStore.set(id, list);
  }
  for (const store of plannedStores) store.pixDays = pixDaysByStore.get(store.storeId) ?? [];
  const { data: files, error: fileErr } = await sb
    .from("stone_day_file")
    .select("store_id, day, kind, status, requested_at")
    .in("store_id", plannedStores.map((s) => s.storeId))
    .in("day", [...daySet]);
  if (fileErr) throw fileErr;
  const state = new Map<string, StoneFileState>();
  for (const row of files ?? []) {
    const key = `${row.store_id}|${String(row.day).slice(0, 10)}`;
    const cur = state.get(key) ?? {
      storeId: row.store_id as string,
      day: String(row.day).slice(0, 10),
      card: null,
      pix: null,
      pixRequestedAt: null,
    };
    if (row.kind === "card" && row.status === "received") cur.card = "received";
    if (row.kind === "pix") {
      cur.pix = row.status === "received" ? "received" : "requested";
      cur.pixRequestedAt = (row.requested_at as string | null) ?? null;
    }
    state.set(key, cur);
  }
  const actions = planStoneClose(now, plannedStores, [...state.values()]);
  let n = 0;
  for (const action of actions) {
    const cred = secretByStore.get(action.storeId);
    if (!cred) continue;
    let secret: string;
    try {
      secret = await decryptPassword(cred.cipher, erpSecret);
    } catch (e) {
      console.warn(`AVISO [${action.code}] Stone: chave ilegível`);
      continue;
    }
    if (action.fetchCard) {
      try {
        const captures = await fetchStoneConciliation({ stoneCode: cred.stoneCode, secret, day: action.day });
        await replaceCaptures(sb, {
          tenantId: action.tenantId,
          storeId: action.storeId,
          day: action.day,
          rows: captures,
        });
        await markStoneFile(sb, {
          tenantId: action.tenantId,
          storeId: action.storeId,
          day: action.day,
          kind: "card",
          status: "received",
          receivedAt: new Date().toISOString(),
        });
        console.log(`Stone ${action.code} ${action.day}: cartão gravado (${captures.length})`);
        n += 1;
      } catch (e) {
        console.warn(`AVISO [${action.code}] Stone ${action.day}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (action.requestPix) {
      const store = plannedStores.find((s) => s.storeId === action.storeId);
      const document = store?.taxDigits ?? "";
      if (!document) continue;
      try {
        await requestStonePixFile({ document, secret, day: action.day });
        await markStoneFile(sb, {
          tenantId: action.tenantId,
          storeId: action.storeId,
          day: action.day,
          kind: "pix",
          status: "requested",
          requestedAt: new Date().toISOString(),
        });
        console.log(`Stone ${action.code} ${action.day}: PIX pedido`);
        n += 1;
      } catch (e) {
        console.warn(`AVISO [${action.code}] PIX ${action.day}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return n;
}

/** O proxy do Fly só entrega nesta máquina depois que ela sobe. A Stone desiste em 3 segundos. */
export async function publicWebhookReady(
  url: string,
  opts?: { fetchImpl?: typeof fetch; attempts?: number; waitMs?: number },
): Promise<boolean> {
  let health: string;
  try {
    health = new URL("/health", url).href;
  } catch {
    return false;
  }
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const attempts = opts?.attempts ?? 12;
  const waitMs = opts?.waitMs ?? 5_000;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchImpl(health, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) return true;
    } catch {
      // o endereço público ainda não cai nesta máquina
    }
    if (i < attempts - 1 && waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  }
  return false;
}

/** Uma vez por chave. Se o endereço já existe, atualiza para a Stone confirmar de novo. */
export async function registerStoneWebhooks(sb: SupabaseClient, erpSecret: string, url: string): Promise<void> {
  const { data, error } = await sb.from("store_stone").select("store_id, secret_ciphertext");
  if (error) throw error;
  const seen = new Set<string>();
  for (const row of data ?? []) {
    const cipher = row.secret_ciphertext as string;
    if (seen.has(cipher)) continue;
    seen.add(cipher);
    try {
      const secret = await decryptPassword(cipher, erpSecret);
      const result = await registerStoneWebhook({ secret, url });
      console.log(result === "created" ? "Webhook PIX Stone cadastrado" : "Webhook PIX Stone atualizado");
    } catch (e) {
      console.warn(`AVISO webhook PIX Stone: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
