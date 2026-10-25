/** Geração da escala do mês. O dia é a unidade: 12×36 alterna dia sim e dia não. */

import { addDays, addMonths, endOfMonth } from "./engine/format";

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
  /** 1 = segunda … 6 = sábado. Só no modo fixo. */
  fixedOffDow?: number | null;
  sex?: Sex | null;
  groupId?: string | null;
};

export type DayNeed = { dow: number; open: boolean; min: number };
export type GroupNeed = { groupId: string; min: number };

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

const CYCLE: Record<SchedulePattern, { work: number; off: number }> = {
  "6x1": { work: 6, off: 1 },
  "5x2": { work: 5, off: 2 },
  "4x3": { work: 4, off: 3 },
  "12x36": { work: 1, off: 1 },
};

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

function baseOff(pattern: SchedulePattern, personIndex: number, dayIndex: number): boolean {
  if (pattern === "12x36") return (dayIndex + personIndex) % 2 === 1;
  const { work, off } = CYCLE[pattern];
  return (dayIndex + personIndex) % (work + off) >= work;
}

function isOff(status: DayStatus): boolean {
  return status === "off" || status === "comp_off";
}

function workersOn(grid: DayStatus[][], day: number, people?: number[]): number {
  const indexes = people ?? grid.map((_, index) => index);
  let count = 0;
  for (const person of indexes) if (!isOff(grid[person][day])) count++;
  return count;
}

function dayMin(needs: DayNeed[] | undefined, dow: number): { open: boolean; min: number } {
  const row = needs?.find((item) => item.dow === dow);
  if (!row) return { open: true, min: 0 };
  return { open: row.open, min: row.open ? row.min : 0 };
}

function groupMin(needs: GroupNeed[] | undefined, groupId: string | null | undefined): number {
  if (!groupId || !needs) return 0;
  return needs.find((item) => item.groupId === groupId)?.min ?? 0;
}

function staysCovered(grid: DayStatus[][], people: SchedulePerson[], needs: DayNeed[] | undefined, groups: GroupNeed[] | undefined, day: number, dow: number, leaving: number): boolean {
  const next = grid.map((row) => row.slice());
  next[leaving][day] = "off";
  if (workersOn(next, day) < dayMin(needs, dow).min) return false;
  const groupId = people[leaving].groupId;
  const min = shiftFloor(needs, groups, dow, groupId);
  if (min <= 0 || !groupId) return true;
  const members = people.map((person, index) => (person.groupId === groupId ? index : -1)).filter((index) => index >= 0);
  return workersOn(next, day, members) >= min;
}

function applySundayMinimum(grid: DayStatus[][], dates: string[], people: SchedulePerson[], sundays: number[], ruleFor: (person: number) => number, needs: DayNeed[] | undefined, groups: GroupNeed[] | undefined) {
  for (let person = 0; person < grid.length; person++) {
    const need = ruleFor(person);
    let offs = sundays.filter((day) => isOff(grid[person][day])).length;
    while (offs < need) {
      const target = sundays
        .filter((day) => !isOff(grid[person][day]) && staysCovered(grid, people, needs, groups, day, 0, person))
        .sort((a, b) => workersOn(grid, b) - workersOn(grid, a))[0];
      if (target == null) break;
      const giveBack = grid[person].findIndex((status, day) => weekday(dates[day]) !== 0 && isOff(status) && dayMin(needs, weekday(dates[day])).open);
      grid[person][target] = "off";
      if (giveBack >= 0) grid[person][giveBack] = "work";
      offs++;
    }
  }
}

function ensureSundayCoverage(grid: DayStatus[][], dates: string[], sundays: number[], needs: DayNeed[] | undefined, locked?: boolean[][]) {
  if (grid.length === 0) return;
  for (const day of sundays) {
    if (!dayMin(needs, 0).open) continue;
    const allowed = grid.map((_, person) => person).filter((person) => !locked?.[person]?.[day]);
    const pool = allowed.length > 0 ? allowed : grid.map((_, person) => person);
    if (workersOn(grid, day, pool) > 0 && workersOn(grid, day) >= dayMin(needs, 0).min) continue;
    let pick = pool[0] ?? 0;
    let best = -1;
    for (const person of pool) {
      const offs = sundays.filter((sunday) => isOff(grid[person][sunday])).length;
      if (offs > best) {
        best = offs;
        pick = person;
      }
    }
    grid[pick][day] = "work";
    const swap = grid[pick].findIndex((status, index) => index !== day && weekday(dates[index]) !== 0 && !isOff(status) && dayMin(needs, weekday(dates[index])).open && !locked?.[pick]?.[index]);
    if (swap >= 0) grid[pick][swap] = "off";
  }
}

