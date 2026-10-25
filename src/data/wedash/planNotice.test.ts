import { describe, expect, it } from "vitest";
import { challengeChangeNotice, goalChangeNotice, levelCuts, publishNotice } from "./planNotice";

describe("planNotice", () => {
  it("um item publicado vira um aviso só", () => {
    expect(
      publishNotice([
        { kind: "goal", name: "Novembro", storeName: "Centro", startsOn: "2026-11-01", endsOn: "2026-11-30", targetLabel: "R$ 10.000,00" },
      ])?.title,
    ).toBe("Nova meta");
  });

  it("meta e desafios do mesmo mês viram um aviso", () => {
    const notice = publishNotice([
      { kind: "goal", name: "Novembro", storeName: "Centro", startsOn: "2026-11-01", endsOn: "2026-11-30", targetLabel: "R$ 10.000,00" },
      { kind: "challenge", name: "Semana 1", storeName: "Centro", startsOn: "2026-11-01", endsOn: "2026-11-07" },
    ]);
    expect(notice?.title).toBe("Novembro está no ar");
    expect(notice?.body).toContain("Desafio Semana 1");
  });

  it("mudar o percentual do nível entra no aviso; nome não", () => {
    const levels = levelCuts(
      [
        { name: "Meta", minAttainmentPct: 100 },
        { name: "Super", minAttainmentPct: 120 },
      ],
      [
        { name: "Meta", minAttainmentPct: 100 },
        { name: "Hiper", minAttainmentPct: 110 },
      ],
    );
    expect(levels.reshaped).toBe(false);
    expect(levels.cuts).toEqual([{ name: "Hiper", from: 120, to: 110 }]);
    const notice = goalChangeNotice({
      storeName: "Centro",
      name: "Novembro",
      targetFrom: 10000,
      targetTo: 10000,
      levels: levels.cuts,
    });
    expect(notice?.body).toContain("110%");
    expect(notice?.body).not.toContain("Valor de");
  });

  it("mínimo igual não avisa", () => {
    expect(challengeChangeNotice({ storeName: "Centro", name: "Semana", targetFrom: "10", targetTo: "10" })).toBeNull();
  });
});
