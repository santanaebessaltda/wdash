/** Tenta login ate sair de busy; ai enfileira SEED. */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient, buildDeps } from "../workers/millennium-sync/src/deps.ts";
import { loginMillennium } from "../workers/millennium-sync/src/millenniumAuth.ts";

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
for (const [k, v] of Object.entries(env)) {
  if (!(k in process.env)) process.env[k] = v;
}
if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
}

const secret = process.env.ERP_SECRET_KEY;
const sb = createAdminClient();
const deps = buildDeps(sb, secret);

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
const { data: credRow } = await sb
  .from("erp_credential")
  .select("id")
  .eq("tenant_id", tid)
  .single();
const full = await deps.loadCredential(credRow.id);

for (let i = 1; i <= 20; i++) {
  console.log(`login try ${i}/20…`);
  const login = await loginMillennium(full.username, full.password);
  if (login.ok) {
    await deps.setStoredSession(credRow.id, login.session);
    await sb
      .from("erp_credential")
      .update({ sync_paused: false, last_error: null, last_error_at: null })
      .eq("id", credRow.id);
    console.log("login OK · session saved");

    await sb
      .from("sync_job")
      .update({
        status: "FAILED",
        error: "replaced after busy clear",
        finished_at: new Date().toISOString(),
        locked_at: null,
      })
      .eq("tenant_id", tid)
      .in("status", ["QUEUED", "RUNNING"]);

    const { data: seed, error } = await sb
      .from("sync_job")
      .insert({
        tenant_id: tid,
        credential_id: credRow.id,
        kind: "SEED",
        status: "QUEUED",
        payload: {},
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    console.log("SEED QUEUED", seed.id);
    process.exit(0);
  }
  console.log(`  → ${login.reason}: ${String(login.raw).slice(0, 120)}`);
  await new Promise((r) => setTimeout(r, 30_000));
}
console.error("ainda busy após 20 tentativas");
process.exit(1);
