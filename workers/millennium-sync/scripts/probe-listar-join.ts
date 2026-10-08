/**
 * JOIN LISTARVENDASSALDO (COD) x lookup produto (COD -> id) x mapa estoque.
 *   cd workers/millennium-sync && npx tsx scripts/probe-listar-join.ts
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
  for (const k of ["value", "Value", "data", "Data", "RAW_DATA"]) {
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

async function listarCodes(
  session: string,
  filial: number,
  tipo: number,
  from: string,
  to: string,
): Promise<Set<string>> {
  const { datai, dataf } = milleniumDataRange(from, to);
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
  const json = JSON.parse(await res.text()) as unknown;
  const codes = new Set<string>();
  for (const r of extractList(json)) {
    if (!r || typeof r !== "object") continue;
    const c = String((r as Record<string, unknown>).COD_PRODUTO ?? "").trim();
    if (c) codes.add(c);
  }
  return codes;
}

async function productCodeToId(session: string): Promise<Map<string, number>> {
  const url = `${millenniumBaseUrl()}/millenium?$lookup=produto.produto.produto`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "WTS-Session": session,
      "X-HTTP-Method": "GET",
      "X-IdentifierCase": "upper",
      "X-DateFormat": "ISOTZ",
    },
    body: "{}",
  });
  const json = JSON.parse(await res.text()) as unknown;
  const map = new Map<string, number>();
  for (const r of extractList(json)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = Number(o.PRODUTO_PRODUTO_PRODUTO);
    const cod = String(o.PRODUTO_PRODUTO_COD_PRODUTO ?? "").trim();
    if (cod && Number.isFinite(id)) map.set(cod, id);
  }
  return map;
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

  const [wpinkCodes, wepinkCodes, codeToId, geradorMap] = await Promise.all([
    listarCodes(session, filial, 101, from, to),
    listarCodes(session, filial, 102, from, to),
    productCodeToId(session),
    fetchFilialGeradorMap({ session }),
  ]);
  const catalog = await fetchProductBrandMap({
    session,
    geradorIds: [...geradorMap.values()],
  });

  const listarMap = new Map<number, "WEPINK" | "WPINK">();
  const missWp: string[] = [];
  let hitWp = 0;
  let hitWe = 0;
  let missWe = 0;
  for (const c of wpinkCodes) {
    const id = codeToId.get(c);
    if (id != null) {
      hitWp += 1;
      listarMap.set(id, "WPINK");
    } else missWp.push(c);
  }
  for (const c of wepinkCodes) {
    const id = codeToId.get(c);
    if (id != null) {
      hitWe += 1;
      listarMap.set(id, "WEPINK");
    } else missWe += 1;
  }

  const oldWp = [...catalog.map.entries()]
    .filter(([, b]) => b === "WPINK")
    .map(([id]) => id);
  const newWp = [...listarMap.entries()]
    .filter(([, b]) => b === "WPINK")
    .map(([id]) => id);
  const onlyNew = newWp.filter((id) => catalog.map.get(id) !== "WPINK");
  const onlyOld = oldWp.filter((id) => listarMap.get(id) !== "WPINK");

  console.log(`lookup codes=${codeToId.size}`);
  console.log(
    `LISTAR 101 codes=${wpinkCodes.size} resolved=${hitWp} miss=${missWp.length}`,
    missWp.slice(0, 10),
  );
  console.log(`LISTAR 102 codes=${wepinkCodes.size} resolved=${hitWe} miss=${missWe}`);
  console.log(`old map WPINK ids=${oldWp.length} · listar WPINK ids=${newWp.length}`);
  console.log(`só no LISTAR (faltavam no estoque)=${onlyNew.length}`, onlyNew.slice(0, 20));
  console.log(`só no estoque (não no LISTAR)=${onlyOld.length}`, onlyOld.slice(0, 10));
  console.log(
    `mapa unido size=${new Set([...catalog.map.keys(), ...listarMap.keys()]).size}`,
  );

  // heuristic WP* no lookup
  let wpPrefix = 0;
  for (const [cod, id] of codeToId) {
    if (/^WP/i.test(cod)) {
      wpPrefix += 1;
      if (!listarMap.has(id)) console.log(`  WP* no lookup fora do LISTAR: ${cod}→${id}`);
    }
  }
  console.log(`lookup WP* prefix count=${wpPrefix}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
