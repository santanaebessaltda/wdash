/** Busca de pessoa: nome ou código no Millennium, com ou sem zeros à esquerda. */
export function matchesCodeOrName(name: string, code: string | null | undefined, query: string): boolean {
  const q = query.trim().toLocaleLowerCase("pt-BR");
  if (!q) return true;
  if (name.toLocaleLowerCase("pt-BR").includes(q)) return true;
  const raw = (code ?? "").trim().toLocaleLowerCase("pt-BR");
  if (!raw) return false;
  if (raw.includes(q)) return true;
  const digits = q.replace(/\D/g, "").replace(/^0+/, "");
  const codeDigits = raw.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length > 0 && codeDigits.includes(digits);
}
