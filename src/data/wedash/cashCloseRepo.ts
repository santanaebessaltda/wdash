import { calendarTodayIso } from "./clock";
import { shiftName } from "./engine/format";
import { cashCloseJobMatches, monthCloseSpanFor, navMonthFloor, sangriaMonthSpan, type CashCloseJobPart } from "./cashCloseMonth";
import { captureBucket, paidPixCents, type CashCloseBucket, type CashCloseMillLine, type CloseAmountMap } from "./cashCloseView";

export type CashCloseSnapshot = {
  millennium: CashCloseMillLine[];
  card: { creditCents: number; debitCents: number; otherCents: number } | null;
  pixCents: number | null;
  pixRequested: boolean;
  cardPending: boolean;
};

const EMPTY: CashCloseSnapshot = { millennium: [], card: null, pixCents: null, pixRequested: false, cardPending: false };

/** Fechamento de um dia: valor digitado, cartão Stone e PIX Stone. */
export async function fetchCashCloseSnapshot(tenantId: string, storeId: string, day: string): Promise<CashCloseSnapshot> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return EMPTY;
  const [mill, captures, pix, files] = await Promise.all([
    sb
      .from("cash_close_day")
      .select("payment_method, opening_cents, sangria_cents, closing_cents, typed_cents")
      .eq("tenant_id", tenantId)
      .eq("store_id", storeId)
      .eq("day", day),
    sb.from("stone_capture").select("account_type, payment_method, captured_cents").eq("tenant_id", tenantId).eq("store_id", storeId).eq("day", day),
    sb.from("stone_pix").select("status, paid_cents").eq("tenant_id", tenantId).eq("store_id", storeId).eq("day", day),
    sb.from("stone_day_file").select("kind, status").eq("tenant_id", tenantId).eq("store_id", storeId).eq("day", day),
  ]);
  if (mill.error || captures.error || pix.error || files.error) {
    throw new Error(mill.error?.message || captures.error?.message || pix.error?.message || files.error?.message);
  }
  const fileRows = files.data ?? [];
  const cardReceived = fileRows.some((f) => f.kind === "card" && f.status === "received");
  const pixReceived = fileRows.some((f) => f.kind === "pix" && f.status === "received");
  const pixRequested = fileRows.some((f) => f.kind === "pix" && f.status === "requested");
  const cardPending = fileRows.some((f) => f.kind === "card" && f.status === "requested");
  let creditCents = 0;
  let debitCents = 0;
  let otherCents = 0;
  for (const row of captures.data ?? []) {
    const cents = Number(row.captured_cents) || 0;
    const bucket = captureBucket(row.account_type == null ? null : Number(row.account_type), String(row.payment_method ?? ""));
    if (bucket === "credit") creditCents += cents;
    else if (bucket === "debit") debitCents += cents;
    else otherCents += cents;
  }
  const pixCents = paidPixCents(
    (pix.data ?? []).map((row) => ({ status: String(row.status ?? ""), paidCents: Number(row.paid_cents) || 0 })),
  );
  return {
    millennium: (mill.data ?? []).map((r) => ({
      paymentMethod: String(r.payment_method ?? ""),
      openingCents: Number(r.opening_cents) || 0,
      sangriaCents: r.sangria_cents == null ? null : Number(r.sangria_cents),
      closingCents: Number(r.closing_cents) || 0,
      typedCents: Number(r.typed_cents) || 0,
    })),
    card: cardReceived ? { creditCents, debitCents, otherCents } : null,
    pixCents: pixReceived ? pixCents : null,
    pixRequested,
    cardPending,
  };
}

export type StoneLink = {
  storeId: string;
  stoneCode: string;
  covers: "all" | "online_pix";
};

/** Stone Code e cobertura das lojas. A chave não sai do banco. */
export async function fetchStoneLinks(tenantId: string, storeIds: string[]): Promise<StoneLink[]> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb || storeIds.length === 0) return [];
  const { data, error } = await sb
    .from("store_stone")
    .select("store_id, stone_code, covers")
    .eq("tenant_id", tenantId)
    .in("store_id", storeIds);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    storeId: String(r.store_id),
    stoneCode: String(r.stone_code),
    covers: r.covers === "all" ? "all" : "online_pix",
  }));
}

