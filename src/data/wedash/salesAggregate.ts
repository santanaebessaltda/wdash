import type {
  AggregateSalesResult,
  CashCloseSale,
  SaleRow,
  SalesBrand,
  SalesDayAgg,
  SalesHourAgg,
  SalesPaymentDayAgg,
  SalesSellerDayAgg,
} from "./salesTypes";
import { titleName } from "../../lib/format";

export type AggregateSalesOptions = {
  tenantId: string;
  timeZone: string;
  /** Clock for “today” hour filtering (injectable in tests). */
  now?: Date;
  /**
   * Quando a Lista veio de uma janela [dayFrom, dayTo]:
   * - dia local < dayFrom → prende em dayFrom (ex.: 31/07→01/08 no fuso)
   * - dia local > dayTo → ignora a linha (fica pro próximo chunk; senão
   *   duplicava: ago clampava 01/09 em 31/08 e set gravava de novo)
   */
  dayFrom?: string;
  dayTo?: string;
};

type DayKey = string;
type HourKey = string;
type PayKey = string;
type SellerKey = string;

type DayBucket = {
  storeId: string;
  day: string;
  brand: SalesBrand;
  revenueCents: number;
  itemCount: number;
  ops: Set<string>;
};

type HourBucket = DayBucket & { hour: number };

type PayBucket = {
  storeId: string;
  day: string;
  paymentMethod: string;
  revenueCents: number;
  ops: Set<string>;
};

type SellerBucket = {
  storeId: string;
  day: string;
  sellerKey: string;
  sellerName: string;
  sellerGeradorId: number | null;
  revenueCents: number;
  itemCount: number;
  ops: Set<string>;
};

function localDayHour(date: Date, timeZone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;

  return { day: `${year}-${month}-${day}`, hour };
}

function dayKey(storeId: string, day: string, brand: SalesBrand): DayKey {
  return `${storeId}|${day}|${brand}`;
}

function hourKey(storeId: string, day: string, hour: number, brand: SalesBrand): HourKey {
  return `${storeId}|${day}|${hour}|${brand}`;
}

function payKey(storeId: string, day: string, method: string): PayKey {
  return `${storeId}|${day}|${method}`;
}

function sellerBucketKey(storeId: string, day: string, key: string): SellerKey {
  return `${storeId}|${day}|${key}`;
}

/**
 * Chave estável do nome da vendedora (trim, sem acento, upper, espaços colapsados).
 * Vazio → null (fora do ranking; permanece no faturamento da loja).
 */
export function sellerKeyFromName(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const key = s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  return key || null;
}

/** Nome gravado da vendedora: primeira letra de cada palavra maiúscula ("Ana Paula de Souza"). */
export function sellerDisplayName(raw: string): string {
  return titleName(raw);
}

/**
 * Normaliza CONDICAO do Millennium → label de UI.
 * Aceita códigos curtos (PIX) e nomes longos (CARTÃO DE CRÉDITO).
 */
