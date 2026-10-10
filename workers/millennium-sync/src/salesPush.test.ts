import { describe, expect, it } from "vitest";
import { formatCashClosePush } from "./cashClosePush.ts";
import { formatStoreGoalPush, goalLevel } from "./goalPush.ts";
import { formatQuietSalesPush, formatSalesPush } from "./salesPush.ts";

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

describe("outros avisos", () => {
  it("período sem venda tem texto fixo", () => {
    expect(formatQuietSalesPush()).toEqual({ title: "Vendas", body: "Sem vendas nos últimos 30 min" });
  });

  it("fechamento separa falta, sobra e dia sem total real", () => {
    const text = formatCashClosePush("2026-10-09", [
      { name: "CENTRO", diffCents: -1500 },
      { name: "SHOPPING", diffCents: null },
    ]);
    expect(text?.body.replaceAll("\u00a0", " ")).toBe("09/10\nCENTRO · faltou R$ 15,00\nSHOPPING · sem total real");
  });

  it("nível da meta só sobe na ordem dos percentuais", () => {
    expect(goalLevel(79, [{ minPct: 80, name: "Prata" }, { minPct: 100, name: "Ouro" }]).level).toBe(0);
    expect(goalLevel(100, [{ minPct: 100, name: "Ouro" }, { minPct: 80, name: "Prata" }])).toEqual({ level: 2, name: "Ouro" });
  });

  it("resumo de meta lista a loja uma vez", () => {
    expect(formatStoreGoalPush([{ storeName: "CENTRO", goalName: "Outubro", levelName: "Prata" }])?.body).toBe(
      "CENTRO · Outubro · Prata",
    );
  });
});
