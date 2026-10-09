import { describe, expect, it } from "vitest";
import { crossDay, monthCharge, stoneStoredToInstant } from "./saleCross";

const TZ = "America/Campo_Grande";

describe("stoneStoredToInstant", () => {
  it("trata o Z da Stone como relógio de Campo Grande", () => {
    const instant = stoneStoredToInstant("2026-10-08T12:20:05.000Z", TZ);
    expect(new Date(instant).toISOString()).toBe("2026-10-08T16:20:05.000Z");
  });
});

describe("crossDay", () => {
  it("conta o par da mesma forma e lista a invertida", () => {
    const result = crossDay({
      timeZone: TZ,
      shifts: [],
      sales: [
        { occurredAt: "2026-10-08T16:20:00.000Z", paymentMethod: "Cartão de crédito", sellerName: "Ana", revenueCents: 1000 },
        { occurredAt: "2026-10-08T16:30:00.000Z", paymentMethod: "Cartão de crédito", sellerName: "Bia", revenueCents: 2000 },
      ],
      captures: [
        { occurredAt: "2026-10-08T12:20:20.000Z", paymentMethod: "Cartão de crédito", capturedCents: 1000 },
        { occurredAt: "2026-10-08T12:30:10.000Z", paymentMethod: "Cartão de débito", capturedCents: 2000 },
      ],
    });
    expect(result.matched).toBe(1);
    expect(result.rows).toEqual([
      {
        status: "invertida",
        occurredAt: "2026-10-08T16:30:00.000Z",
        cents: 2000,
        millenniumMethod: "Cartão de crédito",
        stoneMethod: "Cartão de débito",
        sellerName: "Bia",
        group: "",
        day: "",
      },
    ]);
  });

  it("não cruza fora de 3 minutos e aponta o grupo quando não há vendedor", () => {
    const result = crossDay({
      timeZone: TZ,
      shifts: [{ name: "GRUPO 1", start: "08:00", end: "14:00" }],
      sales: [{ occurredAt: "2026-10-08T16:20:00.000Z", paymentMethod: "PIX", sellerName: "", revenueCents: 4300 }],
      captures: [{ occurredAt: "2026-10-08T12:30:00.000Z", paymentMethod: "PIX", capturedCents: 4300 }],
    });
    expect(result.matched).toBe(0);
    expect(result.rows.map((row) => row.status).sort()).toEqual(["sem-captura", "sem-venda"]);
    expect(result.rows.find((row) => row.status === "sem-captura")?.group).toBe("GRUPO 1");
  });
});

describe("monthCharge", () => {
  it("não desconta mês zerado ou positivo", () => {
    expect(monthCharge({ monthDiffCents: 0, cashier: false, cashierName: "", rows: [], sellersByDay: new Map() })).toBeNull();
  });

  it("na loja de rua a quebra do mês é do caixa", () => {
    const charge = monthCharge({ monthDiffCents: -38820, cashier: true, cashierName: "Caixa CG", rows: [], sellersByDay: new Map() });
    expect(charge?.people).toEqual([{ name: "Caixa CG", cents: 38820 }]);
  });

  it("no quiosque reparte o mês na proporção do que foi apontado, sem passar do total", () => {
    const charge = monthCharge({
      monthDiffCents: -10000,
      cashier: false,
      cashierName: "",
      rows: [
        { status: "sem-captura", occurredAt: "", cents: 8000, millenniumMethod: "", stoneMethod: "", sellerName: "Ana", group: "", day: "2026-10-08" },
        { status: "sem-captura", occurredAt: "", cents: 2000, millenniumMethod: "", stoneMethod: "", sellerName: "Bia", group: "", day: "2026-10-08" },
      ],
      sellersByDay: new Map(),
    });
    expect(charge?.people).toEqual([
      { name: "Ana", cents: 8000 },
      { name: "Bia", cents: 2000 },
    ]);
  });
});
