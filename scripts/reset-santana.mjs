/**
 * Reset completo do tenant de santanaebessaltda@gmail.com  ->  volta ao Onboarding (passo 1).
 * Cancela jobs, desloga a sessao Millennium e apaga tudo que veio do ERP
 * (agregados, equipe, eventos, logs, jobs, lojas, credencial).
 * Usa a service role de workers/millennium-sync/.env.
 *
 *   npx tsx scripts/reset-santana.mjs            # so mostra o que existe
 *   npx tsx scripts/reset-santana.mjs --apagar   # apaga
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { logoutMillennium } from "../workers/millennium-sync/src/millenniumAuth.ts";

const EMAIL = "santanaebessaltda@gmail.com";
const APPLY = process.argv.includes("--apagar");

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[t.slice(0, i).trim()] = val;
  }
  return env;
}

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);
const env = {
  ...loadEnv(path.join(root, ".env")),
  ...loadEnv(path.join(root, "workers/millennium-sync/.env")),
};
for (const [k, v] of Object.entries(env)) {
  if (!(k in process.env)) process.env[k] = v;
}

const STORE_CONFIG_COLUMNS = [
  "timezone",
  "hours",
  "opened_at",
  "royalties_wepink_pct",
  "royalties_wpink_pct",
  "marketing_wepink_pct",
  "marketing_wpink_pct",
  "rent_wepink_pct",
  "rent_wpink_pct",
  "rent_min_cents",
  "icms_pct",
  "icms_st_pct",
];
const BACKUP_FILE = path.join(root, ".tmp-store-config-santana.json");

const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !key) {
  console.error("FAIL: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: identity, error: idErr } = await sb
  .from("identity")
  .select("id, email")
  .ilike("email", EMAIL)
  .maybeSingle();
if (idErr || !identity) {
  console.error("identity:", idErr?.message ?? "not found");
  process.exit(1);
}

const { data: membership, error: memErr } = await sb
  .from("membership")
  .select("id, tenant_id, onboarding_step")
  .eq("identity_id", identity.id)
  .maybeSingle();
if (memErr || !membership) {
  console.error("membership:", memErr?.message ?? "not found");
  process.exit(1);
}

const tenantId = membership.tenant_id;
console.log(`tenant ${tenantId} · membership ${membership.id} · onboarding_step ${membership.onboarding_step}`);

// Filhos antes dos pais (store / erp_credential por ultimo).
const TENANT_TABLES = [
  "sales_hour_agg",
  "sales_day_agg",
  "sales_category_day_agg",
  "sales_payment_day_agg",
  "sales_seller_day_agg",
  "sales_product_day_agg",
  "sales_product_cost_day_agg",
  "sales_coupon_brand",
  "store_seller",
  "erp_sales_evento",
  "sync_log",
  "sync_run",
  "sync_job",
];

console.log(APPLY ? "\n— APAGANDO —" : "\n— só leitura (use --apagar para apagar) —");
for (const table of [...TENANT_TABLES, "store", "erp_credential"]) {
  const { count, error } = await sb
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  console.log(`  ${table}: ${error ? "ERRO " + error.message : count ?? 0}`);
}

const { data: stores } = await sb
  .from("store")
  .select("code, name, timezone, hours, royalties_wepink_pct, icms_pct, icms_st_pct, rent_min_cents")
  .eq("tenant_id", tenantId);
for (const s of stores ?? []) {
  const hasConfig =
    s.hours != null ||
    s.royalties_wepink_pct != null ||
    s.icms_pct != null ||
    s.icms_st_pct != null ||
    s.rent_min_cents != null;
  console.log(`  loja ${s.code} ${s.name} · ${s.timezone ?? "-"} · config manual: ${hasConfig ? "sim" : "não"}`);
}

if (!APPLY) process.exit(0);

// 0) Backup da config manual das lojas (Configuracoes > Lojas)  -  restore-santana-store-config.mjs reaplica.
const { data: storeConfig, error: cfgErr } = await sb
  .from("store")
  .select(`millennium_store_id, code, ${STORE_CONFIG_COLUMNS.join(", ")}`)
  .eq("tenant_id", tenantId);
if (cfgErr) {
  console.error("backup config lojas:", cfgErr.message);
  process.exit(1);
}
fs.writeFileSync(BACKUP_FILE, JSON.stringify(storeConfig, null, 2));
console.log(`backup config de ${storeConfig.length} loja(s) → ${path.relative(root, BACKUP_FILE)}`);

// 1) Jobs abertos  ->  FAILED (worker nao pega mais nada deste tenant).
const { data: openJobs } = await sb
  .from("sync_job")
  .select("id, kind, status")
  .eq("tenant_id", tenantId)
  .in("status", ["QUEUED", "RUNNING"]);
if (openJobs?.length) {
  await sb
    .from("sync_job")
    .update({
      status: "FAILED",
      error: "reset onboarding",
      finished_at: new Date().toISOString(),
      locked_at: null,
    })
    .eq("tenant_id", tenantId)
    .in("status", ["QUEUED", "RUNNING"]);
  console.log("cancelled jobs", openJobs.map((j) => `${j.kind}:${j.status}`).join(", "));
}

// 2) Logout Millennium (nao deixa sessao orfa no ERP).
const { data: cred } = await sb
  .from("erp_credential")
  .select("id, millennium_session")
  .eq("tenant_id", tenantId)
  .maybeSingle();
const token = String(cred?.millennium_session ?? "").trim();
if (token) {
  try {
    await logoutMillennium(token);
    console.log("logout Millennium OK");
  } catch (e) {
    console.warn("logout:", e instanceof Error ? e.message : e);
  }
}

// 3) Dados do ERP.
for (const table of TENANT_TABLES) {
  const { error, count } = await sb.from(table).delete({ count: "exact" }).eq("tenant_id", tenantId);
  if (error) console.warn(`${table}:`, error.message);
  else console.log("deleted", table, count ?? 0);
}

const { error: msErr } = await sb.from("membership_store").delete().eq("membership_id", membership.id);
if (msErr) console.warn("membership_store:", msErr.message);
else console.log("cleared membership_store");

for (const table of ["store", "erp_credential"]) {
  const { error, count } = await sb.from(table).delete({ count: "exact" }).eq("tenant_id", tenantId);
  if (error) console.warn(`${table}:`, error.message);
  else console.log("deleted", table, count ?? 0);
}

// 4) Onboarding do zero.
const { error: stepErr } = await sb
  .from("membership")
  .update({ onboarding_step: 1 })
  .eq("id", membership.id);
if (stepErr) console.warn("onboarding_step:", stepErr.message);
else console.log("onboarding_step → 1 (Empresa)");

console.log("OK · reset concluído — faça login com", EMAIL);
