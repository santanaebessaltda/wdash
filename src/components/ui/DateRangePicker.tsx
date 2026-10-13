import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { isoToDate } from "@/lib/format";
import { calendarTodayIso } from "@/data/wedash/clock";

/**
 * Seletor de intervalo de datas (DateRangePicker)  -  extraido do markup ja
 * validado visualmente em src/pages/forms/DatePickersPage.tsx (calendario
 * mensal + input de range + quick ranges), mas agora como componente
 * CONTROLADO e com datas reais (Date), nao hardcoded em "July 2026".
 *
 * Uso principal: filtro de Periodo das telas do Dashboard. Composto so com
 * primitivos (sem dependencia externa de calendario). Estilo identico ao do
 * tema Vela (border-acc/bg-acc-soft quando ativo, bg-bg-inset no input).
 *
 * - value: [inicio, fim] | null   ->   null = sem selecao
 * - onChange: dispara ao fechar um intervalo valido (inicio <= fim)
 * - quickRanges: atalhos pre-definidos (Hoje, Esta semana, ...)
 *
 * Painel em portal no `document.body` (position:fixed), alinhado a direita
 * do trigger e limitado a viewport  -  evita corte pelo overflow-x-hidden /
 * animacoes com transform dos ancestrais do layout.
 */

export type DateRange = [Date, Date];

/** Ids dos pills  -  alinhados a PeriodType no dashboard. */
export type DatePresetId =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "thisMonth"
  | "thisQuarter"
  | "thisHalf"
  | "thisYear";

export interface QuickRange {
  /** Id do preset  -  quando presente, onChange informa o preset. */
  id?: DatePresetId;
  label: string;
  /** Resolve o intervalo [inicio, fim] a partir de "hoje" (data base). */
  resolve: (today: Date) => DateRange;
}

function startOfCalendarDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addCalendarDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Segunda-feira da semana (PT-BR / ISO). */
function startOfWeek(today: Date): Date {
  const d = startOfCalendarDay(today);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  return addCalendarDays(d, diff);
}

function startOfQuarter(today: Date): Date {
  const month = Math.floor(today.getMonth() / 3) * 3;
  return new Date(today.getFullYear(), month, 1);
}

function startOfHalf(today: Date): Date {
  const month = today.getMonth() < 6 ? 0 : 6;
  return new Date(today.getFullYear(), month, 1);
}

/** Atalhos padrao alinhados ao escopo (URL `periodo=`). */
export const DEFAULT_QUICK_RANGES: QuickRange[] = [
  { id: "today", label: "Hoje", resolve: (h) => { const d = startOfCalendarDay(h); return [d, d]; } },
  { id: "yesterday", label: "Ontem", resolve: (h) => { const d = addCalendarDays(startOfCalendarDay(h), -1); return [d, d]; } },
  { id: "thisWeek", label: "Esta semana", resolve: (h) => { const d = startOfCalendarDay(h); return [startOfWeek(d), d]; } },
  { id: "thisMonth", label: "Este mês", resolve: (h) => { const d = startOfCalendarDay(h); return [new Date(d.getFullYear(), d.getMonth(), 1), d]; } },
  { id: "thisQuarter", label: "Este trimestre", resolve: (h) => { const d = startOfCalendarDay(h); return [startOfQuarter(d), d]; } },
  { id: "thisHalf", label: "Este semestre", resolve: (h) => { const d = startOfCalendarDay(h); return [startOfHalf(d), d]; } },
  { id: "thisYear", label: "Este ano", resolve: (h) => { const d = startOfCalendarDay(h); return [new Date(d.getFullYear(), 0, 1), d]; } },
];

/** Calendários de Fechamento, Sangria e Informe: Este mês mostra o mês civil inteiro. */
export const CALENDAR_QUICK_RANGES: QuickRange[] = DEFAULT_QUICK_RANGES.map((qr) =>
  qr.id !== "thisMonth"
    ? qr
    : {
        ...qr,
        resolve: (today) => {
          const d = startOfCalendarDay(today);
          return [new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 0)];
        },
      },
);

