import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { usePagedRows } from "@/lib/usePagedRows";
import { Pagination } from "./Pagination";
import { ThSort, type SortDir } from "./ThSort";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Hide this column below the given breakpoint to keep mobile tables scannable. */
  hideBelow?: "sm" | "md" | "lg";
  align?: "left" | "right" | "center";
  width?: string;
  /** Clique no titulo ordena pela coluna. */
  sortable?: boolean;
  /** Valor usado na comparacao; obrigatorio quando `sortable`. */
  sortValue?: (row: T) => string | number | null | undefined;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  emptyMessage?: string;
  /** Substitui o `emptyMessage` (ex.: `EmptyState` com acao). */
  empty?: ReactNode;
  className?: string;
  /** Coluna inicial ativa (precisa ser `sortable`). */
  defaultSortKey?: string;
  defaultSortDir?: SortDir;
  /**
   * Pagina no padrao da WDash (10 por pagina no desktop, 5 no celular) e mostra
   * "Mostrando X de Y {paginate}" + paginacao quando ha mais de uma pagina. Ex.: `paginate="produtos"`.
   */
  paginate?: string;
}

const hideBelowClasses: Record<NonNullable<DataTableColumn<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

const alignClasses = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

function compareSortValues(a: string | number | null | undefined, b: string | number | null | undefined, dir: SortDir): number {
  const mul = dir === "asc" ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "string" || typeof b === "string") {
    return String(a).localeCompare(String(b), "pt-BR", { sensitivity: "base", numeric: true }) * mul;
  }
  return (a - b) * mul;
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  emptyMessage = "No records found.",
  empty,
  className,
  defaultSortKey,
  defaultSortDir = "desc",
  paginate,
}: DataTableProps<T>) {
  const sortableCols = columns.filter((c) => c.sortable && c.sortValue);
  const [sortKey, setSortKey] = useState<string | undefined>(() =>
    defaultSortKey && sortableCols.some((c) => c.key === defaultSortKey) ? defaultSortKey : undefined,
  );
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir);

  // Se a coluna ativa sumiu (ex.: troca meta on/off), limpa o sort e volta a ordem original.
  const sortKeyAtivo = sortKey && sortableCols.some((c) => c.key === sortKey) ? sortKey : undefined;

  const sorted = useMemo(() => {
    if (!sortKeyAtivo) return data;
    const col = columns.find((c) => c.key === sortKeyAtivo);
    if (!col?.sortValue) return data;
    return [...data].sort((a, b) => compareSortValues(col.sortValue!(a), col.sortValue!(b), sortDir));
  }, [columns, data, sortKeyAtivo, sortDir]);

  const firstKey = sorted.length > 0 ? rowKey(sorted[0]!) : "";
  const paged = usePagedRows(sorted, `${sorted.length}|${firstKey}|${sortKeyAtivo}|${sortDir}`);
  const rows = paginate ? paged.pageRows : sorted;
  const showPager = Boolean(paginate) && paged.totalPages > 1;

  function toggleSort(key: string) {
    const col = columns.find((c) => c.key === key);
    if (!col?.sortable || !col.sortValue) return;
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Texto  ->  asc; numero  ->  desc (padrao do Desempenho por produto).
      const sample = data.length > 0 ? col.sortValue(data[0]) : null;
      setSortDir(typeof sample === "string" ? "asc" : "desc");
    }
  }

  if (data.length === 0) {
    if (empty) return <>{empty}</>;
    return <div className="rounded-[var(--radius-vela-lg)] border border-line bg-bg-2 p-10 text-center text-sm text-t1">{emptyMessage}</div>;
  }

  return (
    <div className={cn("overflow-hidden rounded-[var(--radius-vela-lg)] border border-line bg-bg-2", className)}>
      <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            {columns.map((col) =>
              col.sortable && col.sortValue ? (
                <ThSort
                  key={col.key}
                  label={col.header}
                  active={sortKeyAtivo === col.key}
                  dir={sortDir}
                  onClick={() => toggleSort(col.key)}
                  align={col.align ?? "left"}
                  className={cn(
                    "px-4 py-3 text-[10.5px] font-bold uppercase tracking-wide",
                    col.hideBelow && hideBelowClasses[col.hideBelow],
                  )}
                />
              ) : (
                <th
                  key={col.key}
                  style={{ width: col.width }}
                  className={cn(
                    "px-4 py-3 text-[10.5px] font-bold uppercase tracking-wide text-t2",
                    alignClasses[col.align ?? "left"],
                    col.hideBelow && hideBelowClasses[col.hideBelow],
                  )}
                >
                  {col.header}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn("border-b border-line last:border-b-0 transition-colors", onRowClick && "cursor-pointer hover:bg-bg-3")}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn("px-4 py-3.5 text-t0 align-middle", alignClasses[col.align ?? "left"], col.hideBelow && hideBelowClasses[col.hideBelow])}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {showPager && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3.5">
          <span className="text-[12.5px] text-t2">
            Mostrando {paged.pageRows.length} de {paged.total} {paginate}
          </span>
          <Pagination page={paged.page} totalPages={paged.totalPages} onChange={paged.setPage} />
        </div>
      )}
    </div>
  );
}
