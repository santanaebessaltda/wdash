import { useEffect, useId, useState } from "react";
import { Button, Dropdown, EmptyState, FormField, Input, Modal, Skeleton, useToast, type DropdownItem } from "@/components/ui";
import {
  deleteStoreShift,
  fetchStoreSellers,
  fetchStoreShifts,
  isActiveSalesPerson,
  saveStoreShift,
  type StoreShift,
} from "@/data/wedash/stores";
import { shiftName } from "@/lib/format";
import { Icon, icons } from "@/pages/users/Icons";
import { SAVE_ERROR_MSG, TimeSelect, nextHalfHour } from "@/pages/operation/shared";

export function nextGroupWindow(shifts: StoreShift[]): { start: string; end: string } {
  const start = shifts[shifts.length - 1]?.end ?? "08:00";
  const end = shifts.length === 0 ? "14:00" : nextHalfHour(start);
  return start < end ? { start, end } : { start: "08:00", end: "14:00" };
}

function sellerCountLabel(count: number): string {
  if (count === 0) return "Nenhum vendedor";
  if (count === 1) return "1 vendedor";
  return `${count} vendedores`;
}

/** Horário válido e nome único na filial. `null` quando pode salvar. */
function groupProblem(name: string, start: string, end: string, shifts: StoreShift[], exceptId?: string): string | null {
  const trimmed = shiftName(name);
  if (!trimmed) return "Dê um nome para o grupo.";
  if (shifts.some((s) => s.id !== exceptId && s.name.toLocaleLowerCase("pt-BR") === trimmed.toLocaleLowerCase("pt-BR"))) {
    return `Já existe um grupo chamado “${trimmed}”.`;
  }
  if (start >= end) return "O horário de início deve ser anterior ao horário de fim.";
  return null;
}

export function GroupPicker({
  sellerName,
  shifts,
  value,
  disabled,
  onChange,
  onCreate,
}: {
  sellerName: string;
  shifts: StoreShift[];
  value: string | null;
  disabled?: boolean;
  onChange: (shiftId: string | null) => void;
  onCreate: () => void;
}) {
  const current = shifts.find((s) => s.id === value);
  const items: DropdownItem[] = [
    ...shifts.map((s) => ({
      label: shiftName(s.name),
      active: s.id === value,
      onClick: () => onChange(s.id),
    })),
    { label: "Sem grupo", active: !value, onClick: () => onChange(null) },
    { label: "", divider: true },
    { label: "+ Criar grupo", highlight: true, onClick: onCreate },
  ];
  return (
    <div className={disabled ? "pointer-events-none opacity-50" : undefined}>
      <Dropdown
        align="left"
        portal
        menuClassName="max-h-72 overflow-y-auto"
        items={items}
        trigger={
          <button
            type="button"
            disabled={disabled}
            aria-label={`Grupo de ${sellerName}`}
            className="inline-flex h-9 min-w-[132px] max-w-[200px] items-center justify-between gap-2 rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-2.5 text-[13px] font-medium text-t0"
          >
            <span className={current ? "truncate" : "truncate text-t2"}>{current ? shiftName(current.name) : "Sem grupo"}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-t2">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        }
      />
    </div>
  );
}

export function GroupFormModal({
  open,
  title,
  submitLabel,
  busyLabel = "Salvando…",
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  busyLabel?: string;
  initial: { name: string; start: string; end: string };
  onClose: () => void;
  onSubmit: (draft: { name: string; start: string; end: string }) => Promise<boolean>;
}) {
  const formId = useId();
  const [name, setName] = useState(initial.name);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initial.name);
    setStart(initial.start);
    setEnd(initial.end);
    setBusy(false);
  }, [open, initial.name, initial.start, initial.end]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    const ok = await onSubmit({ name, start, end });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Modal
      open={open}
      size="sm"
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? busyLabel : submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormField label="Nome do grupo">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Ex.: Manhã" aria-label="Nome do grupo" />
        </FormField>
        <div className="flex gap-3">
          <FormField label="Início">
            <TimeSelect value={start} onChange={setStart} aria-label="Início" />
          </FormField>
          <FormField label="Fim">
            <TimeSelect value={end} onChange={setEnd} aria-label="Fim" />
          </FormField>
        </div>
      </form>
    </Modal>
  );
}

