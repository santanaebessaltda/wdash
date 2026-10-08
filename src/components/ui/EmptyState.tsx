import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({
  icon = "📭",
  title,
  description,
  action,
  framed = true,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  /** false = sem borda/fundo proprios (dentro de um Card). */
  framed?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        framed ? "rounded-[var(--radius-vela-lg)] border border-dashed border-line bg-bg-2 py-14" : "py-10",
        className,
      )}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-bg-3 text-2xl">{icon}</div>
      <p className="text-[14.5px] font-bold text-t0">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-[13px] text-t1">{description}</p>}
      {action && <div className="mt-5 print:hidden">{action}</div>}
    </div>
  );
}
