/**
 * Probe LISTARVENDASSALDO (TIPO=101/102) vs mapa {9701602B}.
 *   cd workers/millennium-sync && npx tsx scripts/probe-sales-balance.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium, millenniumBaseUrl } from "../src/millenniumAuth.ts";
import { listRememberedSessions } from "../src/sessionStore.ts";
import { milleniumDataRange } from "../src/millenniumSales.ts";
import { fetchProductBrandMap } from "../src/millenniumProductDivision.ts";
import { fetchFilialGeradorMap } from "../src/millenniumBrandReport.ts";

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
  for (const k of ["value", "Value", "data", "Data"]) {
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
  }
  const login = await loginMillennium(username, password);
  if (!login.ok) throw new Error(String(login.reason));
  await deps.setStoredSession(credId, login.session);
  return login.session;
}

async function listarVendasSaldo(
  session: string,
  filial: number,
  tipo: number,
  from: string,
  to: string,
) {
  const { datai, dataf } = milleniumDataRange(from, to);
  const t0 = Date.now();
  const res = await fetch(
    `${millenniumBaseUrl()}/MILLENIUM!FRANQUIAS.RELATORIOS.LISTARVENDASSALDO`,
    {
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
        FILIAL: filial,
        DESC: null,
        DATAI: datai,
        DATAF: dataf,
        TIPO: tipo,
      }),
    },
  );
  const text = await res.text();
  const ms = Date.now() - t0;
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  const rows = json ? extractList(json) : [];
  const codes = new Set<string>();
  let soldQty = 0;
  let soldSkus = 0;
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const cod = String(o.COD_PRODUTO ?? "").trim();
    if (cod) codes.add(cod);
    const q = typeof o.QUANTIDADE_FATURADA === "number" ? o.QUANTIDADE_FATURADA : 0;
    if (q > 0) {
      soldQty += q;
      soldSkus += 1;
    }
  }
  console.log(
    `\n=== LISTARVENDASSALDO TIPO=${tipo} === status=${res.status} ms=${ms} rows=${rows.length}`,
  );
  if (!res.ok) {
    console.log(text.slice(0, 300));
    return { codes, soldQty, soldSkus, rows };
  }
  if (rows[0] && typeof rows[0] === "object") {
    console.log("keys:", Object.keys(rows[0] as object).sort().join(", "));
  }
  const prefixes = new Map<string, number>();
  for (const c of codes) {
    const p = /^[A-Za-z]+/.exec(c)?.[0] ?? "(num/other)";
    prefixes.set(p, (prefixes.get(p) ?? 0) + 1);
  }
  console.log(
    `códigos únicos=${codes.size} · vendidos no período=${soldSkus} SKUs / ${soldQty} un`,
  );
  console.log(
    "prefixos:",
    [...prefixes.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}=${n}`)
      .join(" · "),
  );
  console.log("amostra codes:", [...codes].slice(0, 12).join(", "));
  return { codes, soldQty, soldSkus, rows };
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
  const store = stores.find((s) => s.code === "00205")!;
  const session = await ensureSession(deps, cred.id as string, full.username, full.password);

  const from = "2026-09-01";
  const to = "2026-09-22";
  const filial = store.millenniumStoreId!;

  const wpink = await listarVendasSaldo(session, filial, 101, from, to);
  const wepink = await listarVendasSaldo(session, filial, 102, from, to);

  const overlap = [...wpink.codes].filter((c) => wepink.codes.has(c));
  console.log(`\noverlap códigos 101∩102: ${overlap.length}`, overlap.slice(0, 10));

  // mapa atual (id interno)  -  quantos COD_PRODUTO WP* ele cobre via report uniao
  const geradorMap = await fetchFilialGeradorMap({ session });
  const catalog = await fetchProductBrandMap({
    session,
    geradorIds: [...geradorMap.values()],
  });
  let we = 0;
  let wp = 0;
  for (const b of catalog.map.values()) {
    if (b === "WEPINK") we += 1;
    else if (b === "WPINK") wp += 1;
  }
  console.log(
    `\nmapa {9701602B} união geradores: WPINK ids=${wp} WEPINK ids=${we} · LISTAR 101 codes=${wpink.codes.size} · LISTAR 102 codes=${wepink.codes.size}`,
  );

  // DetMov sample: tem COD_PRODUTO?
  const det = await fetch(`${millenniumBaseUrl()}/millenium.MOVIMENTACAO.ConsultaDetMov`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "WTS-Session": session,
      "X-HTTP-Method": "GET",
      "X-IdentifierCase": "upper",
      "X-DateFormat": "ISOTZ",
    },
    body: JSON.stringify({
      TIPO_OPERACAO: "S",
      COD_OPERACAO: 12437575,
      NF: "12911",
    }),
  });
  const detText = await det.text();
  let detJson: unknown = null;
  try {
    detJson = JSON.parse(detText);
  } catch {
    /* ignore */
  }
  const detRows = detJson ? extractList(detJson) : [];
  console.log(`\n=== ConsultaDetMov sample === status=${det.status} rows=${detRows.length}`);
  if (detRows[0] && typeof detRows[0] === "object") {
    console.log("keys:", Object.keys(detRows[0] as object).sort().join(", "));
    console.log("sample:", JSON.stringify(detRows[0]).slice(0, 600));
  } else {
    console.log(detText.slice(0, 300));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
