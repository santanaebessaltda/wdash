import { describe, expect, it } from "vitest";
import {
  isTopbarNetworkScope,
  matchStoresInText,
  needsStorePickForWrite,
  resolveStoresInQuestion,
  speakAskWriteStore,
  type JarvisContext,
  type JarvisStoreRef,
} from "./context";

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

describe("isTopbarNetworkScope / needsStorePickForWrite", () => {
  it("vazio ou lista completa = rede", () => {
    expect(isTopbarNetworkScope([], ["a", "b"])).toBe(true);
    expect(isTopbarNetworkScope(["a", "b"], ["a", "b"])).toBe(true);
    expect(isTopbarNetworkScope(["a"], ["a", "b"])).toBe(false);
    expect(isTopbarNetworkScope([], ["a"])).toBe(false);
  });

  it("escrita pede filial quando ha mais de uma no escopo", () => {
    const multi: JarvisContext = {
      tenantId: "t",
      membershipId: "m1",
      storeIds: [],
      stores: [sb, centro],
      network: [sb, centro],
      today: "2026-10-29",
      managerFirstName: "Romeu",
    };
    expect(needsStorePickForWrite(multi)).toBe(true);
    expect(speakAskWriteStore(multi, "meta")).toMatch(/todas as lojas/i);
    expect(speakAskWriteStore(multi, "meta")).toMatch(/filial/i);

    const one: JarvisContext = {
      ...multi,
      storeIds: ["centro"],
      stores: [centro],
    };
    expect(needsStorePickForWrite(one)).toBe(false);
  });
});

describe("resolveStoresInQuestion", () => {
  it("acha SB na rede mesmo com Topbar so na CENTRO", () => {
    const ctx: JarvisContext = {
      tenantId: "t",
      membershipId: "m1",
      storeIds: ["centro"],
      stores: [centro],
      network: [sb, centro],
      today: "2026-10-29",
      managerFirstName: "Romeu",
    };
    expect(resolveStoresInQuestion("meta de outubro da SB EMPREENDIMENTOS", ctx).map((s) => s.id)).toEqual([
      "sb",
    ]);
  });

  it("sem nome no texto usa o escopo da Topbar", () => {
    const ctx: JarvisContext = {
      tenantId: "t",
      membershipId: "m1",
      storeIds: ["centro"],
      stores: [centro],
      network: [sb, centro],
      today: "2026-10-29",
      managerFirstName: "Romeu",
    };
    expect(resolveStoresInQuestion("qual a meta de outubro?", ctx).map((s) => s.id)).toEqual(["centro"]);
  });
});
