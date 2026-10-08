import { useId, useMemo, useState } from "react";

export interface AreaLineChartProps {
  /** `null` = ponto sem valor (ex.: horas de hoje que ainda nao chegaram)  -  a linha para antes dele. */
  data: (number | null)[];
  /** Segunda serie no mesmo eixo (ex.: meta). Escala compartilhada; `null` = sem ponto. */
  compareData?: (number | null)[];
  labels?: string[];
  /** Titulo do tooltip por ponto (ex.: "21h as 22h"); sem ele usa `labels`. */
  tooltipLabels?: (string | undefined)[];
  color?: string;
  compareColor?: string;
  height?: number;
  showArea?: boolean;
  /** Mostra o valor formatado direto em cada ponto da linha. */
  showValues?: boolean;
  /** Renderiza labels do eixo X dentro da area com scroll (mobile). */
  showAxisLabels?: boolean;
  formatValue?: (v: number) => string;
}

type Point = { x: number; y: number };

function buildSmoothPath(points: Point[]) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/** Largura logica do viewBox  -  o SVG escala fluidamente (padrao Vela). */
const VB_W = 600;
/** Largura minima por ponto no mobile  -  abaixo disso ativa scroll horizontal. */
const MIN_POINT_W = 56;

function toPoints(data: (number | null)[], height: number, padY: number, min: number, range: number) {
  const chartH = height - padY * 2;
  return data.map((v, i) =>
    v == null
      ? null
      : {
          x: data.length <= 1 ? VB_W / 2 : (i / (data.length - 1)) * VB_W,
          y: padY + chartH * (1 - (v - min) / range),
        },
  );
}

export function AreaLineChart({
  data,
  compareData,
  labels,
  tooltipLabels,
  color = "var(--acc)",
  compareColor = "var(--t2)",
  height = 240,
  showArea = true,
  showValues = false,
  showAxisLabels = false,
  formatValue = (v) => String(v),
}: AreaLineChartProps) {
  const gradientId = useId();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const padY = 16;
  const minW = Math.max(VB_W, data.length * MIN_POINT_W);

  const { points, comparePoints, min, max } = useMemo(() => {
    const values = data.filter((v): v is number => v != null);
    const pool =
      compareData && compareData.length === data.length
        ? [...values, ...compareData.filter((v): v is number => v != null)]
        : values;
    const mn = pool.length > 0 ? Math.min(...pool) : 0;
    const mx = pool.length > 0 ? Math.max(...pool) : 0;
    const range = mx - mn || 1;
    return {
      points: toPoints(data, height, padY, mn, range),
      comparePoints:
        compareData && compareData.length === data.length
          ? toPoints(compareData, height, padY, mn, range)
          : null,
      min: mn,
      max: mx,
    };
  }, [data, compareData, height]);

  const drawn = points.filter((p): p is Point => p != null);
  const linePath = buildSmoothPath(drawn);
  const areaPath =
    drawn.length > 1
      ? `${linePath} L ${drawn[drawn.length - 1].x} ${height} L ${drawn[0].x} ${height} Z`
      : "";
  const comparePath = comparePoints ? buildSmoothPath(comparePoints.filter((p): p is Point => p != null)) : "";
  const activeCompare = hoverIdx !== null ? (comparePoints?.[hoverIdx] ?? null) : null;
  const activeCompareValue = hoverIdx !== null ? (compareData?.[hoverIdx] ?? null) : null;
  const active = hoverIdx !== null ? (points[hoverIdx] ?? comparePoints?.[hoverIdx] ?? null) : null;
  const activeValue = hoverIdx !== null ? data[hoverIdx] : null;

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * VB_W;
    const idx = Math.round((relX / VB_W) * Math.max(data.length - 1, 0));
    setHoverIdx(Math.min(data.length - 1, Math.max(0, idx)));
  }

  return (
    <div className="w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]">
      <div className="relative" style={{ minWidth: minW }}>
        <div className="relative w-full" style={{ height }}>
          <svg
            viewBox={`0 0 ${VB_W} ${height}`}
            className="vela-reveal h-full w-full overflow-visible"
            preserveAspectRatio="none"
            onMouseMove={handleMove}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.35" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {showArea && areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
            {comparePath && (
              <path
                d={comparePath}
                fill="none"
                stroke={compareColor}
                strokeWidth="2.5"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <path
              d={linePath}
              fill="none"
              stroke={color}
              strokeWidth="2.5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {showValues &&
              points.map((p, i) =>
                p == null ? null : (
                  <text
                    key={i}
                    x={p.x}
                    y={p.y - 8}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill={color}
                    style={{ pointerEvents: "none" }}
                  >
                    {formatValue(data[i] as number)}
                  </text>
                ),
              )}
            {active && (
              <g>
                <line
                  x1={active.x}
                  y1={0}
                  x2={active.x}
                  y2={height}
                  stroke="var(--line-2)"
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
                {activeCompare && (
                  <circle
                    cx={activeCompare.x}
                    cy={activeCompare.y}
                    r="4"
                    fill={compareColor}
                    stroke="var(--bg-2)"
                    strokeWidth="2"
                  />
                )}
                {activeValue != null && (
                  <circle cx={active.x} cy={active.y} r="5" fill={color} stroke="var(--bg-2)" strokeWidth="2" />
                )}
              </g>
            )}
          </svg>

          {active && hoverIdx !== null && (() => {
            const leftPct = (active.x / VB_W) * 100;
            const topPct = (active.y / height) * 100;
            let translateX = "-50%";
            if (leftPct < 12) translateX = "0";
            else if (leftPct > 88) translateX = "-100%";
            const flipDown = topPct < 22;
            return (
              <div
                className="pointer-events-none absolute z-10 rounded-lg border border-line bg-bg-3 px-2.5 py-1.5 text-[11px] shadow-[var(--shadow-vela)]"
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  marginTop: flipDown ? 10 : -8,
                  transform: `translateX(${translateX})${flipDown ? "" : " translateY(-100%)"}`,
                  whiteSpace: "nowrap",
                }}
              >
                {(tooltipLabels?.[hoverIdx] ?? labels?.[hoverIdx]) ? (
                  <span className="mb-0.5 block text-[10px] font-semibold text-t2">
                    {tooltipLabels?.[hoverIdx] ?? labels?.[hoverIdx]}
                  </span>
                ) : null}
                {activeValue != null && (
                  <span className="flex items-center gap-1.5 font-bold text-t0">
                    <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: color }} />
                    {formatValue(activeValue)}
                  </span>
                )}
                {compareData && compareData.length === data.length && activeCompareValue != null && (
                  <span className="mt-0.5 flex items-center gap-1.5 font-semibold text-t1">
                    <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: compareColor }} />
                    {formatValue(activeCompareValue)}
                  </span>
                )}
              </div>
            );
          })()}
        </div>

        {showAxisLabels && labels && labels.length > 0 && (
          <div className="mt-2 flex justify-between gap-1 px-1">
            {labels.map((label, i) => (
              <span key={`${label}-${i}`} className="min-w-0 truncate text-center text-[11px] font-semibold text-t2">
                {label}
              </span>
            ))}
          </div>
        )}

        <span className="sr-only">
          Range {formatValue(min)} to {formatValue(max)}
        </span>
      </div>
    </div>
  );
}
