import { getSupabase } from "@/lib/supabase";
import { accessState, type AccessState } from "@/data/wedash/engine/sellerAccess";

/** Acesso de cada vendedor da loja (coluna Acesso em Gestao > Vendedores). */
export interface SellerAccessRow {
  storeSellerId: string;
  state: AccessState;
}

export type SellerActionResult =
  | { ok: true; linked?: boolean; token?: string }
  | { ok: false; message: string; code?: string };

const GENERIC_ERROR = "Não foi possível concluir. Tente novamente.";

const MESSAGES: Record<string, string> = {
  invalid_email: "Informe um e-mail válido.",
  email_in_use: "Este e-mail já tem acesso à WDash com outro tipo de acesso.",
  already_invited: "Este vendedor já tem um convite pendente. Use Reenviar no menu da linha.",
  already_member: "Este vendedor já tem acesso à WDash.",
  email_failed: "Não foi possível enviar o convite. Tente novamente.",
  rate_limited: "Muitos convites foram enviados em pouco tempo. Aguarde um minuto e tente novamente.",
  invite_failed: "Não foi possível enviar o convite. Tente novamente.",
  not_invitable: "Só vendedores ativos podem receber acesso.",
  no_group: "Vincule um grupo antes de convidar.",
  not_pending: "Este convite já foi aceito ou cancelado.",
  no_link: "O link do convite não está mais disponível. Reenvie o convite.",
  no_access: "Este vendedor ainda não tem acesso.",
  invalid_status: "O acesso deste vendedor mudou. Atualize a página.",
  forbidden: "Você não tem permissão para gerenciar o acesso dos vendedores desta loja.",
  invalid_seller: "Vendedor não encontrado nesta loja.",
  list_failed: "Não foi possível carregar os acessos. Tente novamente.",
  update_failed: "Não foi possível alterar o acesso. Tente novamente.",
  revoke_failed: "Não foi possível cancelar o convite. Tente novamente.",
  remove_failed: "Não foi possível excluir o acesso. Tente novamente.",
};

function messageFor(code: string | undefined): string {
  return (code && MESSAGES[code]) || GENERIC_ERROR;
}

async function invoke(
  body: Record<string, unknown>,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string; code?: string }> {
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
      /* corpo ilegivel */
    }
    return { ok: false, message: messageFor(code), code };
  }
  const res = (data ?? {}) as { ok?: boolean; error?: string };
  if (!res.ok) return { ok: false, message: messageFor(res.error), code: res.error };
  return { ok: true, data: data as Record<string, unknown> };
}

export async function fetchSellerAccess(storeId: string): Promise<SellerAccessRow[] | null> {
  const r = await invoke({ action: "seller_list", storeId });
  if (!r.ok) return null;
  const sellers = (r.data.sellers as { storeSellerId: string; status: string | null }[] | undefined) ?? [];
  return sellers.map((s) => ({ storeSellerId: s.storeSellerId, state: accessState(s.status ? { status: s.status } : null) }));
}

export async function inviteSeller(storeSellerId: string, email: string): Promise<SellerActionResult> {
  const r = await invoke({ action: "seller_invite", storeSellerId, email });
  if (!r.ok) return r;
  return { ok: true, linked: r.data.linked === true };
}

/** Link igual ao do e-mail, pronto para colar (`/invite/{token}`). */
export async function copySellerInviteLink(storeSellerId: string): Promise<SellerActionResult> {
  const r = await invoke({ action: "seller_link", storeSellerId });
  if (!r.ok) return r;
  const token = typeof r.data.token === "string" ? r.data.token : "";
  if (!token) return { ok: false, message: messageFor("no_link"), code: "no_link" };
  return { ok: true, token: `${window.location.origin}/invite/${token}` };
}

export async function resendSellerInvite(storeSellerId: string): Promise<SellerActionResult> {
  const r = await invoke({ action: "seller_resend", storeSellerId });
  return r.ok ? { ok: true } : r;
}

export async function revokeSellerInvite(storeSellerId: string): Promise<SellerActionResult> {
  const r = await invoke({ action: "seller_revoke", storeSellerId });
  return r.ok ? { ok: true } : r;
}

export async function suspendSeller(storeSellerId: string): Promise<SellerActionResult> {
  const r = await invoke({ action: "seller_suspend", storeSellerId });
  return r.ok ? { ok: true } : r;
}

export async function reactivateSeller(storeSellerId: string): Promise<SellerActionResult> {
  const r = await invoke({ action: "seller_reactivate", storeSellerId });
  return r.ok ? { ok: true } : r;
}

/** Tira o acesso desta loja. A pessoa volta para Convidar. */
export async function removeSellerAccess(storeSellerId: string): Promise<SellerActionResult> {
  const r = await invoke({ action: "seller_remove", storeSellerId });
  return r.ok ? { ok: true } : r;
}
