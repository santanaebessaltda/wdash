import type { ProfilePhotoRef } from "@/data/wedash/profilePhotos";
import { challengeFromRow, emptyChallengeAggInput, excludeNonSalesSellerProducts, type ChallengeRecord, type ChallengeRow } from "@/data/wedash/challengesRepo";
import type { ChallengeAggInput } from "@/data/wedash/challengesRepo";
import type { TeamAggInput } from "@/data/wedash/dashboard";
import { goalFromRow, sellerDayFromRow, teamMemberFromRow, type GoalRow, type GoalTeamRow, type SellerDayRow } from "@/data/wedash/engine/goalRows";
import { unionOriginKeys } from "@/data/wedash/engine/salesOrigin";
import type { GoalRecord, GoalTeamMember } from "@/data/wedash/goalsRepo";
import { excludeNonSalesPeople, salesOriginsFrom, type OriginSeller, type OriginStore } from "@/data/wedash/salesRepo";
import type { SalesDayAgg, SalesProductDayAgg, SalesSellerDayAgg, SalesSellerProductDayAgg, SellerShiftRef } from "@/data/wedash/salesTypes";
import { shiftName } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { paths } from "@/router/paths";

export type PublicBoardStore = {
  id: string;
  tradeName: string;
  hours: unknown;
  timezone: string;
  code: string | null;
  millenniumStoreId: number;
};

export type PublicBoardPack = {
  store: PublicBoardStore;
  watermark: string | null;
  team: TeamAggInput;
  goals: GoalRecord[];
  goalDays: SalesDayAgg[];
  goalSellers: SalesSellerDayAgg[];
  namedSellers: SalesSellerDayAgg[];
  goalTeam: GoalTeamMember[];
  challenges: ChallengeRecord[];
  challengeAggs: ChallengeAggInput;
  photos: ProfilePhotoRef[];
};

type RawSeller = OriginSeller & {
  name: string;
  admitted_on: string | null;
  departed_on: string | null;
  shift_id: string | null;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
};

type Raw = {
  store: PublicBoardStore;
  watermark: string | null;
  days: {
    tenant_id: string;
    store_id: string;
    day: string;
    brand: SalesDayAgg["brand"];
    revenue_cents: number;
    sales_count: number;
    item_count: number;
    cmv_cents: number;
  }[];
  sellerDays: SellerDayRow[];
  sellers: RawSeller[];
  goals: GoalRow[];
  challenges: ChallengeRow[];
  sellerProducts: SalesSellerProductDayAgg[];
  storeProducts?: SalesProductDayAgg[];
  catalog: { code: string; typeId: number | null; name?: string | null }[];
  photos: ProfilePhotoRef[];
};

function asDay(row: Raw["days"][number]): SalesDayAgg {
  return {
    tenantId: row.tenant_id,
    storeId: row.store_id,
    day: String(row.day).slice(0, 10),
    brand: row.brand,
    revenueCents: Number(row.revenue_cents) || 0,
    salesCount: Number(row.sales_count) || 0,
    itemCount: Number(row.item_count) || 0,
    cmvCents: Number(row.cmv_cents) || 0,
  };
}

function shiftsOf(sellers: RawSeller[]): SellerShiftRef[] {
  const out: SellerShiftRef[] = [];
  for (const row of sellers) {
    if (!row.shift_name || !row.shift_start || !row.shift_end) continue;
    out.push({
      storeId: row.store_id,
      employeeId: row.millennium_employee_id == null ? null : Number(row.millennium_employee_id),
      generatorId: row.millennium_gerador_id == null ? null : Number(row.millennium_gerador_id),
      nameKeys: row.name_keys ?? [],
      name: shiftName(row.shift_name),
      start: String(row.shift_start).slice(0, 5),
      end: String(row.shift_end).slice(0, 5),
    });
  }
  return out;
}

export function mapBoardShare(raw: Raw): PublicBoardPack {
  const storeRow: OriginStore = {
    id: raw.store.id,
    code: raw.store.code,
    millennium_store_id: Number(raw.store.millenniumStoreId),
  };
  const origins = salesOriginsFrom(raw.sellers, [storeRow]);
  const hidden = unionOriginKeys(origins);
  const named = (raw.sellerDays ?? []).map((row) => sellerDayFromRow({ ...row, day: String(row.day).slice(0, 10) }));
  const teamSellers = excludeNonSalesPeople(named, hidden);
  const days = (raw.days ?? []).map(asDay);
  const goalTeam = (raw.sellers ?? []).map((row) =>
    teamMemberFromRow({
      store_id: row.store_id,
      millennium_employee_id: Number(row.millennium_employee_id),
      millennium_gerador_id: row.millennium_gerador_id,
      name: row.name,
      name_keys: row.name_keys,
      active: row.active,
      erp_role: row.erp_role,
      admitted_on: row.admitted_on,
      departed_on: row.departed_on,
      shift_id: row.shift_id,
      store_shift: row.shift_name ? { name: row.shift_name } : null,
    } satisfies GoalTeamRow),
  );
  const products = excludeNonSalesSellerProducts(raw.sellerProducts ?? [], hidden);
  const aggs = emptyChallengeAggInput();
  aggs.team = goalTeam;
  aggs.sellerDays = teamSellers;
  aggs.sellerProducts = products;
  aggs.storeDays = days.filter((day) => day.brand === "ALL");
  aggs.storeProducts = raw.storeProducts ?? [];
  for (const day of days) if (day.brand === "ALL" && day.revenueCents > 0) aggs.storeSaleDays.add(`${day.storeId}|${day.day}`);
  for (const item of raw.catalog ?? []) {
    if (item.typeId != null) aggs.typeByCode.set(item.code, Number(item.typeId));
    if (item.name) aggs.nameByCode.set(item.code, item.name);
  }
  for (const item of aggs.storeProducts) {
    if (item.productName && !aggs.nameByCode.has(item.productCode)) aggs.nameByCode.set(item.productCode, item.productName);
  }
  return {
    store: raw.store,
    watermark: raw.watermark,
    team: { dayAggs: days, sellerDayAggs: teamSellers, namedSellerDayAggs: named, origins, sellerShifts: shiftsOf(raw.sellers ?? []) },
    goals: (raw.goals ?? []).map(goalFromRow),
    goalDays: days,
    goalSellers: teamSellers,
    namedSellers: named,
    goalTeam,
    challenges: (raw.challenges ?? []).map(challengeFromRow),
    challengeAggs: aggs,
    photos: raw.photos ?? [],
  };
}

export function boardShareUrl(token: string): string {
  const path = paths.boardShare(token);
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

export async function ensureBoardShare(storeId: string): Promise<string | null> {
  const client = getSupabase();
  if (!client) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).rpc("ensure_board_share", { p_store_id: storeId });
  if (error) {
    console.warn("ensureBoardShare:", error.message);
    return null;
  }
  return typeof data === "string" ? data : null;
}

export async function readBoardShare(token: string, today: string): Promise<PublicBoardPack | null> {
  const client = getSupabase();
  if (!client) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).rpc("read_board_share", { p_token: token, p_today: today });
  if (error) {
    console.warn("readBoardShare:", error.message);
    return null;
  }
  if (!data) return null;
  try {
    return mapBoardShare(data as Raw);
  } catch (caught) {
    console.warn("readBoardShare:", caught instanceof Error ? caught.message : caught);
    return null;
  }
}
