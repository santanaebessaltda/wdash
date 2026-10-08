/**
 * Probe: C5BBF0E2 filtrado por tipo + dump completo do lookup produto.
 *   cd workers/millennium-sync && npx tsx scripts/probe-categoria-agg.ts
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium, millenniumBaseUrl } from "../src/millenniumAuth.ts";
import { listRememberedSessions } from "../src/sessionStore.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_GUID = "{C5BBF0E2-23D5-4493-903F-F529968AC0F2}";

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

function reportHeaders(session: string, base: string): Record<string, string> {
  const origin = base.replace(/\/api\/?$/, "");
  return {
    Accept: "*/*",
    "Content-Type": "application/json",
    Origin: origin,
    Referer: `${origin}/files/web-apps/millennium.html`,
    "WTS-Session": session,
    "X-DateFormat": "ISOTZ",
    "X-HTTP-Method": "POST",
    "X-IdentifierCase": "upper",
  };
}

function extractRaw(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["RAW_DATA", "value", "Value", "data", "Data"]) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [];
}

async function main() {
  loadDotEnv();
  const secret = process.env.ERP_SECRET_KEY!;
  const sb = createAdminClient();
  const deps = buildDeps(sb, secret);
  const { data: cred } = await sb
    .from("erp_credential")
    .select("id, username, tenant_id")
    .eq("status", "VALID")
    .limit(1)
    .maybeSingle();
  if (!cred) throw new Error("no cred");
  const full = await deps.loadCredential(cred.id as string);
  let session =
    (await deps.getStoredSession(cred.id as string)) ??
    listRememberedSessions().find((s) => s.credentialId === (cred.id as string))?.session ??
    null;
  if (!session) {
    const login = await loginMillennium(full.username, full.password);
    if (!login.ok) throw new Error(login.reason);
    session = login.session;
  }
  const base = millenniumBaseUrl().replace(/\/$/, "");
  const geradorId = 126;
  const day = "2026-09-22";

  // A) dump completo 1 produto via lookup com varios paths
  for (const url of [
    `${base}/millenium/produto.produto.produto(407)`,
    `${base}/millenium?$lookup=produto.produto.produto&PRODUTO_PRODUTO_PRODUTO=407&$top=1&$select=*`,
    `${base}/api/millenium?$lookup=produto.produto.produto&PRODUTO=407&$top=1`,
  ]) {
    try {
      const res = await fetch(url.replace("/api/api", "/api"), {
        method: "POST",
        headers: {
          Accept: "*/*",
          "Content-Type": "application/json",
          "WTS-Session": session,
          "X-DateFormat": "ISOTZ",
          "X-HTTP-Method": "GET",
          "X-IdentifierCase": "upper",
        },
        body: JSON.stringify({ _DETAILS: true }),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      console.log(`\n=== product detail ${res.status} ${url.slice(-60)} ===`);
      console.log(text.slice(0, 900));
    } catch (e) {
      console.log("fail", e instanceof Error ? e.message : e);
    }
  }

  // B) report filtrado por PERFUMARIA (13) vs BODY SPLASH (14)
  for (const tipo of [13, 14, null] as const) {
    const body = {
      CATALOG_GUID,
      PARAMETERS_MODEL: [
        {
          SCRIPT: null,
          DATASOURCE: null,
          DATA_DATA_DATA_INTERVAL: 0,
          DATA_DATA_DATA_START: day,
          DATA_DATA_DATA_END: day,
          PRODUTO_PRODUTO_PRODUTO: null,
          FUNCIONARIO_GERADOR_GERADOR: null,
          PRODUTO_DIVISAO_DIVISAO: null,
          FILIAL_GERADOR_GERADOR: geradorId,
          PRODUTO_TIPO_TIPO: tipo,
        },
      ],
      UNIVERSE_NAME: "millenium.mdu",
      REPORT_FORMAT: "raw",
      PARAMETERS_DESCRIPTION: `tipo=${tipo}`,
    };
    const res = await fetch(`${base}/millenium:wtsreports/reports/process`, {
      method: "POST",
      headers: reportHeaders(session, base),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const text = await res.text();
    let rows: unknown[] = [];
    try {
      rows = extractRaw(JSON.parse(text));
    } catch {
      /* */
    }
    let receita = 0;
    let qty = 0;
    const codes = new Set<string>();
    for (const r of rows) {
      const o = r as Record<string, unknown>;
      receita += Number(o.F_366619977 ?? 0);
      qty += Number(o.F_3887607047 ?? 0);
      codes.add(String(o.PRODUTO_PRODUTO_COD_PRODUTO ?? ""));
    }
    console.log(
      `\ntipo=${tipo} status=${res.status} rows=${rows.length} receita=${receita.toFixed(2)} qty=${qty} skus=${codes.size}`,
    );
    if (rows[0]) {
      const o = rows[0] as Record<string, unknown>;
      console.log("  first", o.PRODUTO_PRODUTO_COD_PRODUTO, o.PRODUTO_PRODUTO_DESCRICAO1, o.F_366619977);
    }
  }

  // C) METADATA groups
  const res = await fetch(`${base}/millenium:wtsreports/reports/process`, {
    method: "POST",
    headers: reportHeaders(session, base),
    body: JSON.stringify({
      CATALOG_GUID,
      PARAMETERS_MODEL: [
        {
          SCRIPT: null,
          DATASOURCE: null,
          DATA_DATA_DATA_INTERVAL: 0,
          DATA_DATA_DATA_START: day,
          DATA_DATA_DATA_END: day,
          FILIAL_GERADOR_GERADOR: geradorId,
          PRODUTO_TIPO_TIPO: null,
          PRODUTO_PRODUTO_PRODUTO: null,
          FUNCIONARIO_GERADOR_GERADOR: null,
          PRODUTO_DIVISAO_DIVISAO: null,
        },
      ],
      UNIVERSE_NAME: "millenium.mdu",
      REPORT_FORMAT: "raw",
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
  const meta = parsed["$RAW_DATA.METADATA"] ?? parsed["$RAW_DATA.METADATA.GROUPS"];
  writeFileSync(
    resolve(__dirname, "_tmp-categoria-meta.json"),
    JSON.stringify(
      {
        groups: parsed["$RAW_DATA.METADATA.GROUPS"],
        metaSample: Array.isArray(meta) ? meta.slice(0, 30) : meta,
      },
      null,
      2,
    ),
  );
  console.log("\nwrote _tmp-categoria-meta.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
