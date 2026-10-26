/** Geração da escala do mês, com a mesma busca do gerador de escalas. */

import { addDays, addMonths, endOfMonth } from "./engine/format";
import { generate } from "./scheduleEngine";

export type SchedulePattern = "6x1" | "5x2" | "4x3" | "12x36";
export type ScheduleScenario = "before_6x1" | "after_6x1";
export type OffMode = "rotating" | "fixed";
export type DayStatus = "work" | "off" | "holiday_work" | "comp_off";
export type Sex = "woman" | "man";
/** Um domingo de folga a cada N, ou todos. */
export type SundayRule = "every_3" | "every_2" | "all" | "none";
export type CompWindow = "7_days" | "month_end" | "next_month";
export type HolidayPay = "extra_off" | "double";

export type SchedulePerson = {
  id: string;
  /** Nome na mensagem de erro. Sem ele, a geração usa o identificador. */
  name?: string;
  /** 1 = segunda … 6 = sábado. Só no modo fixo. */
  fixedOffDow?: number | null;
  sex?: Sex | null;
  groupId?: string | null;
};

export type DayNeed = { dow: number; open: boolean; min: number };
/** Mínimo de um turno. Sem `dow`, vale para todos os dias. */
export type GroupNeed = { groupId: string; min: number; dow?: number };

export type HolidayRule = {
  date: string;
  name: string;
  open: boolean;
  workers: number;
  pay: HolidayPay;
  window: CompWindow;
};

export type CompDue = { personId: string; holiday: string; until: string };

export type GeneratedDay = {
  personId: string;
  date: string;
  status: DayStatus;
};

export type GeneratedMonth = { days: GeneratedDay[]; compDue: CompDue[] };

export function patternFits(scenario: ScheduleScenario, pattern: SchedulePattern): boolean {
  if (scenario === "after_6x1") return pattern !== "6x1";
  return true;
}

const WEEK = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 0 = domingo … 6 = sábado, em UTC, sem o fuso do navegador. */
export function weekday(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function weekdayLabel(dow: number): string {
  return WEEK[dow] ?? "";
}

export function sundayOffTarget(rule: SundayRule, sundayCount: number): number {
  if (rule === "none" || sundayCount === 0) return 0;
  if (rule === "all") return sundayCount;
  const every = rule === "every_2" ? 2 : 3;
  return Math.floor(sundayCount / every);
}

export function defaultDayNeeds(): DayNeed[] {
  return Array.from({ length: 7 }, (_, dow) => ({ dow, open: true, min: 1 }));
}

export function nextSundayShift(lastShiftId: string | null, orderedShiftIds: string[]): number {
  if (orderedShiftIds.length === 0) return 0;
  const index = lastShiftId ? orderedShiftIds.indexOf(lastShiftId) : -1;
  if (index < 0) return 0;
  return (index + 1) % orderedShiftIds.length;
}

/** Turno com mais gente trabalhando naquele domingo. */
export function shiftThatWorked(rows: { personId: string; status: string }[], shiftOf: (personId: string) => string | null): string | null {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== "work" && row.status !== "holiday_work") continue;
    const shift = shiftOf(row.personId);
    if (!shift) continue;
    counts.set(shift, (counts.get(shift) ?? 0) + 1);
  }
  let winner: string | null = null;
  let best = 0;
  for (const [id, count] of counts) {
    if (count > best) {
      best = count;
      winner = id;
    }
  }
  return winner;
}

const CADENCE: Record<SundayRule, number> = { none: 0, all: 1, every_2: 2, every_3: 3 };

/** 0 = domingo no WDash vira 6 no gerador, onde 0 é segunda. */
function generatorDow(dow: number): number {
  return (dow + 6) % 7;
}

function sundayCadence(rule: SundayRule | undefined, sundayMin: number): number {
  if (rule) return CADENCE[rule];
  if (sundayMin >= 5) return 1;
  return 0;
}

function holidayDeadline(rule: HolidayRule, monthEnd: string): string {
  if (rule.window === "7_days") return addDays(rule.date, 7);
  if (rule.window === "next_month") return endOfMonth(addMonths(monthEnd, 1));
  return monthEnd;
}

function markStatus(mark: string): DayStatus {
  if (mark === "F") return "off";
  if (mark === "FE") return "holiday_work";
  if (mark === "FC") return "comp_off";
  return "work";
}

function placeIncoming(days: GeneratedDay[], needs: DayNeed[] | undefined, rules: HolidayRule[], due: CompDue): boolean {
  const blocked = new Set(rules.map((rule) => rule.date));
  for (const cell of days) {
    if (cell.personId !== due.personId || cell.date > due.until) continue;
    if (cell.status !== "work" && cell.status !== "holiday_work") continue;
    if (blocked.has(cell.date)) continue;
    const row = needs?.find((item) => item.dow === weekday(cell.date));
    if (row && !row.open) continue;
    const min = row?.open ? row.min : 0;
    const working = days.filter((item) => item.date === cell.date && item.status !== "off" && item.status !== "comp_off").length;
    if (working - 1 < min) continue;
    cell.status = "comp_off";
    return true;
  }
  return false;
}

