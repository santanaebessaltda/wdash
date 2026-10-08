/**
 * Garante 1 processo worker por maquina/pasta.
 * Sem isso, varios `npm start` brigam pelo mesmo login Millennium (busy).
 */
import { existsSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const WORKER_LOCK_PATH = resolve(__dirname, "../.millennium-worker.lock");

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLockPid(): number | null {
  try {
    if (!existsSync(WORKER_LOCK_PATH)) return null;
    const raw = readFileSync(WORKER_LOCK_PATH, "utf8");
    const m = raw.match(/pid\s*=\s*(\d+)/i);
    if (!m) return null;
    return Number(m[1]);
  } catch {
    return null;
  }
}

function writeLock(pid: number): void {
  writeFileSync(
    WORKER_LOCK_PATH,
    `pid=${pid}\nstarted_at=${new Date().toISOString()}\n`,
    "utf8",
  );
}

/**
 * Adquire o lock. Se outro worker vivo ja tem, lanca erro (nao sobe o 2).
 * Se o PID do arquivo morreu (crash), herda o lock.
 */
export function acquireWorkerLock(): void {
  const myPid = process.pid;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(WORKER_LOCK_PATH, "wx");
      closeSync(fd);
      writeLock(myPid);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw e;

      const other = readLockPid();
      if (other != null && other !== myPid && isPidAlive(other)) {
        throw new Error(
          `Já existe um worker Millennium rodando (pid ${other}).\n` +
            `Pare o outro processo antes de subir de novo — ou: taskkill /PID ${other} /F\n` +
            `Lock: ${WORKER_LOCK_PATH}`,
        );
      }

      // Lock orfao (processo morto)  -  remove e tenta de novo.
      try {
        unlinkSync(WORKER_LOCK_PATH);
      } catch {
        /* race com outro boot */
      }
    }
  }

  throw new Error(`Não foi possível adquirir o lock do worker: ${WORKER_LOCK_PATH}`);
}

/** Remove o lock so se ainda for deste processo. */
export function releaseWorkerLock(): void {
  const pid = readLockPid();
  if (pid != null && pid !== process.pid) return;
  try {
    if (existsSync(WORKER_LOCK_PATH)) unlinkSync(WORKER_LOCK_PATH);
  } catch {
    /* ignore */
  }
}

/** Para `npm run erp -- status`. */
export function describeWorkerLock(): string {
  const pid = readLockPid();
  if (pid == null) return "Lock: livre (nenhum worker com lock)";
  if (isPidAlive(pid)) return `Lock: ocupado pelo pid ${pid} (worker ativo)`;
  return `Lock: órfão (pid ${pid} morto) — próximo start limpa`;
}
