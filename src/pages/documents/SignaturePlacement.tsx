import { useEffect, useRef, useState, type PointerEvent } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type RenderTask } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button, FormField, WizardCardHeader, WizardNav } from "@/components/ui";
import { Spinner } from "@/components/ui/Skeleton";
import { folderTitle, type SignatureMark } from "@/data/wedash/documentSplit";
import { openDocument, type DocumentRow, type PersonRow } from "@/data/wedash/documentsRepo";

GlobalWorkerOptions.workerSrc = pdfWorker;

function pointOn(event: PointerEvent<HTMLDivElement>, pageNumber: number): SignatureMark {
  const box = event.currentTarget.getBoundingClientRect();
  const x = Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100));
  const y = Math.min(100, Math.max(0, ((event.clientY - box.top) / box.height) * 100));
  return { pageNumber, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, element: "SIGNATURE" };
}

export function SignaturePlacement({
  rows,
  people,
  sampleId,
  mark,
  extraMark,
  picked,
  onSample,
  onMark,
  onExtraMark,
  onPick,
  onReplicate,
  onBack,
  onNext,
}: {
  rows: DocumentRow[];
  people: PersonRow[];
  sampleId: string;
  mark: SignatureMark;
  extraMark: SignatureMark | null;
  picked: Record<string, boolean>;
  onSample: (id: string) => void;
  onMark: (mark: SignatureMark) => void;
  onExtraMark: (mark: SignatureMark) => void;
  onPick: (id: string, value: boolean) => void;
  onReplicate: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(mark.pageNumber);
  const [placing, setPlacing] = useState<"person" | "extra">("person");
  const [pageTotal, setPageTotal] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sample = rows.find((row) => row.id === sampleId) ?? rows[0];
  const canReplicate = rows.some((row) => row.id !== sample?.id && picked[row.id]);

  useEffect(() => {
    setPage(mark.pageNumber);
  }, [sampleId, mark.pageNumber]);

  useEffect(() => {
    if (!sample) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const url = await openDocument(sample.id);
        if (cancelled) return;
        loadingTask = getDocument({ url });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const total = pdf.numPages;
        setPageTotal(total);
        const safePage = Math.min(Math.max(1, page), total);
        const pdfPage = await pdf.getPage(safePage);
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale: 1.2 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        renderTask = pdfPage.render({ canvas, viewport });
        await renderTask.promise;
        if (!cancelled) setLoading(false);
      } catch {
        if (!cancelled) {
          setLoading(false);
          setError("Não foi possível abrir esta página.");
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [sample?.id, page]);

  if (!sample) return null;
  const person = people.find((item) => item.id === sample.sellerId);

  return (
    <>
      <WizardCardHeader title="Assinaturas" subtitle="A marca começa no centro da última página. Arraste para o lugar da assinatura." />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <FormField label="Documento de exemplo">
          <select
            className="h-[42px] w-full rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3.5 text-[13px] text-t0 outline-none"
            value={sample.id}
            onChange={(event) => onSample(event.target.value)}
          >
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {folderTitle(row.fileName)}
              </option>
            ))}
          </select>
        </FormField>
        <div className="flex items-end">
          <Button type="button" size="sm" variant="outline" disabled={!canReplicate} onClick={onReplicate}>
            Replicar
          </Button>
        </div>
      </div>
      <p className="mt-2 text-[12.5px] text-t2">
        {person ? person.name : "Colaborador não identificado"}
        {" · "}
        marque os outros documentos e replique. O contato de cada pessoa permanece o do cadastro.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        {rows
          .filter((row) => row.id !== sample.id)
          .map((row) => (
            <label key={row.id} className="flex items-center gap-2 text-[12.5px] text-t1">
              <input type="checkbox" checked={Boolean(picked[row.id])} onChange={(event) => onPick(row.id, event.target.checked)} />
              {folderTitle(row.fileName)}
            </label>
          ))}
      </div>
      <div className="relative mt-4 overflow-auto rounded-xl border border-line bg-bg-inset">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-inset/80">
            <Spinner size={22} />
          </div>
        )}
        <div
          className="relative mx-auto w-fit"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const next = pointOn(event, page);
            if (placing === "extra" && extraMark) onExtraMark(next);
            else onMark(next);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const next = pointOn(event, page);
            if (placing === "extra" && extraMark) onExtraMark(next);
            else onMark(next);
          }}
        >
          <canvas ref={canvasRef} className="block max-w-full" />
          {mark.pageNumber === page && (
            <span
              className="pointer-events-none absolute rounded-md border border-acc bg-acc-soft px-2 py-1 text-[11px] font-bold text-acc"
              style={{ left: `${mark.x}%`, top: `${mark.y}%`, transform: "translate(-50%, -50%)" }}
            >
              Assinar
            </span>
          )}
          {extraMark && extraMark.pageNumber === page && (
            <span
              className="pointer-events-none absolute rounded-md border border-warn bg-warn-soft px-2 py-1 text-[11px] font-bold text-warn"
              style={{ left: `${extraMark.x}%`, top: `${extraMark.y}%`, transform: "translate(-50%, -50%)" }}
            >
              Signatário
            </span>
          )}
        </div>
      </div>
      {extraMark && (
        <div className="mt-3 flex gap-2">
          <Button type="button" size="sm" variant={placing === "person" ? "primary" : "outline"} onClick={() => setPlacing("person")}>
            Assinatura
          </Button>
          <Button type="button" size="sm" variant={placing === "extra" ? "primary" : "outline"} onClick={() => setPlacing("extra")}>
            Signatário extra
          </Button>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-3">
        <Button type="button" size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
          Página anterior
        </Button>
        <span className="text-[12.5px] text-t2">
          Página {page} de {pageTotal}
        </span>
        <Button type="button" size="sm" variant="secondary" disabled={page >= pageTotal} onClick={() => setPage((current) => current + 1)}>
          Próxima página
        </Button>
      </div>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-4">
        <WizardNav onPrevious={onBack} onNext={onNext} nextLabel="Revisar" />
      </div>
    </>
  );
}
