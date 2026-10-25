import { progressColor, progressTextClass } from "@/components/ui/ProgressBar";
import { goalLevelPct } from "@/data/wedash/goalView";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";

export type GoalLevelMark = { name: string; pct: number; commissionPct?: number };

const PX_BY_CARACTERE = 5.6;
const GAP_PX = 12;
const HEIGHT_LINE = 13;

let canvasCtx: CanvasRenderingContext2D | null | undefined;
function widthText(name: string, extra: string): number {
  if (canvasCtx === undefined) canvasCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  if (!canvasCtx) return (name + extra).length * PX_BY_CARACTERE + 4;
  canvasCtx.font = "700 10px 'Plus Jakarta Sans', sans-serif";
  const a = canvasCtx.measureText(name).width;
  canvasCtx.font = "600 10px 'Plus Jakarta Sans', sans-serif";
  return Math.ceil(a + canvasCtx.measureText(extra).width) + 2;
}

/**
 * Posicao (0 - 1) de cada corte e largura total (px): cada trecho da barra tem so o espaco do nome do nivel
 * (fora de escala)  -  0 -> N1 = meio rotulo do N1; Ni -> Ni+1 = meio de cada + folga; o ultimo nivel fecha a barra.
 */
function trechos(ws: number[]): { xs: number[]; width: number } {
  const k = ws.length;
  const end: number[] = [];
  let acc = 0;
  for (let i = 0; i < k; i++) {
    const last = i === k - 1;
    if (i === 0) acc += last ? ws[0]! : ws[0]! / 2;
    else acc += ws[i - 1]! / 2 + GAP_PX + (last ? ws[i]! : ws[i]! / 2);
    end.push(acc);
  }
  const width = Math.ceil(acc);
  return { xs: end.map((x) => (width > 0 ? x / width : 0)), width };
}

/** Preenchimento (0 - 1): avanca proporcionalmente dentro do trecho entre dois niveis. */
function preenchimento(pct: number, cortes: number[], xs: number[]): number {
  if (cortes.length === 0) return Math.min(1, Math.max(0, pct / 100));
  let from = 0;
  let x0 = 0;
  for (let i = 0; i < cortes.length; i++) {
    const until = cortes[i]!;
    if (pct < until) return x0 + (until > from ? ((Math.max(pct, from) - from) / (until - from)) * (xs[i]! - x0) : 0);
    from = until;
    x0 = xs[i]!;
  }
  return 1;
}

/**
 * Barra da meta de uma pessoa com os cortes dos niveis ("simulacao" do progresso: cada trecho tem so o espaco
 * do nome do nivel, o preenchimento anda proporcional dentro do trecho e o ultimo nivel fecha a barra).
 * `completo` = rotulos "N1  |  Meta (1%)" no corte, todos na mesma linha  -  a barra reserva a largura em que
 * cabem (quem a usa cuida da rolagem lateral); senao so os cortes e os niveis no tooltip.
 */
export function GoalLevelsBar({ pct, marcos, complete = false }: { pct: number; marcos: GoalLevelMark[]; complete?: boolean }) {
  const name = (m: GoalLevelMark, i: number) => `N${i + 1} · ${m.name}`;
  const extra = (m: GoalLevelMark) => (m.commissionPct != null ? ` (${num(m.commissionPct, 1)}%)` : "");
  const hintLevel = (m: GoalLevelMark, i: number) =>
    `${name(m, i)} · a partir de ${num(m.pct, 0)}% da meta${m.commissionPct != null ? ` · premiação de ${num(m.commissionPct, 1)}%` : ""}`;
  const hint = marcos.map(hintLevel).join("\n");
  const { xs, width } = trechos(marcos.map((m, i) => widthText(name(m, i), extra(m))));
  const minWidth = complete ? width : undefined;
  const full = preenchimento(
    pct,
    marcos.map((m) => m.pct),
    xs,
  );

  return (
    <div style={minWidth ? { minWidth } : undefined}>
      <div className="relative h-[6px] w-full overflow-hidden rounded-full" style={{ background: "var(--bg-3)" }} title={complete ? undefined : hint}>
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${full * 100}%`, background: progressColor(pct) }}
        />
        {marcos.map((m, i) => {
          if (xs[i]! >= 0.995) return null;
          const atingido = pct >= m.pct;
          return (
            <span
              key={m.name}
              className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2"
              style={{ left: `${xs[i]! * 100}%`, background: atingido ? "var(--t0)" : "var(--t2)", opacity: atingido ? 0.55 : 0.35 }}
            />
          );
        })}
      </div>
      {complete && (
      <div className="relative mt-0.5 w-full" style={{ height: HEIGHT_LINE }}>
        {marcos.map((m, i) => {
          const atEnd = i === marcos.length - 1;
          return (
            <span
              key={m.name}
              title={hintLevel(m, i)}
              className={cn(
                "absolute top-0 whitespace-nowrap text-[10px] font-bold",
                atEnd ? "right-0" : "-translate-x-1/2",
                pct >= m.pct ? "text-acc" : "text-t2",
              )}
              style={{ lineHeight: `${HEIGHT_LINE}px`, ...(atEnd ? {} : { left: `${xs[i]! * 100}%` }) }}
            >
              {name(m, i)}
              {extra(m) && <span className="font-semibold opacity-75">{extra(m)}</span>}
            </span>
          );
        })}
      </div>
      )}
    </div>
  );
}

/**
 * "82% da meta  |  Nivel 2  |  Super" + barra com os niveis. `rolagem` = a barra rola na lateral quando o espaco
 * e menor que a largura dos rotulos (fora de tabela, que ja rola sozinha).
 */
export function GoalLevelSummary({
  pct,
  level,
  levelNumber,
  marcos,
  complete = true,
  rolagem = false,
}: {
  pct: number;
  level: string | null;
  levelNumber: number | null;
  marcos: GoalLevelMark[];
  complete?: boolean;
  rolagem?: boolean;
}) {
  const barra = <GoalLevelsBar pct={pct} marcos={marcos} complete={complete} />;
  const shown = goalLevelPct(pct, marcos.map((m) => m.pct));
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11.5px] text-t2">
        <span className={cn("font-mono font-bold", progressTextClass(shown))}>{num(shown, 0)}%</span> da meta
        {level && (
          <>
            {" · "}
            <span className="font-semibold text-t1">
              N{levelNumber} · {level}
            </span>
          </>
        )}
      </p>
      {rolagem ? <div className="overflow-x-auto overscroll-x-contain pb-1 touch-pan-x">{barra}</div> : barra}
    </div>
  );
}
