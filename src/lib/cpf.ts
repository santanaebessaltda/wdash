/** Utilidades de CPF: mascara, limpeza e validacao do digito verificador. */

export function somenteDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

/** 12345678909  ->  123.456.789-09 (parcial enquanto digita). */
export function mascararCpf(v: string): string {
  const d = somenteDigitos(v).slice(0, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);
  let out = p1;
  if (p2) out += `.${p2}`;
  if (p3) out += `.${p3}`;
  if (p4) out += `-${p4}`;
  return out;
}

function calcularDigito(base: string, pesoInicial: number): number {
  let soma = 0;
  for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

/** Valida os dois digitos verificadores. Rejeita sequencias repetidas. */
export function cpfValido(v: string): boolean {
  const d = somenteDigitos(v);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  const d1 = calcularDigito(d.slice(0, 9), 10);
  const d2 = calcularDigito(d.slice(0, 10), 11);
  return d1 === Number(d[9]) && d2 === Number(d[10]);
}

/** Gera um CPF valido a partir dos 9 primeiros digitos (uso em mocks). */
export function cpfDeBase(base9: string): string {
  const d1 = calcularDigito(base9, 10);
  const d2 = calcularDigito(base9 + d1, 11);
  return `${base9}${d1}${d2}`;
}
