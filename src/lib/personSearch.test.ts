import { describe, expect, it } from "vitest";
import { matchesCodeOrName } from "./personSearch";

describe("matchesCodeOrName", () => {
  it("matches the name or the millennium code, with or without leading zeros", () => {
    expect(matchesCodeOrName("Ana Souza", "0010", "")).toBe(true);
    expect(matchesCodeOrName("Ana Souza", "0010", "souza")).toBe(true);
    expect(matchesCodeOrName("Ana Souza", "0010", "0010")).toBe(true);
    expect(matchesCodeOrName("Ana Souza", "0010", "10")).toBe(true);
    expect(matchesCodeOrName("Ana Souza", "0010", "99")).toBe(false);
    expect(matchesCodeOrName("Ana Souza", null, "10")).toBe(false);
  });
});
