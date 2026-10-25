import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Card, DateRangePicker, Modal, Skeleton, Tooltip, useToast, CALENDAR_QUICK_RANGES, type DatePresetId, type DateRangeChangeMeta } from "@/components/ui";
import { statusBadgeVariant } from "@/lib/status";
import { FinanceMonthSkeleton } from "@/components/wedash/LoadingSkeletons";
import { DayFace, DayMetrics, MonthCalendar, blankDayClass } from "@/components/wedash/MonthCalendar";
import { StoreDivisionTitle } from "@/components/wedash/StoreDivisionTitle";
import { EmployeeWithdrawal } from "@/pages/cash-close/EmployeeWithdrawal";
import { OnlinePix } from "@/pages/cash-close/OnlinePix";
import { monthCloseSpanFor, monthsTouched } from "@/data/wedash/cashCloseMonth";
import { addMonths } from "@/data/wedash/engine/format";
import { goalMonthFloor, laterMonth } from "@/data/wedash/goalMonths";
import { fetchGoals } from "@/data/wedash/goalsRepo";
import {
  applyCloseReview,
  buildCashCloseView,
  closeDayGap,
  dayWithoutReal,
  monthCloseSummary,
  realCentsOf,
  withCashWithdrawal,
  withOnlinePix,
  type CashCloseBucket,
  type CashCloseLine,
  type MonthCloseSummary,
} from "@/data/wedash/cashCloseView";
import {
  fetchCashCloseMonthMarks,
  fetchCashCloseReviews,
  fetchCashCloseSnapshot,
  fetchNavMonthFloor,
  fetchOpenCashCloseJob,
  fetchLatestCashCloseError,
  requestMonthClose,
  saveCashCloseReview,
  type CashCloseDayMark,
  type CashCloseReview,
  type CashCloseSnapshot,
} from "@/data/wedash/cashCloseRepo";
import { calendarTodayIso } from "@/data/wedash/clock";
import { isOwner } from "@/layout/nav-wedash";
import { periodLabels } from "@/data/wedash/dashboard";
import {
  dayShortageCents,
  mergeWithdrawalPeople,
  withdrawalDraftFrom,
  withdrawalSave,
  type WithdrawalDraft,
  type WithdrawalPerson,
} from "@/data/wedash/employeeWithdrawal";
import {
  onlinePixDraftFrom,
  onlinePixPreviewCents,
  onlinePixSave,
  onlinePixTotal,
  pixAcquirerCents,
  type OnlinePixDraftRow,
} from "@/data/wedash/onlinePix";
import { fetchSalesDayAggs, fetchSyncWatermark } from "@/data/wedash/salesRepo";
import { fetchStoreSellers, isBranchUser, storesForSession, type Store, type StoreSeller } from "@/data/wedash/stores";
import { fetchWithdrawalStaff } from "@/data/wedash/withdrawalStaff";
import { cn } from "@/lib/cn";
import { brlCent, longDate, isoToDate, endOfMonth, startOfMonth, dateToIso, addDays, labelUpper } from "@/lib/format";
import { refreshMomentTitle, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { parseNum, SectionHeader, useScopedStores } from "@/pages/operation/shared";
import { HeaderFilters } from "@/pages/stock/shared";


const money = (cents: number | null) => (cents == null ? "—" : brlCent(cents / 100));

function diffClass(cents: number | null): string {
  if (cents == null || cents === 0) return "text-t2";
  return cents < 0 ? "text-bad" : "text-ok";
}

function dayTotal(cents: number): string {
  const abs = brlCent(Math.abs(cents) / 100);
  if (cents < 0) return `−${abs}`;
  if (cents > 0) return `+${abs}`;
  return abs;
}

function rangeCells(from: string, to: string): Array<string | null> {
  const cells: Array<string | null> = Array.from({ length: isoToDate(from).getDay() }, () => null);
  for (let day = from; day <= to; day = addDays(day, 1)) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function dayTitle(iso: string): string {
  const s = longDate(iso);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function centsToField(cents: number): string {
  const abs = Math.abs(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `−${abs}` : abs;
}

function fieldToCents(txt: string): number | null {
  const raw = txt.trim().replace("−", "-");
  if (!raw || raw === "-") return null;
  const neg = raw.startsWith("-");
  const n = parseNum(neg ? raw.slice(1) : raw);
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(n * 100) * (neg ? -1 : 1);
}

function linesWithDraft(lines: CashCloseLine[], draft: CloseDraft | undefined): CashCloseLine[] {
  if (!draft) return lines;
  const online = onlinePixPreviewCents(draft.onlinePix, fieldToCents);
  const mapped = lines.map((line) => {
    const next = { ...line };
    const typed = fieldToCents(draft.typed[line.key] ?? "");
    if (typed != null) next.typedCents = typed;
    if (line.key !== "cash") {
      const raw = draft.acquirer[line.key] ?? "";
      const real = fieldToCents(raw);
      if (line.key === "pix") next.stoneCents = pixAcquirerCents(line.stoneCents, real, raw.trim() === "", online);
      else if (raw.trim() && real != null && !(line.stoneCents == null && real === 0)) next.stoneCents = real;
    }
    return next;
  });
  const pix = mapped.find((line) => line.key === "pix");
  const rawPix = draft.acquirer.pix ?? "";
  const stoneWhenNew = pix
    ? null
    : pixAcquirerCents(null, fieldToCents(rawPix), rawPix.trim() === "", online);
  return withOnlinePix(mapped, online, stoneWhenNew);
}

type CloseDraft = {
  typed: Partial<Record<CashCloseBucket, string>>;
  acquirer: Partial<Record<CashCloseBucket, string>>;
  onlinePix: OnlinePixDraftRow[];
};

function CloseTable({
  lines,
  pixPending,
  owner,
  closed,
  draft,
  onAcquirer,
  onTyped,
  pixOnline,
}: {
  lines: CashCloseLine[];
  pixPending: boolean;
  owner: boolean;
  closed: boolean;
  draft?: CloseDraft;
  onAcquirer?: (key: CashCloseBucket, value: string) => void;
  onTyped?: (key: CashCloseBucket, value: string) => void;
  pixOnline: boolean;
}) {
  if (lines.length === 0) return null;
  const field =
    "h-9 w-full min-w-0 rounded-[9px] border border-line bg-bg-inset px-2 text-right font-mono text-[13px] font-bold text-t0 outline-none focus:border-acc";
  const cabecalhos = ["Forma", "Millennium", "Total real", "Diferença"];
  const conta = closeDayGap(lines);
  return (
    <>
      {pixPending && (
        <Alert className="mb-4" variant="info" title="O fechamento de Pix deste dia já foi solicitado. O total real aparecerá assim que estiver disponível." />
      )}
      <div className="overflow-x-auto rounded-[var(--radius-vela-lg)] border border-line bg-bg-2">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              {cabecalhos.map((header, index) => (
                <th
                  key={header}
                  className={cn(
                    "px-3 py-3 text-[10.5px] font-bold uppercase tracking-wide text-t2",
                    index === 0 ? "text-left" : "text-right",
                  )}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((row) => {
              const real = realCentsOf(row);
              const diff = real == null ? null : real - row.systemCents;
              const online = row.manualPixCents ?? 0;
              const pixLocked = row.key === "pix" && (pixOnline || online > 0);
              const acqTxt = draft?.acquirer[row.key] ?? (row.stoneCents == null ? "" : centsToField(row.stoneCents));
              const cashEditable = row.key === "cash" && Boolean(owner && draft && onTyped);
              return (
                <tr key={row.key} className="border-b border-line">
                  <td className="px-3 py-3 text-t0">{labelUpper(row.label)}</td>
                  <td className="px-3 py-3 text-right font-mono text-[13px] font-bold text-t0">{money(row.systemCents)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {cashEditable ? (
                      <div className="flex flex-col items-end">
                        <input
                          value={draft?.typed.cash ?? ""}
                          onChange={(e) => onTyped?.("cash", e.target.value)}
                          inputMode="decimal"
                          placeholder="—"
                          aria-label={`Total real para ${row.label}`}
                          className={field}
                        />
                        {(row.withdrawalCents ?? 0) > 0 && (
                          <span className="mt-0.5 max-w-[220px] text-right text-[11px] leading-tight text-t2">
                            Digitado {money(fieldToCents(draft?.typed.cash ?? "") ?? row.typedCents)} · Retirada {money(row.withdrawalCents ?? 0)}
                          </span>
                        )}
                      </div>
                    ) : row.key === "cash" || pixLocked || !(owner && draft && onAcquirer) ? (
                      <div className="flex flex-col items-end">
                        <span className="font-mono text-[13px] font-bold text-t0">{real == null ? "—" : money(real)}</span>
                        {online > 0 && (
                          <span className="mt-0.5 max-w-[220px] text-right text-[11px] leading-tight text-t2">
                            Adquirente {money(row.stoneCents)} · PIX online {money(online)}
                          </span>
                        )}
                        {row.key === "cash" && (row.withdrawalCents ?? 0) > 0 && (
                          <span className="mt-0.5 max-w-[220px] text-right text-[11px] leading-tight text-t2">
                            Digitado {money(row.typedCents)} · Retirada {money(row.withdrawalCents ?? 0)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <input
                        value={acqTxt}
                        onChange={(e) => onAcquirer(row.key, e.target.value)}
                        inputMode="decimal"
                        placeholder="—"
                        aria-label={`Total real para ${row.label}`}
                        className={field}
                      />
                    )}
                  </td>
                  <td className={cn("px-3 py-3 text-right font-mono text-[13px] font-bold", closed && diff != null ? diffClass(diff) : "text-t2")}>
                    {closed && diff != null ? dayTotal(diff) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-bg-1">
              <td className="px-3 py-3 text-[12px] font-bold uppercase tracking-wide text-t2">Total</td>
              <td className="px-3 py-3 text-right font-mono text-[13px] font-bold text-t0">{money(conta.systemCents)}</td>
              <td className="px-3 py-3 text-right font-mono text-[13px] font-bold text-t0">
                {dayWithoutReal(lines) ? "—" : money(conta.realCents)}
              </td>
              <td className={cn("px-3 py-3 text-right font-mono text-[13px] font-bold", closed && !dayWithoutReal(lines) ? diffClass(conta.diffCents) : "text-t2")}>
                {closed && !dayWithoutReal(lines) ? dayTotal(conta.diffCents) : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

export { MonthStep, MonthYearPicker, monthNavBtn } from "./MonthYearPicker";

/** Financeiro > Fechamento. Calendário do mês, no desenho do Vela. */
export function CashClosePage() {
  const { show } = useToast();
  const { session, storeRows, loading: storesLoading } = useScopedStores();
  const manyStores = storeRows.length > 1;
  const showStores = useMinSkeleton(storesLoading);
  const today = calendarTodayIso();
  const [rangeFrom, setRangeFrom] = useState(() => startOfMonth(today));
  const [rangeTo, setRangeTo] = useState(() => endOfMonth(today));
  const [presetId, setPresetId] = useState<DatePresetId | null>("thisMonth");
  const [floor, setFloor] = useState(() => startOfMonth(today));
  const [marks, setMarks] = useState<CashCloseDayMark[]>([]);
  const [marksKey, setMarksKey] = useState("");
  const [reviews, setReviews] = useState<CashCloseReview[]>([]);
  const [sellersByStore, setSellersByStore] = useState<Map<string, StoreSeller[]>>(new Map());
  const [withdrawalStaff, setWithdrawalStaff] = useState<WithdrawalPerson[]>([]);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [days, setDays] = useState<Record<string, CashCloseSnapshot>>({});
  const [dayKey, setDayKey] = useState("");
  const [error, setError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [watermark, setWatermark] = useState<Date | null | undefined>(undefined);
  const [soldToday, setSoldToday] = useState<{ cents: number; byStore: Record<string, number> } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const storeKey = storeRows.map((l) => l.id).join(",");
  const storesRef = useRef(storeRows);
  storesRef.current = storeRows;
  const rangeFromRef = useRef(rangeFrom);
  rangeFromRef.current = rangeFrom;
  const rangeToRef = useRef(rangeTo);
  rangeToRef.current = rangeTo;
  const cells = useMemo(() => rangeCells(rangeFrom, rangeTo), [rangeFrom, rangeTo]);
  const from = rangeFrom;
  const toGross = rangeTo;
  const to = toGross < today ? toGross : today;
  const bandKey = `${storeKey}|${from}|${to}|${reloadKey}`;

  const sessionStores = useMemo(() => storesForSession(session.stores), [session.stores]);
  const sellerStoresKey = useMemo(() => sessionStores.map((store) => store.id).join(","), [sessionStores]);
  const branches = useMemo(() => {
    const map = new Map<string, { branchCode: string; millenniumBranch: number }>();
    for (const store of sessionStores) map.set(store.id, { branchCode: store.branchCode, millenniumBranch: store.millenniumBranch });
    return map;
  }, [sessionStores]);
  useEffect(() => {
    if (storesLoading || !sellerStoresKey) return;
    let stop = false;
    void fetchStoreSellers(session.tenantId, sellerStoresKey.split(",")).then((map) => {
      if (!stop) setSellersByStore(map);
    });
    return () => {
      stop = true;
    };
  }, [storesLoading, session.tenantId, sellerStoresKey]);
  useEffect(() => {
    if (storesLoading) return;
    let stop = false;
    void fetchWithdrawalStaff(session.tenantId).then((people) => {
      if (!stop) setWithdrawalStaff(people);
    });
    return () => {
      stop = true;
    };
  }, [storesLoading, session.tenantId]);
  useEffect(() => {
    if (storesLoading || !storeKey) return;
    let stop = false;
    const ids = storeKey.split(",");
    void Promise.all([
      Promise.all(ids.map((id) => fetchNavMonthFloor("cash_close_day", session.tenantId, id, today))),
      fetchGoals({
        tenantId: session.tenantId,
        storeIds: ids,
        from: addMonths(today, -36),
        to: endOfMonth(today),
        includeDrafts: true,
      }),
    ]).then(([months, goals]) => {
      if (stop || months.length === 0) return;
      const dataFloor = months.reduce((earliest, item) => (item < earliest ? item : earliest));
      const month = laterMonth(dataFloor, goalMonthFloor(today, goals));
      setFloor(month);
      setRangeFrom((current) => {
        if (current >= month) return current;
        setPresetId(null);
        return month;
      });
    });
    return () => {
      stop = true;
    };
  }, [storesLoading, storeKey, session.tenantId, today, reloadKey]);

  useEffect(() => {
    if (!syncing) return;
    let stop = false;
    let checks = 0;
    const tick = async () => {
      checks += 1;
      const open = await fetchOpenCashCloseJob(session.tenantId, "close");
      if (stop || open || checks < 2) return;
      const message = await fetchLatestCashCloseError(session.tenantId, "close");
      if (stop) return;
      setSyncing(false);
      setReloadKey((n) => n + 1);
      if (message) show(message, "danger");
    };
    void tick();
    const id = window.setInterval(() => void tick(), 3000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [syncing, session.tenantId, show]);

  useEffect(() => {
    let stop = false;
    void fetchSyncWatermark(session.tenantId)
      .catch(() => null)
      .then((wm) => {
        if (!stop) setWatermark(wm);
      });
    return () => {
      stop = true;
    };
  }, [session.tenantId, reloadKey]);

  const requestClosing = useCallback(async () => {
    const ids = storesRef.current.map((store) => store.id);
    if (ids.length === 0) return;
    const months = monthsTouched(rangeFromRef.current, rangeToRef.current);
    const todayIso = calendarTodayIso();
    const withDay = months.filter((month) => monthCloseSpanFor(month, todayIso));
    const targets = withDay.length > 0 ? withDay : [months[0]];
    for (const month of targets) {
      const r = await requestMonthClose(ids, month);
      if (!r.ok) {
        show(r.message, "danger");
        return;
      }
    }
    setSyncing(true);
  }, [show]);

  useScreenRefresh({
    label: "Atualizar vendas e fechamento",
    tip: "Busca as vendas de hoje e relê o fechamento de cada dia do mês.",
    status: refreshMomentTitle(watermark ? watermark.toISOString() : watermark),
    busyLabel: "Atualizando…",
    sales: true,
    run: () => requestClosing(),
  });

  useEffect(() => {
    const onSynced = () => setReloadKey((n) => n + 1);
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, []);

  useEffect(() => {
    if (storesLoading || storeRows.length === 0 || from > to) return;
    let cancelled = false;
    setError(false);
    const ids = storeRows.map((l) => l.id);
    void Promise.all([
      fetchCashCloseMonthMarks(session.tenantId, ids, from, to),
      fetchCashCloseReviews(session.tenantId, ids, from, to),
    ])
      .then(([rows, ajustes]) => {
        if (cancelled) return;
        setMarks(rows);
        setReviews(ajustes);
        setMarksKey(bandKey);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [storesLoading, session.tenantId, storeRows, from, to, bandKey]);

  useEffect(() => {
    if (storesLoading || storeRows.length === 0 || to < today) {
      setSoldToday(null);
      return;
    }
    let stop = false;
    void fetchSalesDayAggs({
      tenantId: session.tenantId,
      storeIds: storeRows.map((store) => store.id),
      from: today,
      to: today,
      brand: null,
    })
      .then((rows) => {
        if (stop) return;
        const all = rows.filter((row) => row.brand === "ALL");
        const used = all.length > 0 ? all : rows.filter((row) => row.brand !== "ALL");
        const byStore: Record<string, number> = {};
        let cents = 0;
        for (const row of used) {
          byStore[row.storeId] = (byStore[row.storeId] ?? 0) + row.revenueCents;
          cents += row.revenueCents;
        }
        setSoldToday({ cents, byStore });
      })
      .catch(() => {
        if (!stop) setSoldToday({ cents: 0, byStore: {} });
      });
    return () => {
      stop = true;
    };
  }, [storesLoading, storeRows, session.tenantId, today, to, reloadKey]);

  useEffect(() => {
    if (storesLoading || !dayOpen || storeRows.length === 0 || dayOpen > today) return;
    let cancelled = false;
    setError(false);
    const key = `${storeKey}|${dayOpen}|${reloadKey}`;
    void Promise.all(storeRows.map((store) => fetchCashCloseSnapshot(session.tenantId, store.id, dayOpen).then((snap) => [store.id, snap] as const)))
      .then((rows) => {
        if (cancelled || !dayOpen) return;
        setDays(Object.fromEntries(rows));
        setDayKey(key);
        setMarks((current) => {
          const next = current.map((mark) => ({ ...mark }));
          for (const [storeId, snap] of rows) {
            const i = next.findIndex((mark) => mark.storeId === storeId && mark.day.slice(0, 10) === dayOpen);
            const mark = { storeId, day: dayOpen, snap, cardPending: snap.cardPending };
            if (i >= 0) next[i] = mark;
            else next.push(mark);
          }
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [storesLoading, dayOpen, session.tenantId, storeRows, today, storeKey, reloadKey]);

  const analysis = useMemo(() => {
    if (marksKey !== bandKey) return null;
    const byDay = new Map<string, DayBucket>();
    const rows: Array<{ day: string; systemCents: number; realCents: number; diffCents: number; pending: boolean }> = [];
    for (const mark of marks) {
      const day = mark.day.slice(0, 10);
      const review = reviews.find((r) => r.storeId === mark.storeId && r.day.slice(0, 10) === day) ?? null;
      const view = buildCashCloseView(mark.snap);
      const lines = applyCloseReview(view.lines, review, {
        cardPending: mark.cardPending,
        pixRequested: mark.snap.pixRequested,
      });
      const gap = closeDayGap(lines);
      const withoutReal = dayWithoutReal(lines);
      const retirada = (review?.withdrawals ?? []).reduce((sum, row) => sum + row.cents, 0);
      const diffCents = gap.diffCents;
      if (day < today) {
        rows.push({
          day,
          systemCents: gap.comparedSystemCents,
          realCents: gap.realCents,
          diffCents,
          pending: withoutReal,
        });
      }
      const current = byDay.get(day) ?? emptyDayBucket();
      current.systemCents += gap.systemCents;
      current.realCents += gap.realCents;
      current.diffCents += diffCents;
      current.withdrawalCents += retirada;
      current.hasMillennium = current.hasMillennium || mark.snap.millennium.length > 0;
      current.hasLines = current.hasLines || lines.length > 0;
      current.pending = current.pending || withoutReal;
      const hasBody = lines.some((line) => line.systemCents !== 0 || line.typedCents !== 0 || line.stoneCents != null || (line.manualPixCents ?? 0) !== 0 || (line.withdrawalCents ?? 0) !== 0);
      if (day < today && withoutReal) current.pendingStores += 1;
      if (day < today && !withoutReal && hasBody) {
        current.closedStores += 1;
        current.closedRealCents += gap.realCents;
        if (diffCents > 0) current.surplusStores += 1;
        else if (diffCents < 0) current.shortageStores += 1;
        if (diffCents !== 0) current.diffStores += 1;
      }
      byDay.set(day, current);
    }
    let diffDays = 0;
    let closedRealCents = 0;
    for (const [day, info] of byDay) {
      if (day >= today) continue;
      closedRealCents += info.closedRealCents;
      if (info.diffStores > 0) diffDays += 1;
    }
    return { summary: monthCloseSummary(rows), byDay, diffDays, closedRealCents };
  }, [marks, reviews, marksKey, bandKey, today]);

  function dayFace(day: string): CalendarFace {
    const info = analysis?.byDay.get(day);
    const counts = {
      diffStores: info?.diffStores ?? 0,
      surplusStores: info?.surplusStores ?? 0,
      shortageStores: info?.shortageStores ?? 0,
      pendingStores: info?.pendingStores ?? 0,
      closedStores: info?.closedStores ?? 0,
    };
    if (day === today) return { kind: "today", totalCents: soldToday?.cents ?? 0, diffCents: 0, withdrawalCents: 0, awaiting: soldToday == null, ...counts };
    if (!info || (info.systemCents === 0 && info.realCents === 0 && !info.pending)) return { kind: "zero", totalCents: 0, diffCents: 0, withdrawalCents: 0, ...counts };
    if (!info.hasMillennium && !info.hasLines && !info.pending) return { kind: "empty", totalCents: 0, diffCents: 0, withdrawalCents: 0, ...counts };
    if (manyStores) {
      if (info.pending && info.closedRealCents === 0) return { kind: "pending", totalCents: info.systemCents, diffCents: 0, withdrawalCents: 0, ...counts };
      return { kind: "total", totalCents: info.realCents, diffCents: 0, withdrawalCents: info.withdrawalCents, ...counts };
    }
    if (info.pending) return { kind: "pending", totalCents: info.systemCents, diffCents: 0, withdrawalCents: 0, ...counts };
    return { kind: "total", totalCents: info.realCents, diffCents: info.diffCents, withdrawalCents: info.withdrawalCents, ...counts };
  }

  function openDay(iso: string) {
    if (iso > today) return;
    if (iso < today && dayFace(iso).kind === "zero") return;
    setDayOpen(iso);
  }

  function applyInterval(start: Date, end: Date, goal?: DateRangeChangeMeta) {
    setRangeFrom(dateToIso(start));
    setRangeTo(dateToIso(end));
    setPresetId(goal?.presetId ?? null);
  }

  const dayPronto = dayOpen != null && dayKey === `${storeKey}|${dayOpen}|${reloadKey}`;

  return (
    <div>
      <SectionHeader
        section="Financeiro"
        title="Fechamento"
        subtitle="Compare o Millennium com o total real e acompanhe diferenças e pendências."
        actions={
          <HeaderFilters>
            <DateRangePicker
              value={[isoToDate(rangeFrom), isoToDate(rangeTo)]}
              minDate={isoToDate(floor)}
              maxDate={isoToDate(endOfMonth(today))}
              quickRanges={CALENDAR_QUICK_RANGES}
              displayLabel={presetId ? periodLabels[presetId] : null}
              activePresetId={presetId}
              onChange={([start, end], goal) => applyInterval(start, end, goal)}
            />
          </HeaderFilters>
        }
      />
      <div className="mt-6 pb-6">
        {error ? <Alert className="mb-4" variant="danger" title="Não foi possível carregar o fechamento. Tente novamente." /> : null}
        {showStores ? (
          <FinanceMonthSkeleton cells={cells} today={today} />
        ) : storeRows.length === 0 ? (
          <Card>
            <EmptyBlock icon="📒" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : analysis ? (
          <>
            <MonthSummary summary={analysis.summary} many={manyStores} diffDays={analysis.diffDays} closedRealCents={analysis.closedRealCents} />
            <Month today={today} cells={cells} dayFace={dayFace} onOpen={openDay} many={manyStores} />
          </>
        ) : (
          <FinanceMonthSkeleton cells={cells} today={today} />
        )}
      </div>
      <DayModal
        day={dayOpen}
        storeRows={storeRows}
        snaps={days}
        reviews={reviews}
        pronto={dayPronto}
        gestor={isOwner(session.role)}
        closed={dayOpen != null && dayOpen < today}
        tenantId={session.tenantId}
        soldByStore={soldToday?.byStore ?? null}
        sellersByStore={sellersByStore}
        branches={branches}
        withdrawalStaff={withdrawalStaff}
        onClose={() => setDayOpen(null)}
        onSaved={(next) => {
          setReviews((current) => {
            const without = current.filter((r) => !(r.storeId === next.storeId && r.day === next.day));
            return [...without, next];
          });
        }}
      />
    </div>
  );
}

type DayBucket = {
  systemCents: number;
  realCents: number;
  diffCents: number;
  withdrawalCents: number;
  hasMillennium: boolean;
  hasLines: boolean;
  pending: boolean;
  diffStores: number;
  surplusStores: number;
  shortageStores: number;
  pendingStores: number;
  closedStores: number;
  closedRealCents: number;
};

function emptyDayBucket(): DayBucket {
  return {
    systemCents: 0,
    realCents: 0,
    diffCents: 0,
    withdrawalCents: 0,
    hasMillennium: false,
    hasLines: false,
    pending: false,
    diffStores: 0,
    surplusStores: 0,
    shortageStores: 0,
    pendingStores: 0,
    closedStores: 0,
    closedRealCents: 0,
  };
}

type CalendarFace = {
  kind: "empty" | "zero" | "pending" | "today" | "total";
  totalCents: number;
  diffCents: number;
  withdrawalCents: number;
  awaiting?: boolean;
  diffStores: number;
  surplusStores: number;
  shortageStores: number;
  pendingStores: number;
  closedStores: number;
};

function filialAttention(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 filial ${singular}` : `${count} filiais ${plural}`;
}

function differenceHint(summary: MonthCloseSummary): string {
  const base = "Diferença acumulada entre o total real e o Millennium nos dias já fechados.";
  if (summary.surplusCents === 0 && summary.shortageCents === 0) return base;
  return `${base}\nSobras: ${brlCent(summary.surplusCents / 100)} · Quebras: ${brlCent(summary.shortageCents / 100)}`;
}

function differenceColor(cents: number): string {
  if (cents > 0) return "var(--ok)";
  if (cents < 0) return "var(--bad)";
  return "var(--t0)";
}

export function PlainKpi({ label, value, color, tooltip }: { label: string; value: string; color: string; tooltip?: string }) {
  return (
    <Card>
      <p className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-t2">
        {label}
        {tooltip ? (
          <Tooltip label={tooltip} side="bottom">
            <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold normal-case tracking-normal text-t2 transition-colors hover:text-t1">?</span>
          </Tooltip>
        ) : null}
      </p>
      <p className="mt-1.5 truncate font-mono text-[22px] font-extrabold" style={{ color }}>{value}</p>
    </Card>
  );
}

function MonthSummary({
  summary,
  many,
  diffDays,
  closedRealCents,
}: {
  summary: MonthCloseSummary;
  many: boolean;
  diffDays: number;
  closedRealCents: number;
}) {
  const cards = many
    ? [
        { label: "Total real", value: brlCent(closedRealCents / 100), color: "var(--t0)" },
        { label: "Dias com diferença", value: String(diffDays), color: "var(--t0)", tooltip: "Dias em que alguma filial fechou com sobra ou quebra." },
        { label: "Dias pendentes", value: String(summary.pendingDays), color: "var(--t0)" },
      ]
    : [
        { label: "Total real", value: brlCent(summary.realCents / 100), color: "var(--t0)" },
        { label: "Diferença", value: dayTotal(summary.diffCents), color: differenceColor(summary.diffCents), tooltip: differenceHint(summary) },
        { label: "Dias pendentes", value: String(summary.pendingDays), color: "var(--t0)" },
      ];
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      {cards.map((card) => (
        <PlainKpi key={card.label} label={card.label} value={card.value} color={card.color} tooltip={"tooltip" in card ? card.tooltip : undefined} />
      ))}
    </div>
  );
}

function MetricSkeleton({ cols }: { cols: string }) {
  return (
    <div className={cn("mb-4 grid grid-cols-1 gap-2", cols)}>
      {Array.from({ length: cols.includes("grid-cols-3") ? 3 : 1 }, (_, index) => (
        <div key={index} className="min-w-0 rounded-[14px] border border-line bg-bg-1 px-3 py-3">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="mt-1 h-7 w-24" />
        </div>
      ))}
    </div>
  );
}

function CloseTableSkeleton() {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-vela-lg)] border border-line bg-bg-2">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            <th className="px-3 py-3 text-left">
              <Skeleton className="h-2.5 w-12" />
            </th>
            {Array.from({ length: 3 }, (_, index) => (
              <th key={index} className="px-3 py-3 text-right">
                <Skeleton className="ml-auto h-2.5 w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 4 }, (_, row) => (
            <tr key={row} className="border-b border-line last:border-b-0">
              <td className="px-3 py-3">
                <Skeleton className="h-3.5 w-20" />
              </td>
              {Array.from({ length: 3 }, (_, cell) => (
                <td key={cell} className="px-3 py-3 text-right">
                  <Skeleton className="ml-auto h-3.5 w-16" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-bg-1">
            <td className="px-3 py-3">
              <Skeleton className="h-3 w-12" />
            </td>
            {Array.from({ length: 3 }, (_, cell) => (
              <td key={cell} className="px-3 py-3 text-right">
                <Skeleton className="ml-auto h-3.5 w-16" />
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Dia em aberto: um número. Dia fechado: três números e a tabela de formas. */
function DayLoadingSkeleton({ closed, stores }: { closed: boolean; stores: number }) {
  const blocks = Math.max(1, stores);
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: blocks }, (_, index) => (
        <section key={index} className={blocks > 1 ? "border-t border-line pb-6 pt-5 first:border-t-0 first:pt-0 last:pb-0" : undefined}>
          {blocks > 1 ? <Skeleton className="mb-2 h-3.5 w-40" /> : null}
          {closed ? (
            <>
              <MetricSkeleton cols="sm:grid-cols-3" />
              <CloseTableSkeleton />
            </>
          ) : (
            <>
              <MetricSkeleton cols="" />
              <Skeleton className="h-3.5 w-full max-w-md" />
            </>
          )}
        </section>
      ))}
    </div>
  );
}

function DayTotals({ systemCents, realCents, diffCents }: { systemCents: number; realCents: number; diffCents: number }) {
  const items = [
    { label: "Millennium", value: money(systemCents), tone: "text-t0" },
    { label: "Total real", value: money(realCents), tone: "text-t0" },
    { label: "Diferença", value: dayTotal(diffCents), tone: diffClass(diffCents) },
  ];
  return (
    <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-[14px] border border-line bg-bg-1 px-3 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-t2">{item.label}</p>
          <p className={cn("mt-1 truncate font-mono text-lg font-extrabold", item.tone)}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export function DayChip({ color, children }: { color: string; children: string }) {
  return (
    <div title={children} className={cn("mt-1 w-full self-stretch truncate rounded-md px-1.5 py-1 text-[10px] font-semibold text-white sm:text-[11px]", color)}>
      {children}
    </div>
  );
}

function differenceChip(cents: number): { color: string; text: string } {
  if (cents > 0) return { color: "bg-ok", text: `Sobra ${brlCent(cents / 100)}` };
  if (cents < 0) return { color: "bg-bad", text: `Quebra ${brlCent(Math.abs(cents) / 100)}` };
  return { color: "bg-chip-gray", text: "Sem diferença" };
}

function dayHint(face: CalendarFace, many: boolean): string | undefined {
  if (many) {
    const partes: string[] = [];
    if (face.closedStores > 0 && face.pendingStores > 0) partes.push(filialAttention(face.closedStores, "fechada", "fechadas"));
    if (face.pendingStores > 0) partes.push(filialAttention(face.pendingStores, "pendente", "pendentes"));
    if (face.surplusStores > 0) partes.push(filialAttention(face.surplusStores, "com sobra", "com sobra"));
    if (face.shortageStores > 0) partes.push(filialAttention(face.shortageStores, "com quebra", "com quebra"));
    if (face.withdrawalCents > 0) partes.push(`Retirada ${brlCent(face.withdrawalCents / 100)}`);
    return partes.length > 0 ? partes.join(" · ") : undefined;
  }
  if (face.kind !== "total") return undefined;
  const partes: string[] = [];
  if (face.diffCents !== 0) partes.push(differenceChip(face.diffCents).text);
  if (face.withdrawalCents > 0) partes.push(`Retirada ${brlCent(face.withdrawalCents / 100)}`);
  return partes.length > 0 ? partes.join(" · ") : undefined;
}

function Month({
  today,
  cells,
  dayFace,
  onOpen,
  many,
}: {
  today: string;
  cells: Array<string | null>;
  dayFace: (day: string) => CalendarFace;
  onOpen: (iso: string) => void;
  many: boolean;
}) {
  return (
    <MonthCalendar>
      {cells.map((day, i) => {
        if (!day) return <div key={`vazio-${i}`} className={blankDayClass(i)} />;
        const face = day <= today ? dayFace(day) : null;
        const showsTotal = face?.kind === "pending" || face?.kind === "total" || (face?.kind === "today" && !face.awaiting);
        const hint = face ? dayHint(face, many) : undefined;
        const open = Boolean(face && face.kind !== "zero" && face.kind !== "empty");
        return (
          <DayFace
            key={day}
            index={i}
            iso={day}
            today={today}
            openable={open}
            openLabel={`Abrir ${dayTitle(day)}`}
            title={hint}
            onOpen={() => onOpen(day)}
            amount={showsTotal && face ? brlCent(face.totalCents / 100) : null}
            badges={
              face?.kind === "today" || face?.kind === "pending" || face?.kind === "total" ? (
                many ? (
                  <>
                    {face.closedStores > 0 && face.pendingStores > 0 && (
                      <DayChip color="bg-ok">{filialAttention(face.closedStores, "fechada", "fechadas")}</DayChip>
                    )}
                    {face.pendingStores > 0 && <DayChip color="bg-warn">{filialAttention(face.pendingStores, "pendente", "pendentes")}</DayChip>}
                    {face.kind === "today" && <DayChip color="bg-acc">Em aberto</DayChip>}
                    {face.kind === "total" && face.surplusStores > 0 && (
                      <DayChip color="bg-ok">{filialAttention(face.surplusStores, "com diferença", "com diferença")}</DayChip>
                    )}
                    {face.kind === "total" && face.shortageStores > 0 && (
                      <DayChip color="bg-bad">{filialAttention(face.shortageStores, "com diferença", "com diferença")}</DayChip>
                    )}
                    {face.kind === "total" && face.withdrawalCents > 0 && (
                      <DayChip color="bg-info">{`Retirada ${brlCent(face.withdrawalCents / 100)}`}</DayChip>
                    )}
                  </>
                ) : (
                  <>
                    {face.kind === "pending" && <DayChip color="bg-warn">{`Pendente ${brlCent(face.totalCents / 100)}`}</DayChip>}
                    {face.kind === "today" && <DayChip color="bg-acc">Em aberto</DayChip>}
                    {face.kind === "total" && (face.diffCents !== 0 || face.withdrawalCents === 0) && (
                      <DayChip color={differenceChip(face.diffCents).color}>{differenceChip(face.diffCents).text}</DayChip>
                    )}
                    {face.kind === "total" && face.withdrawalCents > 0 && (
                      <DayChip color="bg-info">{`Retirada ${brlCent(face.withdrawalCents / 100)}`}</DayChip>
                    )}
                  </>
                )
              ) : null
            }
          />
        );
      })}
    </MonthCalendar>
  );
}

function withdrawalChoices(
  sellersByStore: Map<string, StoreSeller[]>,
  branches: Map<string, { branchCode: string; millenniumBranch: number }>,
  staff: WithdrawalPerson[],
  storeId: string,
  savedIds: string[],
) {
  const saved = new Set(savedIds);
  return mergeWithdrawalPeople(
    [
      ...[...sellersByStore.entries()].map(([id, sellers]) => {
        const branch = branches.get(id);
        return {
          storeId: id,
          people: sellers
            .filter((seller) => saved.has(seller.id) || !branch || !isBranchUser(seller.code, branch))
            .map((seller) => ({ id: seller.id, name: seller.name, active: seller.active })),
        };
      }),
      { storeId: "", people: staff },
    ],
    savedIds,
    storeId,
  );
}

function DayModal({
  day,
  storeRows,
  snaps,
  reviews,
  pronto,
  gestor,
  closed,
  tenantId,
  soldByStore,
  sellersByStore,
  branches,
  withdrawalStaff,
  onClose,
  onSaved,
}: {
  day: string | null;
  storeRows: Store[];
  snaps: Record<string, CashCloseSnapshot>;
  reviews: CashCloseReview[];
  pronto: boolean;
  gestor: boolean;
  closed: boolean;
  tenantId: string;
  soldByStore: Record<string, number> | null;
  sellersByStore: Map<string, StoreSeller[]>;
  branches: Map<string, { branchCode: string; millenniumBranch: number }>;
  withdrawalStaff: WithdrawalPerson[];
  onClose: () => void;
  onSaved: (review: CashCloseReview) => void;
}) {
  const { show } = useToast();
  const [drafts, setDrafts] = useState<Record<string, CloseDraft>>({});
  function canEditStore(storeId: string) {
    if (!day) return false;
    if (gestor) return true;
    return !reviews.some((item) => item.storeId === storeId && item.day.slice(0, 10) === day);
  }
  const [withdrawalDrafts, setWithdrawalDrafts] = useState<Record<string, WithdrawalDraft>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!day || !pronto) return;
    const next: Record<string, CloseDraft> = {};
    const nextWithdrawals: Record<string, WithdrawalDraft> = {};
    for (const store of storeRows) {
      const snap = snaps[store.id];
      if (!snap) continue;
      const review = reviews.find((r) => r.storeId === store.id && r.day === day) ?? null;
      const typed: CloseDraft["typed"] = {};
      const acquirer: CloseDraft["acquirer"] = {};
      for (const line of applyCloseReview(buildCashCloseView(snap).lines, review, {
        cardPending: snap.cardPending,
        pixRequested: snap.pixRequested,
      })) {
        const saved = review?.typedCents[line.key] ?? (line.key === "cash" ? review?.cashTypedCents : null);
        typed[line.key] = centsToField(saved ?? line.typedCents);
        const manual = review?.acquirerCents[line.key];
        const shown = manual ?? line.stoneCents;
        acquirer[line.key] = shown == null ? "" : centsToField(shown);
      }
      next[store.id] = { typed, acquirer, onlinePix: onlinePixDraftFrom(review?.onlinePix ?? [], centsToField) };
      nextWithdrawals[store.id] = withdrawalDraftFrom(review?.withdrawals ?? [], centsToField);
    }
    setDrafts(next);
    setWithdrawalDrafts(nextWithdrawals);
  }, [day, pronto, storeRows, snaps, reviews]);

  const withDados = day
    ? storeRows.filter((store) => {
        const snap = snaps[store.id];
        if (!snap) return false;
        const review = reviews.find((r) => r.storeId === store.id && r.day.slice(0, 10) === day) ?? null;
        return applyCloseReview(buildCashCloseView(snap).lines, review, {
          cardPending: snap.cardPending,
          pixRequested: snap.pixRequested,
        }).some((line) => line.systemCents !== 0 || line.typedCents !== 0 || line.stoneCents != null || (line.manualPixCents ?? 0) !== 0 || (line.withdrawalCents ?? 0) !== 0);
      })
    : [];

  const dayPending =
    closed &&
    pronto &&
    (withDados.length === 0 ||
      withDados.some((store) => {
        const snap = snaps[store.id];
        if (!snap || !day) return true;
        const review = reviews.find((r) => r.storeId === store.id && r.day === day) ?? null;
        const lines = applyCloseReview(buildCashCloseView(snap).lines, review, {
          cardPending: snap.cardPending,
          pixRequested: snap.pixRequested,
        });
        return dayWithoutReal(lines);
      }));

  async function save() {
    if (!day) return;
    setBusy(true);
    for (const store of withDados) {
      if (!canEditStore(store.id)) continue;
      const snap = snaps[store.id];
      const draft = drafts[store.id];
      if (!snap || !draft) continue;
      const lines = buildCashCloseView(snap).lines;
      const typedCents: CashCloseReview["typedCents"] = {};
      const acquirerCents: CashCloseReview["acquirerCents"] = {};
      const onlineSaved = onlinePixSave({ rows: draft.onlinePix ?? [], parseCents: fieldToCents });
      if (!onlineSaved.ok) {
        setBusy(false);
        show(onlineSaved.message, "danger");
        return;
      }
      const onlineCents = onlinePixTotal(onlineSaved.lines);
      let invalid = false;
      for (const line of lines) {
        const typedRaw = draft.typed[line.key] ?? "";
        const typed = fieldToCents(typedRaw);
        if (typedRaw.trim() && typed == null) {
          invalid = true;
          show(`O valor digitado para ${line.label} não é válido.`, "danger");
          break;
        }
        if (typed != null && typed !== line.typedCents) typedCents[line.key] = typed;
        if (line.key === "cash") continue;
        const raw = draft.acquirer[line.key] ?? "";
        const real = fieldToCents(raw);
        if (raw.trim() && real == null) {
          invalid = true;
          show(`O total real para ${line.label} não é válido.`, "danger");
          break;
        }
        if (line.key === "pix") {
          const decided = pixAcquirerCents(line.stoneCents, real, raw.trim() === "", onlineCents);
          if (decided != null && decided !== line.stoneCents) acquirerCents.pix = decided;
          continue;
        }
        if (real != null && real !== line.stoneCents && !(line.stoneCents == null && real === 0)) acquirerCents[line.key] = real;
      }
      if (!invalid && !lines.some((line) => line.key === "pix")) {
        const raw = draft.acquirer.pix ?? "";
        const real = fieldToCents(raw);
        if (raw.trim() && real == null) {
          invalid = true;
          show("O total real para Pix não é válido.", "danger");
        } else {
          const decided = pixAcquirerCents(null, real, raw.trim() === "", onlineCents);
          if (decided != null) acquirerCents.pix = decided;
        }
      }
      if (invalid) {
        setBusy(false);
        return;
      }
      const review = reviews.find((item) => item.storeId === store.id && item.day === day);
      const people = withdrawalChoices(
        sellersByStore,
        branches,
        withdrawalStaff,
        store.id,
        (withdrawalDrafts[store.id]?.rows ?? []).map((row) => row.sellerId),
      );
      const retiro = withdrawalSave({
        shortageCents: dayShortageCents(closeDayGap(linesWithDraft(lines, draft)).diffCents),
        enabled: withdrawalDrafts[store.id]?.enabled ?? false,
        rows: withdrawalDrafts[store.id]?.rows ?? [],
        parseCents: fieldToCents,
        names: people.names,
      });
      if (!retiro.ok) {
        setBusy(false);
        show(retiro.message, "danger");
        return;
      }
      const saved: CashCloseReview = {
        storeId: store.id,
        day,
        cashTypedCents: typedCents.cash ?? null,
        justification: review?.justification ?? "",
        waive: review?.waive ?? false,
        typedCents,
        acquirerCents,
        shortageScope: review?.shortageScope ?? "",
        shortageSellers: review?.shortageSellers ?? [],
        shortageGroup: review?.shortageGroup ?? "",
        withdrawals: retiro.lines,
        onlinePix: onlineSaved.lines,
      };
      const r = await saveCashCloseReview({ tenantId, ...saved });
      if (!r.ok) {
        setBusy(false);
        show(r.message, "danger");
        return;
      }
      onSaved(saved);
    }
    setBusy(false);
    show("Fechamento atualizado.", "success");
    onClose();
  }

  return (
    <Modal
      open={day != null}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={
        day ? (
          <>
            <span>{dayTitle(day)}</span>
            {(!closed || pronto) && (
              <Badge variant={statusBadgeVariant(!closed ? "Em aberto" : dayPending ? "Pendente" : "Fechado")}>
                {!closed ? "Em aberto" : dayPending ? "Pendente" : "Fechado"}
              </Badge>
            )}
          </>
        ) : (
          ""
        )
      }
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {withDados.some((store) => canEditStore(store.id)) ? "Cancelar" : "Voltar"}
          </Button>
          {closed && withDados.some((store) => canEditStore(store.id)) && (
            <Button onClick={() => void save()} disabled={busy || !pronto}>
              {busy ? "Salvando…" : "Salvar"}
            </Button>
          )}
        </>
      }
    >
      {!pronto ? (
        <DayLoadingSkeleton closed={closed} stores={closed ? 1 : storeRows.length} />
      ) : !closed ? (
        <div className="flex flex-col">
          {storeRows.map((store) => {
            const cents = soldByStore && store.id in soldByStore ? soldByStore[store.id] : null;
            return (
              <div key={store.id} className={storeRows.length > 1 ? "border-t border-line pb-6 pt-5 first:border-t-0 first:pt-0 last:pb-0" : undefined}>
                {storeRows.length > 1 ? <StoreDivisionTitle className="mb-2">{store.tradeName}</StoreDivisionTitle> : null}
                <DayMetrics items={[{ label: "Vendido hoje", value: cents == null ? "—" : brlCent(cents / 100) }]} />
                <p className="text-[13px] leading-relaxed text-t2">Este dia ainda está em aberto. A diferença será calculada após o fechamento.</p>
              </div>
            );
          })}
        </div>
      ) : withDados.length === 0 ? (
        <p className="text-[13.5px] leading-relaxed text-t1">Ainda não há fechamento neste dia.</p>
      ) : (
        <div className="flex flex-col">
          {withDados.map((store) => {
            const snap = snaps[store.id];
            if (!snap) return null;
            const review = reviews.find((item) => item.storeId === store.id && item.day.slice(0, 10) === day) ?? null;
            const view = buildCashCloseView(snap);
            const base = applyCloseReview(view.lines, review, { cardPending: snap.cardPending, pixRequested: snap.pixRequested });
            const cash = base.find((l) => l.key === "cash");
            const draft = drafts[store.id];
            const retirada = (withdrawalDrafts[store.id]?.enabled ? withdrawalDrafts[store.id]?.rows ?? [] : []).reduce((sum, row) => {
              const cents = fieldToCents(row.amount);
              return cents != null && cents > 0 ? sum + cents : sum;
            }, 0);
            const lines = withCashWithdrawal(linesWithDraft(base, draft), retirada);
            const conta = closeDayGap(lines);
            const people = withdrawalChoices(
              sellersByStore,
              branches,
              withdrawalStaff,
              store.id,
              (withdrawalDrafts[store.id]?.rows ?? []).map((row) => row.sellerId),
            );
            return (
              <section key={store.id} className={withDados.length > 1 ? "border-t border-line pb-6 pt-5 first:border-t-0 first:pt-0 last:pb-0" : undefined}>
                {storeRows.length > 1 && <StoreDivisionTitle className="mb-3">{store.tradeName}</StoreDivisionTitle>}
                {!dayWithoutReal(lines) ? (
                  <DayTotals systemCents={conta.comparedSystemCents} realCents={conta.realCents} diffCents={conta.diffCents} />
                ) : (
                  <p className="mb-4 text-[13px] text-t2">Falta o total real de alguma forma. A diferença aparece quando ele for informado.</p>
                )}
                {cash?.openingCents != null && (
                  <p className="mb-3 text-[12px] text-t2">
                    Fundo de caixa {brlCent(cash.openingCents / 100)}
                    {cash.cashDropCents != null ? ` · Sangria ${brlCent(Math.abs(cash.cashDropCents) / 100)}` : ""}
                  </p>
                )}
                <CloseTable
                  lines={lines}
                  pixPending={view.pixPending}
                  owner={canEditStore(store.id)}
                  closed={closed}
                  draft={draft}
                  pixOnline={(draft?.onlinePix.length ?? 0) > 0}
                  onAcquirer={(key, value) =>
                    setDrafts((current) => ({
                      ...current,
                      [store.id]: { ...(current[store.id] ?? draft!), acquirer: { ...(current[store.id]?.acquirer ?? {}), [key]: value } },
                    }))
                  }
                  onTyped={(key, value) =>
                    setDrafts((current) => ({
                      ...current,
                      [store.id]: { ...(current[store.id] ?? draft!), typed: { ...(current[store.id]?.typed ?? draft?.typed ?? {}), [key]: value } },
                    }))
                  }
                />
                {draft && (
                  <OnlinePix
                    owner={canEditStore(store.id)}
                    rows={draft.onlinePix}
                    acquirerText={draft.acquirer.pix ?? ""}
                    acquirerCents={lines.find((line) => line.key === "pix")?.stoneCents ?? null}
                    pixPending={view.pixPending}
                    onRows={(rows) =>
                      setDrafts((current) => ({
                        ...current,
                        [store.id]: { ...(current[store.id] ?? draft), onlinePix: rows },
                      }))
                    }
                    onAcquirer={(value) =>
                      setDrafts((current) => ({
                        ...current,
                        [store.id]: {
                          ...(current[store.id] ?? draft),
                          acquirer: { ...(current[store.id]?.acquirer ?? draft.acquirer), pix: value },
                        },
                      }))
                    }
                    toCents={fieldToCents}
                  />
                )}
                <EmployeeWithdrawal
                  owner={canEditStore(store.id)}
                  typedCents={lines.find((line) => line.key === "cash")?.typedCents ?? 0}
                  people={people.people}
                  names={people.names}
                  canonicalId={people.canonicalId}
                  draft={withdrawalDrafts[store.id] ?? { enabled: false, rows: [] }}
                  onChange={(next) => setWithdrawalDrafts((current) => ({ ...current, [store.id]: next }))}
                  toCents={fieldToCents}
                />
              </section>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