export function normalizePaymentMethod(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "Outros";
  const key = s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

  if (key === "PIX" || key.includes("PIX")) return "Pix";
  if (
    key === "CREDITO" ||
    key.includes("CARTAO DE CREDITO") ||
    key.includes("CARTAO CREDITO") ||
    (key.includes("CREDITO") && !key.includes("DEBITO"))
  ) {
    return "Cartão de crédito";
  }
  if (
    key === "DEBITO" ||
    key.includes("CARTAO DE DEBITO") ||
    key.includes("CARTAO DEBITO") ||
    key.includes("DEBITO")
  ) {
    return "Cartão de débito";
  }
  if (key === "DINHEIRO" || key.includes("DINHEIRO") || key === "CASH") return "Dinheiro";
  if (key.includes("TROCA") || key.includes("VALE")) return "Troca / vale";
  if (key.includes("CHEQUE")) return "Cheque";
  if (key.includes("BOLETO")) return "Boleto";

  // Title-case residual (ex.: "VENDA MISTA" → "Venda Mista")
  return s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/**
 * Pure aggregator: SaleRow[] → day/hour aggs.
 * Buckets by store-local DATA_H (occurredAt); sales_count = distinct operationCode.
 * Hour buckets only for the current local calendar day.
 */
export function aggregateSales(
  rows: SaleRow[],
  opts: AggregateSalesOptions,
): AggregateSalesResult {
  const now = opts.now ?? new Date();
  const todayLocal = localDayHour(now, opts.timeZone).day;

  const daysMap = new Map<DayKey, DayBucket>();
  const hoursMap = new Map<HourKey, HourBucket>();

  for (const row of rows) {
    const brand: SalesBrand = row.brand ?? "ALL";
    let { day, hour } = localDayHour(row.occurredAt, opts.timeZone);
    if (opts.dayTo && day > opts.dayTo) continue;
    if (opts.dayFrom && day < opts.dayFrom) day = opts.dayFrom;

    const dk = dayKey(row.storeId, day, brand);
    let dayBucket = daysMap.get(dk);
    if (!dayBucket) {
      dayBucket = {
        storeId: row.storeId,
        day,
        brand,
        revenueCents: 0,
        itemCount: 0,
        ops: new Set(),
      };
      daysMap.set(dk, dayBucket);
    }
    dayBucket.revenueCents += row.revenueCents;
    dayBucket.itemCount += row.itemQty;
    dayBucket.ops.add(row.operationCode);

    if (day === todayLocal) {
      const hk = hourKey(row.storeId, day, hour, brand);
      let hourBucket = hoursMap.get(hk);
      if (!hourBucket) {
        hourBucket = {
          storeId: row.storeId,
          day,
          hour,
          brand,
          revenueCents: 0,
          itemCount: 0,
          ops: new Set(),
        };
        hoursMap.set(hk, hourBucket);
      }
      hourBucket.revenueCents += row.revenueCents;
      hourBucket.itemCount += row.itemQty;
      hourBucket.ops.add(row.operationCode);
    }
  }

  const days: SalesDayAgg[] = [...daysMap.values()]
    .map((b) => ({
      tenantId: opts.tenantId,
      storeId: b.storeId,
      day: b.day,
      brand: b.brand,
      revenueCents: b.revenueCents,
      salesCount: b.ops.size,
      itemCount: b.itemCount,
    }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.storeId.localeCompare(b.storeId));

  const hours: SalesHourAgg[] = [...hoursMap.values()]
    .map((b) => ({
      tenantId: opts.tenantId,
      storeId: b.storeId,
      day: b.day,
      hour: b.hour,
      brand: b.brand,
      revenueCents: b.revenueCents,
      salesCount: b.ops.size,
      itemCount: b.itemCount,
    }))
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        a.hour - b.hour ||
        a.storeId.localeCompare(b.storeId),
    );

  return { days, hours };
}

/**
 * Agrega receita por CONDICAO (dia × loja). brand sempre ALL.
 * Usa `paymentMethod` já normalizado na linha; fallback "Outros".
 */
export function aggregatePaymentDay(
  rows: SaleRow[],
  opts: AggregateSalesOptions,
): SalesPaymentDayAgg[] {
  const map = new Map<PayKey, PayBucket>();

  for (const row of rows) {
    let { day } = localDayHour(row.occurredAt, opts.timeZone);
    if (opts.dayTo && day > opts.dayTo) continue;
    if (opts.dayFrom && day < opts.dayFrom) day = opts.dayFrom;

    const method = normalizePaymentMethod(row.paymentMethod);
    const pk = payKey(row.storeId, day, method);
    let bucket = map.get(pk);
    if (!bucket) {
      bucket = {
        storeId: row.storeId,
        day,
        paymentMethod: method,
        revenueCents: 0,
        ops: new Set(),
      };
      map.set(pk, bucket);
    }
    bucket.revenueCents += row.revenueCents;
    bucket.ops.add(row.operationCode);
  }

  return [...map.values()]
    .map((b) => ({
      tenantId: opts.tenantId,
      storeId: b.storeId,
      day: b.day,
      paymentMethod: b.paymentMethod,
      brand: "ALL" as const,
      revenueCents: b.revenueCents,
      salesCount: b.ops.size,
    }))
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        a.storeId.localeCompare(b.storeId) ||
        a.paymentMethod.localeCompare(b.paymentMethod, "pt-BR"),
    );
}

