/**
 * Regrava CMV (RELATORIOMARGEM) com DATAF inclusivo  -  corrige dias gravados
 * com o bound exclusivo da Lista (+1 dia  2x).
 *
 *   cd workers/millennium-sync && npx tsx scripts/resync-cmv.ts [storeCode]
 *   # default: todas as lojas do tenant da credencial VALID
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium } from "../src/millenniumAuth.ts";
import { cmvCentsFromMargemLines } from "../src/millenniumMargem.ts";
import { listRememberedSessions } from "../src/sessionStore.ts";
import { addDaysYmd } from "../src/millenniumSales.ts";

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
  }
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  let d = from;
  while (d <= to) {
    out.push(d);
    d = addDaysYmd(d, 1);
  }
  return out;
}

async function main() {
  loadDotEnv();
  const filterCode = process.argv[2]?.replace(/^0+/, "") ?? null;
  const secret = process.env.ERP_SECRET_KEY!;
  const sb = createAdminClient();
  const deps = buildDeps(sb, secret);

  const { data: cred } = await sb
    .from("erp_credential")
    .select("id, tenant_id")
    .eq("status", "VALID")
    .limit(1)
    .maybeSingle();
  if (!cred) throw new Error("no VALID erp_credential");

  let session =
    (await deps.getStoredSession(cred.id as string)) ??
    listRememberedSessions().find((s) => s.credentialId === (cred.id as string))?.session ??
    null;
  if (!session) {
    const full = await deps.loadCredential(cred.id as string);
    const login = await loginMillennium(full.username, full.password);
    if (!login.ok) throw new Error(login.reason);
    session = login.session;
  }

  const stores = await deps.listStores(cred.tenant_id as string);
  const targets = filterCode
    ? stores.filter((s) => s.code.replace(/^0+/, "") === filterCode || s.code === process.argv[2])
    : stores;
  if (targets.length === 0) throw new Error(`no store matching ${process.argv[2]}`);

  // Janela: dias que ja tem linha ALL (ou default mes atual  ->  hoje)
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const defaultTo = `${y}-${m}-${day}`;
  const defaultFrom = `${y}-${m}-01`;

  for (const store of targets) {
    const { data: existing } = await sb
      .from("sales_day_agg")
      .select("day")
      .eq("store_id", store.id)
      .eq("brand", "ALL")
      .gt("cmv_cents", 0)
      .order("day");
    const daysWithCmv = [...new Set((existing ?? []).map((r) => r.day as string))].sort();
    const from = daysWithCmv[0] ?? defaultFrom;
    const to = daysWithCmv[daysWithCmv.length - 1] ?? defaultTo;
    const days = eachDay(from, to);
    console.log(`[${store.code}] CMV resync ${from}→${to} (${days.length} dias)`);

    const patches: Array<{ tenantId: string; storeId: string; day: string; cmvCents: number }> = [];
    let ok = 0;
    let fail = 0;
    for (const d of days) {
      try {
        const lines = await deps.fetchRelatorioMargem({
          session,
          millenniumStoreId: store.millenniumStoreId,
          from: d,
          to: d,
        });
        patches.push({
          tenantId: cred.tenant_id as string,
          storeId: store.id,
          day: d,
          cmvCents: cmvCentsFromMargemLines(lines),
        });
        ok += 1;
      } catch (e) {
        fail += 1;
        console.warn(`  ${d}:`, e instanceof Error ? e.message : e);
      }
    }
    if (patches.length) await deps.patchDayCmv(patches);
    const total = patches.reduce((s, p) => s + p.cmvCents, 0);
    console.log(
      `  ok=${ok} fail=${fail} Σ CMV=${(total / 100).toFixed(2)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
