/**
 * Regrava WEPINK/WPINK a partir do relatorio oficial (sem re-SEED).
 *   cd workers/millennium-sync && npx tsx scripts/rebrand-from-report.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium, millenniumBaseUrl } from "../src/millenniumAuth.ts";
import { listRememberedSessions } from "../src/sessionStore.ts";
import {
  brandReportToDayAggs,
  fetchBrandRevenueReport,
  fetchFilialGeradorMap,
} from "../src/millenniumBrandReport.ts";
import { seedWindow, ymdInTz } from "../src/runSyncJob.ts";

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

async function ensureSession(
  deps: ReturnType<typeof buildDeps>,
  credId: string,
  username: string,
  password: string,
): Promise<string> {
  let session =
    (await deps.getStoredSession(credId)) ??
    listRememberedSessions().find((s) => s.credentialId === credId)?.session ??
    null;
  if (session) {
    const smoke = await fetch(`${millenniumBaseUrl()}/Millennium.EVENTOS.ListaTodos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "WTS-Session": session,
        "X-HTTP-Method": "GET",
        "X-IdentifierCase": "upper",
      },
      body: "{}",
    });
    if (smoke.status !== 401) return session;
  }
  const login = await loginMillennium(username, password);
  if (!login.ok) throw new Error(`${login.reason}: ${login.raw}`);
  await deps.setStoredSession(credId, login.session);
  return login.session;
}

async function main() {
  loadDotEnv();
  const secret = process.env.ERP_SECRET_KEY!;
  const sb = createAdminClient();
  const deps = buildDeps(sb, secret);
  const { data: cred } = await sb
    .from("erp_credential")
    .select("id, tenant_id")
    .eq("status", "VALID")
    .limit(1)
    .maybeSingle();
  if (!cred) throw new Error("no cred");
  const full = await deps.loadCredential(cred.id as string);
  const stores = await deps.listStores(cred.tenant_id as string);
  const session = await ensureSession(deps, cred.id as string, full.username, full.password);
  const geradorMap = await fetchFilialGeradorMap({ session });

  const tz = stores[0]?.timezone ?? "America/Sao_Paulo";
  const today = ymdInTz(new Date(), tz);
  const { from, to } = seedWindow(today);
  console.log(`rebrand ${from}→${to} · ${stores.length} loja(s)`);

  // limpa so marcas (ALL fica)
  const { error: delErr, count } = await sb
    .from("sales_day_agg")
    .delete({ count: "exact" })
    .eq("tenant_id", cred.tenant_id)
    .in("brand", ["WEPINK", "WPINK"]);
  if (delErr) console.warn("delete brands:", delErr.message);
  else console.log("deleted brand day rows:", count ?? "?");
  await sb
    .from("sales_hour_agg")
    .delete()
    .eq("tenant_id", cred.tenant_id)
    .in("brand", ["WEPINK", "WPINK"]);

  for (const store of stores) {
    const geradorId = geradorMap.get(store.code);
    if (geradorId == null) {
      console.warn(`  [${store.code}] sem gerador — skip`);
      continue;
    }
    const t0 = Date.now();
    const rows = await fetchBrandRevenueReport({
      session,
      geradorIds: [geradorId],
      from,
      to,
    });
    const aggs = brandReportToDayAggs(rows, {
      tenantId: cred.tenant_id as string,
      storeId: store.id,
    });
    await deps.upsertDayAggs(aggs);
    let we = 0;
    let wp = 0;
    for (const a of aggs) {
      if (a.brand === "WEPINK") we += a.revenueCents;
      if (a.brand === "WPINK") wp += a.revenueCents;
    }
    console.log(
      `  [${store.code}] ${aggs.length} rows · WE R$ ${(we / 100).toFixed(2)} · WP R$ ${(wp / 100).toFixed(2)} · ${Date.now() - t0}ms`,
    );
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
