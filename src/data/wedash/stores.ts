import { defaultWeekHours, effectiveWeekHours, openHourFloor, closeHourCeil, parseWeekHours, type StoreWeekHours } from "./storeHours";
import { collaboratorName, shiftName } from "@/lib/format";
import { SELLER_ROLE } from "./engine/goalRows";

export type PointType = "SHOPPING" | "STREET";
export type Division = "WEPINK" | "WPINK";
export type { StoreWeekHours };

export interface Store {
  id: string;
  millenniumBranch: number;
  branchCode: string;
  name: string;
  tradeName: string;
  cnpj: string;
  city: string;
  uf: string;
  kind: "M" | "F";
  pointType: PointType;
  hasWpink: boolean;
  timezone: string;
  /** Horario por dia (0=dom..6=sab), como configurado. Calculos usam `effectiveWeekHours(horas)`. */
  hours: StoreWeekHours;
  /** Derivado do horario de hoje / primeira janela aberta  -  compat charts legados. */
  opening: number;
  closing: number;
  /** Dias da semana fechados (0 = domingo). */
  daysClosed: number[];
  openedAt: string;
  /** Custos da operacao (Configuracoes > Lojas). Ausente/null = nao configurado. */
  costs?: StoreCosts;
  /** Tabela de custo do Millennium: completa o custo de produto que vem zerado na margem. */
  costTableId?: number | null;
  /** false = desativada: some do seletor e da operacao. Ausente = em operacao. */
  active?: boolean;
}

/** Tabela de custo do Millennium (product_cost_table). */
export interface CostTable {
  id: number;
  code: string;
  description: string;
}

/** % sobre o faturamento da marca; aluguel minimo em R$/mes. null = nao configurado. */
export interface StoreCosts {
  royaltiesWepinkPct: number | null;
  royaltiesWpinkPct: number | null;
  marketingWepinkPct: number | null;
  marketingWpinkPct: number | null;
  rentWepinkPct: number | null;
  rentWpinkPct: number | null;
  /** Aluguel R$/mes: o % do faturamento so soma o que passar dele (aluguel do mes = maior entre os dois). */
  rentMin: number | null;
  /** ICMS % sobre o faturamento da marca. */
  icmsWepinkPct: number | null;
  icmsWpinkPct: number | null;
  /** ICMS ST % sobre o CMV da marca. */
  icmsStWepinkPct: number | null;
  icmsStWpinkPct: number | null;
}

export const EMPTY_STORE_COSTS: StoreCosts = {
  royaltiesWepinkPct: null,
  royaltiesWpinkPct: null,
  marketingWepinkPct: null,
  marketingWpinkPct: null,
  rentWepinkPct: null,
  rentWpinkPct: null,
  rentMin: null,
  icmsWepinkPct: null,
  icmsWpinkPct: null,
  icmsStWepinkPct: null,
  icmsStWpinkPct: null,
};

/** Campos obrigatorios da loja (WPINK so se a loja vende WPINK). */
/** Algum custo da operacao (royalties, marketing, aluguel) preenchido em Configuracoes > Lojas. */
export function storeOperatingCostsConfigured(s: Store): boolean {
  const c = s.costs;
  if (!c) return false;
  return [
    c.royaltiesWepinkPct,
    c.royaltiesWpinkPct,
    c.marketingWepinkPct,
    c.marketingWpinkPct,
    c.rentWepinkPct,
    c.rentWpinkPct,
    c.rentMin,
  ].some((v) => v != null);
}

export function storeCostsPending(s: Store): boolean {
  const c = s.costs ?? EMPTY_STORE_COSTS;
  const base = [c.royaltiesWepinkPct, c.marketingWepinkPct, c.rentWepinkPct, c.rentMin];
  const wpink = s.hasWpink ? [c.royaltiesWpinkPct, c.marketingWpinkPct, c.rentWpinkPct] : [];
  return [...base, ...wpink].some((v) => v == null);
}

function derivedOpenClose(hours: StoreWeekHours): {
  opening: number;
  closing: number;
  daysClosed: number[];
} {
  const daysClosed: number[] = [];
  let opening = 24;
  let closing = 0;
  for (let d = 0; d <= 6; d++) {
    const day = hours[d as 0 | 1 | 2 | 3 | 4 | 5 | 6];
    if (!day) {
      daysClosed.push(d);
      continue;
    }
    const a = openHourFloor(day);
    const c = closeHourCeil(day);
    if (a == null || c == null) continue;
    opening = Math.min(opening, a);
    closing = Math.max(closing, c);
  }
  if (opening >= closing) {
    opening = 9;
    closing = 21;
  }
  return { opening, closing, daysClosed };
}

