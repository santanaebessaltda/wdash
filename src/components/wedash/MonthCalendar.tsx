import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { isoToDate } from "@/lib/format";

const WEEK = [
  { longo: "Domingo", curto: "D" },
  { longo: "Segunda-feira", curto: "S" },
  { longo: "Terça-feira", curto: "T" },
  { longo: "Quarta-feira", curto: "Q" },
  { longo: "Quinta-feira", curto: "Q" },
  { longo: "Sexta-feira", curto: "S" },
  { longo: "Sábado", curto: "S" },
];

const cell =
  "relative flex h-full min-h-[84px] w-full min-w-0 flex-col items-stretch justify-start border-b border-r border-line p-1.5 text-left sm:min-h-[110px] sm:p-2";

/** Grade do mês usada em Fechamento, Sangrias e Informe de vendas. */
export function MonthCalendar({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[18px] border border-line bg-bg-2 shadow-[var(--shadow-vela)]">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-7">
          {WEEK.map((d) => (
            <div key={d.longo} className="border-b border-line px-1 py-3 text-center text-[10px] font-bold leading-tight text-t2 sm:text-[11px]">
              <span className="hidden sm:inline">{d.longo}</span>
              <span className="sm:hidden uppercase">{d.curto}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">{children}</div>
      </div>
    </div>
  );
}

export function blankDayClass(index: number): string {
  return cn(cell, (index + 1) % 7 === 0 && "border-r-0", "bg-bg-1/30");
}

/** Número, valor e badges no mesmo lugar. A caixa fica no canto e não abre o dia. */
export function DayFace({
  index,
  iso,
  today,
  amount,
  badges,
  selected = false,
  openable = false,
  openLabel,
  title,
  check,
  onOpen,
}: {
  index: number;
  iso: string;
  today: string;
  amount?: string | null;
  badges?: ReactNode;
  selected?: boolean;
  openable?: boolean;
  openLabel: string;
  title?: string;
  check?: { checked: boolean; label: string; onToggle: () => void } | null;
  onOpen?: () => void;
}) {
  const futuro = iso > today;
  return (
    <div
      title={title}
      className={cn(
        cell,
        (index + 1) % 7 === 0 && "border-r-0",
        selected && "bg-acc-soft/40",
        openable && (selected ? "hover:bg-acc-soft/40" : "hover:bg-bg-3"),
      )}
    >
      {selected ? <span aria-hidden className="pointer-events-none absolute inset-0 z-10 border border-acc" /> : null}
      {openable ? (
        <button type="button" className="absolute inset-0 z-0" aria-label={openLabel} onClick={onOpen} />
      ) : null}
      <div className={cn("relative z-10 flex min-h-0 w-full flex-1 flex-col", openable && "pointer-events-none")}>
        <span className="flex w-full items-start justify-between gap-1">
          <span
            className={cn(
              "inline-flex h-6 w-6 shrink-0 items-center justify-center self-start rounded-full text-[12px] font-bold",
              iso === today ? "bg-acc text-white" : futuro ? "text-t2" : "text-t1",
            )}
          >
            {isoToDate(iso).getDate()}
          </span>
          {check ? (
            <input
              type="checkbox"
              aria-label={check.label}
              checked={check.checked}
              className="pointer-events-auto mt-0.5 h-4 w-4 shrink-0"
              style={{ accentColor: "var(--acc)" }}
              onClick={(e) => e.stopPropagation()}
              onChange={() => check.onToggle()}
            />
          ) : null}
        </span>
        {amount || badges ? (
          <div className="mt-1.5 w-full min-w-0">
            {amount ? <p className="whitespace-nowrap font-mono text-[12px] font-extrabold text-t1 sm:text-[13px]">{amount}</p> : null}
            {badges}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function DayMetrics({ items }: { items: Array<{ label: string; value: string; className?: string; color?: string }> }) {
  const cols =
    items.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : items.length === 3 ? "sm:grid-cols-3" : items.length === 2 ? "sm:grid-cols-2" : "";
  return (
    <div className={cn("mb-4 grid grid-cols-1 gap-2", cols)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-[14px] border border-line bg-bg-1 px-3 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-t2">{item.label}</p>
          <p className={cn("mt-1 truncate font-mono text-lg font-extrabold text-t0", item.className)} style={item.color ? { color: item.color } : undefined}>
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}
