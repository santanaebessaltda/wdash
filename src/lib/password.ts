/** Regras de senha do produto (criar / redefinir). */

export const SENHA_MIN = 8;

/** Qualquer caractere que nao seja letra ou digito. */
const ESPECIAL = /[^A-Za-z0-9]/;

export type SenhaCheck = { ok: true } | { ok: false; erro: string };

export function senhaTemEspecial(senha: string): boolean {
  return ESPECIAL.test(senha);
}

export function validarSenha(senha: string): SenhaCheck {
  if (senha.length < SENHA_MIN) {
    return { ok: false, erro: `Use pelo menos ${SENHA_MIN} caracteres.` };
  }
  if (!senhaTemEspecial(senha)) {
    return { ok: false, erro: "Inclua 1 caractere especial, como !, @, # ou $." };
  }
  return { ok: true };
}

export function senhaValida(senha: string): boolean {
  return validarSenha(senha).ok;
}

/** Texto curto para medidor / placeholder de regra. */
export const SENHA_REGRA_TEXTO = `Use pelo menos ${SENHA_MIN} caracteres e 1 caractere especial.`;

export function dicaForcaSenha(senha: string): string {
  const n = senha.length;
  if (n === 0) return SENHA_REGRA_TEXTO;
  if (n < SENHA_MIN) {
    const falta = SENHA_MIN - n;
    return falta === 1 ? "Use mais 1 caractere." : `Use mais ${falta} caracteres.`;
  }
  if (!senhaTemEspecial(senha)) return "Inclua 1 caractere especial, como !, @, # ou $.";
  return "Senha válida.";
}
