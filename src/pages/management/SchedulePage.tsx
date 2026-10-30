import { useEffect, useMemo, useRef, useState } from "react";
import { Accordion, Alert, Badge, Button, Card, Checkbox, DateRangePicker, Modal, PageHeader, Select, useToast } from "@/components/ui";
import type { DateRange, DateRangeChangeMeta } from "@/components/ui/DateRangePicker";
import { ColorLegend, type LegendItem } from "@/components/wedash/ColorLegend";
import { ScheduleCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import {
  applyPeriodDateChange,
  dateRangeFromManagementPeriod,
  managementScheduleWindow,
  periodActivePresetId,
  periodDisplayLabel,
} from "@/pages/dashboard/periodPicker";
import { useScope } from "@/pages/dashboard/useScope";
import { HeaderFilters } from "@/pages/stock/shared";
import { useScopedStores } from "@/pages/operation/shared";
import { Icon, icons } from "@/pages/users/Icons";
import { cn } from "@/lib/cn";
import { filterCacheGet, filterCacheSet } from "@/lib/filterCache";
import { useFilterSkeleton } from "@/lib/useFilterSkeleton";
import { dateToIso } from "@/lib/format";
import { calendarTodayIso } from "@/data/wedash/clock";
import { addDays, addMonths, endOfMonth, isoToDate, startOfMonth } from "@/data/wedash/engine/format";
import { fetchGoals } from "@/data/wedash/goalsRepo";
import { scheduleStartMonth, type GoalSpan } from "@/data/wedash/goalMonths";
import { branchRoleLabel, fetchStoreSellers, fetchStoreShifts, isBranchTeamMember, type Store, type StoreSeller, type StoreShift } from "@/data/wedash/stores";
import { applyDayChoices, buildCompOffSummary, COMP_OFF_CLEAR_HINT, dayEditOptions, defaultDayNeeds, eligibleCompOffDays, generateMonth, inferCompLinks, issueFromUnknown, weekday, type CellChoice, type CompDue, type CompOffSummaryRow, type DayNeed, type DayStatus, type HolidayRule, type ScheduleGenerateIssue, type SchedulePattern, type Sex } from "@/data/wedash/scheduleGenerate";
import { holidayLabel, holidaysForStore, loadHolidaySeed, loadNationalHolidays, storePlace, type Holiday } from "@/data/wedash/scheduleHolidays";
import { deleteSchedule, fetchCompDue, fetchPreviousSnapshot, fetchSchedule, patchScheduleCompDue, replaceSchedulePerson, saveManualDay, saveSchedule, type StoredDay, type StoredSchedule } from "@/data/wedash/scheduleRepo";
import { ScheduleWizard, type ScheduleWizardValue, type WizardBranch } from "./ScheduleWizard";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
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

/** Dias do mês civil — largura da grade de cada card. */
function monthDates(monthStart: string): string[] {
  const list: string[] = [];
  const last = endOfMonth(monthStart);
  for (let day = monthStart; day <= last; day = addDays(day, 1)) list.push(day);
  return list;
}

/** Escala pode olhar meses futuros (meta / geração): calendário até +12 meses. */
function maxPickerDate(today: string): Date {
  const d = isoToDate(today);
  return isoToDate(endOfMonth(dateToIso(new Date(d.getFullYear(), d.getMonth() + 12, 1))));
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
  /** Regras do mês dono + do anterior (FC no mês seguinte ainda enxerga o feriado). */
  rules: HolidayRule[];
  compDue: CompDue[];
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
    const links = inferCompLinks([...pool, ...planned], item.schedule.holidayRules, monthEnd, item.schedule.compDue);
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
  const prevStart = addMonths(owner.monthStart, -1);
  const nextStart = addMonths(owner.monthStart, 1);
  const prevSchedule = view.months.find((month) => month.monthStart === prevStart)?.schedule ?? null;
  const real = view.days.filter((row) => {
    const month = startOfMonth(row.day);
    return month === prevStart || month === owner.monthStart || month === nextStart;
  });
  const rules = [...(prevSchedule?.holidayRules ?? []), ...owner.schedule.holidayRules];
  const compDue = [...(prevSchedule?.compDue ?? []), ...owner.schedule.compDue];
  const summary = buildCompOffSummary({
    monthStart: owner.monthStart,
    monthDays: real.filter((row) => startOfMonth(row.day) === owner.monthStart),
    allDays: real,
    rules: owner.schedule.holidayRules,
    compDue: owner.schedule.compDue,
    people: (view.directory ?? view.people).map((person) => ({ id: person.id, name: person.name })),
  });
  const monthDays = [...real, ...plannedFcDays(summary, compDue, real)];
  if (!monthDays.some((row) => row.sellerId === sellerId && row.day === day)) return null;
  return { schedule: owner.schedule, monthStart: owner.monthStart, monthEnd, monthDays, rules, compDue };
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
  /** Equipe ativa (wizard e candidatos a herdar a vaga). */
  people: StoreSeller[];
  /** Ativos + desligados ainda no ERP (nome na grade quando a vaga ficou órfã). */
  directory: StoreSeller[];
  shifts: StoreShift[];
  holidays: Holiday[];
  months: { monthStart: string; schedule: StoredSchedule }[];
  days: StoredDay[];
};

type ReplaceTarget = {
  storeId: string;
  fromSellerId: string;
  fromName: string;
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
  return Array.isArray(c) && c.every((view) => Array.isArray(view.people) && Array.isArray(view.directory) && Array.isArray(view.months) && Array.isArray(view.days));
}

export function SchedulePage() {
  const { show } = useToast();
  const { session, storeRows } = useScopedStores();
  const { scope, setScope } = useScope();
  const many = storeRows.length > 1;
  const today = calendarTodayIso();
  const janela = useMemo(() => managementScheduleWindow(scope.period, today), [scope.period, today]);
  const dateRange = useMemo(() => dateRangeFromManagementPeriod(scope.period), [scope.period]);
  const rangeFrom = startOfMonth(janela.from);
  const rangeTo = endOfMonth(janela.to);
  const windowMonths = useMemo(() => monthStarts(rangeFrom, janela.to), [rangeFrom, janela.to]);
  const windowMonthSet = useMemo(() => new Set(windowMonths), [windowMonths]);
  const monthStart = windowMonths[0] ?? rangeFrom;
  /** Mostra dias dos meses vizinhos até a última FC do mês. */
  const [showNeighbors, setShowNeighbors] = useState(true);
  const monthStartRef = useRef(monthStart);
  monthStartRef.current = monthStart;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [views, setViews] = useState<BranchSchedule[]>([]);
  const [error, setError] = useState(false);
  const [wizardStoreId, setWizardStoreId] = useState<string | null>(null);
  const [wizardMonth, setWizardMonth] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dayOpen, setDayOpen] = useState<{ storeId: string; day: string; sellerId: string; ownerMonth: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ storeId: string; monthStart: string } | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<ReplaceTarget | null>(null);
  const [replaceWithId, setReplaceWithId] = useState("");
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const storeIds = storeRows.map((row) => row.id).join(",");
  const filterKey = `schedule:${session.tenantId}:${storeIds}:${janela.from}:${janela.to}`;
  const { showSkeleton, settle } = useFilterSkeleton(filterKey);
  const reloadGen = useRef(0);
  const storesRef = useRef(storeRows);
  storesRef.current = storeRows;

  function onDateChange(r: DateRange, meta?: DateRangeChangeMeta) {
    setScope(applyPeriodDateChange(scope, r, meta));
  }

  function focusMonth(nextMonth: string) {
    const start = startOfMonth(nextMonth);
    const current = scopeRef.current;
    if (start === startOfMonth(today)) {
      setScope({ ...current, period: { kind: "thisMonth" } });
      return;
    }
    setScope({
      ...current,
      period: { kind: "custom", start, end: endOfMonth(start) },
    });
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
      if (monthStartRef.current < open) focusMonth(open);
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
        // Vizinhos do intervalo (prévia das FC no mês anterior/seguinte).
        const covered = monthStarts(addMonths(rangeFrom, -1), endOfMonth(addMonths(startOfMonth(janela.to), 1)));
        const years = [...new Set(covered.map((month) => Number(month.slice(0, 4))))];
        const [seed, ...nationals] = await Promise.all([loadHolidaySeed(), ...years.map((year) => loadNationalHolidays(year))]);
        const national = nationals.flat();
        const loaded = await Promise.all(
          storesAtLoad.map(async (store) => {
            const teamPromise = fetchStoreSellers(session.tenantId, [store.id]);
            const shiftPromise = fetchStoreShifts(session.tenantId, store.id);
            const stored = await Promise.all(covered.map((month) => fetchSchedule(store.id, month)));
            const [team, storeShifts] = await Promise.all([teamPromise, shiftPromise]);
            const directory = team.get(store.id) ?? [];
            const active = directory.filter((person) => isBranchTeamMember(person));
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
            return { store, people: active, directory, shifts: storeShifts, holidays, months, days };
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
  }, [storeRows, rangeFrom, rangeTo, janela.to, session.tenantId, reloadKey, filterKey, settle]);

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
        // Folga útil no 6×1 é automática (pós-domingo); o wizard não oferece dia fixo.
        fixedOffDow: null,
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
      if (!windowMonths.includes(result.monthStart)) focusMonth(result.monthStart);
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
        const patch = saved.days.flatMap((group) => group.rows);
        const keys = new Set(patch.map((row) => `${row.sellerId}|${row.day}`));
        return { ...view, days: [...view.days.filter((row) => !keys.has(`${row.sellerId}|${row.day}`)), ...patch] };
      }),
    );
  }

  const registered = views.filter((view) => view.months.some((item) => windowMonthSet.has(item.monthStart)));
  const withTeam = views.filter((view) => view.people.length > 0);
  const creatable = withTeam.filter((view) => !view.months.some((item) => item.monthStart === monthStart));
  const scheduleCards = registered
    .flatMap((view) => view.months.filter((item) => windowMonthSet.has(item.monthStart)).map((item) => ({ view, item })))
    .sort(
      (a, b) =>
        a.item.monthStart.localeCompare(b.item.monthStart) ||
        (a.view.store.tradeName || a.view.store.name).localeCompare(b.view.store.tradeName || b.view.store.name, "pt-BR"),
    );

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
        title="Escala"
        actions={
          <HeaderFilters>
            <DateRangePicker
              value={dateRange}
              onChange={onDateChange}
              displayLabel={periodDisplayLabel(scope.period)}
              activePresetId={periodActivePresetId(scope.period)}
              maxDate={maxPickerDate(today)}
            />
            {storeRows.length > 0 ? (
              <Button icon={<Icon d={icons.plus} size={16} />} disabled={showSkeleton || withTeam.length === 0} onClick={openCreate}>
                Nova escala
              </Button>
            ) : null}
          </HeaderFilters>
        }
      />
      {storeRows.length > 0 ? <ColorLegend className="mb-4" mark="square" items={SCHEDULE_LEGEND} /> : null}
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
                const nameList = (view.directory ?? view.people).map((person) => ({ id: person.id, name: person.name }));
                const compRows = buildCompOffSummary({
                  monthStart: item.monthStart,
                  monthDays,
                  allDays: view.days,
                  rules: item.schedule.holidayRules,
                  compDue: item.schedule.compDue,
                  people: nameList,
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
                      people: nameList,
                    })
                  : [];
                const prevHolidayDates = prevCompRows
                  .filter((row) => row.offDate != null && row.offDate >= item.monthStart && row.offDate <= endOfMonth(item.monthStart))
                  .map((row) => row.holidayDate);
                const dates = showNeighbors
                  ? boardDatesWithNeighbors(item.monthStart, [...compRows, ...prevCompRows], prevHolidayDates, true)
                  : monthDates(item.monthStart);
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
                      today={today}
                      section={{
                        storeId: view.store.id,
                        holidays: view.holidays,
                        schedules: boardSchedules.length > 0 ? boardSchedules : [item],
                        days: boardDays,
                        people: view.people,
                        directory: view.directory,
                        shifts: view.shifts,
                      }}
                      onOpenDay={(day, sellerId) => setDayOpen({ storeId: view.store.id, day, sellerId, ownerMonth: item.monthStart })}
                      onReplacePerson={(fromSellerId, fromName) => {
                        setReplaceError(null);
                        setReplaceWithId("");
                        setReplaceTarget({ storeId: view.store.id, fromSellerId, fromName });
                      }}
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
          rules={dayEdit.rules}
          dayNeeds={dayEdit.schedule.dayNeeds}
          monthEnd={dayEdit.monthEnd}
          monthDays={dayEdit.monthDays}
          compDue={dayEdit.compDue}
          scheduleMonths={new Set(dayView.months.map((month) => month.monthStart))}
          names={new Map((dayView.directory ?? dayView.people).map((person) => [person.id, person]))}
          onClose={() => setDayOpen(null)}
          onSave={async (next) => {
            const editedDays = next.flatMap((group) => group.rows);
            const merged = [
              ...dayEdit.monthDays.filter((row) => !editedDays.some((item) => item.sellerId === row.sellerId && item.day === row.day)),
              ...editedDays,
            ];
            const nextDue = syncCompDue(dayEdit.schedule.compDue, merged, dayEdit.rules, dayEdit.monthEnd);
            // FC só no mês seguinte (ainda sem escala): atualiza compDue; não grava dia órfão.
            const scheduleMonths = new Set(dayView.months.map((month) => month.monthStart));
            const persistable = next.filter((group) => scheduleMonths.has(startOfMonth(group.day)));
            if (persistable.length > 0) {
              await saveDay([{ storeId: dayView.store.id, days: persistable }]);
            }
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
      {replaceTarget ? (
        <ReplacePersonModal
          open
          fromName={replaceTarget.fromName}
          candidates={(views.find((view) => view.store.id === replaceTarget.storeId)?.people ?? []).filter(
            (person) => person.id !== replaceTarget.fromSellerId,
          )}
          selectedId={replaceWithId}
          busy={replaceBusy}
          error={replaceError}
          onSelect={setReplaceWithId}
          onClose={() => {
            if (replaceBusy) return;
            setReplaceTarget(null);
            setReplaceWithId("");
            setReplaceError(null);
          }}
          onConfirm={() => {
            const view = views.find((item) => item.store.id === replaceTarget.storeId);
            const next = view?.people.find((person) => person.id === replaceWithId);
            if (!view || !next) {
              setReplaceError("Escolha quem herda a escala.");
              return;
            }
            setReplaceBusy(true);
            setReplaceError(null);
            void replaceSchedulePerson({
              storeId: replaceTarget.storeId,
              fromSellerId: replaceTarget.fromSellerId,
              toSellerId: next.id,
              toName: next.name,
            })
              .then(() => {
                setReplaceTarget(null);
                setReplaceWithId("");
                show(`${next.name.toLocaleUpperCase("pt-BR")} herdou a escala.`, "success");
                setReloadKey((value) => value + 1);
              })
              .catch((caught) => {
                setReplaceError(caught instanceof Error && caught.message ? caught.message : "Não foi possível substituir a pessoa.");
              })
              .finally(() => setReplaceBusy(false));
          }}
        />
      ) : null}
    </div>
  );
}

