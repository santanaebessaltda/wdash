import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SortDir = "asc" | "desc";

export function ThSort({
  label,
  active,
  dir,
  onClick,
  align = "right",
  className,
  aside,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "left" | "right" | "center";
  /** Substitui o padding padrao (`px-3 py-2.5`) quando informado. */
  className?: string;
  /** Ao lado do rotulo, fora do botao de ordenar (ex.: dica). */
  aside?: ReactNode;
}) {
  return (
    <th
      className={cn(
        "align-bottom text-[11px] font-bold uppercase tracking-wide",
        align === "left" && "text-left",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className ?? "px-3 py-2.5",
      )}
    >
      <span className={cn("inline-flex items-center gap-1", align === "right" && "flex-row-reverse")}>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "inline-flex items-center gap-1 whitespace-nowrap align-bottom uppercase tracking-wide hover:text-t0",
            active ? "text-t0" : "text-t2",
            align === "right" && "flex-row-reverse",
            align === "center" && "justify-center",
          )}
        >
          {label}
          <span className="inline-flex w-2.5 shrink-0 justify-center text-[10px] leading-none" aria-hidden>
            {active ? (dir === "asc" ? "↑" : "↓") : ""}
          </span>
        </button>
        {aside}
      </span>
    </th>
  );
}
