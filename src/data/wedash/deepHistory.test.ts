import { describe, expect, it } from "vitest";
import {
  addMonths,
  deepHistoryCap,
  deepHistoryFloor,
  deepHistoryProgress,
  isDeepHistoryWindow,
  monthsInclusive,
  planDeepHistory,
  type DeepStore,
} from "./deepHistory";

const TZ = "America/Sao_Paulo";
const at = (hhmm: string) => new Date(`2026-09-25T${hhmm}:00-03:00`);
const store = { timezone: TZ };

describe("isDeepHistoryWindow", () => {
  it("madrugada = 0h–6h no fuso da loja", () => {
    expect(isDeepHistoryWindow([store], at("23:59"))).toBe(false);
    expect(isDeepHistoryWindow([store], at("00:00"))).toBe(true);
    expect(isDeepHistoryWindow([store], at("03:00"))).toBe(true);
    expect(isDeepHistoryWindow([store], at("05:59"))).toBe(true);
    expect(isDeepHistoryWindow([store], at("06:00"))).toBe(false);
    expect(isDeepHistoryWindow([store], at("15:00"))).toBe(false);
  });

  it("todas as lojas precisam estar na madrugada", () => {
    const cuiaba = { timezone: "America/Cuiaba" }; // 1h a menos que Sao Paulo
    expect(isDeepHistoryWindow([store, cuiaba], at("00:30"))).toBe(false);
    expect(isDeepHistoryWindow([store, cuiaba], at("01:30"))).toBe(true);
    expect(isDeepHistoryWindow([], at("03:00"))).toBe(false);
  });
});

describe("deepHistoryFloor", () => {
  it("inauguração, sem passar do teto", () => {
    expect(deepHistoryFloor("2025-03-10", "2024-10-01")).toBe("2025-03-10");
    expect(deepHistoryFloor("2019-01-01", "2024-10-01")).toBe("2024-10-01");
    expect(deepHistoryFloor(null, "2024-10-01")).toBe("2024-10-01");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01");
  });
});

describe("planDeepHistory", () => {
  const s = (over: Partial<DeepStore>): DeepStore => ({
    id: "s1",
    oldestDay: "2026-08-01",
    floor: "2024-09-01",
    emptyTail: false,
    ...over,
  });

  it("mês anterior ao mais antigo gravado, juntando as lojas no mesmo mês", () => {
    expect(planDeepHistory([s({}), s({ id: "s2" })])).toEqual({
      day: "2026-07-31",
      fillUntil: "2026-07-01",
      storeIds: ["s1", "s2"],
    });
  });

  it("loja atrasada espera: primeiro o mês mais recente que falta", () => {
    expect(planDeepHistory([s({}), s({ id: "s2", oldestDay: "2026-07-01" })])).toEqual({
      day: "2026-07-31",
      fillUntil: "2026-07-01",
      storeIds: ["s1"],
    });
  });

  it("para na inauguração (no meio do mês) e em loja sem venda nos meses mais antigos", () => {
    expect(planDeepHistory([s({ floor: "2026-07-10" })])?.fillUntil).toBe("2026-07-10");
    expect(planDeepHistory([s({ oldestDay: "2026-07-10", floor: "2026-07-10" })])).toBeNull();
    expect(planDeepHistory([s({ emptyTail: true })])).toBeNull();
    expect(planDeepHistory([s({ oldestDay: null })])).toBeNull();
  });
});

describe("deepHistoryProgress (barra da tela)", () => {
  const s = (over: Partial<DeepStore>): DeepStore => ({
    id: "s1",
    oldestDay: "2026-08-01",
    floor: "2024-10-01",
    emptyTail: false,
    ...over,
  });

  it("meses inclusivos e teto UI (24m contando o atual)", () => {
    expect(monthsInclusive("2024-10-01", "2026-09-01")).toBe(24);
    expect(deepHistoryCap("2026-10-07", 24)).toBe("2024-11-01");
  });

  it("% pelos meses já cobertos até o horizonte (mês passado)", () => {
    // Horizonte = set/2026; floor out/2024 → 24 meses. oldest = ago/2026 → falta jul…out = 22; done = 2.
    expect(deepHistoryProgress([s({})], "2026-10-07")).toEqual({
      done: 2,
      total: 24,
      nextMonth: "2026-07-01",
    });
  });

  it("completo (chegou no floor) ou ainda no onboarding = null / 100%", () => {
    expect(deepHistoryProgress([s({ oldestDay: null })], "2026-10-07")).toBeNull();
    expect(deepHistoryProgress([s({ oldestDay: "2024-10-01", floor: "2024-10-01" })], "2026-10-07")).toEqual({
      done: 24,
      total: 24,
      nextMonth: null,
    });
    expect(deepHistoryProgress([s({ emptyTail: true })], "2026-10-07")).toEqual({
      done: 24,
      total: 24,
      nextMonth: null,
    });
  });
});
