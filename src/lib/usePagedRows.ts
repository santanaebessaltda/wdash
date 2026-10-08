import { useEffect, useState } from "react";
import { usePrintMode } from "@/lib/printMode";

/** Padrao das tabelas da WDash: 10 linhas por pagina (desktop e celular). */
export const TABLE_PAGE_SIZE = 10;

/**
 * Pagina `rows` no padrao da WDash. Volta para a pagina 1 quando `resetKey` muda
 * (filtro, busca, ordenacao).
 */
export function usePagedRows<T>(rows: T[], resetKey?: string | number) {
  const printing = usePrintMode();
  const pageSize = printing ? Math.max(1, rows.length) : TABLE_PAGE_SIZE;
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, totalPages);
  const pageRows = rows.slice((current - 1) * pageSize, current * pageSize);
  return { page: current, setPage, totalPages, pageRows, pageSize, total: rows.length };
}
