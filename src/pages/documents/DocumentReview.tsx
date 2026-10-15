import { useEffect, useRef, useState, type PointerEvent } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type RenderTask } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Alert, Button, FormField, Modal, Tooltip, WizardCardHeader, WizardNav } from "@/components/ui";
import { Spinner } from "@/components/ui/Skeleton";
import {
  AUTHENTICATIONS,
  DOCUMENT_COPY,
  DOCUMENT_LIMITS,
  asAuthentication,
  contactFieldsToAsk,
  documentIssue,
  displayTitle,
  guestAuthentication,
  guestChannel,
  preparationCaption,
  preparationReason,
  preparationSituation,
  resolveDrafts,
  saveCpf,
  saveEmail,
  saveWhatsapp,
  signerContactKey,
  type ContactEdit,
  signerCredits,
  type AuthenticationType,
  type DocumentDraft,
  type FieldMark,
  type GuestSigner,
  type SendChannel,
  type SignatureMark,
  type SignerContact,
} from "@/data/wedash/documentSplit";
import { openDocument, type DocumentRow, type PersonRow } from "@/data/wedash/documentsRepo";
import { Icon, icons } from "@/pages/users/Icons";
import { cn } from "@/lib/cn";
import { mascararCpf, maskWhatsapp } from "@/lib/cpf";
import { STATUS_LABEL } from "./frame";

GlobalWorkerOptions.workerSrc = pdfWorker;

const controlClass =
  "h-[42px] w-full rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3.5 text-[13px] text-t0 outline-none transition-colors focus:border-acc";

