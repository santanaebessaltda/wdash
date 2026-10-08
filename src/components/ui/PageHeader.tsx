import type { ReactNode } from "react";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";

export interface PageHeaderProps {
  crumbs?: Crumb[];
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Avisos da tela: no celular entre o titulo e os filtros; no desktop abaixo do cabecalho. */
  notices?: ReactNode;
}

export function PageHeader({ crumbs, title, subtitle, actions, notices }: PageHeaderProps) {
  return (
    <div className="mb-4">
      {crumbs && (
        <div className="print:hidden">
          <Breadcrumbs items={crumbs} />
        </div>
      )}
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between print:mt-0">
        <div className="min-w-0 sm:flex-1">
          <h1 className="truncate text-xl font-extrabold text-t0 sm:text-[26px]">{title}</h1>
          {subtitle && <p className="mt-1 text-[13px] text-t1">{subtitle}</p>}
        </div>
        {actions && <div className="order-3 flex flex-wrap items-center justify-start gap-2 sm:order-2 sm:justify-end print:hidden">{actions}</div>}
        {notices && <div className="order-2 flex w-full flex-col gap-3 empty:hidden sm:order-3 print:hidden">{notices}</div>}
      </div>
    </div>
  );
}
