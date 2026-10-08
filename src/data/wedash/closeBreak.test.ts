import { describe, expect, it } from "vitest";
import { closeBreaks } from "./closeBreak";
import { buildCashCloseView } from "./cashCloseView";

const shifts = [
  { name: "MANHÃ", start: "09:00", end: "14:00" },
  { name: "TARDE", start: "14:00", end: "18:00" },
];

function lines(rows: Array<{ method: string; system: number; typed: number }>) {
  return buildCashCloseView({
    millennium: rows.map((row) => ({
      paymentMethod: row.method,
      openingCents: 0,
      sangriaCents: null,
      closingCents: row.system,
      typedCents: row.typed,
    })),
    card: null,
    pixCents: null,
    pixRequested: false,
  }).lines;
}

describe("quebra do fechamento", () => {
  it("sobra não pede justificativa e a venda cai no grupo do horário", () => {
    const [item] = closeBreaks({
      lines: lines([{ method: "DINHEIRO", system: 1000, typed: 1500 }]),
      sales: [{ occurredAt: "2026-10-07T13:30:00.000Z", paymentMethod: "Dinheiro", sellerName: "Ana" }],
      shifts,
      timeZone: "America/Sao_Paulo",
      pixPending: false,
    });
    expect(item).toMatchObject({
      key: "cash",
      diffCents: 500,
      groups: ["MANHÃ"],
      reason: "Sobra. Não pede justificativa.",
    });
  });

  it("quebra de R$ 2 em dinheiro pode ser sacola", () => {
    const [item] = closeBreaks({
      lines: lines([{ method: "DINHEIRO", system: 1000, typed: 800 }]),
      sales: [{ occurredAt: "2026-10-07T17:00:00.000Z", paymentMethod: "Dinheiro", sellerName: "Ana" }],
      shifts,
      timeZone: "America/Sao_Paulo",
      pixPending: false,
    });
    expect(item.groups).toEqual(["TARDE"]);
    expect(item.reason).toBe("Pode ser sacola de R$ 2.");
  });

  it("valores espelhados podem ser inversão", () => {
    const items = closeBreaks({
      lines: lines([
        { method: "CARTÃO DÉBITO", system: 1000, typed: 800 },
        { method: "CARTÃO CRÉDITO", system: 800, typed: 1000 },
      ]),
      sales: [],
      shifts,
      timeZone: "America/Sao_Paulo",
      pixPending: false,
    });
    expect(items.find((item) => item.key === "debit")?.reason).toBe("Pode ser inversão com cartão de crédito.");
    expect(items.find((item) => item.key === "credit")?.reason).toBe("Sobra. Não pede justificativa.");
  });

  it("falta sem venda fica sem grupo até alguém escolher", () => {
    const [item] = closeBreaks({
      lines: lines([{ method: "DINHEIRO", system: 1000, typed: 700 }]),
      sales: [],
      shifts,
      timeZone: "America/Sao_Paulo",
      pixPending: false,
    });
    expect(item.groups).toEqual([]);
    expect(item.reason).toBe("Falta sem venda identificada. Fica no grupo até escolher a pessoa.");
  });

  it("venda sem vendedor fica no grupo e não entra na folha", () => {
    const [item] = closeBreaks({
      lines: lines([{ method: "PIX", system: 1000, typed: 700 }]),
      sales: [{ occurredAt: "2026-10-07T13:30:00.000Z", paymentMethod: "Pix", sellerName: "" }],
      shifts,
      timeZone: "America/Sao_Paulo",
      pixPending: false,
    });
    expect(item.reason).toBe("Sem vendedor. A falta fica em MANHÃ e não entra na folha.");
  });

  it("vendas em dois grupos não separam a quebra", () => {
    const [item] = closeBreaks({
      lines: lines([{ method: "PIX", system: 1000, typed: 700 }]),
      sales: [
        { occurredAt: "2026-10-07T13:30:00.000Z", paymentMethod: "Pix", sellerName: "Ana" },
        { occurredAt: "2026-10-07T18:00:00.000Z", paymentMethod: "Pix", sellerName: "Bia" },
      ],
      shifts,
      timeZone: "America/Sao_Paulo",
      pixPending: false,
    });
    expect(item.groups).toEqual(["MANHÃ", "TARDE"]);
    expect(item.reason).toBe("As vendas passaram por MANHÃ e TARDE. A quebra do dia não separa o grupo.");
  });

  it("pix pedido e ainda sem arquivo fica em aberto", () => {
    const [item] = closeBreaks({
      lines: lines([{ method: "PIX", system: 1000, typed: 700 }]),
      sales: [],
      shifts,
      timeZone: "America/Sao_Paulo",
      pixPending: true,
    });
    expect(item.reason).toBe("Pix ainda em aberto.");
  });
});
