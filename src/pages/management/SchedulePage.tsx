import { useEffect, useMemo, useRef, useState } from "react";
import { Accordion, Alert, Badge, Button, Card, Checkbox, Modal, PageHeader, Select, useToast } from "@/components/ui";
import { ColorLegend, type LegendItem } from "@/components/wedash/ColorLegend";
import { ScheduleCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { MonthStep, monthNavBtn } from "@/pages/cash-close/MonthYearPicker";
import { HeaderFilters } from "@/pages/stock/shared";
import { useScopedStores } from "@/pages/operation/shared";
import { Icon, icons } from "@/pages/users/Icons";
import { cn } from "@/lib/cn";
import { filterCacheGet, filterCacheSet } from "@/lib/filterCache";
import { useFilterSkeleton } from "@/lib/useFilterSkeleton";
import { calendarTodayIso } from "@/data/wedash/clock";
import { addDays, addMonths, endOfMonth, isoToDate, startOfMonth } from "@/data/wedash/engine/format";
import { fetchGoals } from "@/data/wedash/goalsRepo";
import { scheduleStartMonth, type GoalSpan } from "@/data/wedash/goalMonths";
import { branchRoleLabel, fetchStoreSellers, fetchStoreShifts, isBranchTeamMember, type Store, type StoreSeller, type StoreShift } from "@/data/wedash/stores";
import { DOW_LABELS } from "@/data/wedash/storeHours";
import { applyDayChoices, buildCompOffSummary, dayEditOptions, defaultDayNeeds, generateMonth, inferCompLinks, issueFromUnknown, PREVIOUS_MONTH_EDIT, weekday, type CellChoice, type CompDue, type CompOffSummaryRow, type DayNeed, type DayStatus, type HolidayRule, type ScheduleGenerateIssue, type SchedulePattern, type Sex } from "@/data/wedash/scheduleGenerate";
import { holidayLabel, holidaysForStore, loadHolidaySeed, loadNationalHolidays, storePlace, type Holiday } from "@/data/wedash/scheduleHolidays";
import { deleteSchedule, fetchCompDue, fetchPreviousSnapshot, fetchSchedule, patchScheduleCompDue, saveManualDay, saveSchedule, type StoredDay, type StoredSchedule } from "@/data/wedash/scheduleRepo";
import { ScheduleWizard, type ScheduleWizardValue, type WizardBranch } from "./ScheduleWizard";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const VIEW_OPTIONS = [
  { id: "month", label: "Mês" },
  { id: "week", label: "Semana" },
  { id: "day", label: "Dia" },
] as const;
type ScheduleViewMode = (typeof VIEW_OPTIONS)[number]["id"];
const SCHEDULE_LEGEND: LegendItem[] = [
  { key: "work", color: "bg-ok", label: "T · Trabalha" },
  { key: "off", color: "bg-chip-gray", label: "F · Folga" },
  { key: "holiday", color: "bg-warn", label: "FE · Feriado trabalhado" },
  { key: "comp", color: "bg-info", label: "FC · Folga compensatória" },
];
const PATTERN_LABEL: Record<SchedulePattern, string> = {
  "6x1": "6×1",
  "5x2": "5×2",
  "4x3": "4×3",
  "12x36": "12×36",
};
const SHORT_WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function monthLabel(iso: string): string {
  const date = isoToDate(startOfMonth(iso));
  return `${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
}

/** Semana começando no domingo, como no Calendar. */
function startOfWeek(iso: string): string {
  return addDays(iso, -weekday(iso));
}

function dayHeading(iso: string): string {
  const date = isoToDate(iso);
  return `${date.getDate()} de ${MONTHS[date.getMonth()].toLocaleLowerCase("pt-BR")} de ${date.getFullYear()}`;
}

function viewHeading(mode: ScheduleViewMode, focusDay: string, monthStart: string): string {
  if (mode === "month") return monthLabel(monthStart);
  if (mode === "day") return dayHeading(focusDay);
  const from = startOfWeek(focusDay);
  const to = addDays(from, 6);
  const a = isoToDate(from);
  const b = isoToDate(to);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()} a ${b.getDate()} de ${MONTHS[a.getMonth()].toLocaleLowerCase("pt-BR")} de ${a.getFullYear()}`;
  }
  return `${dayHeading(from)} a ${dayHeading(to)}`;
}

/** Dias do mês civil — a grade sempre usa essa largura (semana/dia só destaca o foco). */
function monthDates(monthStart: string): string[] {
  const list: string[] = [];
  const last = endOfMonth(monthStart);
  for (let day = monthStart; day <= last; day = addDays(day, 1)) list.push(day);
  return list;
}

/** Recorte de foco (semana/dia) — usado para escurecer o que fica fora, sem tirar coluna. */
function focusDatesFor(mode: ScheduleViewMode, focusDay: string, monthStart: string): string[] {
  if (mode === "day") return [focusDay];
  if (mode === "week") {
    const from = startOfWeek(focusDay);
    return Array.from({ length: 7 }, (_, index) => addDays(from, index));
  }
  return monthDates(monthStart);
}

function dayTitle(iso: string, holiday: string | null): string {
  const date = isoToDate(iso);
  const label = `${date.getDate()} de ${MONTHS[date.getMonth()].toLowerCase()}`;
  return holiday ? `${label} · ${holiday}` : label;
}

function shortDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

