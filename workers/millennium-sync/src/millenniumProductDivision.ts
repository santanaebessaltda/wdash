/**
 * Mapa PRODUTO (id interno)  ->  WEPINK | WPINK.
 *
 * 1) wtsreports CATALOG {9701602B...} por geradorxdivisao (estoque  -  incompleto se SALDO=0).
 * 2) LISTARVENDASSALDO TIPO=101/102 por filial + lookup `produto.produto.produto`
 *    (COD_PRODUTO  ->  id)  -  catalogo franquia completo (inclui SKU sem estoque).
 *
 * ConsultaDetMov so traz PRODUTO int; por isso o join COD -> id.
 */
import type { SalesBrand } from "../../../src/data/wedash/salesTypes.ts";
import { millenniumBaseUrl } from "./millenniumAuth.ts";
import { milleniumDataRange } from "./millenniumSales.ts";
import { syncLog } from "./syncLog.ts";

export const PRODUCT_DIVISION_CATALOG_GUID = "{9701602B-B363-4770-989C-8C4459B7E105}";

/** WPINK SUPLEMENTOS */
export const DIVISAO_WPINK = 101;
/** WEPINK (cosmeticos) */
export const DIVISAO_WEPINK = 102;

export type ProductBrandMap = Map<number, SalesBrand>;

/** Filial Millennium + gerador  -  liga LISTARVENDASSALDO ao skip DetMov. */
export type BrandMapStoreRef = {
  millenniumStoreId: number;
  geradorId: number;
};

/** Resultado do catalogo: mapa global + quais geradores tem WPINK (pra pular DetMov). */
export type ProductBrandCatalog = {
  map: ProductBrandMap;
  /** Geradores com 1 SKU na divisao WPINK (101). */
  geradorIdsWithWpink: Set<number>;
};

function reportHeaders(session: string, base: string): Record<string, string> {
  const origin = base.replace(/\/api\/?$/, "");
  return {
    Accept: "*/*",
    "Content-Type": "application/json",
    Origin: origin,
    Referer: `${origin}/files/web-apps/millennium.html`,
    "WTS-Session": session,
    "X-DateFormat": "ISOTZ",
    "X-HTTP-Method": "POST",
    "X-IdentifierCase": "upper",
  };
}

function extractRawData(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  if (Array.isArray(o.RAW_DATA)) return o.RAW_DATA;
  for (const k of ["value", "Value", "data", "Data"]) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [];
}

/** Parse RAW_DATA  ->  productId ints (ignora custo / estoque). */
export function parseProductDivisionRawData(payload: unknown): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of extractRawData(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const v = o.PRODUTO_PRODUTO_PRODUTO ?? o.produto_produto_produto;
    const id =
      typeof v === "number" && Number.isFinite(v)
        ? v
        : typeof v === "string" && /^\d+$/.test(v.trim())
          ? Number(v.trim())
          : null;
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function mergeProductBrandMaps(
  parts: Array<{ brand: SalesBrand; productIds: number[] }>,
): ProductBrandMap {
  const map: ProductBrandMap = new Map();
  for (const part of parts) {
    for (const id of part.productIds) {
      // ultima divisao ganha se houver overlap (nao esperado)
      map.set(id, part.brand);
    }
  }
  return map;
}

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["value", "Value", "data", "Data", "RAW_DATA"]) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [];
}

/** Codigos COD_PRODUTO do LISTARVENDASSALDO. */
export function parseListarVendasSaldoCodes(payload: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of extractList(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const cod = String((raw as Record<string, unknown>).COD_PRODUTO ?? "").trim();
    if (!cod || seen.has(cod)) continue;
    seen.add(cod);
    out.push(cod);
  }
  return out;
}

/** Lookup produto  ->  Map COD_PRODUTO  ->  PRODUTO id. */
export function parseProductCodeToIdLookup(payload: unknown): Map<string, number> {
  const map = new Map<string, number>();
  for (const raw of extractList(payload)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const v = o.PRODUTO_PRODUTO_PRODUTO ?? o.produto_produto_produto;
    const id =
      typeof v === "number" && Number.isFinite(v)
        ? v
        : typeof v === "string" && /^\d+$/.test(v.trim())
          ? Number(v.trim())
          : null;
    const cod = String(o.PRODUTO_PRODUTO_COD_PRODUTO ?? o.produto_produto_cod_produto ?? "").trim();
    if (id == null || !cod) continue;
    map.set(cod, id);
  }
  return map;
}

