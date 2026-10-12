import { describe, expect, it } from "vitest";
import { paths } from "@/router/paths";
import { goalBackPath, teamGoalsReturn } from "./backPath";

describe("volta do detalhe da meta", () => {
  it("sem origem volta para a lista", () => {
    expect(goalBackPath(null)).toBe(paths.goals);
    expect(goalBackPath({})).toBe(paths.goals);
    expect(goalBackPath({ from: "https://wdash.app/team" })).toBe(paths.goals);
  });

  it("origem da Equipe preserva filial, período e abre a aba Metas", () => {
    expect(teamGoalsReturn("?filial=f1&periodo=esteMes")).toBe(`${paths.team}?filial=f1&periodo=esteMes&aba=metas`);
    expect(goalBackPath({ from: teamGoalsReturn("?filial=f1&periodo=hoje") })).toBe(
      `${paths.team}?filial=f1&periodo=hoje&aba=metas`,
    );
    expect(teamGoalsReturn("?aba=ranking&filial=f1")).toBe(`${paths.team}?aba=metas&filial=f1`);
  });
});
