/** Metas mensais por filial, com degraus configuraveis. Sempre em reais. */

import type { GoalBrand, GoalType, Tier } from "./engine/goalTypes";

export type { GoalBrand, GoalType, Tier } from "./engine/goalTypes";

export interface Goal {
  id: string;
  filialId: string;
  /** "AAAA-MM" */
  competencia: string;
  nome: string;
  valorLoja: number;
  degraus: Tier[];
  /** Individual = meta por vendedora; grupo = meta compartilhada do time. */
  tipo: GoalType;
  /**
   * Marcas cobertas pela meta.
   * Ambas (WEPINK+WPINK) = meta de loja/mix completo; uma so = meta de marca.
   */
  marcas: GoalBrand[];
}

/**
 * Escada padrao (demo / default de fabrica).
 * Tipicamente: Meta 50%  ->  Super 75%  ->  Hiper 100% (= meta da loja)  ->  Desafio 110%.
 * Nao e regra fixa  -  a loja configura os % na tela de Metas.
 */
export const BONUS_PER_LEVEL = 50;

export const defaultTiers: Tier[] = [
  { nome: "Meta", atingimentoMinPct: 50, comissaoPct: 1.5, bonus: BONUS_PER_LEVEL * 1 },
  { nome: "Super Meta", atingimentoMinPct: 75, comissaoPct: 2.0, bonus: BONUS_PER_LEVEL * 2 },
  { nome: "Hiper Meta", atingimentoMinPct: 100, comissaoPct: 2.5, bonus: BONUS_PER_LEVEL * 3 },
  { nome: "Meta Desafio", atingimentoMinPct: 110, comissaoPct: 3.0, bonus: BONUS_PER_LEVEL * 4 },
];

const AMBAS: GoalBrand[] = ["WEPINK", "WPINK"];

export const goals: Goal[] = [
  // f1 (Shopping Campo Grande) = loja ancora, meta acima de f2.
  // Valores calibrados ao gerador de vendas (MTD ~ metade do mes  50% da meta).
  { id: "m-f1-2026-07", filialId: "f1", competencia: "2026-07", nome: "Julho 2026", valorLoja: 158000, degraus: defaultTiers, tipo: "grupo", marcas: AMBAS },
  { id: "m-f1-2026-08", filialId: "f1", competencia: "2026-08", nome: "Agosto 2026", valorLoja: 162000, degraus: defaultTiers, tipo: "grupo", marcas: AMBAS },
  { id: "m-f1-2026-09", filialId: "f1", competencia: "2026-09", nome: "Setembro 2026", valorLoja: 170000, degraus: defaultTiers, tipo: "grupo", marcas: AMBAS },
  // Meta de marca paralela (demo de N cards no Ao vivo).
  { id: "m-f1-2026-09-wpink", filialId: "f1", competencia: "2026-09", nome: "Meta WPINK", valorLoja: 32000, degraus: defaultTiers.slice(0, 3), tipo: "individual", marcas: ["WPINK"] },
  { id: "m-f2-2026-07", filialId: "f2", competencia: "2026-07", nome: "Julho 2026", valorLoja: 88000, degraus: defaultTiers, tipo: "grupo", marcas: AMBAS },
  { id: "m-f2-2026-08", filialId: "f2", competencia: "2026-08", nome: "Agosto 2026", valorLoja: 92000, degraus: defaultTiers, tipo: "grupo", marcas: AMBAS },
  { id: "m-f2-2026-09", filialId: "f2", competencia: "2026-09", nome: "Setembro 2026", valorLoja: 98000, degraus: defaultTiers, tipo: "grupo", marcas: AMBAS },
];

/** Todas as metas da loja na competencia (pode haver mais de uma  -  ex.: loja + marca). */
export function goalsOfStore(filialId: string, competencia: string): Goal[] {
  return goals.filter((m) => m.filialId === filialId && m.competencia === competencia);
}

/**
 * Meta "principal" da loja (grupo / mix completo).
 * Usada por KPIs, dashboard e escada  -  nao mistura com metas de marca.
 */
export function goalOfStore(filialId: string, competencia: string): Goal | undefined {
  const list = goalsOfStore(filialId, competencia);
  return (
    list.find((m) => m.tipo === "grupo" && m.marcas.length !== 1) ??
    list.find((m) => m.tipo === "grupo") ??
    list[0]
  );
}
