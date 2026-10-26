import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { usePagedRows } from "@/lib/usePagedRows";
import { StickyHeadTable } from "./StickyHeadTable";
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
  /** Parada no scroll horizontal. `rank` encosta na esquerda; `label` encosta na coluna de 48px. */
  pin?: "rank" | "label";
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
  /** Mesmo respiro da lista de pessoas do ranking (Dashboard > Equipe). */
  compact?: boolean;
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

const PIN_RANK = "sticky left-0 z-20 w-12 min-w-12 max-w-12 bg-bg-2";
const PIN_LABEL = "sticky left-12 z-10 min-w-0 bg-bg-2";
const PIN_CLIP = "min-w-0 max-w-[9.5rem] sm:max-w-[12.5rem] lg:max-w-[14rem] xl:max-w-none";

function pinClass(pin: DataTableColumn<unknown>["pin"]): string | undefined {
  if (pin === "rank") return PIN_RANK;
  if (pin === "label") return PIN_LABEL;
  return undefined;
}

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
  compact = false,
}: DataTableProps<T>) {
  const sortableCols = columns.filter((c) => c.sortable && c.sortValue);
  const [sortKey, setSortKey] = useState<string | undefined>(() =>
    defaultSortKey && sortableCols.some((c) => c.key === defaultSortKey) ? defaultSortKey : undefined,
  );
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir);

  // Se a coluna ativa sumiu (ex.: troca meta on/off), limpa o sort e volta a ordem original.
  const sortKeyActive = sortKey && sortableCols.some((c) => c.key === sortKey) ? sortKey : undefined;

  const sorted = useMemo(() => {
    if (!sortKeyActive) return data;
    const col = columns.find((c) => c.key === sortKeyActive);
    if (!col?.sortValue) return data;
    return [...data].sort((a, b) => compareSortValues(col.sortValue!(a), col.sortValue!(b), sortDir));
  }, [columns, data, sortKeyActive, sortDir]);

  const firstKey = sorted.length > 0 ? rowKey(sorted[0]!) : "";
  const paged = usePagedRows(sorted, `${sorted.length}|${firstKey}|${sortKeyActive}|${sortDir}`);
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

  const headClass = compact
    ? "px-1 pb-3 text-[11px] font-bold uppercase tracking-wide"
    : "px-4 py-3 text-[10.5px] font-bold uppercase tracking-wide";
  const cellClass = compact ? "px-1 py-3 align-middle" : "px-4 py-3.5 align-middle";
  const pinned = columns.some((col) => col.pin);
  const tableClass = cn(
    "w-full text-sm",
    compact ? "min-w-[720px]" : "min-w-[640px]",
    pinned
      ? "border-separate border-spacing-0 [&_tbody_td]:border-b [&_tbody_td]:border-line [&_tbody_tr:last-child_td]:border-b-0 [&_th]:border-b [&_th]:border-line"
      : "border-collapse",
  );
  const headerCells = columns.map((col) =>
    col.sortable && col.sortValue ? (
      <ThSort
        key={col.key}
        label={col.header}
        active={sortKeyActive === col.key}
        dir={sortDir}
        onClick={() => toggleSort(col.key)}
        align={col.align ?? "left"}
        width={col.width}
        className={cn(headClass, "bg-bg-2", pinClass(col.pin), col.hideBelow && hideBelowClasses[col.hideBelow])}
      />
    ) : (
      <th
        key={col.key}
        style={{ width: col.width }}
        className={cn(headClass, "bg-bg-2 text-t2", pinClass(col.pin), alignClasses[col.align ?? "left"], col.hideBelow && hideBelowClasses[col.hideBelow])}
      >
        {col.header}
      </th>
    ),
  );
  const bodyRows = rows.map((row) => (
    <tr
      key={rowKey(row)}
      onClick={onRowClick ? () => onRowClick(row) : undefined}
      className={cn(
        !pinned && "border-b border-line last:border-b-0",
        "transition-colors",
        (compact || onRowClick) && "hover:bg-bg-3",
        onRowClick && "cursor-pointer",
      )}
    >
      {columns.map((col) => (
        <td
          key={col.key}
          style={col.width ? { width: col.width, maxWidth: col.width } : undefined}
          className={cn(cellClass, "text-t0", pinClass(col.pin), alignClasses[col.align ?? "left"], col.hideBelow && hideBelowClasses[col.hideBelow])}
        >
          {col.pin === "label" ? <div className={PIN_CLIP}>{col.render(row)}</div> : col.render(row)}
        </td>
      ))}
    </tr>
  ));

  return (
    <div className={cn(compact ? "min-w-0" : "min-w-0 overflow-hidden rounded-[var(--radius-vela-lg)] border border-line bg-bg-2", className)}>
      {pinned ? (
        <StickyHeadTable
          tableClassName={tableClass}
          headClassName="text-t2"
          minWidth={compact ? 720 : 640}
          syncKey={`${rows.length}|${sortKeyActive}|${sortDir}|${firstKey}`}
          head={headerCells}
        >
          {bodyRows}
        </StickyHeadTable>
      ) : (
      <div className={compact ? "min-w-0 overflow-x-auto" : "min-w-0 overflow-x-auto"}>
      <table className={tableClass}>
        <thead>
          <tr className="border-b border-line text-t2">{headerCells}</tr>
        </thead>
        <tbody>{bodyRows}</tbody>
      </table>
      </div>
      )}
      {showPager && (
        <div className={cn("flex flex-wrap items-center justify-between gap-3", compact ? "mt-4" : "border-t border-line px-4 py-3.5")}>
          <span className="text-[12.5px] text-t2">
            Mostrando {paged.pageRows.length} de {paged.total} {paginate}
          </span>
          <Pagination page={paged.page} totalPages={paged.totalPages} onChange={paged.setPage} />
        </div>
      )}
    </div>
  );
}
