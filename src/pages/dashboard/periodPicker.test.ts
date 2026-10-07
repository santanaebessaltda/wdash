import { describe, expect, it } from "vitest";
import { managementScheduleWindow } from "./periodPicker";

describe("managementScheduleWindow", () => {
  it("Este mês na Gestão vai até o fim do mês (inclui o que ainda vai começar)", () => {
    expect(managementScheduleWindow({ tipo: "esteMes" }, "2026-10-07")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("Hoje continua só o dia", () => {
    expect(managementScheduleWindow({ tipo: "hoje" }, "2026-10-07")).toEqual({
      from: "2026-10-07",
      to: "2026-10-07",
    });
  });

  it("Personalizado respeita fim futuro", () => {
    expect(
      managementScheduleWindow({ tipo: "personalizado", inicio: "2026-10-01", fim: "2026-10-15" }, "2026-10-07"),
    ).toEqual({ from: "2026-10-01", to: "2026-10-15" });
  });
});
