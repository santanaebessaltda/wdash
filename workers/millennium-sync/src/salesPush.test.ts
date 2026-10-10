import { describe, expect, it } from "vitest";
import { formatSalesPush } from "./salesPush.ts";

describe("formatSalesPush", () => {
  it("soma só quem vendeu e omite loja sem venda nova", () => {
    const text = formatSalesPush([
      { name: "CENTRO", deltaCents: 80000 },
      { name: "SHOPPING", deltaCents: 0 },
      { name: "RUA", deltaCents: 44000 },
    ]);
    expect(text?.title.replaceAll("\u00a0", " ")).toBe("Vendas · R$ 1.240,00");
    expect(text?.body.replaceAll("\u00a0", " ")).toBe("Últimos 30 min\nCENTRO · R$ 800,00\nRUA · R$ 440,00");
  });

  it("não avisa quando o intervalo não teve venda", () => {
    expect(formatSalesPush([{ name: "CENTRO", deltaCents: 0 }])).toBeNull();
  });
});
