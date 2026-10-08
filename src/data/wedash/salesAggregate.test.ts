import { describe, expect, it } from "vitest";
import {
  aggregatePaymentDay,
  aggregateSales,
  aggregateSellerDay,
  cashCloseSalesFromRows,
  normalizePaymentMethod,
  sellerDisplayName,
  sellerKeyFromName,
} from "./salesAggregate";
import type { SaleRow } from "./salesTypes";

/** America/Campo_Grande = UTC−4 year-round (MS). */
const TZ = "America/Campo_Grande";
const TENANT = "tenant-1";
const STORE = "store-1";

function row(partial: Partial<SaleRow> & Pick<SaleRow, "operationCode" | "occurredAt">): SaleRow {
  return {
    revenueCents: 10_00,
    itemQty: 1,
    storeId: STORE,
    brand: "ALL",
    ...partial,
  };
}

describe("aggregateSales", () => {
  it("returns empty day and hour arrays for zero rows", () => {
    const result = aggregateSales([], { tenantId: TENANT, timeZone: TZ, now: new Date("2026-09-19T12:00:00Z") });
    expect(result.days).toEqual([]);
    expect(result.hours).toEqual([]);
  });

  it("counts sales_count as distinct operationCode (duplicate lines do not double sales)", () => {
    const rows: SaleRow[] = [
      row({
        operationCode: "OP-1001",
        occurredAt: new Date("2026-09-18T15:30:00.000Z"),
        revenueCents: 189_90,
        itemQty: 2,
      }),
      row({
        operationCode: "OP-1001",
        occurredAt: new Date("2026-09-18T15:30:00.000Z"),
        revenueCents: 89_90,
        itemQty: 1,
      }),
      row({
        operationCode: "OP-1002",
        occurredAt: new Date("2026-09-18T18:05:00.000Z"),
        revenueCents: 249_00,
        itemQty: 3,
      }),
    ];
    const { days } = aggregateSales(rows, {
      tenantId: TENANT,
      timeZone: TZ,
      now: new Date("2026-09-20T12:00:00Z"),
    });
    expect(days).toHaveLength(1);
    expect(days[0].day).toBe("2026-09-18");
    expect(days[0].salesCount).toBe(2);
    expect(days[0].revenueCents).toBe(189_90 + 89_90 + 249_00);
    expect(days[0].itemCount).toBe(6);
  });

  it("buckets by local DATA_H date across multiple calendar days", () => {
    const rows: SaleRow[] = [
      row({
        operationCode: "A",
        occurredAt: new Date("2026-09-18T15:00:00.000Z"),
        revenueCents: 100_00,
      }),
      row({
        operationCode: "B",
        occurredAt: new Date("2026-09-19T15:00:00.000Z"),
        revenueCents: 200_00,
      }),
    ];
    const { days } = aggregateSales(rows, {
      tenantId: TENANT,
      timeZone: TZ,
      now: new Date("2026-09-20T12:00:00Z"),
    });
    const byDay = Object.fromEntries(days.map((d) => [d.day, d]));
    expect(Object.keys(byDay).sort()).toEqual(["2026-09-18", "2026-09-19"]);
    expect(byDay["2026-09-18"].revenueCents).toBe(100_00);
    expect(byDay["2026-09-19"].revenueCents).toBe(200_00);
  });

  it("uses local DATA_H day — UTC midnight trap (Campo_Grande UTC−4)", () => {
    // 2026-09-19T03:30:00Z = 2026-09-18 23:30 local — must NOT land on 19th
    const rows: SaleRow[] = [
      row({
        operationCode: "TRAP",
        occurredAt: new Date("2026-09-19T03:30:00.000Z"),
        revenueCents: 59_90,
      }),
    ];
    const { days, hours } = aggregateSales(rows, {
      tenantId: TENANT,
      timeZone: TZ,
      now: new Date("2026-09-20T12:00:00Z"),
    });
    expect(days).toHaveLength(1);
    expect(days[0].day).toBe("2026-09-18");
    expect(hours).toEqual([]);
  });

  it("emits hour buckets only for the current local calendar day", () => {
    const now = new Date("2026-09-19T20:00:00.000Z"); // local 16:00 on 19th
    const rows: SaleRow[] = [
      row({
        operationCode: "YEST",
        occurredAt: new Date("2026-09-18T15:00:00.000Z"),
        revenueCents: 50_00,
      }),
      row({
        operationCode: "TODAY-AM",
        occurredAt: new Date("2026-09-19T14:00:00.000Z"), // local 10:00
        revenueCents: 80_00,
      }),
      row({
        operationCode: "TODAY-PM",
        occurredAt: new Date("2026-09-19T18:00:00.000Z"), // local 14:00
        revenueCents: 120_00,
      }),
    ];
    const { days, hours } = aggregateSales(rows, { tenantId: TENANT, timeZone: TZ, now });
    expect(days.map((d) => d.day).sort()).toEqual(["2026-09-18", "2026-09-19"]);
    expect(hours.every((h) => h.day === "2026-09-19")).toBe(true);
    expect(hours).toHaveLength(2);
    const byHour = Object.fromEntries(hours.map((h) => [h.hour, h]));
    expect(byHour[10].salesCount).toBe(1);
    expect(byHour[10].revenueCents).toBe(80_00);
    expect(byHour[14].revenueCents).toBe(120_00);
  });

  it("clamps local day before dayFrom into the window start", () => {
    // 2026-07-31T23:00 local CG ≈ 2026-08-01T03:00Z
    const rows: SaleRow[] = [
      row({
        operationCode: "EDGE",
        occurredAt: new Date("2026-08-01T03:00:00.000Z"),
        revenueCents: 53_80,
      }),
    ];
    const { days } = aggregateSales(rows, {
      tenantId: TENANT,
      timeZone: TZ,
      now: new Date("2026-09-19T12:00:00Z"),
      dayFrom: "2026-08-01",
      dayTo: "2026-08-31",
    });
    expect(days).toHaveLength(1);
    expect(days[0].day).toBe("2026-08-01");
    expect(days[0].revenueCents).toBe(53_80);
  });

  it("drops rows whose local day is after dayTo (avoid double-count next chunk)", () => {
    const rows: SaleRow[] = [
      row({
        operationCode: "SEP1",
        occurredAt: new Date("2026-09-01T15:00:00.000Z"),
        revenueCents: 13_128_56,
      }),
      row({
        operationCode: "AUG31",
        occurredAt: new Date("2026-08-31T15:00:00.000Z"),
        revenueCents: 10_216_03,
      }),
    ];
    const { days } = aggregateSales(rows, {
      tenantId: TENANT,
      timeZone: TZ,
      now: new Date("2026-09-19T12:00:00Z"),
      dayFrom: "2026-08-01",
      dayTo: "2026-08-31",
    });
    expect(days).toHaveLength(1);
    expect(days[0].day).toBe("2026-08-31");
    expect(days[0].revenueCents).toBe(10_216_03);
  });
});

