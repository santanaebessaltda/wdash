import { Button, Dropdown, type DropdownItem } from "@/components/ui";

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

/** Botão Exportar. O menu lista só os formatos passados — no Dashboard, só PDF. */
export function ExportDialog({
  formats,
  onExport,
  disabled,
}: {
  formats: ExportFormat[];
  onExport: (format: ExportFormat) => void;
  disabled?: boolean;
}) {
  const options = formats.filter((item) => item in FORMAT_COPY);
  const items: DropdownItem[] = options.map((item) => ({
    label: FORMAT_COPY[item].title,
    description: FORMAT_COPY[item].detail,
    onClick: () => {
      // O menu fecha no clique. A exportação espera esse fechamento para o PDF não imprimir o menu aberto.
      queueMicrotask(() => onExport(item));
    },
  }));

  return (
    <Dropdown
      align="right"
      portal
      menuClassName="min-w-[280px] print:hidden"
      items={items}
      trigger={
        <Button type="button" variant="primary" size="md" className="print:hidden" disabled={disabled || options.length === 0} iconRight={<ChevronDown />}>
          Exportar
        </Button>
      }
    />
  );
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
