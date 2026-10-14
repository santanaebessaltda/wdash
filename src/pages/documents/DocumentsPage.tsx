import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, DataTable, EmptyState, StatCard, type DataTableColumn } from "@/components/ui";
import { paths } from "@/router/paths";
import { monthFolder } from "@/data/wedash/documentSplit";
import type { BatchRow, DocumentRow, PersonRow } from "@/data/wedash/documentsRepo";
import { openDocument } from "@/data/wedash/documentsRepo";
import { DocumentsFrame, FileGlyph, FolderGlyph, STATUS_LABEL, badgeVariant, formatBytes } from "./frame";
import { useDocuments } from "./useDocuments";

type Mode = "home" | "pending" | "month" | "browse";

type FolderEntry = { key: string; label: string; detail: string; fileId?: string };

export function DocumentsPage() {
  const { allStores, batches, documents, people, stores } = useDocuments();
  const [mode, setMode] = useState<Mode>("home");
  const [crumb, setCrumb] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const storeName = useMemo(() => new Map(stores.map((store) => [store.id, store.name])), [stores]);
  const personName = useMemo(() => new Map(people.map((person) => [person.id, person.name])), [people]);
  const batchOf = useMemo(() => new Map(batches.map((batch) => [batch.id, batch])), [batches]);

  const pending = documents.filter((doc) => doc.status === "PENDING" || doc.status === "UNASSIGNED");
  const signed = documents.filter((doc) => doc.status === "SIGNED");
  const now = new Date();
  const thisMonth = documents.filter((doc) => {
    const batch = batchOf.get(doc.batchId);
    return batch?.month === now.getMonth() + 1 && batch.year === now.getFullYear();
  });
  const missingContact = people.filter((person) => !person.email && !person.whatsapp).length;

  const listed =
    mode === "pending"
      ? pending
      : mode === "month"
        ? thisMonth
        : mode === "home"
          ? [...documents].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12)
          : [];

  const folders = mode === "browse" ? folderEntries({ allStores, crumb, documents, batches, people, stores }) : [];
  const needle = query.trim().toLowerCase();
  const visibleFiles = listed.filter((doc) => !needle || doc.fileName.toLowerCase().includes(needle) || (personName.get(doc.sellerId ?? "") ?? "").toLowerCase().includes(needle));
  const visibleFolders = folders.filter((entry) => !needle || entry.label.toLowerCase().includes(needle));

  function goHome() {
    setMode("home");
    setCrumb([]);
    setQuery("");
  }

  function goBack() {
    if (mode === "browse" && crumb.length > 0) {
      setCrumb(crumb.slice(0, -1));
      return;
    }
    goHome();
  }

  const title = sectionTitle(mode, allStores, crumb, storeName, personName);

  return (
    <DocumentsFrame title="Pastas" subtitle={allStores ? "Filial, colaborador, ano e mês" : "Colaborador, ano e mês"}>
      {notice && <p className="mb-3 text-[13px] text-bad">{notice}</p>}
      {mode === "home" && (
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Pendentes" value={pending.length} sub="Ainda não assinados" icon={<FileGlyph />} iconColor="var(--warn)" iconBg="var(--warn-soft)" />
            <StatCard label="Assinados" value={signed.length} sub="Guardados na pasta" icon={<FileGlyph />} iconColor="var(--ok)" iconBg="var(--ok-soft)" />
            <StatCard label="Sem contato" value={missingContact} sub="Sem WhatsApp e sem e-mail" icon={<FolderGlyph />} iconColor="var(--bad)" iconBg="var(--bad-soft)" />
          </div>
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-t2">Atalhos</p>
          <div className="mb-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
            <Shortcut label="Pendentes" count={`${pending.length} arquivos`} onClick={() => { setMode("pending"); setQuery(""); }} />
            <Shortcut label="Este mês" count={`${thisMonth.length} arquivos`} onClick={() => { setMode("month"); setQuery(""); }} />
            <Shortcut
              label={allStores ? "Filiais" : "Colaboradores"}
              count={allStores ? `${stores.length} filiais` : `${people.length} pessoas`}
              onClick={() => { setMode("browse"); setCrumb([]); setQuery(""); }}
            />
          </div>
        </>
      )}

      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {mode !== "home" && (
            <Button size="sm" variant="outline" onClick={goBack}>
              Voltar
            </Button>
          )}
          <h3 className="truncate text-[15px] font-bold text-t0">{title}</h3>
        </div>
        <div className="flex h-[34px] items-center gap-2 rounded-[10px] border border-line bg-bg-inset px-3">
          <FileGlyph size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar arquivos…"
            className="w-28 bg-transparent text-[12.5px] text-t0 outline-none placeholder:text-t2 sm:w-40"
          />
        </div>
      </div>

      {mode === "browse" ? (
        visibleFolders.length === 0 ? (
          <EmptyState title="Pasta vazia" description="Nenhum arquivo neste nível." />
        ) : (
          <FolderTable
            rows={visibleFolders}
            onOpenFolder={(key) => setCrumb([...crumb, key])}
            onOpenFile={(id) => void openFile(id, setNotice)}
          />
        )
      ) : visibleFiles.length === 0 ? (
        <EmptyState
          title="Nenhum arquivo"
          description="O envio fica em Lotes. O PDF pronto aparece na pasta do colaborador."
          action={<Link to={paths.documentBatches} className="text-[13px] font-bold text-acc">Ir para Lotes</Link>}
        />
      ) : (
        <FileTable rows={visibleFiles} people={people} batches={batchOf} onOpen={(id) => void openFile(id, setNotice)} />
      )}
      <p className="mt-3 text-[12.5px] text-t2">
        {mode === "browse" ? `${visibleFolders.length} itens` : `${visibleFiles.length} arquivos`}
      </p>
    </DocumentsFrame>
  );
}

