import { Alert, RadialProgress } from "@/components/ui";
import { calendarTodayIso } from "@/data/wedash/clock";
import { monthFillProgress, type MonthFill } from "@/data/wedash/salesRepo";

/** Periodo [inicio, fim] inclui dias que a carga do mes ainda nao trouxe. */
export function monthFillTouches(fill: MonthFill | null, inicio: string, fim: string): boolean {
  return Boolean(fill && inicio <= fill.currentDay && fim >= fill.fillUntil);
}

/** Durante a carga do historico o calendario libera desde o dia mais antigo da carga (o aviso explica o parcial). */
export function pickerMinDate(coverageFrom: Date | null, fill: MonthFill | null): Date | null {
  if (!fill) return coverageFrom;
  const [y, m, d] = fill.fillUntil.split("-").map(Number);
  const fillStart = new Date(y, m - 1, d);
  return coverageFrom && coverageFrom < fillStart ? coverageFrom : fillStart;
}

/**
 * Alerta com anel de progresso (cor primaria) enquanto a carga do historico (pos-onboarding) roda  -  some sozinho ao terminar.
 * Se o periodo da tela inclui dias ainda nao carregados, avisa que os totais estao parciais.
 */
export function MonthFillNotice({ fill, inicio, fim }: { fill: MonthFill | null; inicio: string; fim: string }) {
  if (!fill) return null;
  const { done, total } = monthFillProgress(fill, calendarTodayIso());
  const pct = Math.round((done / total) * 100);
  const parcial = monthFillTouches(fill, inicio, fim);
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
          Carregando histórico de vendas · <span className="tabular-nums">{pct}%</span>
        </>
      }
    >
      {parcial
        ? "Os dados deste período ainda são parciais e serão atualizados automaticamente conforme o histórico for carregado."
        : "Os dados anteriores serão adicionados automaticamente. Você pode continuar usando o painel normalmente."}
    </Alert>
  );
}
