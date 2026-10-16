import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge, Button, DataTable, Dropdown, EmptyState, FormField, Modal, Card, CardTitle, useToast, type DataTableColumn, type DropdownItem } from "@/components/ui";
import { cn } from "@/lib/cn";
import { HeaderFilter, HeaderSearch } from "@/pages/dashboard/HeaderFilter";
import { Icon, icons } from "@/pages/users/Icons";
import { paths } from "@/router/paths";
import { archivePeople, categoryLabel, displayTitle, documentPersonKey, findDocumentPerson, folderPeople, inLibrary, isFiledStatus, monthFolder, partialEnvelopeLabel, personMatchesQuery, resendVisible, signatureProgressDetail, signerFraction, signingPeople, visibleSigners, type SignerProgress } from "@/data/wedash/documentSplit";
import type { BatchRow, DocumentRow, PersonRow } from "@/data/wedash/documentsRepo";
import { cancelDocument, copyDocumentLink, moveDocument, openDocument, resendDocument } from "@/data/wedash/documentsRepo";
import { DocumentsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { DocumentsFrame, FileGlyph, FolderGlyph, STATUS_LABEL, badgeVariant } from "./frame";
import { useDocuments } from "./useDocuments";

type PeopleFilter = "active" | "all" | "inactive";
type LibraryView = "folders" | "documents";

const STATUS_ORDER = ["Pendente", "Em andamento", "Recusado", "Expirado", "Assinado", "Já assinado", "Arquivado"];

type FolderEntry = { key: string; label: string; detail: string; caption?: string; fileId?: string; count?: number; inactive?: boolean };

const fieldClass = "h-10 w-full rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3 text-[13px] text-t0";

export function DocumentsPage() {
  const { allStores, batches, documents, people, stores, loading, reload } = useDocuments();
  const showSkeleton = useMinSkeleton(loading);
  const navigate = useNavigate();
  const { show } = useToast();
  const flash = (useLocation().state ?? null) as { documentNotice?: string | null } | null;
  const flashed = useRef(false);
  const [crumb, setCrumb] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>("all");
  const [view, setView] = useState<LibraryView>("folders");
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [moveSeller, setMoveSeller] = useState("");
  const [moveMonth, setMoveMonth] = useState("1");
  const [moveYear, setMoveYear] = useState(String(new Date().getFullYear()));
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [signaturesId, setSignaturesId] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    if (flashed.current || !flash?.documentNotice) return;
    flashed.current = true;
    show(flash.documentNotice, "danger");
  }, [flash, show]);

  const storeName = useMemo(() => new Map(stores.map((store) => [store.id, store.name])), [stores]);
  const personName = useMemo(() => new Map(people.map((person) => [person.id, person.name])), [people]);
  const batchOf = useMemo(() => new Map(batches.map((batch) => [batch.id, batch])), [batches]);

  const libraryDocuments = documents.filter((doc) => inLibrary(doc));
  const needle = query.trim().toLowerCase();
  const atBranches = allStores && crumb.length === 0;
  const atPeople = allStores ? crumb.length === 1 : crumb.length === 0;
  const atFiles = allStores ? crumb.length >= 4 : crumb.length >= 3;
  const listedPeople = folderPeople(people, peopleFilter);
  const allowedPeople = new Set(listedPeople.map((person) => person.id));
  const scopedDocuments = libraryDocuments.filter((doc) => {
    const key = documentPersonKey(doc);
    if (!key) return peopleFilter === "all";
    return allowedPeople.has(key);
  });

  function matchesQuery(doc: DocumentRow, includePerson: boolean) {
    if (!needle) return true;
    const batch = batchOf.get(doc.batchId);
    const title = displayTitle(doc.fileName).toLowerCase();
    const category = categoryLabel(batch?.category ?? "").toLowerCase();
    const year = String(batch?.year ?? "");
    const month = monthFolder(batch?.month ?? 0).toLowerCase();
    const person = findDocumentPerson(people, doc);
    const text = title.includes(needle) || doc.fileName.toLowerCase().includes(needle) || category.includes(needle) || year.includes(needle) || month.includes(needle) || statusLabel(doc).toLowerCase().includes(needle);
    return text || (includePerson && person != null && personMatchesQuery(person, query));
  }

  function statusLabel(doc: DocumentRow) {
    return partialEnvelopeLabel(doc.status, signersOf(doc, people)) ?? STATUS_LABEL[doc.status];
  }

  const textDocs = needle ? scopedDocuments.filter((doc) => matchesQuery(doc, atPeople || atBranches)) : scopedDocuments;
  const documentRows = scopedDocuments.filter((doc) => matchesQuery(doc, true));
  const folders = folderEntries({ allStores, crumb, documents: needle ? textDocs : scopedDocuments, batches, people: listedPeople, stores });
  const visibleFolders = folders.filter((folder) => folderVisible(folder));

  function folderVisible(folder: FolderEntry) {
    if (atPeople || atBranches) {
      const matched = textDocs.filter((doc) => (atBranches ? doc.storeId === folder.key : documentPersonKey(doc) === folder.key)).length;
      if (needle && matched > 0) return true;
      if (!needle) return true;
      if (atPeople) {
        const person = listedPeople.find((item) => item.id === folder.key);
        return person != null && personMatchesQuery(person, query);
      }
      return folder.label.toLowerCase().includes(needle);
    }
    if (!needle) return true;
    if (folder.label.toLowerCase().includes(needle)) return true;
    return textDocs.some((doc) => docInFolder(doc, folder.key));
  }

  function docInFolder(doc: DocumentRow, key: string) {
    const batch = batchOf.get(doc.batchId);
    const sellerId = allStores ? crumb[1] : crumb[0];
    if (documentPersonKey(doc) !== sellerId) return false;
    const depth = allStores ? crumb.length - 1 : crumb.length;
    if (depth === 1) return String(batch?.year ?? "") === key;
    const year = allStores ? crumb[2] : crumb[1];
    return String(batch?.year ?? "") === year && monthFolder(batch?.month ?? 0) === key;
  }

  const visibleFiles = atFiles
    ? textDocs.filter((doc) => documentPersonKey(doc) === (allStores ? crumb[1] : crumb[0]) && String(batchOf.get(doc.batchId)?.year ?? "") === (allStores ? crumb[2] : crumb[1]) && monthFolder(batchOf.get(doc.batchId)?.month ?? 0) === (allStores ? crumb[3] : crumb[2]))
    : [];
  const peopleHere = listedPeople.filter((person) => !allStores || crumb[0] == null || person.storeId === crumb[0]);
  const showingDocuments = view === "documents" || atFiles;

  function goRoot() {
    setCrumb([]);
    setQuery("");
  }

  function goUp() {
    setCrumb((current) => current.slice(0, -1));
    setQuery("");
  }

  function openFolder(key: string) {
    setCrumb([...crumb, key]);
    setQuery("");
  }

  const trail = crumb.length === 0 ? [] : [
    { label: "Documentos", onClick: goRoot as (() => void) | null },
    ...(allStores ? [{ label: "Filiais", onClick: goRoot as (() => void) | null }] : []),
    ...crumb.map((key, index) => ({
      label: crumbLabel(key, storeName, personName),
      onClick: index === crumb.length - 1 ? null : () => {
        setCrumb(crumb.slice(0, index + 1));
        setQuery("");
      },
    })),
  ];

  function openMove(id: string) {
    const doc = documents.find((item) => item.id === id);
    const batch = doc ? batchOf.get(doc.batchId) : undefined;
    setMoveSeller(doc ? documentPersonKey(doc) ?? "" : "");
    setMoveMonth(String(batch?.month ?? new Date().getMonth() + 1));
    setMoveYear(String(batch?.year ?? new Date().getFullYear()));
    setMoveId(id);
  }

  async function copyLink(id: string, recipientId?: string) {
    setActing(true);
    try {
      const url = await copyDocumentLink(id, recipientId);
      await navigator.clipboard.writeText(url);
      show("Link copiado.", "success");
    } catch (error) {
      show(error instanceof Error ? error.message : "Não foi possível copiar o link. Tente novamente.", "danger");
    } finally {
      setActing(false);
    }
  }

  async function apagar(id: string) {
    setActing(true);
    try {
      await cancelDocument(id);
      setDeleteId(null);
      show("Documento excluído.", "success");
      await reload();
    } catch (error) {
      show(error instanceof Error ? error.message : "Não foi possível excluir o documento. Tente novamente.", "danger");
    } finally {
      setActing(false);
    }
  }

  async function mover() {
    if (!moveId || !moveSeller) return;
    const year = Number(moveYear);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      show("Informe um ano válido.", "danger");
      return;
    }
    setActing(true);
    try {
      await moveDocument({ documentId: moveId, personId: moveSeller, month: Number(moveMonth), year });
      setMoveId(null);
      show("Documento movido.", "success");
      await reload();
    } catch (error) {
      show(error instanceof Error ? error.message : "Não foi possível mover o documento. Tente novamente.", "danger");
    } finally {
      setActing(false);
    }
  }

  return (
    <DocumentsFrame
      title="Documentos"
      subtitle="Organize documentos da equipe e acompanhe as assinaturas."
      actions={
        <>
          <HeaderSearch value={query} onChange={setQuery} placeholder="Buscar documentos ou pessoas" width={260} />
          <HeaderFilter
            label="Status"
            value={peopleFilter}
            onChange={setPeopleFilter}
            options={[
              { value: "all", label: "Todos os status" },
              { value: "active", label: "Ativos" },
              { value: "inactive", label: "Desligados" },
            ]}
          />
          <div className="flex gap-1 rounded-[11px] border border-line bg-bg-2 p-1" role="group" aria-label="Visualização">
            {(
              [
                ["folders", "Pastas"],
                ["documents", "Documentos"],
              ] as [LibraryView, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => setView(value)}
                className={cn("rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition-colors", view === value ? "bg-acc text-white" : "text-t1 hover:text-t0")}
              >
                {label}
              </button>
            ))}
          </div>
          <Button onClick={() => navigate(paths.documentAttach)}>Anexar documento</Button>
        </>
      }
    >
      {showSkeleton ? (
        <DocumentsSkeleton />
      ) : (
      <>
      {view === "folders" && crumb.length > 0 && (
        <button type="button" onClick={goUp} className="mb-2 inline-flex items-center gap-1 text-[13px] font-bold text-t1 sm:hidden">
          <Icon d={icons.arrowLeft} size={14} />
          Voltar
        </button>
      )}
      {view === "folders" && trail.length > 0 && (
        <nav className="mb-4 flex flex-wrap items-center gap-1 text-[12.5px] text-t2" aria-label="Caminho">
          {trail.map((item, index) => (
            <span key={`${item.label}-${index}`} className="flex items-center gap-1">
              {index > 0 && <span>/</span>}
              {item.onClick ? (
                <button type="button" className="font-bold text-t1 hover:text-t0" onClick={item.onClick}>{item.label}</button>
              ) : (
                <span className="font-bold text-t0">{item.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <Card className="flex w-full flex-col">
        <CardTitle className="mb-4">{showingDocuments ? "Documentos" : "Pastas"}</CardTitle>
        {view === "documents" ? (
          documentRows.length === 0 ? (
            <EmptyState framed={false} title={needle ? "Nenhum documento encontrado." : "Nenhum documento neste filtro."} description={needle ? "Tente outro termo." : peopleFilter === "inactive" ? "Não há documentos de pessoas desligadas." : undefined} />
          ) : (
            <DocumentTable rows={documentRows} people={people} showPerson showStore={allStores} storeName={storeName} busy={acting || resendingId != null} onDownload={(id) => void openFile(id, show)} onOpenSignatures={setSignaturesId} onMove={openMove} onDelete={setDeleteId} />
          )
        ) : atFiles ? (
          visibleFiles.length === 0 ? (
            <EmptyState framed={false} title={needle ? "Nenhum documento encontrado." : "Esta pasta ainda não tem documentos."} description={needle ? "Tente outro termo." : undefined} action={needle ? undefined : <Button onClick={() => navigate(paths.documentAttach)}>Anexar documento</Button>} />
          ) : (
            <DocumentTable rows={visibleFiles} people={people} showPerson={false} showStore={false} storeName={storeName} busy={acting || resendingId != null} onDownload={(id) => void openFile(id, show)} onOpenSignatures={setSignaturesId} onMove={openMove} onDelete={setDeleteId} />
          )
        ) : visibleFolders.length === 0 ? (
          atPeople ? (
            <EmptyState framed={false} title={needle ? "Nenhuma pessoa encontrada" : peopleFilter === "inactive" ? "Nenhuma pessoa desligada" : "Nenhuma pessoa disponível"} description={needle ? "Tente outro nome, CPF ou e-mail." : peopleHere.length === 0 ? "Não há pessoas vinculadas a esta filial." : "Não há pessoas neste filtro."} />
          ) : atBranches && needle ? (
            <EmptyState framed={false} title="Nenhuma filial encontrada" description="Tente outro nome." />
          ) : (
            <EmptyState framed={false} title={needle ? "Nenhum documento encontrado." : "Esta pasta ainda não tem documentos."} description={needle ? "Tente outro termo." : undefined} action={needle ? undefined : <Button onClick={() => navigate(paths.documentAttach)}>Anexar documento</Button>} />
          )
        ) : (
          <FolderList rows={visibleFolders} onOpen={openFolder} />
        )}
      </Card>
      </>
      )}
      <SignaturesModal
        doc={documents.find((item) => item.id === signaturesId) ?? null}
        people={people}
        batches={batchOf}
        busy={acting || resendingId != null}
        resending={resendingId != null}
        onClose={() => setSignaturesId(null)}
        onCopy={(id, recipientId) => void copyLink(id, recipientId)}
        onResend={(id, recipientId) => void resendFile(id, recipientId, show, setResendingId, reload)}
      />
      <Modal
        open={deleteId != null}
        onClose={() => {
          if (!acting) setDeleteId(null);
        }}
        title="Excluir documento?"
        footer={
          <>
            <Button variant="outline" disabled={acting} onClick={() => setDeleteId(null)}>Cancelar</Button>
            <Button variant="danger" disabled={acting || !deleteId} onClick={() => deleteId && void apagar(deleteId)}>
              {acting ? "Excluindo…" : "Excluir documento"}
            </Button>
          </>
        }
      >
        <div className="grid gap-2">
          <p className="text-[13.5px] text-t1">Este documento será removido da WDash e, se houver uma assinatura em andamento, ela será cancelada.</p>
          {documents.some((item) => item.id === deleteId && signersOf(item, people).length > 1) ? (
            <p className="text-[13.5px] text-t1">A assinatura de todos os signatários deste documento será cancelada.</p>
          ) : null}
        </div>
      </Modal>
      <Modal
        open={moveId != null}
        onClose={() => {
          if (!acting) setMoveId(null);
        }}
        title="Mover documento"
        footer={
          <>
            <Button variant="outline" disabled={acting} onClick={() => setMoveId(null)}>Cancelar</Button>
            <Button disabled={acting || !moveSeller} onClick={() => void mover()}>{acting ? "Movendo…" : "Mover"}</Button>
          </>
        }
      >
        <div className="grid gap-3">
          <p className="text-[13.5px] text-t1">Altere a pessoa, o mês ou o ano deste documento. A assinatura em andamento não será alterada.</p>
          <FormField label="Pessoa">
            <select className={fieldClass} value={moveSeller} onChange={(event) => setMoveSeller(event.target.value)}>
              <option value="">Selecione</option>
              <PersonChoices
                people={moveId && isFiledStatus(documents.find((item) => item.id === moveId)?.status ?? "PENDING") ? archivePeople(people, null) : signingPeople(people, null)}
                allStores={allStores}
                storeName={storeName}
              />
            </select>
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Mês">
              <select className={fieldClass} value={moveMonth} onChange={(event) => setMoveMonth(event.target.value)}>
                {Array.from({ length: 12 }, (_, index) => (
                  <option key={index + 1} value={index + 1}>{monthFolder(index + 1)}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Ano">
              <input className={fieldClass} value={moveYear} onChange={(event) => setMoveYear(event.target.value)} />
            </FormField>
          </div>
        </div>
      </Modal>
    </DocumentsFrame>
  );
}

function qty(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function PersonChoices({
  people,
  allStores,
  storeName,
}: {
  people: PersonRow[];
  allStores: boolean;
  storeName: Map<string, string>;
}) {
  return (
    <>
      {people.map((person) => (
        <option key={person.id} value={person.id}>
          {allStores && (person.roleLabel === "Vendedor" || person.roleLabel === "Usuário da filial") ? `${person.name} · ${person.roleLabel} · ${storeName.get(person.storeId) ?? ""}` : `${person.name} · ${person.roleLabel}`}
        </option>
      ))}
    </>
  );
}

async function resendFile(
  id: string,
  recipientId: string | undefined,
  show: (message: string, variant: "success" | "danger") => void,
  setResendingId: (id: string | null) => void,
  reload: () => Promise<void>,
) {
  setResendingId(id);
  try {
    await resendDocument(id, recipientId);
    show("Link reenviado.", "success");
    await reload();
  } catch {
    show("Não foi possível reenviar o link. Tente novamente.", "danger");
  } finally {
    setResendingId(null);
  }
}

async function openFile(id: string, show: (message: string, variant: "success" | "danger") => void) {
  try {
    const url = await openDocument(id);
    const opened = window.open(url, "_blank");
    if (opened) opened.opener = null;
    if (!opened) {
      show("Não foi possível baixar o PDF. Tente novamente.", "danger");
      return;
    }
    show("Download iniciado.", "success");
  } catch (error) {
    show(error instanceof Error ? error.message : "O arquivo ainda não está disponível.", "danger");
  }
}

function crumbLabel(key: string, storeName: Map<string, string>, personName: Map<string, string>) {
  return storeName.get(key) ?? personName.get(key) ?? key;
}

function personLeft(person: PersonRow) {
  if (person.roleLabel === "Gerente" || person.roleLabel === "Gestor" || person.roleLabel === "Usuário da filial") return !person.active;
  if (person.roleLabel === "Vendedor") return !(person.active && person.inErp);
  return !person.active;
}

function monthRank(name: string) {
  return ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"].indexOf(name);
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
    return stores.map((store) => {
      const count = documents.filter((doc) => doc.storeId === store.id).length;
      return {
        key: store.id,
        label: store.name,
        count,
        detail: qty(people.filter((person) => person.storeId === store.id).length, "pessoa", "pessoas"),
      };
    });
  }
  const storeKey = allStores ? crumb[0] : null;
  const depth = allStores ? crumb.length - 1 : crumb.length;
  const peopleHere = people.filter((person) => !storeKey || person.storeId === storeKey);
  if (depth === 0) {
    return peopleHere.map((person) => {
      const count = documents.filter((doc) => documentPersonKey(doc) === person.id).length;
      const inactive = personLeft(person);
      return {
        key: person.id,
        label: person.name,
        caption: inactive ? "Desativada" : person.roleLabel,
        inactive,
        count,
        detail: qty(count, "documento", "documentos"),
      };
    });
  }
  const sellerId = allStores ? crumb[1] : crumb[0];
  const docs = documents.filter((doc) => documentPersonKey(doc) === sellerId);
  if (depth === 1) {
    return [...new Set(docs.map(yearOf))].filter(Boolean).sort((left, right) => Number(right) - Number(left)).map((year) => {
      const count = docs.filter((doc) => yearOf(doc) === year).length;
      return { key: year, label: year, count, detail: qty(count, "documento", "documentos") };
    });
  }
  const year = allStores ? crumb[2] : crumb[1];
  if (depth === 2) {
    return [...new Set(docs.filter((doc) => yearOf(doc) === year).map(monthOf))].filter(Boolean).sort((left, right) => monthRank(right) - monthRank(left)).map((month) => {
      const count = docs.filter((doc) => yearOf(doc) === year && monthOf(doc) === month).length;
      return { key: month, label: month, count, detail: qty(count, "documento", "documentos") };
    });
  }
  const month = allStores ? crumb[3] : crumb[2];
  return docs
    .filter((doc) => yearOf(doc) === year && monthOf(doc) === month)
    .map((doc) => {
      const fraction = signerFraction(signersOf(doc, people));
      const detail = fraction && doc.envelopeId ? `${fraction.done} de ${fraction.total}` : STATUS_LABEL[doc.status];
      return { key: doc.id, label: displayTitle(doc.fileName), detail, fileId: doc.id };
    });
}

function signersOf(doc: DocumentRow, people: PersonRow[]) {
  const listed = visibleSigners({ signers: doc.signers, personName: findDocumentPerson(people, doc)?.name ?? null, extras: doc.extraSigner });
  if (listed.length > 0 || !doc.envelopeId) return listed;
  const name = findDocumentPerson(people, doc)?.name.trim() ?? "";
  if (!name) return [];
  const status: SignerProgress["status"] = doc.status === "SIGNED" ? "SIGNED" : doc.status === "DECLINED" ? "DECLINED" : "PENDING";
  return [{ name, order: 1, recipientId: null, channel: null, status }];
}

function statusOrder(label: string) {
  const index = STATUS_ORDER.indexOf(label);
  return String(index < 0 ? STATUS_ORDER.length : index).padStart(2, "0");
}

function FolderList({ rows, onOpen }: { rows: FolderEntry[]; onOpen: (key: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      {rows.map((row) => (
        <button key={row.key} type="button" onClick={() => onOpen(row.key)} className="flex min-w-0 items-center gap-3 rounded-2xl border border-line bg-bg-2 p-4 text-left hover:border-line-2 hover:bg-bg-3">
          <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-acc-soft text-acc">
            <FolderGlyph size={19} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-bold text-t0">{row.label}</span>
            <span className="mt-0.5 block truncate text-[11.5px] text-t2">{row.inactive ? `${row.caption} · ${row.detail}` : row.caption ?? row.detail}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function DocumentTable({
  rows,
  people,
  showPerson,
  showStore,
  storeName,
  busy,
  onDownload,
  onOpenSignatures,
  onMove,
  onDelete,
}: {
  rows: DocumentRow[];
  people: PersonRow[];
  showPerson: boolean;
  showStore: boolean;
  storeName: Map<string, string>;
  busy: boolean;
  onDownload: (id: string) => void;
  onOpenSignatures: (id: string) => void;
  onMove: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const columns: DataTableColumn<DocumentRow>[] = [
    {
      key: "document",
      header: "Documento",
      sortable: true,
      sortValue: (row) => displayTitle(row.fileName),
      render: (row) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-acc-soft text-acc">
            <FileGlyph />
          </span>
          <span className="truncate text-[13px] font-bold text-t0">{displayTitle(row.fileName)}</span>
        </span>
      ),
    },
  ];
  if (showPerson) {
    columns.push({
      key: "person",
      header: "Pessoa",
      sortable: true,
      sortValue: (row) => findDocumentPerson(people, row)?.name ?? "",
      render: (row) => <span className="text-[13px] text-t0">{findDocumentPerson(people, row)?.name ?? "Sem pessoa"}</span>,
    });
  }
  if (showStore) {
    columns.push({
      key: "store",
      header: "Filial",
      hideBelow: "md",
      sortable: true,
      sortValue: (row) => (row.storeId ? storeName.get(row.storeId) ?? "" : ""),
      render: (row) => <span className="text-[13px] text-t1">{row.storeId ? storeName.get(row.storeId) ?? "—" : "—"}</span>,
    });
  }
  columns.push(
    {
      key: "signatures",
      header: "Assinaturas",
      sortable: true,
      sortValue: (row) => {
        const fraction = signerFraction(signersOf(row, people));
        if (!row.envelopeId || isFiledStatus(row.status) || !fraction || fraction.total === 0) return null;
        return fraction.done / fraction.total;
      },
      render: (row) => <SignatureCount row={row} people={people} onOpen={onOpenSignatures} />,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (row) => statusOrder(partialEnvelopeLabel(row.status, signersOf(row, people)) ?? STATUS_LABEL[row.status]),
      render: (row) => <DocumentStatus row={row} people={people} />,
    },
    {
      key: "sent",
      header: "Enviado em",
      hideBelow: "sm",
      sortable: true,
      sortValue: (row) => {
        const time = new Date(row.sentAt ?? row.createdAt).getTime();
        return Number.isNaN(time) ? null : time;
      },
      render: (row) => <span className="text-[12.5px] text-t2">{formatDay(row.sentAt ?? row.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "52px",
      render: (row) =>
        pendingMenu(row) || isFiledStatus(row.status) || row.envelopeId ? (
          <RowMenu kind={isFiledStatus(row.status) ? "filed" : "pending"} busy={busy} onDownload={() => onDownload(row.id)} onSignatures={() => onOpenSignatures(row.id)} onMove={() => onMove(row.id)} onDelete={() => onDelete(row.id)} />
        ) : (
          <Button size="sm" variant="outline" onClick={() => onDownload(row.id)}>Baixar PDF</Button>
        ),
    },
  );
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowKey={(row) => row.id}
      defaultSortKey="status"
      defaultSortDir="asc"
      paginate="documentos"
      className="!rounded-none !border-0 !bg-transparent shadow-none"
    />
  );
}

function pendingMenu(row: DocumentRow) {
  return resendVisible(row.status) && Boolean(row.envelopeId);
}

function DocumentStatus({ row, people }: { row: DocumentRow; people: PersonRow[] }) {
  if (!row.envelopeId && !isFiledStatus(row.status)) return <span className="text-[12.5px] text-t2">Em preparação</span>;
  const partial = partialEnvelopeLabel(row.status, signersOf(row, people));
  return <Badge variant={partial ? "warning" : badgeVariant(row.status)}>{partial ?? STATUS_LABEL[row.status]}</Badge>;
}

function SignatureCount({ row, people, onOpen }: { row: DocumentRow; people: PersonRow[]; onOpen: (id: string) => void }) {
  if (!row.envelopeId || isFiledStatus(row.status)) return <span className="text-[12.5px] text-t2">—</span>;
  const fraction = signerFraction(signersOf(row, people));
  if (!fraction) return <span className="text-[12.5px] text-t2">—</span>;
  return (
    <button type="button" className="text-[13px] font-semibold text-t0 underline-offset-2 hover:text-acc hover:underline" onClick={() => onOpen(row.id)}>
      {fraction.done}/{fraction.total}
    </button>
  );
}

function SignaturesModal({
  doc,
  people,
  batches,
  busy,
  resending,
  onClose,
  onCopy,
  onResend,
}: {
  doc: DocumentRow | null;
  people: PersonRow[];
  batches: Map<string, BatchRow>;
  busy: boolean;
  resending: boolean;
  onClose: () => void;
  onCopy: (id: string, recipientId?: string) => void;
  onResend: (id: string, recipientId?: string) => void;
}) {
  const signers = doc ? signersOf(doc, people) : [];
  const fraction = signerFraction(signers);
  const person = doc ? findDocumentPerson(people, doc)?.name ?? "Sem pessoa" : "";
  const batch = doc ? batches.get(doc.batchId) : undefined;
  const period = batch ? `${monthFolder(batch.month)}/${batch.year}` : "";
  return (
    <Modal
      open={doc != null}
      onClose={onClose}
      title="Assinaturas"
      footer={<Button variant="outline" onClick={onClose}>Fechar</Button>}
    >
      {doc ? (
        <div className="grid gap-4">
          <div>
            <p className="text-[14px] font-bold text-t0">{displayTitle(doc.fileName)}</p>
            <p className="mt-0.5 text-[12.5px] text-t2">{period ? `${person} · ${period}` : person}</p>
            {fraction ? <p className="mt-3 text-[13px] text-t1">{signatureProgressDetail(fraction.done, fraction.total)}</p> : null}
          </div>
          <div className="grid divide-y divide-line rounded-[var(--radius-vela-md)] border border-line">
            {signers.map((signer) => {
              const pending = signer.status === "PENDING";
              const ownLink = Boolean(signer.recipientId) || signer.order === 1;
              const contact = signerContact(signer, doc, people);
              const channel = signer.channel === "EMAIL" ? "E-mail" : signer.channel === "WHATSAPP" ? "WhatsApp" : null;
              return (
                <div key={`${signer.order}-${signer.name}`} className="grid gap-2 px-3 py-3">
                  <span className="flex min-w-0 items-start gap-2">
                    <SignerMark status={signer.status} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold text-t0">{signer.name}</span>
                      <span className="mt-0.5 block text-[12px] text-t2">{signerState(signer.status)}</span>
                      {pending && (channel || contact) ? (
                        <span className="mt-0.5 block truncate text-[12px] text-t1">{[channel, contact].filter(Boolean).join(" · ")}</span>
                      ) : null}
                    </span>
                  </span>
                  {pending && ownLink ? (
                    <span className="flex flex-wrap gap-2 pl-6">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onCopy(doc.id, signer.recipientId ?? undefined)}>Copiar link</Button>
                      {signer.channel || signer.order === 1 ? (
                        <Button size="sm" disabled={busy} onClick={() => onResend(doc.id, signer.recipientId ?? undefined)}>
                          {resending ? "Reenviando…" : "Reenviar"}
                        </Button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function signerState(status: SignerProgress["status"]) {
  if (status === "SIGNED") return "Assinado";
  if (status === "DECLINED") return "Recusou";
  return "Aguardando assinatura";
}

function SignerMark({ status }: { status: SignerProgress["status"] }) {
  const label = signerState(status);
  if (status === "SIGNED") {
    return (
      <span className="mt-0.5 text-ok" aria-label={label}>
        <Icon d={icons.check} size={14} />
      </span>
    );
  }
  if (status === "DECLINED") {
    return (
      <span className="mt-0.5 text-bad" aria-label={label}>
        <Icon d={icons.x} size={14} />
      </span>
    );
  }
  return (
    <svg className="mt-0.5 shrink-0 text-warn" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-label={label}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l2.5 1.5" />
    </svg>
  );
}

function signerContact(signer: SignerProgress, row: DocumentRow, people: PersonRow[]): string | null {
  const person = findDocumentPerson(people, row);
  const extra = extraContacts(row.extraSigner).find((item) => item.name.toLowerCase() === signer.name.trim().toLowerCase());
  const owner = signer.order === 1 || person?.name.trim().toLowerCase() === signer.name.trim().toLowerCase();
  const email = (extra?.email || (owner ? person?.email : null) || "").trim();
  const phone = (extra?.whatsapp || (owner ? person?.whatsapp : null) || "").trim();
  const chosen = signer.channel === "EMAIL" ? email || phone : phone || email;
  return chosen ? contactLabel(chosen) : null;
}

function extraContacts(value: unknown): { name: string; email: string | null; whatsapp: string | null }[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) return [];
    return [{
      name,
      email: typeof raw.email === "string" ? raw.email : null,
      whatsapp: typeof raw.whatsapp === "string" ? raw.whatsapp : null,
    }];
  });
}

function contactLabel(value: string): string {
  if (value.includes("@")) return value.trim();
  const digits = value.replace(/\D/g, "");
  const local = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return value.trim();
}

function RowMenu({
  kind,
  busy,
  onDownload,
  onSignatures,
  onMove,
  onDelete,
}: {
  kind: "pending" | "filed";
  busy: boolean;
  onDownload: () => void;
  onSignatures: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const items: DropdownItem[] = [
    { label: "Baixar PDF", onClick: onDownload, disabled: busy },
    ...(kind === "pending" ? [{ label: "Ver assinaturas", onClick: onSignatures, disabled: busy }] : []),
    { label: "Mover", onClick: onMove, disabled: busy },
    { label: "", divider: true },
    { label: "Excluir documento", onClick: onDelete, danger: true, disabled: busy },
  ];
  return (
    <span className="flex justify-end">
      <Dropdown
        align="right"
        portal
        items={items}
        trigger={
          <button type="button" aria-label="Ações do documento" disabled={busy} className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-t1 hover:bg-bg-3 disabled:opacity-50">
            <Icon d={icons.dots} size={16} />
          </button>
        }
      />
    </span>
  );
}

function formatDay(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}