function Shortcut({ label, count, onClick }: { label: string; count: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-2xl border border-line bg-bg-2 p-4 text-left hover:border-line-2 hover:bg-bg-3">
      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-acc-soft text-acc">
        <FolderGlyph />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-bold text-t0">{label}</span>
        <span className="mt-0.5 block text-[11.5px] text-t2">{count}</span>
      </span>
    </button>
  );
}

async function openFile(id: string, setNotice: (message: string | null) => void) {
  try {
    const url = await openDocument(id);
    setNotice(null);
    window.open(url, "_blank", "noopener");
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "O arquivo ainda não está disponível.");
  }
}

function sectionTitle(mode: Mode, allStores: boolean, crumb: string[], storeName: Map<string, string>, personName: Map<string, string>) {
  if (mode === "pending") return "Pendentes";
  if (mode === "month") return `Este mês · ${monthFolder(new Date().getMonth() + 1)}`;
  if (mode === "home") return "Arquivos recentes";
  if (crumb.length === 0) return allStores ? "Filiais" : "Colaboradores";
  const last = crumb[crumb.length - 1];
  return storeName.get(last) ?? personName.get(last) ?? last;
}

function folderEntries(input: {
  allStores: boolean;
  crumb: string[];
  documents: DocumentRow[];
  batches: BatchRow[];
  people: PersonRow[];
  stores: { id: string; name: string }[];
}): FolderEntry[] {
  const { allStores, crumb, documents, batches, people, stores } = input;
  const yearOf = (doc: DocumentRow) => String(batches.find((batch) => batch.id === doc.batchId)?.year ?? "");
  const monthOf = (doc: DocumentRow) => monthFolder(batches.find((batch) => batch.id === doc.batchId)?.month ?? 0);
  if (crumb.length === 0 && allStores) {
    return stores.map((store) => ({
      key: store.id,
      label: store.name,
      detail: `${people.filter((person) => person.storeId === store.id).length} colaboradores`,
    }));
  }
  const storeKey = allStores ? crumb[0] : null;
  const depth = allStores ? crumb.length - 1 : crumb.length;
  const peopleHere = people.filter((person) => !storeKey || person.storeId === storeKey);
  if (depth === 0) {
    return peopleHere.map((person) => ({
      key: person.id,
      label: person.name,
      detail: `${documents.filter((doc) => doc.sellerId === person.id).length} arquivos`,
    }));
  }
  const sellerId = allStores ? crumb[1] : crumb[0];
  const docs = documents.filter((doc) => doc.sellerId === sellerId);
  if (depth === 1) {
    return [...new Set(docs.map(yearOf))].filter(Boolean).map((year) => ({
      key: year,
      label: year,
      detail: `${docs.filter((doc) => yearOf(doc) === year).length} arquivos`,
    }));
  }
  const year = allStores ? crumb[2] : crumb[1];
  if (depth === 2) {
    return [...new Set(docs.filter((doc) => yearOf(doc) === year).map(monthOf))].filter(Boolean).map((month) => ({
      key: month,
      label: month,
      detail: "Pasta",
    }));
  }
  const month = allStores ? crumb[3] : crumb[2];
  return docs
    .filter((doc) => yearOf(doc) === year && monthOf(doc) === month)
    .map((doc) => ({ key: doc.id, label: doc.fileName, detail: STATUS_LABEL[doc.status], fileId: doc.id }));
}

