import { describe, expect, it } from "vitest";
import { dayAmounts, depositBlock, depositBoleto, emissionDay, nextNote, parseSangriaLista, reaisToCents, sumAmounts } from "./sangriaMath";

describe("sangria", () => {
  it("o dia da planilha é a data de DATA_EMISSAO", () => {
    expect(emissionDay("2026-08-01T03:00:00.000Z")).toBe("2026-08-01");
    expect(reaisToCents(-4.5)).toBe(450);
  });

  it("separa depósito e compra no dia", () => {
    const day = dayAmounts([
      { amountCents: 150000, kind: "deposit", note: "SANGRIA 02/08 19:48" },
      { amountCents: 450, kind: "purchase", note: "SANGRIA CANETA 4,50" },
    ]);
    expect(day).toEqual({
      totalCents: 150450,
      boletoCents: 150000,
      faltandoCents: 450,
      motivo: "SANGRIA CANETA 4,50",
    });
  });

  it("o mês soma os dias e o depósito soma só os dias marcados", () => {
    const lines = [
      { day: "2026-08-01", amountCents: 140000, kind: "deposit" as const, note: "" },
      { day: "2026-08-02", amountCents: 450, kind: "purchase" as const, note: "Caneta" },
      { day: "2026-08-02", amountCents: 150000, kind: "deposit" as const, note: "" },
    ];
    expect(sumAmounts([dayAmounts(lines.filter((l) => l.day === "2026-08-01")), dayAmounts(lines.filter((l) => l.day === "2026-08-02"))])).toMatchObject({
      totalCents: 290450,
      boletoCents: 290000,
      faltandoCents: 450,
    });
    expect(depositBoleto(lines, ["2026-08-01", "2026-08-02"])).toBe(290000);
  });

  it("não deposita dia já usado nem intervalo vazio", () => {
    expect(depositBlock([], new Set())).toBe("Marque ao menos um dia.");
    expect(depositBlock(["2026-08-01"], new Set(["2026-08-01"]))).toBe("Um desses dias já está num depósito.");
    expect(depositBlock(["2026-08-02"], new Set(["2026-08-01"]))).toBeNull();
  });

  it("a observação editada sobrevive à próxima busca", () => {
    expect(nextNote("Caneta (R$ 4,50)", "SANGRIA CANETA 4,50", "SANGRIA CANETA 4,50")).toBe("Caneta (R$ 4,50)");
    expect(nextNote("SANGRIA CANETA 4,50", "SANGRIA CANETA 4,50", "SANGRIA CANETA")).toBe("SANGRIA CANETA");
  });

  it("lê o lançamento do Millennium", () => {
    const rows = parseSangriaLista({
      value: [
        { LANCAMENTO: 13224037, DATA_EMISSAO: "2026-08-02T03:00:00.000Z", VALOR_PAGO: -4.5, N_DOCUMENTO: "AV248488", OBS: "SANGRIA CANETA 4,50" },
        { LANCAMENTO: null },
      ],
    });
    expect(rows).toEqual([
      { erpLancamento: 13224037, day: "2026-08-02", amountCents: 450, document: "AV248488", note: "SANGRIA CANETA 4,50" },
    ]);
  });
});
