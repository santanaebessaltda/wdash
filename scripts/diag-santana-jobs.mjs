/** Diagnostico rapido Santana  -  jobs abertos. */
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

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const env = {
  ...loadEnv(path.join(root, ".env")),
  ...loadEnv(path.join(root, "workers/millennium-sync/.env")),
};
const sb = createClient(
  (env.SUPABASE_URL || env.VITE_SUPABASE_URL).replace(/\/$/, ""),
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const EMAIL = "santanaebessaltda@gmail.com";
const { data: identity } = await sb.from("identity").select("id").ilike("email", EMAIL).maybeSingle();
const { data: m } = await sb
  .from("membership")
  .select("id, tenant_id, onboarding_step")
  .eq("identity_id", identity.id)
  .maybeSingle();
const tid = m.tenant_id;

const { data: jobs } = await sb
  .from("sync_job")
  .select("id, kind, status, error, created_at, started_at, finished_at, claimed_by")
  .eq("tenant_id", tid)
  .order("created_at", { ascending: false })
  .limit(10);

const { data: ec } = await sb
  .from("erp_credential")
  .select("sync_paused, millennium_session, status")
  .eq("tenant_id", tid)
  .maybeSingle();

console.log(
  JSON.stringify(
    {
      onboarding_step: m.onboarding_step,
      sync_paused: ec?.sync_paused ?? null,
      has_session: Boolean(ec?.millennium_session),
      jobs: (jobs ?? []).map((j) => ({
        id: j.id.slice(0, 8),
        kind: j.kind,
        status: j.status,
        error: j.error,
        created_at: j.created_at,
        started_at: j.started_at,
        finished_at: j.finished_at,
        claimed_by: j.claimed_by,
      })),
    },
    null,
    2,
  ),
);
