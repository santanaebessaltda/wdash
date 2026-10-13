import { useCallback } from "react";
import { WedashBrand } from "@/components/wedash/WedashBrand";
import { resolvePeriod } from "@/data/wedash/dashboard";
import { calendarTodayIso } from "@/data/wedash/clock";
import { storesForSession } from "@/data/wedash/stores";
import { isoToDate } from "@/lib/format";
import { exportPdf } from "@/lib/printMode";
import { useActiveSession } from "@/session/SessionProvider";
import { LastUpdated } from "./LastUpdated";
import { periodDisplayLabel } from "./periodPicker";
import { useScope } from "./useScope";

function dataBr(iso: string): string {
  return isoToDate(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Loja e periodo do relatorio, no formato do cabecalho do PDF e do nome do arquivo. */
function useReportScope() {
  const session = useActiveSession();
  const { scope } = useScope();
  const storeRows = storesForSession(session.stores);
  const store = scope.storeIds[0] ? storeRows.find((s) => s.id === scope.storeIds[0]) : storeRows.length === 1 ? storeRows[0] : undefined;
  const period = resolvePeriod(scope.period, calendarTodayIso());
  const datas = period.start === period.end ? dataBr(period.start) : `${dataBr(period.start)} a ${dataBr(period.end)}`;
  const preset = periodDisplayLabel(scope.period);
  return {
    storeNameValue: store ? store.tradeName : "Todas as filiais",
    storeFile: store ? [store.branchCode.trim(), store.tradeName].filter(Boolean).join(" ") : "Todas as filiais",
    all: !store,
    storeCnpj: store?.cnpj?.trim() || null,
    storeCode: store?.branchCode.trim() || null,
    periodText: preset ? `${preset} · ${datas}` : datas,
    periodFile: preset ?? datas,
  };
}

/** Exportar da tela: abre a impressao com o layout do relatorio (salvar como PDF). */
export function useExportPdf(screen: string, extra?: string | null, { period = true }: { period?: boolean } = {}) {
  const { storeFile, periodFile } = useReportScope();
  return useCallback(
    () =>
      exportPdf([
        screen,
        storeFile,
        extra ?? "",
        // Tela sem periodo (retrato, ex.: estoque) leva a data em que foi gerado.
        period ? periodFile : new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }),
      ]),
    [screen, storeFile, extra, period, periodFile],
  );
}

/** Cabecalho que so aparece no PDF: marca, loja, periodo, filtros da tela e horario dos dados. */
export function ReportHeader({
  filters = [],
  period = true,
  atualizado,
}: {
  filters?: Array<{ label: string; amount: string }>;
  /** Telas de retrato (ex.: estoque) nao tem periodo. */
  period?: boolean;
  /** Substitui a linha "Vendas de hoje atualizadas...". */
  atualizado?: string;
}) {
  const { storeNameValue, storeCnpj, storeCode, all, periodText } = useReportScope();
  const now = new Date();
  const geradoEm = `${now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })} às ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
  return (
    <div className="mb-5 hidden border-b border-line pb-4 print:block">
      <div className="flex items-start justify-between gap-6">
        <WedashBrand size={28} />
        <div className="text-right text-[11px] leading-5 text-t2">
          <p>Gerado em {geradoEm}</p>
          <p>{atualizado ?? <LastUpdated />}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-[12.5px]">
        <p>
          <span className="text-t2">{all ? "Filiais: " : "Filial: "}</span>
          <span className={all ? "font-bold text-t0" : "font-bold uppercase text-t0"}>{storeNameValue}</span>
          {storeCode && <span className="text-t2"> · Cód. {storeCode}</span>}
          {storeCnpj && <span className="text-t2"> · {storeCnpj}</span>}
        </p>
        {period && (
          <p>
            <span className="text-t2">Período: </span>
            <span className="font-bold text-t0">{periodText}</span>
          </p>
        )}
        {filters.map((f) => (
          <p key={f.label}>
            <span className="text-t2">{f.label}: </span>
            <span className="font-bold text-t0">{f.amount}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
