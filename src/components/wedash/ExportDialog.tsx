import { useState } from "react";
import { flushSync } from "react-dom";
import { Button, Modal } from "@/components/ui";

export type ExportFormat = "csv" | "pdf" | "xlsx";

const FORMAT_COPY: Record<ExportFormat, { title: string; detail: string }> = {
  csv: {
    title: "CSV",
    detail: "Baixa a planilha com os dados desta tela.",
  },
  pdf: {
    title: "PDF",
    detail: "Abre a impressão para salvar o relatório desta tela.",
  },
  xlsx: {
    title: "XLSX",
    detail: "Baixa a planilha do Excel com os dados desta tela.",
  },
};

/** Botão Exportar. O modal lista só os formatos passados — no Dashboard, só PDF. */
export function ExportDialog({
  formats,
  onExport,
  disabled,
}: {
  formats: ExportFormat[];
  onExport: (format: ExportFormat) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = formats.filter((format) => format in FORMAT_COPY);

  function choose(format: ExportFormat) {
    flushSync(() => setOpen(false));
    onExport(format);
  }

  return (
    <>
      <Button type="button" variant="primary" disabled={disabled || options.length === 0} onClick={() => setOpen(true)}>
        Exportar
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Exportar" size="sm">
        <p className="mb-4 text-[13px] leading-relaxed text-t1">Escolha o formato do arquivo.</p>
        <div className="flex flex-col gap-2.5">
          {options.map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => choose(format)}
              className="rounded-[var(--radius-vela-lg)] border border-line px-4 py-3 text-left transition-colors hover:border-acc hover:bg-acc-soft/40"
            >
              <p className="text-[13.5px] font-bold text-t0">{FORMAT_COPY[format].title}</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-t2">{FORMAT_COPY[format].detail}</p>
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
        </div>
      </Modal>
    </>
  );
}
