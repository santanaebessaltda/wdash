/** Pure helpers for Overview sync watermark / force UI (testable without React). */

import { AUTO_REFRESH_MIN, finalRoundAt, nextAutoRefreshAt, storePhase } from "./autoRefresh.ts";
import type { StoreWeekHours } from "./storeHours.ts";

/**
 * Cooldown do botao Atualizar.
 * **0 = off** (decisao 2026-09-23  -  sem espera entre cliques).
 * Para religar no futuro: `5 * 60 * 1000`.
 */
export const FORCE_COOLDOWN_MS = 0;

/** Sentinel key: FORCE em "Todas as lojas" (rede). */
export const FORCE_ALL_KEY = "__all__";

export type ForceAtMap = Record<string, string>;

/** "Atualizado as 06:19" (mesmo dia) ou "Atualizado em 23/09 as 18:40". */
export function formatUpdatedAtLabel(
  at: Date,
  opts: { now?: Date; timeZone?: string } = {},
): string {
  const now = opts.now ?? new Date();
  const clockLabel = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: opts.timeZone,
  }).format(at);
  const day = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: opts.timeZone,
  });
  const dayAt = day.format(at);
  if (dayAt === day.format(now)) return `Atualizado às ${clockLabel}`;
  return `Atualizado em ${dayAt.slice(0, 5)} às ${clockLabel}`;
}

export function formatSyncWatermarkLabel(
  watermark: Date | null,
  opts: { loading?: boolean; now?: Date; timeZone?: string } = {},
): string {
  if (watermark == null) {
    return opts.loading ? "Sincronizando dados…" : "Aguardando primeira sincronização";
  }
  return formatUpdatedAtLabel(watermark, opts);
}

function clockInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(at);
}

function dayInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).format(at);
}

/** "atualizado às 14:35" no mesmo dia, ou "atualizado em 21/10 às 18:40". */
function boardUpdatedPhrase(at: Date, now: Date, timeZone: string): string {
  const clock = clockInZone(at, timeZone);
  const day = dayInZone(at, timeZone);
  if (day === dayInZone(now, timeZone)) return `atualizado às ${clock}`;
  return `atualizado em ${day.slice(0, 5)} às ${clock}`;
}

export type AutoRefreshStoreInput = {
  hours: StoreWeekHours;
  /** Placar usa `timeZone`; lojas do session usam `timezone`. */
  timeZone?: string | null;
  timezone?: string | null;
};

function storeZones(stores: AutoRefreshStoreInput[]) {
  return stores.map((store) => ({
    hours: store.hours,
    timezone: store.timeZone || store.timezone || "America/Sao_Paulo",
  }));
}

/**
 * Contador da próxima rodada automática (Placar + tooltip do Atualizar).
 * `null` = loja fechada / ainda não abriu / sem horário — não promete próxima.
 * Passou da hora (ou última do dia ainda não gravou) = "atualizando…".
 */
export function nextAutoRefreshPhrase(args: {
  watermark: Date;
  now?: Date;
  stores: AutoRefreshStoreInput[];
}): string | null {
  const now = args.now ?? new Date();
  const zones = storeZones(args.stores);
  if (zones.length === 0) return null;
  const catchingUp = zones.some((store) => {
    if (storePhase(store.hours, now, store.timezone) !== "finalDue") return false;
    const final = finalRoundAt(store.hours, now, store.timezone);
    return final != null && args.watermark < final;
  });
  if (catchingUp) return "atualizando…";
  const next = nextAutoRefreshAt({
    stores: zones,
    now,
    intervalMin: AUTO_REFRESH_MIN,
    lastAutoAt: args.watermark,
  });
  if (!next) return null;
  const ms = next.getTime() - now.getTime();
  if (ms <= 0) return "atualizando…";
  const min = Math.max(1, Math.ceil(ms / 60_000));
  return min === 1 ? "próxima em 1 min" : `próxima em ${min} min`;
}

/**
 * Linha do placar: última gravação e contador até a próxima rodada automática.
 * Loja fechada, ainda não abriu, ou sem horário = só a última, sem prometer a próxima.
 */
export function formatBoardRefreshStatus(args: {
  watermark: Date | null;
  now?: Date;
  loading?: boolean;
  stores: AutoRefreshStoreInput[];
}): string {
  const watermark = args.watermark;
  if (watermark == null) {
    return args.loading ? "Sincronizando dados…" : "Aguardando primeira sincronização";
  }
  const now = args.now ?? new Date();
  const zones = storeZones(args.stores);
  const timeZone = zones[0]?.timezone ?? "America/Sao_Paulo";
  const updated = boardUpdatedPhrase(watermark, now, timeZone);
  const next = nextAutoRefreshPhrase({ watermark, now, stores: args.stores });
  return next ? `${updated} · ${next}` : updated;
}

export function canForceSyncRefresh(role: string): boolean {
  return role === "OWNER" || role === "MANAGER";
}

/** Client-side mirror of Edge FORCE window for one timestamp. */
export function forceRefreshRetryAfterSec(
  lastForceAt: Date | null,
  now: Date = new Date(),
  windowMs = FORCE_COOLDOWN_MS,
): number | null {
  if (!lastForceAt || windowMs <= 0) return null;
  const elapsed = now.getTime() - lastForceAt.getTime();
  if (elapsed >= windowMs) return null;
  return Math.max(1, Math.ceil((windowMs - elapsed) / 1000));
}

