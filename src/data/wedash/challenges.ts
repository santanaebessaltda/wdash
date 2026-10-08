/**
 * Desafios da competencia (mock deterministico).
 *
 * Cada desafio pertence a uma loja (`filialId`) ou a rede (`null`).
 * Na visao "Todas as lojas" o card mostra de qual loja e.
 *
 * Tipos: quantidade | produto | faturamento | pa | ticket.
 * Progresso individual e fixture explicita (regua vermelho/amarelo/verde).
 */
import { collaborators, eligibleSeller } from "./team";
import { TODAY_ISO } from "./clock";

export type ChallengeType = "produto" | "quantidade" | "faturamento" | "pa" | "ticket";
export type ChallengeUnit = "un" | "x" | "R$";

export interface Challenge {
  id: string;
  nome: string;
  /** Frase curta do objetivo (o que precisa fazer). */
  objetivo: string;
  tipo: ChallengeType;
  /** Loja dona do desafio. `null` = desafio de rede (todas as lojas). */
  filialId: string | null;
  /** Alvo / piso por participante (un, indice ou R$). */
  alvoIndividual: number;
  /**
   * Minimo para valer o desafio. null = sem piso separado (usa o alvo).
   * Em "vender mais", e o piso para concorrer; o ranking ordena pelo realizado.
   */
  minimo: number | null;
  unidade: ChallengeUnit;
  /** R$ por participante (vendedora) que fechar o desafio. */
  premio: number;
  /**
   * R$ do gerente se a regra de loja fechar
   * (min. N vendedoras atingindo o alvo individual).
   */
  premioGerente: number;
  /**
   * Quantas vendedoras precisam bater o alvo individual
   * para o gerente fechar. Meta gerente = este x piso/alvo (tipos un/R$ soma).
   */
  minimoVendedorasAtingindo: number;
  /** "AAAA-MM" */
  competencia: string;
  /** Inicio da janela do desafio (ISO). */
  inicio: string;
  /** Fim da janela do desafio (ISO), inclusive. */
  fim: string;
  /** Produto/categoria alvo (tipo produto/quantidade), quando aplicavel. */
  produtoId: number | null;
  participantes: string[];
}

function ativasDaFilial(filialId: string): string[] {
  return collaborators
    .filter(
      (c) =>
        c.filialId === filialId &&
        eligibleSeller(c) &&
        c.dataAdmissao <= "2026-09-01" &&
        (!c.dataInatividade || c.dataInatividade > "2026-09-15"),
    )
    .map((c) => c.id);
}

const ATIVAS_F1 = ativasDaFilial("f1");
const ATIVAS_F2 = ativasDaFilial("f2");

/**
 * Desafios de setembro/2026  -  2 por loja (HOJE = 2026-09-15).
 * Equipe/Ao vivo listam so Ativo; encerrado e "a comecar" ficam no fixture
 * para premiacao/KPI e para testes de status temporal.
 * - Campo Grande: Perfumaria (encerrado) + P.A. (ativo, verde)
 * - Tres Lagoas: Body Cream (ativo, amarelo) + Ticket (a comecar)
 * Cores na lista vigente: amarelo (body) + verde (pa). Vermelho some ao filtrar.
 */
export const challenges: Challenge[] = [
  {
    id: "d-perfumaria",
    nome: "Perfumaria — 3 acima de R$ 150",
    objetivo: "Vender 3 perfumes acima de R$ 150 e ganhar R$ 50,00.",
    tipo: "quantidade",
    filialId: "f1",
    alvoIndividual: 3,
    minimo: 3,
    unidade: "un",
    premio: 50,
    premioGerente: 50,
    minimoVendedorasAtingindo: 3,
    competencia: "2026-09",
    inicio: "2026-09-01",
    fim: "2026-09-10",
    produtoId: 1,
    participantes: ["c01", "c02", "c03", "c04", "c05", "c07"],
  },
  {
    id: "d-bodycream",
    nome: "Body Cream — quem vender mais",
    objetivo: "Quem vender mais Body Cream (mínimo 15 un) ganha R$ 50,00.",
    tipo: "produto",
    filialId: "f2",
    alvoIndividual: 15,
    minimo: 15,
    unidade: "un",
    premio: 50,
    premioGerente: 50,
    minimoVendedorasAtingindo: 4,
    competencia: "2026-09",
    inicio: "2026-09-01",
    fim: "2026-09-30",
    produtoId: 3,
    participantes: ["c11", "c12", "c13", "c14", "c15", "c17"],
  },
  {
    id: "d-pa",
    nome: "P.A. acima de 1,90",
    objetivo: "Manter P.A. acima de 1,90 no mês e ganhar R$ 50,00.",
    tipo: "pa",
    filialId: "f1",
    alvoIndividual: 1.9,
    minimo: 1.9,
    unidade: "x",
    premio: 50,
    premioGerente: 50,
    minimoVendedorasAtingindo: 5,
    competencia: "2026-09",
    inicio: "2026-09-01",
    fim: "2026-09-30",
    produtoId: null,
    participantes: ATIVAS_F1,
  },
  {
    id: "d-ticket",
    nome: "Ticket médio acima de R$ 185",
    objetivo: "Manter ticket médio acima de R$ 185 e ganhar R$ 50,00.",
    tipo: "ticket",
    filialId: "f2",
    alvoIndividual: 185,
    minimo: 185,
    unidade: "R$",
    premio: 50,
    premioGerente: 50,
    minimoVendedorasAtingindo: 5,
    competencia: "2026-09",
    inicio: "2026-09-20",
    fim: "2026-09-30",
    produtoId: null,
    participantes: ATIVAS_F2,
  },
];

