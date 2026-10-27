/** Formatacao pt-BR usada em todas as telas do produto. */

import { isoToDate, eachDay, num, brlCent } from "../data/wedash/engine/format.ts";

export {
  brlCent,
  collaboratorName,
  isoToDate,
  endOfMonth,
  startOfMonth,
  eachDay,
  num,
  dateToIso,
  shiftName,
  addDays,
} from "../data/wedash/engine/format.ts";

const brlInteger = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Lucro bruto na tabela: +R$ quando positivo. Negativo ja vem com o sinal do R$. Sem custo = "—". */
export function profitBrl(v: number | null | undefined): string {
  if (v == null) return "—";
  return v > 0 ? `+${brlCent(v)}` : brlCent(v);
}

/** R$ 84.210  -  sem centavos, para paineis. */
export function brl(v: number): string {
  return brlInteger.format(v);
}

/** R$ 1,2K  |  R$ 84K  |  R$ 1,2M  -  compacto para cards e graficos. */
export function brlK(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
  if (abs >= 1_000) return `R$ ${(v / 1_000).toLocaleString("pt-BR", { minimumFractionDigits: abs >= 10_000 ? 0 : 1, maximumFractionDigits: abs >= 10_000 ? 0 : 1 })}K`;
  return brlInteger.format(v);
}

/** LOJA / CATEGORIA / PRODUTO  -  rotulos de catalogo em caixa alta (pt-BR). */
export function labelUpper(s: string): string {
  return s.trim().toLocaleUpperCase("pt-BR");
}

const NAME_PARTICLES = new Set(["de", "da", "do", "das", "dos", "e"]);

/** Nome da empresa (tenant): caixa alta, igual ao nome das lojas vindo do ERP. */
export function companyNameCase(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
}

/**
 * Nome de pessoa: primeira letra de cada palavra maiuscula ("Ana Paula de Souza").
 * Particulas (de, da, do, das, dos, e) ficam minusculas fora do inicio. Espelho SQL na migration
 * `20260926170000_title_case_names` e em `supabase/functions/_shared/text.ts`.
 */
export function titleName(s: string | null | undefined): string {
  const words = (s ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR").split(" ");
  return words
    .map((w, i) =>
      i > 0 && NAME_PARTICLES.has(w)
        ? w
        : w.replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, sep: string, l: string) => sep + l.toLocaleUpperCase("pt-BR")),
    )
    .join(" ");
}

/**
 * Nome de produto / categoria / tabela vindo do ERP em Title Case ("DESOD COL VF GOLDEN 100ML"  -> 
 * "Desod Col VF Golden 100ml"). Sigla sem vogal (VF, WP, FPS) fica em maiusculas.
 */
export function labelCase(s: string | null | undefined): string {
  const raw = (s ?? "").trim().replace(/\s+/g, " ").split(" ");
  const cased = titleName(raw.join(" ")).split(" ");
  return cased
    .map((w, i) => (/^[\p{L}]{2,4}$/u.test(raw[i]!) && !/[aeiouyáéíóúâêôãõàü]/iu.test(raw[i]!) ? raw[i]!.toLocaleUpperCase("pt-BR") : w))
    .join(" ");
}

/** 48%  |  48,3% */
export function pct(v: number, casas = 0): string {
  return `${num(v, casas)}%`;
}

/** +12%  |  8%  -  sinal explicito para variacoes. */
export function delta(v: number, casas = 0): string {
  const sinal = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sinal}${num(Math.abs(v), casas)}%`;
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SHORT_MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DAYS_WEEK = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const DAYS_WEEK_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** 15/09 */
export function shortDate(iso: string): string {
  const d = isoToDate(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 15/09/2026 */
export function fullDate(iso: string): string {
  return `${shortDate(iso)}/${isoToDate(iso).getFullYear()}`;
}

/** terca, 15 de setembro */
export function longDate(iso: string): string {
  const d = isoToDate(iso);
  return `${DAYS_WEEK[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

/** setembro de 2026 */
export function monthYear(iso: string): string {
  const d = isoToDate(iso);
  return `${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
}

/** Setembro 2026 (para nome de meta) */
export function monthYearTitle(iso: string): string {
  const d = isoToDate(iso);
  const m = MONTHS[d.getMonth()];
  return `${m.charAt(0).toUpperCase()}${m.slice(1)} ${d.getFullYear()}`;
}

/** set */
export function shortMonth(iso: string): string {
  return SHORT_MONTHS[isoToDate(iso).getMonth()];
}

/** ter */
export function shortWeekday(iso: string): string {
  return DAYS_WEEK_CURTO[isoToDate(iso).getDay()];
}

/** Eixo com um ponto por dia. Mes cheio ou mais de 7 dias no mesmo mes: "01". Cruza meses: "01/10". Semana: "seg". */
export function dayAxisLabel(
  iso: string,
  period: { start: string; end: string; granularity: "day" | "month" | "period" },
): string {
  if (period.start.slice(0, 7) !== period.end.slice(0, 7)) return shortDate(iso);
  const days = eachDay(period.start, period.end).length;
  if (period.granularity === "month" || days > 7) return String(isoToDate(iso).getDate()).padStart(2, "0");
  return shortWeekday(iso);
}

/** Detalhe do ponto diario: "11/10 seg". */
export function dayPointDetail(iso: string): string {
  return `${shortDate(iso)} ${shortWeekday(iso)}`;
}

/** 14:32 */
export function clockTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 14h */
export function shortHour(h: number): string {
  return `${h}h`;
}

/** Faixa de 1 hora para tooltip: "21h as 22h"; hora em andamento = "14h ate agora". */
export function hourSpan(h: number, emProgress = false): string {
  return emProgress ? `${h}h até agora` : `${h}h às ${h + 1}h`;
}

/** Tooltip de delta: "Em relacao ao mes passado." / "Em relacao aos 7 dias anteriores." */
export function comparedWithTip(vs: string): string {
  if (vs.startsWith("os ")) return `Em relação aos ${vs.slice(3)}.`;
  if (vs.startsWith("o ")) return `Em relação ao ${vs.slice(2)}.`;
  if (vs.startsWith("a ")) return `Em relação à ${vs.slice(2)}.`;
  return `Em relação a ${vs}.`;
}

/** Tooltip do badge de delta com o valor comparado: "Em relacao ao mes passado: R$ 12.345,67." */
export function deltaTip(delta: { vs?: string; previous?: string }, metric?: string): string {
  if (!delta.vs) {
    if (metric) return `${metric} no período anterior${delta.previous ? `: ${delta.previous}` : ""}.`;
    return delta.previous ? `Período anterior: ${delta.previous}.` : "";
  }
  const base = comparedWithTip(delta.vs);
  const tip = delta.previous ? `${base.slice(0, -1)}: ${delta.previous}.` : base;
  return metric ? `${metric} ${tip.charAt(0).toLowerCase()}${tip.slice(1)}` : tip;
}

/** `1 dia` / `N dias`  -  prazos e badges. */
export function dayCountLabel(n: number): string {
  return n === 1 ? "1 dia" : `${n} dias`;
}

/** Dias que contam para a pessoa: "31 dias de meta", "1 dia de desafio". */
export function presenceDayLabel(days: number, kind: "meta" | "desafio"): string {
  return `${dayCountLabel(days)} de ${kind}`;
}
