import { describe, expect, it } from "vitest";
import { cieloEstablishment, parseCieloEdi } from "./cieloEdi";

function line(length: number, fields: Array<[number, string]>): string {
  const chars = Array.from({ length }, () => " ");
  for (const [start, value] of fields) {
    for (let i = 0; i < value.length; i++) chars[start - 1 + i] = value[i]!;
  }
  return chars.join("");
}

describe("parseCieloEdi", () => {
  it("separa crédito e débito da captura e ignora rejeitada e cancelamento", () => {
    const credit = line(600, [
      [1, "E"],
      [2, "0000001234"],
      [28, "02"],
      [130, "TX123"],
      [164, "N"],
      [247, "+"],
      [248, "0000000015000"],
      [471, "143015"],
      [496, "VENDA1"],
      [574, "15102026"],
    ]);
    const debit = line(600, [
      [1, "E"],
      [2, "0000001234"],
      [28, "01"],
      [130, "TX124"],
      [164, "N"],
      [247, "+"],
      [248, "0000000002500"],
      [471, "090000"],
      [496, "VENDA2"],
      [574, "15102026"],
    ]);
    const rejected = line(600, [
      [1, "E"],
      [2, "0000001234"],
      [28, "02"],
      [164, "S"],
      [247, "+"],
      [248, "0000000099999"],
      [496, "VENDA3"],
      [574, "15102026"],
    ]);
    const cancel = line(600, [
      [1, "E"],
      [2, "0000001234"],
      [28, "06"],
      [164, "N"],
      [247, "-"],
      [248, "0000000001000"],
      [496, "VENDA4"],
      [574, "15102026"],
    ]);
    const { cards, pix } = parseCieloEdi([credit, debit, rejected, cancel].join("\n"));
    expect(pix).toEqual([]);
    expect(cards).toEqual([
      expect.objectContaining({
        establishment: "0000001234",
        day: "2026-10-15",
        paymentMethod: "Cartão de crédito",
        capturedCents: 15000,
        occurredAt: "2026-10-15T14:30:15-03:00",
      }),
      expect.objectContaining({
        paymentMethod: "Cartão de débito",
        capturedCents: 2500,
      }),
    ]);
  });

  it("lê o Pix pelo estabelecimento e pelo sinal", () => {
    const sale = line(120, [
      [1, "8"],
      [2, "0000005678"],
      [12, "01"],
      [14, "261015"],
      [20, "101500"],
      [26, "E123456789012345678901234567890123456"],
      [74, "+"],
      [75, "0000000004800"],
    ]);
    const debit = line(120, [
      [1, "8"],
      [2, "0000005678"],
      [12, "03"],
      [14, "261015"],
      [20, "111500"],
      [26, "AJUSTEPIX00000000000000000000000001"],
      [74, "-"],
      [75, "0000000000500"],
    ]);
    const { cards, pix } = parseCieloEdi(`${sale}\n${debit}`);
    expect(cards).toEqual([]);
    expect(pix).toEqual([
      expect.objectContaining({ establishment: "0000005678", day: "2026-10-15", paidCents: 4800 }),
      expect.objectContaining({ paidCents: -500 }),
    ]);
  });

  it("normaliza o estabelecimento com zeros à esquerda", () => {
    expect(cieloEstablishment("1234")).toBe("0000001234");
    expect(cieloEstablishment("")).toBe("");
  });
});
