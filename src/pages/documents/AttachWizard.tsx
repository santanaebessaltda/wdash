import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Breadcrumbs, Button, Card, CardHeader, CardTitle, FormField, Modal, ProgressBar, WizardCardHeader, WizardNav, WizardSteps } from "@/components/ui";
import { Spinner } from "@/components/ui/Skeleton";
import { paths } from "@/router/paths";
import { Icon, icons } from "@/pages/users/Icons";
import { useDocuments } from "./useDocuments";
import { cn } from "@/lib/cn";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_COPY,
  DOCUMENT_LIMITS,
  applyContactEdit,
  contactPatch,
  customDocumentName,
  asAuthentication,
  displayTitle,
  extraSignersFrom,
  guestAuthentication,
  guestChannel,
  signerCredits,
  fieldAfterDrop,
  monthFolder,
  preparationSituation,
  remainingPages,
  resolveDrafts,
  sellerMarks,
  type ContactEdit,
  type DocumentDraft,
  type SignerContact,
} from "@/data/wedash/documentSplit";
import {
  assignDocument,
  confirmBatch,
  dropDocumentPage,
  deleteDocument,
  prepareFiles,
  saveEmployeeContact,
  type DocumentRow,
  type PersonRow,
  type PrepareFile,
  type PrepareStatus,
} from "@/data/wedash/documentsRepo";
import { formatBytes } from "./frame";
import { DocumentReview } from "./DocumentReview";

const NO_USERS: { id: string; name: string; email: string }[] = [];

const controlClass =
  "h-[42px] w-full rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3.5 text-[13px] text-t0 outline-none transition-colors focus:border-acc";

const STEPS = [
  { num: 1, label: "Anexar" },
  { num: 2, label: "Preparar" },
  { num: 3, label: "Revisar" },
];

