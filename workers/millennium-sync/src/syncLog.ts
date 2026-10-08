/**
 * Configurações > Logs — erros/avisos do job em memória, gravados em `sync_log` no fim do job.
 * Um job por vez no processo (loop sequencial), então o buffer é por módulo.
 * Mensagens sanitizadas: nada de token WTS-Session, senha ou query string com sessão.
 */

import { execSync } from "node:child_process";

export type SyncLogLevel = "ERROR" | "WARN";

/** Etapa do sync (filtro "Origem" na tela). */
export type SyncLogSource =
  | "job"
  | "login"
  | "vendas"
  | "margem"
  | "cmv"
  | "detalhe_movimento"
  | "categorias"
  | "catalogo"
  | "top_produtos"
  | "cupom"
  | "custo_produto"
  | "itens_pessoa"
  | "mapa_produtos"
  | "gerador"
  | "eventos"
  | "vendedoras"
  | "fechamento_caixa"
  | "millennium_ocupado";

export type SyncLogRow = {
  tenantId: string;
  jobId: string | null;
  jobKind: string | null;
  level: SyncLogLevel;
  source: SyncLogSource;
  storeId: string | null;
  storeLabel: string | null;
  day: string | null;
  message: string;
  detail: Record<string, unknown> | null;
};

type Ctx = { tenantId: string; jobId: string; jobKind: string; erpUser?: string };

/** Teto por job — erro repetido vira `detail.count`, não linha nova. */
const MAX_ROWS_PER_JOB = 200;
const MAX_MESSAGE = 1000;
const MAX_STACK_FRAMES = 8;

/** Commit do worker (`+local` = rodando com alterações não commitadas). `WORKER_VERSION` sobrescreve. */
function detectWorkerVersion(): string {
  if (process.env.WORKER_VERSION) return process.env.WORKER_VERSION;
  try {
    const sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    const dirty = execSync("git status --porcelain -- .", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return dirty ? `${sha}+local` : sha;
  } catch {
    return "desconhecida";
  }
}

export const WORKER_INFO = { version: detectWorkerVersion(), startedAt: new Date().toISOString() };

/** Primeiras linhas do stack, com caminho relativo ao worker e sanitizado. */
export function sanitizeStack(error: unknown): string | null {
  if (!(error instanceof Error) || !error.stack) return null;
  const lines = error.stack
    .split("\n")
    .slice(0, MAX_STACK_FRAMES + 1)
    .map((l) => l.replace(/(file:\/\/\/)?[^\s(]*[\\/]millennium-sync[\\/]/g, "").replace(/\\/g, "/"));
  return sanitizeLogMessage(lines.join("\n"));
}

let ctx: Ctx | null = null;
let rows: SyncLogRow[] = [];
let index = new Map<string, SyncLogRow>();
let issues = new Map<string, number>();

export function sanitizeLogMessage(raw: string): string {
  return raw
    .replace(/(WTS-Session|session|sessao|token|authorization)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi, "$1$2***")
    .replace(/(password|senha|pwd)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi, "$1$2***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer ***")
    .replace(/(https?:\/\/[^\s?"']+)\?[^\s"']*/gi, "$1?…")
    .slice(0, MAX_MESSAGE);
}

export function beginSyncLog(next: Ctx): void {
  ctx = next;
  rows = [];
  index = new Map();
  issues = new Map();
}

/** Avisos/erros do job atual para a loja (+ os sem loja) — inclusive os agregados. */
export function syncLogIssueCount(storeId: string): number {
  return (issues.get(storeId) ?? 0) + (issues.get("") ?? 0);
}

/** Usuário ERP do job — vai em `detail.erpUser` de cada registro (inclusive os já gravados no buffer). */
export function setSyncLogErpUser(erpUser: string): void {
  if (!ctx) return;
  ctx.erpUser = erpUser;
  for (const row of rows) (row.detail ??= {}).erpUser = erpUser;
}

/**
 * Registra erro/aviso do job atual (no-op fora de job).
 * Mesma origem + loja + mensagem no mesmo job agrega em `detail.count` / `detail.days`.
 */
export function syncLog(
  level: SyncLogLevel,
  source: SyncLogSource,
  message: string,
  extra?: {
    store?: { id: string; code: string } | null;
    day?: string | null;
    detail?: Record<string, unknown>;
    /** Erro original — em ERROR vira `detail.stack`. */
    error?: unknown;
  },
): void {
  if (!ctx) return;
  const issueKey = extra?.store?.id ?? "";
  issues.set(issueKey, (issues.get(issueKey) ?? 0) + 1);
  const msg = sanitizeLogMessage(message);
  const key = `${level}|${source}|${extra?.store?.id ?? ""}|${msg}`;
  const hit = index.get(key);
  if (hit) {
    const d = (hit.detail ??= {});
    d.count = Number(d.count ?? 1) + 1;
    if (extra?.day) {
      const days = new Set<string>(Array.isArray(d.days) ? (d.days as string[]) : hit.day ? [hit.day] : []);
      days.add(extra.day);
      d.days = [...days].sort();
    }
    return;
  }
  if (rows.length >= MAX_ROWS_PER_JOB) return;
  const detail: Record<string, unknown> = {
    ...extra?.detail,
    ...(ctx.erpUser ? { erpUser: ctx.erpUser } : {}),
    worker: WORKER_INFO,
  };
  const stack = level === "ERROR" ? sanitizeStack(extra?.error) : null;
  if (stack) detail.stack = stack;
  const row: SyncLogRow = {
    tenantId: ctx.tenantId,
    jobId: ctx.jobId,
    jobKind: ctx.jobKind,
    level,
    source,
    storeId: extra?.store?.id ?? null,
    storeLabel: extra?.store?.code ?? null,
    day: extra?.day ?? null,
    message: msg,
    detail,
  };
  rows.push(row);
  index.set(key, row);
}

/** Fecha o job e devolve as linhas para gravar. */
export function endSyncLog(): SyncLogRow[] {
  const out = rows;
  ctx = null;
  rows = [];
  index = new Map();
  issues = new Map();
  return out;
}
