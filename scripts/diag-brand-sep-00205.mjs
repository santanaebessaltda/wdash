/**
 * Compara sales_day_agg (00205, set/26) com totais do relatorio ERP.
 * Usage: node scripts/diag-brand-sep-00205.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const EMAIL = "santanaebessaltda@gmail.com";
const STORE_CODE = "00205";
const FROM = "2026-09-01";
const TO = "2026-09-22";

/** Totais do relatorio "WEPINK - TOTAL VENDA POR DIA" (ERP)  -  set/26 filial 00205 */
const ERP = {
  WEPINK: 165829.25,
  WPINK: 10876.85,
  TOTAL: 176706.1,
};

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

const { data: identity, error: idErr } = await sb
  .from("identity")
  .select("id")
  .ilike("email", EMAIL)
  .maybeSingle();
if (idErr || !identity) {
  console.error("identity:", idErr?.message ?? "missing");
  process.exit(1);
}
const { data: m, error: mErr } = await sb
  .from("membership")
  .select("tenant_id")
  .eq("identity_id", identity.id)
  .maybeSingle();
if (mErr || !m) {
  console.error("membership:", mErr?.message ?? "missing");
  process.exit(1);
}
const tid = m.tenant_id;
console.log("tenant", tid);

const { data: allStores, error: stErr } = await sb
  .from("store")
  .select("id, code, fantasy_name, millennium_store_id, active")
  .eq("tenant_id", tid);
if (stErr) console.error("store err:", stErr.message);
console.log(
  "stores:",
  (allStores ?? []).map((s) => `${s.code}(mill=${s.millennium_store_id},active=${s.active})`).join(", ") || "(none)",
);

// fallback: store_ids from sales_day_agg
const { data: daySample } = await sb
  .from("sales_day_agg")
  .select("store_id")
  .eq("tenant_id", tid)
  .limit(20);
const storeIds = [...new Set((daySample ?? []).map((r) => r.store_id))];
console.log("store_ids in sales_day_agg:", storeIds);

const store =
  (allStores ?? []).find((s) => s.code === STORE_CODE) ||
  (allStores ?? []).find((s) => String(s.code).includes("205")) ||
  (allStores ?? []).find((s) => s.millennium_store_id === 40261) ||
  (storeIds[0] ? { id: storeIds[0], code: "?", millennium_store_id: null } : null);
if (!store) {
  console.error("store not found");
  process.exit(1);
}
console.log("using store", store.code, store.id, "mill", store.millennium_store_id);

const { data: rows } = await sb
  .from("sales_day_agg")
  .select("day, brand, revenue_cents, sales_count, item_count")
  .eq("tenant_id", tid)
  .eq("store_id", store.id)
  .gte("day", FROM)
  .lte("day", TO)
  .order("day");

const byBrand = { ALL: 0, WEPINK: 0, WPINK: 0 };
const byDay = new Map();
for (const r of rows ?? []) {
  byBrand[r.brand] = (byBrand[r.brand] ?? 0) + r.revenue_cents;
  if (!byDay.has(r.day)) byDay.set(r.day, {});
  byDay.get(r.day)[r.brand] = r.revenue_cents;
}

const reais = (c) => (c / 100).toFixed(2);
console.log("\n=== WeDash 00205", FROM, "→", TO, "===");
for (const b of ["ALL", "WEPINK", "WPINK"]) {
  console.log(`  ${b}: R$ ${reais(byBrand[b] ?? 0)} (${byDay.size} days with data)`);
}
const branded = (byBrand.WEPINK ?? 0) + (byBrand.WPINK ?? 0);
console.log(`  WEPINK+WPINK: R$ ${reais(branded)}`);
console.log(`  ALL − branded: R$ ${reais((byBrand.ALL ?? 0) - branded)} (não classificado)`);

console.log("\n=== ERP relatório ===");
console.log(`  WEPINK: R$ ${ERP.WEPINK.toFixed(2)}`);
console.log(`  WPINK:  R$ ${ERP.WPINK.toFixed(2)}`);
console.log(`  TOTAL:  R$ ${ERP.TOTAL.toFixed(2)}`);

console.log("\n=== Delta (WeDash − ERP) ===");
console.log(
  `  WEPINK: R$ ${((byBrand.WEPINK ?? 0) / 100 - ERP.WEPINK).toFixed(2)}`,
);
console.log(
  `  WPINK:  R$ ${((byBrand.WPINK ?? 0) / 100 - ERP.WPINK).toFixed(2)}`,
);
console.log(
  `  ALL vs TOTAL: R$ ${((byBrand.ALL ?? 0) / 100 - ERP.TOTAL).toFixed(2)}`,
);

console.log("\n=== Por dia (WeDash) ===");
console.log("day        | ALL        | WEPINK     | WPINK      | gap");
for (const [day, brands] of [...byDay.entries()].sort()) {
  const all = brands.ALL ?? 0;
  const we = brands.WEPINK ?? 0;
  const wp = brands.WPINK ?? 0;
  const gap = all - we - wp;
  console.log(
    `${day} | ${reais(all).padStart(10)} | ${reais(we).padStart(10)} | ${reais(wp).padStart(10)} | ${reais(gap).padStart(10)}`,
  );
}
