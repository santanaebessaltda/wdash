import { useState } from "react";
import { Button, PageHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { calendarEvents, swatch } from "@/data/apps";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "./icons";

const VIEWS = ["Month", "Week", "Day"] as const;
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// July 2026: starts on a Wednesday (index 3), 31 days. Today = Jul 10.
const MONTH_START_OFFSET = 3;
const DAYS_IN_MONTH = 31;
const TODAY = 10;

export function Calendar() {
  const [view, setView] = useState<(typeof VIEWS)[number]>("Month");

  // Build 6x7 grid of cells (leading/trailing nulls for padding).
  const cells: (number | null)[] = [];
  for (let i = 0; i < MONTH_START_OFFSET; i++) cells.push(null);
  for (let d = 1; d <= DAYS_IN_MONTH; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const eventsByDay = calendarEvents.reduce<Record<number, typeof calendarEvents>>((acc, e) => {
    (acc[e.day] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        title="July 2026"
        crumbs={[{ label: "Apps" }, { label: "Calendar" }]}
        actions={
          <>
            <div className="flex gap-1 rounded-[11px] border border-line bg-bg-2 p-1">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition-colors",
                    view === v ? "bg-acc text-white" : "text-t1 hover:text-t0",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <button aria-label="Previous month" className="flex h-10 w-10 items-center justify-center rounded-[11px] border border-line bg-bg-2 text-t1 hover:border-line-2 hover:text-t0">
              <ChevronLeftIcon size={16} />
            </button>
            <button aria-label="Next month" className="flex h-10 w-10 items-center justify-center rounded-[11px] border border-line bg-bg-2 text-t1 hover:border-line-2 hover:text-t0">
              <ChevronRightIcon size={16} />
            </button>
            <Button icon={<PlusIcon size={16} />}>New event</Button>
          </>
        }
      />

      {view === "Month" && <MonthView cells={cells} eventsByDay={eventsByDay} />}
      {view === "Week" && <WeekView eventsByDay={eventsByDay} />}
      {view === "Day" && <DayView events={eventsByDay[TODAY] ?? []} />}
    </div>
  );
}

function MonthView({ cells, eventsByDay }: { cells: (number | null)[]; eventsByDay: Record<number, typeof calendarEvents> }) {
  return (
    <div className="overflow-hidden rounded-[18px] border border-line bg-bg-2 shadow-[var(--shadow-vela)]">
      <div className="grid grid-cols-7">
        {DAY_LABELS.map((d) => (
          <div key={d} className="border-b border-line px-2 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-t2">
            <span className="hidden sm:inline">{d}</span>
            <span className="sm:hidden">{d[0]}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          const events = day ? eventsByDay[day] ?? [] : [];
          const isToday = day === TODAY;
          return (
            <div
              key={i}
              className={cn(
                "min-h-[84px] border-b border-r border-line p-1.5 sm:min-h-[110px] sm:p-2",
                (i + 1) % 7 === 0 && "border-r-0",
                !day && "bg-bg-1/30",
              )}
            >
              {day && (
                <>
                  <span
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold",
                      isToday ? "bg-acc text-white" : "text-t1",
                    )}
                  >
                    {day}
                  </span>
                  <div className="mt-1.5 flex flex-col gap-1">
                    {events.slice(0, 3).map((e, ei) => (
                      <div
                        key={ei}
                        className={cn("truncate rounded-md px-1.5 py-1 text-[10px] font-semibold text-white sm:text-[11px]", swatch(e.swatch).dot)}
                      >
                        {e.title}
                      </div>
                    ))}
                    {events.length > 3 && <span className="px-1 text-[10px] font-semibold text-t2">+{events.length - 3} more</span>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ eventsByDay }: { eventsByDay: Record<number, typeof calendarEvents> }) {
  // Week containing today (Jul 5 - 11, 2026: Sun Jul 5 .. Sat Jul 11).
  const weekDays = [5, 6, 7, 8, 9, 10, 11];
  return (
    <div className="overflow-hidden rounded-[18px] border border-line bg-bg-2 shadow-[var(--shadow-vela)]">
      <div className="grid grid-cols-7">
        {weekDays.map((day, i) => (
          <div key={day} className={cn("border-b border-r border-line p-3 text-center", i === 6 && "border-r-0")}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-t2">{DAY_LABELS[i]}</p>
            <span
              className={cn(
                "mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold",
                day === TODAY ? "bg-acc text-white" : "text-t0",
              )}
            >
              {day}
            </span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weekDays.map((day, i) => (
          <div key={day} className={cn("min-h-[280px] space-y-1.5 border-r border-line p-2", i === 6 && "border-r-0")}>
            {(eventsByDay[day] ?? []).map((e, ei) => (
              <div key={ei} className={cn("rounded-md px-2 py-1.5 text-[11px] font-semibold text-white", swatch(e.swatch).dot)}>
                {e.title}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DayView({ events }: { events: typeof calendarEvents }) {
  const hours = ["8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM"];
  return (
    <div className="overflow-hidden rounded-[18px] border border-line bg-bg-2 shadow-[var(--shadow-vela)]">
      <div className="border-b border-line px-5 py-3.5">
        <p className="text-[15px] font-bold text-t0">Friday, July 10</p>
        <p className="mt-0.5 text-xs text-t2">{events.length} events scheduled</p>
      </div>
      <div>
        {hours.map((h, i) => {
          const event = events[i - 1];
          return (
            <div key={h} className="flex gap-4 border-b border-line px-5 py-3 last:border-b-0">
              <span className="w-14 shrink-0 pt-0.5 font-mono text-[11.5px] font-semibold text-t2">{h}</span>
              <div className="flex-1">
                {event && (
                  <div className={cn("rounded-lg px-3 py-2 text-[12.5px] font-semibold text-white", swatch(event.swatch).dot)}>{event.title}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
