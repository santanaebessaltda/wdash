import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button, Modal } from "@/components/ui";

export type ExportFormat = "csv" | "pdf" | "xlsx";

export type ExportStore = { id: string; name: string };

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
  stores,
}: {
  formats: ExportFormat[];
  onExport: (format: ExportFormat, storeIds?: string[]) => void;
  disabled?: boolean;
  /** Com Todas as filiais, a pessoa marca quais entram no arquivo antes do formato. */
  stores?: ExportStore[];
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"stores" | "format">("format");
  const [selected, setSelected] = useState<string[]>([]);
  const allRef = useRef<HTMLInputElement>(null);
  const options = formats.filter((format) => format in FORMAT_COPY);
  const askStores = (stores?.length ?? 0) > 1;
  const allOn = askStores && stores!.every((store) => selected.includes(store.id));
  const some = askStores && selected.length > 0 && !allOn;

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = some;
  }, [some, open, step]);

  function openModal() {
    setSelected(stores?.map((store) => store.id) ?? []);
    setStep(askStores ? "stores" : "format");
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  function toggleAll() {
    setSelected(allOn ? [] : (stores?.map((store) => store.id) ?? []));
  }

  function toggleStore(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function choose(format: ExportFormat) {
    const ids = askStores ? selected : undefined;
    flushSync(() => setOpen(false));
    onExport(format, ids);
  }

  const chosenLabel = !askStores
    ? ""
    : allOn
      ? "Todas as filiais."
      : selected.length === 1
        ? (stores!.find((store) => store.id === selected[0])?.name ?? "1 filial.")
        : `${selected.length} filiais selecionadas.`;

  return (
    <>
      <Button type="button" variant="primary" disabled={disabled || options.length === 0} onClick={openModal}>
        Exportar
      </Button>
      <Modal open={open} onClose={close} title="Exportar" size="sm">
        {step === "stores" && stores ? (
          <>
            <p className="mb-4 text-[13px] leading-relaxed text-t1">Quais filiais entram no arquivo?</p>
            <label className="flex items-center gap-2 border-b border-line pb-3 text-[13.5px] font-bold text-t0">
              <input
                ref={allRef}
                type="checkbox"
                checked={allOn}
                onChange={toggleAll}
                style={{ accentColor: "var(--acc)" }}
                className="h-4 w-4 shrink-0 rounded"
              />
              Marcar todas
            </label>
            <div className="mt-3 flex max-h-64 flex-col gap-2.5 overflow-y-auto">
              {stores.map((store) => (
                <label key={store.id} className="flex items-center gap-2 text-[13px] text-t0">
                  <input
                    type="checkbox"
                    checked={selected.includes(store.id)}
                    onChange={() => toggleStore(store.id)}
                    style={{ accentColor: "var(--acc)" }}
                    className="h-4 w-4 shrink-0 rounded"
                  />
                  <span className="uppercase">{store.name}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={close}>
                Cancelar
              </Button>
              <Button size="sm" disabled={selected.length === 0} onClick={() => setStep("format")}>
                Continuar
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-1 text-[13px] leading-relaxed text-t1">Escolha o formato do arquivo.</p>
            {askStores ? <p className="mb-4 text-[12.5px] text-t2">{chosenLabel}</p> : <div className="mb-4" />}
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
            <div className="mt-4 flex justify-end gap-2">
              {askStores ? (
                <Button variant="outline" size="sm" onClick={() => setStep("stores")}>
                  Voltar
                </Button>
              ) : null}
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
