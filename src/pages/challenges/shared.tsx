import type { ChallengeMetric, ChallengeRecord } from "@/data/wedash/challengesRepo";
import {
  challengeCardSummary,
  metricValueLabel,
  prizeLabel,
  type ChallengeStatus,
  type ChallengeView,
} from "@/data/wedash/challengeView";

export const CHALLENGE_STATUS_ORDER: Record<ChallengeStatus, number> = { active: 0, upcoming: 1, ended: 2 };
export const CHALLENGE_STATUS_VARIANT: Record<ChallengeStatus, "success" | "info" | "neutral"> = {
  active: "success",
  upcoming: "info",
  ended: "neutral",
};

export const CHALLENGE_MODE_HELP: Record<ChallengeRecord["mode"], string> = {
  CONTEST:
    "Ganha quem tiver o melhor resultado. Em caso de empate, as pessoas empatadas recebem o prêmio da posição e a posição seguinte é pulada.",
  MINIMUM: "Todas as pessoas que atingirem o mínimo ganham o prêmio.",
};

const MAIOR: Record<ChallengeMetric, string> = {
  QUANTITY: "Mais itens vendidos",
  VALUE: "Maior faturamento",
  PA: "Maior P.A.",
  TICKET: "Maior ticket médio",
  INDEX: "Maior índice de desempenho",
};

/** "Maior faturamento" / "Minimo de 15 itens"  -  o criterio do desafio em uma linha. */
export function challengeCriterion(c: ChallengeRecord): string {
  if (c.mode === "MINIMUM") return c.target != null ? `Mínimo de ${metricValueLabel(c.metric, c.target)}` : "Mínimo não definido";
  const quem = MAIOR[c.metric];
  return c.target != null ? `${quem} · mínimo de ${metricValueLabel(c.metric, c.target)}` : quem;
}

/** Destaque do card: `label` null = a frase ja e completa ("Ainda nao ha lider"). */
export interface ChallengeHeadline {
  label: string | null;
  value: string;
}

/** Linha de destaque do card: lider(es) / vencedor(es) na Disputa, quantas atingiram no Minimo. */
export function challengeHeadline(c: ChallengeRecord, view: ChallengeView): ChallengeHeadline {
  if (view.status === "upcoming") return { label: "Critério", value: challengeCriterion(c) };
  const encerrado = view.status === "ended";
  if (c.mode === "MINIMUM") {
    const n = view.atingiram;
    const alvo = c.target != null ? ` · mínimo de ${metricValueLabel(c.metric, c.target)}` : "";
    if (n === 0) return { label: null, value: encerrado ? "Ninguém atingiu" : "Ninguém atingiu ainda" };
    if (n === 1) return { label: null, value: `1 pessoa atingiu${alvo}` };
    return { label: "Atingiram", value: `${n} pessoas${alvo}` };
  }
  const { lider } = challengeCardSummary(view);
  const primeiros = view.participantes.filter((p) => p.posicao === 1);
  if (!lider || primeiros.length === 0 || (encerrado && !primeiros[0].vencedor)) {
    return { label: null, value: encerrado ? "Nenhum vencedor" : "Ainda não há líder" };
  }
  const valor = primeiros[0].resultado != null ? ` · ${metricValueLabel(c.metric, primeiros[0].resultado)}` : "";
  const varios = primeiros.length > 1;
  const label = encerrado ? (varios ? "Vencedores" : "Vencedor") : varios ? "Líderes" : "Líder";
  return { label, value: `${lider}${valor}` };
}

/** "Lider: ANA  |  12 itens" ou a frase inteira quando nao ha rotulo. */
export function HeadlineText({ headline }: { headline: ChallengeHeadline }) {
  return headline.label ? (
    <>
      <span className="text-t2">{headline.label}: </span>
      <span className="font-bold text-t0">{headline.value}</span>
    </>
  ) : (
    <span className="font-bold text-t0">{headline.value}</span>
  );
}

/** Premio principal: 1 lugar (Disputa) ou o premio por pessoa (Minimo). */
export function mainPrizeLabel(c: ChallengeRecord): string | null {
  const p = c.prizes[0];
  if (!p) return null;
  return c.mode === "MINIMUM" ? `${prizeLabel(p)} por pessoa` : `1º lugar: ${prizeLabel(p)}`;
}
