import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Accordion, Alert, AlertLink, Button, DatePicker, FormField, Input, Modal, Select, WizardCardHeader, WizardNav, WizardSteps } from "@/components/ui";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { Icon, icons } from "@/pages/users/Icons";
import { cn } from "@/lib/cn";
import { dateToIso, isoToDate } from "@/lib/format";
import { endOfMonth, startOfMonth } from "@/data/wedash/engine/format";
import { DOW_LABELS, type Dow } from "@/data/wedash/storeHours";
import {
  defaultDayNeeds,
  patternFits,
  type CompWindow,
  type DayNeed,
  type GroupNeed,
  type HolidayRule,
  type OffMode,
  type ScheduleGenerateIssue,
  type SchedulePattern,
  type ScheduleScenario,
  type Sex,
  type SundayRule,
} from "@/data/wedash/scheduleGenerate";

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
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

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

export type WizardBranch = {
  id: string;
  name: string;
  people: WizardPerson[];
  hasSchedule: boolean;
  holidays: { date: string; name: string }[];
  /** Dias da semana fechados em Configurações > Funcionamento (0 = domingo). */
  closedDays: number[];
  initial: ScheduleWizardValue;
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

function HeadcountField({ value, max, label, onChange }: { value: number; max: number; label: string; onChange: (next: number) => void }) {
  const cap = Math.max(0, max);
  const current = Math.min(cap, Math.max(0, value));
  return (
    <div className="w-16 shrink-0">
      <Select
        aria-label={label}
        className="h-9! px-2!"
        value={current}
        disabled={cap === 0}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {Array.from({ length: cap + 1 }, (_, count) => (
          <option key={count} value={count}>{count}</option>
        ))}
      </Select>
    </div>
  );
}

/** Mínimo antigo por turno vira o número único do dia. O campo grava só esse número. */
function teamTotal(dayNeeds: DayNeed[], groupNeeds: GroupNeed[], headcount: number): DayNeed[] {
  const days = dayNeeds.length === 7 ? dayNeeds.map((day) => ({ ...day })) : defaultDayNeeds();
  return days.map((day) => {
    const exact = groupNeeds.filter((row) => row.dow === day.dow);
    const legacy = groupNeeds.filter((row) => row.dow == null);
    const rows = exact.length > 0 ? exact : legacy;
    const fromGroups = rows.reduce((highest, row) => Math.max(highest, row.min), 0);
    const raw = day.min > 0 ? day.min : fromGroups;
    const min = Math.max(0, raw);
    return { ...day, min: headcount > 0 ? Math.min(headcount, min) : min };
  });
}

/** Dia fechado em Configurações > Funcionamento não pede quantidade. */
function withStoreDays(days: DayNeed[], closedDays: number[]): DayNeed[] {
  const closed = new Set(closedDays);
  return days.map((day) => ({ ...day, open: !closed.has(day.dow) }));
}

function holidayDateLabel(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year} · ${DOW_LABELS[isoToDate(iso).getDay() as Dow]}`;
}

function scaleMonthLabel(iso: string): string {
  const date = isoToDate(startOfMonth(iso));
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function ScheduleMonthField({ iso, onChange }: { iso: string; onChange: (firstDay: string) => void }) {
  const selected = isoToDate(startOfMonth(iso || dateToIso(new Date())));
  const thisYear = new Date().getFullYear();
  const [open, setOpen] = useState(false);
  const [yearView, setYearView] = useState(selected.getFullYear());
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const minYear = thisYear - 5;
  const maxYear = thisYear + 3;

  useEffect(() => {
    if (!open) return;
    setYearView(isoToDate(startOfMonth(iso)).getFullYear());
  }, [open, iso]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (!open || !triggerRef.current) {
      setPanelPos(null);
      return;
    }
    function place() {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const margin = 12;
      const width = Math.min(window.innerWidth - margin * 2, 300);
      let left = rect.left;
      if (left + width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - width);
      const top = Math.min(rect.bottom + 8, window.innerHeight - margin - 80);
      setPanelPos({ top, left, width, maxHeight: Math.max(200, window.innerHeight - top - margin) });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const yearBtn = (ok: boolean) => cn("flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line text-t1", ok ? "hover:bg-bg-3" : "cursor-not-allowed opacity-40");
  const panel =
    open && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width, maxHeight: panelPos.maxHeight }}
            className="fixed z-[105] overflow-y-auto rounded-[14px] border border-line bg-bg-2 p-4 shadow-[var(--shadow-vela)]"
          >
            <div className="mb-3 flex items-center justify-between">
              <button type="button" disabled={yearView <= minYear} aria-label="Ano anterior" className={yearBtn(yearView > minYear)} onClick={() => setYearView((year) => year - 1)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
              </button>
              <span className="text-sm font-bold text-t0">{yearView}</span>
              <button type="button" disabled={yearView >= maxYear} aria-label="Próximo ano" className={yearBtn(yearView < maxYear)} onClick={() => setYearView((year) => year + 1)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {MONTHS.map((name, month) => {
                const active = selected.getFullYear() === yearView && selected.getMonth() === month;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      onChange(dateToIso(new Date(yearView, month, 1)));
                      setOpen(false);
                    }}
                    className={cn("h-9 truncate rounded-[9px] px-1 text-[12.5px] font-semibold transition-colors", active ? "bg-acc text-white" : "text-t1 hover:bg-bg-3")}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={triggerRef} className="relative flex w-full">
      <button
        type="button"
        aria-label={`Mês da escala: ${scaleMonthLabel(iso)}`}
        onClick={() => setOpen((current) => !current)}
        className={cn("flex h-[42px] w-full min-w-0 items-center gap-2.5 rounded-[11px] border bg-bg-inset px-3.5 text-left transition-colors", open ? "border-acc" : "border-line hover:border-acc")}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={open ? "var(--acc)" : "var(--t2)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span className="min-w-0 truncate text-[13.5px] font-semibold text-t0">{scaleMonthLabel(iso)}</span>
      </button>
      {panel}
    </div>
  );
}

function periodDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

function branchValue(branch: WizardBranch, keep?: Pick<ScheduleWizardValue, "scenario" | "pattern" | "periodStart" | "periodEnd">): ScheduleWizardValue {
  const periodStart = startOfMonth(keep?.periodStart ?? branch.initial.periodStart);
  const periodEnd = endOfMonth(periodStart);
  const own = branch.initial.holidayRules.filter((rule) => rule.date >= periodStart && rule.date <= periodEnd);
  const holidayRules = own.length > 0 ? own : branch.holidays.filter((row) => row.date >= periodStart && row.date <= periodEnd).map((row) => defaultRule(row.date, row.name));
  const headcount = branch.people.filter((person) => branch.initial.selectedIds.includes(person.id)).length;
  const scenario = keep?.scenario ?? branch.initial.scenario;
  const pattern = keep && patternFits(scenario, keep.pattern) ? keep.pattern : branch.initial.pattern;
  return {
    ...branch.initial,
    scenario,
    pattern,
    periodStart,
    periodEnd,
    dayNeeds: withStoreDays(teamTotal(branch.initial.dayNeeds, branch.initial.groupNeeds, headcount), branch.closedDays),
    groupNeeds: [],
    holidayRules,
    replaceManual: false,
  };
}

function hiddenHolidays(branch: WizardBranch, value: ScheduleWizardValue): string[] {
  const kept = new Set(value.holidayRules.map((rule) => rule.date));
  return branch.holidays.filter((row) => row.date >= value.periodStart && row.date <= value.periodEnd && !kept.has(row.date)).map((row) => row.date);
}

export function ScheduleWizard({
  open,
  onClose,
  stores,
  storeId,
  saving,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  stores: WizardBranch[];
  storeId: string;
  saving: boolean;
  onSubmit: (storeId: string, value: ScheduleWizardValue) => Promise<ScheduleGenerateIssue | string | void>;
}) {
  const opening = (stores.find((item) => item.id === storeId) ?? stores[0]) as WizardBranch;
  const [branchId, setBranchId] = useState(opening.id);
  const branch = stores.find((item) => item.id === branchId) ?? opening;
  const people = branch.people;
  const hasSchedule = branch.hasSchedule;
  const nationalHolidays = branch.holidays;
  const [step, setStep] = useState(1);
  const [value, setValue] = useState(() => branchValue(opening));
  const [dismissed, setDismissed] = useState<string[]>(() => hiddenHolidays(opening, branchValue(opening)));
  const [extraDate, setExtraDate] = useState("");
  const [extraName, setExtraName] = useState("");
  const [addingHoliday, setAddingHoliday] = useState(false);
  const [saveIssue, setSaveIssue] = useState<ScheduleGenerateIssue | null>(null);

  function clearIssue() {
    setSaveIssue(null);
  }

  function showIssue(result: ScheduleGenerateIssue | string | void) {
    if (!result) return;
    if (typeof result === "string") {
      setSaveIssue({ title: result, explanation: "", howToFix: [], fixes: [] });
      return;
    }
    setSaveIssue(result);
  }
  const days = periodDays(value.periodStart, value.periodEnd);
  const periodOk = value.periodEnd >= value.periodStart && days > 0 && days <= 93;
  const types = TYPES.filter((item) => patternFits(value.scenario, item.id));
  const selectedPeople = people.filter((person) => value.selectedIds.includes(person.id));
  const headcount = selectedPeople.length;

  function forSubmit(source: typeof value): typeof value {
    return {
      ...source,
      groupNeeds: [],
      dayNeeds: withStoreDays(source.dayNeeds.map((day) => ({ ...day, min: Math.min(headcount, Math.max(0, day.min)) })), branch.closedDays),
      holidayRules: source.holidayRules.map((rule) => ({ ...rule, workers: Math.min(headcount, Math.max(0, rule.workers)) })),
    };
  }

  function setDayMin(dow: number, min: number) {
    setValue((current) => ({
      ...current,
      groupNeeds: [],
      dayNeeds: current.dayNeeds.map((item) => (item.dow === dow ? { ...item, min: Math.min(headcount, Math.max(0, min)) } : item)),
    }));
  }

  function copyMin(from: number) {
    const source = value.dayNeeds.find((day) => day.dow === from);
    if (!source?.open) return;
    setValue((current) => ({
      ...current,
      dayNeeds: current.dayNeeds.map((item) => (item.open ? { ...item, min: source.min } : item)),
    }));
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

  function setScaleMonth(firstDay: string) {
    const periodStart = startOfMonth(firstDay);
    setPeriod({ periodStart, periodEnd: endOfMonth(periodStart) });
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

  function chooseStore(id: string) {
    const next = stores.find((item) => item.id === id);
    if (!next || id === branchId) return;
    const seeded = branchValue(next, value);
    setBranchId(id);
    setValue(seeded);
    setDismissed(hiddenHolidays(next, seeded));
    setExtraDate("");
    setExtraName("");
    setAddingHoliday(false);
    clearIssue();
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
      title={hasSchedule ? "Editar escala" : "Criar escala"}
      size="lg"
      scrollKey={step}
      bodyClassName="overflow-x-hidden overflow-y-auto p-5"
      footer={
        <div className="flex w-full min-w-0 flex-col gap-3">
          {saveIssue ? (
            <Alert
              variant="danger"
              title={saveIssue.title}
              footer={
                saveIssue.fixes.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-black/5 pt-2 dark:border-white/10">
                    {saveIssue.fixes.map((fix) => (
                      <AlertLink
                        key={`${fix.step}-${fix.label}`}
                        onClick={() => {
                          setStep(fix.step);
                          clearIssue();
                        }}
                      >
                        {fix.label}
                      </AlertLink>
                    ))}
                  </div>
                ) : undefined
              }
            >
              {saveIssue.explanation || saveIssue.howToFix.length > 0 ? (
                <div className="space-y-2">
                  {saveIssue.explanation ? <p>{saveIssue.explanation}</p> : null}
                  {saveIssue.howToFix.length > 0 ? (
                    <div>
                      <p className="font-semibold text-t0">Como resolver</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {saveIssue.howToFix.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Alert>
          ) : null}
          <WizardNav
            align="end"
            hidePrevious={step === 1}
            previousDisabled={saving}
            nextDisabled={saving || (step === 1 && !periodOk) || (step === 2 && value.selectedIds.length === 0)}
            nextLabel={step === 4 ? (saving ? (hasSchedule ? "Salvando…" : "Criando…") : hasSchedule ? "Salvar alterações" : "Criar escala") : "Continuar"}
            hidePreviousIcon
            hideNextIcon
            onPrevious={() => {
              clearIssue();
              setStep((current) => current - 1);
            }}
            onNext={() => {
              if (step < 4) {
                clearIssue();
                setStep((current) => current + 1);
                return;
              }
              void onSubmit(branchId, forSubmit(value)).then(showIssue);
            }}
          />
        </div>
      }
    >
      <WizardSteps steps={STEPS} current={step} />
      {step === 1 ? (
        <>
          <WizardCardHeader title={<>Modelo da escala<span className="text-bad"> *</span></>} subtitle="Escolha o modelo e o mês da escala." />
          <div className="flex flex-col gap-4">
          <FormField label="Cenário" required>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => setScenario("before_6x1")} className={cn("rounded-[var(--radius-vela-md)] border px-3 py-2 text-left", value.scenario === "before_6x1" ? "border-acc bg-acc-soft" : "border-line bg-bg-inset")}>
                <span className="block text-[13px] font-semibold text-t0">Antes do fim da 6×1</span>
                <span className="mt-0.5 block text-[12px] text-t2">Inclui 6×1, 5×2, 4×3 e 12×36.</span>
              </button>
              <button type="button" onClick={() => setScenario("after_6x1")} className={cn("rounded-[var(--radius-vela-md)] border px-3 py-2 text-left", value.scenario === "after_6x1" ? "border-acc bg-acc-soft" : "border-line bg-bg-inset")}>
                <span className="block text-[13px] font-semibold text-t0">Após o fim da 6×1</span>
                <span className="mt-0.5 block text-[12px] text-t2">Duas ou mais folgas por semana.</span>
              </button>
            </div>
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Tipo de escala" required hint="Os dias fechados e as folgas de domingo também entram na conta.">
              <Select value={value.pattern} onChange={(event) => setValue((current) => ({ ...current, pattern: event.target.value as SchedulePattern }))}>
                {types.map((item) => (
                  <option key={item.id} value={item.id}>{item.title} · {item.detail}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Mês da escala" required>
              <ScheduleMonthField iso={value.periodStart} onChange={setScaleMonth} />
            </FormField>
          </div>
          </div>
        </>
      ) : null}
      {step === 2 ? (
        <>
          <WizardCardHeader title={<>Equipe da escala<span className="text-bad"> *</span></>} subtitle="Escolha a filial e as pessoas que entram nesta escala." />
          <p className="-mt-2 mb-1 text-[12px] text-t2">Usado apenas para aplicar a regra de folga aos domingos.</p>
          <FormField label="Filial" required>
            <Select value={branchId} disabled={stores.length < 2} aria-label="Filial da escala" onChange={(event) => chooseStore(event.target.value)}>
              {stores.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </Select>
          </FormField>
          <ul className="mt-4 space-y-1.5">
            {people.length === 0 ? <li className="text-[13px] text-t2">Nenhuma pessoa ativa nesta filial.</li> : null}
            {people.map((person) => {
              const selected = value.selectedIds.includes(person.id);
              return (
              <li key={person.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3 py-1.5">
                <input
                  type="checkbox"
                  className="shrink-0"
                  checked={selected}
                  onChange={() =>
                    setValue((current) => ({
                      ...current,
                      selectedIds: current.selectedIds.includes(person.id) ? current.selectedIds.filter((id) => id !== person.id) : [...current.selectedIds, person.id],
                      sex: { ...current.sex, [person.id]: current.sex[person.id] ?? "woman" },
                    }))
                  }
                />
                <PersonAvatar name={person.name} employeeId={person.code} storeId={person.storeId} size="sm" />
                <span className="min-w-[8rem] flex-1">
                  <span className="block truncate text-[13px] font-semibold text-t0">{person.name}</span>
                  <span className="block truncate text-[11px] text-t2">{[person.role, person.groupName].filter(Boolean).join(" · ")}</span>
                </span>
                {selected ? (
                  <span className="flex min-w-0 flex-wrap items-end gap-2">
                    <label className="w-[9.5rem] text-[11px] font-bold text-t0">
                      Dia de folga<span className="text-bad"> *</span>
                      <Select
                        className="mt-1 h-8! px-2!"
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
                    <label className="w-[7.5rem] text-[11px] font-bold text-t0">
                      Sexo<span className="text-bad"> *</span>
                      <Select className="mt-1 h-8! px-2!" aria-label={`Sexo de ${person.name}`} value={value.sex[person.id] ?? "woman"} onChange={(event) => setValue((current) => ({ ...current, sex: { ...current.sex, [person.id]: event.target.value as Sex } }))}>
                        <option value="woman">Mulher</option>
                        <option value="man">Homem</option>
                      </Select>
                    </label>
                  </span>
                ) : null}
              </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[12px] text-t2">No automático, a folga é definida pela escala. Para fixar um dia da semana, escolha-o aqui.</p>
          <div className="mt-4">
          <Accordion
            items={[
              {
                key: "sunday",
                title: "Folgas aos domingos",
                content: (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
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
                    <p className="mt-2 text-[12px] text-t2">Se o domingo estiver fechado na filial, todas as pessoas folgam nesse dia.</p>
                  </>
                ),
              },
            ]}
          />
          </div>
        </>
      ) : null}
      {step === 3 ? (
        <>
          <WizardCardHeader title="Dias de funcionamento" subtitle="Os dias fechados vêm do horário da filial. Nos dias abertos, informe quantas pessoas precisam trabalhar." />
          <div>
            {[...value.dayNeeds].sort((a, b) => a.dow - b.dow).map((day) => {
              const label = DOW_LABELS[day.dow as Dow];
              const firstOpen = [...value.dayNeeds].sort((a, b) => a.dow - b.dow).find((item) => item.open)?.dow === day.dow;
              return (
                <Fragment key={day.dow}>
                  <div className="flex items-center justify-between gap-3 border-b border-line py-1.5">
                    <p className="text-[13px] font-semibold text-t0">{label}</p>
                    {day.open ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-t2">Mínimo de pessoas</span>
                        <HeadcountField value={day.min} max={headcount} label={`Mínimo de pessoas em ${label}`} onChange={(min) => setDayMin(day.dow, min)} />
                      </div>
                    ) : (
                      <p className="text-[13px] text-t2">Fechado</p>
                    )}
                  </div>
                  {firstOpen ? (
                    <button type="button" onClick={() => copyMin(day.dow)} className="mt-1.5 text-left text-[12.5px] font-semibold text-acc hover:underline">
                      Copiar quantidade
                    </button>
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        </>
      ) : null}
      {step === 4 ? (
        <>
          <WizardCardHeader title="Feriados" subtitle="Defina quais feriados a filial abre e quantas pessoas trabalham." />
          <ul className="space-y-3">
            {value.holidayRules.length === 0 ? <li className="text-[13px] text-t2">Nenhum feriado neste período.</li> : null}
            {value.holidayRules.map((rule) => (
              <li key={`${rule.date}-${rule.name}`} className="min-w-0 rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3 py-3">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold text-t0">{rule.name}</span>
                    <span className="text-[12px] text-t2">{holidayDateLabel(rule.date)}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remover ${rule.name}`}
                    onClick={() => {
                      setDismissed((current) => [...current, rule.date]);
                      setValue((current) => ({ ...current, holidayRules: current.holidayRules.filter((item) => item !== rule) }));
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-line text-bad transition-colors hover:bg-bad-soft"
                  >
                    <Icon d={icons.trash} size={14} />
                  </button>
                </div>
                <label className="mt-2 flex items-center gap-2 text-[13px] text-t0">
                  <input type="checkbox" className="shrink-0" checked={rule.open} onChange={(event) => patchRule(rule.date, { open: event.target.checked })} />
                  A filial abre neste feriado
                </label>
                {rule.open ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <FormField label="Pessoas trabalhando" required>
                      <HeadcountField value={rule.workers} max={headcount} label={`Pessoas trabalhando em ${rule.name}`} onChange={(workers) => patchRule(rule.date, { workers })} />
                    </FormField>
                    <FormField label="Compensação" required>
                      <Select value={rule.pay} aria-label={`Compensação de ${rule.name}`} onChange={(event) => patchRule(rule.date, { pay: event.target.value as HolidayRule["pay"] })}>
                        <option value="extra_off">Folga compensatória</option>
                        <option value="double">Pagamento em dobro</option>
                      </Select>
                    </FormField>
                    {rule.pay === "extra_off" ? (
                      <div className="sm:col-span-2">
                        <FormField label="Prazo da folga compensatória" required>
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
                <button
                  type="button"
                  aria-label="Remover feriado municipal"
                  onClick={() => {
                    setExtraDate("");
                    setExtraName("");
                    setAddingHoliday(false);
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-line text-bad transition-colors hover:bg-bad-soft"
                >
                  <Icon d={icons.trash} size={14} />
                </button>
              </div>
            </section>
          ) : (
            <div className="mt-4">
              <Button type="button" variant="outline" size="sm" onClick={() => setAddingHoliday(true)}>
                Adicionar feriado
              </Button>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-t2">Adicione um feriado municipal que não apareceu na lista.</p>
            </div>
          )}
          {hasSchedule ? (
            <label className="mt-4 flex items-start gap-3 rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3 py-3 text-[13px] text-t0">
              <input type="checkbox" className="mt-0.5 shrink-0" checked={value.replaceManual} onChange={(event) => setValue((current) => ({ ...current, replaceManual: event.target.checked }))} />
              <span>Substituir também os dias ajustados neste período. Fora dele, a escala permanece.</span>
            </label>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}
