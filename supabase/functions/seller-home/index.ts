/**
 * seller-home  -  tela Inicio do vendedor.
 * So membership SELLER ativa ligada a um cadastro do Millennium. Le com service role
 * (o vendedor nao tem policy nas tabelas da empresa) e devolve o pacote do motor:
 * O podio do mes traz o faturamento da equipe. A premiacao da meta e so da propria pessoa.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { buildSellerHome, type SellerChallengeInput, type SellerChallengePrize, type SellerHomeInput } from "../_shared/engine/sellerHome.ts";
import type { SellerProductDay } from "../_shared/engine/sellerChallenge.ts";
import { fimDoMes, inicioDoMes, paraIso, somarDias } from "../_shared/engine/format.ts";
import { excludeNonSalesPeople, goalFromRow, sellerDayFromRow, teamMemberFromRow } from "../_shared/engine/goalRows.ts";
import type { DayHours, Dow, StoreWeekHours } from "../_shared/engine/goalWeights.ts";

const PAGE = 1000;

/** Horario gravado da loja; sem nenhum dia aberto = todos os dias (so para o peso da projecao). */
function weekHours(raw: unknown): StoreWeekHours {
  const base: StoreWeekHours = { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (let d = 0; d <= 6; d++) {
      const v = o[String(d)];
      if (!v || typeof v !== "object") continue;
      const row = v as Record<string, unknown>;
      if (typeof row.open === "string" && typeof row.close === "string") {
        base[d as Dow] = { open: row.open, close: row.close };
      }
    }
  }
  if (([0, 1, 2, 3, 4, 5, 6] as Dow[]).some((d) => base[d] != null)) return base;
  const day: DayHours = { open: "10:00", close: "22:00" };
  return { 0: { ...day }, 1: { ...day }, 2: { ...day }, 3: { ...day }, 4: { ...day }, 5: { ...day }, 6: { ...day } };
}
const HISTORY_WEEKS = 6;

function onePrize(raw: unknown): SellerChallengePrize | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const prize = raw as Record<string, unknown>;
  if (prize.kind === "MONEY") {
    const cents = Number(prize.cents);
    return Number.isFinite(cents) && cents > 0 ? { kind: "MONEY", amount: cents / 100 } : null;
  }
  if (prize.kind === "ITEM" && typeof prize.label === "string" && prize.label.trim()) {
    return { kind: "ITEM", label: prize.label.trim() };
  }
  return null;
}

function challengePrizes(raw: unknown): SellerChallengePrize[] {
  if (!Array.isArray(raw)) return [];
  const out: SellerChallengePrize[] = [];
  for (const item of raw) {
    const prize = onePrize(item);
    if (!prize) break;
    out.push(prize);
  }
  return out;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const CHALLENGE_METRICS = ["QUANTITY", "VALUE", "PA", "TICKET", "INDEX"] as const;

function challengeMetricScope(metric: string, scope: string | null): { metric: SellerChallengeInput["metric"]; scope: SellerChallengeInput["scope"] } {
  if (metric === "PRODUCTS" || metric === "CATEGORIES") return { metric: "QUANTITY", scope: metric };
  const parsed = CHALLENGE_METRICS.find((m) => m === metric) ?? "QUANTITY";
  if (parsed !== "QUANTITY" && parsed !== "VALUE") return { metric: parsed, scope: "ALL" };
  const parsedScope = scope === "PRODUCTS" || scope === "CATEGORIES" || scope === "ALL" ? scope : "ALL";
  return { metric: parsed, scope: parsedScope };
}

function codesOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => String((p as { code?: unknown })?.code ?? "").trim()).filter(Boolean);
}

function typeIdsOf(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => Number((c as { typeId?: unknown })?.typeId)).filter((n) => Number.isInteger(n));
}

