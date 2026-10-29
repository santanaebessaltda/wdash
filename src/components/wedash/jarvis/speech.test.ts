import { describe, expect, it } from "vitest";
import { containsWakeWord, normalizeWakeText, stripWakeWord } from "./speech";

describe("wake word helpers", () => {
  it("detecta Ei JARVIS e variantes", () => {
    expect(containsWakeWord("Ei JARVIS")).toBe(true);
    expect(containsWakeWord("jarvis, como está a rede")).toBe(true);
    expect(containsWakeWord("olá jarvis")).toBe(true);
    expect(containsWakeWord("como está a meta")).toBe(false);
  });

  it("remove a wake word do comando", () => {
    expect(normalizeWakeText("Ei JARVIS")).toBe("ei jarvis");
    expect(stripWakeWord("Ei JARVIS, monta um desafio")).toMatch(/monta um desafio/i);
    expect(stripWakeWord("JARVIS")).toBe("JARVIS");
  });
});
