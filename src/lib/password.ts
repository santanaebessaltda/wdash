/** Regras de senha do produto (criar / redefinir). */

export const PASSWORD_MIN = 8;

/** Qualquer caractere que nao seja letra ou digito. */
const ESPECIAL = /[^A-Za-z0-9]/;

export type PasswordCheck = { ok: true } | { ok: false; error: string };

export function passwordHasSpecial(senha: string): boolean {
  return ESPECIAL.test(senha);
}

export function validatePassword(senha: string): PasswordCheck {
  if (senha.length < PASSWORD_MIN) {
    return { ok: false, error: `Use pelo menos ${PASSWORD_MIN} caracteres.` };
  }
  if (!passwordHasSpecial(senha)) {
    return { ok: false, error: "Inclua 1 caractere especial, como !, @, # ou $." };
  }
  return { ok: true };
}

export function passwordIsValid(senha: string): boolean {
  return validatePassword(senha).ok;
}

/** Texto curto para medidor / placeholder de regra. */
export const PASSWORD_RULE_TEXT = `Use pelo menos ${PASSWORD_MIN} caracteres e 1 caractere especial.`;

export function passwordStrengthHint(senha: string): string {
  const n = senha.length;
  if (n === 0) return PASSWORD_RULE_TEXT;
  if (n < PASSWORD_MIN) {
    const falta = PASSWORD_MIN - n;
    return falta === 1 ? "Use mais 1 caractere." : `Use mais ${falta} caracteres.`;
  }
  if (!passwordHasSpecial(senha)) return "Inclua 1 caractere especial, como !, @, # ou $.";
  return "Senha válida.";
}
