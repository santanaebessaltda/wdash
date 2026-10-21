import type { ChallengeMetric, ChallengeRecord } from "@/data/wedash/challengesRepo";
import { paths } from "@/router/paths";
import {
  challengeCardSummary,
  metricValueLabel,
  prizeLabel,
  type ChallengeStatus,
  type ChallengeView,
} from "@/data/wedash/challengeView";

export const CHALLENGE_STATUS_ORDER: Record<ChallengeStatus, number> = { active: 0, upcoming: 1, ended: 2 };

export const CHALLENGE_MODE_HELP: Record<ChallengeRecord["mode"], string> = {
  CONTEST:
    "Ganha quem tiver o melhor resultado. Em caso de empate, as pessoas empatadas recebem o prêmio da posição e a posição seguinte é pulada.",
  MINIMUM: "Todas as pessoas que atingirem o mínimo ganham o prêmio.",
};

const HIGHER: Record<ChallengeMetric, string> = {
  QUANTITY: "Mais itens vendidos",
  VALUE: "Maior faturamento",
  PA: "Maior P.A.",
  TICKET: "Maior ticket médio",
  INDEX: "Maior índice de desempenho",
};

/** "Maior faturamento" / "Minimo de 15 itens"  -  o criterio do desafio em uma linha. */
export function challengeCriterion(c: ChallengeRecord): string {
  if (c.mode === "MINIMUM") return c.target != null ? `Mínimo de ${metricValueLabel(c.metric, c.target)}` : "Mínimo não definido";
  const quem = HIGHER[c.metric];
  return c.target != null ? `${quem} · mínimo de ${metricValueLabel(c.metric, c.target)}` : quem;
}

/** Piso do desafio, para o badge ao lado do período e do prêmio. */
export function challengeMinimumLabel(c: ChallengeRecord): string | null {
  if (c.target == null) return null;
  return `Mínimo de ${metricValueLabel(c.metric, c.target)}`;
}

/** Destaque do card: `label` null = a frase ja e completa ("Ainda nao ha lider"). */
export interface ChallengeHeadline {
  label: string | null;
  value: string;
}

/** Linha de destaque do card: lider(es) / vencedor(es) na Disputa, quantas atingiram no Minimo. */
export function challengeHeadline(c: ChallengeRecord, view: ChallengeView): ChallengeHeadline {
  if (view.status === "upcoming") return { label: "Critério", value: challengeCriterion(c) };
  const ended = view.status === "ended";
  if (c.mode === "MINIMUM") {
    const n = view.reachedCount;
    if (n === 0) return { label: null, value: ended ? "Ninguém atingiu" : "Ninguém atingiu ainda" };
    if (n === 1) return { label: null, value: "1 pessoa atingiu" };
    return { label: null, value: `${n} pessoas atingiram` };
  }
  const { leader } = challengeCardSummary(view);
  const primeiros = view.participants.filter((p) => p.position === 1);
  if (!leader || primeiros.length === 0 || (ended && !primeiros[0].winner)) {
    return { label: null, value: ended ? "Nenhum vencedor" : "Ainda não há líder" };
  }
  const amount = primeiros[0].result != null ? ` · ${metricValueLabel(c.metric, primeiros[0].result)}` : "";
  const varios = primeiros.length > 1;
  const label = ended ? (varios ? "Vencedores" : "Vencedor") : varios ? "Líderes" : "Líder";
  return { label, value: `${leader}${amount}` };
}

/** Frase do placar, para ler de longe. A Gestão continua com o rótulo "Líder:". */
export function floorChallengeHeadline(c: ChallengeRecord, view: ChallengeView): ChallengeHeadline {
  if (view.status === "upcoming") return challengeHeadline(c, view);
  const ended = view.status === "ended";
  if (c.mode === "MINIMUM") {
    const n = view.reachedCount;
    const target = c.target != null ? ` de ${metricValueLabel(c.metric, c.target)}` : "";
    if (n === 0) return { label: null, value: ended ? "Ninguém atingiu o mínimo" : "Ninguém atingiu o mínimo ainda" };
    if (n === 1) return { label: null, value: `1 pessoa já atingiu o mínimo${target}` };
    return { label: null, value: `${n} pessoas já atingiram o mínimo${target}` };
  }
  const { leader } = challengeCardSummary(view);
  const primeiros = view.participants.filter((person) => person.position === 1);
  if (!leader || primeiros.length === 0 || (ended && !primeiros[0].winner)) {
    return { label: null, value: ended ? "Nenhum vencedor" : "Ainda não há líder" };
  }
  const amount = primeiros[0].result != null ? metricValueLabel(c.metric, primeiros[0].result) : null;
  const verb = primeiros.length > 1 ? "lideram" : "lidera";
  return { label: null, value: amount ? `${leader} ${verb} com ${amount}` : `${leader} ${verb}` };
}

/** "Lider: ANA  |  12 itens" ou a frase inteira quando nao ha rotulo. */
export function HeadlineText({ headline, valueClass = "text-t0" }: { headline: ChallengeHeadline; valueClass?: string }) {
  return headline.label ? (
    <>
      <span className="text-t2">{headline.label}: </span>
      <span className={`font-bold ${valueClass}`}>{headline.value}</span>
    </>
  ) : (
    <span className={`font-bold ${valueClass}`}>{headline.value}</span>
  );
}

/** Detalhe aberto pela Equipe volta para a aba Desafios. Sem origem, volta para a lista. */
export function challengeBackPath(state: unknown): string {
  const from = (state as { from?: string } | null)?.from;
  if (typeof from === "string" && from.startsWith("/") && !from.startsWith("//")) return from;
  if (from === "team") return `${paths.team}?tab=challenges`;
  return paths.management.challenges;
}

/** Premio principal: 1 lugar (Disputa) ou o premio por pessoa (Minimo). */
export function mainPrizeLabel(c: ChallengeRecord): string | null {
  const p = c.prizes[0];
  if (!p) return null;
  return c.mode === "MINIMUM" ? `${prizeLabel(p)} por pessoa` : `1º lugar: ${prizeLabel(p)}`;
}
