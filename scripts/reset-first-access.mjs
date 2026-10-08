/**
 * Volta um usuario para o "primeiro acesso" (tela Crie seu acesso) sem mexer em dados do ERP.
 * Marca temporary_password = true; a senha atual vira a "temporaria". Apaga a foto de perfil (avatar_url + arquivos).
 * Com --onboarding (so dono): reabre o onboarding na etapa Integracao ERP (onboarding_step = 2).
 * Reconectar com o mesmo usuario Millennium nao apaga dados; outro usuario apaga os dados de venda do tenant.
 * Com --wipe (implica --onboarding): salva backup das lojas (config, turnos, turno das vendedoras) em
 * .tmp-backup-<tenant>-<data>.json e apaga TUDO do tenant (credencial ERP, lojas, vendas, jobs, logs).
 * Catalogo de produtos e tabelas de custo sao globais e ficam.
 * Usa a service role de workers/millennium-sync/.env.
 *
 *   node scripts/reset-first-access.mjs email@exemplo.com [--onboarding] [--wipe]
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const EMAIL = process.argv[2];
const WIPE = process.argv.includes("--wipe");
const REOPEN_ONBOARDING = WIPE || process.argv.includes("--onboarding");
if (!EMAIL) {
  console.error("uso: npx tsx scripts/reset-first-access.mjs email@exemplo.com");
  process.exit(1);
}

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const env = { ...loadEnv(path.join(root, ".env")), ...loadEnv(path.join(root, "workers/millennium-sync/.env")) };
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !key) {
  console.error("FAIL: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await sb
  .from("identity")
  .update({ temporary_password: true, avatar_url: null })
  .ilike("email", EMAIL)
  .select("id, auth_user_id, email, name, temporary_password");
if (error || !data?.length) {
  console.error("identity:", error?.message ?? "not found");
  process.exit(1);
}
console.log(data);

const authUid = data[0].auth_user_id;
if (authUid) {
  const { data: fotos, error: listErr } = await sb.storage.from("avatars").list(authUid);
  if (listErr) console.error("avatars:", listErr.message);
  else if (fotos?.length) {
    const { error: rmErr } = await sb.storage.from("avatars").remove(fotos.map((f) => `${authUid}/${f.name}`));
    console.log(rmErr ? `avatars: ${rmErr.message}` : `apagado: fotos de perfil (${fotos.length})`);
  }
}

if (WIPE) {
  const { data: owner } = await sb
    .from("membership")
    .select("tenant_id")
    .eq("identity_id", data[0].id)
    .eq("is_owner", true)
    .maybeSingle();
  if (!owner) {
    console.error("--wipe: usuário não é dono de nenhum tenant");
    process.exit(1);
  }
  const tenantId = owner.tenant_id;
  const must = (label, r) => {
    if (r.error) {
      console.error(`${label}:`, r.error.message);
      process.exit(1);
    }
    return r.data ?? [];
  };

  const stores = must("store", await sb.from("store").select("*").eq("tenant_id", tenantId));
  const shifts = must("store_shift", await sb.from("store_shift").select("*").eq("tenant_id", tenantId));
  const sellers = must(
    "store_seller",
    await sb
      .from("store_seller")
      .select("store_id, millennium_employee_id, name, shift_id")
      .eq("tenant_id", tenantId)
      .not("shift_id", "is", null),
  );
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const backupFile = path.join(root, `.tmp-backup-${tenantId}-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ tenantId, stores, shifts, sellerShifts: sellers }, null, 2));
  console.log(`backup: ${backupFile} (${stores.length} lojas, ${shifts.length} turnos, ${sellers.length} vendedoras com turno)`);

  const storeIds = stores.map((s) => s.id);
  if (storeIds.length) must("membership_store", await sb.from("membership_store").delete().in("store_id", storeIds));
  for (const table of [
    "sync_log",
    "sync_job",
    "sync_run",
    "sales_coupon_brand",
    "sales_product_cost_day_agg",
    "sales_product_day_agg",
    "sales_category_day_agg",
    "sales_seller_day_agg",
    "sales_payment_day_agg",
    "sales_hour_agg",
    "sales_day_agg",
    "erp_sales_evento",
    "store_seller",
    "store_shift",
    "store",
    "erp_credential",
  ]) {
    const r = await sb.from(table).delete({ count: "exact" }).eq("tenant_id", tenantId);
    must(table, r);
    console.log(`apagado: ${table} (${r.count ?? 0})`);
  }
}

const membQuery = sb.from("membership");
const { data: memb } = REOPEN_ONBOARDING
  ? await membQuery
      .update({ onboarding_step: 2 })
      .eq("identity_id", data[0].id)
      .eq("is_owner", true)
      .select("role, status, is_owner, onboarding_step")
  : await membQuery.select("role, status, is_owner, onboarding_step").eq("identity_id", data[0].id);
console.log("membership:", memb);
