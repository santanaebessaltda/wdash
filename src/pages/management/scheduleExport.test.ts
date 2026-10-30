import { describe, expect, it } from "vitest";
import { scheduleXlsxRows, statusLetter, type ScheduleExportCard } from "./scheduleExport";

describe("scheduleExport", () => {
  it("mapeia status para a sigla da grade", () => {
    expect(statusLetter("work")).toBe("T");
    expect(statusLetter("off")).toBe("F");
    expect(statusLetter("holiday_work")).toBe("FE");
    expect(statusLetter("holiday_work", true)).toBe("FE 2x");
    expect(statusLetter("comp_off")).toBe("FC");
  });

  it("monta planilha com filial, pessoa e dias do mês", () => {
    const cards: ScheduleExportCard[] = [
      {
        storeName: "QUIOSQUE NORTE",
        monthLabel: "Novembro de 2026",
        pattern: "6x1",
        people: [{ id: "p1", name: "ANA", role: "VENDEDOR", group: "manhã" }],
        dates: ["2026-11-01", "2026-11-02"],
        days: [
          { sellerId: "p1", day: "2026-11-01", status: "work" },
          { sellerId: "p1", day: "2026-11-02", status: "off" },
        ],
      },
    ];
    const rows = scheduleXlsxRows(cards);
    expect(rows[0]).toEqual(["Filial", "Escala", "Mês", "Pessoa", "Cargo", "Grupo", "01", "02"]);
    expect(rows[1]).toEqual(["QUIOSQUE NORTE", "ESCALA 6X1", "Novembro de 2026", "ANA", "VENDEDOR", "manhã", "T", "F"]);
  });
});
