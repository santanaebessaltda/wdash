import { describe, expect, it } from "vitest";
import {
  onlinePixPreviewCents,
  onlinePixSave,
  parseOnlinePix,
  pixAcquirerCents,
} from "./onlinePix";

function save(rows: Array<{ amount: string; note?: string }>) {
  return onlinePixSave({
    rows: rows.map((row, index) => ({ id: String(index), amount: row.amount, note: row.note ?? "" })),
    parseCents: (raw) => {
      const text = raw.trim();
      if (!text) return null;
      const n = Number(text);
      return Number.isFinite(n) ? n : null;
    },
  });
}

describe("PIX online", () => {
  it("guarda valor e descrição e ignora linha vazia ou inválida", () => {
    expect(
      parseOnlinePix([
        { id: "a", cents: 1500, note: "  Maria  " },
        { id: "b", cents: 0, note: "zero" },
        { cents: -10, note: "negativo" },
        null,
        { id: "c", cents: 2500, note: "" },
      ]),
    ).toEqual([
      { id: "a", cents: 1500, note: "Maria" },
      { id: "c", cents: 2500, note: "" },
    ]);
  });

  it("soma os valores preenchidos e recusa linha sem valor", () => {
    expect(onlinePixPreviewCents([{ id: "1", amount: "10", note: "" }, { id: "2", amount: "", note: "rascunho" }], (raw) => (raw.trim() === "" ? null : Number(raw)))).toBe(10);
    const ok = save([
      { amount: "40000", note: "Cliente" },
      { amount: "", note: "" },
      { amount: "10000" },
    ]);
    expect(ok).toEqual({
      ok: true,
      lines: [
        { id: "0", cents: 40000, note: "Cliente" },
        { id: "2", cents: 10000, note: "" },
      ],
    });
    expect(save([{ amount: "", note: "sem valor" }])).toEqual({ ok: false, message: "Informe o valor do PIX online." });
    expect(save([{ amount: "0", note: "" }])).toEqual({ ok: false, message: "Informe o valor do PIX online." });
  });

  it("zero da adquirente só conta quando há PIX online", () => {
    expect(pixAcquirerCents(100000, null, true, 50000)).toBe(100000);
    expect(pixAcquirerCents(100000, 90000, false, 50000)).toBe(90000);
    expect(pixAcquirerCents(null, 0, false, 0)).toBeNull();
    expect(pixAcquirerCents(null, 0, false, 5000)).toBe(0);
    expect(pixAcquirerCents(null, null, true, 5000)).toBeNull();
  });
});