describe("normalizePaymentMethod", () => {
  it("maps common CONDICAO codes", () => {
    expect(normalizePaymentMethod("PIX")).toBe("Pix");
    expect(normalizePaymentMethod("CREDITO")).toBe("Cartão de crédito");
    expect(normalizePaymentMethod("DEBITO")).toBe("Cartão de débito");
    expect(normalizePaymentMethod("DINHEIRO")).toBe("Dinheiro");
    expect(normalizePaymentMethod("")).toBe("Outros");
    expect(normalizePaymentMethod(null)).toBe("Outros");
  });
});

describe("cashCloseSalesFromRows", () => {
  it("guarda valor, forma, vendedor e hora sem somar o dia", () => {
    const rows: SaleRow[] = [
      row({
        operationCode: "C1",
        occurredAt: new Date("2026-10-07T18:40:00.000Z"),
        revenueCents: 99_90,
        paymentMethod: "CREDITO",
        sellerName: "Ana",
      }),
      row({
        operationCode: "C2",
        occurredAt: new Date("2026-10-07T18:41:00.000Z"),
        revenueCents: 99_90,
        paymentMethod: "DEBITO",
        sellerName: "Bia",
      }),
    ];
    const lines = cashCloseSalesFromRows(rows, {
      tenantId: TENANT,
      timeZone: TZ,
      dayFrom: "2026-10-07",
      dayTo: "2026-10-07",
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      operationCode: "C1",
      day: "2026-10-07",
      paymentMethod: "Cartão de crédito",
      revenueCents: 99_90,
      sellerName: "Ana",
    });
    expect(lines[1]?.paymentMethod).toBe("Cartão de débito");
    expect(lines[1]?.sellerName).toBe("Bia");
    const pay = aggregatePaymentDay(rows, { tenantId: TENANT, timeZone: TZ, dayFrom: "2026-10-07", dayTo: "2026-10-07" });
    expect(pay.reduce((s, p) => s + p.revenueCents, 0)).toBe(99_90 + 99_90);
  });

  it("ignora venda zerada e dia fora da janela", () => {
    const rows: SaleRow[] = [
      row({ operationCode: "Z", occurredAt: new Date("2026-10-07T15:00:00.000Z"), revenueCents: 0, paymentMethod: "PIX" }),
      row({ operationCode: "NEXT", occurredAt: new Date("2026-10-08T15:00:00.000Z"), revenueCents: 10_00, paymentMethod: "PIX" }),
    ];
    expect(cashCloseSalesFromRows(rows, { tenantId: TENANT, timeZone: TZ, dayFrom: "2026-10-07", dayTo: "2026-10-07" })).toEqual([]);
  });
});

