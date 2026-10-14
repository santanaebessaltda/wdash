import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Card, CardHeader, CardTitle, ProgressBar, WizardCardHeader, WizardNav, WizardSteps } from "@/components/ui";
import { cn } from "@/lib/cn";
import { DOCUMENT_CATEGORIES, DOCUMENT_COPY, DOCUMENT_LIMITS, monthFolder } from "@/data/wedash/documentSplit";
import {
  assignDocument,
  confirmBatch,
  prepareFiles,
  saveEmployeeContact,
  type DocumentRow,
  type PersonRow,
} from "@/data/wedash/documentsRepo";
import { STATUS_LABEL, formatBytes } from "./frame";

const STEPS = [
  { num: 1, label: "Upload" },
  { num: 2, label: "Envio" },
  { num: 3, label: "Revisão" },
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
  const [unify, setUnify] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [channel, setChannel] = useState<"WHATSAPP" | "EMAIL">("WHATSAPP");
  const [reminder, setReminder] = useState("EVERY_3_DAYS");
  const [deadline, setDeadline] = useState("");
  const [batchId, setBatchId] = useState("");
  const [refused, setRefused] = useState<{ name: string; message: string }[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const rows = documents.filter((doc) => doc.batchId === batchId);
  const ready = rows.filter((row) => personReady(people.find((person) => person.id === row.sellerId), channel));
  const missing = rows.length - ready.length;

  async function split() {
    if (batchId) {
      setStep(2);
      return;
    }
    if (files.length === 0) {
      setError("Anexe pelo menos um PDF.");
      return;
    }
    setProcessing(true);
    setError(null);
    try {
      const prepared = await prepareFiles({ storeId, month: Number(month), year: Number(year), category, unify, files });
      setBatchId(prepared.batchId);
      setRefused(prepared.refused);
      await onReload();
      setStep(2);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível ler os PDFs.");
    } finally {
      setProcessing(false);
    }
  }

  async function send() {
    if (!deadline) {
      setError(DOCUMENT_COPY.deadline);
      setStep(2);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const sent = await confirmBatch({ batchId, channel, deadline, reminder });
      await onReload();
      const failed = (sent.results ?? []).filter((item) => item.error);
      if (failed.length > 0) {
        setError("Quem está sem contato ou com erro não foi enviado. Ajuste a linha e envie de novo.");
        setSending(false);
        return;
      }
      const refusedText = refused.map((item) => `${item.name}: ${item.message}`).join(" ");
      onDone(refusedText || null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar.");
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <WizardSteps steps={STEPS} current={step} />
      <Card padding="lg">
        {processing ? (
          <Processing />
        ) : step === 1 ? (
          <UploadStep
            month={month}
            year={year}
            category={category}
            unify={unify}
            files={files}
            error={error}
            onMonth={setMonth}
            onYear={setYear}
            onCategory={setCategory}
            onUnify={setUnify}
            onFiles={(next) => {
              setFiles(next);
              setBatchId("");
            }}
            onError={setError}
            onCancel={onClose}
            onNext={() => void split()}
          />
        ) : step === 2 ? (
          <SettingsStep
            channel={channel}
            reminder={reminder}
            deadline={deadline}
            error={error}
            onChannel={setChannel}
            onReminder={setReminder}
            onDeadline={setDeadline}
            onBack={() => setStep(1)}
            onNext={() => {
              if (!deadline) {
                setError(DOCUMENT_COPY.deadline);
                return;
              }
              setError(null);
              setStep(3);
            }}
          />
        ) : (
          <ReviewStep
            category={category}
            month={Number(month)}
            year={year}
            channel={channel}
            rows={rows}
            ready={ready.length}
            missing={missing}
            refused={refused}
            people={people}
            error={error}
            sending={sending}
            onBack={() => setStep(2)}
            onSend={() => void send()}
            onAssign={async (documentId, sellerId) => {
              await assignDocument(documentId, sellerId);
              await onReload();
            }}
            onSave={async (input) => {
              await saveEmployeeContact(input);
              await onReload();
            }}
          />
        )}
      </Card>
    </div>
  );
}

function personReady(person: PersonRow | undefined, channel: "WHATSAPP" | "EMAIL") {
  if (!person) return false;
  return channel === "WHATSAPP" ? Boolean(person.whatsapp) : Boolean(person.email);
}

function Processing() {
  return (
    <div className="py-8 text-center">
      <h3 className="text-lg font-bold text-t0">Separando os PDFs</h3>
      <p className="mt-2 text-[13.5px] text-t2">Lendo o texto e o CPF de cada página. Nada é enviado nesta etapa.</p>
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
                    <div className="mt-1 flex justify-between text-[11px] text-t2">
                      <span>{pct}%</span>
                      <span>{Math.max(1, Math.round((100 - pct) / 30))}s restantes</span>
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                aria-label="Remover"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line text-t2 hover:border-bad hover:text-bad"
                onClick={() => onRemove(file)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
  unify,
  files,
  error,
  onMonth,
  onYear,
  onCategory,
  onUnify,
  onFiles,
  onError,
  onCancel,
  onNext,
}: {
  month: string;
  year: string;
  category: string;
  unify: boolean;
  files: File[];
  error: string | null;
  onMonth: (value: string) => void;
  onYear: (value: string) => void;
  onCategory: (value: string) => void;
  onUnify: (value: boolean) => void;
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
      <WizardCardHeader title="Anexar documentos" subtitle="Até 5 PDFs. O mesmo CPF vira um documento só quando a unificação está ligada." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Mês">
          <select className="mt-1 w-full rounded-lg border border-line bg-bg-inset px-2 py-2 text-sm" value={month} onChange={(event) => onMonth(event.target.value)}>
            {Array.from({ length: 12 }, (_, index) => (
              <option key={index + 1} value={index + 1}>
                {monthFolder(index + 1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ano">
          <input className="mt-1 w-full rounded-lg border border-line bg-bg-inset px-2 py-2 text-sm" value={year} onChange={(event) => onYear(event.target.value)} />
        </Field>
        <Field label="Tipo do documento">
          <select className="mt-1 w-full rounded-lg border border-line bg-bg-inset px-2 py-2 text-sm" value={category} onChange={(event) => onCategory(event.target.value)}>
            {DOCUMENT_CATEGORIES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={unify} onChange={(event) => onUnify(event.target.checked)} />
        Unificar páginas do mesmo CPF
      </label>
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
        <p className="mt-2 text-[13.5px] text-t2">ou clique para selecionar, até 5 arquivos</p>
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

function SettingsStep({
  channel,
  reminder,
  deadline,
  error,
  onChannel,
  onReminder,
  onDeadline,
  onBack,
  onNext,
}: {
  channel: "WHATSAPP" | "EMAIL";
  reminder: string;
  deadline: string;
  error: string | null;
  onChannel: (value: "WHATSAPP" | "EMAIL") => void;
  onReminder: (value: string) => void;
  onDeadline: (value: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <WizardCardHeader title="Configurações de envio" subtitle="O link sai por WhatsApp ou e-mail. A assinatura fica no centro de cada página." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Canal">
          <select className="mt-1 w-full rounded-lg border border-line bg-bg-inset px-2 py-2 text-sm" value={channel} onChange={(event) => onChannel(event.target.value as "WHATSAPP" | "EMAIL")}>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">E-mail</option>
          </select>
        </Field>
        <Field label="Lembrete">
          <select className="mt-1 w-full rounded-lg border border-line bg-bg-inset px-2 py-2 text-sm" value={reminder} onChange={(event) => onReminder(event.target.value)}>
            <option value="EVERY_DAY">Todo dia</option>
            <option value="EVERY_3_DAYS">A cada 3 dias</option>
            <option value="EVERY_WEEK">Toda semana</option>
            <option value="NEVER">Nunca</option>
          </select>
        </Field>
        <Field label="Data limite">
          <input type="date" className="mt-1 w-full rounded-lg border border-line bg-bg-inset px-2 py-2 text-sm" value={deadline} onChange={(event) => onDeadline(event.target.value)} />
        </Field>
      </div>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-4">
        <WizardNav onPrevious={onBack} onNext={onNext} nextLabel="Revisar" />
      </div>
    </>
  );
}

function ReviewStep({
  category,
  month,
  year,
  channel,
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
  onSave,
}: {
  category: string;
  month: number;
  year: string;
  channel: "WHATSAPP" | "EMAIL";
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
  onSave: (input: { sellerId: string; cpf: string; email: string; whatsapp: string }) => Promise<void>;
}) {
  return (
    <>
      <WizardCardHeader title="Revisar e enviar" subtitle={`${category} · ${monthFolder(month)}/${year}. Quem estiver sem contato pode ser preenchido aqui.`} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Summary label="Documentos" value={String(rows.length)} />
        <Summary label="Prontos" value={String(ready)} />
        <Summary label="Sem cadastro" value={String(missing)} />
      </div>
      {refused.length > 0 && (
        <p className="mb-3 text-[13px] text-bad">{refused.map((item) => `${item.name}: ${item.message}`).join(" ")}</p>
      )}
      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <ReviewRow key={`${row.id}:${row.sellerId ?? ""}`} row={row} people={people} channel={channel} onAssign={onAssign} onSave={onSave} />
        ))}
        {rows.length === 0 && <p className="text-sm text-t2">Nenhuma página ficou neste envio.</p>}
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
  onAssign,
  onSave,
}: {
  row: DocumentRow;
  people: PersonRow[];
  channel: "WHATSAPP" | "EMAIL";
  onAssign: (documentId: string, sellerId: string) => Promise<void>;
  onSave: (input: { sellerId: string; cpf: string; email: string; whatsapp: string }) => Promise<void>;
}) {
  const person = people.find((item) => item.id === row.sellerId) ?? null;
  const [cpf, setCpf] = useState(person?.cpf ?? "");
  const [email, setEmail] = useState(person?.email ?? "");
  const [whatsapp, setWhatsapp] = useState(person?.whatsapp ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const needsContact = person ? (channel === "WHATSAPP" ? !person.whatsapp : !person.email) : true;

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-[13px] font-bold text-t0">{row.fileName}</p>
        <span className="text-[11px] font-semibold text-t2">{person ? STATUS_LABEL[row.status] : "Escolha o colaborador"}</span>
      </div>
      {!person ? (
        <select className="w-full rounded-lg border border-line bg-bg-inset px-2 py-2 text-sm" defaultValue="" onChange={(event) => event.target.value && void onAssign(row.id, event.target.value)}>
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
            setLocalError(null);
            void onSave({ sellerId: person.id, cpf, email, whatsapp }).catch((reason) => setLocalError(reason instanceof Error ? reason.message : DOCUMENT_COPY.badCpf));
          }}
        >
          <p className="text-[13px] font-semibold text-t1">{person.name}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <input className="rounded-lg border border-line bg-bg-inset px-2 py-2 text-sm" value={cpf} placeholder="CPF" onChange={(event) => setCpf(event.target.value)} />
            <input className={cn("rounded-lg border bg-bg-inset px-2 py-2 text-sm", channel === "EMAIL" && !email ? "border-bad" : "border-line")} value={email} placeholder="E-mail" onChange={(event) => setEmail(event.target.value)} />
            <input className={cn("rounded-lg border bg-bg-inset px-2 py-2 text-sm", channel === "WHATSAPP" && !whatsapp ? "border-bad" : "border-line")} value={whatsapp} placeholder="WhatsApp" onChange={(event) => setWhatsapp(event.target.value)} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-bad">{localError || (needsContact ? (channel === "WHATSAPP" ? DOCUMENT_COPY.noWhatsapp : DOCUMENT_COPY.noEmail) : row.error ?? "")}</span>
            <Button size="sm" variant="outline" type="submit">
              Salvar
            </Button>
          </div>
        </form>
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="text-xs font-semibold text-t1">
      {label}
      {children}
    </label>
  );
}
