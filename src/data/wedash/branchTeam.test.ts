import { describe, expect, it } from "vitest";
import { branchRoleLabel, isActiveSalesPerson, isBranchTeamMember } from "./stores";

const person = (role: string | null, active = true) => ({ active, role });

describe("isBranchTeamMember", () => {
  it("lists vendedor, operador de caixa, gerência and a role not synced yet", () => {
    expect(isBranchTeamMember(person("VENDEDOR"))).toBe(true);
    expect(isBranchTeamMember(person("OPERADOR DE CAIXA"))).toBe(true);
    expect(isBranchTeamMember(person("GERENCIA"))).toBe(true);
    expect(isBranchTeamMember(person(null))).toBe(true);
  });

  it("keeps other roles and inactive people off the active list", () => {
    expect(isBranchTeamMember(person(""))).toBe(false);
    expect(isBranchTeamMember(person("INDEFINIDO"))).toBe(false);
    expect(isBranchTeamMember(person("VENDEDOR", false))).toBe(false);
    expect(isBranchTeamMember(person("OPERADOR DE CAIXA", false))).toBe(false);
  });

  it("does not put cashier or management into the sales ranking", () => {
    expect(isActiveSalesPerson(person("VENDEDOR"))).toBe(true);
    expect(isActiveSalesPerson(person(null))).toBe(true);
    expect(isActiveSalesPerson(person("GERENCIA"))).toBe(false);
    expect(isActiveSalesPerson(person("OPERADOR DE CAIXA"))).toBe(false);
  });
});

describe("branchRoleLabel", () => {
  it("names the three branch roles in Portuguese", () => {
    expect(branchRoleLabel("VENDEDOR")).toBe("Vendedor");
    expect(branchRoleLabel(null)).toBe("Vendedor");
    expect(branchRoleLabel("GERENCIA")).toBe("Gerente");
    expect(branchRoleLabel("OPERADOR DE CAIXA")).toBe("Operador de caixa");
    expect(branchRoleLabel("")).toBe("Sem cargo");
    expect(branchRoleLabel("INDEFINIDO")).toBe("Sem cargo");
  });
});
