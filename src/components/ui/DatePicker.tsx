import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { isoToDate } from "@/lib/format";
import { calendarTodayIso } from "@/data/wedash/clock";

/**
 * Seletor de 1 data  -  campo "Single date" e calendario de src/pages/forms/DatePickersPage.tsx.
 * Um clique no dia escolhe e fecha. Painel em portal, alinhado a esquerda do campo.
 */

const WEEKDAY_INITIALS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTHS_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const PANEL_WIDTH = 320;

function startOfCalendarDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function format(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function DatePicker({
  value,
  onChange,
  minDate,
  maxDate,
  placeholder = "dd/mm/aaaa",
  className,
  invalid = false,
  "aria-label": ariaLabel,
}: {
  value: Date | null;
  onChange: (d: Date) => void;
  /** Borda vermelha (campo com erro). */
  invalid?: boolean;
  /** Dias antes disso ficam bloqueados. */
  minDate?: Date | null;
  /** Dias depois disso ficam bloqueados (sem limite se ausente). */
  maxDate?: Date | null;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const today = useMemo(() => isoToDate(calendarTodayIso()), []);
  const min = useMemo(() => (minDate ? startOfCalendarDay(minDate) : null), [minDate]);
  const max = useMemo(() => (maxDate ? startOfCalendarDay(maxDate) : null), [maxDate]);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const base = value ?? min ?? today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const base = value ?? (min && min > today ? min : today);
    setViewMonth(new Date(base.getFullYear(), base.getMonth(), 1));
  }, [open]); // value lido so no momento do open

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
      let left = rect.left;
      if (left + PANEL_WIDTH > vw - margin) left = Math.max(margin, vw - margin - PANEL_WIDTH);
      const top = Math.min(rect.bottom + 8, vh - margin - 80);
      setPanelPos({ top, left, maxHeight: Math.max(200, vh - top - margin) });
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
    for (let d = 1; d <= daysInMonth; d++) arr.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d));
    return arr;
  }, [viewMonth]);

  const blocked = (day: Date) => Boolean((min && day < min) || (max && day > max));
  const canMonthPrev = !min || new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 0) >= min;
  const canMonthProx = !max || new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1) <= max;

  const navBtn = (enabled: boolean) =>
    cn(
      "flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line text-t1",
      enabled ? "hover:bg-bg-3" : "cursor-not-allowed opacity-40",
    );

  const painel =
    open && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            style={{ top: panelPos.top, left: panelPos.left, width: PANEL_WIDTH, maxHeight: panelPos.maxHeight }}
            className="fixed z-[80] overflow-y-auto rounded-[var(--radius-vela-lg)] border border-line bg-bg-2 p-6 shadow-[var(--shadow-vela)]"
          >
            <div className="mb-3.5 flex items-center justify-between">
              <button
                type="button"
                disabled={!canMonthPrev}
                onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
                aria-label="Mês anterior"
                className={navBtn(canMonthPrev)}
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
                className={navBtn(canMonthProx)}
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
                const off = blocked(day);
                const selected = value != null && sameCalendarDay(value, day);
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    disabled={off}
                    onClick={() => {
                      onChange(day);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex h-9 min-w-0 items-center justify-center rounded-[9px] text-[12.5px] font-semibold transition-colors",
                      off ? "cursor-not-allowed text-t2 opacity-30" : selected ? "bg-acc text-white" : "text-t1 hover:bg-bg-3",
                    )}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={triggerRef} className={cn("relative flex w-full", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        className={cn(
          "flex h-[42px] w-full min-w-0 items-center gap-2.5 rounded-[11px] border bg-bg-inset px-3.5 text-left transition-colors",
          open ? "border-acc" : invalid ? "border-bad" : "border-line hover:border-acc",
        )}
      >
        <svg
          width="15"
          height="15"
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
        <span className={cn("min-w-0 truncate text-[13.5px] font-semibold", value ? "text-t0" : "text-t2")}>
          {value ? format(value) : placeholder}
        </span>
      </button>
      {painel}
    </div>
  );
}
