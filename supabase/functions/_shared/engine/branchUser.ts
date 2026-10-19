/** Usuário da filial: quem tem o código igual ao da filial no ERP. */

export function millenniumCodeKey(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, "").replace(/^0+/, "");
  return digits || null;
}

export function isBranchUser(
  sellerCode: string | null | undefined,
  branch: { branchCode: string; millenniumBranch: number },
): boolean {
  const seller = millenniumCodeKey(sellerCode);
  if (!seller) return false;
  return seller === millenniumCodeKey(branch.branchCode) || seller === millenniumCodeKey(branch.millenniumBranch);
}

export type BranchSellerRef = { id: string; code: string | null; storeId: string };

/** Pessoa da filial que lança venda no usuário da loja: código igual ao da filial. */
export function resolveBranchSellerId(args: {
  sellers: BranchSellerRef[];
  storeId: string;
  branchCode: string;
  millenniumBranch: number;
}): string | null {
  const branch = { branchCode: args.branchCode, millenniumBranch: args.millenniumBranch };
  return args.sellers.find((s) => s.storeId === args.storeId && isBranchUser(s.code, branch))?.id ?? null;
}
