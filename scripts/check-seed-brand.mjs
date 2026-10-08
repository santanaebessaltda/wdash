/** Status rapido do SEED Santana pos-wipe. Usage: node scripts/check-seed-brand.mjs */
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

const { data: jobs } = await sb
  .from("sync_job")
  .select("id, kind, status, error, started_at, finished_at")
  .eq("tenant_id", tid)
  .order("created_at", { ascending: false })
  .limit(3);

const { data: days } = await sb
  .from("sales_day_agg")
  .select("brand, revenue_cents")
  .eq("tenant_id", tid);

const by = {};
const rev = {};
for (const r of days ?? []) {
  by[r.brand] = (by[r.brand] ?? 0) + 1;
  rev[r.brand] = (rev[r.brand] ?? 0) + (r.revenue_cents ?? 0);
}

console.log("jobs:");
for (const j of jobs ?? []) {
  console.log(`  ${j.kind} ${j.status} ${j.id.slice(0, 8)}…`, j.error ?? "");
}
console.log("day_agg rows:", by);
console.log(
  "revenue R$:",
  Object.fromEntries(
    Object.entries(rev).map(([k, v]) => [k, (v / 100).toFixed(2)]),
  ),
);
