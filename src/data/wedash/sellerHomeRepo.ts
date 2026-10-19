import { getSupabase } from "@/lib/supabase";
import { startOfMonth } from "@/data/wedash/engine/format";
import { sellerHistoryFloor, type SellerHomePayload } from "@/data/wedash/engine/sellerHome";

/** Pacote da tela Inicio do vendedor (Edge `seller-home`). null = falhou. */
export async function fetchSellerHome(range?: { from: string; to: string } | null): Promise<SellerHomePayload | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const body = range && iso.test(range.from) && iso.test(range.to) ? { from: range.from, to: range.to } : {};
  const { data, error } = await sb.functions.invoke("seller-home", { body });
  if (error) return null;
  const res = data as (Partial<SellerHomePayload> & { ok?: boolean; today?: string }) | null;
  if (!res?.ok || !res.today || !res.stores || !res.myDays || !res.numbersPeriod) return null;
  return {
    today: res.today,
    month: res.month ?? startOfMonth(res.today),
    historyFrom: res.historyFrom ?? sellerHistoryFloor(res.today),
    name: res.name ?? "",
    stores: res.stores,
    myDays: res.myDays,
    numbersPeriod: res.numbersPeriod,
  };
}
