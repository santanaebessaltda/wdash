/**
 * RELATORIOMARGEM  -  fonte de CMV (custo de mercadoria) e split WEPINK/WPINK (COD WP*).
 *
 * ERP UI / path: **FRANQUIAS > RELATORIOS > RELATORIOMARGEM**
 * API: MILLENIUM!FRANQUIAS.RELATORIOS.RELATORIOMARGEM
 *
 * CMV v1 =  CUSTO_TOTAL (= CUSTO_FRANQUIAS x QTDE_VENDIDA), imposto% = 0.
 * Marca = COD_PRODUTO WP*  ->  WPINK; senao WEPINK (TOTALVENDA). Substitui TOTAL VENDA POR DIA.
 * TODO(Configuracoes>Custos): aplicar imposto_sobre_custo_pct por loja.
 */
import type { SalesDayAgg, SalesProductCostDayAgg } from "../../../src/data/wedash/salesTypes.ts";
import { millenniumBaseUrl } from "./millenniumAuth.ts";
import { milleniumDayBoundIso } from "./millenniumSales.ts";

export const RELATORIO_MARGEM_PATH = "MILLENIUM!FRANQUIAS.RELATORIOS.RELATORIOMARGEM";

/**
 * RELATORIOMARGEM trata DATAI/DATAF como **datas de calendario inclusivas**
 * (UI: Data Inicial  ->  Data Final). DATAF = meia-noite do dia seguinte puxa o dia
 * seguinte e dobra o CMV no somatorio dia a dia.
 */
export function milleniumMargemDataRange(
  from: string,
  to: string,
): { datai: string; dataf: string } {
  return {
    datai: milleniumDayBoundIso(from),
    dataf: milleniumDayBoundIso(to),
  };
}

export type MargemLine = {
  codProduto: string;
  qty: number;
  /** Custo unitario fabrica (reais). */
  custoFranquias: number;
  /** CUSTO_TOTAL = custoFranquias x qty (reais). */
  custoTotal: number;
  totalVenda: number;
};

export type FetchRelatorioMargemParams = {
  session: string;
  millenniumStoreId: number;
  from: string;
  to: string;
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

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function asStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["value", "Value", "data", "Data", "items", "Items", "RAW_DATA"]) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [];
}

