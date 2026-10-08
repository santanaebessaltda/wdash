/**
 * Faturamento por marca via wtsreports.
 *
 * ERP UI: **TOTAL VENDA POR DIA**
 * CATALOG_GUID: {70F9DE61-9CA7-4798-864F-B40B74E61BE5}
 *
 * VENDAS.Lista nao traz marca  -  este relatorio popula sales_day_agg WEPINK/WPINK.
 */
import type { SalesBrand, SalesDayAgg } from "../../../src/data/wedash/salesTypes.ts";
import { millenniumBaseUrl } from "./millenniumAuth.ts";

export const BRAND_REVENUE_CATALOG_GUID = "{70F9DE61-9CA7-4798-864F-B40B74E61BE5}";

export type FilialGeradorRow = {
  geradorId: number;
  code: string;
  name: string;
};

export type BrandReportDayRow = {
  /** Local calendar day YYYY-MM-DD (MS midnight  ->  day). */
  day: string;
  /** Total receita do dia (todas as marcas no array). */
  totalReais: number;
  /** Pares marca  ->  receita em R$. */
  byBrand: Array<{ label: string; revenueReais: number }>;
};

function reportHeaders(session: string, base: string): Record<string, string> {
  const origin = base.replace(/\/api\/?$/, "");
  return {
    Accept: "*/*",
    "Content-Type": "application/json",
    Origin: origin,
    Referer: `${origin}/files/web-apps/millennium.html`,
    "WTS-Session": session,
    "X-DateFormat": "ISOTZ",
    "X-HTTP-Method": "POST",
    "X-IdentifierCase": "upper",
  };
}

/** `"22396.27" "0" `  ->  ["22396.27", "0"] */
export function parseQuotedArray(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
  const s = String(raw);
  const out: string[] = [];
  const re = /"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[1]);
  return out;
}

/** "WEPINK"  ->  WEPINK; "WPINK SUPLEMENTOS" / "WPINK ..."  ->  WPINK. */
export function normalizeBrandLabel(label: string): SalesBrand | null {
  const t = label.trim().toUpperCase();
  if (!t) return null;
  if (t === "WEPINK" || t.startsWith("WEPINK")) return "WEPINK";
  if (t === "WPINK" || t.startsWith("WPINK")) return "WPINK";
  return null;
}

function reaisToCents(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100);
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Math.round(Number(v) * 100);
  }
  return 0;
}

/**
 * Instant ISO do relatorio  ->  YYYY-MM-DD civil.
 * O wtsreports emite meia-noite local como T03:00Z (SP) ou T04:00Z (MS);
 * +12h e pega a data UTC evita cair no dia anterior.
 */
