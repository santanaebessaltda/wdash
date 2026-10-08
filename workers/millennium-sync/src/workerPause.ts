/**
 * Flag local: enquanto existir, o worker nao claima jobs nem enfileira LIGHT.
 * Use `npm run erp -- pause|resume` (ou crie/apague o arquivo).
 */
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PAUSE_FLAG_PATH = resolve(__dirname, "../.millennium-pause");

export function isWorkerPaused(): boolean {
  return existsSync(PAUSE_FLAG_PATH);
}

export function setWorkerPaused(paused: boolean): void {
  if (paused) {
    writeFileSync(
      PAUSE_FLAG_PATH,
      `paused_at=${new Date().toISOString()}\n# npm run erp -- resume\n`,
      "utf8",
    );
  } else if (existsSync(PAUSE_FLAG_PATH)) {
    unlinkSync(PAUSE_FLAG_PATH);
  }
}
