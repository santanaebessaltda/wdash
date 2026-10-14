import { useState } from "react";
import { Badge, Button, Card, DataTable, EmptyState, Modal, ProgressBar, type DataTableColumn } from "@/components/ui";
import {
  assignDocument,
  confirmBatch,
  prepareFiles,
  resendDocument,
  saveEmployeeContact,
  type BatchRow,
  type DocumentRow,
  type PersonRow,
} from "@/data/wedash/documentsRepo";
import { DOCUMENT_CATEGORIES, DOCUMENT_COPY, batchLabel, monthFolder, resendVisible, signedCount } from "@/data/wedash/documentSplit";
import { DocumentsFrame, STATUS_LABEL, badgeVariant } from "./frame";
import { useDocuments } from "./useDocuments";

export function BatchesPage() {
  const { storeId, batches, documents, people, reload } = useDocuments();
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <DocumentsFrame
      title="Lotes"
      subtitle="O PDF enviado cai na pasta do colaborador"
      actions={<Button onClick={() => setCreating(true)}>Novo lote</Button>}
    >
      {notice && <p className="mb-3 text-[13px] text-bad">{notice}</p>}
      <BatchList
        batches={batches}
        documents={documents}
        people={people}
        openBatch={openBatch}
        onOpen={setOpenBatch}
        onResend={async (id) => {
          try {
            await resendDocument(id);
            setNotice(null);
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "Não foi possível reenviar.");
          }
        }}
        onAssign={async (documentId, sellerId) => {
          await assignDocument(documentId, sellerId);
          await reload();
        }}
        onSaveContact={async (input) => {
          await saveEmployeeContact(input);
          await reload();
        }}
        onConfirm={async (input) => {
          await confirmBatch(input);
          await reload();
        }}
      />
      {creating && (
        <NewBatchModal
          people={people}
          storeId={storeId}
          onClose={() => setCreating(false)}
          onCreated={async (message) => {
            setCreating(false);
            setNotice(message);
            await reload();
          }}
        />
      )}
    </DocumentsFrame>
  );
}

