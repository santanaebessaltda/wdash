import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button, Checkbox, Modal, Radio } from "@/components/ui";

export type ExportFormat = "csv" | "pdf" | "xlsx";

export type ExportStore = { id: string; name: string; detail?: string | null };

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

const PDF_WITH_STORES = "Gera um relatório em PDF com as filiais selecionadas.";

/** Botão Exportar. O modal lista só os formatos passados — no Dashboard, só PDF. */
export function ExportDialog({
  formats,
  onExport,
  disabled,
  stores,
}: {
  formats: ExportFormat[];
  onExport: (format: ExportFormat, storeIds?: string[]) => void;
  disabled?: boolean;
  /** Com Todas as filiais, a pessoa marca quais entram no arquivo no mesmo modal do formato. */
  stores?: ExportStore[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [format, setFormat] = useState<ExportFormat | null>(null);
  const [exporting, setExporting] = useState(false);
  const allRef = useRef<HTMLInputElement>(null);
  const options = formats.filter((item) => item in FORMAT_COPY);
  const askStores = (stores?.length ?? 0) > 1;
  const allOn = askStores && stores!.every((store) => selected.includes(store.id));
  const some = askStores && selected.length > 0 && !allOn;

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = some;
  }, [some, open]);

  function openModal() {
    setSelected(stores?.map((store) => store.id) ?? []);
    setFormat(options[0] ?? null);
    setExporting(false);
    setOpen(true);
  }

  function close() {
    if (exporting) return;
    setOpen(false);
  }

  function toggleAll() {
    setSelected(allOn ? [] : (stores?.map((store) => store.id) ?? []));
  }

  function toggleStore(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function choose(next: ExportFormat) {
    flushSync(() => setOpen(false));
    onExport(next);
  }

  function confirm() {
    if (!format || (askStores && selected.length === 0)) return;
    setExporting(true);
    const ids = askStores ? selected : undefined;
    const chosen = format;
    requestAnimationFrame(() => {
      flushSync(() => {
        setOpen(false);
        setExporting(false);
      });
      onExport(chosen, ids);
    });
  }

  return (
    <>
      <Button type="button" variant="primary" disabled={disabled || options.length === 0} onClick={openModal}>
        Exportar
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Exportar"
        size="sm"
        footer={
          askStores ? (
            <>
              <Button variant="outline" size="sm" onClick={close} disabled={exporting}>
                Cancelar
              </Button>
              <Button size="sm" onClick={confirm} disabled={exporting || selected.length === 0 || format == null}>
                {exporting ? "Exportando…" : "Exportar"}
              </Button>
            </>
          ) : undefined
        }
      >
        {askStores && stores ? (
          <>
            <p className="mb-1.5 text-[12.5px] font-bold text-t0">Selecione as filiais</p>
            <Checkbox
              ref={allRef}
              className="w-full border-b border-line pb-3 font-bold"
              checked={allOn}
              onChange={toggleAll}
              disabled={exporting}
              label="Todas as filiais"
            />
            <div className="mt-3 flex max-h-52 flex-col gap-2.5 overflow-y-auto">
              {stores.map((store) => (
                <Checkbox
                  key={store.id}
                  className="items-start"
                  checked={selected.includes(store.id)}
                  onChange={() => toggleStore(store.id)}
                  disabled={exporting}
                  label={
                    <span className="min-w-0 leading-none">
                      <span className="block truncate text-[12px] font-bold uppercase leading-tight">{store.name}</span>
                      {store.detail ? <span className="mt-0.5 block truncate text-[10px] font-normal leading-tight text-t2">{store.detail}</span> : null}
                    </span>
                  }
                />
              ))}
            </div>
            <p className="mb-1.5 mt-5 text-[12.5px] font-bold text-t0">Formato</p>
            <div className="flex flex-col gap-2.5">
              {options.map((item) => (
                <Radio
                  key={item}
                  name="export-format"
                  className="items-start"
                  checked={format === item}
                  onChange={() => setFormat(item)}
                  disabled={exporting}
                  label={
                    <span className="min-w-0">
                      <span className="block font-bold leading-tight">{FORMAT_COPY[item].title}</span>
                      <span className="mt-0.5 block text-[12.5px] font-normal leading-snug text-t2">
                        {item === "pdf" ? PDF_WITH_STORES : FORMAT_COPY[item].detail}
                      </span>
                    </span>
                  }
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="mb-4 text-[13px] leading-relaxed text-t1">Escolha o formato do arquivo.</p>
            <div className="flex flex-col gap-2.5">
              {options.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => choose(item)}
                  className="rounded-[var(--radius-vela-lg)] border border-line px-4 py-3 text-left transition-colors hover:border-acc hover:bg-acc-soft/40"
                >
                  <p className="text-[13.5px] font-bold text-t0">{FORMAT_COPY[item].title}</p>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-t2">{FORMAT_COPY[item].detail}</p>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="outline" size="sm" onClick={close}>
                Cancelar
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
