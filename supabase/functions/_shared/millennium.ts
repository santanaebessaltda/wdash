/** Cliente HTTP do ERP Millennium (so server-side). */

export type LoginReason = "password" | "busy" | "other" | "stores" | "reports";

/** Relatorios personalizados (wtsreports) que o sync usa  -  usuario ERP precisa ter acesso. */
export const CUSTOM_REPORTS = [
  {
    key: "cupom",
    guid: "{52DE7BBC-78D4-7765-A232-A5MAD2840284}",
    name: "WE PINK - PRODUTOS POR CUPOM E VENDEDOR",
    params: { VENDA_MOVIMENTO_NFS: "", PRODUTO_PRODUTO_PRODUTO: null },
  },
] as const;

export type ReportCheck = { key: string; name: string; ok: boolean; error?: string };

/** Formato de loja exposto ao app (ingles). O mapeamento dos campos do ERP fica interno. */
export type MillenniumStore = {
  storeId: number;
  code: string;
  name: string;
  tradeName: string;
  taxId: string;
  city: string;
  state: string;
  franchise: string;
  type: "M" | "F";
  hasWpink: boolean;
  openedAt: string;
};

export function baseUrl(): string {
  const raw = Deno.env.get("MILLENNIUM_API_BASE")?.trim() || "http://177.85.160.35:6017/api";
  return raw.replace(/\/$/, "");
}

function classify401(body: string): LoginReason {
  const t = body.toLowerCase();
  if (t.includes("senha inválida") || t.includes("senha invalida")) return "password";
  if (
    t.includes("ultrapassado o máximo") ||
    t.includes("ultrapassado o maximo") ||
    t.includes("máximo de sess") ||
    t.includes("maximo de sess") ||
    t.includes("já está conectado") ||
    t.includes("ja esta conectado")
  ) {
    return "busy";
  }
  return "other";
}

function extractSession(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  for (const k of ["session", "Session", "SESSION", "token", "Token"]) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  if (o.data && typeof o.data === "object") return extractSession(o.data);
  return null;
}

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

function asStr(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  return String(v).trim();
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function asBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    return t === "true" || t === "1" || t === "s" || t === "sim";
  }
  return false;
}

export function mapStore(raw: unknown): MillenniumStore | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const storeId = asNum(pick(o, "FILIAL", "COD", "filial", "cod"));
  if (storeId == null) return null;
  const typeRaw = asStr(pick(o, "TIPO", "tipo"), "F").toUpperCase();
  const type: "M" | "F" = typeRaw.startsWith("M") ? "M" : "F";
  return {
    storeId,
    code: asStr(pick(o, "COD_FILIAL", "cod_filial", "codFilial"), String(storeId).padStart(5, "0")),
    name: asStr(pick(o, "NOME", "nome")),
    tradeName: asStr(pick(o, "FANTASIA", "fantasia")) || asStr(pick(o, "NOME", "nome")),
    taxId: asStr(pick(o, "CGC", "CNPJ", "cgc", "cnpj")),
    city: asStr(pick(o, "CIDADE", "cidade")),
    state: asStr(pick(o, "ESTADO", "UF", "estado", "uf")),
    franchise: asStr(pick(o, "FRANQUIA", "franquia"), "WEPINK"),
    type,
    hasWpink: asBool(pick(o, "WPINK", "wpink")),
    openedAt: asStr(pick(o, "DATA_INAUGURACAO", "data_inauguracao", "dataInauguracao")).slice(0, 10),
  };
}

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["value", "Value", "data", "Data", "items", "Items", "filiais", "Filiais", "d"]) {
    const v = o[k];
    if (Array.isArray(v)) return v;
  }
  // OData as vezes aninha value como string JSON
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

/** Headers + query no padrao do cliente Millennium (GET ?$format=json&$dateformat=iso). */
function sessionHeaders(session: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "WTS-Session": session,
  };
}

function methodUrl(path: string, extraQuery: Record<string, string> = {}): string {
  const q = new URLSearchParams({ $format: "json", $dateformat: "iso", ...extraQuery });
  return `${baseUrl()}/${path}?${q.toString()}`;
}

