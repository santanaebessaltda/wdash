/**
 * Probe RELATORIOMARGEM  -  campos de custo (CUSTO_FRANQUIAS x QTDE).
 *   cd workers/millennium-sync && npx tsx scripts/probe-margin-report.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium, millenniumBaseUrl } from "../src/millenniumAuth.ts";
import { milleniumDataRange } from "../src/millenniumSales.ts";
import { listRememberedSessions } from "../src/sessionStore.ts";

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

function sampleKeys(rows: unknown[]): string[] {
  const keys = new Set<string>();
  for (const r of rows.slice(0, 5)) {
    if (r && typeof r === "object") {
      for (const k of Object.keys(r as object)) keys.add(k);
    }
  }
  return [...keys].sort();
}

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["value", "Value", "data", "Data", "RAW_DATA", "items", "Items"]) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [];
}

async function tryPath(
  session: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; rows: unknown[]; text: string }> {
  const base = millenniumBaseUrl().replace(/\/$/, "");
  const res = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      "WTS-Session": session,
      "X-DateFormat": "ISOTZ",
      "X-HTTP-Method": "GET",
      "X-IdentifierCase": "upper",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  const rows = extractList(parsed);
  return { ok: res.ok, status: res.status, rows, text: text.slice(0, 400) };
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
  const store = stores.find((s) => s.code === "00205") ?? stores[0]!;

  let session =
    (await deps.getStoredSession(cred.id as string)) ??
    listRememberedSessions().find((s) => s.credentialId === (cred.id as string))?.session ??
    null;
  if (!session) {
    const login = await loginMillennium(full.username, full.password);
    if (!login.ok) throw new Error(login.reason);
    session = login.session;
  }

  const day = "2026-09-22";
  const { datai, dataf } = milleniumDataRange(day, day);
  console.log(`Loja ${store.code} FILIAL=${store.millenniumStoreId} ${day}`);
  console.log(`DATAI=${datai} DATAF=${dataf}`);

  const paths = [
    "MILLENIUM!FRANQUIAS.RELATORIOS.RELATORIOMARGEM",
    "millenium!FRANQUIAS.RELATORIOS.RELATORIOMARGEM",
    "MILLENIUM.FRANQUIAS.RELATORIOS.RELATORIOMARGEM",
  ];

  const bodies: Array<{ label: string; body: Record<string, unknown> }> = [
    {
      label: "ui-shape",
      body: {
        FILIAL: store.millenniumStoreId,
        DESC: null,
        DATAI: datai,
        DATAF: dataf,
        TIPO: null,
      },
    },
  ];

  for (const path of paths) {
    for (const { label, body } of bodies) {
      process.stdout.write(`\n=== ${path} (${label}) ===\n`);
      try {
        const r = await tryPath(session, path, body);
        console.log(`status=${r.status} ok=${r.ok} rows=${r.rows.length}`);
        if (r.rows.length > 0) {
          console.log("keys:", sampleKeys(r.rows).join(", "));
          console.log("sample:", JSON.stringify(r.rows[0]).slice(0, 500));
          // stop early on first hit
          process.exit(0);
        } else if (!r.ok) {
          console.log("body:", r.text);
        } else {
          console.log("empty ok — body:", r.text.slice(0, 200));
        }
      } catch (e) {
        console.log("err:", e instanceof Error ? e.message : e);
      }
    }
  }
  console.log("\nNenhum path devolveu linhas. Tentar wtsreports / outro nome.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
