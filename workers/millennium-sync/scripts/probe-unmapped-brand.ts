/**
 * Amostra DetMov set/26 00205: quanto R$ cai fora do mapa de marca.
 *   cd workers/millennium-sync && npx tsx scripts/probe-unmapped-brand.ts
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
import { fetchConsultaDetMov } from "../src/millenniumDetMov.ts";
import { fetchSalesLista } from "../src/millenniumSales.ts";
import { uniqueBrandSplitHeaders } from "../src/brandSplitFromDetalhe.ts";

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
      signal: AbortSignal.timeout(90_000),
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
  const geradorMap = await fetchFilialGeradorMap({ session });
  const geradorId = geradorMap.get(store.code)!;
  console.log("gerador", geradorId, "filial", store.millenniumStoreId);

  // mapa atual (estoque + LISTAR 101)
  const catalog = await fetchProductBrandMap({
    session,
    geradorIds: [geradorId],
    stores: [{ millenniumStoreId: store.millenniumStoreId, geradorId }],
    from,
    to,
  });
  let we = 0;
  let wp = 0;
  for (const b of catalog.map.values()) {
    if (b === "WEPINK") we += 1;
    else if (b === "WPINK") wp += 1;
  }
  console.log(`mapa atual: WPINK=${wp} WEPINK=${we} total=${catalog.map.size}`);

  // LISTAR 102 sozinho
  console.log("LISTAR TIPO=102…");
  const t0 = Date.now();
  const wepinkCodes = await listarCodes(session, store.millenniumStoreId, 102, from, to);
  console.log(`LISTAR 102 · ${wepinkCodes.size} codes · ${Date.now() - t0}ms`);

  // lookup
  const lookupRes = await fetch(`${millenniumBaseUrl()}/millenium?$lookup=produto.produto.produto`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "WTS-Session": session,
      "X-HTTP-Method": "GET",
      "X-IdentifierCase": "upper",
    },
    body: "{}",
  });
  const lookupJson = JSON.parse(await lookupRes.text()) as unknown;
  const codeToId = new Map<string, number>();
  for (const r of extractList(lookupJson)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = Number(o.PRODUTO_PRODUTO_PRODUTO);
    const cod = String(o.PRODUTO_PRODUTO_COD_PRODUTO ?? "").trim();
    if (cod && Number.isFinite(id)) codeToId.set(cod, id);
  }
  let newWe = 0;
  for (const c of wepinkCodes) {
    const id = codeToId.get(c);
    if (id != null && catalog.map.get(id) !== "WEPINK") {
      newWe += 1;
      catalog.map.set(id, "WEPINK");
    }
  }
  console.log(`LISTAR 102 adicionaria ${newWe} WEPINK ids → mapa ${catalog.map.size}`);

  // sample DetMov: um dia (05/09  -  pico)
  const eventoIds = await deps.resolveEventoIds(session, cred.tenant_id as string, store.code);
  const dayRows = await fetchSalesLista({
    session,
    storeId: store.id,
    millenniumStoreId: store.millenniumStoreId,
    from: "2026-09-05",
    to: "2026-09-05",
    eventoIds,
  });
  const headers = uniqueBrandSplitHeaders(dayRows).slice(0, 80);
  console.log(`\nDetMov sample 05/09 · ${headers.length} cupons (cap 80)`);
  let mapped = 0;
  let unmapped = 0;
  let mappedC = 0;
  let unmappedC = 0;
  const unmappedIds = new Map<number, { cents: number; desc: string }>();
  for (const h of headers) {
    const lines = await fetchConsultaDetMov({
      session,
      codOperacao: h.millenniumOpCode,
      nf: h.nf,
      tipoOperacao: h.tipoOperacao,
    });
    for (const line of lines) {
      const brand = catalog.map.get(line.productId);
      if (brand === "WEPINK" || brand === "WPINK") {
        mapped += 1;
        mappedC += line.revenueCents;
      } else {
        unmapped += 1;
        unmappedC += line.revenueCents;
        const prev = unmappedIds.get(line.productId) ?? { cents: 0, desc: line.descProduto };
        prev.cents += line.revenueCents;
        unmappedIds.set(line.productId, prev);
      }
    }
  }
  console.log(
    `mapped R$ ${(mappedC / 100).toFixed(2)} (${mapped} lines) · unmapped R$ ${(unmappedC / 100).toFixed(2)} (${unmapped} lines)`,
  );
  const top = [...unmappedIds.entries()]
    .sort((a, b) => b[1].cents - a[1].cents)
    .slice(0, 15);
  console.log("top unmapped:");
  for (const [id, v] of top) {
    console.log(`  id=${id} R$ ${(v.cents / 100).toFixed(2)} · ${v.desc.slice(0, 60)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