/** Resolve codigos LISTAR  ->  ids via lookup; ignora COD sem id. */
export function resolveBrandCodesToIds(
  codes: Iterable<string>,
  codeToId: Map<string, number>,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const cod of codes) {
    const id = codeToId.get(cod);
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function fetchListarVendasSaldoCodes(opts: {
  session: string;
  filial: number;
  tipo: number;
  from: string;
  to: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
}): Promise<string[]> {
  const { datai, dataf } = milleniumDataRange(opts.from, opts.to);
  const res = await opts.fetchImpl(
    `${opts.baseUrl}/MILLENIUM!FRANQUIAS.RELATORIOS.LISTARVENDASSALDO`,
    {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        "WTS-Session": opts.session,
        "X-DateFormat": "ISOTZ",
        "X-HTTP-Method": "GET",
        "X-IdentifierCase": "upper",
      },
      body: JSON.stringify({
        FILIAL: opts.filial,
        DESC: null,
        DATAI: datai,
        DATAF: dataf,
        TIPO: opts.tipo,
      }),
      signal: AbortSignal.timeout(90_000),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LISTARVENDASSALDO TIPO=${opts.tipo} → ${res.status} ${text.slice(0, 280)}`);
  }
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`LISTARVENDASSALDO JSON inválido: ${text.slice(0, 200)}`);
  }
  return parseListarVendasSaldoCodes(parsed);
}

async function fetchProductCodeToIdLookup(opts: {
  session: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
}): Promise<Map<string, number>> {
  const res = await opts.fetchImpl(`${opts.baseUrl}/millenium?$lookup=produto.produto.produto`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "WTS-Session": opts.session,
      "X-HTTP-Method": "GET",
      "X-IdentifierCase": "upper",
      "X-DateFormat": "ISOTZ",
    },
    body: "{}",
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`produto lookup → ${res.status} ${text.slice(0, 280)}`);
  }
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`produto lookup JSON inválido: ${text.slice(0, 200)}`);
  }
  return parseProductCodeToIdLookup(parsed);
}

async function fetchDivisionProducts(opts: {
  session: string;
  geradorId: number;
  divisao: number;
  baseUrl: string;
  fetchImpl: typeof fetch;
}): Promise<number[]> {
  const body = {
    CATALOG_GUID: PRODUCT_DIVISION_CATALOG_GUID,
    PARAMETERS_MODEL: [
      {
        SCRIPT: null,
        DATASOURCE: null,
        TABELA_DE_CUSTO: null,
        FILIAL_GERADOR_GERADOR: `(${opts.geradorId})`,
        PRODUTO_DIVISAO_DIVISAO: opts.divisao,
      },
    ],
    UNIVERSE_NAME: "millenium.mdu",
    REPORT_FORMAT: "raw",
    PARAMETERS_DESCRIPTION: `Filial=(${opts.geradorId}) Divisao=${opts.divisao}`,
  };
  const res = await opts.fetchImpl(`${opts.baseUrl}/millenium:wtsreports/reports/process`, {
    method: "POST",
    headers: reportHeaders(opts.session, opts.baseUrl),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`product division ${opts.divisao} → ${res.status} ${text.slice(0, 280)}`);
  }
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`product division JSON inválido: ${text.slice(0, 200)}`);
  }
  return parseProductDivisionRawData(parsed);
}

/**
 * N geradores  ->  mapa uniao + set de geradores que tem WPINK.
 * Com `stores` + from/to: enriquece via LISTARVENDASSALDO (catalogo franquia > estoque).
 * Loja cujo gerador nao esta no set  ->  skip ConsultaDetMov (so ALL).
 */
export async function fetchProductBrandMap(opts: {
  session: string;
  /** Um ou mais geradores; produtos sao uniao (cadastro/estoque varia por loja). */
  geradorIds: number[];
  /** Filiais Millennium + gerador  -  LISTAR completa SKUs sem estoque. */
  stores?: BrandMapStoreRef[];
  /** Janela do LISTAR (so afeta qty faturada; catalogo vem mesmo com SALDO null). */
  from?: string;
  to?: string;
  /** Uma chamada por vez (carga inicial). */
  sequential?: boolean;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<ProductBrandCatalog> {
  const ids = [...new Set(opts.geradorIds.filter((n) => Number.isFinite(n)))];
  if (ids.length === 0) return { map: new Map(), geradorIdsWithWpink: new Set() };
  const base = (opts.baseUrl ?? millenniumBaseUrl()).replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;

  const tasks = ids.flatMap((geradorId) =>
    ([["WPINK", DIVISAO_WPINK], ["WEPINK", DIVISAO_WEPINK]] as const).map(
      ([brand, divisao]) =>
        () =>
          fetchDivisionProducts({ session: opts.session, geradorId, divisao, baseUrl: base, fetchImpl }).then(
            (productIds) => ({ brand, productIds, geradorId }),
          ),
    ),
  );
  const parts: Array<{ brand: "WPINK" | "WEPINK"; productIds: number[]; geradorId: number }> = [];
  if (opts.sequential) {
    for (const task of tasks) parts.push(await task());
  } else {
    parts.push(...(await Promise.all(tasks.map((task) => task()))));
  }

  const geradorIdsWithWpink = new Set<number>();
  for (const part of parts) {
    if (part.brand === "WPINK" && part.productIds.length > 0) {
      geradorIdsWithWpink.add(part.geradorId);
    }
  }

  const map = mergeProductBrandMaps(parts);

  const storeRefs = opts.stores ?? [];
  const from = opts.from;
  const to = opts.to;
  if (storeRefs.length > 0 && from && to) {
    try {
      console.log(`  LISTAR enrich · lookup produto…`);
      const codeToId = await fetchProductCodeToIdLookup({
        session: opts.session,
        baseUrl: base,
        fetchImpl,
      });
      console.log(`  LISTAR enrich · ${codeToId.size} COD→id`);
      // Catalogo franquia: 101=WPINK (fecha buraco do estoque) + 102=WEPINK (idem).
      // 1 filial basta; sequencial (102 pode ser pesado).
      const primary = storeRefs[0]!;
      console.log(`  LISTAR enrich · filial=${primary.millenniumStoreId} TIPO=101…`);
      const wpinkCodes = await fetchListarVendasSaldoCodes({
        session: opts.session,
        filial: primary.millenniumStoreId,
        tipo: DIVISAO_WPINK,
        from,
        to,
        baseUrl: base,
        fetchImpl,
      });
      const wpinkIds = resolveBrandCodesToIds(wpinkCodes, codeToId);
      for (const id of wpinkIds) map.set(id, "WPINK");
      console.log(`  LISTAR enrich · WPINK=${wpinkIds.length}`);

      try {
        console.log(`  LISTAR enrich · filial=${primary.millenniumStoreId} TIPO=102…`);
        const wepinkCodes = await fetchListarVendasSaldoCodes({
          session: opts.session,
          filial: primary.millenniumStoreId,
          tipo: DIVISAO_WEPINK,
          from,
          to,
          baseUrl: base,
          fetchImpl,
        });
        const wepinkIds = resolveBrandCodesToIds(wepinkCodes, codeToId);
        for (const id of wepinkIds) {
          if (map.get(id) === "WPINK") continue; // nao sobrescreve WPINK
          map.set(id, "WEPINK");
        }
        console.log(`  LISTAR enrich · WEPINK+=${wepinkIds.length}`);
      } catch (e102) {
        const msg = e102 instanceof Error ? e102.message : String(e102);
        console.warn(`  LISTAR TIPO=102 falhou (WEPINK via estoque+fallback DetMov): ${msg}`);
      }

      if (wpinkIds.length > 0 && geradorIdsWithWpink.size === 0) {
        for (const s of storeRefs) geradorIdsWithWpink.add(s.geradorId);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`LISTARVENDASSALDO enrich falhou (mapa estoque mantido): ${msg}`);
      syncLog("WARN", "mapa_produtos", `LISTARVENDASSALDO falhou (mapa de estoque mantido): ${msg}`);
    }
  }

  return {
    map,
    geradorIdsWithWpink,
  };
}
