import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, EmptyState, FormField, Modal, Select, useToast } from "@/components/ui";
import { ColorLegend, type LegendItem } from "@/components/wedash/ColorLegend";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { DayChip, PlainKpi } from "@/pages/cash-close/CashClosePage";
import { MonthStep, monthNavBtn } from "@/pages/cash-close/MonthYearPicker";
import { SectionHeader, useScopedStores } from "@/pages/operation/shared";
import { Icon, icons } from "@/pages/users/Icons";
import { cn } from "@/lib/cn";
import { calendarTodayIso } from "@/data/wedash/clock";
import { addDays, addMonths, endOfMonth, isoToDate, shiftName, startOfMonth } from "@/data/wedash/engine/format";
import { fetchGoals } from "@/data/wedash/goalsRepo";
import { monthCoveredByGoal, scheduleStartMonth, type GoalSpan } from "@/data/wedash/goalMonths";
import { branchRoleLabel, fetchStoreSellers, fetchStoreShifts, isBranchTeamMember, type StoreSeller, type StoreShift } from "@/data/wedash/stores";
import { defaultDayNeeds, generateMonth, weekday, weekdayLabel, type DayStatus, type Sex } from "@/data/wedash/scheduleGenerate";
import { holidayLabel, holidaysForStore, loadHolidaySeed, loadNationalHolidays, storePlace, type Holiday } from "@/data/wedash/scheduleHolidays";
import { deleteSchedule, fetchCompDue, fetchSchedule, saveManualDay, saveSchedule, type StoredDay, type StoredSchedule } from "@/data/wedash/scheduleRepo";
import { ScheduleWizard, type ScheduleWizardValue } from "./ScheduleWizard";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const SCHEDULE_LEGEND: LegendItem[] = [
  { key: "work", color: "bg-ok", label: "Trabalha", hint: "Na loja" },
  { key: "off", color: "bg-chip-gray", label: "Folga", hint: "Descanso" },
  { key: "holiday", color: "bg-warn", label: "Feriado trabalhado", hint: "Trabalha no feriado" },
  { key: "double", color: "bg-acc", label: "Pagamento em dobro", hint: "Trabalha com pagamento em dobro" },
  { key: "comp", color: "bg-info", label: "Folga compensatória", hint: "Folga pelo feriado trabalhado" },
];

