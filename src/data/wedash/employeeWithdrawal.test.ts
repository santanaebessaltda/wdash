import { describe, expect, it } from "vitest";
import {
  dayShortageCents,
  netCloseDiff,
  parseWithdrawalRows,
  withdrawalDraftFrom,
  withdrawalPeople,
  withdrawalPreview,
  withdrawalSave,
} from "./employeeWithdrawal";

const names = new Map([
  ["ana", "ANA"],
  ["bia", "BIA"],
]);

function save(input: {
  shortageCents: number;
  enabled?: boolean;
  rows: { sellerId: string; amount: string }[];
  parse?: (raw: string) => number | null;
}) {
  return withdrawalSave({
    shortageCents: input.shortageCents,
    enabled: input.enabled ?? true,
    rows: input.rows.map((row, index) => ({ id: String(index), ...row })),
    parseCents: input.parse ?? ((raw) => (raw.trim() === "" ? null : Number(raw))),
    names,
  });
}

describe("retirada de funcionários", () => {
  it("abate a retirada da quebra do dia, mesmo acima do dinheiro", () => {
    const day = -88492;
    expect(dayShortageCents(day)).toBe(88492);
    expect(dayShortageCents(1200)).toBe(0);
    const saved = save({
      shortageCents: dayShortageCents(day),
      rows: [
        { sellerId: "ana", amount: "50000" },
        { sellerId: "bia", amount: "30802" },
      ],
    });
    expect(saved.ok).toBe(true);
    expect(netCloseDiff(day, 80802)).toBe(-7690);
    expect(netCloseDiff(day, 90000)).toBe(1508);
    expect(netCloseDiff(5000, 1000)).toBe(5000);
  });

  it("parte a quebra entre retirada e quebra de caixa", () => {
    const saved = save({
      shortageCents: 5000,
      rows: [
        { sellerId: "ana", amount: "2000" },
        { sellerId: "bia", amount: "1500" },
      ],
    });
    expect(saved).toEqual({
      ok: true,
      lines: [
        { sellerId: "ana", cents: 2000 },
        { sellerId: "bia", cents: 1500 },
      ],
    });
    expect(withdrawalPreview(5000, [2000, 1500])).toEqual({
      withdrawalCents: 3500,
      breakCents: 1500,
      surplusCents: 0,
    });
  });

  it("aceita a retirada que fecha a quebra inteira", () => {
    const saved = save({ shortageCents: 800, rows: [{ sellerId: "ana", amount: "800" }] });
    expect(saved.ok).toBe(true);
    expect(withdrawalPreview(800, [800]).breakCents).toBe(0);
  });

  it("grava a retirada mesmo acima da quebra, e o excedente vira sobra", () => {
    expect(save({ shortageCents: 1000, rows: [{ sellerId: "ana", amount: "1001" }] })).toEqual({
      ok: true,
      lines: [{ sellerId: "ana", cents: 1001 }],
    });
    expect(withdrawalPreview(1000, [1001])).toEqual({
      withdrawalCents: 1001,
      breakCents: 0,
      surplusCents: 1,
    });
  });

  it("ignora a opção desligada e mantém a retirada num dia que já sobra", () => {
    expect(save({ shortageCents: 1000, enabled: false, rows: [{ sellerId: "ana", amount: "400" }] })).toEqual({
      ok: true,
      lines: [],
    });
    expect(save({ shortageCents: 0, rows: [{ sellerId: "ana", amount: "400" }] })).toEqual({
      ok: true,
      lines: [{ sellerId: "ana", cents: 400 }],
    });
  });

  it("pede funcionário, valor e linha única", () => {
    expect(save({ shortageCents: 1000, rows: [{ sellerId: "", amount: "100" }] })).toEqual({
      ok: false,
      message: "Escolha o funcionário da retirada.",
    });
    expect(save({ shortageCents: 1000, rows: [{ sellerId: "ana", amount: "" }] })).toEqual({
      ok: false,
      message: "Informe o valor da retirada de ANA.",
    });
    expect(
      save({
        shortageCents: 1000,
        rows: [
          { sellerId: "ana", amount: "100" },
          { sellerId: "ana", amount: "200" },
        ],
      }),
    ).toEqual({ ok: false, message: "ANA está em mais de uma retirada." });
  });

  it("descarta linha em branco", () => {
    expect(
      save({
        shortageCents: 1000,
        rows: [
          { sellerId: "", amount: "" },
          { sellerId: "bia", amount: "250" },
        ],
      }),
    ).toEqual({ ok: true, lines: [{ sellerId: "bia", cents: 250 }] });
  });

  it("lista ativos, inclusive gerência, e mantém quem já saiu se a retirada existe", () => {
    const people = withdrawalPeople(
      [
        { id: "ana", name: "ANA", active: true },
        { id: "gerente", name: "GERENTE", active: true },
        { id: "saiu", name: "CARLA", active: false },
        { id: "old", name: "DANI", active: false },
      ],
      ["old"],
    );
    expect(people.map((person) => person.id)).toEqual(["ana", "old", "gerente"]);
  });

  it("reabre o rascunho a partir do que foi gravado", () => {
    expect(withdrawalDraftFrom([{ sellerId: "ana", cents: 1500 }], (cents) => String(cents))).toEqual({
      enabled: true,
      rows: [{ id: "ana", sellerId: "ana", amount: "1500" }],
    });
    expect(parseWithdrawalRows([{ sellerId: "ana", cents: 10 }, { sellerId: "", cents: 5 }, { sellerId: "bia", cents: 0 }])).toEqual([
      { sellerId: "ana", cents: 10 },
    ]);
  });
});
