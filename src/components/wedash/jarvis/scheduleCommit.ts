import { endOfMonth } from "@/data/wedash/engine/format";
import {
  defaultDayNeeds,
  generateMonth,
  issueFromUnknown,
  type ScheduleGenerateIssue,
} from "@/data/wedash/scheduleGenerate";
import { fetchCompDue, fetchPreviousSnapshot, saveSchedule } from "@/data/wedash/scheduleRepo";
import {
  missingScheduleLabels,
  scheduleDraftReady,
  validateScheduleDraft,
  type ScheduleDraftForm,
} from "./scheduleDraft";

export type ScheduleCommitResult =
  | { ok: true; monthStart: string; people: number; keptManualDays: number }
  | { ok: false; reason: string; issue?: ScheduleGenerateIssue };

/** Gera e grava a escala do mês após autorização do Gestor. */
export async function commitSchedule(
  tenantId: string,
  form: ScheduleDraftForm,
): Promise<ScheduleCommitResult> {
  const errors = validateScheduleDraft(form);
  if (Object.keys(errors).length > 0) {
    return { ok: false, reason: `Ainda falta ${missingScheduleLabels(errors).join(", ")} antes de gravar.` };
  }
  const monthStart = form.monthStart!;
  const monthEnd = endOfMonth(monthStart);
  const [year, monthNumber] = monthStart.split("-").map(Number);
  const people = form.people.map((person) => ({
    id: person.id,
    name: person.name,
    fixedOffDow: null as number | null,
    sex: person.sex,
    groupId: null as string | null,
  }));

  try {
    const [incoming, previousSnapshot] = await Promise.all([
      fetchCompDue(form.storeId, monthStart),
      fetchPreviousSnapshot(form.storeId, monthStart),
    ]);
    const generated = generateMonth({
      year: year!,
      month: monthNumber!,
      from: monthStart,
      to: monthEnd,
      pattern: form.pattern,
      offMode: "rotating",
      sundayMin: form.sundayMin,
      womenSunday: "every_2",
      menSunday: "every_3",
      people,
      holidayDates: [],
      dayNeeds: defaultDayNeeds(),
      groupNeeds: [],
      holidayRules: form.holidayRules,
      incomingComp: incoming,
      previousSnapshot,
    });

    const saved = await saveSchedule({
      tenantId,
      storeId: form.storeId,
      monthStart,
      pattern: form.pattern,
      offMode: "rotating",
      sundayMin: form.sundayMin,
      extraHolidays: [],
      womenSunday: "every_2",
      menSunday: "every_3",
      dayNeeds: defaultDayNeeds(),
      groupNeeds: [],
      holidayRules: form.holidayRules,
      compDue: generated.compDue,
      generatorSnapshot: generated.snapshot,
      people: people.map((person) => ({
        sellerId: person.id,
        fixedOffDow: person.fixedOffDow,
        sex: person.sex,
      })),
      days: generated.days.map((row) => ({
        sellerId: row.personId,
        day: row.date,
        status: row.status,
      })),
      keepManual: !form.replaceManual,
      rangeStart: monthStart,
      rangeEnd: monthEnd,
    });

    return {
      ok: true,
      monthStart,
      people: people.length,
      keptManualDays: saved.keptManualDays,
    };
  } catch (caught) {
    const issue = issueFromUnknown(caught);
    return { ok: false, reason: issue.explanation || issue.title, issue };
  }
}

export { scheduleDraftReady };
