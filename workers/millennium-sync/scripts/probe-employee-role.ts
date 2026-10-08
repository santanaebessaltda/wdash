/**
 * Compara FUNCIONARIOS.Lista com CARGO=1 (VENDEDOR) x sem cargo, para 1 filial, + flags do Consulta.
 *   cd workers/millennium-sync && npx tsx scripts/probe-employee-role.ts [FILIAL]
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { millenniumBaseUrl } from "../src/millenniumAuth.ts";
import { parseFuncionarioFlags, isSellerActive } from "../src/millenniumSellers.ts";

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
}

async function main() {
  loadDotEnv();
  const filial = Number(process.argv[2] ?? "8");
  const sb = createAdminClient();
  const deps = buildDeps(sb, process.env.ERP_SECRET_KEY!);
  const { data: cred } = await sb.from("erp_credential").select("id").eq("status", "VALID").limit(1).maybeSingle();
  const session = await deps.getStoredSession(cred!.id as string);
  if (!session) throw new Error("sem sessão salva");
  const base = millenniumBaseUrl().replace(/\/$/, "");
  const headers = {
    Accept: "*/*",
    "Content-Type": "application/json",
    "WTS-Session": session,
    "X-DateFormat": "ISOTZ",
    "X-HTTP-Method": "GET",
    "X-IdentifierCase": "upper",
  };
  const lista = async (cargo: number | null) => {
    const res = await fetch(`${base}/millenium.FUNCIONARIOS.Lista?$top=500`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ORDEM: 1, CAMPO: 1, FILTRO: 2, VALOR_FILTRO: null, VALOR_1: null, VALOR_2: null,
        FILIAL: filial, CARGO: cargo, RESPONSAVEL: null,
      }),
    });
    const j = (await res.json()) as { value?: Record<string, unknown>[] };
    return j.value ?? [];
  };
  const withCargo = await lista(1);
  const all = await lista(null);
  console.log(`filial=${filial} CARGO=1 → ${withCargo.length} · sem cargo → ${all.length}`);
  const ids1 = new Set(withCargo.map((r) => r.FUNCIONARIO));
  for (const r of all) {
    const res = await fetch(`${base}/millenium.FUNCIONARIOS.Consulta`, {
      method: "POST",
      headers,
      body: JSON.stringify({ FUNCIONARIO: r.FUNCIONARIO }),
    });
    const flags = parseFuncionarioFlags(await res.json());
    console.log(
      `${ids1.has(r.FUNCIONARIO) ? "C1" : "--"} ${String(r.FUNCIONARIO).padEnd(7)} ${String(r.CARGO ?? "").padEnd(14)} ${isSellerActive(flags) ? "ATIVA  " : "INATIVA"} ${JSON.stringify(flags)} ${r.NOME}`,
    );
  }
  const { data: store } = await sb.from("store").select("id").eq("millennium_store_id", filial).maybeSingle();
  if (store) {
    const { data: rows } = await sb.from("store_seller").select("name, active, in_erp").eq("store_id", store.id);
    console.log("store_seller:", rows?.map((r) => `${r.name}${r.active ? "" : " (inativa)"}${r.in_erp ? "" : " [fora do ERP]"}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
