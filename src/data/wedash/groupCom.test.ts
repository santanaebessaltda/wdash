import { describe, expect, it } from "vitest";
import {
  decryptGroupComField,
  encryptGroupComField,
  fillGroupComPeriod,
  groupComAcceptsLaunch,
  groupComBaseUrl,
  groupComBillingObject,
  groupComDay,
  groupComMovementsMatch,
  groupComSlug,
  groupComUnit,
  type GroupComMovement,
} from "./groupCom";

const SAO_PAULO = "America/Sao_Paulo";
const OCT_1 = 1790848800000;

describe("groupComSlug", () => {
  it("reads the portal slug from the host", () => {
    expect(groupComSlug("treslagoasapp")).toBe("treslagoasapp");
    expect(groupComSlug("https://nortesulapp.com21.com.br/frontend/public/#/login")).toBe("nortesulapp");
    expect(groupComSlug("https://nortesulapp.com21.com.br/")).toBe("nortesulapp");
    expect(groupComBaseUrl("NorteSulApp.com21.com.br")).toBe("https://nortesulapp.com21.com.br");
    expect(groupComSlug("https://appc.com21.com.br/")).toBeNull();
    expect(groupComSlug("https://app3.intranetmall.com/shoppingcampogrande4/")).toBeNull();
  });
});

describe("groupCom calendar", () => {
  it("maps the mall midnight to the calendar day", () => {
    expect(groupComDay(OCT_1, SAO_PAULO)).toBe("2026-10-01");
    expect(groupComDay(OCT_1 + 86_400_000, SAO_PAULO)).toBe("2026-10-02");
    expect(groupComAcceptsLaunch(OCT_1, "2026-10-01", SAO_PAULO)).toBe(true);
    expect(groupComAcceptsLaunch(OCT_1, "2026-10-02", SAO_PAULO)).toBe(false);
  });
});

describe("fillGroupComPeriod", () => {
  const movements: GroupComMovement[] = [
    { dataMovimento: OCT_1, valorVenda: 7589.21, valorDevolucao: null, quantidadeVendas: null },
    { dataMovimento: OCT_1 + 86400000, valorVenda: null, valorDevolucao: null, quantidadeVendas: null },
  ];

  it("keeps a launched day and fills only the empty past day", () => {
    const filled = fillGroupComPeriod(movements, { "2026-10-02": 918131 }, "2026-10-03", SAO_PAULO);
    expect(filled.changed).toBe(true);
    expect(filled.movimentos[0]?.valorVenda).toBe(7589.21);
    expect(filled.movimentos[1]?.valorVenda).toBe(9181.31);
    expect(filled.days).toEqual([
      { date: "2026-10-01", cents: 758921 },
      { date: "2026-10-02", cents: 918131 },
    ]);
    expect(groupComMovementsMatch(filled.movimentos, filled.movimentos, SAO_PAULO)).toBe(true);
  });

  it("leaves today empty and ignores days outside the selection", () => {
    const today = fillGroupComPeriod(movements, { "2026-10-02": 100 }, "2026-10-02", SAO_PAULO);
    expect(today.changed).toBe(false);
    expect(today.movimentos[1]?.valorVenda).toBeNull();
    const selected = fillGroupComPeriod(movements, { "2026-10-02": 100 }, "2026-10-04", SAO_PAULO, new Set(["2026-10-01"]));
    expect(selected.changed).toBe(false);
    expect(selected.movimentos[1]?.valorVenda).toBeNull();
  });
});

describe("groupComBillingObject", () => {
  it("prefers the active sales object", () => {
    expect(groupComBillingObject([
      { idObjetoFaturamento: 1, nome: "OUTRO", objetoAtivo: 1 },
      { idObjetoFaturamento: 75750, nome: "VENDAS 1", objetoAtivo: 1 },
    ])).toBe(75750);
    expect(groupComUnit({
      contractId: 22434392,
      companyId: 472655,
      clientId: 2896,
      clientCode: "19306",
      roleId: 21,
      code: "74376-Q0024",
      floor: "Piso 1",
      mall: "SHOPPING TRÊS LAGOAS",
      timeZone: SAO_PAULO,
    })?.code).toBe("74376-Q0024");
    expect(groupComUnit({ code: "74376-Q0024" })).toBeNull();
  });
});

describe("encryptGroupComField", () => {
  it("round-trips the portal cipher", async () => {
    const cipher = await encryptGroupComField("loja");
    expect(cipher).not.toContain("loja");
    expect(await decryptGroupComField(cipher)).toBe("loja");
    expect(await encryptGroupComField("loja")).toBe(cipher);
  });
});
