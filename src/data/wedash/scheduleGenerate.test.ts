import { describe, expect, it } from "vitest";
import { applyDayChoices, buildCompOffSummary, generateMonth, previousFromSnapshot, scheduleIssueFromEngine, weekday, type EditableDay, type HolidayRule } from "./scheduleGenerate";
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

  it("lista folga compensatória pendente no mês seguinte", () => {
    const rows = buildCompOffSummary({
      monthStart: "2026-11-01",
      monthDays: [
        { sellerId: "a", day: "2026-11-20", status: "holiday_work" },
        { sellerId: "a", day: "2026-11-21", status: "work" },
      ],
      rules: [{ date: "2026-11-20", name: "Consciência Negra", open: true, workers: 1, pay: "extra_off", window: "next_month" }],
      compDue: [{ personId: "a", holiday: "2026-11-20", until: "2026-12-31" }],
      people: [{ id: "a", name: "Ana" }],
    });
    expect(rows).toEqual([
      {
        personId: "a",
        personName: "Ana",
        holidayDate: "2026-11-20",
        holidayName: "Consciência Negra",
        offDate: null,
        until: "2026-12-31",
      },
    ]);
  });

  it("mostra a data da FC no mês seguinte quando a escala seguinte já existe", () => {
    const rows = buildCompOffSummary({
      monthStart: "2026-11-01",
      monthDays: [{ sellerId: "a", day: "2026-11-20", status: "holiday_work" }],
      allDays: [
        { sellerId: "a", day: "2026-11-20", status: "holiday_work" },
        { sellerId: "a", day: "2026-12-03", status: "comp_off" },
      ],
      rules: [{ date: "2026-11-20", name: "Consciência Negra", open: true, workers: 1, pay: "extra_off", window: "next_month" }],
      compDue: [{ personId: "a", holiday: "2026-11-20", until: "2026-12-31" }],
      people: [{ id: "a", name: "Ana" }],
    });
    expect(rows[0]?.offDate).toBe("2026-12-03");
  });

  it("explica como destravar erro de domingo", () => {
    const issue = scheduleIssueFromEngine(
      [
        {
          title: "O revezamento dos domingos precisa de mais pessoas",
          explanation: "A quantidade pedida nos domingos não deixa espaço para todas as folgas de domingo escolhidas para a equipe.",
          details: ["Foram pedidas 15 presenças nos 5 domingos."],
          actions: [
            { label: "Rever pessoas por dia", target: "businessDays" },
            { label: "Adicionar pessoas à equipe", target: "employeeName" },
          ],
        },
      ],
      "falhou",
    );
    expect(issue.title).toMatch(/domingos/i);
    expect(issue.howToFix.some((line) => line.toLowerCase().includes("domingo"))).toBe(true);
    expect(issue.fixes.map((fix) => fix.step).sort()).toEqual([2, 3]);
  });

  it("usa o mês anterior no revezamento de domingo", () => {
    const people = ["a", "b", "c", "d"].map((id) => ({ id, sex: "woman" as const }));
    const dayNeeds = Array.from({ length: 7 }, (_, dow) => ({ dow, open: true, min: 2 }));
    const october = generateMonth({
      year: 2026,
      month: 10,
      pattern: "6x1",
      offMode: "rotating",
      sundayMin: 0,
      womenSunday: "every_2",
      menSunday: "every_3",
      people,
      holidayDates: [],
      dayNeeds,
      holidayRules: [],
    });
    expect(october.snapshot.month).toBe("2026-10");
    expect(october.snapshot.personIds).toEqual(["a", "b", "c", "d"]);
    expect(previousFromSnapshot(october.snapshot, people, "2026-11")).not.toBeNull();
    expect(previousFromSnapshot(october.snapshot, [{ id: "a" }, { id: "x" }], "2026-11")).toBeNull();

    const november = generateMonth({
      year: 2026,
      month: 11,
      pattern: "6x1",
      offMode: "rotating",
      sundayMin: 0,
      womenSunday: "every_2",
      menSunday: "every_3",
      people,
      holidayDates: [],
      dayNeeds,
      holidayRules: [],
      previousSnapshot: october.snapshot,
    });
    // Com every_2, não pode haver 2 domingos seguidos sem folga na virada out→nov.
    for (const person of people) {
      const sundays = ["2026-10-25", "2026-11-01", "2026-11-08"]
        .map((date) => {
          const row =
            october.days.find((item) => item.personId === person.id && item.date === date) ??
            november.days.find((item) => item.personId === person.id && item.date === date);
          return row?.status === "off" || row?.status === "comp_off";
        });
      for (let i = 0; i + 1 < sundays.length; i++) {
        expect(sundays[i] || sundays[i + 1]).toBe(true);
      }
    }
  });

  it("não trava o revezamento de domingo quando a compensatória vai para o mês seguinte", () => {
    const generated = generateMonth({
      year: 2026,
      month: 11,
      pattern: "6x1",
      offMode: "rotating",
      sundayMin: 0,
      womenSunday: "every_2",
      menSunday: "every_3",
      people: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, sex: "woman" as const })),
      holidayDates: [],
      dayNeeds: [
        { dow: 0, open: true, min: 3 },
        { dow: 1, open: true, min: 4 },
        { dow: 2, open: true, min: 4 },
        { dow: 3, open: true, min: 4 },
        { dow: 4, open: true, min: 5 },
        { dow: 5, open: true, min: 6 },
        { dow: 6, open: true, min: 6 },
      ],
      holidayRules: [
        { date: "2026-11-02", name: "Finados", open: false, workers: 0, pay: "extra_off", window: "month_end" },
        { date: "2026-11-15", name: "Proclamação da República", open: true, workers: 3, pay: "double", window: "month_end" },
        { date: "2026-11-20", name: "Consciência Negra", open: true, workers: 3, pay: "extra_off", window: "next_month" },
      ],
    });
    expect(generated.days.some((row) => row.date.startsWith("2026-11"))).toBe(true);
    expect(generated.compDue.length).toBe(3);
    expect(generated.compDue.every((due) => due.holiday === "2026-11-20" && due.until === "2026-12-31")).toBe(true);
  });

  it("respeita a folga fixa dentro do período pedido", () => {
    const rows = generateMonth({
      year: 2026,
      month: 3,
      pattern: "6x1",
      offMode: "fixed",
      sundayMin: 0,
      womenSunday: "none",
      menSunday: "none",
      people: [{ id: "a", fixedOffDow: 1 }],
      holidayDates: [],
      from: "2026-03-02",
      to: "2026-03-08",
    }).days.filter((row) => row.personId === "a");
    expect(rows.map((row) => row.date)).toEqual(["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08"]);
    expect(rows.map((row) => row.status)).toEqual(["off", "work", "work", "work", "work", "work", "work"]);
  });

  it("repete a escala de outubro do gerador", () => {
    const names = ["emily", "gabriela", "izabelly", "maria", "pamela", "stefani"];
    const expected: Record<string, string> = {
      emily: "TTTTFTTTTTFFTTTTTTFTTTTTFFTTTTT",
      gabriela: "TTTTTFTTTTFHFTTTTTTFTTTTFTFTTTT",
      izabelly: "TTTTTTFTTTFHTFTTTTTTFTTTFTTFTTT",
      maria: "TTTFFTTTTTTFTTTTTFFTTTTTTFTTTTT",
      pamela: "TTTFTFTTTTTHFTTTTFTFTTTTTTFTTTT",
      stefani: "TTTFTTFTTTTFTFTTTFTTFTTTTTTFTTT",
    };
    const rows = generateMonth({
      year: 2026,
      month: 10,
      pattern: "6x1",
      offMode: "rotating",
      sundayMin: 0,
      womenSunday: "every_2",
      menSunday: "every_3",
      people: names.map((id) => ({ id, sex: "woman" as const })),
      holidayDates: [],
      dayNeeds: [
        { dow: 0, open: true, min: 3 },
        { dow: 1, open: true, min: 4 },
        { dow: 2, open: true, min: 4 },
        { dow: 3, open: true, min: 4 },
        { dow: 4, open: true, min: 6 },
        { dow: 5, open: true, min: 6 },
        { dow: 6, open: true, min: 6 },
      ],
      holidayRules: [{ date: "2026-10-12", name: "Nossa Senhora Aparecida", open: true, workers: 3, pay: "double", window: "7_days" }],
    }).days;
    const letter = (status: string) => (status === "holiday_work" ? "H" : status === "off" ? "F" : status === "comp_off" ? "C" : "T");
    for (const id of names) {
      const line = rows.filter((row) => row.personId === id).map((row) => letter(row.status)).join("");
      expect(line, id).toBe(expected[id]);
    }
  });
});

