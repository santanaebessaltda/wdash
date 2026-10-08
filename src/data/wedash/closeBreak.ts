import { cashCloseBucket, type CashCloseBucket, type CashCloseLine } from "./cashCloseView";

export type CloseShift = { name: string; start: string; end: string };

export type CloseSalePoint = {
  occurredAt: string;
  paymentMethod: string;
  sellerName: string;
};

export type CloseBreak = {
  key: CashCloseBucket;
  label: string;
  diffCents: number;
  groups: string[];
  reason: string;
};

const BAG_CENTS = 200;

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

function groupsOf(points: CloseSalePoint[], shifts: CloseShift[], timeZone: string): string[] {
  const ordered = [...shifts].sort((a, b) => (hhmmToMin(a.start) ?? 0) - (hhmmToMin(b.start) ?? 0));
  const hit = new Set<string>();
  for (const point of points) {
    const minutes = localMinutes(point.occurredAt, timeZone);
    if (minutes == null) continue;
    const shift = ordered.find((item) => {
      const start = hhmmToMin(item.start);
      const end = hhmmToMin(item.end);
      return start != null && end != null && minutes >= start && minutes < end;
    });
    if (shift) hit.add(shift.name);
  }
  return ordered.map((item) => item.name).filter((name) => hit.has(name));
}

function listGroups(groups: string[]): string {
  if (groups.length <= 1) return groups[0] ?? "";
  if (groups.length === 2) return `${groups[0]} e ${groups[1]}`;
  return `${groups.slice(0, -1).join(", ")} e ${groups[groups.length - 1]}`;
}

function reasonFor(input: {
  key: CashCloseBucket;
  diff: number;
  points: CloseSalePoint[];
  groups: string[];
  pair: CashCloseLine | null;
  pixPending: boolean;
}): string {
  if (input.diff > 0) return "Sobra. Não pede justificativa.";
  if (input.pair) return `Pode ser inversão com ${input.pair.label.toLowerCase()}.`;
  if (input.key === "cash" && input.diff % BAG_CENTS === 0) return "Pode ser sacola de R$ 2.";
  if (input.key === "pix" && input.pixPending) return "Pix ainda em aberto.";
  if (input.points.length === 0) return "Falta sem venda identificada. Fica no grupo até escolher a pessoa.";
  const semVendedor = input.points.every((point) => point.sellerName.trim() === "");
  if (input.groups.length === 1 && semVendedor) {
    return `Sem vendedor. A falta fica em ${input.groups[0]} e não entra na folha.`;
  }
  if (input.groups.length === 1) return `Quebra em ${input.groups[0]}.`;
  if (input.groups.length > 1) {
    return `As vendas passaram por ${listGroups(input.groups)}. A quebra do dia não separa o grupo.`;
  }
  return "A venda ficou fora dos grupos cadastrados.";
}

/** Diferença digitado − Millennium, com o grupo do horário da venda e um motivo possível. */
export function closeBreaks(input: {
  lines: CashCloseLine[];
  sales: CloseSalePoint[];
  shifts: CloseShift[];
  timeZone: string;
  pixPending: boolean;
}): CloseBreak[] {
  const rows = input.lines
    .map((line) => ({ line, diff: line.typedCents - line.systemCents }))
    .filter((row) => row.diff !== 0);
  const opposite = new Map<number, CashCloseLine[]>();
  for (const row of rows) {
    const list = opposite.get(-row.diff) ?? [];
    list.push(row.line);
    opposite.set(-row.diff, list);
  }
  return rows.map(({ line, diff }) => {
    const points = input.sales.filter((sale) => cashCloseBucket(sale.paymentMethod) === line.key);
    const groups = groupsOf(points, input.shifts, input.timeZone);
    const pair = (opposite.get(diff) ?? []).filter((other) => other.key !== line.key);
    return {
      key: line.key,
      label: line.label,
      diffCents: diff,
      groups,
      reason: reasonFor({
        key: line.key,
        diff,
        points,
        groups,
        pair: pair.length === 1 ? pair[0] : null,
        pixPending: input.pixPending,
      }),
    };
  });
}
