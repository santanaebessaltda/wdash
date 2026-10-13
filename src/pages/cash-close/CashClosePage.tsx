import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Badge, Button, Card, DateRangePicker, Modal, Skeleton, Tooltip, useToast, CALENDAR_QUICK_RANGES, type DatePresetId, type DateRangeChangeMeta } from "@/components/ui";
import { DayFace, DayMetrics, MonthCalendar, blankDayClass } from "@/components/wedash/MonthCalendar";
import { EmployeeWithdrawal } from "@/pages/cash-close/EmployeeWithdrawal";
import { monthCloseSpanFor, monthsTouched } from "@/data/wedash/cashCloseMonth";
import {
  applyCloseReview,
  buildCashCloseView,
  closeDayGap,
  dayWithoutReal,
  monthCloseSummary,
  realCentsOf,
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
  netCloseDiff,
  withdrawalDraftFrom,
  withdrawalPeople,
  withdrawalSave,
  type WithdrawalDraft,
} from "@/data/wedash/employeeWithdrawal";
import { fetchSalesDayAggs, fetchSyncWatermark } from "@/data/wedash/salesRepo";
import { fetchStoreSellers, type Store, type StoreSeller } from "@/data/wedash/stores";
import { isGestor } from "@/layout/nav-wedash";
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

function pageEndYear(ano: number, todayYear: number): number {
  const alvo = Math.min(ano, todayYear);
  return todayYear - Math.floor((todayYear - alvo) / 12) * 12;
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
  return lines.map((line) => {
    const next = { ...line };
    const typed = fieldToCents(draft.typed[line.key] ?? "");
    if (typed != null) next.typedCents = typed;
    if (line.key !== "cash") {
      const raw = draft.acquirer[line.key] ?? "";
      const real = fieldToCents(raw);
      if (raw.trim() && real != null && !(line.stoneCents == null && real === 0)) next.stoneCents = real;
    }
    return next;
  });
}

type CloseDraft = {
  typed: Partial<Record<CashCloseBucket, string>>;
  acquirer: Partial<Record<CashCloseBucket, string>>;
};

