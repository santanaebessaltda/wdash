import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge, Button, DataTable, Dropdown, EmptyState, FormField, Modal, Segmented, Card, useToast, type DataTableColumn, type DropdownItem } from "@/components/ui";
import { cn } from "@/lib/cn";
import { QuickStat } from "@/pages/dashboards/QuickStat";
import { Icon, icons } from "@/pages/users/Icons";
import { paths } from "@/router/paths";
import { archivePeople, displayTitle, documentPersonKey, findDocumentPerson, inLibrary, isFiledStatus, monthFolder, personMatchesQuery, resendVisible, sameCategory, signerCaption, signingPeople, DOCUMENT_CATEGORIES, type SignerProgress } from "@/data/wedash/documentSplit";
import type { BatchRow, DocumentRow, PersonRow } from "@/data/wedash/documentsRepo";
import { cancelDocument, copyDocumentLink, moveDocument, openDocument, resendDocument } from "@/data/wedash/documentsRepo";
import { DocumentsSkeleton } from "@/components/wedash/LoadingSkeletons";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { DocumentsFrame, FileGlyph, FolderGlyph, Glyph, STATUS_LABEL, SearchGlyph, badgeVariant } from "./frame";
import { useDocuments } from "./useDocuments";

type Mode = "home" | "pending" | "month" | "browse";
type PeopleFilter = "active" | "all" | "inactive";

type FolderEntry = { key: string; label: string; detail: string; caption?: string; fileId?: string };

const fieldClass = "h-10 w-full rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3 text-[13px] text-t0";

