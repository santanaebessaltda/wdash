/** Sangria do Millennium: o valor vem negativo; na tela é positivo. `purchase` não entra no boleto (compra, premiação, fornecedor ou outro uso). */

export type SangriaKind = "deposit" | "purchase";

export type SangriaAmounts = {
  totalCents: number;
  boletoCents: number;
  faltandoCents: number;
  motivo: string;
};

export type ParsedSangria = {
  erpLancamento: number;
  day: string;
  amountCents: number;
  document: string;
  note: string;
};

const EMPTY: SangriaAmounts = { totalCents: 0, boletoCents: 0, faltandoCents: 0, motivo: "" };

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

export function reaisToCents(reais: number): number {
  return Math.round(Math.abs(reais) * 100);
}

export function parseSangriaLista(payload: unknown): ParsedSangria[] {
  const out: ParsedSangria[] = [];
  for (const raw of listOf(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const erpLancamento = asNum(row.LANCAMENTO);
    const iso = asStr(row.DATA_EMISSAO);
    const reais = asNum(row.VALOR_PAGO) ?? asNum(row.VALOR_INICIAL);
    if (erpLancamento == null || iso.length < 10 || reais == null) continue;
    out.push({
      erpLancamento,
      day: emissionDay(iso),
      amountCents: reaisToCents(reais),
      document: asStr(row.N_DOCUMENTO),
      note: asStr(row.OBS),
    });
  }
  return out;
}

export function dayAmounts(lines: Array<{ amountCents: number; kind: SangriaKind; note: string }>): SangriaAmounts {
  let totalCents = 0;
  let boletoCents = 0;
  const motivos: string[] = [];
  for (const line of lines) {
    totalCents += line.amountCents;
    if (line.kind === "purchase") {
      if (line.note.trim()) motivos.push(line.note.trim());
    } else {
      boletoCents += line.amountCents;
    }
  }
  return { totalCents, boletoCents, faltandoCents: totalCents - boletoCents, motivo: motivos.join(" · ") };
}

export function sumAmounts(rows: SangriaAmounts[]): SangriaAmounts {
  return rows.reduce(
    (acc, row) => ({
      totalCents: acc.totalCents + row.totalCents,
      boletoCents: acc.boletoCents + row.boletoCents,
      faltandoCents: acc.faltandoCents + row.faltandoCents,
      motivo: "",
    }),
    EMPTY,
  );
}

/** Boleto dos dias marcados. Compra fica de fora. */
export function depositBoleto(
  lines: Array<{ day: string; amountCents: number; kind: SangriaKind; note: string }>,
  days: string[],
): number {
  const marked = new Set(days);
  return dayAmounts(lines.filter((line) => marked.has(line.day))).boletoCents;
}

/** null quando o depósito pode ser feito. */
export function depositBlock(days: string[], taken: ReadonlySet<string>): string | null {
  if (days.length === 0) return "Marque ao menos um dia.";
  if (days.some((day) => taken.has(day))) return "Um desses dias já está num depósito.";
  return null;
}

/** Observação nova do ERP só substitui o texto se a pessoa ainda não editou. */
export function nextNote(savedNote: string, savedErpNote: string, incomingNote: string): string {
  return savedNote === savedErpNote ? incomingNote : savedNote;
}
