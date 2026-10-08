/**
 * Reenfileira SEED/RUNNING orfaos do Santana (UI presa em Buscando, worker mudo).
 * Usage: node scripts/requeue-santana-seed.mjs
 */
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
  (env.SUPABASE_URL || env.VITE_SUPABASE_URL).replace(/\/$/, ""),
  env.SUPABASE_SERVICE_ROLE_KEY,
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

const { data: stuck, error } = await sb
  .from("sync_job")
  .update({
    status: "QUEUED",
    locked_at: null,
    error: null,
    finished_at: null,
  })
  .eq("tenant_id", m.tenant_id)
  .eq("status", "RUNNING")
  .select("id, kind");

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(
  stuck?.length
    ? `OK · ${stuck.length} job(s) RUNNING → QUEUED (${stuck.map((j) => `${j.kind}:${j.id.slice(0, 8)}`).join(", ")})`
    : "Nenhum job RUNNING — nada a reenfileirar",
);