export function DocumentReview({
  rows,
  people,
  drafts,
  signers,
  history,
  activeId,
  refused,
  sending,
  onFocus,
  onDraft,
  onAssign,
  onDrop,
  onContact,
  onRemove,
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
  history: SignerContact[];
  activeId: string;
  refused: { name: string; message: string }[];
  sending: boolean;
  onFocus: (id: string) => void;
  onDraft: (id: string, draft: DocumentDraft) => void;
  onAssign: (documentId: string, sellerId: string) => Promise<void>;
  onDrop: (documentId: string, pageNumber: number) => Promise<void>;
  onContact: (sellerId: string, contact: ContactEdit) => void;
  onRemove: (id: string) => Promise<void>;
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
    if (documentIssue(people.find((item) => item.id === row.sellerId) ?? null, resolved[index], row.pageCount, signers, people, row.sizeBytes)) return false;
    return Boolean(opened[row.id]) || index === 0;
  }).length;
  const openRows = rows.filter((row) => !row.envelopeId).length;
  const index = Math.max(0, rows.findIndex((row) => row.id === activeId));
  const row = rows[index];
  const draft = row ? drafts[row.id] : undefined;
  const unidentified = rows.filter((item) => !item.sellerId && !item.envelopeId).length;
  const attention = openRows - ready;
  const situationOf = (item: DocumentRow, itemIndex: number) => {
    const person = people.find((candidate) => candidate.id === item.sellerId) ?? null;
    const situation = preparationSituation(person, resolved[itemIndex], item.pageCount, signers, people, item.envelopeId, item.sizeBytes);
    const reviewed = Boolean(opened[item.id]) || itemIndex === 0;
    const reason = preparationReason(person, resolved[itemIndex], item.pageCount, signers, people, item.envelopeId, item.sizeBytes, reviewed);
    return preparationCaption(situation, reason);
  };

  return (
    <>
      <WizardCardHeader
        title="Preparar documentos"
        subtitle="Vincule o colaborador, defina os signatários e posicione as marcações de assinatura."
      />
      {analyzed && rows.length > 0 && (
        <p className="mt-3 text-[13px] text-t2">
          {analyzed.files} {analyzed.files === 1 ? "arquivo analisado" : "arquivos analisados"} · {rows.length}{" "}
          {rows.length === 1 ? "documento separado" : "documentos separados"}
          {unidentified > 0 && unidentified === attention
            ? ` · ${unidentified} sem colaborador identificado`
            : attention > 0
              ? ` · ${attention} ${attention === 1 ? "precisa" : "precisam"} de atenção`
              : ""}
          {analyzed.merged > 0
            ? analyzed.merged === 1
              ? ". 1 documento reuniu páginas de arquivos diferentes."
              : `. ${analyzed.merged} documentos reuniram páginas de arquivos diferentes.`
            : "."}
        </p>
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
          history={history}
          index={index}
          total={rows.length}
          rows={rows}
          period={period}
          situationOf={situationOf}
          sending={sending}
          onFocus={onFocus}
          onDraft={(next) => onDraft(row.id, next)}
          onAssign={onAssign}
          onDrop={onDrop}
          onContact={onContact}
          onRemove={() => onRemove(row.id)}
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
      {openRows > 0 && ready !== openRows && (
        <p className="mt-3 text-sm text-t2">Conclua ou exclua os documentos pendentes para revisar o envio.</p>
      )}
      <div className="mt-4">
        <WizardNav
          hideNextIcon
          previousDisabled={sending}
          nextDisabled={sending || openRows === 0 || ready !== openRows}
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
  history,
  index,
  total,
  rows,
  period,
  situationOf,
  sending,
  onFocus,
  onDraft,
  onAssign,
  onDrop,
  onContact,
  onRemove,
}: {
  row: DocumentRow;
  draft: DocumentDraft;
  people: PersonRow[];
  signers: { id: string; name: string; email: string }[];
  history: SignerContact[];
  index: number;
  total: number;
  rows: DocumentRow[];
  period: string;
  situationOf: (item: DocumentRow, itemIndex: number) => string;
  sending: boolean;
  onFocus: (id: string) => void;
  onDraft: (draft: DocumentDraft) => void;
  onAssign: (documentId: string, sellerId: string) => Promise<void>;
  onDrop: (documentId: string, pageNumber: number) => Promise<void>;
  onContact: (sellerId: string, contact: ContactEdit) => void;
  onRemove: () => Promise<void>;
}) {
  const person = people.find((item) => item.id === row.sellerId) ?? null;
  const issue = row.envelopeId ? null : documentIssue(person, draft, row.pageCount, signers, people, row.sizeBytes);
  const previous = index > 0 ? rows[index - 1] : null;
  const next = index < total - 1 ? rows[index + 1] : null;
  const locked = Boolean(row.envelopeId) || sending;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  function saveDraft(next: DocumentDraft) {
    onDraft(next);
    if (!next.fields.some((field) => field.signerId === "seller") && row.sellerId) void onAssign(row.id, "");
  }

  function changeFields(fields: FieldMark[]) {
    saveDraft({ ...draft, fields });
  }

  function guestsWithoutEmpty(signerId: string, exceptFieldId: string) {
    if (!signerId.startsWith("guest:")) return draft.guests ?? [];
    const guestId = signerId.slice("guest:".length);
    const stillUsed = draft.fields.some((field) => field.id !== exceptFieldId && field.signerId === signerId);
    const guest = (draft.guests ?? []).find((item) => item.id === guestId);
    if (stillUsed || guest?.name.trim()) return draft.guests ?? [];
    return (draft.guests ?? []).filter((item) => item.id !== guestId);
  }

  function addGuest(assignTo: FieldMark, contact?: SignerContact) {
    const guest: GuestSigner = {
      id: crypto.randomUUID(),
      name: contact?.name ?? "",
      email: contact?.email ?? "",
      whatsapp: contact?.whatsapp ?? "",
      channel: "WHATSAPP",
      authentication: "DEFAULT_SIGN",
    };
    saveDraft({
      ...draft,
      guests: [...guestsWithoutEmpty(assignTo.signerId, assignTo.id), guest],
      fields: draft.fields.map((item) => (item.id === assignTo.id ? { ...item, signerId: `guest:${guest.id}` } : item)),
    });
    setSelectedId(assignTo.id);
  }

  function pickSigner(field: FieldMark, value: string) {
    if (value === "__guest__") {
      addGuest(field);
      return;
    }
    if (value.startsWith("history:")) {
      const contact = history[Number(value.slice("history:".length))];
      if (!contact) return;
      const existing = (draft.guests ?? []).find((guest) => signerContactKey(guest) === signerContactKey(contact));
      if (existing) {
        saveDraft({
          ...draft,
          guests: guestsWithoutEmpty(field.signerId, field.id),
          fields: draft.fields.map((item) => (item.id === field.id ? { ...item, signerId: `guest:${existing.id}` } : item)),
        });
        return;
      }
      addGuest(field, contact);
      return;
    }
    if (value === "seller" || people.some((item) => item.id === value)) {
      const personId = value === "seller" ? row.sellerId : value;
      saveDraft({
        ...draft,
        fields: draft.fields.map((item) => (item.id === field.id ? { ...item, signerId: "seller" } : item)),
      });
      if (personId && personId !== row.sellerId) void onAssign(row.id, personId);
      return;
    }
    saveDraft({
      ...draft,
      guests: guestsWithoutEmpty(field.signerId, field.id),
      fields: draft.fields.map((item) => (item.id === field.id ? { ...item, signerId: value } : item)),
    });
  }

  function placeMark(mark: SignatureMark) {
    const id = crypto.randomUUID();
    saveDraft({ ...draft, fields: [...draft.fields, { ...mark, id, signerId: row.sellerId ? "" : "seller" }] });
    setSelectedId(id);
  }

  return (
    <div className="mt-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" disabled={!previous || sending} onClick={() => previous && onFocus(previous.id)}>
          Anterior
        </Button>
        <DocumentSwitcher rows={rows} people={people} index={index} situationOf={situationOf} onFocus={onFocus} />
        <Button type="button" variant="secondary" disabled={!next || sending} onClick={() => next && onFocus(next.id)}>
          Próximo
        </Button>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-[13px] text-t2">
              {documentTitle(rows, row, people)} · {period} · {row.pageCount === 1 ? "1 página" : `${row.pageCount} páginas`}
            </p>
            {!locked && (
              <Tooltip label="Excluir documento">
                <button
                  type="button"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-line text-bad transition-colors hover:bg-bad-soft"
                  aria-label="Excluir documento"
                  onClick={() => setConfirmRemove(true)}
                >
                  <Icon d={icons.trash} size={14} />
                </button>
              </Tooltip>
            )}
          </div>
          {!locked && (
            <Alert className="mb-3" title="Clique no documento para posicionar uma assinatura ou rubrica." />
          )}
          <StackedPages
            documentId={row.id}
            pageCount={row.pageCount}
            fields={draft.fields}
            people={people}
            sellerId={row.sellerId}
            guests={draft.guests ?? []}
            history={history}
            disabled={locked}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={changeFields}
            onPick={pickSigner}
            onPlace={placeMark}
            onDrop={(pageNumber) => onDrop(row.id, pageNumber)}
          />
        </div>
        <aside className="flex max-h-[calc(100vh-6rem)] flex-col gap-3 overflow-y-auto rounded-xl border border-line p-3 lg:sticky lg:top-4">
          {row.envelopeId ? (
            <p className="text-[13px] text-t2">{STATUS_LABEL[row.status]}</p>
          ) : (
            <DraftFields
              person={person}
              draft={draft}
              people={people}
              signers={signers}
              issue={issue}
              pageCount={row.pageCount}
              sizeBytes={row.sizeBytes}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onDraft={onDraft}
              onContact={onContact}
            />
          )}
        </aside>
      </div>
      <Modal
        open={confirmRemove}
        onClose={() => {
          if (!removing) setConfirmRemove(false);
        }}
        title="Excluir documento"
        footer={
          <>
            <Button variant="outline" disabled={removing} onClick={() => setConfirmRemove(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={removing}
              onClick={() => {
                setRemoving(true);
                void onRemove().then(
                  () => {
                    setConfirmRemove(false);
                    setRemoving(false);
                  },
                  () => setRemoving(false),
                );
              }}
            >
              {removing ? "Excluindo…" : "Excluir"}
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-t1">Este documento sai do lote. Os outros permanecem.</p>
      </Modal>
    </div>
  );
}

function channelContactsReady(
  person: PersonRow | null,
  draft: DocumentDraft,
  people: PersonRow[],
  signers: { id: string; email: string }[],
) {
  if (!person || channelGap(person, draft.channel)) return false;
  if (!saveCpf(person.cpf ?? "").ok) return false;
  if (draft.channel === "EMAIL") {
    const saved = saveEmail(person.email ?? "");
    if (!saved.ok || !saved.email) return false;
  }
  if (draft.channel === "WHATSAPP" || asAuthentication(draft.authentication) === "SMS") {
    const saved = saveWhatsapp(person.whatsapp ?? "");
    if (!saved.ok || !saved.whatsapp) return false;
  }
  const seen = new Set<string>();
  for (const field of draft.fields) {
    if (!field.signerId || field.signerId === "seller" || seen.has(field.signerId)) continue;
    seen.add(field.signerId);
    if (field.signerId.startsWith("seller:")) {
      const other = people.find((item) => item.id === field.signerId.slice("seller:".length));
      if (!other || channelGap(other, draft.channel)) return false;
    } else if (field.signerId.startsWith("user:")) {
      const user = signers.find((item) => item.id === field.signerId.slice("user:".length));
      if (!user?.email.trim()) return false;
    } else if (field.signerId.startsWith("guest:")) {
      const guest = (draft.guests ?? []).find((item) => item.id === field.signerId.slice("guest:".length));
      if (!guest?.name.trim()) return false;
      const send = guestChannel(guest);
      if (send === "WHATSAPP" || guestAuthentication(guest) === "SMS") {
        const saved = saveWhatsapp(guest.whatsapp);
        if (!saved.ok || !saved.whatsapp) return false;
      }
      if (send === "EMAIL") {
        const saved = saveEmail(guest.email);
        if (!saved.ok || !saved.email) return false;
      }
    }
  }
  return true;
}

function documentTitle(_rows: DocumentRow[], item: DocumentRow, people: PersonRow[]) {
  const title = displayTitle(item.fileName);
  const named = people.find((person) => person.id === item.sellerId);
  if (named) return `${title} · ${named.name}`;
  return title;
}

function DocumentSwitcher({
  rows,
  people,
  index,
  situationOf,
  onFocus,
}: {
  rows: DocumentRow[];
  people: PersonRow[];
  index: number;
  situationOf: (item: DocumentRow, itemIndex: number) => string;
  onFocus: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const row = rows[index];
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);
  if (!row) return null;
  const needle = query.trim().toLowerCase();
  const visible = rows
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter(({ item, itemIndex }) => {
      if (!needle) return true;
      return documentTitle(rows, item, people).toLowerCase().includes(needle) || situationOf(item, itemIndex).toLowerCase().includes(needle);
    });
  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-expanded={open}
        className="flex h-10 w-full min-w-0 items-center rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3 text-left outline-none focus:border-acc"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-bold text-t0">Documento {index + 1} de {rows.length} · {documentTitle(rows, row, people)}</span>
        </span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-xl border border-line bg-bg-2 shadow-[var(--shadow-vela)]">
          {rows.length > 8 && (
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar documento"
              className="h-10 w-full border-b border-line bg-bg-inset px-3 text-[13px] text-t0 outline-none"
            />
          )}
          <div className="max-h-64 overflow-y-auto">
            {visible.map(({ item, itemIndex }) => (
              <button
                key={item.id}
                type="button"
                className={cn("flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-bg-3 focus:bg-bg-3", item.id === row.id && "bg-bg-inset")}
                onClick={() => {
                  onFocus(item.id);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span className="truncate text-[13px] font-bold text-t0">{documentTitle(rows, item, people)}</span>
                <span className="shrink-0 text-[12px] font-bold text-t2">{situationOf(item, itemIndex)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function channelGap(person: { cpf: string | null; email: string | null; whatsapp: string | null }, channel: DocumentDraft["channel"]) {
  const ask = contactFieldsToAsk(person, channel);
  if (channel === "WHATSAPP" && (ask.whatsapp || ask.cpf)) return ask.whatsapp ? "Sem WhatsApp" : "Sem CPF";
  if (channel === "EMAIL" && (ask.email || ask.cpf)) return ask.email ? "Sem e-mail" : "Sem CPF";
  if (ask.cpf) return "Sem CPF";
  return null;
}

function signerGroups(draft: DocumentDraft, person: PersonRow | null, people: PersonRow[], signers: { id: string; name: string; email: string }[]) {
  const order: string[] = [];
  const map = new Map<string, FieldMark[]>();
  for (const field of draft.fields) {
    const key = field.signerId || "none";
    if (!map.has(key)) {
      order.push(key);
      map.set(key, []);
    }
    map.get(key)?.push(field);
  }
  return order.map((key) => {
    const marks = map.get(key) ?? [];
    if (key === "none") {
      return { key, name: "Sem signatário", role: null as "Principal" | "Adicional" | null, origin: "", pending: "Escolha quem assina", marks, person: null, guest: null, userEmail: null, channel: null as SendChannel | null, authentication: null as AuthenticationType | null };
    }
    if (key === "seller" && !person) {
      return { key, name: "Colaborador do documento", role: null, origin: "Colaborador", pending: "Sem colaborador", marks, person: null, guest: null, userEmail: null, channel: draft.channel, authentication: asAuthentication(draft.authentication) };
    }
    if (key === "seller" && person) {
      return { key, name: person.name, role: "Principal" as const, origin: "Colaborador", pending: channelGap(person, draft.channel), marks, person, guest: null, userEmail: null, channel: draft.channel, authentication: asAuthentication(draft.authentication) };
    }
    if (key.startsWith("seller:")) {
      const named = people.find((item) => item.id === key.slice("seller:".length)) ?? null;
      return { key, name: named?.name ?? "Colaborador", role: "Adicional" as const, origin: "Colaborador", pending: named ? channelGap(named, draft.channel) : "Sem contato", marks, person: named, guest: null, userEmail: null, channel: draft.channel, authentication: asAuthentication(draft.authentication) };
    }
    if (key.startsWith("user:")) {
      const named = signers.find((item) => item.id === key.slice("user:".length));
      return { key, name: named?.name ?? "Usuário", role: "Adicional" as const, origin: "Usuário", pending: named?.email ? null : "Sem e-mail", marks, person: null, guest: null, userEmail: named?.email ?? null, channel: "EMAIL" as const, authentication: "DEFAULT_SIGN" as const };
    }
    const guest = (draft.guests ?? []).find((item) => item.id === key.slice("guest:".length)) ?? null;
    const channel = guestChannel(guest);
    const pending = !guest?.name.trim()
      ? "Informe o nome"
      : channel === "WHATSAPP" && !guest.whatsapp.trim()
        ? "Sem WhatsApp"
        : channel === "EMAIL" && !guest.email.trim()
          ? "Sem e-mail"
          : null;
    return { key, name: guest?.name.trim() || "Outra pessoa", role: "Adicional" as const, origin: "Outra pessoa", pending, marks, person: null, guest, userEmail: null, channel, authentication: guestAuthentication(guest) };
  });
}

function DraftFields({
  person,
  draft,
  people,
  signers,
  issue,
  pageCount,
  sizeBytes,
  selectedId,
  onSelect,
  onDraft,
  onContact,
}: {
  person: PersonRow | null;
  draft: DocumentDraft;
  people: PersonRow[];
  signers: { id: string; name: string; email: string }[];
  issue: string | null;
  pageCount: number;
  sizeBytes: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDraft: (draft: DocumentDraft) => void;
  onContact: (sellerId: string, contact: ContactEdit) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const groups = signerGroups(draft, person, people, signers);
  useEffect(() => {
    const field = draft.fields.find((item) => item.id === selectedId);
    if (!field) return;
    setOpenKey(field.signerId || "none");
  }, [draft.fields, selectedId]);

  const ownerMarked = draft.fields.some((field) => field.signerId === "seller" && field.pageNumber >= 1 && field.pageNumber <= pageCount);
  const marksValid =
    ownerMarked &&
    !draft.fields.some((field) => !field.signerId || field.pageNumber < 1 || field.pageNumber > pageCount);
  const contactsValid = channelContactsReady(person, draft, people, signers);
  const sizeValid = sizeBytes <= DOCUMENT_LIMITS.maxEnvelopeBytes;

  return (
    <>
      <section className="rounded-xl border border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-t2">Signatários</p>
          <span className="text-[11px] font-bold text-t2">{groups.length === 1 ? "1 signatário" : `${groups.length} signatários`}</span>
        </div>
        {groups.length === 0 ? (
          <p className="mt-2 text-[13px] text-t2">Nenhuma marcação adicionada.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {groups.map((group) => {
              const open = openKey === group.key;
              return (
                <li key={group.key} className="rounded-lg border border-line">
                  <button type="button" className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-bg-3" onClick={() => setOpenKey(open ? null : group.key)}>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold text-t0">{group.name}</span>
                      <span className="block text-[11px] text-t2">
                        {group.role ? `${group.role} · ` : ""}
                        {group.origin ? `${group.origin} · ` : ""}
                        {group.marks.length} {group.marks.length === 1 ? "marcação" : "marcações"}
                        {group.channel && group.authentication ? ` · ${deliveryCaption(group.channel, group.authentication)}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] font-bold text-warn">{group.pending}</span>
                  </button>
                  {open && (
                    <div className="grid gap-2 border-t border-line px-2.5 py-2">
                      {group.marks.map((field) => (
                        <button
                          key={field.id}
                          type="button"
                          className={cn("rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-bg-3", selectedId === field.id ? "bg-bg-inset font-bold text-t0" : "text-t1")}
                          onClick={() => onSelect(field.id)}
                        >
                          {field.element === "RUBRIC" ? "Rubrica" : "Assinatura"} · Página {field.pageNumber}
                        </button>
                      ))}
                      {(group.key === "seller" || group.guest) && group.channel && group.authentication && (
                        <DeliveryFields
                          channel={group.channel}
                          authentication={group.authentication}
                          onChannel={(channel) => {
                            if (!group.guest) {
                              onDraft({ ...draft, channel });
                              return;
                            }
                            onDraft({
                              ...draft,
                              guests: (draft.guests ?? []).map((item) => (item.id === group.guest?.id ? { ...item, channel } : item)),
                            });
                          }}
                          onAuthentication={(authentication) => {
                            if (!group.guest) {
                              onDraft({ ...draft, authentication });
                              return;
                            }
                            onDraft({
                              ...draft,
                              guests: (draft.guests ?? []).map((item) => (item.id === group.guest?.id ? { ...item, authentication } : item)),
                            });
                          }}
                        />
                      )}
                      {group.person && (
                        <ContactEditor person={group.person} onContact={onContact} />
                      )}
                      {group.guest && (
                        <GuestEditor guest={group.guest} onChange={(next) => onDraft({ ...draft, guests: (draft.guests ?? []).map((item) => (item.id === group.guest?.id ? next : item)) })} />
                      )}
                      {group.userEmail && <p className="text-[12.5px] text-t2">E-mail da conta: {group.userEmail}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="rounded-xl border border-line p-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-t2">Situação do documento</p>
        <ul className="mt-2 grid gap-1.5">
          <CheckRow ok={Boolean(person) && ownerMarked} label="Colaborador identificado" />
          <CheckRow ok={marksValid} label="Marcações válidas" />
          <CheckRow ok={contactsValid} label="Contato para envio válido" />
          <CheckRow ok={sizeValid} label="Tamanho do PDF válido" />
        </ul>
        {issue && !["Escolha o colaborador.", "Falta contato no cadastro.", "Escolha quem assina esta marcação.", DOCUMENT_COPY.badCpf, DOCUMENT_COPY.badEmail, DOCUMENT_COPY.badWhatsapp, DOCUMENT_COPY.overEnvelope, DOCUMENT_COPY.missingPage].includes(issue) && <p className="mt-2 text-xs text-bad">{issue}</p>}
        {!sizeValid && <p className="mt-2 text-xs text-bad">{DOCUMENT_COPY.overEnvelope}</p>}
      </section>
    </>
  );
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center justify-between gap-2 text-[13px]">
      <span className="text-t1">{label}</span>
      <span className={cn("flex shrink-0", ok ? "text-ok" : "text-bad")} role="img" aria-label={ok ? "Ok" : "Pendente"}>
        <Icon d={ok ? icons.check : icons.x} size={16} />
      </span>
    </li>
  );
}

function SignerOptions({
  people,
  sellerId,
  guests,
  history,
  collaborator,
  allowNew = true,
}: {
  people: PersonRow[];
  sellerId: string | null;
  guests: GuestSigner[];
  history: SignerContact[];
  collaborator: boolean;
  allowNew?: boolean;
}) {
  if (collaborator) {
    return (
      <>
        <option value="">Selecionar colaborador</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </>
    );
  }
  const known = new Set((guests ?? []).filter((guest) => guest.name.trim()).map((guest) => signerContactKey(guest)));
  return (
    <>
      <option value="">Signatário</option>
      {people.map((person) => (
        <option key={person.id} value={person.id === sellerId ? "seller" : person.id}>
          {person.name}
        </option>
      ))}
      {guests.map((guest) => (
        <option key={guest.id} value={`guest:${guest.id}`}>
          {guest.name.trim() || "Nova pessoa"}
        </option>
      ))}
      {history.map((contact, index) =>
        known.has(signerContactKey(contact)) ? null : (
          <option key={signerContactKey(contact)} value={`history:${index}`}>
            {contact.name}
          </option>
        ),
      )}
      {allowNew && <option value="__guest__">Nova pessoa</option>}
    </>
  );
}

function ContactEditor({ person, onContact }: { person: PersonRow; onContact: (sellerId: string, contact: ContactEdit) => void }) {
  const hint = contactHint(person);
  function change(next: ContactEdit) {
    onContact(person.id, next);
  }
  return (
    <div className="grid gap-2">
      <FormField label="CPF">
        <input className={controlClass} value={mascararCpf(person.cpf ?? "")} inputMode="numeric" placeholder="000.000.000-00" onChange={(event) => change({ cpf: mascararCpf(event.target.value), email: person.email ?? "", whatsapp: person.whatsapp ?? "" })} />
      </FormField>
      <FormField label="E-mail">
        <input className={controlClass} value={person.email ?? ""} placeholder="nome@email.com" onChange={(event) => change({ cpf: person.cpf ?? "", email: event.target.value, whatsapp: person.whatsapp ?? "" })} />
      </FormField>
      <FormField label="WhatsApp">
        <input className={controlClass} value={maskWhatsapp(person.whatsapp ?? "")} inputMode="tel" placeholder="(11) 99999-9999" onChange={(event) => change({ cpf: person.cpf ?? "", email: person.email ?? "", whatsapp: maskWhatsapp(event.target.value) })} />
      </FormField>
      {hint && <p className="text-xs text-bad">{hint}</p>}
    </div>
  );
}

function contactHint(person: { cpf: string | null; email: string | null; whatsapp: string | null }) {
  if (person.cpf?.trim()) {
    const saved = saveCpf(person.cpf);
    if (!saved.ok) return saved.message;
  }
  if (person.email?.trim()) {
    const saved = saveEmail(person.email);
    if (!saved.ok) return saved.message;
  }
  if (person.whatsapp?.trim()) {
    const saved = saveWhatsapp(person.whatsapp);
    if (!saved.ok) return saved.message;
  }
  return null;
}

function GuestEditor({ guest, onChange }: { guest: GuestSigner; onChange: (guest: GuestSigner) => void }) {
  return (
    <div className="grid gap-2">
      <p className="text-[13px] font-bold text-t0">Contato deste envio</p>
      <FormField label="Nome">
        <input className={controlClass} value={guest.name} onChange={(event) => onChange({ ...guest, name: event.target.value })} />
      </FormField>
      <FormField label="E-mail">
        <input className={controlClass} value={guest.email} onChange={(event) => onChange({ ...guest, email: event.target.value })} />
      </FormField>
      <FormField label="WhatsApp">
        <input className={controlClass} value={maskWhatsapp(guest.whatsapp)} inputMode="tel" placeholder="(11) 99999-9999" onChange={(event) => onChange({ ...guest, whatsapp: maskWhatsapp(event.target.value) })} />
      </FormField>
    </div>
  );
}

function deliveryCaption(channel: SendChannel, authentication: AuthenticationType) {
  const auth = AUTHENTICATIONS.find((item) => item.id === authentication)?.label ?? "Assinatura na tela";
  const credits = signerCredits(channel, authentication);
  const credit = credits > 0 ? ` · ${credits} ${credits === 1 ? "crédito" : "créditos"}` : "";
  return `${channel === "EMAIL" ? "E-mail" : "WhatsApp"} · ${auth}${credit}`;
}

function DeliveryFields({
  channel,
  authentication,
  onChannel,
  onAuthentication,
}: {
  channel: SendChannel;
  authentication: AuthenticationType;
  onChannel: (channel: SendChannel) => void;
  onAuthentication: (authentication: AuthenticationType) => void;
}) {
  const credits = signerCredits(channel, authentication);
  const detail = AUTHENTICATIONS.find((item) => item.id === authentication)?.detail;
  return (
    <div className="grid gap-2">
      <FormField label="Canal">
        <select className={controlClass} value={channel} onChange={(event) => onChannel(event.target.value as SendChannel)}>
          <option value="WHATSAPP">WhatsApp · 1 crédito</option>
          <option value="EMAIL">E-mail</option>
        </select>
      </FormField>
      <FormField label="Autenticação">
        <select className={controlClass} value={authentication} onChange={(event) => onAuthentication(asAuthentication(event.target.value))}>
          {AUTHENTICATIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
              {item.credits > 0 ? ` · ${item.credits} crédito` : ""}
            </option>
          ))}
        </select>
      </FormField>
      {detail && <p className="text-[11.5px] text-t2">{detail}</p>}
      {credits > 0 && (
        <p className="text-[11.5px] text-t2">
          {credits === 1 ? "Este signatário usa 1 crédito do Assina AI." : `Este signatário usa ${credits} créditos do Assina AI.`}
        </p>
      )}
    </div>
  );
}

function StackedPages({
  documentId,
  pageCount,
  fields,
  people,
  sellerId,
  guests,
  history,
  disabled,
  selectedId,
  onSelect,
  onChange,
  onPick,
  onPlace,
  onDrop,
}: {
  documentId: string;
  pageCount: number;
  fields: FieldMark[];
  people: PersonRow[];
  sellerId: string | null;
  guests: GuestSigner[];
  history: SignerContact[];
  disabled: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (fields: FieldMark[]) => void;
  onPick: (field: FieldMark, value: string) => void;
  onPlace: (mark: SignatureMark) => void;
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
                onPlace(pointAt(event.currentTarget, event.clientX, event.clientY, page, "SIGNATURE"));
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
                    history={history}
                    disabled={disabled}
                    selected={selectedId === field.id}
                    onSelect={() => onSelect(field.id)}
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

function MarkCard({
  field,
  people,
  sellerId,
  guests,
  history,
  disabled,
  selected,
  onSelect,
  onChange,
  onPick,
  onDuplicate,
  onRemove,
}: {
  field: FieldMark;
  people: PersonRow[];
  sellerId: string | null;
  guests: GuestSigner[];
  history: SignerContact[];
  disabled: boolean;
  selected: boolean;
  onSelect: () => void;
  onChange: (field: FieldMark) => void;
  onPick: (value: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const drag = useRef<{ pointerId: number; originX: number; originY: number; startX: number; startY: number; moved: boolean } | null>(null);

  function move(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) < 4) return;
    state.moved = true;
    const page = event.currentTarget.closest("[data-page-box]");
    if (!(page instanceof HTMLElement)) return;
    const box = page.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    const x = Math.min(100, Math.max(0, state.originX + (dx / box.width) * 100));
    const y = Math.min(100, Math.max(0, state.originY + (dy / box.height) * 100));
    onChange({ ...field, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }

  return (
    <div
      data-mark
      className="absolute z-20 w-[280px]"
      style={{ left: `${field.x}%`, top: `${field.y}%`, transform: "translate(-50%, -115%)" }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        onSelect();
        if (disabled || !(event.target as HTMLElement).closest("[data-drag]")) return;
        event.stopPropagation();
        drag.current = {
          pointerId: event.pointerId,
          originX: field.x,
          originY: field.y,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      <div className={cn("rounded-[var(--radius-vela-md)] border bg-bg-2 text-t0 shadow-[0_12px_28px_-16px_rgba(0,0,0,0.55)]", selected ? "border-acc" : "border-line")}>
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
            value={sellerId ? (field.signerId === "seller" ? "seller" : field.signerId) : field.signerId === "seller" ? "" : field.signerId}
            disabled={disabled}
            onChange={(event) => onPick(event.target.value)}
          >
            <SignerOptions
              people={people}
              sellerId={sellerId}
              guests={guests}
              history={history}
              collaborator={!sellerId}
              allowNew={!guests.some((guest) => field.signerId === `guest:${guest.id}` && !guest.name.trim())}
            />
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
