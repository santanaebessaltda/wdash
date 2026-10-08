import { describe, expect, it } from "vitest";
import {
  localClock,
  nextAutoRefreshAt,
  parseStoreHours,
  pendingDays,
  planAutoRound,
  recoveryFloor,
  storePhase,
  type AutoStore,
} from "./autoRefresh.ts";

const TZ = "America/Campo_Grande"; // UTC4
/** Horario local em Campo Grande  ->  Date. */
const at = (isoLocal: string) => new Date(`${isoLocal}-04:00`);

const weekdays = parseStoreHours({
  "0": null,
  "1": { open: "10:00", close: "22:00" },
  "2": { open: "10:00", close: "22:00" },
  "3": { open: "10:00", close: "22:00" },
  "4": { open: "10:00", close: "22:00" },
  "5": { open: "10:00", close: "22:00" },
  "6": { open: "10:00", close: "22:00" },
});
const semHorario = parseStoreHours(null);

describe("localClock", () => {
  it("dia, dia da semana e minuto no fuso", () => {
    // 2026-09-25 e sexta.
    expect(localClock(at("2026-09-25T13:45:00"), TZ)).toEqual({ day: "2026-09-25", dow: 5, minutes: 13 * 60 + 45 });
  });
});

describe("storePhase", () => {
  it("antes, aberta, fechou há < 30 min, última rodada devida, fechada / sem horário", () => {
    expect(storePhase(weekdays, at("2026-09-25T09:59:00"), TZ)).toBe("before");
    expect(storePhase(weekdays, at("2026-09-25T10:00:00"), TZ)).toBe("open");
    expect(storePhase(weekdays, at("2026-09-25T22:10:00"), TZ)).toBe("wrapup");
    expect(storePhase(weekdays, at("2026-09-25T22:30:00"), TZ)).toBe("finalDue");
    expect(storePhase(weekdays, at("2026-09-27T12:00:00"), TZ)).toBe("closed"); // domingo
    expect(storePhase(semHorario, at("2026-09-25T12:00:00"), TZ)).toBe("closed");
  });
});

describe("pendingDays", () => {
  it("dias entre o último fechado e hoje, no máx. 3, do mais antigo", () => {
    expect(pendingDays("2026-09-24", "2026-09-25")).toEqual([]);
    expect(pendingDays("2026-09-20", "2026-09-25")).toEqual(["2026-09-21", "2026-09-22", "2026-09-23"]);
  });
  it("sem base = nada; chão = dia 1 do mês anterior", () => {
    expect(pendingDays(null, "2026-09-25")).toEqual([]);
    expect(recoveryFloor("2026-01-10")).toBe("2025-12-01");
    expect(pendingDays("2026-05-01", "2026-09-25", 1)).toEqual(["2026-08-01"]);
  });
});

describe("planAutoRound", () => {
  const store = (id: string, lastSyncAt: string | null = null, hours = weekdays): AutoStore => ({
    id,
    timezone: TZ,
    hours,
    lastSyncAt: lastSyncAt ? at(lastSyncAt) : null,
  });

  it("lojas no expediente quando o intervalo venceu; sem horário fica de fora", () => {
    const now = at("2026-09-25T14:00:00");
    expect(
      planAutoRound({ stores: [store("a"), store("b", null, semHorario)], now, intervalMin: 30, lastAutoAt: null }),
    ).toEqual({ storeIds: ["a"] });
    expect(
      planAutoRound({ stores: [store("a")], now, intervalMin: 30, lastAutoAt: at("2026-09-25T13:40:00") }),
    ).toBeNull();
  });

  it("rodada perdida (desconectado) → lojas abertas assim que voltar", () => {
    expect(
      planAutoRound({
        stores: [store("a"), store("b")],
        now: at("2026-09-25T15:26:00"),
        intervalMin: 30,
        lastAutoAt: at("2026-09-25T14:52:00"),
      }),
    ).toEqual({ storeIds: ["a", "b"] });
  });

  it("fechamento + 30 min: última rodada do dia (uma vez; falhou → tenta a cada 10 min)", () => {
    const now = at("2026-09-25T22:35:00");
    expect(
      planAutoRound({ stores: [store("a", "2026-09-25T21:50:00")], now, intervalMin: 30, lastAutoAt: at("2026-09-25T22:20:00") }),
    ).toEqual({ storeIds: ["a"] });
    expect(
      planAutoRound({ stores: [store("a", "2026-09-25T22:31:00")], now, intervalMin: 30, lastAutoAt: at("2026-09-25T22:30:00") }),
    ).toBeNull();
    expect(
      planAutoRound({ stores: [store("a", "2026-09-25T21:50:00")], now, intervalMin: 30, lastAutoAt: at("2026-09-25T22:30:00") }),
    ).toBeNull();
  });

  it("fora do expediente (antes de abrir, entre o fechamento e +30 min, madrugada) não roda", () => {
    for (const t of ["2026-09-25T08:00:00", "2026-09-25T22:15:00", "2026-09-26T03:00:00"]) {
      expect(
        planAutoRound({ stores: [store("a", "2026-09-25T22:31:00")], now: at(t), intervalMin: 30, lastAutoAt: null }),
      ).toBeNull();
    }
  });
});

describe("nextAutoRefreshAt", () => {
  const s = { timezone: TZ, hours: weekdays };
  const next = (now: string, lastAutoAt: string | null, stores = [s]) =>
    nextAutoRefreshAt({ stores, now: at(now), intervalMin: 30, lastAutoAt: lastAutoAt ? at(lastAutoAt) : null });
  it("aberta: última rodada automática + intervalo; atrasada = agora", () => {
    expect(next("2026-09-25T14:10:00", "2026-09-25T14:00:00")).toEqual(at("2026-09-25T14:30:00"));
    expect(next("2026-09-25T15:26:00", "2026-09-25T14:52:00")).toEqual(at("2026-09-25T15:26:00"));
  });
  it("intervalo passa do fechamento → última rodada (fechamento + 30 min)", () => {
    expect(next("2026-09-25T21:50:00", "2026-09-25T21:45:00")).toEqual(at("2026-09-25T22:30:00"));
    expect(next("2026-09-25T22:10:00", null)).toEqual(at("2026-09-25T22:30:00"));
  });
  it("depois do fechamento + 30 min / fechada / sem horário = sem próxima", () => {
    expect(next("2026-09-25T22:40:00", null)).toBeNull();
    expect(next("2026-09-27T12:00:00", null)).toBeNull();
    expect(next("2026-09-25T12:00:00", null, [{ timezone: TZ, hours: semHorario }])).toBeNull();
  });
});
