import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge, Button, Card, DataTable, EmptyState, Segmented, type DataTableColumn } from "@/components/ui";
import { cn } from "@/lib/cn";
import { QuickStat } from "@/pages/dashboards/QuickStat";
import { paths } from "@/router/paths";
import { displayTitle, monthFolder, resendVisible, DOCUMENT_CATEGORIES } from "@/data/wedash/documentSplit";
import type { BatchRow, DocumentRow, PersonRow } from "@/data/wedash/documentsRepo";
import { openDocument, resendDocument } from "@/data/wedash/documentsRepo";
import { DocumentsFrame, FileGlyph, FolderGlyph, Glyph, STATUS_LABEL, SearchGlyph, badgeVariant } from "./frame";
import { useDocuments } from "./useDocuments";

type Mode = "home" | "pending" | "month" | "sent" | "signed" | "browse";
type PeopleFilter = "active" | "all" | "inactive";

type FolderEntry = { key: string; label: string; detail: string; fileId?: string };

export function DocumentsPage() {
  const { allStores, batches, documents, people, stores, reload } = useDocuments();
  const navigate = useNavigate();
  const flash = (useLocation().state ?? null) as { documentNotice?: string | null; documentSent?: string | null } | null;
  const [mode, setMode] = useState<Mode>("home");
  const [crumb, setCrumb] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [periodFilter, setPeriodFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>("active");
  const [notice, setNotice] = useState<string | null>(flash?.documentNotice ?? null);
  const [sent, setSent] = useState<string | null>(flash?.documentSent ?? null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const storeName = useMemo(() => new Map(stores.map((store) => [store.id, store.name])), [stores]);
  const personName = useMemo(() => new Map(people.map((person) => [person.id, person.name])), [people]);
  const batchOf = useMemo(() => new Map(batches.map((batch) => [batch.id, batch])), [batches]);

  const sentDocuments = documents.filter((doc) => doc.envelopeId);
  const pending = sentDocuments.filter((doc) => doc.status === "PENDING");
  const signed = sentDocuments.filter((doc) => doc.status === "SIGNED");
  const now = new Date();
  const thisMonth = sentDocuments.filter((doc) => {
    const batch = batchOf.get(doc.batchId);
    return batch?.month === now.getMonth() + 1 && batch.year === now.getFullYear();
  });
  const recent = [...sentDocuments].sort((a, b) => (b.sentAt ?? b.createdAt).localeCompare(a.sentAt ?? a.createdAt)).slice(0, 12);
  const periods = [...new Set(sentDocuments.map((doc) => {
    const batch = batchOf.get(doc.batchId);
    return batch ? `${batch.year}-${batch.month}` : "";
  }).filter(Boolean))].sort();

  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;

  function matchesText(doc: DocumentRow) {
    if (!needle) return true;
    const person = (personName.get(doc.sellerId ?? "") ?? "").toLowerCase();
    return displayTitle(doc.fileName).toLowerCase().includes(needle) || doc.fileName.toLowerCase().includes(needle) || person.includes(needle);
  }

  function matchesFilters(doc: DocumentRow) {
    const batch = batchOf.get(doc.batchId);
    if (typeFilter && batch?.category !== typeFilter) return false;
    if (statusFilter && doc.status !== statusFilter) return false;
    if (periodFilter && `${batch?.year}-${batch?.month}` !== periodFilter) return false;
    return true;
  }

  const pool =
    mode === "pending" ? pending : mode === "signed" ? signed : mode === "month" ? thisMonth : mode === "sent" ? sentDocuments : mode === "home" ? recent : [];
  const libraryDocs = sentDocuments.filter((doc) => (mode === "home" ? true : matchesFilters(doc)));
  const visibleFiles = searching ? libraryDocs.filter(matchesText) : pool.filter((doc) => mode === "home" || matchesFilters(doc));
  const narrowed = searching || periodFilter || typeFilter || statusFilter;

  const listedPeople = people.filter((person) => {
    const working = person.active && person.inErp;
    if (peopleFilter === "active") return working;
    if (peopleFilter === "inactive") return !working;
    return true;
  });
  const atPeople = mode === "browse" && (allStores ? crumb.length === 1 : crumb.length === 0);
  const folders = mode === "browse" ? folderEntries({ allStores, crumb, documents: libraryDocs, batches, people: listedPeople, stores }) : [];
  const visibleFolders = searching ? [] : folders;

  function goHome() {
    setMode("home");
    setCrumb([]);
    setQuery("");
    setPeriodFilter("");
    setTypeFilter("");
    setStatusFilter("");
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
    <DocumentsFrame
      title="Documentos"
      subtitle={allStores ? "Encontre documentos por filial, colaborador, ano e mês e acompanhe as assinaturas." : "Encontre documentos por colaborador, ano e mês e acompanhe as assinaturas."}
      actions={
        <Button onClick={() => navigate(paths.documentAttach)}>Anexar documento</Button>
      }
    >
      {sent && <p className="mb-3 text-[13px] text-ok">{sent}</p>}
      {notice && <p className="mb-3 text-[13px] text-bad">{notice}</p>}
      {mode === "home" && (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <button type="button" className="text-left" onClick={() => { setMode("sent"); setQuery(""); }}>
            <QuickStat label="Documentos enviados" value={String(sentDocuments.length)} sub="Já foram para assinatura" tint="acc" icon={<Glyph d="M22 2 11 13M22 2 15 22 11 13 2 9 22 2" />} />
          </button>
          <button type="button" className="text-left" onClick={() => { setMode("pending"); setQuery(""); }}>
            <QuickStat label="Documentos pendentes" value={String(pending.length)} sub="Aguardando assinatura" tint="warn" icon={<Glyph d="M12 8v4l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20" />} />
          </button>
          <button type="button" className="text-left" onClick={() => { setMode("signed"); setQuery(""); }}>
            <QuickStat label="Documentos assinados" value={String(signed.length)} sub="Assinatura concluída" tint="ok" icon={<Glyph d="M20 6 9 17l-5-5" />} />
          </button>
        </div>
      )}
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-t2">Atalhos</p>
      <div className="mb-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        <Shortcut label="Pendentes" active={mode === "pending"} count={qty(pending.length, "documento", "documentos")} onClick={() => { setMode("pending"); setQuery(""); }} />
        <Shortcut label="Este mês" active={mode === "month"} count={qty(thisMonth.length, "documento", "documentos")} onClick={() => { setMode("month"); setQuery(""); }} />
        <Shortcut
          label={allStores ? "Filiais" : "Colaboradores"}
          active={mode === "browse"}
          count={allStores ? qty(stores.length, "filial", "filiais") : qty(listedPeople.length, "pessoa", "pessoas")}
          onClick={() => { setMode("browse"); setCrumb([]); setQuery(""); }}
        />
      </div>

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
          <SearchGlyph />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar documentos"
            className="w-28 bg-transparent text-[12.5px] text-t0 outline-none placeholder:text-t2 sm:w-40"
          />
        </div>
      </div>

      {mode === "browse" && crumb.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1 text-[12.5px] text-t2">
          <button type="button" className="font-bold text-t1 hover:text-t0" onClick={goHome}>
            Documentos
          </button>
          {crumb.map((key, index) => (
            <span key={`${key}-${index}`} className="flex items-center gap-1">
              <span>/</span>
              {index < crumb.length - 1 ? (
                <button type="button" className="font-bold text-t1 hover:text-t0" onClick={() => setCrumb(crumb.slice(0, index + 1))}>
                  {crumbLabel(key, storeName, personName)}
                </button>
              ) : (
                <span className="font-bold text-t0">{crumbLabel(key, storeName, personName)}</span>
              )}
            </span>
          ))}
        </div>
      )}

      {mode !== "home" && (
        <div className="mb-4 flex flex-wrap gap-2">
          <select className="h-10 rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3 text-[13px] text-t0" value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
            <option value="">Período</option>
            {periods.map((key) => {
              const [year, month] = key.split("-");
              return (
                <option key={key} value={key}>
                  {monthFolder(Number(month))}/{year}
                </option>
              );
            })}
          </select>
          <select className="h-10 rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3 text-[13px] text-t0" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="">Tipo</option>
            {DOCUMENT_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select className="h-10 rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3 text-[13px] text-t0" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">Situação</option>
            <option value="PENDING">Pendente</option>
            <option value="SIGNED">Assinado</option>
            <option value="DECLINED">Recusado</option>
            <option value="EXPIRED">Expirado</option>
          </select>
        </div>
      )}
      {atPeople && (
        <div className="mb-4">
          <Segmented
            options={[
              { value: "active", label: "Ativos" },
              { value: "all", label: "Todos" },
              { value: "inactive", label: "Desativados" },
            ]}
            value={peopleFilter}
            onChange={(value) => value && setPeopleFilter(value)}
          />
        </div>
      )}

      {mode === "browse" && !searching ? (
        visibleFolders.length === 0 ? (
          <Card padding="none">
            <EmptyState framed={false} title="Esta pasta ainda não tem documentos." action={<Button onClick={() => navigate(paths.documentAttach)}>Anexar documento</Button>} />
          </Card>
        ) : (
          <FolderTable
            rows={visibleFolders}
            onOpenFolder={(key) => setCrumb([...crumb, key])}
            onOpenFile={(id) => void openFile(id, setNotice)}
          />
        )
      ) : visibleFiles.length === 0 ? (
        <Card padding="none">
          <EmptyState
            framed={false}
            title={narrowed ? "Nenhum documento encontrado." : "Nenhum documento"}
            description={narrowed ? "Tente outro termo ou ajuste os filtros." : "Anexe um PDF para começar."}
            action={narrowed ? undefined : <Button onClick={() => navigate(paths.documentAttach)}>Anexar documento</Button>}
          />
        </Card>
      ) : (
        <FileTable
          rows={visibleFiles}
          people={people}
          batches={batchOf}
          stores={storeName}
          showStore={allStores}
          onDownload={(id) => void openFile(id, setNotice)}
          onResend={(id) => void resendFile(id, setNotice, setSent, setResendingId, reload)}
          resendingId={resendingId}
        />
      )}
      <p className="mt-3 text-[12.5px] text-t2">
        {mode === "browse" && !searching ? qty(visibleFolders.length, "item", "itens") : qty(visibleFiles.length, "documento", "documentos")}
      </p>
    </DocumentsFrame>
  );
}

function qty(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function Shortcut({ label, count, active, onClick }: { label: string; count: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex items-center gap-3 rounded-2xl border bg-bg-2 p-4 text-left hover:border-line-2 hover:bg-bg-3", active ? "border-acc" : "border-line")}>
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

async function resendFile(
  id: string,
  setNotice: (message: string | null) => void,
  setSent: (message: string | null) => void,
  setResendingId: (id: string | null) => void,
  reload: () => Promise<void>,
) {
  setResendingId(id);
  setNotice(null);
  setSent(null);
  try {
    await resendDocument(id);
    setSent("Link reenviado.");
    await reload();
  } catch {
    setNotice("Não foi possível reenviar o documento. Tente novamente.");
  } finally {
    setResendingId(null);
  }
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
  if (mode === "signed") return "Assinados";
  if (mode === "sent") return "Enviados";
  if (mode === "month") return `Este mês · ${monthFolder(new Date().getMonth() + 1)}`;
  if (mode === "home") return "Documentos recentes";
  if (crumb.length === 0) return allStores ? "Filiais" : "Colaboradores";
  const last = crumb[crumb.length - 1];
  return crumbLabel(last, storeName, personName);
}

function crumbLabel(key: string, storeName: Map<string, string>, personName: Map<string, string>) {
  return storeName.get(key) ?? personName.get(key) ?? key;
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
      detail: qty(people.filter((person) => person.storeId === store.id).length, "colaborador", "colaboradores"),
    }));
  }
  const storeKey = allStores ? crumb[0] : null;
  const depth = allStores ? crumb.length - 1 : crumb.length;
  const peopleHere = people.filter((person) => !storeKey || person.storeId === storeKey);
  if (depth === 0) {
    return peopleHere.map((person) => ({
      key: person.id,
      label: person.name,
      detail: qty(documents.filter((doc) => doc.sellerId === person.id).length, "documento", "documentos"),
    }));
  }
  const sellerId = allStores ? crumb[1] : crumb[0];
  const docs = documents.filter((doc) => doc.sellerId === sellerId);
  if (depth === 1) {
    return [...new Set(docs.map(yearOf))].filter(Boolean).map((year) => ({
      key: year,
      label: year,
      detail: qty(docs.filter((doc) => yearOf(doc) === year).length, "documento", "documentos"),
    }));
  }
  const year = allStores ? crumb[2] : crumb[1];
  if (depth === 2) {
    return [...new Set(docs.filter((doc) => yearOf(doc) === year).map(monthOf))].filter(Boolean).map((month) => ({
      key: month,
      label: month,
      detail: qty(docs.filter((doc) => yearOf(doc) === year && monthOf(doc) === month).length, "documento", "documentos"),
    }));
  }
  const month = allStores ? crumb[3] : crumb[2];
  return docs
    .filter((doc) => yearOf(doc) === year && monthOf(doc) === month)
    .map((doc) => ({ key: doc.id, label: displayTitle(doc.fileName), detail: STATUS_LABEL[doc.status], fileId: doc.id }));
}

function FolderTable({ rows, onOpenFolder, onOpenFile }: { rows: FolderEntry[]; onOpenFolder: (key: string) => void; onOpenFile: (id: string) => void }) {
  const columns: DataTableColumn<FolderEntry>[] = [
    {
      key: "name",
      header: "Nome",
      render: (row) => (
        <button type="button" className="flex min-w-0 items-center gap-2.5 text-left" onClick={() => !row.fileId && onOpenFolder(row.key)}>
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
    {
      key: "download",
      header: "",
      render: (row) =>
        row.fileId ? (
          <Button size="sm" variant="outline" onClick={() => onOpenFile(row.fileId!)}>
            Baixar PDF
          </Button>
        ) : null,
    },
  ];
  return <DataTable columns={columns} data={rows} rowKey={(row) => row.key} />;
}

function FileTable({
  rows,
  people,
  batches,
  stores,
  showStore,
  onDownload,
  onResend,
  resendingId,
}: {
  rows: DocumentRow[];
  people: PersonRow[];
  batches: Map<string, BatchRow>;
  stores: Map<string, string>;
  showStore: boolean;
  onDownload: (id: string) => void;
  onResend: (id: string) => void;
  resendingId: string | null;
}) {
  const columns: DataTableColumn<DocumentRow>[] = [
    {
      key: "name",
      header: "Documento",
      render: (row) => {
        const batch = batches.get(row.batchId);
        const period = batch ? `${monthFolder(batch.month)}/${batch.year}` : "PDF";
        return (
          <span className="flex min-w-0 items-center gap-2.5 text-left">
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-acc-soft text-acc">
              <FileGlyph />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold text-t0">{displayTitle(row.fileName)}</span>
              <span className="mt-px block text-[11px] text-t2">{period}</span>
            </span>
          </span>
        );
      },
    },
    {
      key: "owner",
      header: "Colaborador",
      hideBelow: "md",
      render: (row) => <span className="text-[12.5px] text-t1">{people.find((person) => person.id === row.sellerId)?.name ?? "Sem colaborador"}</span>,
    },
    ...(showStore
      ? [
          {
            key: "store",
            header: "Filial",
            hideBelow: "lg" as const,
            render: (row: DocumentRow) => <span className="text-[12.5px] text-t1">{stores.get(row.storeId ?? "") ?? "—"}</span>,
          },
        ]
      : []),
    {
      key: "status",
      header: "Status",
      render: (row) =>
        row.envelopeId ? (
          <Badge variant={badgeVariant(row.status)}>{STATUS_LABEL[row.status]}</Badge>
        ) : (
          <span className="text-[12.5px] text-t2">Em preparação</span>
        ),
    },
    {
      key: "sent",
      header: "Enviado em",
      hideBelow: "sm",
      render: (row) => <span className="text-[12.5px] text-t1">{formatDay(row.sentAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => onDownload(row.id)}>
            Baixar PDF
          </Button>
          {resendVisible(row.status) && row.envelopeId ? (
            <Button size="sm" variant="outline" disabled={resendingId === row.id} onClick={() => onResend(row.id)}>
              {resendingId === row.id ? "Reenviando…" : "Reenviar link"}
            </Button>
          ) : null}
        </span>
      ),
    },
  ];
  return <DataTable columns={columns} data={rows} rowKey={(row) => row.id} />;
}

function formatDay(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}
