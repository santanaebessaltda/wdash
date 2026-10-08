/**
 * team-members  -  Configuracoes > Usuarios (Gestor / Gerente) + aceite do convite.
 *
 * Acoes do Gestor (OWNER/ADMIN_GLOBAL ativo): list  |  invite  |  link  |  resend  |  update  |  suspend  |  reactivate  |  revoke.
 * Acoes da pessoa convidada (JWT aberto pelo link do e-mail): invite_info  |  accept.
 *
 * Convite = Supabase Auth `inviteUserByEmail` (SMTP do projeto), so com o e-mail. identity/membership
 * nascem PENDING (nome vazio); `accept` grava nome e sobrenome do "Crie seu acesso" e ativa.
 * membership_store vazio = todas as lojas.
 */
import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, serve } from "../_shared/cors.ts";
import {
  sellerCaller,
  sellerInvite,
  sellerInviteStoreName,
  sellerLink,
  sellerList,
  sellerResend,
  sellerRemove,
  sellerRevoke,
  sellerSetStatus,
} from "../_shared/sellerInvite.ts";
import { titleName } from "../_shared/text.ts";

type Role = "OWNER" | "MANAGER";
const ROLES: Role[] = ["OWNER", "MANAGER"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const fail = (error: string) => json({ ok: false, error });

function emailOk(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Origem fixa do app — nunca aceitar origin do body (open redirect no e-mail). */
const APP_ORIGIN = (Deno.env.get("APP_ORIGIN") ?? "https://wdash.app").replace(/\/$/, "");

function inviteRedirect(): string {
  return `${APP_ORIGIN}/invite/link`;
}

const ROLE_LABEL: Record<Role, string> = { OWNER: "Gestor", MANAGER: "Gerente" };

/** Mais recente entre duas datas ISO (null = ausente). */
function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * Metadados do convite da WDash (Usuarios / vendedores).
 * `wdash: "member"` impede o trigger de franqueado (Invite do painel Supabase) de abrir empresa nova.
 */
async function inviteData(admin: SupabaseClient, tenantId: string, role: Role) {
  const { data: ten } = await admin.from("tenant").select("name").eq("id", tenantId).maybeSingle();
  return { company: ten?.name ?? "", role: ROLE_LABEL[role], wdash: "member" };
}

/** Conta nova de vendedor (convite por e-mail). Devolve o id do usuario ou o codigo do erro. */
async function inviteSellerAccount(
  admin: SupabaseClient,
  tenantId: string,
  email: string,
): Promise<{ userId: string } | { error: string }> {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { company: await companyName(admin, tenantId), role: "Equipe de vendas", wdash: "member" },
    redirectTo: inviteRedirect(),
  });
  if (error || !data.user) return { error: authErrorCode(error) };
  return { userId: data.user.id };
}

/** Reenvia o convite do vendedor. null = enviado. */
async function resendSellerInvite(
  admin: SupabaseClient,
  tenantId: string,
  email: string,
): Promise<string | null> {
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { company: await companyName(admin, tenantId), role: "Equipe de vendas", wdash: "member" },
    redirectTo: inviteRedirect(),
  });
  return error ? authErrorCode(error) : null;
}

async function companyName(admin: SupabaseClient, tenantId: string): Promise<string> {
  const { data } = await admin.from("tenant").select("name").eq("id", tenantId).maybeSingle();
  return data?.name ?? "";
}

function authErrorCode(e: { message?: string; status?: number; code?: string } | null): string {
  const msg = (e?.message ?? "").toLowerCase();
  const code = (e?.code ?? "").toLowerCase();
  if (msg.includes("rate limit") || code.includes("rate_limit") || e?.status === 429) return "rate_limited";
  if (msg.includes("already been registered") || code === "email_exists") return "email_in_use";
  return "email_failed";
}

async function tenantStoreIds(admin: SupabaseClient, tenantId: string): Promise<Set<string>> {
  const { data } = await admin.from("store").select("id").eq("tenant_id", tenantId).eq("active", true);
  return new Set((data ?? []).map((r) => r.id as string));
}

