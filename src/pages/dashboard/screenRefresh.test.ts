import { describe, expect, it } from "vitest";
import { refreshMomentTitle } from "./screenRefresh";

const now = new Date(2026, 9, 11, 16, 0, 0);

describe("refreshMomentTitle", () => {
  it("separa hora carregando, nunca buscou, hoje e outro dia", () => {
    expect(refreshMomentTitle(undefined, now)).toBe("Carregando última atualização…");
    expect(refreshMomentTitle(null, now)).toBe("Nenhuma atualização ainda");
    expect(refreshMomentTitle("", now)).toBe("Nenhuma atualização ainda");
    expect(refreshMomentTitle(new Date(2026, 9, 11, 14, 35).toISOString(), now)).toBe("Última atualização às 14:35");
    expect(refreshMomentTitle(new Date(2026, 9, 10, 18, 2).toISOString(), now)).toBe("Última atualização em 10/10 às 18:02");
  });
});
