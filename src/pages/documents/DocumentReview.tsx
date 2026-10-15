import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type RenderTask } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button, FormField, WizardCardHeader, WizardNav } from "@/components/ui";
import { Spinner } from "@/components/ui/Skeleton";
import {
  DOCUMENT_COPY,
  contactFieldsToAsk,
  documentIssue,
  folderTitle,
  resolveDrafts,
  type DocumentDraft,
  type FieldMark,
  type SendChannel,
  type SignatureMark,
} from "@/data/wedash/documentSplit";
import { openDocument, type DocumentRow, type PersonRow } from "@/data/wedash/documentsRepo";
import { Icon, icons } from "@/pages/users/Icons";
import { cn } from "@/lib/cn";
import { STATUS_LABEL } from "./frame";

GlobalWorkerOptions.workerSrc = pdfWorker;

const controlClass =
  "h-[42px] w-full rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3.5 text-[13px] text-t0 outline-none transition-colors focus:border-acc";

export function DocumentReview({
  rows,
  people,
  drafts,
  signers,
  activeId,
  refused,
  error,
  sending,
  onFocus,
  onDraft,
  onAssign,
  onDrop,
  onSave,
  onBack,
  onSend,
}: {
  rows: DocumentRow[];
  people: PersonRow[];
  drafts: Record<string, DocumentDraft | undefined>;
  signers: { id: string; name: string; email: string }[];
  activeId: string;
  refused: { name: string; message: string }[];
  error: string | null;
  sending: boolean;
  onFocus: (id: string) => void;
  onDraft: (id: string, draft: DocumentDraft) => void;
  onAssign: (documentId: string, sellerId: string) => Promise<void>;
  onDrop: (documentId: string, pageNumber: number) => Promise<void>;
  onSave: (input: { sellerId: string; cpf?: string; email?: string; whatsapp?: string }) => Promise<void>;
  onBack: () => void;
  onSend: () => void;
}) {
  const resolved = resolveDrafts(
    rows.map((row) => ({ id: row.id, pageCount: row.pageCount })),
    drafts,
  );
  const ready = rows.filter((row, index) => !row.envelopeId && !documentIssue(people.find((item) => item.id === row.sellerId) ?? null, resolved[index], row.pageCount, signers)).length;
  const openRows = rows.filter((row) => !row.envelopeId).length;
  const index = Math.max(0, rows.findIndex((row) => row.id === activeId));
  const row = rows[index];
  const draft = row ? drafts[row.id] : undefined;

  return (
    <>
      <WizardCardHeader
        title="Destinatários"
        subtitle="A página mostra quem recebe. Clique nela para marcar assinatura ou rubrica. O documento seguinte repete o último prazo, lembrete e as marcas."
      />
      {rows.length === 0 ? (
        <div className="mt-4">
          <p className="text-sm font-bold text-t0">Nenhum documento pronto para envio</p>
          <p className="mt-1 text-sm text-t2">Revise os arquivos recusados ou volte e anexe outro PDF.</p>
        </div>
      ) : row && draft ? (
          <ReviewBody
          row={row}
          draft={draft}
          people={people}
          signers={signers}
          index={index}
          total={rows.length}
          rows={rows}
          sending={sending}
          onFocus={onFocus}
          onDraft={(next) => onDraft(row.id, next)}
          onAssign={onAssign}
          onDrop={onDrop}
          onSave={onSave}
        />
      ) : (
        <div className="flex justify-center py-10">
          <Spinner size={22} />
        </div>
      )}
      {refused.length > 0 && <p className="mt-3 text-[13px] text-bad">{refused.map((item) => `${item.name}: ${item.message}`).join(" ")}</p>}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Summary label="Documentos" value={String(rows.length)} />
        <Summary label="Prontos" value={String(ready)} />
        <Summary label="Sem contato" value={String(openRows - ready)} />
      </div>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-4">
        <WizardNav
          previousDisabled={sending}
          nextDisabled={sending || ready === 0}
          onPrevious={onBack}
          onNext={onSend}
          nextLabel={sending ? "Enviando…" : "Enviar"}
        />
      </div>
    </>
  );
}

