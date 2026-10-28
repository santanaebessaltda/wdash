/** Geração da escala do mês, com a mesma busca do gerador de escalas. */

import { addDays, addMonths, endOfMonth } from "./engine/format";
import { continuation, generate } from "./scheduleEngine";

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

/** Pendência de FC. `day` = data prevista (pode cair no mês seguinte); sem ela, só o prazo. */
export type CompDue = { personId: string; holiday: string; until: string; day?: string | null };

export type GeneratedDay = {
  personId: string;
  date: string;
  status: DayStatus;
};

/** Snapshot do motor para o mês seguinte (continuation + ids na ordem da matriz). */
export type GeneratorSnapshot = {
  version: 1;
  personIds: string[];
  month: string;
  model: string;
  employees: { name: string; sex: "M" | "F" }[];
  days: string[];
  matrix: string[][];
  assignment: { base: number; phase: number; workPhase?: number }[];
  startWeek: number;
  firstSpanish: number;
  open: boolean[];
  minimum: number[];
  holidays: unknown[];
  compDeadline: "seven" | "month";
  compensation: { employee: number; holiday: string; day: string; deadline?: string }[];
};

export type GeneratedMonth = { days: GeneratedDay[]; compDue: CompDue[]; snapshot: GeneratorSnapshot };

/** Etapa do wizard onde a pessoa corrige o problema. */
export type ScheduleFixStep = 2 | 3 | 4;

export type ScheduleGenerateIssue = {
  title: string;
  explanation: string;
  /** Passos concretos de como destravar. */
  howToFix: string[];
  /** Atalhos para a etapa do wizard. */
  fixes: { label: string; step: ScheduleFixStep }[];
};

export class ScheduleGenerateError extends Error {
  issue: ScheduleGenerateIssue;
  constructor(issue: ScheduleGenerateIssue) {
    super(issue.explanation);
    this.name = "ScheduleGenerateError";
    this.issue = issue;
  }
}

type EngineDiagnostic = {
  title?: string;
  explanation?: string;
  details?: string[];
  actions?: { label?: string; target?: string }[];
};

const TARGET_STEP: Record<string, ScheduleFixStep> = {
  businessDays: 3,
  employeeList: 2,
  employeeName: 2,
  holidayList: 4,
  compDeadline: 4,
};

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const text = line.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function tipsFor(text: string): string[] {
  const t = text.toLowerCase();
  if (t.includes("domingo")) {
    return [
      "Em Dias, baixe o mínimo de pessoas no domingo.",
      "Em Feriados, se o feriado cair no domingo, use o mesmo mínimo dos outros domingos (não peça mais gente só nele).",
      "Em Equipe → Folgas aos domingos, use “um a cada três” em vez de “um a cada dois”, ou inclua mais pessoas na escala.",
    ];
  }
  if (t.includes("compensat") || (t.includes("folga") && t.includes("feriado"))) {
    return [
      "No feriado, mude o prazo da folga para “No mês seguinte” ou “7 dias”.",
      "Ou troque a compensação para “Pagamento em dobro” (sem folga extra).",
      "Ou em Dias, baixe um pouco o mínimo nos dias úteis para sobrar vaga de folga.",
    ];
  }
  if (t.includes("semana") && (t.includes("cobrir") || t.includes("falta gente") || t.includes("não conseguiu fechar"))) {
    return [
      "Em Dias, reduza o mínimo nos dias mais cheios (sexta e sábado costumam apertar).",
      "Em Equipe, inclua mais pessoas nesta escala.",
      "Se alguém tem folga fixa, mude para Automático ou escolha outro dia.",
    ];
  }
  if (t.includes("12×36") || t.includes("12x36") || t.includes("dia sim")) {
    return [
      "Em Dias e Feriados, as quantidades precisam caber em dois grupos alternados.",
      "Baixe o mínimo nos dias pedindo quase a equipe inteira, ou inclua mais pessoas.",
    ];
  }
  return [
    "Revise a equipe, o mínimo por dia e os feriados — um desses três costuma travar a escala.",
  ];
}

