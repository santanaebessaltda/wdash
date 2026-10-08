/**
 * Itens por cupom via wtsreports personalizado  -  substitui o ConsultaDetMov (1 chamada por cupom)
 * e o top produtos {E7A5C5C7}: 1 chamada por loja x periodo.
 *
 * ERP UI: **WE PINK - PRODUTOS POR CUPOM E VENDEDOR**
 * CATALOG_GUID: {52DE7BBC-78D4-7765-A232-A5MAD2840284}
 *
 * Linha = cupom x produto. Chave do cupom = `COD_OPERACAO|NF|TIPO` (igual a da Lista / cache DetMov).
 * Marca pelo codigo do produto (WP* = WPINK; resto = WEPINK). Vendedora pelo gerador.
 * Nao traz venda sem vendedora  ->  quem chama faz fallback (DetMov so desses cupons).
 */
import { sellerKeyFromName } from "../../../src/data/wedash/salesAggregate.ts";
import type { SalesProductDayAgg, SalesSellerProductDayAgg } from "../../../src/data/wedash/salesTypes.ts";
import { millenniumBaseUrl } from "./millenniumAuth.ts";
import { brandFromCodProduto } from "./millenniumMargem.ts";
import { couponKey, type BrandSplitHeader, type CouponBrand } from "./brandSplitFromDetalhe.ts";

export const COUPON_REPORT_GUID = "{52DE7BBC-78D4-7765-A232-A5MAD2840284}";

export type CouponReportLine = {
  couponKey: string;
  /** DATA_DATA_DATA (so a data); null quando o ERP nao manda. */
  day: string | null;
  productId: number;
  productCode: string;
  productName: string;
  qty: number;
  revenueCents: number;
  sellerGeradorId: number | null;
  sellerName: string;
  /** Tabela de preco de venda usada no cupom (VENDA_TABELA_PRECO_TABELA); null = sem tabela / INDEFINIDO. */
  priceTableId?: number | null;
  priceTableName?: string;
};

export type CouponSeller = { geradorId: number; name: string };

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

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["RAW_DATA", "value", "Value", "data", "Data"]) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [];
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function asStr(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function asBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = asStr(v).toLowerCase();
  return s === "true" || s === "s" || s === "1";
}

function asDay(v: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(asStr(v));
  return m ? m[1]! : null;
}

