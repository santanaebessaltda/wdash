import { useCallback } from "react";
import { WedashBrand } from "@/components/wedash/WedashBrand";
import { resolvePeriod } from "@/data/wedash/dashboard";
import { calendarTodayIso } from "@/data/wedash/clock";
import { storesForSession } from "@/data/wedash/stores";
import { deIso } from "@/lib/format";
import { exportPdf } from "@/lib/printMode";
import { useActiveSession } from "@/session/SessionProvider";
import { LastUpdated } from "./LastUpdated";
import { periodDisplayLabel } from "./periodPicker";
import { useScope } from "./useScope";

function dataBr(iso: string): string {
  return deIso(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Loja e periodo do relatorio, no formato do cabecalho do PDF e do nome do arquivo. */
function useReportScope() {
  const session = useActiveSession();
  const { escopo } = useScope();
  const lojas = storesForSession(session.stores);
  const loja = escopo.filialIds[0] ? lojas.find((s) => s.id === escopo.filialIds[0]) : lojas.length === 1 ? lojas[0] : undefined;
  const periodo = resolvePeriod(escopo.periodo, calendarTodayIso());
  const datas = periodo.inicio === periodo.fim ? dataBr(periodo.inicio) : `${dataBr(periodo.inicio)} a ${dataBr(periodo.fim)}`;
  const preset = periodDisplayLabel(escopo.periodo);
  return {
    lojaNome: loja ? loja.fantasia : "Todas as lojas",
    lojaArquivo: loja ? [loja.codFilial.trim(), loja.fantasia].filter(Boolean).join(" ") : "Todas as lojas",
    todas: !loja,
    lojaCnpj: loja?.cnpj?.trim() || null,
    lojaCodigo: loja?.codFilial.trim() || null,
    periodoTexto: preset ? `${preset} · ${datas}` : datas,
    periodoArquivo: preset ?? datas,
  };
}

/** Exportar da tela: abre a impressao com o layout do relatorio (salvar como PDF). */
export function useExportPdf(tela: string, extra?: string | null, { periodo = true }: { periodo?: boolean } = {}) {
  const { lojaArquivo, periodoArquivo } = useReportScope();
  return useCallback(
    () =>
      exportPdf([
        tela,
        lojaArquivo,
        extra ?? "",
        // Tela sem periodo (retrato, ex.: estoque) leva a data em que foi gerado.
        periodo ? periodoArquivo : new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }),
      ]),
    [tela, lojaArquivo, extra, periodo, periodoArquivo],
  );
}

/** Cabecalho que so aparece no PDF: marca, loja, periodo, filtros da tela e horario dos dados. */
export function ReportHeader({
  filtros = [],
  periodo = true,
  atualizado,
}: {
  filtros?: Array<{ label: string; valor: string }>;
  /** Telas de retrato (ex.: estoque) nao tem periodo. */
  periodo?: boolean;
  /** Substitui a linha "Vendas de hoje atualizadas...". */
  atualizado?: string;
}) {
  const { lojaNome, lojaCnpj, lojaCodigo, todas, periodoTexto } = useReportScope();
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
          <span className="text-t2">{todas ? "Lojas: " : "Loja: "}</span>
          <span className={todas ? "font-bold text-t0" : "font-bold uppercase text-t0"}>{lojaNome}</span>
          {lojaCodigo && <span className="text-t2"> · Filial {lojaCodigo}</span>}
          {lojaCnpj && <span className="text-t2"> · {lojaCnpj}</span>}
        </p>
        {periodo && (
          <p>
            <span className="text-t2">Período: </span>
            <span className="font-bold text-t0">{periodoTexto}</span>
          </p>
        )}
        {filtros.map((f) => (
          <p key={f.label}>
            <span className="text-t2">{f.label}: </span>
            <span className="font-bold text-t0">{f.valor}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
