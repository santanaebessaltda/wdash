/** Rascunho do onboarding (etapa ERP) sobrevive a F5 (localStorage). Senha do ERP só em memória. */

export type RascunhoOnboarding = {
  erp: {
    usuario: string;
    dedicada: boolean;
    aceite: boolean;
  };
};

const PREFIXO = "wedash-onboarding:";
const PREFIXO_SENHA = "wedash-onboarding-senha:";

function chave(membershipId: string) {
  return `${PREFIXO}${membershipId}`;
}

function chaveSenha(membershipId: string) {
  return `${PREFIXO_SENHA}${membershipId}`;
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
  gravarSenhaErp(membershipId, "");
  try {
    window.localStorage.removeItem(chave(membershipId));
  } catch {
    /* ignore */
  }
}

/** Senha do ERP só na memória do separador. F5 pede de novo. Apaga resto antigo no sessionStorage. */
const senhasErp = new Map<string, string>();

function apagarSenhaGuardada(membershipId: string) {
  try {
    window.sessionStorage.removeItem(chaveSenha(membershipId));
  } catch {
    /* ignore */
  }
}

export function lerSenhaErp(membershipId: string): string {
  apagarSenhaGuardada(membershipId);
  return senhasErp.get(membershipId) ?? "";
}

export function gravarSenhaErp(membershipId: string, senha: string) {
  apagarSenhaGuardada(membershipId);
  if (senha) senhasErp.set(membershipId, senha);
  else senhasErp.delete(membershipId);
}
