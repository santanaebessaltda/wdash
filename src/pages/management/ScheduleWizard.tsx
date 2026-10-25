import { useState } from "react";
import { Badge, Button, Modal, WizardCardHeader, WizardNav, WizardSteps } from "@/components/ui";
import { defaultDayNeeds, weekdayLabel, type CompWindow, type DayNeed, type GroupNeed, type HolidayPay, type HolidayRule, type OffMode, type SchedulePattern, type Sex, type SundayRule } from "@/data/wedash/scheduleGenerate";

const STEPS = [
  { num: 1, label: "Equipe" },
  { num: 2, label: "Modelo" },
  { num: 3, label: "Cobertura" },
  { num: 4, label: "Feriados" },
  { num: 5, label: "Filiais" },
  { num: 6, label: "Revisão" },
];

const PATTERNS: { id: SchedulePattern; title: string; text: string }[] = [
  { id: "6x1", title: "6×1", text: "6 dias de trabalho e 1 de folga" },
  { id: "5x2", title: "5×2", text: "5 dias de trabalho e 2 de folga" },
  { id: "12x36", title: "12×36", text: "Um dia trabalha, o outro folga" },
];

const WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const SUNDAY_OPTIONS: { id: SundayRule; label: string }[] = [
  { id: "every_3", label: "Um a cada três domingos" },
  { id: "every_2", label: "Um a cada dois domingos" },
  { id: "all", label: "Todos os domingos" },
  { id: "none", label: "Nenhum obrigatório" },
];

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
  const order = otherStores.length > 0 ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 6];
  const steps = order.map((source, index) => ({ num: index + 1, label: STEPS.find((item) => item.num === source)!.label }));
  const last = order[order.length - 1] === step;

  function go(delta: number) {
    const target = order[order.indexOf(step) + delta];
    if (target) setStep(target);
  }

  function addMunicipal() {
    const name = extraName.trim();
    if (!extraDate.startsWith(monthStart.slice(0, 7)) || !name) return;
    setValue((current) => ({ ...current, holidayRules: [...current.holidayRules, defaultRule(extraDate, name)] }));
    setExtraDate("");
    setExtraName("");
  }

  const canLeaveTeam = value.selectedIds.length > 0;
  const selectedPeople = people.filter((person) => value.selectedIds.includes(person.id));
  const groups = [...new Map(selectedPeople.filter((person) => person.groupId).map((person) => [person.groupId, person.groupName])).entries()];

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
      footer={
        <WizardNav
          hidePrevious={step === 1}
          previousDisabled={saving}
          nextDisabled={saving || (step === 1 && !canLeaveTeam)}
          nextLabel={last ? (saving ? "Gerando…" : "Gerar escala") : "Continuar"}
          hideNextIcon={last}
          onPrevious={() => go(-1)}
          onNext={() => (last ? onSubmit(value) : go(1))}
        />
      }
    >
      <WizardSteps steps={steps} current={order.indexOf(step) + 1} />
      {step === 1 ? (
        <>
          <WizardCardHeader title="Quem entra na escala" subtitle="A equipe ativa desta filial. O sexo vale só para a folga de domingo desta escala." />
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {people.length === 0 ? <li className="text-[13px] text-t2">Nenhuma pessoa ativa nesta filial.</li> : null}
            {people.map((person) => (
              <li key={person.id} className="flex items-center gap-3 rounded-[12px] border border-line px-3 py-2">
                <input
                  type="checkbox"
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
                  <span className="text-[12px] text-t2">{person.groupName || person.role}</span>
                </span>
                <select
                  className="rounded-[10px] border border-line bg-bg-2 px-2 py-1.5 text-[13px]"
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
          <WizardCardHeader title="Modelo" subtitle={`A regra vale para ${monthLabel}.`} />
          <div className="grid gap-2 sm:grid-cols-3">
            {PATTERNS.map((pattern) => (
              <button
                key={pattern.id}
                type="button"
                onClick={() => setValue((current) => ({ ...current, pattern: pattern.id }))}
                className={`rounded-[12px] border px-3 py-3 text-left ${value.pattern === pattern.id ? "border-acc bg-acc-soft" : "border-line"}`}
              >
                <span className="block text-[15px] font-bold text-t0">{pattern.title}</span>
                <span className="mt-1 block text-[12px] text-t2">{pattern.text}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {(
              [
                ["rotating", "Rotativas", "A folga muda de dia na semana."],
                ["fixed", "Fixas na semana", "Cada pessoa folga sempre no mesmo dia, de segunda a sábado."],
              ] as const
            ).map(([id, title, text]) => (
              <button
                key={id}
                type="button"
                onClick={() => setValue((current) => ({ ...current, offMode: id }))}
                className={`rounded-[12px] border px-3 py-3 text-left ${value.offMode === id ? "border-acc bg-acc-soft" : "border-line"}`}
              >
                <span className="block text-[14px] font-bold text-t0">{title}</span>
                <span className="mt-1 block text-[12px] text-t2">{text}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-[13px] font-semibold text-t0">
              Mulheres folgam
              <select className="mt-1 w-full rounded-[10px] border border-line bg-bg-2 px-2 py-2 text-[13px]" value={value.womenSunday} onChange={(event) => setValue((current) => ({ ...current, womenSunday: event.target.value as SundayRule }))}>
                {SUNDAY_OPTIONS.filter((option) => option.id !== "every_3").map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="text-[13px] font-semibold text-t0">
              Homens folgam
              <select className="mt-1 w-full rounded-[10px] border border-line bg-bg-2 px-2 py-2 text-[13px]" value={value.menSunday} onChange={(event) => setValue((current) => ({ ...current, menSunday: event.target.value as SundayRule }))}>
                {SUNDAY_OPTIONS.filter((option) => option.id !== "none").map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          {value.offMode === "fixed" ? (
            <ul className="mt-4 max-h-48 space-y-2 overflow-y-auto">
              {selectedPeople.map((person) => (
                <li key={person.id} className="flex items-center justify-between gap-3">
                  <span className="truncate text-[13px] text-t0">{person.name}</span>
                  <select
                    className="rounded-[10px] border border-line bg-bg-2 px-2 py-1.5 text-[13px]"
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
        </>
      ) : null}
      {step === 3 ? (
        <>
          <WizardCardHeader title="Quem precisa estar" subtitle="Desmarque o dia em que a loja fecha. O número é o mínimo trabalhando." />
          <ul className="space-y-2">
            {value.dayNeeds.map((day) => (
              <li key={day.dow} className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-[13.5px] text-t0">
                  <input
                    type="checkbox"
                    checked={day.open}
                    onChange={(event) =>
                      setValue((current) => ({
                        ...current,
                        dayNeeds: current.dayNeeds.map((item) => (item.dow === day.dow ? { ...item, open: event.target.checked } : item)),
                      }))
                    }
                  />
                  {weekdayLabel(day.dow)}
                </label>
                <label className="flex items-center gap-2 text-[12px] text-t2">
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
                    <li key={id} className="flex items-center justify-between gap-3">
                      <span className="truncate text-[13.5px] text-t0">{name}</span>
                      <label className="flex items-center gap-2 text-[12px] text-t2">
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
      {step === 4 ? (
        <>
          <WizardCardHeader title="Feriados do mês" subtitle="A lista começa com os feriados do mês. O nacional vem da Brasil API. Inclua o municipal, ou remova o que não vale nesta loja." />
          <ul className="max-h-80 space-y-3 overflow-y-auto">
            {value.holidayRules.length === 0 ? <li className="text-[13px] text-t2">Nenhum feriado neste mês.</li> : null}
            {value.holidayRules.map((rule) => (
              <li key={`${rule.date}-${rule.name}`} className="rounded-[12px] border border-line px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-[13.5px] font-semibold text-t0">{rule.name}</span>
                    <span className="text-[12px] text-t2">{rule.date.split("-").reverse().join("/")}</span>
                  </span>
                  <button type="button" className="text-[12px] text-t2" onClick={() => setValue((current) => ({ ...current, holidayRules: current.holidayRules.filter((item) => item !== rule) }))}>
                    Remover
                  </button>
                </div>
                <label className="mt-2 flex items-center gap-2 text-[13px] text-t0">
                  <input type="checkbox" checked={rule.open} onChange={(event) => patchRule(rule.date, { open: event.target.checked })} />
                  A empresa abre neste feriado
                </label>
                {rule.open ? (
                  <div className="mt-2 space-y-2">
                    <label className="flex items-center gap-2 text-[12px] text-t2">
                      Quantas pessoas vão trabalhar?
                      <input inputMode="numeric" value={rule.workers} onChange={(event) => patchRule(rule.date, { workers: Math.max(0, Number(event.target.value) || 0) })} className="w-14 rounded-[10px] border border-line bg-bg-2 px-2 py-1.5 text-center text-[13px] text-t0" />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(
                        [
                          ["extra_off", "Uma folga adicional"],
                          ["double", "Pagamento em dobro"],
                        ] as const
                      ).map(([id, label]) => (
                        <button key={id} type="button" onClick={() => patchRule(rule.date, { pay: id as HolidayPay })} className={`rounded-[12px] border px-3 py-2 text-left text-[13px] ${rule.pay === id ? "border-acc bg-acc-soft" : "border-line"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {rule.pay === "extra_off" ? (
                      <select className="w-full rounded-[10px] border border-line bg-bg-2 px-2 py-2 text-[13px]" value={rule.window} onChange={(event) => patchRule(rule.date, { window: event.target.value as CompWindow })}>
                        <option value="7_days">Nos 7 dias seguintes</option>
                        <option value="month_end">Até o último dia do mês</option>
                        <option value="next_month">No mês seguinte</option>
                      </select>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <input type="date" value={extraDate} min={`${monthStart.slice(0, 7)}-01`} max={`${monthStart.slice(0, 7)}-31`} onChange={(event) => setExtraDate(event.target.value)} className="rounded-[10px] border border-line bg-bg-2 px-2 py-2 text-[13px]" />
            <input placeholder="Nome do feriado municipal" value={extraName} onChange={(event) => setExtraName(event.target.value)} className="min-w-0 flex-1 rounded-[10px] border border-line bg-bg-2 px-2 py-2 text-[13px]" />
            <Button type="button" variant="outline" onClick={addMunicipal}>Adicionar</Button>
          </div>
        </>
      ) : null}
      {step === 5 ? (
        <>
          <WizardCardHeader title="Outras filiais" subtitle="A mesma cobertura e os mesmos feriados. Cada filial usa a própria equipe. Quem não tiver sexo marcado entra como mulher." />
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {otherStores.map((store) => (
              <li key={store.id}>
                <label className="flex items-center gap-3 rounded-[12px] border border-line px-3 py-2 text-[13.5px]">
                  <input
                    type="checkbox"
                    checked={value.copyStoreIds.includes(store.id)}
                    onChange={() =>
                      setValue((current) => ({
                        ...current,
                        copyStoreIds: current.copyStoreIds.includes(store.id) ? current.copyStoreIds.filter((id) => id !== store.id) : [...current.copyStoreIds, store.id],
                      }))
                    }
                  />
                  {store.name}
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {step === 6 ? (
        <>
          <WizardCardHeader title="Revisão" subtitle={`${selectedPeople.length} pessoas · ${PATTERNS.find((pattern) => pattern.id === value.pattern)?.title} · ${monthLabel}`} />
          <p className="mb-3 text-[13px] text-t2">{value.holidayRules.filter((rule) => rule.open).length} feriados com trabalho. A folga que não couber neste mês fica para o mês seguinte.</p>
          {value.copyStoreIds.length > 0 ? <p className="mb-3 text-[13px] text-t2">Também em {value.copyStoreIds.length} {value.copyStoreIds.length === 1 ? "filial" : "filiais"}.</p> : null}
          {hasSchedule ? (
            <label className="flex items-start gap-3 rounded-[12px] border border-line px-3 py-3 text-[13px] text-t0">
              <input type="checkbox" className="mt-0.5" checked={value.replaceManual} onChange={(event) => setValue((current) => ({ ...current, replaceManual: event.target.checked }))} />
              <span>Substituir também os dias ajustados na mão. Sem esta marca, esses dias permanecem.</span>
            </label>
          ) : (
            <Badge variant="info">Primeira escala deste mês</Badge>
          )}
        </>
      ) : null}
    </Modal>
  );
}
