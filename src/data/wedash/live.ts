/** Linha do podio (Equipe e Inicio do vendedor). */
export interface RankingRow {
  position: number;
  employeeId: string;
  name: string;
  /** Nome real quando o rótulo do pódio é "VOCÊ". A foto e as iniciais usam este nome. */
  avatarName?: string;
  sales: number;
  revenue: number;
}
