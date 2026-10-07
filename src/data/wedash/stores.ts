import { defaultWeekHours, effectiveWeekHours, openHourFloor, closeHourCeil, parseWeekHours, type StoreWeekHours } from "./storeHours";
import { collaboratorName, shiftName } from "@/lib/format";
import { SELLER_ROLE } from "./engine/goalRows";

export type PointType = "SHOPPING" | "RUA";
export type Division = "WEPINK" | "WPINK";
export type { StoreWeekHours };

export interface Store {
  id: string;
  millenniumFilial: number;
  codFilial: string;
  nome: string;
  fantasia: string;
  cnpj: string;
  cidade: string;
  uf: string;
  tipo: "M" | "F";
  pointType: PointType;
  temWpink: boolean;
  fuso: string;
  /** Horário por dia (0=dom..6=sáb), como configurado. Cálculos usam `effectiveWeekHours(horas)`. */
  horas: StoreWeekHours;
  /** Derivado do horário de hoje / primeira janela aberta — compat charts legados. */
  abertura: number;
  fechamento: number;
  /** Dias da semana fechados (0 = domingo). */
  diasFechados: number[];
  dataInauguracao: string;
  /** Custos da operação (Configurações > Lojas). Ausente/null = não configurado. */
  custos?: StoreCosts;
  /** Tabela de custo do Millennium: completa o custo de produto que vem zerado na margem. */
  costTableId?: number | null;
}

/** Tabela de custo do Millennium (product_cost_table). */
export interface CostTable {
  id: number;
  code: string;
  description: string;
}

/** % sobre o faturamento da marca; aluguel mínimo em R$/mês. null = não configurado. */
export interface StoreCosts {
  royaltiesWepinkPct: number | null;
  royaltiesWpinkPct: number | null;
  marketingWepinkPct: number | null;
  marketingWpinkPct: number | null;
  rentWepinkPct: number | null;
  rentWpinkPct: number | null;
  /** Aluguel R$/mês: o % do faturamento só soma o que passar dele (aluguel do mês = maior entre os dois). */
  rentMin: number | null;
  /** ICMS % sobre o faturamento da loja (as duas marcas). */
  icmsPct: number | null;
  /** ICMS ST % sobre o custo dos produtos vendidos (CMV). */
  icmsStPct: number | null;
}

export const EMPTY_STORE_COSTS: StoreCosts = {
  royaltiesWepinkPct: null,
  royaltiesWpinkPct: null,
  marketingWepinkPct: null,
  marketingWpinkPct: null,
  rentWepinkPct: null,
  rentWpinkPct: null,
  rentMin: null,
  icmsPct: null,
  icmsStPct: null,
};

/** Campos obrigatórios da loja (WPINK só se a loja vende WPINK). */
/** Algum custo da operação (royalties, marketing, aluguel) preenchido em Configurações > Lojas. */
export function storeOperatingCostsConfigured(s: Store): boolean {
  const c = s.custos;
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
  const c = s.custos ?? EMPTY_STORE_COSTS;
  const base = [c.royaltiesWepinkPct, c.marketingWepinkPct, c.rentWepinkPct, c.rentMin];
  const wpink = s.temWpink ? [c.royaltiesWpinkPct, c.marketingWpinkPct, c.rentWpinkPct] : [];
  return [...base, ...wpink].some((v) => v == null);
}

function derivedOpenClose(horas: StoreWeekHours): {
  abertura: number;
  fechamento: number;
  diasFechados: number[];
} {
  const diasFechados: number[] = [];
  let abertura = 24;
  let fechamento = 0;
  for (let d = 0; d <= 6; d++) {
    const day = horas[d as 0 | 1 | 2 | 3 | 4 | 5 | 6];
    if (!day) {
      diasFechados.push(d);
      continue;
    }
    const a = openHourFloor(day);
    const c = closeHourCeil(day);
    if (a == null || c == null) continue;
    abertura = Math.min(abertura, a);
    fechamento = Math.max(fechamento, c);
  }
  if (abertura >= fechamento) {
    abertura = 9;
    fechamento = 21;
  }
  return { abertura, fechamento, diasFechados };
}

function withHours(
  base: Omit<Store, "horas" | "abertura" | "fechamento" | "diasFechados"> & {
    horas?: StoreWeekHours;
    abertura?: number;
    fechamento?: number;
    diasFechados?: number[];
  },
): Store {
  const horas = base.horas ?? defaultWeekHours();
  const der = derivedOpenClose(effectiveWeekHours(horas));
  return {
    ...base,
    horas,
    abertura: base.abertura ?? der.abertura,
    fechamento: base.fechamento ?? der.fechamento,
    diasFechados: base.diasFechados ?? der.diasFechados,
  };
}

