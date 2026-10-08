/**
 * Diagnostico: 1 dia vs range maior no VENDAS.Lista.
 * Uso (worker com .env ok):
 *   cd workers/millennium-sync
 *   npx tsx scripts/probe-sales-range.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium, logoutMillennium, millenniumBaseUrl } from "../src/millenniumAuth.ts";
import { fetchSalesLista } from "../src/millenniumSales.ts";
import { fetchEventosListaTodos, resolveSalesEventIds } from "../src/millenniumEvents.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  for (const path of [resolve(__dirname, "../.env"), resolve(__dirname, "../../../.env")]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
    if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
      process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
    }
    return;
  }
}

async function main() {
  loadDotEnv();
  const erpSecret = process.env.ERP_SECRET_KEY?.trim();
  if (!erpSecret) throw new Error("ERP_SECRET_KEY missing");

  const sb = createAdminClient();
  const deps = buildDeps(sb, erpSecret);

  const { data: cred } = await sb
    .from("erp_credential")
    .select("id, username, password_ciphertext, tenant_id")
    .eq("status", "VALID")
    .limit(1)
    .maybeSingle();
  if (!cred) throw new Error("no VALID erp_credential");

  const full = await deps.loadCredential(cred.id as string);
  const stores = await deps.listStores(cred.tenant_id as string);
  const store = stores[0];
  if (!store) throw new Error("no stores");

  console.log(`Login ${full.username} · loja ${store.code} (FILIAL ${store.millenniumStoreId})`);
  const login = await loginMillennium(full.username, full.password);
  if (!login.ok) {
    console.error("Login falhou:", login.reason, login.raw.slice(0, 200));
    process.exit(1);
  }

  try {
    const events = await fetchEventosListaTodos({
      session: login.session,
      baseUrl: millenniumBaseUrl(),
    });
    const eventoIds = resolveSalesEventIds(events, store.code);
    console.log(`EVENTOs: ${eventoIds.join(",")}`);

    const ranges: Array<[string, string]> = [
      ["2026-09-21", "2026-09-21"],
      ["2026-09-20", "2026-09-21"],
      ["2026-09-01", "2026-09-21"],
      ["2026-08-01", "2026-09-21"],
    ];

    for (const [from, to] of ranges) {
      const rows = await fetchSalesLista({
        session: login.session,
        storeId: store.id,
        millenniumStoreId: store.millenniumStoreId,
        from,
        to,
        eventoIds,
      });
      const cents = rows.reduce((s, r) => s + r.revenueCents, 0);
      console.log(`  ${from} → ${to}: ${rows.length} linhas · R$ ${(cents / 100).toFixed(2)}`);
    }
  } finally {
    await logoutMillennium(login.session);
    console.log("Logout OK");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
