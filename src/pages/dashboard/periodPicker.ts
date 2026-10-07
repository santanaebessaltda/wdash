import { deIso, fimDoMes } from "@/lib/format";
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
export function dateRangeFromPeriod(periodo: Period): DateRange {
  const r = resolvePeriod(periodo, calendarTodayIso());
  return [deIso(r.inicio), deIso(r.fim)];
}

/**
 * Janela da listagem Gestao > Metas / Desafios.
 * No Dashboard, "Este mes" = mes ate hoje (vendas). Aqui o mes vai ate o ultimo dia,
 * senao desafio/meta que ainda vai comecar some da lista. Personalizado tambem pode
 * apontar para o futuro (o calendario dessas telas permite).
 */
export function managementScheduleWindow(periodo: Period, hojeIso: string = calendarTodayIso()): { from: string; to: string } {
  if (periodo.tipo === "esteMes") {
    const r = resolvePeriod(periodo, hojeIso);
    return { from: r.inicio, to: fimDoMes(r.inicio) };
  }
  if (periodo.tipo === "personalizado" && periodo.inicio && periodo.fim) {
    const from = periodo.inicio;
    const to = periodo.fim;
    return from > to ? { from: to, to } : { from, to };
  }
  const r = resolvePeriod(periodo, hojeIso);
  return { from: r.inicio, to: r.fim };
}

/** Range do DateRangePicker nas listagens de Metas/Desafios (respeita fim futuro). */
export function dateRangeFromManagementPeriod(periodo: Period): DateRange {
  if (periodo.tipo === "personalizado" && periodo.inicio && periodo.fim) {
    return [deIso(periodo.inicio), deIso(periodo.fim)];
  }
  return dateRangeFromPeriod(periodo);
}

/** Rotulo do input: nome do preset; personalizado  ->  null (mostra o range). */
export function periodDisplayLabel(periodo: Period): string | null {
  if (periodo.tipo === "personalizado") return null;
  return periodLabels[periodo.tipo];
}

export function periodActivePresetId(periodo: Period): PeriodType | null {
  if (periodo.tipo === "personalizado") return null;
  return periodo.tipo;
}

function toIsoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Aplica clique no pill (preset) ou range manual no calendario. */
export function applyPeriodDateChange(
  escopo: Scope,
  range: DateRange,
  meta?: DateRangeChangeMeta,
): Scope {
  if (meta?.presetId) {
    return { ...escopo, periodo: { tipo: meta.presetId } };
  }
  return {
    ...escopo,
    periodo: {
      tipo: "personalizado",
      inicio: toIsoLocal(range[0]),
      fim: toIsoLocal(range[1]),
    },
  };
}
