/**
 * Catalogo de produtos + tabelas de custo do Millennium (espelho de workers/millennium-sync/src/
 * millenniumCatalog.ts, millenniumCostTable.ts e dedupeCatalogProducts em productCatalog.ts  -  manter iguais).
 * - Tipos: `$lookup=PRODUTO.tipo.tipo`; produtos de um tipo: `$lookup=produto.produto.produto` com PARAM_9.
 * - Tabelas: `$lookup=tabela_custo.TABELA`; custos: wtsreports {9701602B} com TABELA_DE_CUSTO e filial vazia.
 *   `F_3814918930` = custo unitario; mesmo codigo em varias cores  ->  fica o maior; so > 0.
 */
import { baseUrl } from "./millennium.ts";
import { MillenniumHttpError } from "./millenniumSellers.ts";
import { parsePurchaseStock, type PurchaseStockRow } from "./purchaseStock.ts";

export type ProductType = { typeId: number; description: string };
export type CatalogProduct = { erpProductId: number; code: string; description: string; typeId: number };
export type CostTable = { tableId: number; code: string; description: string };
const PRODUCT_DIVISION_CATALOG_GUID = "{9701602B-B363-4770-989C-8C4459B7E105}";

function rowsOf(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["value", "Value", "data", "Data", "RAW_DATA"]) {
    if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
  }
  return [];
}

