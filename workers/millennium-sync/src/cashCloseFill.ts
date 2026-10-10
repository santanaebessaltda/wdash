import type { SupabaseClient } from "@supabase/supabase-js";
import { clampCloseRange, missingCloseDays } from "../../../src/data/wedash/cashCloseMonth.ts";
import { closeSaleDays } from "../../../src/data/wedash/cashCloseView.ts";
import { stoneFileReady } from "../../../src/data/wedash/stoneClock.ts";
import { decryptPassword } from "./decrypt.ts";
import { fetchStoneConciliation } from "./stoneConciliation.ts";
import { replaceCaptures } from "./stoneCloseScan.ts";
import { markStoneFile } from "./stoneIngest.ts";
import { PIX_INTEGER_CENTS_AFTER, STONE_PIX_RETRY_MS, registerStoneWebhook, requestStonePixFile } from "./stonePix.ts";
import {
  addDaysIso,
  ensureMillenniumSession,
  syncStoreCashClose,
  syncStoreSangria,
  ymdInTz,
  type RunSyncResult,
  type SyncJob,
  type SyncJobDeps,
  type SyncStore,
} from "./runSyncJob.ts";

function digits(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

async function millenniumSaleDays(sb: SupabaseClient, storeId: string, from: string, to: string) {
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

type PixState = { status: "requested" | "received"; requestedAt: string | null; receivedAt: string | null };

async function stoneState(
  sb: SupabaseClient,
  storeId: string,
  from: string,
  to: string,
): Promise<Map<string, { card: boolean; pix: PixState | null }>> {
  const { data, error } = await sb
    .from("stone_day_file")
    .select("day, kind, status, requested_at, received_at")
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
        receivedAt: (row.received_at as string | null) ?? null,
      };
    }
    map.set(day, cur);
  }
  return map;
}

function pixDue(pix: PixState | null, now: Date): boolean {
  if (!pix) return true;
  if (pix.status === "received") {
    const t = pix.receivedAt ? Date.parse(pix.receivedAt) : NaN;
    return Number.isNaN(t) || t < Date.parse(PIX_INTEGER_CENTS_AFTER);
  }
  const t = pix.requestedAt ? Date.parse(pix.requestedAt) : NaN;
  if (Number.isNaN(t)) return true;
  return now.getTime() - t >= STONE_PIX_RETRY_MS;
}

/**
 * Pedido da tela, sem rebuscar as vendas.
 * Sangria: o mês inteiro, do dia 1 até hoje.
 * Fechamento: só o dia que ainda não está gravado, até ontem. A Stone segue esse pedido.
 * Sem parte, a madrugada faz os dois. O CSV do PIX chega depois, pelo webhook.
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
  const part = job.payload.part ?? "both";
  const finish = async (error?: string, storesDone = 0): Promise<RunSyncResult> => {
    await deps.markJobFinished({ jobId: job.id, status: error ? "FAILED" : "SUCCEEDED", ...(error ? { error } : {}) });
    const title = part === "sangria" ? "Sangrias do mês" : "Fechamento do mês";
    console.log(`${error ? "ERRO" : "OK"} ${title}${error ? ` · ${error}` : ` · ${storesDone} loja(s)`}`);
    return error ? { ok: false, reason: "other", error } : { ok: true, storesDone };
  };
  if (!from || !to) return finish("período do fechamento incompleto");
  if (part !== "sangria" && (!deps.fetchCashAccounts || !deps.fetchCashCloseReport || !deps.replaceCashCloseDays)) {
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
    let rangeFrom = from;
    if (deps.closeHistoryFloor) {
      try {
        const floor = await deps.closeHistoryFloor({ tenantId: job.tenantId, timeZone: store.timezone });
        const span = clampCloseRange(from, to, floor);
        if (!span) continue;
        rangeFrom = span.from;
      } catch (e) {
        console.warn(`AVISO chão do fechamento: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const sangriaFrom = job.payload.sangriaFrom ?? rangeFrom;
    const sangriaEnd = job.payload.sangriaTo ?? to;
    const sangriaTo = sangriaEnd < today ? sangriaEnd : today;
    if (part !== "close" && sangriaFrom <= sangriaTo) {
      try {
        await syncStoreSangria(deps, {
          session,
          tenantId: job.tenantId,
          store,
          from: sangriaFrom,
          to: sangriaTo,
        });
      } catch {
        problems.push("Não foi possível buscar as sangrias do Millennium.");
      }
    }
    if (part === "sangria") {
      console.log(`  ${store.code}: sangrias ${sangriaFrom}→${sangriaTo}`);
      continue;
    }
    const days = missingCloseDays(rangeFrom, to, today, await filledDays(sb, job.tenantId, store.id, rangeFrom, to));
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
    if (rangeFrom > end) continue;
    const files = await stoneState(sb, store.id, rangeFrom, end);
    const sales = await millenniumSaleDays(sb, store.id, rangeFrom, end);
    const tax = digits(store.taxId);
    const webhookUrl = process.env.STONE_WEBHOOK_PUBLIC_URL?.trim() ?? "";
    let pixParado = false;
    if (tax.length >= 11 && !webhookUrl) {
      problems.push("Falta o endereço público do aviso do Pix no worker.");
      pixParado = true;
    } else if (tax.length >= 11 && webhookUrl) {
      try {
        const result = await registerStoneWebhook({ secret, url: webhookUrl });
        console.log(
          result === "created"
            ? `  Webhook PIX Stone cadastrado [${store.code}]`
            : `  Webhook PIX Stone atualizado [${store.code}]`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        console.warn(`  AVISO [${store.code}] webhook PIX: ${msg || "não foi possível cadastrar o aviso"}`);
        if (msg.startsWith("A Stone")) {
          problems.push(msg);
          pixParado = true;
        }
      }
    }
    for (let day = rangeFrom; day <= end; day = addDaysIso(day, 1)) {
      if (!stoneFileReady(day, now)) continue;
      const file = files.get(day);
      const wouldCard = covers === "all" && !file?.card;
      const wouldPix = !pixParado && tax.length >= 11 && pixDue(file?.pix ?? null, now);
      if (!sales.any.has(day)) {
        if (wouldCard || wouldPix) console.log(`  ${store.code} ${day}: sem venda no Millennium`);
        continue;
      }
      if (wouldCard && !sales.card.has(day)) {
        console.log(`  ${store.code} ${day}: sem venda de cartão no Millennium`);
      }
      if (wouldCard && sales.card.has(day)) {
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
      if (wouldPix && !sales.pix.has(day)) {
        console.log(`  ${store.code} ${day}: sem venda de Pix no Millennium`);
      }
      if (wouldPix && sales.pix.has(day)) {
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