function shiftFloor(needs: DayNeed[] | undefined, groups: GroupNeed[] | undefined, dow: number, groupId: string | null | undefined): number {
  const explicit = groupMin(groups, groupId);
  if (explicit > 0) return explicit;
  if (needs && groupId) return dayMin(needs, dow).min;
  return 0;
}

function enforceMinimums(grid: DayStatus[][], dates: string[], people: SchedulePerson[], needs: DayNeed[] | undefined, groups: GroupNeed[] | undefined, locked?: boolean[][]) {
  for (let day = 0; day < dates.length; day++) {
    const dow = weekday(dates[day]);
    const rule = dayMin(needs, dow);
    if (!rule.open) {
      for (const row of grid) row[day] = "off";
      continue;
    }
    while (workersOn(grid, day) < rule.min) {
      const person = grid.findIndex((row, index) => isOff(row[day]) && !locked?.[index]?.[day]);
      if (person < 0) break;
      grid[person][day] = "work";
    }
    const seen = new Set<string>();
    for (const person of people) {
      if (!person.groupId || seen.has(person.groupId)) continue;
      seen.add(person.groupId);
      const min = shiftFloor(needs, groups, dow, person.groupId);
      const members = people.map((item, index) => (item.groupId === person.groupId ? index : -1)).filter((index) => index >= 0);
      if (members.some((index) => locked?.[index]?.[day])) continue;
      while (workersOn(grid, day, members) < min) {
        const pick = members.find((index) => isOff(grid[index][day]) && !locked?.[index]?.[day]);
        if (pick == null) break;
        grid[pick][day] = "work";
      }
    }
  }
}

function capConsecutive(grid: DayStatus[][], dates: string[], people: SchedulePerson[], needs: DayNeed[] | undefined, groups: GroupNeed[] | undefined) {
  for (let person = 0; person < grid.length; person++) {
    let run = 0;
    for (let day = 0; day < grid[person].length; day++) {
      if (!isOff(grid[person][day])) {
        run++;
        if (run > 6 && staysCovered(grid, people, needs, groups, day, weekday(dates[day]), person)) {
          grid[person][day] = "off";
          run = 0;
        }
      } else run = 0;
    }
  }
}