/** RAW_DATA do {52DE7BBC}  -  ignora cancelados e linhas sem cupom/produto. */
export function parseCouponReportRawData(payload: unknown): CouponReportLine[] {
  const out: CouponReportLine[] = [];
  for (const raw of extractList(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    if (asBool(o.VENDA_MOVIMENTO_CANCELADA)) continue;
    const opCode = asNum(o.VENDA_MOVIMENTO_COD_OPERACAO);
    const nf = asStr(o.VENDA_MOVIMENTO_NFS);
    const productId = asNum(o.PRODUTO_PRODUTO_PRODUTO);
    if (opCode == null || !nf || productId == null) continue;
    const qty = asNum(o.F_3887607047) ?? 0;
    const revenue = asNum(o.F_366619977) ?? 0;
    if (qty === 0 && revenue === 0) continue;
    const tipo = asStr(o.VENDA_MOVIMENTO_TIPO_OPERACAO) || "S";
    const gerador = asNum(o.FUNCIONARIO_GERADOR_GERADOR);
    const priceTable = asNum(o.VENDA_TABELA_PRECO_TABELA);
    out.push({
      couponKey: couponKey({ millenniumOpCode: opCode, nf, tipoOperacao: tipo }),
      day: asDay(o.DATA_DATA_DATA),
      productId,
      productCode: asStr(o.PRODUTO_PRODUTO_COD_PRODUTO),
      productName: asStr(o.PRODUTO_PRODUTO_DESCRICAO1),
      qty,
      revenueCents: Math.round(revenue * 100),
      sellerGeradorId: gerador != null && gerador > 0 ? gerador : null,
      sellerName: asStr(o.FUNCIONARIO_GERADOR_NOME),
      priceTableId: priceTable != null && priceTable > 0 ? priceTable : null,
      priceTableName: asStr(o.VENDA_TABELA_PRECO_DESCRICAO),
    });
  }
  return out;
}

/** Linhas agrupadas por cupom. */
export function groupCouponLines(lines: CouponReportLine[]): Map<string, CouponReportLine[]> {
  const out = new Map<string, CouponReportLine[]>();
  for (const line of lines) {
    const list = out.get(line.couponKey);
    if (list) list.push(line);
    else out.set(line.couponKey, [line]);
  }
  return out;
}

/** Resumo WEPINK/WPINK de um cupom da Lista (hora = a da Lista). */
export function couponBrandFromReportLines(
  header: BrandSplitHeader,
  lines: CouponReportLine[],
  day: string,
): CouponBrand {
  let wepinkCents = 0;
  let wepinkItems = 0;
  let wpinkCents = 0;
  let wpinkItems = 0;
  for (const line of lines) {
    const items = Math.round(line.qty);
    if (brandFromCodProduto(line.productCode) === "WPINK") {
      wpinkCents += line.revenueCents;
      wpinkItems += items;
    } else {
      wepinkCents += line.revenueCents;
      wepinkItems += items;
    }
  }
  return {
    couponKey: couponKey(header),
    day,
    occurredAt: header.occurredAt,
    wepinkCents,
    wepinkItems,
    wpinkCents,
    wpinkItems,
  };
}

/**
 * Itens do ConsultaDetMov (venda sem vendedora, fora do relatorio) no formato do relatorio.
 * O DetMov nao traz COD_PRODUTO  ->  vem do catalogo; sem cadastro fica sem codigo.
 */
export function detMovToCouponLines(
  key: string,
  lines: Array<{ productId: number; revenueCents: number; qty: number; descProduto: string }>,
  catalog: Map<number, { code: string; description: string }>,
): CouponReportLine[] {
  return lines
    .filter((l) => l.qty !== 0 || l.revenueCents !== 0)
    .map((l) => {
      const cat = catalog.get(l.productId);
      return {
        couponKey: key,
        day: null,
        productId: l.productId,
        productCode: cat?.code ?? "",
        productName: cat?.description || l.descProduto,
        qty: l.qty,
        revenueCents: l.revenueCents,
        sellerGeradorId: null,
        sellerName: "",
      };
    });
}

/** Vendedora de cada cupom (1 linha com gerador). */
export function couponSellers(byCoupon: Map<string, CouponReportLine[]>): Map<string, CouponSeller> {
  const out = new Map<string, CouponSeller>();
  for (const [key, lines] of byCoupon) {
    const hit = lines.find((l) => l.sellerGeradorId != null);
    if (hit) out.set(key, { geradorId: hit.sellerGeradorId!, name: hit.sellerName });
  }
  return out;
}

/**
 * Top produtos (loja x dia x produto) a partir dos itens dos cupons.
 * `dayOf` = dia do cupom (o da Lista); cupom sem dia (fora da Lista) fica de fora.
 */
export function productDayAggsFromCouponLines(
  byCoupon: Map<string, CouponReportLine[]>,
  opts: { tenantId: string; storeId: string; dayOf: (couponKey: string, lines: CouponReportLine[]) => string | null },
): SalesProductDayAgg[] {
  const map = new Map<string, SalesProductDayAgg>();
  for (const [key, lines] of byCoupon) {
    const day = opts.dayOf(key, lines);
    if (!day) continue;
    for (const line of lines) {
      const k = `${day}|${line.productId}`;
      const acc =
        map.get(k) ??
        ({
          tenantId: opts.tenantId,
          storeId: opts.storeId,
          day,
          productId: line.productId,
          productCode: line.productCode,
          productName: line.productName,
          brand: "ALL",
          revenueCents: 0,
          itemCount: 0,
        } satisfies SalesProductDayAgg);
      acc.revenueCents += line.revenueCents;
      acc.itemCount += Math.round(line.qty);
      if (line.productCode) acc.productCode = line.productCode;
      if (line.productName) acc.productName = line.productName;
      map.set(k, acc);
    }
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day) || b.revenueCents - a.revenueCents);
}

/**
 * Itens por pessoa x produto x dia (desafios). Mesmo `dayOf` do top produtos; linha sem gerador
 * (venda sem vendedor identificado, itens do DetMov) fica de fora. Produto agrupado pelo codigo.
 */