/** Folgas compensatórias: apoio compacto sob a grade (fechado por padrão). */
function CompOffAccordion({ rows }: { rows: CompOffSummaryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4">
      <Accordion
        items={[
          {
            key: "comp-offs",
            title: (
              <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                <span>Folgas compensatórias</span>
                <span className="font-semibold text-t2">· {rows.length}</span>
              </span>
            ),
            content: (
              <div className="min-w-0 overflow-x-auto">
                <table className="w-full min-w-[36rem] border-collapse text-[12.5px]">
                  <thead>
                    <tr className="text-[11px] font-bold uppercase tracking-wide text-t2">
                      <th className="pb-2 pr-3 text-left font-bold">Pessoa</th>
                      <th className="pb-2 pr-3 text-left font-bold">Feriado trabalhado</th>
                      <th className="pb-2 pr-3 text-left font-bold">Folga compensatória</th>
                      <th className="pb-2 text-left font-bold">Prazo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.personId}|${row.holidayDate}`}>
                        <td className="py-1.5 pr-3 font-semibold tracking-wide text-t0">{row.personName.toLocaleUpperCase("pt-BR")}</td>
                        <td className="py-1.5 pr-3 text-t1">
                          <span className="font-semibold tabular-nums text-t0">{shortDate(row.holidayDate)}</span>
                          {row.holidayName ? <span className="mt-0.5 block text-[11px] text-t2">{row.holidayName}</span> : null}
                        </td>
                        <td className={cn("py-1.5 pr-3 font-semibold tabular-nums", row.offDate ? "text-info" : "text-t2")}>
                          {row.offDate ? shortDate(row.offDate) : "—"}
                        </td>
                        <td className="py-1.5 font-semibold tabular-nums text-t1">{shortDate(row.until)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

/** Dias do mês + vizinhos até cobrir a última FC (feriado → folga). */
function boardDatesWithNeighbors(
  monthStart: string,
  rows: CompOffSummaryRow[],
  prevHolidayDates: string[],
  showNeighbors: boolean,
): string[] {
  const monthEnd = endOfMonth(monthStart);
  let from = monthStart;
  let to = monthEnd;
  if (showNeighbors) {
    for (const row of rows) {
      if (row.offDate && row.offDate > to) to = row.offDate;
      if (row.offDate && row.offDate < from) from = row.offDate;
    }
    for (const holiday of prevHolidayDates) {
      if (holiday < from) from = holiday;
    }
    const floor = addMonths(monthStart, -1);
    const ceil = endOfMonth(addMonths(monthStart, 1));
    if (from < floor) from = floor;
    if (to > ceil) to = ceil;
  }
  const list: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) list.push(day);
  return list;
}

/**
 * FC planejada em `compDue` (ex.: mês seguinte ainda sem escala) —
 * pinta o tile mesmo sem linha em `store_schedule_day`.
 */
function plannedFcDays(rows: CompOffSummaryRow[], due: CompDue[], existing: StoredDay[]): StoredDay[] {
  const have = new Set(existing.map((row) => `${row.sellerId}|${row.day}`));
  const out: StoredDay[] = [];
  function add(personId: string, day: string) {
    const key = `${personId}|${day}`;
    if (have.has(key)) return;
    have.add(key);
    out.push({ sellerId: personId, day, status: "comp_off", origin: "generated" });
  }
  for (const row of rows) {
    if (row.offDate) add(row.personId, row.offDate);
  }
  for (const item of due) {
    if (item.day) add(item.personId, item.day);
  }
  return out;
}

type DayEditContext = {
  schedule: StoredSchedule;
  monthStart: string;
  monthEnd: string;
  monthDays: StoredDay[];
};

/**
 * Escala dona do dia (feriado → FC): se a FC cai no mês seguinte ainda sem escala,
 * edita pela escala do mês do feriado — não trava como “mês anterior”.
 */
function resolveDayEditContext(
  view: BranchSchedule,
  day: string,
  sellerId: string,
  hintMonth: string | null,
): DayEditContext | null {
  const dayMonth = startOfMonth(day);
  const prevMonth = addMonths(dayMonth, -1);

  function byCompDue(monthStart: string): (typeof view.months)[number] | null {
    const item = view.months.find((month) => month.monthStart === monthStart) ?? null;
    if (!item) return null;
    return item.schedule.compDue.some((due) => due.personId === sellerId && due.day === day) ? item : null;
  }

  function byLink(monthStart: string): (typeof view.months)[number] | null {
    const item = view.months.find((month) => month.monthStart === monthStart) ?? null;
    if (!item) return null;
    const monthEnd = endOfMonth(monthStart);
    const pool = view.days.filter((row) => {
      const month = startOfMonth(row.day);
      return month === monthStart || month === addMonths(monthStart, 1);
    });
    const planned = plannedFcDays(
      [],
      item.schedule.compDue,
      pool,
    );
    const links = inferCompLinks([...pool, ...planned], item.schedule.holidayRules, monthEnd);
    return links.some((link) => link.personId === sellerId && link.day === day) ? item : null;
  }

  let owner = byCompDue(prevMonth) ?? byLink(prevMonth);
  if (!owner && hintMonth && dayMonth !== hintMonth) {
    owner = view.months.find((month) => month.monthStart === hintMonth) ?? null;
  }
  if (!owner && hintMonth) {
    owner = byCompDue(hintMonth);
  }
  if (!owner) {
    owner = view.months.find((month) => month.monthStart === dayMonth) ?? null;
  }
  if (!owner && hintMonth) {
    owner = view.months.find((month) => month.monthStart === hintMonth) ?? null;
  }

  if (!owner) return null;

  const monthEnd = endOfMonth(owner.monthStart);
  const nextStart = addMonths(owner.monthStart, 1);
  const real = view.days.filter((row) => {
    const month = startOfMonth(row.day);
    return month === owner.monthStart || month === nextStart;
  });
  const summary = buildCompOffSummary({
    monthStart: owner.monthStart,
    monthDays: real.filter((row) => startOfMonth(row.day) === owner.monthStart),
    allDays: real,
    rules: owner.schedule.holidayRules,
    compDue: owner.schedule.compDue,
    people: view.people.map((person) => ({ id: person.id, name: person.name })),
  });
  const monthDays = [...real, ...plannedFcDays(summary, owner.schedule.compDue, real)];
  if (!monthDays.some((row) => row.sellerId === sellerId && row.day === day)) return null;
  return { schedule: owner.schedule, monthStart: owner.monthStart, monthEnd, monthDays };
}

/** Alinha `compDue` com as FC gravadas (mês seguinte editado na grade). */
function syncCompDue(compDue: CompDue[], days: StoredDay[], rules: HolidayRule[], monthEnd: string): CompDue[] {
  const links = inferCompLinks(days, rules, monthEnd);
  return compDue.map((due) => {
    const link = links.find((item) => item.personId === due.personId && item.holiday === due.holiday);
    if (link) return { ...due, day: link.day, until: link.deadline };
    const stillOwed = days.some((row) => row.sellerId === due.personId && row.day === due.holiday && row.status === "holiday_work");
    if (!stillOwed) return due;
    if (due.day && !days.some((row) => row.sellerId === due.personId && row.day === due.day && row.status === "comp_off")) {
      return { ...due, day: null };
    }
    return due;
  });
}

function statusChip(status: DayStatus, doublePay: boolean): { color: string; label: string } {
  if (status === "holiday_work" && doublePay) return { color: "bg-acc", label: "Pagamento em dobro" };
  if (status === "holiday_work") return { color: "bg-warn", label: "Feriado trabalhado" };
  if (status === "comp_off") return { color: "bg-info", label: "Folga compensatória" };
  if (status === "off") return { color: "bg-chip-gray", label: "Folga" };
  return { color: "bg-ok", label: "Trabalha" };
}

type SelectedPerson = { id: string; name: string; fixedOffDow: number | null; sex: Sex; groupId: string | null };

type BranchSchedule = {
  store: Store;
  people: StoreSeller[];
  shifts: StoreShift[];
  holidays: Holiday[];
  months: { monthStart: string; schedule: StoredSchedule }[];
  days: StoredDay[];
};

function monthStarts(from: string, to: string): string[] {
  const months: string[] = [];
  let cursor = startOfMonth(from);
  const last = startOfMonth(to);
  while (cursor <= last && months.length < 12) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return months;
}

function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let cursor = startOfMonth(from);
  const last = startOfMonth(to);
  while (cursor <= last && months.length < 4) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return months;
}

function scheduleCacheReady(c: BranchSchedule[] | null): c is BranchSchedule[] {
  return Array.isArray(c);
}

export function SchedulePage() {
  const { show } = useToast();
  const { session, storeRows } = useScopedStores();
  const many = storeRows.length > 1;
  const today = calendarTodayIso();
  const [monthStart, setMonthStart] = useState(() => startOfMonth(today));
  const [focusDay, setFocusDay] = useState(() => today);
  const [viewMode, setViewMode] = useState<ScheduleViewMode>("month");
  /** Mostra dias dos meses vizinhos até a última FC do mês. */
  const [showNeighbors, setShowNeighbors] = useState(true);
  const monthStartRef = useRef(monthStart);
  monthStartRef.current = monthStart;
  const rangeFrom = monthStart;
  const rangeTo = endOfMonth(monthStart);
  const [views, setViews] = useState<BranchSchedule[]>([]);
  const [error, setError] = useState(false);
  const [wizardStoreId, setWizardStoreId] = useState<string | null>(null);
  const [wizardMonth, setWizardMonth] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dayOpen, setDayOpen] = useState<{ storeId: string; day: string; sellerId: string; ownerMonth: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ storeId: string; monthStart: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const storeIds = storeRows.map((row) => row.id).join(",");
  const filterKey = `schedule:${session.tenantId}:${storeIds}:${monthStart}`;
  const { showSkeleton, settle } = useFilterSkeleton(filterKey);
  const reloadGen = useRef(0);
  const storesRef = useRef(storeRows);
  storesRef.current = storeRows;

  const prevMonth = addMonths(monthStart, -1);
  const nextMonth = addMonths(monthStart, 1);
  const weekStart = startOfWeek(focusDay);
  const boardDates = useMemo(() => monthDates(monthStart), [monthStart]);
  const focusDates = useMemo(() => focusDatesFor(viewMode, focusDay, monthStart), [viewMode, focusDay, monthStart]);
  const rangeHeading = viewHeading(viewMode, focusDay, monthStart);

  function goPrev() {
    if (viewMode === "month") {
      setMonthStart(prevMonth);
      setFocusDay(prevMonth === startOfMonth(today) ? today : prevMonth);
      return;
    }
    if (viewMode === "week") {
      const nextFocus = addDays(weekStart, -7);
      setFocusDay(nextFocus);
      setMonthStart(startOfMonth(nextFocus));
      return;
    }
    const nextFocus = addDays(focusDay, -1);
    setFocusDay(nextFocus);
    setMonthStart(startOfMonth(nextFocus));
  }

  function goNext() {
    if (viewMode === "month") {
      setMonthStart(nextMonth);
      setFocusDay(nextMonth === startOfMonth(today) ? today : nextMonth);
      return;
    }
    if (viewMode === "week") {
      const nextFocus = addDays(weekStart, 7);
      setFocusDay(nextFocus);
      setMonthStart(startOfMonth(nextFocus));
      return;
    }
    const nextFocus = addDays(focusDay, 1);
    setFocusDay(nextFocus);
    setMonthStart(startOfMonth(nextFocus));
  }
  const wizardView = views.find((view) => view.store.id === wizardStoreId) ?? null;
  const dayView = dayOpen ? views.find((view) => view.store.id === dayOpen.storeId && view.months.length > 0) ?? null : null;
  const dayEdit = dayOpen && dayView ? resolveDayEditContext(dayView, dayOpen.day, dayOpen.sellerId, dayOpen.ownerMonth) : null;
  const deleteView = deleteTarget ? views.find((view) => view.store.id === deleteTarget.storeId) ?? null : null;
  const deleteMonth = deleteView?.months.find((item) => item.monthStart === deleteTarget?.monthStart) ?? null;

  useEffect(() => {
    const ids = storeIds ? storeIds.split(",") : [];
    if (ids.length === 0) return;
    let stop = false;
    void fetchGoals({
      tenantId: session.tenantId,
      storeIds: ids,
      from: addMonths(today, -24),
      to: endOfMonth(addMonths(today, 14)),
      includeDrafts: true,
    }).then((rows) => {
      if (stop) return;
      const spans: GoalSpan[] = rows.map((row) => ({ startsOn: row.startsOn, endsOn: row.endsOn }));
      const open = scheduleStartMonth(today, spans);
      if (monthStartRef.current < open) {
        setMonthStart(open);
        setFocusDay(open === startOfMonth(today) ? today : open);
      }
    });
    return () => {
      stop = true;
    };
  }, [storeIds, session.tenantId, today]);

  useEffect(() => {
    const gen = ++reloadGen.current;
    const key = filterKey;
    const storesAtLoad = storesRef.current;
    if (storesAtLoad.length === 0) {
      setViews([]);
      settle(key);
      return;
    }
    let stop = false;
    setError(false);
    const cached = filterCacheGet<BranchSchedule[]>(key);
    if (scheduleCacheReady(cached)) {
      setViews(cached);
      settle(key);
    }
    void (async () => {
      try {
        // Anterior + atual + seguinte (setas e prévia das FC no mês seguinte).
        const covered = monthStarts(addMonths(rangeFrom, -1), endOfMonth(addMonths(rangeFrom, 1)));
        const years = [...new Set(covered.map((month) => Number(month.slice(0, 4))))];
        const [seed, ...nationals] = await Promise.all([loadHolidaySeed(), ...years.map((year) => loadNationalHolidays(year))]);
        const national = nationals.flat();
        const loaded = await Promise.all(
          storesAtLoad.map(async (store) => {
            const teamPromise = fetchStoreSellers(session.tenantId, [store.id]);
            const shiftPromise = fetchStoreShifts(session.tenantId, store.id);
            const stored = await Promise.all(covered.map((month) => fetchSchedule(store.id, month)));
            const [team, storeShifts] = await Promise.all([teamPromise, shiftPromise]);
            const active = (team.get(store.id) ?? []).filter((person) => isBranchTeamMember(person));
            const place = storePlace(store);
            const months = covered.flatMap((month, index) => {
              const schedule = stored[index]?.schedule;
              return schedule ? [{ monthStart: month, schedule }] : [];
            });
            const base = holidaysForStore(seed, years[0] ?? Number(rangeFrom.slice(0, 4)), place.uf, place.city, []).filter((row) => row.kind !== "national");
            const known = new Set(base.map((row) => `${row.date}|${row.name}`));
            const extras = months
              .flatMap((item) => item.schedule.holidayRules)
              .filter((rule) => !known.has(`${rule.date}|${rule.name}`))
              .map((rule) => ({ date: rule.date, name: rule.name }));
            const seen = new Set<string>();
            const local = years.flatMap((year) => holidaysForStore(seed, year, place.uf, place.city, extras).filter((row) => row.kind !== "national")).filter((row) => {
              const holidayKey = `${row.date}|${row.name}`;
              if (seen.has(holidayKey)) return false;
              seen.add(holidayKey);
              return true;
            });
            const holidays = [...national, ...local];
            const days = stored.flatMap((item) => item.days);
            return { store, people: active, shifts: storeShifts, holidays, months, days };
          }),
        );
        if (stop || gen !== reloadGen.current) return;
        filterCacheSet(key, loaded);
        setViews(loaded);
        settle(key);
      } catch {
        if (stop || gen !== reloadGen.current) return;
        setError(true);
        if (!scheduleCacheReady(cached)) settle(key);
      }
    })();
    return () => {
      stop = true;
    };
  }, [storeRows, rangeFrom, rangeTo, session.tenantId, reloadKey, filterKey, settle]);

  function scheduleOn(view: BranchSchedule, day: string): StoredSchedule | null {
    return view.months.find((item) => item.monthStart === startOfMonth(day))?.schedule ?? null;
  }

  function initialWizard(view: BranchSchedule, monthStart?: string | null): ScheduleWizardValue {
    const schedule = (monthStart ? view.months.find((item) => item.monthStart === monthStart)?.schedule : null) ?? scheduleOn(view, rangeFrom) ?? view.months[0]?.schedule ?? null;
    const people = view.people;
    const anchor = monthStart ?? startOfMonth(rangeFrom);
    const monthEnd = endOfMonth(anchor);
    return {
      scenario: "before_6x1",
      pattern: schedule?.pattern ?? "6x1",
      offMode: schedule?.offMode ?? "rotating",
      sundayMin: schedule?.sundayMin ?? 1,
      womenSunday: schedule?.womenSunday ?? "every_2",
      menSunday: schedule?.menSunday ?? "every_3",
      periodStart: schedule?.periodStart ?? anchor,
      periodEnd: schedule?.periodEnd ?? monthEnd,
      selectedIds: schedule ? schedule.people.map((person) => person.sellerId) : people.map((person) => person.id),
      sex: Object.fromEntries(people.map((person) => [person.id, schedule?.people.find((row) => row.sellerId === person.id)?.sex ?? "woman"])),
      fixedOff: Object.fromEntries(schedule?.people.filter((person) => person.fixedOffDow != null).map((person) => [person.sellerId, person.fixedOffDow ?? 1]) ?? []),
      dayNeeds: schedule && schedule.dayNeeds.length === 7 ? schedule.dayNeeds : defaultDayNeeds(),
      groupNeeds: schedule?.groupNeeds ?? [],
      holidayRules: schedule?.holidayRules ?? [],
      replaceManual: false,
    };
  }

  async function generateFor(storeId: string, value: ScheduleWizardValue, selected: SelectedPerson[], storeHolidays: Holiday[]) {
    const [year, monthNumber] = value.periodStart.split("-").map(Number);
    const [incoming, previousSnapshot] = await Promise.all([
      fetchCompDue(storeId, value.periodStart),
      fetchPreviousSnapshot(storeId, value.periodStart),
    ]);
    const offMode = selected.length > 0 && selected.every((person) => person.fixedOffDow != null) ? "fixed" : "rotating";
    const generated = generateMonth({
      year,
      month: monthNumber,
      from: value.periodStart,
      to: value.periodEnd,
      pattern: value.pattern,
      offMode,
      sundayMin: value.sundayMin,
      womenSunday: value.womenSunday,
      menSunday: value.menSunday,
      people: selected.map((person) => ({
        id: person.id,
        name: person.name,
        fixedOffDow: person.fixedOffDow,
        sex: person.sex,
        groupId: person.groupId,
      })),
      holidayDates: [],
      dayNeeds: value.dayNeeds,
      groupNeeds: value.groupNeeds,
      holidayRules: value.holidayRules,
      incomingComp: incoming,
      previousSnapshot,
    });
    const known = new Set(storeHolidays.filter((row) => row.kind !== "municipal").map((row) => row.date));
    const months = monthsBetween(value.periodStart, value.periodEnd);
    if (months.length === 0) throw new Error("Não foi possível gerar a escala.");
    let keptManualDays = 0;
    for (const start of months) {
      const saved = await saveSchedule({
        tenantId: session.tenantId,
        storeId,
        monthStart: start,
        pattern: value.pattern,
        offMode,
        sundayMin: value.sundayMin,
        extraHolidays: value.holidayRules.filter((rule) => !known.has(rule.date) && rule.date >= start && rule.date <= endOfMonth(start)).map((rule) => ({ day: Number(rule.date.slice(8, 10)), name: rule.name })),
        womenSunday: value.womenSunday,
        menSunday: value.menSunday,
        dayNeeds: value.dayNeeds,
        groupNeeds: value.groupNeeds,
        holidayRules: value.holidayRules,
        compDue: start === months[months.length - 1] ? generated.compDue : [],
        generatorSnapshot: start === months[0] ? generated.snapshot : null,
        people: selected.map((person) => ({ sellerId: person.id, fixedOffDow: person.fixedOffDow, sex: person.sex })),
        days: generated.days.filter((row) => row.date >= start && row.date <= endOfMonth(start)).map((row) => ({ sellerId: row.personId, day: row.date, status: row.status })),
        keepManual: !value.replaceManual,
        rangeStart: value.periodStart,
        rangeEnd: value.periodEnd,
      });
      keptManualDays += saved.keptManualDays;
    }
    const monthStart = months[0];
    const schedule: StoredSchedule = {
      id: "local",
      pattern: value.pattern,
      offMode,
      sundayMin: value.sundayMin,
      womenSunday: value.womenSunday,
      menSunday: value.menSunday,
      dayNeeds: value.dayNeeds,
      groupNeeds: value.groupNeeds,
      holidayRules: value.holidayRules,
      compDue: generated.compDue,
      generatorSnapshot: generated.snapshot,
      extraHolidays: [],
      periodStart: value.periodStart,
      periodEnd: value.periodEnd,
      people: selected.map((person) => ({ sellerId: person.id, fixedOffDow: person.fixedOffDow, sex: person.sex })),
    };
    const days: StoredDay[] = generated.days
      .filter((row) => row.date >= monthStart && row.date <= endOfMonth(monthStart))
      .map((row) => ({ sellerId: row.personId, day: row.date, status: row.status, origin: "generated" }));
    return { keptManualDays, monthStart, schedule, days };
  }

  async function onGenerate(storeId: string, value: ScheduleWizardValue): Promise<ScheduleGenerateIssue | void> {
    const view = views.find((item) => item.store.id === storeId);
    if (!view) {
      return {
        title: "Não foi possível gerar a escala",
        explanation: "A filial escolhida não está disponível neste momento.",
        howToFix: ["Feche o assistente, atualize a página e tente de novo."],
        fixes: [],
      };
    }
    setSaving(true);
    try {
      const selected = value.selectedIds.map((id) => ({
        id,
        name: view.people.find((person) => person.id === id)?.name ?? "Pessoa",
        fixedOffDow: value.fixedOff[id] > 0 ? value.fixedOff[id] : null,
        sex: value.sex[id] ?? "woman",
        groupId: null,
      }));
      const result = await generateFor(view.store.id, value, selected, view.holidays);
      const kept = result.keptManualDays;
      const editing = view.months.length > 0;
      setViews((current) => current.map((item) => {
        if (item.store.id !== view.store.id) return item;
        const months = [...item.months.filter((month) => month.monthStart !== result.monthStart), { monthStart: result.monthStart, schedule: result.schedule }];
        const days = [...item.days.filter((row) => startOfMonth(row.day) !== result.monthStart), ...result.days];
        return { ...item, months, days };
      }));
      if (monthStart !== result.monthStart) {
        setMonthStart(result.monthStart);
        setFocusDay(result.monthStart === startOfMonth(today) ? today : result.monthStart);
      }
      show(
        kept > 0
          ? `Escala salva. ${kept} ${kept === 1 ? "dia ajustado foi mantido" : "dias ajustados foram mantidos"}.`
          : editing
            ? "Alterações salvas."
            : "Escala criada.",
        "success",
      );
      setWizardStoreId(null);
      setWizardMonth(null);
      setReloadKey((value) => value + 1);
    } catch (caught) {
      return issueFromUnknown(caught);
    } finally {
      setSaving(false);
    }
  }

  async function saveDay(next: Array<{ storeId: string; days: { day: string; rows: StoredDay[] }[] }>) {
    await Promise.all(
      next.flatMap((item) =>
        item.days.map((group) =>
          saveManualDay({
            tenantId: session.tenantId,
            storeId: item.storeId,
            day: group.day,
            rows: group.rows.map((row) => ({ sellerId: row.sellerId, status: row.status, origin: row.origin })),
          }),
        ),
      ),
    );
    setViews((current) =>
      current.map((view) => {
        const saved = next.find((item) => item.storeId === view.store.id);
        if (!saved) return view;
        const touched = new Set(saved.days.map((group) => group.day));
        return { ...view, days: [...view.days.filter((row) => !touched.has(row.day)), ...saved.days.flatMap((group) => group.rows)] };
      }),
    );
  }

  const registered = views.filter((view) => view.months.some((item) => item.monthStart === monthStart));
  const withTeam = views.filter((view) => view.people.length > 0);
  const creatable = withTeam.filter((view) => !view.months.some((item) => item.monthStart === monthStart));
  const scheduleCards = registered
    .flatMap((view) => view.months.filter((item) => item.monthStart === monthStart).map((item) => ({ view, item })))
    .sort((a, b) => (a.view.store.tradeName || a.view.store.name).localeCompare(b.view.store.tradeName || b.view.store.name, "pt-BR"));

  function openCreate() {
    const target = creatable[0] ?? withTeam[0];
    if (!target) return;
    setWizardMonth(null);
    setWizardStoreId(target.store.id);
  }

  function registeredActions(view: BranchSchedule, monthStart: string) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          disabled={showSkeleton}
          onClick={() => setDeleteTarget({ storeId: view.store.id, monthStart })}
        >
          Apagar escala
        </Button>
        <Button
          size="sm"
          disabled={view.people.length === 0 || showSkeleton}
          onClick={() => {
            setWizardMonth(monthStart);
            setWizardStoreId(view.store.id);
          }}
        >
          Editar escala
        </Button>
      </>
    );
  }

  function toBranch(view: BranchSchedule): WizardBranch {
    return {
      id: view.store.id,
      name: view.store.tradeName || view.store.name,
      hasSchedule: view.months.length > 0,
      holidays: view.holidays.map((row) => ({ date: row.date, name: row.name })),
      closedDays: view.store.daysClosed,
      people: view.people.map((person) => ({
        id: person.id,
        name: person.name,
        role: branchRoleLabel(person.role),
        groupId: person.shiftId,
        groupName: view.shifts.find((shift) => shift.id === person.shiftId)?.name ?? "",
        code: person.code,
        storeId: view.store.id,
      })),
      initial: initialWizard(view, view.store.id === wizardStoreId ? wizardMonth : null),
    };
  }

  const wizardBranches = (wizardMonth != null && wizardView ? [wizardView] : withTeam).map((view) => toBranch(view));

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Escala" }]}
        title={monthLabel(monthStart)}
        actions={
          <HeaderFilters>
            {/* No celular: Mês/Semana/Dia + setas na mesma linha (padrão Apps → Calendar). */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1 rounded-[11px] border border-line bg-bg-2 p-1">
                {VIEW_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setViewMode(option.id)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition-colors",
                      viewMode === option.id ? "bg-acc text-white" : "text-t1 hover:text-t0",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={monthNavBtn}
                aria-label={viewMode === "month" ? "Mês anterior" : viewMode === "week" ? "Semana anterior" : "Dia anterior"}
                onClick={goPrev}
              >
                <MonthStep dir="anterior" />
              </button>
              <button
                type="button"
                className={monthNavBtn}
                aria-label={viewMode === "month" ? "Próximo mês" : viewMode === "week" ? "Próxima semana" : "Próximo dia"}
                onClick={goNext}
              >
                <MonthStep dir="proximo" />
              </button>
            </div>
            {storeRows.length > 0 ? (
              <Button icon={<Icon d={icons.plus} size={16} />} disabled={showSkeleton || withTeam.length === 0} onClick={openCreate}>
                Nova escala
              </Button>
            ) : null}
          </HeaderFilters>
        }
      />
      {storeRows.length > 0 ? <ColorLegend className="mb-4" mark="square" items={SCHEDULE_LEGEND} /> : null}
      {viewMode !== "month" && registered.length > 0 ? (
        <p className="mb-4 text-[13px] font-semibold text-t1">{rangeHeading}</p>
      ) : null}
      <div className="min-w-0 pb-8">
        {error ? <Alert className="mb-4" variant="danger" title="Não foi possível carregar a escala. Tente novamente." /> : null}
        {storeRows.length === 0 ? (
          <Card className="flex min-h-[280px] flex-col">
            <EmptyBlock icon="📅" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : showSkeleton ? (
          <ScheduleCardsSkeleton count={many ? 2 : 1} />
        ) : registered.length === 0 ? (
          <Card className="flex min-h-[280px] flex-col">
            <EmptyBlock
              icon="📅"
              title="Sem escala cadastrada"
              description="Nenhuma filial deste filtro tem escala neste mês."
              action={withTeam.length > 0 ? <Button size="sm" onClick={openCreate}>Criar escala</Button> : undefined}
            />
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {scheduleCards.map(({ view, item }) => {
                const monthDays = view.days.filter((row) => startOfMonth(row.day) === item.monthStart);
                const compRows = buildCompOffSummary({
                  monthStart: item.monthStart,
                  monthDays,
                  allDays: view.days,
                  rules: item.schedule.holidayRules,
                  compDue: item.schedule.compDue,
                  people: view.people.map((person) => ({ id: person.id, name: person.name })),
                });
                const prevMonth = addMonths(item.monthStart, -1);
                const prevItem = view.months.find((month) => month.monthStart === prevMonth);
                const prevCompRows = prevItem
                  ? buildCompOffSummary({
                      monthStart: prevMonth,
                      monthDays: view.days.filter((row) => startOfMonth(row.day) === prevMonth),
                      allDays: view.days,
                      rules: prevItem.schedule.holidayRules,
                      compDue: prevItem.schedule.compDue,
                      people: view.people.map((person) => ({ id: person.id, name: person.name })),
                    })
                  : [];
                const prevHolidayDates = prevCompRows
                  .filter((row) => row.offDate != null && row.offDate >= item.monthStart && row.offDate <= endOfMonth(item.monthStart))
                  .map((row) => row.holidayDate);
                const dates = showNeighbors
                  ? boardDatesWithNeighbors(item.monthStart, [...compRows, ...prevCompRows], prevHolidayDates, true)
                  : boardDates.filter((iso) => startOfMonth(iso) === item.monthStart);
                const active =
                  viewMode === "month"
                    ? undefined
                    : new Set(focusDates.filter((iso) => dates.includes(iso)));
                const realDays = view.days.filter((row) => dates.includes(row.day));
                const dueList = [
                  ...item.schedule.compDue,
                  ...(prevItem?.schedule.compDue ?? []),
                ];
                const boardDays = [
                  ...realDays,
                  ...plannedFcDays([...compRows, ...prevCompRows], dueList, realDays).filter((row) => dates.includes(row.day)),
                ];
                const boardSchedules = view.months.filter((month) =>
                  dates.some((iso) => startOfMonth(iso) === month.monthStart),
                );
                const storeLabel = view.store.tradeName || view.store.name;
                return (
                  <Card key={`${view.store.id}-${item.monthStart}`}>
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-[17px] font-extrabold leading-tight tracking-tight text-t0">
                          Escala {PATTERN_LABEL[item.schedule.pattern]}
                        </h3>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                          <Badge variant="neutral" className="max-w-full truncate">
                            {storeLabel}
                          </Badge>
                          <Badge variant="neutral">{monthLabel(item.monthStart).toLocaleUpperCase("pt-BR")}</Badge>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">{registeredActions(view, item.monthStart)}</div>
                    </div>
                    <div className="mb-3">
                      <Checkbox
                        checked={showNeighbors}
                        onChange={(event) => setShowNeighbors(event.target.checked)}
                        label="Ver também os dias dos meses vizinhos"
                      />
                    </div>
                    <ScheduleBoard
                      dates={dates}
                      activeDates={active}
                      today={today}
                      section={{
                        storeId: view.store.id,
                        holidays: view.holidays,
                        schedules: boardSchedules.length > 0 ? boardSchedules : [item],
                        days: boardDays,
                        people: view.people,
                      }}
                      onOpenDay={(day, sellerId) => setDayOpen({ storeId: view.store.id, day, sellerId, ownerMonth: item.monthStart })}
                    />
                    <CompOffAccordion rows={compRows} />
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
      {wizardStoreId && wizardBranches.length > 0 ? (
        <ScheduleWizard
          open
          onClose={() => { setWizardStoreId(null); setWizardMonth(null); }}
          stores={wizardBranches}
          storeId={wizardStoreId}
          saving={saving}
          onSubmit={onGenerate}
        />
      ) : null}
      {dayOpen && dayView && dayEdit ? (
        <DayEditor
          day={dayOpen.day}
          sellerId={dayOpen.sellerId}
          pattern={dayEdit.schedule.pattern}
          rules={dayEdit.schedule.holidayRules}
          dayNeeds={dayEdit.schedule.dayNeeds}
          monthEnd={dayEdit.monthEnd}
          monthDays={dayEdit.monthDays}
          names={new Map(dayView.people.map((person) => [person.id, person]))}
          onClose={() => setDayOpen(null)}
          onSave={async (next) => {
            const editedDays = next.flatMap((group) => group.rows);
            const merged = [
              ...dayEdit.monthDays.filter((row) => !editedDays.some((item) => item.sellerId === row.sellerId && item.day === row.day)),
              ...editedDays,
            ];
            const nextDue = syncCompDue(dayEdit.schedule.compDue, merged, dayEdit.schedule.holidayRules, dayEdit.monthEnd);
            await saveDay([{ storeId: dayView.store.id, days: next }]);
            if (JSON.stringify(nextDue) !== JSON.stringify(dayEdit.schedule.compDue)) {
              await patchScheduleCompDue(dayView.store.id, dayEdit.monthStart, nextDue);
              setViews((current) =>
                current.map((view) => {
                  if (view.store.id !== dayView.store.id) return view;
                  return {
                    ...view,
                    months: view.months.map((month) =>
                      month.monthStart === dayEdit.monthStart
                        ? { ...month, schedule: { ...month.schedule, compDue: nextDue } }
                        : month,
                    ),
                  };
                }),
              );
            }
            setDayOpen(null);
            show("Dia salvo.", "success");
          }}
        />
      ) : null}
      <Modal
        open={deleteMonth != null}
        onClose={() => setDeleteTarget(null)}
        title="Apagar escala"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!deleteView || !deleteMonth) return;
                void deleteSchedule(deleteView.store.id, deleteMonth.monthStart)
                  .then(() => {
                    setDeleteTarget(null);
                    show("Escala apagada.", "success");
                    setReloadKey((value) => value + 1);
                  })
                  .catch((caught) => show(caught instanceof Error ? caught.message : "Não foi possível apagar a escala.", "danger"));
              }}
            >
              Apagar
            </Button>
          </div>
        }
      >
        <p className="text-[13.5px] text-t1">
          Apaga a escala de {deleteMonth ? monthLabel(deleteMonth.monthStart) : ""}
          {many && deleteView ? ` de ${deleteView.store.tradeName || deleteView.store.name}` : " desta filial"}, inclusive os dias ajustados na mão.
          {deleteMonth && endOfMonth(deleteMonth.monthStart) < today ? " Este período já passou." : ""}
        </p>
      </Modal>
    </div>
  );
}

type ScheduleSection = {
  storeId: string;
  holidays: Holiday[];
  schedules: { monthStart: string; schedule: StoredSchedule }[];
  days: StoredDay[];
  people: StoreSeller[];
};

/** Tile leve: fundo soft + letra na cor do status (a grade não compete com o topo). */
function cellMark(status: DayStatus, doublePay: boolean): { letters: string; className: string; tight: boolean } {
  if (status === "holiday_work" && doublePay) {
    return { letters: "FE 2×", className: "bg-warn-soft text-warn", tight: true };
  }
  if (status === "holiday_work") return { letters: "FE", className: "bg-warn-soft text-warn", tight: false };
  if (status === "comp_off") return { letters: "FC", className: "bg-info-soft text-info", tight: false };
  if (status === "off") return { letters: "F", className: "bg-bg-3 text-t2", tight: false };
  return { letters: "T", className: "bg-ok-soft text-ok", tight: false };
}

function dayFloor(schedule: StoredSchedule, iso: string): { min: number; closed: boolean; exact: boolean } {
  const need = schedule.dayNeeds.find((row) => row.dow === weekday(iso));
  const holiday = schedule.holidayRules.find((row) => row.date === iso);
  if (holiday && !holiday.open) return { min: 0, closed: true, exact: false };
  if (holiday?.open) return { min: holiday.workers, closed: false, exact: true };
  if (need && !need.open) return { min: 0, closed: true, exact: false };
  return { min: need?.min ?? 0, closed: false, exact: false };
}

function daysByDate(days: StoredDay[]): Map<string, StoredDay[]> {
  const byDay = new Map<string, StoredDay[]>();
  for (const row of days) {
    const list = byDay.get(row.day) ?? [];
    list.push(row);
    byDay.set(row.day, list);
  }
  return byDay;
}

function isWorking(row: StoredDay | undefined): boolean {
  return row?.status === "work" || row?.status === "holiday_work";
}

function ScheduleBoard({
  dates,
  activeDates,
  today,
  section,
  onOpenDay,
  readOnly = false,
}: {
  dates: string[];
  /** Dias em foco (semana/dia). Fora disso a coluna permanece, só escurece. */
  activeDates?: Set<string>;
  today: string;
  section: ScheduleSection;
  onOpenDay: (day: string, sellerId: string) => void;
  readOnly?: boolean;
}) {
  const { schedules, people, holidays } = section;
  const byId = new Map(people.map((person) => [person.id, person]));
  const byDay = daysByDate(section.days);
  const focusAll = !activeDates || activeDates.size === 0 || activeDates.size === dates.length;
  function inFocus(iso: string) {
    return focusAll || activeDates!.has(iso);
  }
  function scheduleFor(iso: string): StoredSchedule | null {
    return schedules.find((item) => item.monthStart === startOfMonth(iso))?.schedule ?? null;
  }
  const ids = new Set<string>([...schedules.flatMap((item) => item.schedule.people.map((person) => person.sellerId)), ...section.days.map((row) => row.sellerId)]);
  function offDowOf(id: string, fixed: number | null): number | null {
    if (fixed != null) return fixed;
    const counts = Array.from({ length: 7 }, () => 0);
    for (const iso of dates) {
      const row = (byDay.get(iso) ?? []).find((item) => item.sellerId === id);
      if (row?.status === "off") counts[weekday(iso)] += 1;
    }
    let best = -1;
    let bestCount = 0;
    counts.forEach((count, dow) => {
      if (count > bestCount) {
        best = dow;
        bestCount = count;
      }
    });
    return bestCount > 0 ? best : null;
  }
  const roster = [...ids]
    .map((id) => {
      const person = byId.get(id);
      const fixed = schedules.flatMap((item) => item.schedule.people).find((row) => row.sellerId === id)?.fixedOffDow ?? null;
      const offDow = offDowOf(id, fixed);
      const role = person ? branchRoleLabel(person.role).toLocaleUpperCase("pt-BR") : "";
      const offLabel =
        offDow != null
          ? `FOLGA: ${DOW_LABELS[offDow as 0 | 1 | 2 | 3 | 4 | 5 | 6].toLocaleUpperCase("pt-BR")}`
          : "";
      const detail = [role, offLabel].filter(Boolean).join("  ·  ");
      return { id, name: (person?.name ?? "Pessoa").toLocaleUpperCase("pt-BR"), detail, code: person?.code ?? null };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  function presence(iso: string): { working: number; closed: boolean; min: number; exact: boolean } {
    const rows = byDay.get(iso) ?? [];
    const working = rows.filter((row) => isWorking(row)).length;
    const schedule = scheduleFor(iso);
    if (!schedule) return { working, closed: false, min: 0, exact: false };
    const floor = dayFloor(schedule, iso);
    return { working, closed: floor.closed, min: floor.min, exact: floor.exact };
  }

  /* Heatmap compacto: coluna Pessoa mais larga no desktop; no celular a grade rola na horizontal. */
  const dayCols = `repeat(${dates.length}, minmax(1.75rem, 1fr))`;
  const stickyPerson = "sticky left-0 z-[1] bg-bg-2 pr-2";
  const tile = "flex aspect-square w-full min-w-0 flex-col items-center justify-center rounded-[4px] font-extrabold leading-none";
  /** Fora do foco (semana/dia): mesma coluna, só escurece — padrão do Heatmap/calendário. */
  const dimOut = "opacity-[0.28]";
  /** Coluna de hoje: fundo vertical sutil em cabeçalho, células e rodapé. */
  const todayCol = "bg-acc/[0.08]";
  return (
    <div className="min-w-0 overflow-x-auto overscroll-x-contain">
      <div
        className="inline-grid w-max min-w-full gap-0.5 [--person-col:minmax(11rem,14rem)] lg:[--person-col:minmax(14rem,18rem)]"
        style={{ gridTemplateColumns: `var(--person-col) ${dayCols}` }}
      >
        <div className={cn(stickyPerson, "flex items-end pb-1 text-left text-[11px] font-bold uppercase tracking-wide text-t2")}>Pessoa</div>
        {dates.map((iso) => {
          const holiday = holidayLabel(holidays, iso);
          const day = Number(iso.slice(8));
          const focused = inFocus(iso);
          const isToday = iso === today;
          return (
            <div
              key={iso}
              title={holiday ?? dayTitle(iso, null)}
              className={cn(
                "rounded-[4px] px-0.5 pb-1 text-center",
                isToday && todayCol,
                !focused && dimOut,
                holiday && !isToday && focused && "text-warn",
              )}
            >
              <span
                className={cn(
                  "mx-auto inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
                  isToday ? "bg-acc text-white" : holiday && focused ? "text-warn" : "text-t0",
                )}
              >
                {day}
              </span>
              <span className="mt-0.5 block truncate text-[9px] font-bold uppercase text-t2">{SHORT_WEEK[weekday(iso)]}</span>
            </div>
          );
        })}
        {roster.map((person) => (
          <div key={person.id} className="contents">
            <div className={cn(stickyPerson, "flex min-w-0 items-center gap-2 py-0.5")}>
              <PersonAvatar name={person.name} employeeId={person.code} storeId={section.storeId} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold leading-tight text-t0">{person.name}</span>
                {person.detail ? <span className="mt-0.5 block truncate text-[11px] leading-snug text-t2">{person.detail}</span> : null}
              </span>
            </div>
            {dates.map((iso) => {
              const row = (byDay.get(iso) ?? []).find((item) => item.sellerId === person.id);
              const monthSchedule = scheduleFor(iso);
              const doublePay = monthSchedule?.holidayRules.some((rule) => rule.date === iso && rule.pay === "double") ?? false;
              const mark = row ? cellMark(row.status, doublePay) : null;
              const status = row ? statusChip(row.status, doublePay).label : "sem escala";
              const focused = inFocus(iso);
              const isToday = iso === today;
              const letterSize = mark?.tight ? "text-[8px]" : "text-[10px]";
              if (!row || !mark) {
                return (
                  <div
                    key={iso}
                    className={cn(tile, "bg-bg-3", isToday && todayCol, !focused && dimOut)}
                    aria-hidden
                  />
                );
              }
              /* Sem escala no mês do tile (FC planejada no vizinho): ainda abre o editor pela escala dona. */
              if (readOnly) {
                return (
                  <div
                    key={iso}
                    className={cn(tile, letterSize, mark.className, isToday && "ring-1 ring-inset ring-acc/35", !focused && dimOut)}
                    title={status}
                  >
                    {mark.letters}
                  </div>
                );
              }
              return (
                <button
                  key={iso}
                  type="button"
                  className={cn(
                    tile,
                    letterSize,
                    "cursor-pointer transition-opacity hover:opacity-90",
                    mark.className,
                    isToday && "ring-1 ring-inset ring-acc/35",
                    !focused && dimOut,
                  )}
                  aria-label={`${person.name}, ${Number(iso.slice(8))}: ${status}`}
                  onClick={() => onOpenDay(iso, person.id)}
                >
                  {mark.letters}
                </button>
              );
            })}
          </div>
        ))}
        <div className={cn(stickyPerson, "flex items-center py-1 text-left text-[11px] font-bold uppercase leading-tight tracking-wide text-t2")}>Pessoas presentes</div>
        {dates.map((iso) => {
          const face = presence(iso);
          const title = face.closed ? "A loja fecha neste dia" : face.exact ? "Quantidade exata neste feriado" : "Mínimo do dia";
          const sub = face.closed ? "Fechado" : face.min > 0 ? `${face.exact ? "Exato" : "Mínimo"} ${face.min}` : "";
          const focused = inFocus(iso);
          const isToday = iso === today;
          return (
            <div
              key={iso}
              title={title}
              className={cn("min-w-0 rounded-[4px] px-0.5 py-1 text-center", isToday && todayCol, !focused && dimOut)}
            >
              <span className={cn("block text-[11px] font-bold tabular-nums", face.closed ? "text-t2" : "text-t1")}>{face.closed ? "—" : face.working}</span>
              {sub ? <span className="block truncate text-[9px] leading-tight text-t2">{sub}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function choiceOf(status: DayStatus): CellChoice {
  if (status === "off") return "off";
  if (status === "comp_off") return "comp_off";
  return "work";
}

function DayEditor({
  day,
  sellerId,
  pattern,
  rules,
  dayNeeds,
  monthEnd,
  monthDays,
  names,
  onClose,
  onSave,
}: {
  day: string;
  sellerId: string;
  pattern: SchedulePattern;
  rules: HolidayRule[];
  dayNeeds: DayNeed[];
  /** Fim do mês da escala dona (feriado), não necessariamente do dia clicado. */
  monthEnd: string;
  monthDays: StoredDay[];
  names: Map<string, StoreSeller>;
  onClose: () => void;
  onSave: (next: { day: string; rows: StoredDay[] }[]) => Promise<void>;
}) {
  const links = inferCompLinks(monthDays, rules, monthEnd);
  const roster = monthDays.filter((row) => row.day === day && row.sellerId === sellerId);
  const personName = (names.get(sellerId)?.name ?? "Pessoa").toLocaleUpperCase("pt-BR");
  const [drafts, setDrafts] = useState<Record<string, { value: CellChoice; holiday: string }>>(() =>
    Object.fromEntries(
      roster.map((row) => {
        const options = dayEditOptions({ day, days: monthDays, rules, dayNeeds, pattern, personId: row.sellerId, monthEnd });
        const linked = links.find((item) => item.personId === row.sellerId && item.day === day);
        return [row.sellerId, { value: choiceOf(row.status), holiday: linked?.holiday ?? options.holidays[0]?.date ?? "" }];
      }),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function apply() {
    const edited = applyDayChoices({
      day,
      days: monthDays,
      rules,
      dayNeeds,
      pattern,
      monthEnd,
      choices: roster.map((row) => ({ personId: row.sellerId, value: drafts[row.sellerId]?.value ?? choiceOf(row.status), holiday: drafts[row.sellerId]?.holiday || null })),
    });
    if (edited.error) {
      setSaveError(edited.error);
      return;
    }
    const touched = new Set<string>();
    for (const row of edited.days) {
      const before = monthDays.find((item) => item.sellerId === row.sellerId && item.day === row.day);
      if (!before || before.status !== row.status || before.origin !== row.origin) touched.add(row.day);
    }
    setBusy(true);
    setSaveError(null);
    void onSave([...touched].map((iso) => ({ day: iso, rows: edited.days.filter((row) => row.day === iso) })))
      .catch((caught) => setSaveError(caught instanceof Error && caught.message ? caught.message : "Não foi possível salvar o dia."))
      .finally(() => setBusy(false));
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={`${personName} · ${shortDate(day)}`}
      footer={
        <div className="flex w-full min-w-0 flex-col gap-3">
          {saveError ? <Alert variant="danger" title={saveError} /> : null}
          <div className="flex justify-end gap-2.5">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button disabled={busy} onClick={apply}>Aplicar</Button>
          </div>
        </div>
      }
    >
      {roster.map((row) => {
        const options = dayEditOptions({ day, days: monthDays, rules, dayNeeds, pattern, personId: row.sellerId, monthEnd });
        const draft = drafts[row.sellerId] ?? { value: choiceOf(row.status), holiday: "" };
        return (
          <div key={row.sellerId} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-t0">
              O que esta pessoa fará neste dia?
              <Select
                aria-label={`O que ${personName} fará neste dia?`}
                value={draft.value}
                disabled={options.locked || busy}
                onChange={(event) => {
                  const value = event.target.value as CellChoice;
                  setDrafts((current) => ({ ...current, [row.sellerId]: { ...draft, value } }));
                }}
              >
                <option value="work">Trabalhar</option>
                <option value="off">Folgar</option>
                <option value="comp_off" disabled={!options.fcEnabled}>Folga compensatória</option>
              </Select>
            </label>
            {draft.value === "comp_off" && options.fcEnabled ? (
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-t0">
                Qual feriado gerou esta folga?
                <Select
                  aria-label={`Essa folga de ${personName} é por qual feriado?`}
                  value={draft.holiday}
                  disabled={busy}
                  onChange={(event) => setDrafts((current) => ({ ...current, [row.sellerId]: { ...draft, holiday: event.target.value } }))}
                >
                  {options.holidays.map((rule) => (
                    <option key={rule.date} value={rule.date}>{shortDate(rule.date)} · {rule.name}</option>
                  ))}
                </Select>
              </label>
            ) : null}
            {options.locked ? <p className="text-[12.5px] text-t2">{PREVIOUS_MONTH_EDIT}</p> : null}
            <p className="text-[12.5px] text-t2">Ao alterar uma folga compensatória, a folga anterior vinculada ao feriado também será atualizada.</p>
          </div>
        );
      })}
    </Modal>
  );
}