import { describe, expect, it } from "vitest";
import { matchStoresInText, resolveStoresInQuestion, type JarvisContext, type JarvisStoreRef } from "./context";

const sb: JarvisStoreRef = {
  id: "sb",
  name: "SB EMPREENDIMENTOS",
  tradeName: "SB EMPREENDIMENTOS",
  code: "00010",
};
const centro: JarvisStoreRef = {
  id: "centro",
  name: "LOJAWEPINK.CENTRO.CAMPOGRANDE",
  tradeName: "LOJAWEPINK.CENTRO.CAMPOGRANDE",
  code: "00386",
};

describe("matchStoresInText", () => {
  it("casa SB pelo nome completo", () => {
    expect(
      matchStoresInText("mesma configuração de Outubro da filial SB EMPREENDIMENTOS", [sb, centro]).map(
        (s) => s.id,
      ),
    ).toEqual(["sb"]);
  });

  it("nao casa a palavra generica loja sozinha", () => {
    expect(matchStoresInText("quero meta da loja", [sb, centro])).toEqual([]);
  });

  it("pra Loja aponta a unica filial LOJA…", () => {
    expect(
      matchStoresInText("aqui pra Loja, meta individual", [sb, centro]).map((s) => s.id),
    ).toEqual(["centro"]);
  });

  it("cita as duas quando SB e Loja entram no pedido", () => {
    const hit = matchStoresInText(
      "mesma configuração de Outubro da filial SB EMPREENDIMENTOS porém aqui pra Loja",
      [sb, centro],
    ).map((s) => s.id);
    expect(hit).toContain("sb");
    expect(hit).toContain("centro");
  });
});

describe("resolveStoresInQuestion", () => {
  it("acha SB na rede mesmo com Topbar so na CENTRO", () => {
    const ctx: JarvisContext = {
      tenantId: "t",
      storeIds: ["centro"],
      stores: [centro],
      network: [sb, centro],
      today: "2026-10-29",
    };
    expect(resolveStoresInQuestion("meta de outubro da SB EMPREENDIMENTOS", ctx).map((s) => s.id)).toEqual([
      "sb",
    ]);
  });

  it("sem nome no texto usa o escopo da Topbar", () => {
    const ctx: JarvisContext = {
      tenantId: "t",
      storeIds: ["centro"],
      stores: [centro],
      network: [sb, centro],
      today: "2026-10-29",
    };
    expect(resolveStoresInQuestion("qual a meta de outubro?", ctx).map((s) => s.id)).toEqual(["centro"]);
  });
});
