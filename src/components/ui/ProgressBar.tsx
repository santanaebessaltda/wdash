/** Cor da barra do Dash. O valor não troca a cor. */
export function progressColor(_value: number): string {
  return "var(--acc)";
}

/** Texto do percentual que acompanha a barra. Também não muda com o valor. */
export function progressTextClass(_value: number): string {
  return "text-acc";
}

export interface ProgressBarProps {
  value: number; // 0-100
  /** Se omitido, usa a cor primária. */
  color?: string;
  trackColor?: string;
  height?: number;
  label?: string;
}

export function ProgressBar({ value, color, trackColor = "var(--bg-3)", height = 8, label }: ProgressBarProps) {
  const fill = color ?? progressColor(value);
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
          style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: fill }}
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
  /** Se omitido, usa a cor primária. */
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
        <span className={large ? "text-[26px] font-extrabold tracking-tight text-t0" : "text-xs font-bold text-t0"}>
          {Math.round(value)}%
        </span>
        {label && <span className="text-[11px] text-t2">{label}</span>}
      </div>
    </div>
  );
}
