/** Ranking da loja na meta para a tela do vendedor: so nome, % e nivel (sem R$ de ninguem). */
import type { GoalCardView, SellerRow } from "./goalTypes.ts";

export interface SellerRankingEntry {
  position: number;
  name: string;
  /** % da meta individual (modo Grupo: vendido  (meta do grupo  pessoas do grupo)). */
  pct: number;
  /** "N2  |  Super"; null = abaixo do 1 nivel. No modo Grupo e o nivel do grupo. */
  level: string | null;
  me: boolean;
}

export interface SellerRanking {
  entries: SellerRankingEntry[];
  /** p.p. da meta ate a pessoa logo acima; null = 1 lugar, sozinho ou fora do ranking. */
  gapPp: number | null;
  abovePosition: number | null;
}

/** Mesmo grupo = mesmo nome, mesma meta e mesmo atingimento (no modo Grupo todos do grupo tem o mesmo %). */
function groupKey(view: GoalCardView, r: SellerRow): string {
  return view.qtyGroups === 0 ? "*" : `${r.group}|${r.individualGoalAmount}|${r.attainmentPct}`;
}

/** Pessoas do grupo da linha (modo Grupo); 1 no modo Individual. */
export function groupSize(view: GoalCardView, row: SellerRow): number {
  if (view.kind === "individual") return 1;
  const key = groupKey(view, row);
  return view.sellers.filter((r) => !r.noGoal && groupKey(view, r) === key).length;
}

function individualPct(view: GoalCardView, r: SellerRow): number {
  if (view.kind === "individual") return r.attainmentPct;
  const personGoal = r.individualGoalAmount / groupSize(view, r);
  return personGoal > 0 ? (r.revenueAmount / personGoal) * 100 : 0;
}

export function buildSellerRanking(view: GoalCardView, meKey: string): SellerRanking {
  const ordered = view.sellers
    .filter((r) => !r.noGoal)
    .map((r) => ({ r, pct: individualPct(view, r) }))
    .sort((a, b) => b.pct - a.pct || a.r.name.localeCompare(b.r.name, "pt-BR"));
  const entries: SellerRankingEntry[] = [];
  ordered.forEach(({ r, pct }, i) => {
    const prev = entries[i - 1];
    entries.push({
      position: prev && prev.pct === pct ? prev.position : i + 1,
      name: r.name,
      pct,
      level: r.currentLevel ? `N${r.currentLevel} · ${r.currentTierName}` : null,
      me: r.employeeId === meKey,
    });
  });
  const me = entries.find((e) => e.me);
  if (!me || me.position === 1) return { entries, gapPp: null, abovePosition: null };
  const above = entries[entries.findIndex((e) => e.position === me.position) - 1]!;
  return { entries, gapPp: above.pct - me.pct, abovePosition: above.position };
}