describe("aggregatePaymentDay", () => {
  it("sums revenue by CONDICAO and counts distinct ops", () => {
    const rows: SaleRow[] = [
      row({
        operationCode: "OP-1",
        occurredAt: new Date("2026-09-18T15:30:00.000Z"),
        revenueCents: 100_00,
        paymentMethod: "PIX",
      }),
      row({
        operationCode: "OP-1",
        occurredAt: new Date("2026-09-18T15:30:00.000Z"),
        revenueCents: 50_00,
        paymentMethod: "PIX",
      }),
      row({
        operationCode: "OP-2",
        occurredAt: new Date("2026-09-18T16:00:00.000Z"),
        revenueCents: 80_00,
        paymentMethod: "CREDITO",
      }),
    ];
    const pay = aggregatePaymentDay(rows, {
      tenantId: TENANT,
      timeZone: TZ,
      now: new Date("2026-09-19T12:00:00Z"),
      dayFrom: "2026-09-18",
      dayTo: "2026-09-18",
    });
    expect(pay).toHaveLength(2);
    const pix = pay.find((p) => p.paymentMethod === "Pix")!;
    const cred = pay.find((p) => p.paymentMethod === "Cartão de crédito")!;
    expect(pix.revenueCents).toBe(150_00);
    expect(pix.salesCount).toBe(1);
    expect(cred.revenueCents).toBe(80_00);
    expect(cred.brand).toBe("ALL");
  });
});

describe("sellerKeyFromName / sellerDisplayName", () => {
  it("normalizes accents and case for stable keys", () => {
    expect(sellerKeyFromName("Emilly Victória")).toBe("EMILLY VICTORIA");
    expect(sellerKeyFromName("  emilly   victoria  ")).toBe("EMILLY VICTORIA");
    expect(sellerKeyFromName("")).toBeNull();
    expect(sellerKeyFromName(null)).toBeNull();
    expect(sellerDisplayName("EMILLY VICTORIA CANEDO")).toBe("Emilly Victoria Canedo");
    expect(sellerDisplayName("  emilly   victória ")).toBe("Emilly Victória");
    expect(sellerDisplayName("ANA PAULA DE SOUZA E SILVA")).toBe("Ana Paula de Souza e Silva");
    expect(sellerDisplayName("DA SILVA D'ÁVILA")).toBe("Da Silva D'Ávila");
  });
});

describe("aggregateSellerDay", () => {
  it("sums revenue by seller and skips empty names", () => {
    const rows: SaleRow[] = [
      row({
        operationCode: "OP-1",
        occurredAt: new Date("2026-09-18T15:30:00.000Z"),
        revenueCents: 100_00,
        sellerName: "VENDEDORA A",
      }),
      row({
        operationCode: "OP-1",
        occurredAt: new Date("2026-09-18T15:30:00.000Z"),
        revenueCents: 50_00,
        sellerName: "vendedora a",
      }),
      row({
        operationCode: "OP-2",
        occurredAt: new Date("2026-09-18T16:00:00.000Z"),
        revenueCents: 80_00,
        sellerName: "VENDEDORA B",
      }),
      row({
        operationCode: "OP-3",
        occurredAt: new Date("2026-09-18T17:00:00.000Z"),
        revenueCents: 999_00,
        sellerName: null,
      }),
    ];
    const sellers = aggregateSellerDay(rows, {
      tenantId: TENANT,
      timeZone: TZ,
      now: new Date("2026-09-19T12:00:00Z"),
      dayFrom: "2026-09-18",
      dayTo: "2026-09-18",
    });
    expect(sellers).toHaveLength(2);
    const a = sellers.find((s) => s.sellerKey === "VENDEDORA A")!;
    const b = sellers.find((s) => s.sellerKey === "VENDEDORA B")!;
    expect(a.revenueCents).toBe(150_00);
    expect(a.salesCount).toBe(1);
    expect(a.itemCount).toBe(2);
    expect(a.sellerName).toBe("Vendedora A");
    expect(b.revenueCents).toBe(80_00);
    expect(b.brand).toBe("ALL");
  });
});
