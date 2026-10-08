import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decryptPassword } from "./decrypt.ts";
import { createListaMemo } from "./listaFingerprint.ts";
import { loginMillennium, logoutMillennium, millenniumBaseUrl } from "./millenniumAuth.ts";
import {
  eventCodeFromLabel,
  fetchEventosListaTodos,
  resolveSalesEventIds,
  salesEventLabelsCovered,
  type MillenniumEvent,
} from "./millenniumEvents.ts";
import { fetchSalesLista } from "./millenniumSales.ts";
import { fetchFilialGeradorMap, fetchBrandRevenueReport } from "./millenniumBrandReport.ts";
import { fetchConsultaDetMov, type DetMovLine } from "./millenniumDetMov.ts";
import type { CouponBrand } from "./brandSplitFromDetalhe.ts";
import { fetchStoreSellers, type ErpSeller } from "./millenniumSellers.ts";
import { fetchErpStores } from "./millenniumStores.ts";
import { mergeNameKeys, type KnownSeller } from "./sellerLinker.ts";
import { fetchRelatorioMargem } from "./millenniumMargem.ts";
import { fetchCashAccounts, fetchCashCloseReport } from "./millenniumCashClose.ts";
import { fetchStoneConciliation } from "./stoneConciliation.ts";
import { fetchCouponReport } from "./millenniumCouponReport.ts";
import { fetchProductBrandMap } from "./millenniumProductDivision.ts";
import { fetchProductRegistry, fetchProductTypes, fetchProductsOfType } from "./millenniumCatalog.ts";
import { fetchCostTablePrices, fetchCostTables } from "./millenniumCostTable.ts";
import type { CatalogDeps, CatalogEntry } from "./productCatalog.ts";
import { buildCostTableDetectDeps } from "./costTableSync.ts";
import { AUTO_REFRESH_MIN, AUTO_SESSION_MARK, parseStoreHours, planAutoRound, recoveryFloor } from "./autoRefresh.ts";
import {
  addMonths,
  DEEP_EMPTY_MONTHS,
  DEEP_FAIL_WAIT_H,
  DEEP_HISTORY_SPACING_MIN,
  deepHistoryFloor,
  isDeepHistoryWindow,
  monthStart,
  planDeepHistory,
  type DeepStore,
} from "./deepHistory.ts";
import {
  addDaysIso,
  closeHour,
  closeWindow,
  dailyCloseEnabled,
  hourInTz,
  isCloseWindow,
  runSyncJob,
  ymdInTz,
  type SyncCredential,
  type SyncJob,
  type SyncJobDeps,
  type SyncJobKind,
  type SyncStore,
} from "./runSyncJob.ts";
import { autoRefreshEnabled, deepHistorySpan, spanStart } from "./syncConfig.ts";
import { runCashCloseFillJob } from "./cashCloseFill.ts";
import type {
  SalesDayAgg,
  SalesHourAgg,
  CashCloseSale,
  CashCloseDay,
  SalesPaymentDayAgg,
  SalesProductDayAgg,
  SalesProductCostDayAgg,
  SalesSellerDayAgg,
} from "../../../src/data/wedash/salesTypes.ts";

