import { describe, expect, it } from "vitest";
import {
  applyCashReview,
  applyCloseReview,
  buildCashCloseView,
  captureBucket,
  cashCloseChips,
  chipsHaveGap,
  closeDayFace,
  closeDayGap,
  closeDayTotals,
  dayWithoutReal,
  realCentsOf,
  dayAwaitingClose,
  monthCloseSummary,
  closeSaleDays,
  paidPixCents,
  chipsAfterReview,
} from "./cashCloseView";

describe("captureBucket", () => {
  it("soma crédito pré-pago no crédito e débito pré-pago no débito", () => {
    expect(captureBucket(4, "Outros")).toBe("credit");
    expect(captureBucket(2, "Cartão de crédito")).toBe("credit");
    expect(captureBucket(1, "Cartão de débito")).toBe("debit");
    expect(captureBucket(3, "Cartão de débito")).toBe("debit");
    expect(captureBucket(null, "PIX")).toBe("pix");
  });
});

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
    const waiting = applyCloseReview(
      buildCashCloseView(base).lines,
      { cashTypedCents: null, waive: false, acquirerCents: { debit: 750 } },
      { cardPending: true },
    );
    expect(waiting.find((l) => l.key === "debit")?.stoneCents).toBe(750);
    const withFile = applyCloseReview(
      buildCashCloseView({ ...base, card: { creditCents: 0, debitCents: 1000, otherCents: 0 } }).lines,
      { cashTypedCents: null, waive: false, acquirerCents: { debit: 750 } },
    );
    expect(withFile.find((l) => l.key === "debit")?.stoneCents).toBe(750);
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

  it("soma o total real do cartão mesmo quando o digitado bate com o Millennium", () => {
    const view = buildCashCloseView({
      millennium: [
        { paymentMethod: "DINHEIRO", openingCents: 100, sangriaCents: null, closingCents: 18470, typedCents: 18470 },
        { paymentMethod: "CARTÃO DE DÉBITO", openingCents: 0, sangriaCents: null, closingCents: 0, typedCents: 0 },
        { paymentMethod: "CARTÃO DE CRÉDITO", openingCents: 0, sangriaCents: null, closingCents: 0, typedCents: 0 },
      ],
      card: { creditCents: 0, debitCents: 100, otherCents: 0 },
      pixCents: null,
      pixRequested: false,
    });
    expect(closeDayGap(view.lines)).toEqual({ systemCents: 18470, comparedSystemCents: 18470, realCents: 18570, diffCents: 100 });
  });

  it("deixa a diferença negativa enquanto o total real do Pix não foi informado", () => {
    const view = buildCashCloseView({
      millennium: [{ paymentMethod: "PIX", openingCents: 0, sangriaCents: null, closingCents: 2541340, typedCents: 2538250 }],
      card: null,
      pixCents: null,
      pixRequested: true,
    });
    expect(realCentsOf(view.lines[0])).toBeNull();
    expect(closeDayGap(view.lines)).toEqual({ systemCents: 2541340, comparedSystemCents: 2541340, realCents: 0, diffCents: -2541340 });
  });

  it("separa dia com venda, dia de cartão e dia de Pix", () => {
    const days = closeSaleDays([
      { day: "2026-10-01", paymentMethod: "DINHEIRO", closingCents: 0 },
      { day: "2026-10-06", paymentMethod: "CARTÃO DE CRÉDITO", closingCents: 1000 },
      { day: "2026-10-07", paymentMethod: "PIX", closingCents: 500 },
    ]);
    expect([...days.any].sort()).toEqual(["2026-10-06", "2026-10-07"]);
    expect([...days.card]).toEqual(["2026-10-06"]);
    expect([...days.pix]).toEqual(["2026-10-07"]);
  });

  it("soma o Pix pago e usa esse total na diferença do dia", () => {
    expect(
      paidPixCents([
        { status: "paid", paidCents: 2537250 },
        { status: "canceled", paidCents: 500 },
        { status: "Cancelled", paidCents: 200 },
      ]),
    ).toBe(2537250);
    const view = buildCashCloseView({
      millennium: [{ paymentMethod: "PIX", openingCents: 0, sangriaCents: null, closingCents: 2541340, typedCents: 0 }],
      card: null,
      pixCents: 2537250,
      pixRequested: false,
    });
    expect(closeDayGap(view.lines).diffCents).toBe(2537250 - 2541340);
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

  it("dia sem total real fica pendente e fora da diferença do mês", () => {
    const semArquivo = buildCashCloseView({
      millennium: [{ paymentMethod: "PIX", openingCents: 0, sangriaCents: null, closingCents: 1000, typedCents: 0 }],
      card: null,
      pixCents: null,
      pixRequested: true,
    });
    expect(dayWithoutReal(semArquivo.lines)).toBe(true);
    const comArquivo = buildCashCloseView({
      millennium: [{ paymentMethod: "PIX", openingCents: 0, sangriaCents: null, closingCents: 1000, typedCents: 0 }],
      card: null,
      pixCents: 1000,
      pixRequested: false,
    });
    expect(dayWithoutReal(comArquivo.lines)).toBe(false);
    expect(
      monthCloseSummary([
        { day: "2026-10-01", diffCents: -1000, pending: true },
        { day: "2026-10-01", diffCents: -50, pending: true },
        { day: "2026-10-02", diffCents: 100, pending: false },
        { day: "2026-10-03", diffCents: -40, pending: false },
      ]),
    ).toEqual({ diffCents: 60, pendingDays: 1 });
  });
});
