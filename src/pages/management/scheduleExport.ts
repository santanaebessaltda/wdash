import type { DayStatus } from "@/data/wedash/scheduleGenerate";
import type { XlsxCell } from "@/lib/xlsx";
import { buildXlsx } from "@/lib/xlsx";

export type ScheduleExportPerson = {
  id: string;
  name: string;
  role: string;
  group: string;
};

export type ScheduleExportCard = {
  storeName: string;
  monthLabel: string;
  pattern: string;
  people: ScheduleExportPerson[];
  /** Dias civis do mês do card (sem vizinhos). */
  dates: string[];
  days: Array<{ sellerId: string; day: string; status: DayStatus; doublePay?: boolean }>;
};

/** Sigla da grade: T · F · FE · FC · FE 2x. */
export function statusLetter(status: DayStatus, doublePay = false): string {
  if (status === "holiday_work" && doublePay) return "FE 2x";
  if (status === "holiday_work") return "FE";
  if (status === "comp_off") return "FC";
  if (status === "off") return "F";
  return "T";
}

function dayHeader(iso: string, multiMonth: boolean): string {
  const day = iso.slice(8);
  if (!multiMonth) return day;
  return `${day}/${iso.slice(5, 7)}`;
}

/** Uma linha por pessoa × card; colunas = dias do período (união). */
export function scheduleXlsxRows(cards: ScheduleExportCard[]): XlsxCell[][] {
  const allDates = [...new Set(cards.flatMap((card) => card.dates))].sort();
  const multiMonth = new Set(allDates.map((iso) => iso.slice(0, 7))).size > 1;
  const header: XlsxCell[] = [
    "Filial",
    "Escala",
    "Mês",
    "Pessoa",
    "Cargo",
    "Grupo",
    ...allDates.map((iso) => dayHeader(iso, multiMonth)),
  ];
  if (cards.length === 0) return [header];

  const body: XlsxCell[][] = [];
  for (const card of cards) {
    const byKey = new Map(card.days.map((row) => [`${row.sellerId}|${row.day}`, row]));
    const dateSet = new Set(card.dates);
    for (const person of card.people) {
      body.push([
        card.storeName,
        `ESCALA ${card.pattern.toLocaleUpperCase("pt-BR")}`,
        card.monthLabel,
        person.name,
        person.role,
        person.group,
        ...allDates.map((iso) => {
          if (!dateSet.has(iso)) return "";
          const row = byKey.get(`${person.id}|${iso}`);
          return row ? statusLetter(row.status, row.doublePay === true) : "";
        }),
      ]);
    }
  }
  return [header, ...body];
}

export function downloadScheduleXlsx(cards: ScheduleExportCard[], fileName: string) {
  const rows = scheduleXlsxRows(cards);
  const textColumns = rows[0]?.map((_, index) => index) ?? [];
  const bytes = buildXlsx(rows, { textColumns, sheetName: "Escala" });
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const safe = fileName.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safe.endsWith(".xlsx") ? safe : `${safe}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
