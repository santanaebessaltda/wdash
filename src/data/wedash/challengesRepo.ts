/**
 * Gestao > Desafios  -  tabela `challenge` (1 loja por desafio; varios desafios da loja podem cruzar o periodo).
 * Premio no banco em centavos (`{kind:"MONEY",cents}`); no app em reais (`{kind:"MONEY",amount}`).
 */
import { intervaloDias, somarDias } from "@/lib/format";
import type { GoalTeamMember } from "./goalsRepo";
import type { NonSalesPeople } from "./salesRepo";
import type { SalesSellerDayAgg, SalesSellerProductDayAgg } from "./salesTypes";

/** Tipo do desafio: Itens vendidos  |  Faturamento  |  P.A.  |  Ticket medio  |  Indice de desempenho. */
export type ChallengeMetric = "QUANTITY" | "VALUE" | "PA" | "TICKET" | "INDEX";
/** O que conta em Quantidade/Valor: produtos escolhidos  |  categorias escolhidas  |  tudo o que a pessoa vender. */
export type ChallengeScope = "PRODUCTS" | "CATEGORIES" | "ALL";
/** CONTEST = Quem fizer mais (podio)  |  MINIMUM = Quem chegar ao minimo (todos que chegarem). */
export type ChallengeMode = "CONTEST" | "MINIMUM";

/** Premio: valor em R$ (> 0) ou descricao livre (1 - 60 caracteres). */
export type ChallengePrize = { kind: "MONEY"; amount: number } | { kind: "ITEM"; label: string };

export interface ChallengeProduct {
  code: string;
  /** Nome salvo (produto que sair do catalogo continua com nome). */
  name: string;
}

export interface ChallengeCategory {
  typeId: number;
  name: string;
}

export interface ChallengeRecord {
  id: string;
  storeId: string;
  name: string;
  /** ISO YYYY-MM-DD (inclusive). */
  startsOn: string;
  endsOn: string;
  metric: ChallengeMetric;
  /** Quantidade/Valor; P.A. e ticket = ALL. */
  scope: ChallengeScope;
  mode: ChallengeMode;
  products: ChallengeProduct[];
  categories: ChallengeCategory[];
  /** Minimo (obrigatorio em "Quem chegar ao minimo", opcional em "Quem fizer mais"). Itens = inteiro; P.A. = 2 casas; valor/ticket = R$. */
  target: number | null;
  /** P.A./ticket: vendas minimas para concorrer. */
  minSales: number | null;
  /** Disputa: 1, 2, 3 (1 a 3)  |  Minimo: 1 (por pessoa que atingir). */
  prizes: ChallengePrize[];
  managerPrize: ChallengePrize | null;
  /** Meta da gerencia = media da equipe, na unidade da metrica (Indice: indice da equipe x periodo anterior). So com `managerPrize`. */
  managerTarget: number | null;
}

export type ChallengeInput = Omit<ChallengeRecord, "id">;

export const PRIZE_LABEL_MAX = 60;

const METRICS: readonly ChallengeMetric[] = ["QUANTITY", "VALUE", "PA", "TICKET", "INDEX"];
const SCOPES: readonly ChallengeScope[] = ["PRODUCTS", "CATEGORIES", "ALL"];
const MODES: readonly ChallengeMode[] = ["CONTEST", "MINIMUM"];

export const usesScope = (m: ChallengeMetric) => m === "QUANTITY" || m === "VALUE";
/** Indice de desempenho: gerencia ganha pelo indice da equipe x o mesmo n de dias antes do desafio. */
export const isIndexMetric = (m: ChallengeMetric) => m === "INDEX";

/** Tipo + escopo da linha; aceita o formato antigo (metric PRODUCTS/CATEGORIES = Quantidade). */
function parseMetricScope(metric: string, scope: string | null | undefined): { metric: ChallengeMetric; scope: ChallengeScope } {
  if (metric === "PRODUCTS" || metric === "CATEGORIES") return { metric: "QUANTITY", scope: metric };
  const m = METRICS.includes(metric as ChallengeMetric) ? (metric as ChallengeMetric) : "QUANTITY";
  if (!usesScope(m)) return { metric: m, scope: "ALL" };
  return { metric: m, scope: SCOPES.includes(scope as ChallengeScope) ? (scope as ChallengeScope) : "ALL" };
}

