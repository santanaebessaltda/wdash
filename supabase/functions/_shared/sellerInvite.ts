/**
 * Convite e ciclo de vida do acesso do vendedor (Gestao > Vendedores).
 * Regras de quem pode e do que e valido vem do motor (`engine/sellerAccess.ts`).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { canManageStore, hasSalesGroup, invitable, normalizeEmail, validEmail } from "./engine/sellerAccess.ts";

export type SellerCaller = { role: string; memberStoreIds: string[] };

export type SellerRow = {
  id: string;
  store_id: string;
  name: string;
  email: string | null;
  active: boolean;
  in_erp: boolean;
  erp_role: string | null;
  membership_id: string | null;
  shift_id: string | null;
};

export type MembershipRow = {
  id: string;
  role: string;
  status: string;
  identity_id: string;
  identity: { id: string; auth_user_id: string; email: string; status: string } | null;
};

export type SellerActionResult = { ok: true; [k: string]: unknown } | { ok: false; error: string };

const ok = (extra: Record<string, unknown> = {}): SellerActionResult => ({ ok: true, ...extra });
const err = (error: string): { ok: false; error: string } => ({ ok: false, error });

export async function sellerCaller(
  admin: SupabaseClient,
  authUserId: string,
  tenantId: string,
): Promise<SellerCaller | null> {
  const { data: identity } = await admin
    .from("identity")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (!identity) return null;
  const { data: membership } = await admin
    .from("membership")
    .select("id, role, membership_store (store_id)")
    .eq("identity_id", identity.id)
    .eq("tenant_id", tenantId)
    .eq("status", "ACTIVE")
    .in("role", ["OWNER", "ADMIN_GLOBAL", "MANAGER"])
    .limit(1)
    .maybeSingle();
  if (!membership) return null;
  const stores = (membership.membership_store as { store_id: string }[] | null) ?? [];
  return { role: membership.role as string, memberStoreIds: stores.map((s) => s.store_id) };
}

async function sellerOf(admin: SupabaseClient, tenantId: string, storeSellerId: string): Promise<SellerRow | null> {
  const { data } = await admin
    .from("store_seller")
    .select("id, store_id, name, email, active, in_erp, erp_role, membership_id, shift_id")
    .eq("tenant_id", tenantId)
    .eq("id", storeSellerId)
    .maybeSingle();
  return (data as SellerRow | null) ?? null;
}

async function membershipOf(admin: SupabaseClient, id: string | null): Promise<MembershipRow | null> {
  if (!id) return null;
  const { data } = await admin
    .from("membership")
    .select("id, role, status, identity_id, identity:identity_id (id, auth_user_id, email, status)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const identity = Array.isArray(data.identity) ? data.identity[0] : data.identity;
  return { ...(data as object), identity } as MembershipRow;
}

/** Estado do acesso de cada vendedor da loja (coluna Acesso). */
export async function sellerList(
  admin: SupabaseClient,
  caller: SellerCaller,
  tenantId: string,
  storeId: string,
): Promise<SellerActionResult> {
  if (!canManageStore(caller.role, caller.memberStoreIds, storeId)) return err("forbidden");
  const { data, error } = await admin
    .from("store_seller")
    .select("id, membership:membership_id (status)")
    .eq("tenant_id", tenantId)
    .eq("store_id", storeId);
  if (error) return err("list_failed");
  const sellers = (data ?? []).map((r) => {
    const m = Array.isArray(r.membership) ? r.membership[0] : r.membership;
    return { storeSellerId: r.id as string, status: (m?.status as string | undefined) ?? null };
  });
  return ok({ sellers });
}

type InviteInput = {
  tenantId: string;
  storeSellerId: string;
  email: string;
  origin: unknown;
  invite: (email: string) => Promise<{ userId: string } | { error: string }>;
};

/**
 * Convida o vendedor. E-mail que ja e SELLER desta empresa so ganha a loja
 * (`linked: true`, sem e-mail novo). E-mail de outro tipo de acesso e recusado.
 */
