/**
 * HISTORY manual: busca N meses para tras (1 mes fechado por rodada, a partir do dia mais
 * antigo ja gravado; para no teto de 24 meses / inauguracao da loja).
 * Mesmo fluxo do job HISTORY, sem passar pela fila (SYNC_MANUAL_ONLY continua valendo p/ o worker).
 * Nao grava sync_job / watermark (last_light_sync_at).
 *   cd workers/millennium-sync && npx tsx scripts/history-months.ts 2
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { runSyncJob, type SyncJob } from "../src/runSyncJob.ts";

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
  const months = Number(process.argv[2] ?? "1");
  if (!Number.isInteger(months) || months < 1) throw new Error("uso: history-months.ts N (meses)");

  const sb = createAdminClient();
  const base = buildDeps(sb, process.env.ERP_SECRET_KEY!);
  const deps = {
    ...base,
    updateCredential: async () => {},
    markJobFinished: async () => {},
    insertSyncRun: async () => {},
  } as typeof base;

  const { data: cred, error } = await sb
    .from("erp_credential")
    .select("id, tenant_id")
    .eq("status", "VALID")
    .limit(1)
    .maybeSingle();
  if (error || !cred) throw new Error(`sem credencial VALID: ${error?.message ?? ""}`);

  for (let i = 1; i <= months; i++) {
    const job: SyncJob = {
      id: randomUUID(),
      tenantId: cred.tenant_id as string,
      credentialId: cred.id as string,
      kind: "HISTORY",
      status: "RUNNING",
      payload: {},
    };
    const t = Date.now();
    console.log(`HISTORY manual ${i}/${months}`);
    const res = await runSyncJob(job, deps);
    console.log(`resultado ${i}/${months}`, JSON.stringify(res), `${Math.round((Date.now() - t) / 1000)}s`);
    if (!res.ok) process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
