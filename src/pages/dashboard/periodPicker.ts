import { isoToDate, endOfMonth } from "@/lib/format";
import { calendarTodayIso } from "@/data/wedash/clock";
import {
  periodLabels,
  resolvePeriod,
  type Period,
  type PeriodType,
  type Scope,
} from "@/data/wedash/dashboard";
import type { DateRange, DateRangeChangeMeta } from "@/components/ui/DateRangePicker";

/** Intervalo Date a partir do escopo (presets + personalizado).
 *  Usa o dia civil real das lojas  -  nao o TODAY_ISO congelado do mock. */
export function dateRangeFromPeriod(period: Period): DateRange {
  const r = resolvePeriod(period, calendarTodayIso());
  return [isoToDate(r.start), isoToDate(r.end)];
}

/**
 * Janela da listagem Gestao > Metas / Desafios.
 * No Dashboard, "Este mes" = mes ate hoje (vendas). Aqui o mes vai ate o ultimo dia,
 * senao desafio/meta que ainda vai comecar some da lista. Personalizado tambem pode
 * apontar para o futuro (o calendario dessas telas permite).
 */
export function managementScheduleWindow(period: Period, todayIso: string = calendarTodayIso()): { from: string; to: string } {
  if (period.kind === "thisMonth") {
    const r = resolvePeriod(period, todayIso);
    return { from: r.start, to: endOfMonth(r.start) };
  }
  if (period.kind === "custom" && period.start && period.end) {
    const from = period.start;
    const to = period.end;
    return from > to ? { from: to, to } : { from, to };
  }
  const r = resolvePeriod(period, todayIso);
  return { from: r.start, to: r.end };
}

/** Range do DateRangePicker nas listagens de Metas/Desafios (respeita fim futuro). */
export function dateRangeFromManagementPeriod(period: Period): DateRange {
  if (period.kind === "custom" && period.start && period.end) {
    return [isoToDate(period.start), isoToDate(period.end)];
  }
  return dateRangeFromPeriod(period);
}

/** Rotulo do input: nome do preset; personalizado  ->  null (mostra o range). */
export function periodDisplayLabel(period: Period): string | null {
  if (period.kind === "custom") return null;
  return periodLabels[period.kind];
}

export function periodActivePresetId(period: Period): PeriodType | null {
  if (period.kind === "custom") return null;
  return period.kind;
}

function toIsoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Aplica clique no pill (preset) ou range manual no calendario. */
export function applyPeriodDateChange(
  scope: Scope,
  range: DateRange,
  goal?: DateRangeChangeMeta,
): Scope {
  if (goal?.presetId) {
    return { ...scope, period: { kind: goal.presetId } };
  }
  return {
    ...scope,
    period: {
      kind: "custom",
      start: toIsoLocal(range[0]),
      end: toIsoLocal(range[1]),
    },
  };
}