function monthLabel(iso: string): string {
  const date = isoToDate(startOfMonth(iso));
  return `${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
}

function dayTitle(iso: string, holiday: string | null): string {
  const date = isoToDate(iso);
  const label = `${date.getDate()} de ${MONTHS[date.getMonth()].toLowerCase()}`;
  return holiday ? `${label} · ${holiday}` : label;
}

const SHORT_WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function monthDates(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) dates.push(day);
  return dates;
}

function statusFace(status: DayStatus, doublePay: boolean): { fill: string; chip: string; label: string; full: string } {
  if (status === "holiday_work" && doublePay) return { fill: "bg-acc-soft", chip: "bg-acc", label: "Dobro", full: "Pagamento em dobro" };
  if (status === "holiday_work") return { fill: "bg-warn-soft", chip: "bg-warn", label: "Feriado", full: "Feriado trabalhado" };
  if (status === "comp_off") return { fill: "bg-info-soft", chip: "bg-info", label: "Compensa", full: "Folga compensatória" };
  if (status === "off") return { fill: "bg-bg-3", chip: "bg-chip-gray", label: "Folga", full: "Folga" };
  return { fill: "bg-ok-soft", chip: "bg-ok", label: "Trabalha", full: "Trabalha" };
}

type SelectedPerson = { id: string; fixedOffDow: number | null; sex: Sex; groupId: string | null };

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

const STICKY = "sticky left-0 z-20 border-r border-line bg-bg-2";

export function SchedulePage() {
  const { show } = useToast();
  const { session, storeRows } = useScopedStores();
  const store = storeRows.length === 1 ? storeRows[0] : null;
  const today = calendarTodayIso();
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [people, setPeople] = useState<StoreSeller[]>([]);
  const [shifts, setShifts] = useState<StoreShift[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [schedule, setSchedule] = useState<StoredSchedule | null>(null);
  const [days, setDays] = useState<StoredDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [goalSpans, setGoalSpans] = useState<GoalSpan[] | null>(null);
  const storeIds = storeRows.map((row) => row.id).join(",");

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(monthStart);
  const dates = useMemo(() => monthDates(monthStart, monthEnd), [monthStart, monthEnd]);
  const byPerson = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const dayRows = useMemo(() => {
    const map = new Map<string, StoredDay[]>();
    for (const row of days) {
      const list = map.get(row.day) ?? [];
      list.push(row);
      map.set(row.day, list);
    }
    return map;
  }, [days]);

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
      setMonth((current) => (current < open ? open : current));
    });
    return () => {
      stop = true;
    };
  }, [storeIds, session.tenantId, today]);

  useEffect(() => {
    if (!store) return;
    let stop = false;
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const year = Number(monthStart.slice(0, 4));
        const [team, seed, stored, national, storeShifts] = await Promise.all([
          fetchStoreSellers(session.tenantId, [store.id]),
          loadHolidaySeed(),
          fetchSchedule(store.id, monthStart),
          loadNationalHolidays(year),
          fetchStoreShifts(session.tenantId, store.id),
        ]);
        if (stop) return;
        const active = (team.get(store.id) ?? []).filter((person) => isBranchTeamMember(person));
        setPeople(active);
        setShifts(storeShifts);
        const place = storePlace(store);
        const base = holidaysForStore(seed, year, place.uf, place.city, []).filter((row) => row.kind !== "national");
        const known = new Set(base.map((row) => `${row.date}|${row.name}`));
        const extras = (stored.schedule?.holidayRules ?? [])
          .filter((rule) => !known.has(`${rule.date}|${rule.name}`))
          .map((rule) => ({ date: rule.date, name: rule.name }));
        setHolidays([...national, ...holidaysForStore(seed, year, place.uf, place.city, extras).filter((row) => row.kind !== "national")]);
        setSchedule(stored.schedule);
        setDays(stored.days);
      } catch {
        if (!stop) setError(true);
      } finally {
        if (!stop) setLoading(false);
      }
    })();
    return () => {
      stop = true;
    };
  }, [store?.id, monthStart, session.tenantId, reloadKey]);

  const initialWizard = (): ScheduleWizardValue => ({
    scenario: "before_6x1",
    pattern: schedule?.pattern ?? "6x1",
    offMode: schedule?.offMode ?? "rotating",
    sundayMin: schedule?.sundayMin ?? 1,
    womenSunday: schedule?.womenSunday ?? "every_2",
    menSunday: schedule?.menSunday ?? "every_3",
    periodStart: schedule?.periodStart ?? monthStart,
    periodEnd: schedule?.periodEnd ?? monthEnd,
    selectedIds: schedule ? schedule.people.map((person) => person.sellerId) : people.map((person) => person.id),
    sex: Object.fromEntries(people.map((person) => [person.id, schedule?.people.find((row) => row.sellerId === person.id)?.sex ?? "woman"])),
    fixedOff: Object.fromEntries(schedule?.people.filter((person) => person.fixedOffDow != null).map((person) => [person.sellerId, person.fixedOffDow ?? 1]) ?? []),
    dayNeeds: schedule && schedule.dayNeeds.length === 7 ? schedule.dayNeeds : defaultDayNeeds(),
    groupNeeds: schedule?.groupNeeds ?? [],
    holidayRules: schedule?.holidayRules ?? [],
    replaceManual: false,
  });

  async function generateFor(storeId: string, value: ScheduleWizardValue, selected: SelectedPerson[]) {
    const [year, monthNumber] = value.periodStart.split("-").map(Number);
    const incoming = await fetchCompDue(storeId, value.periodStart);
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
        fixedOffDow: person.fixedOffDow,
        sex: person.sex,
        groupId: person.groupId,
      })),
      holidayDates: [],
      dayNeeds: value.dayNeeds,
      groupNeeds: value.groupNeeds,
      holidayRules: value.holidayRules,
      incomingComp: incoming,
    });
    const known = new Set(holidays.filter((row) => row.kind !== "municipal").map((row) => row.date));
    const months = monthsBetween(value.periodStart, value.periodEnd);
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
        people: selected.map((person) => ({ sellerId: person.id, fixedOffDow: person.fixedOffDow, sex: person.sex })),
        days: generated.days.filter((row) => row.date >= start && row.date <= endOfMonth(start)).map((row) => ({ sellerId: row.personId, day: row.date, status: row.status })),
        keepManual: !value.replaceManual,
        rangeStart: value.periodStart,
        rangeEnd: value.periodEnd,
      });
      keptManualDays += saved.keptManualDays;
    }
    return { keptManualDays };
  }

  async function onGenerate(value: ScheduleWizardValue) {
    if (!store) return;
    setSaving(true);
    try {
      const selected = value.selectedIds.map((id) => ({
        id,
        fixedOffDow: value.fixedOff[id] > 0 ? value.fixedOff[id] : null,
        sex: value.sex[id] ?? "woman",
        groupId: people.find((person) => person.id === id)?.shiftId ?? null,
      }));
      const result = await generateFor(store.id, value, selected);
      const kept = result.keptManualDays;
      show(kept > 0 ? `Escala salva. ${kept} ${kept === 1 ? "dia ajustado na mão foi mantido" : "dias ajustados na mão foram mantidos"}.` : "Escala salva.", "success");
      setWizard(false);
      setReloadKey((value) => value + 1);
    } catch (caught) {
      show(caught instanceof Error ? caught.message : "Não foi possível gerar a escala.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function saveDay(next: StoredDay[]) {
    if (!store || !dayOpen) return;
    await saveManualDay({
      tenantId: session.tenantId,
      storeId: store.id,
      day: dayOpen,
      rows: next.map((row) => ({ sellerId: row.sellerId, status: row.status, origin: row.origin })),
    });
    setDays((current) => [...current.filter((row) => row.day !== dayOpen), ...next]);
  }

  const patternLabel = schedule ? schedule.pattern.replace("x", "×") : "—";
  const holidayCount = holidays.filter((row) => row.date >= monthStart && row.date <= monthEnd).length;

  return (
    <div>
      <SectionHeader
        section="Gestão"
        title="Escala"
        subtitle="Acompanhe e ajuste a escala da filial."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={monthNavBtn}
                aria-label="Mês anterior"
                disabled={goalSpans == null || !monthCoveredByGoal(addMonths(monthStart, -1), goalSpans)}
                onClick={() => setMonth((current) => addMonths(current, -1))}
              >
                <MonthStep dir="anterior" />
              </button>
              <span className="min-w-[140px] text-center text-[13.5px] font-semibold text-t0">{monthLabel(monthStart)}</span>
              <button type="button" className={monthNavBtn} aria-label="Próximo mês" onClick={() => setMonth((current) => addMonths(current, 1))}>
                <MonthStep dir="proximo" />
              </button>
            </div>
            <Button icon={schedule ? undefined : <Icon d={icons.plus} size={14} />} disabled={!store || people.length === 0 || loading} onClick={() => setWizard(true)}>
              {schedule ? "Editar escala" : "Criar escala"}
            </Button>
            <Button variant="outline" disabled={!store || !schedule} onClick={() => setConfirmDelete(true)}>
              Apagar escala
            </Button>
          </div>
        }
      />
      <div className="mt-6 pb-8">
        {error ? <Alert className="mb-4" variant="danger" title="Não foi possível carregar a escala. Tente novamente." /> : null}
        {!store ? (
          <Card>
            <EmptyState icon="📅" title="Escolha uma filial" description="Com várias filiais no seletor, o dia não abre. Escolha uma para ver, gerar e ajustar a escala." />
          </Card>
        ) : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <PlainKpi label="Pessoas" value={String(schedule?.people.length ?? people.length)} color="var(--t0)" />
              <PlainKpi label="Modelo" value={patternLabel} color="var(--t0)" />
              <PlainKpi label="Feriados" value={String(holidayCount)} color="var(--t0)" />
              <PlainKpi label="Dias ajustados" value={String(new Set(days.filter((row) => row.origin === "manual").map((row) => row.day)).size)} color="var(--t0)" />
            </div>
            {schedule ? <ColorLegend className="mb-3" items={SCHEDULE_LEGEND} /> : null}
            {schedule ? (
              <ScheduleGrid
                dates={dates}
                today={today}
                holidays={holidays}
                schedule={schedule}
                days={days}
                people={people}
                shifts={shifts}
                onOpenDay={setDayOpen}
              />
            ) : null}
            {loading ? <p className="mt-3 text-[12px] text-t2">Carregando a escala…</p> : null}
            {!loading && people.length === 0 ? <p className="mt-3 text-[12px] text-t2">Esta filial não tem equipe ativa.</p> : null}
            {!loading && people.length > 0 && !schedule ? <p className="mt-3 text-[12px] text-t2">Este mês ainda não tem escala. O feriado do dia já aparece.</p> : null}
          </>
        )}
      </div>
      {store && wizard ? (
        <ScheduleWizard
          open
          onClose={() => setWizard(false)}
          people={people.map((person) => ({
            id: person.id,
            name: person.name,
            role: branchRoleLabel(person.role),
            groupId: person.shiftId,
            groupName: shifts.find((shift) => shift.id === person.shiftId)?.name ?? "",
            code: person.code,
            storeId: store.id,
          }))}
          hasSchedule={schedule != null}
          nationalHolidays={holidays}
          initial={initialWizard()}
          saving={saving}
          onSubmit={(value) => void onGenerate(value)}
        />
      ) : null}
      {store && dayOpen ? (
        <DayEditor
          day={dayOpen}
          holiday={holidayLabel(holidays, dayOpen)}
          doublePay={Boolean(schedule?.holidayRules.some((rule) => rule.date === dayOpen && rule.pay === "double"))}
          rows={dayRows.get(dayOpen) ?? []}
          storeId={store.id}
          shopping={store.tradeName || store.name}
          shifts={shifts}
          names={byPerson}
          onClose={() => setDayOpen(null)}
          onSave={async (next) => {
            try {
              await saveDay(next);
              setDayOpen(null);
              show("Dia salvo.", "success");
            } catch (caught) {
              show(caught instanceof Error ? caught.message : "Não foi possível salvar o dia.", "danger");
            }
          }}
        />
      ) : null}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Apagar escala"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!store) return;
                void deleteSchedule(store.id, monthStart)
                  .then(() => {
                    setConfirmDelete(false);
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
          Apaga a escala de {monthLabel(monthStart)} desta filial, inclusive os dias ajustados na mão. O feriado do dia continua no calendário.
          {monthEnd < today ? " Este mês já passou." : ""}
        </p>
      </Modal>
    </div>
  );
}

function ScheduleGrid({
  dates,
  today,
  holidays,
  schedule,
  days,
  people,
  shifts,
  onOpenDay,
}: {
  dates: string[];
  today: string;
  holidays: Holiday[];
  schedule: StoredSchedule;
  days: StoredDay[];
  people: StoreSeller[];
  shifts: StoreShift[];
  onOpenDay: (day: string) => void;
}) {
  const byDay = new Map<string, StoredDay[]>();
  for (const row of days) {
    const list = byDay.get(row.day) ?? [];
    list.push(row);
    byDay.set(row.day, list);
  }
  const byId = new Map(people.map((person) => [person.id, person]));
  const ids = new Set<string>([...schedule.people.map((person) => person.sellerId), ...days.map((row) => row.sellerId)]);
  const roster = [...ids]
    .map((id) => {
      const person = byId.get(id);
      const fixed = schedule.people.find((row) => row.sellerId === id)?.fixedOffDow ?? null;
      const shift = shifts.find((item) => item.id === person?.shiftId);
      const detail = [person ? branchRoleLabel(person.role) : "", shift ? shiftName(shift.name) : "", fixed != null ? `folga ${weekdayLabel(fixed)}` : ""].filter(Boolean).join(" · ");
      return { id, name: person?.name ?? "Pessoa", detail, shiftId: person?.shiftId ?? null };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const groupIds = new Set(roster.map((person) => person.shiftId).filter((id): id is string => Boolean(id)));
  const perGroup = groupIds.size >= 2;

  function floorOf(iso: string): { min: number; closed: boolean; perGroup: boolean } {
    const need = schedule.dayNeeds.find((row) => row.dow === weekday(iso));
    const holiday = schedule.holidayRules.find((row) => row.date === iso);
    if (holiday && !holiday.open) return { min: 0, closed: true, perGroup: false };
    if (holiday?.open) return { min: holiday.workers, closed: false, perGroup: false };
    if (need && !need.open) return { min: 0, closed: true, perGroup: false };
    return { min: need?.min ?? 0, closed: false, perGroup };
  }

  function presence(iso: string): { working: number; short: boolean; floor: { min: number; closed: boolean; perGroup: boolean } } {
    const floor = floorOf(iso);
    const rows = byDay.get(iso) ?? [];
    const on = (row: StoredDay | undefined) => row?.status === "work" || row?.status === "holiday_work";
    const working = rows.filter((row) => on(row)).length;
    if (floor.closed || !floor.perGroup) return { working, short: !floor.closed && working < floor.min, floor };
    const counts = new Map<string, number>();
    for (const person of roster) {
      if (!person.shiftId) continue;
      const row = rows.find((item) => item.sellerId === person.id);
      counts.set(person.shiftId, (counts.get(person.shiftId) ?? 0) + (on(row) ? 1 : 0));
    }
    const short = [...counts.values()].some((count) => count < floor.min);
    return { working, short, floor };
  }

  return (
    <div className="overflow-x-auto rounded-[18px] border border-line bg-bg-2 shadow-[var(--shadow-vela)]">
      <table className="w-max min-w-full border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            <th className={cn(STICKY, "z-30 min-w-[190px] border-b px-3 py-2 text-[12px] font-bold text-t0")}>Funcionário</th>
            {dates.map((iso) => {
              const holiday = holidayLabel(holidays, iso);
              const dow = weekday(iso);
              return (
                <th key={iso} className="min-w-[4.75rem] border-b border-line p-1 text-center align-bottom">
                  <button type="button" className="flex w-full flex-col items-center gap-0.5 rounded-[9px] px-1 py-1 hover:bg-bg-3" aria-label={`Ajustar ${Number(iso.slice(8))} de ${MONTHS[isoToDate(iso).getMonth()].toLowerCase()}`} onClick={() => onOpenDay(iso)}>
                    <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold", iso === today ? "bg-acc text-white" : dow === 0 ? "text-t1" : "text-t0")}>{Number(iso.slice(8))}</span>
                    <span className="text-[10px] font-bold text-t2">{SHORT_WEEK[dow]}</span>
                    {holiday ? <span className="w-full truncate text-[10px] font-semibold text-warn">{holiday}</span> : null}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {roster.map((person) => (
            <tr key={person.id}>
              <th className={cn(STICKY, "min-w-[190px] border-b px-3 py-2 text-left font-normal")}>
                <span className="block truncate text-[13px] font-semibold text-t0">{person.name}</span>
                {person.detail ? <span className="block truncate text-[11px] text-t2">{person.detail}</span> : null}
              </th>
              {dates.map((iso) => {
                const row = (byDay.get(iso) ?? []).find((item) => item.sellerId === person.id);
                const holiday = holidayLabel(holidays, iso);
                const doublePay = schedule.holidayRules.some((rule) => rule.date === iso && rule.pay === "double");
                if (!row) return <td key={iso} className="border-b border-line bg-bg-1/40" />;
                const face = statusFace(row.status, doublePay && row.status === "holiday_work");
                return (
                  <td key={iso} className={cn("border-b border-line p-1 align-middle", face.fill)}>
                    <button type="button" className="flex min-h-[52px] w-full items-center" aria-label={`${person.name}, ${Number(iso.slice(8))}: ${face.full}${holiday ? `, ${holiday}` : ""}`} onClick={() => onOpenDay(iso)}>
                      <DayChip color={face.chip}>{face.label}</DayChip>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th className={cn(STICKY, "px-3 py-2 text-left text-[12px] font-bold text-t0")}>Pessoas presentes</th>
            {dates.map((iso) => {
              const { working, short, floor } = presence(iso);
              const text = floor.closed ? "Fechado" : floor.min > 0 ? `${working} · mín. ${floor.min}${floor.perGroup ? "/grupo" : ""}` : String(working);
              const title = floor.closed ? "A loja fecha neste dia" : floor.perGroup ? "Mínimo em cada grupo" : "Mínimo do dia";
              return (
                <td key={iso} title={title} className={cn("px-1 py-2 text-center text-[11px] font-bold tabular-nums", floor.closed ? "text-t2" : short ? "text-bad" : "text-ok")}>
                  {text}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function DayEditor({
  day,
  holiday,
  doublePay,
  rows,
  storeId,
  shopping,
  shifts,
  names,
  onClose,
  onSave,
}: {
  day: string;
  holiday: string | null;
  doublePay: boolean;
  rows: StoredDay[];
  storeId: string;
  shopping: string;
  shifts: StoreShift[];
  names: Map<string, StoreSeller>;
  onClose: () => void;
  onSave: (rows: StoredDay[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState(rows);
  const [pick, setPick] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const ordered = [...draft].sort((a, b) => (names.get(a.sellerId)?.name ?? "").localeCompare(names.get(b.sellerId)?.name ?? "", "pt-BR"));
  const missing = [...names.values()].filter((person) => !draft.some((row) => row.sellerId === person.id)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  function addPerson() {
    if (!pick || draft.some((row) => row.sellerId === pick)) return;
    setDraft((current) => [...current, { sellerId: pick, day, status: "work", origin: "manual" }]);
    setPick("");
    setAdding(false);
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={dayTitle(day, holiday)}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onSave(draft).finally(() => setBusy(false));
            }}
          >
            Salvar dia
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-[12.5px] text-t2">Ajuste quem trabalha ou folga neste dia.</p>
      {ordered.length === 0 ? <p className="text-[13px] text-t2">Ninguém neste dia.</p> : null}
      <ul className="space-y-2">
        {ordered.map((row) => {
          const person = names.get(row.sellerId);
          const name = person?.name ?? "Pessoa";
          const shift = shifts.find((item) => item.id === person?.shiftId);
          const place = [shift ? shiftName(shift.name) : "Sem grupo", shopping].filter(Boolean).join(" · ");
          return (
            <li key={row.sellerId} className="flex min-w-0 flex-col gap-2 border-b border-line py-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex min-w-0 items-center gap-2">
                <PersonAvatar name={name} employeeId={person?.code} storeId={storeId} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold text-t0">{name}</span>
                  <span className="block truncate text-[12px] text-t2">{place}</span>
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-2 sm:shrink-0">
                <Select
                  className="h-9! min-w-0 flex-1 px-2! sm:w-[13.5rem] sm:flex-none"
                  aria-label={`Situação de ${name}`}
                  value={row.status}
                  onChange={(event) => {
                    const status = event.target.value as DayStatus;
                    setDraft((current) => current.map((item) => (item.sellerId === row.sellerId ? { ...item, status, origin: "manual" } : item)));
                  }}
                >
                  <option value="work">Trabalha</option>
                  <option value="off">Folga</option>
                  <option value="holiday_work">{doublePay ? "Feriado trabalhado 2×" : "Feriado trabalhado"}</option>
                  <option value="comp_off">Folga compensatória</option>
                </Select>
                <button
                  type="button"
                  aria-label={`Remover ${name} do dia`}
                  onClick={() => setDraft((current) => current.filter((item) => item.sellerId !== row.sellerId))}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-line text-bad transition-colors hover:bg-bad-soft"
                >
                  <Icon d={icons.trash} size={14} />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {missing.length > 0 ? (
        adding ? (
          <section className="mt-4 rounded-[var(--radius-vela-lg)] border border-line bg-bg-2 p-3">
            <p className="text-[12.5px] font-bold text-t0">Adicionar pessoa</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-t2">Alguém da equipe que ainda não está neste dia.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <FormField label="Pessoa" required>
                  <Select value={pick} onChange={(event) => setPick(event.target.value)} aria-label="Pessoa para incluir no dia">
                    <option value="">Escolha</option>
                    {missing.map((person) => (
                      <option key={person.id} value={person.id}>{person.name}</option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <Button type="button" variant="outline" size="sm" disabled={!pick} onClick={addPerson}>
                Adicionar pessoa
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPick("");
                  setAdding(false);
                }}
              >
                Remover
              </Button>
            </div>
          </section>
        ) : (
          <div className="mt-4">
            <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
              Adicionar pessoa
            </Button>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-t2">Alguém da equipe que ainda não está neste dia.</p>
          </div>
        )
      ) : null}
    </Modal>
  );
}