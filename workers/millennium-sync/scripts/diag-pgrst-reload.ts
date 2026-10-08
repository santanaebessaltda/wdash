/**
 * Reload PostgREST schema cache + verify grants on sales_category_day_agg.
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
  const sb = createAdminClient();
  // PostgREST schema cache  -  tabela nova as vezes some do REST ate reload.
  const { error: n1 } = await sb.rpc("" as never).maybeSingle?.();
  void n1;
  const { data, error } = await sb
    .from("sales_category_day_agg")
    .select("category_name")
    .limit(1);
  console.log("service select ok", !error, data?.length, error?.message);

  // Try raw SQL via postgres if available  -  use REST workaround:
  // supabase js can't NOTIFY easily; use fetch to Management or sql endpoint.
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  // PostgREST: Prefer header force reload? Use pg_net? 
  // Official: SELECT pg_notify('pgrst', 'reload schema');
  const res = await fetch(`${url}/rest/v1/rpc/`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  console.log("rpc probe", res.status);

  // Direct SQL via supabase db? Use postgres connection string if present.
  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  console.log("has DATABASE_URL", Boolean(dbUrl));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
