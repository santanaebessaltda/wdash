/**
 * Diag: sales_hour_agg de um dia (brand=ALL) por loja + fuso/horario configurado.
 *   cd workers/millennium-sync && npx tsx scripts/diag-hour-agg.ts 2026-09-23
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
    return;
  }
}

async function main() {
  loadDotEnv();
  const day = process.argv[2] ?? "2026-09-23";
  const sb = createAdminClient();

  const { data: stores, error: se } = await sb
    .from("store")
    .select("id, code, name, timezone, hours");
  if (se) console.log("store err", se.message);
  const nameOf = new Map<string, string>();
  for (const s of stores ?? []) {
    nameOf.set(s.id, `${s.code} ${s.name}`);
    console.log("store", s.code, s.name, "tz=", s.timezone, "hours=", JSON.stringify(s.hours));
  }

  const { data, error } = await sb
    .from("sales_hour_agg")
    .select("store_id, hour, revenue_cents, sales_count, brand")
    .eq("day", day)
    .order("store_id")
    .order("hour");
  if (error) console.log("hour err", error.message);

  const { data: jobs, error: je } = await sb
    .from("sync_job")
    .select("*")
    .neq("kind", "RANGE")
    .gte("created_at", `${day}T00:00:00Z`)
    .order("created_at", { ascending: false })
    .limit(15);
  if (je) console.log("jobs err", je.message);
  for (const j of jobs ?? []) {
    console.log("job", j.kind, j.status, "created", j.created_at, "updated", j.updated_at ?? j.finished_at, JSON.stringify(j.payload));
  }
  const { data: lastRange } = await sb
    .from("sync_job")
    .select("*")
    .eq("kind", "RANGE")
    .order("created_at", { ascending: false })
    .limit(1);
  console.log("job lastRange", JSON.stringify(lastRange?.[0]));

  const byStore = new Map<string, { hour: number; rev: number; n: number; brand: string }[]>();
  for (const r of data ?? []) {
    const k = `${r.store_id}|${r.brand}`;
    const arr = byStore.get(k) ?? [];
    arr.push({ hour: r.hour, rev: Number(r.revenue_cents) / 100, n: r.sales_count, brand: r.brand });
    byStore.set(k, arr);
  }
  for (const [k, rows] of byStore) {
    const [sid, brand] = k.split("|");
    console.log(`\n== ${nameOf.get(sid!) ?? sid} [${brand}] (${day})`);
    for (const r of rows) {
      console.log(`  ${String(r.hour).padStart(2, "0")}h  R$ ${r.rev.toFixed(2).padStart(10)}  vendas=${r.n}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
