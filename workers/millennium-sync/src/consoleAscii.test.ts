import { describe, expect, it } from "vitest";
import { toAscii } from "./consoleAscii";

describe("toAscii", () => {
  it("tira acentos e troca símbolos por equivalentes ASCII", () => {
    expect(toAscii("Usuário ERP · sessão → nova…")).toBe("Usuario ERP | sessao -> nova...");
    expect(toAscii("OK Atualizar concluído · 2× Vendas")).toBe("OK Atualizar concluido | 2x Vendas");
    expect(toAscii("R$\u00a01.234,56")).toBe("R$ 1.234,56");
    expect(toAscii("emoji 🏆 fora")).toBe("emoji  fora");
  });
});
