/**
 * Ultimos jobs da fila de sync (status, tipo, horarios). So leitura.
 * Usage: node scripts/diag-last-jobs.mjs [N]
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

const { data, error } = await sb
  .from("sync_job")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(Number(process.argv[2] ?? 10));
if (error) throw error;
for (const j of data ?? []) {
  const auto = j.payload?.auto ? " auto" : "";
  console.log(j.created_at, j.kind + auto, j.status, j.started_at ?? "-", j.finished_at ?? "-", (j.error ?? "").slice(0, 80));
}
