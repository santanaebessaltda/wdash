import { useEffect, useState } from "react";

function progressComplete(value: number): boolean {
  return value >= 100;
}

/** Cor da barra. Abaixo de 100% fica na cor do sistema; em 100% fica verde. */
export function progressColor(value: number): string {
  return progressComplete(value) ? "var(--ok)" : "var(--acc)";
}

/** Texto do percentual que acompanha a barra. Verde só em 100%. */
export function progressTextClass(value: number): string {
  return progressComplete(value) ? "text-ok" : "text-acc";
}

/** "Atingiu" em verde, ou o lugar / "Não atingiu" na cor do texto. Não é badge. */
export function ProgressStanding({ ok, children }: { ok: boolean; children: string }) {
  return <span className={`shrink-0 text-[12px] font-semibold ${ok ? "text-ok" : "text-t1"}`}>{children}</span>;
}

export interface ProgressBarProps {
  value: number; // 0-100
  /** Se omitido, usa a cor do progresso: primária abaixo de 100%, verde em 100%. */
  color?: string;
  trackColor?: string;
  height?: number;
  label?: string;
  /** Na primeira pintura a barra sai do zero. */
  enter?: boolean;
}

export function ProgressBar({ value, color, trackColor = "var(--bg-3)", height = 8, label, enter = false }: ProgressBarProps) {
  const [drawn, setDrawn] = useState(enter ? 0 : value);
  useEffect(() => {
    if (!enter) {
      setDrawn(value);
      return;
    }
    const frame = requestAnimationFrame(() => setDrawn(value));
    return () => cancelAnimationFrame(frame);
  }, [enter, value]);
  const shown = enter ? drawn : value;
  const fill = color ?? progressColor(shown);
  return (
    <div>
      {label && (
        <div className="mb-1.5 flex items-center justify-between text-[11.5px] font-semibold text-t1">
          <span>{label}</span>
          <span className="text-t0">{Math.round(value)}%</span>
        </div>
      )}
      <div className="w-full overflow-hidden rounded-full" style={{ height, background: trackColor }}>
        <div
          className="h-full rounded-full transition-[width,background] duration-500"
          style={{ width: `${Math.min(100, Math.max(0, shown))}%`, background: fill }}
        />
      </div>
    </div>
  );
}

export function RadialProgress({
  value,
  size = 64,
  stroke = 7,
  color,
  trackColor = "var(--bg-3)",
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  /** Se omitido, usa a cor do progresso: primária abaixo de 100%, verde em 100%. */
  color?: string;
  trackColor?: string;
  /** Subtitulo abaixo do % (ex.: "da meta"). */
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, value)) / 100) * c;
  const large = size >= 120;
  const strokeColor = color ?? progressColor(value);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset .5s ease, stroke .5s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`${large ? "text-[26px] font-extrabold tracking-tight" : "text-xs font-bold"} ${progressComplete(value) ? "text-ok" : "text-t0"}`}
        >
          {Math.round(value)}%
        </span>
        {label && <span className="text-[11px] text-t2">{label}</span>}
      </div>
    </div>
  );
}
