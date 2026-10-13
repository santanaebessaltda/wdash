import { describe, expect, it } from "vitest";
import {
  fillAllosWeek,
  forceLaunchAllowed,
  shoppingMenu,
  informedWeekIds,
  formatAllosAmount,
  informedLaunchValues,
  informedStoredValues,
  ALREADY_LAUNCHED,
  allosPeriods,
  informedGap,
  monthReport,
  periodReports,
  unlaunchedDays,
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

describe("periodReports", () => {
  it("splits the month into Allos weeks and sums only closed days", () => {
    expect(allosPeriods("2026-10-01", "2026-10-31")).toEqual([
      { from: "2026-10-01", to: "2026-10-03" },
      { from: "2026-10-04", to: "2026-10-10" },
      { from: "2026-10-11", to: "2026-10-17" },
      { from: "2026-10-18", to: "2026-10-24" },
      { from: "2026-10-25", to: "2026-10-31" },
    ]);
    const days = reportDays(
      ["2026-10-01", "2026-10-03", "2026-10-04", "2026-10-11", "2026-10-12", "2026-10-13"],
      { "2026-10-01": 1000, "2026-10-03": 2000, "2026-10-04": 4000, "2026-10-11": 8000, "2026-10-12": 500 },
      { "2026-10-01": 1000, "2026-10-04": 3000 },
      today,
    );
    expect(periodReports(days, "2026-10-01", "2026-10-31")).toEqual([
      { from: "2026-10-01", to: "2026-10-03", soldCents: 3000, launchedCents: 1000, differenceCents: -2000 },
      { from: "2026-10-04", to: "2026-10-10", soldCents: 4000, launchedCents: 3000, differenceCents: -1000 },
      { from: "2026-10-11", to: "2026-10-17", soldCents: 8500, launchedCents: 0, differenceCents: -8500 },
    ]);
  });
});

describe("unlaunchedDays", () => {
  it("opens the mall only while a closed day has no stored launch", () => {
    const launched = new Set(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"]);
    expect(unlaunchedDays("2026-10-01", "2026-10-31", today, launched)).toEqual([]);
    expect(unlaunchedDays("2026-10-01", "2026-10-31", today, new Set(["2026-10-01"]))).toContain("2026-10-05");
    expect(unlaunchedDays("2026-10-01", "2026-10-31", "2026-10-01", new Set())).toEqual([]);
    expect(ALREADY_LAUNCHED).toContain("não foi aberto");
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

describe("informedGap", () => {
  it("keeps a missing day apart from a stored zero", () => {
    expect(informedGap(0, null)).toBe("missing");
    expect(informedGap(0, 0)).toBe("match");
    expect(informedGap(10000, 12000)).toBe("over");
    expect(informedGap(10000, 8000)).toBe("under");
  });
});

describe("shoppingMenu", () => {
  it("keeps the report and the shopping settings in the menu", () => {
    expect(shoppingMenu()).toEqual({ settings: true, report: true });
  });
});

describe("forceLaunchAllowed", () => {
  it("blocks a street store, a kiosk without access, and Argo", () => {
    expect(forceLaunchAllowed({ kiosk: false, administrator: "allos" })).toEqual({
      ok: false,
      message: "Esta tela está disponível apenas para filiais do tipo Quiosque em shopping.",
    });
    expect(forceLaunchAllowed({ kiosk: true, administrator: null })).toEqual({
      ok: false,
      message: "O Gestor ainda não configurou a administradora desta filial.",
    });
    expect(forceLaunchAllowed({ kiosk: true, administrator: "argo" })).toEqual({
      ok: false,
      message: "A integração com a Argo ainda não está disponível na WDash.",
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

  it("leaves a blank day empty when it was not selected", () => {
    const html = `
      <input name="data_cadastra" value="2026-10-11">
      <input name="venda0" value="">
      <input name="data_cadastra" value="2026-10-12">
      <input name="venda1" value="">
      <input name="idsemana" value="9291">
      <input name="dias" value="2">
    `;
    const parsed = parseAllosForm(html);
    const filled = fillAllosWeek(parsed!, { "2026-10-11": 10000, "2026-10-12": 9000 }, "2026-10-15", new Set(["2026-10-11"]));
    expect(filled.days.map((day) => day.cents)).toEqual([10000, null]);
    expect(filled.body).toContain("venda0=100,00");
    expect(filled.body).toContain("venda1=");
    expect(filled.body).not.toContain("venda1=90,00");
  });
});
