/** Regras do acesso do vendedor (convite, quem gerencia, estados). Usadas pela Edge e pela tela Vendedores. */
import { SELLER_ROLE } from "./goalRows.ts";

export type AccessState = "NONE" | "PENDING" | "ACTIVE" | "SUSPENDED";

export const ACCESS_LABEL: Record<AccessState, string> = {
  NONE: "Sem acesso",
  PENDING: "Convite pendente",
  ACTIVE: "Ativo",
  SUSPENDED: "Suspenso",
};

export const EMAIL_MAX_LENGTH = 254;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validEmail(email: string): boolean {
  return email.length <= EMAIL_MAX_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Gestor em qualquer loja da empresa; Gerente so nas lojas dele (nenhuma vinculada = todas); outro papel nunca. */
export function canManageStore(role: string, memberStoreIds: string[], storeId: string): boolean {
  if (role === "OWNER" || role === "ADMIN_GLOBAL") return true;
  if (role === "MANAGER") return memberStoreIds.length === 0 || memberStoreIds.includes(storeId);
  return false;
}

/** Estado do acesso pela membership SELLER ligada ao cadastro; sem membership = Sem acesso. */
export function accessState(membership: { status: string } | null): AccessState {
  const s = membership?.status;
  return s === "PENDING" || s === "ACTIVE" || s === "SUSPENDED" ? s : "NONE";
}

const TRANSITIONS: Record<AccessState, AccessState[]> = {
  NONE: ["PENDING"],
  PENDING: ["ACTIVE", "NONE"],
  ACTIVE: ["SUSPENDED", "NONE"],
  SUSPENDED: ["ACTIVE", "NONE"],
};

export function canTransition(from: AccessState, to: AccessState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** So quem esta na equipe de vendas agora: ativo, ainda na lista do Millennium e com cargo VENDEDOR. */
export function invitable(seller: { active: boolean; inErp: boolean; erpRole: string | null }): boolean {
  return seller.active && seller.inErp && (seller.erpRole == null || seller.erpRole === SELLER_ROLE);
}

/** Convite so com grupo vinculado. Sem grupo, o ranking e a meta da tela Inicio ficam sem base. */
export function hasSalesGroup(shiftId: string | null | undefined): boolean {
  return typeof shiftId === "string" && shiftId.length > 0;
}