export function DocumentsPage() {
  const { allStores, batches, documents, people, stores, loading, reload } = useDocuments();
  const showSkeleton = useMinSkeleton(loading);
  const navigate = useNavigate();
  const { show } = useToast();
  const flash = (useLocation().state ?? null) as { documentNotice?: string | null } | null;
  const flashed = useRef(false);
  const [mode, setMode] = useState<Mode>("home");
  const [crumb, setCrumb] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [periodFilter, setPeriodFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>("active");
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [moveSeller, setMoveSeller] = useState("");
  const [moveMonth, setMoveMonth] = useState("1");
  const [moveYear, setMoveYear] = useState(String(new Date().getFullYear()));
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    if (flashed.current || !flash?.documentNotice) return;
    flashed.current = true;
    show(flash.documentNotice, "danger");
  }, [flash, show]);

  const storeName = useMemo(() => new Map(stores.map((store) => [store.id, store.name])), [stores]);
  const personName = useMemo(() => new Map(people.map((person) => [person.id, person.name])), [people]);
  const batchOf = useMemo(() => new Map(batches.map((batch) => [batch.id, batch])), [batches]);

  const sentDocuments = documents.filter((doc) => doc.envelopeId);
  const libraryDocuments = documents.filter((doc) => inLibrary(doc));
  const pending = sentDocuments.filter((doc) => doc.status === "PENDING");
  const signed = sentDocuments.filter((doc) => doc.status === "SIGNED");
  const now = new Date();
  const thisMonth = libraryDocuments.filter((doc) => {
    const batch = batchOf.get(doc.batchId);
    return batch?.month === now.getMonth() + 1 && batch.year === now.getFullYear();
  });
  const recent = [...libraryDocuments].sort((a, b) => (b.sentAt ?? b.createdAt).localeCompare(a.sentAt ?? a.createdAt)).slice(0, 12);
  const periods = [...new Set(libraryDocuments.map((doc) => {
    const batch = batchOf.get(doc.batchId);
    return batch ? `${batch.year}-${batch.month}` : "";
  }).filter(Boolean))].sort();

  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;

  function matchesText(doc: DocumentRow) {
    if (!needle) return true;
    const person = findDocumentPerson(people, doc);
    const titled = displayTitle(doc.fileName).toLowerCase().includes(needle) || doc.fileName.toLowerCase().includes(needle);
    return titled || (person != null && personMatchesQuery(person, needle));
  }

  function matchesFilters(doc: DocumentRow) {
    const batch = batchOf.get(doc.batchId);
    if (typeFilter && !sameCategory(batch?.category ?? "", typeFilter)) return false;
    if (statusFilter && doc.status !== statusFilter) return false;
    if (periodFilter && `${batch?.year}-${batch?.month}` !== periodFilter) return false;
    return true;
  }

  const pool =
    mode === "pending" ? pending : mode === "month" ? thisMonth : mode === "home" ? recent : [];
  const libraryDocs = libraryDocuments.filter((doc) => (mode === "home" ? true : matchesFilters(doc)));
  const visibleFiles = searching ? libraryDocs.filter(matchesText) : pool.filter((doc) => mode === "home" || matchesFilters(doc));
  const narrowed = searching || periodFilter || typeFilter || statusFilter;

  const listedPeople = people.filter((person) => {
    const seller = person.source === "team" && person.roleLabel === "Vendedor";
    const leader = person.roleLabel === "Gerente" || person.roleLabel === "Gestor" || person.roleLabel === "Usuário da filial";
    if (!seller && !leader) return false;
    const working = leader ? person.active : person.active && person.inErp;
    if (peopleFilter === "active") return working;
    if (peopleFilter === "inactive") return !working;
    return true;
  });
  const atPeople = mode === "browse" && (allStores ? crumb.length === 1 : crumb.length === 0);
  const peopleSearch = atPeople && query.trim().length > 0;
  const folders = mode === "browse" ? folderEntries({ allStores, crumb, documents: libraryDocs, batches, people: listedPeople, stores }) : [];
  const visibleFolders = peopleSearch
    ? folders.filter((folder) => {
        const person = listedPeople.find((item) => item.id === folder.key);
        return person != null && personMatchesQuery(person, query);
      })
    : searching
      ? []
      : folders;
  const peopleHere = listedPeople.filter((person) => !allStores || crumb[0] == null || person.storeId === crumb[0]);

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

  const title = sectionTitle(mode, allStores, crumb, storeName, personName);

  return (
    <DocumentsFrame
      title="Documentos"
      subtitle={allStores ? "Encontre documentos por filial, pessoa, ano e mês e acompanhe as assinaturas." : "Encontre documentos por pessoa, ano e mês e acompanhe as assinaturas."}
      actions={
        <Button onClick={() => navigate(paths.documentAttach)}>Anexar documento</Button>
      }
    >
      {showSkeleton ? (
        <DocumentsSkeleton allStores={allStores} />
      ) : (
      <>
      {mode === "home" && (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <QuickStat label="Enviados" value={String(sentDocuments.length)} sub="Enviados para assinatura" tint="acc" icon={<Glyph d="M22 2 11 13M22 2 15 22 11 13 2 9 22 2" />} />
          <QuickStat label="Pendentes" value={String(pending.length)} sub="Aguardando assinatura" tint="warn" icon={<Glyph d="M12 8v4l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20" />} />
          <QuickStat label="Assinados" value={String(signed.length)} sub="Assinatura concluída" tint="ok" icon={<Glyph d="M20 6 9 17l-5-5" />} />
        </div>
      )}
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-t2">Atalhos</p>
      <div className="mb-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        <Shortcut label="Pendentes" active={mode === "pending"} count={qty(pending.length, "documento", "documentos")} onClick={() => { setMode("pending"); setQuery(""); }} />
        <Shortcut label="Este mês" active={mode === "month"} count={qty(thisMonth.length, "documento", "documentos")} onClick={() => { setMode("month"); setQuery(""); }} />
        <Shortcut
          label={allStores ? "Filiais" : "Pessoas"}
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
            placeholder="Buscar por documento ou pessoa"
            className="w-40 bg-transparent text-[12.5px] text-t0 outline-none placeholder:text-t2 sm:w-72"
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
            <option value="ARCHIVED">Arquivado</option>
            <option value="EXTERNAL_SIGNED">Já assinado</option>
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

      {mode === "browse" && (!searching || peopleSearch) ? (
        visibleFolders.length === 0 ? (
          <Card padding="none">
            {atPeople ? (
              <EmptyState
                framed={false}
                title={peopleSearch ? "Nenhuma pessoa encontrada" : "Nenhuma pessoa disponível"}
                description={peopleSearch ? "Tente outro nome, CPF ou e-mail." : peopleHere.length === 0 ? "Não há pessoas vinculadas a esta filial." : "Não há pessoas neste filtro."}
              />
            ) : (
              <EmptyState framed={false} title="Esta pasta ainda não tem documentos." action={<Button onClick={() => navigate(paths.documentAttach)}>Anexar documento</Button>} />
            )}
          </Card>
        ) : (
          <FolderTable
            rows={visibleFolders}
            documents={documents}
            onOpenFolder={(key) => setCrumb([...crumb, key])}
            onOpenFile={(id) => void openFile(id, show)}
            onResend={(id, recipientId) => void resendFile(id, recipientId, show, setResendingId, reload)}
            onCopy={(id, recipientId) => void copyLink(id, recipientId)}
            onMove={openMove}
            onDelete={setDeleteId}
            busy={acting || resendingId != null}
            resendingId={resendingId}
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
          onDownload={(id) => void openFile(id, show)}
          onResend={(id, recipientId) => void resendFile(id, recipientId, show, setResendingId, reload)}
          onCopy={(id, recipientId) => void copyLink(id, recipientId)}
          onMove={openMove}
          onDelete={setDeleteId}
          busy={acting || resendingId != null}
          resendingId={resendingId}
        />
      )}
      <p className="mt-3 text-[12.5px] text-t2">
        {mode === "browse" && (!searching || peopleSearch) ? qty(visibleFolders.length, "item", "itens") : qty(visibleFiles.length, "documento", "documentos")}
      </p>
      </>
      )}
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
          {deleteId && isFiledStatus(documents.find((item) => item.id === deleteId)?.status ?? "PENDING") ? (
            <p className="text-[13.5px] text-t1">Este documento será removido da pasta na WDash. Não há assinatura no Assina AI para cancelar.</p>
          ) : (
            <>
              <p className="text-[13.5px] text-t1">Este documento será removido da WDash e a assinatura em andamento será cancelada no Assina AI.</p>
              {deleteId && extraSignerCount(documents.find((item) => item.id === deleteId)?.extraSigner) > 0 ? (
                <p className="text-[13.5px] text-t1">A assinatura de todos os signatários deste documento será cancelada.</p>
              ) : null}
            </>
          )}
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
          {moveId && isFiledStatus(documents.find((item) => item.id === moveId)?.status ?? "PENDING") ? (
            <>
              <p className="text-[13.5px] text-t1">Altere a pessoa, o mês ou o ano deste documento.</p>
              <p className="text-[13.5px] text-t1">Somente este documento será movido. Os demais documentos permanecem onde estão.</p>
            </>
          ) : (
            <>
              <p className="text-[13.5px] text-t1">Altere a pessoa, o mês ou o ano deste documento. A assinatura em andamento não será alterada.</p>
              <p className="text-[13.5px] text-t1">Somente este documento será movido. Os demais documentos do mesmo envio permanecem onde estão.</p>
            </>
          )}
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

function sectionTitle(mode: Mode, allStores: boolean, crumb: string[], storeName: Map<string, string>, personName: Map<string, string>) {
  if (mode === "pending") return "Pendentes";
  if (mode === "month") return `Este mês · ${monthFolder(new Date().getMonth() + 1)}`;
  if (mode === "home") return "Documentos recentes";
  if (crumb.length === 0) return allStores ? "Filiais" : "Pessoas";
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
      detail: qty(people.filter((person) => person.storeId === store.id).length, "pessoa", "pessoas"),
    }));
  }
  const storeKey = allStores ? crumb[0] : null;
  const depth = allStores ? crumb.length - 1 : crumb.length;
  const peopleHere = people.filter((person) => !storeKey || person.storeId === storeKey);
  if (depth === 0) {
    return peopleHere.map((person) => ({
      key: person.id,
      label: person.name,
      caption: person.roleLabel,
      detail: qty(documents.filter((doc) => documentPersonKey(doc) === person.id).length, "documento", "documentos"),
    }));
  }
  const sellerId = allStores ? crumb[1] : crumb[0];
  const docs = documents.filter((doc) => documentPersonKey(doc) === sellerId);
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
    .map((doc) => ({ key: doc.id, label: displayTitle(doc.fileName), detail: signerCaption(doc.signers) ?? STATUS_LABEL[doc.status], fileId: doc.id }));
}

