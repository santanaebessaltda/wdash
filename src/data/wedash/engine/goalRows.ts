/** Linhas do banco  ->  tipos da meta (sem dependencias fora do motor). */
import { collaboratorName, shiftName } from "./format.ts";
import type { GoalGroup, GoalRecord, GoalTeamMember, SalesBrand, SalesSellerDayAgg, Tier } from "./goalTypes.ts";

export const SELLER_ROLE = "VENDEDOR";

type TierJson = {
  name?: string;
  minPct?: number;
  commissionPct?: number;
  bonusCents?: number;
  managerCommissionPct?: number;
  managerBonusCents?: number;
};

function parseTiers(raw: unknown): Tier[] {
  if (!Array.isArray(raw)) return [];
  return (raw as TierJson[])
    .map((t): Tier => ({
      nome: String(t.name ?? "").trim(),
      atingimentoMinPct: Number(t.minPct ?? 0),
      comissaoPct: Number(t.commissionPct ?? 0),
      bonus: Number(t.bonusCents ?? 0) / 100,
      ...(t.managerCommissionPct != null
        ? { gerenciaPct: Number(t.managerCommissionPct), gerenciaBonus: Number(t.managerBonusCents ?? 0) / 100 }
        : {}),
    }))
    .filter((t) => t.nome && Number.isFinite(t.atingimentoMinPct))
    .sort((a, b) => a.atingimentoMinPct - b.atingimentoMinPct);
}

function parseGroups(raw: unknown): GoalGroup[] {
  if (!Array.isArray(raw)) return [];
  return (raw as { shiftId?: string; name?: string; pct?: number }[])
    .map((g) => ({ shiftId: String(g.shiftId ?? ""), name: String(g.name ?? ""), pct: Number(g.pct ?? 0) }))
    .filter((g) => g.shiftId && Number.isFinite(g.pct));
}

export type GoalRow = {
  id: string;
  store_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  target_cents: number;
  tier_mode: string;
  tiers: unknown;
  groups: unknown;
};

export function goalFromRow(r: GoalRow): GoalRecord {
  return {
    id: r.id,
    storeId: r.store_id,
    name: r.name,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    target: Number(r.target_cents) / 100,
    tierMode: r.tier_mode === "GROUP" ? "GROUP" : r.tier_mode === "GENERAL" ? "GENERAL" : "INDIVIDUAL",
    tiers: parseTiers(r.tiers),
    groups: parseGroups(r.groups),
  };
}

export type GoalTeamRow = {
  store_id: string;
  millennium_employee_id: number;
  millennium_gerador_id: number | null;
  name: string;
  name_keys: string[] | null;
  active: boolean;
  erp_role: string | null;
  shift_id: string | null;
  store_shift: { name: string } | { name: string }[] | null;
};

export function teamMemberFromRow(r: GoalTeamRow): GoalTeamMember {
  const shift = Array.isArray(r.store_shift) ? r.store_shift[0] : r.store_shift;
  return {
    storeId: r.store_id,
    employeeId: r.millennium_employee_id,
    geradorId: r.millennium_gerador_id == null ? null : Number(r.millennium_gerador_id),
    name: collaboratorName(r.name),
    nameKeys: r.name_keys ?? [],
    salesPerson: r.active && (r.erp_role == null || r.erp_role === SELLER_ROLE),
    shiftId: r.shift_id,
    shiftName: shift?.name ? shiftName(shift.name) : null,
  };
}

export type SellerDayRow = {
  tenant_id: string;
  store_id: string;
  day: string;
  seller_key: string;
  seller_name: string;
  seller_employee_id: number | null;
  seller_gerador_id: number | null;
  brand: SalesBrand;
  revenue_cents: number;
  sales_count: number;
  item_count: number | null;
};

export function sellerDayFromRow(r: SellerDayRow): SalesSellerDayAgg {
  return {
    tenantId: r.tenant_id,
    storeId: r.store_id,
    day: r.day,
    sellerKey: String(r.seller_key ?? ""),
    sellerName: collaboratorName(String(r.seller_name ?? "") || String(r.seller_key ?? "")),
    sellerEmployeeId: r.seller_employee_id == null ? null : Number(r.seller_employee_id),
    sellerGeradorId: r.seller_gerador_id == null ? null : Number(r.seller_gerador_id),
    brand: r.brand,
    revenueCents: Number(r.revenue_cents) || 0,
    salesCount: Number(r.sales_count) || 0,
    itemCount: Number(r.item_count) || 0,
  };
}

/** Funcionarios ativos com cargo = VENDEDOR (gerencia, conta de freelancer)  -  fora do ranking. */
export type NonSalesPeople = {
  employeeIds: Set<number>;
  geradorIds: Set<number>;
  /** `storeId|nome normalizado`  -  linhas sem codigo ligadas so pelo nome. */
  storeNameKeys: Set<string>;
};

/** Tira do ranking as vendas de quem nao e da equipe de vendas (a venda continua no total da loja, que vem de outra tabela). */
export function excludeNonSalesPeople(rows: SalesSellerDayAgg[], people: NonSalesPeople): SalesSellerDayAgg[] {
  if (people.employeeIds.size === 0 && people.geradorIds.size === 0 && people.storeNameKeys.size === 0) return rows;
  return rows.filter((r) => {
    if (r.sellerEmployeeId != null) return !people.employeeIds.has(r.sellerEmployeeId);
    if (r.sellerGeradorId != null && people.geradorIds.has(r.sellerGeradorId)) return false;
    return !people.storeNameKeys.has(`${r.storeId}|${r.sellerKey}`);
  });
}
