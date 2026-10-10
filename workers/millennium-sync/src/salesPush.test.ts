import { describe, expect, it } from "vitest";
import { formatCashClosePush } from "./cashClosePush.ts";
import { formatStoreGoalPush, goalLevel } from "./goalPush.ts";
import { formatQuietSalesPush, formatSalesPush } from "./salesPush.ts";

const plain = (value: string | undefined) => value?.replaceAll("\u00a0", " ");

describe("formatSalesPush", () => {
  it("acesso com uma loja mostra o acumulado de hoje", () => {
    const text = formatSalesPush([{ name: "CENTRO", deltaCents: 50000, todayCents: 200000 }]);
    expect(plain(text?.title)).toBe("R$ 500,00 nos últimos 30 min");
    expect(plain(text?.body)).toBe("CENTRO · R$ 2.000,00 hoje");
  });

  it("várias lojas e só uma vendeu agora: o dia de cada loja, da maior para a menor", () => {
    const text = formatSalesPush([
      { name: "CENTRO", deltaCents: 50000, todayCents: 250000 },
      { name: "RUA", deltaCents: 0, todayCents: 300000 },
      { name: "SHOPPING", deltaCents: 0, todayCents: 235000 },
    ]);
    expect(plain(text?.title)).toBe("R$ 500,00 nos últimos 30 min");
    expect(plain(text?.body)).toBe("Hoje nas suas lojas · R$ 7.850,00\nRUA · R$ 3.000,00\nCENTRO · R$ 2.500,00\nSHOPPING · R$ 2.350,00");
  });

  it("várias lojas: o dia primeiro e o acumulado de cada uma, inclusive a que não vendeu agora", () => {
    const text = formatSalesPush([
      { name: "CENTRO", deltaCents: 80000, todayCents: 400000 },
      { name: "SHOPPING", deltaCents: 0, todayCents: 200000 },
      { name: "RUA", deltaCents: 44000, todayCents: 275000 },
    ]);
    expect(plain(text?.title)).toBe("R$ 1.240,00 nos últimos 30 min");
    expect(plain(text?.body)).toBe("Hoje nas suas lojas · R$ 8.750,00\nCENTRO · R$ 4.000,00\nRUA · R$ 2.750,00\nSHOPPING · R$ 2.000,00");
  });

  it("corta a lista e diz quantas lojas ficaram de fora", () => {
    const name = (label: string) => label.padEnd(40, "X");
    const text = formatSalesPush([
      { name: name("CENTRO"), deltaCents: 80000, todayCents: 80000 },
      { name: name("RUA"), deltaCents: 64000, todayCents: 64000 },
      { name: name("SHOPPING"), deltaCents: 40000, todayCents: 40000 },
      { name: name("NORTE"), deltaCents: 32000, todayCents: 32000 },
      { name: name("SUL"), deltaCents: 32000, todayCents: 32000 },
    ]);
    expect(plain(text?.title)).toBe("R$ 2.480,00 nos últimos 30 min");
    expect(plain(text?.body)).toBe(
      `Hoje nas suas lojas · R$ 2.480,00\n${name("CENTRO")} · R$ 800,00\n${name("RUA")} · R$ 640,00\ne mais 3 lojas`,
    );
  });

  it("sem venda nova ainda resume cada loja", () => {
    const text = formatSalesPush([{ name: "CENTRO", deltaCents: 0, todayCents: 200000 }]);
    expect(plain(text?.title)).toBe("Sem vendas nos últimos 30 min");
    expect(plain(text?.body)).toBe("CENTRO · R$ 2.000,00 hoje");
  });

  it("sem loja não há texto", () => {
    expect(formatSalesPush([])).toBeNull();
  });
});

describe("outros avisos", () => {
  it("período sem venda tem texto fixo", () => {
    expect(formatQuietSalesPush()).toEqual({
      title: "Sem vendas nos últimos 30 min",
      body: "Nenhuma nova venda registrada no período.",
    });
  });

  it("fechamento separa falta, sobra e dia sem total real", () => {
    const text = formatCashClosePush("2026-10-09", [
      { name: "CENTRO", diffCents: -1500 },
      { name: "SHOPPING", diffCents: null },
    ]);
    expect(text?.title).toBe("Fechamento · 09/10");
    expect(text?.body.replaceAll("\u00a0", " ")).toBe("CENTRO · faltou R$ 15,00\nSHOPPING · sem total real");
  });

  it("nível da meta só sobe na ordem dos percentuais", () => {
    expect(goalLevel(79, [{ minPct: 80, name: "Prata" }, { minPct: 100, name: "Ouro" }]).level).toBe(0);
    expect(goalLevel(100, [{ minPct: 100, name: "Ouro" }, { minPct: 80, name: "Prata" }])).toEqual({ level: 2, name: "Ouro" });
  });

  it("meta de uma loja entrega a conquista no título", () => {
    expect(formatStoreGoalPush([{ storeName: "CENTRO", goalName: "Outubro", levelName: "Prata" }])).toEqual({
      title: "CENTRO chegou ao Prata ✨",
      body: "Novo nível da meta de Outubro.",
    });
  });

  it("várias metas listam loja e nível", () => {
    expect(
      formatStoreGoalPush([
        { storeName: "CENTRO", goalName: "Outubro", levelName: "Prata" },
        { storeName: "RUA", goalName: "Outubro", levelName: "Ouro" },
      ]),
    ).toEqual({
      title: "2 lojas avançaram de nível ✨",
      body: "CENTRO · Prata\nRUA · Ouro",
    });
  });
});
