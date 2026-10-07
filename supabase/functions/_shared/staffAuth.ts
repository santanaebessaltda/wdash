/**
 * Membership ACTIVE de staff (Gestor / Gerente / admin) + escopo de lojas.
 * membership_store vazio = todas as lojas (inclusive novas).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const STAFF_ROLES = ["OWNER", "MANAGER", "ADMIN_GLOBAL"] as const;
export const GESTOR_ROLES = ["OWNER", "ADMIN_GLOBAL"] as const;

export type StaffCaller = {
  membershipId: string;
  tenantId: string;
  role: string;
  /** Vazio = todas as lojas. */
  memberStoreIds: string[];
};

export async function loadStaffCaller(
  admin: SupabaseClient,
  authUserId: string,
  roles: readonly string[] = STAFF_ROLES,
): Promise<StaffCaller | null> {
  const { data: identity } = await admin
    .from("identity")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (!identity) return null;

  const { data: membership } = await admin
    .from("membership")
    .select("id, tenant_id, role, membership_store (store_id)")
    .eq("identity_id", identity.id)
    .eq("status", "ACTIVE")
    .in("role", [...roles])
    .order("is_owner", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!membership) return null;

  const stores = (membership.membership_store as { store_id: string }[] | null) ?? [];
  return {
    membershipId: membership.id as string,
    tenantId: membership.tenant_id as string,
    role: membership.role as string,
    memberStoreIds: stores.map((s) => s.store_id),
  };
}

/** null = todas; array = só essas (Gerente com vínculo). */
export function managerAllowedStores(role: string, memberStoreIds: string[]): string[] | null {
  if (role !== "MANAGER") return null;
  return memberStoreIds.length === 0 ? null : memberStoreIds;
}

export function canAccessStore(role: string, memberStoreIds: string[], storeId: string): boolean {
  const allowed = managerAllowedStores(role, memberStoreIds);
  return allowed == null || allowed.includes(storeId);
}
