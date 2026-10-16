import { useRef, useState } from "react";
import { Breadcrumbs, Button, FormField, WizardCardHeader, WizardNav, WizardSteps } from "@/components/ui";
import { paths } from "@/router/paths";
import { Icon, icons } from "@/pages/users/Icons";
import { cn } from "@/lib/cn";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_COPY,
  DOCUMENT_LIMITS,
  archivePeople,
  customDocumentName,
  monthFolder,
} from "@/data/wedash/documentSplit";
import { storeFiles, type PersonRow } from "@/data/wedash/documentsRepo";

const controlClass =
  "h-[42px] w-full rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3.5 text-[13px] text-t0 outline-none transition-colors focus:border-acc";

const STEPS = [
  { num: 1, label: "Anexar" },
  { num: 2, label: "Organizar" },
];

export function PathChoice({ onClose, onSign, onFile }: { onClose: () => void; onSign: () => void; onFile: () => void }) {
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" icon={<Icon d={icons.arrowLeft} size={14} />} onClick={onClose}>
          Voltar
        </Button>
        <Breadcrumbs items={[{ label: "Documentos", to: paths.documents }, { label: "Anexar documento" }]} />
      </div>
      <div className="mx-auto max-w-3xl pb-10">
        <h1 className="text-[22px] font-bold text-t0">Anexar documento</h1>
        <p className="mt-1 text-[13.5px] text-t2">Escolha se este PDF vai para assinatura ou só entra na pasta da pessoa.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button type="button" className="rounded-2xl border border-line bg-bg-2 p-5 text-left hover:border-line-2 hover:bg-bg-3" onClick={onSign}>
            <span className="block text-[15px] font-bold text-t0">Enviar para assinatura</span>
            <span className="mt-1 block text-[13px] text-t2">Anexar, preparar os signatários e enviar para assinatura.</span>
          </button>
          <button type="button" className="rounded-2xl border border-line bg-bg-2 p-5 text-left hover:border-line-2 hover:bg-bg-3" onClick={onFile}>
            <span className="block text-[15px] font-bold text-t0">Guardar documento</span>
            <span className="mt-1 block text-[13px] text-t2">Organizar o PDF na pasta da pessoa, sem enviar para assinatura.</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function StoreDocument({
  storeId,
  people,
  stores,
  onDone,
  onBack,
}: {
  storeId: string | null;
  people: PersonRow[];
  stores: { id: string; name: string }[];
  onDone: () => void;
  onBack: () => void;
}) {
  const now = new Date();
  const [step, setStep] = useState(1);
  const [category, setCategory] = useState<string>(DOCUMENT_CATEGORIES[0]);
  const [customName, setCustomName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [branchId, setBranchId] = useState(storeId ?? "");
  const [personId, setPersonId] = useState("");
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [situation, setSituation] = useState<"ARCHIVED" | "EXTERNAL_SIGNED">("ARCHIVED");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const branchName = stores.find((store) => store.id === (storeId ?? branchId))?.name ?? "";
  const choices = archivePeople(people, branchId || null);

  function leave() {
    if (saving) return;
    if (step > 1) {
      setStep(1);
      return;
    }
    onBack();
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" icon={<Icon d={icons.arrowLeft} size={14} />} disabled={saving} onClick={leave}>
          Voltar
        </Button>
        <Breadcrumbs items={[{ label: "Documentos", to: paths.documents }, { label: "Guardar documento" }]} />
      </div>
      <div className="mx-auto max-w-3xl pb-10">
        <WizardSteps steps={STEPS} current={step} />
        {step === 1 ? (
          <FileStep
            category={category}
            customName={customName}
            files={files}
            error={error}
            onCategory={setCategory}
            onCustomName={setCustomName}
            onFiles={setFiles}
            onError={setError}
            onCancel={leave}
            onNext={() => {
              const named = category === "Outros" ? customDocumentName(customName) : { ok: true as const };
              if (!named.ok) {
                setError(named.message);
                return;
              }
              setError(null);
              setStep(2);
            }}
          />
        ) : (
          <OrganizeStep
            lockedStore={storeId != null}
            branchName={branchName}
            stores={stores}
            branchId={branchId}
            people={choices}
            personId={personId}
            month={month}
            year={year}
            situation={situation}
            error={error}
            saving={saving}
            onBranch={(value) => {
              setBranchId(value);
              setPersonId("");
            }}
            onPerson={setPersonId}
            onMonth={setMonth}
            onYear={setYear}
            onSituation={setSituation}
            onBack={() => setStep(1)}
            onSave={() => {
              const parsedYear = Number(year);
              if (!branchId) {
                setError("Escolha a filial.");
                return;
              }
              if (!personId) {
                setError("Escolha a pessoa.");
                return;
              }
              if (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
                setError("Informe um ano válido.");
                return;
              }
              setError(null);
              setSaving(true);
              void storeFiles({
                storeId: branchId,
                personId,
                month: Number(month),
                year: parsedYear,
                category,
                title: customName,
                situation,
                files,
              }).then(
                (result) => {
                  setSaving(false);
                  if (result.created.length === 0) {
                    setError(result.refused[0]?.message ?? "Não foi possível guardar o documento. Tente novamente.");
                    return;
                  }
                  if (result.refused.length > 0) {
                    setError("Alguns documentos não foram guardados. Os que já entraram na pasta não serão duplicados se você tentar de novo com os mesmos arquivos.");
                    setFiles((current) => current.filter((file) => result.refused.some((item) => item.name === file.name)));
                    return;
                  }
                  onDone();
                },
                (reason: unknown) => {
                  setSaving(false);
                  setError(reason instanceof Error ? reason.message : "Não foi possível guardar o documento. Tente novamente.");
                },
              );
            }}
          />
        )}
      </div>
    </div>
  );
}

function FileStep({
  category,
  customName,
  files,
  error,
  onCategory,
  onCustomName,
  onFiles,
  onError,
  onCancel,
  onNext,
}: {
  category: string;
  customName: string;
  files: File[];
  error: string | null;
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
      <WizardCardHeader title="Guardar documento" subtitle="Envie até 5 PDFs. Eles entram na pasta da pessoa e não são enviados para assinatura." />
      <FormField label="Tipo do documento">
        <select className={controlClass} value={category} onChange={(event) => onCategory(event.target.value)}>
          {DOCUMENT_CATEGORIES.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </FormField>
      {category === "Outros" && (
        <div className="mt-3">
          <FormField label="Nome do documento" hint="Este nome aparece na pasta.">
            <input className={controlClass} value={customName} placeholder="Ex.: Atestado médico" onChange={(event) => onCustomName(event.target.value)} />
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
        <h3 className="text-[17px] font-bold text-t0">Arraste e solte os PDFs aqui</h3>
        <p className="mt-2 text-[13.5px] text-t2">ou clique para selecionar até 5 arquivos</p>
        <p className="mt-1 text-[12px] text-t2">PDF · até 15 MB e 1.000 páginas por arquivo · digital ou escaneado</p>
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
      {files.length > 0 && (
        <ul className="mt-3 overflow-hidden rounded-xl border border-line">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`} className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 last:border-b-0">
              <span className="truncate text-[13px] font-bold text-t0">{file.name}</span>
              <button type="button" className="text-[12.5px] font-bold text-bad" onClick={() => onFiles(files.filter((item) => item !== file))}>
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-4">
        <WizardNav previousLabel="Voltar" nextLabel="Continuar" hideNextIcon onPrevious={onCancel} onNext={onNext} nextDisabled={files.length === 0} />
      </div>
    </>
  );
}

function personLabel(person: PersonRow) {
  const leader = person.roleLabel === "Gerente" || person.roleLabel === "Gestor";
  const off = leader ? !person.active : !(person.active && person.inErp);
  return `${person.name} · ${person.roleLabel}${off ? " · Desativado" : ""}`;
}

function OrganizeStep({
  lockedStore,
  branchName,
  stores,
  branchId,
  people,
  personId,
  month,
  year,
  situation,
  error,
  saving,
  onBranch,
  onPerson,
  onMonth,
  onYear,
  onSituation,
  onBack,
  onSave,
}: {
  lockedStore: boolean;
  branchName: string;
  stores: { id: string; name: string }[];
  branchId: string;
  people: PersonRow[];
  personId: string;
  month: string;
  year: string;
  situation: "ARCHIVED" | "EXTERNAL_SIGNED";
  error: string | null;
  saving: boolean;
  onBranch: (value: string) => void;
  onPerson: (value: string) => void;
  onMonth: (value: string) => void;
  onYear: (value: string) => void;
  onSituation: (value: "ARCHIVED" | "EXTERNAL_SIGNED") => void;
  onBack: () => void;
  onSave: () => void;
}) {
  return (
    <>
      <WizardCardHeader title="Organizar" subtitle="Defina onde este documento fica. Nada é enviado para assinatura." />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Filial">
          {lockedStore ? (
            <p className="flex h-[42px] items-center text-[13.5px] font-bold text-t0">{branchName}</p>
          ) : (
            <select className={controlClass} value={branchId} onChange={(event) => onBranch(event.target.value)}>
              <option value="">Selecione</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="Pessoa">
          <select className={controlClass} value={personId} onChange={(event) => onPerson(event.target.value)} disabled={!branchId}>
            <option value="">Selecione</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {personLabel(person)}
              </option>
            ))}
          </select>
        </FormField>
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
      </div>
      <div className="mt-3">
        <FormField label="Situação">
          <select className={controlClass} value={situation} onChange={(event) => onSituation(event.target.value === "EXTERNAL_SIGNED" ? "EXTERNAL_SIGNED" : "ARCHIVED")}>
            <option value="ARCHIVED">Não requer assinatura</option>
            <option value="EXTERNAL_SIGNED">Já assinado</option>
          </select>
        </FormField>
        <p className="mt-2 text-[12.5px] text-t2">Não requer assinatura aparece como Arquivado. Já assinado indica que o documento foi assinado fora da WDash.</p>
      </div>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-4">
        <WizardNav previousLabel="Voltar" nextLabel={saving ? "Salvando…" : "Salvar"} hideNextIcon previousDisabled={saving} nextDisabled={saving} onPrevious={onBack} onNext={onSave} />
      </div>
    </>
  );
}