type EngineMonth = {
  ok: boolean;
  error?: string;
  days: string[];
  matrix: string[][];
  compensation?: { employee: number; holiday: string; day: string; deadline?: string }[];
};

export function generateMonth(input: {
  year: number;
  month: number;
  pattern: SchedulePattern;
  offMode: OffMode;
  sundayMin: number;
  womenSunday?: SundayRule;
  menSunday?: SundayRule;
  people: SchedulePerson[];
  holidayDates: Iterable<string>;
  dayNeeds?: DayNeed[];
  groupNeeds?: GroupNeed[];
  holidayRules?: HolidayRule[];
  incomingComp?: CompDue[];
  /** O ciclo começa nesta data. Sem ela, a escala usa o mês inteiro. */
  from?: string;
  to?: string;
  /** Ordem dos turnos. O mínimo do dia é da equipe inteira, como no gerador. */
  sundayShifts?: string[];
  /** Índice do turno que trabalha o primeiro domingo do período. */
  sundayShiftStart?: number;
}): GeneratedMonth {
  const month = isoDate(input.year, input.month, 1).slice(0, 7);
  const monthStart = `${month}-01`;
  const monthEnd = endOfMonth(monthStart);
  const from = input.from ?? monthStart;
  const to = input.to ?? monthEnd;
  const open = Array.from({ length: 7 }, (_, genDow) => {
    const row = input.dayNeeds?.find((item) => item.dow === (genDow + 1) % 7);
    return row ? row.open : true;
  });
  const minimum = Array.from({ length: 7 }, (_, genDow) => {
    const row = input.dayNeeds?.find((item) => item.dow === (genDow + 1) % 7);
    return row?.open ? row.min : 0;
  });
  const rules = (input.holidayRules ?? []).filter((rule) => rule.date.startsWith(month));
  const result = generate({
    month,
    regime: "before",
    model: input.pattern,
    employees: input.people.map((person) => ({
      name: person.name?.trim() || "Pessoa",
      sex: person.sex === "man" ? "M" : "F",
      fixed: person.fixedOffDow == null ? -1 : generatorDow(person.fixedOffDow),
    })),
    open,
    minimum,
    sundayF: sundayCadence(input.womenSunday, input.sundayMin),
    sundayM: sundayCadence(input.menSunday, input.sundayMin),
    compDeadline: "seven",
    firstSpanish: 1,
    holidays: rules.map((rule) => ({
      date: rule.date,
      name: rule.name,
      workers: rule.open ? rule.workers : 0,
      treatment: rule.pay === "double" ? "pay" : "comp",
      deadline: rule.pay === "extra_off" ? holidayDeadline(rule, monthEnd) : rule.date,
      notBefore: rule.window === "next_month" ? addDays(monthEnd, 1) : addDays(rule.date, 1),
    })),
  }) as EngineMonth;
  if (!result.ok) throw new Error(result.error || "Não foi possível gerar a escala.");
  const plain = new Set(input.holidayDates);
  const knownHoliday = new Set(rules.map((rule) => rule.date));
  const days: GeneratedDay[] = [];
  const calendar: string[] = result.days;
  for (let person = 0; person < input.people.length; person++) {
    for (let index = 0; index < calendar.length; index++) {
      const date = calendar[index];
      if (date < from || date > to) continue;
      let status = markStatus(result.matrix[person][index]);
      if (status === "work" && plain.has(date) && !knownHoliday.has(date)) status = "holiday_work";
      days.push({ personId: input.people[person].id, date, status });
    }
  }
  const compDue: CompDue[] = [];
  for (const link of result.compensation ?? []) {
    if (link.day >= from && link.day <= to) continue;
    const person = input.people[link.employee];
    if (!person) continue;
    compDue.push({ personId: person.id, holiday: link.holiday, until: link.deadline || monthEnd });
  }
  for (const due of input.incomingComp ?? []) {
    if (!placeIncoming(days, input.dayNeeds, rules, due)) compDue.push(due);
  }
  return { days, compDue };
}

export type EditableDay = { sellerId: string; day: string; status: DayStatus; origin?: "generated" | "manual" };
export type CellChoice = "work" | "off" | "comp_off";
export type CompLink = { personId: string; holiday: string; day: string; deadline: string };

export const PREVIOUS_MONTH_EDIT = "Este dia pertence à escala do mês anterior. Edite aquela escala para alterá-lo.";
export const COMP_OFF_BLOCKED = "Escolha um dia de trabalho para conceder a folga adicional pelo feriado. As folgas normais devem ser preservadas.";

function dayFace(rules: HolidayRule[], needs: DayNeed[], iso: string): { holiday: boolean; closed: boolean } {
  const rule = rules.find((item) => item.date === iso);
  if (rule) return { holiday: true, closed: rule.workers === 0 || !rule.open };
  const need = needs.find((item) => item.dow === weekday(iso));
  return { holiday: false, closed: need ? !need.open : false };
}