type PrizeJson = { kind?: unknown; cents?: unknown; label?: unknown };

function parsePrize(raw: unknown): ChallengePrize | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as PrizeJson;
  if (p.kind === "MONEY") {
    const cents = Number(p.cents);
    return Number.isFinite(cents) && cents > 0 ? { kind: "MONEY", amount: Math.round(cents) / 100 } : null;
  }
  if (p.kind === "ITEM") {
    const label = String(p.label ?? "").trim().slice(0, PRIZE_LABEL_MAX);
    return label ? { kind: "ITEM", label } : null;
  }
  return null;
}

/** Podio em ordem: um premio invalido corta dali para frente (o 3 nunca vira 2). */
function parsePrizes(raw: unknown): ChallengePrize[] {
  if (!Array.isArray(raw)) return [];
  const out: ChallengePrize[] = [];
  for (const item of raw) {
    const prize = parsePrize(item);
    if (!prize) break;
    out.push(prize);
  }
  return out;
}

function parseProducts(raw: unknown): ChallengeProduct[] {
  if (!Array.isArray(raw)) return [];
  return (raw as { code?: unknown; name?: unknown }[])
    .map((p) => ({ code: String(p?.code ?? "").trim(), name: String(p?.name ?? "").trim() }))
    .filter((p) => p.code);
}

function parseCategories(raw: unknown): ChallengeCategory[] {
  if (!Array.isArray(raw)) return [];
  return (raw as { typeId?: unknown; name?: unknown }[])
    .map((c) => ({ typeId: Number(c?.typeId), name: String(c?.name ?? "").trim() }))
    .filter((c) => Number.isInteger(c.typeId));
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type ChallengeRow = {
  id: string;
  store_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  metric: string;
  scope: string | null;
  mode: string;
  products: unknown;
  categories: unknown;
  /** numeric chega como texto pelo PostgREST. */
  target: number | string | null;
  min_sales: number | null;
  prizes: unknown;
  manager_prize: unknown;
};

/** Meta guardada junto do premio da gerencia; desafio antigo sem ela usa o alvo/piso. */
function parseManagerTarget(raw: unknown, fallback: number | null): number | null {
  const t = raw && typeof raw === "object" && !Array.isArray(raw) ? numOrNull((raw as { target?: unknown }).target) : null;
  return t != null && t > 0 ? t : fallback;
}

export function challengeFromRow(r: ChallengeRow): ChallengeRecord {
  const metricScope = parseMetricScope(r.metric, r.scope);
  const indice = isIndexMetric(metricScope.metric);
  // Indice: o piso das vendedoras nao serve de meta da gerencia (outra escala)  ->  sem meta, sem premio.
  const managerTargetRaw = parseManagerTarget(r.manager_prize, indice ? null : numOrNull(r.target));
  const managerPrize = indice && managerTargetRaw == null ? null : parsePrize(r.manager_prize);
  return {
    id: r.id,
    storeId: r.store_id,
    name: r.name,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    ...metricScope,
    mode: MODES.includes(r.mode as ChallengeMode) ? (r.mode as ChallengeMode) : "CONTEST",
    products: parseProducts(r.products),
    categories: parseCategories(r.categories),
    target: numOrNull(r.target),
    minSales: numOrNull(r.min_sales),
    prizes: parsePrizes(r.prizes),
    managerPrize,
    managerTarget: managerPrize ? managerTargetRaw : null,
  };
}

function prizeToJson(p: ChallengePrize): { kind: "MONEY"; cents: number } | { kind: "ITEM"; label: string } {
  return p.kind === "MONEY"
    ? { kind: "MONEY", cents: Math.round(p.amount * 100) }
    : { kind: "ITEM", label: p.label.trim().slice(0, PRIZE_LABEL_MAX) };
}

/** Linha para insert/update (sem tenant e sem id). */
export function challengeToRow(c: ChallengeInput): Omit<ChallengeRow, "id"> {
  return {
    store_id: c.storeId,
    name: c.name.trim(),
    starts_on: c.startsOn,
    ends_on: c.endsOn,
    metric: c.metric,
    scope: usesScope(c.metric) ? c.scope : "ALL",
    mode: c.mode,
    products: c.products.map((p) => ({ code: p.code, name: p.name })),
    categories: c.categories.map((x) => ({ typeId: x.typeId, name: x.name })),
    target: c.target == null ? null : Math.round(c.target * 100) / 100,
    min_sales: c.minSales,
    prizes: c.prizes.map(prizeToJson),
    manager_prize: c.managerPrize
      ? { ...prizeToJson(c.managerPrize), target: c.managerTarget == null ? null : Math.round(c.managerTarget * 100) / 100 }
      : null,
  };
}

const COLS =
  "id, store_id, name, starts_on, ends_on, metric, scope, mode, products, categories, target, min_sales, prizes, manager_prize";

async function client() {
  const { getSupabase } = await import("@/lib/supabase");
  return getSupabase();
}

/** Desafios das lojas com periodo que cruza [from, to]; mais recentes primeiro. */
export async function fetchChallenges(q: {
  tenantId: string;
  storeIds: string[];
  from: string;
  to: string;
}): Promise<ChallengeRecord[]> {
  if (q.storeIds.length === 0) return [];
  const sb = await client();
  if (!sb) return [];
  const { data, error } = await sb
    .from("challenge")
    .select(COLS)
    .eq("tenant_id", q.tenantId)
    .in("store_id", q.storeIds)
    .lte("starts_on", q.to)
    .gte("ends_on", q.from)
    .order("starts_on", { ascending: false })
    .order("id");
  if (error) {
    console.warn("fetchChallenges:", error.message);
    return [];
  }
  return ((data ?? []) as ChallengeRow[]).map(challengeFromRow);
}

export async function fetchChallenge(tenantId: string, id: string): Promise<ChallengeRecord | null> {
  const sb = await client();
  if (!sb) return null;
  const { data, error } = await sb.from("challenge").select(COLS).eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) {
    console.warn("fetchChallenge:", error.message);
    return null;
  }
  return data ? challengeFromRow(data as ChallengeRow) : null;
}