export const stores: Store[] = [
  withHours({
    id: "f1",
    millenniumFilial: 8,
    codFilial: "00008",
    nome: "ESSENCIA PERFUMARIA CG SHOPPING",
    fantasia: "Shopping Campo Grande",
    cnpj: "45.812.330/0001-19",
    cidade: "Campo Grande",
    uf: "MS",
    tipo: "M",
    pointType: "SHOPPING",
    temWpink: false,
    fuso: "America/Campo_Grande",
    horas: {
      0: { open: "12:00", close: "20:00" },
      1: { open: "10:00", close: "22:00" },
      2: { open: "10:00", close: "22:00" },
      3: { open: "10:00", close: "22:00" },
      4: { open: "10:00", close: "22:00" },
      5: { open: "10:00", close: "22:00" },
      6: { open: "10:00", close: "22:00" },
    },
    dataInauguracao: "2024-03-14",
  }),
  withHours({
    id: "f2",
    millenniumFilial: 10,
    codFilial: "00010",
    nome: "ESSENCIA PERFUMARIA TRES LAGOAS",
    fantasia: "Shopping Três Lagoas",
    cnpj: "45.812.330/0002-08",
    cidade: "Três Lagoas",
    uf: "MS",
    tipo: "F",
    pointType: "RUA",
    temWpink: true,
    fuso: "America/Campo_Grande",
    horas: {
      0: null,
      1: { open: "08:00", close: "18:00" },
      2: { open: "08:00", close: "18:00" },
      3: { open: "08:00", close: "18:00" },
      4: { open: "08:00", close: "18:00" },
      5: { open: "08:00", close: "18:00" },
      6: { open: "08:00", close: "18:00" },
    },
    dataInauguracao: "2025-06-02",
  }),
];

export function storeById(id: string): Store {
  const f = allStores().find((x) => x.id === id) ?? stores.find((x) => x.id === id);
  if (!f) throw new Error(`Filial não encontrada: ${id}`);
  return f;
}

