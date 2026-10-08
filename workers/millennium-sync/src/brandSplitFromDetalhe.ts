/**
 * Classifica itens do ConsultaDetMov  ->  SaleRow WEPINK/WPINK (pra aggregateSales).
 */
import type { SaleRow, SalesBrand } from "../../../src/data/wedash/salesTypes.ts";
import type { DetMovLine } from "./millenniumDetMov.ts";
import type { ProductBrandMap } from "./millenniumProductDivision.ts";
import type { SaleRowWithFilial } from "./millenniumSales.ts";

export type BrandSplitHeader = {
  operationCode: string;
  millenniumOpCode: number;
  nf: string;
  tipoOperacao: string;
  occurredAt: Date;
  storeId: string;
};

/** Soma linhas por marca. Fora do mapa: infere pela descricao; senao WEPINK. */
export function inferBrandFromDesc(desc: string): SalesBrand | null {
  const t = desc.trim().toUpperCase();
  if (!t) return null;
  // Codigo WP* / rotulo WPINK
  if (/\bWPINK\b/.test(t) || /^WP[\dA-Z]/.test(t) || t.startsWith("WP ")) return "WPINK";
  if (/\bWEPINK\b/.test(t) || /\bWE\s*PINK\b/.test(t)) return "WEPINK";
  // Prefixo do COD no DESC (ex.: "BSVHG-ATH-001-BODY...")
  const cod = /^([A-Z0-9][A-Z0-9._-]*)/.exec(t)?.[1] ?? "";
  if (/^WP[\dA-Z]/.test(cod)) return "WPINK";
  return null;
}

export function resolveLineBrand(
  productId: number,
  descProduto: string,
  productMap: ProductBrandMap,
): SalesBrand {
  const mapped = productMap.get(productId);
  if (mapped === "WEPINK" || mapped === "WPINK") return mapped;
  return inferBrandFromDesc(descProduto) ?? "WEPINK";
}

/** Soma linhas por marca (mapa  ->  desc  ->  default WEPINK). */
export function splitLinesByBrand(
  lines: DetMovLine[],
  productMap: ProductBrandMap,
): Map<SalesBrand, { revenueCents: number; itemCount: number }> {
  const out = new Map<SalesBrand, { revenueCents: number; itemCount: number }>();
  for (const line of lines) {
    const brand = resolveLineBrand(line.productId, line.descProduto, productMap);
    if (brand === "ALL") continue;
    const prev = out.get(brand) ?? { revenueCents: 0, itemCount: 0 };
    prev.revenueCents += line.revenueCents;
    prev.itemCount += line.qty;
    out.set(brand, prev);
  }
  return out;
}

/** Headers unicos com NF + COD_OPERACAO numerico (1 DetMov por cupom). */
export function uniqueBrandSplitHeaders(rows: SaleRowWithFilial[]): BrandSplitHeader[] {
  const seen = new Set<string>();
  const out: BrandSplitHeader[] = [];
  for (const row of rows) {
    if (row.millenniumOpCode == null || !row.nf) continue;
    const tipo = (row.tipoOperacao ?? "S").trim() || "S";
    const key = couponKey({ millenniumOpCode: row.millenniumOpCode, nf: row.nf, tipoOperacao: tipo });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      operationCode: row.operationCode,
      millenniumOpCode: row.millenniumOpCode,
      nf: row.nf,
      tipoOperacao: tipo,
      occurredAt: row.occurredAt,
      storeId: row.storeId,
    });
  }
  return out;
}

/** Resumo WEPINK/WPINK de um cupom (cache `sales_coupon_brand`). */
export type CouponBrand = {
  couponKey: string;
  day: string;
  occurredAt: Date;
  wepinkCents: number;
  wepinkItems: number;
  wpinkCents: number;
  wpinkItems: number;
  /** Itens do DetMov (top produtos sem nova chamada). null = cache antigo, sem itens. */
  items?: DetMovLine[] | null;
};

export function couponKey(header: Pick<BrandSplitHeader, "millenniumOpCode" | "nf" | "tipoOperacao">): string {
  return `${header.millenniumOpCode}|${header.nf}|${header.tipoOperacao}`;
}

export function couponBrandFromLines(
  header: BrandSplitHeader,
  lines: DetMovLine[],
  productMap: ProductBrandMap,
  day: string,
): CouponBrand {
  const byBrand = splitLinesByBrand(lines, productMap);
  const we = byBrand.get("WEPINK");
  const wp = byBrand.get("WPINK");
  return {
    couponKey: couponKey(header),
    day,
    occurredAt: header.occurredAt,
    wepinkCents: we?.revenueCents ?? 0,
    wepinkItems: we?.itemCount ?? 0,
    wpinkCents: wp?.revenueCents ?? 0,
    wpinkItems: wp?.itemCount ?? 0,
    items: lines,
  };
}

/** Cupom do cache  ->  0..2 SaleRows (hora = a da Lista). */
export function saleRowsFromCouponBrand(header: BrandSplitHeader, coupon: CouponBrand): SaleRow[] {
  const out: SaleRow[] = [];
  const parts: Array<[SalesBrand, number, number]> = [
    ["WEPINK", coupon.wepinkCents, coupon.wepinkItems],
    ["WPINK", coupon.wpinkCents, coupon.wpinkItems],
  ];
  for (const [brand, revenueCents, itemQty] of parts) {
    if (revenueCents === 0 && itemQty === 0) continue;
    out.push({
      operationCode: header.operationCode,
      occurredAt: header.occurredAt,
      revenueCents,
      itemQty,
      storeId: header.storeId,
      brand,
    });
  }
  return out;
}

/** Uma venda (detalhe)  ->  0..2 SaleRows (WEPINK e/ou WPINK). */
export function saleRowsFromDetLines(
  header: BrandSplitHeader,
  lines: DetMovLine[],
  productMap: ProductBrandMap,
): SaleRow[] {
  const byBrand = splitLinesByBrand(lines, productMap);
  const out: SaleRow[] = [];
  for (const [brand, part] of byBrand) {
    if (part.revenueCents === 0 && part.itemCount === 0) continue;
    out.push({
      operationCode: header.operationCode,
      occurredAt: header.occurredAt,
      revenueCents: part.revenueCents,
      itemQty: part.itemCount,
      storeId: header.storeId,
      brand,
    });
  }
  return out;
}