export function reportInstantToDay(iso: unknown): string | null {
  const s = String(iso ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 12 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function parseBrandReportRawData(payload: unknown): BrandReportDayRow[] {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const list = Array.isArray(root.RAW_DATA)
    ? root.RAW_DATA
    : Array.isArray(payload)
      ? payload
      : [];
  const out: BrandReportDayRow[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const day = reportInstantToDay(o.DATA_DATA_DATA ?? o.data_data_data);
    if (!day) continue;
    const labels = parseQuotedArray(o.ARRAY_PRODUTO_MARCA_DESCRICAO ?? o.array_produto_marca_descricao);
    const values = parseQuotedArray(o.ARRAY_F_366619977 ?? o.array_f_366619977);
    const byBrand: BrandReportDayRow["byBrand"] = [];
    const n = Math.max(labels.length, values.length);
    for (let i = 0; i < n; i++) {
      const label = labels[i] ?? "";
      const revenueReais = Number(values[i] ?? 0);
      if (!label && !revenueReais) continue;
      byBrand.push({ label, revenueReais: Number.isFinite(revenueReais) ? revenueReais : 0 });
    }
    const totalRaw = o.F_366619977 ?? o.f_366619977;
    const totalReais =
      typeof totalRaw === "number"
        ? totalRaw
        : byBrand.reduce((a, b) => a + b.revenueReais, 0);
    out.push({ day, totalReais, byBrand });
  }
  return out;
}

/** Converte linhas do relatorio  ->  sales_day_agg WEPINK/WPINK (so receita; count/itens = 0). */
export function brandReportToDayAggs(
  rows: BrandReportDayRow[],
  opts: { tenantId: string; storeId: string },
): SalesDayAgg[] {
  const map = new Map<string, SalesDayAgg>();
  for (const row of rows) {
    for (const part of row.byBrand) {
      const brand = normalizeBrandLabel(part.label);
      if (!brand) continue;
      const key = `${row.day}|${brand}`;
      const prev = map.get(key);
      const cents = reaisToCents(part.revenueReais);
      if (prev) {
        prev.revenueCents += cents;
      } else {
        map.set(key, {
          tenantId: opts.tenantId,
          storeId: opts.storeId,
          day: row.day,
          brand,
          revenueCents: cents,
          salesCount: 0,
          itemCount: 0,
        });
      }
    }
  }
  return [...map.values()].sort((a, b) =>
    a.day === b.day ? a.brand.localeCompare(b.brand) : a.day.localeCompare(b.day),
  );
}

/**
 * Mantem receita do relatorio e aplica salesCount/itemCount da fonte (DetMov day aggs).
 * So altera linhas WEPINK/WPINK presentes em `reportDays`.
 */
export function applyBrandDayCounts(
  reportDays: SalesDayAgg[],
  countSource: SalesDayAgg[],
): SalesDayAgg[] {
  const byKey = new Map<string, { salesCount: number; itemCount: number }>();
  for (const c of countSource) {
    if (c.brand !== "WEPINK" && c.brand !== "WPINK") continue;
    const k = `${c.day}|${c.brand}`;
    const prev = byKey.get(k) ?? { salesCount: 0, itemCount: 0 };
    prev.salesCount += c.salesCount;
    prev.itemCount += c.itemCount;
    byKey.set(k, prev);
  }
  return reportDays.map((d) => {
    const c = byKey.get(`${d.day}|${d.brand}`);
    if (!c) return d;
    return { ...d, salesCount: c.salesCount, itemCount: c.itemCount };
  });
}

/**
 * Loja so cosmetico (sem WPINK): todas as vendas da Lista sao WEPINK  - 
 * copia counts do ALL para as linhas WEPINK do relatorio.
 */
export function applyAllCountsToWepinkDays(
  reportDays: SalesDayAgg[],
  allDays: SalesDayAgg[],
): SalesDayAgg[] {
  const byDay = new Map<string, { salesCount: number; itemCount: number }>();
  for (const a of allDays) {
    if (a.brand !== "ALL") continue;
    const prev = byDay.get(a.day) ?? { salesCount: 0, itemCount: 0 };
    prev.salesCount += a.salesCount;
    prev.itemCount += a.itemCount;
    byDay.set(a.day, prev);
  }
  return reportDays.map((d) => {
    if (d.brand !== "WEPINK") return d;
    const c = byDay.get(d.day);
    if (!c) return d;
    return { ...d, salesCount: c.salesCount, itemCount: c.itemCount };
  });
}

export async function fetchFilialGeradorMap(opts: {
  session: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<Map<string, number>> {
  const base = (opts.baseUrl ?? millenniumBaseUrl()).replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${base}/millenium?$lookup=filial.GERADOR.gerador&$format=json&$dateformat=iso`;
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "*/*",
      "WTS-Session": opts.session,
      "X-DateFormat": "ISOTZ",
      "X-IdentifierCase": "upper",
    },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`filial.GERADOR.gerador  ->  ${res.status} ${text.slice(0, 240)}`);
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : [];
  } catch {
    throw new Error(`filial.GERADOR.gerador JSON invalido: ${text.slice(0, 240)}`);
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (() => {
          const o = parsed as Record<string, unknown>;
          for (const k of ["value", "Value", "data", "Data", "d"]) {
            if (Array.isArray(o[k])) return o[k] as unknown[];
          }
          return [];
        })()
      : [];
  const map = new Map<string, number>();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const code = String(o.FILIAL_GERADOR_COD_FILIAL ?? o.filial_gerador_cod_filial ?? "").trim();
    const g = o.FILIAL_GERADOR_GERADOR ?? o.filial_gerador_gerador;
    const geradorId = typeof g === "number" ? g : typeof g === "string" && /^\d+$/.test(g) ? Number(g) : null;
    if (!code || geradorId == null) continue;
    map.set(code, geradorId);
  }
  return map;
}

export type FetchBrandRevenueParams = {
  session: string;
  /** Um ou mais geradores  -  para por-loja, passar so 1. */
  geradorIds: number[];
  /** Inclusive YYYY-MM-DD (fuso loja). */
  from: string;
  to: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

/**
 * Relatorio de faturamento por marca (rapido).
 * INTERVAL 0 = "Outro" (custom)  -  START/END visiveis (format D = YYYY-MM-DD).
 * INTERVAL 3 = "Este Mes" (ignora START/END).
 */
export async function fetchBrandRevenueReport(
  params: FetchBrandRevenueParams,
): Promise<BrandReportDayRow[]> {
  if (params.geradorIds.length === 0) return [];
  const base = (params.baseUrl ?? millenniumBaseUrl()).replace(/\/$/, "");
  const fetchImpl = params.fetchImpl ?? fetch;
  const body = {
    CATALOG_GUID: BRAND_REVENUE_CATALOG_GUID,
    PARAMETERS_MODEL: [
      {
        SCRIPT: null,
        DATASOURCE: null,
        FILIAL_GERADOR_GERADOR: `(${params.geradorIds.join(",")})`,
        /** 0 = Outro (custom); START/END so entram com interval=0. */
        DATA_DATA_DATA_INTERVAL: 0,
        DATA_DATA_DATA_START: params.from,
        DATA_DATA_DATA_END: params.to,
        FUNCIONARIO_GERADOR_GERADOR: null,
      },
    ],
    UNIVERSE_NAME: "millenium.mdu",
    REPORT_FORMAT: "raw",
    PARAMETERS_DESCRIPTION: `Filial=(${params.geradorIds.join(",")}) Data=${params.from}..${params.to}`,
  };
  const res = await fetchImpl(`${base}/millenium:wtsreports/reports/process`, {
    method: "POST",
    headers: reportHeaders(params.session, base),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`wtsreports brand → ${res.status} ${text.slice(0, 320)}`);
  }
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`wtsreports brand JSON inválido: ${text.slice(0, 240)}`);
  }
  return parseBrandReportRawData(parsed);
}
