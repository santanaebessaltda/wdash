import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, DatePicker, FormField, Input, Modal, Select, WizardCardHeader, WizardNav, WizardSteps } from "@/components/ui";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { Icon, icons } from "@/pages/users/Icons";
import { cn } from "@/lib/cn";
import { dateToIso, isoToDate } from "@/lib/format";
import { defaultDayNeeds, patternFits, weekdayLabel, type CompWindow, type DayNeed, type GroupNeed, type HolidayRule, type OffMode, type SchedulePattern, type ScheduleScenario, type Sex, type SundayRule } from "@/data/wedash/scheduleGenerate";
import { paths } from "@/router/paths";

const STEPS = [
  { num: 1, label: "Escala" },
  { num: 2, label: "Equipe" },
  { num: 3, label: "Dias" },
  { num: 4, label: "Feriados" },
];

const TYPES: { id: SchedulePattern; title: string; detail: string }[] = [
  { id: "6x1", title: "6×1", detail: "Uma folga por semana" },
  { id: "5x2", title: "5×2", detail: "Duas folgas por semana" },
  { id: "4x3", title: "4×3", detail: "Três folgas por semana" },
  { id: "12x36", title: "12×36", detail: "Um dia trabalha, o outro folga" },
];

const WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const SUNDAY_OPTIONS: { id: SundayRule; label: string }[] = [
  { id: "every_3", label: "Um a cada três domingos" },
  { id: "every_2", label: "Um a cada dois domingos" },
  { id: "all", label: "Todos os domingos" },
  { id: "none", label: "Nenhum obrigatório" },
];

export type WizardPerson = {
  id: string;
  name: string;
  role: string;
  groupId: string | null;
  groupName: string;
  /** Código no Millennium, para achar a foto da conta. */
  code: string | null;
  storeId: string;
};

export type ScheduleWizardValue = {
  scenario: ScheduleScenario;
  pattern: SchedulePattern;
  offMode: OffMode;
  sundayMin: number;
  womenSunday: SundayRule;
  menSunday: SundayRule;
  periodStart: string;
  periodEnd: string;
  selectedIds: string[];
  sex: Record<string, Sex>;
  fixedOff: Record<string, number>;
  dayNeeds: DayNeed[];
  groupNeeds: GroupNeed[];
  holidayRules: HolidayRule[];
  replaceManual: boolean;
};

function defaultRule(date: string, name: string): HolidayRule {
  return { date, name, open: true, workers: 1, pay: "extra_off", window: "7_days" };
}

function CountField({
  value,
  disabled,
  label,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  label: string;
  onChange: (next: number) => void;
}) {
  const next = (raw: number) => onChange(Math.min(99, Math.max(0, Math.floor(raw) || 0)));
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-vela-md)] border border-line bg-bg-inset text-t0 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled || value <= 0}
        aria-label={`Diminuir ${label}`}
        onClick={() => next(value - 1)}
      >
        <Icon d={icons.minus} size={14} />
      </button>
      <Input
        inputMode="numeric"
        disabled={disabled}
        value={value}
        aria-label={label}
        onChange={(event) => next(Number(event.target.value.replace(/\D/g, "")))}
        className="h-9! w-12 px-1 text-center"
      />
      <button
        type="button"
        className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-vela-md)] border border-line bg-bg-inset text-t0 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled || value >= 99}
        aria-label={`Aumentar ${label}`}
        onClick={() => next(value + 1)}
      >
        <Icon d={icons.plus} size={14} />
      </button>
    </div>
  );
}

function periodDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function ScheduleWizard({
  open,
  onClose,
  people,
  hasSchedule,
  nationalHolidays,
  initial,
  saving,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  people: WizardPerson[];
  hasSchedule: boolean;
  nationalHolidays: { date: string; name: string }[];
  initial: ScheduleWizardValue;
  saving: boolean;
  onSubmit: (value: ScheduleWizardValue) => void;
}) {
  const [step, setStep] = useState(1);
  const [dismissed, setDismissed] = useState<string[]>(() => {
    if (initial.holidayRules.length === 0) return [];
    const kept = new Set(initial.holidayRules.map((rule) => rule.date));
    return nationalHolidays.filter((row) => row.date >= initial.periodStart && row.date <= initial.periodEnd && !kept.has(row.date)).map((row) => row.date);
  });
  const [value, setValue] = useState(() => ({
    ...initial,
    dayNeeds: initial.dayNeeds.length === 7 ? initial.dayNeeds : defaultDayNeeds(),
    holidayRules: initial.holidayRules.length > 0 ? initial.holidayRules : nationalHolidays.filter((row) => row.date >= initial.periodStart && row.date <= initial.periodEnd).map((row) => defaultRule(row.date, row.name)),
  }));
  const [extraDate, setExtraDate] = useState("");
  const [extraName, setExtraName] = useState("");
  const [addingHoliday, setAddingHoliday] = useState(false);
  const days = periodDays(value.periodStart, value.periodEnd);
  const periodOk = value.periodEnd >= value.periodStart && days > 0 && days <= 93;
  const types = TYPES.filter((item) => patternFits(value.scenario, item.id));
  const selectedType = TYPES.find((item) => item.id === value.pattern);
  const selectedPeople = people.filter((person) => value.selectedIds.includes(person.id));
  const shifts = [...new Map(selectedPeople.filter((person) => person.groupId).map((person) => [person.groupId as string, person.groupName || "Turno"])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const unassigned = selectedPeople.filter((person) => !person.groupId);

  function shownMin(groupId: string, dow: number, source: typeof value): number {
    const exact = source.groupNeeds.find((row) => row.groupId === groupId && row.dow === dow);
    if (exact) return exact.min;
    const legacy = source.groupNeeds.find((row) => row.groupId === groupId && row.dow == null);
    if (legacy) return legacy.min;
    return source.dayNeeds.find((row) => row.dow === dow)?.min ?? 1;
  }

  function withShiftNeeds(source: typeof value): typeof value {
    if (unassigned.length > 0 || shifts.length === 0) return source;
    const groupNeeds: GroupNeed[] = [];
    for (const day of source.dayNeeds) {
      for (const shift of shifts) groupNeeds.push({ groupId: shift.id, dow: day.dow, min: shownMin(shift.id, day.dow, source) });
    }
    return { ...source, dayNeeds: source.dayNeeds.map((day) => ({ ...day, min: 0 })), groupNeeds };
  }

  function setShiftMin(groupId: string, dow: number, min: number) {
    setValue((current) => {
      const next = withShiftNeeds(current);
      return { ...next, groupNeeds: next.groupNeeds.map((row) => (row.groupId === groupId && row.dow === dow ? { ...row, min } : row)) };
    });
  }

  function rulesFor(start: string, end: string, current: HolidayRule[], skipped: string[]): HolidayRule[] {
    const kept = current.filter((rule) => rule.date >= start && rule.date <= end);
    const have = new Set([...kept.map((rule) => rule.date), ...skipped]);
    const added = nationalHolidays.filter((row) => row.date >= start && row.date <= end && !have.has(row.date)).map((row) => defaultRule(row.date, row.name));
    return [...kept, ...added].sort((a, b) => a.date.localeCompare(b.date));
  }

  function setPeriod(patch: { periodStart?: string; periodEnd?: string }) {
    setValue((current) => {
      const next = { ...current, ...patch };
      if (!next.periodStart || !next.periodEnd || next.periodEnd < next.periodStart) return next;
      return { ...next, holidayRules: rulesFor(next.periodStart, next.periodEnd, current.holidayRules, dismissed) };
    });
  }

  function setScenario(scenario: ScheduleScenario) {
    setValue((current) => ({
      ...current,
      scenario,
      pattern: patternFits(scenario, current.pattern) ? current.pattern : "5x2",
    }));
  }

  function addMunicipal() {
    const name = extraName.trim();
    if (!extraDate || extraDate < value.periodStart || extraDate > value.periodEnd || !name) return;
    setDismissed((current) => current.filter((date) => date !== extraDate));
    setValue((current) => ({ ...current, holidayRules: [...current.holidayRules.filter((rule) => rule.date !== extraDate), defaultRule(extraDate, name)].sort((a, b) => a.date.localeCompare(b.date)) }));
    setExtraDate("");
    setExtraName("");
    setAddingHoliday(false);
  }

  function patchRule(date: string, patch: Partial<HolidayRule>) {
    setValue((current) => ({
      ...current,
      holidayRules: current.holidayRules.map((rule) => (rule.date === date ? { ...rule, ...patch } : rule)),
    }));
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title="Nova escala"
      size="lg"
      bodyClassName="overflow-x-hidden overflow-y-auto p-5"
      footer={
        <WizardNav
          hidePrevious={step === 1}
          previousDisabled={saving}
          nextDisabled={saving || (step === 1 && !periodOk) || (step === 2 && value.selectedIds.length === 0) || (step === 3 && unassigned.length > 0)}
          nextLabel={step === 4 ? (saving ? "Criando…" : "Nova escala") : "Continuar"}
          hideNextIcon={step === 4}
          onPrevious={() => setStep((current) => current - 1)}
          onNext={() => (step === 4 ? onSubmit(withShiftNeeds(value)) : setStep((current) => current + 1))}
        />
      }
    >
      <WizardSteps steps={STEPS} current={step} />
      {step === 1 ? (
        <>
          <WizardCardHeader title={<>Qual escala montar?<span className="text-bad"> *</span></>} subtitle="O cenário, o tipo e o período. A escala começa no primeiro dia." />
          <div className="flex flex-col gap-4">
          <FormField label="Cenário" required>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => setScenario("before_6x1")} className={cn("rounded-[var(--radius-vela-md)] border px-3 py-3 text-left", value.scenario === "before_6x1" ? "border-acc bg-acc-soft" : "border-line bg-bg-inset")}>
                <span className="block text-[14px] font-bold text-t0">Antes do fim da 6×1</span>
                <span className="mt-1 block text-[12px] text-t2">6×1, 5×2, 4×3 e 12×36.</span>
              </button>
              <button type="button" onClick={() => setScenario("after_6x1")} className={cn("rounded-[var(--radius-vela-md)] border px-3 py-3 text-left", value.scenario === "after_6x1" ? "border-acc bg-acc-soft" : "border-line bg-bg-inset")}>
                <span className="block text-[14px] font-bold text-t0">Após o fim da 6×1</span>
                <span className="mt-1 block text-[12px] text-t2">Duas ou mais folgas por semana.</span>
              </button>
            </div>
          </FormField>
          <FormField label="Tipo de escala" required hint={`${selectedType?.detail}. Os dias fechados e as folgas de domingo também entram na conta.`}>
            <Select value={value.pattern} onChange={(event) => setValue((current) => ({ ...current, pattern: event.target.value as SchedulePattern }))}>
              {types.map((item) => (
                <option key={item.id} value={item.id}>{item.title} · {item.detail}</option>
              ))}
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Data de início" required error={value.periodStart ? undefined : "Informe a data de início."}>
              <DatePicker
                value={value.periodStart ? isoToDate(value.periodStart) : null}
                onChange={(day) => {
                  const next = dateToIso(day);
                  setPeriod(value.periodEnd && value.periodEnd < next ? { periodStart: next, periodEnd: "" } : { periodStart: next });
                }}
                invalid={!value.periodStart}
                aria-label="Data de início"
              />
            </FormField>
            <FormField label="Data de fim" required error={periodOk ? undefined : "A data de fim precisa ser depois da data de início, em até 93 dias."}>
              <DatePicker
                value={value.periodEnd ? isoToDate(value.periodEnd) : null}
                onChange={(day) => setPeriod({ periodEnd: dateToIso(day) })}
                minDate={value.periodStart ? isoToDate(value.periodStart) : null}
                invalid={!periodOk}
                aria-label="Data de fim"
              />
            </FormField>
          </div>
          {periodOk ? <p className="text-[12px] text-t2">A escala começa em {value.periodStart.split("-").reverse().join("/")} e segue até {value.periodEnd.split("-").reverse().join("/")}. O ciclo conta a partir do primeiro dia.</p> : null}
          </div>
        </>
      ) : null}
      {step === 2 ? (
        <>
          <WizardCardHeader title={<>Quem vai trabalhar?<span className="text-bad"> *</span></>} subtitle="A equipe desta filial. O sexo organiza a folga de domingo." />
          <ul className="space-y-2">
            {people.length === 0 ? <li className="text-[13px] text-t2">Nenhuma pessoa ativa nesta filial.</li> : null}
            {people.map((person) => (
              <li key={person.id} className="min-w-0 rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3 py-2">
                <div className="flex min-w-0 items-center gap-3">
                  <input
                    type="checkbox"
                    className="shrink-0"
                    checked={value.selectedIds.includes(person.id)}
                    onChange={() =>
                      setValue((current) => ({
                        ...current,
                        selectedIds: current.selectedIds.includes(person.id) ? current.selectedIds.filter((id) => id !== person.id) : [...current.selectedIds, person.id],
                        sex: { ...current.sex, [person.id]: current.sex[person.id] ?? "woman" },
                      }))
                    }
                  />
                  <PersonAvatar name={person.name} employeeId={person.code} storeId={person.storeId} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-t0">{person.name}</span>
                    <span className="block truncate text-[12px] text-t2">{person.groupName || person.role}</span>
                  </span>
                  <label className="shrink-0 text-[12px] font-bold text-t0">
                    Sexo<span className="text-bad"> *</span>
                    <Select className="mt-1 h-9! w-[7.5rem]! px-2!" aria-label={`Sexo de ${person.name}`} value={value.sex[person.id] ?? "woman"} onChange={(event) => setValue((current) => ({ ...current, sex: { ...current.sex, [person.id]: event.target.value as Sex } }))}>
                      <option value="woman">Mulher</option>
                      <option value="man">Homem</option>
                    </Select>
                  </label>
                </div>
                {value.selectedIds.includes(person.id) ? (
                  <label className="mt-2 flex min-w-0 items-center justify-between gap-3 text-[12px] text-t2">
                    Dia de folga
                    <Select
                      className="h-9! w-[9.5rem]! shrink-0 px-2!"
                      aria-label={`Dia de folga de ${person.name}`}
                      value={value.fixedOff[person.id] ?? ""}
                      onChange={(event) =>
                        setValue((current) => ({
                          ...current,
                          fixedOff: event.target.value ? { ...current.fixedOff, [person.id]: Number(event.target.value) } : Object.fromEntries(Object.entries(current.fixedOff).filter(([id]) => id !== person.id)),
                        }))
                      }
                    >
                      <option value="">Automático</option>
                      {WEEKDAYS.map((label, index) => (
                        <option key={label} value={index + 1}>{label}</option>
                      ))}
                    </Select>
                  </label>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-t2">No automático, a folga muda ao longo do período. Quem precisa do mesmo dia toda semana escolhe o dia.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <FormField label="Mulheres folgam" required>
              <Select value={value.womenSunday} onChange={(event) => setValue((current) => ({ ...current, womenSunday: event.target.value as SundayRule }))}>
                {SUNDAY_OPTIONS.filter((option) => option.id !== "every_3").map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Homens folgam" required>
              <Select value={value.menSunday} onChange={(event) => setValue((current) => ({ ...current, menSunday: event.target.value as SundayRule }))}>
                {SUNDAY_OPTIONS.filter((option) => option.id !== "none").map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </Select>
            </FormField>
          </div>
          <p className="mt-2 text-[12px] text-t2">Com o domingo desmarcado, todo mundo folga.</p>
        </>
      ) : null}
      {step === 3 ? (
        <>
          <WizardCardHeader title="Em quais dias a empresa abre?" subtitle="Desmarque o dia em que todos ficam de folga." />
          {unassigned.length > 0 ? (
            <Alert
              variant="warning"
              title="Falta o grupo de alguém"
              action={
                <Link to={paths.management.team} className="shrink-0 text-[12.5px] font-bold text-acc">
                  Abrir Equipe
                </Link>
              }
            >
              {unassigned.length === 1 ? `${unassigned[0].name} não tem grupo.` : `${unassigned.map((person) => person.name).join(", ")} não têm grupo.`} Escolha o grupo de cada pessoa em Equipe e volte para montar a escala.
            </Alert>
          ) : (
            <>
              <p className="text-[13px] font-semibold text-t0">Quantas pessoas de cada turno?</p>
              <p className="mt-1 mb-3 text-[12px] text-t2">
                {shifts.length > 1
                  ? "O número é só daquele turno, no dia marcado. Os domingos revezam entre os turnos e continuam a partir do domingo anterior."
                  : "O número é o mínimo desse turno em cada dia aberto."}
              </p>
              <ul className="space-y-2">
                {value.dayNeeds.map((day) => (
                  <li key={day.dow} className="border-b border-line py-2">
                    <label className="flex min-w-0 items-center gap-2 text-[13.5px] text-t0">
                      <input
                        type="checkbox"
                        className="shrink-0"
                        checked={day.open}
                        onChange={(event) =>
                          setValue((current) => ({
                            ...current,
                            dayNeeds: current.dayNeeds.map((item) => (item.dow === day.dow ? { ...item, open: event.target.checked } : item)),
                          }))
                        }
                      />
                      <span className="truncate font-semibold">{weekdayLabel(day.dow)}</span>
                    </label>
                    {day.open
                      ? shifts.map((shift) => (
                          <div key={shift.id} className="mt-2 flex min-w-0 items-center justify-between gap-3 pl-6">
                            <span className="min-w-0 truncate text-[13px] text-t0">{shift.name}</span>
                            <div className="flex shrink-0 items-center gap-2 text-[12px] text-t2">
                              <span>
                                Pelo menos<span className="text-bad"> *</span>
                              </span>
                              <CountField value={shownMin(shift.id, day.dow, value)} label={`pessoas de ${shift.name} em ${weekdayLabel(day.dow)}`} onChange={(min) => setShiftMin(shift.id, day.dow, min)} />
                            </div>
                          </div>
                        ))
                      : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : null}
      {step === 4 ? (
        <>
          <WizardCardHeader title="Vai abrir nos feriados?" subtitle="O nacional já vem na lista. Inclua o municipal ou remova o que não vale nesta loja." />
          <ul className="space-y-3">
            {value.holidayRules.length === 0 ? <li className="text-[13px] text-t2">Nenhum feriado neste período.</li> : null}
            {value.holidayRules.map((rule) => (
              <li key={`${rule.date}-${rule.name}`} className="min-w-0 rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3 py-3">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold text-t0">{rule.name}</span>
                    <span className="text-[12px] text-t2">{rule.date.split("-").reverse().join("/")}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDismissed((current) => [...current, rule.date]);
                      setValue((current) => ({ ...current, holidayRules: current.holidayRules.filter((item) => item !== rule) }));
                    }}
                  >
                    Remover
                  </Button>
                </div>
                <label className="mt-2 flex items-center gap-2 text-[13px] text-t0">
                  <input type="checkbox" className="shrink-0" checked={rule.open} onChange={(event) => patchRule(rule.date, { open: event.target.checked })} />
                  A empresa abre neste feriado
                </label>
                {rule.open ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <FormField label="Pessoas trabalhando" required>
                      <CountField value={rule.workers} label={`pessoas trabalhando em ${rule.name}`} onChange={(workers) => patchRule(rule.date, { workers })} />
                    </FormField>
                    <FormField label="Quem trabalha recebe" required>
                      <Select value={rule.pay} aria-label={`Pagamento de ${rule.name}`} onChange={(event) => patchRule(rule.date, { pay: event.target.value as HolidayRule["pay"] })}>
                        <option value="extra_off">Uma folga adicional</option>
                        <option value="double">Pagamento em dobro</option>
                      </Select>
                    </FormField>
                    {rule.pay === "extra_off" ? (
                      <div className="sm:col-span-2">
                        <FormField label="Quando a folga acontece" required>
                          <Select value={rule.window} aria-label={`Janela da folga de ${rule.name}`} onChange={(event) => patchRule(rule.date, { window: event.target.value as CompWindow })}>
                            <option value="7_days">Nos 7 dias seguintes</option>
                            <option value="month_end">Até o último dia do mês</option>
                            <option value="next_month">No mês seguinte</option>
                          </Select>
                        </FormField>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {addingHoliday ? (
            <section className="mt-4 rounded-[var(--radius-vela-lg)] border border-line bg-bg-2 p-3">
              <p className="text-[12.5px] font-bold text-t0">Feriado municipal</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-t2">Feriado desta cidade que a lista não trouxe.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <FormField label="Data do feriado" required>
                    <DatePicker
                      value={extraDate ? isoToDate(extraDate) : null}
                      onChange={(day) => setExtraDate(dateToIso(day))}
                      minDate={value.periodStart ? isoToDate(value.periodStart) : null}
                      maxDate={value.periodEnd ? isoToDate(value.periodEnd) : null}
                      aria-label="Data do feriado municipal"
                    />
                  </FormField>
                </div>
                <div className="min-w-0 flex-1">
                  <FormField label="Nome do feriado" required>
                    <Input placeholder="Feriado municipal" value={extraName} onChange={(event) => setExtraName(event.target.value)} aria-label="Nome do feriado municipal" />
                  </FormField>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={!extraDate || !extraName.trim()} onClick={addMunicipal}>
                  Adicionar feriado
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setExtraDate("");
                    setExtraName("");
                    setAddingHoliday(false);
                  }}
                >
                  Remover
                </Button>
              </div>
            </section>
          ) : (
            <div className="mt-4">
              <Button type="button" variant="outline" size="sm" onClick={() => setAddingHoliday(true)}>
                Adicionar feriado
              </Button>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-t2">Feriado desta cidade que a lista não trouxe.</p>
            </div>
          )}
          {hasSchedule ? (
            <label className="mt-4 flex items-start gap-3 rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3 py-3 text-[13px] text-t0">
              <input type="checkbox" className="mt-0.5 shrink-0" checked={value.replaceManual} onChange={(event) => setValue((current) => ({ ...current, replaceManual: event.target.checked }))} />
              <span>Substituir também os dias ajustados na mão dentro deste período. Fora dele, a escala permanece.</span>
            </label>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}