export function sellerProductDayAggsFromCouponLines(
  byCoupon: Map<string, CouponReportLine[]>,
  opts: { tenantId: string; storeId: string; dayOf: (couponKey: string, lines: CouponReportLine[]) => string | null },
): SalesSellerProductDayAgg[] {
  const map = new Map<string, SalesSellerProductDayAgg>();
  for (const [key, lines] of byCoupon) {
    const day = opts.dayOf(key, lines);
    if (!day) continue;
    for (const line of lines) {
      if (line.sellerGeradorId == null) continue;
      const productCode = line.productCode || `#${line.productId}`;
      const k = `${day}|${line.sellerGeradorId}|${productCode}`;
      const acc =
        map.get(k) ??
        ({
          tenantId: opts.tenantId,
          storeId: opts.storeId,
          day,
          sellerGeradorId: line.sellerGeradorId,
          sellerKey: "",
          sellerName: "",
          productCode,
          productId: line.productId,
          itemCount: 0,
          revenueCents: 0,
        } satisfies SalesSellerProductDayAgg);
      acc.itemCount += Math.round(line.qty);
      acc.revenueCents += line.revenueCents;
      if (line.sellerName) {
        acc.sellerName = line.sellerName;
        acc.sellerKey = sellerKeyFromName(line.sellerName) ?? "";
      }
      map.set(k, acc);
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      a.day.localeCompare(b.day) || a.sellerGeradorId - b.sellerGeradorId || a.productCode.localeCompare(b.productCode),
  );
}

export type PriceTableDayAgg = {
  day: string;
  tableId: number;
  tableName: string;
  itemCount: number;
  revenueCents: number;
};

/** Itens e R$ por tabela de preco de venda (loja x dia). Linha sem tabela (detalhe do movimento) fica de fora. */
export function priceTableDayAggsFromCouponLines(
  byCoupon: Map<string, CouponReportLine[]>,
  dayOf: (couponKey: string, lines: CouponReportLine[]) => string | null,
): PriceTableDayAgg[] {
  const map = new Map<string, PriceTableDayAgg>();
  for (const [key, lines] of byCoupon) {
    const day = dayOf(key, lines);
    if (!day) continue;
    for (const line of lines) {
      if (line.priceTableId == null) continue;
      const k = `${day}|${line.priceTableId}`;
      const acc = map.get(k) ?? { day, tableId: line.priceTableId, tableName: "", itemCount: 0, revenueCents: 0 };
      acc.itemCount += Math.round(line.qty);
      acc.revenueCents += line.revenueCents;
      if (line.priceTableName) acc.tableName = line.priceTableName;
      map.set(k, acc);
    }
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day) || b.itemCount - a.itemCount);
}

export type FetchCouponReportParams = {
  session: string;
  geradorId: number;
  /** ISO day YYYY-MM-DD (inclusivo). */
  from: string;
  to: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export async function fetchCouponReport(params: FetchCouponReportParams): Promise<CouponReportLine[]> {
  const base = (params.baseUrl ?? millenniumBaseUrl()).replace(/\/$/, "");
  const fetchImpl = params.fetchImpl ?? fetch;
  const filial = `(${params.geradorId})`;
  const body = {
    CATALOG_GUID: COUPON_REPORT_GUID,
    PARAMETERS_MODEL: [
      {
        SCRIPT: null,
        DATASOURCE: null,
        DATA_DATA_DATA_INTERVAL: 0,
        DATA_DATA_DATA_START: params.from,
        DATA_DATA_DATA_END: params.to,
        VENDA_MOVIMENTO_NFS: "",
        FILIAL_GERADOR_GERADOR: filial,
        PRODUTO_PRODUTO_PRODUTO: null,
      },
    ],
    UNIVERSE_NAME: "millenium.mdu",
    REPORT_FORMAT: "raw",
    PARAMETERS_DESCRIPTION: `Filial=${filial} Data=${params.from}..${params.to}`,
  };
  const res = await fetchImpl(`${base}/millenium:wtsreports/reports/process`, {
    method: "POST",
    headers: reportHeaders(params.session, base),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`wtsreports produtos por cupom → ${res.status} ${text.slice(0, 320)}`);
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`wtsreports produtos por cupom JSON inválido: ${text.slice(0, 240)}`);
  }
  return parseCouponReportRawData(parsed);
}
