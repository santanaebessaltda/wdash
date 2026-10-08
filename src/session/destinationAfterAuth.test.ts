import { describe, expect, it } from "vitest";
import { paths } from "@/router/paths";
import type { Session } from "./session";
import { destinationAfterAuth } from "./authApi";

function session(role: Session["role"]): Session {
  return {
    membershipId: "m1",
    name: "Ana",
    cpf: "",
    email: "ana@example.com",
    avatarUrl: null,
    role,
    isOwner: role === "OWNER",
    stores: ["s1"],
    collaboratorId: null,
    onboardingStep: null,
    temporaryPassword: false,
    tenantId: "t1",
    companyName: "EMPRESA",
    appInstalled: false,
  };
}

describe("destinationAfterAuth", () => {
  it("opens Visão geral even when the previous screen was Editar meta", () => {
    expect(destinationAfterAuth(session("OWNER"), "/goals/meta-1/edit")).toBe(paths.overview);
    expect(destinationAfterAuth(session("MANAGER"), paths.seller.home)).toBe(paths.overview);
  });

  it("keeps the seller on Início", () => {
    expect(destinationAfterAuth(session("SELLER"), paths.seller.home)).toBe(paths.seller.home);
    expect(destinationAfterAuth(session("SELLER"))).toBe(paths.seller.home);
  });

  it("opens Visão geral for a gestor without a previous screen", () => {
    expect(destinationAfterAuth(session("OWNER"))).toBe(paths.overview);
  });
});
