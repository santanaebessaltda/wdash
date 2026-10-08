/**
 * Cancela jobs abertos (QUEUED/RUNNING) do tenant de santanaebessaltda@gmail.com.
 * Nao apaga dados nem desloga o Millennium.
 *
 *   npx tsx scripts/cancel-santana-jobs.mjs
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
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: identity } = await sb.from("identity").select("id").ilike("email", EMAIL).maybeSingle();
const { data: membership } = await sb
  .from("membership")
  .select("tenant_id")
  .eq("identity_id", identity.id)
  .maybeSingle();
const tenantId = membership.tenant_id;

const { data: open } = await sb
  .from("sync_job")
  .select("id, kind, status")
  .eq("tenant_id", tenantId)
  .in("status", ["QUEUED", "RUNNING"]);
if (!open?.length) {
  console.log("nenhum job aberto");
  process.exit(0);
}
const { error } = await sb
  .from("sync_job")
  .update({
    status: "FAILED",
    error: "cancelado manualmente (Lista de mês inteiro pesada demais)",
    finished_at: new Date().toISOString(),
    locked_at: null,
  })
  .eq("tenant_id", tenantId)
  .in("status", ["QUEUED", "RUNNING"]);
if (error) {
  console.error(error.message);
  process.exit(1);
}
console.log("cancelados:", open.map((j) => `${j.kind}:${j.status}:${j.id.slice(0, 8)}`).join(", "));