function needsProductLines(metric: string, scope: string | null): boolean {
  const parsed = challengeMetricScope(metric, scope);
  return (parsed.metric === "QUANTITY" || parsed.metric === "VALUE") && parsed.scope !== "ALL";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const fail = (error: string, status = 200) => json({ ok: false, error }, status);

/** PostgREST corta em 1000 linhas; busca todas as paginas na ordem pedida. */
async function allPages(query: any): Promise<any[]> { // deno-lint-ignore no-explicit-any
  const out: any[] = []; // deno-lint-ignore no-explicit-any
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return out;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseAnon || !serviceKey) return json({ error: "server_misconfigured" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: identity } = await admin
    .from("identity")
    .select("id, name")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (!identity) return fail("not_linked", 403);

  const { data: memberships } = await admin
    .from("membership")
    .select("id, tenant_id")
    .eq("identity_id", identity.id)
    .eq("role", "SELLER")
    .eq("status", "ACTIVE");
  const membership = memberships?.[0];
  if (!membership) return fail("not_linked", 403);

  const { data: links } = await admin
    .from("store_seller")
    .select("store_id, millennium_employee_id, store:store_id (trade_name, name, last_sync_at, hours)")
    .eq("membership_id", membership.id)
    .eq("active", true)
    .eq("in_erp", true);
  const stores = (links ?? [])
    .filter((l) => l.millennium_employee_id != null)
    .map((l) => {
      const store = (Array.isArray(l.store) ? l.store[0] : l.store) as
        | { trade_name: string | null; name: string; last_sync_at: string | null; hours: unknown }
        | null;
      return {
        storeId: l.store_id as string,
        storeName: store?.trade_name?.trim() || store?.name || "",
        lastSyncAt: store?.last_sync_at ?? null,
        employeeId: l.millennium_employee_id as number,
        week: weekHours(store?.hours),
      };
    });
  if (stores.length === 0) return fail("not_linked", 403);

  const today = paraIso(new Date());
  const storeIds = stores.map((s) => s.storeId);
  const from = somarDias(inicioDoMes(somarDias(today, -HISTORY_WEEKS * 7)), 0);

  try {
    const monthStart = inicioDoMes(today);
    const monthEnd = fimDoMes(today);
    const [dayRows, sellerRows, teamRows, goalRows, challengeRows] = await Promise.all([
      allPages(
        admin.from("sales_day_agg").select("tenant_id, store_id, day, brand, revenue_cents, sales_count, item_count, cmv_cents")
          .eq("tenant_id", membership.tenant_id).eq("brand", "ALL").in("store_id", storeIds).gte("day", from).lte("day", today)
          .order("day").order("store_id"),
      ),
      allPages(
        admin.from("sales_seller_day_agg")
          .select("tenant_id, store_id, day, seller_key, seller_name, seller_employee_id, seller_gerador_id, brand, revenue_cents, sales_count, item_count")
          .eq("tenant_id", membership.tenant_id).eq("brand", "ALL").in("store_id", storeIds).gte("day", from).lte("day", today)
          .order("day").order("store_id"),
      ),
      allPages(
        admin.from("store_seller")
          .select("store_id, millennium_employee_id, millennium_gerador_id, name, name_keys, active, erp_role, shift_id, store_shift(name)")
          .eq("tenant_id", membership.tenant_id).in("store_id", storeIds).order("name"),
      ),
      allPages(
        admin.from("goal").select("id, store_id, name, starts_on, ends_on, target_cents, tier_mode, tiers, groups")
          .eq("tenant_id", membership.tenant_id).in("store_id", storeIds).lte("starts_on", today).gte("ends_on", from)
          .order("starts_on", { ascending: false }),
      ),
      allPages(
        admin.from("challenge").select("id, store_id, name, starts_on, ends_on, metric, scope, mode, products, categories, target, min_sales, prizes")
          .eq("tenant_id", membership.tenant_id).in("store_id", storeIds)
          .lte("starts_on", monthEnd).gte("ends_on", monthStart)
          .order("starts_on", { ascending: false }),
      ),
    ]);

    const productChallenges = challengeRows.filter((r) => needsProductLines(String(r.metric ?? ""), r.scope == null ? null : String(r.scope)));
    const needsTypes = productChallenges.some((r) => challengeMetricScope(String(r.metric ?? ""), r.scope == null ? null : String(r.scope)).scope === "CATEGORIES");
    let sellerProducts: SellerProductDay[] = [];
    let productTypes: { code: string; typeId: number }[] = [];
    if (productChallenges.length > 0) {
      const productFrom = productChallenges.reduce((m: string, r) => (String(r.starts_on) < m ? String(r.starts_on) : m), String(productChallenges[0].starts_on));
      const productTo = today < monthEnd ? today : monthEnd;
      const [productRows, typeRows] = await Promise.all([
        allPages(
          admin.from("sales_seller_product_day_agg")
            .select("store_id, day, seller_gerador_id, seller_key, seller_name, product_code, item_count, revenue_cents")
            .eq("tenant_id", membership.tenant_id).in("store_id", storeIds)
            .gte("day", productFrom).lte("day", productTo)
            .order("day").order("store_id").order("seller_gerador_id").order("product_code"),
        ),
        needsTypes
          ? allPages(admin.from("product_catalog").select("product_code, type_id").order("product_code"))
          : Promise.resolve([]),
      ]);
      sellerProducts = productRows.map((r) => ({
        storeId: String(r.store_id),
        day: String(r.day),
        sellerGeradorId: Number(r.seller_gerador_id),
        sellerKey: String(r.seller_key ?? ""),
        sellerName: String(r.seller_name ?? ""),
        productCode: String(r.product_code ?? "").trim(),
        itemCount: Number(r.item_count) || 0,
        revenueCents: Number(r.revenue_cents) || 0,
      }));
      productTypes = typeRows
        .filter((r) => r.type_id != null)
        .map((r) => ({ code: String(r.product_code), typeId: Number(r.type_id) }));
    }

    const team = teamRows.map(teamMemberFromRow);
    const nonSales = {
      employeeIds: new Set(team.filter((m) => !m.salesPerson && m.employeeId != null).map((m) => m.employeeId as number)),
      geradorIds: new Set(team.filter((m) => !m.salesPerson && m.geradorId != null).map((m) => m.geradorId as number)),
      storeNameKeys: new Set(team.filter((m) => !m.salesPerson).flatMap((m) => m.nameKeys.map((k) => `${m.storeId}|${k}`))),
    };
    sellerProducts = sellerProducts.filter(
      (r) => !nonSales.geradorIds.has(r.sellerGeradorId) && !nonSales.storeNameKeys.has(`${r.storeId}|${r.sellerKey}`),
    );
    const input: SellerHomeInput = {
      today,
      stores,
      goals: goalRows.map(goalFromRow),
      dayAggs: dayRows.map((r) => ({
        tenantId: r.tenant_id, storeId: r.store_id, day: r.day, brand: r.brand,
        revenueCents: Number(r.revenue_cents) || 0, salesCount: Number(r.sales_count) || 0,
        itemCount: Number(r.item_count) || 0, cmvCents: r.cmv_cents == null ? undefined : Number(r.cmv_cents),
      })),
      sellerDayAggs: excludeNonSalesPeople(sellerRows.map(sellerDayFromRow), nonSales),
      team,
      sellerProducts,
      productTypes,
      challenges: challengeRows.map((r): SellerChallengeInput => {
        const prizes = challengePrizes(r.prizes);
        const metricScope = challengeMetricScope(String(r.metric ?? ""), r.scope == null ? null : String(r.scope));
        return {
          id: String(r.id),
          storeId: String(r.store_id),
          name: String(r.name ?? ""),
          startsOn: String(r.starts_on),
          endsOn: String(r.ends_on),
          mode: r.mode === "MINIMUM" ? "MINIMUM" : "CONTEST",
          prize: prizes[0] ?? null,
          prizes,
          metric: metricScope.metric,
          scope: metricScope.scope,
          productCodes: codesOf(r.products),
          categoryIds: typeIdsOf(r.categories),
          target: numOrNull(r.target),
          minSales: numOrNull(r.min_sales),
        };
      }),
    };
    const home = buildSellerHome(input);
    return json({
      ok: true,
      today,
      name: identity.name ?? "",
      stores: home.stores,
      myDays: home.myDays,
      numbersPeriod: { from: monthStart, to: today },
    });
  } catch (e) {
    console.warn("seller-home", e instanceof Error ? e.message : e);
    return fail("load_failed", 500);
  }
});
