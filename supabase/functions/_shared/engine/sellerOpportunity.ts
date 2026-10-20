/**
 * Oportunidades da carteira da vendedora: o que já está garantido, o que ainda está em disputa
 * e o que encerrou sem premiação. O valor que ela não ganhou fica só aqui.
 */
import { brlCent } from "./format.ts";
import type { SellerChallengeMetric } from "./sellerChallenge.ts";
import { goalCeiling, type GoalCeilingTier } from "./sellerPrize.ts";

export type WalletOpportunityState = "guaranteed" | "open" | "missed";

export interface WalletGoalOpportunity {
  kind: "goal";
  name: string;
  endsOn: string;
  state: WalletOpportunityState;
  levelLabel: string | null;
  prizeCents: number;
  bonusCents: number;
  next: { label: string; gapCents: number; prizeGainCents: number; bonusGainCents: number } | null;
  missedLevelLabel: string | null;
  missedPrizeCents: number;
  missedBonusCents: number;
  /** Meta aberta: o percentual do último nível continua sobre o que ela vender. */
  floor: boolean;
  /** Já está no último nível. O upside fica zerado porque não há outro degrau; vender mais ainda aumenta a premiação. */
  atLast: boolean;
  upsideCents: number;
}

export interface WalletChallengeOpportunity {
  kind: "challenge";
  name: string;
  endsOn: string;
  state: WalletOpportunityState;
  resultCaption: string;
  resultLabel: string | null;
  metricLabel: string;
  targetLabel: string | null;
  gapLabel: string | null;
  placeLabel: string | null;
  prizeLabel: string;
  upsideCents: number;
}

export type WalletOpportunity = WalletGoalOpportunity | WalletChallengeOpportunity;

export interface OpportunityPrize {
  kind: string;
  amount?: number;
  label?: string;
}

function cents(reais: number): number {
  if (!Number.isFinite(reais) || reais <= 0) return 0;
  return Math.round(reais * 100);
}

function resultCaption(metric: SellerChallengeMetric): string {
  if (metric === "PA") return "Seu P.A.";
  if (metric === "TICKET") return "Seu ticket";
  if (metric === "INDEX") return "Seu índice";
  return "Você vendeu";
}

/** Card da meta. O valor é o mínimo ao chegar no último nível; o bloco seguinte é o ganho ao fechar a folga. */
export function goalWalletOpportunity(input: {
  name: string;
  endsOn: string;
  open: boolean;
  levelNumber: number | null;
  levelName: string | null;
  prizeReais: number;
  bonusReais: number;
  achieved: number;
  goalAmount: number;
  currentPct: number;
  groupSize: number;
  tiers: GoalCeilingTier[];
}): WalletGoalOpportunity {
  const prizeCents = cents(input.prizeReais);
  const bonusCents = cents(input.bonusReais);
  const ceiling = goalCeiling({
    open: input.open,
    achieved: input.achieved,
    goalAmount: input.goalAmount,
    prizeNow: input.prizeReais,
    bonusNow: input.bonusReais,
    currentPct: input.currentPct,
    groupSize: input.groupSize,
    tiers: input.tiers,
  });
  const state: WalletOpportunityState = !input.open && prizeCents === 0 && bonusCents === 0 ? "missed" : prizeCents > 0 || bonusCents > 0 ? "guaranteed" : "open";
  const step = ceiling.next;
  const next = step
    ? {
        label: `N${step.number} · ${step.name}`,
        gapCents: cents(step.gap),
        prizeGainCents: cents(step.prizeGain),
        bonusGainCents: cents(step.bonusGain),
      }
    : null;
  const first = input.tiers[0];
  let missedLevelLabel: string | null = null;
  let missedPrizeCents = 0;
  let missedBonusCents = 0;
  if (state === "missed" && first && input.goalAmount > 0) {
    const share = 1 / Math.max(1, input.groupSize);
    const threshold = (input.goalAmount * first.minAttainmentPct) / 100;
    missedLevelLabel = `N1 · ${first.name}`;
    missedPrizeCents = cents(((threshold * first.commissionPct) / 100) * share);
    missedBonusCents = cents(first.bonus);
  }
  return {
    kind: "goal",
    name: input.name,
    endsOn: input.endsOn,
    state,
    levelLabel: input.levelNumber != null && input.levelName ? `N${input.levelNumber} · ${input.levelName}` : null,
    prizeCents,
    bonusCents,
    next: next && (next.gapCents > 0 || next.prizeGainCents > 0 || next.bonusGainCents > 0) ? next : null,
    missedLevelLabel,
    missedPrizeCents,
    missedBonusCents,
    floor: input.open,
    atLast: input.open && ceiling.next == null,
    upsideCents: cents(ceiling.upside),
  };
}