function maxDay(a: string, b: string): string {
  return a > b ? a : b;
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export function createAdminClient(): SupabaseClient {
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const CATALOG_MISS_TTL_MS = 24 * 60 * 60 * 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function buildCatalogDeps(sb: SupabaseClient): CatalogDeps {
  return {
    async countCatalog() {
      const { count, error } = await sb.from("product_catalog").select("product_code", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    async knownProductIds(ids) {
      const known = new Set<number>();
      const since = new Date(Date.now() - CATALOG_MISS_TTL_MS).toISOString();
      for (const part of chunk(ids, 300)) {
        const { data, error } = await sb.from("product_catalog").select("erp_product_id").in("erp_product_id", part);
        if (error) throw error;
        for (const r of data ?? []) known.add(Number(r.erp_product_id));
        const { data: miss, error: missErr } = await sb
          .from("product_catalog_miss")
          .select("erp_product_id")
          .in("erp_product_id", part)
          .gte("checked_at", since);
        if (missErr) throw missErr;
        for (const r of miss ?? []) known.add(Number(r.erp_product_id));
      }
      return known;
    },
    async lookupProducts(ids) {
      const out = new Map<number, CatalogEntry>();
      for (const part of chunk([...new Set(ids)], 300)) {
        const { data, error } = await sb
          .from("product_catalog")
          .select("erp_product_id, product_code, description, type_id")
          .in("erp_product_id", part);
        if (error) throw error;
        for (const r of data ?? []) {
          out.set(Number(r.erp_product_id), {
            code: String(r.product_code),
            description: String(r.description ?? ""),
            typeId: r.type_id == null ? null : Number(r.type_id),
          });
        }
      }
      return out;
    },
    async claimRefresh(owner, leaseSec, minIntervalSec) {
      const { data, error } = await sb.rpc("claim_product_catalog_refresh", {
        p_owner: owner,
        p_lease_seconds: leaseSec,
        p_min_interval_seconds: minIntervalSec,
      });
      if (error) throw error;
      return data === true;
    },
    async releaseRefresh(owner, ok, err) {
      const { error } = await sb.rpc("release_product_catalog_refresh", {
        p_owner: owner,
        p_ok: ok,
        p_error: err ?? null,
      });
      if (error) throw error;
    },
    async upsertTypes(types) {
      if (types.length === 0) return;
      const now = new Date().toISOString();
      const { error } = await sb
        .from("product_type")
        .upsert(types.map((t) => ({ type_id: t.typeId, description: t.description, updated_at: now })), {
          onConflict: "type_id",
        });
      if (error) throw error;
    },
    async upsertProducts(products) {
      if (products.length === 0) return;
      const now = new Date().toISOString();
      // Codigo que trocou de id no ERP: libera o id antigo antes (erp_product_id e unico).
      for (const part of chunk(products, 300)) {
        const { data: clash, error: clashErr } = await sb
          .from("product_catalog")
          .select("product_code, erp_product_id")
          .in("erp_product_id", part.map((p) => p.erpProductId));
        if (clashErr) throw clashErr;
        const codeById = new Map(part.map((p) => [p.erpProductId, p.code]));
        const stale = (clash ?? [])
          .filter((r) => codeById.get(Number(r.erp_product_id)) !== String(r.product_code))
          .map((r) => String(r.product_code));
        if (stale.length > 0) {
          const { error: delErr } = await sb.from("product_catalog").delete().in("product_code", stale);
          if (delErr) throw delErr;
        }
        const { error } = await sb.from("product_catalog").upsert(
          part.map((p) => ({
            product_code: p.code,
            erp_product_id: p.erpProductId,
            description: p.description,
            type_id: p.typeId,
            updated_at: now,
          })),
          { onConflict: "product_code" },
        );
        if (error) throw error;
        const { error: missErr } = await sb
          .from("product_catalog_miss")
          .delete()
          .in("erp_product_id", part.map((p) => p.erpProductId));
        if (missErr) throw missErr;
      }
    },
    async recordMisses(items) {
      if (items.length === 0) return;
      const now = new Date().toISOString();
      const { error } = await sb.from("product_catalog_miss").upsert(
        items.map((i) => ({ erp_product_id: i.erpProductId, product_code: i.code, checked_at: now })),
        { onConflict: "erp_product_id" },
      );
      if (error) throw error;
    },
    fetchTypes: (session) => fetchProductTypes({ session, baseUrl: millenniumBaseUrl() }),
    fetchProductsOfType: (session, typeId) => fetchProductsOfType({ session, typeId, baseUrl: millenniumBaseUrl() }),
    fetchRegistry: (session, millenniumStoreId) => fetchProductRegistry({ session, millenniumStoreId, baseUrl: millenniumBaseUrl() }),
    async saveRegistry(items) {
      let saved = 0;
      for (const part of chunk(items, 500)) {
        const { data, error } = await sb.rpc("set_product_catalog_registry", {
          items: part.map((i) => ({
            product_code: i.code,
            registered_at: i.registeredAt,
            purchase_multiple: i.purchaseMultiple,
            purchase_blocked: i.purchaseBlocked,
          })),
        });
        if (error) throw error;
        saved += Number(data ?? 0);
      }
      return saved;
    },
    async countCostTables() {
      const { count, error } = await sb.from("product_cost_table").select("table_id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    async storeCostTable(storeId) {
      const { data, error } = await sb.from("store").select("cost_table_id").eq("id", storeId).maybeSingle();
      if (error) throw error;
      return data?.cost_table_id == null ? null : Number(data.cost_table_id);
    },
    async coveredCostCodes(tableId, codes) {
      const covered = new Set<string>();
      const since = new Date(Date.now() - CATALOG_MISS_TTL_MS).toISOString();
      for (const part of chunk(codes, 300)) {
        const { data, error } = await sb
          .from("product_cost_table_price")
          .select("product_code")
          .eq("table_id", tableId)
          .in("product_code", part);
        if (error) throw error;
        for (const r of data ?? []) covered.add(String(r.product_code));
        const { data: miss, error: missErr } = await sb
          .from("product_cost_miss")
          .select("product_code")
          .eq("table_id", tableId)
          .in("product_code", part)
          .gte("checked_at", since);
        if (missErr) throw missErr;
        for (const r of miss ?? []) covered.add(String(r.product_code));
      }
      return covered;
    },
    async recordCostMisses(tableId, codes) {
      if (codes.length === 0) return;
      const now = new Date().toISOString();
      const { error } = await sb.from("product_cost_miss").upsert(
        codes.map((c) => ({ table_id: tableId, product_code: c, checked_at: now })),
        { onConflict: "table_id,product_code" },
      );
      if (error) throw error;
    },
    fetchCostTables: (session) => fetchCostTables({ session }),
    fetchCostTablePrices: (session, tableId) => fetchCostTablePrices({ session, tableId }),
    async saveCostTables(tables) {
      const now = new Date().toISOString();
      const { error } = await sb.from("product_cost_table").upsert(
        tables.map((t) => ({ table_id: t.tableId, code: t.code, description: t.description, updated_at: now })),
        { onConflict: "table_id" },
      );
      if (error) throw error;
    },
    async saveCostTablePrices(tableId, prices) {
      const startedAt = new Date().toISOString();
      const rows = [...prices].map(([code, cents]) => ({
        table_id: tableId,
        product_code: code,
        unit_cost_cents: cents,
        updated_at: startedAt,
      }));
      for (const part of chunk(rows, 500)) {
        const { error } = await sb.from("product_cost_table_price").upsert(part, { onConflict: "table_id,product_code" });
        if (error) throw error;
      }
      // Produto que saiu da tabela (ou ficou com custo 0) deixa de completar o custo.
      const { error } = await sb
        .from("product_cost_table_price")
        .delete()
        .eq("table_id", tableId)
        .lt("updated_at", startedAt);
      if (error) throw error;
    },
  };
}

/** Sobrevive entre jobs (buildDeps roda a cada job). */
const listaMemo = createListaMemo();

export function buildDeps(sb: SupabaseClient, erpSecret: string): SyncJobDeps {
  let eventsCache: import("./millenniumEvents.ts").MillenniumEvent[] | null = null;

  return {
    catalog: buildCatalogDeps(sb),
    costTable: buildCostTableDetectDeps(sb),
    listaMemo,
    async hasRunningForCredential(credentialId, excludeJobId) {
      let q = sb
        .from("sync_job")
        .select("id")
        .eq("credential_id", credentialId)
        .eq("status", "RUNNING")
        .limit(1);
      if (excludeJobId) q = q.neq("id", excludeJobId);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },

    async markJobRunning(jobId) {
      // Idempotente: claimNextJob ja promove QUEUED→RUNNING; se ainda QUEUED (testes), promove.
      // Zero linhas = outro worker levou o job (ou ja terminou) — fail closed.
      const { data, error } = await sb
        .from("sync_job")
        .update({ status: "RUNNING", locked_at: new Date().toISOString() })
        .eq("id", jobId)
        .in("status", ["QUEUED", "RUNNING"])
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("job_claim_lost");
    },

    async markJobFinished({ jobId, status, error: errMsg, noSalesChange }) {
      let payload: Record<string, unknown> | undefined;
      if (noSalesChange) {
        const { data, error: readErr } = await sb.from("sync_job").select("payload").eq("id", jobId).single();
        if (readErr) throw readErr;
        payload = { ...((data?.payload ?? {}) as Record<string, unknown>), noSalesChange: true };
      }
      const { error } = await sb
        .from("sync_job")
        .update({
          status,
          error: errMsg ?? null,
          finished_at: new Date().toISOString(),
          ...(payload ? { payload } : {}),
        })
        .eq("id", jobId);
      if (error) throw error;
    },

    async loadCredential(credentialId) {
      const { data, error } = await sb
        .from("erp_credential")
        .select("id, tenant_id, username, password_ciphertext, status")
        .eq("id", credentialId)
        .single();
      if (error || !data) throw error ?? new Error("credential_not_found");
      const password = await decryptPassword(data.password_ciphertext as string, erpSecret);
      return {
        id: data.id as string,
        tenantId: data.tenant_id as string,
        username: data.username as string,
        password,
        status: data.status as SyncCredential["status"],
      };
    },

    async listStores(tenantId) {
      const { data, error } = await sb
        .from("store")
        .select(
          "id, millennium_store_id, code, name, trade_name, tax_id, timezone, opened_at, has_wpink, millennium_gerador_id, last_closed_day",
        )
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("millennium_store_id");
      if (error) throw error;
      const stoneRes = await sb
        .from("store_stone")
        .select("store_id, stone_code, secret_ciphertext, covers")
        .eq("tenant_id", tenantId);
      const stoneByStore = new Map<string, { stone_code: string; secret_ciphertext: string; covers: string }>();
      if (stoneRes.error) console.warn(`AVISO Stone das lojas: ${stoneRes.error.message}`);
      if (!stoneRes.error) {
        for (const row of stoneRes.data ?? []) {
          stoneByStore.set(row.store_id as string, {
            stone_code: row.stone_code as string,
            secret_ciphertext: row.secret_ciphertext as string,
            covers: row.covers as string,
          });
        }
      }
      return ((data ?? []) as Array<{
        id: string;
        millennium_store_id: number;
        code: string | null;
        name: string | null;
        trade_name: string | null;
        tax_id: string | null;
        timezone: string;
        opened_at: string | null;
        has_wpink: boolean | null;
        millennium_gerador_id: number | null;
        last_closed_day: string | null;
      }>).map(
        (r): SyncStore => {
          const stone = stoneByStore.get(r.id);
          return {
            id: r.id,
            millenniumStoreId: r.millennium_store_id,
            code: r.code || String(r.millennium_store_id).padStart(5, "0"),
            name: r.trade_name || r.name || null,
            taxId: r.tax_id,
            timezone: r.timezone || "America/Campo_Grande",
            openedAt: r.opened_at ? String(r.opened_at).slice(0, 10) : null,
            hasWpink: r.has_wpink,
            geradorId: r.millennium_gerador_id,
            lastClosedDay: r.last_closed_day ? String(r.last_closed_day).slice(0, 10) : null,
            stoneCode: stone?.stone_code ?? null,
            stoneSecretCiphertext: stone?.secret_ciphertext ?? null,
            stoneCovers: stone?.covers === "all" ? "all" : stone ? "online_pix" : null,
          };
        },
      );
    },

    async setStoresGerador(rows) {
      for (const r of rows) {
        const { error } = await sb.from("store").update({ millennium_gerador_id: r.geradorId }).eq("id", r.storeId);
        if (error) throw error;
      }
    },

    async fetchErpStores(session) {
      return fetchErpStores({ session });
    },

    async updateStoresFromErp(tenantId, erpStores) {
      const { data, error } = await sb
        .from("store")
        .select("id, millennium_store_id, code, name, trade_name, tax_id, opened_at")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      const byErpId = new Map(
        ((data ?? []) as Array<{
          id: string;
          millennium_store_id: number;
          code: string | null;
          name: string | null;
          trade_name: string | null;
          tax_id: string | null;
          opened_at: string | null;
        }>).map((r) => [Number(r.millennium_store_id), r]),
      );
      let updated = 0;
      let missing = 0;
      for (const s of erpStores) {
        const row = byErpId.get(s.millenniumStoreId);
        if (!row) {
          missing++;
          continue;
        }
        const patch: Record<string, string> = {};
        if (s.code && s.code !== row.code) patch.code = s.code;
        if (s.name && s.name !== row.name) patch.name = s.name;
        if (s.tradeName && s.tradeName !== row.trade_name) patch.trade_name = s.tradeName;
        if (s.taxId && s.taxId !== row.tax_id) patch.tax_id = s.taxId;
        if (s.openedAt && s.openedAt !== (row.opened_at ? String(row.opened_at).slice(0, 10) : null)) patch.opened_at = s.openedAt;
        if (Object.keys(patch).length === 0) continue;
        const { error: upErr } = await sb.from("store").update(patch).eq("id", row.id);
        if (upErr) throw upErr;
        updated++;
      }
      return { updated, missing };
    },

    async markStoresClosed(rows) {
      for (const r of rows) {
        const { error } = await sb
          .from("store")
          .update({ last_closed_day: r.day })
          .eq("id", r.storeId)
          .or(`last_closed_day.is.null,last_closed_day.lt.${r.day}`);
        if (error) throw error;
      }
    },

    async markStoresSynced(storeIds, at) {
      if (storeIds.length === 0) return;
      const { error } = await sb.from("store").update({ last_sync_at: at.toISOString() }).in("id", storeIds);
      if (error) throw error;
    },

    async listExistingDays({ tenantId, storeId, from, to }) {
      const { data, error } = await sb
        .from("sales_day_agg")
        .select("day")
        .eq("tenant_id", tenantId)
        .eq("store_id", storeId)
        .gte("day", from)
        .lte("day", to);
      if (error) throw error;
      const days = new Set<string>();
      for (const r of data ?? []) {
        const d = String((r as { day: string }).day).slice(0, 10);
        if (d) days.add(d);
      }
      return [...days];
    },

    async listDaysWithCmv({ tenantId, storeId, from, to }) {
      const { data, error } = await sb
        .from("sales_day_agg")
        .select("day")
        .eq("tenant_id", tenantId)
        .eq("store_id", storeId)
        .eq("brand", "ALL")
        .not("cmv_cents", "is", null)
        .gte("day", from)
        .lte("day", to);
      if (error) throw error;
      const days = new Set<string>();
      for (const r of data ?? []) {
        const d = String((r as { day: string }).day).slice(0, 10);
        if (d) days.add(d);
      }
      return [...days];
    },

    async listDaysWithProduct({ tenantId, storeId, from, to }) {
      const { data, error } = await sb
        .from("sales_product_day_agg")
        .select("day")
        .eq("tenant_id", tenantId)
        .eq("store_id", storeId)
        .gte("day", from)
        .lte("day", to);
      if (error) throw error;
      const days = new Set<string>();
      for (const r of data ?? []) {
        const d = String((r as { day: string }).day).slice(0, 10);
        if (d) days.add(d);
      }
      return [...days];
    },

    async listDaysPaymentComplete({ tenantId, storeId, from, to }) {
      const days = new Set<string>();
      const { data: payRows, error: payErr } = await sb
        .from("sales_payment_day_agg")
        .select("day")
        .eq("tenant_id", tenantId)
        .eq("store_id", storeId)
        .gte("day", from)
        .lte("day", to);
      if (payErr) throw payErr;
      for (const r of payRows ?? []) {
        const d = String((r as { day: string }).day).slice(0, 10);
        if (d) days.add(d);
      }
      // Dia sem venda: nada a particionar por CONDICAO  -  considera completo.
      const { data: zeroRows, error: zeroErr } = await sb
        .from("sales_day_agg")
        .select("day")
        .eq("tenant_id", tenantId)
        .eq("store_id", storeId)
        .eq("brand", "ALL")
        .eq("revenue_cents", 0)
        .gte("day", from)
        .lte("day", to);
      if (zeroErr) throw zeroErr;
      for (const r of zeroRows ?? []) {
        const d = String((r as { day: string }).day).slice(0, 10);
        if (d) days.add(d);
      }
      return [...days];
    },

    async earliestSalesDay({ tenantId, storeId }) {
      const { data, error } = await sb
        .from("sales_day_agg")
        .select("day")
        .eq("tenant_id", tenantId)
        .eq("store_id", storeId)
        .order("day", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return String((data as { day: string }).day).slice(0, 10);
    },

    login: loginMillennium,
    logout: logoutMillennium,

    async resolveEventoIds(session, tenantId, codFilial) {
      const { data: cached, error: cacheErr } = await sb
        .from("erp_sales_evento")
        .select("code, millennium_evento_id, label")
        .eq("tenant_id", tenantId);
      if (cacheErr) {
        console.warn(
          `[worker] erp_sales_evento read: ${cacheErr.message} — fallback ListaTodos`,
        );
      }
      const fromDb: MillenniumEvent[] = (cached ?? []).map((r) => ({
        id: Number((r as { millennium_evento_id: number }).millennium_evento_id),
        label: String(
          (r as { code?: string; label?: string }).code ??
            (r as { label?: string }).label ??
            "",
        ),
      }));
      if (fromDb.length > 0 && salesEventLabelsCovered(fromDb, codFilial)) {
        return resolveSalesEventIds(fromDb, codFilial);
      }

      if (!eventsCache || !salesEventLabelsCovered(eventsCache, codFilial)) {
        eventsCache = await fetchEventosListaTodos({
          session,
          baseUrl: millenniumBaseUrl(),
        });
      }
      const all = eventsCache;
      if (all.length > 0) {
        const rows = all
          .map((e) => {
            const code = eventCodeFromLabel(e.label) || String(e.id);
            return {
              tenant_id: tenantId,
              code,
              millennium_evento_id: e.id,
              label: e.label,
              updated_at: new Date().toISOString(),
            };
          })
          .filter((r) => r.code.length > 0);
        const { error: upErr } = await sb.from("erp_sales_evento").upsert(rows, {
          onConflict: "tenant_id,code",
        });
        if (upErr) {
          console.warn(`[worker] erp_sales_evento upsert: ${upErr.message}`);
        } else {
          console.log(
            `[worker] EVENTOS cache: ${rows.length} código(s) gravados (tenant=${tenantId.slice(0, 8)}…)`,
          );
        }
      }
      return resolveSalesEventIds(all, codFilial);
    },

    async fetchSalesLista(params) {
      return fetchSalesLista({
        ...params,
        baseUrl: millenniumBaseUrl(),
      });
    },

    async fetchCashAccounts(session) {
      return fetchCashAccounts({ session, baseUrl: millenniumBaseUrl() });
    },

    async fetchCashCloseReport(args) {
      return fetchCashCloseReport({ ...args, baseUrl: millenniumBaseUrl() });
    },

    async fetchStoneCaptures(args) {
      const secret = await decryptPassword(args.secretCiphertext, erpSecret);
      return fetchStoneConciliation({ stoneCode: args.stoneCode, secret, day: args.day });
    },

    async fetchFilialGeradorMap(session) {
      return fetchFilialGeradorMap({
        session,
        baseUrl: millenniumBaseUrl(),
      });
    },

    async fetchProductBrandMap(params) {
      return fetchProductBrandMap({
        session: params.session,
        geradorIds: params.geradorIds,
        stores: params.stores,
        from: params.from,
        to: params.to,
        sequential: params.sequential,
        baseUrl: millenniumBaseUrl(),
      });
    },

    async fetchBrandRevenueReport(params) {
      return fetchBrandRevenueReport({
        session: params.session,
        geradorIds: params.geradorIds,
        from: params.from,
        to: params.to,
        baseUrl: millenniumBaseUrl(),
      });
    },

    async fetchStoreSellers(params) {
      return fetchStoreSellers({
        session: params.session,
        millenniumStoreId: params.millenniumStoreId,
        concurrency: params.concurrency,
        known: params.known,
        baseUrl: millenniumBaseUrl(),
      });
    },

    async loadSellerDirectory(tenantId) {
      const { data, error } = await sb
        .from("store_seller")
        .select("store_id, millennium_employee_id, millennium_gerador_id, name_keys, erp_role")
        .eq("tenant_id", tenantId)
        .limit(5000);
      if (error) throw error;
      const sellers: KnownSeller[] = (data ?? []).map((r) => ({
        storeId: r.store_id as string,
        employeeId: Number(r.millennium_employee_id),
        nameKeys: (r.name_keys as string[] | null) ?? [],
        geradorId: r.millennium_gerador_id == null ? null : Number(r.millennium_gerador_id),
        role: (r.erp_role as string | null) ?? null,
      }));
      return { sellers };
    },

    async syncStoreSellers(args) {
      const now = new Date().toISOString();
      const { data: existing, error: exErr } = await sb
        .from("store_seller")
        .select("millennium_employee_id, name_keys")
        .eq("store_id", args.storeId);
      if (exErr) throw exErr;
      const prevKeys = new Map(
        (existing ?? []).map((r) => [Number(r.millennium_employee_id), (r.name_keys as string[] | null) ?? []]),
      );
      const base = (s: ErpSeller) => ({
        tenant_id: args.tenantId,
        store_id: args.storeId,
        millennium_employee_id: s.employeeId,
        code: s.code || null,
        name: s.name,
        name_keys: mergeNameKeys(prevKeys.get(s.employeeId), s.name),
        erp_login: s.login,
        erp_role: s.role,
        in_erp: true,
        synced_at: now,
      });
      // Consultadas: status + gerador. Nao consultadas (gerador salvo, mesmo cargo): so Lista, status fica o do banco.
      const consulted = args.sellers
        .filter((s) => s.active != null)
        .map((s) => ({
          ...base(s),
          active: s.active,
          erp_flags: s.flags,
          ...(s.geradorId != null ? { millennium_gerador_id: s.geradorId } : {}),
        }));
      const listOnly = args.sellers.filter((s) => s.active == null).map(base);
      for (const payload of [consulted.filter((p) => "millennium_gerador_id" in p), consulted.filter((p) => !("millennium_gerador_id" in p)), listOnly]) {
        if (payload.length === 0) continue;
        const { error } = await sb
          .from("store_seller")
          .upsert(payload, { onConflict: "store_id,millennium_employee_id" });
        if (error) throw error;
      }
      let gone = sb
        .from("store_seller")
        .update({ in_erp: false, synced_at: now })
        .eq("store_id", args.storeId)
        .eq("in_erp", true);
      if (args.sellers.length > 0) {
        gone = gone.not("millennium_employee_id", "in", `(${args.sellers.map((s) => s.employeeId).join(",")})`);
      }
      const { error: goneErr } = await gone;
      if (goneErr) throw goneErr;

      const { error: linkErr } = await sb.rpc("link_seller_day_aggs", {
        p_tenant_id: args.tenantId,
        p_store_id: args.storeId,
      });
      if (linkErr) console.warn(`link_seller_day_aggs: ${linkErr.message}`);

      const { error: accessErr } = await sb.rpc("sync_seller_access", {
        p_tenant_id: args.tenantId,
        p_store_id: args.storeId,
      });
      if (accessErr) console.warn(`sync_seller_access: ${accessErr.message}`);

      const { data: rows, error: rowsErr } = await sb
        .from("store_seller")
        .select("millennium_employee_id, millennium_gerador_id, name_keys, erp_role")
        .eq("store_id", args.storeId);
      if (rowsErr) throw rowsErr;
      return (rows ?? []).map(
        (r): KnownSeller => ({
          storeId: args.storeId,
          employeeId: Number(r.millennium_employee_id),
          nameKeys: (r.name_keys as string[] | null) ?? [],
          geradorId: r.millennium_gerador_id == null ? null : Number(r.millennium_gerador_id),
          role: (r.erp_role as string | null) ?? null,
        }),
      );
    },

    async fetchConsultaDetMov(params) {
      return fetchConsultaDetMov({
        session: params.session,
        codOperacao: params.codOperacao,
        nf: params.nf,
        tipoOperacao: params.tipoOperacao,
        baseUrl: millenniumBaseUrl(),
      });
    },

    async listCouponBrands({ tenantId, storeId, from, to }) {
      const out: CouponBrand[] = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await sb
          .from("sales_coupon_brand")
          .select("coupon_key,day,occurred_at,wepink_cents,wepink_items,wpink_cents,wpink_items,items")
          .eq("tenant_id", tenantId)
          .eq("store_id", storeId)
          .gte("day", from)
          .lte("day", to)
          .order("coupon_key")
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        const rows = data ?? [];
        for (const r of rows) {
          out.push({
            couponKey: String(r.coupon_key),
            day: String(r.day).slice(0, 10),
            occurredAt: new Date(String(r.occurred_at)),
            wepinkCents: Number(r.wepink_cents ?? 0),
            wepinkItems: Number(r.wepink_items ?? 0),
            wpinkCents: Number(r.wpink_cents ?? 0),
            wpinkItems: Number(r.wpink_items ?? 0),
            items: Array.isArray(r.items) ? (r.items as DetMovLine[]) : null,
          });
        }
        if (rows.length < pageSize) return out;
      }
    },

    async upsertCouponBrands({ tenantId, storeId, rows }) {
      for (let i = 0; i < rows.length; i += 500) {
        const payload = rows.slice(i, i + 500).map((r) => ({
          tenant_id: tenantId,
          store_id: storeId,
          coupon_key: r.couponKey,
          day: r.day,
          occurred_at: r.occurredAt.toISOString(),
          wepink_cents: r.wepinkCents,
          wepink_items: r.wepinkItems,
          wpink_cents: r.wpinkCents,
          wpink_items: r.wpinkItems,
          items: r.items ?? null,
          fetched_at: new Date().toISOString(),
        }));
        const { error } = await sb.from("sales_coupon_brand").upsert(payload, {
          onConflict: "tenant_id,store_id,coupon_key",
        });
        if (error) throw error;
      }
    },

    async fetchRelatorioMargem(params) {
      return fetchRelatorioMargem({
        session: params.session,
        millenniumStoreId: params.millenniumStoreId,
        from: params.from,
        to: params.to,
        baseUrl: millenniumBaseUrl(),
      });
    },

    async fetchCouponReport(params) {
      return fetchCouponReport({
        session: params.session,
        geradorId: params.geradorId,
        from: params.from,
        to: params.to,
        baseUrl: millenniumBaseUrl(),
      });
    },

    async upsertDayAggs(rows: SalesDayAgg[]) {
      if (rows.length === 0) return;
      const payload = rows.map((r) => {
        const base = {
          tenant_id: r.tenantId,
          store_id: r.storeId,
          day: r.day,
          brand: r.brand,
          revenue_cents: r.revenueCents,
          sales_count: r.salesCount,
          item_count: r.itemCount,
        };
        // Inclui CMV quando a margem ja classificou (WEPINK/WPINK); omitir em
        // upserts so-Lista (ALL) para nao zerar CMV ja patchado.
        if (r.cmvCents != null) {
          return { ...base, cmv_cents: r.cmvCents };
        }
        return base;
      });
      const { error } = await sb.from("sales_day_agg").upsert(payload, {
        onConflict: "tenant_id,store_id,day,brand",
      });
      if (error) throw error;
    },

    async patchDayCmv(rows) {
      if (rows.length === 0) return;
      for (const r of rows) {
        const { error } = await sb
          .from("sales_day_agg")
          .update({ cmv_cents: r.cmvCents })
          .eq("tenant_id", r.tenantId)
          .eq("store_id", r.storeId)
          .eq("day", r.day)
          .eq("brand", "ALL");
        if (error) throw error;
        // Se ainda nao existe linha ALL (dia sem Lista), cria stub com CMV.
        const { data: existing } = await sb
          .from("sales_day_agg")
          .select("day")
          .eq("tenant_id", r.tenantId)
          .eq("store_id", r.storeId)
          .eq("day", r.day)
          .eq("brand", "ALL")
          .maybeSingle();
        if (!existing) {
          const { error: insErr } = await sb.from("sales_day_agg").insert({
            tenant_id: r.tenantId,
            store_id: r.storeId,
            day: r.day,
            brand: "ALL",
            revenue_cents: 0,
            sales_count: 0,
            item_count: 0,
            cmv_cents: r.cmvCents,
          });
          if (insErr) throw insErr;
        }
      }
    },

    async replaceProductDayAggs(args: {
      tenantId: string;
      storeId: string;
      from: string;
      to: string;
      rows: SalesProductDayAgg[];
    }) {
      const { error: delErr } = await sb
        .from("sales_product_day_agg")
        .delete()
        .eq("tenant_id", args.tenantId)
        .eq("store_id", args.storeId)
        .gte("day", args.from)
        .lte("day", args.to);
      if (delErr) throw delErr;
      if (args.rows.length === 0) return;
      const payload = args.rows.map((r) => ({
        tenant_id: r.tenantId,
        store_id: r.storeId,
        day: r.day,
        product_id: r.productId,
        product_code: r.productCode,
        product_name: r.productName,
        brand: r.brand,
        revenue_cents: r.revenueCents,
        item_count: r.itemCount,
      }));
      const { error } = await sb.from("sales_product_day_agg").upsert(payload, {
        onConflict: "tenant_id,store_id,day,product_id",
      });
      if (error) throw error;
    },

    async replaceSellerProductDayAggs(args) {
      const { error: delErr } = await sb
        .from("sales_seller_product_day_agg")
        .delete()
        .eq("tenant_id", args.tenantId)
        .eq("store_id", args.storeId)
        .gte("day", args.from)
        .lte("day", args.to);
      if (delErr) throw delErr;
      for (const batch of chunk(args.rows, 500)) {
        const { error } = await sb.from("sales_seller_product_day_agg").upsert(
          batch.map((r) => ({
            tenant_id: r.tenantId,
            store_id: r.storeId,
            day: r.day,
            seller_gerador_id: r.sellerGeradorId,
            seller_key: r.sellerKey,
            seller_name: r.sellerName,
            product_code: r.productCode,
            product_id: r.productId,
            item_count: r.itemCount,
            revenue_cents: r.revenueCents,
          })),
          { onConflict: "tenant_id,store_id,day,seller_gerador_id,product_code" },
        );
        if (error) throw error;
      }
    },

    async replacePriceTableDayAggs(args) {
      const { error: delErr } = await sb
        .from("sales_price_table_day_agg")
        .delete()
        .eq("tenant_id", args.tenantId)
        .eq("store_id", args.storeId)
        .gte("day", args.from)
        .lte("day", args.to);
      if (delErr) throw delErr;
      if (args.rows.length === 0) return;
      const { error } = await sb.from("sales_price_table_day_agg").upsert(
        args.rows.map((r) => ({
          tenant_id: args.tenantId,
          store_id: args.storeId,
          day: r.day,
          table_id: r.tableId,
          table_name: r.tableName,
          item_count: r.itemCount,
          revenue_cents: r.revenueCents,
        })),
        { onConflict: "store_id,day,table_id" },
      );
      if (error) throw error;
    },

    async replaceProductCostDayAggs(args: {
      tenantId: string;
      storeId: string;
      days: string[];
      rows: SalesProductCostDayAgg[];
    }) {
      if (args.days.length === 0) return;
      const { error: delErr } = await sb
        .from("sales_product_cost_day_agg")
        .delete()
        .eq("tenant_id", args.tenantId)
        .eq("store_id", args.storeId)
        .in("day", args.days);
      if (delErr) throw delErr;
      if (args.rows.length === 0) return;
      const payload = args.rows.map((r) => ({
        tenant_id: r.tenantId,
        store_id: r.storeId,
        day: r.day,
        product_code: r.productCode,
        item_count: r.itemCount,
        revenue_cents: r.revenueCents,
        cmv_cents: r.cmvCents,
      }));
      const { error } = await sb.from("sales_product_cost_day_agg").upsert(payload, {
        onConflict: "tenant_id,store_id,day,product_code",
      });
      if (error) throw error;
    },

    async replacePaymentDayAggs(args: {
      tenantId: string;
      storeId: string;
      from: string;
      to: string;
      rows: SalesPaymentDayAgg[];
    }) {
      const { error: delErr } = await sb
        .from("sales_payment_day_agg")
        .delete()
        .eq("tenant_id", args.tenantId)
        .eq("store_id", args.storeId)
        .gte("day", args.from)
        .lte("day", args.to);
      if (delErr) throw delErr;
      if (args.rows.length === 0) return;
      const payload = args.rows.map((r) => ({
        tenant_id: r.tenantId,
        store_id: r.storeId,
        day: r.day,
        payment_method: r.paymentMethod,
        brand: r.brand,
        revenue_cents: r.revenueCents,
        sales_count: r.salesCount,
      }));
      const { error } = await sb.from("sales_payment_day_agg").upsert(payload, {
        onConflict: "tenant_id,store_id,day,payment_method",
      });
      if (error) throw error;
    },

    async replaceCashCloseSales(args: {
      tenantId: string;
      storeId: string;
      from: string;
      to: string;
      rows: CashCloseSale[];
    }) {
      const { error: delErr } = await sb
        .from("cash_close_sale")
        .delete()
        .eq("tenant_id", args.tenantId)
        .eq("store_id", args.storeId)
        .gte("day", args.from)
        .lte("day", args.to);
      if (delErr) throw delErr;
      const payload = args.rows.map((r) => ({
        tenant_id: r.tenantId,
        store_id: r.storeId,
        operation_code: r.operationCode,
        day: r.day,
        occurred_at: r.occurredAt,
        payment_method: r.paymentMethod,
        revenue_cents: r.revenueCents,
        seller_name: r.sellerName,
        seller_gerador_id: r.sellerGeradorId,
      }));
      for (let i = 0; i < payload.length; i += 400) {
        const { error } = await sb.from("cash_close_sale").upsert(payload.slice(i, i + 400), {
          onConflict: "tenant_id,store_id,operation_code,payment_method",
        });
        if (error) throw error;
      }
    },

    async replaceCashCloseDays(args: {
      tenantId: string;
      storeId: string;
      from: string;
      to: string;
      rows: CashCloseDay[];
    }) {
      const { error: delErr } = await sb
        .from("cash_close_day")
        .delete()
        .eq("tenant_id", args.tenantId)
        .eq("store_id", args.storeId)
        .gte("day", args.from)
        .lte("day", args.to);
      if (delErr) throw delErr;
      const payload = args.rows.map((r) => ({
        tenant_id: r.tenantId,
        store_id: r.storeId,
        day: r.day,
        payment_method: r.paymentMethod,
        account_id: r.accountId,
        opening_cents: r.openingCents,
        sangria_cents: r.sangriaCents,
        closing_cents: r.closingCents,
        typed_cents: r.typedCents,
      }));
      for (let i = 0; i < payload.length; i += 400) {
        const { error } = await sb.from("cash_close_day").upsert(payload.slice(i, i + 400), {
          onConflict: "tenant_id,store_id,day,payment_method",
        });
        if (error) throw error;
      }
    },

    async replaceStoneCaptures(args) {
      const { error: delErr } = await sb
        .from("stone_capture")
        .delete()
        .eq("tenant_id", args.tenantId)
        .eq("store_id", args.storeId)
        .eq("day", args.day);
      if (delErr) throw delErr;
      const payload = args.rows.map((r) => ({
        tenant_id: r.tenantId,
        store_id: r.storeId,
        day: r.day,
        acquirer_key: r.acquirerKey,
        occurred_at: r.occurredAt,
        account_type: r.accountType,
        payment_method: r.paymentMethod,
        brand_id: r.brandId,
        captured_cents: r.capturedCents,
        authorization_code: r.authorizationCode,
        installments: r.installments,
      }));
      for (let i = 0; i < payload.length; i += 400) {
        const { error } = await sb.from("stone_capture").upsert(payload.slice(i, i + 400), {
          onConflict: "tenant_id,store_id,acquirer_key",
        });
        if (error) throw error;
      }
    },

    async replaceSellerDayAggs(args: {
      tenantId: string;
      storeId: string;
      from: string;
      to: string;
      rows: SalesSellerDayAgg[];
    }) {
      const { error: delErr } = await sb
        .from("sales_seller_day_agg")
        .delete()
        .eq("tenant_id", args.tenantId)
        .eq("store_id", args.storeId)
        .gte("day", args.from)
        .lte("day", args.to);
      if (delErr) throw delErr;
      if (args.rows.length === 0) return;
      const payload = args.rows.map((r) => ({
        tenant_id: r.tenantId,
        store_id: r.storeId,
        day: r.day,
        seller_key: r.sellerKey,
        seller_name: r.sellerName,
        seller_employee_id: r.sellerEmployeeId ?? null,
        seller_gerador_id: r.sellerGeradorId ?? null,
        brand: r.brand,
        revenue_cents: r.revenueCents,
        sales_count: r.salesCount,
        item_count: r.itemCount ?? 0,
      }));
      const { error } = await sb.from("sales_seller_day_agg").upsert(payload, {
        onConflict: "tenant_id,store_id,day,seller_key",
      });
      if (error) throw error;
    },

    async upsertHourAggs(rows: SalesHourAgg[]) {
      if (rows.length === 0) return;
      const payload = rows.map((r) => ({
        tenant_id: r.tenantId,
        store_id: r.storeId,
        day: r.day,
        hour: r.hour,
        brand: r.brand,
        revenue_cents: r.revenueCents,
        sales_count: r.salesCount,
        item_count: r.itemCount,
      }));
      const { error } = await sb.from("sales_hour_agg").upsert(payload, {
        onConflict: "tenant_id,store_id,day,hour,brand",
      });
      if (error) throw error;
    },

    async setStoresHasWpink(rows) {
      for (const r of rows) {
        const { error } = await sb
          .from("store")
          .update({ has_wpink: r.hasWpink })
          .eq("id", r.storeId);
        if (error) throw error;
      }
    },

    async insertSyncRun(args) {
      const { error } = await sb.from("sync_run").insert({
        tenant_id: args.tenantId,
        credential_id: args.credentialId,
        kind: args.kind,
        ok: args.ok,
        stores_done: args.storesDone,
        error: args.error ?? null,
        started_at: args.startedAt.toISOString(),
        finished_at: args.finishedAt.toISOString(),
      });
      if (error) throw error;
    },

    async insertSyncLogs(rows) {
      const { error } = await sb.from("sync_log").insert(
        rows.map((r) => ({
          tenant_id: r.tenantId,
          job_id: r.jobId,
          job_kind: r.jobKind,
          level: r.level,
          source: r.source,
          store_id: r.storeId,
          store_label: r.storeLabel,
          day: r.day,
          message: r.message,
          detail: r.detail,
        })),
      );
      if (error) throw error;
    },

    async updateCredential(args) {
      const patch: Record<string, unknown> = {};
      if (args.status) patch.status = args.status;
      if (args.lastError !== undefined) patch.last_error = args.lastError;
      if (args.lastErrorAt) patch.last_error_at = args.lastErrorAt.toISOString();
      if (args.lastSuccessAt) patch.last_success_at = args.lastSuccessAt.toISOString();
      if (args.lastLightSyncAt) patch.last_light_sync_at = args.lastLightSyncAt.toISOString();
      if (Object.keys(patch).length === 0) return;
      const { error } = await sb.from("erp_credential").update(patch).eq("id", args.credentialId);
      if (error) throw error;
    },

    async getStoredSession(credentialId) {
      const { data, error } = await sb
        .from("erp_credential")
        .select("millennium_session")
        .eq("id", credentialId)
        .maybeSingle();
      if (error) throw error;
      const s = (data as { millennium_session?: string | null } | null)?.millennium_session;
      return typeof s === "string" && s.length > 0 ? s : null;
    },

    async setStoredSession(credentialId, session) {
      const { error } = await sb
        .from("erp_credential")
        .update(
          session
            ? {
                millennium_session: session,
                millennium_session_at: new Date().toISOString(),
                millennium_session_by: "worker",
              }
            : {
                millennium_session: null,
                millennium_session_at: null,
                millennium_session_by: null,
              },
        )
        .eq("id", credentialId);
      if (error) throw error;
    },

    async enqueueMonthFillDay({ tenantId, credentialId, day, fillUntil, storeIds }) {
      const { data: open, error: openErr } = await sb
        .from("sync_job")
        .select("id")
        .eq("credential_id", credentialId)
        .eq("kind", "CLOSE")
        .eq("payload->>to", day)
        .in("status", ["QUEUED", "RUNNING"])
        .limit(1)
        .maybeSingle();
      if (openErr) throw openErr;
      if (open) return false;
      const { error } = await sb.from("sync_job").insert({
        tenant_id: tenantId,
        credential_id: credentialId,
        kind: "CLOSE",
        status: "QUEUED",
        payload: { from: day, to: day, fillUntil, ...(storeIds?.length ? { storeIds } : {}) },
      });
      if (error) throw error;
      return true;
    },

    async hasPriorityJobQueued(credentialId) {
      const { data, error } = await sb
        .from("sync_job")
        .select("id")
        .eq("credential_id", credentialId)
        .in("kind", ["FORCE", "FORCE_LIGHT", "SEED"])
        .eq("status", "QUEUED")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data != null;
    },

    async markJobProgress({ jobId, day }) {
      const { data, error } = await sb.from("sync_job").select("payload").eq("id", jobId).single();
      if (error) throw error;
      const payload = (data?.payload ?? {}) as Record<string, unknown>;
      const { error: upErr } = await sb
        .from("sync_job")
        .update({ payload: { ...payload, progressDay: day } })
        .eq("id", jobId);
      if (upErr) throw upErr;
    },

    now: () => new Date(),
  };
}

/**
 * Fechamento de ontem (CLOSE), 1x por integracao por dia, so na janela da madrugada
 * (CLOSE_HOUR ... +CLOSE_WINDOW_HOURS, fuso da 1 loja). Cobre anteontem tambem se a noite anterior
 * nao fechou. Nao enfileira com onboarding aberto nem com SEED pendente (a carga ja cobre ontem).
 */
export async function enqueueDueCloseJobs(sb: SupabaseClient, now = new Date()): Promise<number> {
  if (!dailyCloseEnabled()) return 0;
  const { data: creds, error } = await sb
    .from("erp_credential")
    .select("id, tenant_id, sync_paused")
    .eq("status", "VALID");
  if (error) throw error;
  let n = 0;
  for (const c of creds ?? []) {
    if (!isIntegrationActive(c as { sync_paused?: boolean | null })) continue;
    const tenantId = c.tenant_id as string;
    const credentialId = c.id as string;

    const { data: firstStore } = await sb
      .from("store")
      .select("timezone")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!firstStore) continue;
    const tz = (firstStore.timezone as string) || "America/Campo_Grande";
    if (!isCloseWindow(hourInTz(now, tz), closeHour())) continue;
    const today = ymdInTz(now, tz);
    const yesterday = addDaysIso(today, -1);

    const { data: already } = await sb
      .from("sync_job")
      .select("id")
      .eq("credential_id", credentialId)
      .eq("kind", "CLOSE")
      .eq("payload->>to", yesterday)
      .limit(1)
      .maybeSingle();
    if (already) continue;

    const { data: onboarding } = await sb
      .from("membership")
      .select("id")
      .eq("tenant_id", tenantId)
      .not("onboarding_step", "is", null)
      .limit(1)
      .maybeSingle();
    if (onboarding) continue;

    const { data: seed } = await sb
      .from("sync_job")
      .select("id")
      .eq("credential_id", credentialId)
      .in("kind", ["SEED", "BACKFILL"])
      .in("status", ["QUEUED", "RUNNING"])
      .limit(1)
      .maybeSingle();
    if (seed) continue;

    // So lojas com dia pendente (a rodada automatica depois do fechamento ja fecha o dia).
    const { data: storeRows, error: storeErr } = await sb
      .from("store")
      .select("id, last_closed_day")
      .eq("tenant_id", tenantId)
      .eq("active", true);
    if (storeErr) throw storeErr;
    const pendingStores = (storeRows ?? [])
      .map((s) => ({
        id: s.id as string,
        lastClosed: s.last_closed_day ? String(s.last_closed_day).slice(0, 10) : null,
      }))
      .filter((s) => !s.lastClosed || s.lastClosed < yesterday);
    if (pendingStores.length === 0) continue;

    const { data: prevCloses, error: prevErr } = await sb
      .from("sync_job")
      .select("status, payload")
      .eq("credential_id", credentialId)
      .eq("kind", "CLOSE")
      .is("payload->>fillUntil", null)
      .is("payload->>deepDone", null)
      .order("created_at", { ascending: false })
      .limit(5);
    if (prevErr) throw prevErr;
    const dayBefore = addDaysIso(today, -2);
    const previousClosed =
      (prevCloses ?? []).length === 0 ||
      (prevCloses ?? []).some(
        (r) => r.status === "SUCCEEDED" && (r.payload as { to?: string } | null)?.to === dayBefore,
      );

    // Loja sem base = ontem (+ anteontem se a noite anterior falhou); com base = desde o dia seguinte
    // ao ultimo fechado, ate o dia 1 do mes anterior.
    const legacyFrom = closeWindow(today, previousClosed).from;
    const floor = recoveryFloor(today);
    const from = pendingStores
      .map((s) => (s.lastClosed ? maxDay(addDaysIso(s.lastClosed, 1), floor) : legacyFrom))
      .reduce((a, b) => (b < a ? b : a));

    const { error: insErr } = await sb.from("sync_job").insert({
      tenant_id: tenantId,
      credential_id: credentialId,
      kind: "CLOSE",
      status: "QUEUED",
      payload: { from, to: yesterday, storeIds: pendingStores.map((s) => s.id) },
    });
    if (insErr) throw insErr;
    n += 1;
  }
  return n;
}

/**
 * Atualizacao automatica: enfileira o Atualizar de hoje (FORCE com `auto: true`) das lojas no expediente
 * 30 min depois da ultima rodada automatica + a ultima rodada do dia (fechamento + 30 min); loja sem
 * horario configurado nao entra (rodada perdida = roda assim que reconectar). O dia fecha na madrugada.
 * Nao enfileira com onboarding aberto, SEED pendente, integracao pausada/senha invalida ou
 * outro Atualizar ja na fila. Rodada anterior pulada por sessao caida  ->  esta faz login 1x;
 * usuario exclusivo da WeDash (`dedicated`) faz login na hora.
 */
export async function enqueueDueAutoRefreshJobs(sb: SupabaseClient, now = new Date()): Promise<number> {
  if (!autoRefreshEnabled()) return 0;
  const { data: creds, error } = await sb
    .from("erp_credential")
    .select("id, tenant_id, sync_paused, dedicated")
    .eq("status", "VALID")
    .eq("auto_refresh_enabled", true);
  if (error) throw error;
  let n = 0;
  for (const c of creds ?? []) {
    if (!isIntegrationActive(c as { sync_paused?: boolean | null })) continue;
    const tenantId = c.tenant_id as string;
    const credentialId = c.id as string;

    const { data: open } = await sb
      .from("sync_job")
      .select("id")
      .eq("credential_id", credentialId)
      .in("kind", ["FORCE", "SEED", "BACKFILL"])
      .in("status", ["QUEUED", "RUNNING"])
      .limit(1)
      .maybeSingle();
    if (open) continue;

    const { data: onboarding } = await sb
      .from("membership")
      .select("id")
      .eq("tenant_id", tenantId)
      .not("onboarding_step", "is", null)
      .limit(1)
      .maybeSingle();
    if (onboarding) continue;

    const { data: storeRows, error: storeErr } = await sb
      .from("store")
      .select("id, timezone, hours, last_sync_at")
      .eq("tenant_id", tenantId)
      .eq("active", true);
    if (storeErr) throw storeErr;
    if (!storeRows?.length) continue;

    const { data: lastAuto } = await sb
      .from("sync_job")
      .select("created_at, status, error")
      .eq("credential_id", credentialId)
      .eq("kind", "FORCE")
      .eq("payload->>auto", "true")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const plan = planAutoRound({
      stores: storeRows.map((s) => ({
        id: s.id as string,
        timezone: (s.timezone as string) || "America/Campo_Grande",
        hours: parseStoreHours(s.hours),
        lastSyncAt: s.last_sync_at ? new Date(s.last_sync_at as string) : null,
      })),
      now,
      intervalMin: AUTO_REFRESH_MIN,
      lastAutoAt: lastAuto?.created_at ? new Date(lastAuto.created_at as string) : null,
    });
    if (!plan) continue;

    // Usuario exclusivo da WeDash: ninguem para derrubar  ->  login na hora se a sessao caiu.
    const relogin =
      Boolean(c.dedicated) ||
      (lastAuto?.status === "FAILED" && String(lastAuto.error ?? "").startsWith(AUTO_SESSION_MARK));
    const { error: insErr } = await sb.from("sync_job").insert({
      tenant_id: tenantId,
      credential_id: credentialId,
      kind: "FORCE",
      status: "QUEUED",
      payload: {
        auto: true,
        storeIds: plan.storeIds,
        ...(relogin ? { relogin: true } : {}),
      },
    });
    if (insErr) throw insErr;
    n += 1;
  }
  return n;
}

/**
 * Carga funda do historico na madrugada (0h - 6h no fuso de todas as lojas): 1 mes por vez, a cada 15 min,
 * do mais recente que falta ate a inauguracao da loja (teto = `.env DEEP_HISTORY`, ex.: 24m; off =
 * desligado). Nao enfileira com outro job na fila da credencial, onboarding aberto ou integracao
 * pausada. Mes que falhou so volta na proxima madrugada. Terminou  ->  grava 1 aviso "historico
 * completo" (sino de Notificacoes).
 */
export async function enqueueDueDeepHistoryJobs(sb: SupabaseClient, now = new Date()): Promise<number> {
  const span = deepHistorySpan();
  if (span === "off") return 0;
  const { data: creds, error } = await sb.from("erp_credential").select("id, tenant_id, sync_paused").eq("status", "VALID");
  if (error) throw error;
  let n = 0;
  for (const c of creds ?? []) {
    if (!isIntegrationActive(c as { sync_paused?: boolean | null })) continue;
    const tenantId = c.tenant_id as string;
    const credentialId = c.id as string;

    const { data: open } = await sb
      .from("sync_job")
      .select("id")
      .eq("credential_id", credentialId)
      .in("status", ["QUEUED", "RUNNING"])
      .limit(1)
      .maybeSingle();
    if (open) continue;

    const { data: onboarding } = await sb
      .from("membership")
      .select("id")
      .eq("tenant_id", tenantId)
      .not("onboarding_step", "is", null)
      .limit(1)
      .maybeSingle();
    if (onboarding) continue;

    const { data: storeRows, error: storeErr } = await sb
      .from("store")
      .select("id, timezone, opened_at")
      .eq("tenant_id", tenantId)
      .eq("active", true);
    if (storeErr) throw storeErr;
    if (!storeRows?.length) continue;
    const stores = storeRows.map((s) => ({
      id: s.id as string,
      timezone: (s.timezone as string) || "America/Campo_Grande",
      openedAt: s.opened_at ? String(s.opened_at).slice(0, 10) : null,
    }));
    if (!isDeepHistoryWindow(stores, now)) continue;

    const { data: lastDeep } = await sb
      .from("sync_job")
      .select("created_at, status, finished_at")
      .eq("credential_id", credentialId)
      .eq("kind", "CLOSE")
      .eq("payload->>deep", "true")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const minutesAgo = (iso: unknown) => (typeof iso === "string" ? (now.getTime() - Date.parse(iso)) / 60_000 : Infinity);
    if (minutesAgo(lastDeep?.created_at) < DEEP_HISTORY_SPACING_MIN) continue;
    if (lastDeep?.status === "FAILED" && minutesAgo(lastDeep.finished_at) < DEEP_FAIL_WAIT_H * 60) continue;

    const today = ymdInTz(now, stores[0]!.timezone);
    const cap = spanStart(span, today);
    const deepStores: DeepStore[] = [];
    for (const s of stores) {
      const { data: oldestRow, error: oldErr } = await sb
        .from("sales_day_agg")
        .select("day")
        .eq("store_id", s.id)
        .eq("brand", "ALL")
        .order("day", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (oldErr) throw oldErr;
      const oldestDay = oldestRow?.day ? String(oldestRow.day).slice(0, 10) : null;
      let emptyTail = false;
      if (!s.openedAt && oldestDay && oldestDay === monthStart(oldestDay)) {
        const { data: tail, error: tailErr } = await sb
          .from("sales_day_agg")
          .select("revenue_cents")
          .eq("store_id", s.id)
          .eq("brand", "ALL")
          .gte("day", oldestDay)
          .lt("day", addMonths(oldestDay, DEEP_EMPTY_MONTHS));
        if (tailErr) throw tailErr;
        emptyTail = (tail ?? []).every((r) => Number(r.revenue_cents ?? 0) === 0);
      }
      deepStores.push({ id: s.id, oldestDay, floor: deepHistoryFloor(s.openedAt, cap), emptyTail });
    }

    const plan = planDeepHistory(deepStores);
    if (!plan) {
      // Historico completo: 1 aviso no sino (so se a carga funda rodou alguma vez).
      if (lastDeep?.status !== "SUCCEEDED") continue;
      const { data: marker } = await sb
        .from("sync_job")
        .select("id")
        .eq("credential_id", credentialId)
        .eq("payload->>deepDone", "true")
        .limit(1)
        .maybeSingle();
      if (marker) continue;
      const since = deepStores
        .map((s) => s.oldestDay)
        .filter((d): d is string => d != null)
        .reduce((a, b) => (b < a ? b : a), today);
      const at = now.toISOString();
      const { error: markErr } = await sb.from("sync_job").insert({
        tenant_id: tenantId,
        credential_id: credentialId,
        kind: "CLOSE",
        status: "SUCCEEDED",
        payload: { deepDone: true, since },
        finished_at: at,
      });
      if (markErr) throw markErr;
      console.log(`Histórico antigo completo (desde ${since}) | empresa ${tenantId.slice(0, 8)}`);
      continue;
    }

    const { error: insErr } = await sb.from("sync_job").insert({
      tenant_id: tenantId,
      credential_id: credentialId,
      kind: "CLOSE",
      status: "QUEUED",
      payload: { from: plan.day, to: plan.day, fillUntil: plan.fillUntil, storeIds: plan.storeIds, deep: true },
    });
    if (insErr) throw insErr;
    n += 1;
  }
  return n;
}

/** Ordem na fila: Atualizar/SEED primeiro; HISTORY por ultimo (roda quando nao ha nada do gestor). */
const JOB_PRIORITY: Record<string, number> = {
  REGISTRY: 0,
  FORCE: 0,
  FORCE_LIGHT: 0,
  SEED: 1,
  BACKFILL: 1,
  CLOSE: 2,
  RANGE: 2,
  LIGHT: 2,
  HISTORY: 3,
};

/**
 * Proximo job elegivel: peek por prioridade + UPDATE atomico QUEUED→RUNNING.
 * Se outro worker pegar a linha no meio, tenta o candidato seguinte.
 */
export async function claimNextJob(sb: SupabaseClient): Promise<SyncJob | null> {
  const { data: rows, error } = await sb
    .from("sync_job")
    .select("id, tenant_id, credential_id, kind, status, payload")
    .eq("status", "QUEUED")
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) throw error;
  if (!rows?.length) return null;
  // sort e estavel: mesma prioridade mantem a ordem de chegada.
  rows.sort((a, b) => (JOB_PRIORITY[a.kind as string] ?? 2) - (JOB_PRIORITY[b.kind as string] ?? 2));

  for (const row of rows) {
    const credentialId = row.credential_id as string;

    const { data: running } = await sb
      .from("sync_job")
      .select("id")
      .eq("credential_id", credentialId)
      .eq("status", "RUNNING")
      .limit(1)
      .maybeSingle();
    if (running) continue;

    const { data: cred } = await sb
      .from("erp_credential")
      .select("sync_paused")
      .eq("id", credentialId)
      .maybeSingle();
    if (!isIntegrationActive(cred as { sync_paused?: boolean } | null)) continue;

    const lockedAt = new Date().toISOString();
    const { data: claimed, error: claimErr } = await sb
      .from("sync_job")
      .update({ status: "RUNNING", locked_at: lockedAt })
      .eq("id", row.id)
      .eq("status", "QUEUED")
      .select("id, tenant_id, credential_id, kind, status, payload")
      .maybeSingle();
    if (claimErr) throw claimErr;
    if (!claimed) continue;

    const payload = (claimed.payload ?? {}) as {
      from?: string;
      to?: string;
      storeIds?: unknown;
      fillUntil?: unknown;
      auto?: unknown;
      relogin?: unknown;
      closeStoreIds?: unknown;
      deep?: unknown;
      cashOnly?: unknown;
    };
    const idList = (raw: unknown) =>
      Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && id.length > 0) : undefined;
    const storeIds = idList(payload.storeIds);
    const closeStoreIds = idList(payload.closeStoreIds);
    return {
      id: claimed.id as string,
      tenantId: claimed.tenant_id as string,
      credentialId: claimed.credential_id as string,
      kind: claimed.kind as SyncJobKind,
      status: "RUNNING",
      payload: {
        from: typeof payload.from === "string" ? payload.from : undefined,
        to: typeof payload.to === "string" ? payload.to : undefined,
        ...(storeIds && storeIds.length > 0 ? { storeIds } : {}),
        ...(typeof payload.fillUntil === "string" ? { fillUntil: payload.fillUntil } : {}),
        ...(payload.auto === true ? { auto: true } : {}),
        ...(payload.relogin === true ? { relogin: true } : {}),
        ...(closeStoreIds && closeStoreIds.length > 0 ? { closeStoreIds } : {}),
        ...(payload.deep === true ? { deep: true } : {}),
        ...(payload.cashOnly === true ? { cashOnly: true } : {}),
      },
    };
  }
  return null;
}

/**
 * Integracao ERP ativa = nao pausada.
 * Presenca WeDash NAO e exigida (HISTORY pode rodar com app fechado).
 */
export function isIntegrationActive(
  cred: { sync_paused?: boolean | null } | null | undefined,
): boolean {
  return !cred?.sync_paused;
}

/**
 * No boot: limpa RUNNING orfaos e cancela fila de tenants ainda no onboarding.
 * Evita worker brigar com a sessao do wizard (busy / onboarding preso).
 */
export async function disconnectTenantSessions(
  sb: SupabaseClient,
  logout: (session: string) => Promise<void>,
): Promise<number> {
  const { data, error } = await sb
    .from("erp_credential")
    .select("id, millennium_session")
    .not("millennium_session", "is", null);
  if (error) throw error;
  let n = 0;
  for (const row of data ?? []) {
    const token = String((row as { millennium_session?: string }).millennium_session ?? "").trim();
    const id = (row as { id: string }).id;
    if (token) {
      try {
        await logout(token);
        n += 1;
      } catch {
        /* best-effort */
      }
    }
    await sb
      .from("erp_credential")
      .update({
        millennium_session: null,
        millennium_session_at: null,
        millennium_session_by: null,
        sync_paused: true,
      })
      .eq("id", id);
  }
  return n;
}

/**
 * No boot: RUNNING orfaos voltam pra fila (QUEUED), nao falham.
 * Assim um Ctrl+C / crash no meio do SEED nao deixa a UI presa em "Buscando".
 * Tambem cancela fila de tenants ainda no onboarding.
 */
export async function recoverOnStartup(sb: SupabaseClient): Promise<void> {
  const nowIso = new Date().toISOString();

  const { data: running, error: runErr } = await sb
    .from("sync_job")
    .select("id")
    .eq("status", "RUNNING");
  if (runErr) throw runErr;
  if (running && running.length > 0) {
    const { error } = await sb
      .from("sync_job")
      .update({
        status: "QUEUED",
        locked_at: null,
        error: null,
        finished_at: null,
      })
      .eq("status", "RUNNING");
    if (error) throw error;
    console.log(`Recuperação: ${running.length} sincronização(ões) em andamento voltaram para a fila`);
  }

  const { data: boarding, error: boardErr } = await sb
    .from("membership")
    .select("tenant_id")
    .not("onboarding_step", "is", null);
  if (boardErr) throw boardErr;
  const tenantIds = [...new Set((boarding ?? []).map((m) => m.tenant_id as string))];
  if (tenantIds.length === 0) return;

  const { data: cancelled, error: cancelErr } = await sb
    .from("sync_job")
    .update({
      status: "FAILED",
      error: "pausado — tenant em onboarding",
      finished_at: nowIso,
    })
    .in("tenant_id", tenantIds)
    .in("status", ["QUEUED", "RUNNING"])
    .select("id");
  if (cancelErr) throw cancelErr;
  if (cancelled && cancelled.length > 0) {
    console.log(`Recuperação: ${cancelled.length} sincronização(ões) canceladas (onboarding aberto)`);
  }
}

/** Retencao de Configuracoes > Logs. */
export const SYNC_LOG_RETENTION_DAYS = 120;

export async function purgeOldSyncLogs(sb: SupabaseClient, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SYNC_LOG_RETENTION_DAYS * 86_400_000).toISOString();
  const { data, error } = await sb.from("sync_log").delete().lt("created_at", cutoff).select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Durante o poll: RUNNING parado demais (worker morreu no meio)  ->  refila.
 * Sem isso a UI fica em "Buscando" e o log do worker fica mudo.
 */
export async function recoverStaleRunningJobs(
  sb: SupabaseClient,
  maxAgeMs = 12 * 60_000,
): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const { data, error } = await sb
    .from("sync_job")
    .select("id, locked_at, created_at")
    .eq("status", "RUNNING");
  if (error) throw error;
  let n = 0;
  for (const row of data ?? []) {
    const lockedAt = (row as { locked_at?: string | null }).locked_at;
    const createdAt = (row as { created_at?: string }).created_at;
    const stamp = lockedAt || createdAt;
    if (!stamp || stamp > cutoff) continue;
    const { error: upErr } = await sb
      .from("sync_job")
      .update({
        status: "QUEUED",
        locked_at: null,
        error: null,
        finished_at: null,
      })
      .eq("id", (row as { id: string }).id)
      .eq("status", "RUNNING");
    if (!upErr) {
      n += 1;
      console.log(
        `Recuperação: sincronização ${(row as { id: string }).id.slice(0, 8)} parada voltou para a fila`,
      );
    }
  }
  return n;
}

/**
 * Enqueue LIGHT for credentials due (interval elapsed, no open job).
 * Default OFF  -  so Atualizar (FORCE). Ligar com LIGHT_AUTO=1 no .env.
 */
export async function enqueueDueLightJobs(sb: SupabaseClient): Promise<number> {
  if (process.env.LIGHT_AUTO !== "1") return 0;

  const { data: creds, error } = await sb
    .from("erp_credential")
    .select(
      "id, tenant_id, light_interval_min, last_light_sync_at, last_error_at, last_error, status, sync_paused",
    )
    .eq("status", "VALID");
  if (error) throw error;

  let enqueued = 0;
  const now = Date.now();
  const busyBackoffMs = 10 * 60_000;

  for (const c of creds ?? []) {
    if (!isIntegrationActive(c as { sync_paused?: boolean })) continue;

    // Nao dispara LIGHT enquanto algum membership do tenant ainda esta no onboarding.
    const { data: onboarding } = await sb
      .from("membership")
      .select("id")
      .eq("tenant_id", c.tenant_id)
      .not("onboarding_step", "is", null)
      .limit(1)
      .maybeSingle();
    if (onboarding) continue;

    const intervalMin = Number(c.light_interval_min) || 5;
    const last = c.last_light_sync_at ? new Date(c.last_light_sync_at as string).getTime() : 0;
    const due = !last || now - last >= intervalMin * 60_000;
    if (!due) continue;

    // Millennium session limit / 401  -  don't spam LIGHT every poll while broken.
    const errAt = c.last_error_at ? new Date(c.last_error_at as string).getTime() : 0;
    const errText = String(c.last_error ?? "").toLowerCase();
    const busyRecently =
      errAt > 0 &&
      now - errAt < busyBackoffMs &&
      (errText.includes("ultrapassado") ||
        errText.includes("máximo") ||
        errText.includes("maximo") ||
        errText.includes("já está conectado") ||
        errText.includes("ja esta conectado") ||
        errText.includes("busy") ||
        errText.includes("401") ||
        errText.includes("unauthorized") ||
        errText.includes("sessão") ||
        errText.includes("sessao"));
    if (busyRecently) continue;

    const { data: open } = await sb
      .from("sync_job")
      .select("id")
      .eq("credential_id", c.id)
      .in("status", ["QUEUED", "RUNNING"])
      .limit(1)
      .maybeSingle();
    if (open) continue;

    const { error: insErr } = await sb.from("sync_job").insert({
      tenant_id: c.tenant_id,
      credential_id: c.id,
      kind: "LIGHT",
      status: "QUEUED",
      payload: {},
    });
    if (!insErr) enqueued += 1;
  }
  return enqueued;
}

export async function processOneJob(sb: SupabaseClient, erpSecret: string): Promise<boolean> {
  const job = await claimNextJob(sb);
  if (!job) return false;

  // LIGHT automatico desligado  -  descarta se ainda houver na fila.
  if (job.kind === "LIGHT" && process.env.LIGHT_AUTO !== "1") {
    await sb
      .from("sync_job")
      .update({
        status: "FAILED",
        error: "LIGHT auto desligado (só Atualizar / FORCE)",
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .in("status", ["QUEUED", "RUNNING"]);
    console.log(`Sincronização ${job.id.slice(0, 8)} ignorada: atualização rápida desligada`);
    return true;
  }

  // So Atualizar (FORCE) + SEED do onboarding + fechamento/carga do historico (CLOSE).
  // RANGE/BACKFILL/HISTORY nao rodam sozinhos.
  if (
    process.env.SYNC_MANUAL_ONLY !== "0" &&
    job.kind !== "FORCE" &&
    job.kind !== "FORCE_LIGHT" &&
    job.kind !== "SEED" &&
    job.kind !== "CLOSE" &&
    job.kind !== "REGISTRY"
  ) {
    await sb
      .from("sync_job")
      .update({
        status: "FAILED",
        error: `pausado — sync manual (só FORCE/SEED); kind=${job.kind}`,
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .in("status", ["QUEUED", "RUNNING"]);
    console.log(`Sincronização ${job.id.slice(0, 8)} (${job.kind}) ignorada: somente atualização manual`);
    return true;
  }

  // Nunca compete com o wizard: onboarding usa a mesma sessao Millennium.
  const { data: onboarding } = await sb
    .from("membership")
    .select("id")
    .eq("tenant_id", job.tenantId)
    .not("onboarding_step", "is", null)
    .limit(1)
    .maybeSingle();
  if (onboarding) {
    // claimNextJob ja deixou RUNNING  -  nao filtrar por QUEUED.
    await sb
      .from("sync_job")
      .update({
        status: "FAILED",
        error: "pausado — tenant em onboarding",
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .in("status", ["QUEUED", "RUNNING"]);
    console.log(`Sincronização ${job.id.slice(0, 8)} ignorada: onboarding em andamento`);
    return true;
  }

  // Usuario pausou sync (liberou ERP)  -  nao compete com sessao desktop.
  const { data: credPause } = await sb
    .from("erp_credential")
    .select("sync_paused")
    .eq("id", job.credentialId)
    .maybeSingle();
  if ((credPause as { sync_paused?: boolean } | null)?.sync_paused) {
    // claimNextJob ja promoveu a RUNNING — devolve a fila ate o resume.
    await sb
      .from("sync_job")
      .update({ status: "QUEUED", locked_at: null, error: null, finished_at: null })
      .eq("id", job.id)
      .eq("status", "RUNNING");
    console.log(`Sincronização ${job.id.slice(0, 8)} ignorada: sincronização pausada`);
    return true;
  }

  const deps = buildDeps(sb, erpSecret);
  let result: Awaited<ReturnType<typeof runSyncJob>>;
  try {
    result =
      job.kind === "CLOSE" && job.payload.cashOnly
        ? await runCashCloseFillJob(job, deps, sb, erpSecret)
        : await runSyncJob(job, deps);
  } catch (e) {
    if (e instanceof Error && e.message === "job_claim_lost") {
      // Outro worker levou o lease depois do peek — nada a fazer.
      return false;
    }
    throw e;
  }
  if (!result.ok) {
    if (result.reason === "locked") {
      // claimNextJob ja tinha promovido a RUNNING — devolve a fila.
      await sb
        .from("sync_job")
        .update({ status: "QUEUED", locked_at: null, error: null, finished_at: null })
        .eq("id", job.id)
        .eq("status", "RUNNING");
      return false;
    }
    console.log(`Sincronização ${job.id.slice(0, 8)} falhou (${result.reason})`);
  }
  return true;
}