export function AttachWizard({
  storeId,
  people,
  documents,
  history,
  onReload,
  onClose,
  onDone,
}: {
  storeId: string | null;
  people: PersonRow[];
  documents: DocumentRow[];
  history: SignerContact[];
  onReload: () => Promise<void>;
  onClose: () => void;
  onDone: (notice: string | null, sent?: string | null) => void;
}) {
  const [step, setStep] = useState(1);
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [category, setCategory] = useState<string>(DOCUMENT_CATEGORIES[0]);
  const [customName, setCustomName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DocumentDraft | undefined>>({});
  const [opened, setOpened] = useState<Record<string, true>>({});
  const [activeId, setActiveId] = useState("");
  const openAtStart = useRef(true);
  const [batchId, setBatchId] = useState("");
  const [refused, setRefused] = useState<{ name: string; message: string }[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<PrepareStatus>({ phase: "upload", index: 1, total: 1, name: "PDF", files: [] });
  const [analyzed, setAnalyzed] = useState<{ files: number; merged: number } | null>(null);
  const [outcomes, setOutcomes] = useState<PrepareFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [contactEdits, setContactEdits] = useState<Record<string, ContactEdit>>({});
  const signers = NO_USERS;
  const shownPeople = useMemo(
    () => people.map((person) => applyContactEdit(person, contactEdits) ?? person),
    [people, contactEdits],
  );

  const rows = useMemo(
    () =>
      documents
        .filter((doc) => doc.batchId === batchId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    [documents, batchId],
  );
  const rowKey = rows.map((row) => `${row.id}:${row.pageCount}`).join("|");

  useEffect(() => {
    if (step === 1) openAtStart.current = true;
  }, [step]);

  useEffect(() => {
    if (step !== 2 || !activeId) return;
    setOpened((current) => (current[activeId] ? current : { ...current, [activeId]: true }));
  }, [step, activeId]);

  useEffect(() => {
    if (step !== 2 || !openAtStart.current || rows.length === 0) return;
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
    setProgress({ phase: "upload", index: 1, total: files.length, name: files[0]?.name ?? "PDF", files: [] });
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
      setRefused(prepared.refused);
      setProgress({ phase: "review", files: prepared.files });
      if (prepared.created.length === 0) {
        setBatchId("");
        setOutcomes(prepared.files);
        setError("Nenhum arquivo pôde ser separado. Remova os recusados e continue com os PDFs válidos.");
        return;
      }
      setBatchId(prepared.batchId);
      setAnalyzed({ files: files.length, merged: prepared.merged });
      setOutcomes([]);
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
    setSentNote(null);
    try {
      const resolved = resolveDrafts(
        rows.map((row) => ({ id: row.id, pageCount: row.pageCount })),
        drafts,
      );
      const readySellers = new Set(
        situations(rows, drafts, shownPeople, signers, opened)
          .filter((item) => item.situation === "Pronto" && item.row.sellerId)
          .map((item) => item.row.sellerId as string),
      );
      for (const sellerId of readySellers) {
        const edit = contactEdits[sellerId];
        const person = people.find((item) => item.id === sellerId);
        if (!edit || !person) continue;
        const next = contactPatch({ cpf: edit.cpf, email: edit.email, whatsapp: edit.whatsapp });
        if (!next.ok) throw new Error(next.message);
        if (next.patch.cpf === person.cpf && (next.patch.email ?? null) === person.email && (next.patch.whatsapp ?? null) === person.whatsapp) continue;
        await saveEmployeeContact({ sellerId, cpf: edit.cpf, email: edit.email, whatsapp: edit.whatsapp });
      }
      if (readySellers.size > 0) {
        setContactEdits((current) => {
          const next = { ...current };
          for (const id of readySellers) delete next[id];
          return next;
        });
        await onReload();
      }
      const before = situations(rows, drafts, shownPeople, signers, opened);
      const readyIds = new Set(before.filter((item) => item.situation === "Pronto").map((item) => item.row.id));
      const heldBack = before.filter((item) => item.situation !== "Pronto" && item.situation !== "Já enviado").length;
      const sent = await confirmBatch({
        batchId,
        deadline: "",
        reminder: "EVERY_3_DAYS",
        documents: rows.map((row, index) => ({
          id: row.id,
          channel: resolved[index].channel,
          authentication: asAuthentication(resolved[index].authentication),
          marks: sellerMarks(resolved[index].fields),
          deadline: resolved[index].deadline,
          reminder: resolved[index].reminder,
          extraSigners: extraSignersFrom(resolved[index].fields, signers, row.pageCount, {
            people: shownPeople,
            guests: resolved[index].guests,
            channel: resolved[index].channel,
          }),
        })),
        extraSigner: null,
      });
      await onReload();
      const failed = (sent.results ?? []).filter((item) => item.error && readyIds.has(item.id));
      const sentCount = readyIds.size - failed.length;
      if (failed.length > 0 && sentCount === 0) {
        setError(failed.length === 1 && failed[0].error ? failed[0].error : "Os documentos prontos não foram enviados. Tente novamente.");
        setSending(false);
        setConfirmSend(false);
        return;
      }
      setConfirmSend(false);
      if (heldBack > 0 || failed.length > 0) {
        setSentNote(
          `${sentCount} ${sentCount === 1 ? "documento enviado" : "documentos enviados"}. ${heldBack} ${heldBack === 1 ? "ficou de fora porque precisa" : "ficaram de fora porque precisam"} de correção.`,
        );
        setError(failed.length > 0 ? "Alguns documentos prontos não foram enviados. Os que ficaram de fora por pendência não entram neste envio." : null);
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
    if (step > 1 || files.length > 0) {
      setConfirmLeave(true);
      return;
    }
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
      <div className={cn("mx-auto pb-10", step === 2 ? "max-w-6xl" : step === 3 ? "max-w-4xl" : "max-w-3xl")}>
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
            outcomes={outcomes}
            error={error}
            onMonth={setMonth}
            onYear={setYear}
            onCategory={setCategory}
            onCustomName={setCustomName}
            onFiles={(next) => {
              setFiles(next);
              setBatchId("");
              setOutcomes([]);
            }}
            onError={setError}
            onCancel={leave}
            onNext={() => void split()}
          />
        ) : step === 2 ? (
          <DocumentReview
            rows={rows}
            people={shownPeople}
            drafts={drafts}
            signers={signers}
            history={history}
            activeId={activeId}
            refused={refused}
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
                    fields: draft.fields.flatMap((field) => {
                      const next = fieldAfterDrop(field, pageNumber, nextCount);
                      return next ? [next] : [];
                    }),
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
            onContact={(sellerId, contact) => setContactEdits((current) => ({ ...current, [sellerId]: contact }))}
            onRemove={async (id) => {
              await deleteDocument(id);
              setDrafts((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setOpened((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setActiveId((current) => {
                if (current !== id) return current;
                const index = rows.findIndex((row) => row.id === id);
                return rows[index + 1]?.id ?? rows[index - 1]?.id ?? "";
              });
              await onReload();
            }}
            onBack={() => setStep(1)}
            onReview={() => {
              setError(null);
              setStep(3);
            }}
            period={`${monthFolder(Number(month))}/${year}`}
            analyzed={analyzed}
            opened={opened}
          />
        ) : (
          <SendReview
            rows={rows}
            people={shownPeople}
            drafts={drafts}
            signers={signers}
            opened={opened}
            error={error}
            sentNote={sentNote}
            sending={sending}
            onBack={() => {
              setError(null);
              setSentNote(null);
              setStep(2);
            }}
            onOpen={(id) => {
              setActiveId(id);
              setStep(2);
            }}
            onSend={() => {
              const pending = situations(rows, drafts, shownPeople, signers, opened).filter((item) => item.situation !== "Pronto" && item.situation !== "Já enviado").length;
              if (pending > 0) {
                setConfirmSend(true);
                return;
              }
              void send();
            }}
            onRemove={async (id) => {
              await deleteDocument(id);
              setDrafts((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setOpened((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setActiveId((current) => {
                if (current !== id) return current;
                const index = rows.findIndex((row) => row.id === id);
                return rows[index + 1]?.id ?? rows[index - 1]?.id ?? "";
              });
              await onReload();
            }}
            onApply={(ids, deadline, reminder) => {
              setDrafts((current) => {
                const resolved = resolveDrafts(
                  rows.map((row) => ({ id: row.id, pageCount: row.pageCount })),
                  current,
                );
                const next = { ...current };
                for (const id of ids) {
                  const index = rows.findIndex((row) => row.id === id);
                  if (index < 0) continue;
                  next[id] = { ...(current[id] ?? resolved[index]), deadline, reminder };
                }
                return next;
              });
            }}
          />
        )}
      </div>
      </div>
      <Modal
        open={confirmSend}
        onClose={() => setConfirmSend(false)}
        title="Enviar só o que está pronto"
        footer={
          <>
            <Button variant="outline" disabled={sending} onClick={() => setConfirmSend(false)}>
              Cancelar
            </Button>
            <Button disabled={sending} onClick={() => void send()}>
              {sending ? "Enviando…" : sendLabel(situations(rows, drafts, shownPeople, signers, opened).filter((item) => item.situation === "Pronto").length)}
            </Button>
          </>
        }
      >
        <ConfirmCopy rows={rows} drafts={drafts} people={shownPeople} signers={signers} opened={opened} />
      </Modal>
      <Modal
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title="Sair da preparação"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmLeave(false)}>
              Continuar
            </Button>
            <Button variant="danger" onClick={onClose}>
              Sair
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-t1">As marcações desta preparação serão perdidas. Contatos já salvos no cadastro permanecem.</p>
      </Modal>
    </div>
  );
}

export function AttachPage() {
  const navigate = useNavigate();
  const { storeId, people, documents, history, reload } = useDocuments();
  return (
    <AttachWizard
      storeId={storeId}
      people={people}
      documents={documents}
      history={history}
      onReload={reload}
      onClose={() => navigate(paths.documents)}
      onDone={(notice, sent) =>
        navigate(paths.documents, {
          state: { documentNotice: notice, documentSent: sent ?? (notice ? null : "Documentos enviados.") },
        })
      }
    />
  );
}


function sendLabel(count: number) {
  if (count <= 0) return "Enviar documentos";
  return count === 1 ? "Enviar 1 documento" : `Enviar ${count} documentos`;
}

function situations(
  rows: DocumentRow[],
  drafts: Record<string, DocumentDraft | undefined>,
  people: PersonRow[],
  signers: { id: string; name: string; email: string }[],
  opened: Record<string, true>,
) {
  const resolved = resolveDrafts(
    rows.map((row) => ({ id: row.id, pageCount: row.pageCount })),
    drafts,
  );
  return rows.map((row, index) => {
    const person = people.find((item) => item.id === row.sellerId) ?? null;
    const situation = preparationSituation(person, resolved[index], row.pageCount, signers, people, row.envelopeId, row.sizeBytes);
    return {
      row,
      person,
      draft: resolved[index],
      situation: situation === "Pronto" && !opened[row.id] && index > 0 ? "Conferir marcação" : situation,
    };
  });
}

function ConfirmCopy({
  rows,
  drafts,
  people,
  signers,
  opened,
}: {
  rows: DocumentRow[];
  drafts: Record<string, DocumentDraft | undefined>;
  people: PersonRow[];
  signers: { id: string; name: string; email: string }[];
  opened: Record<string, true>;
}) {
  const items = situations(rows, drafts, people, signers, opened);
  const ready = items.filter((item) => item.situation === "Pronto").length;
  const held = items.filter((item) => item.situation !== "Pronto" && item.situation !== "Já enviado").length;
  return (
    <p className="text-[13.5px] text-t1">
      {ready === 1 ? "1 documento será enviado para assinatura." : `${ready} documentos serão enviados para assinatura.`}{" "}
      {held === 1
        ? "Outro documento não será enviado porque precisa de correção."
        : `Outros ${held} não serão enviados porque precisam de correção.`}
    </p>
  );
}

function SendReview({
  rows,
  people,
  drafts,
  signers,
  opened,
  error,
  sentNote,
  sending,
  onBack,
  onOpen,
  onSend,
  onRemove,
  onApply,
}: {
  rows: DocumentRow[];
  people: PersonRow[];
  drafts: Record<string, DocumentDraft | undefined>;
  signers: { id: string; name: string; email: string }[];
  opened: Record<string, true>;
  error: string | null;
  sentNote: string | null;
  sending: boolean;
  onBack: () => void;
  onOpen: (id: string) => void;
  onSend: () => void;
  onRemove: (id: string) => Promise<void>;
  onApply: (ids: string[], deadline: string, reminder: DocumentDraft["reminder"]) => void;
}) {
  const items = situations(rows, drafts, people, signers, opened);
  const ready = items.filter((item) => item.situation === "Pronto").length;
  const attention = items.filter((item) => item.situation !== "Pronto" && item.situation !== "Já enviado").length;
  const sent = items.filter((item) => item.situation === "Já enviado").length;
  const [deadline, setDeadline] = useState("");
  const [reminder, setReminder] = useState<DocumentDraft["reminder"]>("EVERY_3_DAYS");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const openIds = items.filter((item) => item.situation !== "Já enviado").map((item) => item.row.id);
  return (
    <>
      <WizardCardHeader
        title="Revisar envio"
        subtitle="Confira quem recebe cada documento. O envio leva só os que estão prontos."
      />
      {items.length === 0 ? (
        <div>
          <p className="text-sm font-bold text-t0">Nenhum documento pronto para envio.</p>
          <p className="mt-1 text-sm text-t2">Corrija as pendências para continuar.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {(
            [
              ["Prontos para envio", items.filter((item) => item.situation === "Pronto")],
              ["Precisam de correção", items.filter((item) => item.situation !== "Pronto" && item.situation !== "Já enviado")],
              ["Já enviados", items.filter((item) => item.situation === "Já enviado")],
            ] as const
          )
            .filter(([, group]) => group.length > 0)
            .map(([title, group]) => (
              <section key={title}>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-t2">{title}</p>
                <div className="overflow-hidden rounded-xl border border-line">
                  {group.map((item) => (
                    <div key={item.row.id} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-bold text-t0">{displayTitle(item.row.fileName)}</span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-t2">{scheduleLine(item.draft)}</span>
                      </span>
                      <span className="truncate text-[13px] text-t1">{item.person?.name ?? "Sem colaborador"}</span>
                      <Button type="button" size="sm" variant="outline" onClick={() => onOpen(item.row.id)}>
                        {item.situation === "Pronto" || item.situation === "Já enviado" ? "Revisar" : "Corrigir"}
                      </Button>
                      {item.situation === "Já enviado" ? (
                        <span className="w-8" />
                      ) : (
                        <button
                          type="button"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-line text-bad transition-colors hover:bg-bad-soft"
                          aria-label="Excluir documento"
                          onClick={() => setRemoveId(item.row.id)}
                        >
                          <Icon d={icons.trash} size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <SummaryTile label="Prontos" value={String(ready)} />
        <SummaryTile label="Precisam de atenção" value={String(attention)} />
        <SummaryTile label="Já enviados" value={String(sent)} />
      </div>
      {openIds.length > 0 && (
        <div className="mt-4 rounded-xl border border-line p-3">
          <p className="text-[13px] font-bold text-t0">Lembrete e data limite</p>
          <p className="mt-1 text-[12.5px] text-t2">Vale para todos os documentos que ainda não foram enviados. Contatos e canais não mudam.</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="grid min-w-[160px] flex-1 gap-1 text-[12px] font-bold text-t2">
              Lembrete
              <select className={controlClass} value={reminder} onChange={(event) => setReminder(event.target.value as DocumentDraft["reminder"])}>
                <option value="EVERY_DAY">Todo dia</option>
                <option value="EVERY_3_DAYS">A cada 3 dias</option>
                <option value="EVERY_WEEK">Toda semana</option>
                <option value="NEVER">Nunca</option>
              </select>
            </label>
            <label className="grid min-w-[160px] flex-1 gap-1 text-[12px] font-bold text-t2">
              Data limite
              <input type="date" className={controlClass} value={deadline} onChange={(event) => setDeadline(event.target.value)} />
            </label>
            <Button type="button" variant="outline" onClick={() => onApply(openIds, deadline, reminder)}>
              Aplicar
            </Button>
          </div>
        </div>
      )}
      {sentNote && <Alert className="mt-4" variant="success" title={sentNote} />}
      {error && <Alert className="mt-4" variant="danger" title={error} />}
      <div className="mt-4">
        <WizardNav previousLabel="Voltar" nextLabel={sending ? "Enviando…" : sendLabel(ready)} hideNextIcon previousDisabled={sending} nextDisabled={sending || ready === 0} onPrevious={onBack} onNext={onSend} />
      </div>
      <Modal
        open={removeId != null}
        onClose={() => {
          if (!removing) setRemoveId(null);
        }}
        title="Excluir documento"
        footer={
          <>
            <Button variant="outline" disabled={removing} onClick={() => setRemoveId(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={removing || !removeId}
              onClick={() => {
                if (!removeId) return;
                const id = removeId;
                setRemoving(true);
                void onRemove(id).then(
                  () => {
                    setRemoveId(null);
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
    </>
  );
}

function scheduleLine(draft: DocumentDraft) {
  const people = new Map<string, { channel: "EMAIL" | "WHATSAPP"; authentication: ReturnType<typeof asAuthentication> }>();
  for (const field of draft.fields) {
    if (field.signerId.startsWith("guest:")) {
      const guest = (draft.guests ?? []).find((item) => item.id === field.signerId.slice("guest:".length));
      people.set(field.signerId, { channel: guestChannel(guest), authentication: guestAuthentication(guest) });
    } else if (field.signerId === "seller" || field.signerId === "") {
      people.set("seller", { channel: draft.channel, authentication: asAuthentication(draft.authentication) });
    }
  }
  if (people.size === 0) people.set("seller", { channel: draft.channel, authentication: asAuthentication(draft.authentication) });
  const labels = [...new Set([...people.values()].map((item) => (item.channel === "EMAIL" ? "E-mail" : "WhatsApp")))];
  const credits = [...people.values()].reduce((sum, item) => sum + signerCredits(item.channel, item.authentication), 0);
  const reminder =
    draft.reminder === "EVERY_DAY" ? "Todo dia" : draft.reminder === "EVERY_WEEK" ? "Toda semana" : draft.reminder === "NEVER" ? "Sem lembrete" : "A cada 3 dias";
  const deadline = draft.deadline ? draft.deadline.split("-").reverse().join("/") : "Sem prazo";
  const credit = credits > 0 ? `${credits} ${credits === 1 ? "crédito" : "créditos"} · ` : "";
  return `${labels.join(" e ")} · ${credit}${reminder} · ${deadline}`;
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-t2">{label}</p>
      <p className="mt-1 text-xl font-extrabold text-t0">{value}</p>
    </div>
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
      {status.files.length > 0 && (
        <div className="mt-5 w-full max-w-lg overflow-hidden rounded-xl border border-line text-left">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-line px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-t2">
            <span>Arquivo</span>
            <span>Situação</span>
          </div>
          {status.files.map((file) => (
            <div key={file.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
              <span className="truncate text-[13px] font-bold text-t0">{file.name}</span>
              <span className={cn("text-[12.5px] font-bold", file.situation === "Processado" ? "text-ok" : file.situation === "Recusado" || file.situation === "PDF escaneado" ? "text-bad" : "text-t1")}>
                {file.detail ?? file.situation}
              </span>
            </div>
          ))}
        </div>
      )}
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
  outcomes,
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
  outcomes: PrepareFile[];
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
      {outcomes.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border border-line">
          {outcomes.map((item) => (
            <div key={item.name} className="flex items-start justify-between gap-3 border-b border-line px-3 py-2 last:border-b-0">
              <span className="truncate text-[13px] font-bold text-t0">{item.name}</span>
              <span className={cn("text-right text-[12.5px]", item.situation === "Processado" ? "text-ok" : "text-bad")}>{item.detail ?? item.situation}</span>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-4">
        <WizardNav previousLabel="Cancelar" nextLabel="Continuar" hideNextIcon onPrevious={onCancel} onNext={onNext} nextDisabled={files.length === 0} />
      </div>
    </>
  );
}