const WEEKDAY_INITIALS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTHS_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const SHORT_MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatShort(d: Date): string {
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

function formatRange(r: DateRange): string {
  const [a, b] = r;
  return sameCalendarDay(a, b) ? formatShort(a) : `${formatShort(a)} – ${formatShort(b)}`;
}

export type DateRangeChangeMeta = {
  /** Preset clicado (pill). Ausente = selecao manual no calendario. */
  presetId?: DatePresetId;
};

export function DateRangePicker({
  value,
  onChange,
  quickRanges = DEFAULT_QUICK_RANGES,
  /** Quando o escopo e um preset, mostra o nome no input (ex.: "Este mes"). */
  displayLabel,
  /** Preset ativo no escopo  -  destaca o pill correspondente. */
  activePresetId,
  className,
  size = "md",
  minDate,
  maxDate,
}: {
  value: DateRange | null;
  onChange: (r: DateRange, goal?: DateRangeChangeMeta) => void;
  quickRanges?: QuickRange[];
  displayLabel?: string | null;
  activePresetId?: string | null;
  className?: string;
  /** Alinha ao Button: sm = h-8 (acoes do PageHeader), md = h-10. */
  size?: "sm" | "md";
  /** Dias antes disso ficam bloqueados (cobertura sync). */
  minDate?: Date | null;
  /** Dias depois disso ficam bloqueados (default: hoje). */
  maxDate?: Date | null;
}) {
  // Dia civil das lojas (Campo Grande)  -  alinhado a resolvePeriod/calendarTodayIso.
  const today = useMemo(() => isoToDate(calendarTodayIso()), []);
  const min = useMemo(() => (minDate ? startOfCalendarDay(minDate) : null), [minDate]);
  const max = useMemo(() => startOfCalendarDay(maxDate ?? today), [maxDate, today]);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<Date>(() => (value ? new Date(value[0].getFullYear(), value[0].getMonth(), 1) : new Date(today.getFullYear(), today.getMonth(), 1)));
  const [draftStart, setDraftStart] = useState<Date | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Ao abrir: zera rascunho e alinha o mes ao valor atual (evita dia "fantasma" do draft).
  useEffect(() => {
    if (!open) return;
    setDraftStart(null);
    if (value) setViewMonth(new Date(value[0].getFullYear(), value[0].getMonth(), 1));
  }, [open]); // value lido so no momento do open

  function dayBlocked(day: Date): boolean {
    if (min && day < min) return true;
    if (day > max) return true;
    return false;
  }

  function clampRange(r: DateRange): DateRange | null {
    let [a, b] = r;
    if (a > b) [a, b] = [b, a];
    if (min && b < min) return null;
    if (a > max) return null;
    const start = min && a < min ? min : a;
    const end = b > max ? max : b;
    if (start > end) return null;
    return [start, end];
  }

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
      const width = Math.min(vw - margin * 2, 640);
      // Alinha a direita do painel a direita do trigger; empurra pra dentro se passar.
      let left = rect.right - width;
      if (left < margin) left = margin;
      if (left + width > vw - margin) left = Math.max(margin, vw - margin - width);
      const top = Math.min(rect.bottom + 8, vh - margin - 80);
      const maxHeight = Math.max(200, vh - top - margin);
      setPanelPos({ top, left, width, maxHeight });
    }

    colocar();
    window.addEventListener("resize", colocar);
    window.addEventListener("scroll", colocar, true);
    return () => {
      window.removeEventListener("resize", colocar);
      window.removeEventListener("scroll", colocar, true);
    };
  }, [open]);

  const cells = useMemo(() => {
    const offset = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1).getDay();
    const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
    const arr: (Date | null)[] = Array.from({ length: offset }, () => null);
    for (let d = 1; d <= daysInMonth; d++) {
      arr.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d));
    }
    return arr;
  }, [viewMonth]);

  const canMonthPrev = !min || new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 0) >= min;
  const canMonthProx =
    new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1) <= max;

  /** 1 dia = Hoje/Ontem se bater com o calendario real (igual aos pills). */
  function presetOfRange(r: DateRange): DatePresetId | undefined {
    const [a, b] = r;
    if (!sameCalendarDay(a, b)) return undefined;
    if (sameCalendarDay(a, today)) return "today";
    if (sameCalendarDay(a, addCalendarDays(today, -1))) return "yesterday";
    return undefined;
  }

  function pickDay(day: Date) {
    if (dayBlocked(day)) return;
    // 1 clique (ou dia anterior ao inicio)  ->  marca inicio; 2 no mesmo dia  ->  so aquele dia.
    if (!draftStart || (!sameCalendarDay(draftStart, day) && draftStart > day)) {
      setDraftStart(day);
      return;
    }
    const clamped = clampRange([draftStart, day]);
    if (!clamped) return;
    const presetId = presetOfRange(clamped);
    onChange(clamped, presetId ? { presetId } : undefined);
    setDraftStart(null);
    setOpen(false);
  }

  function applyQuick(qr: QuickRange) {
    const raw = qr.resolve(today);
    const clamped = clampRange(raw);
    if (!clamped) return;
    onChange(clamped, qr.id ? { presetId: qr.id } : undefined);
    setDraftStart(null);
    setViewMonth(new Date(clamped[0].getFullYear(), clamped[0].getMonth(), 1));
    setOpen(false);
  }

  function quickAvailable(qr: QuickRange): boolean {
    return clampRange(qr.resolve(today)) != null;
  }

  function isSelected(day: Date): boolean {
    if (draftStart && sameCalendarDay(draftStart, day)) return true;
    if (value) return sameCalendarDay(value[0], day) || sameCalendarDay(value[1], day);
    return false;
  }

  function isInside(day: Date): boolean {
    const lo = draftStart ?? (value ? value[0] : day);
    const hi = value ? value[1] : day;
    if (!draftStart && value) return day > value[0] && day < value[1];
    if (draftStart) return false;
    return day > lo && day < hi;
  }

  const label = displayLabel?.trim()
    ? displayLabel
    : value
      ? formatRange(value)
      : "Período personalizado";

  const painel =
    open && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width, maxHeight: panelPos.maxHeight }}
            className="fixed z-[80] flex flex-col gap-4 overflow-y-auto overflow-x-hidden rounded-[14px] border border-line bg-bg-2 p-4 shadow-[var(--shadow-vela)] sm:flex-row"
          >
            <div className="flex shrink-0 flex-row flex-wrap gap-2 sm:w-[150px] sm:flex-col sm:flex-nowrap">
              <span className="mb-0.5 hidden text-[11px] font-bold uppercase tracking-wide text-t2 sm:block">Períodos</span>
              {quickRanges.map((qr) => {
                const ok = quickAvailable(qr);
                const active = Boolean(qr.id && activePresetId && qr.id === activePresetId);
                return (
                  <button
                    key={qr.id ?? qr.label}
                    type="button"
                    disabled={!ok}
                    onClick={() => applyQuick(qr)}
                    className={cn(
                      "h-8 rounded-[9px] border px-3 text-left text-xs font-semibold transition-colors",
                      !ok
                        ? "cursor-not-allowed border-line/60 text-t2 opacity-40"
                        : active
                          ? "border-acc bg-acc-soft text-acc"
                          : "border-line text-t1 hover:border-acc hover:text-acc",
                    )}
                  >
                    {qr.label}
                  </button>
                );
              })}
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-3 flex items-center justify-between">
                <button
                  type="button"
                  disabled={!canMonthPrev}
                  onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
                  aria-label="Mês anterior"
                  className={cn(
                    "flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line text-t1",
                    canMonthPrev ? "hover:bg-bg-3" : "cursor-not-allowed opacity-40",
                  )}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
                <span className="text-sm font-bold text-t0">
                  {MONTHS_PT[viewMonth.getMonth()]} {viewMonth.getFullYear()}
                </span>
                <button
                  type="button"
                  disabled={!canMonthProx}
                  onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
                  aria-label="Próximo mês"
                  className={cn(
                    "flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line text-t1",
                    canMonthProx ? "hover:bg-bg-3" : "cursor-not-allowed opacity-40",
                  )}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </div>

              <div className="mb-1.5 grid grid-cols-7 gap-1">
                {WEEKDAY_INITIALS.map((d, i) => (
                  <span key={`${d}-${i}`} className="py-1 text-center text-[10.5px] font-bold text-t2">
                    {d}
                  </span>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {cells.map((day, i) => {
                  if (day === null) return <span key={`e${i}`} />;
                  const isTodayFlag = sameCalendarDay(day, today);
                  const blocked = dayBlocked(day);
                  const selected = isSelected(day);
                  const inside = isInside(day);
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      disabled={blocked}
                      onClick={() => pickDay(day)}
                      aria-current={isTodayFlag ? "date" : undefined}
                      title={isTodayFlag ? "Hoje" : undefined}
                      className={cn(
                        "flex h-9 min-w-0 items-center justify-center rounded-[9px] text-[12.5px] transition-colors",
                        blocked
                          ? "cursor-not-allowed text-t2 opacity-30"
                          : selected
                            ? "bg-acc font-bold text-white"
                            : inside
                              ? "bg-acc-soft font-semibold text-acc"
                              : isTodayFlag
                                ? "font-bold text-acc ring-1 ring-acc/50 hover:bg-acc-soft"
                                : "font-semibold text-t1 hover:bg-bg-3",
                      )}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>

              <p className="mt-3 text-[11px] text-t2">
                {min
                  ? draftStart
                    ? "Clique de novo no mesmo dia (só ele) ou no último dia. Só dados já sincronizados."
                    : "Só períodos já sincronizados. Selecione o primeiro e o último dia."
                  : draftStart
                    ? "Clique de novo no mesmo dia (só ele) ou no último dia."
                    : "Selecione o primeiro e o último dia."}
              </p>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={triggerRef} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex min-w-0 items-center rounded-[var(--radius-vela-sm)] border bg-bg-3 text-left transition-colors",
          size === "sm" ? "h-8 gap-2 px-3" : "h-10 gap-2.5 px-3.5",
          open ? "border-acc" : "border-line hover:border-acc",
        )}
      >
        <svg
          width={size === "sm" ? 13 : 15}
          height={size === "sm" ? 13 : 15}
          viewBox="0 0 24 24"
          fill="none"
          stroke={open ? "var(--acc)" : "var(--t2)"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span className={cn("min-w-0 truncate font-semibold", size === "sm" ? "text-xs" : "text-[13.5px]", value || displayLabel ? "text-t0" : "text-t2")}>{label}</span>
      </button>
      {painel}
    </div>
  );
}
