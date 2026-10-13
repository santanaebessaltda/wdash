/** Metas mensais por filial, com degraus configuraveis. Sempre em reais. */

import type { GoalBrand, GoalType, Tier } from "./engine/goalTypes";

export type { GoalBrand, GoalType, Tier } from "./engine/goalTypes";

export interface Goal {
  id: string;
  storeId: string;
  /** "AAAA-MM" */
  competence: string;
  name: string;
  storeAmount: number;
  tiers: Tier[];
  /** Individual = meta por vendedora; grupo = meta compartilhada do time. */
  kind: GoalType;
  /**
   * Marcas cobertas pela meta.
   * Ambas (WEPINK+WPINK) = meta de loja/mix completo; uma so = meta de marca.
   */
  brands: GoalBrand[];
}

/**
 * Escada padrao (demo / default de fabrica).
 * Tipicamente: Meta 50%  ->  Super 75%  ->  Hiper 100% (= meta da loja)  ->  Desafio 110%.
 * Nao e regra fixa  -  a loja configura os % na tela de Metas.
 */
export const BONUS_PER_LEVEL = 50;

export const defaultTiers: Tier[] = [
  { name: "Meta", minAttainmentPct: 50, commissionPct: 1.5, bonus: BONUS_PER_LEVEL * 1 },
  { name: "Super Meta", minAttainmentPct: 75, commissionPct: 2.0, bonus: BONUS_PER_LEVEL * 2 },
  { name: "Hiper Meta", minAttainmentPct: 100, commissionPct: 2.5, bonus: BONUS_PER_LEVEL * 3 },
  { name: "Meta Desafio", minAttainmentPct: 110, commissionPct: 3.0, bonus: BONUS_PER_LEVEL * 4 },
];

const AMBAS: GoalBrand[] = ["WEPINK", "WPINK"];

export const goals: Goal[] = [
  // f1 (Shopping Campo Grande) = loja ancora, meta acima de f2.
  // Valores calibrados ao gerador de vendas (MTD ~ metade do mes  50% da meta).
  { id: "m-f1-2026-07", storeId: "f1", competence: "2026-07", name: "Julho 2026", storeAmount: 158000, tiers: defaultTiers, kind: "grupo", brands: AMBAS },
  { id: "m-f1-2026-08", storeId: "f1", competence: "2026-08", name: "Agosto 2026", storeAmount: 162000, tiers: defaultTiers, kind: "grupo", brands: AMBAS },
  { id: "m-f1-2026-09", storeId: "f1", competence: "2026-09", name: "Setembro 2026", storeAmount: 170000, tiers: defaultTiers, kind: "grupo", brands: AMBAS },
  // Meta de marca paralela (demo de N cards no Ao vivo).
  { id: "m-f1-2026-09-wpink", storeId: "f1", competence: "2026-09", name: "Meta WPINK", storeAmount: 32000, tiers: defaultTiers.slice(0, 3), kind: "individual", brands: ["WPINK"] },
  { id: "m-f2-2026-07", storeId: "f2", competence: "2026-07", name: "Julho 2026", storeAmount: 88000, tiers: defaultTiers, kind: "grupo", brands: AMBAS },
  { id: "m-f2-2026-08", storeId: "f2", competence: "2026-08", name: "Agosto 2026", storeAmount: 92000, tiers: defaultTiers, kind: "grupo", brands: AMBAS },
  { id: "m-f2-2026-09", storeId: "f2", competence: "2026-09", name: "Setembro 2026", storeAmount: 98000, tiers: defaultTiers, kind: "grupo", brands: AMBAS },
];

/** Todas as metas da loja na competencia (pode haver mais de uma  -  ex.: loja + marca). */
export function goalsOfStore(storeId: string, competence: string): Goal[] {
  return goals.filter((m) => m.storeId === storeId && m.competence === competence);
}

/**
 * Meta "principal" da loja (grupo / mix completo).
 * Usada por KPIs, dashboard e escada  -  nao mistura com metas de marca.
 */
export function goalOfStore(storeId: string, competence: string): Goal | undefined {
  const list = goalsOfStore(storeId, competence);
  return (
    list.find((m) => m.kind === "grupo" && m.brands.length !== 1) ??
    list.find((m) => m.kind === "grupo") ??
    list[0]
  );
}
