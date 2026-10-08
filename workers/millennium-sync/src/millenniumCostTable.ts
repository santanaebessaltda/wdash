/**
 * Tabelas de custo do Millennium.
 * - Lista: lookup `tabela_custo.TABELA` (8 tabelas na rede: CUSTO, SP, RJ E MG, CENTRO OESTE...).
 * - Custos: wtsreports {9701602B} com `TABELA_DE_CUSTO` e filial vazia = tabela inteira (~545 codigos, ~3s).
 *   `F_3814918930` = custo unitario; `F_453092731` = custo x estoque (ignorado).
 *   Mesmo codigo em varias cores  ->  fica o maior custo.
 */
import { millenniumBaseUrl } from "./millenniumAuth.ts";
import { PRODUCT_DIVISION_CATALOG_GUID } from "./millenniumProductDivision.ts";

export type CostTable = { tableId: number; code: string; description: string };

function rowsOf(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["RAW_DATA", "value", "Value", "data", "Data"]) {
    if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
  }
  return [];
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function parseCostTables(payload: unknown): CostTable[] {
  const out: CostTable[] = [];
  for (const r of rowsOf(payload)) {
    const id = asNum(r.TABELA_CUSTO_TABELA);
    if (id == null) continue;
    out.push({
      tableId: id,
      code: String(r.TABELA_CUSTO_CODIGO ?? "").trim(),
      description: String(r.TABELA_CUSTO_DESCRICAO ?? "").trim(),
    });
  }
  return out;
}

/** COD_PRODUTO  ->  custo unitario em centavos (so > 0). */
export function parseCostTablePrices(payload: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rowsOf(payload)) {
    const code = String(r.PRODUTO_PRODUTO_COD_PRODUTO ?? "").trim();
    const unit = asNum(r.F_3814918930);
    if (!code || unit == null || unit <= 0) continue;
    const cents = Math.round(unit * 100);
    if (cents > (out.get(code) ?? 0)) out.set(code, cents);
  }
  return out;
}

export async function fetchCostTables(opts: {
  session: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<CostTable[]> {
  const base = (opts.baseUrl ?? millenniumBaseUrl()).replace(/\/$/, "");
  const res = await (opts.fetchImpl ?? fetch)(`${base}/millenium?$lookup=tabela_custo.TABELA&$top=501`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "WTS-Session": opts.session,
      "X-HTTP-Method": "GET",
      "X-IdentifierCase": "upper",
      "X-DateFormat": "ISOTZ",
    },
    body: JSON.stringify({
      SCRIPT: null,
      DATASOURCE: null,
      TABELA_CUSTO_TABELA: null,
      _DETAILS: true,
      PARAM_6: null,
      PARAM_7: null,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`tabela_custo lookup → ${res.status} ${text.slice(0, 200)}`);
  return parseCostTables(text ? JSON.parse(text) : []);
}

export async function fetchCostTablePrices(opts: {
  session: string;
  tableId: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<Map<string, number>> {
  const base = (opts.baseUrl ?? millenniumBaseUrl()).replace(/\/$/, "");
  const origin = base.replace(/\/api\/?$/, "");
  const res = await (opts.fetchImpl ?? fetch)(`${base}/millenium:wtsreports/reports/process`, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      Origin: origin,
      Referer: `${origin}/files/web-apps/millennium.html`,
      "WTS-Session": opts.session,
      "X-DateFormat": "ISOTZ",
      "X-HTTP-Method": "POST",
      "X-IdentifierCase": "upper",
    },
    body: JSON.stringify({
      CATALOG_GUID: PRODUCT_DIVISION_CATALOG_GUID,
      PARAMETERS_MODEL: [
        {
          SCRIPT: null,
          DATASOURCE: null,
          TABELA_DE_CUSTO: opts.tableId,
          FILIAL_GERADOR_GERADOR: "",
          PRODUTO_DIVISAO_DIVISAO: null,
        },
      ],
      UNIVERSE_NAME: "millenium.mdu",
      REPORT_FORMAT: "raw",
      PARAMETERS_DESCRIPTION: `Tabela=${opts.tableId}`,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`tabela de custo ${opts.tableId} → ${res.status} ${text.slice(0, 200)}`);
  return parseCostTablePrices(text ? JSON.parse(text) : []);
}
