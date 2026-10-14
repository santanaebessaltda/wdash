import { describe, expect, it } from "vitest";
import { challengeBackPath } from "@/pages/challenges/shared";
import { paths } from "@/router/paths";
import { goalBackPath, teamChallengesReturn, teamGoalsReturn } from "./backPath";

describe("volta do detalhe da meta", () => {
  it("sem origem volta para a lista", () => {
    expect(goalBackPath(null)).toBe(paths.goals);
    expect(goalBackPath({})).toBe(paths.goals);
    expect(goalBackPath({ from: "https://wdash.app/team" })).toBe(paths.goals);
  });

  it("origem da Equipe preserva filial, período e abre a aba Metas", () => {
    expect(teamGoalsReturn("?filial=f1&periodo=esteMes")).toBe(`${paths.team}?filial=f1&periodo=esteMes&tab=goals`);
    expect(goalBackPath({ from: teamGoalsReturn("?filial=f1&periodo=hoje") })).toBe(
      `${paths.team}?filial=f1&periodo=hoje&tab=goals`,
    );
    expect(teamGoalsReturn("?aba=ranking&filial=f1")).toBe(`${paths.team}?aba=ranking&filial=f1&tab=goals`);
  });

  it("origem da Equipe preserva filial, período e abre a aba Desafios", () => {
    expect(teamChallengesReturn("?store=f1&period=today")).toBe(`${paths.team}?store=f1&period=today&tab=challenges`);
    expect(teamChallengesReturn("?tab=goals&store=f1")).toBe(`${paths.team}?tab=challenges&store=f1`);
  });
});

describe("volta do detalhe do desafio", () => {
  it("sem origem volta para a lista", () => {
    expect(challengeBackPath(null)).toBe(paths.management.challenges);
    expect(challengeBackPath({})).toBe(paths.management.challenges);
    expect(challengeBackPath({ from: "https://wdash.app/team" })).toBe(paths.management.challenges);
  });

  it("aberto pela Equipe volta para a aba Desafios", () => {
    const from = teamChallengesReturn("?store=f1&period=today");
    expect(challengeBackPath({ from })).toBe(from);
    expect(challengeBackPath({ from: "team" })).toBe(`${paths.team}?tab=challenges`);
  });
});
