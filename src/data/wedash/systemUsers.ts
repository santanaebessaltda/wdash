import { getSupabase } from "@/lib/supabase";
import { stores as demoStores } from "@/data/wedash/stores";
import { companyNameCase, titleName } from "@/lib/format";

/** Papeis de quem acessa o sistema (fora a equipe de vendas). */
export type SystemRole = "OWNER" | "MANAGER";
export type SystemUserStatus = "PENDING" | "ACTIVE" | "SUSPENDED";

export interface SystemUser {
  membershipId: string;
  /** Vazio enquanto o convite nao foi aceito (o nome vem do "Crie seu acesso"). */
  name: string;
  email: string;
  role: SystemRole;
  status: SystemUserStatus;
  /** Gestor principal (criou a conta)  -  nao pode ser editado nem suspenso. */
  isOwner: boolean;
  isSelf: boolean;
  /** Vazio = todas as lojas (inclui lojas novas). */
  storeIds: string[];
  invitedAt: string | null;
  lastSignInAt: string | null;
  acceptedAt: string | null;
}

export interface SystemUserStore {
  id: string;
  code: string;
  name: string;
}

export interface SystemUsersData {
  members: SystemUser[];
  stores: SystemUserStore[];
}

export interface InviteInput {
  email: string;
  role: SystemRole;
  /** Vazio = todas as lojas (inclusive as que abrirem depois). */
  storeIds: string[];
}

/** `code` = codigo de erro da Edge, para a tela trocar a mensagem pelo contexto (ex.: `protected_member`). */
export type ActionResult = { ok: true } | { ok: false; message: string; code?: string };

const GENERIC_ERROR = "Não foi possível concluir. Tente novamente.";
const LOAD_ERROR = "Não foi possível carregar os usuários. Tente novamente.";

const MESSAGES: Record<string, string> = {
  invalid_email: "Informe um e-mail válido.",
  invalid_role: "Escolha o tipo de acesso.",
  invalid_stores: "Escolha pelo menos uma loja.",
  already_invited: "Este e-mail já tem um convite pendente. Use Reenviar convite na aba Convites pendentes.",
  already_member: "Este e-mail já tem acesso à WDash.",
  email_in_use: "Este e-mail já está vinculado a outra empresa na WDash.",
  rate_limited: "Muitos convites foram enviados em pouco tempo. Aguarde um minuto e tente novamente.",
  email_failed: "Não foi possível enviar o e-mail do convite. Tente novamente.",
  invite_failed: "Não foi possível concluir o convite. Se o e-mail chegou, ignore-o e envie um novo convite.",
  update_failed: "Não foi possível salvar as alterações. Tente novamente.",
  revoke_failed: "Não foi possível cancelar o convite. Tente novamente.",
  protected_member: "O acesso do Gestor principal não pode ser alterado aqui.",
  not_pending: "Este convite já foi aceito ou cancelado.",
  no_link: "O link do convite não está mais disponível. Reenvie o convite.",
  link_failed: "Não foi possível copiar o link. Tente novamente.",
  forbidden: "Somente Gestores podem gerenciar usuários.",
};

function messageFor(code: string | undefined): string {
  return (code && MESSAGES[code]) || GENERIC_ERROR;
}

async function invoke<T>(
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; message: string; code?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, message: GENERIC_ERROR };
  const { data, error } = await sb.functions.invoke("team-members", {
    body: { ...body, origin: window.location.origin },
  });
  if (error) {
    let code: string | undefined;
    try {
      const ctx = (error as { context?: Response }).context;
      code = ctx ? ((await ctx.json()) as { error?: string }).error : undefined;
    } catch {
      /* ignore */
    }
    return { ok: false, message: messageFor(code), code };
  }
  const res = data as { ok?: boolean; error?: string } & T;
  if (!res?.ok) return { ok: false, message: messageFor(res?.error), code: res?.error };
  return { ok: true, data: res };
}

/* ---------- Demo (sem Supabase) ---------- */

let demo: SystemUser[] | null = null;

function demoMembers(): SystemUser[] {
  if (!demo) {
    const now = new Date().toISOString();
    demo = [
      { membershipId: "d-owner", name: "Você", email: "gestor@wedash.app", role: "OWNER", status: "ACTIVE", isOwner: true, isSelf: true, storeIds: [], invitedAt: now, lastSignInAt: now, acceptedAt: now },
      { membershipId: "d-mgr", name: "Marcos Lima", email: "marcos@exemplo.com", role: "MANAGER", status: "ACTIVE", isOwner: false, isSelf: false, storeIds: [demoStores[0]?.id ?? "f1"], invitedAt: now, lastSignInAt: now, acceptedAt: now },
      { membershipId: "d-inv", name: "", email: "paula@exemplo.com", role: "MANAGER", status: "PENDING", isOwner: false, isSelf: false, storeIds: [demoStores[1]?.id ?? "f2"], invitedAt: now, lastSignInAt: null, acceptedAt: null },
    ];
  }
  return demo;
}

