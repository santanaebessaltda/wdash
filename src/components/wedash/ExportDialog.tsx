import { useState } from "react";
import { flushSync } from "react-dom";
import { Button, Modal } from "@/components/ui";
import { PickerRow } from "@/components/wedash/ConnectionList";

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
  const options = formats.filter((item) => item in FORMAT_COPY);

  function choose(next: ExportFormat) {
    flushSync(() => setOpen(false));
    onExport(next);
  }

  return (
    <>
      <Button type="button" variant="primary" disabled={disabled || options.length === 0} onClick={() => setOpen(true)}>
        Exportar
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Exportar"
        footer={
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
        }
      >
        <p className="mb-3 text-[13.5px] leading-relaxed text-t1">Escolha o formato do arquivo.</p>
        <div className="flex flex-col gap-2.5">
          {options.map((item) => (
            <PickerRow key={item} name={FORMAT_COPY[item].title} detail={FORMAT_COPY[item].detail} onClick={() => choose(item)} />
          ))}
        </div>
      </Modal>
    </>
  );
}
