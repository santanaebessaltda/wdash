/**
 * Totais por lojaxmarca set/26  -  achar onde esta o gap vs ERP 00205.
 * Usage: node scripts/diag-brand-sep-all.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const EMAIL = "santanaebessaltda@gmail.com";
const FROM = "2026-09-01";
const TO = "2026-09-22";
const ERP = { WEPINK: 165829.25, WPINK: 10876.85, TOTAL: 176706.1 };

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
const sb = createClient(
  (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, ""),
  env.SUPABASE_SERVICE_ROLE_KEY || "",
  { auth: { persistSession: false } },
);

const { data: identity } = await sb
  .from("identity")
  .select("id")
  .ilike("email", EMAIL)
  .maybeSingle();
const { data: m } = await sb
  .from("membership")
  .select("tenant_id")
  .eq("identity_id", identity.id)
  .maybeSingle();
const tid = m.tenant_id;

const { data: stores, error: stErr } = await sb
  .from("store")
  .select("id, code, millennium_store_id, active, name")
  .eq("tenant_id", tid);
if (stErr) {
  const { data: stores2, error: e2 } = await sb
    .from("store")
    .select("*")
    .eq("tenant_id", tid)
    .limit(1);
  console.log("store select err:", stErr.message);
  console.log("store sample keys:", stores2?.[0] ? Object.keys(stores2[0]) : e2?.message);
}

const { data: storesOk } = await sb
  .from("store")
  .select("id, code, millennium_store_id, active")
  .eq("tenant_id", tid);
console.log("stores:");
for (const s of storesOk ?? []) {
  console.log(`  ${s.code} mill=${s.millennium_store_id} active=${s.active} id=${s.id.slice(0, 8)}`);
}
const byId = new Map((storesOk ?? []).map((s) => [s.id, s]));

const { data: rows, error } = await sb
  .from("sales_day_agg")
  .select("store_id, day, brand, revenue_cents")
  .eq("tenant_id", tid)
  .gte("day", FROM)
  .lte("day", TO);
if (error) {
  console.error(error.message);
  process.exit(1);
}

const tot = new Map(); // store|brand -> cents
const tenant = { ALL: 0, WEPINK: 0, WPINK: 0 };
for (const r of rows ?? []) {
  const key = `${r.store_id}|${r.brand}`;
  tot.set(key, (tot.get(key) ?? 0) + r.revenue_cents);
  tenant[r.brand] = (tenant[r.brand] ?? 0) + r.revenue_cents;
}

const reais = (c) => (c / 100).toFixed(2);
console.log(`\nrows=${rows?.length ?? 0}`);
console.log("\n=== Tenant total set/01-22 ===");
for (const b of ["ALL", "WEPINK", "WPINK"]) {
  console.log(`  ${b}: R$ ${reais(tenant[b] ?? 0)}`);
}
console.log(
  `  branded/ALL: ${(((tenant.WEPINK + tenant.WPINK) / (tenant.ALL || 1)) * 100).toFixed(1)}%`,
);

console.log("\n=== Por loja ===");
const storeIds = [...new Set((rows ?? []).map((r) => r.store_id))];
for (const sid of storeIds) {
  const s = byId.get(sid);
  const all = tot.get(`${sid}|ALL`) ?? 0;
  const we = tot.get(`${sid}|WEPINK`) ?? 0;
  const wp = tot.get(`${sid}|WPINK`) ?? 0;
  console.log(
    `  ${s?.code ?? "?"} mill=${s?.millennium_store_id ?? "?"} · ALL ${reais(all)} · WE ${reais(we)} · WP ${reais(wp)} · gap ${reais(all - we - wp)}`,
  );
}

const s205 =
  (storesOk ?? []).find((s) => s.code === "00205") ||
  (storesOk ?? []).find((s) => s.millennium_store_id === 40261);
if (s205) {
  const all = tot.get(`${s205.id}|ALL`) ?? 0;
  const we = tot.get(`${s205.id}|WEPINK`) ?? 0;
  const wp = tot.get(`${s205.id}|WPINK`) ?? 0;
  console.log("\n=== 00205 vs ERP ===");
  console.log(`  WeDash ALL    ${reais(all)}  ERP TOTAL  ${ERP.TOTAL.toFixed(2)}  Δ ${(all / 100 - ERP.TOTAL).toFixed(2)}`);
  console.log(`  WeDash WEPINK ${reais(we)}  ERP WEPINK ${ERP.WEPINK.toFixed(2)}  Δ ${(we / 100 - ERP.WEPINK).toFixed(2)}`);
  console.log(`  WeDash WPINK  ${reais(wp)}  ERP WPINK  ${ERP.WPINK.toFixed(2)}  Δ ${(wp / 100 - ERP.WPINK).toFixed(2)}`);
}
