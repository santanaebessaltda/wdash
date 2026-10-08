/**
 * Acha fonte completa produto  ->  WEPINK/WPINK (sem escopo de estoque por loja).
 *
 *   cd workers/millennium-sync && npx tsx scripts/probe-full-product-brand.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium, millenniumBaseUrl } from "../src/millenniumAuth.ts";
import { listRememberedSessions } from "../src/sessionStore.ts";
import { fetchFilialGeradorMap } from "../src/millenniumBrandReport.ts";
import {
  PRODUCT_DIVISION_CATALOG_GUID,
  DIVISAO_WEPINK,
  DIVISAO_WPINK,
  parseProductDivisionRawData,
} from "../src/millenniumProductDivision.ts";

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

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["value", "Value", "data", "Data", "RAW_DATA", "items", "Items"]) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [];
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
  const base = millenniumBaseUrl();
  if (session) {
    const smoke = await fetch(`${base}/Millennium.EVENTOS.ListaTodos`, {
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
    console.log("sessão 401 — login fresco…");
  }
  const login = await loginMillennium(username, password);
  if (!login.ok) throw new Error(String(login.reason));
  await deps.setStoredSession(credId, login.session);
  return login.session;
}

async function callReport(
  session: string,
  label: string,
  params: Record<string, unknown>,
) {
  const base = millenniumBaseUrl();
  const origin = base.replace(/\/api\/?$/, "");
  const t0 = Date.now();
  const res = await fetch(`${base}/millenium:wtsreports/reports/process`, {
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
    body: JSON.stringify({
      CATALOG_GUID: PRODUCT_DIVISION_CATALOG_GUID,
      PARAMETERS_MODEL: [{ SCRIPT: null, DATASOURCE: null, TABELA_DE_CUSTO: null, ...params }],
      UNIVERSE_NAME: "millenium.mdu",
      REPORT_FORMAT: "raw",
      PARAMETERS_DESCRIPTION: label,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  const ids = json ? parseProductDivisionRawData(json) : [];
  const rows = json ? extractList(json) : [];
  console.log(`\n=== ${label} ===`);
  console.log(`status=${res.status} ms=${ms} rows=${rows.length} productIds=${ids.length}`);
  if (!res.ok) console.log("body:", text.slice(0, 250));
  else if (rows[0] && typeof rows[0] === "object") {
    console.log("keys:", Object.keys(rows[0] as object).sort().join(", "));
    console.log("sample:", JSON.stringify(rows[0]).slice(0, 400));
  }
  return { ids, rows, status: res.status };
}

async function callLookup(session: string, lookup: string, body: Record<string, unknown> = {}) {
  const base = millenniumBaseUrl();
  const url = `${base}/millenium?$lookup=${lookup}`;
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
  const rows = json ? extractList(json) : [];
  console.log(`\n=== lookup ${lookup} ===`);
  console.log(`status=${res.status} ms=${Date.now() - t0} rows=${rows.length} bytes=${text.length}`);
  if (!res.ok) console.log("body:", text.slice(0, 300));
  else if (rows[0] && typeof rows[0] === "object") {
    console.log("keys:", Object.keys(rows[0] as object).sort().join(", "));
    console.log("sample:", JSON.stringify(rows[0]).slice(0, 500));
  } else if (text.length < 400) {
    console.log("body:", text);
  }
  return rows;
}

async function tryProdutoApis(session: string) {
  const base = millenniumBaseUrl();
  const candidates = [
    "millenium.PRODUTO.Lista",
    "millenium.PRODUTO.ListaTodos",
    "MILLENIUM.PRODUTO.produto.Lista",
    "millenium.PRODUTOS.Lista",
  ];
  for (const path of candidates) {
    const t0 = Date.now();
    const res = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "WTS-Session": session,
        "X-HTTP-Method": "GET",
        "X-IdentifierCase": "upper",
        "X-DateFormat": "ISOTZ",
      },
      body: JSON.stringify({}),
    });
    const text = await res.text();
    console.log(`\n=== ${path} === status=${res.status} ms=${Date.now() - t0} bytes=${text.length}`);
    console.log(text.slice(0, 280));
  }
}

async function main() {
  loadDotEnv();
  const secret = process.env.ERP_SECRET_KEY;
  if (!secret) throw new Error("ERP_SECRET_KEY missing");
  const sb = createAdminClient();
  const deps = buildDeps(sb, secret);
  const { data: cred } = await sb
    .from("erp_credential")
    .select("id, username")
    .eq("status", "VALID")
    .limit(1)
    .maybeSingle();
  if (!cred) throw new Error("no cred");
  const full = await deps.loadCredential(cred.id as string);
  const session = await ensureSession(deps, cred.id as string, full.username, full.password);

  const geradorMap = await fetchFilialGeradorMap({ session });
  const g205 = geradorMap.get("00205") ?? 65728;
  console.log(`gerador 00205=${g205} · total geradores=${geradorMap.size}`);

  // A) como hoje: filial + divisao
  const a101 = await callReport(session, `filial=${g205} div=101`, {
    FILIAL_GERADOR_GERADOR: `(${g205})`,
    PRODUTO_DIVISAO_DIVISAO: DIVISAO_WPINK,
  });
  const a102 = await callReport(session, `filial=${g205} div=102`, {
    FILIAL_GERADOR_GERADOR: `(${g205})`,
    PRODUTO_DIVISAO_DIVISAO: DIVISAO_WEPINK,
  });

  // B) sem filial  -  catalogo global?
  const b101 = await callReport(session, `sem filial div=101`, {
    FILIAL_GERADOR_GERADOR: null,
    PRODUTO_DIVISAO_DIVISAO: DIVISAO_WPINK,
  });
  const b102 = await callReport(session, `sem filial div=102`, {
    FILIAL_GERADOR_GERADOR: null,
    PRODUTO_DIVISAO_DIVISAO: DIVISAO_WEPINK,
  });

  // C) filial vazia string / ()
  const c101 = await callReport(session, `filial=() div=101`, {
    FILIAL_GERADOR_GERADOR: "()",
    PRODUTO_DIVISAO_DIVISAO: DIVISAO_WPINK,
  });

  // D) so divisao, sem chave filial
  const d101 = await callReport(session, `só div=101`, {
    PRODUTO_DIVISAO_DIVISAO: DIVISAO_WPINK,
  });

  // E) lookups de cadastro
  await callLookup(session, "PRODUTO.divisao.divisao");
  await callLookup(session, "produto.produto.produto", { _DETAILS: true });
  await callLookup(session, "PRODUTO.produto.produto", {
    PARAM_6: DIVISAO_WPINK, // Divisao nos lookups aninhados do cupom report
  });

  await tryProdutoApis(session);

  console.log("\n========== RESUMO ==========");
  console.log(`A filial+div: WPINK=${a101.ids.length} WEPINK=${a102.ids.length}`);
  console.log(`B null filial: WPINK=${b101.ids.length} WEPINK=${b102.ids.length}`);
  console.log(`C filial=(): WPINK=${c101.ids.length}`);
  console.log(`D só div: WPINK=${d101.ids.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
