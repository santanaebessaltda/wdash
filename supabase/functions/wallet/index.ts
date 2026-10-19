/**
 * Carteira do vendedor. A membership SELLER não lê as tabelas da empresa,
 * então a conta roda aqui e a resposta traz só a linha dela.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, serve } from "../_shared/cors.ts";
import { resolveBranchSellerId } from "../_shared/engine/branchUser.ts";
import { collaboratorName, endOfMonth, shiftName, startOfMonth } from "../_shared/engine/format.ts";
import { goalWeightFrom } from "../_shared/engine/goalProjection.ts";
import { excludeNonSalesPeople, goalFromRow, sellerDayFromRow, teamMemberFromRow } from "../_shared/engine/goalRows.ts";
import type { DayHours, Dow, StoreWeekHours } from "../_shared/engine/goalWeights.ts";
import { challengeStanding, type SellerChallengeMetric, type SellerChallengeScope, type SellerProductDay } from "../_shared/engine/sellerChallenge.ts";
import { sellerHistoryFrom } from "../_shared/engine/sellerHome.ts";
import { buildWalletMonth, type WalletCashDay, type WalletChallengeInput, type WalletGoalInput, type WalletPersonInput } from "../_shared/engine/wallet.ts";
import { buildGoalCardView, goalStatus } from "../_shared/engine/goalView.ts";
import {
  applyCloseReview,
  assembleMonthMarks,
  buildCashCloseView,
  closeDayGap,
  dayWithoutReal,
  rowsForAcquirer,
} from "../_shared/close/cashCloseView.ts";
import { dayShortageCents, netCloseDiff, parseWithdrawalRows } from "../_shared/close/employeeWithdrawal.ts";
import { parseOnlinePix } from "../_shared/close/onlinePix.ts";
import { shortageShares, suggestDayShortage, type ShortageScope } from "../_shared/close/shortageAssign.ts";

const PAGE = 1000;

function weekHours(raw: unknown): StoreWeekHours {
  const base: StoreWeekHours = { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
  if (raw && typeof raw === "object") {
    const row = raw as Record<string, unknown>;
    for (let day = 0; day <= 6; day++) {
      const value = row[String(day)];
      if (!value || typeof value !== "object") continue;
      const hours = value as Record<string, unknown>;
      if (typeof hours.open === "string" && typeof hours.close === "string") base[day as Dow] = { open: hours.open, close: hours.close };
    }
  }
  if (([0, 1, 2, 3, 4, 5, 6] as Dow[]).some((day) => base[day] != null)) return base;
  const open: DayHours = { open: "10:00", close: "22:00" };
  return { 0: { ...open }, 1: { ...open }, 2: { ...open }, 3: { ...open }, 4: { ...open }, 5: { ...open }, 6: { ...open } };
}

function onePrize(raw: unknown): { kind: "MONEY"; amount: number } | { kind: "ITEM"; label: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const prize = raw as Record<string, unknown>;
  if (prize.kind === "MONEY") {
    const cents = Number(prize.cents);
    return Number.isFinite(cents) && cents > 0 ? { kind: "MONEY", amount: cents / 100 } : null;
  }
  if (prize.kind === "ITEM" && typeof prize.label === "string" && prize.label.trim()) return { kind: "ITEM", label: prize.label.trim() };
  return null;
}

function challengePrizes(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ kind: "MONEY"; amount: number } | { kind: "ITEM"; label: string }> = [];
  for (const item of raw) {
    const prize = onePrize(item);
    if (!prize) break;
    out.push(prize);
  }
  return out;
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const METRICS = ["QUANTITY", "VALUE", "PA", "TICKET", "INDEX"] as const;

function metricScope(metric: string, scope: string | null): { metric: SellerChallengeMetric; scope: SellerChallengeScope } {
  if (metric === "PRODUCTS" || metric === "CATEGORIES") return { metric: "QUANTITY", scope: metric };
  const parsed = METRICS.find((item) => item === metric) ?? "QUANTITY";
  if (parsed !== "QUANTITY" && parsed !== "VALUE") return { metric: parsed, scope: "ALL" };
  const parsedScope = scope === "PRODUCTS" || scope === "CATEGORIES" || scope === "ALL" ? scope : "ALL";
  return { metric: parsed, scope: parsedScope };
}

function codesOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String((item as { code?: unknown })?.code ?? "").trim()).filter(Boolean);
}

function typeIdsOf(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => Number((item as { typeId?: unknown })?.typeId)).filter((n) => Number.isInteger(n));
}

function needsProductLines(metric: string, scope: string | null): boolean {
  const parsed = metricScope(metric, scope);
  return (parsed.metric === "QUANTITY" || parsed.metric === "VALUE") && parsed.scope !== "ALL";
}

function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("pt-BR");
}

function reaisToCents(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const fail = (error: string, status = 200) => json({ ok: false, error }, status);

async function allPages(query: any): Promise<any[]> { // deno-lint-ignore no-explicit-any
  const out: any[] = []; // deno-lint-ignore no-explicit-any
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return out;
  }
}

serve(async (req) => {
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
  const { data: identity } = await admin.from("identity").select("id, name").eq("auth_user_id", userData.user.id).maybeSingle();
  if (!identity) return fail("not_linked", 403);

  const { data: memberships } = await admin
    .from("membership")
    .select("id, tenant_id")
    .eq("identity_id", identity.id)
    .eq("role", "SELLER")
    .eq("status", "ACTIVE");
  const membership = memberships?.[0];
  if (!membership) return fail("not_linked", 403);

  let requestedMonth: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body === "object" && typeof body.month === "string" && /^\d{4}-\d{2}$/.test(body.month)) requestedMonth = body.month;
  } catch {
    requestedMonth = null;
  }

  const { data: links } = await admin
    .from("store_seller")
    .select("id, store_id, millennium_employee_id, name, admitted_on, store:store_id (trade_name, name, timezone, hours)")
    .eq("membership_id", membership.id)
    .eq("tenant_id", membership.tenant_id);
  const mine = (links ?? []).filter((link) => link.millennium_employee_id != null);
  if (mine.length === 0) return fail("not_linked", 403);

  const todayParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Campo_Grande", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => todayParts.find((item) => item.type === type)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const historyFrom = sellerHistoryFrom(
    today,
    mine.map((link) => (link.admitted_on == null ? null : String(link.admitted_on))),
  );
  let month = requestedMonth ?? today.slice(0, 7);
  if (`${month}-01` < historyFrom) month = historyFrom.slice(0, 7);
  if (`${month}-01` > startOfMonth(today)) month = today.slice(0, 7);
  const monthStart = `${month}-01`;
  const monthEnd = endOfMonth(monthStart);
  const storeIds = [...new Set(mine.map((link) => String(link.store_id)))];
  const myIds = new Set(mine.map((link) => String(link.id)));
  const myId = String(mine[0].id);

  try {
    const teamRows = await allPages(
      admin
        .from("store_seller")
        .select("id, store_id, code, millennium_employee_id, millennium_gerador_id, name, name_keys, active, erp_role, admitted_on, departed_on, shift_id, store_shift(name)")
        .eq("tenant_id", membership.tenant_id)
        .in("store_id", storeIds)
        .order("name"),
    );
    const branchStores = await allPages(
      admin.from("store").select("id, code, millennium_store_id, branch_user_chosen, branch_user_seller_id").in("id", storeIds),
    );
    const branchSellerId = new Map<string, string | null>();
    for (const store of branchStores) {
      branchSellerId.set(
        String(store.id),
        resolveBranchSellerId({
          sellers: teamRows.map((row) => ({ id: String(row.id), code: row.code == null ? null : String(row.code), storeId: String(row.store_id) })),
          storeId: String(store.id),
          branchCode: store.code == null ? String(store.millennium_store_id) : String(store.code),
          millenniumBranch: Number(store.millennium_store_id),
        }),
      );
    }
    const team = teamRows.map((row) => {
      const member = teamMemberFromRow(row);
      if (branchSellerId.get(String(row.store_id)) !== String(row.id)) return member;
      return { ...member, branchUser: true, salesPerson: false };
    });

    const people: WalletPersonInput[] = [];
    const byEmployee = new Map<string, string>();
    const byName = new Map<string, string>();
    const remember = (name: string, personId: string) => {
      const key = nameKey(name);
      if (key && !byName.has(key)) byName.set(key, personId);
    };
    for (const row of teamRows) {
      const id = myIds.has(String(row.id)) ? myId : String(row.id);
      if (!people.some((person) => person.id === id)) people.push({ id, name: collaboratorName(String(row.name ?? "")) });
      if (row.millennium_employee_id != null) byEmployee.set(`e:${Number(row.millennium_employee_id)}`, id);
      remember(String(row.name ?? ""), id);
      if (Array.isArray(row.name_keys)) for (const key of row.name_keys) if (typeof key === "string") remember(key, id);
    }
    if (!people.some((person) => person.id === myId)) people.push({ id: myId, name: collaboratorName(String(mine[0].name ?? identity.name ?? "")) });

    const [goalRows, challengeRows] = await Promise.all([
      allPages(
        admin
          .from("goal")
          .select("id, store_id, name, starts_on, ends_on, target_cents, tier_mode, tiers, groups, spread_unidentified")
          .eq("tenant_id", membership.tenant_id)
          .in("store_id", storeIds)
          .lte("starts_on", monthEnd)
          .gte("ends_on", monthStart),
      ),
      allPages(
        admin
          .from("challenge")
          .select("id, store_id, name, starts_on, ends_on, metric, scope, mode, products, categories, target, min_sales, prizes")
          .eq("tenant_id", membership.tenant_id)
          .in("store_id", storeIds)
          .lte("starts_on", monthEnd)
          .gte("ends_on", monthStart),
      ),
    ]);
    const goals = goalRows.map(goalFromRow).filter((goal) => goal.endsOn.slice(0, 7) === month);
    const challenges = challengeRows.filter((row) => String(row.ends_on).slice(0, 7) === month);
    const salesTo = monthEnd < today ? monthEnd : today;
    let salesFrom = monthStart;
    for (const goal of goals) {
      const from = goalWeightFrom(goal.startsOn);
      if (from < salesFrom) salesFrom = from;
    }
    for (const challenge of challenges) if (String(challenge.starts_on) < salesFrom) salesFrom = String(challenge.starts_on);

    const [dayRows, sellerRows] = salesFrom <= salesTo
      ? await Promise.all([
          allPages(
            admin
              .from("sales_day_agg")
              .select("tenant_id, store_id, day, brand, revenue_cents, sales_count, item_count, cmv_cents")
              .eq("tenant_id", membership.tenant_id)
              .eq("brand", "ALL")
              .in("store_id", storeIds)
              .gte("day", salesFrom)
              .lte("day", salesTo)
              .order("day")
              .order("store_id"),
          ),
          allPages(
            admin
              .from("sales_seller_day_agg")
              .select("tenant_id, store_id, day, seller_key, seller_name, seller_employee_id, seller_gerador_id, brand, revenue_cents, sales_count, item_count")
              .eq("tenant_id", membership.tenant_id)
              .eq("brand", "ALL")
              .in("store_id", storeIds)
              .gte("day", salesFrom)
              .lte("day", salesTo)
              .order("day")
              .order("store_id"),
          ),
        ])
      : [[], []];

    const namedAggs = sellerRows.map(sellerDayFromRow);
    const nonSales = {
      employeeIds: new Set(team.filter((member) => !member.salesPerson).map((member) => member.employeeId)),
      generatorIds: new Set(team.filter((member) => !member.salesPerson && member.generatorId != null).map((member) => member.generatorId as number)),
      storeNameKeys: new Set(team.filter((member) => !member.salesPerson).flatMap((member) => member.nameKeys.map((key) => `${member.storeId}|${key}`))),
    };
    const sellerAggs = excludeNonSalesPeople(namedAggs, nonSales);
    const dayAggs = dayRows.map((row) => ({
      tenantId: String(row.tenant_id),
      storeId: String(row.store_id),
      day: String(row.day),
      brand: "ALL" as const,
      revenueCents: Number(row.revenue_cents) || 0,
      salesCount: Number(row.sales_count) || 0,
      itemCount: Number(row.item_count) || 0,
      cmvCents: row.cmv_cents == null ? undefined : Number(row.cmv_cents),
    }));

    const productChallenges = challenges.filter((row) => needsProductLines(String(row.metric ?? ""), row.scope == null ? null : String(row.scope)));
    let sellerProducts: SellerProductDay[] = [];
    let productTypes: { code: string; typeId: number }[] = [];
    if (productChallenges.length > 0 && salesFrom <= salesTo) {
      const productFrom = productChallenges.reduce((min, row) => (String(row.starts_on) < min ? String(row.starts_on) : min), String(productChallenges[0].starts_on));
      const needsTypes = productChallenges.some((row) => metricScope(String(row.metric ?? ""), row.scope == null ? null : String(row.scope)).scope === "CATEGORIES");
      const [productRows, typeRows] = await Promise.all([
        allPages(
          admin
            .from("sales_seller_product_day_agg")
            .select("store_id, day, seller_gerador_id, seller_key, seller_name, product_code, item_count, revenue_cents")
            .eq("tenant_id", membership.tenant_id)
            .in("store_id", storeIds)
            .gte("day", productFrom)
            .lte("day", salesTo)
            .order("day"),
        ),
        needsTypes ? allPages(admin.from("product_catalog").select("product_code, type_id").order("product_code")) : Promise.resolve([]),
      ]);
      sellerProducts = productRows.map((row) => ({
        storeId: String(row.store_id),
        day: String(row.day),
        sellerGeneratorId: Number(row.seller_gerador_id),
        sellerKey: String(row.seller_key ?? ""),
        sellerName: String(row.seller_name ?? ""),
        productCode: String(row.product_code ?? "").trim(),
        itemCount: Number(row.item_count) || 0,
        revenueCents: Number(row.revenue_cents) || 0,
      }));
      productTypes = typeRows.filter((row) => row.type_id != null).map((row) => ({ code: String(row.product_code), typeId: Number(row.type_id) }));
      sellerProducts = sellerProducts.filter(
        (row) => !nonSales.generatorIds.has(row.sellerGeneratorId) && !nonSales.storeNameKeys.has(`${row.storeId}|${row.sellerKey}`),
      );
    }

    const storeName = new Map<string, string>();
    const storeZone = new Map<string, string>();
    const storeWeek = new Map<string, StoreWeekHours>();
    for (const link of mine) {
      const store = (Array.isArray(link.store) ? link.store[0] : link.store) as { trade_name?: string | null; name?: string; timezone?: string | null; hours?: unknown } | null;
      const id = String(link.store_id);
      storeName.set(id, store?.trade_name?.trim() || store?.name || "Filial");
      storeZone.set(id, store?.timezone || "America/Campo_Grande");
      storeWeek.set(id, weekHours(store?.hours));
    }

    const goalSlices: WalletGoalInput[] = goals.map((goal) => {
      const card = buildGoalCardView({
        goal,
        storeNameValue: storeName.get(goal.storeId) ?? "Filial",
        dayAggs,
        sellerDayAggs: sellerAggs,
        namedSellerDayAggs: namedAggs,
        team,
        today,
        week: storeWeek.get(goal.storeId),
      });
      const rows = [];
      for (const seller of card.sellers) {
        const personId = byEmployee.get(seller.employeeId) ?? byName.get(nameKey(seller.name));
        if (!personId) continue;
        rows.push({ personId, prizeCents: reaisToCents(seller.accruedPrize), bonusCents: reaisToCents(seller.bonusReached) });
      }
      return { name: goal.name, endsOn: goal.endsOn, open: goalStatus(goal, today) === "active", people: rows };
    });

    const challengeSlices: WalletChallengeInput[] = [];
    for (const row of challenges) {
      const prizes = challengePrizes(row.prizes);
      const parsed = metricScope(String(row.metric ?? ""), row.scope == null ? null : String(row.scope));
      const challenge = {
        id: String(row.id),
        storeId: String(row.store_id),
        name: String(row.name ?? ""),
        startsOn: String(row.starts_on),
        endsOn: String(row.ends_on),
        mode: row.mode === "MINIMUM" ? "MINIMUM" as const : "CONTEST" as const,
        prize: prizes[0] ?? null,
        prizes,
        metric: parsed.metric,
        scope: parsed.scope,
        productCodes: codesOf(row.products),
        categoryIds: typeIdsOf(row.categories),
        target: numOrNull(row.target),
        minSales: numOrNull(row.min_sales),
      };
      const status = goalStatus(challenge, today);
      if (status === "upcoming") continue;
      const link = mine.find((item) => String(item.store_id) === challenge.storeId);
      const peopleRows = [];
      if (link) {
        const standing = challengeStanding(challenge, {
          today,
          employeeId: Number(link.millennium_employee_id),
          team,
          sellerDays: sellerAggs,
          products: sellerProducts,
          productTypes,
        });
        if (status === "active") peopleRows.push({ personId: myId, moneyCents: 0, itemLabel: null });
        else if (standing.won) {
          const prize = challenge.mode === "MINIMUM" ? prizes[0] : prizes[(standing.position ?? 1) - 1];
          if (prize?.kind === "ITEM") peopleRows.push({ personId: myId, moneyCents: 0, itemLabel: prize.label });
          else if (prize?.kind === "MONEY") peopleRows.push({ personId: myId, moneyCents: reaisToCents(prize.amount), itemLabel: null });
        }
      }
      challengeSlices.push({ name: challenge.name, endsOn: challenge.endsOn, open: status === "active", people: peopleRows });
    }

    const days = await cashDays(admin, membership.tenant_id, storeIds, storeZone, monthStart, monthEnd, today, byName);
    for (const day of days) {
      day.withdrawals = day.withdrawals.map((line) => ({ ...line, personId: myIds.has(line.personId) ? myId : line.personId }));
      day.shortage = day.shortage.map((line) => ({ ...line, personId: myIds.has(line.personId) ? myId : line.personId }));
    }
    const wallet = buildWalletMonth({
      month,
      people,
      goals: goalSlices,
      challenges: challengeSlices,
      days,
      onlyPersonId: myId,
    });
    const mineName = people.find((person) => person.id === myId)?.name || String(mine[0].name ?? "");
    wallet.people = wallet.people.map((person) => (person.personId === myId ? { ...person, name: mineName } : person));
    return json({ ok: true, historyFrom, wallet });
  } catch (error) {
    console.warn("wallet", error instanceof Error ? error.message : error);
    return fail("load_failed", 500);
  }
});

async function cashDays(
  admin: any, // deno-lint-ignore no-explicit-any
  tenantId: string,
  storeIds: string[],
  zones: Map<string, string>,
  from: string,
  to: string,
  today: string,
  byName: Map<string, string>,
): Promise<WalletCashDay[]> {
  const linkRes = await admin.from("store_cielo").select("store_id").eq("tenant_id", tenantId).in("store_id", storeIds);
  const cielo = new Set((linkRes.error ? [] : linkRes.data ?? []).map((row: { store_id: string }) => String(row.store_id)));
  const [mill, stoneFiles, stoneCaptures, stonePix, cieloFiles, cieloCaptures, cieloPix, reviewRows, shiftRows] = await Promise.all([
    allPages(admin.from("cash_close_day").select("store_id, day, payment_method, opening_cents, sangria_cents, closing_cents, typed_cents").eq("tenant_id", tenantId).in("store_id", storeIds).gte("day", from).lte("day", to).order("day")),
    allPages(admin.from("stone_day_file").select("store_id, day, kind, status").eq("tenant_id", tenantId).in("store_id", storeIds).gte("day", from).lte("day", to)),
    allPages(admin.from("stone_capture").select("store_id, day, account_type, payment_method, captured_cents").eq("tenant_id", tenantId).in("store_id", storeIds).gte("day", from).lte("day", to)),
    allPages(admin.from("stone_pix").select("store_id, day, status, paid_cents").eq("tenant_id", tenantId).in("store_id", storeIds).gte("day", from).lte("day", to)),
    cielo.size > 0 ? allPages(admin.from("cielo_day_file").select("store_id, day, kind, status").eq("tenant_id", tenantId).in("store_id", [...cielo]).gte("day", from).lte("day", to)) : Promise.resolve([]),
    cielo.size > 0 ? allPages(admin.from("cielo_capture").select("store_id, day, payment_method, captured_cents").eq("tenant_id", tenantId).in("store_id", [...cielo]).gte("day", from).lte("day", to)) : Promise.resolve([]),
    cielo.size > 0 ? allPages(admin.from("cielo_pix").select("store_id, day, paid_cents").eq("tenant_id", tenantId).in("store_id", [...cielo]).gte("day", from).lte("day", to)) : Promise.resolve([]),
    loadReviews(admin, tenantId, storeIds, from, to),
    allPages(admin.from("store_shift").select("store_id, name, start_time, end_time").eq("tenant_id", tenantId).in("store_id", storeIds)),
  ]);
  const marks = assembleMonthMarks({
    millennium: mill.map((row: any) => ({
      storeId: String(row.store_id),
      day: String(row.day),
      paymentMethod: String(row.payment_method ?? ""),
      openingCents: Number(row.opening_cents) || 0,
      cashDropCents: row.sangria_cents == null ? null : Number(row.sangria_cents),
      closingCents: Number(row.closing_cents) || 0,
      typedCents: Number(row.typed_cents) || 0,
    })),
    files: rowsForAcquirer(
      stoneFiles.map(fileRow),
      cieloFiles.map(fileRow),
      cielo,
    ),
    captures: rowsForAcquirer(
      stoneCaptures.map((row: any) => ({
        storeId: String(row.store_id),
        day: String(row.day),
        accountType: row.account_type == null ? null : Number(row.account_type),
        paymentMethod: String(row.payment_method ?? ""),
        capturedCents: Number(row.captured_cents) || 0,
      })),
      cieloCaptures.map((row: any) => ({
        storeId: String(row.store_id),
        day: String(row.day),
        accountType: null,
        paymentMethod: String(row.payment_method ?? ""),
        capturedCents: Number(row.captured_cents) || 0,
      })),
      cielo,
    ),
    pix: rowsForAcquirer(
      stonePix.map((row: any) => ({ storeId: String(row.store_id), day: String(row.day), status: String(row.status ?? ""), paidCents: Number(row.paid_cents) || 0 })),
      cieloPix.map((row: any) => ({ storeId: String(row.store_id), day: String(row.day), status: "paid", paidCents: Number(row.paid_cents) || 0 })),
      cielo,
    ),
  });
  const reviewByKey = new Map(reviewRows.map((review) => [`${review.storeId}|${review.day.slice(0, 10)}`, review]));
  const shiftsOf = (storeId: string) =>
    shiftRows
      .filter((row: any) => String(row.store_id) === storeId)
      .map((row: any) => ({ name: shiftName(String(row.name ?? "")), start: String(row.start_time).slice(0, 5), end: String(row.end_time).slice(0, 5) }));
  const days: WalletCashDay[] = [];
  for (const mark of marks) {
    const day = mark.day.slice(0, 10);
    if (day < from || day > to || day >= today) continue;
    const review = reviewByKey.get(`${mark.storeId}|${day}`) ?? null;
    const view = buildCashCloseView(mark);
    const lines = applyCloseReview(view.lines, review, { cardPending: mark.cardPending, pixRequested: mark.pixRequested });
    const withdrawn = (review?.withdrawals ?? []).reduce((sum, line) => sum + line.cents, 0);
    const remaining = !review?.waive && !dayWithoutReal(lines) && mark.millennium.length > 0 ? dayShortageCents(netCloseDiff(closeDayGap(lines).diffCents, withdrawn)) : 0;
    const withdrawals = (review?.withdrawals ?? []).map((line) => ({ personId: line.sellerId, cents: line.cents }));
    if (remaining <= 0) {
      days.push({ day, withdrawals, shortage: [], unassignedShortageCents: 0 });
      continue;
    }
    const scope = review?.shortageScope ?? "";
    if (scope !== "seller" && scope !== "group" && scope !== "everyone") {
      days.push({ day, withdrawals, shortage: [], unassignedShortageCents: remaining });
      continue;
    }
    const [sales, captures] = await Promise.all([
      allPages(admin.from("cash_close_sale").select("occurred_at, payment_method, seller_name, revenue_cents").eq("tenant_id", tenantId).eq("store_id", mark.storeId).eq("day", day)),
      allPages(admin.from("stone_capture").select("occurred_at, payment_method, captured_cents").eq("tenant_id", tenantId).eq("store_id", mark.storeId).eq("day", day)),
    ]);
    const shortageSales = sales.map((sale: any) => ({
      occurredAt: String(sale.occurred_at),
      paymentMethod: String(sale.payment_method ?? ""),
      sellerName: String(sale.seller_name ?? ""),
      revenueCents: Number(sale.revenue_cents) || 0,
    }));
    const shifts = shiftsOf(mark.storeId);
    const suggestion = suggestDayShortage({
      lines,
      sales: shortageSales,
      captures: captures.map((capture: any) => ({
        occurredAt: String(capture.occurred_at ?? ""),
        paymentMethod: String(capture.payment_method ?? ""),
        capturedCents: Number(capture.captured_cents) || 0,
      })),
      shifts,
      timeZone: zones.get(mark.storeId) ?? "America/Campo_Grande",
    });
    const named = shortageShares({
      shortageCents: remaining,
      scope: scope as ShortageScope,
      sellers: review?.shortageSellers ?? [],
      group: review?.shortageGroup ?? "",
      suggestion,
      sales: shortageSales,
      shifts,
      timeZone: zones.get(mark.storeId) ?? "America/Campo_Grande",
    });
    const shortage: { personId: string; cents: number }[] = [];
    let unassigned = named.length === 0 ? remaining : 0;
    for (const share of named) {
      const personId = byName.get(nameKey(share.name));
      if (!personId) unassigned += share.cents;
      else shortage.push({ personId, cents: share.cents });
    }
    days.push({ day, withdrawals, shortage, unassignedShortageCents: unassigned });
  }
  const seen = new Set(marks.map((mark) => `${mark.storeId}|${mark.day.slice(0, 10)}`));
  for (const review of reviewRows) {
    const day = review.day.slice(0, 10);
    if (seen.has(`${review.storeId}|${day}`) || day < from || day > to || day >= today || review.withdrawals.length === 0) continue;
    days.push({
      day,
      withdrawals: review.withdrawals.map((line) => ({ personId: line.sellerId, cents: line.cents })),
      shortage: [],
      unassignedShortageCents: 0,
    });
  }
  return days;
}

function fileRow(row: any) {
  return { storeId: String(row.store_id), day: String(row.day), kind: String(row.kind ?? ""), status: String(row.status ?? "") };
}

async function loadReviews(admin: any, tenantId: string, storeIds: string[], from: string, to: string) {
  const cols = "store_id, day, cash_typed_cents, justification, waive, typed_cents, acquirer_cents, shortage_scope, shortage_sellers, shortage_group";
  let query = await admin.from("cash_close_review").select(`${cols}, withdrawals, online_pix`).eq("tenant_id", tenantId).in("store_id", storeIds).gte("day", from).lte("day", to);
  if (query.error?.code === "42703") query = await admin.from("cash_close_review").select(`${cols}, withdrawals`).eq("tenant_id", tenantId).in("store_id", storeIds).gte("day", from).lte("day", to);
  if (query.error?.code === "42703") query = await admin.from("cash_close_review").select(cols).eq("tenant_id", tenantId).in("store_id", storeIds).gte("day", from).lte("day", to);
  if (query.error) throw new Error(query.error.message);
  return (query.data ?? []).map((row: any) => ({
    storeId: String(row.store_id),
    day: String(row.day),
    cashTypedCents: row.cash_typed_cents == null ? null : Number(row.cash_typed_cents),
    justification: String(row.justification ?? ""),
    waive: row.waive === true,
    typedCents: row.typed_cents ?? {},
    acquirerCents: row.acquirer_cents ?? {},
    onlinePix: parseOnlinePix(row.online_pix),
    withdrawals: parseWithdrawalRows(row.withdrawals),
    shortageScope: row.shortage_scope === "seller" || row.shortage_scope === "group" || row.shortage_scope === "everyone" ? row.shortage_scope : "",
    shortageSellers: Array.isArray(row.shortage_sellers) ? row.shortage_sellers.filter((item: unknown) => typeof item === "string") : [],
    shortageGroup: String(row.shortage_group ?? ""),
  }));
}
