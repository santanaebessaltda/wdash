/**
 * Probe: VENDAS.Lista tem NF + COD_OPERACAO numerico? + 1 ConsultaDetMov.
 *   cd workers/millennium-sync && npx tsx scripts/probe-detmov.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium, millenniumBaseUrl } from "../src/millenniumAuth.ts";
import { listRememberedSessions } from "../src/sessionStore.ts";
import { fetchSalesLista } from "../src/millenniumSales.ts";
import { fetchEventosListaTodos, resolveSalesEventIds } from "../src/millenniumEvents.ts";

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

  const events = await fetchEventosListaTodos({ session, baseUrl: millenniumBaseUrl() });
  const eventoIds = resolveSalesEventIds(events, store.code);
  const today = new Date().toISOString().slice(0, 10);
  // ontem pra ter volume
  const day = "2026-09-21";

  console.log(`Lista ${store.code} FILIAL=${store.millenniumStoreId} day=${day}`);
  const rows = await fetchSalesLista({
    session,
    storeId: store.id,
    millenniumStoreId: store.millenniumStoreId,
    from: day,
    to: day,
    eventoIds,
  });
  console.log(`mapped rows=${rows.length}`);

  // raw call to inspect NF
  const { milleniumDataRange } = await import("../src/millenniumSales.ts");
  const { datai, dataf } = milleniumDataRange(day, day);
  const body = {
    EVENTO: `(${eventoIds.join(",")})`,
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
  const res = await fetch(`${millenniumBaseUrl()}/millenium.VENDAS.Lista`, {
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
  const raw = await res.json();
  const list = Array.isArray(raw) ? raw : (raw.value ?? raw.data ?? []);
  const first = list[0] as Record<string, unknown> | undefined;
  if (!first) {
    console.log("Lista vazia");
    return;
  }
  const keys = Object.keys(first).sort();
  console.log("Lista keys:", keys.join(", "));
  const interesting = keys.filter((k) =>
    /nf|nota|oper|doc|tipo|prod|valor|quant|cancel/i.test(k),
  );
  console.log(
    "interesting:",
    interesting.map((k) => `${k}=${JSON.stringify(first[k])}`).join(" · "),
  );
  console.log("sample COD_OPERACAO type:", typeof first.COD_OPERACAO, first.COD_OPERACAO);
  console.log("sample NF:", first.NF, first.NOTA, first.NUMERO_NF, first.DOCUMENTO);

  const codOp = first.COD_OPERACAO;
  const nf = first.NF ?? first.NOTA ?? first.NUMERO_NF;
  if (codOp == null || nf == null) {
    console.log("SEM NF ou COD_OPERACAO — não dá pra chamar DetMov com este payload");
    // dump a few more rows looking for NF
    for (const r of list.slice(0, 5)) {
      const o = r as Record<string, unknown>;
      console.log({
        COD_OPERACAO: o.COD_OPERACAO,
        NF: o.NF,
        NOTA: o.NOTA,
        DOCUMENTO: o.DOCUMENTO,
        TIPO_OPERACAO: o.TIPO_OPERACAO,
        VALOR_FINAL: o.VALOR_FINAL,
      });
    }
    return;
  }

  console.log(`\nConsultaDetMov COD_OPERACAO=${codOp} NF=${nf}`);
  const detBody = {
    COD_OPERACAO: typeof codOp === "number" ? codOp : Number(codOp),
    TIPO_OPERACAO: "S",
    NF: String(nf),
    PRODUTO: null,
    COR: null,
    ESTAMPA: null,
    TAMANHO: null,
    SCRIPTTAMANHO: null,
    ITEM: null,
  };
  const detRes = await fetch(`${millenniumBaseUrl()}/millenium.MOVIMENTACAO.ConsultaDetMov`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "WTS-Session": session,
      "X-HTTP-Method": "GET",
      "X-IdentifierCase": "upper",
      "X-DateFormat": "ISOTZ",
    },
    body: JSON.stringify(detBody),
  });
  const detText = await detRes.text();
  console.log(`det status=${detRes.status} bytes=${detText.length}`);
  let detJson: unknown;
  try {
    detJson = JSON.parse(detText);
  } catch {
    console.log(detText.slice(0, 400));
    return;
  }
  const detList = Array.isArray(detJson)
    ? detJson
    : ((detJson as { value?: unknown[] }).value ?? []);
  console.log(`det lines=${detList.length}`);
  if (detList[0]) {
    console.log("det keys:", Object.keys(detList[0] as object).sort().join(", "));
    console.log("det[0]:", JSON.stringify(detList[0], null, 2).slice(0, 1200));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
