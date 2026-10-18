import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Badge, Button, Card, DateRangePicker, Modal, Skeleton, Tooltip, useToast, CALENDAR_QUICK_RANGES, type DatePresetId, type DateRangeChangeMeta } from "@/components/ui";
import { statusBadgeVariant } from "@/lib/status";
import { DayFace, DayMetrics, MonthCalendar, blankDayClass } from "@/components/wedash/MonthCalendar";
import { EmployeeWithdrawal } from "@/pages/cash-close/EmployeeWithdrawal";
import { OnlinePix } from "@/pages/cash-close/OnlinePix";
import { monthCloseSpanFor, monthsTouched } from "@/data/wedash/cashCloseMonth";
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
import { periodLabels } from "@/data/wedash/dashboard";
import {
  dayShortageCents,
  mergeWithdrawalPeople,
  withdrawalDraftFrom,
  withdrawalSave,
  type WithdrawalDraft,
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
import { fetchStoreSellers, storesForSession, type Store, type StoreSeller } from "@/data/wedash/stores";
import { isOwner } from "@/layout/nav-wedash";
import { cn } from "@/lib/cn";
import { brlCent, longDate, isoToDate, endOfMonth, startOfMonth, dateToIso, addDays, labelUpper } from "@/lib/format";
import { refreshMomentTitle, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useScope } from "@/pages/dashboard/useScope";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { parseNum, SectionHeader, SelectStoreCard, pickOneStore, useScopedStores } from "@/pages/operation/shared";
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

const MONTHS_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function monthYearLabel(iso: string): string {
  const d = isoToDate(startOfMonth(iso));
  return `${MONTHS_PT[d.getMonth()]} de ${d.getFullYear()}`;
}

function pageEndYear(year: number, todayYear: number): number {
  const target = Math.min(year, todayYear);
  return todayYear - Math.floor((todayYear - target) / 12) * 12;
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
  pixOnline,
}: {
  lines: CashCloseLine[];
  pixPending: boolean;
  owner: boolean;
  closed: boolean;
  draft?: CloseDraft;
  onAcquirer?: (key: CashCloseBucket, value: string) => void;
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
              return (
                <tr key={row.key} className="border-b border-line">
                  <td className="px-3 py-3 text-t0">{labelUpper(row.label)}</td>
                  <td className="px-3 py-3 text-right font-mono text-[13px] font-bold text-t0">{money(row.systemCents)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {row.key === "cash" || pixLocked || !(owner && draft && onAcquirer) ? (
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

export function MonthYearPicker({
  iso,
  today,
  minIso,
  onChange,
}: {
  iso: string;
  today: string;
  /** Primeiro mês que pode ser escolhido. Antes disso o mês fica bloqueado. */
  minIso: string;
  onChange: (target: string) => void;
}) {
  const todayDateValue = isoToDate(today);
  const todayYear = todayDateValue.getFullYear();
  const todayMonth = todayDateValue.getMonth();
  const floor = isoToDate(startOfMonth(minIso));
  const floorYear = floor.getFullYear();
  const floorMonth = floor.getMonth();
  const selected = isoToDate(startOfMonth(iso));
  const [open, setOpen] = useState(false);
  const [modo, setModo] = useState<"month" | "year">("month");
  const [yearView, setYearView] = useState(selected.getFullYear());
  const [yearPage, setYearPage] = useState(todayYear);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setModo("month");
    setYearView(selected.getFullYear());
  }, [open]); // ano lido só ao abrir

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (!open || !triggerRef.current) {
      setPanelPos(null);
      return;
    }
    function colocar() {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const margin = 12;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(vw - margin * 2, 300);
      let left = rect.right - width;
      if (left < margin) left = margin;
      if (left + width > vw - margin) left = Math.max(margin, vw - margin - width);
      const top = Math.min(rect.bottom + 8, vh - margin - 80);
      setPanelPos({ top, left, width, maxHeight: Math.max(200, vh - top - margin) });
    }
    colocar();
    window.addEventListener("resize", colocar);
    window.addEventListener("scroll", colocar, true);
    return () => {
      window.removeEventListener("resize", colocar);
      window.removeEventListener("scroll", colocar, true);
    };
  }, [open]);

  const anos = Array.from({ length: 12 }, (_, i) => yearPage - 11 + i);
  const canYearPrev = modo === "year" ? anos[0] > floorYear : yearView > floorYear;
  const canYearProx = modo === "year" ? yearPage < todayYear : yearView < todayYear;
  const navBtn = (ok: boolean) =>
    cn("flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line text-t1", ok ? "hover:bg-bg-3" : "cursor-not-allowed opacity-40");

  function pickMonth(month: number) {
    const before = yearView < floorYear || (yearView === floorYear && month < floorMonth);
    const future = yearView > todayYear || (yearView === todayYear && month > todayMonth);
    if (before || future) return;
    onChange(dateToIso(new Date(yearView, month, 1)));
    setOpen(false);
  }

  const painel =
    open && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width, maxHeight: panelPos.maxHeight }}
            className="fixed z-[80] overflow-y-auto rounded-[14px] border border-line bg-bg-2 p-4 shadow-[var(--shadow-vela)]"
          >
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                disabled={!canYearPrev}
                aria-label={modo === "year" ? "Anos anteriores" : "Ano anterior"}
                className={navBtn(canYearPrev)}
                onClick={() => (modo === "year" ? setYearPage((n) => n - 12) : setYearView((n) => n - 1))}
              >
                <MonthStep dir="anterior" />
              </button>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-sm font-bold text-t0 hover:bg-bg-3"
                onClick={() => {
                  if (modo === "month") {
                    setYearPage(pageEndYear(yearView, todayYear));
                    setModo("year");
                    return;
                  }
                  setModo("month");
                }}
              >
                {modo === "month" ? yearView : `${anos[0]} – ${anos[anos.length - 1]}`}
              </button>
              <button
                type="button"
                disabled={!canYearProx}
                aria-label={modo === "year" ? "Próximos anos" : "Próximo ano"}
                className={navBtn(canYearProx)}
                onClick={() => (modo === "year" ? setYearPage((n) => Math.min(todayYear, n + 12)) : setYearView((n) => n + 1))}
              >
                <MonthStep dir="proximo" />
              </button>
            </div>
            {modo === "month" ? (
              <div className="grid grid-cols-3 gap-1">
                {MONTHS_PT.map((name, month) => {
                  const blocked =
                    yearView < floorYear ||
                    (yearView === floorYear && month < floorMonth) ||
                    yearView > todayYear ||
                    (yearView === todayYear && month > todayMonth);
                  const active = selected.getFullYear() === yearView && selected.getMonth() === month;
                  return (
                    <button
                      key={name}
                      type="button"
                      disabled={blocked}
                      onClick={() => pickMonth(month)}
                      className={cn(
                        "h-9 truncate rounded-[9px] px-1 text-[12.5px] font-semibold transition-colors",
                        blocked ? "cursor-not-allowed text-t2 opacity-30" : active ? "bg-acc text-white" : "text-t1 hover:bg-bg-3",
                      )}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {anos.map((year) => {
                  const blocked = year < floorYear || year > todayYear;
                  const active = selected.getFullYear() === year;
                  return (
                    <button
                      key={year}
                      type="button"
                      disabled={blocked}
                      onClick={() => {
                        setYearView(year);
                        setModo("month");
                      }}
                      className={cn(
                        "h-9 rounded-[9px] text-[12.5px] font-semibold transition-colors",
                        blocked ? "cursor-not-allowed text-t2 opacity-30" : active ? "bg-acc text-white" : "text-t1 hover:bg-bg-3",
                      )}
                    >
                      {year}
                    </button>
                  );
                })}
              </div>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={triggerRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={`Mês e ano: ${monthYearLabel(iso)}`}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-10 min-w-0 items-center gap-2.5 rounded-[var(--radius-vela-sm)] border bg-bg-3 px-3.5 text-left transition-colors",
          open ? "border-acc" : "border-line hover:border-acc",
        )}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={open ? "var(--acc)" : "var(--t2)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span className="truncate text-[13.5px] font-semibold text-t0">{monthYearLabel(iso)}</span>
      </button>
      {painel}
    </div>
  );
}

export const monthNavBtn =
  "flex h-10 w-10 items-center justify-center rounded-[11px] border border-line bg-bg-2 text-t1 hover:border-line-2 hover:text-t0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-t1";

export function MonthStep({ dir }: { dir: "anterior" | "proximo" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === "anterior" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

/** Financeiro > Fechamento. Calendário do mês, no desenho do Vela. */
export function CashClosePage() {
  const { show } = useToast();
  const { session, storeRows, loading: storesLoading } = useScopedStores();
  const { scope } = useScope();
  const escolher = pickOneStore(scope.storeIds, session.stores.length);
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

  const storeIdValue = storeRows[0]?.id ?? "";
  const sellerStoresKey = useMemo(() => storesForSession(session.stores).map((store) => store.id).join(","), [session.stores]);
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
    if (storesLoading || escolher || !storeIdValue) return;
    let stop = false;
    void fetchNavMonthFloor("cash_close_day", session.tenantId, storeIdValue, today).then((month) => {
      if (stop) return;
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
  }, [storesLoading, escolher, storeIdValue, session.tenantId, today, reloadKey]);

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
    if (escolher) return;
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
  }, [show, escolher]);

  useScreenRefresh({
    label: "Atualizar vendas e fechamento",
    tip: "Busca as vendas de hoje e os fechamentos do período.",
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
    if (storesLoading || escolher || storeRows.length === 0 || from > to) return;
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
  }, [storesLoading, escolher, session.tenantId, storeRows, from, to, bandKey]);

  useEffect(() => {
    if (storesLoading || escolher || storeRows.length === 0 || to < today) {
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
  }, [storesLoading, escolher, storeRows, session.tenantId, today, to, reloadKey]);

  useEffect(() => {
    if (storesLoading || escolher || !dayOpen || storeRows.length === 0 || dayOpen > today) return;
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
  }, [storesLoading, escolher, dayOpen, session.tenantId, storeRows, today, storeKey, reloadKey]);

  const analysis = useMemo(() => {
    if (marksKey !== bandKey) return null;
    const byDay = new Map<string, { systemCents: number; realCents: number; diffCents: number; withdrawalCents: number; hasMillennium: boolean; hasLines: boolean; pending: boolean }>();
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
      const current = byDay.get(day) ?? { systemCents: 0, realCents: 0, diffCents: 0, withdrawalCents: 0, hasMillennium: false, hasLines: false, pending: false };
      current.systemCents += gap.systemCents;
      current.realCents += gap.realCents;
      current.diffCents += diffCents;
      current.withdrawalCents += retirada;
      current.hasMillennium = current.hasMillennium || mark.snap.millennium.length > 0;
      current.hasLines = current.hasLines || lines.length > 0;
      current.pending = current.pending || withoutReal;
      byDay.set(day, current);
    }
    return { summary: monthCloseSummary(rows), byDay };
  }, [marks, reviews, marksKey, bandKey, today]);

  function dayFace(day: string): { kind: "empty" | "zero" | "pending" | "today" | "total"; totalCents: number; diffCents: number; withdrawalCents: number; awaiting?: boolean } {
    const info = analysis?.byDay.get(day);
    if (day === today) return { kind: "today", totalCents: soldToday?.cents ?? 0, diffCents: 0, withdrawalCents: 0, awaiting: soldToday == null };
    if (info?.pending) return { kind: "pending", totalCents: info.systemCents, diffCents: 0, withdrawalCents: 0 };
    if (!info || (info.systemCents === 0 && info.realCents === 0)) return { kind: "zero", totalCents: 0, diffCents: 0, withdrawalCents: 0 };
    if (!info.hasMillennium && !info.hasLines) return { kind: "empty", totalCents: 0, diffCents: 0, withdrawalCents: 0 };
    return { kind: "total", totalCents: info.realCents, diffCents: info.diffCents, withdrawalCents: info.withdrawalCents };
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
        {escolher ? (
          <div className="max-w-[720px]">
            <SelectStoreCard />
          </div>
        ) : showStores ? (
          <Skeleton className="h-[520px] w-full rounded-[18px]" />
        ) : storeRows.length === 0 ? (
          <Card>
            <EmptyBlock icon="📒" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : (
          <>
            {analysis ? (
              <MonthSummary summary={analysis.summary} />
            ) : (
              <Skeleton className="mb-4 h-[88px] w-full rounded-[18px]" />
            )}
            <Month today={today} cells={cells} dayFace={dayFace} onOpen={openDay} />
          </>
        )}
      </div>
      <DayModal
        day={dayOpen}
        storeRows={storeRows}
        snaps={days}
        reviews={reviews}
        pronto={dayPronto}
        owner={isOwner(session.role)}
        closed={dayOpen != null && dayOpen < today}
        tenantId={session.tenantId}
        soldByStore={soldToday?.byStore ?? null}
        sellersByStore={sellersByStore}
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

function MonthSummary({ summary }: { summary: MonthCloseSummary }) {
  const cards = [
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

function dayHint(face: { kind: "empty" | "zero" | "pending" | "today" | "total"; totalCents: number; diffCents: number; withdrawalCents: number }): string | undefined {
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
}: {
  today: string;
  cells: Array<string | null>;
  dayFace: (day: string) => { kind: "empty" | "zero" | "pending" | "today" | "total"; totalCents: number; diffCents: number; withdrawalCents: number; awaiting?: boolean };
  onOpen: (iso: string) => void;
}) {
  return (
    <MonthCalendar>
      {cells.map((day, i) => {
        if (!day) return <div key={`vazio-${i}`} className={blankDayClass(i)} />;
        const face = day <= today ? dayFace(day) : null;
        const showsTotal = face?.kind === "pending" || face?.kind === "total" || (face?.kind === "today" && !face.awaiting);
        const hint = face ? dayHint(face) : undefined;
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
              ) : null
            }
          />
        );
      })}
    </MonthCalendar>
  );
}

function withdrawalChoices(sellersByStore: Map<string, StoreSeller[]>, storeId: string, savedIds: string[]) {
  return mergeWithdrawalPeople(
    [...sellersByStore.entries()].map(([id, sellers]) => ({
      storeId: id,
      people: sellers.map((seller) => ({ id: seller.id, name: seller.name, active: seller.active })),
    })),
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
  owner,
  closed,
  tenantId,
  soldByStore,
  sellersByStore,
  onClose,
  onSaved,
}: {
  day: string | null;
  storeRows: Store[];
  snaps: Record<string, CashCloseSnapshot>;
  reviews: CashCloseReview[];
  pronto: boolean;
  owner: boolean;
  closed: boolean;
  tenantId: string;
  soldByStore: Record<string, number> | null;
  sellersByStore: Map<string, StoreSeller[]>;
  onClose: () => void;
  onSaved: (review: CashCloseReview) => void;
}) {
  const { show } = useToast();
  const [drafts, setDrafts] = useState<Record<string, CloseDraft>>({});
  const [withdrawalDrafts, setWithdrawalDrafts] = useState<Record<string, WithdrawalDraft>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!day || !pronto) return;
    const next: Record<string, CloseDraft> = {};
    const nextWithdrawals: Record<string, WithdrawalDraft> = {};
    for (const store of storeRows) {
      const snap = snaps[store.id];
      if (!snap) continue;
      const review = reviews.find((r) => r.storeId === store.id && r.day === day);
      const typed: CloseDraft["typed"] = {};
      const acquirer: CloseDraft["acquirer"] = {};
      for (const line of buildCashCloseView(snap).lines) {
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
        return snap && buildCashCloseView(snap).lines.some((line) => line.systemCents !== 0 || line.typedCents !== 0 || line.stoneCents != null);
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
            {owner ? "Cancelar" : "Voltar"}
          </Button>
          {owner && closed && withDados.length > 0 && (
            <Button onClick={() => void save()} disabled={busy || !pronto}>
              {busy ? "Salvando…" : "Salvar"}
            </Button>
          )}
        </>
      }
    >
      {!pronto ? (
        <Skeleton className="h-40 w-full" />
      ) : !closed ? (
        <div className="flex flex-col gap-4">
          {storeRows.map((store) => {
            const cents = soldByStore && store.id in soldByStore ? soldByStore[store.id] : null;
            return (
              <div key={store.id}>
                {storeRows.length > 1 ? <p className="mb-2 text-[13px] font-bold text-t0">{store.tradeName}</p> : null}
                <DayMetrics items={[{ label: "Vendido hoje", value: cents == null ? "—" : brlCent(cents / 100) }]} />
                <p className="text-[13px] leading-relaxed text-t2">Este dia ainda está em aberto. A diferença será calculada após o fechamento.</p>
              </div>
            );
          })}
        </div>
      ) : withDados.length === 0 ? (
        <p className="text-[13.5px] leading-relaxed text-t1">Ainda não há fechamento neste dia.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {withDados.map((store) => {
            const snap = snaps[store.id];
            if (!snap) return null;
            const view = buildCashCloseView(snap);
            const cash = view.lines.find((l) => l.key === "cash");
            const draft = drafts[store.id];
            const retirada = (withdrawalDrafts[store.id]?.enabled ? withdrawalDrafts[store.id]?.rows ?? [] : []).reduce((sum, row) => {
              const cents = fieldToCents(row.amount);
              return cents != null && cents > 0 ? sum + cents : sum;
            }, 0);
            const lines = withCashWithdrawal(linesWithDraft(view.lines, draft), retirada);
            const conta = closeDayGap(lines);
            const people = withdrawalChoices(
              sellersByStore,
              store.id,
              (withdrawalDrafts[store.id]?.rows ?? []).map((row) => row.sellerId),
            );
            return (
              <section key={store.id}>
                {storeRows.length > 1 && <p className="mb-3 text-[13px] font-bold text-t0">{store.tradeName}</p>}
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
                  owner={owner}
                  closed={closed}
                  draft={draft}
                  pixOnline={(draft?.onlinePix.length ?? 0) > 0}
                  onAcquirer={(key, value) =>
                    setDrafts((current) => ({
                      ...current,
                      [store.id]: { ...(current[store.id] ?? draft!), acquirer: { ...(current[store.id]?.acquirer ?? {}), [key]: value } },
                    }))
                  }
                />
                {draft && (
                  <OnlinePix
                    owner={owner}
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
                  owner={owner}
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
