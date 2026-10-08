/**
 * Isolamento do vendedor (SACC-06): loga como um vendedor de teste e confere que
 *   1. nenhuma tabela da empresa devolve linhas (so as proprias em identity/membership/membership_store/tenant);
 *   2. as funcoes so do servidor recusam a chamada e staff_tenant_ids() vem vazio;
 *   3. a Edge seller-home responde sem R$ de colegas (ranking so com posicao, nome, %, nivel).
 * Sai com codigo 1 listando cada falha. Precisa das migrations aplicadas e da Edge publicada.
 *
 * Variaveis (process.env, .env ou workers/millennium-sync/.env):
 *   SUPABASE_URL (ou VITE_SUPABASE_URL)  |  SUPABASE_ANON_KEY (ou VITE_SUPABASE_ANON_KEY)
 *   SELLER_TEST_EMAIL  |  SELLER_TEST_PASSWORD   conta SELLER ativa e ligada a uma loja
 *   SELLER_HOME_URL                            opcional; padrao {SUPABASE_URL}/functions/v1/seller-home
 *
 *   node scripts/check-seller-isolation.mjs
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
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const env = {
  ...loadEnv(path.join(root, ".env")),
  ...loadEnv(path.join(root, "workers/millennium-sync/.env")),
  ...process.env,
};
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || "";
const email = env.SELLER_TEST_EMAIL || "";
const password = env.SELLER_TEST_PASSWORD || "";
const sellerHomeUrl = env.SELLER_HOME_URL || `${url}/functions/v1/seller-home`;

if (!url || !anonKey || !email || !password) {
  console.error(
    "uso: SELLER_TEST_EMAIL=… SELLER_TEST_PASSWORD=… node scripts/check-seller-isolation.mjs\n" +
      "     (também precisa de SUPABASE_URL e SUPABASE_ANON_KEY; SELLER_HOME_URL opcional)",
  );
  process.exit(1);
}

/** Tabelas e views de `public` (migrations). Nenhuma pode devolver linha para o vendedor. */
const TENANT_TABLES = [
  "erp_credential",
  "store",
  "sync_job",
  "sync_run",
  "sync_log",
  "sales_day_agg",
  "sales_hour_agg",
  "sales_category_day_agg",
  "sales_category_day_view",
  "sales_payment_day_agg",
  "sales_seller_day_agg",
  "sales_product_day_agg",
  "sales_product_cost_day_agg",
  "sales_seller_product_day_agg",
  "sales_price_table_day_agg",
  "sales_coupon_brand",
  "erp_sales_evento",
  "store_seller",
  "store_shift",
  "store_cost_item",
  "store_stock",
  "store_purchase_stock",
  "store_purchase_min",
  "goal",
  "challenge",
  "product_type",
  "product_catalog",
  "product_catalog_miss",
  "product_catalog_sync",
  "product_cost_table",
  "product_cost_table_price",
  "product_cost_table_sync",
  "product_cost_miss",
  "product_sale_table",
  "product_sale_price",
];

/** Grant so de algumas colunas: `*` daria permission denied sem testar a policy. */
const SELECT_COLUMNS = { product_catalog_sync: "id" };

const SERVICE_ONLY_RPCS = [
  ["sync_seller_access", { p_tenant_id: "00000000-0000-0000-0000-000000000000", p_store_id: "00000000-0000-0000-0000-000000000000" }],
  ["invite_link_token", { p_auth_user_id: "00000000-0000-0000-0000-000000000000" }],
  ["link_seller_day_aggs", { p_tenant_id: "00000000-0000-0000-0000-000000000000", p_store_id: null }],
];

const RANKING_KEYS = new Set(["position", "name", "pct", "level", "me"]);
const GOAL_KEYS = new Set(["name", "startsOn", "endsOn", "mode", "me", "nextLevelGain", "projectedPrize", "ranking"]);

const isPermissionDenied = (error) => error?.code === "42501" || /permission denied/i.test(error?.message ?? "");

const sb = createClient(url, anonKey, { auth: { persistSession: false } });
const { data: signIn, error: signInErr } = await sb.auth.signInWithPassword({ email, password });
if (signInErr || !signIn.session) {
  console.error("FAIL: login do vendedor:", signInErr?.message ?? "sem sessão");
  process.exit(1);
}
const authUserId = signIn.user.id;
const failures = [];

