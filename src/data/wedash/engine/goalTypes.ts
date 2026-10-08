/** Tipos da conta da meta (sem dependencias fora do motor). Money nos agregados = centavos inteiros. */

export interface Tier {
  nome: string;
  atingimentoMinPct: number;
  /** % da premiacao sobre o faturamento realizado neste degrau. */
  comissaoPct: number;
  /**
   * Bonus acumulado ao atingir este degrau.
   * Regra de produto: R$ 50 por nivel (1 -> 50, 2 -> 100, 3 -> 150, 4 -> 200).
   */
  bonus: number;
  /** Premiacao da gerencia (% sobre o faturamento total da loja) ao a loja chegar neste nivel; ausente = sem premiacao da gerencia. */
  gerenciaPct?: number;
  /** Bonus da gerencia (R$) ao a loja chegar neste nivel; soma com os niveis anteriores. */
  gerenciaBonus?: number;
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
  geradorId?: number | null;
  name: string;
  /** Nomes normalizados ja vistos (liga venda gravada so pelo nome). */
  nameKeys: string[];
  /** Ativo com cargo VENDEDOR = na equipe de vendas agora. */
  salesPerson: boolean;
  /** Grupo da pessoa (Gestao > Vendedores). */
  shiftId: string | null;
  shiftName: string | null;
}

export interface SellerRow {
  colaboradorId: string;
  nome: string;
  /** Filial da vendedora  -  necessaria na visao rede (coluna Shopping). */
  filialId: string;
  filialNome: string;
  /** Nome do grupo (Grupo 1/Grupo 2) ou "Sem grupo". */
  grupo: string;
  faturamentoValor: number;
  faturamento: string;
  atendimentos: number;
  ticketValor: number;
  ticket: string;
  paValor: number;
  pa: string;
  diasTrabalhados: number;
  tendencia: "subindo" | "estavel" | "caindo";
  // Meta individual (so com meta ativa; sem meta ficam zerados e semMeta=true)
  metaIndividualValor: number;
  metaProporcional: boolean;
  diasElegiveis: number;
  atingimentoPct: number;
  barraPct: number;
  /** Participacao no faturamento vs. meta da loja (valorLoja). */
  pctMetaGeral: number;
  /** Marcos da escada p/ barra segmentada: { nome, pct, bonus, pctPremiacao }. */
  marcosEscada: { nome: string; pct: number; pctPremiacao: number; bonus: number }[];
  degrauAtual: string | null;
  /** Indice 1-based do degrau atual (null = ainda sem nivel). */
  nivelAtual: number | null;
  proximoDegrau: { nome: string; faltaValor: number; pctPremiacao: number; bonus: number; atingMinPct: number } | null;
  /** Premiacao acumulada da escada de metas (realizado x pct do degrau). */
  premiacaoAcumulada: number;
  /** % de premiacao do degrau atual (0 se ainda nao entrou na escada). */
  comissaoPct: number;
  /** Premiacao projetada pelo ritmo: realizado escalado x pct do degrau projetado. */
  premiacaoProjetadaIndividual: number | null;
  /** Atingimento projetado pelo ritmo da competencia (100 = fecha a meta). */
  atingimentoProjetadoPct: number | null;
  bonusAlcancado: number;
  // Atencao  -  um ponto por vendedora, na ordem de prioridade do mockup.
  atencao: { tipo: "pa" | "ritmo" | "preco"; texto: string; detalhe: string } | null;
  semMeta: boolean;
}

export interface NetworkGlobalGoal {
  /** Nome da meta ou "Setembro 2026". */
  competTexto: string;
  /** Faturamento na competencia (loja ou rede)  -  total da loja, igual a Visao Geral. */
  realizado: number;
  /** Parte do realizado fora da equipe (venda sem vendedora, gerencia); 0 = tudo na equipe. */
  foraDaEquipe?: number;
  /** Meta da loja ou soma das metas da rede. */
  total: number;
  /** realizado / total x 100. */
  pct: number;
  /** Projecao pelo indice de desempenho acumulado (AD-021). */
  projetadoPct: number;
  /** Dias abertos da competencia a partir de hoje (incluindo hoje). */
  diasRestantes: number;
  /** Inicio da competencia (ISO). */
  inicio: string;
  /** Fim da competencia (ISO). */
  fim: string;
}

/** Card de uma meta ativa (Ao vivo / Equipe)  -  progresso + badges + escada. */
export interface GoalCardView {
  id: string;
  nome: string;
  tipo: GoalType;
  lojaNome: string;
  marcas: GoalBrand[];
  qtdGrupos: number;
  qtdVendedoras: number;
  qtdNiveis: number;
  degraus: Tier[];
  faixa: NetworkGlobalGoal;
  vendedoras: SellerRow[];
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
  sellerGeradorId?: number | null;
  brand: SalesBrand;
  revenueCents: number;
  /** Distinct COD_OPERACAO count. */
  salesCount: number;
  /**  QUANTIDADE (itens). 0 em linhas gravadas antes de 2026-09-26. */
  itemCount?: number;
};
