/**
 * FORCE manual de um dia passado (enquanto o job noturno nao existe).
 * Roda o mesmo fluxo do Atualizar com o relogio fixado em 23:59 do dia (fuso 04).
 * Nao grava sync_job / watermark (last_light_sync_at).
 *   cd workers/millennium-sync && npx tsx scripts/force-day.ts 2026-09-23
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
  const day = process.argv[2];
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("uso: force-day.ts YYYY-MM-DD");

  const sb = createAdminClient();
  const base = buildDeps(sb, process.env.ERP_SECRET_KEY!);
  // 23:59:30 no fuso 04 (America/Campo_Grande) = dia+1 03:59:30Z
  const fakeNow = new Date(`${day}T23:59:30.000-04:00`);

  const deps = {
    ...base,
    now: () => fakeNow,
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

  const job: SyncJob = {
    id: randomUUID(),
    tenantId: cred.tenant_id as string,
    credentialId: cred.id as string,
    kind: "FORCE",
    status: "RUNNING",
    payload: { from: day, to: day },
  };
  console.log(`FORCE manual ${day} · relógio=${fakeNow.toISOString()}`);
  const res = await runSyncJob(job, deps);
  console.log("resultado", JSON.stringify(res));
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
