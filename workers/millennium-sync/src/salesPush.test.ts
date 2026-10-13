import { describe, expect, it } from "vitest";
import { formatCashClosePush } from "./cashClosePush.ts";
import { formatStoreGoalPush, goalLevel } from "./goalPush.ts";
import { formatSalesPush } from "./salesPush.ts";

const plain = (value: string | undefined) => value?.replaceAll("\u00a0", " ");

describe("formatSalesPush", () => {
  it("uma filial: o intervalo no título e o dia no fim da linha", () => {
    const text = formatSalesPush([{ name: "LOJAWEPINK.CENTRO.CAMPOGRANDE", deltaCents: 80000, todayCents: 345000 }]);
    expect(plain(text?.title)).toBe("Vendas · +R$ 800,00");
    expect(plain(text?.body)).toBe("LOJAWEPINK.CENTRO.CAMPOGRANDE · R$ 3.450,00 hoje");
  });

  it("várias filiais: hoje da rede e cada filial, da que mais vendeu no dia para a que menos vendeu", () => {
    const text = formatSalesPush([
      { name: "QUIOSQUESHOPPINGTRESLAGOAS", deltaCents: 35840, todayCents: 167660 },
      { name: "SB EMPREENDIMENTOS", deltaCents: 80400, todayCents: 312400 },
      { name: "LOJAWEPINK.CENTRO.CAMPOGRANDE", deltaCents: 318270, todayCents: 1926500 },
      { name: "QUIOSQUESHOPPINGNORTESULPLAZA", deltaCents: 54040, todayCents: 211500 },
    ]);
    expect(plain(text?.title)).toBe("Vendas · +R$ 4.885,50");
    expect(plain(text?.body)).toBe(
      [
        "Hoje · R$ 26.180,60",
        "LOJAWEPINK.CENTRO.CAMPOGRANDE · +R$ 3.182,70 · R$ 19.265,00",
        "SB EMPREENDIMENTOS · +R$ 804,00 · R$ 3.124,00",
        "QUIOSQUESHOPPINGNORTESULPLAZA · +R$ 540,40 · R$ 2.115,00",
        "QUIOSQUESHOPPINGTRESLAGOAS · +R$ 358,40 · R$ 1.676,60",
      ].join("\n"),
    );
  });

  it("filial sem venda no intervalo continua na lista, no lugar do acumulado do dia", () => {
    const text = formatSalesPush([
      { name: "CENTRO", deltaCents: 50000, todayCents: 250000 },
      { name: "RUA", deltaCents: 0, todayCents: 300000 },
      { name: "SHOPPING", deltaCents: 0, todayCents: 235000 },
    ]);
    expect(plain(text?.title)).toBe("Vendas · +R$ 500,00");
    expect(plain(text?.body)).toBe(
      [
        "Hoje · R$ 7.850,00",
        "RUA · R$ 0,00 · R$ 3.000,00",
        "CENTRO · +R$ 500,00 · R$ 2.500,00",
        "SHOPPING · R$ 0,00 · R$ 2.350,00",
      ].join("\n"),
    );
  });

  it("sem venda nova ainda mostra a posição do dia", () => {
    const text = formatSalesPush([
      { name: "SB EMPREENDIMENTOS", deltaCents: 0, todayCents: 312400 },
      { name: "LOJAWEPINK.CENTRO.CAMPO.GRANDE", deltaCents: 0, todayCents: 1926500 },
    ]);
    expect(plain(text?.title)).toBe("Sem vendas nos últimos 30 min");
    expect(plain(text?.body)).toBe("Hoje · R$ 22.389,00\nLOJAWEPINK.CENTRO.CAMPO.GRANDE · R$ 19.265,00\nSB EMPREENDIMENTOS · R$ 3.124,00");
  });

  it("uma filial sem venda nova não repete o dia em duas linhas", () => {
    const text = formatSalesPush([{ name: "CENTRO", deltaCents: 0, todayCents: 200000 }]);
    expect(plain(text?.title)).toBe("Sem vendas nos últimos 30 min");
    expect(plain(text?.body)).toBe("CENTRO · R$ 2.000,00 hoje");
  });

  it("sem filial no acesso não há texto", () => {
    expect(formatSalesPush([])).toBeNull();
  });
});

describe("outros avisos", () => {
  it("fechamento separa falta, sobra e dia sem total real", () => {
    const text = formatCashClosePush("2026-10-09", [
      { name: "CENTRO", diffCents: -1500 },
      { name: "SHOPPING", diffCents: null },
    ]);
    expect(text?.title).toBe("Fechamento · 09/10");
    expect(text?.body.replaceAll("\u00a0", " ")).toBe("CENTRO · faltou R$ 15,00\nSHOPPING · sem total real");
  });

  it("quando cabe, o fechamento mantém a ordem do acesso", () => {
    const text = formatCashClosePush("2026-10-09", [
      { name: "SB EMPREENDIMENTOS", diffCents: 0 },
      { name: "LOJAWEPINK.CENTRO.CAMPOGRANDE", diffCents: -20000 },
    ]);
    expect(text?.body.replaceAll("\u00a0", " ")).toBe(
      "SB EMPREENDIMENTOS · sem diferença\nLOJAWEPINK.CENTRO.CAMPOGRANDE · faltou R$ 200,00",
    );
  });

  it("quando não cabe, o fechamento mostra primeiro o que pede atenção", () => {
    const quiet = (letter: string) => ({ name: letter.repeat(40), diffCents: 0 });
    const text = formatCashClosePush("2026-10-09", [
      quiet("A"),
      quiet("B"),
      quiet("C"),
      quiet("D"),
      { name: "CENTRO", diffCents: -20000 },
      { name: "RUA", diffCents: null },
    ]);
    const body = text?.body.replaceAll("\u00a0", " ") ?? "";
    const lines = body.split("\n");
    expect(lines[0]).toBe("CENTRO · faltou R$ 200,00");
    expect(lines[1]).toBe("RUA · sem total real");
    expect(lines[2]?.startsWith("A".repeat(40))).toBe(true);
    expect(body.includes("C".repeat(40))).toBe(false);
    expect(lines.at(-1)).toBe("e mais 2 filiais");
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
