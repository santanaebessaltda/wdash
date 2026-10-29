import { describe, expect, it } from "vitest";
import { dayGreeting, firstNameFrom } from "./greeting";

describe("dayGreeting", () => {
  it("usa faixa de horário", () => {
    expect(dayGreeting(new Date("2026-10-29T08:00:00"))).toBe("BOM DIA");
    expect(dayGreeting(new Date("2026-10-29T15:00:00"))).toBe("BOA TARDE");
    expect(dayGreeting(new Date("2026-10-29T21:00:00"))).toBe("BOA NOITE");
  });
});

describe("firstNameFrom", () => {
  it("pega o primeiro nome", () => {
    expect(firstNameFrom("Romeu Fernandes")).toBe("Romeu");
    expect(firstNameFrom("")).toBe("Gestor");
  });
});
