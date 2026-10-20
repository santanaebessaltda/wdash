import { useCallback, useState } from "react";
import { flushSync } from "react-dom";
import { WedashBrand } from "@/components/wedash/WedashBrand";
import { resolvePeriod } from "@/data/wedash/dashboard";
import { calendarTodayIso } from "@/data/wedash/clock";
import { storesForSession } from "@/data/wedash/stores";
import { exportStoreLabel, isoToDate } from "@/lib/format";
import { exportPdf, reportFileTitle } from "@/lib/printMode";
import { useActiveSession } from "@/session/SessionProvider";
import { LastUpdated } from "./LastUpdated";
import { periodDisplayLabel } from "./periodPicker";
import { useScope } from "./useScope";

function dataBr(iso: string): string {
  return isoToDate(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Loja e periodo do relatorio, no formato do cabecalho do PDF e do nome do arquivo. */
function useReportScope(pickedIds: string[] | null = null) {
  const session = useActiveSession();
  const { scope } = useScope();
  const storeRows = storesForSession(session.stores);
  const picked =
    pickedIds && pickedIds.length > 0 && pickedIds.length < storeRows.length
      ? storeRows.filter((store) => pickedIds.includes(store.id)).sort((a, b) => a.tradeName.localeCompare(b.tradeName, "pt-BR"))
      : [];
  const store = picked.length === 1
    ? picked[0]
    : scope.storeIds[0]
      ? storeRows.find((s) => s.id === scope.storeIds[0])
      : storeRows.length === 1
        ? storeRows[0]
        : undefined;
  const several = picked.length > 1;
  const period = resolvePeriod(scope.period, calendarTodayIso());
  const datas = period.start === period.end ? dataBr(period.start) : `${dataBr(period.start)} a ${dataBr(period.end)}`;
  const preset = periodDisplayLabel(scope.period);
  return {
    storeNameValue: several ? picked.map((item) => item.tradeName).join(" · ") : store ? store.tradeName : "Todas as filiais",
    storeFile: several
      ? picked.map((item) => item.tradeName).join(", ")
      : store
        ? [store.branchCode.trim(), store.tradeName].filter(Boolean).join(" ")
        : "Todas as filiais",
    all: several || !store,
    storeCnpj: several ? null : store?.cnpj?.trim() || null,
    storeCode: several ? null : store?.branchCode.trim() || null,
    periodText: preset ? `${preset} · ${datas}` : datas,
    periodFile: preset ?? datas,
  };
}

function reportParts(screen: string, storeFile: string, periodFile: string, extra: string | null | undefined, period: boolean): string[] {
  return [
    screen,
    storeFile,
    extra ?? "",
    // Tela sem periodo (retrato, ex.: estoque) leva a data em que foi gerado.
    period ? periodFile : new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }),
  ];
}

/** Nome do arquivo do relatorio, o mesmo da impressao, sem extensao. */
export function useReportFileTitle(screen: string, extra?: string | null, { period = true }: { period?: boolean } = {}) {
  const { storeFile, periodFile } = useReportScope();
  return useCallback(
    () => reportFileTitle(reportParts(screen, storeFile, periodFile, extra, period)),
    [screen, storeFile, extra, period, periodFile],
  );
}

/** Exportar da tela: abre a impressao com o layout do relatorio (salvar como PDF). */
export function useExportPdf(screen: string, extra?: string | null, { period = true }: { period?: boolean } = {}) {
  const { storeFile, periodFile } = useReportScope();
  return useCallback(
    () => exportPdf(reportParts(screen, storeFile, periodFile, extra, period)),
    [screen, storeFile, extra, period, periodFile],
  );
}

/** Escopo da tela durante o PDF. A rede inteira continua com a lista vazia do seletor. */
export function scopeForExport<T extends { storeIds: string[] }>(scope: T, storeIds: string[] | null, storeCount: number): T {
  if (!storeIds || storeIds.length === 0 || storeIds.length >= storeCount) return scope;
  return { ...scope, storeIds };
}

/** Exportar do Dashboard. Com Todas as filiais, o PDF pode ficar só com as filiais marcadas. */
export function useDashboardExport(screen: string) {
  const session = useActiveSession();
  const { scope } = useScope();
  const { periodFile } = useReportScope();
  const rows = storesForSession(session.stores);
  const [printIds, setPrintIds] = useState<string[] | null>(null);
  const viewScope = scopeForExport(scope, printIds, rows.length);
  const stores =
    scope.storeIds.length === 0 && rows.length > 1
      ? [...rows]
          .map((store) => ({ id: store.id, ...exportStoreLabel(store.tradeName, store.name) }))
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      : undefined;

  function exportPdfFor(storeIds?: string[]) {
    const ids = storeIds && storeIds.length > 0 && storeIds.length < rows.length ? storeIds : null;
    flushSync(() => setPrintIds(ids));
    const picked = ids
      ? rows.filter((store) => ids.includes(store.id)).sort((a, b) => a.tradeName.localeCompare(b.tradeName, "pt-BR"))
      : [];
    const storeFile =
      picked.length === 1
        ? [picked[0]!.branchCode.trim(), picked[0]!.tradeName].filter(Boolean).join(" ")
        : picked.length > 1
          ? picked.map((store) => store.tradeName).join(", ")
          : "Todas as filiais";
    exportPdf(reportParts(screen, storeFile, periodFile, null, true));
    const done = () => {
      window.removeEventListener("afterprint", done);
      setPrintIds(null);
    };
    window.addEventListener("afterprint", done);
  }

  return { viewScope, printIds, stores, exportPdfFor };
}

/** Cabecalho que so aparece no PDF: marca, loja, periodo, filtros da tela e horario dos dados. */
export function ReportHeader({
  filters = [],
  period = true,
  atualizado,
  pickedIds = null,
}: {
  filters?: Array<{ label: string; amount: string }>;
  /** Telas de retrato (ex.: estoque) nao tem periodo. */
  period?: boolean;
  /** Substitui a linha "Vendas de hoje atualizadas...". */
  atualizado?: string;
  /** Filiais do PDF quando o seletor está em Todas e a pessoa marcou só algumas. */
  pickedIds?: string[] | null;
}) {
  const { storeNameValue, storeCnpj, storeCode, all, periodText } = useReportScope(pickedIds);
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
