import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { dateToIso, isoToDate, startOfMonth } from "@/lib/format";

const MONTHS_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function monthYearLabel(iso: string): string {
  const d = isoToDate(startOfMonth(iso));
  return `${MONTHS_PT[d.getMonth()]} de ${d.getFullYear()}`;
}

function pageEndYear(year: number, todayYear: number): number {
  const target = Math.min(year, todayYear);
  return todayYear - Math.floor((todayYear - target) / 12) * 12;
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
