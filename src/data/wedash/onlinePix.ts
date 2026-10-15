export type OnlinePixLine = {
  id: string;
  cents: number;
  note: string;
};

export type OnlinePixDraftRow = {
  id: string;
  amount: string;
  note: string;
};

export const ONLINE_PIX_NOTE_MAX = 80;
export const ONLINE_PIX_MAX = 40;

/** Soma os PIX online já gravados. Valor inválido fica de fora. */
export function onlinePixTotal(lines: Array<{ cents: number }>): number {
  return lines.reduce((sum, line) => sum + (Number.isFinite(line.cents) ? Math.round(line.cents) : 0), 0);
}

export function parseOnlinePix(value: unknown): OnlinePixLine[] {
  if (!Array.isArray(value)) return [];
  const out: OnlinePixLine[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const cents = (item as { cents?: unknown }).cents;
    if (typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) continue;
    const note = String((item as { note?: unknown }).note ?? "").trim().slice(0, ONLINE_PIX_NOTE_MAX);
    const id = String((item as { id?: unknown }).id ?? "").trim() || crypto.randomUUID();
    out.push({ id, cents: Math.round(cents), note });
  }
  return out;
}

export function onlinePixDraftFrom(lines: OnlinePixLine[], formatCents: (cents: number) => string): OnlinePixDraftRow[] {
  return lines.map((line) => ({ id: line.id, amount: formatCents(line.cents), note: line.note }));
}

export function blankOnlinePixRow(): OnlinePixDraftRow {
  return { id: crypto.randomUUID(), amount: "", note: "" };
}

/** Soma só o que já é um valor positivo. Linha em branco não entra na conta da tela. */
export function onlinePixPreviewCents(rows: OnlinePixDraftRow[], parseCents: (raw: string) => number | null): number {
  return rows.reduce((sum, row) => {
    const cents = parseCents(row.amount);
    return cents != null && cents > 0 ? sum + cents : sum;
  }, 0);
}

/**
 * Valor da adquirente que entra no total do Pix.
 * Campo vazio mantém o arquivo. Zero sem arquivo só vale quando há PIX online.
 */
export function pixAcquirerCents(
  fileCents: number | null,
  typed: number | null,
  typedBlank: boolean,
  onlineCents: number,
): number | null {
  if (typedBlank || typed == null) return fileCents;
  if (fileCents == null && typed === 0 && onlineCents === 0) return null;
  return typed;
}

export function onlinePixSave(input: {
  rows: OnlinePixDraftRow[];
  parseCents: (raw: string) => number | null;
}): { ok: true; lines: OnlinePixLine[] } | { ok: false; message: string } {
  const filled = input.rows.filter((row) => row.amount.trim() !== "" || row.note.trim() !== "");
  if (filled.length > ONLINE_PIX_MAX) return { ok: false, message: "São muitos PIX online neste dia." };
  const lines: OnlinePixLine[] = [];
  for (const row of filled) {
    const note = row.note.trim();
    if (note.length > ONLINE_PIX_NOTE_MAX) return { ok: false, message: "A descrição do PIX online pode ter até 80 caracteres." };
    const cents = input.parseCents(row.amount);
    if (cents == null || cents <= 0) return { ok: false, message: "Informe o valor do PIX online." };
    lines.push({ id: row.id, cents: Math.round(cents), note });
  }
  return { ok: true, lines };
}
