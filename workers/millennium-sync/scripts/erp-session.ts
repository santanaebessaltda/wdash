/**
 * Controle manual da sessao Millennium do worker.
 *
 *   npm run erp -- status   # pausado? sessoes salvas?
 *   npm run erp -- logout   # encerra sessao WDash no ERP (libera o usuario)
 *   npm run erp -- pause    # para de syncar + logout (use o ERP a vontade)
 *   npm run erp -- resume   # volta a processar a fila
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logoutMillennium } from "../src/millenniumAuth.ts";
import {
  listRememberedSessions,
  logoutRememberedSessions,
} from "../src/sessionStore.ts";
import { isWorkerPaused, PAUSE_FLAG_PATH, setWorkerPaused } from "../src/workerPause.ts";
import { describeWorkerLock } from "../src/workerLock.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  const candidates = [
    resolve(__dirname, "../.env"),
    resolve(__dirname, "../../../.env"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
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

async function cmdStatus() {
  const paused = isWorkerPaused();
  const sessions = listRememberedSessions();
  console.log(paused ? "Worker: PAUSADO (não synca)" : "Worker: ativo (se estiver rodando)");
  console.log(`Flag: ${PAUSE_FLAG_PATH}`);
  console.log(describeWorkerLock());
  console.log(
    sessions.length === 0
      ? "Sessões salvas: nenhuma"
      : `Sessões salvas: ${sessions.length} (credencial ${sessions.map((s) => s.credentialId.slice(0, 8)).join(", ")}…)`,
  );
}

async function cmdLogout() {
  const n = await logoutRememberedSessions(logoutMillennium);
  console.log(
    n > 0
      ? `Logout OK · ${n} sessão(ões) encerrada(s) no Millennium`
      : "Nenhuma sessão WDash salva para encerrar (já liberado ou worker nunca logou)",
  );
}

async function cmdPause() {
  setWorkerPaused(true);
  await cmdLogout();
  console.log("Pausado. Pode usar o usuário no ERP. Depois: npm run erp -- resume");
}

async function cmdResume() {
  setWorkerPaused(false);
  console.log("Retomado. O worker volta a processar a fila no próximo poll.");
}

async function main() {
  loadDotEnv();
  const cmd = (process.argv[2] ?? "status").toLowerCase();
  switch (cmd) {
    case "status":
      await cmdStatus();
      break;
    case "logout":
      await cmdLogout();
      break;
    case "pause":
      await cmdPause();
      break;
    case "resume":
      await cmdResume();
      break;
    default:
      console.error(`Uso: npm run erp -- <status|logout|pause|resume>`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
