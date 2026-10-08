import { describe, expect, it } from "vitest";
import {
  ACCESS_LABEL,
  accessState,
  canManageStore,
  canTransition,
  hasSalesGroup,
  invitable,
  normalizeEmail,
  validEmail,
  type AccessState,
} from "./sellerAccess.ts";

describe("e-mail do convite", () => {
  it("is saved trimmed and in lowercase", () => {
    expect(normalizeEmail("  Ana.Silva@Loja.COM ")).toBe("ana.silva@loja.com");
  });

  it("refuses empty or malformed e-mails", () => {
    expect(validEmail("")).toBe(false);
    expect(validEmail("ana")).toBe(false);
    expect(validEmail("ana@loja")).toBe(false);
    expect(validEmail("ana silva@loja.com")).toBe(false);
    expect(validEmail("ana@loja.com")).toBe(true);
  });

  it("accepts up to 254 characters", () => {
    const at254 = `${"a".repeat(242)}@loja.com.br`;
    expect(at254).toHaveLength(254);
    expect(validEmail(at254)).toBe(true);
    expect(validEmail(`a${at254}`)).toBe(false);
  });
});

describe("canManageStore", () => {
  it("Gestor manages any store; Gerente only the linked stores (none linked = all); others never", () => {
    expect(canManageStore("OWNER", [], "s2")).toBe(true);
    expect(canManageStore("ADMIN_GLOBAL", ["s1"], "s2")).toBe(true);
    expect(canManageStore("MANAGER", ["s1"], "s1")).toBe(true);
    expect(canManageStore("MANAGER", ["s1"], "s2")).toBe(false);
    expect(canManageStore("MANAGER", [], "s2")).toBe(true);
    expect(canManageStore("SELLER", [], "s1")).toBe(false);
  });
});

describe("accessState", () => {
  it("maps the seller membership to Sem acesso / Convite pendente / Ativo / Suspenso", () => {
    expect(ACCESS_LABEL[accessState(null)]).toBe("Sem acesso");
    expect(ACCESS_LABEL[accessState({ status: "PENDING" })]).toBe("Convite pendente");
    expect(ACCESS_LABEL[accessState({ status: "ACTIVE" })]).toBe("Ativo");
    expect(ACCESS_LABEL[accessState({ status: "SUSPENDED" })]).toBe("Suspenso");
  });
});

describe("canTransition", () => {
  it("Sem acesso → Convite pendente → Ativo ⇄ Suspenso, and convite or acesso ativo volta a Sem acesso", () => {
    const states: AccessState[] = ["NONE", "PENDING", "ACTIVE", "SUSPENDED"];
    const allowed = states.flatMap((from) => states.filter((to) => canTransition(from, to)).map((to) => `${from}>${to}`));
    expect(allowed.sort()).toEqual([
      "ACTIVE>NONE",
      "ACTIVE>SUSPENDED",
      "NONE>PENDING",
      "PENDING>ACTIVE",
      "PENDING>NONE",
      "SUSPENDED>ACTIVE",
      "SUSPENDED>NONE",
    ]);
  });
});

describe("invitable", () => {
  it("only active people with cargo VENDEDOR still in the Millennium list", () => {
    expect(invitable({ active: true, inErp: true, erpRole: "VENDEDOR" })).toBe(true);
    expect(invitable({ active: false, inErp: true, erpRole: "INDEFINIDO" })).toBe(false);
    expect(invitable({ active: true, inErp: true, erpRole: "GERENCIA" })).toBe(false);
    expect(invitable({ active: true, inErp: false, erpRole: "VENDEDOR" })).toBe(false);
    expect(invitable({ active: true, inErp: true, erpRole: null })).toBe(true);
    expect(invitable({ active: true, inErp: true, erpRole: "" })).toBe(false);
  });
});

describe("hasSalesGroup", () => {
  it("requires a linked group before the invite", () => {
    expect(hasSalesGroup("shift-1")).toBe(true);
    expect(hasSalesGroup(null)).toBe(false);
    expect(hasSalesGroup(undefined)).toBe(false);
    expect(hasSalesGroup("")).toBe(false);
  });
});
