import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs, Button, Card, CardHeader, CardTitle, FormField, ProgressBar, WizardCardHeader, WizardNav, WizardSteps } from "@/components/ui";
import { Spinner } from "@/components/ui/Skeleton";
import { paths } from "@/router/paths";
import { Icon, icons } from "@/pages/users/Icons";
import { useDocuments } from "./useDocuments";
import { cn } from "@/lib/cn";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_COPY,
  DOCUMENT_LIMITS,
  customDocumentName,
  extraSignersFrom,
  fieldAfterDrop,
  monthFolder,
  remainingPages,
  resolveDrafts,
  sellerMarks,
  type DocumentDraft,
} from "@/data/wedash/documentSplit";
import {
  assignDocument,
  confirmBatch,
  dropDocumentPage,
  prepareFiles,
  saveEmployeeContact,
  type DocumentRow,
  type PersonRow,
  type PrepareStatus,
} from "@/data/wedash/documentsRepo";
import { formatBytes } from "./frame";
import { DocumentReview } from "./DocumentReview";
import { fetchSystemUsers } from "@/data/wedash/systemUsers";

const controlClass =
  "h-[42px] w-full rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3.5 text-[13px] text-t0 outline-none transition-colors focus:border-acc";

const STEPS = [
  { num: 1, label: "Anexar" },
  { num: 2, label: "Destinatários" },
];