type ScheduleSection = {
  storeId: string;
  holidays: Holiday[];
  schedules: { monthStart: string; schedule: StoredSchedule }[];
  days: StoredDay[];
  people: StoreSeller[];
  directory: StoreSeller[];
  shifts: StoreShift[];
};

function ReplacePersonModal({
  open,
  fromName,
  candidates,
  selectedId,
  busy,
  error,
  onSelect,
  onClose,
  onConfirm,
}: {
  open: boolean;
  fromName: string;
  candidates: StoreSeller[];
  selectedId: string;
  busy: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const selected = candidates.find((person) => person.id === selectedId) ?? null;
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Substituir na escala"
      footer={
        <div className="flex w-full min-w-0 flex-col gap-3">
          {error ? <Alert variant="danger" title={error} /> : null}
          <div className="flex justify-end gap-2.5">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button disabled={busy || !selected} onClick={onConfirm}>
              {busy ? "Substituindo…" : "Substituir"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13.5px] leading-relaxed text-t1">
          {fromName.toLocaleUpperCase("pt-BR")} saiu da equipe. Quem herda a folga, os dias e as compensatórias desta vaga?
        </p>
        {candidates.length === 0 ? (
          <p className="text-[13px] text-t2">Nenhuma pessoa ativa nesta filial para herdar a escala.</p>
        ) : (
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-t0">
            Nova pessoa
            <Select
              value={selectedId}
              onChange={(event) => onSelect(event.target.value)}
              aria-label="Pessoa que herda a escala"
            >
              <option value="">Escolher</option>
              {candidates.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name.toLocaleUpperCase("pt-BR")}
                </option>
              ))}
            </Select>
          </label>
        )}
        {selected ? (
          <p className="text-[12.5px] leading-relaxed text-t2">
            Se {selected.name.toLocaleUpperCase("pt-BR")} já tiver linha nesta escala, essa linha sai e ela fica com a vaga de{" "}
            {fromName.toLocaleUpperCase("pt-BR")}.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

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
  onReplacePerson,
  readOnly = false,
}: {
  dates: string[];
  /** Dias em foco (semana/dia). Fora disso a coluna permanece, só escurece. */
  activeDates?: Set<string>;
  today: string;
  section: ScheduleSection;
  onOpenDay: (day: string, sellerId: string) => void;
  onReplacePerson?: (sellerId: string, name: string) => void;
  readOnly?: boolean;
}) {
  const { schedules, people, holidays } = section;
  const directory = section.directory ?? people;
  const byId = new Map(directory.map((person) => [person.id, person]));
  const activeIds = new Set(people.map((person) => person.id));
  const byDay = daysByDate(section.days);
  const focusAll = !activeDates || activeDates.size === 0 || activeDates.size === dates.length;
  function inFocus(iso: string) {
    return focusAll || activeDates!.has(iso);
  }
  function scheduleFor(iso: string): StoredSchedule | null {
    return schedules.find((item) => item.monthStart === startOfMonth(iso))?.schedule ?? null;
  }
  const ids = new Set<string>([...schedules.flatMap((item) => item.schedule.people.map((person) => person.sellerId)), ...section.days.map((row) => row.sellerId)]);
  const shiftById = new Map(section.shifts.map((shift) => [shift.id, shift]));
  const roster = [...ids]
    .map((id) => {
      const person = byId.get(id);
      const orphan = !activeIds.has(id);
      const role = orphan
        ? "DESLIGADA"
        : person
          ? branchRoleLabel(person.role).toLocaleUpperCase("pt-BR")
          : "";
      const shift = person?.shiftId ? shiftById.get(person.shiftId) ?? null : null;
      const groupLabel = shift ? shift.name.toLocaleUpperCase("pt-BR") : "";
      const hoursTitle = shift ? `${shift.name} · ${shift.start}–${shift.end}` : undefined;
      return {
        id,
        name: (person?.name ?? "Pessoa").toLocaleUpperCase("pt-BR"),
        role,
        groupLabel,
        hoursTitle,
        code: person?.code ?? null,
        orphan,
      };
    })
    .sort((a, b) => {
      if (a.orphan !== b.orphan) return a.orphan ? 1 : -1;
      return a.name.localeCompare(b.name, "pt-BR");
    });

  function presence(iso: string): { working: number; closed: boolean; min: number; exact: boolean } {
    const rows = byDay.get(iso) ?? [];
    const working = rows.filter((row) => isWorking(row)).length;
    const schedule = scheduleFor(iso);
    if (!schedule) return { working, closed: false, min: 0, exact: false };
    const floor = dayFloor(schedule, iso);
    return { working, closed: floor.closed, min: floor.min, exact: floor.exact };
  }

  /* Heatmap compacto: coluna Pessoa mais larga no desktop; no celular a grade rola na horizontal.
     Coluna do dia um pouco mais larga para caber a sigla + grupo abaixo. */
  const dayCols = `repeat(${dates.length}, minmax(2.1rem, 1fr))`;
  const stickyPerson = "sticky left-0 z-[1] bg-bg-2 pr-2";
  const tile =
    "flex min-h-[2.1rem] w-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-[4px] px-0.5 py-0.5 font-extrabold leading-none";
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
            <div className={cn(stickyPerson, "flex min-w-0 items-center gap-2 py-0.5")} title={person.hoursTitle}>
              <PersonAvatar name={person.name} employeeId={person.code} storeId={section.storeId} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold leading-tight text-t0">{person.name}</span>
                {person.role ? <span className="mt-0.5 block truncate text-[11px] leading-snug text-t2">{person.role}</span> : null}
                {person.orphan && onReplacePerson && !readOnly ? (
                  <button
                    type="button"
                    className="mt-1 text-[11px] font-bold text-acc hover:underline"
                    onClick={() => onReplacePerson(person.id, person.name)}
                  >
                    Substituir por…
                  </button>
                ) : null}
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
              const groupLine = person.groupLabel ? (
                <span className="max-w-full truncate text-[7px] font-bold leading-none tracking-wide opacity-90">{person.groupLabel}</span>
              ) : null;
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
                    title={person.groupLabel ? `${status} · ${person.groupLabel}` : status}
                  >
                    <span>{mark.letters}</span>
                    {groupLine}
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
                  aria-label={
                    person.groupLabel
                      ? `${person.name}, ${Number(iso.slice(8))}: ${status}, ${person.groupLabel}`
                      : `${person.name}, ${Number(iso.slice(8))}: ${status}`
                  }
                  onClick={() => onOpenDay(iso, person.id)}
                >
                  <span>{mark.letters}</span>
                  {groupLine}
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
  compDue,
  scheduleMonths,
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
  compDue: CompDue[];
  /** Meses com `store_schedule` — FC só em compDue (vizinho) não grava dia órfão. */
  scheduleMonths: Set<string>;
  names: Map<string, StoreSeller>;
  onClose: () => void;
  onSave: (next: { day: string; rows: StoredDay[] }[]) => Promise<void>;
}) {
  const links = inferCompLinks(monthDays, rules, monthEnd, compDue);
  const roster = monthDays.filter((row) => row.day === day && row.sellerId === sellerId);
  const personName = (names.get(sellerId)?.name ?? "Pessoa").toLocaleUpperCase("pt-BR");
  const [drafts, setDrafts] = useState<Record<string, { value: CellChoice; holiday: string; targetDay: string }>>(() =>
    Object.fromEntries(
      roster.map((row) => {
        const options = dayEditOptions({ day, days: monthDays, rules, dayNeeds, pattern, personId: row.sellerId, monthEnd, compDue });
        const linked = links.find((item) => item.personId === row.sellerId && item.day === day);
        const holiday = linked?.holiday ?? options.holidays[0]?.date ?? "";
        return [row.sellerId, { value: choiceOf(row.status), holiday, targetDay: day }];
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
      compDue,
      choices: roster.map((row) => {
        const draft = drafts[row.sellerId];
        const value = draft?.value ?? choiceOf(row.status);
        return {
          personId: row.sellerId,
          value,
          holiday: draft?.holiday || null,
          targetDay: value === "comp_off" ? draft?.targetDay || day : null,
        };
      }),
    });
    if (edited.error) {
      setSaveError(edited.error);
      return;
    }
    // Só grava as células que mudaram — não reescreve o dia inteiro (evita apagar outros colaboradores).
    const changed = edited.days.filter((row) => {
      const before = monthDays.find((item) => item.sellerId === row.sellerId && item.day === row.day);
      return !before || before.status !== row.status || before.origin !== row.origin;
    });
    const touched = [...new Set(changed.map((row) => row.day))];
    setBusy(true);
    setSaveError(null);
    void onSave(touched.map((iso) => ({ day: iso, rows: changed.filter((row) => row.day === iso) })))
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
        const options = dayEditOptions({ day, days: monthDays, rules, dayNeeds, pattern, personId: row.sellerId, monthEnd, compDue });
        const draft = drafts[row.sellerId] ?? { value: choiceOf(row.status), holiday: "", targetDay: day };
        const fcDays =
          draft.value === "comp_off" && draft.holiday
            ? eligibleCompOffDays({
                personId: row.sellerId,
                holiday: draft.holiday,
                days: monthDays,
                rules,
                dayNeeds,
                monthEnd,
                includeDay: day,
              })
            : [];
        const targetDay = fcDays.includes(draft.targetDay) ? draft.targetDay : fcDays[0] ?? day;
        return (
          <div key={row.sellerId} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-t0">
              O que esta pessoa fará neste dia?
              <Select
                aria-label={`O que ${personName} fará neste dia?`}
                value={draft.value}
                disabled={busy}
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
              <>
                <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-t0">
                  Qual feriado gerou esta folga?
                  <Select
                    aria-label={`Essa folga de ${personName} é por qual feriado?`}
                    value={draft.holiday}
                    disabled={busy}
                    onChange={(event) => {
                      const holiday = event.target.value;
                      const nextDays = eligibleCompOffDays({
                        personId: row.sellerId,
                        holiday,
                        days: monthDays,
                        rules,
                        dayNeeds,
                        monthEnd,
                        includeDay: day,
                      });
                      setDrafts((current) => ({
                        ...current,
                        [row.sellerId]: {
                          ...draft,
                          holiday,
                          targetDay: nextDays.includes(draft.targetDay) ? draft.targetDay : nextDays[0] ?? day,
                        },
                      }));
                    }}
                  >
                    {options.holidays.map((rule) => (
                      <option key={rule.date} value={rule.date}>{shortDate(rule.date)} · {rule.name}</option>
                    ))}
                  </Select>
                </label>
                {fcDays.length > 0 ? (
                  <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-t0">
                    Em qual dia cai a folga compensatória?
                    <Select
                      aria-label={`Dia da folga compensatória de ${personName}`}
                      value={targetDay}
                      disabled={busy}
                      onChange={(event) =>
                        setDrafts((current) => ({ ...current, [row.sellerId]: { ...draft, targetDay: event.target.value } }))
                      }
                    >
                      {fcDays.map((iso) => {
                        const plannedOnly = !scheduleMonths.has(startOfMonth(iso));
                        return (
                          <option key={iso} value={iso}>
                            {shortDate(iso)}
                            {iso === day ? " · atual" : ""}
                            {plannedOnly ? " · mês seguinte" : ""}
                          </option>
                        );
                      })}
                    </Select>
                  </label>
                ) : null}
              </>
            ) : null}
            {options.orphanComp ? <p className="text-[12.5px] text-t2">{COMP_OFF_CLEAR_HINT}</p> : null}
            <p className="text-[12.5px] text-t2">Ao mudar o dia da folga compensatória, o dia anterior volta a trabalho.</p>
          </div>
        );
      })}
    </Modal>
  );
}