/** Casa lojas do Millennium com o catálogo local (millenniumFilial → id). */
export function storeIdsFromErp(
  lista: {
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
  for (const e of lista) {
    const hit = stores.find((f) => f.millenniumFilial === e.storeId);
    if (hit) {
      if (!ids.includes(hit.id)) ids.push(hit.id);
      continue;
    }
    const id = `erp-${e.storeId}`;
    if (!ids.includes(id)) ids.push(id);
    registerExtraStore(
      withHours({
        id,
        millenniumFilial: e.storeId,
        codFilial: e.code ?? String(e.storeId).padStart(5, "0"),
        nome: e.name ?? e.tradeName ?? id,
        fantasia: e.tradeName ?? e.name ?? id,
        cnpj: formatCnpjDisplay(e.taxId ?? ""),
        cidade: e.city ?? "",
        uf: e.state ?? "",
        tipo: e.type ?? "F",
        pointType: "RUA",
        temWpink: Boolean(e.hasWpink),
        fuso: "America/Sao_Paulo",
        dataInauguracao: e.openedAt ?? "2024-01-01",
      }),
    );
  }
  return ids;
}

const CHAVE_EXTRAS = "wedash-filiais-extra";

function lerExtras(): Store[] {
  try {
    const raw = window.localStorage.getItem(CHAVE_EXTRAS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Store[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((s) =>
      withHours({
        ...s,
        horas: s.horas ? parseWeekHours(s.horas) : defaultWeekHours(),
      }),
    );
  } catch {
    return [];
  }
}

function registerExtraStore(f: Store, opts?: { silent?: boolean }) {
  try {
    const atuais = lerExtras().filter((x) => x.id !== f.id);
    window.localStorage.setItem(CHAVE_EXTRAS, JSON.stringify([...atuais, f]));
    if (!opts?.silent) window.dispatchEvent(new Event("wedash:stores"));
  } catch {
    /* ignore */
  }
}

/** Catálogo completo: fixtures + extras vindas do ERP (localStorage). */
export function allStores(): Store[] {
  const map = new Map(stores.map((f) => [f.id, f]));
  for (const e of lerExtras()) map.set(e.id, e);
  return [...map.values()];
}

/**
 * Lojas do produto para filtros/ranking.
 * Se já hidratou ERP (UUIDs), ignora fixtures mock — senão "Todas" misturava f1/f2.
 */
export function productStores(): Store[] {
  const extras = lerExtras();
  return extras.length > 0 ? extras : stores;
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

/** Lojas da sessão: só ids que o membership enxerga (UUIDs reais pós-ERP). */
export function storesForSession(sessionStoreIds: string[]): Store[] {
  if (sessionStoreIds.length === 0) return [];
  const catalog = allStores();
  const hit = catalog.filter((f) => sessionStoreIds.includes(f.id));
  if (hit.length > 0) return hit;
  // Demo: sessão ainda aponta para fixtures f1/f2.
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
  cost_table_id?: number | string | null;
}): Store {
  const horas = parseWeekHours(r.hours);
  const num = (v: number | string | null | undefined) => (v == null || v === "" ? null : Number(v));
  const rentCents = num(r.rent_min_cents);
  return withHours({
    id: r.id,
    millenniumFilial: r.millennium_store_id,
    codFilial: r.code || String(r.millennium_store_id).padStart(5, "0"),
    nome: r.name || r.trade_name || r.code || r.id,
    fantasia: r.trade_name || r.name || r.code || r.id,
    cnpj: formatCnpjDisplay(r.tax_id ?? ""),
    cidade: "",
    uf: "",
    tipo: "F",
    pointType: r.point_type === "STREET" ? "RUA" : "SHOPPING",
    temWpink: Boolean(r.has_wpink),
    fuso: r.timezone || "America/Campo_Grande",
    horas,
    dataInauguracao: r.opened_at ? String(r.opened_at).slice(0, 10) : "2024-01-01",
    custos: {
      royaltiesWepinkPct: num(r.royalties_wepink_pct),
      royaltiesWpinkPct: num(r.royalties_wpink_pct),
      marketingWepinkPct: num(r.marketing_wepink_pct),
      marketingWpinkPct: num(r.marketing_wpink_pct),
      rentWepinkPct: num(r.rent_wepink_pct),
      rentWpinkPct: num(r.rent_wpink_pct),
      rentMin: rentCents == null ? null : rentCents / 100,
      icmsPct: num(r.icms_pct),
      icmsStPct: num(r.icms_st_pct),
    },
    costTableId: num(r.cost_table_id),
  });
}

const STORE_COST_COLUMNS =
  "royalties_wepink_pct, royalties_wpink_pct, marketing_wepink_pct, marketing_wpink_pct, rent_wepink_pct, rent_wpink_pct, rent_min_cents";
const STORE_TAX_COLUMNS = "icms_pct, icms_st_pct";
const STORE_COST_TABLE_COLUMN = "cost_table_id";
const STORE_POINT_TYPE_COLUMN = "point_type";

/**
 * Filtro de marca só faz sentido se alguma loja do escopo tem WPINK.
 * `filialIds` vazio = rede (usa sessionStoreIds).
 */
export function scopeShowsBrandPicker(filialIds: string[], sessionStoreIds: string[]): boolean {
  const ids = filialIds.length > 0 ? filialIds : sessionStoreIds;
  if (ids.length === 0) return false;
  const byId = new Map(storesForSession(sessionStoreIds).map((s) => [s.id, s]));
  return ids.some((id) => byId.get(id)?.temWpink === true);
}

/** Formata CNPJ 14 dígitos; se já vier mascarado, devolve como está. */
export function formatCnpjDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 14) return raw.trim();
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

/**
 * Carrega lojas do Postgres (UUIDs da membership) e registra no catálogo local.
 * Sem isso o StorePicker cai no mock f1/f2 e o useScope rejeita a seleção.
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
    if (error?.code === "42703") ({ data, error } = await query(`${baseCols}, ${STORE_COST_COLUMNS}`));
    if (error?.code === "42703") ({ data, error } = await query(baseCols));
    if (error || !data?.length) {
      if (error) console.warn("hydrateSessionStores:", error.message);
      return already;
    }

    const out: Store[] = (data as unknown as Parameters<typeof rowToStore>[0][]).map(rowToStore);
    // Substitui o catálogo local: lojas de resets/reseeds antigos (com horário
    // padrão 9–21) não podem continuar entrando em "Todas" e nos eixos de hora.
    try {
      window.localStorage.setItem(CHAVE_EXTRAS, JSON.stringify(out));
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

/** Persiste fuso + horário semanal (Configurações > Lojas). */
export async function updateStoreSchedule(args: {
  storeId: string;
  timezone: string;
  hours: StoreWeekHours;
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
      .update({ timezone: args.timezone, hours: payloadHours })
      .eq("id", args.storeId);

    if (error) return { ok: false, error: error.message };

    const existing = allStores().find((s) => s.id === args.storeId);
    if (existing) {
      registerExtraStore(
        withHours({
          ...existing,
          fuso: args.timezone,
          horas: args.hours,
        }),
      );
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Tabelas de custo do Millennium (sincronizadas pelo worker). Falha → []. */
export async function fetchCostTables(): Promise<CostTable[]> {
  try {
    const { getSupabase } = await import("@/lib/supabase");
    const sb = getSupabase();
    if (!sb) return [];
    const { data, error } = await sb.from("product_cost_table").select("table_id, code, description").order("code");
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: Number(r.table_id),
      code: String(r.code ?? ""),
      description: String(r.description ?? ""),
    }));
  } catch (e) {
    console.warn("fetchCostTables:", e);
    return [];
  }
}

/** Tabela de custo da loja (Configurações > Lojas > Custo dos produtos). Gravar fixa a escolha (a detecção automática não mexe mais). */
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

/** Persiste custos da operação da loja (Configurações > Lojas > Custos). */
export async function updateStoreCosts(
  storeId: string,
  custos: StoreCosts,
  pointType?: PointType,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { getSupabase } = await import("@/lib/supabase");
    const sb = getSupabase();
    if (!sb) return { ok: false, error: "Supabase não configurado" };

    const { error } = await sb
      .from("store")
      .update({
        royalties_wepink_pct: custos.royaltiesWepinkPct,
        royalties_wpink_pct: custos.royaltiesWpinkPct,
        marketing_wepink_pct: custos.marketingWepinkPct,
        marketing_wpink_pct: custos.marketingWpinkPct,
        rent_wepink_pct: custos.rentWepinkPct,
        rent_wpink_pct: custos.rentWpinkPct,
        rent_min_cents: custos.rentMin == null ? null : Math.round(custos.rentMin * 100),
        icms_pct: custos.icmsPct,
        icms_st_pct: custos.icmsStPct,
        ...(pointType ? { point_type: pointType === "RUA" ? "STREET" : "MALL" } : {}),
      })
      .eq("id", storeId);
    if (error) return { ok: false, error: error.message };

    const existing = allStores().find((s) => s.id === storeId);
    if (existing) {
      registerExtraStore({ ...existing, custos, ...(pointType ? { pointType } : {}) });
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
  /** CARGO no Millennium (upper); "" = sem cargo no ERP; null = ainda não sincronizado com cargo. */
  role: string | null;
  syncedAt: string;
  /** Turno (store_shift.id) definido na WeDash; null = sem turno. */
  shiftId: string | null;
  /** E-mail do cadastro do Millennium (pré-preenche o convite de acesso). */
  email: string | null;
}

export { SELLER_ROLE };

/** Na equipe de vendas agora: ativo com cargo VENDEDOR (gerência / conta de freelancer fica fora). */
export function isActiveSalesPerson(s: Pick<StoreSeller, "active" | "role">): boolean {
  return s.active && (s.role == null || s.role === SELLER_ROLE);
}

/**
 * Funcionários por loja sincronizados do Millennium (`store_seller`); equipe de vendas = `isActiveSalesPerson`.
 * Só quem ainda está na lista do ERP; ativas primeiro, depois por nome.
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
  // Migration de turnos ainda não aplicada → lista sem turno.
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

/** Turno da loja (Configurações > Lojas > Turnos). Horas em HH:MM local da loja. */
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
  forbidden: "Você não tem permissão para atualizar os vendedores.",
};

/** Busca as vendedoras da loja no Millennium agora (Edge `erp-sellers-sync`) e grava em `store_seller`. */
export async function syncStoreSellersNow(storeId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: false, message: "Não foi possível conectar à WeDash. Verifique sua conexão e tente novamente." };

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
    message: SYNC_SELLERS_ERRORS[code] ?? "Não foi possível atualizar os vendedores. Tente novamente.",
  };
}

