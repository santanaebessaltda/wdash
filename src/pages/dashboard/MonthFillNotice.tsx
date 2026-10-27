import { Alert, RadialProgress } from "@/components/ui";
import { calendarTodayIso } from "@/data/wedash/clock";
import { monthFillProgress, type MonthFill } from "@/data/wedash/salesRepo";
import { filterCacheDate } from "@/lib/filterCache";

/** Periodo [inicio, fim] inclui dias que a carga do mes ainda nao trouxe. */
export function monthFillTouches(fill: MonthFill | null, start: string, end: string): boolean {
  return Boolean(fill && start <= fill.currentDay && end >= fill.fillUntil);
}

/** Durante a carga do historico o calendario libera desde o dia mais antigo da carga (o aviso explica o parcial). */
export function pickerMinDate(coverageFrom: Date | string | null | undefined, fill: MonthFill | null): Date | null {
  const coverage = filterCacheDate(coverageFrom);
  if (!fill?.fillUntil) return coverage;
  const [y, m, d] = fill.fillUntil.split("-").map(Number);
  if (!y || !m || !d) return coverage;
  const fillStart = new Date(y, m - 1, d);
  return coverage && coverage < fillStart ? coverage : fillStart;
}

/**
 * Alerta com anel de progresso (cor primaria) enquanto a carga do historico (pos-onboarding) roda  -  some sozinho ao terminar.
 * Se o periodo da tela inclui dias ainda nao carregados, avisa que os totais estao parciais.
 */
export function MonthFillNotice({ fill, start, end }: { fill: MonthFill | null; start: string; end: string }) {
  if (!fill) return null;
  const { done, total } = monthFillProgress(fill, calendarTodayIso());
  const pct = Math.round((done / total) * 100);
  const partial = monthFillTouches(fill, start, end);
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
      {partial
        ? "Os dados deste período ainda são parciais e serão atualizados automaticamente conforme o histórico for carregado."
        : "Os dados anteriores serão adicionados automaticamente. Você pode continuar usando o painel normalmente."}
    </Alert>
  );
}
