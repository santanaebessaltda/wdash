/** Usuário da filial: escolha da WDash, ou o código igual ao da filial quando ainda não houve escolha. */

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

/**
 * Pessoa da filial que lança venda no usuário da loja.
 * `chosen` false = quem tem o código da filial. `chosen` true com id vazio = nenhum.
 */
export function resolveBranchSellerId(args: {
  chosen: boolean;
  chosenSellerId: string | null;
  sellers: BranchSellerRef[];
  storeId: string;
  branchCode: string;
  millenniumBranch: number;
}): string | null {
  const inStore = args.sellers.filter((s) => s.storeId === args.storeId);
  if (args.chosen) {
    if (!args.chosenSellerId) return null;
    return inStore.some((s) => s.id === args.chosenSellerId) ? args.chosenSellerId : null;
  }
  const branch = { branchCode: args.branchCode, millenniumBranch: args.millenniumBranch };
  return inStore.find((s) => isBranchUser(s.code, branch))?.id ?? null;
}
