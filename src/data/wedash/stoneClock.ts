/**
 * O arquivo da Stone do dia D existe a partir das 5h de Brasília do dia seguinte.
 * 5h em America/Sao_Paulo = 08:00 UTC (sem horário de verão).
 */
export function stoneFileReady(day: string, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + 1));
  return now.getTime() >= Date.parse(`${next.toISOString().slice(0, 10)}T08:00:00.000Z`);
}
