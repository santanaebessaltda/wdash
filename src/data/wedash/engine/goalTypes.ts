/** Tipos da conta da meta (sem dependencias fora do motor). Money nos agregados = centavos inteiros. */

export interface Tier {
  name: string;
  minAttainmentPct: number;
  /** % da premiacao sobre o faturamento realizado neste degrau. */
  commissionPct: number;
  /**
   * Bonus acumulado ao atingir este degrau.
   * Regra de produto: R$ 50 por nivel (1 -> 50, 2 -> 100, 3 -> 150, 4 -> 200).
   */
  bonus: number;
  /** Premiacao da gerencia (% sobre o faturamento total da loja) ao a loja chegar neste nivel; ausente = sem premiacao da gerencia. */
  managerPct?: number;
  /** Bonus da gerencia (R$) ao a loja chegar neste nivel; soma com os niveis anteriores. */
  managerBonus?: number;
}

export type GoalType = "individual" | "grupo" | "geral";
export type GoalBrand = "WEPINK" | "WPINK";

/** Meta gravada (tabela `goal`): 1 por loja por periodo, valores em reais. */
export interface GoalRecord {
  id: string;
  storeId: string;
  name: string;
  /** ISO YYYY-MM-DD (inclusive). */
  startsOn: string;
  endsOn: string;
  /** Meta da loja no periodo (R$). */
  target: number;
  /** INDIVIDUAL = cada pessoa pela propria meta; GROUP = o grupo sobe pela soma; GENERAL = a loja sobe pelo total vendido e a premiacao se divide. */
  tierMode: "INDIVIDUAL" | "GROUP" | "GENERAL";
  tiers: Tier[];
  /** % da meta de cada grupo da loja (soma 100); vazio = sem grupos de distribuicao. */
  groups: GoalGroup[];
}

export interface GoalGroup {
  shiftId: string;
  name: string;
  pct: number;
}

/** Pessoa da equipe da loja (store_seller) para a meta. */
export interface GoalTeamMember {
  storeId: string;
  employeeId: number;
  /** Codigo de gerador no Millennium (liga os itens por pessoa dos desafios). */
  generatorId?: number | null;
  name: string;
  /** Nomes normalizados ja vistos (liga venda gravada so pelo nome). */
  nameKeys: string[];
  /** Ativo com cargo VENDEDOR = na equipe de vendas agora. */
  salesPerson: boolean;
  /** DATA_ADMISSAO. Ausente ou null = desde o início do período. */
  admittedOn?: string | null;
  /** Dia em que a WDash viu o desligamento. Ausente ou null = sem saída gravada. */
  departedOn?: string | null;
  /** Grupo da pessoa (Gestao > Vendedores). */
  shiftId: string | null;
  shiftName: string | null;
}

export interface SellerRow {
  employeeId: string;
  name: string;
  /** Filial da vendedora  -  necessaria na visao rede (coluna Shopping). */
  storeId: string;
  storeName: string;
  /** Nome do grupo (Grupo 1/Grupo 2) ou "Sem grupo". */
  group: string;
  revenueAmount: number;
  revenue: string;
  salesCount: number;
  ticketAmount: number;
  ticket: string;
  paAmount: number;
  pa: string;
  daysWorked: number;
  trend: "up" | "flat" | "down";
  // Meta individual (so com meta ativa; sem meta ficam zerados e semMeta=true)
  individualGoalAmount: number;
  proportionalGoal: boolean;
  eligibleDays: number;
  /** Dias do período da meta, para o rótulo "N de M dias". */
  periodDays: number;
  attainmentPct: number;
  barPct: number;
  /** Participacao no faturamento vs. meta da loja (valorLoja). */
  storeGoalPct: number;
  /** Marcos da escada p/ barra segmentada: { nome, pct, bonus, pctPremiacao }. */
  ladderMarks: { name: string; pct: number; prizePct: number; bonus: number }[];
  currentTierName: string | null;
  /** Indice 1-based do degrau atual (null = ainda sem nivel). */
  currentLevel: number | null;
  nextTier: { name: string; gapAmount: number; prizePct: number; bonus: number; minAttainmentPct: number } | null;
  /** Premiacao acumulada da escada de metas (realizado x pct do degrau). */
  accruedPrize: number;
  /** % de premiacao do degrau atual (0 se ainda nao entrou na escada). */
  commissionPct: number;
  /** Premiacao projetada pelo ritmo: realizado escalado x pct do degrau projetado. */
  projectedIndividualPrize: number | null;
  /** Atingimento projetado pelo ritmo da competencia (100 = fecha a meta). */
  projectedAttainmentPct: number | null;
  bonusReached: number;
  // Atencao  -  um ponto por vendedora, na ordem de prioridade do mockup.
  attention: { kind: "pa" | "ritmo" | "preco"; text: string; detail: string } | null;
  noGoal: boolean;
}

