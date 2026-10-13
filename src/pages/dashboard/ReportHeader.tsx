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
    storeNameValue: store ? store.fantasia : "Todas as filiais",
    lojaArquivo: store ? [store.codFilial.trim(), store.fantasia].filter(Boolean).join(" ") : "Todas as filiais",
    todas: !store,
    lojaCnpj: store?.cnpj?.trim() || null,
    lojaCodigo: store?.codFilial.trim() || null,
    periodoTexto: preset ? `${preset} · ${datas}` : datas,
    periodoArquivo: preset ?? datas,
  };
}

/** Exportar da tela: abre a impressao com o layout do relatorio (salvar como PDF). */
export function useExportPdf(tela: string, extra?: string | null, { period = true }: { period?: boolean } = {}) {
  const { lojaArquivo, periodoArquivo } = useReportScope();
  return useCallback(
    () =>
      exportPdf([
        tela,
        lojaArquivo,
        extra ?? "",
        // Tela sem periodo (retrato, ex.: estoque) leva a data em que foi gerado.
        period ? periodoArquivo : new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }),
      ]),
    [tela, lojaArquivo, extra, period, periodoArquivo],
  );
}

/** Cabecalho que so aparece no PDF: marca, loja, periodo, filtros da tela e horario dos dados. */
export function ReportHeader({
  filtros = [],
  period = true,
  atualizado,
}: {
  filtros?: Array<{ label: string; amount: string }>;
  /** Telas de retrato (ex.: estoque) nao tem periodo. */
  period?: boolean;
  /** Substitui a linha "Vendas de hoje atualizadas...". */
  atualizado?: string;
}) {
  const { storeNameValue, lojaCnpj, lojaCodigo, todas, periodoTexto } = useReportScope();
  const agora = new Date();
  const geradoEm = `${agora.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })} às ${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
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
          <span className="text-t2">{todas ? "Filiais: " : "Filial: "}</span>
          <span className={todas ? "font-bold text-t0" : "font-bold uppercase text-t0"}>{storeNameValue}</span>
          {lojaCodigo && <span className="text-t2"> · Cód. {lojaCodigo}</span>}
          {lojaCnpj && <span className="text-t2"> · {lojaCnpj}</span>}
        </p>
        {period && (
          <p>
            <span className="text-t2">Período: </span>
            <span className="font-bold text-t0">{periodoTexto}</span>
          </p>
        )}
        {filtros.map((f) => (
          <p key={f.label}>
            <span className="text-t2">{f.label}: </span>
            <span className="font-bold text-t0">{f.amount}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
