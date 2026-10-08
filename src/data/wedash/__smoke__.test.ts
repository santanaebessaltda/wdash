import { describe, expect, it } from "vitest";
import { goalOfStore } from "./goals";

// Smoke test provando que o runner Vitest resolve o alias `@` e importa modulos de dominio.
describe("smoke", () => {
  it("lê uma meta mockada da camada de domínio", () => {
    const meta = goalOfStore("f1", "2026-09");
    expect(meta?.valorLoja).toBe(170000);
  });
});