/**
 * Cooldown do botao Atualizar conforme loja(s) do StorePicker.
 * - 1 loja: bloqueia se essa loja OU um FORCE "Todas" recente.
 * - Todas ([]): bloqueia se QUALQUER FORCE recente (loja ou rede)  -  opcao A.
 */
export function forceCooldownForScopeSec(
  map: ForceAtMap,
  storeIds: string[],
  now: Date = new Date(),
  windowMs = FORCE_COOLDOWN_MS,
): number | null {
  if (windowMs <= 0) return null;
  const parse = (iso: string | undefined): Date | null => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  let worst: number | null = null;
  const consider = (at: Date | null) => {
    const sec = forceRefreshRetryAfterSec(at, now, windowMs);
    if (sec == null) return;
    if (worst == null || sec > worst) worst = sec;
  };

  if (storeIds.length === 0) {
    // Opcao A: qualquer FORCE recente bloqueia "Todas".
    for (const iso of Object.values(map)) consider(parse(iso));
    return worst;
  }

  consider(parse(map[FORCE_ALL_KEY]));
  for (const id of storeIds) consider(parse(map[id]));
  return worst;
}

/** Infer last FORCE time from Edge retryAfterSec (for hydrating UI after 429). */
export function lastForceAtFromRetryAfter(
  retryAfterSec: number,
  now: Date = new Date(),
  windowMs = FORCE_COOLDOWN_MS,
): Date {
  const clamped = Math.max(0, Math.min(windowMs / 1000, retryAfterSec));
  return new Date(now.getTime() - (windowMs - clamped * 1000));
}

export function formatForceCooldownLabel(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function forceAtMapStorageKey(tenantId: string): string {
  return `wedash.forceMap.${tenantId}`;
}

/** @deprecated legacy single-key  -  migrado em readForceAtMap */
export function forceLastAtStorageKey(tenantId: string): string {
  return `wedash.forceAt.${tenantId}`;
}

export function readForceAtMap(tenantId: string): ForceAtMap {
  try {
    const raw = localStorage.getItem(forceAtMapStorageKey(tenantId));
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const out: ForceAtMap = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string") out[k] = v;
        }
        return out;
      }
    }
    // Migra chave legada (cooldown tenant-wide)  ->  __all__
    const legacy = localStorage.getItem(forceLastAtStorageKey(tenantId));
    if (legacy) {
      const d = new Date(legacy);
      if (!Number.isNaN(d.getTime())) {
        const map = { [FORCE_ALL_KEY]: d.toISOString() };
        writeForceAtMap(tenantId, map);
        return map;
      }
    }
  } catch {
    /* private mode / quota */
  }
  return {};
}

export function writeForceAtMap(tenantId: string, map: ForceAtMap): void {
  try {
    localStorage.setItem(forceAtMapStorageKey(tenantId), JSON.stringify(map));
  } catch {
    /* private mode / quota */
  }
}

/** Registra FORCE bem-sucedido no mapa local (por loja ou rede). */
export function recordForceAt(
  tenantId: string,
  storeIds: string[],
  at: Date = new Date(),
): ForceAtMap {
  const map = { ...readForceAtMap(tenantId) };
  const iso = at.toISOString();
  if (storeIds.length === 0) {
    map[FORCE_ALL_KEY] = iso;
  } else {
    for (const id of storeIds) map[id] = iso;
  }
  writeForceAtMap(tenantId, map);
  return map;
}

/** Compat: ultimo FORCE "global" (so __all__ / legado). */
export function readForceLastAt(tenantId: string): Date | null {
  const map = readForceAtMap(tenantId);
  const raw = map[FORCE_ALL_KEY];
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function writeForceLastAt(tenantId: string, at: Date = new Date()): void {
  recordForceAt(tenantId, [], at);
}

/** FORCE enfileirado ainda QUEUED/RUNNING  -  sobrevive a fechar o PWA. */
export type PendingForceJob = {
  /** sync_job.id quando o enqueue devolveu. */
  jobId?: string;
  storeIds: string[];
  enqueuedAt: string;
};

export function forcePendingStorageKey(tenantId: string): string {
  return `wedash.forcePending.${tenantId}`;
}

export function readPendingForce(tenantId: string): PendingForceJob | null {
  try {
    const raw = localStorage.getItem(forcePendingStorageKey(tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const o = parsed as Record<string, unknown>;
    const enqueuedAt = typeof o.enqueuedAt === "string" ? o.enqueuedAt : "";
    if (!enqueuedAt) return null;
    const storeIds = Array.isArray(o.storeIds)
      ? o.storeIds.filter((x): x is string => typeof x === "string")
      : [];
    const jobId = typeof o.jobId === "string" && o.jobId ? o.jobId : undefined;
    return { jobId, storeIds, enqueuedAt };
  } catch {
    return null;
  }
}

export function writePendingForce(tenantId: string, job: PendingForceJob): void {
  try {
    localStorage.setItem(forcePendingStorageKey(tenantId), JSON.stringify(job));
  } catch {
    /* private mode / quota */
  }
}

export function clearPendingForce(tenantId: string): void {
  try {
    localStorage.removeItem(forcePendingStorageKey(tenantId));
  } catch {
    /* ignore */
  }
}

/** Saiu da conta: o Atualizar guardado neste aparelho não volta no próximo login. */
export function clearAllPendingForce(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith("wedash.forcePending.")) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
