import type { SupabaseClient } from "@supabase/supabase-js";
import { missingCloseDays } from "../../../src/data/wedash/cashCloseMonth.ts";
import { stoneFileReady } from "../../../src/data/wedash/stoneClock.ts";
import { decryptPassword } from "./decrypt.ts";
import { fetchStoneConciliation } from "./stoneConciliation.ts";
import { replaceCaptures } from "./stoneCloseScan.ts";
import { markStoneFile } from "./stoneIngest.ts";
import { STONE_PIX_RETRY_MS, registerStoneWebhook, requestStonePixFile } from "./stonePix.ts";
import {
  addDaysIso,
  ensureMillenniumSession,
  syncStoreCashClose,
  ymdInTz,
  type RunSyncResult,
  type SyncJob,
  type SyncJobDeps,
  type SyncStore,
} from "./runSyncJob.ts";

function digits(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

async function filledDays(sb: SupabaseClient, tenantId: string, storeId: string, from: string, to: string): Promise<Set<string>> {
  const { data, error } = await sb
    .from("cash_close_day")
    .select("day")
    .eq("tenant_id", tenantId)
    .eq("store_id", storeId)
    .gte("day", from)
    .lte("day", to);
  if (error) throw error;
  return new Set((data ?? []).map((r) => String(r.day).slice(0, 10)));
}

type PixState = { status: "requested" | "received"; requestedAt: string | null };

async function stoneState(
  sb: SupabaseClient,
  storeId: string,
  from: string,
  to: string,
): Promise<Map<string, { card: boolean; pix: PixState | null }>> {
  const { data, error } = await sb
    .from("stone_day_file")
    .select("day, kind, status, requested_at")
    .eq("store_id", storeId)
    .gte("day", from)
    .lte("day", to);
  if (error) throw error;
  const map = new Map<string, { card: boolean; pix: PixState | null }>();
  for (const row of data ?? []) {
    const day = String(row.day).slice(0, 10);
    const cur = map.get(day) ?? { card: false, pix: null };
    if (row.kind === "card" && row.status === "received") cur.card = true;
    if (row.kind === "pix") {
      cur.pix = {
        status: row.status === "received" ? "received" : "requested",
        requestedAt: (row.requested_at as string | null) ?? null,
      };
    }
    map.set(day, cur);
  }
  return map;
}

function pixDue(pix: PixState | null, now: Date): boolean {
  if (!pix) return true;
  if (pix.status === "received") return false;
  const t = pix.requestedAt ? Date.parse(pix.requestedAt) : NaN;
  if (Number.isNaN(t)) return true;
  return now.getTime() - t >= STONE_PIX_RETRY_MS;
}

/**
 * Fechamento sob pedido: do dia 1 ao dia pedido, só o que ainda não está gravado.
 * Não rebusca as vendas. O CSV do PIX chega depois, pelo webhook.
 */
export async function runCashCloseFillJob(
  job: SyncJob,
  deps: SyncJobDeps,
  sb: SupabaseClient,
  erpSecret: string,
): Promise<RunSyncResult> {
  if (await deps.hasRunningForCredential(job.credentialId, job.id)) return { ok: false, reason: "locked" };
  await deps.markJobRunning(job.id);
  const from = job.payload.from;
  const to = job.payload.to;
  const finish = async (error?: string, storesDone = 0): Promise<RunSyncResult> => {
    await deps.markJobFinished({ jobId: job.id, status: error ? "FAILED" : "SUCCEEDED", ...(error ? { error } : {}) });
    console.log(`${error ? "ERRO" : "OK"} Fechamento do mês${error ? ` · ${error}` : ` · ${storesDone} loja(s)`}`);
    return error ? { ok: false, reason: "other", error } : { ok: true, storesDone };
  };
  if (!from || !to || !deps.fetchCashAccounts || !deps.fetchCashCloseReport || !deps.replaceCashCloseDays) {
    return finish("período do fechamento incompleto");
  }

  let session: string;
  let stores: SyncStore[];
  try {
    const cred = await deps.loadCredential(job.credentialId);
    console.log(`Fechamento do mês ${from}→${to} · usuário ERP ${cred.username} · job ${job.id.slice(0, 8)}`);
    const ensured = await ensureMillenniumSession(cred, deps);
    if (!ensured.ok) {
      if (ensured.reason === "password") {
        await deps.updateCredential({
          credentialId: cred.id,
          status: "INVALID",
          lastError: ensured.raw,
          lastErrorAt: deps.now(),
        });
      }
      return finish(`login no Millennium falhou (${ensured.reason})`);
    }
    session = ensured.session;
    stores = await deps.listStores(job.tenantId);
  } catch (e) {
    return finish(e instanceof Error ? e.message : String(e));
  }

  const wanted = job.payload.storeIds;
  const chosen = wanted?.length ? stores.filter((s) => wanted.includes(s.id)) : stores;
  let accounts: Awaited<ReturnType<NonNullable<SyncJobDeps["fetchCashAccounts"]>>> = [];
  let accountsOk = false;
  try {
    accounts = await deps.fetchCashAccounts(session);
    accountsOk = true;
  } catch (e) {
    console.warn(`AVISO contas de caixa: ${e instanceof Error ? e.message : String(e)}`);
  }

  const now = deps.now();
  const problems: string[] = [];
  if (!accountsOk) problems.push("Não foi possível ler as contas de caixa do Millennium.");
  for (const store of chosen) {
    const today = ymdInTz(now, store.timezone);
    const days = missingCloseDays(from, to, today, await filledDays(sb, job.tenantId, store.id, from, to));
    for (const day of days) {
      try {
        await syncStoreCashClose(deps, {
          session,
          tenantId: job.tenantId,
          store,
          from: day,
          to: day,
          accounts,
          accountsOk,
          strict: true,
        });
      } catch {
        problems.push(`Não foi possível buscar o fechamento do Millennium em ${day}.`);
      }
    }
    const { data: stoneRow, error: stoneErr } = await sb
      .from("store_stone")
      .select("stone_code, secret_ciphertext, covers")
      .eq("store_id", store.id)
      .maybeSingle();
    if (stoneErr) {
      problems.push("Não foi possível ler a conexão da adquirente.");
      continue;
    }
    if (!stoneRow) {
      if (days.length > 0) console.log(`  ${store.code}: ${days.length} dia(s) de caixa`);
      continue;
    }
    let secret = "";
    try {
      secret = await decryptPassword(String(stoneRow.secret_ciphertext), erpSecret);
    } catch {
      problems.push("Não foi possível ler a chave da adquirente. Conecte a Stone de novo.");
      continue;
    }
    const covers = stoneRow.covers === "all" ? "all" : "online_pix";
    const stoneCode = String(stoneRow.stone_code);
    const end = to < today ? to : addDaysIso(today, -1);
    if (from > end) continue;
    const files = await stoneState(sb, store.id, from, end);
    const tax = digits(store.taxId);
    const webhookUrl = process.env.STONE_WEBHOOK_PUBLIC_URL?.trim() ?? "";
    let pixParado = false;
    if (tax.length >= 11 && !webhookUrl) {
      problems.push("Falta o endereço público do aviso do Pix no worker.");
      pixParado = true;
    } else if (tax.length >= 11 && webhookUrl) {
      try {
        await registerStoneWebhook({ secret, url: webhookUrl });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        console.warn(`  AVISO [${store.code}] webhook PIX: não foi possível cadastrar o aviso`);
        if (msg.startsWith("A Stone")) {
          problems.push(msg);
          pixParado = true;
        }
      }
    }
    for (let day = from; day <= end; day = addDaysIso(day, 1)) {
      if (!stoneFileReady(day, now)) continue;
      const file = files.get(day);
      if (covers === "all" && !file?.card) {
        try {
          const captures = await fetchStoneConciliation({ stoneCode, secret, day });
          await replaceCaptures(sb, { tenantId: job.tenantId, storeId: store.id, day, rows: captures });
          await markStoneFile(sb, {
            tenantId: job.tenantId,
            storeId: store.id,
            day,
            kind: "card",
            status: "received",
            receivedAt: new Date().toISOString(),
          });
          console.log(`  Stone ${store.code} ${day}: cartão (${captures.length})`);
        } catch (e) {
          console.warn(`  AVISO [${store.code}] Stone ${day}: ${e instanceof Error ? e.message : String(e)}`);
          problems.push(`Não foi possível buscar o cartão da adquirente em ${day}.`);
        }
      }
      if (!pixParado && tax.length >= 11 && pixDue(file?.pix ?? null, now)) {
        try {
          await requestStonePixFile({ document: tax, secret, day });
          await markStoneFile(sb, {
            tenantId: job.tenantId,
            storeId: store.id,
            day,
            kind: "pix",
            status: "requested",
            requestedAt: new Date().toISOString(),
          });
          console.log(`  Stone ${store.code} ${day}: PIX pedido`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          console.warn(`  AVISO [${store.code}] PIX ${day}: ${msg}`);
          if (msg.startsWith("A Stone ainda não confirmou")) {
            pixParado = true;
            problems.push(msg);
          } else {
            problems.push(`Não foi possível pedir o Pix da adquirente em ${day}.`);
          }
        }
      }
    }
  }
  return finish(problems[0], chosen.length);
}