async function callList(
  session: string,
  paths: string[],
  extraQuery: Record<string, string> = {},
  bodyPost: Record<string, unknown> = {},
): Promise<{ parsed: unknown; path: string }> {
  const headers = sessionHeaders(session);
  let lastErr = "";

  // 1) GET  -  padrao do cliente millenium-go
  for (const path of paths) {
    try {
      const res = await fetch(methodUrl(path, extraQuery), { method: "GET", headers });
      const raw = await res.text();
      if (!res.ok) {
        lastErr = `GET ${path} → ${res.status} ${raw.slice(0, 240)}`;
        continue;
      }
      const parsed = raw ? JSON.parse(raw) : [];
      return { parsed, path };
    } catch (e) {
      lastErr = `GET ${path} → ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // 2) POST + X-HTTP-Method: GET (variante WTS)
  const headersPost = {
    ...headers,
    "X-HTTP-Method": "GET",
    "X-DateFormat": "ISOTZ",
    "X-IdentifierCase": "upper",
  };
  for (const path of paths) {
    try {
      const res = await fetch(`${baseUrl()}/${path}`, {
        method: "POST",
        headers: headersPost,
        body: JSON.stringify({ $top: 0, ...bodyPost }),
      });
      const raw = await res.text();
      if (!res.ok) {
        lastErr = `POST ${path} → ${res.status} ${raw.slice(0, 240)}`;
        continue;
      }
      const parsed = raw ? JSON.parse(raw) : [];
      return { parsed, path };
    } catch (e) {
      lastErr = `POST ${path} → ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  throw new Error(lastErr || "lista falhou");
}

export async function loginMillennium(
  username: string,
  password: string,
): Promise<{ ok: true; session: string } | { ok: false; reason: LoginReason; raw: string }> {
  const url = `${baseUrl()}/login?$format=json&$dateformat=iso`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "WTS-Authorization": `${username}/${password}`,
        "WTS-AppName": "millenium",
        "WTS-LicenceType": "retag",
      },
      body: "{}",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("login fetch falhou", msg);
    return { ok: false, reason: "other", raw: msg };
  }

  const raw = await res.text();
  console.log("login status", res.status, raw.slice(0, 300));
  if (res.status === 401) return { ok: false, reason: classify401(raw), raw };
  if (!res.ok) return { ok: false, reason: "other", raw };

  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    /* texto puro */
  }
  const session =
    extractSession(parsed) ?? (raw.trim().length > 0 && !raw.trim().startsWith("{") ? raw.trim() : null);
  if (!session) return { ok: false, reason: "other", raw: raw || "login sem session" };
  return { ok: true, session };
}

export async function logoutMillennium(session: string): Promise<void> {
  try {
    await fetch(`${baseUrl()}/logout?$format=json&$dateformat=iso`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "WTS-Session": session,
      },
      body: "{}",
    });
  } catch {
    /* best-effort */
  }
}

function errorText(raw: string): string {
  try {
    const o = JSON.parse(raw) as { error?: { message?: { value?: string } | string } };
    const m = o.error?.message;
    const v = typeof m === "string" ? m : m?.value;
    if (v) return v.replace(/^Remote Call Error:\([^)]*\)\s*\(\w+\)\s*/i, "").trim().slice(0, 200);
  } catch {
    /* texto puro */
  }
  return raw.slice(0, 200);
}

/**
 * Smoke de cada relatorio personalizado: filial vazia + 01/01/2000  ->  resposta leve.
 * 200 com `RAW_DATA` = acesso ok; qualquer outra resposta = sem acesso / nao existe.
 */
export async function checkCustomReports(session: string): Promise<ReportCheck[]> {
  const base = baseUrl();
  const origin = base.replace(/\/api\/?$/, "");
  const headers = {
    Accept: "*/*",
    "Content-Type": "application/json",
    Origin: origin,
    Referer: `${origin}/files/web-apps/millennium.html`,
    "WTS-Session": session,
    "X-DateFormat": "ISOTZ",
    "X-HTTP-Method": "POST",
    "X-IdentifierCase": "upper",
  };
  return await Promise.all(
    CUSTOM_REPORTS.map(async (r): Promise<ReportCheck> => {
      try {
        const res = await fetch(`${base}/millenium:wtsreports/reports/process`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            CATALOG_GUID: r.guid,
            PARAMETERS_MODEL: [
              {
                SCRIPT: null,
                DATASOURCE: null,
                DATA_DATA_DATA_INTERVAL: 0,
                DATA_DATA_DATA_START: "2000-01-01",
                DATA_DATA_DATA_END: "2000-01-01",
                FILIAL_GERADOR_GERADOR: null,
                ...r.params,
              },
            ],
            UNIVERSE_NAME: "millenium.mdu",
            REPORT_FORMAT: "raw",
          }),
          signal: AbortSignal.timeout(45_000),
        });
        const raw = await res.text();
        if (!res.ok) return { key: r.key, name: r.name, ok: false, error: errorText(raw) };
        const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        if (!Array.isArray(parsed.RAW_DATA)) {
          return { key: r.key, name: r.name, ok: false, error: "resposta sem dados" };
        }
        return { key: r.key, name: r.name, ok: true };
      } catch (e) {
        return { key: r.key, name: r.name, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
}

const STORE_PATHS = ["millenium.filiais.lista", "millennium.filiais.lista", "Millennium.FILIAIS.Lista"];

export async function listMillenniumStores(session: string): Promise<MillenniumStore[]> {
  const { parsed, path } = await callList(session, STORE_PATHS, { $top: "0" });
  const list = extractList(parsed)
    .map(mapStore)
    .filter((s): s is MillenniumStore => s != null);
  console.log("STORES via", path, "qtd", list.length);
  return list;
}