function withHours(
  base: Omit<Store, "hours" | "opening" | "closing" | "daysClosed"> & {
    hours?: StoreWeekHours;
    opening?: number;
    closing?: number;
    daysClosed?: number[];
  },
): Store {
  const hours = base.hours ?? defaultWeekHours();
  const der = derivedOpenClose(effectiveWeekHours(hours));
  return {
    ...base,
    hours,
    opening: base.opening ?? der.opening,
    closing: base.closing ?? der.closing,
    daysClosed: base.daysClosed ?? der.daysClosed,
  };
}

export const stores: Store[] = [
  withHours({
    id: "f1",
    millenniumBranch: 8,
    branchCode: "00008",
    name: "ESSENCIA PERFUMARIA CG SHOPPING",
    tradeName: "Shopping Campo Grande",
    cnpj: "45.812.330/0001-19",
    city: "Campo Grande",
    uf: "MS",
    kind: "M",
    pointType: "SHOPPING",
    hasWpink: false,
    timezone: "America/Campo_Grande",
    hours: {
      0: { open: "12:00", close: "20:00" },
      1: { open: "10:00", close: "22:00" },
      2: { open: "10:00", close: "22:00" },
      3: { open: "10:00", close: "22:00" },
      4: { open: "10:00", close: "22:00" },
      5: { open: "10:00", close: "22:00" },
      6: { open: "10:00", close: "22:00" },
    },
    openedAt: "2024-03-14",
  }),
  withHours({
    id: "f2",
    millenniumBranch: 10,
    branchCode: "00010",
    name: "ESSENCIA PERFUMARIA TRES LAGOAS",
    tradeName: "Shopping Três Lagoas",
    cnpj: "45.812.330/0002-08",
    city: "Três Lagoas",
    uf: "MS",
    kind: "F",
    pointType: "STREET",
    hasWpink: true,
    timezone: "America/Campo_Grande",
    hours: {
      0: null,
      1: { open: "08:00", close: "18:00" },
      2: { open: "08:00", close: "18:00" },
      3: { open: "08:00", close: "18:00" },
      4: { open: "08:00", close: "18:00" },
      5: { open: "08:00", close: "18:00" },
      6: { open: "08:00", close: "18:00" },
    },
    openedAt: "2025-06-02",
  }),
];

export function storeById(id: string): Store {
  const f = allStores().find((x) => x.id === id) ?? stores.find((x) => x.id === id);
  if (!f) throw new Error(`Filial não encontrada: ${id}`);
  return f;
}

/** Casa lojas do Millennium com o catalogo local (millenniumFilial  ->  id). */
export function storeIdsFromErp(
  list: {
    storeId: number;
    tradeName?: string;
    taxId?: string;
    code?: string;
    name?: string;
    type?: "M" | "F";
    hasWpink?: boolean;
    openedAt?: string;
    city?: string;
    state?: string;
  }[],
): string[] {
  const ids: string[] = [];
  for (const e of list) {
    const hit = stores.find((f) => f.millenniumBranch === e.storeId);
    if (hit) {
      if (!ids.includes(hit.id)) ids.push(hit.id);
      continue;
    }
    const id = `erp-${e.storeId}`;
    if (!ids.includes(id)) ids.push(id);
    registerExtraStore(
      withHours({
        id,
        millenniumBranch: e.storeId,
        branchCode: e.code ?? String(e.storeId).padStart(5, "0"),
        name: e.name ?? e.tradeName ?? id,
        tradeName: e.tradeName ?? e.name ?? id,
        cnpj: formatCnpjDisplay(e.taxId ?? ""),
        city: e.city ?? "",
        uf: e.state ?? "",
        kind: e.type ?? "F",
        pointType: "STREET",
        hasWpink: Boolean(e.hasWpink),
        timezone: "America/Sao_Paulo",
        openedAt: e.openedAt ?? "2024-01-01",
      }),
    );
  }
  return ids;
}

const ROWKEY_EXTRAS = "wedash-filiais-extra";

