import { describe, expect, it } from "vitest";
import { openMonthThrough, shouldRefreshOpenMonthSellers } from "./sellerMonthRefresh.ts";

describe("shouldRefreshOpenMonthSellers", () => {
  it("só com a marca explícita", () => {
    expect(shouldRefreshOpenMonthSellers({ payload: { refreshMonthSellers: true } })).toBe(true);
    expect(shouldRefreshOpenMonthSellers({ payload: {} })).toBe(false);
    expect(shouldRefreshOpenMonthSellers({})).toBe(false);
  });
});

describe("openMonthThrough", () => {
  it("começa no dia 1 e termina hoje", () => {
    expect(openMonthThrough("2026-10-22")).toEqual({ from: "2026-10-01", to: "2026-10-22" });
  });
});