describe("edição de um dia", () => {
  const rules: HolidayRule[] = [{ date: "2026-10-12", name: "Nossa Senhora Aparecida", open: true, workers: 3, pay: "extra_off", window: "7_days" }];
  const needs = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, open: dow !== 0, min: 1 }));
  const days: EditableDay[] = [
    { sellerId: "ana", day: "2026-10-12", status: "holiday_work", origin: "generated" },
    { sellerId: "ana", day: "2026-10-15", status: "comp_off", origin: "generated" },
    { sellerId: "ana", day: "2026-10-16", status: "work", origin: "generated" },
    { sellerId: "bia", day: "2026-10-12", status: "holiday_work", origin: "generated" },
    { sellerId: "bia", day: "2026-10-15", status: "work", origin: "generated" },
    { sellerId: "bia", day: "2026-10-16", status: "work", origin: "generated" },
  ];

  it("move a folga do feriado e devolve o dia anterior para trabalho", () => {
    const edited = applyDayChoices({
      day: "2026-10-16",
      days,
      rules,
      dayNeeds: needs,
      pattern: "6x1",
      monthEnd: "2026-10-31",
      choices: [
        { personId: "ana", value: "comp_off", holiday: "2026-10-12" },
        { personId: "bia", value: "off", holiday: null },
      ],
    });
    expect(edited.error).toBeNull();
    expect(edited.days.find((row) => row.sellerId === "ana" && row.day === "2026-10-15")?.status).toBe("work");
    expect(edited.days.find((row) => row.sellerId === "ana" && row.day === "2026-10-16")?.status).toBe("comp_off");
    expect(edited.days.find((row) => row.sellerId === "bia" && row.day === "2026-10-16")?.status).toBe("off");
    expect(edited.days.find((row) => row.sellerId === "bia" && row.day === "2026-10-15")?.status).toBe("work");
  });

  it("trabalhar num feriado continua como feriado trabalhado", () => {
    const edited = applyDayChoices({
      day: "2026-10-12",
      days,
      rules,
      dayNeeds: needs,
      pattern: "6x1",
      monthEnd: "2026-10-31",
      choices: [{ personId: "ana", value: "work", holiday: null }],
    });
    expect(edited.error).toBeNull();
    expect(edited.days.find((row) => row.sellerId === "ana" && row.day === "2026-10-12")?.status).toBe("holiday_work");
  });

  it("não coloca folga de feriado em cima de uma folga normal", () => {
    const edited = applyDayChoices({
      day: "2026-10-16",
      days: days.map((row) => (row.sellerId === "ana" && row.day === "2026-10-16" ? { ...row, status: "off" as const } : row)),
      rules,
      dayNeeds: needs,
      pattern: "6x1",
      monthEnd: "2026-10-31",
      choices: [{ personId: "ana", value: "comp_off", holiday: "2026-10-12" }],
    });
    expect(edited.error).toMatch(/folgas normais/);
    expect(edited.days.find((row) => row.sellerId === "ana" && row.day === "2026-10-15")?.status).toBe("comp_off");
  });
});