/** Monta o aviso amigável a partir do diagnóstico do motor (ou de um texto solto). */
export function scheduleIssueFromEngine(
  diagnostics: EngineDiagnostic[] | undefined,
  fallback: string,
): ScheduleGenerateIssue {
  const diag = diagnostics?.[0];
  const title = diag?.title?.trim() || "Não foi possível montar a escala";
  const explanation = diag?.explanation?.trim() || fallback.trim() || "Revise equipe, dias e feriados e tente de novo.";
  const blob = `${title} ${explanation} ${(diag?.details ?? []).join(" ")}`;
  const howToFix = uniqueLines([...(diag?.details ?? []), ...tipsFor(blob)]);
  const fixes = uniqueLines(
    (diag?.actions ?? [])
      .map((action) => {
        const step = action.target ? TARGET_STEP[action.target] : undefined;
        if (!step || !action.label) return "";
        return `${step}|${action.label}`;
      })
      .filter(Boolean),
  ).map((row) => {
    const [step, ...rest] = row.split("|");
    return { step: Number(step) as ScheduleFixStep, label: rest.join("|") };
  });
  if (fixes.length === 0) {
    if (blob.toLowerCase().includes("domingo") || blob.toLowerCase().includes("equipe")) {
      fixes.push({ step: 2, label: "Rever equipe e folgas de domingo" }, { step: 3, label: "Rever mínimo nos dias" });
    } else if (blob.toLowerCase().includes("feriado") || blob.toLowerCase().includes("compensat")) {
      fixes.push({ step: 4, label: "Rever feriados" }, { step: 3, label: "Rever mínimo nos dias" });
    } else {
      fixes.push({ step: 3, label: "Rever dias" }, { step: 2, label: "Rever equipe" }, { step: 4, label: "Rever feriados" });
    }
  }
  return { title, explanation, howToFix, fixes };
}

export function issueFromUnknown(caught: unknown): ScheduleGenerateIssue {
  if (caught instanceof ScheduleGenerateError) return caught.issue;
  const message = caught instanceof Error && caught.message ? caught.message : "Não foi possível gerar a escala.";
  return scheduleIssueFromEngine(undefined, message);
}

/** Encaixa o snapshot do mês anterior na equipe atual (mesmos ids). */
export function previousFromSnapshot(
  snapshot: GeneratorSnapshot | null | undefined,
  people: SchedulePerson[],
  nextMonth: string,
): { previous: Record<string, unknown>; orderedPeople: SchedulePerson[] } | null {
  if (!snapshot || snapshot.version !== 1) return null;
  if (snapshot.month >= nextMonth) return null;
  const expectedNext = addMonths(`${snapshot.month}-01`, 1).slice(0, 7);
  if (expectedNext !== nextMonth) return null;
  if (!Array.isArray(snapshot.personIds) || snapshot.personIds.length !== people.length) return null;
  if (!snapshot.personIds.every((id) => people.some((person) => person.id === id))) return null;
  const orderedPeople = snapshot.personIds.map((id) => people.find((person) => person.id === id)!);
  return {
    orderedPeople,
    previous: {
      // Validação estrita do gerador exige nomes idênticos; ids já conferidos acima.
      carryOnly: true,
      month: snapshot.month,
      model: snapshot.model,
      employees: orderedPeople.map((person, index) => ({
        name: snapshot.employees[index]?.name || person.name?.trim() || "Pessoa",
        sex: person.sex === "man" ? "M" : "F",
      })),
      days: snapshot.days,
      matrix: snapshot.matrix,
      assignment: snapshot.assignment,
      startWeek: snapshot.startWeek,
      firstSpanish: snapshot.firstSpanish,
      open: snapshot.open,
      minimum: snapshot.minimum,
      holidays: snapshot.holidays,
      compDeadline: snapshot.compDeadline,
      // Compensatórias no mês seguinte já vêm em incomingComp / placeIncoming.
      compensation: (snapshot.compensation ?? []).filter((link) => link.day.startsWith(nextMonth)),
    },
  };
}

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

