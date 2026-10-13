import { describe, expect, it } from "vitest";
import { goalOfStore } from "./goals";

// Smoke test provando que o runner Vitest resolve o alias `@` e importa modulos de dominio.
describe("smoke", () => {
  it("lê uma meta mockada da camada de domínio", () => {
    const goal = goalOfStore("f1", "2026-09");
    expect(goal?.storeAmount).toBe(170000);
  });
});