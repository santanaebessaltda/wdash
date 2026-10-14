import { paths } from "@/router/paths";

/** Detalhe aberto por outra tela volta para ela. Sem origem, volta para a lista de metas. */
export function goalBackPath(state: unknown): string {
  const from = (state as { from?: string } | null)?.from;
  if (typeof from === "string" && from.startsWith("/") && !from.startsWith("//")) return from;
  return paths.goals;
}

function teamTabReturn(search: string, tab: "goals" | "challenges"): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("tab", tab);
  return `${paths.team}?${params.toString()}`;
}

/** Equipe, aba Metas, com a query da tela de onde saiu (filial e período). */
export function teamGoalsReturn(search: string): string {
  return teamTabReturn(search, "goals");
}

/** Equipe, aba Desafios, com a query da tela de onde saiu (filial e período). */
export function teamChallengesReturn(search: string): string {
  return teamTabReturn(search, "challenges");
}
