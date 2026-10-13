import { describe, expect, it } from "vitest";
import {
  fillAllosWeek,
  forceLaunchAllowed,
  shoppingMenu,
  informedWeekIds,
  formatAllosAmount,
  informedLaunchValues,
  informedStoredValues,
  monthReport,
  parseAllosForm,
  reportDays,
  shoppingAccountView,
  sumSoldByDay,
  type SalesWindow,
} from "./shoppingReport";

const today = "2026-10-13";

function week(days: Array<[string, number | null, number]>, kind: SalesWindow["kind"] = "informed"): SalesWindow {
  return {
    kind,
    days: days.map(([date, fieldCents, soldCents]) => ({ date, fieldCents, soldCents })),
  };
}

describe("informedLaunchValues", () => {
  it("fills every blank past day and keeps a value already in the form", () => {
    const windows = [
      week([
        ["2026-10-11", null, 10000],
        ["2026-10-12", 8000, 9000],
        ["2026-10-13", null, 5000],
        ["2026-10-14", null, 0],
      ]),
    ];
    expect(informedLaunchValues(windows, today)).toEqual([
      { date: "2026-10-11", cents: 10000 },
      { date: "2026-10-12", cents: 8000 },
      { date: "2026-10-13", cents: null },
      { date: "2026-10-14", cents: null },
    ]);
  });

  it("fills blank past days in an older window too", () => {
    const windows = [week([["2026-10-04", null, 675680]]), week([["2026-10-11", null, 1000]])];
    expect(informedLaunchValues(windows, today).map((day) => day.cents)).toEqual([675680, 1000]);
  });

  it("sends 0,00 when a closed day had no sales", () => {
    const windows = [week([["2026-10-12", null, 0]])];
    expect(informedLaunchValues(windows, today)).toEqual([{ date: "2026-10-12", cents: 0 }]);
  });

  it("does not write the Online line", () => {
    const windows = [week([["2026-10-12", null, 5000]], "online")];
    expect(informedLaunchValues(windows, today)).toEqual([]);
  });
});

describe("monthReport", () => {
  it("subtracts sold from launched and counts a missing launch as zero", () => {
    const report = monthReport(
      [
        { date: "2026-10-11", soldCents: 10000, launchedCents: 12000 },
        { date: "2026-10-12", soldCents: 5000, launchedCents: null },
        { date: "2026-10-13", soldCents: 9999, launchedCents: null },
      ],
      today,
    );
    expect(report).toEqual({
      soldCents: 15000,
      launchedCents: 12000,
      differenceCents: -3000,
      blankDays: 1,
    });
  });
});

describe("formatAllosAmount", () => {
  it("uses the shopping form's thousands and decimal marks", () => {
    expect(formatAllosAmount(675680)).toBe("6.756,80");
    expect(formatAllosAmount(0)).toBe("0,00");
  });
});

describe("sumSoldByDay", () => {
  it("keeps the store total and does not add the brand split again", () => {
    expect(
      sumSoldByDay([
        { day: "2026-10-01", brand: "ALL", revenueCents: 10000 },
        { day: "2026-10-01", brand: "WEPINK", revenueCents: 7000 },
        { day: "2026-10-01", brand: "WPINK", revenueCents: 3000 },
      ]),
    ).toEqual({ "2026-10-01": 10000 });
  });
});

describe("informedStoredValues", () => {
  it("keeps a filled past day, stores a blank past day as zero, and skips today", () => {
    expect(
      informedStoredValues(
        [
          { date: "2026-10-11", fieldCents: 12000 },
          { date: "2026-10-12", fieldCents: null },
          { date: "2026-10-13", fieldCents: 9999 },
        ],
        today,
      ),
    ).toEqual([
      { date: "2026-10-11", cents: 12000 },
      { date: "2026-10-12", cents: 0 },
    ]);
  });
});

describe("reportDays", () => {
  it("counts a past day without a launch as blank and leaves today out", () => {
    const days = reportDays(
      ["2026-10-11", "2026-10-12", "2026-10-13"],
      sumSoldByDay([
        { day: "2026-10-11", revenueCents: 6000 },
        { day: "2026-10-11", revenueCents: 4000 },
        { day: "2026-10-12", revenueCents: 5000 },
      ]),
      { "2026-10-11": 12000 },
      today,
    );
    expect(monthReport(days, today)).toEqual({
      soldCents: 15000,
      launchedCents: 12000,
      differenceCents: -3000,
      blankDays: 1,
    });
    expect(days.find((day) => day.date === "2026-10-13")).toBeUndefined();
  });
});

