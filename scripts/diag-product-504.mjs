/**
 * Vendas e custo de um produto (margem x tabelas de custo). So leitura.
 * Usage: node scripts/diag-product-504.mjs [COD_PRODUTO]
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

const code = process.argv[2] ?? "504";
const { data: stores } = await sb.from("store").select("id, code, trade_name, cost_table_id");
const storeOf = new Map((stores ?? []).map((s) => [s.id, s]));

const { data: cat } = await sb.from("product_catalog").select("*").eq("product_code", code);
console.log("catalogo:", cat);

const { data: sales } = await sb
  .from("sales_product_day_agg")
  .select("store_id, day, item_count, revenue_cents")
  .eq("product_code", code)
  .order("day");
console.log(`\nvendas (sales_product_day_agg): ${sales?.length ?? 0} linhas`);
for (const r of sales ?? []) {
  console.log(r.day, storeOf.get(r.store_id)?.code, "itens", r.item_count, "R$", (r.revenue_cents / 100).toFixed(2));
}

const { data: cost } = await sb
  .from("sales_product_cost_day_agg")
  .select("store_id, day, item_count, revenue_cents, cmv_cents")
  .eq("product_code", code)
  .order("day");
console.log(`\nmargem (sales_product_cost_day_agg): ${cost?.length ?? 0} linhas`);
for (const r of cost ?? []) {
  const unit = r.item_count > 0 ? r.cmv_cents / 100 / r.item_count : 0;
  console.log(
    r.day, storeOf.get(r.store_id)?.code,
    "itens", r.item_count,
    "R$", (r.revenue_cents / 100).toFixed(2),
    "CMV", (r.cmv_cents / 100).toFixed(2),
    "unit", unit.toFixed(2),
  );
}

const { data: prices } = await sb.from("product_cost_table_price").select("table_id, unit_cost_cents").eq("product_code", code);
console.log("\nprecos nas tabelas de custo:", prices);
console.log("tabela por loja:", (stores ?? []).map((s) => `${s.code}=${s.cost_table_id}`).join(" "));
