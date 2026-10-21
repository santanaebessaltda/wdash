import { buildTeamDashboardView, type Scope, type TeamAggInput, type TeamDashboardView } from "../dashboard";
import { dayInGeneralGoal } from "./goalView";
import type { GoalRecord } from "./goalTypes";

export { dayInGeneralGoal };

/** Tira as vendas dos dias em meta Geral. Sem meta Geral, devolve o mesmo array. */
export function omitGeneralGoalSellerRows<T extends { storeId: string; day: string }>(
  rows: T[] | undefined,
  goals: GoalRecord[],
  today: string,
): T[] | undefined {
  if (!rows || !goals.some((goal) => goal.tierMode === "GENERAL")) return rows;
  return rows.filter((row) => !dayInGeneralGoal(goals, row.storeId, row.day, today));
}

/**
 * Ranking, pódio e lista da Equipe: a filial em meta Geral fica de fora.
 * Os KPIs, a composição e o faturamento por grupo continuam os da view completa.
 */
export function rankingOutsideGeneralGoal(
  scope: Scope,
  input: TeamAggInput,
  goals: GoalRecord[],
  today: string,
): TeamDashboardView {
  const base = buildTeamDashboardView(scope, input);
  const sellerDayAggs = omitGeneralGoalSellerRows(input.sellerDayAggs, goals, today);
  if (sellerDayAggs === input.sellerDayAggs) return base;
  return { ...base, people: buildTeamDashboardView(scope, { ...input, sellerDayAggs }).people };
}
