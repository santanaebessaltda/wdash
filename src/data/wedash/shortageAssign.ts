import { cashCloseBucket, realCentsOf, type CashCloseBucket, type CashCloseLine } from "./cashCloseView";

export type ShortageSale = {
  occurredAt: string;
  paymentMethod: string;
  sellerName: string;
  revenueCents: number;
};

export type ShortageCapture = {
  occurredAt: string;
  paymentMethod: string;
  capturedCents: number;
};

export type ShortageShift = { name: string; start: string; end: string };

export type ShortageScope = "seller" | "group" | "everyone" | "store";

export type ShortageSuggestion = {
  scope: "seller" | "group" | "everyone";
  /** Vendedoras já marcadas. Vazio quando há mais de uma candidata do mesmo valor. */
  sellers: string[];
  /** Nomes que a lista mostra quando o destino é vendedora. */
  candidates: string[];
  /** Valor de cada venda apontada. Só entra no rateio quando o conjunto marcado é este. */
  amounts: Record<string, number>;
  split: "matched" | "equal";
  group: string;
  groups: string[];
  note: string;
};

function hhmmToMin(hhmm: string): number | null {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function localMinutes(iso: string, timeZone: string): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  const minute = Number(get("minute"));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

export function groupNameAt(iso: string, shifts: ShortageShift[], timeZone: string): string | null {
  const minutes = localMinutes(iso, timeZone);
  if (minutes == null) return null;
  const ordered = [...shifts].sort((a, b) => (hhmmToMin(a.start) ?? 0) - (hhmmToMin(b.start) ?? 0));
  const hit = ordered.find((item) => {
    const start = hhmmToMin(item.start);
    const end = hhmmToMin(item.end);
    return start != null && end != null && minutes >= start && minutes < end;
  });
  return hit?.name ?? null;
}

function namesOf(groups: string[]): string {
  if (groups.length <= 1) return groups[0] ?? "";
  if (groups.length === 2) return `${groups[0]} e ${groups[1]}`;
  return `${groups.slice(0, -1).join(", ")} e ${groups[groups.length - 1]}`;
}

function sellerName(raw: string): string {
  return raw.trim();
}

function uniqueNames(names: string[]): string[] {
  return [...new Set(names.map(sellerName).filter((name) => name.length > 0))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Vendas do Millennium sem uma captura da Stone do mesmo valor. */
export function unpairedSales(sales: ShortageSale[], captures: ShortageCapture[]): ShortageSale[] {
  const used = new Set<number>();
  for (const capture of captures) {
    let best = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    sales.forEach((sale, index) => {
      if (used.has(index) || sale.revenueCents !== capture.capturedCents) return;
      const dist = Math.abs(new Date(sale.occurredAt).getTime() - new Date(capture.occurredAt).getTime());
      if (!Number.isFinite(dist) || dist >= bestDist) return;
      best = index;
      bestDist = dist;
    });
    if (best >= 0) used.add(best);
  }
  return sales.filter((_, index) => !used.has(index));
}

function groupsTouched(sales: ShortageSale[], shifts: ShortageShift[], timeZone: string): string[] {
  const hit = new Set<string>();
  for (const sale of sales) {
    const name = groupNameAt(sale.occurredAt, shifts, timeZone);
    if (name) hit.add(name);
  }
  return shifts.map((shift) => shift.name).filter((name) => hit.has(name));
}

type FormHit =
  | { kind: "sellers"; sellers: { name: string; cents: number }[]; candidates: string[]; openChoice: boolean }
  | { kind: "group"; groups: string[] }
  | { kind: "everyone" };

function matchedSellers(sales: ShortageSale[]): { name: string; cents: number }[] | null {
  const byName = new Map<string, number>();
  for (const sale of sales) {
    const name = sellerName(sale.sellerName);
    if (!name) return null;
    byName.set(name, (byName.get(name) ?? 0) + sale.revenueCents);
  }
  return [...byName.entries()]
    .map(([name, cents]) => ({ name, cents }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function placeByTime(sales: ShortageSale[], shifts: ShortageShift[], timeZone: string): FormHit {
  if (shifts.length === 0) return { kind: "everyone" };
  const touched = groupsTouched(sales, shifts, timeZone);
  if (touched.length > 0) return { kind: "group", groups: touched };
  return { kind: "group", groups: shifts.map((shift) => shift.name) };
}

function formHit(input: {
  bucket: CashCloseBucket;
  shortageCents: number;
  sales: ShortageSale[];
  captures: ShortageCapture[];
  shifts: ShortageShift[];
  timeZone: string;
}): FormHit {
  const sales = input.sales.filter((sale) => cashCloseBucket(sale.paymentMethod) === input.bucket);
  const captures = input.captures.filter((capture) => cashCloseBucket(capture.paymentMethod) === input.bucket);
  if (input.bucket !== "cash" && captures.length > 0) {
    const left = unpairedSales(sales, captures);
    if (left.reduce((sum, sale) => sum + sale.revenueCents, 0) === input.shortageCents) {
      const sellers = matchedSellers(left);
      if (sellers && sellers.reduce((sum, row) => sum + row.cents, 0) === input.shortageCents) {
        return { kind: "sellers", sellers, candidates: sellers.map((row) => row.name), openChoice: false };
      }
    }
    return placeByTime(left.length > 0 ? left : sales, input.shifts, input.timeZone);
  }
  const same = sales.filter((sale) => sale.revenueCents === input.shortageCents);
  const named = matchedSellers(same);
  if (named && named.length === 1 && same.every((sale) => sellerName(sale.sellerName) === named[0]?.name)) {
    return {
      kind: "sellers",
      sellers: [{ name: named[0].name, cents: input.shortageCents }],
      candidates: [named[0].name],
      openChoice: false,
    };
  }
  if (named && named.length > 1) {
    return { kind: "sellers", sellers: [], candidates: named.map((row) => row.name), openChoice: true };
  }
  return placeByTime(sales, input.shifts, input.timeZone);
}

function sellerNote(names: string[], openChoice: boolean): string {
  if (openChoice) return "Há mais de uma venda deste valor. Escolha quem paga.";
  if (names.length === 1) return `A falta fecha com a venda de ${names[0]}.`;
  return `A falta fecha com as vendas de ${namesOf(names)}.`;
}

/**
 * Destino sugerido da falta do dia.
 * Vendedora quando o valor fecha com vendas. Um grupo quando a hora cabe nele.
 * Vários grupos ficam para escolha. Sem grupo configurado, a equipe inteira.
 */
export function suggestDayShortage(input: {
  lines: CashCloseLine[];
  sales: ShortageSale[];
  captures: ShortageCapture[];
  shifts: ShortageShift[];
  timeZone: string;
}): ShortageSuggestion {
  const empty: ShortageSuggestion = {
    scope: input.shifts.length === 0 ? "everyone" : "group",
    sellers: [],
    candidates: [],
    amounts: {},
    split: "equal",
    group: input.shifts.length === 1 ? input.shifts[0].name : "",
    groups: input.shifts.map((shift) => shift.name),
    note: input.shifts.length === 0 ? "Não há grupo configurado. A falta fica com toda a equipe." : "Escolha o grupo que assume a falta.",
  };
  const negatives = input.lines.flatMap((line) => {
    const real = realCentsOf(line);
    if (real == null) return [];
    const diff = real - line.systemCents;
    return diff < 0 ? [{ bucket: line.key, shortageCents: -diff }] : [];
  });
  if (negatives.length === 0) return empty;
  const hits = negatives.map((row) => formHit({ ...row, sales: input.sales, captures: input.captures, shifts: input.shifts, timeZone: input.timeZone }));
  if (hits.every((hit) => hit.kind === "sellers" && !hit.openChoice)) {
    const amounts: Record<string, number> = {};
    for (const hit of hits) {
      if (hit.kind !== "sellers") continue;
      for (const seller of hit.sellers) amounts[seller.name] = (amounts[seller.name] ?? 0) + seller.cents;
    }
    const sellers = Object.keys(amounts).sort((a, b) => a.localeCompare(b, "pt-BR"));
    return {
      scope: "seller",
      sellers,
      candidates: sellers,
      amounts,
      split: "matched",
      group: "",
      groups: input.shifts.map((shift) => shift.name),
      note: sellerNote(sellers, false),
    };
  }
  if (hits.length === 1 && hits[0]?.kind === "sellers" && hits[0].openChoice) {
    return {
      scope: "seller",
      sellers: [],
      candidates: hits[0].candidates,
      amounts: {},
      split: "equal",
      group: "",
      groups: input.shifts.map((shift) => shift.name),
      note: sellerNote(hits[0].candidates, true),
    };
  }
  if (input.shifts.length === 0 || hits.some((hit) => hit.kind === "everyone")) {
    return {
      scope: "everyone",
      sellers: [],
      candidates: uniqueNames(input.sales.map((sale) => sale.sellerName)),
      amounts: {},
      split: "equal",
      group: "",
      groups: [],
      note: "Não há grupo configurado. A falta fica com toda a equipe.",
    };
  }
  const groups = uniqueNames(
    hits.flatMap((hit) => (hit.kind === "group" ? hit.groups : [])),
  );
  const ordered = input.shifts.map((shift) => shift.name).filter((name) => groups.includes(name));
  const shown = ordered.length > 0 ? ordered : input.shifts.map((shift) => shift.name);
  if (shown.length === 1) {
    return {
      scope: "group",
      sellers: [],
      candidates: uniqueNames(input.sales.map((sale) => sale.sellerName)),
      amounts: {},
      split: "equal",
      group: shown[0],
      groups: shown,
      note: `A falta cai em ${shown[0]}.`,
    };
  }
  return {
    scope: "group",
    sellers: [],
    candidates: uniqueNames(input.sales.map((sale) => sale.sellerName)),
    amounts: {},
    split: "equal",
    group: "",
    groups: shown,
    note: `A falta passou por ${namesOf(shown)}. Escolha o grupo.`,
  };
}

export function splitEqual(totalCents: number, names: string[]): { name: string; cents: number }[] {
  const list = uniqueNames(names);
  if (list.length === 0 || totalCents <= 0) return [];
  const base = Math.floor(totalCents / list.length);
  let rest = totalCents - base * list.length;
  return list.map((name) => {
    const extra = rest > 0 ? 1 : 0;
    if (rest > 0) rest -= 1;
    return { name, cents: base + extra };
  });
}

export function sellersInGroup(sales: ShortageSale[], shifts: ShortageShift[], group: string, timeZone: string): string[] {
  return uniqueNames(sales.filter((sale) => groupNameAt(sale.occurredAt, shifts, timeZone) === group).map((sale) => sale.sellerName));
}

/** Quanto cada pessoa paga com o destino escolhido. */
export function shortageShares(input: {
  shortageCents: number;
  scope: ShortageScope;
  sellers: string[];
  group: string;
  suggestion: ShortageSuggestion;
  sales: ShortageSale[];
  shifts: ShortageShift[];
  timeZone: string;
}): { name: string; cents: number }[] {
  if (input.scope === "store" || input.shortageCents <= 0) return [];
  if (input.scope === "seller") {
    const picked = uniqueNames(input.sellers);
    const suggested = uniqueNames(input.suggestion.sellers);
    const same =
      input.suggestion.split === "matched" &&
      picked.length > 0 &&
      picked.length === suggested.length &&
      picked.every((name) => suggested.includes(name));
    if (same) {
      return picked.map((name) => ({ name, cents: input.suggestion.amounts[name] ?? 0 })).filter((row) => row.cents > 0);
    }
    return splitEqual(input.shortageCents, picked);
  }
  if (input.scope === "group") {
    return splitEqual(input.shortageCents, sellersInGroup(input.sales, input.shifts, input.group, input.timeZone));
  }
  return splitEqual(
    input.shortageCents,
    input.sales.map((sale) => sale.sellerName),
  );
}
