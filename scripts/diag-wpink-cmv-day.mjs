/**
 * Produtos com custo do dia (sales_product_cost_day_agg) de uma loja/dia. So leitura.
 * Usage: node scripts/diag-wpink-cmv-day.mjs 00205 2026-09-12
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

const [code = "00205", ...days] = process.argv.slice(2);
const { data: store } = await sb.from("store").select("id, code").eq("code", code).maybeSingle();
for (const day of days.length ? days : ["2026-09-12"]) {
  const { data: cost } = await sb
    .from("sales_product_cost_day_agg")
    .select("*")
    .eq("store_id", store.id)
    .eq("day", day);
  const { data: prod } = await sb
    .from("sales_product_day_agg")
    .select("*")
    .eq("store_id", store.id)
    .eq("day", day);
  console.log(`=== ${code} ${day} ===`);
  console.log("custo (margem):");
  for (const r of cost ?? []) {
    const k = r.product_code ?? r.cod_produto ?? r.product_id;
    if (!String(k).toUpperCase().startsWith("WP")) continue;
    console.log(" ", JSON.stringify(r));
  }
  console.log("itens (cupom):");
  for (const r of prod ?? []) {
    const k = String(r.product_code ?? r.cod_produto ?? r.product_id ?? "");
    const d = String(r.description ?? r.product_name ?? "");
    if (!k.toUpperCase().startsWith("WP") && !d.toUpperCase().includes("WP")) continue;
    console.log(" ", JSON.stringify(r));
  }
}
