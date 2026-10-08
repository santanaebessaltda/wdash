/** Timing helpers for sync progress logs. */

export function nowMs(): number {
  return Date.now();
}

/** Ex.: 240ms  |  1.4s  |  23s */
export function formatElapsed(startedMs: number, endedMs = Date.now()): string {
  const ms = Math.max(0, Math.round(endedMs - startedMs));
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) {
    const s = ms / 1000;
    return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
  }
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${String(s).padStart(2, "0")}s`;
}

/** Tempo gasto em chamadas ao Millennium, por etapa (ordem de chegada). */
export class StepTimings {
  private readonly steps = new Map<string, { ms: number; calls: number }>();

  add(step: string, ms: number, calls = 1): void {
    const cur = this.steps.get(step) ?? { ms: 0, calls: 0 };
    cur.ms += Math.max(0, ms);
    cur.calls += calls;
    this.steps.set(step, cur);
  }

  /** Mede `fn` como 1 chamada da etapa (conta mesmo se falhar). */
  async time<T>(step: string, fn: () => Promise<T>): Promise<T> {
    const t = nowMs();
    try {
      return await fn();
    } finally {
      this.add(step, nowMs() - t);
    }
  }

  entries(): Array<[string, { ms: number; calls: number }]> {
    return [...this.steps.entries()].map(([step, v]) => [step, { ...v }]);
  }

  get isEmpty(): boolean {
    return this.steps.size === 0;
  }

  totalMs(): number {
    let ms = 0;
    for (const s of this.steps.values()) ms += s.ms;
    return ms;
  }

  totalCalls(): number {
    let n = 0;
    for (const s of this.steps.values()) n += s.calls;
    return n;
  }

  /** Linhas "Etapa  |  N chamada(s)  |  tempo  |  media". */
  lines(): string[] {
    return [...this.steps.entries()].map(([step, { ms, calls }]) => {
      const avg = calls > 0 ? ` · média ${formatElapsed(0, ms / calls)}` : "";
      return `${step} · ${calls} chamada${calls === 1 ? "" : "s"} · ${formatElapsed(0, ms)}${avg}`;
    });
  }
}
