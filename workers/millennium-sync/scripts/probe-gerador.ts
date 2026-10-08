/**
 * Confere o codigo de gerador de 1 funcionaria (FUNCIONARIOS.Consulta, so leitura; reusa a sessao salva).
 *   cd workers/millennium-sync && npx tsx scripts/probe-gerador.ts FUNCIONARIO
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { millenniumBaseUrl } from "../src/millenniumAuth.ts";
import { parseFuncionarioFlags, parseFuncionarioGerador } from "../src/millenniumSellers.ts";

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
  const funcionario = Number(process.argv[2]);
  if (!Number.isFinite(funcionario)) throw new Error("uso: probe-gerador.ts FUNCIONARIO");
  const sb = createAdminClient();
  const deps = buildDeps(sb, process.env.ERP_SECRET_KEY!);
  const { data: cred } = await sb.from("erp_credential").select("id").eq("status", "VALID").limit(1).maybeSingle();
  const session = await deps.getStoredSession(cred!.id as string);
  if (!session) throw new Error("sem sessão salva (não faço login novo para não derrubar ninguém)");
  const base = millenniumBaseUrl().replace(/\/$/, "");
  const res = await fetch(`${base}/millenium.FUNCIONARIOS.Consulta`, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      "WTS-Session": session,
      "X-DateFormat": "ISOTZ",
      "X-HTTP-Method": "GET",
      "X-IdentifierCase": "upper",
    },
    body: JSON.stringify({ FUNCIONARIO: funcionario }),
  });
  console.log(`HTTP ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  const row = (Array.isArray(json.value) ? json.value[0] : json) as Record<string, unknown> | undefined;
  const geradores = (row?.GERADORES ?? []) as Array<Record<string, unknown>>;
  console.log(`NOME: ${String(row?.NOME ?? "")}`);
  console.log(
    "GERADORES:",
    geradores.map((g) => ({ GERADOR: g.GERADOR, DESATIVADO: g.DESATIVADO, NOME: g.NOME })),
  );
  console.log(`parseFuncionarioGerador → ${parseFuncionarioGerador(json)}`);
  console.log("flags:", parseFuncionarioFlags(json));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
