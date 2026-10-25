import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, EmptyState, Modal, useToast } from "@/components/ui";
import { MonthCalendar } from "@/components/wedash/MonthCalendar";
import { PlainKpi } from "@/pages/cash-close/CashClosePage";
import { MonthStep, monthNavBtn } from "@/pages/cash-close/MonthYearPicker";
import { SectionHeader, useScopedStores } from "@/pages/operation/shared";
import { isOwner } from "@/layout/nav-wedash";
import { calendarTodayIso } from "@/data/wedash/clock";
import { addDays, addMonths, endOfMonth, isoToDate, startOfMonth } from "@/data/wedash/engine/format";
import { fetchGoals } from "@/data/wedash/goalsRepo";
import { monthCoveredByGoal, scheduleStartMonth, type GoalSpan } from "@/data/wedash/goalMonths";
import { branchRoleLabel, fetchStoreSellers, fetchStoreShifts, isBranchTeamMember, storesForSession, type StoreSeller, type StoreShift } from "@/data/wedash/stores";
import { defaultDayNeeds, generateMonth, weekday, type DayStatus, type GroupNeed, type Sex } from "@/data/wedash/scheduleGenerate";
import { holidayLabel, holidaysForStore, loadHolidaySeed, loadNationalHolidays, storePlace, type Holiday } from "@/data/wedash/scheduleHolidays";
import { deleteSchedule, fetchCompDue, fetchSchedule, saveManualDay, saveSchedule, type StoredDay, type StoredSchedule } from "@/data/wedash/scheduleRepo";
import { ScheduleWizard, type ScheduleWizardValue } from "./ScheduleWizard";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const STATUS_LABEL: Record<DayStatus, string> = {
  work: "Trabalha",
  off: "Folga",
  holiday_work: "Feriado trabalhado",
  comp_off: "Folga compensatória",
};
const CYCLE: DayStatus[] = ["work", "off", "holiday_work", "comp_off"];

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
  const [notice, setNotice] = useState<string | null>(null);
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

  const otherStores = isOwner(session.role)
    ? storesForSession(session.stores)
        .filter((row) => row.id !== store?.id)
        .map((row) => ({ id: row.id, name: row.tradeName || row.name }))
    : [];

  const initialWizard = (): ScheduleWizardValue => ({
    pattern: schedule?.pattern ?? "6x1",
    offMode: schedule?.offMode ?? "rotating",
    sundayMin: schedule?.sundayMin ?? 1,
    womenSunday: schedule?.womenSunday ?? "every_2",
    menSunday: schedule?.menSunday ?? "every_3",
    selectedIds: schedule ? schedule.people.map((person) => person.sellerId) : people.map((person) => person.id),
    sex: Object.fromEntries(people.map((person) => [person.id, schedule?.people.find((row) => row.sellerId === person.id)?.sex ?? "woman"])),
    fixedOff: Object.fromEntries(schedule?.people.map((person) => [person.sellerId, person.fixedOffDow ?? 1]) ?? []),
    dayNeeds: schedule && schedule.dayNeeds.length === 7 ? schedule.dayNeeds : defaultDayNeeds(),
    groupNeeds: schedule?.groupNeeds ?? [],
    holidayRules: schedule?.holidayRules ?? [],
    copyStoreIds: [],
    replaceManual: false,
  });

  function coverageFor(selected: SelectedPerson[], value: ScheduleWizardValue): GroupNeed[] {
    const ids = [...new Set(selected.map((person) => person.groupId).filter((id): id is string => Boolean(id)))];
    return ids.map((groupId) => ({ groupId, min: value.groupNeeds.find((row) => row.groupId === groupId)?.min ?? 2 }));
  }

  async function generateFor(storeId: string, value: ScheduleWizardValue, selected: SelectedPerson[], groupNeeds: GroupNeed[]) {
    const [year, monthNumber] = monthStart.split("-").map(Number);
    const incoming = await fetchCompDue(storeId, monthStart);
    const generated = generateMonth({
      year,
      month: monthNumber,
      pattern: value.pattern,
      offMode: value.offMode,
      sundayMin: value.sundayMin,
      womenSunday: value.womenSunday,
      menSunday: value.menSunday,
      people: selected.map((person) => ({
        id: person.id,
        fixedOffDow: value.offMode === "fixed" ? person.fixedOffDow : null,
        sex: person.sex,
        groupId: person.groupId,
      })),
      holidayDates: [],
      dayNeeds: value.dayNeeds,
      groupNeeds,
      holidayRules: value.holidayRules,
      incomingComp: incoming,
    });
    const known = new Set(holidays.filter((row) => row.kind !== "municipal").map((row) => row.date));
    return saveSchedule({
      tenantId: session.tenantId,
      storeId,
      monthStart,
      pattern: value.pattern,
      offMode: value.offMode,
      sundayMin: value.sundayMin,
      extraHolidays: value.holidayRules.filter((rule) => !known.has(rule.date)).map((rule) => ({ day: Number(rule.date.slice(8, 10)), name: rule.name })),
      womenSunday: value.womenSunday,
      menSunday: value.menSunday,
      dayNeeds: value.dayNeeds,
      groupNeeds,
      holidayRules: value.holidayRules,
      compDue: generated.compDue,
      people: selected.map((person) => ({ sellerId: person.id, fixedOffDow: value.offMode === "fixed" ? person.fixedOffDow : null, sex: person.sex })),
      days: generated.days.map((row) => ({ sellerId: row.personId, day: row.date, status: row.status })),
      keepManual: !value.replaceManual,
    });
  }

  async function onGenerate(value: ScheduleWizardValue) {
    if (!store) return;
    setSaving(true);
    try {
      const selected = value.selectedIds.map((id, index) => ({
        id,
        fixedOffDow: value.fixedOff[id] ?? ((index % 6) + 1),
        sex: value.sex[id] ?? "woman",
        groupId: people.find((person) => person.id === id)?.shiftId ?? null,
      }));
      const result = await generateFor(store.id, value, selected, coverageFor(selected, value));
      let kept = result.keptManualDays;
      if (value.copyStoreIds.length > 0) {
        const teams = await fetchStoreSellers(session.tenantId, value.copyStoreIds);
        for (const storeId of value.copyStoreIds) {
          const team = (teams.get(storeId) ?? []).filter((person) => isBranchTeamMember(person));
          const copiedPeople = team.map((person, index) => ({ id: person.id, fixedOffDow: (index % 6) + 1, sex: "woman" as const, groupId: person.shiftId }));
          const groupFloor = value.groupNeeds.length > 0 ? Math.max(...value.groupNeeds.map((row) => row.min)) : 2;
          const copied = await generateFor(
            storeId,
            value,
            copiedPeople,
            coverageFor(copiedPeople, { ...value, groupNeeds: [] }).map((row) => ({ ...row, min: groupFloor })),
          );
          kept += copied.keptManualDays;
        }
      }
      setNotice(kept > 0 ? `Escala gerada. ${kept} ${kept === 1 ? "dia ajustado na mão foi mantido" : "dias ajustados na mão foram mantidos"}.` : "Escala gerada.");
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
            <Button disabled={!store || people.length === 0 || loading} onClick={() => setWizard(true)}>
              Gerar escala
            </Button>
            <Button variant="outline" disabled={!store || !schedule} onClick={() => setConfirmDelete(true)}>
              Apagar escala
            </Button>
          </div>
        }
      />
      <div className="mt-6 pb-8">
        {error ? <Alert className="mb-4" variant="danger" title="Não foi possível carregar a escala. Tente novamente." /> : null}
        {notice ? <Alert className="mb-4" variant="success" title={notice} /> : null}
        {!store ? (
          <Card>
            <EmptyState icon="📅" title="Escolha uma filial" description="Com várias filiais no seletor, o dia não abre. Escolha uma para ver, gerar e ajustar a escala." />
          </Card>
        ) : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <PlainKpi label="Pessoas" value={String(schedule?.people.length ?? people.length)} color="var(--t0)" />
              <PlainKpi label="Modelo" value={patternLabel} color="var(--acc)" />
              <PlainKpi label="Feriados" value={String(holidayCount)} color="var(--warn)" />
              <PlainKpi label="Dias manuais" value={String(new Set(days.filter((row) => row.origin === "manual").map((row) => row.day)).size)} color="var(--t0)" />
            </div>
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
                        <div className="flex items-start justify-between gap-1">
                          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold ${day === today ? "bg-acc text-white" : "text-t0"}`}>{Number(day.slice(8))}</span>
                          {weekday(day) === 0 ? <span className="text-[10px] font-semibold text-t2">Dom</span> : null}
                        </div>
                        {label ? <p className="mt-1 line-clamp-2 text-[10px] font-semibold leading-tight text-warn">{label}</p> : null}
                        <div className="mt-1 flex flex-col gap-0.5">
                          {rows.slice(0, 4).map((row) => {
                            const double = row.status === "holiday_work" && schedule?.holidayRules.some((rule) => rule.date === day && rule.pay === "double");
                            return (
                              <Badge
                                key={row.sellerId}
                                title={double ? "Pagamento em dobro" : row.origin === "manual" ? "Ajustado na mão" : undefined}
                                variant={row.status === "off" || row.status === "comp_off" ? "neutral" : row.status === "holiday_work" ? "warning" : "success"}
                                className="max-w-full truncate"
                              >
                                {byPerson.get(row.sellerId)?.name ?? "Pessoa"}{double ? " 2×" : ""}
                              </Badge>
                            );
                          })}
                          {rows.length > 4 ? <span className="text-[10px] text-t2">+{rows.length - 4}</span> : null}
                        </div>
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
          }))}
          otherStores={otherStores}
          hasSchedule={schedule != null}
          monthLabel={monthLabel(monthStart)}
          monthStart={monthStart}
          nationalHolidays={holidays.filter((row) => row.date >= monthStart && row.date <= monthEnd)}
          initial={initialWizard()}
          saving={saving}
          onSubmit={(value) => void onGenerate(value)}
        />
      ) : null}
      {store && dayOpen ? (
        <DayEditor
          day={dayOpen}
          holiday={holidayLabel(holidays, dayOpen)}
          rows={dayRows.get(dayOpen) ?? []}
          names={byPerson}
          onClose={() => setDayOpen(null)}
          onSave={async (next) => {
            try {
              await saveDay(next);
              setDayOpen(null);
            } catch (caught) {
              show(caught instanceof Error ? caught.message : "Não foi possível salvar o dia.", "danger");
            }
          }}
          onReset={async () => {
            if (!schedule) return;
            const [year, monthNumber] = monthStart.split("-").map(Number);
            const incoming = await fetchCompDue(store.id, monthStart);
            const generated = generateMonth({
              year,
              month: monthNumber,
              pattern: schedule.pattern,
              offMode: schedule.offMode,
              sundayMin: schedule.sundayMin,
              womenSunday: schedule.womenSunday,
              menSunday: schedule.menSunday,
              people: schedule.people.map((person) => ({
                id: person.sellerId,
                fixedOffDow: person.fixedOffDow,
                sex: person.sex,
                groupId: people.find((row) => row.id === person.sellerId)?.shiftId ?? null,
              })),
              holidayDates: [],
              dayNeeds: schedule.dayNeeds,
              groupNeeds: schedule.groupNeeds,
              holidayRules: schedule.holidayRules,
              incomingComp: incoming,
            }).days.filter((row) => row.date === dayOpen);
            try {
              await saveDay(generated.map((row) => ({ sellerId: row.personId, day: row.date, status: row.status, origin: "generated" as const })));
              setDayOpen(null);
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
                    setNotice("Escala apagada. O feriado continua no calendário.");
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
  rows,
  names,
  onClose,
  onSave,
  onReset,
}: {
  day: string;
  holiday: string | null;
  rows: StoredDay[];
  names: Map<string, StoreSeller>;
  onClose: () => void;
  onSave: (rows: StoredDay[]) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(rows);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
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
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
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
      <ul className="space-y-2">
        {draft.map((row) => (
          <li key={row.sellerId} className="flex items-center justify-between gap-3">
            <span className="truncate text-[13.5px] font-semibold text-t0">{names.get(row.sellerId)?.name ?? "Pessoa"}</span>
            <button
              type="button"
              className="shrink-0"
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
              <Badge variant={row.status === "off" || row.status === "comp_off" ? "neutral" : row.status === "holiday_work" ? "warning" : "success"}>
                {STATUS_LABEL[row.status]}
              </Badge>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}