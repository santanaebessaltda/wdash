import { cashCloseBucket, type CashCloseBucket } from "./cashCloseView";
import { groupNameAt, splitEqual, type ShortageShift } from "./shortageAssign";

const WINDOW_MS = 3 * 60 * 1000;

export type CrossSale = {
  occurredAt: string;
  paymentMethod: string;
  sellerName: string;
  revenueCents: number;
};

export type CrossCapture = {
  occurredAt: string;
  paymentMethod: string;
  capturedCents: number;
  /** Código de autorização, quando a captura trouxer. A venda do Millennium ainda não tem. */
  authorizationCode?: string;
};

export type CrossRow = {
  status: "invertida" | "sem-captura" | "sem-venda";
  occurredAt: string;
  cents: number;
  millenniumMethod: string;
  stoneMethod: string;
  sellerName: string;
  group: string;
  day: string;
};

export type CrossDay = {
  matched: number;
  rows: CrossRow[];
};

function electronic(method: string): boolean {
  const bucket = cashCloseBucket(method);
  return bucket === "debit" || bucket === "credit" || bucket === "pix";
}

/** A hora gravada da Stone é o relógio da loja com sufixo Z. Devolve o instante UTC de verdade. */
export function stoneStoredToInstant(storedIso: string, timeZone: string): number {
  const parsed = new Date(storedIso);
  if (Number.isNaN(parsed.getTime())) return Number.NaN;
  const utcGuess = Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
    parsed.getUTCHours(),
    parsed.getUTCMinutes(),
    parsed.getUTCSeconds(),
  );
  const offset = zoneOffsetMs(utcGuess, timeZone);
  let instant = utcGuess - offset;
  const offsetAt = zoneOffsetMs(instant, timeZone);
  if (offsetAt !== offset) instant -= offsetAt - offset;
  return instant;
}

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  let hour = get("hour");
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - utcMs;
}

function saleInstant(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.NaN : t;
}

type Side = {
  at: number;
  cents: number;
  method: string;
  bucket: CashCloseBucket;
  sellerName: string;
  authorizationCode: string;
};

function who(sellerName: string, at: number, shifts: ShortageShift[], timeZone: string): { sellerName: string; group: string } {
  const seller = sellerName.trim();
  if (seller) return { sellerName: seller, group: "" };
  const group = groupNameAt(new Date(at).toISOString(), shifts, timeZone) ?? "";
  return { sellerName: "", group };
}

/**
 * Cruza cada venda eletrônica com a captura do mesmo valor na hora mais próxima (até 3 min),
 * em qualquer forma. Forma diferente = venda invertida. O que cruzou na mesma forma só entra na contagem.
 */