function FolderTable({
  rows,
  documents,
  onOpenFolder,
  onOpenFile,
  onResend,
  onCopy,
  onMove,
  onDelete,
  busy,
  resendingId,
}: {
  rows: FolderEntry[];
  documents: DocumentRow[];
  onOpenFolder: (key: string) => void;
  onOpenFile: (id: string) => void;
  onResend: (id: string, recipientId?: string) => void;
  onCopy: (id: string, recipientId?: string) => void;
  onMove: (id: string) => void;
  onDelete: (id: string) => void;
  busy: boolean;
  resendingId: string | null;
}) {
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
            <span className="mt-px block text-[11px] text-t2">{row.fileId ? "PDF" : row.caption ?? "Pasta"}</span>
          </span>
        </button>
      ),
    },
    { key: "detail", header: "Conteúdo", render: (row) => <span className="text-[12.5px] text-t1">{row.detail}</span> },
    {
      key: "download",
      header: "",
      render: (row) => {
        const doc = row.fileId ? documents.find((item) => item.id === row.fileId) : undefined;
        if (doc && (pendingMenu(doc) || isFiledStatus(doc.status))) {
          return (
            <span className="flex items-center justify-end gap-2">
              {resendingId === doc.id && <span className="text-[12px] font-bold text-t2">Reenviando…</span>}
              <RowMenu
                kind={isFiledStatus(doc.status) ? "filed" : "pending"}
                signers={doc.signers}
                busy={busy}
                onDownload={() => onOpenFile(doc.id)}
                onResend={(recipientId) => onResend(doc.id, recipientId)}
                onCopy={(recipientId) => onCopy(doc.id, recipientId)}
                onMove={() => onMove(doc.id)}
                onDelete={() => onDelete(doc.id)}
              />
            </span>
          );
        }
        return row.fileId ? (
          <Button size="sm" variant="outline" onClick={() => onOpenFile(row.fileId!)}>
            Baixar PDF
          </Button>
        ) : null;
      },
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
  onCopy,
  onMove,
  onDelete,
  busy,
  resendingId,
}: {
  rows: DocumentRow[];
  people: PersonRow[];
  batches: Map<string, BatchRow>;
  stores: Map<string, string>;
  showStore: boolean;
  onDownload: (id: string) => void;
  onResend: (id: string, recipientId?: string) => void;
  onCopy: (id: string, recipientId?: string) => void;
  onMove: (id: string) => void;
  onDelete: (id: string) => void;
  busy: boolean;
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
      header: "Pessoa",
      hideBelow: "md",
      render: (row) => <span className="text-[12.5px] text-t1">{findDocumentPerson(people, row)?.name ?? "Sem pessoa"}</span>,
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
      render: (row) => <DocumentStatus row={row} />,
    },
    {
      key: "sent",
      header: "Enviado em",
      hideBelow: "sm",
      render: (row) => <span className="text-[12.5px] text-t1">{formatDay(isFiledStatus(row.status) ? row.createdAt : row.sentAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      render: (row) =>
        pendingMenu(row) || isFiledStatus(row.status) ? (
          <span className="flex items-center justify-end gap-2">
            {resendingId === row.id && <span className="text-[12px] font-bold text-t2">Reenviando…</span>}
            <RowMenu
              kind={isFiledStatus(row.status) ? "filed" : "pending"}
              signers={row.signers}
              busy={busy || resendingId === row.id}
              onDownload={() => onDownload(row.id)}
              onResend={(recipientId) => onResend(row.id, recipientId)}
              onCopy={(recipientId) => onCopy(row.id, recipientId)}
              onMove={() => onMove(row.id)}
              onDelete={() => onDelete(row.id)}
            />
          </span>
        ) : (
          <span className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => onDownload(row.id)}>
              Baixar PDF
            </Button>
          </span>
        ),
    },
  ];
  return <DataTable columns={columns} data={rows} rowKey={(row) => row.id} />;
}

