import type {
  SalesCategoryDayAgg,
  SalesCategoryRef,
  SalesProductCostDayAgg,
  SalesProductDayAgg,
} from "./salesTypes";

/** Mesmo id da view: produto fora do catálogo. */
export const UNDEFINED_CATEGORY_ID = -2_000_000_000;
export const UNDEFINED_CATEGORY_NAME = "INDEFINIDO";

/**
 * Faturamento por categoria a partir do que o sync já gravou
 * (produto do dia + CMV do dia + tipo do catálogo).
 * A mesma conta de `sales_category_day_view`, sem recalcular o histórico no banco.
 */
export function rollupCategoryDays(args: {
  products: SalesProductDayAgg[];
  costs: SalesProductCostDayAgg[];
  typeByProductId: Record<number, number>;
  typeNameById: Record<number, string>;
}): SalesCategoryDayAgg[] {
  const margin = new Map<string, number>();
  for (const row of args.costs) {
    const code = row.productCode.trim();
    if (!code) continue;
    margin.set(costKey(row.tenantId, row.storeId, row.day, code), row.revenueCents);
  }

  const byCode = new Map<string, SalesProductDayAgg[]>();
  for (const row of args.products) {
    const key = costKey(row.tenantId, row.storeId, row.day, row.productCode.trim());
    const list = byCode.get(key);
    if (list) list.push(row);
    else byCode.set(key, [row]);
  }

  const totals = new Map<string, SalesCategoryDayAgg>();
  for (const rows of byCode.values()) {
    rows.sort((a, b) => a.productId - b.productId);
    const first = rows[0]!;
    const code = first.productCode.trim();
    const marginCents = code ? margin.get(costKey(first.tenantId, first.storeId, first.day, code)) : undefined;
    rows.forEach((row, index) => {
      const revenueCents = pricedRevenue(row.revenueCents, marginCents, index === 0);
      const categoryId = args.typeByProductId[row.productId] ?? UNDEFINED_CATEGORY_ID;
      const categoryName = args.typeNameById[categoryId] || UNDEFINED_CATEGORY_NAME;
      const key = `${row.tenantId}|${row.storeId}|${row.day}|${categoryId}`;
      const acc = totals.get(key);
      if (acc) {
        acc.revenueCents += revenueCents;
        acc.itemCount += row.itemCount;
        if (row.day >= acc.day) acc.categoryName = categoryName;
      } else {
        totals.set(key, {
          tenantId: row.tenantId,
          storeId: row.storeId,
          day: row.day,
          categoryId,
          categoryName,
          brand: "ALL",
          revenueCents,
          itemCount: row.itemCount,
        });
      }
    });
  }

  return [...totals.values()];
}

/** Tipos do catálogo já sincronizado, para a barra zerada sem varrer venda antiga. */
export function categoryCatalogFromTypes(
  typeByProductId: Record<number, number>,
  typeNameById: Record<number, string>,
): SalesCategoryRef[] {
  const ids = new Set<number>();
  for (const typeId of Object.values(typeByProductId)) ids.add(typeId);
  return [...ids]
    .map((categoryId) => ({
      categoryId,
      categoryName: typeNameById[categoryId] || UNDEFINED_CATEGORY_NAME,
      brand: "ALL" as const,
    }))
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName, "pt-BR"));
}

function pricedRevenue(productCents: number, marginCents: number | undefined, firstOfCode: boolean): number {
  if (marginCents != null && marginCents > 0) return firstOfCode ? marginCents : 0;
  return productCents;
}

function costKey(tenantId: string, storeId: string, day: string, code: string): string {
  return `${tenantId}|${storeId}|${day}|${code}`;
}
