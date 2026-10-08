/**
 * Periodo compartilhado entre as telas (useScope). sessionStorage (nao localStorage):
 * fechar o app volta para "Hoje"; o logout tambem limpa.
 */
export const PERIOD_STORAGE_KEY = "wedash.period";

export function clearSavedPeriod() {
  try {
    sessionStorage.removeItem(PERIOD_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
