import { describe, expect, it } from "vitest";
import { brlCent } from "./format.ts";
import {
  challengePrizeLabel,
  challengeUpsideReais,
  challengeWalletOpportunity,
  goalWalletOpportunity,
  opportunitiesInRange,
  type WalletOpportunity,
} from "./sellerOpportunity.ts";

const tiers = [
  { name: "Meta", minAttainmentPct: 100, commissionPct: 1, bonus: 50 },
  { name: "Super", minAttainmentPct: 120, commissionPct: 2, bonus: 100 },
  { name: "Hiper", minAttainmentPct: 150, commissionPct: 3, bonus: 150 },
];

describe("goalWalletOpportunity", () => {
  const base = {
    name: "Meta outubro",
    endsOn: "2026-10-31",
    open: true,
    levelNumber: 1,
    levelName: "Meta",
    prizeReais: 105,
    bonusReais: 50,
    achieved: 10_500,
    goalAmount: 10_000,
    currentPct: 1,
    groupSize: 1,
    tiers,
  };

  it("guarda o mínimo do último nível e o próximo nível ao fechar a folga", () => {
    const card = goalWalletOpportunity(base);
    expect(card.state).toBe("guaranteed");
    expect(card.levelLabel).toBe("N1 · Meta");
    expect(card.prizeCents).toBe(10_500);
    expect(card.bonusCents).toBe(5_000);
    expect(card.upsideCents).toBe(59_500);
    expect(card.floor).toBe(true);
    expect(card.atLast).toBe(false);
    expect(card.next).toEqual({ label: "N2 · Super", gapCents: 150_000, prizeGainCents: 13_500, bonusGainCents: 10_000 });
    expect(card.missedPrizeCents).toBe(0);
  });

  it("meta encerrada sem premiação mostra o 1º nível e não soma no potencial", () => {
    const card = goalWalletOpportunity({ ...base, open: false, levelNumber: null, levelName: null, prizeReais: 0, bonusReais: 0, achieved: 4_000, currentPct: 0 });
    expect(card.state).toBe("missed");
    expect(card.floor).toBe(false);
    expect(card.atLast).toBe(false);
    expect(card.upsideCents).toBe(0);
    expect(card.next).toBeNull();
    expect(card.missedLevelLabel).toBe("N1 · Meta");
    expect(card.missedPrizeCents).toBe(10_000);
    expect(card.missedBonusCents).toBe(5_000);
  });

  it("no último nível o mínimo já está na premiação e vender mais continua aumentando", () => {
    const card = goalWalletOpportunity({ ...base, levelNumber: 3, levelName: "Hiper", prizeReais: 480, bonusReais: 300, achieved: 16_000, currentPct: 3 });
    expect(card.atLast).toBe(true);
    expect(card.floor).toBe(true);
    expect(card.upsideCents).toBe(0);
    expect(card.next).toBeNull();
  });
});

describe("challenge upside", () => {
  const prizes = [
    { kind: "MONEY", amount: 200 },
    { kind: "MONEY", amount: 100 },
  ];

  it("disputa aberta conta só o prêmio do 1º lugar", () => {
    expect(challengeUpsideReais(true, prizes)).toBe(200);
    expect(challengePrizeLabel(prizes[0])).toBe(brlCent(200));
  });

  it("encerrado não entra no potencial, ganho ou não", () => {
    expect(challengeUpsideReais(false, prizes)).toBe(0);
    const won = challengeWalletOpportunity({
      name: "Maior faturamento",
      endsOn: "2026-10-31",
      open: false,
      won: true,
      metric: "VALUE",
      resultLabel: "R$ 8.000,00",
      metricLabel: "Faturamento",
      targetLabel: null,
      gapLabel: null,
      position: 2,
      prizeLabel: "R$ 150,00",
      upsideReais: 200,
    });
    expect(won.state).toBe("guaranteed");
    expect(won.upsideCents).toBe(0);
    expect(won.placeLabel).toBe("2º lugar");
    const missed = challengeWalletOpportunity({ ...won, won: false, position: null, prizeLabel: "R$ 100,00" });
    expect(missed.state).toBe("missed");
    expect(missed.upsideCents).toBe(0);
  });

  it("aberto e já com prêmio fica alcançado, e o valor segue no potencial", () => {
    const card = challengeWalletOpportunity({
      name: "Boca de Milhões",
      endsOn: "2026-10-31",
      open: true,
      won: true,
      metric: "QUANTITY",
      resultLabel: "10 itens",
      metricLabel: "Itens vendidos",
      targetLabel: "10 itens",
      gapLabel: null,
      position: null,
      prizeLabel: "R$ 100,00",
      upsideReais: 100,
    });
    expect(card.state).toBe("guaranteed");
    expect(card.upsideCents).toBe(10_000);
    expect(card.resultCaption).toBe("Você vendeu");
  });

  it("aberto e ainda sem o prêmio fica em andamento", () => {
    const card = challengeWalletOpportunity({
      name: "Boca de Milhões",
      endsOn: "2026-10-31",
      open: true,
      won: false,
      metric: "QUANTITY",
      resultLabel: "8 itens",
      metricLabel: "Itens vendidos",
      targetLabel: "10 itens",
      gapLabel: "Faltam 2 itens",
      position: null,
      prizeLabel: "R$ 100,00",
      upsideReais: 100,
    });
    expect(card.state).toBe("open");
    expect(card.upsideCents).toBe(10_000);
    expect(card.gapLabel).toBe("Faltam 2 itens");
  });
});

describe("opportunitiesInRange", () => {
  const goal = (endsOn: string): WalletOpportunity =>
    goalWalletOpportunity({
      name: "Meta",
      endsOn,
      open: false,
      levelNumber: 1,
      levelName: "Meta",
      prizeReais: 10,
      bonusReais: 0,
      achieved: 1_000,
      goalAmount: 1_000,
      currentPct: 1,
      groupSize: 1,
      tiers,
    });

  it("descarta o que termina fora do intervalo e não repete a mesma oportunidade", () => {
    const late = goal("2026-10-31");
    const early = goal("2026-10-03");
    const kept = opportunitiesInRange([[late, early], [early]], "2026-10-01", "2026-10-15");
    expect(kept.map((item) => item.endsOn)).toEqual(["2026-10-03"]);
  });
});
