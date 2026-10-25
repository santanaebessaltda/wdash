import { useState } from "react";
import { Badge, Button, DatePicker, FormField, Modal, WizardCardHeader, WizardNav } from "@/components/ui";
import { cn } from "@/lib/cn";
import { dateToIso, isoToDate } from "@/lib/format";
import { defaultDayNeeds, patternFits, weekdayLabel, type CompWindow, type DayNeed, type GroupNeed, type HolidayRule, type OffMode, type SchedulePattern, type ScheduleScenario, type Sex, type SundayRule } from "@/data/wedash/scheduleGenerate";

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

const fieldClass = "w-full min-w-0 rounded-[10px] border border-line bg-bg-2 px-2 py-2 text-[13px] text-t0";

export type WizardPerson = { id: string; name: string; role: string; groupId: string | null; groupName: string };

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
  copyStoreIds: string[];
  replaceManual: boolean;
};

function defaultRule(date: string, name: string): HolidayRule {
  return { date, name, open: true, workers: 1, pay: "extra_off", window: "7_days" };
}

function periodDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

function ScheduleSteps({ current }: { current: number }) {
  return (
    <ol className="mb-5 grid grid-cols-4 gap-1">
      {STEPS.map((step) => {
        const done = step.num < current;
        const active = step.num === current;
        return (
          <li key={step.num} className="flex min-w-0 flex-col items-center gap-1 text-center">
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border-2 text-[12px] font-extrabold",
                done && "border-acc bg-acc text-white",
                active && "border-acc bg-acc-soft text-acc",
                !done && !active && "border-line bg-bg-inset text-t2",
              )}
            >
              {done ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                step.num
              )}
            </span>
            <span className={cn("w-full truncate text-[11px] font-semibold", active ? "text-t0" : "text-t2")}>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function ScheduleWizard({
  open,
  onClose,
  people,
  otherStores,
  hasSchedule,
  nationalHolidays,
  initial,
  saving,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  people: WizardPerson[];
  otherStores: { id: string; name: string }[];
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
  const days = periodDays(value.periodStart, value.periodEnd);
  const periodOk = value.periodEnd >= value.periodStart && days > 0 && days <= 93;
  const types = TYPES.filter((item) => patternFits(value.scenario, item.id));
  const selectedType = TYPES.find((item) => item.id === value.pattern);
  const selectedPeople = people.filter((person) => value.selectedIds.includes(person.id));
  const sunday = value.dayNeeds.find((day) => day.dow === 0);

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
  }

  function patchRule(date: string, patch: Partial<HolidayRule>) {
    setValue((current) => ({
      ...current,
      holidayRules: current.holidayRules.map((rule) => (rule.date === date ? { ...rule, ...patch } : rule)),
    }));
  }

  function setSundayClosed(closed: boolean) {
    setValue((current) => ({
      ...current,
      dayNeeds: current.dayNeeds.map((day) => (day.dow === 0 ? { ...day, open: !closed } : day)),
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
          nextDisabled={saving || (step === 1 && !periodOk) || (step === 2 && value.selectedIds.length === 0)}
          nextLabel={step === 4 ? (saving ? "Criando…" : "Nova escala") : "Continuar"}
          hideNextIcon={step === 4}
          onPrevious={() => setStep((current) => current - 1)}
          onNext={() => (step === 4 ? onSubmit(value) : setStep((current) => current + 1))}
        />
      }
    >
      <ScheduleSteps current={step} />
      {step === 1 ? (
        <>
          <WizardCardHeader title="Qual escala você quer montar?" subtitle="Primeiro o cenário, o tipo e o período." />
          <p className="mb-2 text-[13px] font-semibold text-t0">Cenário</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => setScenario("before_6x1")} className={`rounded-[12px] border px-3 py-3 text-left ${value.scenario === "before_6x1" ? "border-acc bg-acc-soft" : "border-line"}`}>
              <span className="block text-[14px] font-bold text-t0">Antes do fim da 6×1</span>
              <span className="mt-1 block text-[12px] text-t2">6×1, 5×2, 4×3 e 12×36.</span>
            </button>
            <button type="button" onClick={() => setScenario("after_6x1")} className={`rounded-[12px] border px-3 py-3 text-left ${value.scenario === "after_6x1" ? "border-acc bg-acc-soft" : "border-line"}`}>
              <span className="block text-[14px] font-bold text-t0">Após o fim da 6×1</span>
              <span className="mt-1 block text-[12px] text-t2">Duas ou mais folgas por semana.</span>
            </button>
          </div>
          <label className="mt-4 block min-w-0 text-[13px] font-semibold text-t0">
            Tipo de escala
            <select className={`mt-1 ${fieldClass}`} value={value.pattern} onChange={(event) => setValue((current) => ({ ...current, pattern: event.target.value as SchedulePattern }))}>
              {types.map((item) => (
                <option key={item.id} value={item.id}>{item.title} · {item.detail}</option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-[12px] text-t2">{selectedType?.detail}. Os dias fechados e as folgas de domingo também entram na conta.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
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
          {periodOk ? <p className="mt-2 text-[12px] text-t2">A escala começa em {value.periodStart.split("-").reverse().join("/")} e segue até {value.periodEnd.split("-").reverse().join("/")}. O ciclo conta a partir do primeiro dia.</p> : null}
        </>
      ) : null}
      {step === 2 ? (
        <>
          <WizardCardHeader title="Quem vai trabalhar?" subtitle="A equipe desta filial. O sexo organiza a folga de domingo." />
          <ul className="space-y-2">
            {people.length === 0 ? <li className="text-[13px] text-t2">Nenhuma pessoa ativa nesta filial.</li> : null}
            {people.map((person) => (
              <li key={person.id} className="min-w-0 rounded-[12px] border border-line px-3 py-2">
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
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-t0">{person.name}</span>
                    <span className="block truncate text-[12px] text-t2">{person.groupName || person.role}</span>
                  </span>
                  <select className="shrink-0 rounded-[10px] border border-line bg-bg-2 px-2 py-1.5 text-[13px]" value={value.sex[person.id] ?? "woman"} onChange={(event) => setValue((current) => ({ ...current, sex: { ...current.sex, [person.id]: event.target.value as Sex } }))}>
                    <option value="woman">Mulher</option>
                    <option value="man">Homem</option>
                  </select>
                </div>
                {value.selectedIds.includes(person.id) ? (
                  <label className="mt-2 flex min-w-0 items-center justify-between gap-3 text-[12px] text-t2">
                    Dia de folga
                    <select
                      className="shrink-0 rounded-[10px] border border-line bg-bg-2 px-2 py-1.5 text-[13px] text-t0"
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
                    </select>
                  </label>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-t2">No automático, a folga muda ao longo do período. Quem precisa do mesmo dia toda semana escolhe o dia.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="min-w-0 text-[13px] font-semibold text-t0">
              Mulheres folgam
              <select className={`mt-1 ${fieldClass}`} value={value.womenSunday} onChange={(event) => setValue((current) => ({ ...current, womenSunday: event.target.value as SundayRule }))}>
                {SUNDAY_OPTIONS.filter((option) => option.id !== "every_3").map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="min-w-0 text-[13px] font-semibold text-t0">
              Homens folgam
              <select className={`mt-1 ${fieldClass}`} value={value.menSunday} onChange={(event) => setValue((current) => ({ ...current, menSunday: event.target.value as SundayRule }))}>
                {SUNDAY_OPTIONS.filter((option) => option.id !== "none").map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-2 text-[12px] text-t2">Se a empresa fechar no domingo, todo mundo folga.</p>
        </>
      ) : null}
      {step === 3 ? (
        <>
          <WizardCardHeader title="Em quais dias a empresa abre?" subtitle="Desmarque o dia em que todos ficam de folga." />
          <label className="mb-4 flex items-center gap-2 rounded-[12px] border border-line bg-bg-1 px-3 py-3 text-[13.5px] text-t0">
            <input type="checkbox" className="shrink-0" checked={sunday ? !sunday.open : false} onChange={(event) => setSundayClosed(event.target.checked)} />
            A empresa fecha aos domingos
          </label>
          <p className="text-[13px] font-semibold text-t0">Nos dias abertos, de quantas pessoas você precisa?</p>
          <p className="mt-1 mb-3 text-[12px] text-t2">
            {(() => {
              const shifts = new Set(selectedPeople.map((person) => person.groupId).filter(Boolean)).size;
              return shifts > 1
                ? `O número é por turno. Com ${shifts} turnos, 2 significa 2 em cada um. Os domingos revezam entre os turnos e continuam a partir do domingo anterior.`
                : "O menor número trabalhando em cada dia.";
            })()}
          </p>
          <ul className="space-y-2">
            {value.dayNeeds.map((day) => (
              <li key={day.dow} className="flex min-w-0 items-center justify-between gap-3 border-b border-line py-2">
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
                  <span className="truncate">{weekdayLabel(day.dow)}</span>
                </label>
                <label className="flex shrink-0 items-center gap-2 text-[12px] text-t2">
                  Pelo menos
                  <input
                    inputMode="numeric"
                    disabled={!day.open}
                    value={day.min}
                    onChange={(event) =>
                      setValue((current) => ({
                        ...current,
                        dayNeeds: current.dayNeeds.map((item) => (item.dow === day.dow ? { ...item, min: Math.max(0, Number(event.target.value) || 0) } : item)),
                      }))
                    }
                    className="w-14 rounded-[10px] border border-line bg-bg-2 px-2 py-1.5 text-center text-[13px] text-t0"
                  />
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {step === 4 ? (
        <>
          <WizardCardHeader title="Vai abrir nos feriados?" subtitle="O nacional já vem na lista. Inclua o municipal ou remova o que não vale nesta loja." />
          <ul className="space-y-3">
            {value.holidayRules.length === 0 ? <li className="text-[13px] text-t2">Nenhum feriado neste período.</li> : null}
            {value.holidayRules.map((rule) => (
              <li key={`${rule.date}-${rule.name}`} className="min-w-0 rounded-[12px] border border-line px-3 py-3">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold text-t0">{rule.name}</span>
                    <span className="text-[12px] text-t2">{rule.date.split("-").reverse().join("/")}</span>
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-[12px] text-t2"
                    onClick={() => {
                      setDismissed((current) => [...current, rule.date]);
                      setValue((current) => ({ ...current, holidayRules: current.holidayRules.filter((item) => item !== rule) }));
                    }}
                  >
                    Remover
                  </button>
                </div>
                <label className="mt-2 flex items-center gap-2 text-[13px] text-t0">
                  <input type="checkbox" className="shrink-0" checked={rule.open} onChange={(event) => patchRule(rule.date, { open: event.target.checked })} />
                  A empresa abre neste feriado
                </label>
                {rule.open ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label className="min-w-0 text-[12px] text-t2">
                      Pessoas trabalhando
                      <input inputMode="numeric" value={rule.workers} onChange={(event) => patchRule(rule.date, { workers: Math.max(0, Number(event.target.value) || 0) })} className={`mt-1 ${fieldClass}`} />
                    </label>
                    <label className="min-w-0 text-[12px] text-t2">
                      Quem trabalha recebe
                      <select className={`mt-1 ${fieldClass}`} value={rule.pay} onChange={(event) => patchRule(rule.date, { pay: event.target.value as HolidayRule["pay"] })}>
                        <option value="extra_off">Uma folga adicional</option>
                        <option value="double">Pagamento em dobro</option>
                      </select>
                    </label>
                    {rule.pay === "extra_off" ? (
                      <label className="min-w-0 text-[12px] text-t2 sm:col-span-2">
                        Quando a folga acontece
                        <select className={`mt-1 ${fieldClass}`} value={rule.window} onChange={(event) => patchRule(rule.date, { window: event.target.value as CompWindow })}>
                          <option value="7_days">Nos 7 dias seguintes</option>
                          <option value="month_end">Até o último dia do mês</option>
                          <option value="next_month">No mês seguinte</option>
                        </select>
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="mt-3 grid gap-2 sm:grid-cols-[9.5rem_minmax(0,1fr)_auto] sm:items-center">
            <input type="date" value={extraDate} min={value.periodStart} max={value.periodEnd} onChange={(event) => setExtraDate(event.target.value)} className={fieldClass} />
            <input placeholder="Feriado municipal" value={extraName} onChange={(event) => setExtraName(event.target.value)} className={fieldClass} />
            <Button type="button" variant="outline" onClick={addMunicipal}>Adicionar</Button>
          </div>
          {otherStores.length > 0 ? (
            <div className="mt-5">
              <p className="text-[13px] font-semibold text-t0">Copiar para outras filiais</p>
              <p className="mt-1 mb-2 text-[12px] text-t2">A mesma regra. Cada filial usa a própria equipe, e quem não tiver sexo entra como mulher.</p>
              <ul className="space-y-2">
                {otherStores.map((store) => (
                  <li key={store.id}>
                    <label className="flex min-w-0 items-center gap-3 rounded-[12px] border border-line px-3 py-2 text-[13.5px]">
                      <input
                        type="checkbox"
                        className="shrink-0"
                        checked={value.copyStoreIds.includes(store.id)}
                        onChange={() =>
                          setValue((current) => ({
                            ...current,
                            copyStoreIds: current.copyStoreIds.includes(store.id) ? current.copyStoreIds.filter((id) => id !== store.id) : [...current.copyStoreIds, store.id],
                          }))
                        }
                      />
                      <span className="min-w-0 truncate">{store.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-4 text-[13px] text-t2">
            {selectedPeople.length} pessoas · {selectedType?.title} · {value.holidayRules.filter((rule) => rule.open).length} feriados com trabalho.
          </p>
          {hasSchedule ? (
            <label className="mt-3 flex items-start gap-3 rounded-[12px] border border-line px-3 py-3 text-[13px] text-t0">
              <input type="checkbox" className="mt-0.5 shrink-0" checked={value.replaceManual} onChange={(event) => setValue((current) => ({ ...current, replaceManual: event.target.checked }))} />
              <span>Substituir também os dias ajustados na mão dentro deste período. Fora dele, a escala permanece.</span>
            </label>
          ) : (
            <div className="mt-3">
              <Badge variant="info">Primeira escala deste mês</Badge>
            </div>
          )}
        </>
      ) : null}
    </Modal>
  );
}
