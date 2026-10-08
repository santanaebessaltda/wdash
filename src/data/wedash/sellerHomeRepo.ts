import { getSupabase } from "@/lib/supabase";
import type { SellerHomePayload } from "@/data/wedash/engine/sellerHome";

/** Pacote da tela Inicio do vendedor (Edge `seller-home`). null = falhou. */
export async function fetchSellerHome(): Promise<SellerHomePayload | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.functions.invoke("seller-home", { body: {} });
  if (error) return null;
  const res = data as (SellerHomePayload & { ok?: boolean }) | null;
  if (!res?.ok) return null;
  return res;
}
