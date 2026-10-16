/**
 * Extrato Cielo de largura fixa. CIELO03 traz a captura (registro E).
 * CIELO16 traz o Pix (registro 8). Posições como no manual 15.15, começando em 1.
 */

export type CieloCardRow = {
  establishment: string;
  day: string;
  acquirerKey: string;
  paymentMethod: "Cartão de crédito" | "Cartão de débito";
  capturedCents: number;
  occurredAt: string;
};

export type CieloPixRow = {
  establishment: string;
  day: string;
  pixId: string;
  paidCents: number;
  occurredAt: string;
};

export function cieloEstablishment(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return "";
  return digits.padStart(10, "0").slice(-10);
}

function field(line: string, start: number, length: number): string {
  return line.slice(start - 1, start - 1 + length);
}

function signedCents(line: string, signAt: number, valueAt: number, length: number): number {
  const raw = field(line, valueAt, length).replace(/\D/g, "");
  if (!raw) return 0;
  const cents = Number(raw);
  if (!Number.isFinite(cents)) return 0;
  return field(line, signAt, 1) === "-" ? -cents : cents;
}

/** DDMMAAAA → AAAA-MM-DD. Zero e lixo ficam vazios. */
function ddmmaaaa(raw: string): string {
  if (!/^\d{8}$/.test(raw) || raw === "00000000") return "";
  const day = raw.slice(0, 2);
  const month = raw.slice(2, 4);
  const year = raw.slice(4, 8);
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return "";
  return `${year}-${month}-${day}`;
}

/** AAMMDD → AAAA-MM-DD. */
function aammdd(raw: string): string {
  if (!/^\d{6}$/.test(raw) || raw === "000000") return "";
  const year = 2000 + Number(raw.slice(0, 2));
  const month = raw.slice(2, 4);
  const day = raw.slice(4, 6);
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return "";
  return `${year}-${month}-${day}`;
}

function occurredAt(day: string, hhmmss: string): string {
  if (!/^\d{6}$/.test(hhmmss)) return `${day}T12:00:00-03:00`;
  return `${day}T${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}-03:00`;
}

function saleKey(line: string, establishment: string): string {
  const unique = field(line, 496, 15).trim();
  const transaction = field(line, 130, 22).trim();
  const key = unique && !/^0+$/.test(unique) ? unique : transaction;
  return key ? `${establishment}:${key}` : "";
}

/** Registro E: venda capturada. 01 débito, 02 crédito à vista, 03 parcelado. */
function parseSale(line: string): CieloCardRow | null {
  if (line[0] !== "E" || line.length < 581) return null;
  if (field(line, 164, 1) === "S") return null;
  const launch = field(line, 28, 2);
  const paymentMethod =
    launch === "01" ? "Cartão de débito" : launch === "02" || launch === "03" ? "Cartão de crédito" : null;
  if (!paymentMethod) return null;
  const establishment = cieloEstablishment(field(line, 2, 10));
  const day = ddmmaaaa(field(line, 574, 8));
  const acquirerKey = saleKey(line, establishment);
  if (!establishment || !day || !acquirerKey) return null;
  return {
    establishment,
    day,
    acquirerKey,
    paymentMethod,
    capturedCents: signedCents(line, 247, 248, 13),
    occurredAt: occurredAt(day, field(line, 471, 6)),
  };
}

/** Registro 8: Pix. 01 venda, 02 ajuste a crédito, 03 ajuste a débito. O sinal manda no valor. */
function parsePix(line: string): CieloPixRow | null {
  if (line[0] !== "8" || line.length < 87) return null;
  const kind = field(line, 12, 2);
  if (kind !== "01" && kind !== "02" && kind !== "03") return null;
  const establishment = cieloEstablishment(field(line, 2, 10));
  const day = aammdd(field(line, 14, 6));
  const pixId = field(line, 26, 36).trim();
  const nsu = field(line, 62, 6).trim();
  const id = pixId || (nsu ? `${establishment}:${day}:${nsu}` : "");
  if (!establishment || !day || !id) return null;
  return {
    establishment,
    day,
    pixId: id,
    paidCents: signedCents(line, 74, 75, 13),
    occurredAt: occurredAt(day, field(line, 20, 6)),
  };
}

export function parseCieloEdi(text: string): { cards: CieloCardRow[]; pix: CieloPixRow[] } {
  const cards = new Map<string, CieloCardRow>();
  const pix = new Map<string, CieloPixRow>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, "");
    if (!line) continue;
    const sale = parseSale(line);
    if (sale) {
      cards.set(`${sale.establishment}|${sale.acquirerKey}`, sale);
      continue;
    }
    const row = parsePix(line);
    if (row) pix.set(`${row.establishment}|${row.pixId}`, row);
  }
  return { cards: [...cards.values()], pix: [...pix.values()] };
}