function demoPatch(id: string, patch: Partial<SystemUser> | null): ActionResult {
  const list = demoMembers();
  demo = patch === null ? list.filter((m) => m.membershipId !== id) : list.map((m) => (m.membershipId === id ? { ...m, ...patch } : m));
  return { ok: true };
}

/* ---------- API ---------- */

export async function fetchSystemUsers(): Promise<{ ok: true; data: SystemUsersData } | { ok: false; message: string }> {
  if (!getSupabase()) {
    return {
      ok: true,
      data: {
        members: demoMembers().map((m) => ({ ...m, name: titleName(m.name) })),
        stores: demoStores.map((s) => ({ id: s.id, code: String(s.codFilial), name: s.fantasia })),
      },
    };
  }
  const r = await invoke<SystemUsersData>({ action: "list" });
  if (!r.ok) return { ok: false, message: r.message === GENERIC_ERROR ? LOAD_ERROR : r.message };
  const members = (r.data.members ?? []).map((m) => ({ ...m, name: titleName(m.name) }));
  return { ok: true, data: { members, stores: r.data.stores ?? [] } };
}

export async function inviteSystemUser(input: InviteInput): Promise<ActionResult> {
  if (!getSupabase()) {
    demoMembers().push({
      membershipId: `d-${Date.now()}`,
      name: "",
      email: input.email.trim().toLowerCase(),
      role: input.role,
      status: "PENDING",
      isOwner: false,
      isSelf: false,
      storeIds: input.storeIds,
      invitedAt: new Date().toISOString(),
      lastSignInAt: null,
      acceptedAt: null,
    });
    return { ok: true };
  }
  const r = await invoke({ action: "invite", ...input, allStores: input.storeIds.length === 0 });
  return r.ok ? { ok: true } : r;
}

/** `storeIds` vazio = todas as lojas. */
export async function updateSystemUser(membershipId: string, role: SystemRole, storeIds: string[]): Promise<ActionResult> {
  if (!getSupabase()) return demoPatch(membershipId, { role, storeIds });
  const r = await invoke({ action: "update", membershipId, role, storeIds, allStores: storeIds.length === 0 });
  return r.ok ? { ok: true } : r;
}

type MemberAction = "resend" | "suspend" | "reactivate" | "revoke";

/** Link igual ao do e-mail, pronto para colar (`/invite/{token}`). */
export async function copySystemUserInviteLink(
  membershipId: string,
): Promise<{ ok: true; token: string } | { ok: false; message: string; code?: string }> {
  if (!getSupabase()) return { ok: false, message: messageFor("no_link"), code: "no_link" };
  const r = await invoke<{ token?: string }>({ action: "link", membershipId });
  if (!r.ok) return r;
  const token = typeof r.data.token === "string" ? r.data.token : "";
  if (!token) return { ok: false, message: messageFor("no_link"), code: "no_link" };
  return { ok: true, token: `${window.location.origin}/invite/${token}` };
}

export async function systemUserAction(action: MemberAction, membershipId: string): Promise<ActionResult> {
  if (!getSupabase()) {
    if (action === "revoke") return demoPatch(membershipId, null);
    if (action === "suspend") return demoPatch(membershipId, { status: "SUSPENDED" });
    if (action === "reactivate") return demoPatch(membershipId, { status: "ACTIVE" });
    return demoPatch(membershipId, { invitedAt: new Date().toISOString() });
  }
  const r = await invoke({ action, membershipId });
  return r.ok ? { ok: true } : r;
}

/* ---------- Pessoa convidada ---------- */

export interface InviteInfo {
  email: string;
  role: SystemRole | "SELLER";
  companyName: string;
  /** Loja do convite de vendedor (fantasia). null para Gestor/Gerente. */
  storeName: string | null;
  /** franchisee = Invite do painel (empresa nova); member = Usuarios/Vendedores. */
  kind: "franchisee" | "member";
}

export async function fetchInviteInfo(): Promise<{ ok: true; info: InviteInfo } | { ok: false; code: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, code: "not_found" };
  const { data, error } = await sb.functions.invoke("team-members", { body: { action: "invite_info" } });
  const res = data as ({ ok?: boolean; error?: string; kind?: string } & InviteInfo) | null;
  if (error || !res?.ok) return { ok: false, code: res?.error ?? "not_found" };
  const resAny = res as InviteInfo & { storeName?: string | null; kind?: string };
  return {
    ok: true,
    info: {
      email: res.email,
      role: res.role,
      companyName: companyNameCase(res.companyName),
      storeName: resAny.storeName ? companyNameCase(resAny.storeName) : null,
      kind: resAny.kind === "franchisee" ? "franchisee" : "member",
    },
  };
}

/** Ativa o convite gravando o nome e o sobrenome informados no "Crie seu acesso". */
export async function acceptInvite(personal: { firstName: string; lastName: string }): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { data, error } = await sb.functions.invoke("team-members", {
    body: { action: "accept", firstName: titleName(personal.firstName), lastName: titleName(personal.lastName) },
  });
  return !error && Boolean((data as { ok?: boolean } | null)?.ok);
}
