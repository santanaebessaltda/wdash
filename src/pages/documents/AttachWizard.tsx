import { useEffect, useRef, useState } from "react";
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
  contactFieldsToAsk,
  customDocumentName,
  folderTitle,
  monthFolder,
  defaultSignatureMark,
  placementWarning,
  replicateSetup,
  type SendChannel,
  type SignatureMark,
} from "@/data/wedash/documentSplit";
import {
  assignDocument,
  confirmBatch,
  prepareFiles,
  saveEmployeeContact,
  type DocumentRow,
  type PersonRow,
  type PrepareStatus,
} from "@/data/wedash/documentsRepo";
import { STATUS_LABEL, formatBytes } from "./frame";
import { SignaturePlacement } from "./SignaturePlacement";

const controlClass =
  "h-[42px] w-full rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3.5 text-[13px] text-t0 outline-none transition-colors focus:border-acc";

const STEPS = [
  { num: 1, label: "Anexar" },
  { num: 2, label: "Destinatários" },
  { num: 3, label: "Assinaturas" },
  { num: 4, label: "Revisão" },
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
  const [channels, setChannels] = useState<Record<string, SendChannel>>({});
  const [marks, setMarks] = useState<Record<string, SignatureMark>>({});
  const [sampleId, setSampleId] = useState("");
  const [extraMark, setExtraMark] = useState<SignatureMark | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [reminder, setReminder] = useState("EVERY_3_DAYS");
  const [deadline, setDeadline] = useState("");
  const [extraOn, setExtraOn] = useState(false);
  const [extraName, setExtraName] = useState("");
  const [extraChannel, setExtraChannel] = useState<SendChannel>("EMAIL");
  const [extraEmail, setExtraEmail] = useState("");
  const [extraWhatsapp, setExtraWhatsapp] = useState("");
  const [batchId, setBatchId] = useState("");
  const [refused, setRefused] = useState<{ name: string; message: string }[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<PrepareStatus>({ phase: "upload", index: 1, total: 1, name: "PDF" });
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const rows = documents.filter((doc) => doc.batchId === batchId);
  function channelOf(id: string): SendChannel {
    return channels[id] ?? "WHATSAPP";
  }
  function markOf(row: DocumentRow): SignatureMark {
    return marks[row.id] ?? defaultSignatureMark(row.pageCount);
  }
  const sample = rows.find((row) => row.id === sampleId) ?? rows[0];
  const shownExtra = extraOn && sample ? (extraMark ?? { ...defaultSignatureMark(sample.pageCount), y: 72 }) : null;
  const ready = rows.filter((row) => {
    if (row.envelopeId) return false;
    const person = people.find((item) => item.id === row.sellerId);
    return personReady(person, channelOf(row.id)) && !placementWarning([markOf(row)], row.pageCount);
  });
  const missing = rows.filter((row) => !row.envelopeId).length - ready.length;

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
      const sent = await confirmBatch({
        batchId,
        deadline,
        reminder,
        documents: rows.map((row) => ({ id: row.id, channel: channelOf(row.id), marks: [markOf(row)] })),
        extraSigner: extraOn && shownExtra
          ? { name: extraName.trim(), channel: extraChannel, email: extraEmail.trim() || null, whatsapp: extraWhatsapp.trim() || null, marks: [shownExtra] }
          : null,
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
      <div className="mx-auto max-w-3xl">
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
        ) : step === 2 ? (
          <RecipientsStep
            rows={rows}
            people={people}
            reminder={reminder}
            deadline={deadline}
            extraOn={extraOn}
            extraName={extraName}
            extraChannel={extraChannel}
            extraEmail={extraEmail}
            extraWhatsapp={extraWhatsapp}
            channelOf={channelOf}
            picked={picked}
            error={error}
            onReminder={setReminder}
            onDeadline={setDeadline}
            onExtraOn={setExtraOn}
            onExtraName={setExtraName}
            onExtraChannel={setExtraChannel}
            onExtraEmail={setExtraEmail}
            onExtraWhatsapp={setExtraWhatsapp}
            onChannel={(id, value) => setChannels((current) => ({ ...current, [id]: value }))}
            onPick={(id, value) => setPicked((current) => ({ ...current, [id]: value }))}
            onReplicate={(sourceId) => {
              const source = rows.find((row) => row.id === sourceId);
              const copy = replicateSetup({ channel: channelOf(sourceId), marks: source ? [markOf(source)] : [] });
              setChannels((current) => {
                const next = { ...current };
                for (const row of rows) {
                  if (row.id !== sourceId && picked[row.id]) next[row.id] = copy.channel;
                }
                return next;
              });
              const copied = copy.marks[0];
              if (!copied) return;
              setMarks((current) => {
                const next = { ...current };
                for (const row of rows) {
                  if (row.id !== sourceId && picked[row.id]) next[row.id] = { ...copied };
                }
                return next;
              });
            }}
            onAssign={async (documentId, sellerId) => {
              await assignDocument(documentId, sellerId);
              await onReload();
            }}
            onSave={async (input) => {
              await saveEmployeeContact(input);
              await onReload();
            }}
            onBack={() => setStep(1)}
            onNext={() => {
              if (extraOn && !extraName.trim()) {
                setError("Informe o nome do signatário.");
                return;
              }
              if (extraOn && extraChannel === "EMAIL" && !extraEmail.trim()) {
                setError(DOCUMENT_COPY.noEmail);
                return;
              }
              if (extraOn && extraChannel === "WHATSAPP" && !extraWhatsapp.trim()) {
                setError(DOCUMENT_COPY.noWhatsapp);
                return;
              }
              setError(null);
              setStep(3);
            }}
          />
        ) : step === 3 && sample ? (
          <SignaturePlacement
            rows={rows}
            people={people}
            sampleId={sample.id}
            mark={markOf(sample)}
            extraMark={shownExtra}
            picked={picked}
            onSample={setSampleId}
            onMark={(next) => setMarks((current) => ({ ...current, [sample.id]: next }))}
            onExtraMark={setExtraMark}
            onPick={(id, value) => setPicked((current) => ({ ...current, [id]: value }))}
            onReplicate={() => {
              const copy = replicateSetup({ channel: channelOf(sample.id), marks: [markOf(sample)] });
              setChannels((current) => {
                const next = { ...current };
                for (const row of rows) {
                  if (row.id !== sample.id && picked[row.id]) next[row.id] = copy.channel;
                }
                return next;
              });
              const copied = copy.marks[0];
              if (!copied) return;
              setMarks((current) => {
                const next = { ...current };
                for (const row of rows) {
                  if (row.id !== sample.id && picked[row.id]) next[row.id] = { ...copied };
                }
                return next;
              });
            }}
            onBack={() => setStep(2)}
            onNext={() => {
              setError(null);
              setStep(4);
            }}
          />
        ) : (
          <ReviewStep
            category={category}
            month={Number(month)}
            year={year}
            channelOf={channelOf}
            markOf={markOf}
            extra={
              extraOn && shownExtra
                ? { name: extraName.trim(), channel: extraChannel, pageNumber: shownExtra.pageNumber }
                : null
            }
            rows={rows}
            ready={ready.length}
            missing={missing}
            refused={refused}
            people={people}
            error={error}
            sending={sending}
            onBack={() => setStep(3)}
            onSend={() => void send()}
            onAssign={async (documentId, sellerId) => {
              await assignDocument(documentId, sellerId);
              await onReload();
            }}
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

function personReady(person: PersonRow | undefined, channel: SendChannel) {
  if (!person) return false;
  const ask = contactFieldsToAsk(person, channel);
  return !ask.cpf && !ask.email && !ask.whatsapp;
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
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
        <WizardNav previousLabel="Cancelar" nextLabel="Continuar" onPrevious={onCancel} onNext={onNext} nextDisabled={files.length === 0} />
      </div>
    </>
  );
}

function ChannelSelect({ value, onChange }: { value: SendChannel; onChange: (value: SendChannel) => void }) {
  return (
    <select className={controlClass} value={value} onChange={(event) => onChange(event.target.value as SendChannel)}>
      <option value="WHATSAPP">WhatsApp</option>
      <option value="EMAIL">E-mail</option>
    </select>
  );
}

function RecipientsStep({
  rows,
  people,
  reminder,
  deadline,
  extraOn,
  extraName,
  extraChannel,
  extraEmail,
  extraWhatsapp,
  channelOf,
  picked,
  error,
  onReminder,
  onDeadline,
  onExtraOn,
  onExtraName,
  onExtraChannel,
  onExtraEmail,
  onExtraWhatsapp,
  onChannel,
  onPick,
  onReplicate,
  onAssign,
  onSave,
  onBack,
  onNext,
}: {
  rows: DocumentRow[];
  people: PersonRow[];
  reminder: string;
  deadline: string;
  extraOn: boolean;
  extraName: string;
  extraChannel: SendChannel;
  extraEmail: string;
  extraWhatsapp: string;
  channelOf: (id: string) => SendChannel;
  picked: Record<string, boolean>;
  error: string | null;
  onReminder: (value: string) => void;
  onDeadline: (value: string) => void;
  onExtraOn: (value: boolean) => void;
  onExtraName: (value: string) => void;
  onExtraChannel: (value: SendChannel) => void;
  onExtraEmail: (value: string) => void;
  onExtraWhatsapp: (value: string) => void;
  onChannel: (id: string, value: SendChannel) => void;
  onPick: (id: string, value: boolean) => void;
  onReplicate: (sourceId: string) => void;
  onAssign: (documentId: string, sellerId: string) => Promise<void>;
  onSave: (input: { sellerId: string; cpf?: string; email?: string; whatsapp?: string }) => Promise<void>;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <WizardCardHeader title="Destinatários" subtitle="Cada documento escolhe o canal. O cadastro só é pedido quando ainda falta o contato." />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Lembrete">
          <select className={controlClass} value={reminder} onChange={(event) => onReminder(event.target.value)}>
            <option value="EVERY_DAY">Todo dia</option>
            <option value="EVERY_3_DAYS">A cada 3 dias</option>
            <option value="EVERY_WEEK">Toda semana</option>
            <option value="NEVER">Nunca</option>
          </select>
        </FormField>
        <FormField label="Data limite" optional hint="Depois desta data, o documento ficará expirado se ainda não tiver sido assinado.">
          <input type="date" className={controlClass} value={deadline} onChange={(event) => onDeadline(event.target.value)} />
        </FormField>
      </div>
      <div className="mt-4 rounded-xl border border-line p-3">
        <label className="flex items-center gap-2 text-[13px] font-bold text-t0">
          <input type="checkbox" checked={extraOn} onChange={(event) => onExtraOn(event.target.checked)} />
          Adicionar um signatário neste envio
        </label>
        {extraOn && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <FormField label="Nome">
              <input className={controlClass} value={extraName} onChange={(event) => onExtraName(event.target.value)} />
            </FormField>
            <FormField label="Canal">
              <ChannelSelect value={extraChannel} onChange={onExtraChannel} />
            </FormField>
            {extraChannel === "EMAIL" ? (
              <FormField label="E-mail">
                <input className={controlClass} value={extraEmail} onChange={(event) => onExtraEmail(event.target.value)} />
              </FormField>
            ) : (
              <FormField label="WhatsApp">
                <input className={controlClass} value={extraWhatsapp} onChange={(event) => onExtraWhatsapp(event.target.value)} />
              </FormField>
            )}
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-3">
        {rows.map((row) => (
          <RecipientRow
            key={`${row.id}:${row.sellerId ?? ""}`}
            row={row}
            people={people}
            channel={channelOf(row.id)}
            picked={Boolean(picked[row.id])}
            canReplicate={rows.some((item) => item.id !== row.id && picked[item.id])}
            onChannel={(value) => onChannel(row.id, value)}
            onPick={(value) => onPick(row.id, value)}
            onReplicate={() => onReplicate(row.id)}
            onAssign={onAssign}
            onSave={onSave}
          />
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-4">
        <WizardNav onPrevious={onBack} onNext={onNext} nextLabel="Assinaturas" />
      </div>
    </>
  );
}

function RecipientRow({
  row,
  people,
  channel,
  picked,
  canReplicate,
  onChannel,
  onPick,
  onReplicate,
  onAssign,
  onSave,
}: {
  row: DocumentRow;
  people: PersonRow[];
  channel: SendChannel;
  picked: boolean;
  canReplicate: boolean;
  onChannel: (value: SendChannel) => void;
  onPick: (value: boolean) => void;
  onReplicate: () => void;
  onAssign: (documentId: string, sellerId: string) => Promise<void>;
  onSave: (input: { sellerId: string; cpf?: string; email?: string; whatsapp?: string }) => Promise<void>;
}) {
  const person = people.find((item) => item.id === row.sellerId) ?? null;
  const ask = person ? contactFieldsToAsk(person, channel) : null;
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const alreadySent = Boolean(row.envelopeId);

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="flex min-w-0 items-center gap-2">
          <input type="checkbox" checked={picked} disabled={alreadySent} onChange={(event) => onPick(event.target.checked)} />
          <span className="truncate text-[13px] font-bold text-t0">{folderTitle(row.fileName)}</span>
        </label>
        <Button size="sm" variant="outline" type="button" disabled={!canReplicate || alreadySent} onClick={onReplicate}>
          Replicar
        </Button>
      </div>
      {alreadySent ? (
        <p className="text-[13px] text-t2">{STATUS_LABEL[row.status]}</p>
      ) : !person ? (
        <select className={controlClass} defaultValue="" onChange={(event) => event.target.value && void onAssign(row.id, event.target.value)}>
          <option value="">Escolher colaborador</option>
          {people.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ask || (!ask.cpf && !ask.email && !ask.whatsapp)) return;
            setLocalError(null);
            const input: { sellerId: string; cpf?: string; email?: string; whatsapp?: string } = { sellerId: person.id };
            if (ask.cpf) input.cpf = cpf;
            if (ask.email) input.email = email;
            if (ask.whatsapp) input.whatsapp = whatsapp;
            void onSave(input).catch((reason) => setLocalError(reason instanceof Error ? reason.message : DOCUMENT_COPY.badCpf));
          }}
        >
          <p className="text-[13px] font-bold text-t0">{person.name}</p>
          <FormField label="Canal">
            <ChannelSelect value={channel} onChange={onChannel} />
          </FormField>
          {ask && (ask.cpf || ask.email || ask.whatsapp) && (
            <div className="grid gap-2 sm:grid-cols-2">
              {ask.cpf && (
                <FormField label="CPF">
                  <input className={controlClass} value={cpf} onChange={(event) => setCpf(event.target.value)} />
                </FormField>
              )}
              {ask.email && (
                <FormField label="E-mail">
                  <input className={controlClass} value={email} onChange={(event) => setEmail(event.target.value)} />
                </FormField>
              )}
              {ask.whatsapp && (
                <FormField label="WhatsApp">
                  <input className={controlClass} value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} />
                </FormField>
              )}
            </div>
          )}
          {ask && (ask.cpf || ask.email || ask.whatsapp) && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-bad">{localError}</span>
              <Button size="sm" variant="outline" type="submit">
                Salvar
              </Button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}

function ReviewStep({
  category,
  month,
  year,
  channelOf,
  markOf,
  extra,
  rows,
  ready,
  missing,
  refused,
  people,
  error,
  sending,
  onBack,
  onSend,
  onAssign,
}: {
  category: string;
  month: number;
  year: string;
  channelOf: (id: string) => SendChannel;
  markOf: (row: DocumentRow) => SignatureMark;
  extra: { name: string; channel: SendChannel; pageNumber: number } | null;
  rows: DocumentRow[];
  ready: number;
  missing: number;
  refused: { name: string; message: string }[];
  people: PersonRow[];
  error: string | null;
  sending: boolean;
  onBack: () => void;
  onSend: () => void;
  onAssign: (documentId: string, sellerId: string) => Promise<void>;
}) {
  return (
    <>
      <h3 className="text-lg font-bold text-t0">Revisar e enviar</h3>
      <p className="mt-1 text-[13.5px] text-t2">{category} · {monthFolder(month)}/{year}</p>
      <p className="mt-1 mb-6 text-[13.5px] text-t2">Confira quem recebe cada documento e em qual página está a assinatura.</p>
      {extra && (
        <p className="mb-4 text-[13px] text-t1">
          Signatário extra: {extra.name || "Sem nome"} · {extra.channel === "WHATSAPP" ? "WhatsApp" : "E-mail"} · assinatura na página {extra.pageNumber}
        </p>
      )}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Summary label="Documentos" value={String(rows.length)} />
        <Summary label="Prontos" value={String(ready)} />
        <Summary label="Sem contato" value={String(missing)} />
      </div>
      {refused.length > 0 && (
        <p className="mb-3 text-[13px] text-bad">{refused.map((item) => `${item.name}: ${item.message}`).join(" ")}</p>
      )}
      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <ReviewRow key={`${row.id}:${row.sellerId ?? ""}`} row={row} people={people} channel={channelOf(row.id)} mark={markOf(row)} onAssign={onAssign} />
        ))}
        {rows.length === 0 && (
          <div>
            <p className="text-sm font-bold text-t0">Nenhum documento pronto para envio</p>
            <p className="mt-1 text-sm text-t2">Revise os arquivos recusados ou identifique os colaboradores para continuar.</p>
          </div>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-4">
        <WizardNav previousDisabled={sending} nextDisabled={sending || ready === 0} onPrevious={onBack} onNext={onSend} nextLabel={sending ? "Enviando…" : "Enviar"} />
      </div>
    </>
  );
}

function ReviewRow({
  row,
  people,
  channel,
  mark,
  onAssign,
}: {
  row: DocumentRow;
  people: PersonRow[];
  channel: SendChannel;
  mark: SignatureMark;
  onAssign: (documentId: string, sellerId: string) => Promise<void>;
}) {
  const person = people.find((item) => item.id === row.sellerId) ?? null;
  const ready = personReady(person ?? undefined, channel);
  const alreadySent = Boolean(row.envelopeId);
  const pageWarn = placementWarning([mark], row.pageCount);
  const statusText = alreadySent ? STATUS_LABEL[row.status] : !person ? "Colaborador não identificado" : pageWarn ?? (ready ? "Pronto para enviar" : "Falta contato no cadastro");

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-[13px] font-bold text-t0">{folderTitle(row.fileName)}</p>
        <span className={cn("text-right text-[11px] font-semibold", alreadySent ? "text-t2" : ready && !pageWarn ? "text-ok" : "text-bad")}>{statusText}</span>
      </div>
      {!person ? (
        <select className={controlClass} defaultValue="" onChange={(event) => event.target.value && void onAssign(row.id, event.target.value)}>
          <option value="">Escolher colaborador</option>
          {people.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-[13px] text-t1">
          {person.name} · {channel === "WHATSAPP" ? "WhatsApp" : "E-mail"} · assinatura na página {mark.pageNumber}
        </p>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-t2">{label}</p>
      <p className="mt-1 text-xl font-extrabold text-t0">{value}</p>
    </div>
  );
}

