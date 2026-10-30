import { describe, expect, it } from "vitest";
import { splitJarvisReply, typingDelayMs } from "./chatBlocks";

describe("splitJarvisReply", () => {
  it("respeita paragrafos com linha em branco", () => {
    expect(splitJarvisReply("Primeiro.\n\nSegundo?\n\nTerceiro!")).toEqual([
      "Primeiro.",
      "Segundo?",
      "Terceiro!",
    ]);
  });

  it("quebra paragrafo longo em frases", () => {
    const long =
      "Sugeri R$ 270.000,00 com base no histórico do mesmo mês e no mês recente. " +
      "No período tem Black Friday e feriados que puxam o alvo pra cima. " +
      "Quer que eu copie a configuração de outubro com escada e grupos?";
    const parts = splitJarvisReply(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(" ")).toContain("270.000");
    expect(parts.at(-1)).toMatch(/outubro/i);
  });

  it("nao quebra mensagem curta", () => {
    expect(splitJarvisReply("Beleza, descartei a meta.")).toEqual(["Beleza, descartei a meta."]);
  });
});

describe("typingDelayMs", () => {
  it("fica entre 280 e 900", () => {
    expect(typingDelayMs("oi")).toBeGreaterThanOrEqual(280);
    expect(typingDelayMs("x".repeat(500))).toBeLessThanOrEqual(900);
  });
});
