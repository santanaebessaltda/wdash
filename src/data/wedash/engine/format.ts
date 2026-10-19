/** Formatacao pt-BR e datas usadas pela conta da meta (sem dependencias fora do motor). */

const brlCentavos = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** R$ 84.210,37  -  com centavos, para conferencia. */
export function brlCent(v: number): string {
  return brlCentavos.format(v);
}

/** Nome de vendedor (equipe vinda do Millennium): caixa alta nas listas. A saudacao usa o primeiro nome em Title Case. */
export function collaboratorName(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
}

/** Nome do turno: caixa alta (gravado e exibido). */
export function shiftName(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
}

/** 2,3  |  184,5  -  numero com casas decimais em pt-BR. */
export function num(v: number, casas = 0): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Converte "2026-09-15" em Date local (meia-noite), sem armadilha de fuso. */
export function isoToDate(iso: string): Date {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d);
}

/** Converte Date em "2026-09-15" no fuso local. */
export function dateToIso(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Adiciona dias a um ISO. */
export function addDays(iso: string, days: number): string {
  const d = isoToDate(iso);
  d.setDate(d.getDate() + days);
  return dateToIso(d);
}

/** Primeiro dia do mes do ISO. */
export function startOfMonth(iso: string): string {
  const d = isoToDate(iso);
  return dateToIso(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** Ultimo dia do mes do ISO. */
export function endOfMonth(iso: string): string {
  const d = isoToDate(iso);
  return dateToIso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** Primeiro dia do mes deslocado. delta negativo volta no calendario. */
export function addMonths(iso: string, delta: number): string {
  const d = isoToDate(startOfMonth(iso));
  return dateToIso(new Date(d.getFullYear(), d.getMonth() + delta, 1));
}

/** Lista de ISOs entre inicio e fim, inclusive. */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  let current = start;
  while (current <= end) {
    out.push(current);
    current = addDays(current, 1);
  }
  return out;
}
