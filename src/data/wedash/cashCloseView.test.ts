import { describe, expect, it } from "vitest";
import {
  applyCashReview,
  applyCloseReview,
  assembleMonthMarks,
  rowsForAcquirer,
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
        { paymentMethod: "DINHEIRO", openingCents: 44775, cashDropCents: -485000, closingCents: -10275, typedCents: 25850 },
        { paymentMethod: "CARTÃO CRÉDITO", openingCents: 0, cashDropCents: null, closingCents: 2_068_060, typedCents: 2_145_930 },
        { paymentMethod: "TEF CARTÃO CRÉDITO", openingCents: 0, cashDropCents: null, closingCents: 44910, typedCents: 44910 },
        { paymentMethod: "CARTÃO DÉBITO", openingCents: 0, cashDropCents: null, closingCents: 1_740_940, typedCents: 1_778_890 },
        { paymentMethod: "TEF CARTÃO DÉBITO", openingCents: 0, cashDropCents: null, closingCents: 66100, typedCents: 66100 },
        { paymentMethod: "PIX", openingCents: 0, cashDropCents: null, closingCents: 1_431_330, typedCents: 1_433_930 },
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
    expect(view.lines.find((l) => l.key === "cash")?.cashDropCents).toBe(-485000);
  });

  it("com os arquivos gravados, a Stone entra na conferência", () => {
    const view = buildCashCloseView({
      millennium: [
        { paymentMethod: "CARTÃO CRÉDITO", openingCents: 0, cashDropCents: null, closingCents: 1000, typedCents: 1000 },
        { paymentMethod: "PIX", openingCents: 0, cashDropCents: null, closingCents: 500, typedCents: 500 },
      ],
      card: { creditCents: 1000, debitCents: 0, otherCents: 0 },
      pixCents: 480,
      pixRequested: false,
    });
    expect(view.lines.find((l) => l.key === "credit")?.stoneCents).toBe(1000);
    expect(view.lines.find((l) => l.key === "pix")?.stoneCents).toBe(480);
    expect(view.lines.find((l) => l.key === "other")).toBeUndefined();
  });

  it("com o arquivo do cartão, Outros do Millennium sem captura fica zerado e entra na soma", () => {
    const view = buildCashCloseView({
      millennium: [
        { paymentMethod: "DINHEIRO", openingCents: 0, cashDropCents: null, closingCents: 328280, typedCents: 204490 },
        { paymentMethod: "CARTÃO DE DÉBITO", openingCents: 0, cashDropCents: null, closingCents: 570770, typedCents: 0 },
        { paymentMethod: "CARTÃO DE CRÉDITO", openingCents: 0, cashDropCents: null, closingCents: 837140, typedCents: 0 },
        { paymentMethod: "PIX", openingCents: 0, cashDropCents: null, closingCents: 341770, typedCents: 0 },
        { paymentMethod: "VOUCHER", openingCents: 0, cashDropCents: null, closingCents: 30470, typedCents: 0 },
      ],
      card: { creditCents: 825800, debitCents: 620770, otherCents: 0 },
      pixCents: 400320,
      pixRequested: false,
    });
    expect(view.lines.find((l) => l.key === "other")).toMatchObject({ systemCents: 30470, stoneCents: 0 });
    expect(dayWithoutReal(view.lines)).toBe(false);
    const gap = closeDayGap(view.lines);
    expect(gap.realCents).toBe(204490 + 620770 + 825800 + 400320);
    expect(gap.systemCents).toBe(328280 + 570770 + 837140 + 341770 + 30470);
    expect(gap.diffCents).toBe(gap.realCents - gap.systemCents);
  });

  it("Outros sem captura fica R$ 0,00 e o total soma as outras formas", () => {
    const view = buildCashCloseView({
      millennium: [
        { paymentMethod: "DINHEIRO", openingCents: 0, cashDropCents: null, closingCents: 121530, typedCents: 110410 },
        { paymentMethod: "CARTÃO DE DÉBITO", openingCents: 0, cashDropCents: null, closingCents: 259840, typedCents: 0 },
        { paymentMethod: "CARTÃO DE CRÉDITO", openingCents: 0, cashDropCents: null, closingCents: 290570, typedCents: 0 },
        { paymentMethod: "PIX", openingCents: 0, cashDropCents: null, closingCents: 169670, typedCents: 0 },
        { paymentMethod: "VOUCHER", openingCents: 0, cashDropCents: null, closingCents: 11190, typedCents: 0 },
      ],
      card: { creditCents: 290570, debitCents: 259840, otherCents: 0 },
      pixCents: 174960,
      pixRequested: false,
    });
    expect(view.lines.find((l) => l.key === "other")).toMatchObject({ systemCents: 11190, stoneCents: 0 });
    expect(dayWithoutReal(view.lines)).toBe(false);
    expect(closeDayGap(view.lines)).toEqual({
      systemCents: 852800,
      comparedSystemCents: 852800,
      realCents: 110410 + 259840 + 290570 + 174960,
      diffCents: 110410 + 259840 + 290570 + 174960 - 852800,
    });
  });

  it("marca falta no calendário e, sem diferença, o dia fechado", () => {
    const gap = cashCloseChips({
      millennium: [{ paymentMethod: "DINHEIRO", openingCents: 0, cashDropCents: null, closingCents: 10000, typedCents: 8000 }],
      card: null,
      pixCents: null,
      pixRequested: false,
    });
    expect(gap[0]).toMatchObject({ tone: "bad", label: expect.stringContaining("Dinheiro") });

    const ok = cashCloseChips({
      millennium: [{ paymentMethod: "DINHEIRO", openingCents: 0, cashDropCents: null, closingCents: 10000, typedCents: 10000 }],
      card: null,
      pixCents: null,
      pixRequested: true,
    });
    expect(ok.map((c) => c.key)).toEqual(["pix-pending"]);

    const closed = cashCloseChips({
      millennium: [{ paymentMethod: "DINHEIRO", openingCents: 0, cashDropCents: null, closingCents: 10000, typedCents: 10000 }],
      card: null,
      pixCents: null,
      pixRequested: false,
    });
    expect(closed).toEqual([{ key: "ok", label: "Fechado", tone: "ok" }]);
  });

  it("o gestor troca o dinheiro digitado e a falta assumida sai do desconto", () => {
    const base = {
      millennium: [{ paymentMethod: "DINHEIRO", openingCents: 0, cashDropCents: null, closingCents: 10000, typedCents: 8000 }],
      card: null,
      pixCents: null,
      pixRequested: false,
    };
    const adjusted = applyCashReview(base, { cashTypedCents: 9000, waive: false });
    expect(adjusted.millennium[0]?.typedCents).toBe(9000);
    const chips = cashCloseChips(base);
    expect(chipsAfterReview(chips, { cashTypedCents: 8000, waive: true })[0]).toMatchObject({
      label: "Falta assumida",
      tone: "ok",
    });
  });

  it("o valor digitado entra uma vez na linha já somada", () => {
    const base = {
      millennium: [
        { paymentMethod: "DINHEIRO", openingCents: 0, cashDropCents: null, closingCents: 6000, typedCents: 4000 },
        { paymentMethod: "DINHEIRO", openingCents: 0, cashDropCents: null, closingCents: 4000, typedCents: 4000 },
        { paymentMethod: "CARTÃO DÉBITO", openingCents: 0, cashDropCents: null, closingCents: 1000, typedCents: 1000 },
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
  const cash = (system: number, typed: number) => ({
    millennium: [{ paymentMethod: "DINHEIRO", openingCents: 0, cashDropCents: null, closingCents: system, typedCents: typed }],
    card: null,
    pixCents: null,
    pixRequested: false,
  });

  it("soma sistema e digitado e marca o dia pendente enquanto a Stone não chega", () => {
    const view = buildCashCloseView({ ...cash(10000, 10000), pixRequested: true });
    expect(closeDayTotals(view.lines)).toEqual({ systemCents: 10000, typedCents: 10000, diffCents: 0 });
    expect(dayAwaitingClose({ hasMillennium: true, pixRequested: true, pixCents: null })).toBe(true);
    expect(closeDayFace({ awaiting: true, hasLines: true, hasGap: false })).toBe("pending");
  });

  it("soma o total real do cartão mesmo quando o digitado bate com o Millennium", () => {
    const view = buildCashCloseView({
      millennium: [
        { paymentMethod: "DINHEIRO", openingCents: 100, cashDropCents: null, closingCents: 18470, typedCents: 18470 },
        { paymentMethod: "CARTÃO DE DÉBITO", openingCents: 0, cashDropCents: null, closingCents: 0, typedCents: 0 },
        { paymentMethod: "CARTÃO DE CRÉDITO", openingCents: 0, cashDropCents: null, closingCents: 0, typedCents: 0 },
      ],
      card: { creditCents: 0, debitCents: 100, otherCents: 0 },
      pixCents: null,
      pixRequested: false,
    });
    expect(closeDayGap(view.lines)).toEqual({ systemCents: 18470, comparedSystemCents: 18470, realCents: 18570, diffCents: 100 });
  });

  it("não inventa quebra enquanto o total real do Pix não foi informado", () => {
    const view = buildCashCloseView({
      millennium: [{ paymentMethod: "PIX", openingCents: 0, cashDropCents: null, closingCents: 2541340, typedCents: 2538250 }],
      card: null,
      pixCents: null,
      pixRequested: true,
    });
    expect(realCentsOf(view.lines[0])).toBeNull();
    expect(closeDayGap(view.lines)).toEqual({ systemCents: 2541340, comparedSystemCents: 0, realCents: 0, diffCents: 0 });
    expect(dayWithoutReal(view.lines)).toBe(true);
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
      millennium: [{ paymentMethod: "PIX", openingCents: 0, cashDropCents: null, closingCents: 2541340, typedCents: 0 }],
      card: null,
      pixCents: 2537250,
      pixRequested: false,
    });
    expect(closeDayGap(view.lines).diffCents).toBe(2537250 - 2541340);
  });

  it("diferença aparece mesmo com arquivo a caminho, e o dia limpo fica fechado", () => {
    const chips = cashCloseChips(cash(10000, 8000));
    expect(chipsHaveGap(chips)).toBe(true);
    expect(closeDayFace({ awaiting: true, hasLines: true, hasGap: true })).toBe("difference");
    expect(chipsHaveGap([{ key: "loja-card-pending", label: "Aguardando cartão", tone: "warn" }])).toBe(false);
    expect(chipsHaveGap([{ key: "loja-ok", label: "Fechado", tone: "ok" }])).toBe(false);
    expect(chipsHaveGap([{ key: "loja-cash-caixa", label: "Falta assumida", tone: "ok" }])).toBe(false);
    expect(dayAwaitingClose({ hasMillennium: true, pixRequested: false, pixCents: null })).toBe(false);
    expect(closeDayFace({ awaiting: false, hasLines: true, hasGap: false })).toBe("closed");
    expect(dayAwaitingClose({ hasMillennium: false, pixRequested: false, pixCents: null })).toBe(true);
  });

  it("dia sem total real fica pendente e fora da diferença do mês", () => {
    const withoutFile = buildCashCloseView({
      millennium: [{ paymentMethod: "PIX", openingCents: 0, cashDropCents: null, closingCents: 1000, typedCents: 0 }],
      card: null,
      pixCents: null,
      pixRequested: true,
    });
    expect(dayWithoutReal(withoutFile.lines)).toBe(true);
    const withFile = buildCashCloseView({
      millennium: [{ paymentMethod: "PIX", openingCents: 0, cashDropCents: null, closingCents: 1000, typedCents: 0 }],
      card: null,
      pixCents: 1000,
      pixRequested: false,
    });
    expect(dayWithoutReal(withFile.lines)).toBe(false);
    const dia09 = assembleMonthMarks({
      millennium: [
        { storeId: "loja", day: "2026-10-09", paymentMethod: "DINHEIRO", openingCents: 22750, cashDropCents: -90000, closingCents: 25560, typedCents: 29600 },
        { storeId: "loja", day: "2026-10-09T00:00:00", paymentMethod: "CARTÃO DÉBITO", openingCents: 0, cashDropCents: null, closingCents: 604121, typedCents: 605521 },
        { storeId: "loja", day: "2026-10-09", paymentMethod: "CARTÃO CRÉDITO", openingCents: 0, cashDropCents: null, closingCents: 1401680, typedCents: 1404080 },
        { storeId: "loja", day: "2026-10-09", paymentMethod: "PIX", openingCents: 0, cashDropCents: null, closingCents: 631650, typedCents: 640340 },
      ],
      files: [
        { storeId: "loja", day: "2026-10-09", kind: "card", status: "received" },
        { storeId: "loja", day: "2026-10-09T00:00:00", kind: "pix", status: "received" },
      ],
      captures: [
        { storeId: "loja", day: "2026-10-09T00:00:00", accountType: 1, paymentMethod: "Débito", capturedCents: 605521 },
        { storeId: "loja", day: "2026-10-09", accountType: 2, paymentMethod: "Crédito", capturedCents: 1404080 },
      ],
      pix: [{ storeId: "loja", day: "2026-10-09", status: "paid", paidCents: 629150 }],
    });
    expect(dia09).toHaveLength(1);
    expect(dia09[0]?.day).toBe("2026-10-09");
    const linhas09 = buildCashCloseView({
      millennium: dia09[0]!.millennium,
      card: dia09[0]!.card,
      pixCents: dia09[0]!.pixCents,
      pixRequested: dia09[0]!.pixRequested,
    }).lines;
    expect(dayWithoutReal(linhas09)).toBe(false);
    expect(closeDayGap(linhas09).diffCents).toBe(5340);
    expect(
      monthCloseSummary([
        { day: "2026-10-01", systemCents: 5000, realCents: 0, diffCents: -1000, pending: true },
        { day: "2026-10-01", systemCents: 20, realCents: 0, diffCents: -50, pending: true },
        { day: "2026-10-02", systemCents: 1000, realCents: 1100, diffCents: 100, pending: false },
        { day: "2026-10-03", systemCents: 200, realCents: 160, diffCents: -40, pending: false },
      ]),
    ).toEqual({
      systemCents: 1200,
      realCents: 1260,
      diffCents: 60,
      surplusCents: 100,
      shortageCents: 40,
      surplusDays: 1,
      shortageDays: 1,
      pendingDays: 1,
    });
  });

  it("soma o PIX online à adquirente e mantém os dois valores", () => {
    const lines = applyCloseReview(
      buildCashCloseView({
        millennium: [{ paymentMethod: "PIX", openingCents: 0, cashDropCents: null, closingCents: 150000, typedCents: 0 }],
        card: null,
        pixCents: 100000,
        pixRequested: false,
      }).lines,
      {
        cashTypedCents: null,
        waive: false,
        onlinePix: [
          { id: "a", cents: 40000, note: "Maria" },
          { id: "b", cents: 10000, note: "" },
        ],
      },
    );
    const pix = lines.find((line) => line.key === "pix");
    expect(pix).toMatchObject({ stoneCents: 100000, manualPixCents: 50000 });
    expect(realCentsOf(pix!)).toBe(150000);
    expect(closeDayGap(lines).diffCents).toBe(0);
  });

  it("guarda o PIX online sem fechar o dia enquanto a adquirente não chegou", () => {
    const lines = applyCloseReview(
      buildCashCloseView({
        millennium: [{ paymentMethod: "PIX", openingCents: 0, cashDropCents: null, closingCents: 150000, typedCents: 0 }],
        card: null,
        pixCents: null,
        pixRequested: true,
      }).lines,
      {
        cashTypedCents: null,
        waive: false,
        onlinePix: [{ id: "a", cents: 50000, note: "" }],
      },
    );
    expect(lines.find((line) => line.key === "pix")).toMatchObject({ stoneCents: null, manualPixCents: 50000 });
    expect(realCentsOf(lines[0]!)).toBeNull();
    expect(dayWithoutReal(lines)).toBe(true);
    expect(closeDayGap(lines)).toMatchObject({ comparedSystemCents: 0, realCents: 0, diffCents: 0 });
  });

  it("com adquirente zero, o total real do Pix é só o PIX online", () => {
    const lines = applyCloseReview(
      buildCashCloseView({
        millennium: [{ paymentMethod: "DINHEIRO", openingCents: 0, cashDropCents: null, closingCents: 1000, typedCents: 1000 }],
        card: null,
        pixCents: null,
        pixRequested: false,
      }).lines,
      {
        cashTypedCents: null,
        waive: false,
        acquirerCents: { pix: 0 },
        onlinePix: [{ id: "a", cents: 5000, note: "Extrato" }],
      },
    );
    const pix = lines.find((line) => line.key === "pix");
    expect(pix).toMatchObject({ systemCents: 0, stoneCents: 0, manualPixCents: 5000 });
    expect(realCentsOf(pix!)).toBe(5000);
    expect(closeDayGap(lines).diffCents).toBe(5000);
  });

  it("soma a retirada de funcionário no total real do dinheiro", () => {
    const lines = applyCloseReview(
      buildCashCloseView({
        millennium: [{ paymentMethod: "DINHEIRO", openingCents: 0, cashDropCents: null, closingCents: 100000, typedCents: 80000 }],
        card: null,
        pixCents: null,
        pixRequested: false,
      }).lines,
      {
        cashTypedCents: null,
        waive: false,
        withdrawals: [{ sellerId: "ana", cents: 20000 }],
      },
    );
    const cash = lines.find((line) => line.key === "cash");
    expect(cash).toMatchObject({ typedCents: 80000, withdrawalCents: 20000 });
    expect(realCentsOf(cash!)).toBe(100000);
    expect(closeDayGap(lines).diffCents).toBe(0);
  });
});

describe("rowsForAcquirer", () => {
  it("usa o arquivo da Cielo na filial conectada e mantém a Stone nas outras", () => {
    const stone = [
      { storeId: "a", day: "2026-10-01" },
      { storeId: "b", day: "2026-10-01" },
    ];
    const cielo = [{ storeId: "b", day: "2026-10-02" }];
    expect(rowsForAcquirer(stone, cielo, new Set(["b"]))).toEqual([
      { storeId: "a", day: "2026-10-01" },
      { storeId: "b", day: "2026-10-02" },
    ]);
  });
});