function holidayDeadline(rule: HolidayRule, _monthEnd?: string): string {
  // Prazo sempre a partir do mês do feriado — não do mês da grade aberta (FC no mês seguinte).
  const holidayMonthEnd = endOfMonth(`${rule.date.slice(0, 7)}-01`);
  if (rule.window === "7_days") return addDays(rule.date, 7);
  if (rule.window === "next_month") return endOfMonth(addMonths(holidayMonthEnd, 1));
  return holidayMonthEnd;
}

function markStatus(mark: string): DayStatus {
  if (mark === "F") return "off";
  if (mark === "FE") return "holiday_work";
  if (mark === "FC") return "comp_off";
  return "work";
}

function placeIncoming(days: GeneratedDay[], needs: DayNeed[] | undefined, rules: HolidayRule[], due: CompDue): boolean {
  const blocked = new Set(rules.map((rule) => rule.date));
  const tryCell = (cell: GeneratedDay | undefined): boolean => {
    if (!cell || cell.date > due.until) return false;
    if (cell.status !== "work" && cell.status !== "holiday_work") return false;
    if (blocked.has(cell.date)) return false;
    const row = needs?.find((item) => item.dow === weekday(cell.date));
    if (row && !row.open) return false;
    const min = row?.open ? row.min : 0;
    const working = days.filter((item) => item.date === cell.date && item.status !== "off" && item.status !== "comp_off").length;
    if (working - 1 < min) return false;
    cell.status = "comp_off";
    return true;
  };
  // Data já combinada no mês anterior (repasse ao sindicato): tenta nela primeiro.
  if (due.day) {
    const preferred = days.find((cell) => cell.personId === due.personId && cell.date === due.day);
    if (tryCell(preferred)) return true;
  }
  for (const cell of days) {
    if (cell.personId !== due.personId) continue;
    if (tryCell(cell)) return true;
  }
  return false;
}

/** Escolhe dias de trabalho no mês seguinte para FC com prazo “mês seguinte” (sem estender a grade do motor). */
function planNextMonthCompDays(input: {
  people: SchedulePerson[];
  days: GeneratedDay[];
  rules: HolidayRule[];
  dayNeeds: DayNeed[];
  monthEnd: string;
  skip: Set<string>;
}): CompDue[] {
  const dues: CompDue[] = [];
  const load = new Map<string, number>();
  for (const rule of input.rules) {
    if (rule.pay !== "extra_off" || rule.window !== "next_month" || !rule.open) continue;
    const until = holidayDeadline(rule, input.monthEnd);
    const from = addDays(input.monthEnd, 1);
    const workers = input.days
      .filter((row) => row.date === rule.date && row.status === "holiday_work")
      .map((row) => row.personId);
    let slot = 0;
    for (const personId of workers) {
      const key = `${personId}|${rule.date}`;
      if (input.skip.has(key)) continue;
      const day = pickNextMonthCompDay({ from, until, dayNeeds: input.dayNeeds, load, slot: slot++ });
      dues.push({ personId, holiday: rule.date, until, day });
      if (day) load.set(day, (load.get(day) ?? 0) + 1);
    }
  }
  return dues;
}