/**
 * Progresso fixo por participante  -  valores na unidade do desafio.
 * Cobrem <50% (vermelho), 50 - 79% (amarelo) e 80% (verde) nas barras.
 */
const PROGRESSO_FIXO: Record<string, Record<string, number>> = {
  // Campo Grande  |  encerrado  ->  agregado vermelho (~44%).
  "d-perfumaria": {
    c01: 2,
    c02: 1,
    c03: 1,
    c04: 0,
    c05: 0,
    c07: 0,
  },
  // Tres Lagoas  |  ativo  ->  agregado amarelo (~63%).
  "d-bodycream": {
    c11: 9,
    c12: 8,
    c13: 7,
    c14: 6,
    c15: 5,
    c17: 3,
  },
  // Campo Grande  |  ativo  ->  media ~1,90 (verde).
  "d-pa": {
    c01: 2.05,
    c02: 1.98,
    c03: 1.92,
    c04: 1.88,
    c05: 1.85,
    c07: 1.82,
    c08: 1.78,
  },
  // Tres Lagoas  |  a comecar.
  "d-ticket": {},
};

/** Desafios da competencia. Sem desafios: lista vazia (a tela segue). */
export function activeChallenges(competencia: string): Challenge[] {
  return challenges.filter((d) => d.competencia === competencia);
}

/** Desafios da competencia visiveis no escopo de lojas (loja propria + rede). */
export function challengesInScope(competencia: string, filiaisIds: string[]): Challenge[] {
  return activeChallenges(competencia).filter((d) => d.filialId == null || filiaisIds.includes(d.filialId));
}

/** Piso efetivo: minimo configurado ou o proprio alvo. */
export function challengeFloor(d: Challenge): number {
  return d.minimo ?? d.alvoIndividual;
}

/** P.A. e ticket sao indices  -  agregacao por media, nao por soma. */
export function challengeIsIndex(d: Pick<Challenge, "tipo">): boolean {
  return d.tipo === "pa" || d.tipo === "ticket";
}

/**
 * Meta do gerente (tipos un / R$ soma): piso x N vendedoras que precisam atingir.
 * No escopo filtrado, N nunca passa do n de participantes visiveis.
 * Para indices (pa/ticket), a UI usa o proprio piso como alvo da media.
 */
export function challengeManagerTarget(d: Challenge, participantesNoEscopo: number): number {
  if (challengeIsIndex(d)) return challengeFloor(d);
  const n = Math.min(d.minimoVendedorasAtingindo, Math.max(0, participantesNoEscopo));
  return challengeFloor(d) * n;
}

/**
 * Progresso rumo a meta do gerente (regra A, tipos un/R$): cada vendedora
 * contribui no maximo ate o piso individual  -  uma nao "carrega" as outras.
 */
export function cappedManagerProgress(progressos: number[], piso: number): number {
  return progressos.reduce((s, p) => s + Math.min(Math.max(0, p), piso), 0);
}

/** Media aritmetica (indices pa/ticket). */
export function averageProgress(progressos: number[]): number {
  if (progressos.length === 0) return 0;
  return progressos.reduce((s, p) => s + Math.max(0, p), 0) / progressos.length;
}

/**
 * Progresso individual do participante no desafio.
 * Antes do inicio da janela  ->  0. Deterministico via fixture.
 */
export function individualProgress(d: Challenge, colaboradorId: string): number {
  if (!d.participantes.includes(colaboradorId)) return 0;
  if (TODAY_ISO < d.inicio) return 0;
  const fixo = PROGRESSO_FIXO[d.id]?.[colaboradorId];
  if (fixo != null) return fixo;
  return 0;
}
