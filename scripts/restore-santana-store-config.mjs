/**
 * Reaplica a config manual das lojas (fuso, horario, custos, impostos) salva pelo
 * reset-santana.mjs em .tmp-store-config-santana.json, casando por millennium_store_id.
 * Fica esperando o Onboarding recriar as lojas (poll 500ms, ate 30 min).
 *
 *   npx tsx scripts/restore-santana-store-config.mjs
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
if (!url || !key) {
  console.error("FAIL: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const BACKUP_FILE = path.join(root, ".tmp-store-config-santana.json");
if (!fs.existsSync(BACKUP_FILE)) {
  console.error("backup não encontrado:", BACKUP_FILE);
  process.exit(1);
}
const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
const pending = new Map(backup.map((row) => [Number(row.millennium_store_id), row]));

const sb = createClient(url, key, { auth: { persistSession: false } });
const { data: identity } = await sb.from("identity").select("id").ilike("email", EMAIL).maybeSingle();
const { data: membership } = await sb
  .from("membership")
  .select("tenant_id")
  .eq("identity_id", identity.id)
  .maybeSingle();
const tenantId = membership.tenant_id;

console.log(`aguardando o Onboarding criar ${pending.size} loja(s)…`);
const deadline = Date.now() + 30 * 60_000;
while (pending.size > 0 && Date.now() < deadline) {
  const { data: stores } = await sb
    .from("store")
    .select("id, millennium_store_id, code")
    .eq("tenant_id", tenantId)
    .in("millennium_store_id", [...pending.keys()]);
  for (const store of stores ?? []) {
    const row = pending.get(Number(store.millennium_store_id));
    if (!row) continue;
    const { millennium_store_id: _m, code: _c, ...config } = row;
    const { error } = await sb.from("store").update(config).eq("id", store.id);
    if (error) {
      console.warn(`loja ${store.code}:`, error.message);
      continue;
    }
    pending.delete(Number(store.millennium_store_id));
    console.log(`${new Date().toLocaleTimeString("pt-BR")} · loja ${store.code} · config reaplicada (${config.timezone})`);
  }
  if (pending.size > 0) await new Promise((r) => setTimeout(r, 500));
}
if (pending.size > 0) {
  console.error("tempo esgotado · faltaram:", [...pending.values()].map((r) => r.code).join(", "));
  process.exit(1);
}
console.log("OK · config de todas as lojas reaplicada");
