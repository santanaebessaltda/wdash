import type { ReactNode } from "react";
import { Card } from "./Card";
import { AnimatedNumber } from "./AnimatedNumber";
import { Tooltip } from "./Tooltip";
import { cn } from "@/lib/cn";
import { deltaTip } from "@/lib/format";

export interface StatCardProps {
  label: string;
  value: string | number;
  /** Sem ícone, o card começa no rótulo. */
  icon?: ReactNode;
  iconColor?: string;
  iconBg?: string;
  delta?: { value: string; positive: boolean; vs?: string; diff?: string; previous?: string };
  sparkline?: ReactNode;
  /** Texto secundario abaixo do valor (ex.: "1.665 vendas  |  2.495 itens"). */
  sub?: ReactNode;
  /** Borra o número principal no placar. */
  secret?: boolean;
  /** Segunda linha (ex.: contribuicao WPINK na Overview). */
  sub2?: string;
  /** Tooltip exibido ao passar o mouse no  ao lado do label. */
  tooltip?: string;
  /** Substitui o tooltip padrão do badge de comparação. */
  deltaTooltip?: string;
  /** Cor do valor. Sem isso, o número fica na cor padrão do texto. */
  valueClassName?: string;
  /** Linha de apoio mais clara. Só o placar da loja. */
  quietSub?: boolean;
  /** Ícone e espaços menores. O valor continua o destaque. Só o placar da loja. */
  dense?: boolean;
  /** Fundo em degradê com halo na cor do ícone, como o card de insight. Só o placar da loja. */
  glass?: boolean;
  className?: string;
}

export function StatCard({ label, value, icon, iconColor = "var(--acc)", iconBg = "var(--acc-soft)", delta, sparkline, sub, sub2, tooltip, deltaTooltip, valueClassName, quietSub = false, dense = false, glass = false, secret = false, className }: StatCardProps) {
  const labelNode = (
    <div className={cn("flex min-w-0 items-center gap-1.5", !dense && (icon || delta) && "mt-4", dense && "min-w-0 flex-1")}>
      <p className="truncate text-xs font-bold uppercase tracking-wide text-t1">{label}</p>
      {tooltip && (
        <Tooltip label={tooltip} side="bottom">
          <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 hover:text-t1 transition-colors">
            ?
          </span>
        </Tooltip>
      )}
    </div>
  );
  return (
    <Card padding={dense ? "sm" : "md"} glass={glass ? iconBg : undefined} className={cn("min-w-0", dense && "!p-2.5", className)}>
      {dense && icon ? (
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]" style={{ background: iconBg, color: iconColor }}>
            {icon}
          </div>
          {labelNode}
        </div>
      ) : null}
      {!dense && (icon || delta) ? (
      <div className={cn("flex items-center gap-2", icon ? "justify-between" : "justify-end")}>
        {icon ? (
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px]"
            style={{ background: iconBg, color: iconColor }}
          >
            {icon}
          </div>
        ) : null}
        {delta && (() => {
          const badgeLabel = deltaTooltip ?? deltaTip(delta);
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
      ) : null}
      {!dense || !icon ? labelNode : null}
      <AnimatedNumber once={dense} duration={dense ? 700 : 1100} value={value} secret={secret} className={cn("block truncate font-extrabold", dense ? "mt-1 text-xl leading-none" : "mt-1 text-2xl", valueClassName ?? "text-t0")} />
      {sub && <p className={cn("truncate", dense ? "mt-1 text-[11px] leading-tight text-t0" : quietSub ? "mt-0.5 text-[10.5px] text-t3" : "mt-0.5 text-[11px] text-t2")}>{sub}</p>}
      {sub2 && <p className="mt-0.5 truncate text-[11px] text-t2">{sub2}</p>}
      {sparkline && <div className="mt-3 h-9">{sparkline}</div>}
    </Card>
  );
}
