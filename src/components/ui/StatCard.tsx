import type { ReactNode } from "react";
import { Card } from "./Card";
import { AnimatedNumber } from "./AnimatedNumber";
import { Tooltip } from "./Tooltip";
import { cn } from "@/lib/cn";
import { tipDelta } from "@/lib/format";

export interface StatCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  iconColor?: string;
  iconBg?: string;
  delta?: { value: string; positive: boolean; vs?: string; diff?: string; anterior?: string };
  sparkline?: ReactNode;
  /** Texto secundario abaixo do valor (ex.: "1.665 vendas  |  2.495 itens"). */
  sub?: string;
  /** Segunda linha (ex.: contribuicao WPINK na Overview). */
  sub2?: string;
  /** Tooltip exibido ao passar o mouse no  ao lado do label. */
  tooltip?: string;
  className?: string;
}

export function StatCard({ label, value, icon, iconColor = "var(--acc)", iconBg = "var(--acc-soft)", delta, sparkline, sub, sub2, tooltip, className }: StatCardProps) {
  return (
    <Card className={cn("min-w-0", className)}>
      <div className="flex items-center justify-between gap-2">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px]"
          style={{ background: iconBg, color: iconColor }}
        >
          {icon}
        </div>
        {delta && (() => {
          const badgeLabel = tipDelta(delta);
          const badge = (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold",
                delta.positive ? "text-ok bg-ok-soft" : "text-bad bg-bad-soft",
              )}
            >
              {delta.positive ? "↗" : "↘"} {delta.value}
            </span>
          );
          return badgeLabel ? <Tooltip label={badgeLabel}>{badge}</Tooltip> : badge;
        })()}
      </div>
      <div className="mt-4 flex items-center gap-1.5">
        <p className="truncate text-xs font-bold uppercase tracking-wide text-t1">{label}</p>
        {tooltip && (
          <Tooltip label={tooltip} side="bottom">
            <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 hover:text-t1 transition-colors">
              ?
            </span>
          </Tooltip>
        )}
      </div>
      <AnimatedNumber value={value} className="mt-1 block truncate text-2xl font-extrabold text-t0" />
      {sub && <p className="mt-0.5 truncate text-[11px] text-t2">{sub}</p>}
      {sub2 && <p className="mt-0.5 truncate text-[11px] text-t2">{sub2}</p>}
      {sparkline && <div className="mt-3 h-9">{sparkline}</div>}
    </Card>
  );
}
