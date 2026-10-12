import { describe, expect, it } from "vitest";
import { refreshMomentTitle } from "./screenRefresh";

const agora = new Date(2026, 9, 11, 16, 0, 0);

describe("refreshMomentTitle", () => {
  it("separa hora carregando, nunca buscou, hoje e outro dia", () => {
    expect(refreshMomentTitle(undefined, agora)).toBe("Carregando última atualização…");
    expect(refreshMomentTitle(null, agora)).toBe("Nenhuma atualização ainda");
    expect(refreshMomentTitle("", agora)).toBe("Nenhuma atualização ainda");
    expect(refreshMomentTitle(new Date(2026, 9, 11, 14, 35).toISOString(), agora)).toBe("Última atualização às 14:35");
    expect(refreshMomentTitle(new Date(2026, 9, 10, 18, 2).toISOString(), agora)).toBe("Última atualização em 10/10 às 18:02");
  });
});
