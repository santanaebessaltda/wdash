/**
 * Log do worker no terminal: cabecalho do job  ->  1 bloco por loja  ->  resumo.
 * Linhas tecnicas de cada etapa so aparecem com SYNC_LOG_VERBOSE=1 (avisos e erros sempre aparecem).
 */
import { formatElapsed, type StepTimings } from "./syncTiming.ts";

const RULE = "=".repeat(72);
const SUB_RULE = "-".repeat(72);

export function isVerbose(): boolean {
  return process.env.SYNC_LOG_VERBOSE === "1";
}

/** Linha tecnica (etapa a etapa)  -  so com SYNC_LOG_VERBOSE=1. */
export function detail(message: string): void {
  if (isVerbose()) console.log(message);
}

/** 25/09/2026 (dia ISO  ->  BR). */
export function brDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Hora local (HH:MM:SS) no fuso informado. */
export function clock(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(at);
}

export function brlCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Nome curto da etapa no resumo (tira o identificador tecnico entre parenteses/chaves). */
function shortStep(step: string): string {
  return step.replace(/\s*[({][^)}]*[)}]/g, "").trim();
}

function stepsInline(timings: StepTimings): string {
  return timings
    .entries()
    .map(([step, v]) => `${shortStep(step)} ${v.calls > 1 ? `${v.calls}x ` : ""}${formatElapsed(0, v.ms)}`)
    .join(", ");
}

export type JobHeader = {
  title: string;
  /** Periodo (ISO). */
  from: string;
  to: string;
  storeCount: number;
  erpUser: string;
  sessionReused: boolean;
  tenantId: string;
  jobId: string;
  startedAt: Date;
  timeZone: string;
};

export function logJobHeader(h: JobHeader): void {
  const period = h.from === h.to ? brDay(h.from) : `${brDay(h.from)} a ${brDay(h.to)}`;
  console.log(RULE);
  console.log(`${h.title} | ${period} | ${plural(h.storeCount, "loja", "lojas")}`);
  console.log(`  Usuário ERP : ${h.erpUser} (sessão ${h.sessionReused ? "reaproveitada" : "nova"})`);
  console.log(`  Empresa     : ${h.tenantId.slice(0, 8)} | sincronização ${h.jobId.slice(0, 8)}`);
  console.log(`  Início      : ${clock(h.startedAt, h.timeZone)}`);
  console.log(SUB_RULE);
}

export function logStoreStart(args: {
  index: number;
  total: number;
  code: string;
  name?: string | null;
  /** Lojas ja concluidas (para estimar o que falta). */
  done: Array<{ ms: number }>;
}): void {
  const name = args.name ? ` - ${args.name}` : "";
  let eta = "";
  if (args.total > 1 && args.done.length > 0) {
    const avg = args.done.reduce((a, s) => a + s.ms, 0) / args.done.length;
    eta = ` (faltam ~${formatElapsed(0, avg * (args.total - args.index))})`;
  }
  console.log(`[${args.index + 1}/${args.total}] Loja ${args.code}${name}${eta}`);
}

export function logStoreEnd(args: {
  /** Numeros da loja (ex.: "35 vendas  |  35 cupons"). */
  facts: string[];
  ms: number;
  timings?: StepTimings;
  failures?: number;
}): void {
  if (args.facts.length > 0) console.log(`      ${args.facts.join(" | ")}`);
  const calls = args.timings?.totalCalls() ?? 0;
  const steps = args.timings && !args.timings.isEmpty ? ` (${stepsInline(args.timings)})` : "";
  const fail = args.failures ? ` | ${plural(args.failures, "janela com falha", "janelas com falha")}` : "";
  console.log(
    `      ${args.failures ? "AVISO" : "OK"} em ${formatElapsed(0, args.ms)} | ${plural(calls, "chamada", "chamadas")} ao ERP${steps}${fail}`,
  );
}

/** Carga em periodo: cabecalho unico (os dados do ERP vem 1x por loja; os dias sao so gravacao). */
export function logRangeHeader(args: { title: string; from: string; to: string; storeCount: number; jobId: string }): void {
  console.log(RULE);
  console.log(
    `${args.title} | ${brDay(args.from)} a ${brDay(args.to)} | ${plural(args.storeCount, "loja", "lojas")} | sincronização ${args.jobId.slice(0, 8)}`,
  );
  console.log(`  ERP uma vez por loja no período; depois grava dia a dia`);
  console.log(SUB_RULE);
}

/** 1 linha por dia gravado; chamadas ao ERP so quando houve (normalmente so no 1 dia). */
export function logRangeDay(args: {
  index: number;
  total: number;
  day: string;
  sales: number;
  revenueCents: number;
  ms: number;
  timings: StepTimings;
}): void {
  const calls = args.timings.totalCalls();
  const erp = calls > 0 ? ` | ${plural(calls, "chamada", "chamadas")} ao ERP (${stepsInline(args.timings)})` : "";
  console.log(
    `[${args.index + 1}/${args.total}] ${brDay(args.day)} | ${plural(args.sales, "venda", "vendas")} | ${brlCents(args.revenueCents)} | ${formatElapsed(0, args.ms)}${erp}`,
  );
}

export function logRangeEnd(args: {
  ok: boolean;
  title: string;
  days: number;
  totalDays: number;
  ms: number;
  timings: StepTimings;
  note?: string;
}): void {
  console.log(SUB_RULE);
  const calls = args.timings.totalCalls();
  console.log(
    `${args.ok ? "OK" : "AVISO"} | ${args.title} | ${args.days}/${plural(args.totalDays, "dia", "dias")} | ${formatElapsed(0, args.ms)} | ${plural(calls, "chamada", "chamadas")} ao ERP`,
  );
  if (!args.timings.isEmpty) console.log(`  Chamadas    : ${stepsInline(args.timings)}`);
  if (args.note) console.log(`  ${args.note}`);
  console.log(RULE);
}

export function logJobEnd(args: {
  ok: boolean;
  title: string;
  storesDone: number;
  storeCount: number;
  ms: number;
  timings: StepTimings;
  erpUser: string | null;
  startedAt: Date;
  finishedAt: Date;
  timeZone: string;
  perStore: Array<{ code: string; ms: number }>;
  error?: string;
}): void {
  console.log(SUB_RULE);
  const calls = args.timings.totalCalls();
  const head = args.ok ? `OK | ${args.title} concluído` : `ERRO | ${args.title} falhou`;
  console.log(
    `${head} | ${args.storesDone}/${plural(args.storeCount, "loja", "lojas")} | ${formatElapsed(0, args.ms)} | ${plural(calls, "chamada", "chamadas")} ao ERP`,
  );
  console.log(
    `  Horário     : ${clock(args.startedAt, args.timeZone)} até ${clock(args.finishedAt, args.timeZone)}` +
      (args.erpUser ? ` | usuário ERP ${args.erpUser}` : ""),
  );
  if (args.perStore.length > 1) {
    console.log(`  Por loja    : ${args.perStore.map((s) => `${s.code} ${formatElapsed(0, s.ms)}`).join(", ")}`);
  }
  if (!args.timings.isEmpty) console.log(`  Chamadas    : ${stepsInline(args.timings)}`);
  if (args.error) console.log(`  Motivo      : ${args.error}`);
  console.log(RULE);
}