function extraSignerCount(value: unknown) {
  const items = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  return items.filter((item) => item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string" && (item as { name: string }).name.trim()).length;
}

function pendingMenu(row: DocumentRow) {
  return resendVisible(row.status) && Boolean(row.envelopeId);
}

function DocumentStatus({ row }: { row: DocumentRow }) {
  if (!row.envelopeId && !isFiledStatus(row.status)) return <span className="text-[12.5px] text-t2">Em preparação</span>;
  const caption = signerCaption(row.signers);
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <Badge variant={badgeVariant(row.status)}>{STATUS_LABEL[row.status]}</Badge>
      {caption ? <span className="text-[12px] text-t1">{caption}</span> : null}
    </span>
  );
}

function RowMenu({
  kind,
  signers,
  busy,
  onDownload,
  onResend,
  onCopy,
  onMove,
  onDelete,
}: {
  kind: "pending" | "filed";
  signers: SignerProgress[];
  busy: boolean;
  onDownload: () => void;
  onResend: (recipientId?: string) => void;
  onCopy: (recipientId?: string) => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const linked = signers.filter((signer) => signer.recipientId);
  const individual = kind === "pending" && linked.length > 1;
  const linkItems: DropdownItem[] = individual
    ? linked.flatMap((signer) => [
        ...(signer.status === "PENDING" && signer.channel
          ? [{ label: `Reenviar link · ${signer.name}`, onClick: () => onResend(signer.recipientId ?? undefined), disabled: busy }]
          : []),
        { label: `Copiar link · ${signer.name}`, onClick: () => onCopy(signer.recipientId ?? undefined), disabled: busy },
      ])
    : [
        { label: "Reenviar link", onClick: () => onResend(linked[0]?.recipientId ?? undefined), disabled: busy },
        { label: "Copiar link", onClick: () => onCopy(linked[0]?.recipientId ?? undefined), disabled: busy },
      ];
  const items: DropdownItem[] = [
    { label: "Baixar PDF", onClick: onDownload, disabled: busy },
    ...(kind === "pending" ? linkItems : []),
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