/** `allStores` = vazio (todas, inclusive lojas novas); senao 1 loja do tenant. */
function parseStoreIds(body: Record<string, unknown>, allowed: Set<string>): string[] | null {
  if (body.allStores === true) return [];
  if (!Array.isArray(body.storeIds)) return null;
  const ids = [...new Set(body.storeIds.filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (ids.length === 0 || ids.some((id) => !allowed.has(id))) return null;
  return ids;
}

async function replaceStores(admin: SupabaseClient, membershipId: string, storeIds: string[]) {
  const { error: delErr } = await admin.from("membership_store").delete().eq("membership_id", membershipId);
  if (delErr) throw delErr;
  if (storeIds.length === 0) return;
  const { error } = await admin
    .from("membership_store")
    .insert(storeIds.map((store_id) => ({ membership_id: membershipId, store_id })));
  if (error) throw error;
}

/** Pessoa convidada: identity pelo JWT + convite pendente mais recente. */
async function invitee(admin: SupabaseClient, user: User) {
  const { data: identity } = await admin
    .from("identity")
    .select("id, name, email, status")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!identity) return null;
  const { data: memberships } = await admin
    .from("membership")
    .select("id, role, status, tenant_id, is_owner, created_at")
    .eq("identity_id", identity.id)
    .order("created_at", { ascending: false });
  return { identity, memberships: memberships ?? [] };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseAnon || !serviceKey) return json({ error: "server_misconfigured" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const action = typeof body.action === "string" ? body.action : "";
  const admin = createClient(supabaseUrl, serviceKey);

  /* ---------- Pessoa convidada ---------- */
  if (action === "invite_info" || action === "accept") {
    let me = await invitee(admin, userData.user);
    // Convite orfao: Auth existe, identity ficou sem auth_user_id ou com id antigo.
    if (!me && userData.user.email) {
      const email = userData.user.email.trim().toLowerCase();
      const { data: orphan } = await admin
        .from("identity")
        .select("id, name, email, status, auth_user_id")
        .eq("email", email)
        .eq("status", "PENDING")
        .maybeSingle();
      if (orphan && orphan.auth_user_id !== userData.user.id) {
        const { error: linkErr } = await admin
          .from("identity")
          .update({ auth_user_id: userData.user.id })
          .eq("id", orphan.id);
        if (!linkErr) me = await invitee(admin, userData.user);
      }
    }
    if (!me) return fail("not_found");
    const pending = me.memberships.find((m) => m.status === "PENDING");
    if (!pending) {
      const active = me.memberships.some((m) => m.status === "ACTIVE");
      return fail(active ? "already_active" : "not_found");
    }
    if (action === "invite_info") {
      const { data: ten } = await admin
        .from("tenant")
        .select("name")
        .eq("id", pending.tenant_id)
        .maybeSingle();
      const storeName = pending.role === "SELLER" ? await sellerInviteStoreName(admin, pending.id) : null;
      // is_owner no PENDING = franqueado provisionado pelo Invite do painel Supabase.
      const kind = pending.is_owner ? "franchisee" : "member";
      return json({
        ok: true,
        email: me.identity.email,
        role: pending.role,
        companyName: ten?.name ?? "",
        storeName,
        kind,
      });
    }
    const firstName = titleName(typeof body.firstName === "string" ? body.firstName : "");
    const lastName = titleName(typeof body.lastName === "string" ? body.lastName : "");
    if (firstName.length < 2 || lastName.length < 2) return fail("invalid_personal_data");
    const now = new Date().toISOString();
    const { error: mErr } = await admin
      .from("membership")
      .update({ status: "ACTIVE", accepted_at: now })
      .eq("id", pending.id);
    if (mErr) return fail("accept_failed");
    const { error: iErr } = await admin
      .from("identity")
      .update({
        status: "ACTIVE",
        temporary_password: false,
        first_name: firstName,
        last_name: lastName,
        name: titleName(`${firstName} ${lastName}`),
      })
      .eq("id", me.identity.id);
    if (iErr) return fail("accept_failed");
    return json({ ok: true });
  }

  /* ---------- Gestor ---------- */
  const { data: callerIdentity } = await admin
    .from("identity")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (!callerIdentity) return json({ error: "identity_not_found" }, 403);
  const { data: caller } = await admin
    .from("membership")
    .select("id, tenant_id, role")
    .eq("identity_id", callerIdentity.id)
    .eq("status", "ACTIVE")
    .in("role", ["OWNER", "ADMIN_GLOBAL", "MANAGER"])
    .limit(1)
    .maybeSingle();
  if (!caller) return json({ error: "forbidden" }, 403);
  const tenantId = caller.tenant_id as string;

  /* ---------- Vendedor (Gestor em qualquer loja; Gerente so nas lojas dele) ---------- */
  if (action.startsWith("seller_")) {
    const who = await sellerCaller(admin, userData.user.id, tenantId);
    if (!who) return json({ error: "forbidden" }, 403);
    const storeSellerId = typeof body.storeSellerId === "string" ? body.storeSellerId : "";
    const storeId = typeof body.storeId === "string" ? body.storeId : "";
    const invite = (email: string) => inviteSellerAccount(admin, tenantId, email);
    const resend = (email: string) => resendSellerInvite(admin, tenantId, email);
    const result =
      action === "seller_list" ? await sellerList(admin, who, tenantId, storeId)
      : action === "seller_invite" ? await sellerInvite(admin, who, { tenantId, storeSellerId, email: String(body.email ?? ""), origin: body.origin, invite })
      : action === "seller_link" ? await sellerLink(admin, who, tenantId, storeSellerId)
      : action === "seller_resend" ? await sellerResend(admin, who, tenantId, storeSellerId, resend)
      : action === "seller_revoke" ? await sellerRevoke(admin, who, tenantId, storeSellerId)
      : action === "seller_remove" ? await sellerRemove(admin, who, tenantId, storeSellerId)
      : action === "seller_suspend" ? await sellerSetStatus(admin, who, tenantId, storeSellerId, "SUSPENDED")
      : action === "seller_reactivate" ? await sellerSetStatus(admin, who, tenantId, storeSellerId, "ACTIVE")
      : null;
    if (!result) return fail("invalid_action");
    return result.ok ? json(result) : fail(String(result.error));
  }

  if (caller.role === "MANAGER") return json({ error: "forbidden" }, 403);

  if (action === "list") {
    const [{ data: rows, error }, { data: storeRows }] = await Promise.all([
      admin
        .from("membership")
        .select("id, role, status, is_owner, accepted_at, created_at, identity:identity_id (id, auth_user_id, name, email, last_seen_at), membership_store (store_id)")
        .eq("tenant_id", tenantId)
        .in("role", ROLES)
        .in("status", ["PENDING", "ACTIVE", "SUSPENDED"])
        .order("created_at"),
      admin.from("store").select("id, code, name, trade_name").eq("tenant_id", tenantId).eq("active", true).order("code"),
    ]);
    if (error) return fail("list_failed");
    const members = await Promise.all(
      (rows ?? []).map(async (r) => {
        const ident = r.identity as unknown as {
          id: string;
          auth_user_id: string;
          name: string;
          email: string;
          last_seen_at: string | null;
        };
        const { data: au } = await admin.auth.admin.getUserById(ident.auth_user_id);
        return {
          membershipId: r.id,
          name: ident.name,
          email: ident.email,
          role: r.role,
          status: r.status,
          isOwner: r.is_owner,
          isSelf: r.id === caller.id,
          storeIds: ((r.membership_store as { store_id: string }[] | null) ?? []).map((s) => s.store_id),
          invitedAt: au.user?.invited_at ?? r.created_at,
          lastSignInAt: latest(ident.last_seen_at, au.user?.last_sign_in_at ?? null),
          acceptedAt: r.accepted_at,
        };
      }),
    );
    const stores = (storeRows ?? []).map((s) => ({
      id: s.id,
      code: s.code,
      name: (s.trade_name as string | null)?.trim() || (s.name as string),
    }));
    return json({ ok: true, members, stores });
  }

  if (action === "invite") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const role = body.role as Role;
    if (!emailOk(email)) return fail("invalid_email");
    if (!ROLES.includes(role)) return fail("invalid_role");
    const storeIds = parseStoreIds(body, await tenantStoreIds(admin, tenantId));
    if (!storeIds) return fail("invalid_stores");

    const { data: existing } = await admin
      .from("identity")
      .select("id, membership (id, tenant_id, status)")
      .eq("email", email)
      .maybeSingle();
    if (existing) {
      const ms = (existing.membership as { tenant_id: string; status: string }[] | null) ?? [];
      const here = ms.find((m) => m.tenant_id === tenantId);
      if (here) return fail(here.status === "PENDING" ? "already_invited" : "already_member");
      return fail("email_in_use");
    }

    // Auth orfao (e-mail convidado sem identity): remove para o invite criar tudo de novo.
    try {
      const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const orphanAuth = (listed?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email);
      if (orphanAuth) {
        const { data: linked } = await admin
          .from("identity")
          .select("id")
          .eq("auth_user_id", orphanAuth.id)
          .maybeSingle();
        if (!linked) await admin.auth.admin.deleteUser(orphanAuth.id);
      }
    } catch {
      /* segue para o invite */
    }

    const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: await inviteData(admin, tenantId, role),
      redirectTo: inviteRedirect(),
    });
    if (invErr || !invited.user) return fail(authErrorCode(invErr));

    const rollback = async () => {
      await admin.auth.admin.deleteUser(invited.user.id);
    };
    const { data: identity, error: idErr } = await admin
      .from("identity")
      .insert({ auth_user_id: invited.user.id, email, name: "", status: "PENDING" })
      .select("id")
      .single();
    if (idErr || !identity) {
      await rollback();
      return fail("invite_failed");
    }
    const { data: membership, error: mErr } = await admin
      .from("membership")
      .insert({ identity_id: identity.id, tenant_id: tenantId, role, status: "PENDING", is_owner: false })
      .select("id")
      .single();
    if (mErr || !membership) {
      await rollback();
      return fail("invite_failed");
    }
    try {
      await replaceStores(admin, membership.id as string, storeIds);
    } catch {
      await rollback();
      return fail("invite_failed");
    }
    return json({ ok: true, membershipId: membership.id });
  }

  /* Acoes sobre um membro existente do tenant. */
  const membershipId = typeof body.membershipId === "string" ? body.membershipId : "";
  if (!membershipId) return fail("invalid_member");
  const { data: target } = await admin
    .from("membership")
    .select("id, role, status, is_owner, identity:identity_id (id, auth_user_id, email, name, status)")
    .eq("id", membershipId)
    .eq("tenant_id", tenantId)
    .in("role", ROLES)
    .maybeSingle();
  if (!target) return fail("invalid_member");
  const targetIdentity = target.identity as unknown as {
    id: string;
    auth_user_id: string;
    email: string;
    name: string;
    status: string;
  };
  const protectedTarget = target.is_owner || target.id === caller.id;

  if (action === "link") {
    if (target.status !== "PENDING") return fail("not_pending");
    const { data, error } = await admin.rpc("invite_link_token", {
      p_auth_user_id: targetIdentity.auth_user_id,
    });
    if (error) return fail("link_failed");
    const token = typeof data === "string" ? data : "";
    if (!token) return fail("no_link");
    return json({ ok: true, token });
  }

  if (action === "resend") {
    if (target.status !== "PENDING") return fail("not_pending");
    const { error } = await admin.auth.admin.inviteUserByEmail(targetIdentity.email, {
      data: await inviteData(admin, tenantId, target.role as Role),
      redirectTo: inviteRedirect(),
    });
    if (error) return fail(authErrorCode(error));
    return json({ ok: true });
  }

  if (action === "update") {
    if (protectedTarget) return fail("protected_member");
    const role = body.role as Role;
    if (!ROLES.includes(role)) return fail("invalid_role");
    const storeIds = parseStoreIds(body, await tenantStoreIds(admin, tenantId));
    if (!storeIds) return fail("invalid_stores");
    const { error } = await admin.from("membership").update({ role }).eq("id", target.id);
    if (error) return fail("update_failed");
    try {
      await replaceStores(admin, target.id as string, storeIds);
    } catch {
      return fail("update_failed");
    }
    return json({ ok: true });
  }

  if (action === "suspend" || action === "reactivate") {
    if (protectedTarget) return fail("protected_member");
    const from = action === "suspend" ? "ACTIVE" : "SUSPENDED";
    if (target.status !== from) return fail("invalid_status");
    const { error } = await admin
      .from("membership")
      .update({ status: action === "suspend" ? "SUSPENDED" : "ACTIVE" })
      .eq("id", target.id);
    if (error) return fail("update_failed");
    return json({ ok: true });
  }

  if (action === "revoke") {
    if (target.status !== "PENDING") return fail("not_pending");
    const { error } = await admin.from("membership").delete().eq("id", target.id);
    if (error) return fail("revoke_failed");
    const { count } = await admin
      .from("membership")
      .select("id", { count: "exact", head: true })
      .eq("identity_id", targetIdentity.id);
    // Conta criada so para este convite: apaga o usuario do Auth (identity cai em cascata).
    if ((count ?? 0) === 0 && targetIdentity.status === "PENDING") {
      await admin.auth.admin.deleteUser(targetIdentity.auth_user_id);
    }
    return json({ ok: true });
  }

  return fail("invalid_action");
});
