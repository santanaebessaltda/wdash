import type { StockProductRow, StockStatus } from "@/data/wedash/stockProducts";
import { stockCostAmount } from "@/data/wedash/stockProducts";
import type { XlsxCell } from "@/lib/xlsx";
import { buildXlsx } from "@/lib/xlsx";
import { localQty, qty } from "./shared";

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  negative: "Negativo",
  awaiting: "Aguardando transferência",
  ok: "Regular",
};

/** Caixa normal, só a primeira letra maiúscula: "PONTO DE VENDA" → "Ponto de venda". */
export function headerCase(value: string): string {
  const text = value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  if (!text) return "";
  return text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);
}

/** Instrucao de transferencia, a mesma que o papel escreve sob o status. */
export function stockTransferNote(r: StockProductRow, multipleStores: boolean): string {
  return r.storeRows
    .flatMap((l) =>
      l.transferencias.map((t) => {
        const action = `transferir ${qty(t.qty)} de ${t.from} para ${t.to}.`;
        return multipleStores ? `${l.store.tradeName}: ${action}` : action.charAt(0).toUpperCase() + action.slice(1);
      }),
    )
    .join("\n");
}

function reais(v: number): number {
  return Math.round(v * 100) / 100;
}

function moneyCell(v: number | null): XlsxCell {
  return v == null ? "" : reais(v);
}

/** Planilha da lista filtrada: todas as linhas, nao so a pagina. Um local so nao ganha coluna Total. */
export function inventoryXlsxRows(lines: Array<{ r: StockProductRow; status: StockStatus }>, locations: string[]): XlsxCell[][] {
  const showsTotal = locations.length !== 1;
  const header: XlsxCell[] = [
    "Código",
    "Produto",
    "Categoria",
    ...locations.map(headerCase),
    ...(showsTotal ? ["Total"] : []),
    "A receber",
    "Total geral",
    "Preço de custo",
    "Valor",
    "Status",
  ];
  const body = lines.map(({ r, status }) => {
    const cost = stockCostAmount(r);
    const unit: XlsxCell = cost.amount != null && cost.unit == null ? "Varia" : moneyCell(cost.unit);
    return [
      r.code,
      r.name,
      r.category,
      ...locations.map((name) => localQty(r, name)),
      ...(showsTotal ? [r.stock] : []),
      r.aReceive ?? "",
      r.totalGeral ?? "",
      unit,
      moneyCell(cost.amount),
      STOCK_STATUS_LABEL[status],
    ];
  });
  if (lines.length === 0) return [header];
  const receive = lines.every(({ r }) => r.aReceive == null) ? "" : lines.reduce((s, { r }) => s + (r.aReceive ?? 0), 0);
  const totalGeral = lines.every(({ r }) => r.totalGeral == null) ? "" : lines.reduce((s, { r }) => s + (r.totalGeral ?? 0), 0);
  const amounts = lines.map(({ r }) => stockCostAmount(r).amount);
  const amount = amounts.some((v) => v != null) ? reais(amounts.reduce<number>((s, v) => s + (v ?? 0), 0)) : "";
  const total: XlsxCell[] = [
    "",
    "Total do filtro",
    "",
    ...locations.map((name) => lines.reduce((s, { r }) => s + localQty(r, name), 0)),
    ...(showsTotal ? [lines.reduce((s, { r }) => s + r.stock, 0)] : []),
    receive,
    totalGeral,
    "",
    amount,
    "",
  ];
  return [header, ...body, total];
}

export function downloadInventoryXlsx(
  lines: Array<{ r: StockProductRow; status: StockStatus }>,
  locations: string[],
  fileName: string,
) {
  const rows = inventoryXlsxRows(lines, locations);
  const textColumns = [0, 1, 2, rows[0].length - 1];
  const bytes = buildXlsx(rows, { textColumns, sheetName: "Estoque" });
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
