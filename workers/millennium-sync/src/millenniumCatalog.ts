/**
 * Catalogo de produtos do Millennium (lookups comuns, sem relatorio personalizado).
 * - Tipos: `$lookup=PRODUTO.tipo.tipo`  ->  PRODUTO_TIPO_TIPO / PRODUTO_TIPO_DESCRICAO (~19).
 * - Produtos de um tipo: `$lookup=produto.produto.produto` com `PARAM_9` = tipo.
 *   A lista de produtos nao traz o tipo na linha  -  o tipo sai do filtro.
 */
import { millenniumBaseUrl } from "./millenniumAuth.ts";

export type ProductType = { typeId: number; description: string };
export type CatalogProduct = { erpProductId: number; code: string; description: string; typeId: number };

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["value", "Value", "data", "Data", "RAW_DATA"]) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [];
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

function asStr(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

export function parseProductTypes(payload: unknown): ProductType[] {
  const out = new Map<number, ProductType>();
  for (const raw of extractList(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const typeId = asNum(o.PRODUTO_TIPO_TIPO ?? o.produto_tipo_tipo);
    if (typeId == null) continue;
    out.set(typeId, { typeId, description: asStr(o.PRODUTO_TIPO_DESCRICAO ?? o.produto_tipo_descricao) || `TIPO ${typeId}` });
  }
  return [...out.values()];
}

export function parseTypeProducts(payload: unknown, typeId: number): CatalogProduct[] {
  const out: CatalogProduct[] = [];
  for (const raw of extractList(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const id = asNum(o.PRODUTO_PRODUTO_PRODUTO ?? o.produto_produto_produto);
    const code = asStr(o.PRODUTO_PRODUTO_COD_PRODUTO ?? o.produto_produto_cod_produto);
    if (id == null || !code) continue;
    out.push({
      erpProductId: id,
      code,
      description: asStr(o.PRODUTO_PRODUTO_DESCRICAO1 ?? o.produto_produto_descricao1),
      typeId,
    });
  }
  return out;
}

async function lookup(opts: {
  session: string;
  path: string;
  body: Record<string, unknown>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const base = (opts.baseUrl ?? millenniumBaseUrl()).replace(/\/$/, "");
  const res = await (opts.fetchImpl ?? fetch)(`${base}/millenium?$lookup=${opts.path}&$top=5000`, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      "WTS-Session": opts.session,
      "X-DateFormat": "ISOTZ",
      "X-HTTP-Method": "GET",
      "X-IdentifierCase": "upper",
    },
    body: JSON.stringify(opts.body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`lookup ${opts.path} → ${res.status} ${text.slice(0, 240)}`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`lookup ${opts.path} JSON inválido: ${text.slice(0, 200)}`);
  }
}

export async function fetchProductTypes(opts: {
  session: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<ProductType[]> {
  const payload = await lookup({
    ...opts,
    path: "PRODUTO.tipo.tipo",
    body: { SCRIPT: null, DATASOURCE: null, PRODUTO_TIPO_TIPO: null, _DETAILS: true },
  });
  return parseProductTypes(payload);
}

export type ProductRegistry = { code: string; registeredAt: string | null; purchaseMultiple: number | null; purchaseBlocked: boolean | null };

/** DATA_CADASTRO vem a meia-noite de Brasilia em UTC ("2024-06-05T03:00:00.000Z")  ->  "2024-06-05". */
function brDate(v: unknown): string | null {
  const s = asStr(v);
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  return new Date(t - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Linhas por tamanho/cor do mesmo codigo trazem o mesmo cadastro: fica uma por codigo. */
export function parseProductRegistry(payload: unknown): ProductRegistry[] {
  const out = new Map<string, ProductRegistry>();
  for (const raw of extractList(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const code = asStr(o.COD_PRODUTO);
    if (!code) continue;
    const prev = out.get(code);
    const multiple = asNum(o.QUANTIDADE_MULTIPLA);
    const blocked = typeof o.BLOQUEADO_COMPRA === "boolean" ? o.BLOQUEADO_COMPRA : null;
    out.set(code, {
      code,
      registeredAt: prev?.registeredAt ?? brDate(o.DATA_CADASTRO),
      purchaseMultiple: prev?.purchaseMultiple ?? (multiple != null && multiple > 0 ? multiple : null),
      purchaseBlocked: prev?.purchaseBlocked ?? blocked,
    });
  }
  return [...out.values()];
}

/**
 * Cadastro dos produtos pelo relatorio "Saldo Atual e Futuro" (FRANQUIAS.RELATORIOS.ESTOQUEEMCOMPRA):
 * data de cadastro, quantidade multipla e bloqueado compra. Vem por filial, mas o cadastro e o mesmo em
 * todas as lojas  -  1 chamada com qualquer loja (~0,5 - 5s).
 */
export async function fetchProductRegistry(opts: {
  session: string;
  millenniumStoreId: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<ProductRegistry[]> {
  const base = (opts.baseUrl ?? millenniumBaseUrl()).replace(/\/$/, "");
  const res = await (opts.fetchImpl ?? fetch)(`${base}/MILLENIUM!FRANQUIAS.RELATORIOS.ESTOQUEEMCOMPRA?$top=5000`, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      "WTS-Session": opts.session,
      "X-DateFormat": "ISOTZ",
      "X-HTTP-Method": "GET",
      "X-IdentifierCase": "upper",
    },
    body: JSON.stringify({ FILIAL: opts.millenniumStoreId, DESC: null, TIPO: null, DATAI: null, DATAF: null }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ESTOQUEEMCOMPRA → ${res.status} ${text.slice(0, 240)}`);
  try {
    return parseProductRegistry(text ? JSON.parse(text) : {});
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error(`ESTOQUEEMCOMPRA JSON inválido: ${text.slice(0, 200)}`);
    throw e;
  }
}

export async function fetchProductsOfType(opts: {
  session: string;
  typeId: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<CatalogProduct[]> {
  const payload = await lookup({
    ...opts,
    path: "produto.produto.produto",
    body: { SCRIPT: null, DATASOURCE: null, PARAM_9: opts.typeId, _DETAILS: true },
  });
  return parseTypeProducts(payload, opts.typeId);
}
