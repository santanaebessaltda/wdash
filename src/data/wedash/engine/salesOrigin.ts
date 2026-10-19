import type { NonSalesPeople } from "./goalRows.ts";
import type { SalesSellerDayAgg } from "./goalTypes.ts";

export type SalesOrigin = "team" | "branchUser" | "management";

export type SalesOriginIndex = {
  branchUser: NonSalesPeople;
  management: NonSalesPeople;
};

export function emptyOriginKeys(): NonSalesPeople {
  return { employeeIds: new Set(), generatorIds: new Set(), storeNameKeys: new Set() };
}

export function matchesOrigin(
  row: Pick<SalesSellerDayAgg, "storeId" | "sellerKey" | "sellerEmployeeId" | "sellerGeneratorId">,
  keys: NonSalesPeople,
): boolean {
  if (row.sellerEmployeeId != null) return keys.employeeIds.has(row.sellerEmployeeId);
  if (row.sellerGeneratorId != null && keys.generatorIds.has(row.sellerGeneratorId)) return true;
  return keys.storeNameKeys.has(`${row.storeId}|${row.sellerKey}`);
}

/** Usuário da filial antes da gerência: a mesma pessoa não entra nos dois. */
export function sellerOrigin(row: Pick<SalesSellerDayAgg, "storeId" | "sellerKey" | "sellerEmployeeId" | "sellerGeneratorId">, index: SalesOriginIndex): SalesOrigin {
  if (matchesOrigin(row, index.branchUser)) return "branchUser";
  if (matchesOrigin(row, index.management)) return "management";
  return "team";
}

export function unionOriginKeys(index: SalesOriginIndex): NonSalesPeople {
  const out = emptyOriginKeys();
  for (const keys of [index.branchUser, index.management]) {
    for (const id of keys.employeeIds) out.employeeIds.add(id);
    for (const id of keys.generatorIds) out.generatorIds.add(id);
    for (const key of keys.storeNameKeys) out.storeNameKeys.add(key);
  }
  return out;
}
