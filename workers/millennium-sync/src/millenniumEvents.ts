/**
 * EVENTOS.ListaTodos  ->  IDs used as VENDAS.Lista EVENTO filter "(17,24,...)".
 *
 * Franchise sales screens filter to S-X, S-03 plus S-{COD_FILIAL}
 * (e.g. filial 00010  ->  S-10). S-100 fica de fora (movimentacoes que
 * inflavam o faturamento vs o BI). Sem o filtro, Lista devolve
 * transferencias / outros eventos.
 */

export type MillenniumEvent = {
  id: number;
  /** Display / code e.g. "S-10", "S-X" */
  label: string;
};

export type FetchEventosParams = {
  session: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null) return o[k];
  }
  const lower = Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function asStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["value", "Value", "data", "Data", "items", "Items", "d"]) {
    const v = o[k];
    if (Array.isArray(v)) return v;
  }
  if (typeof o.value === "string") {
    try {
      const inner = JSON.parse(o.value);
      if (Array.isArray(inner)) return inner;
    } catch {
      /* ignore */
    }
  }
  return [];
}

function defaultBaseUrl(): string {
  return (process.env.MILLENNIUM_API_BASE ?? "http://127.0.0.1:6017/api").replace(/\/$/, "");
}

/** Global + per-store event labels for VENDAS.Lista (COD_FILIAL "00010"  ->  S-10). */
export function salesEventLabelsForStore(codFilial: string): string[] {
  const stripped = String(Number(String(codFilial).trim() || "0"));
  const labels = new Set(["S-X", "S-03", `S-${stripped}`]);
  return [...labels];
}

export function mapEventosListaPayload(payload: unknown): MillenniumEvent[] {
  const out: MillenniumEvent[] = [];
  for (const raw of extractList(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const id = asNum(pick(o, "EVENTO", "COD", "COD_EVENTO", "evento", "cod"));
    if (id == null) continue;
    const label =
      asStr(pick(o, "CODIGO", "COD_EVENTO", "DESCRICAO", "DESC", "NOME", "codigo", "descricao")) ||
      String(id);
    out.push({ id, label });
  }
  return out;
}

/** Pick EVENTO ids whose label matches the store sales whitelist (case-insensitive). */
export function resolveSalesEventIds(
  events: MillenniumEvent[],
  codFilial: string,
): number[] {
  const wanted = new Set(
    salesEventLabelsForStore(codFilial).map((l) => l.toUpperCase()),
  );
  const ids = new Set<number>();
  for (const e of events) {
    const label = e.label.toUpperCase().trim();
    // Exact match or label starts with "S-10 " / contains as token
    if (wanted.has(label)) {
      ids.add(e.id);
      continue;
    }
    const token = label.split(/\s+/)[0] ?? "";
    if (wanted.has(token)) ids.add(e.id);
  }
  return [...ids].sort((a, b) => a - b);
}

/** True se o cache tem todos os codigos S-* necessarios para a loja. */
export function salesEventLabelsCovered(
  events: MillenniumEvent[],
  codFilial: string,
): boolean {
  const wanted = salesEventLabelsForStore(codFilial).map((l) => l.toUpperCase());
  if (wanted.length === 0) return true;
  const covered = new Set<string>();
  for (const e of events) {
    const label = e.label.toUpperCase().trim();
    const token = (label.split(/\s+/)[0] ?? "").toUpperCase();
    for (const w of wanted) {
      if (label === w || token === w) covered.add(w);
    }
  }
  return wanted.every((w) => covered.has(w));
}

/** Normaliza label  ->  codigo curto (S-10) pra PK. */
export function eventCodeFromLabel(label: string): string {
  const t = label.trim().toUpperCase();
  if (!t) return "";
  return (t.split(/\s+/)[0] ?? t).trim();
}

/** Format for VENDAS.Lista body: EVENTO: "(17,24,22,107)" */
export function formatEventoFilter(ids: number[]): string {
  return `(${ids.join(",")})`;
}

/**
 * GET millenium.EVENTOS.ListaTodos (body + X-HTTP-Method, same as UI).
 */
export async function fetchEventosListaTodos(params: FetchEventosParams): Promise<MillenniumEvent[]> {
  const base = (params.baseUrl ?? defaultBaseUrl()).replace(/\/$/, "");
  const fetchImpl = params.fetchImpl ?? fetch;
  const timeoutMs = Number(process.env.MILLENNIUM_FETCH_TIMEOUT_MS ?? "300000") || 300_000;
  const paths = ["millenium.EVENTOS.ListaTodos", "EVENTOS.ListaTodos", "Millennium.EVENTOS.ListaTodos"];
  let lastErr = "";

  const body = {
    TIPO: null,
    TIPO_EVENTO: null,
    TIPO_ENTRADA: null,
    TIPO_SAIDA: null,
    TIPO_INTERFACE: null,
    FILIAIS_PERMITIDAS: null,
  };

  for (const path of paths) {
    const url = `${base}/${path}`;
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-HTTP-Method": "GET",
          "X-DateFormat": "ISOTZ",
          "X-IdentifierCase": "upper",
          "WTS-Session": params.session,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await res.text();
      if (!res.ok) {
        lastErr = `GET ${path} → ${res.status} ${raw.slice(0, 240)}`;
        continue;
      }
      const parsed = raw ? JSON.parse(raw) : [];
      return mapEventosListaPayload(parsed);
    } catch (e) {
      lastErr = `GET ${path} → ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  throw new Error(lastErr || "EVENTOS.ListaTodos failed");
}
