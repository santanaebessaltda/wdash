/**
 * Itens de uma venda: millenium.MOVIMENTACAO.ConsultaDetMov.
 * Body: COD_OPERACAO (number) + TIPO_OPERACAO "S" + NF (cupom).
 */
import { millenniumBaseUrl } from "./millenniumAuth.ts";

export type DetMovLine = {
  productId: number;
  /** PRECO_TOTAL em centavos. */
  revenueCents: number;
  /** QUANTIDADE (unidades). */
  qty: number;
  descProduto: string;
};

export type FetchDetMovParams = {
  session: string;
  /** Millennium COD_OPERACAO (numerico). */
  codOperacao: number;
  /** Cupom / NF da Lista. */
  nf: string;
  /** Default "S" (saida / venda). */
  tipoOperacao?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null) return o[k];
  }
  const lower = Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function asStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function reaisToCents(v: unknown): number {
  const n = asNum(v);
  if (n == null) return 0;
  return Math.round(n * 100);
}

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["value", "Value", "data", "Data", "items", "Items"]) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [];
}

/** Parse JSON do ConsultaDetMov  ->  linhas com produto + R$ + qty. */
export function parseConsultaDetMovPayload(payload: unknown): DetMovLine[] {
  const out: DetMovLine[] = [];
  for (const raw of extractList(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const productId = asNum(pick(o, "PRODUTO", "produto"));
    if (productId == null) continue;
    out.push({
      productId,
      revenueCents: reaisToCents(pick(o, "PRECO_TOTAL", "preco_total")),
      qty: asNum(pick(o, "QUANTIDADE", "quantidade")) ?? 0,
      descProduto: asStr(pick(o, "DESC_PRODUTO", "desc_produto")),
    });
  }
  return out;
}

export async function fetchConsultaDetMov(params: FetchDetMovParams): Promise<DetMovLine[]> {
  const base = (params.baseUrl ?? millenniumBaseUrl()).replace(/\/$/, "");
  const fetchImpl = params.fetchImpl ?? fetch;
  const body = {
    COD_OPERACAO: params.codOperacao,
    TIPO_OPERACAO: params.tipoOperacao ?? "S",
    NF: String(params.nf),
    PRODUTO: null,
    COR: null,
    ESTAMPA: null,
    TAMANHO: null,
    SCRIPTTAMANHO: null,
    ITEM: null,
  };
  const res = await fetchImpl(`${base}/millenium.MOVIMENTACAO.ConsultaDetMov`, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      "WTS-Session": params.session,
      "X-DateFormat": "ISOTZ",
      "X-HTTP-Method": "GET",
      "X-IdentifierCase": "upper",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `ConsultaDetMov ${params.codOperacao}/${params.nf} → ${res.status} ${text.slice(0, 240)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : [];
  } catch {
    throw new Error(`ConsultaDetMov JSON inválido: ${text.slice(0, 200)}`);
  }
  return parseConsultaDetMovPayload(parsed);
}
