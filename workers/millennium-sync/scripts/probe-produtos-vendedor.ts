/**
 * Probe: WEPINK - PRODUTOS VENDIDOS POR VENDEDOR (C5BBF0E2)
 * + lookup produto.tipo.tipo
 *
 *   cd workers/millennium-sync && npx tsx scripts/probe-produtos-vendedor.ts
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium, millenniumBaseUrl } from "../src/millenniumAuth.ts";
import { fetchFilialGeradorMap } from "../src/millenniumBrandReport.ts";
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
  for (const k of ["RAW_DATA", "value", "Value", "data", "Data", "items", "Items"]) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [];
}

function sampleKeys(rows: unknown[]): string[] {
  const keys = new Set<string>();
  for (const r of rows.slice(0, 8)) {
    if (r && typeof r === "object") for (const k of Object.keys(r as object)) keys.add(k);
  }
  return [...keys].sort();
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
  const stores = await deps.listStores(cred.tenant_id as string);
  const store = stores.find((s) => s.code === "00010" || s.code === "10") ?? stores.find((s) => /santana/i.test(s.name)) ?? stores[0]!;

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
  console.log(`session ok · loja ${store.code} mill=${store.millenniumStoreId} · ${store.name}`);

  // 1) tipos  -  curl usa GET+body; Node nao aceita  ->  POST + X-HTTP-Method:GET
  {
    const res = await fetch(`${base}/millenium?$lookup=produto.tipo.tipo&$top=501`, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        "WTS-Session": session,
        "X-DateFormat": "ISOTZ",
        "X-HTTP-Method": "GET",
        "X-IdentifierCase": "upper",
      },
      body: JSON.stringify({
        SCRIPT: null,
        DATASOURCE: null,
        PRODUTO_TIPO_TIPO: null,
        _DETAILS: true,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    console.log(`\n=== produto.tipo.tipo → ${res.status} ===`);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.log(text.slice(0, 400));
    }
    const rows = extractRaw(parsed);
    console.log("count", rows.length);
    console.log(
      rows
        .slice(0, 25)
        .map((r) => {
          const o = r as Record<string, unknown>;
          return `${o.PRODUTO_TIPO_TIPO}=${o.PRODUTO_TIPO_DESCRICAO}`;
        })
        .join(" | "),
    );
  }

  // 2) gerador  -  lookup pode 401; curl do gestor usou 126 p/ Santana
  let geradorId = 126;
  try {
    const geradorMap = await fetchFilialGeradorMap(session);
    geradorId =
      geradorMap.get(store.code) ??
      geradorMap.get(store.code.replace(/^0+/, "")) ??
      geradorId;
    console.log(`\ngerador map ok · ${store.code} → ${geradorId}`);
  } catch (e) {
    console.warn(`\ngerador map falhou (${e instanceof Error ? e.message : e}) — fallback ${geradorId}`);
  }

  // 3) report C5BBF0E2  -  variantes de data
  const day = "2026-09-22";
  const variants: Array<{ label: string; start: string; end: string }> = [
    { label: "ymd", start: day, end: day },
    { label: "iso-T04", start: `${day}T04:00:00.000Z`, end: `${day}T04:00:00.000Z` },
    { label: "iso-T00", start: `${day}T00:00:00.000Z`, end: `${day}T00:00:00.000Z` },
    { label: "br", start: "22/09/2026", end: "22/09/2026" },
  ];

  for (const v of variants) {
    const body = {
      CATALOG_GUID,
      PARAMETERS_MODEL: [
        {
          SCRIPT: null,
          DATASOURCE: null,
          DATA_DATA_DATA_INTERVAL: 0,
          DATA_DATA_DATA_START: v.start,
          DATA_DATA_DATA_END: v.end,
          PRODUTO_PRODUTO_PRODUTO: null,
          FUNCIONARIO_GERADOR_GERADOR: null,
          PRODUTO_DIVISAO_DIVISAO: null,
          FILIAL_GERADOR_GERADOR: geradorId,
          PRODUTO_TIPO_TIPO: null,
        },
      ],
      UNIVERSE_NAME: "millenium.mdu",
      REPORT_FORMAT: "raw",
      PARAMETERS_DESCRIPTION: `Filial=${geradorId} Data=${day}`,
    };

    console.log(`\n=== wtsreports C5BBF0E2 ${v.label} ===`);
    const res = await fetch(`${base}/millenium:wtsreports/reports/process`, {
      method: "POST",
      headers: reportHeaders(session, base),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const text = await res.text();
    console.log("status", res.status, "bytes", text.length);
    if (!res.ok) {
      console.log(text.slice(0, 280));
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.log("JSON inválido", text.slice(0, 400));
      continue;
    }
    const root = parsed as Record<string, unknown>;
    console.log("top keys", Object.keys(root).sort().join(", "));
    const rows = extractRaw(parsed);
    console.log("rows", rows.length);
    console.log("keys", sampleKeys(rows).join(", "));
    console.log("sample[0]", JSON.stringify(rows[0], null, 2)?.slice(0, 2000));
    console.log("sample[1]", JSON.stringify(rows[1], null, 2)?.slice(0, 1200));

    const outPath = resolve(__dirname, "_tmp-produtos-vendedor.json");
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          variant: v.label,
          status: res.status,
          topKeys: Object.keys(root),
          rowCount: rows.length,
          keys: sampleKeys(rows),
          sample: rows.slice(0, 8),
        },
        null,
        2,
      ),
    );
    console.log("wrote", outPath);
    break; // first success
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
