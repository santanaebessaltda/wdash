import { describe, expect, it } from "vitest";
import { sessionStoreIds } from "./stores";

const storeRows = [
  { id: "a", active: true },
  { id: "b", active: false },
  { id: "c", active: true },
];

describe("sessionStoreIds", () => {
  it("sem vínculo, o gestor vê só as lojas em operação", () => {
    expect(sessionStoreIds({ linkedIds: [], tenantStores: storeRows, role: "OWNER" })).toEqual(["a", "c"]);
  });

  it("vínculo com loja desativada não a devolve", () => {
    expect(sessionStoreIds({ linkedIds: ["a", "b"], tenantStores: storeRows, role: "MANAGER" })).toEqual(["a"]);
  });

  it("vendedor sem vínculo não ganha a rede", () => {
    expect(sessionStoreIds({ linkedIds: [], tenantStores: storeRows, role: "SELLER" })).toEqual([]);
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
