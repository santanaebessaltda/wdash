import { calendarTodayIso } from "./clock";
import { shiftName } from "./engine/format";
import { monthCloseSpanFor } from "./cashCloseMonth";
import { cashCloseBucket, type CashCloseBucket, type CashCloseMillLine, type CloseAmountMap } from "./cashCloseView";

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
    sb.from("stone_capture").select("payment_method, captured_cents").eq("tenant_id", tenantId).eq("store_id", storeId).eq("day", day),
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
    const bucket = cashCloseBucket(String(row.payment_method ?? ""));
    if (bucket === "credit") creditCents += cents;
    else if (bucket === "debit") debitCents += cents;
    else otherCents += cents;
  }
  let pixCents = 0;
  for (const row of pix.data ?? []) {
    const status = String(row.status ?? "").toLowerCase();
    if (status === "canceled" || status === "cancelled") continue;
    pixCents += Number(row.paid_cents) || 0;
  }
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
  const [mill, files, captures] = await Promise.all([
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
      .select("store_id, day, payment_method, captured_cents")
      .eq("tenant_id", tenantId)
      .in("store_id", storeIds)
      .gte("day", from)
      .lte("day", to)
      .limit(20000),
  ]);
  if (mill.error || files.error || captures.error) throw new Error(mill.error?.message || files.error?.message || captures.error?.message);
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
  for (const row of files.data ?? []) {
    const mark = slot(String(row.store_id), String(row.day));
    if (row.kind === "pix" && row.status === "requested") mark.snap.pixRequested = true;
    if (row.kind === "card" && row.status === "requested") mark.cardPending = true;
  }
  const cards = new Map<string, { creditCents: number; debitCents: number; otherCents: number }>();
  for (const row of captures.data ?? []) {
    const key = `${row.store_id}|${String(row.day).slice(0, 10)}`;
    const card = cards.get(key) ?? { creditCents: 0, debitCents: 0, otherCents: 0 };
    const cents = Number(row.captured_cents) || 0;
    const bucket = cashCloseBucket(String(row.payment_method ?? ""));
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

/** Dias do intervalo que têm ao menos uma venda da lista. */
export async function fetchCashCloseSaleDays(tenantId: string, storeIds: string[], from: string, to: string): Promise<Set<string>> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  const days = new Set<string>();
  if (!sb || storeIds.length === 0 || from > to) return days;
  const { data, error } = await sb
    .from("cash_close_sale")
    .select("day")
    .eq("tenant_id", tenantId)
    .in("store_id", storeIds)
    .gte("day", from)
    .lte("day", to)
    .limit(20000);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) days.add(String(row.day).slice(0, 10));
  return days;
}

/** Pede o fechamento dos dias do mês visível que ainda não têm, até ontem. */
export async function requestMonthClose(
  storeIds: string[],
  monthDay = calendarTodayIso(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  const span = monthCloseSpanFor(monthDay, calendarTodayIso());
  if (!span) return { ok: false, message: "Os fechamentos deste mês estarão disponíveis a partir de amanhã." };
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: true };
  const { error } = await sb.functions.invoke("erp-sync-enqueue", {
    body: { action: "cash_close", from: span.from, to: span.to, storeIds },
  });
  if (error) return { ok: false, message: "Não foi possível buscar os fechamentos deste mês. Tente novamente." };
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

export type CashCloseReview = {
  storeId: string;
  day: string;
  cashTypedCents: number | null;
  justification: string;
  waive: boolean;
  typedCents: CloseAmountMap;
  acquirerCents: CloseAmountMap;
};

export async function fetchCashCloseReviews(tenantId: string, storeIds: string[], from: string, to: string): Promise<CashCloseReview[]> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb || storeIds.length === 0 || from > to) return [];
  const { data, error } = await sb
    .from("cash_close_review")
    .select("store_id, day, cash_typed_cents, justification, waive, typed_cents, acquirer_cents")
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
    },
    { onConflict: "tenant_id,store_id,day" },
  );
  if (error) return { ok: false, message: "Não foi possível salvar o fechamento. Tente novamente." };
  return { ok: true };
}

export async function fetchOpenCashCloseJob(tenantId: string): Promise<boolean> {
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
  return (data ?? []).some((row) => (row.payload as { cashOnly?: unknown } | null)?.cashOnly === true);
}

/** Erro do último fechamento pedido por esta tela. Sucesso devolve null. */
export async function fetchLatestCashCloseError(tenantId: string): Promise<string | null> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("sync_job")
    .select("status, error, payload")
    .eq("tenant_id", tenantId)
    .eq("kind", "CLOSE")
    .order("finished_at", { ascending: false })
    .limit(5);
  if (error) return null;
  const row = (data ?? []).find((item) => (item.payload as { cashOnly?: unknown } | null)?.cashOnly === true);
  if (!row || row.status !== "FAILED") return null;
  const message = String(row.error ?? "");
  return message.startsWith("Não foi possível") ? message : "Não foi possível buscar os fechamentos. Tente novamente.";
}

export type CloseSaleRow = {
  storeId: string;
  occurredAt: string;
  paymentMethod: string;
  sellerName: string;
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
    .select("store_id, occurred_at, payment_method, seller_name")
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
  }));
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
