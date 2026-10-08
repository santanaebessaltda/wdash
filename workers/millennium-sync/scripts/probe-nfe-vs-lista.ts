/**
 * Perf: NFE.Lista_Status vs VENDAS.Lista vs ListaTodos
 * + amostra "Produtos por Cupom e Vendedor" (CATALOG 52DE7BBC...).
 *
 *   cd workers/millennium-sync && npx tsx scripts/probe-nfe-vs-lista.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium, millenniumBaseUrl } from "../src/millenniumAuth.ts";
import { listRememberedSessions } from "../src/sessionStore.ts";
import { milleniumDataRange } from "../src/millenniumSales.ts";
import { fetchEventosListaTodos, resolveSalesEventIds } from "../src/millenniumEvents.ts";
import { fetchFilialGeradorMap } from "../src/millenniumBrandReport.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** GUID do print  -  se falhar, tentamos variantes (curl veio com possivel typo). */
const CUPON_REPORT_GUIDS = [
  "{52DE7BBC-78D4-7765-A232-A5AAD2840284}",
  "{52DE7BBC-78D4-4765-A232-A5AAD2840284}",
  "{52DE7BBC-78D4-7765-A232-A5MAD2840284}",
];

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

async function timedPost(
  label: string,
  url: string,
  session: string,
  body: unknown,
  methodHint: "GET" | "POST",
) {
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      "WTS-Session": session,
      "X-DateFormat": "ISOTZ",
      "X-HTTP-Method": methodHint,
      "X-IdentifierCase": "upper",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  const rows = json ? extractList(json) : [];
  const sample = rows[0] && typeof rows[0] === "object" ? (rows[0] as object) : null;
  console.log(
    `\n=== ${label} ===\nstatus=${res.status} ms=${ms} bytes=${text.length} rows=${rows.length}`,
  );
  if (sample) {
    console.log("keys:", Object.keys(sample).sort().join(", "));
    console.log("sample[0]:", JSON.stringify(sample).slice(0, 500));
  } else if (!res.ok) {
    console.log("body:", text.slice(0, 300));
  }
  return { ms, status: res.status, rows, bytes: text.length, json };
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
  if (!cred) throw new Error("no cred");
  const full = await deps.loadCredential(cred.id as string);
  const stores = await deps.listStores(cred.tenant_id as string);
  const store = stores.find((s) => s.code === "00205")!;

  // Sempre login fresco  -  token do browser/store costuma expirar entre probes.
  let session: string | null =
    (await deps.getStoredSession(cred.id as string)) ??
    listRememberedSessions().find((s) => s.credentialId === (cred.id as string))?.session ??
    null;

  async function ensureSession(): Promise<string> {
    if (session) {
      // smoke: events com token antigo falha com 401  ->  relogin
      try {
        await fetchEventosListaTodos({ session, baseUrl: millenniumBaseUrl() });
        return session;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("401")) throw e;
        console.log("sessão 401 — fazendo login fresco…");
        session = null;
      }
    }
    const login = await loginMillennium(full.username, full.password);
    if (!login.ok) throw new Error(String(login.reason));
    session = login.session;
    await deps.setStoredSession(cred.id as string, session);
    return session;
  }
  session = await ensureSession();

  const base = millenniumBaseUrl();
  const events = await fetchEventosListaTodos({ session, baseUrl: base });
  const eventoIds = resolveSalesEventIds(events, store.code);
  const eventoStr = `(${eventoIds.join(",")})`;
  const from = "2026-09-01";
  const to = "2026-09-22";
  const { datai, dataf } = milleniumDataRange(from, to);

  console.log(`loja ${store.code} FILIAL=${store.millenniumStoreId} EVENTOs ${eventoStr}`);
  console.log(`período ${from}→${to} (DATAI=${datai} DATAF=${dataf})`);

  // 1) Status NFe
  const nfe = await timedPost(
    "NFE.Lista_Status (Status de NFe)",
    `${base}/MILLENIUM.NFE.Lista_Status`,
    session,
    {
      STATUS: "2",
      DATA: datai,
      FILIAL: store.millenniumStoreId,
      DATAF: dataf,
      TIPO_ORIGEM: null,
      RELACAO_ES: null,
      NAO_AGRUPAR_CFOP: null,
      MODELO_NFE: "-1",
      EVENTO: eventoStr,
      NOTA: null,
      CFOP: null,
      PEDIDOV: null,
      PREFATURAMENTO: null,
      COD_VOLUME: null,
      CANCELADA: false,
      INUTILIZ_CANCEL: false,
      CPF_PAULISTA: null,
    },
    "GET",
  );

  // 2) VENDAS.Lista (o que o worker usa hoje)
  const listaBody = {
    EVENTO: eventoStr,
    DATAI: datai,
    DATAF: dataf,
    FILIAL: store.millenniumStoreId,
    DOCUMENTO: null,
    CANCELADA: false,
    GERADOR: "C",
    COD: null,
    ORDEM: 0,
    CONTA: null,
    NOTAI: null,
    NOTAF: null,
    TIPO_PAGTO: null,
    CONDICAO: null,
    EMBARQUE: null,
    N_DOCEXTERNO: null,
    VENDEDOR: null,
    PEDIDOREF: null,
    FILIAL_DESTINO: null,
    PRODUCAO: null,
    CONFERIDO: null,
    TIPO_PEDIDO: null,
    COD_PEDIDO: null,
    PEDIDO: false,
    GRUPO_LOJA: null,
    NUMERO_CARTAO: null,
    GERADOR_COM: "V",
    COD_COM: null,
    LIM_CRED_MOV_EXCEDEU: null,
    LIM_CRED_EX_VLR_INI: null,
    LIM_CRED_EX_VLR_FIM: null,
    NUMERO_PREFAT: null,
    PREFATURAMENTO: false,
    COD_VOLUME: null,
    ENTREGA_CONFIRMADA: null,
    VOID: null,
  };
  const lista = await timedPost(
    "VENDAS.Lista (worker atual)",
    `${base}/millenium.VENDAS.Lista`,
    session,
    listaBody,
    "GET",
  );

  // 3) ListaTodos
  const listaTodos = await timedPost(
    "VENDAS.ListaTodos",
    `${base}/millenium.VENDAS.ListaTodos`,
    session,
    listaBody,
    "GET",
  );

  // 4) Produtos por Cupom  -  INTERVAL 3 = Este Mes
  const geradorMap = await fetchFilialGeradorMap({ session });
  const g = geradorMap.get("00205") ?? 65728;
  const origin = base.replace(/\/api\/?$/, "");
  let cupomOk = false;
  for (const guid of CUPON_REPORT_GUIDS) {
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
        CATALOG_GUID: guid,
        PARAMETERS_MODEL: [
          {
            SCRIPT: null,
            DATASOURCE: null,
            DATA_DATA_DATA_INTERVAL: 3,
            DATA_DATA_DATA_START: null,
            DATA_DATA_DATA_END: null,
            VENDA_MOVIMENTO_NFS: "",
            FILIAL_GERADOR_GERADOR: `(${g})`,
            PRODUTO_PRODUTO_PRODUTO: null,
          },
        ],
        UNIVERSE_NAME: "millenium.mdu",
        REPORT_FORMAT: "raw",
        PARAMETERS_DESCRIPTION: `Filial=(${g}) Data=Este Mes`,
      }),
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    console.log(`\n=== Produtos por Cupom GUID=${guid} ===\nstatus=${res.status} ms=${ms} bytes=${text.length}`);
    if (!res.ok) {
      console.log("fail:", text.slice(0, 200));
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      console.log("non-json", text.slice(0, 200));
      continue;
    }
    const rows = extractList(json);
    console.log(`rows=${rows.length}`);
    if (rows[0] && typeof rows[0] === "object") {
      console.log("keys:", Object.keys(rows[0] as object).sort().join(", "));
      console.log("sample[0]:", JSON.stringify(rows[0], null, 2).slice(0, 1200));
      // brand hints in desc
      let we = 0;
      let wp = 0;
      let other = 0;
      for (const r of rows.slice(0, 200) as Array<Record<string, unknown>>) {
        const desc = String(
          r.PRODUTO_PRODUTO_DESCRICAO1 ?? r.DESC_PRODUTO ?? r.PRODUTO ?? "",
        ).toUpperCase();
        if (desc.includes("WPINK") || desc.startsWith("WP")) wp += 1;
        else if (desc.includes("WEPINK")) we += 1;
        else other += 1;
      }
      console.log(`hint in first 200: WEPINK~${we} WPINK/WP~${wp} other~${other}`);
    }
    cupomOk = true;
    break;
  }
  if (!cupomOk) console.log("\nProdutos por Cupom: nenhum GUID respondeu OK");

  console.log("\n========== RESUMO PERF ==========");
  console.log(`NFE.Lista_Status : ${nfe.ms}ms · ${nfe.rows.length} rows · ${(nfe.bytes / 1024).toFixed(0)}KB`);
  console.log(`VENDAS.Lista     : ${lista.ms}ms · ${lista.rows.length} rows · ${(lista.bytes / 1024).toFixed(0)}KB`);
  console.log(
    `VENDAS.ListaTodos: ${listaTodos.ms}ms · ${listaTodos.rows.length} rows · ${(listaTodos.bytes / 1024).toFixed(0)}KB`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
