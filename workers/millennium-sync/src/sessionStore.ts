/**
 * Sessao Millennium em memoria do processo.
 * Token tambem vive em erp_credential.millennium_session (service_role) —
 * crash/reboot usa a coluna no banco (disconnectTenantSessions), nao disco.
 * Em Vitest: mesma memoria de processo (isolada por arquivo de teste).
 */
import { existsSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Caminho legado — apagado na 1ª escrita para nao deixar WTS-Session em plaintext. */
const LEGACY_STORE_PATH = resolve(__dirname, "../.millennium-sessions.json");

type Store = Record<string, string>;
let memoryStore: Store = {};
let scrubbedLegacy = false;

function scrubLegacyDisk(): void {
  if (scrubbedLegacy) return;
  scrubbedLegacy = true;
  try {
    if (existsSync(LEGACY_STORE_PATH)) unlinkSync(LEGACY_STORE_PATH);
  } catch {
    /* best-effort */
  }
}

function readStore(): Store {
  scrubLegacyDisk();
  return { ...memoryStore };
}

function writeStore(store: Store): void {
  scrubLegacyDisk();
  memoryStore = { ...store };
}

export function rememberMillenniumSession(credentialId: string, session: string): void {
  const store = readStore();
  store[credentialId] = session;
  writeStore(store);
}

export function forgetMillenniumSession(credentialId: string): void {
  const store = readStore();
  if (!(credentialId in store)) return;
  delete store[credentialId];
  writeStore(store);
}

export function listRememberedSessions(): Array<{ credentialId: string; session: string }> {
  return Object.entries(readStore()).map(([credentialId, session]) => ({ credentialId, session }));
}

/** Encerra todas as sessoes lembradas (script erp-session / liberar busy). */
export async function logoutRememberedSessions(
  logout: (session: string) => Promise<void>,
): Promise<number> {
  const entries = listRememberedSessions();
  if (entries.length === 0) return 0;
  let n = 0;
  for (const { credentialId, session } of entries) {
    try {
      await logout(session);
      n += 1;
      console.log(`Logout sessão órfã · credencial ${credentialId.slice(0, 8)}…`);
    } catch (e) {
      console.warn(
        `Falha ao logout órfã ${credentialId.slice(0, 8)}…:`,
        e instanceof Error ? e.message : e,
      );
    }
    forgetMillenniumSession(credentialId);
  }
  return n;
}