function placeComp(grid: DayStatus[][], dates: string[], people: SchedulePerson[], needs: DayNeed[] | undefined, groups: GroupNeed[] | undefined, person: number, from: number, to: number): boolean {
  for (let day = from; day <= to && day < dates.length; day++) {
    if (day < 0 || isOff(grid[person][day])) continue;
    const dow = weekday(dates[day]);
    if (!dayMin(needs, dow).open) continue;
    if (!staysCovered(grid, people, needs, groups, day, dow, person)) continue;
    grid[person][day] = "comp_off";
    return true;
  }
  return false;
}

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
  /** Ordem dos turnos. Com dois ou mais, os domingos revezam. */
  sundayShifts?: string[];
  /** Índice do turno que trabalha o primeiro domingo do período. */
  sundayShiftStart?: number;
}): GeneratedMonth {
  const dates = input.from && input.to && input.from <= input.to
    ? Array.from({ length: 93 }, (_, index) => addDays(input.from!, index)).filter((iso) => iso <= input.to!)
    : Array.from({ length: daysInMonth(input.year, input.month) }, (_, index) => isoDate(input.year, input.month, index + 1));
  const count = dates.length;
  const openSundays = dates.map((iso, index) => (weekday(iso) === 0 ? index : -1)).filter((index) => index >= 0 && dayMin(input.dayNeeds, 0).open);
  const shifts = input.sundayShifts ?? [];
  function sundayOwner(day: number): string | null {
    if (shifts.length < 2) return null;
    const pos = openSundays.indexOf(day);
    if (pos < 0) return null;
    return shifts[((input.sundayShiftStart ?? 0) + pos) % shifts.length];
  }
  const locked = input.people.map((person) => dates.map((_, day) => {
    const owner = sundayOwner(day);
    return Boolean(owner && person.groupId && person.groupId !== owner);
  }));
  const grid: DayStatus[][] = input.people.map((person, personIndex) =>
    dates.map((iso, day) => {
      const dow = weekday(iso);
      if (input.dayNeeds && !dayMin(input.dayNeeds, dow).open) return "off";
      if (locked[personIndex][day]) return "off";
      if (person.fixedOffDow != null) return dow === person.fixedOffDow ? "off" : "work";
      if (baseOff(input.pattern, personIndex, day)) return "off";
      return "work";
    }),
  );
  const sundays = openSundays;
  const bySex = input.womenSunday != null || input.menSunday != null;
  const ruleFor = (person: number) => {
    if (!bySex) return input.sundayMin >= 5 ? sundays.length : input.sundayMin;
    const sex = input.people[person].sex === "man" ? "man" : "woman";
    const rule = sex === "man" ? (input.menSunday ?? "every_3") : (input.womenSunday ?? "every_2");
    return sundayOffTarget(rule, sundays.length);
  };
  if (input.offMode === "rotating" || bySex) applySundayMinimum(grid, dates, input.people, sundays, ruleFor, input.dayNeeds, input.groupNeeds);
  ensureSundayCoverage(grid, dates, sundays, input.dayNeeds, locked);
  enforceMinimums(grid, dates, input.people, input.dayNeeds, input.groupNeeds, locked);
  capConsecutive(grid, dates, input.people, input.dayNeeds, input.groupNeeds);

  const compDue: CompDue[] = [];
  const monthEnd = endOfMonth(dates[0] ?? isoDate(input.year, input.month, 1));
  const nextEnd = endOfMonth(addMonths(monthEnd, 1));
  for (const due of input.incomingComp ?? []) {
    const person = input.people.findIndex((item) => item.id === due.personId);
    if (person < 0) continue;
    const until = dates.findIndex((iso) => iso > due.until);
    const placed = placeComp(grid, dates, input.people, input.dayNeeds, input.groupNeeds, person, 0, until < 0 ? count - 1 : until - 1);
    if (!placed) compDue.push(due);
  }

  const rules = new Map((input.holidayRules ?? []).map((rule) => [rule.date, rule]));
  const plain = new Set(input.holidayDates);
  for (let day = 0; day < count; day++) {
    const rule = rules.get(dates[day]);
    if (!rule) continue;
    if (!rule.open) {
      for (const row of grid) row[day] = "off";
      continue;
    }
    const working = grid
      .map((row, person) => ({ person, working: !isOff(row[day]) }))
      .sort((a, b) => Number(b.working) - Number(a.working));
    const keep = new Set(working.slice(0, Math.max(0, rule.workers)).map((item) => item.person));
    for (let person = 0; person < grid.length; person++) {
      if (keep.has(person)) grid[person][day] = "holiday_work";
      else grid[person][day] = "off";
    }
    if (rule.pay !== "extra_off") continue;
    for (const person of keep) {
      const from = day + 1;
      const to = rule.window === "7_days" ? day + 7 : rule.window === "month_end" ? count - 1 : -1;
      const placed = to >= from && placeComp(grid, dates, input.people, input.dayNeeds, input.groupNeeds, person, from, Math.min(to, count - 1));
      if (!placed) compDue.push({ personId: input.people[person].id, holiday: rule.date, until: nextEnd });
    }
  }

  const rows: GeneratedDay[] = [];
  for (let person = 0; person < input.people.length; person++) {
    for (let day = 0; day < count; day++) {
      let status = grid[person][day];
      if (status === "work" && plain.has(dates[day]) && !rules.has(dates[day])) status = "holiday_work";
      rows.push({ personId: input.people[person].id, date: dates[day], status });
    }
  }
  return { days: rows, compDue };
}