/** Rótulo do prêmio. Vazio quando não há o que mostrar. */
export function challengePrizeLabel(prize: OpportunityPrize | null | undefined): string {
  if (!prize) return "";
  if (prize.kind === "ITEM") return (prize.label ?? "").trim();
  if (prize.kind === "MONEY" && typeof prize.amount === "number" && prize.amount > 0) return brlCent(prize.amount);
  return "";
}

/** Teto de um desafio aberto: o prêmio que uma pessoa pode levar. Na disputa, só o 1º lugar. */
export function challengeUpsideReais(open: boolean, prizes: OpportunityPrize[]): number {
  if (!open) return 0;
  const top = prizes[0];
  if (top?.kind !== "MONEY" || typeof top.amount !== "number" || top.amount <= 0) return 0;
  return top.amount;
}

export function challengeWalletOpportunity(input: {
  name: string;
  endsOn: string;
  open: boolean;
  won: boolean;
  metric: SellerChallengeMetric;
  resultLabel: string | null;
  metricLabel: string;
  targetLabel: string | null;
  gapLabel: string | null;
  position: number | null;
  prizeLabel: string;
  upsideReais: number;
}): WalletChallengeOpportunity {
  const state: WalletOpportunityState = input.won ? "guaranteed" : input.open ? "open" : "missed";
  return {
    kind: "challenge",
    name: input.name,
    endsOn: input.endsOn,
    state,
    resultCaption: resultCaption(input.metric),
    resultLabel: input.resultLabel,
    metricLabel: input.metricLabel,
    targetLabel: input.targetLabel,
    gapLabel: input.open ? input.gapLabel : null,
    placeLabel: input.position != null && input.position > 0 ? `${input.position}º lugar` : null,
    prizeLabel: input.prizeLabel,
    upsideCents: input.open ? cents(input.upsideReais) : 0,
  };
}

export function isWalletOpportunity(value: unknown): value is WalletOpportunity {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<WalletOpportunity>;
  if (row.kind !== "goal" && row.kind !== "challenge") return false;
  if (typeof row.name !== "string" || typeof row.endsOn !== "string") return false;
  if (row.state !== "guaranteed" && row.state !== "open" && row.state !== "missed") return false;
  return typeof row.upsideCents === "number";
}

/** Junta os meses e fica só com o que termina dentro do intervalo. */
export function opportunitiesInRange(parts: WalletOpportunity[][], from: string, to: string): WalletOpportunity[] {
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const seen = new Set<string>();
  const out: WalletOpportunity[] = [];
  for (const list of parts) {
    for (const item of list) {
      if (item.endsOn < start || item.endsOn > end) continue;
      const key = `${item.kind}|${item.name}|${item.endsOn}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  const order = (kind: WalletOpportunity["kind"]) => (kind === "goal" ? 0 : 1);
  out.sort((a, b) => order(a.kind) - order(b.kind) || a.endsOn.localeCompare(b.endsOn) || a.name.localeCompare(b.name, "pt-BR"));
  return out;
}
