/** Diagnostico: por que o worker nao claima o SEED? */
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
  (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, ""),
  env.SUPABASE_SERVICE_ROLE_KEY || "",
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
const tid = m.tenant_id;

const { data: jobs } = await sb
  .from("sync_job")
  .select("id, kind, status, error, created_at, locked_at, finished_at")
  .eq("tenant_id", tid)
  .order("created_at", { ascending: false })
  .limit(8);

const { data: cred } = await sb
  .from("erp_credential")
  .select("id, sync_paused, status, last_error, last_error_at, millennium_session")
  .eq("tenant_id", tid)
  .single();

console.log(
  "cred",
  JSON.stringify(
    {
      sync_paused: cred.sync_paused,
      status: cred.status,
      last_error: cred.last_error?.slice?.(0, 80) ?? cred.last_error,
      last_error_at: cred.last_error_at,
      has_session: Boolean(cred.millennium_session),
    },
    null,
    2,
  ),
);
console.log("jobs:");
for (const j of jobs ?? []) {
  console.log(
    `  ${j.kind} ${j.status} ${j.id.slice(0, 8)} created=${j.created_at} err=${(j.error ?? "").slice(0, 60)}`,
  );
}

const pausePath = path.join(root, "workers/millennium-sync/.millennium-pause");
console.log("local pause file:", fs.existsSync(pausePath));