export interface NetworkGlobalGoal {
  /** Nome da meta ou "Setembro 2026". */
  competenceText: string;
  /** Faturamento na competencia (loja ou rede)  -  total da loja, igual a Visao Geral. */
  achieved: number;
  /** Parte do realizado fora da equipe (venda sem vendedora, gerencia); 0 = tudo na equipe. */
  outsideTeam?: number;
  /** Meta da loja ou soma das metas da rede. */
  total: number;
  /** realizado / total x 100. */
  pct: number;
  /** Projecao pelo indice de desempenho acumulado (AD-021). */
  projectedPct: number;
  /** Dias abertos da competencia a partir de hoje (incluindo hoje). */
  daysRemaining: number;
  /** Inicio da competencia (ISO). */
  start: string;
  /** Fim da competencia (ISO). */
  end: string;
}

/** Card de uma meta ativa (Ao vivo / Equipe)  -  progresso + badges + escada. */
export interface GoalCardView {
  id: string;
  name: string;
  kind: GoalType;
  storeNameValue: string;
  brands: GoalBrand[];
  qtyGroups: number;
  qtySellers: number;
  qtyLevels: number;
  tiers: Tier[];
  band: NetworkGlobalGoal;
  sellers: SellerRow[];
}

export type SalesBrand = "WEPINK" | "WPINK" | "ALL";

/** Daily bucket  -  matches sales_day_agg natural key. */
export type SalesDayAgg = {
  tenantId: string;
  storeId: string;
  /** Local calendar day YYYY-MM-DD in store timezone. */
  day: string;
  brand: SalesBrand;
  revenueCents: number;
  /** Distinct COD_OPERACAO count. */
  salesCount: number;
  itemCount: number;
  /**
   * CMV em centavos (RELATORIOMARGEM  CUSTO_TOTAL). brand=ALL na v1.
   * TODO(Configuracoes>Custos): x (1 + imposto_sobre_custo_pct).
   */
  cmvCents?: number;
};

/** Daily revenue by seller (VENDEDOR_MILLENNIUM)  -  sales_seller_day_agg. */
export type SalesSellerDayAgg = {
  tenantId: string;
  storeId: string;
  day: string;
  /** Nome normalizado (chave estavel sem acento). */
  sellerKey: string;
  /** Rotulo de UI (title-case). */
  sellerName: string;
  /** Codigo da funcionaria no Millennium (FUNCIONARIO)  -  resolvido pelo nome na gravacao; null = so nome. */
  sellerEmployeeId?: number | null;
  /** Gerador da vendedora no Millennium (relatorio de cupom); null = so pelo nome. */
  sellerGeneratorId?: number | null;
  brand: SalesBrand;
  revenueCents: number;
  /** Distinct COD_OPERACAO count. */
  salesCount: number;
  /**  QUANTIDADE (itens). 0 em linhas gravadas antes de 2026-09-26. */
  itemCount?: number;
};
