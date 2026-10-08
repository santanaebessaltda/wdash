import { progressColor, progressTextClass } from "@/components/ui/ProgressBar";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";

export type GoalLevelMark = { nome: string; pct: number; comissaoPct?: number };

const PX_POR_CARACTERE = 5.6;
const GAP_PX = 12;
const ALTURA_LINHA = 13;

let canvasCtx: CanvasRenderingContext2D | null | undefined;
function larguraTexto(nome: string, extra: string): number {
  if (canvasCtx === undefined) canvasCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  if (!canvasCtx) return (nome + extra).length * PX_POR_CARACTERE + 4;
  canvasCtx.font = "700 10px 'Plus Jakarta Sans', sans-serif";
  const a = canvasCtx.measureText(nome).width;
  canvasCtx.font = "600 10px 'Plus Jakarta Sans', sans-serif";
  return Math.ceil(a + canvasCtx.measureText(extra).width) + 2;
}

/**
 * Posicao (0 - 1) de cada corte e largura total (px): cada trecho da barra tem so o espaco do nome do nivel
 * (fora de escala)  -  0 -> N1 = meio rotulo do N1; Ni -> Ni+1 = meio de cada + folga; o ultimo nivel fecha a barra.
 */
function trechos(ws: number[]): { xs: number[]; largura: number } {
  const k = ws.length;
  const fim: number[] = [];
  let acc = 0;
  for (let i = 0; i < k; i++) {
    const ultimo = i === k - 1;
    if (i === 0) acc += ultimo ? ws[0]! : ws[0]! / 2;
    else acc += ws[i - 1]! / 2 + GAP_PX + (ultimo ? ws[i]! : ws[i]! / 2);
    fim.push(acc);
  }
  const largura = Math.ceil(acc);
  return { xs: fim.map((x) => (largura > 0 ? x / largura : 0)), largura };
}

/** Preenchimento (0 - 1): avanca proporcionalmente dentro do trecho entre dois niveis. */
function preenchimento(pct: number, cortes: number[], xs: number[]): number {
  if (cortes.length === 0) return Math.min(1, Math.max(0, pct / 100));
  let de = 0;
  let x0 = 0;
  for (let i = 0; i < cortes.length; i++) {
    const ate = cortes[i]!;
    if (pct < ate) return x0 + (ate > de ? ((Math.max(pct, de) - de) / (ate - de)) * (xs[i]! - x0) : 0);
    de = ate;
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
export function GoalLevelsBar({ pct, marcos, completo = false }: { pct: number; marcos: GoalLevelMark[]; completo?: boolean }) {
  const nome = (m: GoalLevelMark, i: number) => `N${i + 1} · ${m.nome}`;
  const extra = (m: GoalLevelMark) => (m.comissaoPct != null ? ` (${num(m.comissaoPct, 1)}%)` : "");
  const dicaNivel = (m: GoalLevelMark, i: number) =>
    `${nome(m, i)} · a partir de ${num(m.pct, 0)}% da meta${m.comissaoPct != null ? ` · premiação de ${num(m.comissaoPct, 1)}%` : ""}`;
  const dica = marcos.map(dicaNivel).join("\n");
  const { xs, largura } = trechos(marcos.map((m, i) => larguraTexto(nome(m, i), extra(m))));
  const minWidth = completo ? largura : undefined;
  const cheio = preenchimento(
    pct,
    marcos.map((m) => m.pct),
    xs,
  );

  return (
    <div style={minWidth ? { minWidth } : undefined}>
      <div className="relative h-[6px] w-full overflow-hidden rounded-full" style={{ background: "var(--bg-3)" }} title={completo ? undefined : dica}>
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${cheio * 100}%`, background: progressColor(pct) }}
        />
        {marcos.map((m, i) => {
          if (xs[i]! >= 0.995) return null;
          const atingido = pct >= m.pct;
          return (
            <span
              key={m.nome}
              className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2"
              style={{ left: `${xs[i]! * 100}%`, background: atingido ? "var(--t0)" : "var(--t2)", opacity: atingido ? 0.55 : 0.35 }}
            />
          );
        })}
      </div>
      {completo && (
      <div className="relative mt-0.5 w-full" style={{ height: ALTURA_LINHA }}>
        {marcos.map((m, i) => {
          const naPonta = i === marcos.length - 1;
          return (
            <span
              key={m.nome}
              title={dicaNivel(m, i)}
              className={cn(
                "absolute top-0 whitespace-nowrap text-[10px] font-bold",
                naPonta ? "right-0" : "-translate-x-1/2",
                pct >= m.pct ? "text-acc" : "text-t2",
              )}
              style={{ lineHeight: `${ALTURA_LINHA}px`, ...(naPonta ? {} : { left: `${xs[i]! * 100}%` }) }}
            >
              {nome(m, i)}
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
  nivel,
  nivelNumero,
  marcos,
  completo = true,
  rolagem = false,
}: {
  pct: number;
  nivel: string | null;
  nivelNumero: number | null;
  marcos: GoalLevelMark[];
  completo?: boolean;
  rolagem?: boolean;
}) {
  const barra = <GoalLevelsBar pct={pct} marcos={marcos} completo={completo} />;
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11.5px] text-t2">
        <span className={cn("font-mono font-bold", progressTextClass(pct))}>{num(pct, 0)}%</span> da meta
        {nivel && (
          <>
            {" · "}
            <span className="font-semibold text-t1">
              N{nivelNumero} · {nivel}
            </span>
          </>
        )}
      </p>
      {rolagem ? <div className="overflow-x-auto overscroll-x-contain pb-1 touch-pan-x">{barra}</div> : barra}
    </div>
  );
}
