import { describe, expect, it } from "vitest";
import { queryStoreIds, sessionStoreIds } from "./stores";

const storeRows = [
  { id: "a", active: true },
  { id: "b", active: false },
  { id: "c", active: true },
];

describe("sessionStoreIds", () => {
  it("sem vínculo, o gestor vê só as lojas em operação", () => {
    expect(sessionStoreIds({ linkedIds: [], tenantStores: storeRows, role: "OWNER" })).toEqual(["a", "c"]);
  });

  it("gestor com vínculo antigo da primeira conta também vê a filial nova", () => {
    expect(sessionStoreIds({ linkedIds: ["a"], tenantStores: storeRows, role: "OWNER" })).toEqual(["a", "c"]);
    expect(sessionStoreIds({ linkedIds: ["a"], tenantStores: storeRows, role: "ADMIN_GLOBAL" })).toEqual(["a", "c"]);
  });

  it("vínculo com loja desativada não a devolve", () => {
    expect(sessionStoreIds({ linkedIds: ["a", "b"], tenantStores: storeRows, role: "MANAGER" })).toEqual(["a"]);
  });

  it("vendedor sem vínculo não ganha a rede", () => {
    expect(sessionStoreIds({ linkedIds: [], tenantStores: storeRows, role: "SELLER" })).toEqual([]);
  });

  it("gerente sem loja no seletor consulta só o vínculo", () => {
    expect(queryStoreIds("MANAGER", [], ["a", "c"])).toEqual(["a", "c"]);
    expect(queryStoreIds("MANAGER", ["a"], ["a", "c"])).toEqual(["a"]);
  });

  it("gerente sem vínculo não abre a rede", () => {
    expect(queryStoreIds("MANAGER", [], [])).toEqual(["00000000-0000-0000-0000-000000000000"]);
  });

  it("gestor com seletor vazio continua na rede", () => {
    expect(queryStoreIds("OWNER", [], ["a"])).toEqual([]);
    expect(queryStoreIds("ADMIN_GLOBAL", ["c"], ["a", "c"])).toEqual(["c"]);
  });

  it("todas desativadas deixam o seletor vazio", () => {
    expect(
      sessionStoreIds({
        linkedIds: [],
        tenantStores: storeRows.map((s) => ({ ...s, active: false })),
        role: "OWNER",
      }),
    ).toEqual([]);
  });
});
