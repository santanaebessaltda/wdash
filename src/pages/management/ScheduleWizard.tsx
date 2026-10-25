import { useState } from "react";
import { Badge, Button, Modal, WizardCardHeader, WizardNav, WizardSteps } from "@/components/ui";
import type { ExtraHoliday } from "@/data/wedash/scheduleRepo";
import type { OffMode, SchedulePattern } from "@/data/wedash/scheduleGenerate";

const STEPS = [
  { num: 1, label: "Equipe" },
  { num: 2, label: "Modelo" },
  { num: 3, label: "Regras" },
  { num: 4, label: "Filiais" },
  { num: 5, label: "Revisão" },
];

const PATTERNS: { id: SchedulePattern; title: string; text: string }[] = [
  { id: "6x1", title: "6×1", text: "6 dias de trabalho e 1 de folga" },
  { id: "5x2", title: "5×2", text: "5 dias de trabalho e 2 de folga" },
  { id: "12x36", title: "12×36", text: "Um dia trabalha, o outro folga" },
];

const WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export type WizardPerson = { id: string; name: string; role: string };

export type ScheduleWizardValue = {
  pattern: SchedulePattern;
  offMode: OffMode;
  sundayMin: number;
  selectedIds: string[];
  fixedOff: Record<string, number>;
  extraHolidays: ExtraHoliday[];
  copyStoreIds: string[];
  replaceManual: boolean;
};