export function AttachWizard({
  storeId,
  people,
  documents,
  onReload,
  onClose,
  onDone,
}: {
  storeId: string | null;
  people: PersonRow[];
  documents: DocumentRow[];
  onReload: () => Promise<void>;
  onClose: () => void;
  onDone: (message: string | null) => void;
}) {
  const [step, setStep] = useState(1);
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [category, setCategory] = useState<string>(DOCUMENT_CATEGORIES[0]);
  const [customName, setCustomName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DocumentDraft | undefined>>({});
  const [activeId, setActiveId] = useState("");
  const openAtStart = useRef(true);
  const [batchId, setBatchId] = useState("");
  const [refused, setRefused] = useState<{ name: string; message: string }[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<PrepareStatus>({ phase: "upload", index: 1, total: 1, name: "PDF" });
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [signers, setSigners] = useState<{ id: string; name: string; email: string }[]>([]);

  useEffect(() => {
    void fetchSystemUsers().then((result) => {
      if (!result.ok) return;
      setSigners(
        result.data.members
          .filter((member) => member.status === "ACTIVE" && member.email)
          .map((member) => ({ id: member.membershipId, name: member.name || member.email, email: member.email })),
      );
    });
  }, []);

  const rows = useMemo(
    () =>
      documents
        .filter((doc) => doc.batchId === batchId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    [documents, batchId],
  );
  const rowKey = rows.map((row) => `${row.id}:${row.pageCount}`).join("|");

  useEffect(() => {
    if (step !== 2) {
      openAtStart.current = true;
      return;
    }
    if (!openAtStart.current || rows.length === 0) return;
    openAtStart.current = false;
    setActiveId(rows[0].id);
  }, [step, rows]);

  useEffect(() => {
    if (step !== 2 || rows.length === 0) return;
    const id = rows.some((row) => row.id === activeId) ? activeId : rows[0].id;
    setDrafts((current) => {
      if (current[id]) return current;
      const list = resolveDrafts(
        rows.map((row) => ({ id: row.id, pageCount: row.pageCount })),
        current,
      );
      const index = rows.findIndex((row) => row.id === id);
      return { ...current, [id]: list[index] };
    });
    if (id !== activeId) setActiveId(id);
  }, [step, rowKey, activeId]);

  async function split() {
    if (batchId) {
      setStep(2);
      return;
    }
    if (files.length === 0) {
      setError("Anexe pelo menos um PDF.");
      return;
    }
    const named = category === "Outros" ? customDocumentName(customName) : null;
    if (named && !named.ok) {
      setError(named.message);
      return;
    }
    setProcessing(true);
    setProgress({ phase: "upload", index: 1, total: files.length, name: files[0]?.name ?? "PDF" });
    setError(null);
    try {
      const prepared = await prepareFiles({
        storeId,
        month: Number(month),
        year: Number(year),
        category,
        title: named && named.ok ? named.name : undefined,
        unify: true,
        files,
        onProgress: setProgress,
      });
      setBatchId(prepared.batchId);
      setRefused(prepared.refused);
      setProgress({ phase: "review" });
      await onReload();
      setStep(2);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível ler os PDFs.");
    } finally {
      setProcessing(false);
    }
  }

  async function send() {
    setSending(true);
    setError(null);
    try {
      const resolved = resolveDrafts(
        rows.map((row) => ({ id: row.id, pageCount: row.pageCount })),
        drafts,
      );
      const sent = await confirmBatch({
        batchId,
        deadline: "",
        reminder: "EVERY_3_DAYS",
        documents: rows.map((row, index) => ({
          id: row.id,
          channel: resolved[index].channel,
          marks: sellerMarks(resolved[index].fields),
          deadline: resolved[index].deadline,
          reminder: resolved[index].reminder,
          extraSigners: extraSignersFrom(resolved[index].fields, signers, row.pageCount, {
            people,
            guests: resolved[index].guests,
            channel: resolved[index].channel,
          }),
        })),
        extraSigner: null,
      });
      await onReload();
      const failed = (sent.results ?? []).filter((item) => item.error);
      if (failed.length > 0) {
        setError("Alguns documentos não foram enviados. Corrija os documentos com erro ou sem contato e envie novamente. Os documentos já enviados não serão duplicados.");
        setSending(false);
        return;
      }
      const refusedText = refused.map((item) => `${item.name}: ${item.message}`).join(" ");
      onDone(refusedText || null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar os documentos. Tente novamente.");
      setSending(false);
    }
  }

  function leave() {
    if (processing || sending) return;
    onClose();
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" icon={<Icon d={icons.arrowLeft} size={14} />} disabled={processing || sending} onClick={leave}>
          Voltar
        </Button>
        <Breadcrumbs items={[{ label: "Documentos", to: paths.documents }, { label: "Anexar documento" }]} />
      </div>
      <div className={cn("mx-auto", step === 2 ? "max-w-6xl" : "max-w-3xl")}>
      <WizardSteps steps={STEPS} current={step} />
      <div>
        {processing ? (
          <Processing key={progress.phase} status={progress} />
        ) : step === 1 ? (
          <UploadStep
            month={month}
            year={year}
            category={category}
            customName={customName}
            files={files}
            error={error}
            onMonth={setMonth}
            onYear={setYear}
            onCategory={setCategory}
            onCustomName={setCustomName}
            onFiles={(next) => {
              setFiles(next);
              setBatchId("");
            }}
            onError={setError}
            onCancel={leave}
            onNext={() => void split()}
          />
        ) : (
          <DocumentReview
            rows={rows}
            people={people}
            drafts={drafts}
            signers={signers}
            activeId={activeId}
            refused={refused}
            error={error}
            sending={sending}
            onFocus={(id) => {
              setActiveId(id);
              setDrafts((current) => {
                if (current[id]) return current;
                const list = resolveDrafts(
                  rows.map((row) => ({ id: row.id, pageCount: row.pageCount })),
                  current,
                );
                const index = rows.findIndex((row) => row.id === id);
                if (index < 0) return current;
                return { ...current, [id]: list[index] };
              });
            }}
            onDraft={(id, draft) => setDrafts((current) => ({ ...current, [id]: draft }))}
            onAssign={async (documentId, sellerId) => {
              await assignDocument(documentId, sellerId);
              await onReload();
            }}
            onDrop={async (documentId, pageNumber) => {
              const row = rows.find((item) => item.id === documentId);
              if (!row) return;
              await dropDocumentPage(documentId, pageNumber);
              const nextCount = remainingPages(row.pageCount, pageNumber);
              setDrafts((current) => {
                const draft = current[documentId];
                if (!draft) return current;
                if (nextCount == null) {
                  const next = { ...current };
                  delete next[documentId];
                  return next;
                }
                return {
                  ...current,
                  [documentId]: {
                    ...draft,
                    fields: draft.fields.map((field) => fieldAfterDrop(field, pageNumber, nextCount)),
                  },
                };
              });
              if (nextCount == null) {
                const index = rows.findIndex((item) => item.id === documentId);
                const neighbor = rows[index + 1] ?? rows[index - 1];
                setActiveId(neighbor?.id ?? "");
              }
              await onReload();
            }}
            onSave={async (input) => {
              await saveEmployeeContact(input);
              await onReload();
            }}
            onBack={() => setStep(1)}
            onSend={() => void send()}
          />
        )}
      </div>
      </div>
    </div>
  );
}

export function AttachPage() {
  const navigate = useNavigate();
  const { storeId, people, documents, reload } = useDocuments();
  return (
    <AttachWizard
      storeId={storeId}
      people={people}
      documents={documents}
      onReload={reload}
      onClose={() => navigate(paths.documents)}
      onDone={(message) =>
        navigate(paths.documents, {
          state: { documentNotice: message, documentSent: message ? null : "Documentos enviados." },
        })
      }
    />
  );
}


const READ_LINES = ["Lendo as páginas…", "Identificando os colaboradores…", "Separando os documentos…"];

function Processing({ status }: { status: PrepareStatus }) {
  const [readIndex, setReadIndex] = useState(0);

  useEffect(() => {
    if (status.phase !== "read") return;
    setReadIndex(0);
    const timer = window.setInterval(() => setReadIndex((current) => Math.min(current + 1, READ_LINES.length - 1)), 2200);
    return () => window.clearInterval(timer);
  }, [status.phase]);

  const label =
    status.phase === "upload"
      ? status.total > 1
        ? `Enviando ${status.name} · ${status.index} de ${status.total}`
        : `Enviando ${status.name}…`
      : status.phase === "review"
        ? "Preparando a revisão…"
        : READ_LINES[readIndex];

  return (
    <div className="flex flex-col items-center py-10 text-center">
      <Spinner size={28} />
      <h3 className="mt-4 text-lg font-bold text-t0">Preparando os documentos</h3>
      <p className="mt-2 min-h-5 text-[13.5px] text-t1" aria-live="polite">
        {label}
      </p>
      <p className="mt-1 text-[12.5px] text-t2">Nenhum documento é enviado para assinatura nesta etapa.</p>
    </div>
  );
}

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function AttachedFiles({ files, onRemove }: { files: File[]; onRemove: (file: File) => void }) {
  const [progress, setProgress] = useState<Record<string, number>>({});

  useEffect(() => {
    const timer = window.setInterval(() => {
      setProgress((current) => {
        const next: Record<string, number> = {};
        let changed = false;
        for (const file of files) {
          const value = current[fileKey(file)] ?? 0;
          const updated = Math.min(100, value + (value === 0 ? 24 : 19));
          next[fileKey(file)] = updated;
          if (updated !== value) changed = true;
        }
        return changed ? next : current;
      });
    }, 90);
    return () => window.clearInterval(timer);
  }, [files]);

  const ready = files.filter((file) => (progress[fileKey(file)] ?? 0) >= 100).length;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Documentos anexados</CardTitle>
        <span className="text-[12.5px] text-t2">
          {ready} de {files.length} prontos
        </span>
      </CardHeader>
      <div className="flex flex-col gap-3.5">
        {files.map((file) => {
          const pct = progress[fileKey(file)] ?? 0;
          const done = pct >= 100;
          return (
            <div key={fileKey(file)} className="flex items-center gap-3.5 rounded-xl border border-line bg-bg-inset p-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--bad-soft)", color: "var(--bad)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="truncate text-[13.5px] font-bold text-t0">{file.name}</span>
                  <span className="shrink-0 text-xs text-t2">{formatBytes(file.size)}</span>
                </div>
                {done ? (
                  <div className="flex items-center gap-1.5">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    <span className="text-[11.5px] font-semibold text-ok">Anexo pronto</span>
                  </div>
                ) : (
                  <>
                    <ProgressBar value={pct} height={5} />
                    <p className="mt-1 text-[11px] text-t2">{pct}%</p>
                  </>
                )}
              </div>
              <button
                type="button"
                aria-label={`Remover ${file.name}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-line text-bad transition-colors hover:bg-bad-soft"
                onClick={() => onRemove(file)}
              >
                <Icon d={icons.trash} size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function UploadStep({
  month,
  year,
  category,
  customName,
  files,
  error,
  onMonth,
  onYear,
  onCategory,
  onCustomName,
  onFiles,
  onError,
  onCancel,
  onNext,
}: {
  month: string;
  year: string;
  category: string;
  customName: string;
  files: File[];
  error: string | null;
  onMonth: (value: string) => void;
  onYear: (value: string) => void;
  onCategory: (value: string) => void;
  onCustomName: (value: string) => void;
  onFiles: (files: File[]) => void;
  onError: (message: string | null) => void;
  onCancel: () => void;
  onNext: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function take(incoming: File[]) {
    const next = [...files];
    const notes: string[] = [];
    for (const file of incoming) {
      const pdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (!pdf) {
        notes.push(`${file.name}: ${DOCUMENT_COPY.notPdf}`);
        continue;
      }
      if (file.size > DOCUMENT_LIMITS.maxSourceBytes) {
        notes.push(`${file.name}: ${DOCUMENT_COPY.tooBigSource}`);
        continue;
      }
      if (next.length >= DOCUMENT_LIMITS.maxFiles) {
        notes.push(DOCUMENT_COPY.tooMany);
        break;
      }
      if (!next.some((item) => item.name === file.name && item.size === file.size)) next.push(file);
    }
    onFiles(next);
    onError(notes.length ? notes.join(" ") : null);
  }

  return (
    <>
      <WizardCardHeader title="Anexar documentos" subtitle="Envie até 5 PDFs. A WDash identifica o CPF em cada página e reúne as páginas do mesmo colaborador em um único documento." />
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Mês">
          <select className={controlClass} value={month} onChange={(event) => onMonth(event.target.value)}>
            {Array.from({ length: 12 }, (_, index) => (
              <option key={index + 1} value={index + 1}>
                {monthFolder(index + 1)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Ano">
          <input className={controlClass} value={year} onChange={(event) => onYear(event.target.value)} />
        </FormField>
        <FormField label="Tipo do documento">
          <select className={controlClass} value={category} onChange={(event) => onCategory(event.target.value)}>
            {DOCUMENT_CATEGORIES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </FormField>
      </div>
      {category === "Outros" && (
        <div className="mt-3">
          <FormField label="Nome do documento" hint="Este nome será usado na pasta e no arquivo enviado ao colaborador.">
            <input className={controlClass} value={customName} placeholder="Ex.: Termo de férias" onChange={(event) => onCustomName(event.target.value)} />
          </FormField>
        </div>
      )}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          take([...event.dataTransfer.files]);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn("mt-4 cursor-pointer rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors", dragOver ? "border-acc bg-acc-soft" : "border-line")}
      >
        <div className="mx-auto mb-4 flex items-center justify-center rounded-2xl bg-acc-soft" style={{ height: 60, width: 60 }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
        </div>
        <h3 className="text-[17px] font-bold text-t0">Arraste e solte os PDFs aqui</h3>
        <p className="mt-2 text-[13.5px] text-t2">ou clique para selecionar até 5 arquivos</p>
        <p className="mt-1 text-[12px] text-t2">PDF · até 15 MB e 1.000 páginas por arquivo</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(event) => {
            take([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
      </div>
      {files.length > 0 && <AttachedFiles files={files} onRemove={(file) => onFiles(files.filter((item) => item !== file))} />}
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-4">
        <WizardNav previousLabel="Cancelar" nextLabel="Continuar" hideNextIcon onPrevious={onCancel} onNext={onNext} nextDisabled={files.length === 0} />
      </div>
    </>
  );
}