function CloseTable({
  lines,
  pixPending,
  gestor,
  closed,
  draft,
  onAcquirer,
}: {
  lines: CashCloseLine[];
  pixPending: boolean;
  gestor: boolean;
  closed: boolean;
  draft?: CloseDraft;
  onAcquirer?: (key: CashCloseBucket, value: string) => void;
}) {
  if (lines.length === 0) return null;
  const campo =
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
              const acqTxt = draft?.acquirer[row.key] ?? (row.stoneCents == null ? "" : centsToField(row.stoneCents));
              return (
                <tr key={row.key} className="border-b border-line">
                  <td className="px-3 py-3 text-t0">{labelUpper(row.label)}</td>
                  <td className="px-3 py-3 text-right font-mono text-[13px] font-bold text-t0">{money(row.systemCents)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {row.key === "cash" || !(gestor && draft && onAcquirer) ? (
                      <span className="font-mono text-[13px] font-bold text-t0">{real == null ? "—" : money(real)}</span>
                    ) : (
                      <input
                        value={acqTxt}
                        onChange={(e) => onAcquirer(row.key, e.target.value)}
                        inputMode="decimal"
                        placeholder="—"
                        aria-label={`Total real para ${row.label}`}
                        className={campo}
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
  onChange: (alvo: string) => void;
}) {
  const todayDateValue = isoToDate(today);
  const todayYear = todayDateValue.getFullYear();
  const todayMonth = todayDateValue.getMonth();
  const piso = isoToDate(startOfMonth(minIso));
  const pisoAno = piso.getFullYear();
  const pisoMes = piso.getMonth();
  const selecionado = isoToDate(startOfMonth(iso));
  const [open, setOpen] = useState(false);
  const [modo, setModo] = useState<"month" | "year">("month");
  const [anoVista, setAnoVista] = useState(selecionado.getFullYear());
  const [anoPagina, setAnoPagina] = useState(todayYear);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setModo("month");
    setAnoVista(selecionado.getFullYear());
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
      const margem = 12;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(vw - margem * 2, 300);
      let left = rect.right - width;
      if (left < margem) left = margem;
      if (left + width > vw - margem) left = Math.max(margem, vw - margem - width);
      const top = Math.min(rect.bottom + 8, vh - margem - 80);
      setPanelPos({ top, left, width, maxHeight: Math.max(200, vh - top - margem) });
    }
    colocar();
    window.addEventListener("resize", colocar);
    window.addEventListener("scroll", colocar, true);
    return () => {
      window.removeEventListener("resize", colocar);
      window.removeEventListener("scroll", colocar, true);
    };
  }, [open]);

  const anos = Array.from({ length: 12 }, (_, i) => anoPagina - 11 + i);
  const podeAnoAnt = modo === "year" ? anos[0] > pisoAno : anoVista > pisoAno;
  const podeAnoProx = modo === "year" ? anoPagina < todayYear : anoVista < todayYear;
  const navBtn = (ok: boolean) =>
    cn("flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line text-t1", ok ? "hover:bg-bg-3" : "cursor-not-allowed opacity-40");

  function pickMonth(month: number) {
    const antes = anoVista < pisoAno || (anoVista === pisoAno && month < pisoMes);
    const futuro = anoVista > todayYear || (anoVista === todayYear && month > todayMonth);
    if (antes || futuro) return;
    onChange(dateToIso(new Date(anoVista, month, 1)));
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
                disabled={!podeAnoAnt}
                aria-label={modo === "year" ? "Anos anteriores" : "Ano anterior"}
                className={navBtn(podeAnoAnt)}
                onClick={() => (modo === "year" ? setAnoPagina((n) => n - 12) : setAnoVista((n) => n - 1))}
              >
                <MonthStep dir="anterior" />
              </button>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-sm font-bold text-t0 hover:bg-bg-3"
                onClick={() => {
                  if (modo === "month") {
                    setAnoPagina(pageEndYear(anoVista, todayYear));
                    setModo("year");
                    return;
                  }
                  setModo("month");
                }}
              >
                {modo === "month" ? anoVista : `${anos[0]} – ${anos[anos.length - 1]}`}
              </button>
              <button
                type="button"
                disabled={!podeAnoProx}
                aria-label={modo === "year" ? "Próximos anos" : "Próximo ano"}
                className={navBtn(podeAnoProx)}
                onClick={() => (modo === "year" ? setAnoPagina((n) => Math.min(todayYear, n + 12)) : setAnoVista((n) => n + 1))}
              >
                <MonthStep dir="proximo" />
              </button>
            </div>
            {modo === "month" ? (
              <div className="grid grid-cols-3 gap-1">
                {MONTHS_PT.map((name, month) => {
                  const bloqueado =
                    anoVista < pisoAno ||
                    (anoVista === pisoAno && month < pisoMes) ||
                    anoVista > todayYear ||
                    (anoVista === todayYear && month > todayMonth);
                  const ativo = selecionado.getFullYear() === anoVista && selecionado.getMonth() === month;
                  return (
                    <button
                      key={name}
                      type="button"
                      disabled={bloqueado}
                      onClick={() => pickMonth(month)}
                      className={cn(
                        "h-9 truncate rounded-[9px] px-1 text-[12.5px] font-semibold transition-colors",
                        bloqueado ? "cursor-not-allowed text-t2 opacity-30" : ativo ? "bg-acc text-white" : "text-t1 hover:bg-bg-3",
                      )}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {anos.map((ano) => {
                  const bloqueado = ano < pisoAno || ano > todayYear;
                  const ativo = selecionado.getFullYear() === ano;
                  return (
                    <button
                      key={ano}
                      type="button"
                      disabled={bloqueado}
                      onClick={() => {
                        setAnoVista(ano);
                        setModo("month");
                      }}
                      className={cn(
                        "h-9 rounded-[9px] text-[12.5px] font-semibold transition-colors",
                        bloqueado ? "cursor-not-allowed text-t2 opacity-30" : ativo ? "bg-acc text-white" : "text-t1 hover:bg-bg-3",
                      )}
                    >
                      {ano}
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

/** Gestão > Fechamento. Calendário do mês, no desenho do Vela. */
export function CashClosePage() {
  const { show } = useToast();
  const { session, storeRows, loading: lojasLoading } = useScopedStores();
  const { scope } = useScope();
  const escolher = pickOneStore(scope.storeIds, session.stores.length);
  const showStores = useMinSkeleton(lojasLoading);
  const today = calendarTodayIso();
  const [rangeFrom, setRangeFrom] = useState(() => startOfMonth(today));
  const [rangeTo, setRangeTo] = useState(() => endOfMonth(today));
  const [presetId, setPresetId] = useState<DatePresetId | null>("thisMonth");
  const [piso, setPiso] = useState(() => startOfMonth(today));
  const [marks, setMarks] = useState<CashCloseDayMark[]>([]);
  const [marksKey, setMarksKey] = useState("");
  const [reviews, setReviews] = useState<CashCloseReview[]>([]);
  const [sellersByStore, setSellersByStore] = useState<Map<string, StoreSeller[]>>(new Map());
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  const [dias, setDias] = useState<Record<string, CashCloseSnapshot>>({});
  const [diaKey, setDiaKey] = useState("");
  const [erro, setErro] = useState(false);
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
  const toBruto = rangeTo;
  const to = toBruto < today ? toBruto : today;
  const bandKey = `${storeKey}|${from}|${to}|${reloadKey}`;

  const storeIdValue = storeRows[0]?.id ?? "";
  useEffect(() => {
    if (lojasLoading || escolher || storeRows.length === 0) return;
    let stop = false;
    void fetchStoreSellers(session.tenantId, storeRows.map((store) => store.id)).then((map) => {
      if (!stop) setSellersByStore(map);
    });
    return () => {
      stop = true;
    };
  }, [lojasLoading, escolher, session.tenantId, storeRows]);
  useEffect(() => {
    if (lojasLoading || escolher || !storeIdValue) return;
    let stop = false;
    void fetchNavMonthFloor("cash_close_day", session.tenantId, storeIdValue, today).then((month) => {
      if (stop) return;
      setPiso(month);
      setRangeFrom((atual) => {
        if (atual >= month) return atual;
        setPresetId(null);
        return month;
      });
    });
    return () => {
      stop = true;
    };
  }, [lojasLoading, escolher, storeIdValue, session.tenantId, today, reloadKey]);

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

  const pedirFechamento = useCallback(async () => {
    if (escolher) return;
    const ids = storesRef.current.map((store) => store.id);
    if (ids.length === 0) return;
    const months = monthsTouched(rangeFromRef.current, rangeToRef.current);
    const todayIso = calendarTodayIso();
    const comDia = months.filter((month) => monthCloseSpanFor(month, todayIso));
    const alvos = comDia.length > 0 ? comDia : [months[0]];
    for (const month of alvos) {
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
    run: () => pedirFechamento(),
  });

  useEffect(() => {
    const onSynced = () => setReloadKey((n) => n + 1);
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, []);

  useEffect(() => {
    if (lojasLoading || escolher || storeRows.length === 0 || from > to) return;
    let cancelled = false;
    setErro(false);
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
        if (!cancelled) setErro(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lojasLoading, escolher, session.tenantId, storeRows, from, to, bandKey]);

  useEffect(() => {
    if (lojasLoading || escolher || storeRows.length === 0 || to < today) {
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
  }, [lojasLoading, escolher, storeRows, session.tenantId, today, to, reloadKey]);

  useEffect(() => {
    if (lojasLoading || escolher || !diaAberto || storeRows.length === 0 || diaAberto > today) return;
    let cancelled = false;
    setErro(false);
    const key = `${storeKey}|${diaAberto}|${reloadKey}`;
    void Promise.all(storeRows.map((store) => fetchCashCloseSnapshot(session.tenantId, store.id, diaAberto).then((snap) => [store.id, snap] as const)))
      .then((rows) => {
        if (cancelled || !diaAberto) return;
        setDias(Object.fromEntries(rows));
        setDiaKey(key);
        setMarks((atual) => {
          const next = atual.map((mark) => ({ ...mark }));
          for (const [storeId, snap] of rows) {
            const i = next.findIndex((mark) => mark.storeId === storeId && mark.day.slice(0, 10) === diaAberto);
            const mark = { storeId, day: diaAberto, snap, cardPending: snap.cardPending };
            if (i >= 0) next[i] = mark;
            else next.push(mark);
          }
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setErro(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lojasLoading, escolher, diaAberto, session.tenantId, storeRows, today, storeKey, reloadKey]);

  const analise = useMemo(() => {
    if (marksKey !== bandKey) return null;
    const porDia = new Map<string, { systemCents: number; realCents: number; diffCents: number; withdrawalCents: number; hasMillennium: boolean; hasLines: boolean; pending: boolean }>();
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
      const semReal = dayWithoutReal(lines);
      const retirada = (review?.withdrawals ?? []).reduce((sum, row) => sum + row.cents, 0);
      const diffCents = netCloseDiff(gap.diffCents, retirada);
      if (day < today) {
        rows.push({
          day,
          systemCents: gap.comparedSystemCents,
          realCents: gap.realCents,
          diffCents,
          pending: semReal,
        });
      }
      const atual = porDia.get(day) ?? { systemCents: 0, realCents: 0, diffCents: 0, withdrawalCents: 0, hasMillennium: false, hasLines: false, pending: false };
      atual.systemCents += gap.systemCents;
      atual.realCents += gap.realCents;
      atual.diffCents += diffCents;
      atual.withdrawalCents += retirada;
      atual.hasMillennium = atual.hasMillennium || mark.snap.millennium.length > 0;
      atual.hasLines = atual.hasLines || lines.length > 0;
      atual.pending = atual.pending || semReal;
      porDia.set(day, atual);
    }
    return { summary: monthCloseSummary(rows), porDia };
  }, [marks, reviews, marksKey, bandKey, today]);

  function dayFace(day: string): { kind: "empty" | "zero" | "pending" | "today" | "total"; totalCents: number; diffCents: number; withdrawalCents: number; awaiting?: boolean } {
    const info = analise?.porDia.get(day);
    if (day === today) return { kind: "today", totalCents: soldToday?.cents ?? 0, diffCents: 0, withdrawalCents: 0, awaiting: soldToday == null };
    if (info?.pending) return { kind: "pending", totalCents: info.systemCents, diffCents: 0, withdrawalCents: 0 };
    if (!info || (info.systemCents === 0 && info.realCents === 0)) return { kind: "zero", totalCents: 0, diffCents: 0, withdrawalCents: 0 };
    if (!info.hasMillennium && !info.hasLines) return { kind: "empty", totalCents: 0, diffCents: 0, withdrawalCents: 0 };
    return { kind: "total", totalCents: info.realCents, diffCents: info.diffCents, withdrawalCents: info.withdrawalCents };
  }

  function openDay(iso: string) {
    if (iso > today) return;
    if (iso < today && dayFace(iso).kind === "zero") return;
    setDiaAberto(iso);
  }

  function aplicarIntervalo(start: Date, end: Date, goal?: DateRangeChangeMeta) {
    setRangeFrom(dateToIso(start));
    setRangeTo(dateToIso(end));
    setPresetId(goal?.presetId ?? null);
  }

  const diaPronto = diaAberto != null && diaKey === `${storeKey}|${diaAberto}|${reloadKey}`;

  return (
    <div>
      <SectionHeader
        section="Gestão"
        title="Fechamento"
        subtitle="Compare o Millennium com o total real e acompanhe diferenças e pendências."
        actions={
          <HeaderFilters>
            <DateRangePicker
              value={[isoToDate(rangeFrom), isoToDate(rangeTo)]}
              minDate={isoToDate(piso)}
              maxDate={isoToDate(endOfMonth(today))}
              quickRanges={CALENDAR_QUICK_RANGES}
              displayLabel={presetId ? periodLabels[presetId] : null}
              activePresetId={presetId}
              onChange={([start, end], goal) => aplicarIntervalo(start, end, goal)}
            />
          </HeaderFilters>
        }
      />
      <div className="mt-6 pb-6">
        {erro ? <Alert className="mb-4" variant="danger" title="Não foi possível carregar o fechamento. Tente novamente." /> : null}
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
            {analise ? (
              <MonthSummary summary={analise.summary} />
            ) : (
              <Skeleton className="mb-4 h-[88px] w-full rounded-[18px]" />
            )}
            <Mes today={today} cells={cells} dayFace={dayFace} onOpen={openDay} />
          </>
        )}
      </div>
      <DayModal
        day={diaAberto}
        storeRows={storeRows}
        snaps={dias}
        reviews={reviews}
        pronto={diaPronto}
        gestor={isGestor(session.role)}
        closed={diaAberto != null && diaAberto < today}
        tenantId={session.tenantId}
        soldByStore={soldToday?.byStore ?? null}
        sellersByStore={sellersByStore}
        onClose={() => setDiaAberto(null)}
        onSaved={(next) => {
          setReviews((atual) => {
            const sem = atual.filter((r) => !(r.storeId === next.storeId && r.day === next.day));
            return [...sem, next];
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
  const itens = [
    { label: "Millennium", value: money(systemCents), tom: "text-t0" },
    { label: "Total real", value: money(realCents), tom: "text-t0" },
    { label: "Diferença", value: dayTotal(diffCents), tom: diffClass(diffCents) },
  ];
  return (
    <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {itens.map((item) => (
        <div key={item.label} className="min-w-0 rounded-[14px] border border-line bg-bg-1 px-3 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-t2">{item.label}</p>
          <p className={cn("mt-1 truncate font-mono text-lg font-extrabold", item.tom)}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export function DayChip({ cor, children }: { cor: string; children: string }) {
  return (
    <div title={children} className={cn("mt-1 w-full self-stretch truncate rounded-md px-1.5 py-1 text-[10px] font-semibold text-white sm:text-[11px]", cor)}>
      {children}
    </div>
  );
}

function differenceChip(cents: number): { cor: string; text: string } {
  if (cents > 0) return { cor: "bg-ok", text: `Sobra ${brlCent(cents / 100)}` };
  if (cents < 0) return { cor: "bg-bad", text: `Quebra ${brlCent(Math.abs(cents) / 100)}` };
  return { cor: "bg-chip-gray", text: "Sem diferença" };
}

function dayHint(face: { kind: "empty" | "zero" | "pending" | "today" | "total"; totalCents: number; diffCents: number; withdrawalCents: number }): string | undefined {
  if (face.kind !== "total") return undefined;
  const partes: string[] = [];
  if (face.diffCents !== 0) partes.push(differenceChip(face.diffCents).text);
  if (face.withdrawalCents > 0) partes.push(`Retirada ${brlCent(face.withdrawalCents / 100)}`);
  return partes.length > 0 ? partes.join(" · ") : undefined;
}

function Mes({
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
        const dica = face ? dayHint(face) : undefined;
        const open = Boolean(face && face.kind !== "zero" && face.kind !== "empty");
        return (
          <DayFace
            key={day}
            index={i}
            iso={day}
            today={today}
            openable={open}
            openLabel={`Abrir ${dayTitle(day)}`}
            title={dica}
            onOpen={() => onOpen(day)}
            amount={showsTotal && face ? brlCent(face.totalCents / 100) : null}
            badges={
              face?.kind === "today" || face?.kind === "pending" || face?.kind === "total" ? (
                <>
                  {face.kind === "pending" && <DayChip cor="bg-warn">{`Pendente ${brlCent(face.totalCents / 100)}`}</DayChip>}
                  {face.kind === "today" && <DayChip cor="bg-acc">Em aberto</DayChip>}
                  {face.kind === "total" && (face.diffCents !== 0 || face.withdrawalCents === 0) && (
                    <DayChip cor={differenceChip(face.diffCents).cor}>{differenceChip(face.diffCents).text}</DayChip>
                  )}
                  {face.kind === "total" && face.withdrawalCents > 0 && (
                    <DayChip cor="bg-info">{`Retirada ${brlCent(face.withdrawalCents / 100)}`}</DayChip>
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
        const salvo = review?.typedCents[line.key] ?? (line.key === "cash" ? review?.cashTypedCents : null);
        typed[line.key] = centsToField(salvo ?? line.typedCents);
        const manual = review?.acquirerCents[line.key];
        const shown = manual ?? line.stoneCents;
        acquirer[line.key] = shown == null ? "" : centsToField(shown);
      }
      next[store.id] = { typed, acquirer };
      nextWithdrawals[store.id] = withdrawalDraftFrom(review?.withdrawals ?? [], centsToField);
    }
    setDrafts(next);
    setWithdrawalDrafts(nextWithdrawals);
  }, [day, pronto, storeRows, snaps, reviews]);

  const comDados = day
    ? storeRows.filter((store) => {
        const snap = snaps[store.id];
        return snap && buildCashCloseView(snap).lines.some((line) => line.systemCents !== 0 || line.typedCents !== 0 || line.stoneCents != null);
      })
    : [];

  const diaPendente =
    closed &&
    pronto &&
    (comDados.length === 0 ||
      comDados.some((store) => {
        const snap = snaps[store.id];
        if (!snap || !day) return true;
        const review = reviews.find((r) => r.storeId === store.id && r.day === day) ?? null;
        const lines = applyCloseReview(buildCashCloseView(snap).lines, review, {
          cardPending: snap.cardPending,
          pixRequested: snap.pixRequested,
        });
        return dayWithoutReal(lines);
      }));

  async function salvar() {
    if (!day) return;
    setBusy(true);
    for (const store of comDados) {
      const snap = snaps[store.id];
      const draft = drafts[store.id];
      if (!snap || !draft) continue;
      const linhas = buildCashCloseView(snap).lines;
      const typedCents: CashCloseReview["typedCents"] = {};
      const acquirerCents: CashCloseReview["acquirerCents"] = {};
      let invalido = false;
      for (const line of linhas) {
        const typedRaw = draft.typed[line.key] ?? "";
        const typed = fieldToCents(typedRaw);
        if (typedRaw.trim() && typed == null) {
          invalido = true;
          show(`O valor digitado para ${line.label} não é válido.`, "danger");
          break;
        }
        if (typed != null && typed !== line.typedCents) typedCents[line.key] = typed;
        if (line.key === "cash") continue;
        const raw = draft.acquirer[line.key] ?? "";
        const real = fieldToCents(raw);
        if (raw.trim() && real == null) {
          invalido = true;
          show(`O total real para ${line.label} não é válido.`, "danger");
          break;
        }
        if (real != null && real !== line.stoneCents && !(line.stoneCents == null && real === 0)) acquirerCents[line.key] = real;
      }
      if (invalido) {
        setBusy(false);
        return;
      }
      const review = reviews.find((item) => item.storeId === store.id && item.day === day);
      const people = withdrawalPeople(
        (sellersByStore.get(store.id) ?? []).map((seller) => ({ id: seller.id, name: seller.name, active: seller.active })),
        (withdrawalDrafts[store.id]?.rows ?? []).map((row) => row.sellerId),
      );
      const retiro = withdrawalSave({
        shortageCents: dayShortageCents(closeDayGap(linesWithDraft(linhas, draft)).diffCents),
        enabled: withdrawalDrafts[store.id]?.enabled ?? false,
        rows: withdrawalDrafts[store.id]?.rows ?? [],
        parseCents: fieldToCents,
        names: new Map(people.map((person) => [person.id, person.name])),
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
              <Badge variant={!closed ? "accent" : diaPendente ? "warning" : "success"}>
                {!closed ? "Em aberto" : diaPendente ? "Pendente" : "Fechado"}
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
            {gestor ? "Cancelar" : "Voltar"}
          </Button>
          {gestor && closed && comDados.length > 0 && (
            <Button onClick={() => void salvar()} disabled={busy || !pronto}>
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
                {storeRows.length > 1 ? <p className="mb-2 text-[13px] font-bold text-t0">{store.fantasia}</p> : null}
                <DayMetrics items={[{ label: "Vendido hoje", value: cents == null ? "—" : brlCent(cents / 100) }]} />
                <p className="text-[13px] leading-relaxed text-t2">Este dia ainda está em aberto. A diferença será calculada após o fechamento.</p>
              </div>
            );
          })}
        </div>
      ) : comDados.length === 0 ? (
        <p className="text-[13.5px] leading-relaxed text-t1">Ainda não há fechamento neste dia.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {comDados.map((store) => {
            const snap = snaps[store.id];
            if (!snap) return null;
            const view = buildCashCloseView(snap);
            const cash = view.lines.find((l) => l.key === "cash");
            const draft = drafts[store.id];
            const linhas = linesWithDraft(view.lines, draft);
            const conta = closeDayGap(linhas);
            const people = withdrawalPeople(
              (sellersByStore.get(store.id) ?? []).map((seller) => ({ id: seller.id, name: seller.name, active: seller.active })),
              (withdrawalDrafts[store.id]?.rows ?? []).map((row) => row.sellerId),
            );
            return (
              <section key={store.id}>
                {storeRows.length > 1 && <p className="mb-3 text-[13px] font-bold text-t0">{store.fantasia}</p>}
                {!dayWithoutReal(linhas) ? (
                  <DayTotals systemCents={conta.comparedSystemCents} realCents={conta.realCents} diffCents={conta.diffCents} />
                ) : (
                  <p className="mb-4 text-[13px] text-t2">Falta o total real de alguma forma. A diferença aparece quando ele for informado.</p>
                )}
                {cash?.openingCents != null && (
                  <p className="mb-3 text-[12px] text-t2">
                    Fundo de caixa {brlCent(cash.openingCents / 100)}
                    {cash.sangriaCents != null ? ` · Sangria ${brlCent(Math.abs(cash.sangriaCents) / 100)}` : ""}
                  </p>
                )}
                <CloseTable
                  lines={linhas}
                  pixPending={view.pixPending}
                  gestor={gestor}
                  closed={closed}
                  draft={draft}
                  onAcquirer={(key, value) =>
                    setDrafts((atual) => ({
                      ...atual,
                      [store.id]: { ...(atual[store.id] ?? draft!), acquirer: { ...(atual[store.id]?.acquirer ?? {}), [key]: value } },
                    }))
                  }
                />
                <EmployeeWithdrawal
                  gestor={gestor}
                  shortageCents={dayShortageCents(conta.diffCents)}
                  people={people}
                  draft={withdrawalDrafts[store.id] ?? { enabled: false, rows: [] }}
                  onChange={(next) => setWithdrawalDrafts((atual) => ({ ...atual, [store.id]: next }))}
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