export async function saveStoneLink(input: {
  storeId: string;
  stoneCode: string;
  secret: string;
  covers: "all" | "online_pix";
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: false, message: "Não foi possível conectar à WDash. Verifique sua conexão e tente novamente." };
  const { data, error } = await sb.functions.invoke("stone-credential-persist", { body: input });
  if (error || !data?.ok) return { ok: false, message: "Não foi possível conectar a Stone. Tente novamente." };
  return { ok: true };
}

/** Tira a loja da Stone. Os fechamentos já gravados ficam. */
export async function disconnectStoneLink(storeId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: false, message: "Não foi possível conectar à WDash. Verifique sua conexão e tente novamente." };
  const { data, error } = await sb.functions.invoke("stone-credential-persist", {
    body: { storeId, disconnect: true },
  });
  if (error || !data?.ok) return { ok: false, message: "Não foi possível desconectar a Stone. Tente novamente." };
  return { ok: true };
}

export type CashCloseDayMark = {
  storeId: string;
  day: string;
  snap: CashCloseSnapshot;
  cardPending: boolean;
};

/** Fechamentos do intervalo, um por loja e dia, com o total da adquirente para o calendário. */
export async function fetchCashCloseMonthMarks(
  tenantId: string,
  storeIds: string[],
  from: string,
  to: string,
): Promise<CashCloseDayMark[]> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb || storeIds.length === 0 || from > to) return [];
  const [mill, files, captures, pix] = await Promise.all([
    sb
      .from("cash_close_day")
      .select("store_id, day, payment_method, opening_cents, sangria_cents, closing_cents, typed_cents")
      .eq("tenant_id", tenantId)
      .in("store_id", storeIds)
      .gte("day", from)
      .lte("day", to)
      .limit(10000),
    sb
      .from("stone_day_file")
      .select("store_id, day, kind, status")
      .eq("tenant_id", tenantId)
      .in("store_id", storeIds)
      .gte("day", from)
      .lte("day", to)
      .limit(5000),
    sb
      .from("stone_capture")
      .select("store_id, day, account_type, payment_method, captured_cents")
      .eq("tenant_id", tenantId)
      .in("store_id", storeIds)
      .gte("day", from)
      .lte("day", to)
      .limit(20000),
    sb
      .from("stone_pix")
      .select("store_id, day, status, paid_cents")
      .eq("tenant_id", tenantId)
      .in("store_id", storeIds)
      .gte("day", from)
      .lte("day", to)
      .limit(20000),
  ]);
  if (mill.error || files.error || captures.error || pix.error) {
    throw new Error(mill.error?.message || files.error?.message || captures.error?.message || pix.error?.message);
  }
  const byKey = new Map<string, CashCloseDayMark>();
  const slot = (storeId: string, day: string) => {
    const key = `${storeId}|${day}`;
    const cur = byKey.get(key);
    if (cur) return cur;
    const created: CashCloseDayMark = { storeId, day, snap: { ...EMPTY, millennium: [] }, cardPending: false };
    byKey.set(key, created);
    return created;
  };
  for (const row of mill.data ?? []) {
    const mark = slot(String(row.store_id), String(row.day));
    mark.snap.millennium.push({
      paymentMethod: String(row.payment_method ?? ""),
      openingCents: Number(row.opening_cents) || 0,
      sangriaCents: row.sangria_cents == null ? null : Number(row.sangria_cents),
      closingCents: Number(row.closing_cents) || 0,
      typedCents: Number(row.typed_cents) || 0,
    });
  }
  const pixReceived = new Set<string>();
  for (const row of files.data ?? []) {
    const day = String(row.day).slice(0, 10);
    const mark = slot(String(row.store_id), day);
    const key = `${row.store_id}|${day}`;
    if (row.kind === "pix" && row.status === "requested") mark.snap.pixRequested = true;
    if (row.kind === "pix" && row.status === "received") pixReceived.add(key);
    if (row.kind === "card" && row.status === "requested") mark.cardPending = true;
  }
  const pixRows = new Map<string, Array<{ status: string; paidCents: number }>>();
  for (const row of pix.data ?? []) {
    const key = `${row.store_id}|${String(row.day).slice(0, 10)}`;
    const list = pixRows.get(key) ?? [];
    list.push({ status: String(row.status ?? ""), paidCents: Number(row.paid_cents) || 0 });
    pixRows.set(key, list);
  }
  for (const key of pixReceived) {
    const [storeId, day] = key.split("|");
    if (!storeId || !day) continue;
    slot(storeId, day).snap.pixCents = paidPixCents(pixRows.get(key) ?? []);
  }
  const cards = new Map<string, { creditCents: number; debitCents: number; otherCents: number }>();
  for (const row of captures.data ?? []) {
    const key = `${row.store_id}|${String(row.day).slice(0, 10)}`;
    const card = cards.get(key) ?? { creditCents: 0, debitCents: 0, otherCents: 0 };
    const cents = Number(row.captured_cents) || 0;
    const bucket = captureBucket(row.account_type == null ? null : Number(row.account_type), String(row.payment_method ?? ""));
    if (bucket === "credit") card.creditCents += cents;
    else if (bucket === "debit") card.debitCents += cents;
    else if (bucket !== "pix") card.otherCents += cents;
    cards.set(key, card);
  }
  for (const [key, card] of cards) {
    const [storeId, day] = key.split("|");
    if (!storeId || !day) continue;
    slot(storeId, day).snap.card = card;
  }
  return [...byKey.values()];
}

