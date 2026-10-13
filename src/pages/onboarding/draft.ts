/** Rascunho do onboarding (etapa ERP) sobrevive a F5 (localStorage). Senha do ERP só em memória. */

export type DraftOnboarding = {
  erp: {
    username: string;
    dedicada: boolean;
    aceite: boolean;
  };
};

const PREFIXO = "wedash-onboarding:";
const PASSWORD_PREFIX = "wedash-onboarding-senha:";

function rowKey(membershipId: string) {
  return `${PREFIXO}${membershipId}`;
}

function passwordKey(membershipId: string) {
  return `${PASSWORD_PREFIX}${membershipId}`;
}

export function draftEmpty(): DraftOnboarding {
  return { erp: { username: "", dedicada: false, aceite: false } };
}

export function lerDraft(membershipId: string): DraftOnboarding | null {
  try {
    const raw = window.localStorage.getItem(rowKey(membershipId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftOnboarding> | null;
    if (!parsed) return null;
    return {
      erp: {
        username: parsed.erp?.username ?? "",
        dedicada: parsed.erp?.dedicada ?? false,
        aceite: parsed.erp?.aceite ?? false,
      },
    };
  } catch {
    return null;
  }
}

export function saveDraft(membershipId: string, r: DraftOnboarding) {
  try {
    window.localStorage.setItem(rowKey(membershipId), JSON.stringify(r));
  } catch {
    /* quota / privado */
  }
}

export function clearDraft(membershipId: string) {
  writeErpPassword(membershipId, "");
  try {
    window.localStorage.removeItem(rowKey(membershipId));
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

export function writeErpPassword(membershipId: string, password: string) {
  clearStoredPassword(membershipId);
  if (password) erpPasswords.set(membershipId, password);
  else erpPasswords.delete(membershipId);
}
