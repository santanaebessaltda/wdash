/**
 * Re-busca o RELATORIOMARGEM de dias antigos e compara o custo unitario com o gravado.
 * Responde: a margem usa o custo da epoca da venda ou o custo atual da tabela? So leitura no ERP.
 *   cd workers/millennium-sync && npx tsx scripts/probe-margem-refetch.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { fetchRelatorioMargem } from "../src/millenniumMargem.ts";

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

/** [loja, codigo]  -  custo 0 gravado (420, WP014) e custo diferente da tabela atual (259, 901, 504). */
const CASES: Array<[string, string]> = [
  ["00114", "420"],
  ["00114", "452"],
  ["00205", "WP014"],
  ["00114", "259"],
  ["00205", "901"],
  ["00010", "504"],
];

async function main() {
  loadDotEnv();
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: stores } = await sb.from("store").select("id, code, tenant_id, millennium_store_id");
  const byCode = new Map((stores ?? []).map((s) => [s.code, s]));
  const { data: cred } = await sb
    .from("erp_credential")
    .select("millennium_session")
    .eq("tenant_id", stores?.[0]?.tenant_id)
    .single();
  const session = cred?.millennium_session as string;

  for (const [storeCode, code] of CASES) {
    const store = byCode.get(storeCode)!;
    const { data: rows } = await sb
      .from("sales_product_cost_day_agg")
      .select("day, item_count, cmv_cents")
      .eq("store_id", store.id)
      .eq("product_code", code)
      .gt("item_count", 0)
      .order("day", { ascending: true });
    const picks = rows?.length ? [rows[0]!, rows[rows.length - 1]!] : [];
    for (const r of picks) {
      const lines = await fetchRelatorioMargem({
        session,
        millenniumStoreId: store.millennium_store_id,
        from: r.day,
        to: r.day,
      });
      const hit = lines.filter((l) => l.codProduto.trim() === code);
      const qty = hit.reduce((a, l) => a + l.qty, 0);
      const custo = hit.reduce((a, l) => a + l.custoTotal, 0);
      const gravado = r.cmv_cents / r.item_count / 100;
      const agora = qty > 0 ? custo / qty : null;
      console.log(
        `${storeCode} ${code.padEnd(6)} ${r.day} · gravado ${gravado.toFixed(2)} · margem hoje ${agora == null ? "sem linha" : agora.toFixed(2)}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
