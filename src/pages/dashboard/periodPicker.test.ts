import { describe, expect, it } from "vitest";
import { managementScheduleWindow } from "./periodPicker";

describe("managementScheduleWindow", () => {
  it("Este mês na Gestão vai até o fim do mês (inclui o que ainda vai começar)", () => {
    expect(managementScheduleWindow({ kind: "thisMonth" }, "2026-10-07")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("Hoje continua só o dia", () => {
    expect(managementScheduleWindow({ kind: "today" }, "2026-10-07")).toEqual({
      from: "2026-10-07",
      to: "2026-10-07",
    });
  });

  it("Personalizado respeita fim futuro", () => {
    expect(
      managementScheduleWindow({ kind: "custom", start: "2026-10-01", end: "2026-10-15" }, "2026-10-07"),
    ).toEqual({ from: "2026-10-01", to: "2026-10-15" });
  });
});
