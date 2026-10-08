import { describe, expect, it } from "vitest";
import {
  applyCashReview,
  applyCloseReview,
  buildCashCloseView,
  cashCloseChips,
  chipsHaveGap,
  closeDayFace,
  closeDayTotals,
  dayAwaitingClose,
  monthCloseSummary,
  chipsAfterReview,
} from "./cashCloseView";

describe("buildCashCloseView", () => {
  it("soma TEF no cartão e deixa a Stone em branco enquanto o arquivo não chegou", () => {
    const view = buildCashCloseView({
      millennium: [
        { paymentMethod: "DINHEIRO", openingCents: 44775, sangriaCents: -485000, closingCents: -10275, typedCents: 25850 },
        { paymentMethod: "CARTÃO CRÉDITO", openingCents: 0, sangriaCents: null, closingCents: 2_068_060, typedCents: 2_145_930 },
        { paymentMethod: "TEF CARTÃO CRÉDITO", openingCents: 0, sangriaCents: null, closingCents: 44910, typedCents: 44910 },
        { paymentMethod: "CARTÃO DÉBITO", openingCents: 0, sangriaCents: null, closingCents: 1_740_940, typedCents: 1_778_890 },
        { paymentMethod: "TEF CARTÃO DÉBITO", openingCents: 0, sangriaCents: null, closingCents: 66100, typedCents: 66100 },
        { paymentMethod: "PIX", openingCents: 0, sangriaCents: null, closingCents: 1_431_330, typedCents: 1_433_930 },
      ],
      card: null,
      pixCents: null,
      pixRequested: true,
    });
    const credit = view.lines.find((l) => l.key === "credit");
    const debit = view.lines.find((l) => l.key === "debit");
    const pix = view.lines.find((l) => l.key === "pix");
    expect(credit).toMatchObject({ systemCents: 2_112_970, stoneCents: null });
    expect(debit).toMatchObject({ systemCents: 1_807_040, stoneCents: null });
    expect(pix?.stoneCents).toBeNull();
    expect(view.pixPending).toBe(true);
    expect(view.lines.find((l) => l.key === "cash")?.sangriaCents).toBe(-485000);
  });

  it("com os arquivos gravados, a Stone entra na conferência", () => {
    const view = buildCashCloseView({
      millennium: [
        { paymentMethod: "CARTÃO CRÉDITO", openingCents: 0, sangriaCents: null, closingCents: 1000, typedCents: 1000 },
        { paymentMethod: "PIX", openingCents: 0, sangriaCents: null, closingCents: 500, typedCents: 500 },
      ],
      card: { creditCents: 1000, debitCents: 0, otherCents: 0 },
      pixCents: 480,
      pixRequested: false,
    });
    expect(view.lines.find((l) => l.key === "credit")?.stoneCents).toBe(1000);
    expect(view.lines.find((l) => l.key === "pix")?.stoneCents).toBe(480);
  });

  it("marca falta no calendário e, sem diferença, o dia fechado", () => {
    const falta = cashCloseChips({
      millennium: [{ paymentMethod: "DINHEIRO", openingCents: 0, sangriaCents: null, closingCents: 10000, typedCents: 8000 }],
      card: null,
      pixCents: null,
      pixRequested: false,
    });
    expect(falta[0]).toMatchObject({ tone: "bad", label: expect.stringContaining("Dinheiro") });

    const ok = cashCloseChips({
      millennium: [{ paymentMethod: "DINHEIRO", openingCents: 0, sangriaCents: null, closingCents: 10000, typedCents: 10000 }],
      card: null,
      pixCents: null,
      pixRequested: true,
    });
    expect(ok.map((c) => c.key)).toEqual(["pix-pending"]);

    const fechado = cashCloseChips({
      millennium: [{ paymentMethod: "DINHEIRO", openingCents: 0, sangriaCents: null, closingCents: 10000, typedCents: 10000 }],
      card: null,
      pixCents: null,
      pixRequested: false,
    });
    expect(fechado).toEqual([{ key: "ok", label: "Fechado", tone: "ok" }]);
  });

  it("o gestor troca o dinheiro digitado e a falta assumida sai do desconto", () => {
    const base = {
      millennium: [{ paymentMethod: "DINHEIRO", openingCents: 0, sangriaCents: null, closingCents: 10000, typedCents: 8000 }],
      card: null,
      pixCents: null,
      pixRequested: false,
    };
    const ajustado = applyCashReview(base, { cashTypedCents: 9000, waive: false });
    expect(ajustado.millennium[0]?.typedCents).toBe(9000);
    const chips = cashCloseChips(base);
    expect(chipsAfterReview(chips, { cashTypedCents: 8000, waive: true })[0]).toMatchObject({
      label: "Falta assumida",
      tone: "ok",
    });
  });

  it("o valor digitado entra uma vez na linha já somada", () => {
    const base = {
      millennium: [
        { paymentMethod: "DINHEIRO", openingCents: 0, sangriaCents: null, closingCents: 6000, typedCents: 4000 },
        { paymentMethod: "DINHEIRO", openingCents: 0, sangriaCents: null, closingCents: 4000, typedCents: 4000 },
        { paymentMethod: "CARTÃO DÉBITO", openingCents: 0, sangriaCents: null, closingCents: 1000, typedCents: 1000 },
      ],
      card: null,
      pixCents: null,
      pixRequested: false,
    };
    const lines = applyCloseReview(buildCashCloseView(base).lines, {
      cashTypedCents: null,
      waive: false,
      typedCents: { cash: 9000, debit: 800 },
      acquirerCents: { debit: 750 },
    });
    expect(lines.find((l) => l.key === "cash")).toMatchObject({ systemCents: 10000, typedCents: 9000 });
    expect(lines.find((l) => l.key === "debit")).toMatchObject({ typedCents: 800, stoneCents: 750 });
    const waiting = applyCloseReview(buildCashCloseView(base).lines, { cashTypedCents: null, waive: false, acquirerCents: { debit: 750 } }, { cardPending: true });
    expect(waiting.find((l) => l.key === "debit")?.stoneCents).toBeNull();
  });
});

