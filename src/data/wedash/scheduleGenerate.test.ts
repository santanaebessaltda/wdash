import { describe, expect, it } from "vitest";
import { generateMonth, weekday } from "./scheduleGenerate";
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
    });
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
    });
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
    });
    const tuesdays = rows.filter((row) => weekday(row.date) === 2);
    expect(tuesdays.every((row) => row.status === "off" || row.status === "holiday_work")).toBe(true);
    expect(tuesdays.some((row) => row.status === "off")).toBe(true);
  });
});