/** Primeiro mês que o calendário deixa abrir para esta loja. */
export async function fetchNavMonthFloor(
  table: "cash_close_day" | "sangria_line",
  tenantId: string,
  storeId: string,
  today: string,
): Promise<string> {
  const before = `${today.slice(0, 7)}-01`;
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return before;
  const [oldest, newest] = await Promise.all([
    sb.from(table).select("day").eq("tenant_id", tenantId).eq("store_id", storeId).lt("day", before).order("day", { ascending: true }).limit(1),
    sb.from(table).select("day").eq("tenant_id", tenantId).eq("store_id", storeId).lt("day", before).order("day", { ascending: false }).limit(1),
  ]);
  if (oldest.error || newest.error) return before;
  const oldDay = oldest.data?.[0] ? String(oldest.data[0].day) : null;
  const newDay = newest.data?.[0] ? String(newest.data[0].day) : null;
  return navMonthFloor(today, oldDay, newDay);
}

/** Pede as sangrias do mês visível, do dia 1 até hoje. */
export async function requestSangriaMonth(
  storeIds: string[],
  monthDay = calendarTodayIso(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  const span = sangriaMonthSpan(monthDay, calendarTodayIso());
  if (!span) return { ok: false, message: "Não há sangrias para buscar neste mês." };
  return enqueueCashClose(span.from, span.to, storeIds, "Não foi possível buscar as sangrias deste mês. Tente novamente.", "sangria");
}

/** Pede o fechamento dos dias do mês visível que ainda não têm, até ontem. */
export async function requestMonthClose(
  storeIds: string[],
  monthDay = calendarTodayIso(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  const span = monthCloseSpanFor(monthDay, calendarTodayIso());
  if (!span) return { ok: false, message: "Os fechamentos deste mês estarão disponíveis a partir de amanhã." };
  return enqueueCashClose(span.from, span.to, storeIds, "Não foi possível buscar os fechamentos deste mês. Tente novamente.", "close");
}

async function enqueueCashClose(
  from: string,
  to: string,
  storeIds: string[],
  fail: string,
  part: CashCloseJobPart,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: true };
  const { error } = await sb.functions.invoke("erp-sync-enqueue", {
    body: { action: "cash_close", from, to, storeIds, part },
  });
  if (error) return { ok: false, message: fail };
  return { ok: true };
}

const BUCKETS: CashCloseBucket[] = ["cash", "debit", "credit", "pix", "other"];

function amountMap(value: unknown): CloseAmountMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: CloseAmountMap = {};
  for (const key of BUCKETS) {
    const n = (value as Record<string, unknown>)[key];
    if (typeof n === "number" && Number.isFinite(n)) out[key] = Math.round(n);
  }
  return out;
}

