import type { ReactNode } from "react";
import { Card, AnimatedNumber, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ICONS, TINT, type IconKey, type TintKey } from "./icons";

export interface KpiTileProps {
  label: string;
  value: string;
  icon: IconKey;
  tint: TintKey;
  delta?: { value: string; positive: boolean; /** Base da comparacao, ex.: "1 - 15 ago" */ vs?: string };
  sub?: string;
  /**
   * Quando true, o subtitulo aceita duas linhas (quebra em "  |  ") e reserva a
   * altura da segunda mesmo vazia, pra manter todos os tiles de uma grade com
   * a mesma altura. Usado so onde isso importa (grade 2x2 no mobile); as
   * demais dashboards mantem uma linha truncada, como sempre foi.
   */
  subDuasLinhas?: boolean;
  /** Tooltip exibido ao passar o mouse no  ao lado do label. */
  tooltip?: string;
  /** Sparkline ou outro elemento renderizado abaixo do subtitulo. */
  sparkline?: ReactNode;
}

/** Subtitulo que quebra em duas linhas no mobile (uma por trecho, separado por "  |  " no texto de origem) e volta a ficar numa linha so a partir do sm, onde cabe. Reserva a altura da segunda linha mesmo quando nao ha, pra tiles vizinhos nao ficarem com alturas diferentes. */
export function KpiSubtitulo({ texto }: { texto: string }) {
  const [primeira, segunda] = texto.split(" · ");
  return (
    <div className="mt-1 min-h-[2.4em] text-[11.5px] leading-snug text-t2">
      <span className="block sm:inline">{primeira}</span>
      {segunda && (
        <>
          <span className="hidden sm:inline"> · </span>
          <span className="block sm:inline">{segunda}</span>
        </>
      )}
    </div>
  );
}

/**
 * KPI card used by the Sales / Project / SaaS / BI dashboards  -  visually
 * close to `StatCard` but with an uppercase label and an optional
 * secondary "sub" line under the value, matching the source layout.
 */
export function KpiTile({ label, value, icon, tint, delta, sub, subDuasLinhas, tooltip, sparkline }: KpiTileProps) {
  const Icon = ICONS[icon];
  return (
    <Card className="min-w-0">
      <div className="mb-3.5 flex items-center justify-between gap-2">
        <span
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl"
          style={{ background: TINT[tint].bg, color: TINT[tint].fg }}
        >
          <Icon size={20} />
        </span>
        {delta && (
          <span
            title={`${delta.value} ${delta.positive ? "acima" : "abaixo"}${delta.vs ? ` de ${delta.vs}` : " do período comparado"}`}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold",
              delta.positive ? "text-ok bg-ok-soft" : "text-bad bg-bad-soft",
            )}
          >
            {delta.positive ? "↗" : "↘"} {delta.value}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-t1">{label}</p>
        {tooltip && (
          <Tooltip label={tooltip}>
            <span className="inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-line text-[8px] font-bold leading-none text-t2">
              ⓘ
            </span>
          </Tooltip>
        )}
      </div>
      <AnimatedNumber value={value} className="mt-1.5 block truncate text-2xl font-extrabold tracking-tight text-t0" />
      {sub && (subDuasLinhas ? <KpiSubtitulo texto={sub} /> : <p className="mt-0.5 truncate text-[11.5px] text-t2">{sub}</p>)}
      {sparkline && <div className="mt-3 h-9">{sparkline}</div>}
    </Card>
  );
}
