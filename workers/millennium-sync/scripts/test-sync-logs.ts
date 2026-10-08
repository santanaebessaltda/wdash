/**
 * Grava 1 aviso + 1 erro de teste em sync_log (Configuracoes > Logs).
 *   cd workers/millennium-sync
 *   npx tsx scripts/test-sync-logs.ts          # insere
 *   npx tsx scripts/test-sync-logs.ts --clean  # remove os de teste
 * Linhas de teste levam detail.test = true.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient } from "../src/deps.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  const path = resolve(__dirname, "../.env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
}

async function main() {
  loadDotEnv();
  const sb = createAdminClient();

  if (process.argv.includes("--clean")) {
    const { data, error } = await sb.from("sync_log").delete().eq("detail->>test", "true").select("id");
    if (error) throw error;
    console.log(`Removidos ${data?.length ?? 0} log(s) de teste.`);
    return;
  }

  const { data: cred, error: credErr } = await sb
    .from("erp_credential")
    .select("tenant_id")
    .limit(1)
    .maybeSingle();
  if (credErr) throw credErr;
  if (!cred) throw new Error("Nenhuma credencial ERP encontrada.");
  const tenantId = cred.tenant_id as string;

  const { data: store } = await sb
    .from("store")
    .select("id, code, trade_name")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("code")
    .limit(1)
    .maybeSingle();

  const hoje = new Date().toISOString().slice(0, 10);
  const rows = [
    {
      tenant_id: tenantId,
      job_kind: "FORCE",
      level: "WARN",
      source: "categorias",
      store_id: store?.id ?? null,
      store_label: store?.code ?? null,
      day: hoje,
      message: "Relatório WEPINK - FATURAMENTO POR TIPO DE PRODUTO {2C46ADF5…} falhou: HTTP 400 Tipo de documento não suportado",
      detail: { test: true, count: 1, days: [hoje] },
    },
    {
      tenant_id: tenantId,
      job_kind: "FORCE",
      level: "ERROR",
      source: "vendas",
      store_id: store?.id ?? null,
      store_label: store?.code ?? null,
      day: hoje,
      message: "Desistindo de VENDAS.Lista após 3 tentativas: timeout de 60s",
      detail: { test: true, count: 3, days: [hoje] },
    },
  ];
  const { error } = await sb.from("sync_log").insert(rows);
  if (error) throw error;
  console.log(`Inseridos 1 aviso + 1 erro de teste (tenant ${tenantId}, loja ${store?.trade_name ?? "—"}).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