export type ShortageScopeSaved = "" | "seller" | "group" | "everyone";

export type CashCloseReview = {
  storeId: string;
  day: string;
  cashTypedCents: number | null;
  justification: string;
  waive: boolean;
  typedCents: CloseAmountMap;
  acquirerCents: CloseAmountMap;
  shortageScope: ShortageScopeSaved;
  shortageSellers: string[];
  shortageGroup: string;
};

function sellerList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function scopeOf(value: unknown): ShortageScopeSaved {
  if (value === "seller" || value === "group" || value === "everyone") return value;
  return "";
}

export async function fetchCashCloseReviews(tenantId: string, storeIds: string[], from: string, to: string): Promise<CashCloseReview[]> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb || storeIds.length === 0 || from > to) return [];
  const { data, error } = await sb
    .from("cash_close_review")
    .select("store_id, day, cash_typed_cents, justification, waive, typed_cents, acquirer_cents, shortage_scope, shortage_sellers, shortage_group")
    .eq("tenant_id", tenantId)
    .in("store_id", storeIds)
    .gte("day", from)
    .lte("day", to);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    storeId: String(row.store_id),
    day: String(row.day),
    cashTypedCents: row.cash_typed_cents == null ? null : Number(row.cash_typed_cents),
    justification: String(row.justification ?? ""),
    waive: row.waive === true,
    typedCents: amountMap(row.typed_cents),
    acquirerCents: amountMap(row.acquirer_cents),
    shortageScope: scopeOf(row.shortage_scope),
    shortageSellers: sellerList(row.shortage_sellers),
    shortageGroup: String(row.shortage_group ?? ""),
  }));
}

export async function saveCashCloseReview(input: {
  tenantId: string;
  storeId: string;
  day: string;
  cashTypedCents: number | null;
  justification: string;
  waive: boolean;
  typedCents: CloseAmountMap;
  acquirerCents: CloseAmountMap;
  shortageScope: ShortageScopeSaved;
  shortageSellers: string[];
  shortageGroup: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: false, message: "Não foi possível conectar à WDash. Verifique sua conexão e tente novamente." };
  const { error } = await sb.from("cash_close_review").upsert(
    {
      tenant_id: input.tenantId,
      store_id: input.storeId,
      day: input.day,
      cash_typed_cents: input.cashTypedCents,
      justification: input.justification,
      waive: input.waive,
      typed_cents: input.typedCents,
      acquirer_cents: input.acquirerCents,
      shortage_scope: input.shortageScope,
      shortage_sellers: input.shortageSellers,
      shortage_group: input.shortageGroup,
    },
    { onConflict: "tenant_id,store_id,day" },
  );
  if (error) return { ok: false, message: "Não foi possível salvar o fechamento. Tente novamente." };
  return { ok: true };
}

export async function fetchOpenCashCloseJob(tenantId: string, part: "sangria" | "close"): Promise<boolean> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return false;
  const { data, error } = await sb
    .from("sync_job")
    .select("payload, status")
    .eq("tenant_id", tenantId)
    .eq("kind", "CLOSE")
    .in("status", ["QUEUED", "RUNNING"])
    .limit(20);
  if (error) return false;
  return (data ?? []).some((row) => cashCloseJobMatches(row.payload as { cashOnly?: unknown; part?: unknown } | null, part));
}

