/**
 * Limpa vendas/jobs do Santana e enfileira SEED novo.
 * Mantem lojas + credencial ERP (nao mexe no onboarding).
 *
 * Usage: node scripts/wipe-santana-sales-reseed.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const EMAIL = "santanaebessaltda@gmail.com";

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
  .select("id, tenant_id")
  .eq("identity_id", identity.id)
  .maybeSingle();
if (memErr || !membership) {
  console.error("membership:", memErr?.message ?? "not found");
  process.exit(1);
}

const tenantId = membership.tenant_id;
console.log("tenant", tenantId, "|", identity.email);

const { data: cred, error: credErr } = await sb
  .from("erp_credential")
  .select("id")
  .eq("tenant_id", tenantId)
  .maybeSingle();
if (credErr || !cred) {
  console.error("erp_credential:", credErr?.message ?? "not found — rode onboarding ERP antes");
  process.exit(1);
}

for (const table of [
  "sales_hour_agg",
  "sales_day_agg",
  "sales_category_day_agg",
  "sales_payment_day_agg",
  "sales_seller_day_agg",
  "sales_product_day_agg",
  "sales_coupon_brand",
  "store_seller",
  "erp_sales_evento",
  "sync_log",
  "sync_run",
]) {
  const { error, count } = await sb
    .from(table)
    .delete({ count: "exact" })
    .eq("tenant_id", tenantId);
  if (error) console.warn(`${table}:`, error.message);
  else console.log("deleted", table, count ?? "?");
}

const { data: openJobs } = await sb
  .from("sync_job")
  .select("id, kind, status")
  .eq("tenant_id", tenantId)
  .in("status", ["QUEUED", "RUNNING"]);
if (openJobs?.length) {
  const { error: jobErr } = await sb
    .from("sync_job")
    .update({
      status: "FAILED",
      error: "wipe sales + reseed (sem S-100, sem HISTORY auto)",
      finished_at: new Date().toISOString(),
      locked_at: null,
    })
    .eq("tenant_id", tenantId)
    .in("status", ["QUEUED", "RUNNING"]);
  if (jobErr) console.warn("cancel jobs:", jobErr.message);
  else console.log("cancelled jobs", openJobs.map((j) => `${j.kind}:${j.status}`).join(", "));
} else {
  console.log("no open jobs");
}

const { data: seed, error: seedErr } = await sb
  .from("sync_job")
  .insert({
    tenant_id: tenantId,
    credential_id: cred.id,
    kind: "SEED",
    status: "QUEUED",
    payload: {},
  })
  .select("id")
  .single();
if (seedErr || !seed) {
  console.error("enqueue SEED:", seedErr?.message ?? "failed");
  process.exit(1);
}

console.log("OK · SEED QUEUED", seed.id);
console.log("Range: dia 1 do mês atual → hoje");
