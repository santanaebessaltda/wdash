const NAME_PARTICLES = new Set(["de", "da", "do", "das", "dos", "e"]);

/** Nome de pessoa / turno: "Ana Paula de Souza" (espelho de `titleName` em src/lib/format.ts  -  manter iguais). */
export function titleName(s: string | null | undefined): string {
  const words = (s ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR").split(" ");
  return words
    .map((w, i) =>
      i > 0 && NAME_PARTICLES.has(w)
        ? w
        : w.replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, sep: string, l: string) => sep + l.toLocaleUpperCase("pt-BR")),
    )
    .join(" ");
}
