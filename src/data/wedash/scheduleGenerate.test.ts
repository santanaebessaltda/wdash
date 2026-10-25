import { describe, expect, it } from "vitest";
import { generateMonth, nextSundayShift, weekday } from "./scheduleGenerate";
import { easter, nationalHolidays, storePlace } from "./scheduleHolidays";

describe("feriados nacionais", () => {
  it("calcula a Páscoa e o Carnaval de 2026", () => {
    expect(easter(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    const dates = nationalHolidays(2026).map((row) => `${row.date} ${row.name}`);
    expect(dates).toContain("2026-02-16 Carnaval");
    expect(dates).toContain("2026-02-17 Carnaval");
    expect(dates).toContain("2026-04-03 Sexta-feira Santa");
    expect(dates).toContain("2026-11-20 Consciência Negra");
    expect(dates.some((row) => row.startsWith("2026-04-05"))).toBe(false);
  });

  it("reconhece Campo Grande e Três Lagoas pelo nome da filial", () => {
    expect(storePlace({ city: "", uf: "", name: "ESSENCIA PERFUMARIA CG SHOPPING", tradeName: "Filial" }).city).toBe("Campo Grande");
    expect(storePlace({ city: "", uf: "", name: "ESSENCIA PERFUMARIA TRES LAGOAS", tradeName: "Filial" }).city).toBe("Três Lagoas");
    expect(storePlace({ city: "Dourados", uf: "MS", name: "Outra", tradeName: "Outra" }).city).toBe("Dourados");
  });
});

describe("geração da escala", () => {
  const people = [{ id: "a" }, { id: "b" }];

  it("no 12×36 duas pessoas não folgam no mesmo dia", () => {
    const rows = generateMonth({
      year: 2026,
      month: 3,
      pattern: "12x36",
      offMode: "rotating",
      sundayMin: 0,
      people,
      holidayDates: [],
    }).days;
    const byDate = new Map<string, string[]>();
    for (const row of rows) {
      const list = byDate.get(row.date) ?? [];
      list.push(row.status);
      byDate.set(row.date, list);
    }
    for (const statuses of byDate.values()) {
      expect(statuses.filter((status) => status === "off").length).toBeLessThan(statuses.length);
    }
  });

  it("marca feriado trabalhado e mantém folga", () => {
    const rows = generateMonth({
      year: 2026,
      month: 4,
      pattern: "6x1",
      offMode: "rotating",
      sundayMin: 0,
      people: [{ id: "a" }],
      holidayDates: ["2026-04-21"],
    }).days;
    const tiradentes = rows.find((row) => row.date === "2026-04-21");
    expect(tiradentes?.status === "holiday_work" || tiradentes?.status === "off").toBe(true);
    expect(weekday("2026-04-21")).toBe(2);
  });

  it("folga fixa na terça", () => {
    const rows = generateMonth({
      year: 2026,
      month: 3,
      pattern: "6x1",
      offMode: "fixed",
      sundayMin: 0,
      people: [{ id: "a", fixedOffDow: 2 }],
      holidayDates: [],
    }).days;
    const tuesdays = rows.filter((row) => weekday(row.date) === 2);
    expect(tuesdays.every((row) => row.status === "off" || row.status === "holiday_work")).toBe(true);
    expect(tuesdays.some((row) => row.status === "off")).toBe(true);
  });

  it("dá mais domingo de folga para mulher do que para homem", () => {
    const rows = generateMonth({
      year: 2026,
      month: 3,
      pattern: "6x1",
      offMode: "rotating",
      sundayMin: 0,
      womenSunday: "every_2",
      menSunday: "every_3",
      people: [
        { id: "mulher", sex: "woman" },
        { id: "homem", sex: "man" },
      ],
      holidayDates: [],
    }).days;
    const sundayOffs = (id: string) => rows.filter((row) => row.personId === id && weekday(row.date) === 0 && (row.status === "off" || row.status === "comp_off")).length;
    expect(sundayOffs("mulher")).toBeGreaterThanOrEqual(2);
    expect(sundayOffs("homem")).toBeGreaterThanOrEqual(1);
  });

  it("marca a folga do feriado nos sete dias seguintes", () => {
    const generated = generateMonth({
      year: 2026,
      month: 10,
      pattern: "6x1",
      offMode: "rotating",
      sundayMin: 0,
      people: [{ id: "a" }, { id: "b" }],
      holidayDates: [],
      dayNeeds: Array.from({ length: 7 }, (_, dow) => ({ dow, open: true, min: 1 })),
      holidayRules: [{ date: "2026-10-12", name: "Aparecida", open: true, workers: 1, pay: "extra_off", window: "7_days" }],
    });
    const worked = generated.days.find((row) => row.date === "2026-10-12" && row.status === "holiday_work");
    expect(worked).toBeTruthy();
    const comp = generated.days.filter((row) => row.personId === worked?.personId && row.status === "comp_off" && row.date > "2026-10-12" && row.date <= "2026-10-19");
    expect(comp.length).toBe(1);
    expect(generated.compDue).toEqual([]);
  });

  it("deixa a folga do feriado para o mês seguinte", () => {
    const generated = generateMonth({
      year: 2026,
      month: 10,
      pattern: "6x1",
      offMode: "rotating",
      sundayMin: 0,
      people: [{ id: "a" }],
      holidayDates: [],
      holidayRules: [{ date: "2026-10-12", name: "Aparecida", open: true, workers: 1, pay: "extra_off", window: "next_month" }],
    });
    expect(generated.compDue).toEqual([{ personId: "a", holiday: "2026-10-12", until: "2026-11-30" }]);
  });

  it("começa o ciclo no primeiro dia do período", () => {
    const rows = generateMonth({
      year: 2026,
      month: 3,
      pattern: "6x1",
      offMode: "rotating",
      sundayMin: 0,
      people: [{ id: "a" }],
      holidayDates: [],
      from: "2026-03-04",
      to: "2026-03-10",
    }).days.filter((row) => row.personId === "a");
    expect(rows.map((row) => row.date)).toEqual(["2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"]);
    expect(rows[0]?.status).toBe("work");
    expect(rows[6]?.status).toBe("off");
  });

  it("pede o mínimo em cada turno e reveza o domingo", () => {
    const team = [
      { id: "a1", groupId: "manha" },
      { id: "a2", groupId: "manha" },
      { id: "b1", groupId: "tarde" },
      { id: "b2", groupId: "tarde" },
    ];
    const rows = generateMonth({
      year: 2026,
      month: 3,
      pattern: "6x1",
      offMode: "rotating",
      sundayMin: 0,
      people: team,
      holidayDates: [],
      dayNeeds: Array.from({ length: 7 }, (_, dow) => ({ dow, open: true, min: 2 })),
      sundayShifts: ["manha", "tarde"],
      sundayShiftStart: 0,
    }).days;
    const working = (date: string, groupId: string) => rows.filter((row) => row.date === date && team.find((person) => person.id === row.personId)?.groupId === groupId && (row.status === "work" || row.status === "holiday_work")).length;
    expect(working("2026-03-02", "manha")).toBe(2);
    expect(working("2026-03-02", "tarde")).toBe(2);
    expect(working("2026-03-01", "manha")).toBe(2);
    expect(working("2026-03-01", "tarde")).toBe(0);
    expect(working("2026-03-08", "tarde")).toBe(2);
    expect(working("2026-03-08", "manha")).toBe(0);
    const split = generateMonth({
      year: 2026,
      month: 3,
      from: "2026-03-01",
      to: "2026-03-02",
      pattern: "12x36",
      offMode: "rotating",
      sundayMin: 0,
      people: team,
      holidayDates: [],
      dayNeeds: Array.from({ length: 7 }, (_, dow) => ({ dow, open: true, min: 0 })),
      groupNeeds: [
        { groupId: "manha", dow: 1, min: 2 },
        { groupId: "tarde", dow: 1, min: 1 },
      ],
      sundayShifts: ["manha", "tarde"],
      sundayShiftStart: 0,
    }).days;
    const onMonday = (groupId: string) => split.filter((row) => row.date === "2026-03-02" && team.find((person) => person.id === row.personId)?.groupId === groupId && (row.status === "work" || row.status === "holiday_work")).length;
    expect(onMonday("manha")).toBe(2);
    expect(onMonday("tarde")).toBe(1);
    expect(nextSundayShift("manha", ["manha", "tarde"])).toBe(1);
    expect(nextSundayShift(null, ["manha", "tarde"])).toBe(0);
  });
});
