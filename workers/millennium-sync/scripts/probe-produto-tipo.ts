/**
 * Probe: produto.produto.produto  -  campos TIPO / COD  ->  classificar categorias.
 *   cd workers/millennium-sync && npx tsx scripts/probe-produto-tipo.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium, millenniumBaseUrl } from "../src/millenniumAuth.ts";
import { listRememberedSessions } from "../src/sessionStore.ts";

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
  let session =
    (await deps.getStoredSession(cred.id as string)) ??
    listRememberedSessions().find((s) => s.credentialId === (cred.id as string))?.session ??
    null;
  if (!session) {
    const login = await loginMillennium(full.username, full.password);
    if (!login.ok) throw new Error(login.reason);
    session = login.session;
  }
  const base = millenniumBaseUrl().replace(/\/$/, "");

  // Sample product ids from probe report: 407, 404
  for (const q of [
    { label: "by-id-407", url: `${base}/millenium?$lookup=produto.produto.produto&PRODUTO=${407}&$top=5` },
    { label: "by-cod-235", url: `${base}/millenium?$lookup=produto.produto.produto&COD_PRODUTO=235&$top=5` },
    { label: "list-top", url: `${base}/millenium?$lookup=produto.produto.produto&$top=3` },
  ]) {
    const res = await fetch(q.url, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        "WTS-Session": session,
        "X-DateFormat": "ISOTZ",
        "X-HTTP-Method": "GET",
        "X-IdentifierCase": "upper",
      },
      body: JSON.stringify({ SCRIPT: null, DATASOURCE: null, _DETAILS: true }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    console.log(`\n=== ${q.label} → ${res.status} ===`);
    try {
      const parsed = JSON.parse(text) as { value?: unknown[] };
      const rows = parsed.value ?? [];
      console.log("count", rows.length);
      if (rows[0] && typeof rows[0] === "object") {
        const o = rows[0] as Record<string, unknown>;
        const keys = Object.keys(o).sort();
        console.log("keys", keys.filter((k) => /TIPO|DESC|COD|PRODUTO|DIVISAO|MARCA/i.test(k)).join(", "));
        console.log(
          "pick",
          JSON.stringify(
            {
              PRODUTO: o.PRODUTO ?? o.produto,
              COD_PRODUTO: o.COD_PRODUTO ?? o.cod_produto,
              DESCRICAO1: o.DESCRICAO1 ?? o.descricao1,
              TIPO: o.TIPO ?? o.tipo,
              PRODUTO_TIPO_TIPO: o.PRODUTO_TIPO_TIPO,
              DIVISAO: o.DIVISAO ?? o.divisao,
              MARCA: o.MARCA ?? o.marca,
            },
            null,
            2,
          ),
        );
        // dump all keys briefly
        console.log(
          "all tipo-ish",
          keys.filter((k) => /tipo/i.test(k)).map((k) => `${k}=${JSON.stringify(o[k])}`).join(" | "),
        );
      } else {
        console.log(text.slice(0, 400));
      }
    } catch {
      console.log(text.slice(0, 400));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
