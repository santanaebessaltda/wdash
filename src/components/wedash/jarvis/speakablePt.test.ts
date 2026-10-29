import { describe, expect, it } from "vitest";
import { forSpeech, integerToPtBr, parsePtBrNumber } from "./speakablePt";

describe("integerToPtBr", () => {
  it("lê milhão e mil", () => {
    expect(integerToPtBr(1_192_475)).toBe(
      "um milhão, cento e noventa e dois mil e quatrocentos e setenta e cinco",
    );
    expect(integerToPtBr(9722)).toBe("nove mil e setecentos e vinte e dois");
    expect(integerToPtBr(1_000_000)).toBe("um milhão");
    expect(integerToPtBr(1000)).toBe("mil");
  });
});

describe("parsePtBrNumber", () => {
  it("entende ponto como milhar", () => {
    expect(parsePtBrNumber("1.192.475")).toBe(1_192_475);
    expect(parsePtBrNumber("9.722")).toBe(9722);
  });
});

describe("forSpeech", () => {
  it("expande reais e vendas", () => {
    const spoken = forSpeech(
      "Esse mês, você vendeu R$ 1.192.475, com 9.722 vendas.",
    );
    expect(spoken).toContain("um milhão");
    expect(spoken).toContain("reais");
    expect(spoken).toContain("nove mil");
    expect(spoken).not.toMatch(/R\$/);
    expect(spoken).not.toContain("1.192");
  });
});
