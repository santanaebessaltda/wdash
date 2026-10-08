/**
 * Saldo Atual e Futuro (FRANQUIAS.RELATORIOS.ESTOQUEEMCOMPRA)  ->  linhas do Pedido de compra.
 * Sem imports: testado no vitest (`purchaseStock.test.ts`). Mesmo formato de `PurchaseStockRow` em
 * src/data/wedash/purchaseOrder.ts (manter iguais).
 */

export type PurchaseStockRow = {
  code: string;
  color: string;
  print: string;
  size: string;
  description: string;
  balance: number;
  openOrder: number;
  total: number;
  multiple: number | null;
  blocked: boolean;
  registeredAt: string | null;
  position: number;
};

export type PurchaseRegistry = {
  code: string;
  registeredAt: string | null;
  purchaseMultiple: number | null;
  purchaseBlocked: boolean;
};

function rowsOf(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["value", "Value", "data", "Data", "RAW_DATA"]) {
    if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
  }
  return [];
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asStr(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** DATA_CADASTRO vem a meia-noite de Brasilia em UTC ("2024-06-05T03:00:00.000Z")  ->  "2024-06-05". */
function brDate(v: unknown): string | null {
  const s = asStr(v);
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Linhas com o mesmo codigo + cor + estampa + tamanho sao somadas (fica a posicao da 1). */
export function parsePurchaseStock(payload: unknown): PurchaseStockRow[] {
  const out = new Map<string, PurchaseStockRow>();
  let position = 0;
  for (const raw of rowsOf(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const code = asStr(raw.COD_PRODUTO);
    if (!code) continue;
    const color = asStr(raw.COR);
    const print = asStr(raw.ESTAMPA);
    const size = asStr(raw.TAMANHO);
    const balance = asNum(raw.SALDO) ?? 0;
    const openOrder = asNum(raw.QUANTIDADE_PEDIDO) ?? 0;
    const total = asNum(raw.TOTAL) ?? balance + openOrder;
    const key = [code, color, print, size].join("\u0000");
    const prev = out.get(key);
    if (prev) {
      prev.balance += balance;
      prev.openOrder += openOrder;
      prev.total += total;
      continue;
    }
    const multiple = asNum(raw.QUANTIDADE_MULTIPLA);
    out.set(key, {
      code,
      color,
      print,
      size,
      description: asStr(raw.DESCRICAO1),
      balance,
      openOrder,
      total,
      multiple: multiple != null && multiple > 0 ? multiple : null,
      blocked: raw.BLOQUEADO_COMPRA === true,
      registeredAt: brDate(raw.DATA_CADASTRO),
      position: position++,
    });
  }
  return [...out.values()];
}

/** Cadastro por codigo (variantes do mesmo produto trazem o mesmo cadastro)  ->  `set_product_catalog_registry`. */
export function purchaseRegistry(rows: PurchaseStockRow[]): PurchaseRegistry[] {
  const out = new Map<string, PurchaseRegistry>();
  for (const r of rows) {
    if (out.has(r.code)) continue;
    out.set(r.code, { code: r.code, registeredAt: r.registeredAt, purchaseMultiple: r.multiple, purchaseBlocked: r.blocked });
  }
  return [...out.values()];
}