function pickNextMonthCompDay(input: {
  from: string;
  until: string;
  dayNeeds: DayNeed[];
  load: Map<string, number>;
  slot: number;
}): string | null {
  const candidates: string[] = [];
  for (let cursor = input.from; cursor <= input.until; cursor = addDays(cursor, 1)) {
    const need = input.dayNeeds.find((item) => item.dow === weekday(cursor));
    if (need && !need.open) continue;
    candidates.push(cursor);
  }
  if (candidates.length === 0) return null;
  // Espalha as FCs: menos gente no mesmo dia, depois o próximo slot livre.
  candidates.sort(
    (a, b) =>
      (input.load.get(a) ?? 0) - (input.load.get(b) ?? 0) ||
      (weekday(a) === 0 ? 1 : 0) - (weekday(b) === 0 ? 1 : 0) ||
      a.localeCompare(b),
  );
  const lightest = input.load.get(candidates[0]!) ?? 0;
  const pool = candidates.filter((date) => (input.load.get(date) ?? 0) === lightest);
  return pool[input.slot % pool.length] ?? pool[0] ?? null;
}

type EngineMonth = {
  ok: boolean;
  error?: string;
  days: string[];
  matrix: string[][];
  compensation?: { employee: number; holiday: string; day: string; deadline?: string }[];
  assignment?: { base: number; phase: number; workPhase?: number }[];
  config?: Record<string, unknown>;
  diagnostics?: EngineDiagnostic[];
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
  /** Snapshot do mês anterior (mesma equipe) — revezamento de domingo e dia-base. */
  previousSnapshot?: GeneratorSnapshot | null;
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
  const linked = previousFromSnapshot(input.previousSnapshot, input.people, month);
  const people = linked?.orderedPeople ?? input.people;
  const previousAssignment = linked?.previous?.assignment as
    | { base: number; phase: number; workPhase?: number }[]
    | undefined;
  const rules = (input.holidayRules ?? []).filter((rule) => rule.date.startsWith(month));
  const result = generate({
    month,
    regime: "before",
    model: input.pattern,
    previous: linked?.previous,
    employees: people.map((person, index) => {
      const fixedChosen = person.fixedOffDow == null ? -1 : generatorDow(person.fixedOffDow);
      // Sem folga fixa na tela: herda o dia-base do mês anterior (como continuar no gerador).
      const inherited =
        fixedChosen < 0 && previousAssignment?.[index] && Number.isInteger(previousAssignment[index].base)
          ? previousAssignment[index].base
          : -1;
      return {
        name: person.name?.trim() || "Pessoa",
        sex: person.sex === "man" ? "M" : "F",
        fixed: fixedChosen >= 0 ? fixedChosen : inherited,
      };
    }),
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
  if (!result.ok) {
    throw new ScheduleGenerateError(
      scheduleIssueFromEngine(result.diagnostics, result.error || "Não foi possível gerar a escala."),
    );
  }
  const plain = new Set(input.holidayDates);
  const knownHoliday = new Set(rules.map((rule) => rule.date));
  const days: GeneratedDay[] = [];
  const calendar: string[] = result.days;
  for (let person = 0; person < people.length; person++) {
    for (let index = 0; index < calendar.length; index++) {
      const date = calendar[index];
      if (date < from || date > to) continue;
      let status = markStatus(result.matrix[person][index]);
      if (status === "work" && plain.has(date) && !knownHoliday.has(date)) status = "holiday_work";
      days.push({ personId: people[person].id, date, status });
    }
  }
  const compDue: CompDue[] = [];
  const dueKey = (personId: string, holiday: string) => `${personId}|${holiday}`;
  const seenDue = new Set<string>();
  const pushDue = (due: CompDue) => {
    const key = dueKey(due.personId, due.holiday);
    if (seenDue.has(key)) return;
    seenDue.add(key);
    compDue.push(due);
  };
  for (const link of result.compensation ?? []) {
    if (link.day >= from && link.day <= to) continue;
    const person = people[link.employee];
    if (!person) continue;
    pushDue({ personId: person.id, holiday: link.holiday, until: link.deadline || monthEnd, day: link.day });
  }
  // "No mês seguinte": o motor não estende a grade (senão herda domingo/EC 141).
  // Escolhemos a data prevista aqui para o sindicato e para o mês seguinte.
  for (const due of planNextMonthCompDays({
    people,
    days,
    rules,
    dayNeeds: input.dayNeeds ?? defaultDayNeeds(),
    monthEnd,
    skip: seenDue,
  })) {
    pushDue(due);
  }
  for (const due of input.incomingComp ?? []) {
    if (!placeIncoming(days, input.dayNeeds, rules, due)) pushDue(due);
  }
  const cont = continuation(result) as Omit<GeneratorSnapshot, "version" | "personIds">;
  const snapshot: GeneratorSnapshot = {
    version: 1,
    personIds: people.map((person) => person.id),
    ...cont,
  };
  return { days, compDue, snapshot };
}

export type EditableDay = { sellerId: string; day: string; status: DayStatus; origin?: "generated" | "manual" };
export type CellChoice = "work" | "off" | "comp_off";
export type CompLink = { personId: string; holiday: string; day: string; deadline: string };

/** @deprecated Mantido para mensagens antigas; a edição de FC órfã não trava mais o select. */
export const PREVIOUS_MONTH_EDIT = "Este dia pertence à escala do mês anterior. Edite aquela escala para alterá-lo.";
export const COMP_OFF_BLOCKED = "Escolha um dia de trabalho para conceder a folga adicional pelo feriado. As folgas normais devem ser preservadas.";
export const COMP_OFF_CLEAR_HINT =
  "Esta folga compensatória não está ligada a um feriado nesta escala. Você pode trocar para Trabalhar ou Folgar; para remarcar a FC, use um dia de trabalho com feriado elegível.";

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

export type CompOffSummaryRow = {
  personId: string;
  personName: string;
  holidayDate: string;
  holidayName: string;
  /** Dia da FC, se já marcado. Null = ainda pendente (ex.: mês seguinte). */
  offDate: string | null;
  until: string;
};

/**
 * Folgas compensatórias do mês: FC já marcada (mesmo no mês seguinte, se vier em `allDays`)
 * e pendências de `compDue` (prazo “no mês seguinte”).
 */
export function buildCompOffSummary(input: {
  monthStart: string;
  monthDays: { sellerId: string; day: string; status: DayStatus }[];
  /** Dias carregados do filtro (pode incluir o mês seguinte já gerado). */
  allDays?: { sellerId: string; day: string; status: DayStatus }[];
  rules: HolidayRule[];
  compDue: CompDue[];
  people: { id: string; name: string }[];
}): CompOffSummaryRow[] {
  const monthEnd = endOfMonth(input.monthStart);
  const nameOf = new Map(input.people.map((person) => [person.id, person.name]));
  const pool = input.allDays ?? input.monthDays;
  const editable: EditableDay[] = pool.map((row) => ({
    sellerId: row.sellerId,
    day: row.day,
    status: row.status,
  }));
  const links = inferCompLinks(editable, input.rules, monthEnd);
  const usedPeopleHolidays = new Set(links.map((link) => `${link.personId}|${link.holiday}`));
  const rows: CompOffSummaryRow[] = [];

  for (const link of links) {
    const rule = input.rules.find((item) => item.date === link.holiday);
    if (!rule || !link.holiday.startsWith(input.monthStart.slice(0, 7))) continue;
    // Só entra se a pessoa trabalhou o feriado neste mês.
    if (!input.monthDays.some((row) => row.sellerId === link.personId && row.day === link.holiday && row.status === "holiday_work")) {
      continue;
    }
    rows.push({
      personId: link.personId,
      personName: nameOf.get(link.personId) || "Pessoa",
      holidayDate: link.holiday,
      holidayName: rule.name,
      offDate: link.day,
      until: link.deadline,
    });
  }

  for (const rule of input.rules) {
    if (!rule.open || rule.pay !== "extra_off" || !rule.date.startsWith(input.monthStart.slice(0, 7))) continue;
    const until = holidayDeadline(rule, monthEnd);
    const workers = input.monthDays
      .filter((row) => row.day === rule.date && row.status === "holiday_work")
      .map((row) => row.sellerId);
    for (const personId of workers) {
      if (usedPeopleHolidays.has(`${personId}|${rule.date}`)) continue;
      const due = input.compDue.find((item) => item.personId === personId && item.holiday === rule.date);
      // Sem FC na grade: usa a data prevista em compDue (ex.: mês seguinte) ou só o prazo.
      rows.push({
        personId,
        personName: nameOf.get(personId) || "Pessoa",
        holidayDate: rule.date,
        holidayName: rule.name,
        offDate: due?.day || null,
        until: due?.until || until,
      });
      usedPeopleHolidays.add(`${personId}|${rule.date}`);
    }
  }

  return rows.sort(
    (a, b) =>
      a.holidayDate.localeCompare(b.holidayDate) ||
      a.personName.localeCompare(b.personName, "pt-BR") ||
      (a.offDate || a.until).localeCompare(b.offDate || b.until),
  );
}

/** Liga cada folga pelo feriado ao feriado trabalhado, como a lista de compensação do gerador. */
export function inferCompLinks(days: EditableDay[], rules: HolidayRule[], monthEnd: string, compDue?: CompDue[]): CompLink[] {
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
  // Pendências gravadas (ex.: FC já no mês seguinte) fecham o vínculo mesmo se a inferência pela grade falhar.
  for (const due of compDue ?? []) {
    if (!due.day) continue;
    const key = `${due.personId}|${due.day}`;
    if (used.has(key)) continue;
    if (!days.some((row) => row.sellerId === due.personId && row.day === due.day && row.status === "comp_off")) continue;
    const rule = rules.find((item) => item.date === due.holiday && item.open && item.pay === "extra_off");
    if (!rule) continue;
    used.add(key);
    links.push({ personId: due.personId, holiday: due.holiday, day: due.day, deadline: due.until || holidayDeadline(rule, monthEnd) });
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
  compDue?: CompDue[];
}): { locked: boolean; orphanComp: boolean; fcEnabled: boolean; holidays: HolidayRule[] } {
  const row = input.days.find((item) => item.sellerId === input.personId && item.day === input.day);
  const links = inferCompLinks(input.days, input.rules, input.monthEnd, input.compDue);
  const linked = links.some((link) => link.personId === input.personId && link.day === input.day);
  // FC sem vínculo: não trava o select — dá para limpar (trabalhar/folgar) ou remarcar se houver feriado elegível.
  const orphanComp = row?.status === "comp_off" && !linked;
  const locked = false;
  const face = dayFace(input.rules, input.dayNeeds, input.day);
  const holidays = input.rules.filter((rule) => {
    if (rule.pay !== "extra_off" || !rule.open || rule.date >= input.day) return false;
    const worked = input.days.some((item) => item.sellerId === input.personId && item.day === rule.date && item.status === "holiday_work");
    return worked && input.day <= holidayDeadline(rule, input.monthEnd);
  });
  const choice = row ? cellChoice(row.status) : "work";
  const fcEnabled =
    input.pattern !== "12x36" && (choice === "work" || choice === "comp_off") && !face.holiday && !face.closed && holidays.length > 0;
  return { locked, orphanComp, fcEnabled, holidays };
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
  compDue?: CompDue[];
  choices: { personId: string; value: CellChoice; holiday: string | null }[];
}): { days: T[]; error: string | null } {
  let days = input.days.map((row) => ({ ...row }));
  let links = inferCompLinks(days, input.rules, input.monthEnd, input.compDue);
  for (const choice of input.choices) {
    const current = days.find((row) => row.sellerId === choice.personId && row.day === input.day);
    if (!current) continue;
    const linked = links.find((link) => link.personId === choice.personId && link.day === input.day);
    const same = cellChoice(current.status) === choice.value && (choice.value !== "comp_off" || linked?.holiday === choice.holiday);
    if (same) continue;
    const options = dayEditOptions({ ...input, days, personId: choice.personId });
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