/** Erro do último fechamento pedido por esta tela. Sucesso devolve null. */
export async function fetchLatestCashCloseError(tenantId: string, part: "sangria" | "close"): Promise<string | null> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("sync_job")
    .select("status, error, payload")
    .eq("tenant_id", tenantId)
    .eq("kind", "CLOSE")
    .order("finished_at", { ascending: false })
    .limit(8);
  if (error) return null;
  const row = (data ?? []).find((item) => cashCloseJobMatches(item.payload as { cashOnly?: unknown; part?: unknown } | null, part));
  if (!row || row.status !== "FAILED") return null;
  const message = String(row.error ?? "");
  const fallback = part === "sangria"
    ? "Não foi possível buscar as sangrias. Tente novamente."
    : "Não foi possível buscar os fechamentos. Tente novamente.";
  return message.startsWith("Não foi possível") ? message : fallback;
}

export type CloseSaleRow = {
  storeId: string;
  occurredAt: string;
  paymentMethod: string;
  sellerName: string;
  revenueCents: number;
};

export type CloseCaptureRow = {
  storeId: string;
  occurredAt: string;
  paymentMethod: string;
  capturedCents: number;
  authorizationCode: string;
};

export type CloseShiftRow = {
  storeId: string;
  name: string;
  start: string;
  end: string;
};

/** Vendas do dia, para achar o grupo do horário. */
export async function fetchCashCloseSales(tenantId: string, storeIds: string[], day: string): Promise<CloseSaleRow[]> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb || storeIds.length === 0) return [];
  const { data, error } = await sb
    .from("cash_close_sale")
    .select("store_id, occurred_at, payment_method, seller_name, revenue_cents")
    .eq("tenant_id", tenantId)
    .in("store_id", storeIds)
    .eq("day", day)
    .limit(8000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    storeId: String(row.store_id),
    occurredAt: String(row.occurred_at),
    paymentMethod: String(row.payment_method ?? ""),
    sellerName: String(row.seller_name ?? ""),
    revenueCents: Number(row.revenue_cents) || 0,
  }));
}

/** Capturas de cartão e PIX do dia, para achar a venda que não foi cobrada. */
export async function fetchShortageCaptures(tenantId: string, storeIds: string[], day: string): Promise<CloseCaptureRow[]> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb || storeIds.length === 0) return [];
  const [card, pix] = await Promise.all([
    sb
      .from("stone_capture")
      .select("store_id, occurred_at, payment_method, captured_cents, authorization_code")
      .eq("tenant_id", tenantId)
      .in("store_id", storeIds)
      .eq("day", day)
      .limit(8000),
    sb
      .from("stone_pix")
      .select("store_id, occurred_at, paid_cents, status")
      .eq("tenant_id", tenantId)
      .in("store_id", storeIds)
      .eq("day", day)
      .limit(8000),
  ]);
  if (card.error) throw new Error(card.error.message);
  if (pix.error) throw new Error(pix.error.message);
  const rows: CloseCaptureRow[] = (card.data ?? []).map((row) => ({
    storeId: String(row.store_id),
    occurredAt: String(row.occurred_at ?? ""),
    paymentMethod: String(row.payment_method ?? ""),
    capturedCents: Number(row.captured_cents) || 0,
    authorizationCode: String(row.authorization_code ?? ""),
  }));
  for (const row of pix.data ?? []) {
    const status = String(row.status ?? "").toLowerCase();
    if (status === "canceled" || status === "cancelled") continue;
    const cents = Number(row.paid_cents) || 0;
    if (cents <= 0) continue;
    rows.push({
      storeId: String(row.store_id),
      occurredAt: row.occurred_at ? String(row.occurred_at) : "",
      paymentMethod: "Pix",
      capturedCents: cents,
      authorizationCode: "",
    });
  }
  return rows;
}

/** Grupos da loja, no horário local. */
export async function fetchCloseShifts(tenantId: string, storeIds: string[]): Promise<CloseShiftRow[]> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb || storeIds.length === 0) return [];
  const { data, error } = await sb
    .from("store_shift")
    .select("store_id, name, start_time, end_time")
    .eq("tenant_id", tenantId)
    .in("store_id", storeIds)
    .order("start_time");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    storeId: String(row.store_id),
    name: shiftName(String(row.name ?? "")),
    start: String(row.start_time).slice(0, 5),
    end: String(row.end_time).slice(0, 5),
  }));
}
