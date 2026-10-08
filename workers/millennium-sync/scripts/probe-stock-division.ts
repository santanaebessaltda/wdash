/**
 * Probe ESTOQUEEMCOMPRA vs wtsreports {9701602B} (mapa produto -> divisao).
 *   cd workers/millennium-sync && npx tsx scripts/probe-stock-division.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium, millenniumBaseUrl } from "../src/millenniumAuth.ts";
import { listRememberedSessions } from "../src/sessionStore.ts";
import { fetchFilialGeradorMap } from "../src/millenniumBrandReport.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STOCK_DIV_GUID = "{9701602B-B363-4770-989C-8C4459B7E105}";

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

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["value", "Value", "data", "Data", "items", "Items", "RAW_DATA"]) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  if (typeof o.value === "string") {
    try {
      const inner = JSON.parse(o.value);
      if (Array.isArray(inner)) return inner;
    } catch {
      /* ignore */
    }
  }
  return [];
}

function summarizeRows(label: string, rows: unknown[]) {
  console.log(`${label}: rows=${rows.length}`);
  if (rows[0] && typeof rows[0] === "object") {
    const keys = Object.keys(rows[0] as object).sort();
    console.log("keys:", keys.join(", "));
    console.log("sample[0]:", JSON.stringify(rows[0], null, 2).slice(0, 1600));
  }
  const wp024 = rows.find((x) => x && typeof x === "object" && JSON.stringify(x).includes("WP024"));
  if (wp024) console.log("WP024:", JSON.stringify(wp024, null, 2).slice(0, 900));
  else console.log("WP024 não achado");
  if (rows[0] && typeof rows[0] === "object") {
    const o = rows[0] as Record<string, unknown>;
    const prodKeys = Object.keys(o).filter((k) => /prod|cod|id/i.test(k));
    console.log("prod-ish keys:", prodKeys.map((k) => `${k}=${JSON.stringify(o[k])}`).join(" · "));
  }
}

async function callEstoque(session: string, body: Record<string, unknown>) {
  const url = `${millenniumBaseUrl()}/MILLENIUM!FRANQUIAS.RELATORIOS.ESTOQUEEMCOMPRA`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "WTS-Session": session,
      "X-HTTP-Method": "GET",
      "X-IdentifierCase": "upper",
      "X-DateFormat": "ISOTZ",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, ms: Date.now() - t0, bytes: text.length, json, preview: text.slice(0, 400) };
}

async function callStockDivReport(session: string, geradorId: number, divisao: number) {
  const base = millenniumBaseUrl();
  const origin = base.replace(/\/api\/?$/, "");
  const url = `${base}/millenium:wtsreports/reports/process`;
  const body = {
    CATALOG_GUID: STOCK_DIV_GUID,
    PARAMETERS_MODEL: [
      {
        SCRIPT: null,
        DATASOURCE: null,
        TABELA_DE_CUSTO: null,
        FILIAL_GERADOR_GERADOR: `(${geradorId})`,
        PRODUTO_DIVISAO_DIVISAO: divisao,
      },
    ],
    UNIVERSE_NAME: "millenium.mdu",
    REPORT_FORMAT: "raw",
    PARAMETERS_DESCRIPTION: `Filial=(${geradorId}) Divisao=${divisao}`,
  };
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      Origin: origin,
      Referer: `${origin}/files/web-apps/millennium.html`,
      "WTS-Session": session,
      "X-DateFormat": "ISOTZ",
      "X-HTTP-Method": "POST",
      "X-IdentifierCase": "upper",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, ms: Date.now() - t0, bytes: text.length, json, preview: text.slice(0, 500) };
}

async function main() {
  loadDotEnv();
  const secret = process.env.ERP_SECRET_KEY;
  if (!secret) throw new Error("ERP_SECRET_KEY missing");
  const sb = createAdminClient();
  const deps = buildDeps(sb, secret);
  const { data: cred } = await sb
    .from("erp_credential")
    .select("id, username, tenant_id")
    .eq("status", "VALID")
    .limit(1)
    .maybeSingle();
  if (!cred) throw new Error("no VALID erp_credential");
  const full = await deps.loadCredential(cred.id as string);
  const stores = await deps.listStores(cred.tenant_id as string);
  console.log(`cred ${full.username} · lojas: ${stores.map((s) => `${s.code}=${s.millenniumStoreId}`).join(", ")}`);

  let session =
    (await deps.getStoredSession(cred.id as string)) ??
    listRememberedSessions().find((s) => s.credentialId === (cred.id as string))?.session ??
    null;
  let ownedLogin = false;
  if (!session) {
    const login = await loginMillennium(full.username, full.password);
    if (!login.ok) {
      console.error("Login:", login.reason, login.raw?.slice(0, 200));
      process.exit(1);
    }
    session = login.session;
    ownedLogin = true;
    console.log("session: login novo");
  } else {
    console.log("session: reusando token salvo");
  }

  try {
    console.log("\n========== A) ESTOQUEEMCOMPRA TIPO=101 FILIAL=40261 ==========");
    const estoque = await callEstoque(session, {
      FILIAL: 40261,
      DESC: null,
      TIPO: 101,
      DATAI: null,
      DATAF: null,
    });
    console.log(`status=${estoque.status} ms=${estoque.ms} bytes=${estoque.bytes}`);
    if (estoque.json) summarizeRows("ESTOQUE", extractList(estoque.json));
    else console.log(estoque.preview);

    console.log("\n========== B) wtsreports {9701602B} divisao=101 ==========");
    const geradorMap = await fetchFilialGeradorMap({ session });
    const g00205 = geradorMap.get("00205") ?? 65728;
    console.log(`gerador 00205=${g00205} (map size ${geradorMap.size})`);
    const report = await callStockDivReport(session, g00205, 101);
    console.log(`status=${report.status} ms=${report.ms} bytes=${report.bytes}`);
    if (report.json) {
      const top = report.json as Record<string, unknown>;
      console.log("top keys:", Object.keys(top).join(", "));
      summarizeRows("REPORT", extractList(report.json));
    } else {
      console.log(report.preview);
    }
  } finally {
    if (ownedLogin) {
      const { logoutMillennium } = await import("../src/millenniumAuth.ts");
      await logoutMillennium(session);
      console.log("\nlogout ok");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
