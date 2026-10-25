import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, EmptyState, FormField, Modal, Select, useToast } from "@/components/ui";
import { MonthCalendar } from "@/components/wedash/MonthCalendar";
import { ColorLegend, type LegendItem } from "@/components/wedash/ColorLegend";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { PlainKpi } from "@/pages/cash-close/CashClosePage";
import { cn } from "@/lib/cn";
import { MonthStep, monthNavBtn } from "@/pages/cash-close/MonthYearPicker";
import { SectionHeader, useScopedStores } from "@/pages/operation/shared";
import { Icon, icons } from "@/pages/users/Icons";
import { calendarTodayIso } from "@/data/wedash/clock";
import { addDays, addMonths, endOfMonth, isoToDate, startOfMonth } from "@/data/wedash/engine/format";
import { fetchGoals } from "@/data/wedash/goalsRepo";
import { monthCoveredByGoal, scheduleStartMonth, type GoalSpan } from "@/data/wedash/goalMonths";
import { branchRoleLabel, fetchStoreSellers, fetchStoreShifts, isBranchTeamMember, type StoreSeller, type StoreShift } from "@/data/wedash/stores";
import { defaultDayNeeds, generateMonth, nextSundayShift, shiftThatWorked, weekday, type DayStatus, type Sex } from "@/data/wedash/scheduleGenerate";
import { holidayLabel, holidaysForStore, loadHolidaySeed, loadNationalHolidays, storePlace, type Holiday } from "@/data/wedash/scheduleHolidays";
import { deleteSchedule, fetchCompDue, fetchSchedule, fetchScheduleDays, saveManualDay, saveSchedule, type StoredDay, type StoredSchedule } from "@/data/wedash/scheduleRepo";
import { ScheduleWizard, type ScheduleWizardValue } from "./ScheduleWizard";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const STATUS_LABEL: Record<DayStatus, string> = {
  work: "Trabalha",
  off: "Folga",
  holiday_work: "Feriado trabalhado",
  comp_off: "Folga compensatória",
};
const CYCLE: DayStatus[] = ["work", "off", "holiday_work", "comp_off"];

const STATUS_BADGE: Record<DayStatus, "success" | "warning" | "info" | "neutral"> = {
  work: "success",
  holiday_work: "warning",
  off: "neutral",
  comp_off: "info",
};

const SCHEDULE_LEGEND: LegendItem[] = [
  { key: "work", color: "bg-ok", label: "Trabalha", hint: "quem está na loja" },
  { key: "off", color: "bg-chip-gray", label: "Folga", hint: "descanso da escala" },
  { key: "holiday", color: "bg-warn", label: "Feriado trabalhado", hint: "abre no feriado" },
  { key: "double", color: "bg-acc", label: "Pagamento em dobro", hint: "feriado com o dobro" },
  { key: "comp", color: "bg-info", label: "Folga compensatória", hint: "folga de quem trabalhou o feriado" },
];

