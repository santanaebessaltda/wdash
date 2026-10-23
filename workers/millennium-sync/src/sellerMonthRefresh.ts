import type { SyncJobPayload } from "./runSyncJob.ts";

/**
 * Só quando o job traz a marca. Quem marca: Atualizar manual (o job de hoje) e o
 * fechamento da madrugada (o último dia). Automático, dia pendente e carga do histórico não marcam.
 */
export function shouldRefreshOpenMonthSellers(job: {
  payload?: Pick<SyncJobPayload, "refreshMonthSellers">;
}): boolean {
  return job.payload?.refreshMonthSellers === true;
}

/** Dia 1 do mês de `today` até `today` (calendário da loja). */
export function openMonthThrough(today: string): { from: string; to: string } {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}
