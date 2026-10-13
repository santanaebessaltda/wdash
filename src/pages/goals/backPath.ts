import { paths } from "@/router/paths";

/** Detalhe aberto por outra tela volta para ela. Sem origem, volta para a lista de metas. */
export function goalBackPath(state: unknown): string {
  const from = (state as { from?: string } | null)?.from;
  if (typeof from === "string" && from.startsWith("/") && !from.startsWith("//")) return from;
  return paths.goals;
}

/** Equipe, aba Metas, com a query da tela de onde saiu (filial e período). */
export function teamGoalsReturn(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("tab", "goals");
  return `${paths.team}?${params.toString()}`;
}