function ReviewBody({
  row,
  draft,
  people,
  signers,
  index,
  total,
  rows,
  sending,
  onFocus,
  onDraft,
  onAssign,
  onDrop,
  onSave,
}: {
  row: DocumentRow;
  draft: DocumentDraft;
  people: PersonRow[];
  signers: { id: string; name: string; email: string }[];
  index: number;
  total: number;
  rows: DocumentRow[];
  sending: boolean;
  onFocus: (id: string) => void;
  onDraft: (draft: DocumentDraft) => void;
  onAssign: (documentId: string, sellerId: string) => Promise<void>;
  onDrop: (documentId: string, pageNumber: number) => Promise<void>;
  onSave: (input: { sellerId: string; cpf?: string; email?: string; whatsapp?: string }) => Promise<void>;
}) {
  const person = people.find((item) => item.id === row.sellerId) ?? null;
  const issue = row.envelopeId ? null : documentIssue(person, draft, row.pageCount, signers);
  const previous = index > 0 ? rows[index - 1] : null;
  const next = index < total - 1 ? rows[index + 1] : null;
  const locked = Boolean(row.envelopeId) || sending;

  function changeFields(fields: FieldMark[]) {
    onDraft({ ...draft, fields });
  }

  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={!previous || sending} onClick={() => previous && onFocus(previous.id)}>
          Anterior
        </Button>
        <select
          className={cn(controlClass, "min-w-0 flex-1")}
          value={row.id}
          onChange={(event) => onFocus(event.target.value)}
        >
          {rows.map((item, itemIndex) => {
            const named = people.find((personItem) => personItem.id === item.sellerId);
            return (
              <option key={item.id} value={item.id}>
                {itemIndex + 1}. {folderTitle(item.fileName)} · {named?.name ?? "Sem colaborador"}
              </option>
            );
          })}
        </select>
        <Button type="button" size="sm" variant="secondary" disabled={!next || sending} onClick={() => next && onFocus(next.id)}>
          Próximo
        </Button>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <h3 className="text-lg font-bold text-t0">{person?.name ?? "Colaborador não identificado"}</h3>
          <p className="mt-1 mb-3 text-[13px] text-t2">
            {folderTitle(row.fileName)} · {row.pageCount === 1 ? "1 página" : `${row.pageCount} páginas`}
          </p>
          <StackedPages
            documentId={row.id}
            pageCount={row.pageCount}
            fields={draft.fields}
            personName={person?.name ?? "Colaborador"}
            signers={signers}
            disabled={locked}
            onChange={changeFields}
            onDrop={(pageNumber) => onDrop(row.id, pageNumber)}
          />
        </div>
        <aside className="flex flex-col gap-3 rounded-xl border border-line p-3 lg:sticky lg:top-4">
          {row.envelopeId ? (
            <p className="text-[13px] text-t2">{STATUS_LABEL[row.status]}</p>
          ) : (
            <DraftFields person={person} draft={draft} people={people} row={row} issue={issue} onDraft={onDraft} onAssign={onAssign} onSave={onSave} />
          )}
        </aside>
      </div>
    </div>
  );
}

