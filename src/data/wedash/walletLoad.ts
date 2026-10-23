import { getSupabase } from "@/lib/supabase";
import { collaboratorName } from "@/lib/format";
import {
  applyCloseReview,
  buildCashCloseView,
  closeDayGap,
  dayWithoutReal,
} from "./cashCloseView";
import {
  fetchCashCloseMonthMarks,
  fetchCashCloseReviews,
  fetchCashCloseSales,
  fetchCloseShifts,
  fetchShortageCaptures,
} from "./cashCloseRepo";
import { fetchChallengeInput, fetchChallenges } from "./challengesRepo";
import { buildChallengeView } from "./challengeView";
import { dayShortageCents, netCloseDiff } from "./employeeWithdrawal";
import { goalWeightFrom } from "./engine/goalProjection";
import type { StoreWeekHours } from "./engine/goalWeights";
import { isWalletOpportunity, type WalletOpportunity } from "./engine/sellerOpportunity";
import { buildWalletMonth, managersForStore, splitEqualCents, type WalletCashDay, type WalletChallengeInput, type WalletGoalInput, type WalletManager, type WalletMonth, type WalletPersonInput } from "./engine/wallet";
import { buildGoalCardView, goalManagerPrize, goalStatus } from "./goalView";
import { fetchGoalTeam, fetchGoals } from "./goalsRepo";
import { fetchNamedSellerDayAggs, fetchSalesDayAggs, fetchSalesSellerDayAggs } from "./salesRepo";
import { shortageShares, suggestDayShortage, type ShortageScope } from "./shortageAssign";
import { fetchWithdrawalStaff } from "./withdrawalStaff";

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function endOfMonthIso(monthStart: string): string {
  const [year, month] = monthStart.slice(0, 7).split("-").map(Number);
  const last = new Date(year, month, 0).getDate();
  return `${monthStart.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

function reaisToCents(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100);
}

function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("pt-BR");
}

type Roster = {
  people: WalletPersonInput[];
  byId: Map<string, string>;
  byEmployee: Map<string, string>;
  byName: Map<string, string>;
  /** Gerentes ativas da WDash. Filiais vazias = todas. */
  managers: WalletManager[];
};

function rememberName(index: Map<string, string>, name: string, personId: string) {
  const key = nameKey(name);
  if (key && !index.has(key)) index.set(key, personId);
}

async function fetchWalletManagers(tenantId: string): Promise<WalletManager[]> {
  const sb = getSupabase();
  if (!sb) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any).rpc("wallet_managers", { p_tenant_id: tenantId });
  if (error) {
    console.warn("fetchWalletManagers:", error.message);
    return [];
  }
  const managers: WalletManager[] = [];
  for (const row of (data ?? []) as { id?: string | null; name?: string | null; store_ids?: unknown }[]) {
    const id = row.id?.trim() ?? "";
    const name = collaboratorName(row.name);
    if (!id || !name) continue;
    const storeIds = Array.isArray(row.store_ids)
      ? row.store_ids.filter((storeId): storeId is string => typeof storeId === "string" && storeId.length > 0)
      : [];
    managers.push({ id, name, storeIds });
  }
  return managers;
}

async function loadRoster(tenantId: string, storeId: string): Promise<Roster> {
  const sb = getSupabase();
  const people: WalletPersonInput[] = [];
  const byId = new Map<string, string>();
  const byEmployee = new Map<string, string>();
  const byName = new Map<string, string>();
  const add = (id: string, name: string, employeeId: number | null, nameKeys: string[]) => {
    if (!id || byId.has(id)) return;
    const label = collaboratorName(name) || "Funcionário fora do cadastro";
    byId.set(id, id);
    people.push({ id, name: label });
    if (employeeId != null) byEmployee.set(`e:${employeeId}`, id);
    rememberName(byName, label, id);
    for (const key of nameKeys) rememberName(byName, key, id);
  };

  if (sb) {
    const { data, error } = await sb
      .from("store_seller")
      .select("id, millennium_employee_id, name, name_keys")
      .eq("tenant_id", tenantId)
      .eq("store_id", storeId)
      .limit(2000);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      add(
        String(row.id),
        String(row.name ?? ""),
        row.millennium_employee_id == null ? null : Number(row.millennium_employee_id),
        Array.isArray(row.name_keys) ? row.name_keys.filter((key): key is string => typeof key === "string") : [],
      );
    }
  }

  const managers = await fetchWalletManagers(tenantId);
  for (const manager of managers) add(manager.id, manager.name, null, []);
  const staff = await fetchWithdrawalStaff(tenantId);
  for (const person of staff) add(person.id, person.name, null, []);
  return { people, byId, byEmployee, byName, managers };
}

function personFromKey(roster: Roster, key: string, name: string): string | null {
  if (roster.byEmployee.has(key)) return roster.byEmployee.get(key) ?? null;
  if (roster.byId.has(key)) return key;
  return roster.byName.get(nameKey(name)) ?? roster.byName.get(nameKey(key.replace(/^n:/, ""))) ?? null;
}

function personFromName(roster: Roster, name: string): string | null {
  return roster.byName.get(nameKey(name)) ?? null;
}

/** Carteira de uma filial no mês. Quem lê é gestor ou gerente. */
export async function loadBranchWallet(input: {
  tenantId: string;
  storeId: string;
  storeName: string;
  month: string;
  today: string;
  timeZone: string;
  week?: StoreWeekHours;
}): Promise<WalletMonth> {
  const month = monthKey(input.month);
  const monthStart = `${month}-01`;
  const monthEnd = endOfMonthIso(monthStart);
  const range = { tenantId: input.tenantId, storeIds: [input.storeId], from: monthStart, to: monthEnd };

  const [goals, challenges, team, roster, marks, reviews, shifts] = await Promise.all([
    fetchGoals(range),
    fetchChallenges(range),
    fetchGoalTeam(input.tenantId, [input.storeId]),
    loadRoster(input.tenantId, input.storeId),
    fetchCashCloseMonthMarks(input.tenantId, [input.storeId], monthStart, monthEnd),
    fetchCashCloseReviews(input.tenantId, [input.storeId], monthStart, monthEnd),
    fetchCloseShifts(input.tenantId, [input.storeId]),
  ]);

  const endingGoals = goals.filter((goal) => monthKey(goal.endsOn) === month && goal.storeId === input.storeId);
  const endingChallenges = challenges.filter((challenge) => monthKey(challenge.endsOn) === month && challenge.storeId === input.storeId);
  const salesTo = monthEnd < input.today ? monthEnd : input.today;
  let salesFrom = monthStart;
  for (const goal of endingGoals) {
    const from = goalWeightFrom(goal.startsOn);
    if (from < salesFrom) salesFrom = from;
  }
  for (const challenge of endingChallenges) {
    if (challenge.startsOn < salesFrom) salesFrom = challenge.startsOn;
  }

  const goalQuery = { tenantId: input.tenantId, storeIds: [input.storeId], from: salesFrom, to: salesTo };
  const [dayAggs, sellerAggs, namedAggs, challengeAggs] = await Promise.all([
    endingGoals.length > 0 && salesFrom <= salesTo ? fetchSalesDayAggs({ ...goalQuery, brand: "ALL" }) : Promise.resolve([]),
    endingGoals.length > 0 && salesFrom <= salesTo ? fetchSalesSellerDayAggs(goalQuery) : Promise.resolve([]),
    endingGoals.length > 0 && salesFrom <= salesTo ? fetchNamedSellerDayAggs(goalQuery) : Promise.resolve([]),
    fetchChallengeInput({ tenantId: input.tenantId, challenges: endingChallenges, today: input.today }),
  ]);

  const managers = managersForStore(roster.managers, input.storeId);
  const goalSlices: WalletGoalInput[] = endingGoals.map((goal) => {
    const card = buildGoalCardView({
      goal,
      storeNameValue: input.storeName,
      dayAggs,
      sellerDayAggs: sellerAggs,
      namedSellerDayAggs: namedAggs,
      team,
      today: input.today,
      week: input.week,
    });
    const people = new Map<string, WalletGoalInput["people"][number]>();
    for (const seller of card.sellers) {
      const personId = personFromKey(roster, seller.employeeId, seller.name);
      if (!personId) continue;
      people.set(personId, {
        personId,
        prizeCents: reaisToCents(seller.accruedPrize),
        bonusCents: reaisToCents(seller.bonusReached),
      });
    }
    const management = goalManagerPrize(goal, card.band.achieved);
    if (management && managers.length > 0) {
      const prizes = splitEqualCents(reaisToCents(management.prizeAmount), managers.length);
      const bonuses = splitEqualCents(reaisToCents(management.bonus), managers.length);
      managers.forEach((manager, index) => {
        const row = people.get(manager.id) ?? { personId: manager.id, prizeCents: 0, bonusCents: 0 };
        row.managementPrizeCents = prizes[index] ?? 0;
        row.managementBonusCents = bonuses[index] ?? 0;
        people.set(manager.id, row);
      });
    }
    return { name: goal.name, endsOn: goal.endsOn, open: goalStatus(goal, input.today) === "active", people: [...people.values()] };
  });

  const challengeSlices: WalletChallengeInput[] = [];
  for (const challenge of endingChallenges) {
    const status = goalStatus(challenge, input.today);
    if (status === "upcoming") continue;
    const view = buildChallengeView({ challenge, aggs: challengeAggs, today: input.today });
    const people = [];
    for (const participant of view.participants) {
      const personId = personFromKey(roster, participant.key, participant.name);
      if (!personId) continue;
      if (status === "active") {
        people.push({ personId, moneyCents: 0, itemLabel: null });
        continue;
      }
      if (!participant.winner || !participant.prize) continue;
      if (participant.prize.kind === "ITEM") {
        people.push({ personId, moneyCents: 0, itemLabel: participant.prize.label });
        continue;
      }
      people.push({ personId, moneyCents: reaisToCents(participant.prize.amount), itemLabel: null });
    }
    const managerPrize = status === "active" ? null : view.management?.atingiu ? view.management.prize : null;
    if (managerPrize && managers.length > 0) {
      if (managerPrize.kind === "ITEM") {
        for (const manager of managers) people.push({ personId: manager.id, moneyCents: 0, itemLabel: managerPrize.label, management: true });
      } else {
        const shares = splitEqualCents(reaisToCents(managerPrize.amount), managers.length);
        managers.forEach((manager, index) => {
          const share = shares[index] ?? 0;
          if (share > 0) people.push({ personId: manager.id, moneyCents: share, itemLabel: null, management: true });
        });
      }
    }
    challengeSlices.push({ name: challenge.name, endsOn: challenge.endsOn, open: status === "active", people });
  }

  const storeShifts = shifts
    .filter((shift) => shift.storeId === input.storeId)
    .map((shift) => ({ name: shift.name, start: shift.start, end: shift.end }));
  const reviewByDay = new Map(reviews.filter((review) => review.storeId === input.storeId).map((review) => [review.day.slice(0, 10), review]));
  const days: WalletCashDay[] = [];
  const seen = new Set<string>();

  for (const mark of marks) {
    if (mark.storeId !== input.storeId) continue;
    const day = mark.day.slice(0, 10);
    if (day < monthStart || day > monthEnd || day >= input.today) continue;
    seen.add(day);
    const review = reviewByDay.get(day) ?? null;
    const view = buildCashCloseView(mark.snap);
    const lines = applyCloseReview(view.lines, review, { cardPending: mark.cardPending, pixRequested: mark.snap.pixRequested });
    const gap = closeDayGap(lines);
    const withdrawals = (review?.withdrawals ?? []).map((line) => ({ personId: line.sellerId, cents: line.cents }));
    const withdrawn = withdrawals.reduce((sum, line) => sum + line.cents, 0);
    const remaining =
      review?.waive || dayWithoutReal(lines) || mark.snap.millennium.length === 0
        ? 0
        : dayShortageCents(netCloseDiff(gap.diffCents, withdrawn));
    days.push(await cashDay(input, roster, day, withdrawals, remaining, review, lines, storeShifts));
  }

  for (const review of reviews) {
    const day = review.day.slice(0, 10);
    if (review.storeId !== input.storeId || seen.has(day) || day < monthStart || day > monthEnd || day >= input.today) continue;
    if (review.withdrawals.length === 0) continue;
    days.push({
      day,
      withdrawals: review.withdrawals.map((line) => ({ personId: line.sellerId, cents: line.cents })),
      shortage: [],
      unassignedShortageCents: 0,
    });
  }

  return buildWalletMonth({
    month,
    people: roster.people,
    goals: goalSlices,
    challenges: challengeSlices,
    days,
  });
}

async function cashDay(
  input: { tenantId: string; storeId: string; timeZone: string },
  roster: Roster,
  day: string,
  withdrawals: { personId: string; cents: number }[],
  remaining: number,
  review: { shortageScope: string; shortageSellers: string[]; shortageGroup: string } | null,
  lines: Parameters<typeof suggestDayShortage>[0]["lines"],
  shifts: { name: string; start: string; end: string }[],
): Promise<WalletCashDay> {
  if (remaining <= 0) return { day, withdrawals, shortage: [], unassignedShortageCents: 0 };
  const scope = review?.shortageScope ?? "";
  if (scope !== "seller" && scope !== "group" && scope !== "everyone") {
    return { day, withdrawals, shortage: [], unassignedShortageCents: remaining };
  }
  const [sales, captures] = await Promise.all([
    fetchCashCloseSales(input.tenantId, [input.storeId], day),
    fetchShortageCaptures(input.tenantId, [input.storeId], day),
  ]);
  const shortageSales = sales.map((sale) => ({
    occurredAt: sale.occurredAt,
    paymentMethod: sale.paymentMethod,
    sellerName: sale.sellerName,
    revenueCents: sale.revenueCents,
  }));
  const suggestion = suggestDayShortage({
    lines,
    sales: shortageSales,
    captures: captures.map((capture) => ({
      occurredAt: capture.occurredAt,
      paymentMethod: capture.paymentMethod,
      capturedCents: capture.capturedCents,
    })),
    shifts,
    timeZone: input.timeZone,
  });
  const named = shortageShares({
    shortageCents: remaining,
    scope: scope as ShortageScope,
    sellers: review?.shortageSellers ?? [],
    group: review?.shortageGroup ?? "",
    suggestion,
    sales: shortageSales,
    shifts,
    timeZone: input.timeZone,
  });
  const shortage: { personId: string; cents: number }[] = [];
  let unassigned = 0;
  for (const share of named) {
    const personId = personFromName(roster, share.name);
    if (!personId) {
      unassigned += share.cents;
      continue;
    }
    shortage.push({ personId, cents: share.cents });
  }
  if (named.length === 0) unassigned += remaining;
  return { day, withdrawals, shortage, unassignedShortageCents: unassigned };
}

function isWalletMonth(value: unknown): value is WalletMonth {
  if (!value || typeof value !== "object") return false;
  const row = value as WalletMonth;
  return typeof row.month === "string" && Array.isArray(row.people) && typeof row.unassignedShortageCents === "number";
}

function readOpportunities(value: unknown): WalletOpportunity[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isWalletOpportunity);
}

/** Carteira da pessoa logada como vendedora. A Edge devolve só a linha dela e as oportunidades do período. */
export async function loadSellerWallet(month: string): Promise<{ wallet: WalletMonth; historyFrom: string; opportunities: WalletOpportunity[] } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.functions.invoke("wallet", { body: { month: monthKey(month) } });
  if (error) return null;
  const res = data as { ok?: boolean; wallet?: unknown; historyFrom?: string; opportunities?: unknown } | null;
  if (!res?.ok || !isWalletMonth(res.wallet)) return null;
  return { wallet: res.wallet, historyFrom: res.historyFrom ?? `${monthKey(month)}-01`, opportunities: readOpportunities(res.opportunities) };
}
