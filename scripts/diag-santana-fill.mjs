/** Diagnostico: carga pos-onboarding Santana (jobs fillUntil + cobertura). */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

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
  (env.SUPABASE_URL || env.VITE_SUPABASE_URL).replace(/\/$/, ""),
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const EMAIL = "santanaebessaltda@gmail.com";
const { data: identity, error: idErr } = await sb
  .from("identity")
  .select("id")
  .ilike("email", EMAIL)
  .maybeSingle();
if (idErr || !identity) throw idErr || new Error("identity not found");

const { data: m } = await sb
  .from("membership")
  .select("id, tenant_id, onboarding_step")
  .eq("identity_id", identity.id)
  .maybeSingle();
const tid = m.tenant_id;
console.log("tenant", tid);
console.log("onboarding_step", m.onboarding_step);

const { data: jobs } = await sb
  .from("sync_job")
  .select("id, kind, status, error, created_at, finished_at, payload")
  .eq("tenant_id", tid)
  .order("created_at", { ascending: false })
  .limit(50);

console.log("\n--- jobs ---");
for (const j of jobs ?? []) {
  const p = j.payload || {};
  console.log(
    [
      j.created_at?.slice(0, 19),
      j.kind.padEnd(5),
      j.status.padEnd(10),
      p.fillUntil ? `fillUntil=${p.fillUntil}` : "",
      p.from != null ? `from=${p.from}` : "",
      p.to != null ? `to=${p.to}` : "",
      p.deep ? "deep" : "",
      p.progressDay ? `progress=${p.progressDay}` : "",
      p.deepDone ? "deepDone" : "",
      (j.error || "").slice(0, 120),
    ]
      .filter(Boolean)
      .join(" | "),
  );
}

const fills = (jobs ?? []).filter((j) => j.payload?.fillUntil && !j.payload?.deep);
console.log("\n--- month-fill jobs (fillUntil, not deep) ---", fills.length);
for (const j of fills) {
  console.log(j.created_at?.slice(0, 19), j.status, j.payload);
}

const { data: stores } = await sb
  .from("store")
  .select("id, name, trade_name, active, last_closed_day")
  .eq("tenant_id", tid);
console.log("\n--- coverage ---");
for (const s of stores ?? []) {
  const { data: min } = await sb
    .from("sales_day_agg")
    .select("day")
    .eq("store_id", s.id)
    .eq("brand", "ALL")
    .order("day", { ascending: true })
    .limit(1)
    .maybeSingle();
  const { data: max } = await sb
    .from("sales_day_agg")
    .select("day")
    .eq("store_id", s.id)
    .eq("brand", "ALL")
    .order("day", { ascending: false })
    .limit(1)
    .maybeSingle();
  console.log(
    (s.trade_name || s.name).slice(0, 40).padEnd(40),
    "active=" + s.active,
    "last_closed=" + (s.last_closed_day ?? "-"),
    "agg",
    min?.day ?? "-",
    "..",
    max?.day ?? "-",
  );
}
