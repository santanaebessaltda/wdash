import { timingSafeEqual } from "node:crypto";

/** O Atualizar chama o worker com este segredo. Sem ele, a rota nem existe. */
export function bearerMatches(header: string | undefined, expected: string): boolean {
  if (!expected) return false;
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return false;
  const got = header.slice(prefix.length);
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function seedCookieJar(header: string): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of header.split(";")) {
    const cut = part.indexOf("=");
    if (cut > 0) jar.set(part.slice(0, cut).trim(), part.slice(cut + 1).trim());
  }
  return jar;
}
