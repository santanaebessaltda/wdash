/**
 * RELATORIOMARGEM (FRANQUIAS > RELATORIOS)  -  custo unitario atual por COD_PRODUTO de uma loja no periodo.
 * Espelho do fetch/parse de workers/millennium-sync/src/millenniumMargem.ts (manter iguais).
 * O custo da margem nao e historico: buscar um periodo antigo devolve o custo de hoje.
 */
import { baseUrl } from "./millennium.ts";
import { MillenniumHttpError } from "./millenniumSellers.ts";

const RELATORIO_MARGEM_PATH = "MILLENIUM!FRANQUIAS.RELATORIOS.RELATORIOMARGEM";

function rowsOf(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["value", "Value", "data", "Data", "items", "Items", "RAW_DATA"]) {
    if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
  }
  return [];
}

function pick(o: Record<string, unknown>, key: string): unknown {
  return o[key] ?? o[key.toLowerCase()];
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/** DATAI/DATAF = datas de calendario inclusivas (meia-noite do Millennium, UTC4). */
const dayBound = (ymd: string) => `${ymd}T04:00:00.000Z`;

/** COD_PRODUTO  ->  custo unitario em reais (CUSTO_TOTAL  QTDE_VENDIDA; so > 0). */
export async function fetchMargemUnitCosts(
  session: string,
  millenniumStoreId: number,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const res = await fetch(`${baseUrl()}/${RELATORIO_MARGEM_PATH}`, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      "WTS-Session": session,
      "X-DateFormat": "ISOTZ",
      "X-HTTP-Method": "GET",
      "X-IdentifierCase": "upper",
    },
    body: JSON.stringify({ FILIAL: millenniumStoreId, DESC: null, DATAI: dayBound(from), DATAF: dayBound(to), TIPO: null }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) throw new MillenniumHttpError(`RELATORIOMARGEM ${from}→${to} → ${res.status} ${text.slice(0, 200)}`, res.status);
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : [];
  } catch {
    throw new Error(`RELATORIOMARGEM JSON inválido: ${text.slice(0, 120)}`);
  }
  const acc = new Map<string, { qty: number; cost: number }>();
  for (const o of rowsOf(payload)) {
    const code = String(pick(o, "COD_PRODUTO") ?? "").trim();
    if (!code) continue;
    const qty = asNum(pick(o, "QTDE_VENDIDA")) ?? 0;
    const unit = asNum(pick(o, "CUSTO_FRANQUIAS")) ?? 0;
    const total = asNum(pick(o, "CUSTO_TOTAL")) ?? unit * qty;
    const a = acc.get(code) ?? { qty: 0, cost: 0 };
    a.qty += qty;
    a.cost += total;
    acc.set(code, a);
  }
  const out = new Map<string, number>();
  for (const [code, a] of acc) if (a.qty > 0 && a.cost > 0) out.set(code, a.cost / a.qty);
  return out;
}