export function ScheduleWizard({
  open,
  onClose,
  people,
  otherStores,
  hasSchedule,
  monthLabel,
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
  initial: ScheduleWizardValue;
  saving: boolean;
  onSubmit: (value: ScheduleWizardValue) => void;
}) {
  const [step, setStep] = useState(1);
  const [value, setValue] = useState(initial);
  const [extraDay, setExtraDay] = useState("");
  const [extraName, setExtraName] = useState("");
  const order = otherStores.length > 0 ? [1, 2, 3, 4, 5] : [1, 2, 3, 5];
  const steps = order.map((source, index) => ({ num: index + 1, label: STEPS.find((item) => item.num === source)!.label }));

  function go(next: number) {
    if (next === 4 && otherStores.length === 0) setStep(5);
    else if (next === 3 && step === 5 && otherStores.length === 0) setStep(3);
    else setStep(next);
  }

  function addExtra() {
    const day = Number(extraDay);
    const name = extraName.trim();
    if (!day || day > 31 || !name) return;
    setValue((current) => ({ ...current, extraHolidays: [...current.extraHolidays, { day, name }] }));
    setExtraDay("");
    setExtraName("");
  }

  const canLeaveTeam = value.selectedIds.length > 0;
  const selectedPeople = people.filter((person) => value.selectedIds.includes(person.id));

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
          nextLabel={step === 5 ? (saving ? "Gerando…" : "Gerar escala") : "Continuar"}
          hideNextIcon={step === 5}
          onPrevious={() => go(step === 5 && otherStores.length === 0 ? 3 : step - 1)}
          onNext={() => (step === 5 ? onSubmit(value) : go(step + 1))}
        />
      }
    >
      <WizardSteps steps={steps} current={order.indexOf(step) + 1} />
      {step === 1 ? (
        <>
          <WizardCardHeader title="Quem entra na escala" subtitle="A equipe ativa desta filial. Tire quem não entra neste mês." />
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {people.length === 0 ? <li className="text-[13px] text-t2">Nenhuma pessoa ativa nesta filial.</li> : null}
            {people.map((person) => (
              <li key={person.id}>
                <label className="flex items-center gap-3 rounded-[12px] border border-line px-3 py-2">
                  <input
                    type="checkbox"
                    checked={value.selectedIds.includes(person.id)}
                    onChange={() =>
                      setValue((current) => ({
                        ...current,
                        selectedIds: current.selectedIds.includes(person.id)
                          ? current.selectedIds.filter((id) => id !== person.id)
                          : [...current.selectedIds, person.id],
                      }))
                    }
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold text-t0">{person.name}</span>
                    <span className="text-[12px] text-t2">{person.role}</span>
                  </span>
                </label>
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
          {value.offMode === "fixed" ? (
            <ul className="mt-4 max-h-48 space-y-2 overflow-y-auto">
              {selectedPeople.map((person) => (
                <li key={person.id} className="flex items-center justify-between gap-3">
                  <span className="truncate text-[13px] text-t0">{person.name}</span>
                  <select
                    className="rounded-[10px] border border-line bg-bg-2 px-2 py-1.5 text-[13px]"
                    value={value.fixedOff[person.id] ?? 1}
                    onChange={(event) =>
                      setValue((current) => ({ ...current, fixedOff: { ...current.fixedOff, [person.id]: Number(event.target.value) } }))
                    }
                  >
                    {WEEKDAYS.map((label, index) => (
                      <option key={label} value={index + 1}>
                        {label}
                      </option>
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
          <WizardCardHeader title="Domingos e feriados" subtitle="Os feriados nacionais, estaduais e da cidade já entram no calendário." />
          <label className="block text-[13px] font-semibold text-t0">
            Mínimo de domingos de folga
            <select
              className="mt-1 w-full rounded-[10px] border border-line bg-bg-2 px-2 py-2 text-[13px]"
              value={value.sundayMin}
              onChange={(event) => setValue((current) => ({ ...current, sundayMin: Number(event.target.value) }))}
            >
              <option value={0}>Nenhum obrigatório</option>
              <option value={1}>1 domingo no mês</option>
              <option value={2}>2 domingos no mês</option>
              <option value={3}>3 domingos no mês</option>
              <option value={4}>4 domingos no mês</option>
              <option value={5}>Todos os domingos</option>
            </select>
          </label>
          <div className="mt-4">
            <p className="text-[13px] font-semibold text-t0">Feriado desta filial no mês</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                inputMode="numeric"
                placeholder="Dia"
                value={extraDay}
                onChange={(event) => setExtraDay(event.target.value)}
                className="w-20 rounded-[10px] border border-line bg-bg-2 px-2 py-2 text-[13px]"
              />
              <input
                placeholder="Nome do feriado"
                value={extraName}
                onChange={(event) => setExtraName(event.target.value)}
                className="min-w-0 flex-1 rounded-[10px] border border-line bg-bg-2 px-2 py-2 text-[13px]"
              />
              <Button type="button" variant="outline" onClick={addExtra}>
                Adicionar
              </Button>
            </div>
            <ul className="mt-2 space-y-1">
              {value.extraHolidays.map((holiday) => (
                <li key={`${holiday.day}-${holiday.name}`} className="flex items-center justify-between text-[13px]">
                  <span>
                    Dia {holiday.day} — {holiday.name}
                  </span>
                  <button
                    type="button"
                    className="text-t2"
                    onClick={() =>
                      setValue((current) => ({
                        ...current,
                        extraHolidays: current.extraHolidays.filter((row) => row !== holiday),
                      }))
                    }
                  >
                    Tirar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
      {step === 4 ? (
        <>
          <WizardCardHeader title="Outras filiais" subtitle="A mesma regra, com a equipe ativa de cada filial. O dia ajustado na mão de cada uma permanece." />
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
                        copyStoreIds: current.copyStoreIds.includes(store.id)
                          ? current.copyStoreIds.filter((id) => id !== store.id)
                          : [...current.copyStoreIds, store.id],
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
      {step === 5 ? (
        <>
          <WizardCardHeader title="Revisão" subtitle={`${selectedPeople.length} pessoas · ${PATTERNS.find((pattern) => pattern.id === value.pattern)?.title} · ${monthLabel}`} />
          {value.copyStoreIds.length > 0 ? <p className="mb-3 text-[13px] text-t2">Também em {value.copyStoreIds.length} {value.copyStoreIds.length === 1 ? "filial" : "filiais"}.</p> : null}
          {hasSchedule ? (
            <label className="flex items-start gap-3 rounded-[12px] border border-line px-3 py-3 text-[13px] text-t0">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={value.replaceManual}
                onChange={(event) => setValue((current) => ({ ...current, replaceManual: event.target.checked }))}
              />
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
