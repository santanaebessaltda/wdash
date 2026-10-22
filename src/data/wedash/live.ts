/** Linha do podio (Equipe e Inicio do vendedor). */
export interface RankingRow {
  position: number;
  employeeId: string;
  name: string;
  /** Nome real quando o rótulo do pódio é "VOCÊ". A foto e as iniciais usam este nome. */
  avatarName?: string;
  /** Loja da pessoa, para achar a foto pelo nome. */
  storeId?: string;
  sales: number;
  revenue: number;
  /** Nível da meta desta pessoa, no pódio. */
  note?: string;
  /** Quanto falta para o próximo nível, no pódio do placar. */
  gap?: string;
  /** Desafios do período já ganhos. No avatar do placar. */
  wins?: number;
  /** Filial, quando o placar junta mais de uma. */
  place?: string;
}
