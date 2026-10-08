import { describe, expect, it } from "vitest";
import { planStoneClose, type StoneCloseStore, type StoneFileState } from "./stoneClosePlan";

const now = new Date("2026-10-08T08:30:00.000Z");

const store: StoneCloseStore = {
  storeId: "s1",
  tenantId: "t1",
  code: "00386",
  taxDigits: "12345678000199",
  covers: "all",
  days: ["2026-10-07", "2026-10-06"],
};

describe("planStoneClose", () => {
  it("pede o cartão e o PIX quando o arquivo já existe e nada foi gravado", () => {
    const actions = planStoneClose(now, [store], []);
    expect(actions).toEqual([
      expect.objectContaining({ day: "2026-10-07", fetchCard: true, requestPix: true }),
      expect.objectContaining({ day: "2026-10-06", fetchCard: true, requestPix: true }),
    ]);
  });

  it("não pede de novo o que já chegou, e espera o prazo do PIX pedido agora", () => {
    const files: StoneFileState[] = [
      {
        storeId: "s1",
        day: "2026-10-07",
        card: "received",
        pix: "requested",
        pixRequestedAt: "2026-10-08T08:00:00.000Z",
      },
      {
        storeId: "s1",
        day: "2026-10-06",
        card: "received",
        pix: "received",
        pixRequestedAt: "2026-10-07T08:10:00.000Z",
      },
    ];
    expect(planStoneClose(now, [store], files)).toEqual([]);
  });

  it("pede o PIX de novo se o CSV não chegou em 45 min", () => {
    const files: StoneFileState[] = [
      {
        storeId: "s1",
        day: "2026-10-07",
        card: "received",
        pix: "requested",
        pixRequestedAt: "2026-10-08T07:00:00.000Z",
      },
    ];
    const actions = planStoneClose(now, [store], files);
    expect(actions.map((a) => a.day)).toEqual(["2026-10-07", "2026-10-06"]);
    expect(actions[0]).toMatchObject({ fetchCard: false, requestPix: true });
  });

  it("loja só de PIX online não baixa o extrato de cartão", () => {
    const actions = planStoneClose(now, [{ ...store, covers: "online_pix", days: ["2026-10-07"] }], []);
    expect(actions).toEqual([expect.objectContaining({ fetchCard: false, requestPix: true })]);
  });

  it("antes das 5h de Brasília não pede o arquivo", () => {
    const early = new Date("2026-10-08T07:30:00.000Z");
    const actions = planStoneClose(early, [store], []);
    expect(actions.map((a) => a.day)).toEqual(["2026-10-06"]);
  });
});
