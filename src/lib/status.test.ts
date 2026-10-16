import { describe, expect, it } from "vitest";
import { statusBadgeVariant } from "./status";

describe("statusBadgeVariant", () => {
  it("uses one color for the same status on every screen", () => {
    expect(statusBadgeVariant("Ativo")).toBe("success");
    expect(statusBadgeVariant("Em andamento")).toBe("success");
    expect(statusBadgeVariant("Pendente")).toBe("warning");
    expect(statusBadgeVariant("Convite pendente")).toBe("warning");
    expect(statusBadgeVariant("Suspenso")).toBe("danger");
    expect(statusBadgeVariant("Desligado")).toBe("neutral");
    expect(statusBadgeVariant("Desativada")).toBe("neutral");
    expect(statusBadgeVariant("A começar")).toBe("info");
    expect(statusBadgeVariant("Em aberto")).toBe("accent");
  });
});