function BatchList({
  batches,
  documents,
  people,
  openBatch,
  onOpen,
  onResend,
  onAssign,
  onSaveContact,
  onConfirm,
}: {
  batches: BatchRow[];
  documents: DocumentRow[];
  people: PersonRow[];
  openBatch: string | null;
  onOpen: (id: string | null) => void;
  onResend: (id: string) => Promise<void>;
  onAssign: (documentId: string, sellerId: string) => Promise<void>;
  onSaveContact: (input: { sellerId: string; cpf: string; email: string; whatsapp: string }) => Promise<void>;
  onConfirm: (input: { batchId: string; channel: "EMAIL" | "WHATSAPP"; deadline: string; reminder: string }) => Promise<void>;
}) {
  if (batches.length === 0) return <EmptyState title="Nenhum lote" description="Envie um PDF para começar." />;
  return (
    <div className="grid gap-3">
      {batches.map((batch) => {
        const rows = documents.filter((doc) => doc.batchId === batch.id);
        const statuses = rows.map((row) => (row.status === "UNASSIGNED" ? "PENDING" : row.status));
        const signed = signedCount(statuses);
        const total = rows.length;
        const columns: DataTableColumn<DocumentRow>[] = [
          { key: "person", header: "Colaborador", render: (row) => people.find((person) => person.id === row.sellerId)?.name ?? "Escolha o colaborador" },
          { key: "file", header: "Documento", render: (row) => row.fileName },
          { key: "status", header: "Status", render: (row) => <Badge variant={badgeVariant(row.status)}>{row.sellerId ? STATUS_LABEL[row.status] : "Escolha o colaborador"}</Badge> },
          {
            key: "act",
            header: "",
            render: (row) =>
              resendVisible(row.status) && row.envelopeId ? (
                <Button size="sm" variant="outline" onClick={() => void onResend(row.id)}>
                  Reenviar
                </Button>
              ) : !row.sellerId ? (
                <select className="rounded-lg border border-line bg-bg-inset px-2 py-1 text-xs" defaultValue="" onChange={(event) => event.target.value && void onAssign(row.id, event.target.value)}>
                  <option value="">Escolher</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              ) : (
                <ContactEditor
                  key={row.sellerId}
                  person={people.find((person) => person.id === row.sellerId) ?? null}
                  error={row.error}
                  locked={Boolean(row.envelopeId)}
                  onSave={(input) => onSaveContact({ sellerId: row.sellerId!, ...input })}
                />
              ),
          },
        ];
        return (
          <Card key={batch.id}>
            <button type="button" className="w-full text-left" onClick={() => onOpen(openBatch === batch.id ? null : batch.id)}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[14px] font-bold text-t0">
                  {batch.category} · {monthFolder(batch.month)}/{batch.year}
                </p>
                <Badge variant={batchLabel(statuses) === "Assinado" ? "success" : "neutral"}>{batchLabel(statuses)}</Badge>
              </div>
              <p className="mb-2 text-xs text-t2">
                {signed} de {total}
              </p>
              <ProgressBar value={total ? (signed / total) * 100 : 0} />
            </button>
            {openBatch === batch.id && (
              <div className="mt-4 grid gap-3">
                {rows.some((row) => !row.envelopeId) && (
                  <SendReady channel={batch.channel ?? "WHATSAPP"} deadline={batch.deadline ?? ""} onSend={(input) => onConfirm({ batchId: batch.id, ...input })} />
                )}
                <DataTable columns={columns} data={rows} rowKey={(row) => row.id} />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function ContactEditor({
  person,
  error,
  locked,
  onSave,
}: {
  person: PersonRow | null;
  error: string | null;
  locked: boolean;
  onSave: (input: { cpf: string; email: string; whatsapp: string }) => Promise<void>;
}) {
  const [cpf, setCpf] = useState(person?.cpf ?? "");
  const [email, setEmail] = useState(person?.email ?? "");
  const [whatsapp, setWhatsapp] = useState(person?.whatsapp ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  if (!person || locked) return <span className="text-xs text-t2">{error ?? ""}</span>;
  return (
    <form
      className="grid gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        setLocalError(null);
        void onSave({ cpf, email, whatsapp }).catch((reason) => setLocalError(reason instanceof Error ? reason.message : DOCUMENT_COPY.badCpf));
      }}
    >
      {(error || localError) && <span className="text-xs text-bad">{localError || error}</span>}
      <div className="flex flex-wrap gap-1">
        <input className="w-28 rounded-lg border border-line bg-bg-inset px-2 py-1 text-xs" value={cpf} placeholder="CPF" onChange={(event) => setCpf(event.target.value)} />
        <input className="w-36 rounded-lg border border-line bg-bg-inset px-2 py-1 text-xs" value={email} placeholder="E-mail" onChange={(event) => setEmail(event.target.value)} />
        <input className="w-28 rounded-lg border border-line bg-bg-inset px-2 py-1 text-xs" value={whatsapp} placeholder="WhatsApp" onChange={(event) => setWhatsapp(event.target.value)} />
        <Button size="sm" variant="outline" type="submit">
          Salvar
        </Button>
      </div>
    </form>
  );
}

function SendReady({
  channel,
  deadline,
  onSend,
}: {
  channel: "EMAIL" | "WHATSAPP";
  deadline: string;
  onSend: (input: { channel: "EMAIL" | "WHATSAPP"; deadline: string; reminder: string }) => Promise<void>;
}) {
  const [nextChannel, setChannel] = useState(channel);
  const [nextDeadline, setDeadline] = useState(deadline.slice(0, 10));
  const [reminder, setReminder] = useState("EVERY_3_DAYS");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!nextDeadline) {
          setError(DOCUMENT_COPY.deadline);
          return;
        }
        setError(null);
        void onSend({ channel: nextChannel, deadline: nextDeadline, reminder }).catch((reason) =>
          setError(reason instanceof Error ? reason.message : "Não foi possível enviar."),
        );
      }}
    >
      <label className="text-xs font-semibold text-t1">
        Canal
        <select className="mt-1 block rounded-lg border border-line bg-bg-inset px-2 py-1 text-sm" value={nextChannel} onChange={(event) => setChannel(event.target.value as "EMAIL" | "WHATSAPP")}>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="EMAIL">E-mail</option>
        </select>
      </label>
      <label className="text-xs font-semibold text-t1">
        Data limite
        <input type="date" className="mt-1 block rounded-lg border border-line bg-bg-inset px-2 py-1 text-sm" value={nextDeadline} onChange={(event) => setDeadline(event.target.value)} />
      </label>
      <label className="text-xs font-semibold text-t1">
        Lembrete
        <select className="mt-1 block rounded-lg border border-line bg-bg-inset px-2 py-1 text-sm" value={reminder} onChange={(event) => setReminder(event.target.value)}>
          <option value="EVERY_DAY">Todo dia</option>
          <option value="EVERY_3_DAYS">A cada 3 dias</option>
          <option value="EVERY_WEEK">Toda semana</option>
          <option value="NEVER">Nunca</option>
        </select>
      </label>
      <Button size="sm" type="submit">
        Enviar prontos
      </Button>
      {error && <span className="text-xs text-bad">{error}</span>}
    </form>
  );
}

function NewBatchModal({
  people,
  storeId,
  onClose,
  onCreated,
}: {
  people: PersonRow[];
  storeId: string | null;
  onClose: () => void;
  onCreated: (message: string | null) => Promise<void>;
}) {
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [category, setCategory] = useState<string>(DOCUMENT_CATEGORIES[0]);
  const [unify, setUnify] = useState(true);
  const [channel, setChannel] = useState<"WHATSAPP" | "EMAIL">("WHATSAPP");
  const [deadline, setDeadline] = useState("");
  const [reminder, setReminder] = useState("EVERY_3_DAYS");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!deadline) {
      setError(DOCUMENT_COPY.deadline);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const prepared = await prepareFiles({
        storeId,
        month: Number(month),
        year: Number(year),
        category,
        unify,
        files,
      });
      await confirmBatch({ batchId: prepared.batchId, channel, deadline, reminder });
      const refused = prepared.refused.map((item) => `${item.name}: ${item.message}`).join(" ");
      await onCreated(refused || null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar.");
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title="Novo lote"
      onClose={onClose}
      footer={
        <Button onClick={() => void submit()} disabled={busy || files.length === 0}>
          {busy ? "Enviando…" : "Continuar"}
        </Button>
      }
    >
      <div className="grid gap-3">
        <label className="text-xs font-semibold text-t1">
          Mês
          <select className="mt-1 w-full rounded-lg border border-line bg-bg-inset px-2 py-2 text-sm" value={month} onChange={(event) => setMonth(event.target.value)}>
            {Array.from({ length: 12 }, (_, index) => (
              <option key={index + 1} value={index + 1}>
                {monthFolder(index + 1)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-t1">
          Ano
          <input className="mt-1 w-full rounded-lg border border-line bg-bg-inset px-2 py-2 text-sm" value={year} onChange={(event) => setYear(event.target.value)} />
        </label>
        <label className="text-xs font-semibold text-t1">
          Categoria
          <select className="mt-1 w-full rounded-lg border border-line bg-bg-inset px-2 py-2 text-sm" value={category} onChange={(event) => setCategory(event.target.value)}>
            {DOCUMENT_CATEGORIES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={unify} onChange={(event) => setUnify(event.target.checked)} />
          Unificar páginas do mesmo CPF
        </label>
        <label className="text-xs font-semibold text-t1">
          Canal
          <select className="mt-1 w-full rounded-lg border border-line bg-bg-inset px-2 py-2 text-sm" value={channel} onChange={(event) => setChannel(event.target.value as "WHATSAPP" | "EMAIL")}>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">E-mail</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-t1">
          Data limite
          <input type="date" className="mt-1 w-full rounded-lg border border-line bg-bg-inset px-2 py-2 text-sm" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
        </label>
        <label className="text-xs font-semibold text-t1">
          Lembrete
          <select className="mt-1 w-full rounded-lg border border-line bg-bg-inset px-2 py-2 text-sm" value={reminder} onChange={(event) => setReminder(event.target.value)}>
            <option value="EVERY_DAY">Todo dia</option>
            <option value="EVERY_3_DAYS">A cada 3 dias</option>
            <option value="EVERY_WEEK">Toda semana</option>
            <option value="NEVER">Nunca</option>
          </select>
        </label>
        <input type="file" accept="application/pdf" multiple onChange={(event) => setFiles([...(event.target.files ?? [])])} />
        {error && <p className="text-sm text-bad">{error}</p>}
        <p className="text-xs text-t2">{people.length} colaboradores nesta visão.</p>
      </div>
    </Modal>
  );
}