function lerExtras(): Store[] {
  try {
    const raw = window.localStorage.getItem(ROWKEY_EXTRAS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Store[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((s) =>
      withHours({
        ...s,
        hours: s.hours ? parseWeekHours(s.hours) : defaultWeekHours(),
      }),
    );
  } catch {
    return [];
  }
}

function registerExtraStore(f: Store, opts?: { silent?: boolean }) {
  try {
    const atuais = lerExtras().filter((x) => x.id !== f.id);
    window.localStorage.setItem(ROWKEY_EXTRAS, JSON.stringify([...atuais, f]));
    if (!opts?.silent) window.dispatchEvent(new Event("wedash:stores"));
  } catch {
    /* ignore */
  }
}

/** Catalogo completo: fixtures + extras vindas do ERP (localStorage). */
export function allStores(): Store[] {
  const map = new Map(stores.map((f) => [f.id, f]));
  for (const e of lerExtras()) map.set(e.id, e);
  return [...map.values()];
}

/**
 * Lojas do produto para filtros/ranking.
 * Se ja hidratou ERP (UUIDs), ignora fixtures mock  -  senao "Todas" misturava f1/f2.
 */
export function productStores(): Store[] {
  const extras = lerExtras();
  return extras.length > 0 ? extras : stores;
}

/** Loja desativada nao entra na operacao. Ausente = em operacao (fixtures e dados antigos). */
export function isOperationalStore(s: { active?: boolean }): boolean {
  return s.active !== false;
}

/**
 * Ids que o usuario enxerga no seletor. Vinculo vazio (exceto vendedor) = todas as lojas ativas.
 * Loja desativada fica de fora mesmo se ainda estiver no vinculo.
 */
export function sessionStoreIds(input: {
  linkedIds: string[];
  tenantStores: { id: string; active: boolean }[];
  role: string;
}): string[] {
  const operational = input.tenantStores.filter((s) => s.active);
  if (input.linkedIds.length === 0) {
    if (input.role === "SELLER") return [];
    return operational.map((s) => s.id);
  }
  const allowed = new Set(input.linkedIds);
  return operational.filter((s) => allowed.has(s.id)).map((s) => s.id);
}

/** Lojas da sessao: so ids que o membership enxerga (UUIDs reais pos-ERP). */
export function storesForSession(sessionStoreIds: string[]): Store[] {
  if (sessionStoreIds.length === 0) return [];
  const catalog = allStores();
  const hit = catalog.filter((f) => sessionStoreIds.includes(f.id));
  if (hit.length > 0) return hit;
  // Demo: sessao ainda aponta para fixtures f1/f2.
  return stores.filter((f) => sessionStoreIds.includes(f.id));
}

function rowToStore(r: {
  id: string;
  millennium_store_id: number;
  code: string | null;
  name: string | null;
  trade_name: string | null;
  tax_id?: string | null;
  timezone: string | null;
  opened_at?: string | null;
  has_wpink?: boolean | null;
  hours?: unknown;
  royalties_wepink_pct?: number | string | null;
  royalties_wpink_pct?: number | string | null;
  marketing_wepink_pct?: number | string | null;
  marketing_wpink_pct?: number | string | null;
  rent_wepink_pct?: number | string | null;
  rent_wpink_pct?: number | string | null;
  rent_min_cents?: number | string | null;
  point_type?: string | null;
  icms_pct?: number | string | null;
  icms_st_pct?: number | string | null;
  icms_wepink_pct?: number | string | null;
  icms_wpink_pct?: number | string | null;
  icms_st_wepink_pct?: number | string | null;
  icms_st_wpink_pct?: number | string | null;
  cost_table_id?: number | string | null;
  active?: boolean | null;
}): Store {
  const hours = parseWeekHours(r.hours);
  const num = (v: number | string | null | undefined) => (v == null || v === "" ? null : Number(v));
  const rentCents = num(r.rent_min_cents);
  return withHours({
    id: r.id,
    millenniumBranch: r.millennium_store_id,
    branchCode: r.code || String(r.millennium_store_id).padStart(5, "0"),
    name: r.name || r.trade_name || r.code || r.id,
    tradeName: r.trade_name || r.name || r.code || r.id,
    cnpj: formatCnpjDisplay(r.tax_id ?? ""),
    city: "",
    uf: "",
    kind: "F",
    pointType: r.point_type === "STREET" ? "STREET" : "SHOPPING",
    hasWpink: Boolean(r.has_wpink),
    timezone: r.timezone || "America/Campo_Grande",
    hours,
    openedAt: r.opened_at ? String(r.opened_at).slice(0, 10) : "2024-01-01",
    costs: {
      royaltiesWepinkPct: num(r.royalties_wepink_pct),
      royaltiesWpinkPct: num(r.royalties_wpink_pct),
      marketingWepinkPct: num(r.marketing_wepink_pct),
      marketingWpinkPct: num(r.marketing_wpink_pct),
      rentWepinkPct: num(r.rent_wepink_pct),
      rentWpinkPct: num(r.rent_wpink_pct),
      rentMin: rentCents == null ? null : rentCents / 100,
      icmsWepinkPct: r.icms_wepink_pct !== undefined ? num(r.icms_wepink_pct) : num(r.icms_pct),
      icmsWpinkPct: r.icms_wpink_pct !== undefined ? num(r.icms_wpink_pct) : num(r.icms_pct),
      icmsStWepinkPct: r.icms_st_wepink_pct !== undefined ? num(r.icms_st_wepink_pct) : num(r.icms_st_pct),
      icmsStWpinkPct: r.icms_st_wpink_pct !== undefined ? num(r.icms_st_wpink_pct) : num(r.icms_st_pct),
    },
    costTableId: num(r.cost_table_id),
    active: r.active !== false,
  });
}

const STORE_COST_COLUMNS =
  "royalties_wepink_pct, royalties_wpink_pct, marketing_wepink_pct, marketing_wpink_pct, rent_wepink_pct, rent_wpink_pct, rent_min_cents";
const STORE_TAX_COLUMNS =
  "icms_wepink_pct, icms_wpink_pct, icms_st_wepink_pct, icms_st_wpink_pct, icms_pct, icms_st_pct";
const STORE_TAX_LEGACY_COLUMNS = "icms_pct, icms_st_pct";
const STORE_COST_TABLE_COLUMN = "cost_table_id";
const STORE_POINT_TYPE_COLUMN = "point_type";

/**
 * Filtro de marca so faz sentido se alguma loja do escopo tem WPINK.
 * `filialIds` vazio = rede (usa sessionStoreIds).
 */
export function scopeShowsBrandPicker(storeIds: string[], sessionStoreIds: string[]): boolean {
  const ids = storeIds.length > 0 ? storeIds : sessionStoreIds;
  if (ids.length === 0) return false;
  const byId = new Map(storesForSession(sessionStoreIds).map((s) => [s.id, s]));
  return ids.some((id) => byId.get(id)?.hasWpink === true);
}

/** Formata CNPJ 14 digitos; se ja vier mascarado, devolve como esta. */
export function formatCnpjDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 14) return raw.trim();
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

/**
 * Carrega lojas do Postgres (UUIDs da membership) e registra no catalogo local.
 * Sem isso o StorePicker cai no mock f1/f2 e o useScope rejeita a selecao.
 */
export async function hydrateSessionStores(tenantId: string, sessionStoreIds: string[]): Promise<Store[]> {
  if (sessionStoreIds.length === 0) return [];
  const already = storesForSession(sessionStoreIds);

  try {
    const { getSupabase } = await import("@/lib/supabase");
    const sb = getSupabase();
    if (!sb) return already;

    const baseCols = "id, millennium_store_id, code, name, trade_name, tax_id, timezone, opened_at, has_wpink, hours";
    const query = (cols: string) =>
      sb
        .from("store")
        .select(cols)
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .in("id", sessionStoreIds)
        .order("code");

    let { data, error } = await query(
      `${baseCols}, ${STORE_COST_COLUMNS}, ${STORE_TAX_COLUMNS}, ${STORE_COST_TABLE_COLUMN}, ${STORE_POINT_TYPE_COLUMN}`,
    );
    // Banco sem as migrations de impostos/custos: segue sem eles em vez de cair no mock.
    if (error?.code === "42703")
      ({ data, error } = await query(`${baseCols}, ${STORE_COST_COLUMNS}, ${STORE_TAX_COLUMNS}, ${STORE_COST_TABLE_COLUMN}`));
    if (error?.code === "42703") ({ data, error } = await query(`${baseCols}, ${STORE_COST_COLUMNS}, ${STORE_TAX_COLUMNS}`));
    if (error?.code === "42703")
      ({ data, error } = await query(
        `${baseCols}, ${STORE_COST_COLUMNS}, ${STORE_TAX_LEGACY_COLUMNS}, ${STORE_COST_TABLE_COLUMN}, ${STORE_POINT_TYPE_COLUMN}`,
      ));
    if (error?.code === "42703") ({ data, error } = await query(`${baseCols}, ${STORE_COST_COLUMNS}`));
    if (error?.code === "42703") ({ data, error } = await query(baseCols));
    if (error || !data?.length) {
      if (error) console.warn("hydrateSessionStores:", error.message);
      return already;
    }

    const out: Store[] = (data as unknown as Parameters<typeof rowToStore>[0][]).map(rowToStore);
    // Substitui o catalogo local: lojas de resets/reseeds antigos (com horario
    // padrao 9 - 21) nao podem continuar entrando em "Todas" e nos eixos de hora.
    try {
      window.localStorage.setItem(ROWKEY_EXTRAS, JSON.stringify(out));
    } catch {
      /* ignore */
    }
    if (out.length > 0) window.dispatchEvent(new Event("wedash:stores"));
    return out.length > 0 ? out : already;
  } catch (e) {
    console.warn("hydrateSessionStores:", e);
    return already;
  }
}

const STORE_BASE_COLUMNS =
  "id, millennium_store_id, code, name, trade_name, tax_id, timezone, opened_at, has_wpink, hours, active";

async function selectStoreRows(
  tenantId: string,
  opts: { ids?: string[]; activeOnly?: boolean },
): Promise<Parameters<typeof rowToStore>[0][] | null> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return null;
  const run = (cols: string) => {
    let q = sb.from("store").select(cols).eq("tenant_id", tenantId).order("code");
    if (opts.activeOnly) q = q.eq("active", true);
    if (opts.ids) q = q.in("id", opts.ids);
    return q;
  };
  const full =
    STORE_BASE_COLUMNS +
    ", " +
    STORE_COST_COLUMNS +
    ", " +
    STORE_TAX_COLUMNS +
    ", " +
    STORE_COST_TABLE_COLUMN +
    ", " +
    STORE_POINT_TYPE_COLUMN;
  const withTable = STORE_BASE_COLUMNS + ", " + STORE_COST_COLUMNS + ", " + STORE_TAX_COLUMNS + ", " + STORE_COST_TABLE_COLUMN;
  const withTax = STORE_BASE_COLUMNS + ", " + STORE_COST_COLUMNS + ", " + STORE_TAX_COLUMNS;
  const withLegacyTax =
    STORE_BASE_COLUMNS +
    ", " +
    STORE_COST_COLUMNS +
    ", " +
    STORE_TAX_LEGACY_COLUMNS +
    ", " +
    STORE_COST_TABLE_COLUMN +
    ", " +
    STORE_POINT_TYPE_COLUMN;
  const withCost = STORE_BASE_COLUMNS + ", " + STORE_COST_COLUMNS;
  let { data, error } = await run(full);
  if (error?.code === "42703") ({ data, error } = await run(withTable));
  if (error?.code === "42703") ({ data, error } = await run(withTax));
  if (error?.code === "42703") ({ data, error } = await run(withLegacyTax));
  if (error?.code === "42703") ({ data, error } = await run(withCost));
  if (error?.code === "42703") ({ data, error } = await run(STORE_BASE_COLUMNS));
  if (error) {
    console.warn("selectStoreRows:", error.message);
    return null;
  }
  return (data ?? []) as unknown as Parameters<typeof rowToStore>[0][];
}