for (const table of TENANT_TABLES) {
  const { data, error } = await sb
    .from(table)
    .select(SELECT_COLUMNS[table] ?? "*")
    .limit(1);
  if (error) {
    if (!isPermissionDenied(error)) failures.push(`${table}: erro inesperado (${error.code ?? ""} ${error.message})`);
    continue;
  }
  if (data.length > 0) failures.push(`${table}: devolveu linhas`);
}

const { data: identities, error: identErr } = await sb.from("identity").select("id, auth_user_id");
if (identErr) failures.push(`identity: ${identErr.message}`);
const ownIdentityIds = (identities ?? []).map((r) => r.id);
if ((identities ?? []).some((r) => r.auth_user_id !== authUserId)) failures.push("identity: devolveu identidade de outra pessoa");
if (ownIdentityIds.length !== 1) failures.push(`identity: esperado 1 linha própria, veio ${ownIdentityIds.length}`);

const { data: memberships, error: membErr } = await sb.from("membership").select("id, identity_id, tenant_id, role, status");
if (membErr) failures.push(`membership: ${membErr.message}`);
if ((memberships ?? []).some((m) => !ownIdentityIds.includes(m.identity_id))) {
  failures.push("membership: devolveu acesso de outra pessoa");
}
if (!(memberships ?? []).some((m) => m.role === "SELLER" && m.status === "ACTIVE")) {
  failures.push("membership: a conta de teste não tem acesso SELLER ativo");
}
const ownMembershipIds = (memberships ?? []).map((m) => m.id);
const ownTenantIds = (memberships ?? []).map((m) => m.tenant_id);

const { data: memberStores, error: msErr } = await sb.from("membership_store").select("membership_id, store_id");
if (msErr) failures.push(`membership_store: ${msErr.message}`);
if ((memberStores ?? []).some((r) => !ownMembershipIds.includes(r.membership_id))) {
  failures.push("membership_store: devolveu lojas de outro acesso");
}

const { data: tenants, error: tenantErr } = await sb.from("tenant").select("id");
if (tenantErr) failures.push(`tenant: ${tenantErr.message}`);
if ((tenants ?? []).some((t) => !ownTenantIds.includes(t.id))) failures.push("tenant: devolveu outra empresa");

const { data: staffTenants, error: staffErr } = await sb.rpc("staff_tenant_ids");
if (staffErr) failures.push(`staff_tenant_ids: ${staffErr.message}`);
else if ((staffTenants ?? []).length > 0) failures.push("staff_tenant_ids: vendedor aparece como Gestor/Gerente");

for (const [fn, args] of SERVICE_ONLY_RPCS) {
  const { error } = await sb.rpc(fn, args);
  if (!error) failures.push(`${fn}: vendedor conseguiu executar`);
  else if (!isPermissionDenied(error)) failures.push(`${fn}: erro inesperado (${error.code ?? ""} ${error.message})`);
}

const res = await fetch(sellerHomeUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${signIn.session.access_token}`,
  },
  body: "{}",
});
const payload = await res.json().catch(() => null);
if (!res.ok || !payload?.ok || !payload.home) {
  failures.push(`seller-home: HTTP ${res.status} ${JSON.stringify(payload)}`);
} else {
  for (const store of payload.home.stores ?? []) {
    if (!store.goal) continue;
    for (const key of Object.keys(store.goal)) {
      if (!GOAL_KEYS.has(key)) failures.push(`seller-home: loja ${store.storeId} traz campo inesperado na meta: ${key}`);
    }
    for (const entry of store.goal.ranking ?? []) {
      for (const key of Object.keys(entry)) {
        if (!RANKING_KEYS.has(key)) failures.push(`seller-home: ranking da loja ${store.storeId} traz ${key}`);
      }
    }
  }
}

await sb.auth.signOut();

if (failures.length) {
  console.error(`FAIL: ${failures.length} problema(s) de isolamento`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: ${TENANT_TABLES.length} tabelas sem linhas, dados próprios restritos, seller-home sem R$ de colegas`);
