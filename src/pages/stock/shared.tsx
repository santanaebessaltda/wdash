import type { ReactNode } from "react";
import { Button, Pagination } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { STOCK_SALES_LOCATION, type StockProductRow } from "@/data/wedash/stockProducts";
import { brlCent, num } from "@/lib/format";

export const TipHelp = ({ label }: { label: string }) => (
  <Tooltip label={label}>
    <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 transition-colors hover:text-t1 print:hidden">
      ?
    </span>
  </Tooltip>
);

export const money = (v: number | null) => (v == null ? "—" : brlCent(v));
export const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1).replace(".", ",")}%`);
export const pctRate = (v: number) => `${num(v, v % 1 === 0 ? 0 : 2)}%`;
export const qty = (v: number) => num(v, v % 1 === 0 ? 0 : 3);

/** Saldo do produto num local de estoque, somando as lojas do filtro. */
export function localQty(r: StockProductRow, nome: string): number {
  return r.lojas.reduce((s, l) => s + (l.locais.find((x) => x.nome === nome)?.qtd ?? 0), 0);
}

/** Locais de estoque com saldo em algum produto, na ordem da hierarquia: Estoque, os demais em ordem alfabetica, Ponto de venda. */
export function stockLocations(rows: StockProductRow[]): string[] {
  const nomes = new Set<string>();
  for (const r of rows) for (const l of r.lojas) for (const x of l.locais) nomes.add(x.nome);
  const ordem = (n: string) => (n === "ESTOQUE" ? 0 : n === STOCK_SALES_LOCATION ? 2 : 1);
  return [...nomes].sort((a, b) => ordem(a) - ordem(b) || a.localeCompare(b, "pt-BR"));
}

export function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="primary" size="md" onClick={onClick}>
      Exportar
    </Button>
  );
}

/** "Mostrando X de Y produtos" + paginacao, abaixo da tabela (padrao Data Tables). */
export function TableFooter({ shown, total, page, totalPages, onPage }: { shown: number; total: number; page: number; totalPages: number; onPage: (p: number) => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
      <span className="text-[12.5px] text-t2">
        Mostrando {shown} de {num(total)} produtos
      </span>
      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onChange={onPage} />}
    </div>
  );
}

/** Filtros do cabecalho no padrao da Visao geral: um abaixo do outro no celular, em linha no desktop. O horario da ultima busca fica no botao Atualizar. */
export function HeaderFilters({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-2 sm:items-end">
      <div className="flex w-full min-w-0 flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">{children}</div>
    </div>
  );
}