/**
 * Lojas da lista de Administracao, inclusive as desativadas.
 * Vinculo vazio = todas as lojas da empresa. Vinculo preenchido = so essas.
 */
export async function fetchManagedStores(tenantId: string, membershipId: string): Promise<Store[]> {
  try {
    const { getSupabase } = await import("@/lib/supabase");
    const sb = getSupabase();
    if (!sb) return stores;
    const { data: links, error } = await sb.from("membership_store").select("store_id").eq("membership_id", membershipId);
    if (error) {
      console.warn("fetchManagedStores:", error.message);
      return [];
    }
    const ids = (links ?? []).map((r) => r.store_id as string);
    const rows = await selectStoreRows(tenantId, ids.length > 0 ? { ids } : {});
    if (!rows) return [];
    return rows.map(rowToStore);
  } catch (e) {
    console.warn("fetchManagedStores:", e);
    return [];
  }
}

const SAVE_FAIL = "Não foi possível salvar as alterações. Tente novamente.";

/** Liga ou desliga a loja na operacao. Desativada, ela sai do catalogo local. */
export async function setStoreActive(storeId: string, active: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { getSupabase } = await import("@/lib/supabase");
    const sb = getSupabase();
    if (!sb) return { ok: false, error: SAVE_FAIL };
    const { error } = await sb.from("store").update({ active }).eq("id", storeId);
    if (error) return { ok: false, error: SAVE_FAIL };
    if (!active) {
      try {
        const atuais = lerExtras().filter((x) => x.id !== storeId);
        window.localStorage.setItem(ROWKEY_EXTRAS, JSON.stringify(atuais));
        window.dispatchEvent(new Event("wedash:stores"));
      } catch {
        /* ignore */
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, error: SAVE_FAIL };
  }
}

