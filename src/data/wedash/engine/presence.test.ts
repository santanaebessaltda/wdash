import { describe, expect, it } from "vitest";
import { presenceDays, scaledMinimum } from "./presence.ts";

const full = { admittedOn: null, departedOn: null, active: true };

describe("presenceDays", () => {
  it("sem datas e ativa cobre o período inteiro", () => {
    expect(presenceDays("2026-10-01", "2026-10-03", full, null)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("admissão no meio começa nesse dia e não aumenta o alvo de quem já estava", () => {
    expect(presenceDays("2026-10-01", "2026-10-04", { ...full, admittedOn: "2026-10-03" }, null)).toEqual([
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("admissão depois do período fica de fora", () => {
    expect(presenceDays("2026-10-01", "2026-10-04", { ...full, admittedOn: "2026-10-05" }, null)).toEqual([]);
  });

  it("desligamento no meio fecha nesse dia, inclusive", () => {
    expect(
      presenceDays("2026-10-01", "2026-10-04", { admittedOn: null, departedOn: "2026-10-02", active: false }, "2026-10-04"),
    ).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("inativa sem data de saída fecha no último dia vendido", () => {
    expect(presenceDays("2026-10-01", "2026-10-31", { admittedOn: null, departedOn: null, active: false }, "2026-10-10")).toEqual(
      each("2026-10-01", "2026-10-10"),
    );
  });

  it("inativa sem venda e sem saída fica de fora", () => {
    expect(presenceDays("2026-10-01", "2026-10-31", { admittedOn: null, departedOn: null, active: false }, null)).toEqual([]);
  });

  it("saída antes do período fica de fora mesmo com venda", () => {
    expect(
      presenceDays("2026-10-01", "2026-10-31", { admittedOn: "2026-01-01", departedOn: "2026-09-30", active: false }, "2026-10-02"),
    ).toEqual([]);
  });
});

describe("scaledMinimum", () => {
  it("fraciona o mínimo pelos dias presentes", () => {
    expect(scaledMinimum(30, 10, 30)).toBe(10);
    expect(scaledMinimum(30, 30, 30)).toBe(30);
  });
});

function each(start: string, end: string): string[] {
  const out: string[] = [];
  let d = start;
  while (d <= end) {
    out.push(d);
    const dt = new Date(`${d}T12:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + 1);
    d = dt.toISOString().slice(0, 10);
  }
  return out;
}
