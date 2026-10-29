import { describe, expect, it } from "vitest";
import { classifyIntent, jarvisReply } from "./respond";

describe("classifyIntent", () => {
  it("reconhece cumprimento", () => {
    expect(classifyIntent("Oi JARVIS")).toBe("greeting");
  });

  it("reconhece desafio, meta, escala e navegação", () => {
    expect(classifyIntent("Quero criar um desafio de body splash")).toBe("challenge");
    expect(classifyIntent("Vamos montar a meta de março")).toBe("goal");
    expect(classifyIntent("Gerar a escala de novembro 6x1")).toBe("schedule");
    expect(classifyIntent("Abre a Visão geral")).toBe("navigate");
  });

  it("reconhece estoque e vendas", () => {
    expect(classifyIntent("Tem produto parado no estoque?")).toBe("analyze_stock");
    expect(classifyIntent("Como está o faturamento da rede?")).toBe("analyze_sales");
  });

  it("reconhece autorização sem rascunho", () => {
    expect(classifyIntent("Autorizo")).toBe("authorize");
  });
});

describe("jarvisReply", () => {
  it("menciona autorização no desafio", () => {
    const text = jarvisReply("Quero montar um desafio");
    expect(text.toLowerCase()).toMatch(/autoriz/);
  });

  it("não inventa número de faturamento", () => {
    const text = jarvisReply("Qual o faturamento de hoje?");
    expect(text).not.toMatch(/R\$\s*\d/);
  });
});
