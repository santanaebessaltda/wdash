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

const MESSAGES: Record<string, string> = {
  invalid_email: "Informe um e-mail válido.",
  email_in_use: "Este e-mail já está vinculado à WDash com outro tipo de acesso.",
  email_pending: "Este e-mail já tem um convite pendente para outro vendedor.",
  email_taken: "Este e-mail já está em uso por outro vendedor desta filial.",
  already_invited: "Este vendedor já tem um convite pendente. Use Reenviar convite no menu da linha.",
  already_member: "Este vendedor já tem acesso à WDash.",
  email_failed: "Não foi possível enviar o convite. Tente novamente.",
  rate_limited: "Muitos convites foram enviados em pouco tempo. Tente novamente em um minuto.",
  invite_failed: "Não foi possível enviar o convite. Tente novamente.",
  email_not_released: "Este e-mail ainda está preso a um convite cancelado. Espere um instante e tente de novo.",
  not_invitable: "Somente vendedores ativos podem receber acesso.",
  no_group: "Vincule o vendedor a um grupo antes de convidar.",
  not_pending: "Este convite já foi aceito ou cancelado.",
  no_link: "O link do convite não está mais disponível. Reenvie o convite.",
  no_access: "Este vendedor ainda não tem acesso à WDash.",
  invalid_status: "O acesso deste vendedor foi alterado. Atualize a página e tente novamente.",
  forbidden: "Você não tem permissão para gerenciar o acesso dos vendedores desta filial.",
  invalid_seller: "Vendedor não encontrado nesta filial.",
  list_failed: "Não foi possível carregar os acessos dos vendedores. Tente novamente.",
  update_failed: "Não foi possível alterar o acesso. Tente novamente.",
  revoke_failed: "Não foi possível cancelar o convite. Tente novamente.",
  remove_failed: "Não foi possível excluir o acesso. Tente novamente.",
  link_failed: "Não foi possível copiar o link. Tente novamente.",
};

/** Quando a Edge não devolve um código conhecido, a frase segue a ação. */
const ACTION_FALLBACK: Record<string, string> = {
  seller_list: MESSAGES.list_failed!,
  seller_invite: MESSAGES.invite_failed!,
  seller_resend: MESSAGES.invite_failed!,
  seller_link: MESSAGES.link_failed!,
  seller_revoke: MESSAGES.revoke_failed!,
  seller_suspend: MESSAGES.update_failed!,
  seller_reactivate: MESSAGES.update_failed!,
  seller_remove: MESSAGES.remove_failed!,
};

function messageFor(code: string | undefined, fallback: string): string {
  return (code && MESSAGES[code]) || fallback;
}

async function invoke(
  body: Record<string, unknown>,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string; code?: string }> {
  const fallback = ACTION_FALLBACK[String(body.action)] ?? "Não foi possível concluir. Tente novamente.";
  const sb = getSupabase();
  if (!sb) return { ok: false, message: fallback };
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
    return { ok: false, message: messageFor(code, fallback), code };
  }
  const res = (data ?? {}) as { ok?: boolean; error?: string };
  if (!res.ok) return { ok: false, message: messageFor(res.error, fallback), code: res.error };
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
  if (!token) return { ok: false, message: messageFor("no_link", MESSAGES.no_link!), code: "no_link" };
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
