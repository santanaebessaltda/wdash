/**
 * Compara split WEPINK/WPINK:
 *   A) RELATORIOMARGEM  |  COD_PRODUTO WP*  ->  WPINK (TOTALVENDA)
 *   B) TOTAL VENDA POR DIA (wtsreports marca)
 *   C) VENDAS.Lista total (ALL)  -  referencia de faturamento
 *
 *   cd workers/millennium-sync && npx tsx scripts/probe-margem-vs-brand-report.ts
 *   STORE=00205 DAY=2026-09-23 npx tsx scripts/probe-margem-vs-brand-report.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium, millenniumBaseUrl } from "../src/millenniumAuth.ts";
import { listRememberedSessions } from "../src/sessionStore.ts";
import {
  fetchBrandRevenueReport,
  fetchFilialGeradorMap,
  normalizeBrandLabel,
} from "../src/millenniumBrandReport.ts";
import {
  fetchRelatorioMargem,
  type MargemLine,
} from "../src/millenniumMargem.ts";
import { fetchSalesLista } from "../src/millenniumSales.ts";

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

/** Mesma regra do DetMov: COD WP*  ->  WPINK; senao WEPINK. */
function brandFromCod(cod: string): "WEPINK" | "WPINK" {
  const t = cod.trim().toUpperCase();
  if (/^WP[\dA-Z]/.test(t) || t === "WP" || t.startsWith("WP ")) return "WPINK";
  return "WEPINK";
}

function sumMargemByBrand(lines: MargemLine[]) {
  let wepink = 0;
  let wpink = 0;
  let cmvWe = 0;
  let cmvWp = 0;
  const wpSamples: string[] = [];
  const weSamples: string[] = [];
  for (const line of lines) {
    const brand = brandFromCod(line.codProduto);
    if (brand === "WPINK") {
      wpink += line.totalVenda;
      cmvWp += line.custoTotal;
      if (wpSamples.length < 8 && line.codProduto) wpSamples.push(line.codProduto);
    } else {
      wepink += line.totalVenda;
      cmvWe += line.custoTotal;
      if (weSamples.length < 8 && line.codProduto) weSamples.push(line.codProduto);
    }
  }
  return {
    wepink,
    wpink,
    total: wepink + wpink,
    cmvWe,
    cmvWp,
    cmvTotal: cmvWe + cmvWp,
    wpSamples,
    weSamples,
    lines: lines.length,
    wpLines: lines.filter((l) => brandFromCod(l.codProduto) === "WPINK").length,
  };
}

function fmt(reais: number): string {
  return `R$ ${reais.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pctDiff(a: number, b: number): string {
  if (b === 0) return a === 0 ? "0%" : "∞";
  return `${(((a - b) / b) * 100).toFixed(2)}%`;
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
      signal: AbortSignal.timeout(15_000),
    });
    if (smoke.status !== 401) return session;
  }
  const login = await loginMillennium(username, password);
  if (!login.ok) throw new Error(String(login.reason));
  await deps.setStoredSession(credId, login.session);
  return login.session;
}

async function main() {
  loadDotEnv();
  const storeCode = (process.env.STORE ?? "00205").trim();
  const day = (process.env.DAY ?? "2026-09-23").trim();
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
  const store = stores.find((s) => s.code === storeCode);
  if (!store) throw new Error(`loja ${storeCode} não encontrada`);

  const session = await ensureSession(deps, cred.id as string, full.username, full.password);
  const geradorMap = await fetchFilialGeradorMap({ session });
  const geradorId = geradorMap.get(store.code);
  if (geradorId == null) throw new Error(`sem GERADOR para ${store.code}`);

  console.log(
    `\n=== Probe margem WP* vs TOTAL VENDA POR DIA ===\nloja ${store.code} FILIAL=${store.millenniumStoreId} GERADOR=${geradorId} dia=${day}\n`,
  );

  // A) Margem
  const tM = Date.now();
  const margemLines = await fetchRelatorioMargem({
    session,
    millenniumStoreId: store.millenniumStoreId,
    from: day,
    to: day,
  });
  const msM = Date.now() - tM;
  const byCod = sumMargemByBrand(margemLines);
  console.log(`A) RELATORIOMARGEM · ${msM}ms · ${byCod.lines} linha(s) · WP*=${byCod.wpLines}`);
  console.log(`   WEPINK ${fmt(byCod.wepink)}  WPINK ${fmt(byCod.wpink)}  Σ ${fmt(byCod.total)}`);
  console.log(`   CMV     ${fmt(byCod.cmvWe)} / ${fmt(byCod.cmvWp)}  Σ ${fmt(byCod.cmvTotal)}`);
  console.log(`   sample WP*:  ${byCod.wpSamples.join(", ") || "(nenhum)"}`);
  console.log(`   sample WE:   ${byCod.weSamples.join(", ") || "(nenhum)"}`);

  // B) Report marca
  const tR = Date.now();
  const reportRows = await fetchBrandRevenueReport({
    session,
    geradorIds: [geradorId],
    from: day,
    to: day,
  });
  const msR = Date.now() - tR;
  let repWe = 0;
  let repWp = 0;
  for (const row of reportRows) {
    for (const part of row.byBrand) {
      const b = normalizeBrandLabel(part.label);
      if (b === "WEPINK") repWe += part.revenueReais;
      else if (b === "WPINK") repWp += part.revenueReais;
    }
  }
  console.log(`\nB) TOTAL VENDA POR DIA · ${msR}ms · ${reportRows.length} dia(s)`);
  console.log(`   WEPINK ${fmt(repWe)}  WPINK ${fmt(repWp)}  Σ ${fmt(repWe + repWp)}`);
  if (reportRows[0]) {
    console.log(
      `   raw brands: ${reportRows[0].byBrand.map((p) => `${p.label}=${p.revenueReais}`).join(" | ")}`,
    );
  }

  // C) Lista ALL
  const eventoIds = await deps.resolveEventoIds(session, cred.tenant_id as string, store.code);
  const tL = Date.now();
  const lista = await fetchSalesLista({
    session,
    storeId: store.id,
    millenniumStoreId: store.millenniumStoreId,
    from: day,
    to: day,
    eventoIds,
  });
  const msL = Date.now() - tL;
  const listaTotal = lista.reduce((a, r) => a + r.revenueCents, 0) / 100;
  console.log(`\nC) VENDAS.Lista · ${msL}ms · ${lista.length} venda(s)`);
  console.log(`   ALL ${fmt(listaTotal)}`);

  // Diffs
  console.log(`\n=== Diffs (margem WP* vs report) ===`);
  console.log(
    `   WEPINK  margem−report = ${fmt(byCod.wepink - repWe)} (${pctDiff(byCod.wepink, repWe)})`,
  );
  console.log(
    `   WPINK   margem−report = ${fmt(byCod.wpink - repWp)} (${pctDiff(byCod.wpink, repWp)})`,
  );
  console.log(
    `   Σ marca margem−report = ${fmt(byCod.total - (repWe + repWp))} (${pctDiff(byCod.total, repWe + repWp)})`,
  );
  console.log(
    `   Σ margem−Lista        = ${fmt(byCod.total - listaTotal)} (${pctDiff(byCod.total, listaTotal)})`,
  );
  console.log(
    `   Σ report−Lista        = ${fmt(repWe + repWp - listaTotal)} (${pctDiff(repWe + repWp, listaTotal)})`,
  );
  console.log(`\nTempo: margem ${msM}ms vs report ${msR}ms (Lista ${msL}ms)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
