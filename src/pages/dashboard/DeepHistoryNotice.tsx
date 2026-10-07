import { Alert, RadialProgress } from "@/components/ui";
import type { DeepHistoryFill, MonthFill } from "@/data/wedash/salesRepo";

/** Periodo pede dias ainda nao trazidos pela carga funda. */
export function deepHistoryTouches(fill: DeepHistoryFill | null, inicio: string, _fim: string): boolean {
  return Boolean(fill && inicio < fill.oldestLoaded);
}

/**
 * Alerta com anel de progresso enquanto a recuperacao de vendas antigas (madrugada) ainda nao
 * chegou na inauguracao / teto. Escondido durante a carga do mes (MonthFill) — ela tem prioridade.
 */
export function DeepHistoryNotice({
  fill,
  monthFill,
  inicio,
  fim,
}: {
  fill: DeepHistoryFill | null;
  monthFill: MonthFill | null;
  inicio: string;
  fim: string;
}) {
  if (monthFill || !fill || fill.total <= 0) return null;
  const pct = Math.round((fill.done / fill.total) * 100);
  const parcial = deepHistoryTouches(fill, inicio, fim);
  return (
    <Alert
      variant="accent"
      className="mt-4 items-center"
      icon={
        <span className="shrink-0">
          <RadialProgress value={pct} size={44} stroke={4} color="var(--acc)" />
        </span>
      }
      title={
        <>
          Recuperando vendas antigas · <span className="tabular-nums">{pct}%</span>
        </>
      }
    >
      {parcial
        ? "Os dados deste período ainda são parciais. A recuperação continua de madrugada (0h–6h), um mês a cada 15 minutos."
        : "A recuperação continua de madrugada (0h–6h), um mês a cada 15 minutos. Você pode continuar usando o painel normalmente."}
    </Alert>
  );
}
