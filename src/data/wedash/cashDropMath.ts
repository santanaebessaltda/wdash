/** Sangria do Millennium: o valor vem negativo; na tela é positivo. `purchase` não entra no boleto (compra, premiação, fornecedor ou outro uso). */

export type CashDropKind = "deposit" | "purchase";

export type CashDropAmounts = {
  totalCents: number;
  boletoCents: number;
  /** Compra, premiação, fornecedor ou outro uso. Não entra no boleto. */
  excludedCents: number;
  /** Dinheiro da sangria que não estava no caixa. Não entra no boleto. */
  gapCents: number;
  reason: string;
};

export type ParsedCashDrop = {
  erpEntry: number;
  day: string;
  amountCents: number;
  document: string;
  note: string;
};

const EMPTY: CashDropAmounts = { totalCents: 0, boletoCents: 0, excludedCents: 0, gapCents: 0, reason: "" };

/** A falta não passa do que ainda iria para o boleto. */
export function clampShortage(baseBoletoCents: number, gapCents: number): number {
  if (!Number.isFinite(gapCents) || gapCents <= 0) return 0;
  const base = Math.max(0, baseBoletoCents);
  return Math.min(Math.round(gapCents), base);
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asStr(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function listOf(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const value = (payload as { value?: unknown }).value;
  return Array.isArray(value) ? value : [];
}

/** DATA_EMISSAO vem em 03:00Z. O dia da planilha é a data desse instante, não o fuso da loja. */
export function emissionDay(iso: string): string {
  return iso.slice(0, 10);
}

export function brlToCents(brl: number): number {
  return Math.round(Math.abs(brl) * 100);
}

export function parseCashDropList(payload: unknown): ParsedCashDrop[] {
  const out: ParsedCashDrop[] = [];
  for (const raw of listOf(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const erpEntry = asNum(row.LANCAMENTO);
    const iso = asStr(row.DATA_EMISSAO);
    const brl = asNum(row.VALOR_PAGO) ?? asNum(row.VALOR_INICIAL);
    if (erpEntry == null || iso.length < 10 || brl == null) continue;
    out.push({
      erpEntry,
      day: emissionDay(iso),
      amountCents: brlToCents(brl),
      document: asStr(row.N_DOCUMENTO),
      note: asStr(row.OBS),
    });
  }
  return out;
}

export function dayAmounts(
  lines: Array<{ amountCents: number; kind: CashDropKind; note: string }>,
  gapCents = 0,
): CashDropAmounts {
  let totalCents = 0;
  let baseCents = 0;
  let excludedCents = 0;
  const motivos: string[] = [];
  for (const line of lines) {
    totalCents += line.amountCents;
    if (line.kind === "purchase") {
      excludedCents += line.amountCents;
      if (line.note.trim()) motivos.push(line.note.trim());
    } else {
      baseCents += line.amountCents;
    }
  }
  const gap = clampShortage(baseCents, gapCents);
  return { totalCents, boletoCents: baseCents - gap, excludedCents, gapCents: gap, reason: motivos.join(" · ") };
}

export function sumAmounts(rows: CashDropAmounts[]): CashDropAmounts {
  return rows.reduce(
    (acc, row) => ({
      totalCents: acc.totalCents + row.totalCents,
      boletoCents: acc.boletoCents + row.boletoCents,
      excludedCents: acc.excludedCents + row.excludedCents,
      gapCents: acc.gapCents + row.gapCents,
      reason: "",
    }),
    EMPTY,
  );
}

/** Boleto dos dias marcados. Compra e falta ficam de fora. */
export function depositBoleto(
  lines: Array<{ day: string; amountCents: number; kind: CashDropKind; note: string }>,
  days: string[],
  gapByDay: ReadonlyMap<string, number> = new Map(),
): number {
  const marked = new Set(days);
  let cents = 0;
  for (const day of marked) {
    cents += dayAmounts(
      lines.filter((line) => line.day === day),
      gapByDay.get(day) ?? 0,
    ).boletoCents;
  }
  return cents;
}

/** null quando o recebimento pode ser feito. */
export function depositBlock(days: string[], taken: ReadonlySet<string>): string | null {
  if (days.length === 0) return "Marque ao menos um dia.";
  if (days.some((day) => taken.has(day))) return "Um desses dias já está num recebimento.";
  return null;
}

/** Observação nova do ERP só substitui o texto se a pessoa ainda não editou. */
export function nextNote(savedNote: string, savedErpNote: string, incomingNote: string): string {
  return savedNote === savedErpNote ? incomingNote : savedNote;
}
