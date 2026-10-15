import { describe, expect, it } from "vitest";
import { branchRoleLabel, isActiveSalesPerson, isBranchSalesPerson, isBranchTeamMember, isBranchUser, teamRoleLabel } from "./stores";

const campoGrande = { branchCode: "00386", millenniumBranch: 386 };

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

describe("isBranchUser", () => {
  it("matches the branch code with or without leading zeros", () => {
    expect(isBranchUser("386", campoGrande)).toBe(true);
    expect(isBranchUser("00386", campoGrande)).toBe(true);
    expect(isBranchUser("0386", campoGrande)).toBe(true);
    expect(isBranchUser("387", campoGrande)).toBe(false);
    expect(isBranchUser(null, campoGrande)).toBe(false);
    expect(isBranchUser("0", campoGrande)).toBe(false);
  });

  it("matches the filial id when the display code has no digits", () => {
    expect(isBranchUser("386", { branchCode: "CENTRO", millenniumBranch: 386 })).toBe(true);
  });

  it("keeps the branch user on the team and out of the sales columns", () => {
    const user = { active: true, role: "VENDEDOR", code: "386" };
    expect(isBranchTeamMember(user, campoGrande)).toBe(true);
    expect(isBranchSalesPerson(user, campoGrande)).toBe(false);
    expect(isActiveSalesPerson(user)).toBe(true);
    expect(isBranchTeamMember({ active: true, role: "OUTRO", code: "386" }, campoGrande)).toBe(true);
    expect(isBranchTeamMember({ active: true, role: "OUTRO", code: "386" })).toBe(false);
  });
});

describe("teamRoleLabel", () => {
  it("names the person with the branch code as Usuário da filial", () => {
    expect(teamRoleLabel({ role: "GERENCIA", code: "386" }, campoGrande)).toBe("Usuário da filial");
    expect(teamRoleLabel({ role: "VENDEDOR", code: "00386" }, campoGrande)).toBe("Usuário da filial");
    expect(teamRoleLabel({ role: "GERENCIA", code: "999" }, campoGrande)).toBe("Gerente");
    expect(teamRoleLabel({ role: "VENDEDOR", code: "10" }, campoGrande)).toBe("Vendedor");
    expect(teamRoleLabel({ role: "OPERADOR DE CAIXA", code: "665" }, campoGrande)).toBe("Operador de caixa");
  });
});
