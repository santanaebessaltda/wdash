/** Regras de senha do produto (criar / redefinir). */

export const PASSWORD_MIN = 8;

/** Qualquer caractere que nao seja letra ou digito. */
const ESPECIAL = /[^A-Za-z0-9]/;

export type PasswordCheck = { ok: true } | { ok: false; error: string };

export function passwordHasSpecial(password: string): boolean {
  return ESPECIAL.test(password);
}

export function validatePassword(password: string): PasswordCheck {
  if (password.length < PASSWORD_MIN) {
    return { ok: false, error: `Use pelo menos ${PASSWORD_MIN} caracteres.` };
  }
  if (!passwordHasSpecial(password)) {
    return { ok: false, error: "Inclua 1 caractere especial, como !, @, # ou $." };
  }
  return { ok: true };
}

export function passwordIsValid(password: string): boolean {
  return validatePassword(password).ok;
}

/** Texto curto para medidor / placeholder de regra. */
export const PASSWORD_RULE_TEXT = `Use pelo menos ${PASSWORD_MIN} caracteres e 1 caractere especial.`;

export function passwordStrengthHint(password: string): string {
  const n = password.length;
  if (n === 0) return PASSWORD_RULE_TEXT;
  if (n < PASSWORD_MIN) {
    const gap = PASSWORD_MIN - n;
    return gap === 1 ? "Use mais 1 caractere." : `Use mais ${gap} caracteres.`;
  }
  if (!passwordHasSpecial(password)) return "Inclua 1 caractere especial, como !, @, # ou $.";
  return "Senha válida.";
}
