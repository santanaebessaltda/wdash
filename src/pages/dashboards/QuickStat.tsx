import type { ReactNode } from "react";
import { Card, Tooltip } from "@/components/ui";
import { TINT, type TintKey } from "./icons";

/** Card compacto da faixa WPINK do Financeiro: ícone ao lado do valor. */
export function QuickStat({
  label,
  value,
  icon,
  tint,
  tooltip,
  sub,
  badge,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tint: TintKey;
  tooltip?: string;
  sub?: string;
  badge?: ReactNode;
}) {
  const color = TINT[tint];
  return (
    <Card padding="sm" className="flex items-center gap-3.5">
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
        style={{ background: color.bg, color: color.fg }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-t2">
          {label}
          {tooltip ? (
            <Tooltip label={tooltip} side="bottom">
              <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 transition-colors hover:text-t1">
                ?
              </span>
            </Tooltip>
          ) : null}
        </p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
          <p className="truncate font-mono text-lg font-extrabold text-t0">{value}</p>
          {badge}
        </div>
        {sub ? <p className="text-[11px] text-t2">{sub}</p> : null}
      </div>
    </Card>
  );
}