function FolderTable({ rows, onOpenFolder, onOpenFile }: { rows: FolderEntry[]; onOpenFolder: (key: string) => void; onOpenFile: (id: string) => void }) {
  const columns: DataTableColumn<FolderEntry>[] = [
    {
      key: "name",
      header: "Nome",
      render: (row) => (
        <button type="button" className="flex min-w-0 items-center gap-2.5 text-left" onClick={() => (row.fileId ? onOpenFile(row.fileId) : onOpenFolder(row.key))}>
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-acc-soft text-acc">
            {row.fileId ? <FileGlyph /> : <FolderGlyph />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-bold text-t0">{row.label}</span>
            <span className="mt-px block text-[11px] text-t2">{row.fileId ? "PDF" : "Pasta"}</span>
          </span>
        </button>
      ),
    },
    { key: "detail", header: "Conteúdo", render: (row) => <span className="text-[12.5px] text-t1">{row.detail}</span> },
  ];
  return <DataTable columns={columns} data={rows} rowKey={(row) => row.key} />;
}

function FileTable({
  rows,
  people,
  batches,
  onOpen,
}: {
  rows: DocumentRow[];
  people: PersonRow[];
  batches: Map<string, BatchRow>;
  onOpen: (id: string) => void;
}) {
  const columns: DataTableColumn<DocumentRow>[] = [
    {
      key: "name",
      header: "Nome",
      render: (row) => (
        <button type="button" className="flex min-w-0 items-center gap-2.5 text-left" onClick={() => onOpen(row.id)}>
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-acc-soft text-acc">
            <FileGlyph />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-bold text-t0">{row.fileName}</span>
            <span className="mt-px block text-[11px] text-t2">{batches.get(row.batchId)?.category ?? "PDF"}</span>
          </span>
        </button>
      ),
    },
    {
      key: "owner",
      header: "Colaborador",
      hideBelow: "md",
      render: (row) => <span className="text-[12.5px] text-t1">{people.find((person) => person.id === row.sellerId)?.name ?? "Escolha o colaborador"}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge variant={badgeVariant(row.status)}>{row.sellerId ? STATUS_LABEL[row.status] : "Escolha o colaborador"}</Badge>,
    },
    { key: "size", header: "Tamanho", hideBelow: "sm", render: (row) => <span className="font-mono text-[12.5px] font-semibold text-t0">{formatBytes(row.sizeBytes)}</span> },
  ];
  return <DataTable columns={columns} data={rows} rowKey={(row) => row.id} />;
}
