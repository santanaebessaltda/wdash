import { addMonths, endOfMonth, startOfMonth } from "./engine/format";

export type GoalSpan = { startsOn: string; endsOn: string };

/** O mês civil cruza alguma meta da filial. */
export function monthCoveredByGoal(monthStart: string, goals: GoalSpan[]): boolean {
  const start = startOfMonth(monthStart);
  const end = endOfMonth(start);
  return goals.some((goal) => goal.startsOn.slice(0, 10) <= end && goal.endsOn.slice(0, 10) >= start);
}

/**
 * Escala abre no mês de hoje quando ele tem meta.
 * Sem meta nesse mês, abre no mês seguinte.
 */
export function scheduleStartMonth(today: string, goals: GoalSpan[]): string {
  const current = startOfMonth(today);
  return monthCoveredByGoal(current, goals) ? current : addMonths(current, 1);
}

/**
 * Mês mais antigo alcançável a partir de `anchor`, só por meses seguidos com meta.
 * Se o próprio `anchor` não tem meta, ele é o chão: o mês anterior fica bloqueado.
 */
export function goalMonthFloor(anchor: string, goals: GoalSpan[]): string {
  let month = startOfMonth(anchor);
  if (!monthCoveredByGoal(month, goals)) return month;
  let previous = addMonths(month, -1);
  while (monthCoveredByGoal(previous, goals)) {
    month = previous;
    previous = addMonths(month, -1);
  }
  return month;
}

/** O chão da tela é o mais recente entre o dado já gravado e a meta. */
export function laterMonth(a: string, b: string): string {
  const left = startOfMonth(a);
  const right = startOfMonth(b);
  return left > right ? left : right;
}