function DraftFields({
  person,
  draft,
  people,
  row,
  issue,
  onDraft,
  onAssign,
  onSave,
}: {
  person: PersonRow | null;
  draft: DocumentDraft;
  people: PersonRow[];
  row: DocumentRow;
  issue: string | null;
  onDraft: (draft: DocumentDraft) => void;
  onAssign: (documentId: string, sellerId: string) => Promise<void>;
  onSave: (input: { sellerId: string; cpf?: string; email?: string; whatsapp?: string }) => Promise<void>;
}) {
  const ask = person ? contactFieldsToAsk(person, draft.channel) : null;
  return (
    <>
      {!person ? (
        <FormField label="Colaborador">
          <select className={controlClass} defaultValue="" onChange={(event) => event.target.value && void onAssign(row.id, event.target.value)}>
            <option value="">Escolher colaborador</option>
            {people.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </FormField>
      ) : (
        <p className="text-[13px] font-bold text-t0">{person.name}</p>
      )}
      <FormField label="Canal">
        <ChannelSelect value={draft.channel} onChange={(channel) => onDraft({ ...draft, channel })} />
      </FormField>
      {person && ask && (ask.cpf || ask.email || ask.whatsapp) && (
        <ContactForm key={`${person.id}:${draft.channel}`} personId={person.id} ask={ask} onSave={onSave} />
      )}
      <p className="text-[12.5px] text-t2">O signatário adicional se escolhe na marcação, pela lista de usuários.</p>
      <FormField label="Lembrete">
        <select className={controlClass} value={draft.reminder} onChange={(event) => onDraft({ ...draft, reminder: event.target.value as DocumentDraft["reminder"] })}>
          <option value="EVERY_DAY">Todo dia</option>
          <option value="EVERY_3_DAYS">A cada 3 dias</option>
          <option value="EVERY_WEEK">Toda semana</option>
          <option value="NEVER">Nunca</option>
        </select>
      </FormField>
      <FormField label="Data limite" optional hint="Depois desta data, o documento fica expirado se ainda não tiver sido assinado.">
        <input type="date" className={controlClass} value={draft.deadline} onChange={(event) => onDraft({ ...draft, deadline: event.target.value })} />
      </FormField>
      {issue && <p className="text-xs text-bad">{issue}</p>}
    </>
  );
}

function ContactForm({
  personId,
  ask,
  onSave,
}: {
  personId: string;
  ask: { cpf: boolean; email: boolean; whatsapp: boolean };
  onSave: (input: { sellerId: string; cpf?: string; email?: string; whatsapp?: string }) => Promise<void>;
}) {
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setLocalError(null);
        const input: { sellerId: string; cpf?: string; email?: string; whatsapp?: string } = { sellerId: personId };
        if (ask.cpf) input.cpf = cpf;
        if (ask.email) input.email = email;
        if (ask.whatsapp) input.whatsapp = whatsapp;
        void onSave(input).catch((reason) => setLocalError(reason instanceof Error ? reason.message : DOCUMENT_COPY.badCpf));
      }}
    >
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
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-bad">{localError}</span>
        <Button size="sm" variant="outline" type="submit">
          Salvar
        </Button>
      </div>
    </form>
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

