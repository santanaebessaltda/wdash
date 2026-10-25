import { useState } from "react";
import { Badge, Button, Modal, WizardCardHeader, WizardNav } from "@/components/ui";
import { cn } from "@/lib/cn";
import { defaultDayNeeds, weekdayLabel, type CompWindow, type DayNeed, type GroupNeed, type HolidayRule, type OffMode, type SchedulePattern, type Sex, type SundayRule } from "@/data/wedash/scheduleGenerate";

const STEPS = [
  { num: 1, label: "Equipe" },
  { num: 2, label: "Regras" },
  { num: 3, label: "Feriados" },
];

const PATTERNS: { id: SchedulePattern; title: string; text: string }[] = [
  { id: "6x1", title: "6×1", text: "6 dias de trabalho e 1 de folga." },
  { id: "5x2", title: "5×2", text: "5 dias de trabalho e 2 de folga." },
  { id: "12x36", title: "12×36", text: "Um dia trabalha, o outro folga." },
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
  pattern: SchedulePattern;
  offMode: OffMode;
  sundayMin: number;
  womenSunday: SundayRule;
  menSunday: SundayRule;
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

function ScheduleSteps({ current }: { current: number }) {
  return (
    <ol className="mb-5 grid grid-cols-3 gap-2">
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
  monthLabel,
  monthStart,
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
  monthLabel: string;
  monthStart: string;
  nationalHolidays: { date: string; name: string }[];
  initial: ScheduleWizardValue;
  saving: boolean;
  onSubmit: (value: ScheduleWizardValue) => void;
}) {
  const [step, setStep] = useState(1);
  const [value, setValue] = useState(() => ({
    ...initial,
    dayNeeds: initial.dayNeeds.length === 7 ? initial.dayNeeds : defaultDayNeeds(),
    holidayRules: initial.holidayRules.length > 0 ? initial.holidayRules : nationalHolidays.filter((row) => row.date.startsWith(monthStart.slice(0, 7))).map((row) => defaultRule(row.date, row.name)),
  }));
  const [extraDate, setExtraDate] = useState("");
  const [extraName, setExtraName] = useState("");
  const canLeaveTeam = value.selectedIds.length > 0;
  const selectedPeople = people.filter((person) => value.selectedIds.includes(person.id));
  const groups = [...new Map(selectedPeople.filter((person) => person.groupId).map((person) => [person.groupId, person.groupName])).entries()];
  const pattern = PATTERNS.find((item) => item.id === value.pattern);

  function addMunicipal() {
    const name = extraName.trim();
    if (!extraDate.startsWith(monthStart.slice(0, 7)) || !name) return;
    setValue((current) => ({ ...current, holidayRules: [...current.holidayRules, defaultRule(extraDate, name)] }));
    setExtraDate("");
    setExtraName("");
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
      title="Gerar escala"
      size="lg"
      bodyClassName="overflow-x-hidden overflow-y-auto p-5"
      footer={
        <WizardNav
          hidePrevious={step === 1}
          previousDisabled={saving}
          nextDisabled={saving || (step === 1 && !canLeaveTeam)}
          nextLabel={step === 3 ? (saving ? "Gerando…" : "Gerar escala") : "Continuar"}
          hideNextIcon={step === 3}
          onPrevious={() => setStep((current) => current - 1)}
          onNext={() => (step === 3 ? onSubmit(value) : setStep((current) => current + 1))}
        />
      }
    >
      <ScheduleSteps current={step} />
      {step === 1 ? (
        <>
          <WizardCardHeader title="Quem entra na escala" subtitle="A equipe ativa desta filial. O sexo vale só para a folga de domingo." />
          <ul className="space-y-2">
            {people.length === 0 ? <li className="text-[13px] text-t2">Nenhuma pessoa ativa nesta filial.</li> : null}
            {people.map((person) => (
              <li key={person.id} className="flex min-w-0 items-center gap-3 rounded-[12px] border border-line px-3 py-2">
                <input
                  type="checkbox"
                  className="shrink-0"
                  checked={value.selectedIds.includes(person.id)}
                  onChange={() =>
                    setValue((current) => ({
                      ...current,
                      selectedIds: current.selectedIds.includes(person.id)
                        ? current.selectedIds.filter((id) => id !== person.id)
                        : [...current.selectedIds, person.id],
                      sex: { ...current.sex, [person.id]: current.sex[person.id] ?? "woman" },
                    }))
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-t0">{person.name}</span>
                  <span className="block truncate text-[12px] text-t2">{person.groupName || person.role}</span>
                </span>
                <select
                  className="shrink-0 rounded-[10px] border border-line bg-bg-2 px-2 py-1.5 text-[13px]"
                  value={value.sex[person.id] ?? "woman"}
                  onChange={(event) => setValue((current) => ({ ...current, sex: { ...current.sex, [person.id]: event.target.value as Sex } }))}
                >
                  <option value="woman">Mulher</option>
                  <option value="man">Homem</option>
                </select>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {step === 2 ? (
        <>
          <WizardCardHeader title="Regras" subtitle={`Vale para ${monthLabel}. ${pattern?.text ?? ""}`} />
          <div className="grid grid-cols-3 gap-2">
            {PATTERNS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setValue((current) => ({ ...current, pattern: item.id }))}
                className={`rounded-[12px] border px-2 py-2 text-[14px] font-bold ${value.pattern === item.id ? "border-acc bg-acc-soft text-acc" : "border-line text-t0"}`}
              >
                {item.title}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(
              [
                ["rotating", "Rotativas"],
                ["fixed", "Fixas"],
              ] as const
            ).map(([id, title]) => (
              <button
                key={id}
                type="button"
                onClick={() => setValue((current) => ({ ...current, offMode: id }))}
                className={`rounded-[12px] border px-2 py-2 text-[13px] font-semibold ${value.offMode === id ? "border-acc bg-acc-soft text-acc" : "border-line text-t0"}`}
              >
                {title}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-t2">{value.offMode === "fixed" ? "Cada pessoa folga sempre no mesmo dia, de segunda a sábado." : "A folga muda de dia na semana."}</p>
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
          {value.offMode === "fixed" ? (
            <ul className="mt-4 space-y-2">
              {selectedPeople.map((person) => (
                <li key={person.id} className="flex min-w-0 items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-[13px] text-t0">{person.name}</span>
                  <select
                    className="shrink-0 rounded-[10px] border border-line bg-bg-2 px-2 py-1.5 text-[13px]"
                    value={value.fixedOff[person.id] ?? 1}
                    onChange={(event) => setValue((current) => ({ ...current, fixedOff: { ...current.fixedOff, [person.id]: Number(event.target.value) } }))}
                  >
                    {WEEKDAYS.map((label, index) => (
                      <option key={label} value={index + 1}>{label}</option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-5 text-[13px] font-semibold text-t0">Quem precisa estar</p>
          <p className="mt-1 mb-3 text-[12px] text-t2">Desmarque o dia em que a loja fecha. O número é o mínimo trabalhando.</p>
          <ul className="space-y-2">
            {value.dayNeeds.map((day) => (
              <li key={day.dow} className="flex min-w-0 items-center justify-between gap-3">
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
          {groups.length > 0 ? (
            <div className="mt-4">
              <p className="text-[13px] font-semibold text-t0">Por grupo, nos dias abertos</p>
              <ul className="mt-2 space-y-2">
                {groups.map(([id, name]) => {
                  const min = value.groupNeeds.find((item) => item.groupId === id)?.min ?? 2;
                  return (
                    <li key={id} className="flex min-w-0 items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-[13.5px] text-t0">{name}</span>
                      <label className="flex shrink-0 items-center gap-2 text-[12px] text-t2">
                        Pelo menos
                        <input
                          inputMode="numeric"
                          value={min}
                          onChange={(event) =>
                            setValue((current) => ({
                              ...current,
                              groupNeeds: [
                                ...current.groupNeeds.filter((item) => item.groupId !== id),
                                { groupId: id!, min: Math.max(0, Number(event.target.value) || 0) },
                              ],
                            }))
                          }
                          className="w-14 rounded-[10px] border border-line bg-bg-2 px-2 py-1.5 text-center text-[13px] text-t0"
                        />
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
      {step === 3 ? (
        <>
          <WizardCardHeader title="Feriados do mês" subtitle="O nacional já vem na lista. Inclua o municipal ou remova o que não vale nesta loja." />
          <ul className="space-y-3">
            {value.holidayRules.length === 0 ? <li className="text-[13px] text-t2">Nenhum feriado neste mês.</li> : null}
            {value.holidayRules.map((rule) => (
              <li key={`${rule.date}-${rule.name}`} className="min-w-0 rounded-[12px] border border-line px-3 py-3">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold text-t0">{rule.name}</span>
                    <span className="text-[12px] text-t2">{rule.date.split("-").reverse().join("/")}</span>
                  </span>
                  <button type="button" className="shrink-0 text-[12px] text-t2" onClick={() => setValue((current) => ({ ...current, holidayRules: current.holidayRules.filter((item) => item !== rule) }))}>
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
            <input type="date" value={extraDate} min={`${monthStart.slice(0, 7)}-01`} max={`${monthStart.slice(0, 7)}-31`} onChange={(event) => setExtraDate(event.target.value)} className={fieldClass} />
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
            {selectedPeople.length} pessoas · {pattern?.title} · {value.holidayRules.filter((rule) => rule.open).length} feriados com trabalho.
            {value.copyStoreIds.length > 0 ? ` Também em ${value.copyStoreIds.length} ${value.copyStoreIds.length === 1 ? "filial" : "filiais"}.` : ""}
          </p>
          {hasSchedule ? (
            <label className="mt-3 flex items-start gap-3 rounded-[12px] border border-line px-3 py-3 text-[13px] text-t0">
              <input type="checkbox" className="mt-0.5 shrink-0" checked={value.replaceManual} onChange={(event) => setValue((current) => ({ ...current, replaceManual: event.target.checked }))} />
              <span>Substituir também os dias ajustados na mão. Sem esta marca, esses dias permanecem.</span>
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
