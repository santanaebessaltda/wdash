/**
 * Tabelas de custo do Millennium x produtos com custo 0 no RELATORIOMARGEM. So leitura no ERP.
 * Faz login com a credencial salva e grava a sessao nova em erp_credential (o worker reaproveita).
 *   cd workers/millennium-sync && npx tsx scripts/probe-cost-table.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { decryptPassword } from "../src/decrypt.ts";
import { loginMillennium, millenniumBaseUrl } from "../src/millenniumAuth.ts";

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
  }
  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  }
}

type Row = Record<string, unknown>;

function rowsOf(payload: unknown): Row[] {
  if (Array.isArray(payload)) return payload as Row[];
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["RAW_DATA", "value", "Value", "data", "Data"]) {
    if (Array.isArray(o[k])) return o[k] as Row[];
  }
  return [];
}

async function main() {
  loadDotEnv();
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const base = millenniumBaseUrl();
  const origin = base.replace(/\/api\/?$/, "");

  const { data: zero, error: zeroErr } = await sb
    .from("sales_product_cost_day_agg")
    .select("store_id, product_code, item_count, revenue_cents")
    .gt("revenue_cents", 0)
    .eq("cmv_cents", 0);
  if (zeroErr) throw zeroErr;
  const zeroCodes = new Map<string, { itens: number; fat: number; stores: Set<string> }>();
  for (const r of zero ?? []) {
    const z = zeroCodes.get(r.product_code) ?? { itens: 0, fat: 0, stores: new Set<string>() };
    z.itens += r.item_count;
    z.fat += r.revenue_cents;
    z.stores.add(r.store_id);
    zeroCodes.set(r.product_code, z);
  }
  console.log(`${zeroCodes.size} produtos com custo 0 na margem: ${[...zeroCodes.keys()].join(", ")}`);

  const { data: stores } = await sb
    .from("store")
    .select("id, code, tenant_id, millennium_gerador_id")
    .not("millennium_gerador_id", "is", null);
  const storeIds = new Set([...zeroCodes.values()].flatMap((z) => [...z.stores]));
  const targets = (stores ?? []).filter((s) => storeIds.has(s.id));
  const tenantId = targets[0]?.tenant_id ?? stores?.[0]?.tenant_id;

  const { data: cred, error: credErr } = await sb
    .from("erp_credential")
    .select("id, username, password_ciphertext")
    .eq("tenant_id", tenantId)
    .single();
  if (credErr || !cred) throw credErr ?? new Error("sem credencial");
  const lookupTables = (s: string) =>
    fetch(`${base}/millenium?$lookup=tabela_custo.TABELA&$top=501`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "WTS-Session": s,
        "X-HTTP-Method": "GET",
        "X-IdentifierCase": "upper",
        "X-DateFormat": "ISOTZ",
      },
      body: JSON.stringify({
        SCRIPT: null,
        DATASOURCE: null,
        TABELA_CUSTO_TABELA: null,
        _DETAILS: true,
        PARAM_6: null,
        PARAM_7: null,
      }),
    });

  const { data: saved } = await sb.from("erp_credential").select("millennium_session").eq("id", cred.id).single();
  let session = saved?.millennium_session as string | null;
  let lookupRes = session ? await lookupTables(session) : null;
  if (!lookupRes || lookupRes.status === 401) {
    const password = await decryptPassword(cred.password_ciphertext, process.env.ERP_SECRET_KEY!.trim());
    const login = await loginMillennium(cred.username, password);
    if (!login.ok) throw new Error(`login falhou: ${login.reason}`);
    session = login.session;
    console.log(`login ok (usuário ${cred.username})`);
    await sb.from("erp_credential").update({ millennium_session: session }).eq("id", cred.id);
    lookupRes = await lookupTables(session);
  } else {
    console.log("sessão salva reaproveitada");
  }
  const lookupText = await lookupRes.text();
  if (!lookupRes.ok) throw new Error(`lookup ${lookupRes.status} ${lookupText.slice(0, 200)}`);
  const tables = rowsOf(JSON.parse(lookupText));
  console.log(`\n${tables.length} tabelas de custo:`);
  for (const t of tables) console.log("  ", JSON.stringify(t));
  const tableIds = tables
    .map((t) => t.TABELA_CUSTO_TABELA ?? t.TABELA)
    .filter((v): v is number | string => v != null);

  async function report(tabela: number | string, gerador: number) {
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
        CATALOG_GUID: "{9701602B-B363-4770-989C-8C4459B7E105}",
        PARAMETERS_MODEL: [
          {
            SCRIPT: null,
            DATASOURCE: null,
            TABELA_DE_CUSTO: tabela,
            FILIAL_GERADOR_GERADOR: `(${gerador})`,
            PRODUTO_DIVISAO_DIVISAO: null,
          },
        ],
        UNIVERSE_NAME: "millenium.mdu",
        REPORT_FORMAT: "raw",
        PARAMETERS_DESCRIPTION: `Tabela=${tabela} Filial=(${gerador})`,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false as const, status: res.status, err: text.slice(0, 200), rows: [] as Row[] };
    return { ok: true as const, status: res.status, err: "", rows: rowsOf(JSON.parse(text)) };
  }

  if (process.argv.includes("--multi")) {
    const gers = targets.map((s) => s.millennium_gerador_id).join(",");
    const t0 = Date.now();
    const res = await fetch(`${base}/millenium:wtsreports/reports/process`, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        Origin: origin,
        Referer: `${origin}/files/web-apps/millennium.html`,
        "WTS-Session": session!,
        "X-DateFormat": "ISOTZ",
        "X-HTTP-Method": "POST",
        "X-IdentifierCase": "upper",
      },
      body: JSON.stringify({
        CATALOG_GUID: "{9701602B-B363-4770-989C-8C4459B7E105}",
        PARAMETERS_MODEL: [
          { SCRIPT: null, DATASOURCE: null, TABELA_DE_CUSTO: 20104, FILIAL_GERADOR_GERADOR: `(${gers})`, PRODUTO_DIVISAO_DIVISAO: null },
        ],
        UNIVERSE_NAME: "millenium.mdu",
        REPORT_FORMAT: "raw",
        PARAMETERS_DESCRIPTION: `Tabela=20104 Filial=(${gers})`,
      }),
    });
    const text = await res.text();
    const rows = res.ok ? rowsOf(JSON.parse(text)) : [];
    const codes = new Set(rows.map((r) => String(r.PRODUTO_PRODUTO_COD_PRODUTO).trim()));
    const dup = rows.length - codes.size;
    console.log(`multi (${gers}): ${res.status} · ${rows.length} linhas · ${codes.size} códigos · ${dup} repetidos · ${Date.now() - t0}ms`);
    const semFilial = await fetch(`${base}/millenium:wtsreports/reports/process`, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        Origin: origin,
        Referer: `${origin}/files/web-apps/millennium.html`,
        "WTS-Session": session!,
        "X-DateFormat": "ISOTZ",
        "X-HTTP-Method": "POST",
        "X-IdentifierCase": "upper",
      },
      body: JSON.stringify({
        CATALOG_GUID: "{9701602B-B363-4770-989C-8C4459B7E105}",
        PARAMETERS_MODEL: [
          { SCRIPT: null, DATASOURCE: null, TABELA_DE_CUSTO: 20104, FILIAL_GERADOR_GERADOR: "", PRODUTO_DIVISAO_DIVISAO: null },
        ],
        UNIVERSE_NAME: "millenium.mdu",
        REPORT_FORMAT: "raw",
        PARAMETERS_DESCRIPTION: "Tabela=20104",
      }),
    });
    const t2 = await semFilial.text();
    const rows2 = semFilial.ok ? rowsOf(JSON.parse(t2)) : [];
    console.log(`sem filial: ${semFilial.status} · ${rows2.length} linhas · ${new Set(rows2.map((r) => String(r.PRODUTO_PRODUTO_COD_PRODUTO).trim())).size} códigos${semFilial.ok ? "" : " · " + t2.slice(0, 200)}`);
    return;
  }

  if (process.argv.includes("--compare")) {
    for (const s of targets) {
      const margem = new Map<string, { day: string; unit: number }>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb
          .from("sales_product_cost_day_agg")
          .select("day, product_code, item_count, cmv_cents")
          .eq("store_id", s.id)
          .gt("cmv_cents", 0)
          .gt("item_count", 0)
          .range(from, from + 999);
        if (error) throw error;
        for (const r of data ?? []) {
          const cur = margem.get(r.product_code);
          if (!cur || r.day > cur.day) {
            margem.set(r.product_code, { day: r.day, unit: r.cmv_cents / r.item_count / 100 });
          }
        }
        if (!data || data.length < 1000) break;
      }
      console.log(`\n=== Loja ${s.code}: ${margem.size} produtos com custo na margem (último dia de cada)`);
      for (const tabela of tableIds) {
        const r = await report(tabela, s.millennium_gerador_id);
        const unitByCode = new Map(
          r.rows.map((row) => [String(row.PRODUTO_PRODUTO_COD_PRODUTO).trim(), Number(row.F_3814918930) || 0]),
        );
        let igual = 0;
        let diferente = 0;
        let ausente = 0;
        const exemplos: string[] = [];
        for (const [code, m] of margem) {
          const u = unitByCode.get(code);
          if (u == null) {
            ausente += 1;
            continue;
          }
          if (Math.abs(u - m.unit) <= 0.011) igual += 1;
          else {
            diferente += 1;
            if (exemplos.length < 3) exemplos.push(`${code} margem ${m.unit.toFixed(2)} x tabela ${u.toFixed(2)}`);
          }
        }
        console.log(
          `  tabela ${tabela}: igual ${igual} · diferente ${diferente} · fora da tabela ${ausente}${exemplos.length ? ` · ex.: ${exemplos.join("; ")}` : ""}`,
        );
      }
    }
    return;
  }

  let shownFields = false;
  for (const s of targets) {
    const codesHere = [...zeroCodes].filter(([, z]) => z.stores.has(s.id)).map(([c]) => c);
    console.log(`\n=== Loja ${s.code} (gerador ${s.millennium_gerador_id}) · sem custo: ${codesHere.join(", ")}`);
    for (const tabela of tableIds) {
      const t0 = Date.now();
      const r = await report(tabela, s.millennium_gerador_id);
      if (!shownFields && r.rows[0]) {
        console.log("campos:", Object.keys(r.rows[0]).join(", "));
        console.log("exemplo:", JSON.stringify(r.rows[0]));
        shownFields = true;
      }
      const codeKey = r.rows[0] ? Object.keys(r.rows[0]).find((k) => /COD_PRODUTO/i.test(k)) : undefined;
      const hits = codeKey ? r.rows.filter((row) => codesHere.includes(String(row[codeKey]).trim())) : [];
      console.log(
        `  tabela ${tabela}: ${r.ok ? `${r.rows.length} produtos` : `ERRO ${r.status} ${r.err}`} · ${Date.now() - t0}ms · ${hits.length}/${codesHere.length} dos sem custo aparecem`,
      );
      for (const h of hits) console.log("     ", JSON.stringify(h));
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
