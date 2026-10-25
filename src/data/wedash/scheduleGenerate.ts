/** Geração da escala do mês. O dia é a unidade: 12×36 alterna dia sim e dia não. */

export type SchedulePattern = "6x1" | "5x2" | "12x36";
export type OffMode = "rotating" | "fixed";
export type DayStatus = "work" | "off" | "holiday_work" | "comp_off";

export type SchedulePerson = {
  id: string;
  /** 1 = segunda … 6 = sábado. Só no modo fixo. */
  fixedOffDow?: number | null;
};

export type GeneratedDay = {
  personId: string;
  date: string;
  status: DayStatus;
};

const CYCLE: Record<SchedulePattern, { work: number; off: number }> = {
  "6x1": { work: 6, off: 1 },
  "5x2": { work: 5, off: 2 },
  "12x36": { work: 1, off: 1 },
};

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

function baseOff(pattern: SchedulePattern, personIndex: number, dayIndex: number): boolean {
  if (pattern === "12x36") return (dayIndex + personIndex) % 2 === 1;
  const { work, off } = CYCLE[pattern];
  return (dayIndex + personIndex) % (work + off) >= work;
}

function isOff(status: DayStatus): boolean {
  return status === "off" || status === "comp_off";
}

function workersOn(grid: DayStatus[][], day: number): number {
  let count = 0;
  for (const row of grid) if (!isOff(row[day])) count++;
  return count;
}

function applySundayMinimum(grid: DayStatus[][], dates: string[], sundays: number[], minimum: number) {
  const need = minimum >= 5 ? sundays.length : minimum;
  for (let person = 0; person < grid.length; person++) {
    let offs = sundays.filter((day) => isOff(grid[person][day])).length;
    while (offs < need) {
      const target = sundays
        .filter((day) => !isOff(grid[person][day]) && workersOn(grid, day) > 1)
        .sort((a, b) => workersOn(grid, b) - workersOn(grid, a))[0];
      if (target == null) break;
      const giveBack = grid[person].findIndex((status, day) => weekday(dates[day]) !== 0 && isOff(status));
      grid[person][target] = "off";
      if (giveBack >= 0) grid[person][giveBack] = "work";
      offs++;
    }
  }
}

function ensureSundayCoverage(grid: DayStatus[][], dates: string[], sundays: number[]) {
  if (grid.length === 0) return;
  for (const day of sundays) {
    if (workersOn(grid, day) > 0) continue;
    let pick = 0;
    let best = -1;
    for (let person = 0; person < grid.length; person++) {
      const offs = sundays.filter((sunday) => isOff(grid[person][sunday])).length;
      if (offs > best) {
        best = offs;
        pick = person;
      }
    }
    grid[pick][day] = "work";
    const swap = grid[pick].findIndex((status, index) => index !== day && weekday(dates[index]) !== 0 && !isOff(status));
    if (swap >= 0) grid[pick][swap] = "off";
  }
}

function capConsecutive(grid: DayStatus[][]) {
  for (const row of grid) {
    let run = 0;
    for (let day = 0; day < row.length; day++) {
      if (!isOff(row[day])) {
        run++;
        if (run > 6 && workersOn(grid, day) > 1) {
          row[day] = "off";
          run = 0;
        }
      } else run = 0;
    }
  }
}

export function generateMonth(input: {
  year: number;
  month: number;
  pattern: SchedulePattern;
  offMode: OffMode;
  sundayMin: number;
  people: SchedulePerson[];
  holidayDates: Iterable<string>;
}): GeneratedDay[] {
  const count = daysInMonth(input.year, input.month);
  const dates = Array.from({ length: count }, (_, index) => isoDate(input.year, input.month, index + 1));
  const grid: DayStatus[][] = input.people.map((person, personIndex) =>
    dates.map((iso, day) => {
      const dow = weekday(iso);
      if (input.offMode === "fixed" && person.fixedOffDow != null && dow === person.fixedOffDow) return "off";
      if (input.offMode === "rotating" && baseOff(input.pattern, personIndex, day)) return "off";
      return "work";
    }),
  );
  const sundays = dates.map((iso, index) => (weekday(iso) === 0 ? index : -1)).filter((index) => index >= 0);
  if (input.offMode === "rotating") applySundayMinimum(grid, dates, sundays, input.sundayMin);
  ensureSundayCoverage(grid, dates, sundays);
  capConsecutive(grid);
  const holidays = new Set(input.holidayDates);
  const rows: GeneratedDay[] = [];
  for (let person = 0; person < input.people.length; person++) {
    for (let day = 0; day < count; day++) {
      let status = grid[person][day];
      if (status === "work" && holidays.has(dates[day])) status = "holiday_work";
      rows.push({ personId: input.people[person].id, date: dates[day], status });
    }
  }
  return rows;
}
