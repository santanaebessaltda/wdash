/**
 * Carga inicial (SEED) de UMA filial, fora da fila, para medir o tempo por relatório.
 * Sequencial: uma chamada ao Millennium por vez; resumo ⏱ por etapa no fim.
 * Por padrão NÃO grava nada no banco (só mede). `--gravar` persiste como o SEED real.
 *   cd workers/millennium-sync && npx tsx scripts/seed-store.ts 00008
 *   npx tsx scripts/seed-store.ts 00008 --gravar
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { runSyncJob, type SyncJob, type SyncJobDeps } from "../src/runSyncJob.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  for (const path of [resolve(__dirname, "../.env"), resolve(__dirname, "../../../.env")]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
    if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
      process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
    }
    return;
  }
}

async function main() {
  loadDotEnv();
  const code = process.argv[2];
  const write = process.argv.includes("--gravar");
  if (!code || code.startsWith("--")) throw new Error("uso: seed-store.ts COD_FILIAL [--gravar]");

  const sb = createAdminClient();
  const base = buildDeps(sb, process.env.ERP_SECRET_KEY!);

  const { data: cred, error } = await sb
    .from("erp_credential")
    .select("id, tenant_id")
    .eq("status", "VALID")
    .limit(1)
    .maybeSingle();
  if (error || !cred) throw new Error(`sem credencial VALID: ${error?.message ?? ""}`);

  const { data: stores, error: storeErr } = await sb
    .from("store")
    .select("id, code, millennium_store_id")
    .eq("tenant_id", cred.tenant_id as string)
    .eq("active", true);
  if (storeErr) throw storeErr;
  const wanted = code.replace(/^0+/, "");
  const store = (stores ?? []).find(
    (s) => String(s.code ?? "").replace(/^0+/, "") === wanted || String(s.millennium_store_id) === wanted,
  );
  if (!store) {
    throw new Error(`filial ${code} não encontrada. Lojas: ${(stores ?? []).map((s) => s.code).join(", ")}`);
  }

  const noop = async () => {};
  const dryWrites: Partial<SyncJobDeps> = write
    ? {}
    : {
        upsertDayAggs: noop,
        patchDayCmv: noop,
        replaceProductDayAggs: noop,
        replaceProductCostDayAggs: noop,
        replacePaymentDayAggs: noop,
        replaceCashCloseSales: noop,
        replaceCashCloseDays: noop,
        fetchCashAccounts: async () => [],
        fetchCashCloseReport: async () => [],
        replaceSellerDayAggs: noop,
        upsertHourAggs: noop,
        listCouponBrands: async () => [],
        upsertCouponBrands: noop,
        setStoresHasWpink: noop,
        syncStoreSellers: async () => [],
        insertSyncLogs: noop,
      };
  const deps = {
    ...base,
    ...dryWrites,
    markJobRunning: noop,
    markJobFinished: noop,
    insertSyncRun: noop,
    hasRunningForCredential: async () => false,
    enqueueMonthFillDay: async () => false,
    updateCredential: async ({ lastLightSyncAt: _l, lastSuccessAt: _s, ...rest }) => {
      if (rest.status == null && rest.lastError == null) return;
      await base.updateCredential(rest);
    },
  } as SyncJobDeps;

  const job: SyncJob = {
    id: randomUUID(),
    tenantId: cred.tenant_id as string,
    credentialId: cred.id as string,
    kind: "SEED",
    status: "RUNNING",
    payload: { storeIds: [store.id as string] },
  };
  console.log(
    `SEED ${store.code} (mês anterior 01 → hoje) · sequencial · ${write ? "GRAVANDO no banco" : "SEM gravar (só mede)"}`,
  );
  const res = await runSyncJob(job, deps);
  console.log("resultado", JSON.stringify(res));
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
