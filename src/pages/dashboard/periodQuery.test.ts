import { describe, expect, it } from "vitest";
import { paths } from "@/router/paths";
import { routeShowsPeriod, searchForRoute } from "./periodQuery";

describe("periodo na URL", () => {
  it("permanece nas telas com o campo", () => {
    expect(routeShowsPeriod(paths.overview)).toBe(true);
    expect(routeShowsPeriod(paths.financial)).toBe(true);
    expect(routeShowsPeriod(paths.products)).toBe(true);
    expect(routeShowsPeriod(paths.team)).toBe(true);
    expect(routeShowsPeriod(paths.goals)).toBe(true);
    expect(routeShowsPeriod(paths.management.challenges)).toBe(true);
    expect(searchForRoute(paths.team, "?filial=f1&periodo=hoje&aba=desafios")).toBe("?filial=f1&periodo=hoje&aba=desafios");
    expect(searchForRoute(paths.overview, "filial=f1&periodo=personalizado&de=2026-10-01&ate=2026-10-11")).toBe(
      "?filial=f1&periodo=personalizado&de=2026-10-01&ate=2026-10-11",
    );
  });

  it("sai das telas sem o campo e mantém a filial", () => {
    expect(routeShowsPeriod(paths.operation.sellers)).toBe(false);
    expect(routeShowsPeriod(paths.stock.inventory)).toBe(false);
    expect(routeShowsPeriod(paths.goalNew)).toBe(false);
    expect(routeShowsPeriod(paths.goalDetail("abc"))).toBe(false);
    expect(routeShowsPeriod(paths.management.challengeNew)).toBe(false);
    expect(routeShowsPeriod(paths.management.challengeDetail("abc"))).toBe(false);
    expect(searchForRoute(paths.stock.inventory, "?filial=f1&periodo=hoje&de=2026-10-01&ate=2026-10-11")).toBe("?filial=f1");
    expect(searchForRoute(paths.profile, "?periodo=hoje")).toBe("");
    expect(searchForRoute(paths.operation.branch, "")).toBe("");
  });
});
