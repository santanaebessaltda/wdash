/**
 * Produtos vendidos com custo 0 no RELATORIOMARGEM (sales_product_cost_day_agg). So leitura.
 * Usage: node scripts/diag-zero-cost-products.mjs
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

const { data: stores } = await sb.from("store").select("id, code");
const codeOf = new Map((stores ?? []).map((s) => [s.id, s.code]));

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb
    .from("sales_product_cost_day_agg")
    .select("store_id, day, product_code, item_count, revenue_cents, cmv_cents")
    .gt("revenue_cents", 0)
    .eq("cmv_cents", 0)
    .range(from, from + 999);
  if (error) throw error;
  rows.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

const byProd = new Map();
for (const r of rows) {
  const p = byProd.get(r.product_code) ?? { dias: new Set(), itens: 0, fat: 0, lojas: new Set(), min: r.day, max: r.day };
  p.dias.add(r.day);
  p.itens += r.item_count;
  p.fat += r.revenue_cents;
  p.lojas.add(codeOf.get(r.store_id));
  if (r.day < p.min) p.min = r.day;
  if (r.day > p.max) p.max = r.day;
  byProd.set(r.product_code, p);
}
for (const [code, p] of [...byProd].sort((a, b) => b[1].fat - a[1].fat)) {
  console.log(
    code.padEnd(12),
    "dias", String(p.dias.size).padStart(3),
    "itens", String(p.itens).padStart(4),
    "fat", (p.fat / 100).toFixed(2).padStart(10),
    "lojas", [...p.lojas].join(","),
    p.min, "->", p.max,
  );
}
