/**
 * Sincronizacao no `.env`  -  cada chave cuida de uma coisa so:
 * - SYNC_ONBOARDING (padrao 1m): so a carga do onboarding. off = sem vendas  -  ao conectar traz so o
 *   cadastro (gerador, equipe e produtos)  |  Nd = N dias contando hoje  |  Nm = N meses contando o atual.
 * - AUTO_REFRESH (padrao on): Atualizar automatico a cada 30 min, o dia todo. off = so o manual.
 * - CLOSE_HOUR (padrao 3): hora local do fechamento da madrugada (0 - 23). off = desligado.
 * - DEEP_HISTORY (padrao off, so Nm): historico antigo na madrugada, ate a inauguracao da loja.
 *
 * Dias perdidos (integracao desconectada, worker parado) sao recuperados por qualquer Atualizar ou
 * fechamento da madrugada a partir do ultimo dia fechado da loja  -  nao depende de nenhuma chave.
 * Valor invalido derruba o worker na partida (`assertSyncConfig`).
 */
import { addDays } from "./autoRefresh.ts";
import { addMonths, monthStart } from "./deepHistory.ts";

type Env = Record<string, string | undefined>;

export type SyncSpan = "off" | { n: number; unit: "d" | "m" };

export function parseSyncSpan(name: string, raw: string | undefined, fallback: SyncSpan): SyncSpan {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return fallback;
  if (value === "off") return "off";
  const match = /^(\d+)([dm])$/.exec(value);
  const n = match ? Number(match[1]) : 0;
  if (!match || n < 1) throw new Error(`${name}=${raw} inválido — use off, Nd (ex.: 2d) ou Nm (ex.: 2m)`);
  return { n, unit: match[2] as "d" | "m" };
}

/** Primeiro dia coberto pelo periodo (inclui hoje / o mes atual). */
export function spanStart(span: Exclude<SyncSpan, "off">, todayIso: string): string {
  return span.unit === "d" ? addDays(todayIso, -(span.n - 1)) : addMonths(monthStart(todayIso), -(span.n - 1));
}

export function describeSpan(span: SyncSpan): string {
  if (span === "off") return "desligado";
  if (span.unit === "d") return span.n === 1 ? "só hoje" : span.n === 2 ? "hoje e ontem" : `últimos ${span.n} dias`;
  return span.n === 1 ? "mês atual" : `${span.n} meses (mês atual + ${span.n - 1} anterior(es))`;
}

export function onboardingSpan(env: Env = process.env): SyncSpan {
  return parseSyncSpan("SYNC_ONBOARDING", env.SYNC_ONBOARDING, { n: 1, unit: "m" });
}

export function syncOnboardingOff(env: Env = process.env): boolean {
  return onboardingSpan(env) === "off";
}

/** Anotacao do SEED pulado com SYNC_ONBOARDING=off (status SUCCEEDED; o sino ignora). */
export const SYNC_OFF_NOTE = "sync desligado (SYNC_ONBOARDING=off)";

/** Dia mais antigo da carga do historico depois do SEED (que ja trouxe hoje); null = nada antes de hoje. */
export function onboardingHistoryUntil(todayIso: string, env: Env = process.env): string | null {
  const span = onboardingSpan(env);
  if (span === "off") return null;
  const start = spanStart(span, todayIso);
  return start < todayIso ? start : null;
}

export function deepHistorySpan(env: Env = process.env): SyncSpan {
  const span = parseSyncSpan("DEEP_HISTORY", env.DEEP_HISTORY, "off");
  if (span !== "off" && span.unit !== "m") throw new Error(`DEEP_HISTORY=${env.DEEP_HISTORY} inválido — use off ou Nm (ex.: 24m)`);
  return span;
}

export function autoRefreshEnabled(env: Env = process.env): boolean {
  const value = (env.AUTO_REFRESH ?? "").trim().toLowerCase();
  if (!value || value === "on") return true;
  if (value === "off") return false;
  throw new Error(`AUTO_REFRESH=${env.AUTO_REFRESH} inválido — use on ou off`);
}

function assertCloseHour(env: Env): void {
  const value = (env.CLOSE_HOUR ?? "").trim().toLowerCase();
  if (!value || value === "off") return;
  const n = Number(value);
  if (!/^\d{1,2}$/.test(value) || n > 23) throw new Error(`CLOSE_HOUR=${env.CLOSE_HOUR} inválido — use off ou uma hora de 0 a 23`);
}

export function assertSyncConfig(env: Env = process.env): void {
  onboardingSpan(env);
  autoRefreshEnabled(env);
  assertCloseHour(env);
  deepHistorySpan(env);
}