/** Parse payload  ->  linhas de produto (ignora TOTALVENDA como faturamento). */
export function parseRelatorioMargemPayload(payload: unknown): MargemLine[] {
  const out: MargemLine[] = [];
  for (const raw of extractList(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const cod = asStr(pick(o, "COD_PRODUTO", "cod_produto"));
    const qty = asNum(pick(o, "QTDE_VENDIDA", "qtde_vendida")) ?? 0;
    const custoFranquias = asNum(pick(o, "CUSTO_FRANQUIAS", "custo_franquias")) ?? 0;
    let custoTotal = asNum(pick(o, "CUSTO_TOTAL", "custo_total"));
    if (custoTotal == null) custoTotal = custoFranquias * qty;
    const totalVenda = asNum(pick(o, "TOTALVENDA", "totalvenda")) ?? 0;
    if (!cod && qty === 0 && custoTotal === 0) continue;
    out.push({
      codProduto: cod,
      qty,
      custoFranquias,
      custoTotal,
      totalVenda,
    });
  }
  return out;
}

/** Soma CMV do periodo em centavos (imposto% = 0 nesta versao). */
export function cmvCentsFromMargemLines(lines: MargemLine[]): number {
  let reais = 0;
  for (const line of lines) {
    reais += line.custoTotal;
  }
  return Math.round(reais * 100);
}

/**
 * COD_PRODUTO  ->  marca. WPINK = prefixo WP* (ex.: WP002, WP055).
 * Validado vs TOTAL VENDA POR DIA (diff 0% em 00205 set/26).
 */
export function brandFromCodProduto(cod: string): "WEPINK" | "WPINK" {
  const t = cod.trim().toUpperCase();
  if (/^WP[\dA-Z]/.test(t) || t === "WP" || t.startsWith("WP ")) return "WPINK";
  return "WEPINK";
}

/**
 * Linhas da margem de 1 dia  ->  sales_day_agg WEPINK/WPINK
 * (receita = TOTALVENDA, CMV = CUSTO_TOTAL; counts = 0).
 */
export function brandDayAggsFromMargemLines(
  lines: MargemLine[],
  opts: { tenantId: string; storeId: string; day: string },
): SalesDayAgg[] {
  let wepinkRev = 0;
  let wpinkRev = 0;
  let wepinkCmv = 0;
  let wpinkCmv = 0;
  for (const line of lines) {
    const rev = Math.round(line.totalVenda * 100);
    const cmv = Math.round(line.custoTotal * 100);
    if (brandFromCodProduto(line.codProduto) === "WPINK") {
      wpinkRev += rev;
      wpinkCmv += cmv;
    } else {
      wepinkRev += rev;
      wepinkCmv += cmv;
    }
  }
  const out: SalesDayAgg[] = [];
  if (wepinkRev > 0 || wepinkCmv > 0) {
    out.push({
      tenantId: opts.tenantId,
      storeId: opts.storeId,
      day: opts.day,
      brand: "WEPINK",
      revenueCents: wepinkRev,
      salesCount: 0,
      itemCount: 0,
      cmvCents: wepinkCmv,
    });
  }
  if (wpinkRev > 0 || wpinkCmv > 0) {
    out.push({
      tenantId: opts.tenantId,
      storeId: opts.storeId,
      day: opts.day,
      brand: "WPINK",
      revenueCents: wpinkRev,
      salesCount: 0,
      itemCount: 0,
      cmvCents: wpinkCmv,
    });
  }
  return out;
}

/** Linhas da margem de 1 dia  ->  CMV por COD_PRODUTO (sales_product_cost_day_agg). */
export function productCostDayAggsFromMargemLines(
  lines: MargemLine[],
  opts: { tenantId: string; storeId: string; day: string },
): SalesProductCostDayAgg[] {
  const map = new Map<string, { qty: number; rev: number; cmv: number }>();
  for (const line of lines) {
    const code = line.codProduto.trim();
    if (!code) continue;
    const acc = map.get(code) ?? { qty: 0, rev: 0, cmv: 0 };
    acc.qty += line.qty;
    acc.rev += line.totalVenda;
    acc.cmv += line.custoTotal;
    map.set(code, acc);
  }
  return [...map.entries()].map(([productCode, v]) => ({
    tenantId: opts.tenantId,
    storeId: opts.storeId,
    day: opts.day,
    productCode,
    itemCount: v.qty,
    revenueCents: Math.round(v.rev * 100),
    cmvCents: Math.round(v.cmv * 100),
  }));
}

export async function fetchRelatorioMargem(
  params: FetchRelatorioMargemParams,
): Promise<MargemLine[]> {
  const base = (params.baseUrl ?? millenniumBaseUrl()).replace(/\/$/, "");
  const fetchImpl = params.fetchImpl ?? fetch;
  const { datai, dataf } = milleniumMargemDataRange(params.from, params.to);
  const body = {
    FILIAL: params.millenniumStoreId,
    DESC: null,
    DATAI: datai,
    DATAF: dataf,
    TIPO: null,
  };
  const res = await fetchImpl(`${base}/${RELATORIO_MARGEM_PATH}`, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      "WTS-Session": params.session,
      "X-DateFormat": "ISOTZ",
      "X-HTTP-Method": "GET",
      "X-IdentifierCase": "upper",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`RELATORIOMARGEM ${params.from}→${params.to} → ${res.status} ${text.slice(0, 240)}`);
  }
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : [];
  } catch {
    throw new Error(`RELATORIOMARGEM JSON inválido: ${text.slice(0, 120)}`);
  }
  return parseRelatorioMargemPayload(parsed);
}
