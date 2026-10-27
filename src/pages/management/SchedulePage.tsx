import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, DateRangePicker, Modal, Select, useToast, CALENDAR_QUICK_RANGES, type DatePresetId, type DateRangeChangeMeta } from "@/components/ui";
import { ColorLegend, type LegendItem } from "@/components/wedash/ColorLegend";
import { ScheduleCardsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { BranchBadge, PeriodBadge } from "@/components/wedash/RecordBadges";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { HeaderFilters } from "@/pages/stock/shared";
import { SectionHeader, useScopedStores } from "@/pages/operation/shared";
import { Icon, icons } from "@/pages/users/Icons";
import { cn } from "@/lib/cn";
import { filterCacheGet, filterCacheSet } from "@/lib/filterCache";
import { useFilterSkeleton } from "@/lib/useFilterSkeleton";
import { calendarTodayIso } from "@/data/wedash/clock";
import { addDays, addMonths, dateToIso, endOfMonth, isoToDate, shiftName, startOfMonth } from "@/data/wedash/engine/format";
import { periodLabels } from "@/data/wedash/dashboard";
import { fetchGoals } from "@/data/wedash/goalsRepo";
import { goalMonthFloor, scheduleStartMonth, type GoalSpan } from "@/data/wedash/goalMonths";
import { branchRoleLabel, fetchStoreSellers, fetchStoreShifts, isBranchTeamMember, type Store, type StoreSeller, type StoreShift } from "@/data/wedash/stores";
import { DOW_LABELS } from "@/data/wedash/storeHours";
import { applyDayChoices, buildCompOffSummary, dayEditOptions, defaultDayNeeds, generateMonth, inferCompLinks, issueFromUnknown, PREVIOUS_MONTH_EDIT, weekday, type CellChoice, type CompOffSummaryRow, type DayNeed, type DayStatus, type HolidayRule, type ScheduleGenerateIssue, type SchedulePattern, type Sex } from "@/data/wedash/scheduleGenerate";
import { holidayLabel, holidaysForStore, loadHolidaySeed, loadNationalHolidays, storePlace, type Holiday } from "@/data/wedash/scheduleHolidays";
import { deleteSchedule, fetchCompDue, fetchPreviousSnapshot, fetchSchedule, saveManualDay, saveSchedule, type StoredDay, type StoredSchedule } from "@/data/wedash/scheduleRepo";
import { ScheduleWizard, type ScheduleWizardValue, type WizardBranch } from "./ScheduleWizard";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const SCHEDULE_LEGEND: LegendItem[] = [
  { key: "work", color: "bg-ok", label: "T · Trabalha", hint: "Na filial" },
  { key: "off", color: "bg-chip-gray", label: "F · Folga", hint: "Descanso" },
  { key: "holiday", color: "bg-warn", label: "FE · Feriado trabalhado", hint: "Trabalha no feriado" },
  { key: "double", color: "bg-acc", label: "FE 2× · Pagamento em dobro", hint: "Trabalha com pagamento em dobro" },
  { key: "comp", color: "bg-info", label: "FC · Folga compensatória", hint: "Folga pelo feriado trabalhado" },
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

function scheduleTitle(pattern: SchedulePattern, monthStart: string): string {
  const date = isoToDate(startOfMonth(monthStart));
  const month = `${MONTHS[date.getMonth()].toLocaleLowerCase("pt-BR")} de ${date.getFullYear()}`;
  return `${PATTERN_LABEL[pattern]} · ${month}`;
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

function CompOffSummaryCard({ rows }: { rows: CompOffSummaryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4 rounded-xl border border-line bg-bg-inset p-3.5 sm:p-4">
      <div className="mb-3">
        <h4 className="text-[13px] font-bold text-t0">Folgas compensatórias</h4>
        <p className="mt-0.5 text-[12px] text-t2">
          Para repasse ao sindicato: feriado trabalhado e a data da folga, mesmo quando ela cai no mês seguinte.
        </p>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <li
            key={`${row.personId}|${row.holidayDate}`}
            className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
          >
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-t0">{row.personName}</p>
              <p className="text-[12px] text-t2">
                Feriado {shortDate(row.holidayDate)} · {row.holidayName}
              </p>
            </div>
            <p className={cn("shrink-0 text-[12.5px] font-semibold", row.offDate ? "text-info" : "text-warn")}>
              {row.offDate
                ? `Folga em ${shortDate(row.offDate)}`
                : `Folga até ${shortDate(row.until)}`}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
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
  const [rangeFrom, setRangeFrom] = useState(() => startOfMonth(today));
  const [rangeTo, setRangeTo] = useState(() => endOfMonth(today));
  const [presetId, setPresetId] = useState<DatePresetId | null>("thisMonth");
  const rangeFromRef = useRef(rangeFrom);
  rangeFromRef.current = rangeFrom;
  const [views, setViews] = useState<BranchSchedule[]>([]);
  const [error, setError] = useState(false);
  const [wizardStoreId, setWizardStoreId] = useState<string | null>(null);
  const [wizardMonth, setWizardMonth] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dayOpen, setDayOpen] = useState<{ storeId: string; day: string; sellerId: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ storeId: string; monthStart: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [goalSpans, setGoalSpans] = useState<GoalSpan[] | null>(null);
  const storeIds = storeRows.map((row) => row.id).join(",");
  const filterKey = `schedule:${session.tenantId}:${storeIds}:${rangeFrom}:${rangeTo}`;
  const { showSkeleton, settle } = useFilterSkeleton(filterKey);
  const reloadGen = useRef(0);
  const storesRef = useRef(storeRows);
  storesRef.current = storeRows;

  const periodFloor = goalSpans ? goalMonthFloor(scheduleStartMonth(today, goalSpans), goalSpans) : startOfMonth(today);
  const periodCeil = endOfMonth(addMonths(today, 14));
  const dates = useMemo(() => {
    const list: string[] = [];
    for (let day = rangeFrom; day <= rangeTo; day = addDays(day, 1)) list.push(day);
    return list;
  }, [rangeFrom, rangeTo]);
  const wizardView = views.find((view) => view.store.id === wizardStoreId) ?? null;
  const dayView = dayOpen ? views.find((view) => view.store.id === dayOpen.storeId && view.months.length > 0) ?? null : null;
  const openSchedule = dayOpen && dayView ? scheduleOn(dayView, dayOpen.day) : null;
  const deleteView = deleteTarget ? views.find((view) => view.store.id === deleteTarget.storeId) ?? null : null;
  const deleteMonth = deleteView?.months.find((item) => item.monthStart === deleteTarget?.monthStart) ?? null;

  useEffect(() => {
    const ids = storeIds ? storeIds.split(",") : [];
    if (ids.length === 0) {
      setGoalSpans([]);
      return;
    }
    let stop = false;
    setGoalSpans(null);
    void fetchGoals({
      tenantId: session.tenantId,
      storeIds: ids,
      from: addMonths(today, -24),
      to: endOfMonth(addMonths(today, 14)),
      includeDrafts: true,
    }).then((rows) => {
      if (stop) return;
      const spans = rows.map((row) => ({ startsOn: row.startsOn, endsOn: row.endsOn }));
      setGoalSpans(spans);
      const open = scheduleStartMonth(today, spans);
      if (rangeFromRef.current < open) {
        setRangeFrom(open);
        setRangeTo(endOfMonth(open));
        setPresetId(open === startOfMonth(today) ? "thisMonth" : null);
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
        const covered = monthStarts(rangeFrom, rangeTo);
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
      const end = endOfMonth(result.monthStart);
      setViews((current) => current.map((item) => {
        if (item.store.id !== view.store.id) return item;
        const months = [...item.months.filter((month) => month.monthStart !== result.monthStart), { monthStart: result.monthStart, schedule: result.schedule }];
        const days = [...item.days.filter((row) => startOfMonth(row.day) !== result.monthStart), ...result.days];
        return { ...item, months, days };
      }));
      if (rangeFrom > result.monthStart || rangeTo < end) {
        setRangeFrom(result.monthStart);
        setRangeTo(end);
        setPresetId(result.monthStart === startOfMonth(today) ? "thisMonth" : null);
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

  const registered = views.filter((view) => view.months.length > 0);
  const creatable = views.filter((view) => view.months.length === 0 && view.people.length > 0);
  const scheduleCards = registered
    .flatMap((view) => view.months.map((item) => ({ view, item })))
    .sort((a, b) => a.item.monthStart.localeCompare(b.item.monthStart) || (a.view.store.tradeName || a.view.store.name).localeCompare(b.view.store.tradeName || b.view.store.name, "pt-BR"));

  function openCreate() {
    setWizardMonth(null);
    setWizardStoreId(creatable[0].store.id);
  }

  function registeredActions(view: BranchSchedule, monthStart: string) {
    return (
      <>
        <Button size="sm" variant="outline" onClick={() => setDeleteTarget({ storeId: view.store.id, monthStart })}>
          Apagar escala
        </Button>
        <Button size="sm" disabled={view.people.length === 0 || showSkeleton} onClick={() => { setWizardMonth(monthStart); setWizardStoreId(view.store.id); }}>
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

  const wizardBranches = (wizardView && wizardView.months.length > 0 ? [wizardView] : creatable).map((view) => toBranch(view));

  return (
    <div>
      <SectionHeader
        section="Gestão"
        title="Escala"
        subtitle={many ? "Acompanhe a escala das filiais." : "Acompanhe e ajuste a escala da filial."}
        actions={
          <HeaderFilters>
            <DateRangePicker
              value={[isoToDate(rangeFrom), isoToDate(rangeTo)]}
              minDate={isoToDate(periodFloor)}
              maxDate={isoToDate(periodCeil)}
              quickRanges={CALENDAR_QUICK_RANGES}
              displayLabel={presetId ? periodLabels[presetId] : null}
              activePresetId={presetId}
              onChange={([start, end], meta?: DateRangeChangeMeta) => {
                setRangeFrom(dateToIso(start));
                setRangeTo(dateToIso(end));
                setPresetId(meta?.presetId ?? null);
              }}
            />
            {creatable.length > 0 ? (
              <Button icon={<Icon d={icons.plus} size={16} />} disabled={showSkeleton} onClick={openCreate}>
                Nova escala
              </Button>
            ) : null}
          </HeaderFilters>
        }
      />
      <div className="mt-6 min-w-0 pb-8">
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
              description="Nenhuma filial deste filtro tem escala neste período."
              action={creatable.length > 0 ? <Button size="sm" onClick={openCreate}>Criar escala</Button> : undefined}
            />
          </Card>
        ) : (
          <>
            <ColorLegend className="mb-4" items={SCHEDULE_LEGEND} />
            <div className="flex flex-col gap-4">
              {scheduleCards.map(({ view, item }) => {
                const monthDates = dates.filter((iso) => startOfMonth(iso) === item.monthStart);
                const monthDays = view.days.filter((row) => startOfMonth(row.day) === item.monthStart);
                const compRows = buildCompOffSummary({
                  monthStart: item.monthStart,
                  monthDays,
                  allDays: view.days,
                  rules: item.schedule.holidayRules,
                  compDue: item.schedule.compDue,
                  people: view.people.map((person) => ({ id: person.id, name: person.name })),
                });
                return (
                  <Card key={`${view.store.id}-${item.monthStart}`}>
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-[15px] font-bold text-t0">{scheduleTitle(item.schedule.pattern, item.monthStart)}</h3>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <PeriodBadge from={item.monthStart} to={endOfMonth(item.monthStart)} />
                          <BranchBadge name={view.store.tradeName || view.store.name} />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">{registeredActions(view, item.monthStart)}</div>
                    </div>
                    <ScheduleBoard
                      dates={monthDates}
                      today={today}
                      section={{
                        storeId: view.store.id,
                        holidays: view.holidays,
                        schedules: [item],
                        days: monthDays,
                        people: view.people,
                        shifts: view.shifts,
                      }}
                      onOpenDay={(day, sellerId) => setDayOpen({ storeId: view.store.id, day, sellerId })}
                    />
                    <CompOffSummaryCard rows={compRows} />
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
      {dayOpen && dayView && openSchedule ? (
        <DayEditor
          day={dayOpen.day}
          sellerId={dayOpen.sellerId}
          pattern={openSchedule.pattern}
          rules={openSchedule.holidayRules}
          dayNeeds={openSchedule.dayNeeds}
          monthDays={dayView.days.filter((row) => startOfMonth(row.day) === startOfMonth(dayOpen.day))}
          names={new Map(dayView.people.map((person) => [person.id, person]))}
          onClose={() => setDayOpen(null)}
          onSave={async (next) => {
            await saveDay([{ storeId: dayView.store.id, days: next }]);
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
                    show("Escala apagada. O feriado continua no calendário.", "success");
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
          {many && deleteView ? ` de ${deleteView.store.tradeName || deleteView.store.name}` : " desta filial"}, inclusive os dias ajustados na mão. O feriado do dia continua no calendário.
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
  shifts: StoreShift[];
};

function cellMark(status: DayStatus, doublePay: boolean): { letters: string; note: string | null; className: string } {
  if (status === "holiday_work" && doublePay) return { letters: "FE", note: "2×", className: "bg-acc-soft text-acc" };
  if (status === "holiday_work") return { letters: "FE", note: null, className: "bg-warn-soft text-warn" };
  if (status === "comp_off") return { letters: "FC", note: null, className: "bg-info-soft text-info" };
  if (status === "off") return { letters: "F", note: null, className: "bg-bg-3 text-t2" };
  return { letters: "T", note: null, className: "bg-ok-soft text-ok" };
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
  today,
  section,
  onOpenDay,
}: {
  dates: string[];
  today: string;
  section: ScheduleSection;
  onOpenDay: (day: string, sellerId: string) => void;
}) {
  const { schedules, people, shifts, holidays } = section;
  const byId = new Map(people.map((person) => [person.id, person]));
  const byDay = daysByDate(section.days);
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
      const shift = shifts.find((item) => item.id === person?.shiftId);
      const offDow = offDowOf(id, fixed);
      const detail = [person ? branchRoleLabel(person.role).toLocaleUpperCase("pt-BR") : "", shift ? shiftName(shift.name) : "", offDow != null ? `FOLGA: ${DOW_LABELS[offDow as 0 | 1 | 2 | 3 | 4 | 5 | 6].toLocaleUpperCase("pt-BR")}` : ""].filter(Boolean).join(" · ");
      return { id, name: person?.name ?? "Pessoa", detail, shiftId: person?.shiftId ?? null, code: person?.code ?? null };
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

  /* Dia com largura mínima: no celular a grade rola na horizontal em vez de esmagar os números. */
  const columns = `minmax(11rem, 14rem) repeat(${dates.length}, minmax(2.5rem, 1fr))`;
  const stickyPerson = "sticky left-0 z-[1] border-r border-line bg-bg-2";
  return (
    <div className="min-w-0 overflow-x-auto overscroll-x-contain rounded-[18px] border border-line bg-bg-2">
      <div className="grid w-max min-w-full" style={{ gridTemplateColumns: columns }}>
        <div className={cn(stickyPerson, "border-b px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-t2")}>Pessoa</div>
        {dates.map((iso) => {
          const holiday = holidayLabel(holidays, iso);
          const day = Number(iso.slice(8));
          return (
            <div key={iso} title={holiday ?? dayTitle(iso, null)} className={cn("border-b border-line px-0.5 py-2 text-center", holiday && iso !== today && "text-warn")}>
              <span
                className={cn(
                  "mx-auto inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold",
                  iso === today ? "bg-acc text-white" : holiday ? "text-warn" : "text-t0",
                )}
              >
                {day}
              </span>
              <span className="mt-0.5 block truncate text-[10px] font-bold uppercase text-t2">{SHORT_WEEK[weekday(iso)]}</span>
            </div>
          );
        })}
        {roster.map((person) => (
          <div key={person.id} className="contents">
            <div className={cn(stickyPerson, "flex min-w-0 items-center gap-2 border-b px-2 py-1.5")}>
              <PersonAvatar name={person.name} employeeId={person.code} storeId={section.storeId} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold leading-tight text-t0">{person.name}</span>
                {person.detail ? <span className="mt-0.5 block truncate text-[11px] leading-snug text-t2">{person.detail}</span> : null}
              </span>
            </div>
            {dates.map((iso) => {
              const row = (byDay.get(iso) ?? []).find((item) => item.sellerId === person.id);
              const doublePay = scheduleFor(iso)?.holidayRules.some((rule) => rule.date === iso && rule.pay === "double") ?? false;
              const mark = row ? cellMark(row.status, doublePay) : null;
              const status = row ? statusChip(row.status, doublePay).label : "sem escala";
              if (!row || !mark) {
                return <div key={iso} className="min-h-11 border-b border-line" />;
              }
              return (
                <button
                  key={iso}
                  type="button"
                  className="flex min-h-11 min-w-0 cursor-pointer items-center justify-center border-b border-line p-0.5"
                  aria-label={`${person.name}, ${Number(iso.slice(8))}: ${status}`}
                  onClick={() => onOpenDay(iso, person.id)}
                >
                  <span className={cn("flex h-8 w-full max-w-9 flex-col items-center justify-center rounded-[6px] text-[10px] font-bold leading-none", mark.className)}>
                    {mark.letters}
                    {mark.note ? <span className="mt-0.5 text-[8px] font-semibold uppercase">{mark.note}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        <div className={cn(stickyPerson, "px-2 py-2 text-left text-[11px] font-bold uppercase leading-tight tracking-wide text-t2")}>Pessoas presentes</div>
        {dates.map((iso) => {
          const face = presence(iso);
          const title = face.closed ? "A loja fecha neste dia" : face.exact ? "Quantidade exata neste feriado" : "Mínimo do dia";
          const sub = face.closed ? "Fechado" : face.min > 0 ? `${face.exact ? "Ex." : "Mín."} ${face.min}` : "";
          return (
            <div key={iso} title={title} className="min-w-0 px-0.5 py-1.5 text-center">
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
  monthDays: StoredDay[];
  names: Map<string, StoreSeller>;
  onClose: () => void;
  onSave: (next: { day: string; rows: StoredDay[] }[]) => Promise<void>;
}) {
  const monthEnd = endOfMonth(startOfMonth(day));
  const links = inferCompLinks(monthDays, rules, monthEnd);
  const roster = monthDays.filter((row) => row.day === day && row.sellerId === sellerId);
  const personName = names.get(sellerId)?.name ?? "Pessoa";
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