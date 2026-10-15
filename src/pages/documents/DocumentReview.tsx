import { useEffect, useRef, useState, type PointerEvent } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type RenderTask } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button, FormField, Modal, Tooltip, WizardCardHeader, WizardNav } from "@/components/ui";
import { Spinner } from "@/components/ui/Skeleton";
import {
  DOCUMENT_COPY,
  documentIssue,
  folderTitle,
  preparationSituation,
  resolveDrafts,
  type DocumentDraft,
  type FieldMark,
  type GuestSigner,
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
  onReview,
  period,
  analyzed,
  opened,
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
  onReview: () => void;
  period: string;
  analyzed: { files: number; merged: number } | null;
  opened: Record<string, true>;
}) {
  const resolved = resolveDrafts(
    rows.map((row) => ({ id: row.id, pageCount: row.pageCount })),
    drafts,
  );
  const ready = rows.filter((row, index) => {
    if (row.envelopeId) return false;
    if (documentIssue(people.find((item) => item.id === row.sellerId) ?? null, resolved[index], row.pageCount, signers, people)) return false;
    return Boolean(opened[row.id]) || index === 0;
  }).length;
  const openRows = rows.filter((row) => !row.envelopeId).length;
  const index = Math.max(0, rows.findIndex((row) => row.id === activeId));
  const row = rows[index];
  const draft = row ? drafts[row.id] : undefined;
  const unidentified = rows.filter((item) => !item.sellerId && !item.envelopeId).length;
  const [listOpen, setListOpen] = useState(false);
  const situationOf = (item: DocumentRow, itemIndex: number) => {
    const person = people.find((candidate) => candidate.id === item.sellerId) ?? null;
    const situation = preparationSituation(person, resolved[itemIndex], item.pageCount, signers, people, item.envelopeId);
    if (situation === "Pronto" && !opened[item.id] && itemIndex > 0) return "Conferir marcação";
    return situation;
  };

  return (
    <>
      <WizardCardHeader
        title="Preparar documentos"
        subtitle="Vincule o colaborador, posicione as marcações e confira o contato do canal escolhido."
      />
      {analyzed && rows.length > 0 && (
        <div className="mt-4 rounded-xl border border-line bg-bg-2 px-3 py-2.5">
          <p className="text-[13px] text-t1">
            {analyzed.files} {analyzed.files === 1 ? "arquivo analisado" : "arquivos analisados"}. {rows.length}{" "}
            {rows.length === 1 ? "documento preparado" : "documentos preparados"}. {unidentified}{" "}
            {unidentified === 1 ? "precisa" : "precisam"} de identificação.
          </p>
          {analyzed.merged > 0 && (
            <p className="mt-1 text-[13px] text-t1">
              {analyzed.merged === 1
                ? "1 documento reuniu páginas de arquivos diferentes."
                : `${analyzed.merged} documentos reuniram páginas de arquivos diferentes.`}
            </p>
          )}
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setListOpen(true)}>
            Ver documentos
          </Button>
        </div>
      )}
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
          period={period}
          listOpen={listOpen}
          situationOf={situationOf}
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
      {refused.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border border-line">
          {refused.map((item) => (
            <div key={item.name} className="flex items-start justify-between gap-3 border-b border-line px-3 py-2 last:border-b-0">
              <span className="truncate text-[13px] font-bold text-t0">{item.name}</span>
              <span className="text-right text-[12.5px] text-bad">{item.message === DOCUMENT_COPY.scanned ? "PDF escaneado. Envie um PDF digital com texto selecionável." : item.message}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Summary label="Documentos" value={String(rows.length)} />
        <Summary label="Prontos" value={String(ready)} />
        <Summary label="Precisam de atenção" value={String(openRows - ready)} />
      </div>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-4">
        <WizardNav
          hideNextIcon
          previousDisabled={sending}
          nextDisabled={sending}
          onPrevious={onBack}
          onNext={onReview}
          nextLabel="Revisar envio"
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
  period,
  listOpen,
  situationOf,
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
  period: string;
  listOpen: boolean;
  situationOf: (item: DocumentRow, itemIndex: number) => string;
  sending: boolean;
  onFocus: (id: string) => void;
  onDraft: (draft: DocumentDraft) => void;
  onAssign: (documentId: string, sellerId: string) => Promise<void>;
  onDrop: (documentId: string, pageNumber: number) => Promise<void>;
  onSave: (input: { sellerId: string; cpf?: string; email?: string; whatsapp?: string }) => Promise<void>;
}) {
  const person = people.find((item) => item.id === row.sellerId) ?? null;
  const issue = row.envelopeId ? null : documentIssue(person, draft, row.pageCount, signers, people);
  const previous = index > 0 ? rows[index - 1] : null;
  const next = index < total - 1 ? rows[index + 1] : null;
  const locked = Boolean(row.envelopeId) || sending;
  const [tool, setTool] = useState<SignatureMark["element"]>("SIGNATURE");
  const [activeSigner, setActiveSigner] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function changeFields(fields: FieldMark[]) {
    onDraft({ ...draft, fields });
  }

  function addGuest(assignTo?: FieldMark) {
    const guest: GuestSigner = { id: crypto.randomUUID(), name: "", email: "", whatsapp: "" };
    const signerId = `guest:${guest.id}`;
    onDraft({
      ...draft,
      guests: [...(draft.guests ?? []), guest],
      fields: assignTo ? draft.fields.map((item) => (item.id === assignTo.id ? { ...item, signerId } : item)) : draft.fields,
    });
    setActiveSigner(signerId);
  }

  function pickSigner(field: FieldMark, value: string) {
    if (value === "__guest__") {
      addGuest(field);
      return;
    }
    const signerId = value.startsWith("seller:") && value.slice("seller:".length) === row.sellerId ? "seller" : value;
    onDraft({
      ...draft,
      fields: draft.fields.map((item) => (item.id === field.id ? { ...item, signerId } : item)),
    });
    setActiveSigner(signerId);
  }

  function chooseToolSigner(value: string) {
    if (value === "__guest__") {
      addGuest();
      return;
    }
    setActiveSigner(value);
  }

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-bold text-t0">Documento {index + 1} de {total}</p>
        <p className="truncate text-[12.5px] text-t2">{folderTitle(row.fileName)} · {period}</p>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" disabled={!previous || sending} onClick={() => previous && onFocus(previous.id)}>
          Anterior
        </Button>
        <select
          className="h-10 min-w-0 flex-1 rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3.5 text-[13px] text-t0 outline-none transition-colors focus:border-acc"
          value={row.id}
          onChange={(event) => onFocus(event.target.value)}
        >
          {rows.map((item, itemIndex) => {
            const named = people.find((personItem) => personItem.id === item.sellerId);
            return (
              <option key={item.id} value={item.id}>
                {itemIndex + 1}. {named?.name ?? "Sem colaborador"} · {situationOf(item, itemIndex)}
              </option>
            );
          })}
        </select>
        <Button type="button" variant="secondary" disabled={!next || sending} onClick={() => next && onFocus(next.id)}>
          Próximo
        </Button>
      </div>
      {listOpen && (
        <div className="mb-3 overflow-hidden rounded-xl border border-line">
          {rows.map((item, itemIndex) => {
            const named = people.find((personItem) => personItem.id === item.sellerId);
            return (
              <button
                key={item.id}
                type="button"
                className={cn("flex w-full items-center justify-between gap-3 border-b border-line px-3 py-2 text-left last:border-b-0 hover:bg-bg-3", item.id === row.id && "bg-bg-inset")}
                onClick={() => onFocus(item.id)}
              >
                <span className="truncate text-[13px] font-bold text-t0">{itemIndex + 1}. {folderTitle(item.fileName)} · {named?.name ?? "Sem colaborador"}</span>
                <span className="shrink-0 text-[12px] font-bold text-t2">{situationOf(item, itemIndex)}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          {person && <h3 className="text-lg font-bold text-t0">{person.name}</h3>}
          <p className={cn("mb-3 text-[13px] text-t2", person && "mt-1")}>
            {folderTitle(row.fileName)} · {row.pageCount === 1 ? "1 página" : `${row.pageCount} páginas`}
          </p>
          {!locked && (
            <>
              <p className="mb-2 text-[13px] text-t1">Clique no documento para posicionar uma assinatura ou rubrica.</p>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <select
                  className="h-10 min-w-[180px] flex-1 rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3 text-[13px] text-t0 outline-none focus:border-acc"
                  value={activeSigner}
                  onChange={(event) => chooseToolSigner(event.target.value)}
                >
                  <option value="">Signatário da próxima marcação</option>
                  <SignerOptions people={people} sellerId={row.sellerId} guests={draft.guests ?? []} signers={signers} />
                </select>
                <Button type="button" size="sm" variant={tool === "SIGNATURE" ? "primary" : "secondary"} onClick={() => setTool("SIGNATURE")}>
                  Assinatura
                </Button>
                <Button type="button" size="sm" variant={tool === "RUBRIC" ? "primary" : "secondary"} onClick={() => setTool("RUBRIC")}>
                  Rubrica
                </Button>
              </div>
            </>
          )}
          <StackedPages
            documentId={row.id}
            pageCount={row.pageCount}
            fields={draft.fields}
            people={people}
            sellerId={row.sellerId}
            guests={draft.guests ?? []}
            signers={signers}
            disabled={locked}
            tool={tool}
            activeSigner={activeSigner}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={changeFields}
            onPick={pickSigner}
            onDrop={(pageNumber) => onDrop(row.id, pageNumber)}
          />
        </div>
        <aside className="flex flex-col gap-3 rounded-xl border border-line p-3 lg:sticky lg:top-4">
          {row.envelopeId ? (
            <p className="text-[13px] text-t2">{STATUS_LABEL[row.status]}</p>
          ) : (
            <DraftFields
              person={person}
              draft={draft}
              people={people}
              signers={signers}
              issue={issue}
              onAssign={(sellerId) => onAssign(row.id, sellerId)}
              onDraft={onDraft}
              onSave={onSave}
            />
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
  signers,
  issue,
  onAssign,
  onDraft,
  onSave,
}: {
  person: PersonRow | null;
  draft: DocumentDraft;
  people: PersonRow[];
  signers: { id: string; name: string; email: string }[];
  issue: string | null;
  onAssign: (sellerId: string) => Promise<void>;
  onDraft: (draft: DocumentDraft) => void;
  onSave: (input: { sellerId: string; cpf?: string; email?: string; whatsapp?: string }) => Promise<void>;
}) {
  const extras = people.filter(
    (item) => item.id !== person?.id && draft.fields.some((field) => field.signerId === `seller:${item.id}`),
  );
  const guests = (draft.guests ?? []).filter((guest) => draft.fields.some((field) => field.signerId === `guest:${guest.id}`));
  const listed = new Set<string>();
  const marks: { key: string; name: string; role: "Principal" | "Adicional" }[] = [];
  for (const field of draft.fields) {
    if (listed.has(field.signerId)) continue;
    listed.add(field.signerId);
    if (field.signerId === "seller") {
      marks.push({ key: field.id, name: person?.name ?? "Sem colaborador", role: "Principal" });
      continue;
    }
    if (field.signerId.startsWith("seller:")) {
      const named = people.find((item) => item.id === field.signerId.slice("seller:".length));
      marks.push({ key: field.signerId, name: named?.name ?? "Colaborador", role: "Adicional" });
      continue;
    }
    if (field.signerId.startsWith("user:")) {
      const named = signers.find((item) => item.id === field.signerId.slice("user:".length));
      marks.push({ key: field.signerId, name: named?.name ?? "Usuário", role: "Adicional" });
      continue;
    }
    if (field.signerId.startsWith("guest:")) {
      const named = (draft.guests ?? []).find((item) => item.id === field.signerId.slice("guest:".length));
      marks.push({ key: field.signerId, name: named?.name || "Outra pessoa", role: "Adicional" });
    }
  }
  return (
    <>
      <FormField label="Colaborador do documento">
        <select className={controlClass} value={person?.id ?? ""} onChange={(event) => event.target.value && void onAssign(event.target.value)}>
          <option value="">Sem colaborador</option>
          {people.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </FormField>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-t2">Signatários</p>
        {marks.length === 0 ? (
          <p className="mt-1 text-[13px] text-t2">Nenhuma marcação neste documento.</p>
        ) : (
          <ul className="mt-1 grid gap-1">
            {marks.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="min-w-0 truncate text-t0">{item.name}</span>
                <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-t2">{item.role}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-t2">Assinaturas</p>
        {draft.fields.length === 0 ? (
          <p className="mt-1 text-[13px] text-t2">Nenhuma marcação neste documento.</p>
        ) : (
          <ul className="mt-1 grid gap-1">
            {draft.fields.map((field) => (
              <li key={field.id} className="text-[13px] text-t1">
                {field.element === "RUBRIC" ? "Rubrica" : "Assinatura"} · Página {field.pageNumber} · {signerName(field, person, people, signers, draft.guests ?? [])}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-t2">Configurações de envio</p>
      <FormField label="Canal">
        <ChannelSelect value={draft.channel} onChange={(channel) => onDraft({ ...draft, channel })} />
      </FormField>
      {person && (
        <ContactEditor key={`${person.id}:${person.cpf ?? ""}:${person.email ?? ""}:${person.whatsapp ?? ""}`} person={person} onSave={onSave} />
      )}
      {extras.map((item) => (
        <ContactEditor key={`${item.id}:${item.cpf ?? ""}:${item.email ?? ""}:${item.whatsapp ?? ""}`} person={item} onSave={onSave} />
      ))}
      {guests.map((guest) => (
        <GuestEditor
          key={guest.id}
          guest={guest}
          onChange={(next) => onDraft({ ...draft, guests: (draft.guests ?? []).map((item) => (item.id === guest.id ? next : item)) })}
        />
      ))}
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
      {issue && issue !== "Escolha o colaborador." && <p className="text-xs text-bad">{issue}</p>}
    </>
  );
}

function signerName(
  field: FieldMark,
  person: PersonRow | null,
  people: PersonRow[],
  signers: { id: string; name: string }[],
  guests: GuestSigner[],
) {
  if (field.signerId === "seller") return person?.name ?? "Sem colaborador";
  if (field.signerId.startsWith("seller:")) return people.find((item) => item.id === field.signerId.slice("seller:".length))?.name ?? "Colaborador";
  if (field.signerId.startsWith("user:")) return signers.find((item) => item.id === field.signerId.slice("user:".length))?.name ?? "Usuário";
  if (field.signerId.startsWith("guest:")) return guests.find((item) => item.id === field.signerId.slice("guest:".length))?.name.trim() || "Outra pessoa";
  return "Signatário";
}

function SignerOptions({
  people,
  sellerId,
  guests,
  signers,
}: {
  people: PersonRow[];
  sellerId: string | null;
  guests: GuestSigner[];
  signers: { id: string; name: string }[];
}) {
  return (
    <>
      <optgroup label="Colaboradores">
        {people.length === 0 ? (
          <option value="" disabled>
            Nenhum colaborador
          </option>
        ) : (
          people.map((person) => (
            <option key={person.id} value={person.id === sellerId ? "seller" : `seller:${person.id}`}>
              {person.name}
            </option>
          ))
        )}
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
      <optgroup label="Outra pessoa">
        {guests.map((guest) => (
          <option key={guest.id} value={`guest:${guest.id}`}>
            {guest.name.trim() || "Outra pessoa"}
          </option>
        ))}
        <option value="__guest__">Adicionar outra pessoa</option>
      </optgroup>
    </>
  );
}

function ContactEditor({
  person,
  onSave,
}: {
  person: PersonRow;
  onSave: (input: { sellerId: string; cpf?: string; email?: string; whatsapp?: string }) => Promise<void>;
}) {
  const [cpf, setCpf] = useState(person.cpf ?? "");
  const [email, setEmail] = useState(person.email ?? "");
  const [whatsapp, setWhatsapp] = useState(person.whatsapp ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const dirty = cpf !== (person.cpf ?? "") || email !== (person.email ?? "") || whatsapp !== (person.whatsapp ?? "");

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setLocalError(null);
        void onSave({ sellerId: person.id, cpf, email, whatsapp }).catch((reason) =>
          setLocalError(reason instanceof Error ? reason.message : DOCUMENT_COPY.badCpf),
        );
      }}
    >
      <p className="text-[13px] font-bold text-t0">{person.name}</p>
      <FormField label="CPF">
        <input className={controlClass} value={cpf} onChange={(event) => setCpf(event.target.value)} />
      </FormField>
      <FormField label="E-mail">
        <input className={controlClass} value={email} onChange={(event) => setEmail(event.target.value)} />
      </FormField>
      <FormField label="WhatsApp">
        <input className={controlClass} value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} />
      </FormField>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-bad">{localError}</span>
        <Button size="sm" variant="outline" type="submit" disabled={!dirty}>
          Salvar
        </Button>
      </div>
    </form>
  );
}

function GuestEditor({ guest, onChange }: { guest: GuestSigner; onChange: (guest: GuestSigner) => void }) {
  return (
    <div className="grid gap-2">
      <p className="text-[13px] font-bold text-t0">Outra pessoa</p>
      <FormField label="Nome">
        <input className={controlClass} value={guest.name} onChange={(event) => onChange({ ...guest, name: event.target.value })} />
      </FormField>
      <FormField label="E-mail">
        <input className={controlClass} value={guest.email} onChange={(event) => onChange({ ...guest, email: event.target.value })} />
      </FormField>
      <FormField label="WhatsApp">
        <input className={controlClass} value={guest.whatsapp} onChange={(event) => onChange({ ...guest, whatsapp: event.target.value })} />
      </FormField>
    </div>
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
  people,
  sellerId,
  guests,
  signers,
  disabled,
  tool,
  activeSigner,
  selectedId,
  onSelect,
  onChange,
  onPick,
  onDrop,
}: {
  documentId: string;
  pageCount: number;
  fields: FieldMark[];
  people: PersonRow[];
  sellerId: string | null;
  guests: GuestSigner[];
  signers: { id: string; name: string; email: string }[];
  disabled: boolean;
  tool: SignatureMark["element"];
  activeSigner: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (fields: FieldMark[]) => void;
  onPick: (field: FieldMark, value: string) => void;
  onDrop: (pageNumber: number) => Promise<void>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dropping, setDropping] = useState<number | null>(null);
  const [confirmPage, setConfirmPage] = useState<number | null>(null);
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
          const displayWidth = Math.min(960, Math.max(natural.width, 840));
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
    setConfirmPage(null);
    setDropping(pageNumber);
    void onDrop(pageNumber).finally(() => setDropping(null));
  }

  function askDrop(pageNumber: number) {
    if (pages.length === 1) {
      setConfirmPage(pageNumber);
      return;
    }
    drop(pageNumber);
  }

  return (
    <div ref={hostRef} className={cn("relative overflow-auto rounded-xl border border-line bg-bg-inset px-4 py-6", loading && "min-h-[560px]")}>
      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg-inset">
          <Spinner size={22} />
        </div>
      )}
      <div className={cn("mx-auto flex w-fit max-w-full flex-col gap-6", loading && "invisible")}>
        {pages.map((page) => (
          <section key={page} className="w-fit max-w-full">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-bold text-t1">Página {page}</span>
              <Tooltip label="Excluir página">
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-line text-bad transition-colors hover:bg-bad-soft disabled:opacity-50"
                  aria-label="Excluir página"
                  disabled={disabled || dropping != null}
                  onClick={() => askDrop(page)}
                >
                  <Icon d={icons.trash} size={14} />
                </button>
              </Tooltip>
            </div>
            <div
              data-page-box
              className="relative w-fit max-w-full bg-white shadow-lg"
              onClick={(event) => {
                if (disabled || (event.target as HTMLElement).closest("[data-mark]")) return;
                const added = pointAt(event.currentTarget, event.clientX, event.clientY, page, tool);
                const id = crypto.randomUUID();
                onChange([...fields, { ...added, id, signerId: activeSigner || "seller" }]);
                onSelect(id);
              }}
            >
              <canvas data-page={page} className="block h-auto max-w-full bg-white" />
              {fields
                .filter((field) => field.pageNumber === page && !loading)
                .map((field) => (
                  <MarkCard
                    key={field.id}
                    field={field}
                    people={people}
                    sellerId={sellerId}
                    guests={guests}
                    signers={signers}
                    disabled={disabled}
                    highlighted={sameSigner(field.signerId, activeSigner, sellerId)}
                    selected={selectedId === field.id}
                    onChange={(next) => onChange(fields.map((item) => (item.id === field.id ? next : item)))}
                    onPick={(value) => onPick(field, value)}
                    onDuplicate={() => {
                      const id = crypto.randomUUID();
                      onChange([...fields, { ...field, ...shiftedCopy(field), id }]);
                      onSelect(id);
                    }}
                    onRemove={() => onChange(fields.filter((item) => item.id !== field.id))}
                  />
                ))}
            </div>
          </section>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <Modal
        open={confirmPage != null}
        onClose={() => setConfirmPage(null)}
        title="Excluir página"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmPage(null)}>
              Cancelar
            </Button>
            <Button variant="danger" disabled={dropping != null} onClick={() => confirmPage != null && drop(confirmPage)}>
              Excluir documento
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-t1">Esta é a única página do documento. Ao excluí-la, o documento também será removido do lote.</p>
      </Modal>
    </div>
  );
}

function pointAt(element: HTMLElement, clientX: number, clientY: number, pageNumber: number, elementKind: SignatureMark["element"]): SignatureMark {
  const box = element.getBoundingClientRect();
  const x = Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100));
  const y = Math.min(100, Math.max(0, ((clientY - box.top) / box.height) * 100));
  return { pageNumber, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, element: elementKind };
}

function shiftedCopy(field: FieldMark): { x: number; y: number } {
  const y = Math.round((field.y + 8) * 10) / 10;
  if (y <= 92) return { x: field.x, y };
  const x = Math.round((field.x + 8) * 10) / 10;
  if (x <= 92) return { x, y: Math.min(field.y, 92) };
  return { x: Math.max(0, Math.round((field.x - 8) * 10) / 10), y: Math.min(field.y, 92) };
}

function sameSigner(signerId: string, activeSigner: string, sellerId: string | null) {
  if (!activeSigner) return false;
  if (signerId === activeSigner) return true;
  const owner = sellerId ? `seller:${sellerId}` : "";
  return (signerId === "seller" && (activeSigner === "seller" || activeSigner === owner)) || (activeSigner === "seller" && signerId === owner);
}

function MarkCard({
  field,
  people,
  sellerId,
  guests,
  signers,
  disabled,
  highlighted,
  selected,
  onChange,
  onPick,
  onDuplicate,
  onRemove,
}: {
  field: FieldMark;
  people: PersonRow[];
  sellerId: string | null;
  guests: GuestSigner[];
  signers: { id: string; name: string }[];
  disabled: boolean;
  highlighted: boolean;
  selected: boolean;
  onChange: (field: FieldMark) => void;
  onPick: (value: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const page = event.currentTarget.closest("[data-page-box]");
    if (!(page instanceof HTMLElement)) return;
    const next = pointAt(page, event.clientX, event.clientY, field.pageNumber, field.element);
    onChange({ ...field, x: next.x, y: next.y });
  }

  return (
    <div
      data-mark
      className="absolute z-20 w-[280px]"
      style={{ left: `${field.x}%`, top: `${field.y}%`, transform: "translate(-50%, -115%)" }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        if (!(event.target as HTMLElement).closest("[data-drag]")) return;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={move}
    >
      <div className={cn("rounded-[var(--radius-vela-md)] border bg-bg-2 text-t0 shadow-[0_12px_28px_-16px_rgba(0,0,0,0.55)]", highlighted || selected ? "border-acc" : "border-line")}>
        <div
          data-drag
          aria-label="Arrastar marcação"
          className="flex h-7 cursor-grab items-center justify-center rounded-t-[8px] text-t2 hover:bg-bg-3 active:cursor-grabbing"
        >
          <GripIcon />
        </div>
        <div className="grid gap-1.5 p-1.5">
          <select
            className="h-8 min-w-0 rounded-[var(--radius-vela-sm)] border border-line bg-bg-inset px-2 text-xs font-bold text-t0 outline-none focus:border-acc"
            value={field.signerId === "seller" ? (sellerId ? "seller" : "") : field.signerId}
            disabled={disabled}
            onChange={(event) => onPick(event.target.value)}
          >
            {field.signerId === "seller" && !sellerId && <option value="">Selecionar</option>}
            <SignerOptions people={people} sellerId={sellerId} guests={guests} signers={signers} />
          </select>
          <div className="flex gap-1">
            <Button type="button" size="sm" className="flex-1" disabled={disabled} variant={field.element === "SIGNATURE" ? "primary" : "secondary"} onClick={() => onChange({ ...field, element: "SIGNATURE" })}>
              Assinatura
            </Button>
            <Button type="button" size="sm" className="flex-1" disabled={disabled} variant={field.element === "RUBRIC" ? "primary" : "secondary"} onClick={() => onChange({ ...field, element: "RUBRIC" })}>
              Rubrica
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-end gap-1 border-t border-line px-1.5 py-1">
          <Tooltip label="Duplicar marcação">
            <button
              type="button"
              aria-label="Duplicar marcação"
              disabled={disabled}
              onClick={onDuplicate}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-line text-t1 transition-colors hover:bg-bg-3 disabled:opacity-50"
            >
              <CopyIcon />
            </button>
          </Tooltip>
          <Tooltip label="Excluir marcação">
            <button
              type="button"
              aria-label="Excluir marcação"
              disabled={disabled}
              onClick={onRemove}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-line text-bad transition-colors hover:bg-bad-soft disabled:opacity-50"
            >
              <Icon d={icons.trash} size={14} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function GripIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
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