export async function sellerInvite(admin: SupabaseClient, caller: SellerCaller, input: InviteInput): Promise<SellerActionResult> {
  const seller = await sellerOf(admin, input.tenantId, input.storeSellerId);
  if (!seller) return err("invalid_seller");
  if (!canManageStore(caller.role, caller.memberStoreIds, seller.store_id)) return err("forbidden");
  if (!invitable({ active: seller.active, inErp: seller.in_erp, erpRole: seller.erp_role })) return err("not_invitable");
  if (!hasSalesGroup(seller.shift_id)) return err("no_group");

  const current = await membershipOf(admin, seller.membership_id);
  if (current) return err(current.status === "PENDING" ? "already_invited" : "already_member");

  const email = normalizeEmail(input.email);
  if (!validEmail(email)) return err("invalid_email");

  const { data: existing } = await admin
    .from("identity")
    .select("id, status, membership (id, tenant_id, role, status)")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    const ms = (existing.membership as { id: string; tenant_id: string; role: string; status: string }[] | null) ?? [];
    const here = ms.find((m) => m.tenant_id === input.tenantId);
    const live = ms;
    if (here) {
      if (here.role !== "SELLER") return err("email_in_use");
      return linkStore(admin, seller, here.id);
    }
    if (live.length > 0) return err("email_in_use");
    // Conta PENDING sem nenhuma membership: convite orfao. Libera o e-mail.
    if (existing.status === "PENDING") {
      const { data: ident } = await admin.from("identity").select("auth_user_id").eq("id", existing.id).maybeSingle();
      if (ident?.auth_user_id) await admin.auth.admin.deleteUser(ident.auth_user_id as string);
    } else {
      return err("email_in_use");
    }
  }

  const invited = await input.invite(email);
  if ("error" in invited) return err(invited.error);

  const rollback = async () => {
    await admin.auth.admin.deleteUser(invited.userId);
  };
  const { data: identity, error: idErr } = await admin
    .from("identity")
    .insert({ auth_user_id: invited.userId, email, name: seller.name, status: "PENDING" })
    .select("id")
    .single();
  if (idErr || !identity) {
    await rollback();
    return err("invite_failed");
  }
  const { data: membership, error: mErr } = await admin
    .from("membership")
    .insert({
      identity_id: identity.id,
      tenant_id: input.tenantId,
      role: "SELLER",
      status: "PENDING",
      is_owner: false,
    })
    .select("id")
    .single();
  if (mErr || !membership) {
    await rollback();
    return err("invite_failed");
  }
  const { error: storeErr } = await admin
    .from("membership_store")
    .insert({ membership_id: membership.id, store_id: seller.store_id });
  if (storeErr) {
    await rollback();
    return err("invite_failed");
  }
  const { error: linkErr } = await admin
    .from("store_seller")
    .update({ membership_id: membership.id, email })
    .eq("id", seller.id);
  if (linkErr) {
    await rollback();
    return err("invite_failed");
  }
  return ok({ membershipId: membership.id });
}

/** Mesma conta, mais uma loja: sem e-mail novo. */
async function linkStore(admin: SupabaseClient, seller: SellerRow, membershipId: string): Promise<SellerActionResult> {
  const { error: storeErr } = await admin
    .from("membership_store")
    .upsert({ membership_id: membershipId, store_id: seller.store_id }, { onConflict: "membership_id,store_id" });
  if (storeErr) return err("invite_failed");
  const { error } = await admin
    .from("store_seller")
    .update({ membership_id: membershipId })
    .eq("id", seller.id);
  if (error) return err("invite_failed");
  return ok({ linked: true });
}

/** O mesmo link do e-mail (token do convite aberto). null = sem convite aberto. */
export async function sellerLink(admin: SupabaseClient, caller: SellerCaller, tenantId: string, storeSellerId: string): Promise<SellerActionResult> {
  const found = await sellerMembership(admin, caller, tenantId, storeSellerId);
  if (!found.ok) return found;
  if (found.membership.status !== "PENDING" || !found.membership.identity) return err("not_pending");
  const { data, error } = await admin.rpc("invite_link_token", {
    p_auth_user_id: found.membership.identity.auth_user_id,
  });
  if (error) return err("link_failed");
  const token = typeof data === "string" ? data : "";
  // Sem token aberto (convite antigo ou ja confirmado): a tela avisa e oferece reenviar.
  // generateLink criaria um link novo e invalidaria o do e-mail, entao nao e usado.
  if (!token) return err("no_link");
  return ok({ token });
}

export async function sellerResend(
  admin: SupabaseClient,
  caller: SellerCaller,
  tenantId: string,
  storeSellerId: string,
  resend: (email: string) => Promise<string | null>,
): Promise<SellerActionResult> {
  const found = await sellerMembership(admin, caller, tenantId, storeSellerId);
  if (!found.ok) return found;
  if (found.membership.status !== "PENDING" || !found.membership.identity) return err("not_pending");
  const error = await resend(found.membership.identity.email);
  return error ? err(error) : ok();
}

