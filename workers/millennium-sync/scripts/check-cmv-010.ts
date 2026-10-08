/**
 * Confere cmv_cents da loja 00010 no banco vs Overview.
 *   cd workers/millennium-sync && npx tsx scripts/check-cmv-010.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient } from "../src/deps.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  for (const path of [resolve(__dirname, "../.env"), resolve(__dirname, "../../../.env")]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
    if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
      process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
    }
  }
}

async function main() {
  loadDotEnv();
  const sb = createAdminClient();
  const { data: store } = await sb
    .from("store")
    .select("id, code, trade_name")
    .eq("code", "00010")
    .maybeSingle();
  if (!store) throw new Error("store 00010 not found");

  const { data: days } = await sb
    .from("sales_day_agg")
    .select("day, brand, cmv_cents, revenue_cents")
    .eq("store_id", store.id)
    .gte("day", "2026-09-01")
    .lte("day", "2026-09-22")
    .order("day");

  const byBrand: Record<string, { cmv: number; n: number }> = {};
  for (const d of days ?? []) {
    const b = d.brand as string;
    byBrand[b] ??= { cmv: 0, n: 0 };
    byBrand[b].cmv += Number(d.cmv_cents || 0);
    byBrand[b].n += 1;
  }
  console.log("store", store.code, store.id);
  console.log("by brand:", JSON.stringify(byBrand, null, 2));
  const all = (days ?? []).filter((d) => d.brand === "ALL");
  const sum = all.reduce((s, d) => s + Number(d.cmv_cents || 0), 0);
  console.log(`ALL Σ CMV=${(sum / 100).toFixed(2)} days=${all.length}`);
  console.log(
    "per day ALL:",
    all.map((d) => `${d.day.slice(8)}=${(Number(d.cmv_cents) / 100).toFixed(0)}`).join(" "),
  );

  // Rede (todas lojas) no mesmo periodo
  const { data: allStores } = await sb
    .from("sales_day_agg")
    .select("store_id, brand, cmv_cents")
    .eq("brand", "ALL")
    .gte("day", "2026-09-01")
    .lte("day", "2026-09-22");
  const byStore: Record<string, number> = {};
  for (const r of allStores ?? []) {
    byStore[r.store_id] = (byStore[r.store_id] ?? 0) + Number(r.cmv_cents || 0);
  }
  const { data: stores } = await sb.from("store").select("id, code");
  const codeById = Object.fromEntries((stores ?? []).map((s) => [s.id, s.code]));
  console.log(
    "rede by store:",
    Object.entries(byStore)
      .map(([id, c]) => `${codeById[id] ?? id}=${(c / 100).toFixed(2)}`)
      .join(" | "),
  );
  const rede = Object.values(byStore).reduce((s, c) => s + c, 0);
  console.log(`rede Σ=${(rede / 100).toFixed(2)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