type DayHoursJson = { open: string; close: string } | null;

export interface Grupo {
  id: string;
  filialId: string;
  nome: string;
  horaInicio: number;
  horaFim: number;
}

export const grupos: Grupo[] = [
  { id: "t-f1-manha", filialId: "f1", nome: "Grupo 1", horaInicio: 0, horaFim: 16 },
  { id: "t-f1-tarde", filialId: "f1", nome: "Grupo 2", horaInicio: 16, horaFim: 24 },
  { id: "t-f2-manha", filialId: "f2", nome: "Grupo 1", horaInicio: 0, horaFim: 13 },
  { id: "t-f2-tarde", filialId: "f2", nome: "Grupo 2", horaInicio: 13, horaFim: 24 },
];

export interface Tarefa {
  id: string;
  filialId: string;
  grupoId: string;
  titulo: string;
  ordem: number;
}

export const tarefas: Tarefa[] = [
  { id: "tf1", filialId: "f1", grupoId: "t-f1-manha", titulo: "Abrir caixa e conferir fundo de troco", ordem: 1 },
  { id: "tf2", filialId: "f1", grupoId: "t-f1-manha", titulo: "Reposição da vitrine de perfumaria", ordem: 2 },
  { id: "tf3", filialId: "f1", grupoId: "t-f1-manha", titulo: "Testar provadores e repor blotters", ordem: 3 },
  { id: "tf4", filialId: "f1", grupoId: "t-f1-manha", titulo: "Conferir etiquetas de preço da promoção", ordem: 4 },
  { id: "tf5", filialId: "f1", grupoId: "t-f1-manha", titulo: "Limpeza das prateleiras de body splash", ordem: 5 },
  { id: "tf6", filialId: "f1", grupoId: "t-f1-tarde", titulo: "Passagem de grupo: caixa e pendências", ordem: 1 },
  { id: "tf7", filialId: "f1", grupoId: "t-f1-tarde", titulo: "Reposição de estoque na loja", ordem: 2 },
  { id: "tf8", filialId: "f1", grupoId: "t-f1-tarde", titulo: "Organizar kits de presente", ordem: 3 },
  { id: "tf9", filialId: "f1", grupoId: "t-f1-tarde", titulo: "Fechamento de caixa e sangria", ordem: 4 },
  { id: "tf10", filialId: "f2", grupoId: "t-f2-manha", titulo: "Abrir loja e conferir fundo de troco", ordem: 1 },
  { id: "tf11", filialId: "f2", grupoId: "t-f2-manha", titulo: "Conferir vitrine externa", ordem: 2 },
  { id: "tf12", filialId: "f2", grupoId: "t-f2-manha", titulo: "Repor suplementos WPINK no expositor", ordem: 3 },
  { id: "tf13", filialId: "f2", grupoId: "t-f2-manha", titulo: "Registrar temperatura do estoque", ordem: 4 },
  { id: "tf14", filialId: "f2", grupoId: "t-f2-tarde", titulo: "Passagem de grupo", ordem: 1 },
  { id: "tf15", filialId: "f2", grupoId: "t-f2-tarde", titulo: "Reposição de perfumaria", ordem: 2 },
  { id: "tf16", filialId: "f2", grupoId: "t-f2-tarde", titulo: "Fechamento de caixa", ordem: 3 },
];