/** Persiste fuso + horario semanal (Configuracoes > Lojas). */
export async function updateStoreSchedule(args: {
  storeId: string;
  timezone: string;
  hours: StoreWeekHours;
  pointType?: PointType;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { getSupabase } = await import("@/lib/supabase");
    const sb = getSupabase();
    if (!sb) return { ok: false, error: "Supabase não configurado" };

    const payloadHours: Record<string, DayHoursJson> = {};
    for (let d = 0; d <= 6; d++) {
      payloadHours[String(d)] = args.hours[d as 0 | 1 | 2 | 3 | 4 | 5 | 6];
    }

    const { error } = await sb
      .from("store")
      .update({
        timezone: args.timezone,
        hours: payloadHours,
        ...(args.pointType ? { point_type: args.pointType === "STREET" ? "STREET" : "MALL" } : {}),
      })
      .eq("id", args.storeId);

    if (error) return { ok: false, error: error.message };

    const existing = allStores().find((s) => s.id === args.storeId);
    if (existing) {
      registerExtraStore(
        withHours({
          ...existing,
          timezone: args.timezone,
          hours: args.hours,
          ...(args.pointType ? { pointType: args.pointType } : {}),
        }),
      );
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Tabelas de custo do Millennium. Falha de leitura devolve null. */
export async function fetchCostTables(): Promise<CostTable[] | null> {
  try {
    const { getSupabase } = await import("@/lib/supabase");
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb.from("product_cost_table").select("table_id, code, description").order("code");
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: Number(r.table_id),
      code: String(r.code ?? ""),
      description: String(r.description ?? ""),
    }));
  } catch (e) {
    console.warn("fetchCostTables:", e);
    return null;
  }
}

