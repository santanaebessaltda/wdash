import { Badge } from "./Badge";
import { ProgressBar } from "./ProgressBar";
import { cn } from "@/lib/cn";

/**
 * Escada de Premiacao (CommissionLadder)  -  widget central da tela Equipe.
 * Mostra os degraus de meta (ex.: Meta  ->  Super Meta  ->  Hiper Meta) com o
 * progresso atual do faturamento em relacao a cada degrau.
 *
 * Composto com componentes Vela existentes: ProgressBar (trilho de progresso)
 * + Badge (selo do degrau atual). Estilo alinhado ao tema (acc para ativo,
 * t2 para inativo).
 *
 * - degraus: lista de { label, valor } ordenada do menor pro maior.
 * - realizado: faturamento acumulado no periodo.
 * - formatValue: formata os valores em R$ (ex.: brl).
 */

export interface LadderStep {
  label: string;
  /** Valor alvo do degrau em R$ (ex.: 190000 para Meta, 216000 para Super). */
  valor: number;
}

export function CommissionLadder({
  degraus,
  realizado,
  formatValue = (v: number) => String(v),
  className,
}: {
  degraus: LadderStep[];
  realizado: number;
  formatValue?: (v: number) => string;
  className?: string;
}) {
  // Ordena os degraus do menor pro maior (Meta  ->  Super  ->  Hiper).
  const ordenados = [...degraus].sort((a, b) => a.valor - b.valor);
  // Degrau atual: o ultimo cujo valor foi atingido (realizado >= valor).
  const indiceAtual = ordenados.reduce((acc, d, i) => (realizado >= d.valor ? i : acc), -1);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {ordenados.map((degrau, i) => {
        const pct = Math.min(100, (realizado / degrau.valor) * 100);
        const atingido = realizado >= degrau.valor;
        const ehAtual = i === indiceAtual;
        return (
          <div key={degrau.label} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={cn("text-[13px] font-bold", atingido ? "text-ok" : "text-t0")}>{degrau.label}</span>
                {ehAtual && !atingido && (
                  <Badge variant="info" dot>
                    Em andamento
                  </Badge>
                )}
                {atingido && (
                  <Badge variant="success" dot>
                    Atingido
                  </Badge>
                )}
              </div>
              <span className="text-[12px] font-semibold text-t1">
                {formatValue(realizado)} / {formatValue(degrau.valor)}
              </span>
            </div>
            <ProgressBar value={pct} height={10} />
            <span className="text-[11px] text-t2">
              {atingido
                ? `✓ ${degrau.label} batida!`
                : `Faltam ${formatValue(Math.max(0, degrau.valor - realizado))} (${pct.toFixed(1)}%)`}
            </span>
          </div>
        );
      })}
    </div>
  );
}