export interface Categoria {
  id: number;
  nome: string;
  divisao: Division;
  /** CMV como fração do preço de venda (custo de fábrica com imposto). */
  cmvPct: number;
}

/** Categorias por TIPO do ERP, agrupadas por id. */
export const categorias: Categoria[] = [
  { id: 1, nome: "Perfumaria", divisao: "WEPINK", cmvPct: 0.3 },
  { id: 2, nome: "Body Splash", divisao: "WEPINK", cmvPct: 0.27 },
  { id: 3, nome: "Body Cream", divisao: "WEPINK", cmvPct: 0.31 },
  { id: 4, nome: "Hair", divisao: "WEPINK", cmvPct: 0.34 },
  { id: 5, nome: "Skincare", divisao: "WEPINK", cmvPct: 0.36 },
  { id: 6, nome: "Make", divisao: "WEPINK", cmvPct: 0.38 },
  { id: 7, nome: "Kits e presentes", divisao: "WEPINK", cmvPct: 0.33 },
  { id: 8, nome: "Suplementos", divisao: "WPINK", cmvPct: 0.42 },
];

export const paymentMethods = ["Pix", "Cartão de crédito", "Cartão de débito", "Dinheiro"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export interface StoreConfig {
  filialId: string;
  impostoSobreCustoPct: number;
  margemMinimaPct: number | null;
}

export const storeConfigs: StoreConfig[] = [
  { filialId: "f1", impostoSobreCustoPct: 4, margemMinimaPct: 55 },
  { filialId: "f2", impostoSobreCustoPct: 4, margemMinimaPct: null },
];