describe("resumo do fechamento", () => {
  const dinheiro = (system: number, typed: number) => ({
    millennium: [{ paymentMethod: "DINHEIRO", openingCents: 0, sangriaCents: null, closingCents: system, typedCents: typed }],
    card: null,
    pixCents: null,
    pixRequested: false,
  });

  it("soma sistema e digitado e marca o dia pendente enquanto a Stone não chega", () => {
    const view = buildCashCloseView({ ...dinheiro(10000, 10000), pixRequested: true });
    expect(closeDayTotals(view.lines)).toEqual({ systemCents: 10000, typedCents: 10000, diffCents: 0 });
    expect(dayAwaitingClose({ hasMillennium: true, pixRequested: true, pixCents: null })).toBe(true);
    expect(closeDayFace({ awaiting: true, hasLines: true, hasGap: false })).toBe("pendente");
  });

  it("diferença aparece mesmo com arquivo a caminho, e o dia limpo fica fechado", () => {
    const chips = cashCloseChips(dinheiro(10000, 8000));
    expect(chipsHaveGap(chips)).toBe(true);
    expect(closeDayFace({ awaiting: true, hasLines: true, hasGap: true })).toBe("diferenca");
    expect(chipsHaveGap([{ key: "loja-card-pending", label: "Aguardando cartão", tone: "warn" }])).toBe(false);
    expect(chipsHaveGap([{ key: "loja-ok", label: "Fechado", tone: "ok" }])).toBe(false);
    expect(chipsHaveGap([{ key: "loja-cash-caixa", label: "Falta assumida", tone: "ok" }])).toBe(false);
    expect(dayAwaitingClose({ hasMillennium: true, pixRequested: false, pixCents: null })).toBe(false);
    expect(closeDayFace({ awaiting: false, hasLines: true, hasGap: false })).toBe("fechado");
    expect(dayAwaitingClose({ hasMillennium: false, pixRequested: false, pixCents: null })).toBe(true);
  });

  it("resume o mês e conta o dia pendente uma vez", () => {
    expect(
      monthCloseSummary([
        { day: "2026-10-01", systemCents: 1000, typedCents: 800, pending: true },
        { day: "2026-10-01", systemCents: 500, typedCents: 500, pending: true },
        { day: "2026-10-02", systemCents: 2000, typedCents: 2000, pending: false },
      ]),
    ).toEqual({ systemCents: 3500, typedCents: 3300, diffCents: -200, pendingDays: 1 });
  });
});