/**
 * Exclui o acesso ja aceito (Ativo ou Suspenso) nesta loja.
 * Conta ligada a outra loja: so esta loja volta a "Sem acesso".
 * Ultima loja: a pessoa deixa de entrar na WDASH.
 */
export async function sellerRemove(admin: SupabaseClient, caller: SellerCaller, tenantId: string, storeSellerId: string): Promise<SellerActionResult> {
  const seller = await sellerOf(admin, tenantId, storeSellerId);
  if (!seller) return err("invalid_seller");
  if (!canManageStore(caller.role, caller.memberStoreIds, seller.store_id)) return err("forbidden");
  const membership = await membershipOf(admin, seller.membership_id);
  if (!membership || membership.role !== "SELLER" || !membership.identity) return err("no_access");
  if (membership.status !== "ACTIVE" && membership.status !== "SUSPENDED") return err("invalid_status");

  const { count } = await admin
    .from("store_seller")
    .select("id", { count: "exact", head: true })
    .eq("membership_id", membership.id)
    .neq("id", seller.id);
  if ((count ?? 0) > 0) {
    const { error: unlink } = await admin.from("store_seller").update({ membership_id: null }).eq("id", seller.id);
    if (unlink) return err("remove_failed");
    const { error: storeErr } = await admin
      .from("membership_store")
      .delete()
      .eq("membership_id", membership.id)
      .eq("store_id", seller.store_id);
    if (storeErr) return err("remove_failed");
    return ok();
  }

  const { error } = await admin.from("membership").delete().eq("id", membership.id);
  if (error) return err("remove_failed");
  const { count: left } = await admin
    .from("membership")
    .select("id", { count: "exact", head: true })
    .eq("identity_id", membership.identity.id);
  if ((left ?? 0) === 0) await admin.auth.admin.deleteUser(membership.identity.auth_user_id);
  return ok();
}

/** Cancela o convite: volta a "Sem acesso" e apaga o usuario do Auth se a pessoa ficou sem acesso. */
export async function sellerRevoke(admin: SupabaseClient, caller: SellerCaller, tenantId: string, storeSellerId: string): Promise<SellerActionResult> {
  const found = await sellerMembership(admin, caller, tenantId, storeSellerId);
  if (!found.ok) return found;
  if (found.membership.status !== "PENDING" || !found.membership.identity) return err("not_pending");
  const { error } = await admin.from("membership").delete().eq("id", found.membership.id);
  if (error) return err("revoke_failed");
  const { count } = await admin
    .from("membership")
    .select("id", { count: "exact", head: true })
    .eq("identity_id", found.membership.identity.id);
  if ((count ?? 0) === 0 && found.membership.identity.status === "PENDING") {
    await admin.auth.admin.deleteUser(found.membership.identity.auth_user_id);
  }
  return ok();
}

export async function sellerSetStatus(
  admin: SupabaseClient,
  caller: SellerCaller,
  tenantId: string,
  storeSellerId: string,
  to: "SUSPENDED" | "ACTIVE",
): Promise<SellerActionResult> {
  const found = await sellerMembership(admin, caller, tenantId, storeSellerId);
  if (!found.ok) return found;
  const from = to === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
  if (found.membership.status !== from) return err("invalid_status");
  const { error } = await admin.from("membership").update({ status: to }).eq("id", found.membership.id);
  if (error) return err("update_failed");
  return ok();
}

/** Nome da loja do convite de vendedor (texto do "Crie seu acesso"). null = sem loja ligada. */
export async function sellerInviteStoreName(admin: SupabaseClient, membershipId: string): Promise<string | null> {
  const { data } = await admin
    .from("membership_store")
    .select("store_id")
    .eq("membership_id", membershipId)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const { data: store } = await admin
    .from("store")
    .select("trade_name, name")
    .eq("id", data.store_id)
    .maybeSingle();
  if (!store) return null;
  return ((store.trade_name as string | null)?.trim() || (store.name as string)) ?? null;
}

async function sellerMembership(
  admin: SupabaseClient,
  caller: SellerCaller,
  tenantId: string,
  storeSellerId: string,
): Promise<{ ok: true; membership: MembershipRow } | { ok: false; error: string }> {
  const seller = await sellerOf(admin, tenantId, storeSellerId);
  if (!seller) return err("invalid_seller");
  if (!canManageStore(caller.role, caller.memberStoreIds, seller.store_id)) return err("forbidden");
  const membership = await membershipOf(admin, seller.membership_id);
  if (!membership || membership.role !== "SELLER") return err("no_access");
  return { ok: true, membership };
}
