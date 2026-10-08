/**
 * Probe: resposta do wtsreports por usuario (acesso ou nao aos personalizados).
 *   cd workers/millennium-sync
 *   $env:PROBE_USER="GERENTE"; $env:PROBE_PASS="..."; npx tsx scripts/probe-report-access.ts
 * Sem PROBE_USER: usa a credencial VALID do banco (sessao salva ou login).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium, logoutMillennium, millenniumBaseUrl } from "../src/millenniumAuth.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  const path = resolve(__dirname, "../.env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
}

async function main() {
  loadDotEnv();
  let session: string | null = null;
  let ownLogin = false;
  const user = process.env.PROBE_USER?.trim();
  const pass = process.env.PROBE_PASS ?? "";
  if (user) {
    const login = await loginMillennium(user, pass);
    if (!login.ok) throw new Error(`login ${user}: ${login.reason} ${login.raw.slice(0, 200)}`);
    session = login.session;
    ownLogin = true;
  } else {
    const sb = createAdminClient();
    const deps = buildDeps(sb, process.env.ERP_SECRET_KEY!);
    const { data: cred } = await sb.from("erp_credential").select("id").eq("status", "VALID").limit(1).maybeSingle();
    if (!cred) throw new Error("no cred");
    session = await deps.getStoredSession(cred.id as string);
    if (!session) {
      const full = await deps.loadCredential(cred.id as string);
      const login = await loginMillennium(full.username, full.password);
      if (!login.ok) throw new Error(`login: ${login.reason}`);
      session = login.session;
      ownLogin = true;
    }
  }
  try {
    await probe(session);
  } finally {
    if (ownLogin) await logoutMillennium(session);
  }
}

async function probe(session: string) {
  const base = millenniumBaseUrl().replace(/\/$/, "");
  const origin = base.replace(/\/api\/?$/, "");
  const headers = {
    Accept: "*/*",
    "Content-Type": "application/json",
    Origin: origin,
    Referer: `${origin}/files/web-apps/millennium.html`,
    "WTS-Session": session,
    "X-DateFormat": "ISOTZ",
    "X-HTTP-Method": "POST",
    "X-IdentifierCase": "upper",
  };
  const cases: Array<[string, string]> = [
    ["categorias", "{2C46ADF5-4B28-4C72-95B5-759C5BA026E4}"],
    ["top produtos", "{E7A5C5C7-950F-425C-8556-803FE15D92E7}"],
  ];
  for (const [label, guid] of cases) {
    for (const day of ["2000-01-01", "2026-09-23"]) {
      const t0 = Date.now();
      const res = await fetch(`${base}/millenium:wtsreports/reports/process`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          CATALOG_GUID: guid,
          PARAMETERS_MODEL: [
            {
              SCRIPT: null,
              DATASOURCE: null,
              DATA_DATA_DATA_INTERVAL: 0,
              DATA_DATA_DATA_START: day,
              DATA_DATA_DATA_END: day,
              FILIAL_GERADOR_GERADOR: null,
            },
          ],
          UNIVERSE_NAME: "millenium.mdu",
          REPORT_FORMAT: "raw",
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const text = await res.text();
      let rows = -1;
      let keys: string[] = [];
      try {
        const o = JSON.parse(text) as Record<string, unknown>;
        keys = Object.keys(o);
        rows = Array.isArray(o.RAW_DATA) ? (o.RAW_DATA as unknown[]).length : -1;
      } catch {
        /* */
      }
      console.log(`\n[${label}] day=${day} status=${res.status} ${Date.now() - t0}ms len=${text.length} rows=${rows} keys=${keys.join(",")}`);
      console.log(text.slice(0, 300));
    }
  }

  // Catalogo de relatorios visivel ao usuario (se a API expuser).
  for (const path of ["millenium:wtsreports/reports/list", "millenium:wtsreports/catalog/list"]) {
    const res = await fetch(`${base}/${path}`, { method: "POST", headers, body: "{}", signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    console.log(`\n[${path}] status=${res.status} len=${text.length}`);
    console.log(text.slice(0, 300));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
