/**
 * Backfill WEPINK/WPINK em sales_day_agg via wtsreports (nao mexe no ALL).
 * Uso: npx tsx scripts/backfill-brand-split.ts [from] [to]
 * Default: min(day) -> max(day) de sales_day_agg ALL do tenant.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient } from "../src/deps.ts";
import {
  brandReportToDayAggs,
  fetchBrandRevenueReport,
  fetchFilialGeradorMap,
} from "../src/millenniumBrandReport.ts";

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
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
    if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
      process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
    }
  }
}

async function main() {
  loadDotEnv();
  const fromArg = process.argv[2];
  const toArg = process.argv[3];
  const sb = createAdminClient();

  const { data: cred } = await sb
    .from("erp_credential")
    .select("id, tenant_id, millennium_session")
    .eq("status", "VALID")
    .not("millennium_session", "is", null)
    .limit(1)
    .maybeSingle();
  if (!cred?.millennium_session) throw new Error("no stored session");
  const session = String(cred.millennium_session);
  const tenantId = String(cred.tenant_id);

  const { data: stores, error: se } = await sb
    .from("store")
    .select("id, code, trade_name, name")
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (se) throw se;

  let from = fromArg;
  let to = toArg;
  if (!from || !to) {
    const { data: bounds } = await sb
      .from("sales_day_agg")
      .select("day")
      .eq("tenant_id", tenantId)
      .eq("brand", "ALL")
      .order("day", { ascending: true })
      .limit(1);
    const { data: boundsHi } = await sb
      .from("sales_day_agg")
      .select("day")
      .eq("tenant_id", tenantId)
      .eq("brand", "ALL")
      .order("day", { ascending: false })
      .limit(1);
    from = from || String(bounds?.[0]?.day ?? "").slice(0, 10);
    to = to || String(boundsHi?.[0]?.day ?? "").slice(0, 10);
  }
  if (!from || !to) throw new Error("sem range (passe from to ou tenha ALL no banco)");
  console.log(`backfill brand ${from} → ${to} · ${(stores ?? []).length} loja(s)`);

  const geradorMap = await fetchFilialGeradorMap({ session });
  console.log("geradores", Object.fromEntries(geradorMap));

  for (const store of stores ?? []) {
    const code = String(store.code || "");
    const g = geradorMap.get(code);
    if (g == null) {
      console.warn(`  skip ${code} — sem GERADOR`);
      continue;
    }
    const rows = await fetchBrandRevenueReport({
      session,
      geradorIds: [g],
      from,
      to,
    });
    const aggs = brandReportToDayAggs(rows, { tenantId, storeId: String(store.id) });
    if (aggs.length === 0) {
      console.log(`  ${code} · 0 linhas`);
      continue;
    }
    const payload = aggs.map((r) => ({
      tenant_id: r.tenantId,
      store_id: r.storeId,
      day: r.day,
      brand: r.brand,
      revenue_cents: r.revenueCents,
      sales_count: r.salesCount,
      item_count: r.itemCount,
    }));
    const { error } = await sb.from("sales_day_agg").upsert(payload, {
      onConflict: "tenant_id,store_id,day,brand",
    });
    if (error) throw error;
    const wepink = aggs.filter((a) => a.brand === "WEPINK").length;
    const wpink = aggs.filter((a) => a.brand === "WPINK").length;
    console.log(
      `  ${code} · ${aggs.length} dia×marca (WEPINK ${wepink} · WPINK ${wpink}) · ${store.trade_name || store.name}`,
    );
  }
  console.log("ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
