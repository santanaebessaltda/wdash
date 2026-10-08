import { stoneFileReady } from "../../../src/data/wedash/stoneClock.ts";

export { stoneFileReady };

export type StonePixRow = {
  eventId: string;
  e2eId: string;
  status: string;
  paidCents: number;
  canceledCents: number;
  feeCents: number;
  occurredAt: string | null;
  terminalSerial: string;
};

const STONE_URL = "https://conciliation.stone.com.br";

/** Novo pedido do mesmo dia só depois deste prazo. A Stone fala em até 30 min. */
export const STONE_PIX_RETRY_MS = 45 * 60 * 1000;

function basic(secret: string): string {
  return `Basic ${Buffer.from(`${secret}:`).toString("base64")}`;
}

function cell(header: string[], row: string[], name: string): string {
  const i = header.indexOf(name);
  return i < 0 ? "" : (row[i] ?? "").trim();
}

function moneyToCents(raw: string): number {
  let s = raw.trim();
  if (!s) return 0;
  s = s.replace(/\s/g, "");
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replaceAll(".", "").replace(",", ".") : s.replaceAll(",", "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** created_at da Stone é UTC. Sem fuso, trata como UTC. */
function pixInstant(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const iso = `${s.replace(" ", "T").slice(0, 19)}.000Z`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function splitCsv(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** CSV do arquivo PIX. Uma linha por evento. Cabeçalho vazio = dia sem PIX. */
export function parseStonePixCsv(text: string): StonePixRow[] {
  const body = text.replace(/^\uFEFF/, "").trim();
  if (!body) return [];
  const lines = body.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const delimiter = (lines[0] ?? "").includes(";") ? ";" : ",";
  const header = splitCsv(lines[0] ?? "", delimiter).map((h) => h.trim().toLowerCase());
  const byId = new Map<string, StonePixRow>();
  for (const line of lines.slice(1)) {
    const cols = splitCsv(line, delimiter);
    const eventId = cell(header, cols, "id");
    const e2eId = cell(header, cols, "pix_transaction__e2e_id");
    if (!eventId && !e2eId) continue;
    const id = eventId || e2eId;
    byId.set(id, {
      eventId: id,
      e2eId,
      status: cell(header, cols, "status").toLowerCase(),
      paidCents: moneyToCents(cell(header, cols, "pix_transaction__paid_amount") || cell(header, cols, "amount")),
      canceledCents: moneyToCents(cell(header, cols, "pix_transaction__canceled_amount")),
      feeCents: moneyToCents(cell(header, cols, "pix_transaction__fee_amount")),
      occurredAt: pixInstant(cell(header, cols, "created_at") || cell(header, cols, "pix_transaction__detail__provider_datetime")),
      terminalSerial: cell(header, cols, "pix_transaction__terminal__serial_number"),
    });
  }
  return [...byId.values()];
}

export function stonePixPaidCents(row: StonePixRow): number {
  if (row.status === "canceled" || row.status === "cancelled") return 0;
  return row.paidCents;
}

export async function requestStonePixFile(opts: {
  document: string;
  secret: string;
  day: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${STONE_URL}/v2/merchant/${opts.document}/conciliation-file/pix/${opts.day}`, {
    method: "POST",
    headers: {
      Authorization: basic(opts.secret),
      "x-user-type": "client",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 202 || res.status === 200) return;
  const text = await res.text();
  if (/webhook/i.test(text)) {
    throw new Error("A Stone ainda não confirmou o endereço de aviso do Pix. O arquivo só sai depois dessa confirmação.");
  }
  throw new Error(`Stone PIX ${opts.day} → ${res.status} ${text.slice(0, 180)}`);
}

/** 201 cadastrado, 409 já existia. Outro status estoura. */
export async function registerStoneWebhook(opts: {
  secret: string;
  url: string;
  fetchImpl?: typeof fetch;
}): Promise<"created" | "exists"> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${STONE_URL}/v2/webhook`, {
    method: "POST",
    headers: {
      Authorization: basic(opts.secret),
      "x-user-type": "client",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ url: opts.url }),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 201) return "created";
  if (res.status === 409) return "exists";
  const text = await res.text();
  throw new Error(`Webhook Stone → ${res.status} ${text.slice(0, 180)}`);
}

const MAX_PIX_CSV_BYTES = 15_000_000;

export async function downloadStonePixCsv(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!url.startsWith("https://")) throw new Error("Link do PIX sem https");
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Download PIX → ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > MAX_PIX_CSV_BYTES) throw new Error("CSV do PIX grande demais");
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_PIX_CSV_BYTES) throw new Error("CSV do PIX grande demais");
  return new TextDecoder().decode(buf);
}