describe("shoppingMenu", () => {
  it("shows settings on a kiosk and the report only when Allos is saved", () => {
    expect(shoppingMenu({ kiosk: false, administrator: "allos" })).toEqual({ settings: false, report: false });
    expect(shoppingMenu({ kiosk: true, administrator: null })).toEqual({ settings: true, report: false });
    expect(shoppingMenu({ kiosk: true, administrator: "argo" })).toEqual({ settings: true, report: false });
    expect(shoppingMenu({ kiosk: true, administrator: "allos" })).toEqual({ settings: true, report: true });
  });
});

describe("forceLaunchAllowed", () => {
  it("blocks a street store, a kiosk without access, and Argo", () => {
    expect(forceLaunchAllowed({ kiosk: false, administrator: "allos" })).toEqual({
      ok: false,
      message: "O informe de vendas vale para quiosque em shopping.",
    });
    expect(forceLaunchAllowed({ kiosk: true, administrator: null })).toEqual({
      ok: false,
      message: "O Gestor ainda não configurou o shopping desta filial.",
    });
    expect(forceLaunchAllowed({ kiosk: true, administrator: "argo" })).toEqual({
      ok: false,
      message: "O envio da Argo ainda não está disponível. Nada foi alterado no shopping.",
    });
    expect(forceLaunchAllowed({ kiosk: true, administrator: "allos" })).toEqual({ ok: true });
  });
});

describe("shoppingAccountView", () => {
  it("drops the saved password", () => {
    const view = shoppingAccountView({
      store_id: "loja",
      administrator: "allos",
      base_url: "https://app3.intranetmall.com/shopping",
      username: "LUCF019",
      secret_ciphertext: "segredo-cifrado",
    });
    expect(view).toEqual({
      storeId: "loja",
      administrator: "allos",
      baseUrl: "https://app3.intranetmall.com/shopping",
      username: "LUCF019",
      lastRunAt: null,
      lastError: "",
    });
    expect(JSON.stringify(view)).not.toContain("segredo");
  });
});

describe("informedWeekIds", () => {
  it("reads the Informada week and skips Online", () => {
    const html = `
      <h2>Informada</h2>
      <a href="vendas_alterar.asp?IDSEMANA=9291">Informar vendas</a>
      <h2>Online</h2>
      <a href="vendas_alterar.asp?IDSEMANA=9300">Informar vendas</a>
    `;
    expect(informedWeekIds(html)).toEqual(["9291"]);
  });
});

describe("fillAllosWeek", () => {
  it("fills only the blank past day and sends the filled day again", () => {
    const html = `
      <input name="data_cadastra" value="2026-10-11">
      <input name="venda0" value="">
      <input name="data_cadastra" value="2026-10-12">
      <input name="venda1" value="80,00">
      <input name="data_cadastra" value="2026-10-13">
      <input name="venda2" value="">
      <input name="data_cadastra" value="2026-10-14">
      <input name="venda3" value="">
      <input name="data_cadastra" value="2026-10-15">
      <input name="venda4" value="">
      <input name="data_cadastra" value="2026-10-16">
      <input name="venda5" value="">
      <input name="data_cadastra" value="2026-10-17">
      <input name="venda6" value="">
      <input name="idsemana" value="9291">
      <input name="dias" value="7">
    `;
    const parsed = parseAllosForm(html);
    expect(parsed).not.toBeNull();
    const filled = fillAllosWeek(parsed!, { "2026-10-11": 10000, "2026-10-12": 9000 }, today);
    expect(filled.days.map((day) => day.cents)).toEqual([10000, 8000, null, null, null, null, null]);
    expect(filled.body).toContain("venda0=100,00");
    expect(filled.body).toContain("venda1=80,00");
    expect(filled.body).toContain("venda2=");
    expect(filled.body).not.toContain("venda2=0,00");
    expect(filled.body).toContain("idsemana=9291");
    expect(filled.body).toContain("dias=7");
  });

  it("keeps a short month-start week and sends that day count", () => {
    const html = `
      <input name="data_cadastra" value="2026-10-1">
      <input name="venda0" value="10,00">
      <input name="data_cadastra" value="2026-10-2">
      <input name="venda1" value="">
      <input name="data_cadastra" value="2026-10-3">
      <input name="venda2" value="">
      <input name="idsemana" value="9267">
      <input name="dias" value="3">
    `;
    const parsed = parseAllosForm(html);
    expect(parsed?.fields).toHaveLength(3);
    const filled = fillAllosWeek(parsed!, { "2026-10-02": 2500 }, today);
    expect(filled.body).toContain("dias=3");
    expect(filled.body).toContain("venda1=25,00");
    expect(filled.body).not.toContain("dias=7");
  });
});