export function crossDay(input: {
  sales: CrossSale[];
  captures: CrossCapture[];
  shifts: ShortageShift[];
  timeZone: string;
  day?: string;
}): CrossDay {
  const sales: Side[] = input.sales
    .filter((sale) => electronic(sale.paymentMethod) && sale.revenueCents > 0)
    .map((sale) => ({
      at: saleInstant(sale.occurredAt),
      cents: sale.revenueCents,
      method: sale.paymentMethod,
      bucket: cashCloseBucket(sale.paymentMethod),
      sellerName: sale.sellerName,
      authorizationCode: "",
    }))
    .filter((sale) => Number.isFinite(sale.at))
    .sort((a, b) => a.at - b.at);
  const captures: Side[] = input.captures
    .filter((capture) => electronic(capture.paymentMethod) && capture.capturedCents > 0)
    .map((capture) => ({
      at: stoneStoredToInstant(capture.occurredAt, input.timeZone),
      cents: capture.capturedCents,
      method: capture.paymentMethod,
      bucket: cashCloseBucket(capture.paymentMethod),
      sellerName: "",
      authorizationCode: (capture.authorizationCode ?? "").trim(),
    }))
    .filter((capture) => Number.isFinite(capture.at));
  const used = new Set<number>();
  let matched = 0;
  const rows: CrossRow[] = [];
  for (const sale of sales) {
    let best = -1;
    let bestDist = WINDOW_MS + 1;
    let bestAuth = false;
    captures.forEach((capture, index) => {
      if (used.has(index) || capture.cents !== sale.cents) return;
      const dist = Math.abs(capture.at - sale.at);
      if (dist > WINDOW_MS) return;
      const auth =
        sale.authorizationCode.length > 0 &&
        capture.authorizationCode.length > 0 &&
        sale.authorizationCode === capture.authorizationCode;
      if (best >= 0 && dist > bestDist) return;
      if (best >= 0 && dist === bestDist && (!auth || bestAuth)) return;
      best = index;
      bestDist = dist;
      bestAuth = auth;
    });
    if (best < 0) {
      const place = who(sale.sellerName, sale.at, input.shifts, input.timeZone);
      rows.push({
        status: "sem-captura",
        occurredAt: new Date(sale.at).toISOString(),
        cents: sale.cents,
        millenniumMethod: sale.method,
        stoneMethod: "",
        ...place,
        day: input.day ?? "",
      });
      continue;
    }
    used.add(best);
    const capture = captures[best];
    if (!capture) continue;
    if (capture.bucket !== sale.bucket) {
      const place = who(sale.sellerName, sale.at, input.shifts, input.timeZone);
      rows.push({
        status: "invertida",
        occurredAt: new Date(sale.at).toISOString(),
        cents: sale.cents,
        millenniumMethod: sale.method,
        stoneMethod: capture.method,
        ...place,
        day: input.day ?? "",
      });
      continue;
    }
    matched += 1;
  }
  captures.forEach((capture, index) => {
    if (used.has(index)) return;
    const place = who("", capture.at, input.shifts, input.timeZone);
    rows.push({
      status: "sem-venda",
      occurredAt: new Date(capture.at).toISOString(),
      cents: capture.cents,
      millenniumMethod: "",
      stoneMethod: capture.method,
      ...place,
      day: input.day ?? "",
    });
  });
  rows.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return { matched, rows };
}

export type MonthCharge = {
  cents: number;
  people: { name: string; cents: number }[];
};

/** Desconto do mês. Null quando o mês não ficou negativo. A decisão continua fora da WDash. */
export function monthCharge(input: {
  monthDiffCents: number;
  cashier: boolean;
  cashierName: string;
  rows: CrossRow[];
  sellersByDay: Map<string, string[]>;
}): MonthCharge | null {
  if (input.monthDiffCents >= 0) return null;
  const shortage = -input.monthDiffCents;
  if (input.cashier) {
    return { cents: shortage, people: [{ name: input.cashierName.trim() || "Caixa", cents: shortage }] };
  }
  const byName = new Map<string, number>();
  const add = (name: string, cents: number) => {
    const key = name.trim();
    if (!key || cents <= 0) return;
    byName.set(key, (byName.get(key) ?? 0) + cents);
  };
  for (const row of input.rows) {
    if (row.cents <= 0) continue;
    if (row.sellerName.trim()) {
      add(row.sellerName, row.cents);
      continue;
    }
    if (row.group) {
      add(row.group, row.cents);
      continue;
    }
    const sellers = input.sellersByDay.get(row.day) ?? [];
    for (const share of splitEqual(row.cents, sellers)) add(share.name, share.cents);
  }
  const named = [...byName.entries()].map(([name, cents]) => ({ name, cents }));
  const attributed = named.reduce((sum, row) => sum + row.cents, 0);
  if (attributed <= 0) return { cents: shortage, people: [] };
  const pool = Math.min(shortage, attributed);
  const people = named
    .map((row) => ({ name: row.name, cents: Math.round((row.cents * pool) / attributed) }))
    .filter((row) => row.cents > 0);
  const drift = pool - people.reduce((sum, row) => sum + row.cents, 0);
  if (people.length > 0 && drift !== 0) people[0] = { ...people[0], cents: people[0].cents + drift };
  people.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return { cents: shortage, people };
}
