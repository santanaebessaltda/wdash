/**
 * Confirma divisao 102 = WEPINK (so contagens, sem dump de sessao).
 *   cd workers/millennium-sync && npx tsx scripts/probe-division-ids.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminClient, buildDeps } from "../src/deps.ts";
import { loginMillennium } from "../src/millenniumAuth.ts";
import { listRememberedSessions } from "../src/sessionStore.ts";
import {
  DIVISAO_WEPINK,
  DIVISAO_WPINK,
  fetchProductBrandMap,
} from "../src/millenniumProductDivision.ts";
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
  const geradorMap = await fetchFilialGeradorMap({ session });
  const geradorIds = [...geradorMap.values()];
  if (geradorIds.length === 0) throw new Error("no gerador");
  console.log(`divisões: WPINK=${DIVISAO_WPINK} WEPINK=${DIVISAO_WEPINK} geradores=${geradorIds.join(",")}`);
  const map = await fetchProductBrandMap({ session, geradorIds });
  let wepink = 0;
  let wpink = 0;
  for (const b of map.map.values()) {
    if (b === "WEPINK") wepink += 1;
    else if (b === "WPINK") wpink += 1;
  }
  console.log(
    `mapa: total=${map.map.size} WEPINK=${wepink} WPINK=${wpink} · geradores c/ WPINK=${[...map.geradorIdsWithWpink].join(",") || "(nenhum)"}`,
  );
  console.log(wepink > 0 && wpink > 0 ? "OK: ambas divisões populadas" : "AVISO: alguma divisão vazia");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
