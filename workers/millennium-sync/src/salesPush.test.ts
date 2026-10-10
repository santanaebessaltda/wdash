import { describe, expect, it } from "vitest";
import { formatCashClosePush } from "./cashClosePush.ts";
import { formatStoreGoalPush, goalLevel } from "./goalPush.ts";
import { formatQuietSalesPush, formatSalesPush } from "./salesPush.ts";

const plain = (value: string | undefined) => value?.replaceAll("\u00a0", " ");

describe("formatSalesPush", () => {
  it("acesso com uma loja: o intervalo no título e o dia da loja no texto", () => {
    const text = formatSalesPush([{ name: "CENTRO", deltaCents: 50000, todayCents: 200000 }]);
    expect(plain(text?.title)).toBe("R$ 500,00 nos últimos 30 min");
    expect(plain(text?.body)).toBe("CENTRO · hoje R$ 2.000,00");
  });

  it("várias lojas e só uma vendeu agora: o dia da rede no título e só essa loja na lista", () => {
    const text = formatSalesPush([
      { name: "CENTRO", deltaCents: 50000, todayCents: 250000 },
      { name: "RUA", deltaCents: 0, todayCents: 300000 },
      { name: "SHOPPING", deltaCents: 0, todayCents: 235000 },
    ]);
    expect(plain(text?.title)).toBe("R$ 500,00 nos últimos 30 min · hoje R$ 7.850,00");
    expect(plain(text?.body)).toBe("CENTRO · R$ 500,00 · hoje R$ 2.500,00");
  });

  it("várias lojas: título da rede e uma linha por loja que vendeu, da maior para a menor", () => {
    const text = formatSalesPush([
      { name: "CENTRO", deltaCents: 80000, todayCents: 320000 },
      { name: "SHOPPING", deltaCents: 0, todayCents: 340000 },
      { name: "RUA", deltaCents: 44000, todayCents: 215000 },
    ]);
    expect(plain(text?.title)).toBe("R$ 1.240,00 nos últimos 30 min · hoje R$ 8.750,00");
    expect(plain(text?.body)).toBe("CENTRO · R$ 800,00 · hoje R$ 3.200,00\nRUA · R$ 440,00 · hoje R$ 2.150,00");
  });

  it("lista todas as lojas que venderam, sem cortar", () => {
    const text = formatSalesPush([
      { name: "CENTRO", deltaCents: 80000, todayCents: 80000 },
      { name: "RUA", deltaCents: 64000, todayCents: 64000 },
      { name: "SHOPPING", deltaCents: 40000, todayCents: 40000 },
      { name: "NORTE", deltaCents: 32000, todayCents: 32000 },
      { name: "SUL", deltaCents: 32000, todayCents: 32000 },
    ]);
    expect(plain(text?.title)).toBe("R$ 2.480,00 nos últimos 30 min · hoje R$ 2.480,00");
    expect(plain(text?.body)).toBe(
      "CENTRO · R$ 800,00 · hoje R$ 800,00\nRUA · R$ 640,00 · hoje R$ 640,00\nSHOPPING · R$ 400,00 · hoje R$ 400,00\nNORTE · R$ 320,00 · hoje R$ 320,00\nSUL · R$ 320,00 · hoje R$ 320,00",
    );
  });

  it("uma loja sem venda nova ainda mostra o dia dela", () => {
    const text = formatSalesPush([{ name: "CENTRO", deltaCents: 0, todayCents: 200000 }]);
    expect(plain(text?.title)).toBe("R$ 0,00 nos últimos 30 min");
    expect(plain(text?.body)).toBe("CENTRO · hoje R$ 2.000,00");
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
