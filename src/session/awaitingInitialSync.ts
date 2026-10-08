/** Flag pos-onboarding: bloqueia o app ate a carga inicial (SEED) gravar de verdade. */
const FLAG = "wedash.awaitingInitialSync";
const SINCE = "wedash.awaitingInitialSyncSince";

export function markAwaitingInitialSync(): void {
  try {
    sessionStorage.setItem(FLAG, "1");
    sessionStorage.setItem(SINCE, new Date().toISOString());
  } catch {
    /* ignore */
  }
}

/** Reinicia o relogio do "aguardando sync" (ex.: Tentar novamente). */
export function bumpAwaitingInitialSyncSince(): void {
  try {
    if (sessionStorage.getItem(FLAG) === "1") {
      sessionStorage.setItem(SINCE, new Date().toISOString());
    }
  } catch {
    /* ignore */
  }
}

export function clearAwaitingInitialSync(): void {
  try {
    sessionStorage.removeItem(FLAG);
    sessionStorage.removeItem(SINCE);
  } catch {
    /* ignore */
  }
}

export function isAwaitingInitialSync(): boolean {
  try {
    return sessionStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

/** Instantaneo em que pedimos o SEED  -  jobs antigos "SUCCEEDED" nao liberam a tela. */
export function awaitingInitialSyncSince(): string | null {
  try {
    return sessionStorage.getItem(SINCE);
  } catch {
    return null;
  }
}