/** Cria (sem id) ou atualiza o desafio. */
export async function saveChallenge(
  tenantId: string,
  id: string | null,
  c: ChallengeInput,
): Promise<{ ok: true; id: string } | { ok: false }> {
  const sb = await client();
  if (!sb) return { ok: true, id: id ?? "demo" };
  const row = challengeToRow(c);
  const res = id
    ? await sb
        .from("challenge")
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select("id")
        .single()
    : await sb
        .from("challenge")
        .insert({ ...row, tenant_id: tenantId })
        .select("id")
        .single();
  if (res.error) {
    console.warn("saveChallenge:", res.error.message);
    return { ok: false };
  }
  return { ok: true, id: (res.data as { id: string }).id };
}

export async function deleteChallenge(tenantId: string, id: string): Promise<{ ok: boolean }> {
  const sb = await client();
  if (!sb) return { ok: true };
  const { error } = await sb.from("challenge").delete().eq("tenant_id", tenantId).eq("id", id);
  if (error) {
    console.warn("deleteChallenge:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

/** Produto do catalogo no seletor do desafio. */
export interface CatalogProduct {
  code: string;
  name: string;
  typeId: number | null;
  /** Categoria em caixa alta ("" = sem categoria). */
  category: string;
}

export interface CatalogCategory {
  typeId: number;
  name: string;
}

export interface ChallengeCatalog {
  products: CatalogProduct[];
  categories: CatalogCategory[];
  /** COD_PRODUTO  ->  tipo (categoria). */
  typeByCode: Map<string, number>;
}

let catalogPromise: Promise<ChallengeCatalog> | null = null;

/** Catalogo global (produtos + categorias, caixa alta, sem INDEFINIDO). 1x por sessao. */
export function fetchChallengeCatalog(): Promise<ChallengeCatalog> {
  if (catalogPromise) return catalogPromise;
  const run = (async (): Promise<ChallengeCatalog> => {
    const out: ChallengeCatalog = { products: [], categories: [], typeByCode: new Map() };
    const sb = await client();
    if (!sb) return out;
    const { fetchAllPages } = await import("./salesRepo");
    const [rows, typeRes] = await Promise.all([
      fetchAllPages<{ product_code: string; description: string | null; type_id: number | null }>(
        sb.from("product_catalog").select("product_code, description, type_id").order("product_code"),
        "fetchChallengeCatalog",
      ),
      sb.from("product_type").select("type_id, description"),
    ]);
    if (typeRes.error) console.warn("fetchChallengeCatalog:", typeRes.error.message);
    const typeName = new Map<number, string>();
    for (const t of (typeRes.data ?? []) as Array<{ type_id: number; description: string | null }>) {
      const name = (t.description ?? "").trim().toUpperCase();
      if (name && name !== "INDEFINIDO") typeName.set(Number(t.type_id), name);
    }
    out.categories = [...typeName].map(([typeId, name]) => ({ typeId, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    for (const r of rows) {
      const code = String(r.product_code ?? "").trim();
      if (!code) continue;
      const typeId = r.type_id == null ? null : Number(r.type_id);
      if (typeId != null) out.typeByCode.set(code, typeId);
      out.products.push({
        code,
        name: (r.description ?? "").trim().toUpperCase(),
        typeId,
        category: typeId == null ? "" : (typeName.get(typeId) ?? ""),
      });
    }
    out.products.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return out;
  })();
  catalogPromise = run;
  void run.then((c) => {
    if (c.products.length === 0) catalogPromise = null;
  });
  return run;
}

export interface DayRange {
  from: string;
  to: string;
}

/**
 * Janelas do indice da equipe (gerencia no Indice de desempenho): o desafio x o mesmo n de dias logo antes dele.
 * `anterior` = periodo anterior inteiro (texto da tela). Em andamento conta ate ontem nos dois lados (sem dia parcial);
 * `comparado` = null enquanto nao ha dia fechado.
 */
export function managerIndexWindows(
  c: Pick<ChallengeRecord, "startsOn" | "endsOn">,
  today: string,
): { anterior: DayRange; atual: DayRange | null; comparado: DayRange | null } {
  const dur = intervaloDias(c.startsOn, c.endsOn).length;
  const anterior = { from: somarDias(c.startsOn, -dur), to: somarDias(c.startsOn, -1) };
  const fim = c.endsOn < today ? c.endsOn : somarDias(today, -1);
  if (fim < c.startsOn) return { anterior, atual: null, comparado: null };
  const dias = intervaloDias(c.startsOn, fim).length;
  return { anterior, atual: { from: c.startsOn, to: fim }, comparado: { from: anterior.from, to: somarDias(anterior.from, dias - 1) } };
}

/** Dados que a conta do desafio precisa (lidos 1x para todos os desafios da tela). */
export interface ChallengeAggInput {
  /** Itens por pessoa x produto (Produtos/Categorias), sem gerencia / freelancer. */
  sellerProducts: SalesSellerProductDayAgg[];
  /** Vendas, itens e faturamento por pessoa x dia (P.A., ticket e quem vendeu), sem gerencia. */
  sellerDays: SalesSellerDayAgg[];
  /** `storeId|day` com venda da loja (sales_day_agg ALL)  -  base do alerta de resultado incompleto. */
  storeSaleDays: Set<string>;
  team: GoalTeamMember[];
  /** COD_PRODUTO  ->  tipo (categoria). */
  typeByCode: Map<string, number>;
}

export function emptyChallengeAggInput(): ChallengeAggInput {
  return { sellerProducts: [], sellerDays: [], storeSaleDays: new Set(), team: [], typeByCode: new Map() };
}

/** Tira as linhas de gerencia / conta de freelancer (ativos com cargo = VENDEDOR), por gerador e por nome. */
export function excludeNonSalesSellerProducts(
  rows: SalesSellerProductDayAgg[],
  people: NonSalesPeople,
): SalesSellerProductDayAgg[] {
  if (people.geradorIds.size === 0 && people.storeNameKeys.size === 0) return rows;
  return rows.filter(
    (r) => !people.geradorIds.has(r.sellerGeradorId) && !people.storeNameKeys.has(`${r.storeId}|${r.sellerKey}`),
  );
}

type SellerProductRow = {
  tenant_id: string;
  store_id: string;
  day: string;
  seller_gerador_id: number;
  seller_key: string;
  seller_name: string;
  product_code: string;
  product_id: number;
  item_count: number;
  revenue_cents: number;
};

/**
 * Busca, para a uniao das lojas/periodos dos desafios (ate hoje), tudo o que a conta precisa.
 * Itens por pessoa so quando ha desafio de Produtos/Categorias. Falha de leitura = vazio.
 */
export async function fetchChallengeInput(q: {
  tenantId: string;
  challenges: ChallengeRecord[];
  today: string;
}): Promise<ChallengeAggInput> {
  const out = emptyChallengeAggInput();
  if (q.challenges.length === 0) return out;
  const sb = await client();
  if (!sb) return out;
  const { fetchAllPages, fetchNonSalesPeople, fetchSalesDayAggs, fetchSalesSellerDayAggs } = await import("./salesRepo");
  const { fetchGoalTeam } = await import("./goalsRepo");
  const storeIds = [...new Set(q.challenges.map((c) => c.storeId))];
  // Indice com premio da gerencia compara a equipe com o mesmo n de dias antes do desafio.
  const inicio = (c: ChallengeRecord) =>
    isIndexMetric(c.metric) && c.managerPrize ? managerIndexWindows(c, q.today).anterior.from : c.startsOn;
  const from = q.challenges.reduce((m, c) => (inicio(c) < m ? inicio(c) : m), inicio(q.challenges[0]));
  const maxEnd = q.challenges.reduce((m, c) => (c.endsOn > m ? c.endsOn : m), q.challenges[0].endsOn);
  const to = maxEnd < q.today ? maxEnd : q.today;
  const needsItems = q.challenges.some((c) => usesScope(c.metric) && c.scope !== "ALL");
  const needsTypes = q.challenges.some((c) => usesScope(c.metric) && c.scope === "CATEGORIES");

  out.team = await fetchGoalTeam(q.tenantId, storeIds);
  if (from > to) return out;

  const range = { tenantId: q.tenantId, storeIds, from, to };
  const sellerProducts = needsItems
    ? (async () => {
        const ordered = sb
          .from("sales_seller_product_day_agg")
          .select(
            "tenant_id, store_id, day, seller_gerador_id, seller_key, seller_name, product_code, product_id, item_count, revenue_cents",
          )
          .eq("tenant_id", q.tenantId)
          .in("store_id", storeIds)
          .gte("day", from)
          .lte("day", to)
          .order("day")
          .order("store_id")
          .order("seller_gerador_id")
          .order("product_code");
        const [rows, nonSales] = await Promise.all([
          fetchAllPages<SellerProductRow>(ordered, "fetchChallengeInput"),
          fetchNonSalesPeople(sb as unknown as Parameters<typeof fetchNonSalesPeople>[0], q.tenantId),
        ]);
        return excludeNonSalesSellerProducts(
          rows.map((r) => ({
            tenantId: r.tenant_id,
            storeId: r.store_id,
            day: r.day,
            sellerGeradorId: Number(r.seller_gerador_id),
            sellerKey: String(r.seller_key ?? ""),
            sellerName: String(r.seller_name ?? ""),
            productCode: String(r.product_code ?? "").trim(),
            productId: Number(r.product_id) || 0,
            itemCount: Number(r.item_count) || 0,
            revenueCents: Number(r.revenue_cents) || 0,
          })),
          nonSales,
        );
      })()
    : Promise.resolve([] as SalesSellerProductDayAgg[]);

  const [products, sellerDays, storeDays, catalog] = await Promise.all([
    sellerProducts,
    fetchSalesSellerDayAggs(range),
    needsItems ? fetchSalesDayAggs({ ...range, brand: "ALL" }) : Promise.resolve([]),
    needsTypes ? fetchChallengeCatalog() : Promise.resolve(null),
  ]);
  out.sellerProducts = products;
  out.sellerDays = sellerDays;
  for (const d of storeDays) if (d.revenueCents > 0) out.storeSaleDays.add(`${d.storeId}|${d.day}`);
  if (catalog) out.typeByCode = catalog.typeByCode;
  return out;
}