function cellChoice(status: DayStatus): CellChoice {
  if (status === "off") return "off";
  if (status === "comp_off") return "comp_off";
  return "work";
}

/** Liga cada folga pelo feriado ao feriado trabalhado, como a lista de compensação do gerador. */
export function inferCompLinks(days: EditableDay[], rules: HolidayRule[], monthEnd: string): CompLink[] {
  const links: CompLink[] = [];
  const used = new Set<string>();
  const people = [...new Set(days.map((row) => row.sellerId))];
  for (const personId of people) {
    const offs = days.filter((row) => row.sellerId === personId && row.status === "comp_off").map((row) => row.day).sort();
    const holidays = rules
      .filter((rule) => rule.open && rule.pay === "extra_off" && days.some((row) => row.sellerId === personId && row.day === rule.date && row.status === "holiday_work"))
      .sort((a, b) => a.date.localeCompare(b.date));
    for (const rule of holidays) {
      const deadline = holidayDeadline(rule, monthEnd);
      const day = offs.find((iso) => iso > rule.date && iso <= deadline && !used.has(`${personId}|${iso}`));
      if (!day) continue;
      used.add(`${personId}|${day}`);
      links.push({ personId, holiday: rule.date, day, deadline });
    }
  }
  return links;
}

export function dayEditOptions(input: {
  day: string;
  days: EditableDay[];
  rules: HolidayRule[];
  dayNeeds: DayNeed[];
  pattern: SchedulePattern;
  personId: string;
  monthEnd: string;
}): { locked: boolean; fcEnabled: boolean; holidays: HolidayRule[] } {
  const row = input.days.find((item) => item.sellerId === input.personId && item.day === input.day);
  const links = inferCompLinks(input.days, input.rules, input.monthEnd);
  const locked = row?.status === "comp_off" && !links.some((link) => link.personId === input.personId && link.day === input.day);
  const face = dayFace(input.rules, input.dayNeeds, input.day);
  const holidays = input.rules.filter((rule) => {
    if (rule.pay !== "extra_off" || !rule.open || rule.date >= input.day) return false;
    const worked = input.days.some((item) => item.sellerId === input.personId && item.day === rule.date && item.status === "holiday_work");
    return worked && input.day <= holidayDeadline(rule, input.monthEnd);
  });
  const choice = row ? cellChoice(row.status) : "work";
  const fcEnabled = input.pattern !== "12x36" && !locked && (choice === "work" || choice === "comp_off") && !face.holiday && !face.closed && holidays.length > 0;
  return { locked, fcEnabled, holidays };
}

function writeStatus<T extends EditableDay>(days: T[], personId: string, day: string, status: DayStatus): T[] {
  return days.map((row) => (row.sellerId === personId && row.day === day && row.status !== status ? { ...row, status, origin: "manual" } : row));
}

/** Aplica as escolhas de um dia inteiro com a mesma troca de célula do gerador. */
export function applyDayChoices<T extends EditableDay>(input: {
  day: string;
  days: T[];
  rules: HolidayRule[];
  dayNeeds: DayNeed[];
  pattern: SchedulePattern;
  monthEnd: string;
  choices: { personId: string; value: CellChoice; holiday: string | null }[];
}): { days: T[]; error: string | null } {
  let days = input.days.map((row) => ({ ...row }));
  let links = inferCompLinks(days, input.rules, input.monthEnd);
  for (const choice of input.choices) {
    const current = days.find((row) => row.sellerId === choice.personId && row.day === input.day);
    if (!current) continue;
    const linked = links.find((link) => link.personId === choice.personId && link.day === input.day);
    const same = cellChoice(current.status) === choice.value && (choice.value !== "comp_off" || linked?.holiday === choice.holiday);
    if (same) continue;
    const options = dayEditOptions({ ...input, days, personId: choice.personId });
    if (options.locked) return { days: input.days, error: PREVIOUS_MONTH_EDIT };
    if (choice.value === "comp_off" && (!options.fcEnabled || !choice.holiday || !options.holidays.some((rule) => rule.date === choice.holiday))) {
      return { days: input.days, error: COMP_OFF_BLOCKED };
    }
    links = links.filter((link) => !(link.personId === choice.personId && link.day === input.day));
    if (choice.value === "comp_off" && choice.holiday) {
      const previous = links.find((link) => link.personId === choice.personId && link.holiday === choice.holiday);
      if (previous) {
        days = writeStatus(days, choice.personId, previous.day, "work");
        links = links.filter((link) => link !== previous);
      }
      const rule = input.rules.find((item) => item.date === choice.holiday);
      links.push({ personId: choice.personId, holiday: choice.holiday, day: input.day, deadline: rule ? holidayDeadline(rule, input.monthEnd) : input.monthEnd });
      days = writeStatus(days, choice.personId, input.day, "comp_off");
    } else if (choice.value === "work") {
      const face = dayFace(input.rules, input.dayNeeds, input.day);
      days = writeStatus(days, choice.personId, input.day, face.holiday ? "holiday_work" : "work");
    } else {
      days = writeStatus(days, choice.personId, input.day, "off");
    }
  }
  return { days, error: null };
}