/** Tabela de custo da loja (Configuracoes > Lojas > Custo dos produtos). Gravar fixa a escolha (a deteccao automatica nao mexe mais). */
export async function updateStoreCostTable(
  storeId: string,
  costTableId: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { getSupabase } = await import("@/lib/supabase");
    const sb = getSupabase();
    if (!sb) return { ok: false, error: "Supabase não configurado" };

    const { error } = await sb
      .from("store")
      .update({ cost_table_id: costTableId, cost_table_set_at: new Date().toISOString() })
      .eq("id", storeId);
    if (error) return { ok: false, error: error.message };

    const existing = allStores().find((s) => s.id === storeId);
    if (existing) registerExtraStore({ ...existing, costTableId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Persiste custos da operacao da loja (Configuracoes > Lojas > Custos). */
export async function updateStoreCosts(
  storeId: string,
  costs: StoreCosts,
  pointType?: PointType,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { getSupabase } = await import("@/lib/supabase");
    const sb = getSupabase();
    if (!sb) return { ok: false, error: "Supabase não configurado" };

    const { error } = await sb
      .from("store")
      .update({
        royalties_wepink_pct: costs.royaltiesWepinkPct,
        royalties_wpink_pct: costs.royaltiesWpinkPct,
        marketing_wepink_pct: costs.marketingWepinkPct,
        marketing_wpink_pct: costs.marketingWpinkPct,
        rent_wepink_pct: costs.rentWepinkPct,
        rent_wpink_pct: costs.rentWpinkPct,
        rent_min_cents: costs.rentMin == null ? null : Math.round(costs.rentMin * 100),
        icms_wepink_pct: costs.icmsWepinkPct,
        icms_wpink_pct: costs.icmsWpinkPct,
        icms_st_wepink_pct: costs.icmsStWepinkPct,
        icms_st_wpink_pct: costs.icmsStWpinkPct,
        ...(pointType ? { point_type: pointType === "STREET" ? "STREET" : "MALL" } : {}),
      })
      .eq("id", storeId);
    if (error) return { ok: false, error: error.message };

    const existing = allStores().find((s) => s.id === storeId);
    if (existing) {
      registerExtraStore({ ...existing, costs, ...(pointType ? { pointType } : {}) });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface StoreSeller {
  id: string;
  name: string;
  /** COD_FUNCIONARIO no Millennium. */
  code: string | null;
  /** false = desativada / afastada / oculta no caixa no ERP. */
  active: boolean;
  /** CARGO no Millennium (upper); "" = sem cargo no ERP; null = ainda nao sincronizado com cargo. */
  role: string | null;
  syncedAt: string;
  /** Turno (store_shift.id) definido na WeDash; null = sem turno. */
  shiftId: string | null;
  /** E-mail do cadastro do Millennium (pre-preenche o convite de acesso). */
  email: string | null;
}

export { SELLER_ROLE };

/** Na equipe de vendas agora: ativo com cargo VENDEDOR (gerencia / conta de freelancer fica fora do ranking). */
export function isActiveSalesPerson(s: Pick<StoreSeller, "active" | "role">): boolean {
  return s.active && (s.role == null || s.role === SELLER_ROLE);
}

/** Cargos que a tela Gestão > Equipe lista. O ranking continua só com `isActiveSalesPerson`. */
const BRANCH_TEAM_ROLES = new Set<string>([SELLER_ROLE, "GERENCIA", "OPERADOR DE CAIXA"]);

/** Ativo na lista da filial: vendedor, operador de caixa ou gerência. Cargo null (legado, ainda não sincronizado) conta como vendedor. */
export function isBranchTeamMember(s: Pick<StoreSeller, "active" | "role">): boolean {
  return s.active && (s.role == null || BRANCH_TEAM_ROLES.has(s.role));
}

/** Rótulo do cargo do Millennium na tela Equipe. */
export function branchRoleLabel(role: string | null): string {
  if (role == null || role === SELLER_ROLE) return "Vendedor";
  if (role === "") return "Sem cargo";
  if (role === "GERENCIA") return "Gerência";
  if (role === "OPERADOR DE CAIXA") return "Operador de caixa";
  if (role === "INDEFINIDO") return "Indefinido";
  return role;
}

/**
 * Funcionarios por loja sincronizados do Millennium (`store_seller`); equipe de vendas = `isActiveSalesPerson`.
 * So quem ainda esta na lista do ERP; ativas primeiro, depois por nome.
 */
export async function fetchStoreSellers(tenantId: string, storeIds: string[]): Promise<Map<string, StoreSeller[]>> {
  const out = new Map<string, StoreSeller[]>();
  if (storeIds.length === 0) return out;
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return out;

  const query = (cols: string) =>
    sb
      .from("store_seller")
      .select(cols)
      .eq("tenant_id", tenantId)
      .in("store_id", storeIds)
      .eq("in_erp", true)
      .order("active", { ascending: false })
      .order("name")
      .limit(2000);
  const base = "id, store_id, name, code, active, erp_role, synced_at, email";
  let { data, error } = await query(`${base}, shift_id`);
  // Migration de turnos ainda nao aplicada  ->  lista sem turno.
  if (error?.code === "42703") ({ data, error } = await query(base));
  if (error) {
    console.warn("fetchStoreSellers:", error.message);
    return out;
  }
  type Row = {
    id: string;
    store_id: string;
    name: string;
    code: string | null;
    active: boolean;
    erp_role: string | null;
    synced_at: string;
    shift_id?: string | null;
    email?: string | null;
  };
  for (const r of (data ?? []) as unknown as Row[]) {
    const list = out.get(r.store_id) ?? [];
    list.push({
      id: r.id,
      name: collaboratorName(r.name),
      code: r.code,
      active: r.active,
      role: r.erp_role ?? null,
      syncedAt: r.synced_at,
      shiftId: r.shift_id ?? null,
      email: r.email ?? null,
    });
    out.set(r.store_id, list);
  }
  return out;
}

/** Turno da loja (Configuracoes > Lojas > Turnos). Horas em HH:MM local da loja. */
export interface StoreShift {
  id: string;
  name: string;
  start: string;
  end: string;
}

type WriteResult = { ok: true } | { ok: false; error: string };

export async function fetchStoreShifts(tenantId: string, storeId: string): Promise<StoreShift[]> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("store_shift")
    .select("id, name, start_time, end_time")
    .eq("tenant_id", tenantId)
    .eq("store_id", storeId)
    .order("start_time");
  if (error) {
    console.warn("fetchStoreShifts:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    name: shiftName(r.name),
    start: String(r.start_time).slice(0, 5),
    end: String(r.end_time).slice(0, 5),
  }));
}

export async function saveStoreShift(args: {
  tenantId: string;
  storeId: string;
  shift: Omit<StoreShift, "id"> & { id?: string };
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase não configurado" };
  const row = { name: shiftName(args.shift.name), start_time: args.shift.start, end_time: args.shift.end };
  const { data, error } = args.shift.id
    ? await sb.from("store_shift").update(row).eq("id", args.shift.id).select("id").single()
    : await sb
        .from("store_shift")
        .insert({ ...row, tenant_id: args.tenantId, store_id: args.storeId })
        .select("id")
        .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

/** Excluir o turno deixa as vendedoras dele sem turno (FK on delete set null). */
export async function deleteStoreShift(id: string): Promise<WriteResult> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase não configurado" };
  const { error } = await sb.from("store_shift").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function setSellerShift(sellerId: string, shiftId: string | null): Promise<WriteResult> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase não configurado" };
  const { error } = await sb.from("store_seller").update({ shift_id: shiftId }).eq("id", sellerId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

const SYNC_SELLERS_ERRORS: Record<string, string> = {
  credential_missing: "A conexão com o Millennium ainda não foi configurada. Acesse Conta › Integrações para conectar.",
  credential_invalid: "Não foi possível acessar o Millennium. Verifique os dados da integração em Conta › Integrações.",
  integration_paused: "A conexão com o Millennium está desconectada. Acesse Conta › Integrações para conectar novamente.",
  erp_busy: "Este usuário do Millennium está conectado em outro local. Encerre a outra sessão e tente novamente.",
  forbidden: "Você não tem permissão para atualizar a equipe.",
};

/** Horário da última busca de vendedores nas lojas (o `synced_at` mais recente). */
export async function fetchLatestSellerSyncedAt(tenantId: string, storeIds: string[]): Promise<string | null> {
  if (storeIds.length === 0) return null;
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("store_seller")
    .select("synced_at")
    .eq("tenant_id", tenantId)
    .in("store_id", storeIds)
    .order("synced_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("fetchLatestSellerSyncedAt:", error.message);
    return null;
  }
  const at = (data?.[0] as { synced_at?: string } | undefined)?.synced_at;
  return at ?? null;
}

/** Busca as vendedoras da loja no Millennium agora (Edge `erp-sellers-sync`) e grava em `store_seller`. */
export async function syncStoreSellersNow(storeId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: false, message: "Não foi possível conectar à WDash. Verifique sua conexão e tente novamente." };

  const { data, error } = await sb.functions.invoke("erp-sellers-sync", { body: { storeId } });
  let body = data as { ok?: boolean; error?: string } | null;
  if ((!body || typeof body !== "object") && error && typeof error === "object") {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        body = (await ctx.json()) as typeof body;
      } catch {
        /* ignore */
      }
    }
  }
  if (body?.ok === true) return { ok: true };
  const code = body?.error ?? "";
  return {
    ok: false,
    message: SYNC_SELLERS_ERRORS[code] ?? "Não foi possível atualizar a equipe. Tente novamente.",
  };
}

type DayHoursJson = { open: string; close: string } | null;

export interface Group {
  id: string;
  storeId: string;
  name: string;
  hourStart: number;
  hourEnd: number;
}

export const groups: Group[] = [
  { id: "t-f1-manha", storeId: "f1", name: "Grupo 1", hourStart: 0, hourEnd: 16 },
  { id: "t-f1-tarde", storeId: "f1", name: "Grupo 2", hourStart: 16, hourEnd: 24 },
  { id: "t-f2-manha", storeId: "f2", name: "Grupo 1", hourStart: 0, hourEnd: 13 },
  { id: "t-f2-tarde", storeId: "f2", name: "Grupo 2", hourStart: 13, hourEnd: 24 },
];

export interface Task {
  id: string;
  storeId: string;
  groupId: string;
  title: string;
  order: number;
}

export const tasks: Task[] = [
  { id: "tf1", storeId: "f1", groupId: "t-f1-manha", title: "Abrir caixa e conferir fundo de troco", order: 1 },
  { id: "tf2", storeId: "f1", groupId: "t-f1-manha", title: "Reposição da vitrine de perfumaria", order: 2 },
  { id: "tf3", storeId: "f1", groupId: "t-f1-manha", title: "Testar provadores e repor blotters", order: 3 },
  { id: "tf4", storeId: "f1", groupId: "t-f1-manha", title: "Conferir etiquetas de preço da promoção", order: 4 },
  { id: "tf5", storeId: "f1", groupId: "t-f1-manha", title: "Limpeza das prateleiras de body splash", order: 5 },
  { id: "tf6", storeId: "f1", groupId: "t-f1-tarde", title: "Passagem de grupo: caixa e pendências", order: 1 },
  { id: "tf7", storeId: "f1", groupId: "t-f1-tarde", title: "Reposição de estoque na loja", order: 2 },
  { id: "tf8", storeId: "f1", groupId: "t-f1-tarde", title: "Organizar kits de presente", order: 3 },
  { id: "tf9", storeId: "f1", groupId: "t-f1-tarde", title: "Fechamento de caixa e sangria", order: 4 },
  { id: "tf10", storeId: "f2", groupId: "t-f2-manha", title: "Abrir loja e conferir fundo de troco", order: 1 },
  { id: "tf11", storeId: "f2", groupId: "t-f2-manha", title: "Conferir vitrine externa", order: 2 },
  { id: "tf12", storeId: "f2", groupId: "t-f2-manha", title: "Repor suplementos WPINK no expositor", order: 3 },
  { id: "tf13", storeId: "f2", groupId: "t-f2-manha", title: "Registrar temperatura do estoque", order: 4 },
  { id: "tf14", storeId: "f2", groupId: "t-f2-tarde", title: "Passagem de grupo", order: 1 },
  { id: "tf15", storeId: "f2", groupId: "t-f2-tarde", title: "Reposição de perfumaria", order: 2 },
  { id: "tf16", storeId: "f2", groupId: "t-f2-tarde", title: "Fechamento de caixa", order: 3 },
];

export interface Category {
  id: number;
  name: string;
  division: Division;
  /** CMV como fracao do preco de venda (custo de fabrica com imposto). */
  cmvPct: number;
}

/** Categorias por TIPO do ERP, agrupadas por id. */
export const categories: Category[] = [
  { id: 1, name: "Perfumaria", division: "WEPINK", cmvPct: 0.3 },
  { id: 2, name: "Body Splash", division: "WEPINK", cmvPct: 0.27 },
  { id: 3, name: "Body Cream", division: "WEPINK", cmvPct: 0.31 },
  { id: 4, name: "Hair", division: "WEPINK", cmvPct: 0.34 },
  { id: 5, name: "Skincare", division: "WEPINK", cmvPct: 0.36 },
  { id: 6, name: "Make", division: "WEPINK", cmvPct: 0.38 },
  { id: 7, name: "Kits e presentes", division: "WEPINK", cmvPct: 0.33 },
  { id: 8, name: "Suplementos", division: "WPINK", cmvPct: 0.42 },
];

export const paymentMethods = ["Pix", "Cartão de crédito", "Cartão de débito", "Dinheiro"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export interface StoreConfig {
  storeId: string;
  taxSobreCostPct: number;
  marginMinimaPct: number | null;
}

export const storeConfigs: StoreConfig[] = [
  { storeId: "f1", taxSobreCostPct: 4, marginMinimaPct: 55 },
  { storeId: "f2", taxSobreCostPct: 4, marginMinimaPct: null },
];
