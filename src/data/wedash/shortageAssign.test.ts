import { describe, expect, it } from "vitest";
import { buildCashCloseView } from "./cashCloseView";
import { shortageShares, suggestDayShortage, unpairedSales } from "./shortageAssign";

const shifts = [
  { name: "MANHÃ", start: "09:00", end: "14:00" },
  { name: "TARDE", start: "14:00", end: "18:00" },
];

const zone = "America/Sao_Paulo";

function lines(rows: Array<{ method: string; system: number; real: number }>) {
  return buildCashCloseView({
    millennium: rows.map((row) => ({
      paymentMethod: row.method,
      openingCents: 0,
      sangriaCents: null,
      closingCents: row.system,
      typedCents: row.method.includes("DINHEIRO") ? row.real : 0,
    })),
    card: {
      debitCents: rows.find((row) => row.method.includes("DÉBITO"))?.real ?? null,
      creditCents: rows.find((row) => row.method.includes("CRÉDITO"))?.real ?? null,
      otherCents: 0,
    },
    pixCents: rows.find((row) => row.method.includes("PIX"))?.real ?? null,
    pixRequested: true,
  }).lines;
}

describe("direcionar a falta", () => {
  it("casa a captura com a venda mais próxima e sobra a que não foi cobrada", () => {
    const left = unpairedSales(
      [
        { occurredAt: "2026-10-07T13:00:00.000Z", paymentMethod: "Cartão de crédito", sellerName: "Ana", revenueCents: 5000 },
        { occurredAt: "2026-10-07T18:00:00.000Z", paymentMethod: "Cartão de crédito", sellerName: "Bia", revenueCents: 5000 },
      ],
      [{ occurredAt: "2026-10-07T18:05:00.000Z", paymentMethod: "Cartão de crédito", capturedCents: 5000 }],
    );
    expect(left.map((sale) => sale.sellerName)).toEqual(["Ana"]);
  });

  it("crédito que fecha com uma venda aponta a vendedora", () => {
    const suggestion = suggestDayShortage({
      lines: lines([{ method: "CARTÃO CRÉDITO", system: 15000, real: 10000 }]),
      sales: [
        { occurredAt: "2026-10-07T13:00:00.000Z", paymentMethod: "Cartão de crédito", sellerName: "Ana", revenueCents: 10000 },
        { occurredAt: "2026-10-07T15:00:00.000Z", paymentMethod: "Cartão de crédito", sellerName: "Bia", revenueCents: 5000 },
      ],
      captures: [{ occurredAt: "2026-10-07T15:00:00.000Z", paymentMethod: "Cartão de crédito", capturedCents: 10000 }],
      shifts,
      timeZone: zone,
    });
    expect(suggestion.scope).toBe("seller");
    expect(suggestion.sellers).toEqual(["Bia"]);
    expect(suggestion.amounts).toEqual({ Bia: 5000 });
    expect(suggestion.note).toBe("A falta fecha com a venda de Bia.");
  });

  it("dinheiro igual a uma venda aponta essa vendedora", () => {
    const suggestion = suggestDayShortage({
      lines: lines([{ method: "DINHEIRO", system: 8000, real: 3000 }]),
      sales: [
        { occurredAt: "2026-10-07T13:00:00.000Z", paymentMethod: "Dinheiro", sellerName: "Ana", revenueCents: 5000 },
        { occurredAt: "2026-10-07T17:30:00.000Z", paymentMethod: "Dinheiro", sellerName: "Bia", revenueCents: 3000 },
      ],
      captures: [],
      shifts,
      timeZone: zone,
    });
    expect(suggestion).toMatchObject({ scope: "seller", sellers: ["Ana"], split: "matched" });
  });

  it("várias vendas do mesmo valor ficam para escolha", () => {
    const suggestion = suggestDayShortage({
      lines: lines([{ method: "DINHEIRO", system: 5000, real: 0 }]),
      sales: [
        { occurredAt: "2026-10-07T13:00:00.000Z", paymentMethod: "Dinheiro", sellerName: "Ana", revenueCents: 5000 },
        { occurredAt: "2026-10-07T17:30:00.000Z", paymentMethod: "Dinheiro", sellerName: "Bia", revenueCents: 5000 },
      ],
      captures: [],
      shifts,
      timeZone: zone,
    });
    expect(suggestion.scope).toBe("seller");
    expect(suggestion.sellers).toEqual([]);
    expect(suggestion.candidates).toEqual(["Ana", "Bia"]);
    expect(suggestion.note).toBe("Há mais de uma venda deste valor. Escolha quem paga.");
  });

  it("sem venda do valor, a hora cai no grupo", () => {
    const suggestion = suggestDayShortage({
      lines: lines([{ method: "DINHEIRO", system: 4000, real: 2500 }]),
      sales: [
        { occurredAt: "2026-10-07T13:00:00.000Z", paymentMethod: "Dinheiro", sellerName: "Ana", revenueCents: 2000 },
        { occurredAt: "2026-10-07T13:40:00.000Z", paymentMethod: "Dinheiro", sellerName: "Bia", revenueCents: 2000 },
      ],
      captures: [],
      shifts,
      timeZone: zone,
    });
    expect(suggestion.scope).toBe("group");
    expect(suggestion.group).toBe("MANHÃ");
    expect(suggestion.note).toBe("A falta cai em MANHÃ.");
  });

  it("hora em dois grupos pede a escolha do grupo", () => {
    const suggestion = suggestDayShortage({
      lines: lines([{ method: "DINHEIRO", system: 4000, real: 2500 }]),
      sales: [
        { occurredAt: "2026-10-07T13:00:00.000Z", paymentMethod: "Dinheiro", sellerName: "Ana", revenueCents: 2000 },
        { occurredAt: "2026-10-07T17:30:00.000Z", paymentMethod: "Dinheiro", sellerName: "Bia", revenueCents: 2000 },
      ],
      captures: [],
      shifts,
      timeZone: zone,
    });
    expect(suggestion.scope).toBe("group");
    expect(suggestion.group).toBe("");
    expect(suggestion.groups).toEqual(["MANHÃ", "TARDE"]);
  });

  it("sem grupo configurado a falta fica com a equipe", () => {
    const suggestion = suggestDayShortage({
      lines: lines([{ method: "DINHEIRO", system: 4000, real: 2500 }]),
      sales: [{ occurredAt: "2026-10-07T13:00:00.000Z", paymentMethod: "Dinheiro", sellerName: "Ana", revenueCents: 2000 }],
      captures: [],
      shifts: [],
      timeZone: zone,
    });
    expect(suggestion.scope).toBe("everyone");
    expect(suggestion.note).toBe("Não há grupo configurado. A falta fica com toda a equipe.");
  });

  it("rateio igual reparte o centavo e o grupo só inclui quem trabalhou nele", () => {
    const suggestion = suggestDayShortage({
      lines: lines([{ method: "DINHEIRO", system: 4000, real: 2500 }]),
      sales: [
        { occurredAt: "2026-10-07T13:00:00.000Z", paymentMethod: "Dinheiro", sellerName: "Ana", revenueCents: 2000 },
        { occurredAt: "2026-10-07T13:40:00.000Z", paymentMethod: "Dinheiro", sellerName: "Bia", revenueCents: 2000 },
        { occurredAt: "2026-10-07T17:30:00.000Z", paymentMethod: "Dinheiro", sellerName: "Cia", revenueCents: 900 },
      ],
      captures: [],
      shifts,
      timeZone: zone,
    });
    const shares = shortageShares({
      shortageCents: 1500,
      scope: "group",
      sellers: [],
      group: "MANHÃ",
      suggestion,
      sales: [
        { occurredAt: "2026-10-07T13:00:00.000Z", paymentMethod: "Dinheiro", sellerName: "Ana", revenueCents: 2000 },
        { occurredAt: "2026-10-07T13:40:00.000Z", paymentMethod: "Dinheiro", sellerName: "Bia", revenueCents: 2000 },
        { occurredAt: "2026-10-07T17:30:00.000Z", paymentMethod: "Dinheiro", sellerName: "Cia", revenueCents: 900 },
      ],
      shifts,
      timeZone: zone,
    });
    expect(shares).toEqual([
      { name: "Ana", cents: 750 },
      { name: "Bia", cents: 750 },
    ]);
  });
});
