/** Limpa sessao Millennium stale + reenfileira SEED Santana. */
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

const { data: cred } = await sb
  .from("erp_credential")
  .update({
    millennium_session: null,
    sync_paused: false,
  })
  .eq("tenant_id", tid)
  .select("id")
  .single();
console.log("cleared session · cred", cred.id);

const { data: open } = await sb
  .from("sync_job")
  .select("id, kind, status")
  .eq("tenant_id", tid)
  .in("status", ["QUEUED", "RUNNING"]);
if (open?.length) {
  await sb
    .from("sync_job")
    .update({
      status: "FAILED",
      error: "reseed after 401 — fresh login",
      finished_at: new Date().toISOString(),
      locked_at: null,
    })
    .eq("tenant_id", tid)
    .in("status", ["QUEUED", "RUNNING"]);
  console.log("cancelled", open.map((j) => `${j.kind}:${j.status}`).join(", "));
}

const { data: seed, error } = await sb
  .from("sync_job")
  .insert({
    tenant_id: tid,
    credential_id: cred.id,
    kind: "SEED",
    status: "QUEUED",
    payload: {},
  })
  .select("id")
  .single();
if (error) {
  console.error(error.message);
  process.exit(1);
}
console.log("SEED QUEUED", seed.id);
