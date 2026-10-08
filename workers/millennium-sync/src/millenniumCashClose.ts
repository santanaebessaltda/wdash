/**
 * Fechamento de caixa do Millennium.
 * Lista_Caixas liga a filial ao caixa (NUMERO = código da loja).
 * FECHAMENTOCAIXADETALHADO devolve fundo, sangria, fechamento e valor digitado de um dia.
 * A conta de compras (NUMERO com sufixo -1) não entra.
 */
import { millenniumBaseUrl } from "./millenniumAuth.ts";
import { milleniumDayBoundIso } from "./millenniumSales.ts";

export type CashAccount = {
  conta: number;
  numero: string;
  descricao: string;
};

export type CashCloseReportLine = {
  paymentMethod: string;
  openingReais: number;
  sangriaReais: number | null;
  closingReais: number;
  typedReais: number;
};

function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] != null && o[k] !== "") return o[k];
  const lower = Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v != null && v !== "") return v;
  }
  return undefined;
}

const asStr = (v: unknown) => (v == null ? "" : String(v).trim());

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
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

export function parseCashAccounts(payload: unknown): CashAccount[] {
  const out: CashAccount[] = [];
  for (const raw of extractList(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const conta = asNum(pick(o, "CONTA"));
    const numero = asStr(pick(o, "NUMERO"));
    if (conta == null || !numero) continue;
    out.push({ conta, numero, descricao: asStr(pick(o, "DESCRICAO")) });
  }
  return out;
}

/** Caixa da loja. Compras (`00386-1`) não casa com o código `00386`. */
export function cashAccountForStore(accounts: CashAccount[], storeCode: string): CashAccount | null {
  const code = storeCode.trim();
  if (!code) return null;
  return accounts.find((a) => a.numero.trim() === code) ?? null;
}

export function parseCashCloseReport(payload: unknown): CashCloseReportLine[] {
  const out: CashCloseReportLine[] = [];
  for (const raw of extractList(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const paymentMethod = asStr(pick(o, "FORMA_PAGAMENTO"));
    if (!paymentMethod) continue;
    const sangria = pick(o, "VALOR_SANGRIA");
    out.push({
      paymentMethod,
      openingReais: asNum(pick(o, "ENTRADA_INICIAL")) ?? 0,
      sangriaReais: sangria == null ? null : asNum(sangria),
      closingReais: asNum(pick(o, "VALOR_FECHAMENTO")) ?? 0,
      typedReais: asNum(pick(o, "VALOR_DIGITADO_FECHAMENTO")) ?? 0,
    });
  }
  return out;
}

export function reaisToCents(reais: number): number {
  return Math.round(reais * 100);
}

const uiHeaders = (session: string): Record<string, string> => ({
  Accept: "*/*",
  "Content-Type": "application/json",
  "WTS-Session": session,
  "X-DateFormat": "ISOTZ",
  "X-HTTP-Method": "GET",
  "X-IdentifierCase": "upper",
});

async function readJson(res: Response, label: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} → ${res.status} ${text.slice(0, 240)}`);
  try {
    return text ? JSON.parse(text) : [];
  } catch {
    throw new Error(`${label} JSON inválido: ${text.slice(0, 120)}`);
  }
}

export async function fetchCashAccounts(opts: {
  session: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<CashAccount[]> {
  const base = (opts.baseUrl ?? millenniumBaseUrl()).replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${base}/millenium.CONTAS.Lista_Caixas?$top=501`, {
    method: "POST",
    headers: uiHeaders(opts.session),
    body: JSON.stringify({ FILIAL: null, IMPR_FISC: null }),
    signal: AbortSignal.timeout(60_000),
  });
  return parseCashAccounts(await readJson(res, "Lista_Caixas"));
}

export async function fetchCashCloseReport(opts: {
  session: string;
  conta: number;
  day: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<CashCloseReportLine[]> {
  const base = (opts.baseUrl ?? millenniumBaseUrl()).replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const bound = milleniumDayBoundIso(opts.day);
  const res = await fetchImpl(`${base}/MILLENIUM!FRANQUIAS.RELATORIOS.FECHAMENTOCAIXADETALHADO`, {
    method: "POST",
    headers: uiHeaders(opts.session),
    body: JSON.stringify({ DATAI: bound, DATAF: bound, CONTA: opts.conta }),
    signal: AbortSignal.timeout(60_000),
  });
  return parseCashCloseReport(await readJson(res, `FECHAMENTOCAIXADETALHADO ${opts.day}`));
}
