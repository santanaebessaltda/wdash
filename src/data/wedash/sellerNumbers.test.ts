import { describe, expect, it } from "vitest";
import type { SellerDay } from "@/data/wedash/engine/sellerHome";
import { sellerNumbers } from "./sellerNumbers";

const TODAY = "2026-10-04";

const dia = (day: string, revenue: number, sales: number, items: number | null, storeId = "s1"): SellerDay => ({
  storeId, day, revenue, sales, items,
});

describe("sellerNumbers", () => {
  it("Hoje não tem comparativo (AC 3)", () => {
    const n = sellerNumbers([dia(TODAY, 200, 2, 4)], { from: "2026-10-01", to: TODAY }, TODAY, "hoje");
    expect(n.faturamento).toEqual({ value: 200 });
    expect(n.vendas).toEqual({ value: 2 });
    expect(n.ticket.value).toBe(100);
    expect(n.pa.value).toBe(2);
    expect(n.faturamento.delta).toBeUndefined();
  });

  it("Mês compara com o mesmo recorte até ontem nos dois lados (AC 3)", () => {
    const days = [
      dia("2026-09-27", 100, 1, 2),
      dia("2026-09-29", 300, 3, 6),
      dia("2026-10-01", 400, 4, 8),
      dia("2026-10-03", 500, 5, 10),
      dia(TODAY, 900, 9, 18),
    ];
    const n = sellerNumbers(days, { from: "2026-10-01", to: TODAY }, TODAY, "mes");
    // Hoje fica de fora dos dois lados: 01 - 03/10 x os 4 dias anteriores ate 29/09.
    expect(n.faturamento.value).toBe(900);
    expect(n.faturamento.delta?.anterior).toBeTruthy();
    expect(n.vendas.value).toBe(9);
  });

  it("P.A. fica indisponível quando um dia com venda não tem itens (AC 4)", () => {
    const n = sellerNumbers(
      [dia("2026-10-01", 100, 1, 2), dia("2026-10-02", 200, 2, null)],
      { from: "2026-10-01", to: "2026-10-31" },
      TODAY,
      "mes",
    );
    expect(n.pa.value).toBeNull();
    expect(n.pa.delta).toBeUndefined();
    expect(n.faturamento.value).toBe(300);
  });

  it("sem vendas mostra zero e nenhum badge (AC 5)", () => {
    const n = sellerNumbers([], { from: "2026-10-01", to: TODAY }, TODAY, "mes");
    expect(n.faturamento).toEqual({ value: 0 });
    expect(n.vendas).toEqual({ value: 0 });
    expect(n.ticket).toEqual({ value: 0 });
    expect(n.pa).toEqual({ value: 0 });
  });

  it("soma as vendas de todas as lojas do vendedor (AC 6)", () => {
    const n = sellerNumbers(
      [dia("2026-10-02", 100, 1, 2, "s1"), dia("2026-10-02", 300, 3, 6, "s2")],
      { from: "2026-10-01", to: "2026-10-31" },
      TODAY,
      "mes",
    );
    expect(n.faturamento.value).toBe(400);
    expect(n.vendas.value).toBe(4);
    expect(n.pa.value).toBe(2);
  });

  it("período encerrado compara os dois lados inteiros", () => {
    const n = sellerNumbers(
      [dia("2026-09-01", 100, 1, 2), dia("2026-09-02", 200, 2, 4), dia("2026-08-30", 50, 1, 2)],
      { from: "2026-09-01", to: "2026-09-02" },
      TODAY,
      "mes",
    );
    expect(n.faturamento.value).toBe(300);
    expect(n.faturamento.delta).toBeDefined();
  });
});