function StackedPages({
  documentId,
  pageCount,
  fields,
  personName,
  signers,
  disabled,
  onChange,
  onDrop,
}: {
  documentId: string;
  pageCount: number;
  fields: FieldMark[];
  personName: string;
  signers: { id: string; name: string; email: string }[];
  disabled: boolean;
  onChange: (fields: FieldMark[]) => void;
  onDrop: (pageNumber: number) => Promise<void>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dropping, setDropping] = useState<number | null>(null);
  const pages = Array.from({ length: Math.max(1, pageCount) }, (_, index) => index + 1);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setLoading(true);
    setError(null);
    void openDocument(documentId)
      .then((next) => {
        if (!cancelled) setUrl(next);
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setError("Não foi possível abrir esta página.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    if (!url || !hostRef.current) return;
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    const renders: RenderTask[] = [];
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        loadingTask = getDocument({ url });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const total = Math.min(pdf.numPages, pages.length);
        for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
          const canvas = hostRef.current?.querySelector<HTMLCanvasElement>(`canvas[data-page="${pageNumber}"]`);
          if (!canvas) continue;
          const pdfPage = await pdf.getPage(pageNumber);
          if (cancelled) return;
          const natural = pdfPage.getViewport({ scale: 1 });
          const displayWidth = Math.min(720, natural.width);
          const viewport = pdfPage.getViewport({ scale: (displayWidth / natural.width) * (window.devicePixelRatio || 1) });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${displayWidth}px`;
          canvas.style.maxWidth = "100%";
          canvas.style.height = "auto";
          canvas.style.aspectRatio = `${natural.width} / ${natural.height}`;
          const task = pdfPage.render({ canvas, viewport });
          renders.push(task);
          await task.promise;
        }
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
      for (const task of renders) task.cancel();
      void loadingTask?.destroy();
    };
  }, [url, pageCount, pages.length]);

  function drop(pageNumber: number) {
    setDropping(pageNumber);
    void onDrop(pageNumber).finally(() => setDropping(null));
  }

  return (
    <div ref={hostRef} className="relative overflow-auto rounded-xl bg-[#3c4043] px-4 py-6">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#3c4043]/80">
          <Spinner size={22} />
        </div>
      )}
      <p className="mb-4 text-center text-[12.5px] text-white/80">Clique na página para adicionar a marcação.</p>
      <div className="mx-auto flex w-fit max-w-full flex-col gap-6">
        {pages.map((page) => (
          <section key={page} className="w-fit max-w-full">
            <div className="mb-2 flex items-center justify-between gap-2 text-white/80">
              <span className="text-[12.5px] font-bold">Página {page}</span>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-white/20 text-white transition-colors hover:bg-white/10 disabled:opacity-50"
                aria-label={pages.length === 1 ? "Apagar documento" : `Apagar página ${page}`}
                disabled={disabled || dropping != null}
                onClick={() => drop(page)}
              >
                <Icon d={icons.trash} size={14} />
              </button>
            </div>
            <div
              data-page-box
              className="relative w-fit max-w-full bg-white shadow-lg"
              onClick={(event) => {
                if (disabled || (event.target as HTMLElement).closest("[data-mark]")) return;
                const added = pointAt(event.currentTarget, event.clientX, event.clientY, page);
                onChange([...fields, { ...added, id: crypto.randomUUID(), signerId: "seller" }]);
              }}
            >
              <canvas data-page={page} className="block h-auto max-w-full bg-white" />
              {fields
                .filter((field) => field.pageNumber === page)
                .map((field) => (
                  <MarkCard
                    key={field.id}
                    field={field}
                    personName={personName}
                    signers={signers}
                    disabled={disabled}
                    onChange={(next) => onChange(fields.map((item) => (item.id === field.id ? next : item)))}
                    onDuplicate={() =>
                      onChange([
                        ...fields,
                        { ...field, id: crypto.randomUUID(), y: Math.min(92, Math.round((field.y + 8) * 10) / 10) },
                      ])
                    }
                    onRemove={() => onChange(fields.filter((item) => item.id !== field.id))}
                  />
                ))}
            </div>
          </section>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-white">{error}</p>}
    </div>
  );
}

function pointAt(element: HTMLElement, clientX: number, clientY: number, pageNumber: number): SignatureMark {
  const box = element.getBoundingClientRect();
  const x = Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100));
  const y = Math.min(100, Math.max(0, ((clientY - box.top) / box.height) * 100));
  return { pageNumber, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, element: "SIGNATURE" };
}

function MarkCard({
  field,
  personName,
  signers,
  disabled,
  onChange,
  onDuplicate,
  onRemove,
}: {
  field: FieldMark;
  personName: string;
  signers: { id: string; name: string }[];
  disabled: boolean;
  onChange: (field: FieldMark) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const page = event.currentTarget.closest("[data-page-box]");
    if (!(page instanceof HTMLElement)) return;
    const next = pointAt(page, event.clientX, event.clientY, field.pageNumber);
    onChange({ ...field, x: next.x, y: next.y });
  }

  return (
    <div
      data-mark
      className="absolute z-20 w-[232px]"
      style={{ left: `${field.x}%`, top: `${field.y}%`, transform: "translate(-50%, -115%)" }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        if ((event.target as HTMLElement).closest("select, button")) return;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={move}
    >
      <div className="rounded-xl border border-neutral-200 bg-white p-1.5 text-neutral-900 shadow-lg">
        <div className="flex items-center gap-1">
          <select
            className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-[12px] font-bold"
            value={field.signerId}
            disabled={disabled}
            onChange={(event) => onChange({ ...field, signerId: event.target.value })}
          >
            <optgroup label="Colaborador">
              <option value="seller">{personName}</option>
            </optgroup>
            <optgroup label="Usuários">
              {signers.length === 0 ? (
                <option value="" disabled>
                  Nenhum usuário ativo
                </option>
              ) : (
                signers.map((signer) => (
                  <option key={signer.id} value={`user:${signer.id}`}>
                    {signer.name}
                  </option>
                ))
              )}
            </optgroup>
          </select>
          <IconButton label="Duplicar marcação" disabled={disabled} onClick={onDuplicate}>
            <CopyIcon />
          </IconButton>
          <IconButton label="Apagar marcação" disabled={disabled} onClick={onRemove}>
            <Icon d={icons.trash} size={14} />
          </IconButton>
        </div>
        <div className="mt-1.5 flex gap-1">
          <TypeButton active={field.element === "SIGNATURE"} disabled={disabled} onClick={() => onChange({ ...field, element: "SIGNATURE" })}>
            Assinatura
          </TypeButton>
          <TypeButton active={field.element === "RUBRIC"} disabled={disabled} onClick={() => onChange({ ...field, element: "RUBRIC" })}>
            Rubrica
          </TypeButton>
        </div>
      </div>
    </div>
  );
}

function TypeButton({ active, disabled, onClick, children }: { active: boolean; disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-7 flex-1 rounded-md text-[11px] font-bold",
        active ? "bg-neutral-900 text-white" : "border border-neutral-200 text-neutral-600",
      )}
    >
      {children}
    </button>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
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
