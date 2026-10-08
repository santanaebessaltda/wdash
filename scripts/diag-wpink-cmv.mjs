/**
 * Lista linhas WPINK / ALL de sales_day_agg (set/2026) e se tem CMV.
 * So leitura. Usage: node scripts/diag-wpink-cmv.mjs [from] [to]
 */
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
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

const from = process.argv[2] ?? "2026-09-01";
const to = process.argv[3] ?? "2026-09-30";

const { data: stores } = await sb.from("store").select("id, code, name, has_wpink");
const byId = new Map((stores ?? []).map((s) => [s.id, s]));

const { data: rows, error } = await sb
  .from("sales_day_agg")
  .select("store_id, day, brand, revenue_cents, cmv_cents, sales_count, item_count")
  .gte("day", from)
  .lte("day", to)
  .in("brand", ["ALL", "WPINK"])
  .order("day");
if (error) throw error;

const brl = (c) => (c == null ? "null" : (c / 100).toFixed(2));
for (const r of rows ?? []) {
  if (r.brand === "WPINK" && !(r.revenue_cents > 0)) continue;
  const s = byId.get(r.store_id);
  const flag = r.brand === "WPINK" && r.revenue_cents > 0 && !r.cmv_cents ? "  <== WPINK sem CMV" : "";
  console.log(
    r.day,
    s?.code ?? r.store_id.slice(0, 8),
    r.brand.padEnd(5),
    "fat", brl(r.revenue_cents).padStart(10),
    "cmv", brl(r.cmv_cents).padStart(10),
    "vendas", String(r.sales_count).padStart(4),
    flag,
  );
}
