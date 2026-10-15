import { useEffect, useRef, useState, type PointerEvent } from "react";
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

function pointOn(event: PointerEvent<HTMLDivElement>, pageNumber: number): SignatureMark {
  const box = event.currentTarget.getBoundingClientRect();
  const x = Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100));
  const y = Math.min(100, Math.max(0, ((event.clientY - box.top) / box.height) * 100));
  return { pageNumber, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, element: "SIGNATURE" };
}

export function DocumentReview({
  rows,
  people,
  drafts,
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
  const ready = rows.filter((row, index) => !row.envelopeId && !documentIssue(people.find((item) => item.id === row.sellerId) ?? null, resolved[index], row.pageCount)).length;
  const openRows = rows.filter((row) => !row.envelopeId).length;
  const index = Math.max(0, rows.findIndex((row) => row.id === activeId));
  const row = rows[index];
  const draft = row ? drafts[row.id] : undefined;

  return (
    <>
      <WizardCardHeader
        title="Destinatários"
        subtitle="A página mostra quem recebe. Prazo, lembrete, signatário extra e posição passam para o documento seguinte."
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
  const issue = row.envelopeId ? null : documentIssue(person, draft, row.pageCount);
  const [placing, setPlacing] = useState<"person" | "extra">("person");
  const previous = index > 0 ? rows[index - 1] : null;
  const next = index < total - 1 ? rows[index + 1] : null;

  useEffect(() => {
    if (!draft.extra) setPlacing("person");
  }, [draft.extra]);

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
            mark={draft.mark}
            extraMark={draft.extra?.marks[0] ?? null}
            disabled={Boolean(row.envelopeId) || sending}
            onPlace={(mark) => {
              if (placing === "extra" && draft.extra) onDraft({ ...draft, extra: { ...draft.extra, marks: [mark] } });
              else onDraft({ ...draft, mark });
            }}
            onDrop={(pageNumber) => onDrop(row.id, pageNumber)}
          />
        </div>
        <aside className="flex flex-col gap-3 rounded-xl border border-line p-3 lg:sticky lg:top-4">
          {row.envelopeId ? (
            <p className="text-[13px] text-t2">{STATUS_LABEL[row.status]}</p>
          ) : (
            <DraftFields person={person} draft={draft} people={people} row={row} issue={issue} onDraft={onDraft} onAssign={onAssign} onSave={onSave} onPlacing={setPlacing} placing={placing} />
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
  placing,
  onDraft,
  onAssign,
  onSave,
  onPlacing,
}: {
  person: PersonRow | null;
  draft: DocumentDraft;
  people: PersonRow[];
  row: DocumentRow;
  issue: string | null;
  placing: "person" | "extra";
  onDraft: (draft: DocumentDraft) => void;
  onAssign: (documentId: string, sellerId: string) => Promise<void>;
  onSave: (input: { sellerId: string; cpf?: string; email?: string; whatsapp?: string }) => Promise<void>;
  onPlacing: (placing: "person" | "extra") => void;
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
      <label className="flex items-center gap-2 text-[13px] font-bold text-t0">
        <input
          type="checkbox"
          checked={Boolean(draft.extra)}
          onChange={(event) => {
            if (!event.target.checked) {
              onDraft({ ...draft, extra: null });
              return;
            }
            onDraft({
              ...draft,
              extra: {
                name: "",
                channel: "EMAIL",
                email: null,
                whatsapp: null,
                marks: [{ ...draft.mark, y: 72 }],
              },
            });
            onPlacing("extra");
          }}
        />
        Signatário extra
      </label>
      {draft.extra && (
        <div className="grid gap-2">
          <FormField label="Nome">
            <input className={controlClass} value={draft.extra.name} onChange={(event) => onDraft({ ...draft, extra: { ...draft.extra!, name: event.target.value } })} />
          </FormField>
          <FormField label="Canal do signatário">
            <ChannelSelect
              value={draft.extra.channel}
              onChange={(channel) => onDraft({ ...draft, extra: { ...draft.extra!, channel } })}
            />
          </FormField>
          {draft.extra.channel === "EMAIL" ? (
            <FormField label="E-mail">
              <input
                className={controlClass}
                value={draft.extra.email ?? ""}
                onChange={(event) => onDraft({ ...draft, extra: { ...draft.extra!, email: event.target.value || null } })}
              />
            </FormField>
          ) : (
            <FormField label="WhatsApp">
              <input
                className={controlClass}
                value={draft.extra.whatsapp ?? ""}
                onChange={(event) => onDraft({ ...draft, extra: { ...draft.extra!, whatsapp: event.target.value || null } })}
              />
            </FormField>
          )}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={placing === "person" ? "primary" : "outline"} onClick={() => onPlacing("person")}>
              Assinatura
            </Button>
            <Button type="button" size="sm" variant={placing === "extra" ? "primary" : "outline"} onClick={() => onPlacing("extra")}>
              Signatário extra
            </Button>
          </div>
        </div>
      )}
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
  mark,
  extraMark,
  disabled,
  onPlace,
  onDrop,
}: {
  documentId: string;
  pageCount: number;
  mark: SignatureMark;
  extraMark: SignatureMark | null;
  disabled: boolean;
  onPlace: (mark: SignatureMark) => void;
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
          const viewport = pdfPage.getViewport({ scale: 1.2 });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
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
    <div ref={hostRef} className="relative flex flex-col gap-4">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-bg-inset/80">
          <Spinner size={22} />
        </div>
      )}
      {pages.map((page) => (
        <section key={page} className="rounded-xl border border-line bg-bg-inset p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-bold text-t1">Página {page}</span>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-line text-bad transition-colors hover:bg-bad-soft disabled:opacity-50"
              aria-label={pages.length === 1 ? "Apagar documento" : `Apagar página ${page}`}
              disabled={disabled || dropping != null}
              onClick={() => drop(page)}
            >
              <Icon d={icons.trash} size={14} />
            </button>
          </div>
          <div
            className="relative mx-auto w-full max-w-3xl"
            onPointerDown={(event) => {
              if (disabled || event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              onPlace(pointOn(event, page));
            }}
            onPointerMove={(event) => {
              if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
              onPlace(pointOn(event, page));
            }}
          >
            <canvas data-page={page} className="block h-auto w-full bg-white" />
            {mark.pageNumber === page && <MarkBadge label="Assinar" mark={mark} tone="acc" />}
            {extraMark && extraMark.pageNumber === page && <MarkBadge label="Signatário" mark={extraMark} tone="warn" />}
          </div>
        </section>
      ))}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

function MarkBadge({ label, mark, tone }: { label: string; mark: SignatureMark; tone: "acc" | "warn" }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute rounded-md border px-2 py-1 text-[11px] font-bold",
        tone === "acc" ? "border-acc bg-acc-soft text-acc" : "border-warn bg-warn-soft text-warn",
      )}
      style={{ left: `${mark.x}%`, top: `${mark.y}%`, transform: "translate(-50%, -50%)" }}
    >
      {label}
    </span>
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