function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asStr(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

async function call(url: string, init: RequestInit, label: string): Promise<unknown> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new MillenniumHttpError(`${label} → ${res.status} ${text.slice(0, 200)}`, res.status);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} JSON inválido: ${text.slice(0, 200)}`);
  }
}

function lookup(session: string, path: string, top: number, body: Record<string, unknown>): Promise<unknown> {
  return call(
    `${baseUrl()}/millenium?$lookup=${path}&$top=${top}`,
    {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        "WTS-Session": session,
        "X-DateFormat": "ISOTZ",
        "X-HTTP-Method": "GET",
        "X-IdentifierCase": "upper",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    },
    `lookup ${path}`,
  );
}

export async function fetchProductTypes(session: string): Promise<ProductType[]> {
  const payload = await lookup(session, "PRODUTO.tipo.tipo", 5000, {
    SCRIPT: null,
    DATASOURCE: null,
    PRODUTO_TIPO_TIPO: null,
    _DETAILS: true,
  });
  const out = new Map<number, ProductType>();
  for (const o of rowsOf(payload)) {
    const typeId = asInt(o.PRODUTO_TIPO_TIPO ?? o.produto_tipo_tipo);
    if (typeId == null) continue;
    out.set(typeId, { typeId, description: asStr(o.PRODUTO_TIPO_DESCRICAO ?? o.produto_tipo_descricao) || `TIPO ${typeId}` });
  }
  return [...out.values()];
}

export async function fetchProductsOfType(session: string, typeId: number): Promise<CatalogProduct[]> {
  const payload = await lookup(session, "produto.produto.produto", 5000, {
    SCRIPT: null,
    DATASOURCE: null,
    PARAM_9: typeId,
    _DETAILS: true,
  });
  const out: CatalogProduct[] = [];
  for (const o of rowsOf(payload)) {
    const id = asInt(o.PRODUTO_PRODUTO_PRODUTO ?? o.produto_produto_produto);
    const code = asStr(o.PRODUTO_PRODUTO_COD_PRODUTO ?? o.produto_produto_cod_produto);
    if (id == null || !code) continue;
    out.push({ erpProductId: id, code, description: asStr(o.PRODUTO_PRODUTO_DESCRICAO1 ?? o.produto_produto_descricao1), typeId });
  }
  return out;
}

/** Mesmo codigo de produto em 2 tipos / mesmo id com 2 codigos: fica o ultimo visto. */
export function dedupeCatalogProducts(products: CatalogProduct[]): CatalogProduct[] {
  const byCode = new Map<string, CatalogProduct>();
  const codeById = new Map<number, string>();
  for (const p of products) {
    const prevCode = codeById.get(p.erpProductId);
    if (prevCode != null && prevCode !== p.code) byCode.delete(prevCode);
    byCode.set(p.code, p);
    codeById.set(p.erpProductId, p.code);
  }
  return [...byCode.values()];
}

export async function fetchCostTables(session: string): Promise<CostTable[]> {
  const payload = await lookup(session, "tabela_custo.TABELA", 501, {
    SCRIPT: null,
    DATASOURCE: null,
    TABELA_CUSTO_TABELA: null,
    _DETAILS: true,
    PARAM_6: null,
    PARAM_7: null,
  });
  const out: CostTable[] = [];
  for (const r of rowsOf(payload)) {
    const id = asNum(r.TABELA_CUSTO_TABELA);
    if (id == null) continue;
    out.push({ tableId: id, code: asStr(r.TABELA_CUSTO_CODIGO), description: asStr(r.TABELA_CUSTO_DESCRICAO) });
  }
  return out;
}

function report(session: string, guid: string, params: Record<string, unknown>, label: string): Promise<unknown> {
  const base = baseUrl();
  const origin = base.replace(/\/api\/?$/, "");
  return call(
    `${base}/millenium:wtsreports/reports/process`,
    {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        Origin: origin,
        Referer: `${origin}/files/web-apps/millennium.html`,
        "WTS-Session": session,
        "X-DateFormat": "ISOTZ",
        "X-HTTP-Method": "POST",
        "X-IdentifierCase": "upper",
      },
      body: JSON.stringify({
        CATALOG_GUID: guid,
        PARAMETERS_MODEL: [{ SCRIPT: null, DATASOURCE: null, ...params }],
        UNIVERSE_NAME: "millenium.mdu",
        REPORT_FORMAT: "raw",
        PARAMETERS_DESCRIPTION: label,
      }),
      signal: AbortSignal.timeout(120_000),
    },
    label,
  );
}

/** COD_PRODUTO  ->  custo unitario em centavos (so > 0). */
export async function fetchCostTablePrices(session: string, tableId: number): Promise<Map<string, number>> {
  const payload = await report(
    session,
    PRODUCT_DIVISION_CATALOG_GUID,
    { TABELA_DE_CUSTO: tableId, FILIAL_GERADOR_GERADOR: "", PRODUTO_DIVISAO_DIVISAO: null },
    `tabela de custo ${tableId}`,
  );
  const out = new Map<string, number>();
  for (const r of rowsOf(payload)) {
    const code = asStr(r.PRODUTO_PRODUTO_COD_PRODUTO);
    const unit = asNum(r.F_3814918930);
    if (!code || unit == null || unit <= 0) continue;
    const cents = Math.round(unit * 100);
    if (cents > (out.get(code) ?? 0)) out.set(code, cents);
  }
  return out;
}

/* ---------- Estoque > Produtos (so Edge `erp-stock-sync`; o worker nao usa) ---------- */

export type SaleTable = { tableId: number; code: string; description: string };

const SALE_PRICE_CATALOG_GUID = "{24B9BF6D-E463-4ED9-B74E-DF3AF5E1E02F}";

/** Tabelas de preco de venda (`$lookup=tabela_venda.TABELA`); sem INDEFINIDO (id  0). */
export async function fetchSaleTables(session: string): Promise<SaleTable[]> {
  const payload = await lookup(session, "tabela_venda.TABELA", 501, {
    SCRIPT: null,
    DATASOURCE: null,
    TABELA_VENDA_TABELA: null,
    _DETAILS: true,
    PARAM_6: null,
    PARAM_7: null,
  });
  const out: SaleTable[] = [];
  for (const r of rowsOf(payload)) {
    const id = asNum(r.TABELA_VENDA_TABELA);
    if (id == null || id <= 0) continue;
    out.push({ tableId: id, code: asStr(r.TABELA_VENDA_CODIGO), description: asStr(r.TABELA_VENDA_DESCRICAO) });
  }
  return out;
}

/**
 * COD_PRODUTO  ->  preco de venda em centavos da tabela (wtsreports {24B9BF6D}; `F_3554079995` = venda,
 * `F_3294710456` = custo da tabela de custo passada). Produto com venda bloqueada fica de fora. So > 0.
 */
export async function fetchSalePrices(session: string, costTableId: number, saleTableId: number): Promise<Map<string, number>> {
  const payload = await report(
    session,
    SALE_PRICE_CATALOG_GUID,
    { TABELA_DE_CUSTO: costTableId, TABELA_DE_VENDA: saleTableId, PRODUTO_DIVISAO_DIVISAO: null },
    `tabela de venda ${saleTableId}`,
  );
  const out = new Map<string, number>();
  for (const r of rowsOf(payload)) {
    const code = asStr(r.PRODUTO_PRODUTO_COD_PRODUTO);
    const price = asNum(r.F_3554079995);
    const blocked = r.PRODUTO_PRODUTO_BLOQUEIA_VENDA === true || asStr(r.PRODUTO_PRODUTO_BLOQUEIA_VENDA).toUpperCase() === "S";
    if (!code || price == null || price <= 0 || blocked) continue;
    const cents = Math.round(price * 100);
    if (cents > (out.get(code) ?? 0)) out.set(code, cents);
  }
  return out;
}

export type StoreStockItem = { total: number; locations: Record<string, number> };

/**
 * COD_PRODUTO  ->  estoque da loja por local (ESTOQUEPORLOCAL: ESTOQUE, QUIOSQUE, SHOP010...) e total = soma dos
 * locais (bate 100% com o SALDO do ESTOQUEEMCOMPRA). A entrada cai em ESTOQUE e a venda sai do QUIOSQUE:
 * local negativo com outro positivo = transferencia pendente; so a soma e o estoque real.
 */
export async function fetchStoreStock(session: string, millenniumStoreId: number): Promise<Map<string, StoreStockItem>> {
  const payload = await call(
    `${baseUrl()}/MILLENIUM!FRANQUIAS.RELATORIOS.ESTOQUEPORLOCAL`,
    {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        "WTS-Session": session,
        "X-DateFormat": "ISOTZ",
        "X-HTTP-Method": "GET",
        "X-IdentifierCase": "upper",
      },
      body: JSON.stringify({ FILIAL: millenniumStoreId }),
      signal: AbortSignal.timeout(120_000),
    },
    `estoque filial ${millenniumStoreId}`,
  );
  const out = new Map<string, StoreStockItem>();
  for (const r of rowsOf(payload)) {
    const code = asStr(r.COD_PRODUTO);
    const qty = asNum(r.SALDO) ?? 0;
    if (!code) continue;
    const item = out.get(code) ?? { total: 0, locations: {} };
    const local = asStr(r.LOCAL) || "ESTOQUE";
    item.total += qty;
    item.locations[local] = (item.locations[local] ?? 0) + qty;
    out.set(code, item);
  }
  return out;
}

/** Saldo Atual e Futuro da loja (Pedido de compra), sem periodo: saldo, pedidos em aberto, multipla, bloqueio e cadastro. */
export async function fetchPurchaseStock(session: string, millenniumStoreId: number): Promise<PurchaseStockRow[]> {
  const payload = await call(
    `${baseUrl()}/MILLENIUM!FRANQUIAS.RELATORIOS.ESTOQUEEMCOMPRA?$top=5000`,
    {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        "WTS-Session": session,
        "X-DateFormat": "ISOTZ",
        "X-HTTP-Method": "GET",
        "X-IdentifierCase": "upper",
      },
      body: JSON.stringify({ FILIAL: millenniumStoreId, DESC: null, TIPO: null, DATAI: null, DATAF: null }),
      signal: AbortSignal.timeout(120_000),
    },
    `saldo atual e futuro filial ${millenniumStoreId}`,
  );
  return parsePurchaseStock(payload);
}