function monthLabel(iso: string): string {
  const date = isoToDate(startOfMonth(iso));
  return `${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
}

function cellsOf(from: string, to: string): Array<string | null> {
  const cells: Array<string | null> = Array.from({ length: isoToDate(from).getDay() }, () => null);
  for (let day = from; day <= to; day = addDays(day, 1)) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
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

const CHIP_ORDER: DayStatus[] = ["work", "holiday_work", "off", "comp_off"];

function DayFaces({
  rows,
  storeId,
  byPerson,
  doublePay,
}: {
  rows: StoredDay[];
  storeId: string;
  byPerson: Map<string, StoreSeller>;
  doublePay: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <>
      {CHIP_ORDER.map((status) => {
        const people = rows
          .filter((row) => row.status === status)
          .sort((a, b) => (byPerson.get(a.sellerId)?.name ?? "").localeCompare(byPerson.get(b.sellerId)?.name ?? "", "pt-BR"));
        if (people.length === 0) return null;
        const holiday = status === "holiday_work" && doublePay;
        const label = holiday ? "Feriado 2×" : STATUS_LABEL[status];
        const color = holiday ? "bg-acc" : status === "work" ? "bg-ok" : status === "holiday_work" ? "bg-warn" : status === "comp_off" ? "bg-info" : "bg-chip-gray";
        const shown = people.slice(0, 3);
        const rest = people.length - shown.length;
        const names = people.map((row) => byPerson.get(row.sellerId)?.name ?? "Pessoa").join(", ");
        return (
          <div
            key={status}
            title={`${label}: ${names}`}
            className={cn("mt-1 flex w-full min-w-0 items-center gap-1 rounded-md px-1 py-1 text-white", color)}
          >
            <span className="flex shrink-0 items-center">
              {shown.map((row, index) => {
                const person = byPerson.get(row.sellerId);
                const name = person?.name ?? "Pessoa";
                return (
                  <PersonAvatar
                    key={row.sellerId}
                    name={name}
                    employeeId={person?.code}
                    storeId={storeId}
                    size="xs"
                    ring
                    className={index > 0 ? "-ml-1.5" : ""}
                  />
                );
              })}
              {rest > 0 ? (
                <span className="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/25 text-[10px] font-bold text-white ring-2 ring-bg-2">
                  +{rest}
                </span>
              ) : null}
            </span>
            <span className="min-w-0 truncate text-[10px] font-semibold sm:text-[11px]">{`${label} ${people.length}`}</span>
          </div>
        );
      })}
    </>
  );
}

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
  const cells = useMemo(() => cellsOf(monthStart, monthEnd), [monthStart, monthEnd]);
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

  async function sundayPlan(storeId: string, team: { id: string; groupId: string | null }[], from: string) {
    const storeShifts = await fetchStoreShifts(session.tenantId, storeId);
    const present = [...new Set(team.map((person) => person.groupId).filter((id): id is string => Boolean(id)))];
    const ordered = storeShifts.map((shift) => shift.id).filter((id) => present.includes(id));
    for (const id of present) if (!ordered.includes(id)) ordered.push(id);
    if (ordered.length < 2) return { sundayShifts: ordered, sundayShiftStart: 0 };
    const previous = await fetchScheduleDays(storeId, addDays(from, -45), addDays(from, -1));
    const last = previous.filter((row) => weekday(row.day) === 0).reduce((max, row) => (row.day > max ? row.day : max), "");
    const shiftOf = new Map(team.map((person) => [person.id, person.groupId]));
    const lastShift = last
      ? shiftThatWorked(
          previous.filter((row) => row.day === last).map((row) => ({ personId: row.sellerId, status: row.status })),
          (id) => shiftOf.get(id) ?? null,
        )
      : null;
    return { sundayShifts: ordered, sundayShiftStart: nextSundayShift(lastShift, ordered) };
  }

  async function generateFor(storeId: string, value: ScheduleWizardValue, selected: SelectedPerson[]) {
    const [year, monthNumber] = value.periodStart.split("-").map(Number);
    const incoming = await fetchCompDue(storeId, value.periodStart);
    const rotation = await sundayPlan(storeId, selected, value.periodStart);
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
      sundayShifts: rotation.sundayShifts,
      sundayShiftStart: rotation.sundayShiftStart,
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
        subtitle="Veja quem trabalha, quem folga e o feriado de cada dia."
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
            <Button icon={<Icon d={icons.plus} size={14} />} disabled={!store || people.length === 0 || loading} onClick={() => setWizard(true)}>
              Nova escala
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
              <PlainKpi label="Dias manuais" value={String(new Set(days.filter((row) => row.origin === "manual").map((row) => row.day)).size)} color="var(--t0)" />
            </div>
            {schedule ? <ColorLegend className="mb-3" items={SCHEDULE_LEGEND} /> : null}
            <MonthCalendar>
              {cells.map((day, index) => {
                const rows = day ? (dayRows.get(day) ?? []) : [];
                const label = day ? holidayLabel(holidays, day) : null;
                const edge = (index + 1) % 7 === 0;
                return (
                  <div key={day ?? `vazio-${index}`} className={`relative min-h-[110px] border-b border-r border-line p-1.5 text-left ${edge ? "border-r-0" : ""} ${day ? "" : "bg-bg-1/30"}`}>
                    {day && schedule ? (
                      <button type="button" className="absolute inset-0 z-0" aria-label={`Ajustar ${day.split("-")[2]}`} onClick={() => setDayOpen(day)} />
                    ) : null}
                    {day ? (
                      <div className="pointer-events-none relative z-10">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold ${day === today ? "bg-acc text-white" : "text-t0"}`}>{Number(day.slice(8))}</span>
                        {label ? <p className="mt-1 line-clamp-2 text-[10px] font-semibold leading-tight text-warn">{label}</p> : null}
                        <DayFaces rows={rows} storeId={store.id} byPerson={byPerson} doublePay={Boolean(schedule?.holidayRules.some((rule) => rule.date === day && rule.pay === "double"))} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </MonthCalendar>
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
          onReset={async () => {
            if (!schedule) return;
            const from = schedule.periodStart ?? monthStart;
            const to = schedule.periodEnd ?? monthEnd;
            const [year, monthNumber] = from.split("-").map(Number);
            const team = schedule.people.map((person) => ({
              id: person.sellerId,
              fixedOffDow: person.fixedOffDow,
              sex: person.sex,
              groupId: people.find((row) => row.id === person.sellerId)?.shiftId ?? null,
            }));
            const incoming = await fetchCompDue(store.id, from);
            const rotation = await sundayPlan(store.id, team, from);
            const generated = generateMonth({
              year,
              month: monthNumber,
              from,
              to,
              pattern: schedule.pattern,
              offMode: schedule.offMode,
              sundayMin: schedule.sundayMin,
              womenSunday: schedule.womenSunday,
              menSunday: schedule.menSunday,
              people: team,
              holidayDates: [],
              dayNeeds: schedule.dayNeeds,
              groupNeeds: schedule.groupNeeds,
              holidayRules: schedule.holidayRules,
              incomingComp: incoming,
              sundayShifts: rotation.sundayShifts,
              sundayShiftStart: rotation.sundayShiftStart,
            }).days.filter((row) => row.date === dayOpen);
            try {
              await saveDay(generated.map((row) => ({ sellerId: row.personId, day: row.date, status: row.status, origin: "generated" as const })));
              setDayOpen(null);
              show("Dia voltou ao padrão.", "success");
            } catch (caught) {
              show(caught instanceof Error ? caught.message : "Não foi possível voltar ao padrão.", "danger");
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

function DayEditor({
  day,
  holiday,
  doublePay,
  rows,
  storeId,
  names,
  onClose,
  onSave,
  onReset,
}: {
  day: string;
  holiday: string | null;
  doublePay: boolean;
  rows: StoredDay[];
  storeId: string;
  names: Map<string, StoreSeller>;
  onClose: () => void;
  onSave: (rows: StoredDay[]) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(rows);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const ordered = [...draft].sort((a, b) => (names.get(a.sellerId)?.name ?? "").localeCompare(names.get(b.sellerId)?.name ?? "", "pt-BR"));
  const missing = [...names.values()].filter((person) => !draft.some((row) => row.sellerId === person.id)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  function addPerson() {
    if (!pick || draft.some((row) => row.sellerId === pick)) return;
    setDraft((current) => [...current, { sellerId: pick, day, status: "work", origin: "manual" }]);
    setPick("");
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={`Dia ${Number(day.slice(8))}`}
      footer={
        <div className="flex flex-wrap justify-between gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onReset().finally(() => setBusy(false));
            }}
          >
            Voltar ao padrão
          </Button>
          <div className="flex gap-2">
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
        </div>
      }
    >
      {holiday ? <p className="mb-3 text-[13px] font-semibold text-warn">{holiday}</p> : null}
      <p className="mb-3 text-[12.5px] text-t2">Inclua, tire ou mude a situação de cada pessoa. Voltar ao padrão restaura o dia gerado.</p>
      {ordered.length === 0 ? <p className="text-[13px] text-t2">Ninguém neste dia.</p> : null}
      <ul className="space-y-2">
        {ordered.map((row) => {
          const person = names.get(row.sellerId);
          const name = person?.name ?? "Pessoa";
          return (
            <li key={row.sellerId} className="flex min-w-0 items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <PersonAvatar name={name} employeeId={person?.code} storeId={storeId} size="sm" />
                <span className="truncate text-[13.5px] font-semibold text-t0">{name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="shrink-0"
                  aria-label={`Mudar a situação de ${name}`}
                  onClick={() =>
                    setDraft((current) =>
                      current.map((item) => {
                        if (item.sellerId !== row.sellerId) return item;
                        const next = CYCLE[(CYCLE.indexOf(item.status) + 1) % CYCLE.length];
                        return { ...item, status: next, origin: "manual" };
                      }),
                    )
                  }
                >
                  <Badge variant={row.status === "holiday_work" && doublePay ? "accent" : STATUS_BADGE[row.status]}>
                    {STATUS_LABEL[row.status]}{row.status === "holiday_work" && doublePay ? " 2×" : ""}
                  </Badge>
                </button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setDraft((current) => current.filter((item) => item.sellerId !== row.sellerId))}>
                  Remover
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
      {missing.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <FormField label="Adicionar pessoa">
              <Select value={pick} onChange={(event) => setPick(event.target.value)} aria-label="Pessoa para incluir no dia">
                <option value="">Escolha</option>
                {missing.map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </Select>
            </FormField>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={!pick} onClick={addPerson}>
            Adicionar
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}