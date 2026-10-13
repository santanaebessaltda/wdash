import { describe, expect, it } from "vitest";
import { bearerMatches, seedCookieJar } from "./allosAuth";

describe("bearerMatches", () => {
  it("accepts only the exact bearer token", () => {
    expect(bearerMatches("Bearer segredo", "segredo")).toBe(true);
    expect(bearerMatches("Bearer outro", "segredo")).toBe(false);
    expect(bearerMatches("segredo", "segredo")).toBe(false);
    expect(bearerMatches(undefined, "segredo")).toBe(false);
    expect(bearerMatches("Bearer segredo", "")).toBe(false);
  });
});

describe("seedCookieJar", () => {
  it("keeps the browser session cookies, including values with extra equals", () => {
    expect(seedCookieJar("ASPSESSIONID=ABC; cf_clearance=a.b=c")).toEqual(
      new Map([
        ["ASPSESSIONID", "ABC"],
        ["cf_clearance", "a.b=c"],
      ]),
    );
  });
});