export function ManageGroupsModal({
  open,
  tenantId,
  storeId,
  onClose,
  onChanged,
}: {
  open: boolean;
  tenantId: string;
  storeId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { show } = useToast();
  const [shifts, setShifts] = useState<StoreShift[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<StoreShift | null>(null);
  const [creating, setCreating] = useState<{ start: string; end: string } | null>(null);
  const [removing, setRemoving] = useState<StoreShift | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoaded(false);
    void Promise.all([fetchStoreShifts(tenantId, storeId), fetchStoreSellers(tenantId, [storeId])]).then(([list, sellers]) => {
      if (cancelled) return;
      const count = new Map<string, number>();
      for (const seller of sellers.get(storeId) ?? []) {
        if (seller.shiftId && isActiveSalesPerson(seller)) count.set(seller.shiftId, (count.get(seller.shiftId) ?? 0) + 1);
      }
      setCounts(count);
      setShifts(list);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, tenantId, storeId, tick]);

  function refresh() {
    setTick((n) => n + 1);
    onChanged();
  }

  async function saveCreate(draft: { name: string; start: string; end: string }) {
    const problem = groupProblem(draft.name, draft.start, draft.end, shifts);
    if (problem) {
      show(problem, "danger");
      return false;
    }
    const r = await saveStoreShift({ tenantId, storeId, shift: draft });
    if (!r.ok) {
      show(SAVE_ERROR_MSG, "danger");
      return false;
    }
    show("Grupo criado.", "success");
    refresh();
    return true;
  }

  async function saveEdit(draft: { name: string; start: string; end: string }) {
    if (!editing) return false;
    const problem = groupProblem(draft.name, draft.start, draft.end, shifts, editing.id);
    if (problem) {
      show(problem, "danger");
      return false;
    }
    const r = await saveStoreShift({
      tenantId,
      storeId,
      shift: { id: editing.id, name: draft.name, start: draft.start, end: draft.end },
    });
    if (!r.ok) {
      show(SAVE_ERROR_MSG, "danger");
      return false;
    }
    show("Alterações salvas.", "success");
    refresh();
    return true;
  }

  async function remove(shift: StoreShift) {
    setBusy(true);
    const r = await deleteStoreShift(shift.id);
    setBusy(false);
    setRemoving(null);
    if (!r.ok) return show(SAVE_ERROR_MSG, "danger");
    show("Grupo excluído.", "success");
    refresh();
  }

  const removingCount = removing ? (counts.get(removing.id) ?? 0) : 0;

  return (
    <>
      <Modal
        open={open}
        onClose={() => {
          setEditing(null);
          setCreating(null);
          setRemoving(null);
          onClose();
        }}
        title="Gerenciar grupos"
        size="md"
        footer={
          loaded ? (
            <Button type="button" onClick={() => setCreating(nextGroupWindow(shifts))}>
              Criar grupo
            </Button>
          ) : undefined
        }
      >
        {!loaded ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : shifts.length === 0 ? (
          <EmptyState
            framed={false}
            className="py-2!"
            icon="👥"
            title="Nenhum grupo cadastrado"
            description="Crie um grupo para organizar os vendedores desta filial."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {shifts.map((shift) => (
              <li key={shift.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-vela-md)] border border-line px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-bold text-t0">{shiftName(shift.name)}</p>
                  <p className="text-[12.5px] text-t2">
                    {shift.start}–{shift.end} · {sellerCountLabel(counts.get(shift.id) ?? 0)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(shift)}>
                    Editar
                  </Button>
                  <button
                    type="button"
                    aria-label={`Excluir ${shiftName(shift.name)}`}
                    onClick={() => {
                      if ((counts.get(shift.id) ?? 0) > 0) setRemoving(shift);
                      else void remove(shift);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-t2 hover:bg-bg-3 hover:text-bad"
                  >
                    <Icon d={icons.trash} size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <GroupFormModal
        open={creating != null}
        title="Criar grupo"
        submitLabel="Criar grupo"
        busyLabel="Criando…"
        initial={{ name: "", start: creating?.start ?? "08:00", end: creating?.end ?? "14:00" }}
        onClose={() => setCreating(null)}
        onSubmit={saveCreate}
      />
      <GroupFormModal
        open={editing != null}
        title="Editar grupo"
        submitLabel="Salvar alterações"
        busyLabel="Salvando…"
        initial={{ name: editing?.name ?? "", start: editing?.start ?? "08:00", end: editing?.end ?? "14:00" }}
        onClose={() => setEditing(null)}
        onSubmit={saveEdit}
      />
      <Modal
        open={removing != null}
        onClose={() => !busy && setRemoving(null)}
        title={removing ? `Excluir grupo ${shiftName(removing.name)}?` : "Excluir grupo?"}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setRemoving(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy || !removing}
              onClick={() => {
                if (removing) void remove(removing);
              }}
            >
              {busy ? "Excluindo…" : "Excluir grupo"}
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-t1">
          {removingCount === 1 ? "1 vendedor ficará sem grupo definido." : `${removingCount} vendedores ficarão sem grupo definido.`}
        </p>
      </Modal>
    </>
  );
}

export { groupProblem };
