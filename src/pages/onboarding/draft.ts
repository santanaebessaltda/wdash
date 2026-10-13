/** Rascunho do onboarding (etapa ERP) sobrevive a F5 (localStorage). Senha do ERP só em memória. */

export type RascunhoOnboarding = {
  erp: {
    usuario: string;
    dedicada: boolean;
    aceite: boolean;
  };
};

const PREFIXO = "wedash-onboarding:";
const PASSWORD_PREFIX = "wedash-onboarding-senha:";

function chave(membershipId: string) {
  return `${PREFIXO}${membershipId}`;
}

function passwordKey(membershipId: string) {
  return `${PASSWORD_PREFIX}${membershipId}`;
}

export function rascunhoVazio(): RascunhoOnboarding {
  return { erp: { usuario: "", dedicada: false, aceite: false } };
}

export function lerRascunho(membershipId: string): RascunhoOnboarding | null {
  try {
    const raw = window.localStorage.getItem(chave(membershipId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RascunhoOnboarding> | null;
    if (!parsed) return null;
    return {
      erp: {
        usuario: parsed.erp?.usuario ?? "",
        dedicada: parsed.erp?.dedicada ?? false,
        aceite: parsed.erp?.aceite ?? false,
      },
    };
  } catch {
    return null;
  }
}

export function gravarRascunho(membershipId: string, r: RascunhoOnboarding) {
  try {
    window.localStorage.setItem(chave(membershipId), JSON.stringify(r));
  } catch {
    /* quota / privado */
  }
}

export function limparRascunho(membershipId: string) {
  writeErpPassword(membershipId, "");
  try {
    window.localStorage.removeItem(chave(membershipId));
  } catch {
    /* ignore */
  }
}

/** Senha do ERP só na memória do separador. F5 pede de novo. Apaga resto antigo no sessionStorage. */
const erpPasswords = new Map<string, string>();

function clearStoredPassword(membershipId: string) {
  try {
    window.sessionStorage.removeItem(passwordKey(membershipId));
  } catch {
    /* ignore */
  }
}

export function readErpPassword(membershipId: string): string {
  clearStoredPassword(membershipId);
  return erpPasswords.get(membershipId) ?? "";
}

export function writeErpPassword(membershipId: string, senha: string) {
  clearStoredPassword(membershipId);
  if (senha) erpPasswords.set(membershipId, senha);
  else erpPasswords.delete(membershipId);
}