/**
 * Uma linha por venda × forma, com hora e vendedor.
 * O agregado diário de formas não muda: isto só guarda o detalhe para o fechamento de caixa.
 * Venda de R$ 0 fica de fora. Dia além de dayTo também (mesmo corte do agregado).
 */
export function cashCloseSalesFromRows(rows: SaleRow[], opts: AggregateSalesOptions): CashCloseSale[] {
  const map = new Map<string, CashCloseSale>();

  for (const row of rows) {
    if (row.revenueCents === 0) continue;
    let { day } = localDayHour(row.occurredAt, opts.timeZone);
    if (opts.dayTo && day > opts.dayTo) continue;
    if (opts.dayFrom && day < opts.dayFrom) day = opts.dayFrom;

    const method = normalizePaymentMethod(row.paymentMethod);
    const key = `${row.storeId}|${row.operationCode}|${method}`;
    const sellerName = (row.sellerName ?? "").trim();
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        tenantId: opts.tenantId,
        storeId: row.storeId,
        operationCode: row.operationCode,
        day,
        occurredAt: row.occurredAt.toISOString(),
        paymentMethod: method,
        revenueCents: row.revenueCents,
        sellerName,
        sellerGeradorId: row.sellerGeradorId ?? null,
      });
      continue;
    }
    prev.revenueCents += row.revenueCents;
    if (row.occurredAt.toISOString() < prev.occurredAt) prev.occurredAt = row.occurredAt.toISOString();
    if (!prev.sellerName && sellerName) prev.sellerName = sellerName;
    if (prev.sellerGeradorId == null && row.sellerGeradorId != null) prev.sellerGeradorId = row.sellerGeradorId;
  }

  return [...map.values()].sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.occurredAt.localeCompare(b.occurredAt) ||
      a.operationCode.localeCompare(b.operationCode) ||
      a.paymentMethod.localeCompare(b.paymentMethod, "pt-BR"),
  );
}

/**
 * Agrega receita por vendedora (dia × loja). brand sempre ALL.
 * Sem nome (sellerKey null) → ignora — fica no fat. da loja, fora do ranking.
 */
export function aggregateSellerDay(
  rows: SaleRow[],
  opts: AggregateSalesOptions,
): SalesSellerDayAgg[] {
  const map = new Map<SellerKey, SellerBucket>();

  for (const row of rows) {
    let { day } = localDayHour(row.occurredAt, opts.timeZone);
    if (opts.dayTo && day > opts.dayTo) continue;
    if (opts.dayFrom && day < opts.dayFrom) day = opts.dayFrom;

    const key = sellerKeyFromName(row.sellerName);
    if (!key) continue;
    const display = sellerDisplayName(row.sellerName ?? key);
    const sk = sellerBucketKey(row.storeId, day, key);
    let bucket = map.get(sk);
    if (!bucket) {
      bucket = {
        storeId: row.storeId,
        day,
        sellerKey: key,
        sellerName: display,
        sellerGeradorId: null,
        revenueCents: 0,
        itemCount: 0,
        ops: new Set(),
      };
      map.set(sk, bucket);
    }
    if (bucket.sellerGeradorId == null && row.sellerGeradorId != null) bucket.sellerGeradorId = row.sellerGeradorId;
    bucket.revenueCents += row.revenueCents;
    bucket.itemCount += row.itemQty;
    bucket.ops.add(row.operationCode);
  }

  return [...map.values()]
    .map((b) => ({
      tenantId: opts.tenantId,
      storeId: b.storeId,
      day: b.day,
      sellerKey: b.sellerKey,
      sellerName: b.sellerName,
      ...(b.sellerGeradorId != null ? { sellerGeradorId: b.sellerGeradorId } : {}),
      brand: "ALL" as const,
      revenueCents: b.revenueCents,
      salesCount: b.ops.size,
      itemCount: b.itemCount,
    }))
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        a.storeId.localeCompare(b.storeId) ||
        a.sellerKey.localeCompare(b.sellerKey),
    );
}
