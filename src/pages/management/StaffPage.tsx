import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, DataTable, Dropdown, EmptyState, FormField, Modal, Segmented, Skeleton, Switch, useToast, type DataTableColumn, type DropdownItem } from "@/components/ui";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { SegmentedSkeleton, StoreCardsSkeleton, TeamTableSkeleton } from "@/components/wedash/LoadingSkeletons";
import {
  fetchLatestSellerSyncedAt,
  fetchStoreSellers,
  fetchStoreShifts,
  isBranchSalesPerson,
  isBranchTeamMember,
  isResolvedBranchUser,
  teamRoleLabel,
  saveStoreShift,
  setBranchUser,
  setSellerShift,
  syncStoreSellersNow,
  type Store,
  type StoreSeller,
  type StoreShift,
} from "@/data/wedash/stores";
import { refreshMomentTitle, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { shiftName } from "@/lib/format";
import { InviteSellerModal } from "@/pages/management/InviteSellerModal";
import { GroupFormModal, ManageGroupsModal, groupProblem, nextGroupWindow } from "@/pages/management/SellerGroups";
import { CostCardTitle, SAVE_ERROR_MSG, StoreCardsPage, useScopedStores } from "@/pages/operation/shared";
import { Icon, icons } from "@/pages/users/Icons";
import {
  copySellerInviteLink,
  fetchSellerAccess,
  reactivateSeller,
  removeSellerAccess,
  resendSellerInvite,
  revokeSellerInvite,
  suspendSeller,
  type SellerAccessRow,
} from "@/data/wedash/sellerAccess";
import { ACCESS_LABEL, hasSalesGroup, type AccessState } from "@/data/wedash/engine/sellerAccess";
import { statusBadgeVariant } from "@/lib/status";

/** Equipe. Pessoas da filial no Millennium; grupo e acesso à WDash só do vendedor. */
export function StaffPage() {
  const { session, storeRows, loading } = useScopedStores();
  const { show } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [groupsTick, setGroupsTick] = useState(0);
  const [manageOpen, setManageOpen] = useState(false);
  const syncing = useRef(false);
  const singleStore = storeRows.length === 1 ? storeRows[0] : null;

  const storesRef = useRef(storeRows);
  storesRef.current = storeRows;
  const [sellerSyncAt, setSellerSyncAt] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (loading) return;
    let stop = false;
    const ids = storeRows.map((store) => store.id);
    void fetchLatestSellerSyncedAt(session.tenantId, ids).then((at) => {
      if (!stop) setSellerSyncAt(at);
    });
    return () => {
      stop = true;
    };
  }, [loading, storeRows, reloadKey, session.tenantId]);

  async function refreshTeam() {
    const list = storesRef.current;
    if (syncing.current || list.length === 0) return;
    syncing.current = true;
    try {
      const results = await Promise.all(list.map((store) => syncStoreSellersNow(store.id)));
      const fail = results.find((r) => !r.ok);
      if (fail && !fail.ok) show(fail.message, "danger");
      else show("Equipe atualizada.", "success");
      if (results.some((r) => r.ok)) setReloadKey((n) => n + 1);
    } finally {
      syncing.current = false;
    }
  }

  useScreenRefresh({
    label: "Atualizar equipe",
    tip: "Busca no Millennium a equipe desta filial.",
    status: refreshMomentTitle(sellerSyncAt),
    busyLabel: "Buscando equipe…",
    run: refreshTeam,
  });

  return (
    <>
      <StoreCardsPage
        section="Equipe"
        title="Equipe"
        subtitle="Acompanhe a equipe da filial e gerencie cadastros, grupos e acessos."
        actions={
          singleStore ? (
            <Button type="button" onClick={() => setManageOpen(true)}>
              Gerenciar grupos
            </Button>
          ) : undefined
        }
        loading={loading}
        skeleton={(n) => <StoreCardsSkeleton count={n} title team wide />}
        storeRows={storeRows}
        wide
        oneStore
      >
        {(store) => <StaffCard tenantId={session.tenantId} store={store} reloadKey={reloadKey} groupsTick={groupsTick} />}
      </StoreCardsPage>
      {singleStore && (
        <ManageGroupsModal
          open={manageOpen}
          tenantId={session.tenantId}
          storeId={singleStore.id}
          branch={singleStore}
          onClose={() => setManageOpen(false)}
          onChanged={() => setGroupsTick((n) => n + 1)}
        />
      )}
    </>
  );
}

function StaffCard({ tenantId, store, reloadKey, groupsTick }: { tenantId: string; store: Store; reloadKey: number; groupsTick: number }) {
  const { show } = useToast();
  const [team, setTeam] = useState<StoreSeller[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const [shifts, setShifts] = useState<StoreShift[]>([]);
  const [shiftOf, setShiftOf] = useState<Record<string, string | null>>({});
  const [tab, setTab] = useState<"ativos" | "desligados">("ativos");
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [access, setAccess] = useState<Map<string, AccessState> | null>(null);
  const [inviting, setInviting] = useState<StoreSeller | null>(null);
  const [editing, setEditing] = useState<StoreSeller | null>(null);
  const [pendingShift, setPendingShift] = useState<{ sellerId: string; shiftId: string } | null>(null);
  const [removing, setRemoving] = useState<StoreSeller | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);
  const [creating, setCreating] = useState<{ sellerId: string; start: string; end: string } | null>(null);
  const [branchChoice, setBranchChoice] = useState<{ chosen: boolean; sellerId: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchStoreSellers(tenantId, [store.id])
      .then((m) => {
        if (!cancelled) {
          setTeam(m.get(store.id) ?? []);
          setShiftOf({});
        }
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, store.id, tick, reloadKey, groupsTick]);

  useEffect(() => {
    setBranchChoice(null);
  }, [store.id, store.branchUserChosen, store.branchUserSellerId]);

  useEffect(() => {
    let cancelled = false;
    setAccess(null);
    void fetchSellerAccess(store.id).then((rows: SellerAccessRow[] | null) => {
      if (cancelled) return;
      setAccess(new Map((rows ?? []).map((r) => [r.storeSellerId, r.state])));
    });
    return () => {
      cancelled = true;
    };
  }, [store.id, tick, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    void fetchStoreShifts(tenantId, store.id).then((list) => {
      if (!cancelled) setShifts(list);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId, store.id, groupsTick]);

  const branchStore = branchChoice
    ? { ...store, branchUserChosen: branchChoice.chosen, branchUserSellerId: branchChoice.sellerId }
    : store;
  const salesPerson = (seller: StoreSeller) => isBranchSalesPerson(seller, branchStore);
  const ativos = useMemo(() => team.filter((seller) => isBranchTeamMember(seller, branchStore)), [team, branchStore]);
  const desligados = useMemo(() => team.filter((s) => !s.active), [team]);
  const rows = tab === "ativos" ? ativos : desligados;

  async function changeShift(sellerId: string, shiftId: string | null): Promise<boolean> {
    const before = shiftOf[sellerId];
    setShiftOf((m) => ({ ...m, [sellerId]: shiftId }));
    setSavingIds((s) => new Set(s).add(sellerId));
    const r = await setSellerShift(sellerId, shiftId);
    setSavingIds((s) => {
      const next = new Set(s);
      next.delete(sellerId);
      return next;
    });
    if (r.ok) return true;
    setShiftOf((m) => {
      const next = { ...m };
      if (before === undefined) delete next[sellerId];
      else next[sellerId] = before;
      return next;
    });
    show("Não foi possível alterar o grupo. Tente novamente.", "danger");
    return false;
  }

  async function createGroup(draft: { name: string; start: string; end: string }) {
    if (!creating) return false;
    const problem = groupProblem(draft.name, draft.start, draft.end, shifts);
    if (problem) {
      show(problem, "danger");
      return false;
    }
    const saved = await saveStoreShift({ tenantId, storeId: store.id, shift: draft });
    if (!saved.ok) {
      show(SAVE_ERROR_MSG, "danger");
      return false;
    }
    setShifts(await fetchStoreShifts(tenantId, store.id));
    const assigned = await changeShift(creating.sellerId, saved.id);
    if (!assigned) return false;
    setPendingShift({ sellerId: creating.sellerId, shiftId: saved.id });
    setTeam((list) => list.map((person) => (person.id === creating.sellerId ? { ...person, shiftId: saved.id } : person)));
    show("Grupo criado.", "success");
    return true;
  }

  async function runAccess(sellerId: string, fn: (id: string) => Promise<{ ok: boolean; message?: string }>, okMsg: string) {
    const r = await fn(sellerId);
    if (!r.ok) return show(r.message ?? "Não foi possível alterar o acesso. Tente novamente.", "danger");
    show(okMsg, "success");
    setTick((n) => n + 1);
  }

  async function copyLink(sellerId: string) {
    const r = await copySellerInviteLink(sellerId);
    if (!r.ok || !r.token) return show(r.ok ? "O link do convite não está mais disponível. Reenvie o convite." : r.message, "danger");
    try {
      await navigator.clipboard.writeText(r.token);
      show("Link copiado.", "success");
    } catch {
      show("Não foi possível copiar o link. Tente novamente.", "danger");
    }
  }

  async function saveProfile(seller: StoreSeller, draft: SellerDraft): Promise<boolean> {
    const currentShift = seller.id in shiftOf ? shiftOf[seller.id] : seller.shiftId;
    if (draft.sales && draft.shiftId !== (currentShift ?? null)) {
      const shifted = await changeShift(seller.id, draft.shiftId);
      if (!shifted) return false;
      setTeam((list) => list.map((person) => (person.id === seller.id ? { ...person, shiftId: draft.shiftId } : person)));
    }
    const wasBranch = isResolvedBranchUser(seller, branchStore);
    if (draft.branchUser !== wasBranch) {
      const before = branchChoice;
      const next = draft.branchUser ? seller.id : null;
      setBranchChoice({ chosen: true, sellerId: next });
      const saved = await setBranchUser(store.id, next);
      if (!saved.ok) {
        setBranchChoice(before);
        show("Não foi possível salvar o usuário da filial. Tente novamente.", "danger");
        return false;
      }
    }
    show("Cadastro salvo.", "success");
    return true;
  }

  const columns = useMemo<DataTableColumn<StoreSeller>[]>(
    () => [
      ...sellerColumns(branchStore),
      {
        key: "access",
        header: "Acesso",
        sortable: true,
        sortValue: (v) => (access == null || !salesPerson(v) ? null : accessLabel(access.get(v.id) ?? "NONE")),
        render: (v) => {
          if (!salesPerson(v)) return <span className="text-t2">—</span>;
          return <AccessBadge state={access == null ? "loading" : (access.get(v.id) ?? "NONE")} />;
        },
      },
      {
        key: "shift",
        header: "Grupo",
        sortable: true,
        sortValue: (v) => (salesPerson(v) ? groupLabel(v.id in shiftOf ? shiftOf[v.id] : v.shiftId, shifts) : null),
        render: (v) => {
          if (!salesPerson(v)) return <span className="text-t2">—</span>;
          const current = v.id in shiftOf ? shiftOf[v.id] : v.shiftId;
          return <span className="text-[13px] text-t1">{groupLabel(current, shifts)}</span>;
        },
      },
      {
        key: "actions",
        header: "",
        align: "right",
        render: (v) => {
          const items = rowActions({
            sales: salesPerson(v),
            state: salesPerson(v) ? (access == null ? null : (access.get(v.id) ?? "NONE")) : null,
            grouped: hasSalesGroup(v.id in shiftOf ? shiftOf[v.id] : v.shiftId),
            onEdit: () => setEditing({ ...v, shiftId: (v.id in shiftOf ? shiftOf[v.id] : v.shiftId) ?? null }),
            onInvite: () => setInviting(v),
            onCopy: () => void copyLink(v.id),
            onResend: () => void runAccess(v.id, resendSellerInvite, "Convite reenviado."),
            onRevoke: () => void runAccess(v.id, revokeSellerInvite, "Convite cancelado."),
            onSuspend: () => void runAccess(v.id, suspendSeller, "Acesso suspenso."),
            onReactivate: () => void runAccess(v.id, reactivateSeller, "Acesso reativado."),
            onRemove: () => setRemoving(v),
          });
          if (items.length === 0) return null;
          return <RowMenu items={items} />;
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shifts, shiftOf, savingIds, access, branchStore],
  );

  const withoutTeam = loaded && team.length === 0;

  return (
    <Card padding="none">
      <div className="px-5 pt-5">
        <CostCardTitle title="Equipe da filial" />
      </div>
      {!loaded ? (
        <div className="px-5 pb-4">
          <SegmentedSkeleton widths={["w-24", "w-32"]} />
        </div>
      ) : !withoutTeam && (
        <div className="px-5 pb-4">
          <Segmented
            options={[
              { value: "ativos", label: `Ativos (${ativos.length})` },
              { value: "desligados", label: `Desligados (${desligados.length})` },
            ]}
            value={tab}
            onChange={(v) => v && setTab(v)}
          />
        </div>
      )}
      {!loaded ? (
        <TeamTableSkeleton withShift={tab === "ativos"} />
      ) : rows.length === 0 ? (
        <EmptyState
          framed={false}
          className="pt-4!"
          icon="👥"
          title={withoutTeam ? "Nenhuma pessoa sincronizada" : tab === "ativos" ? "Nenhuma pessoa ativa" : "Nenhuma pessoa desligada"}
          description={
            withoutTeam
              ? "Use Atualizar equipe no topo para buscar a equipe desta filial no Millennium."
              : tab === "ativos"
                ? "Não há vendedores, operadores de caixa ou usuários da filial ativos nesta filial no momento."
                : "Pessoas desligadas no Millennium aparecem aqui."
          }
        />
      ) : (
        <DataTable
          className="rounded-none! border-x-0! border-b-0! bg-transparent!"
          columns={tab === "ativos" ? columns : [...sellerColumns(store), columns[columns.length - 1]!]}
          data={rows}
          rowKey={(v) => v.id}
          paginate="pessoas"
        />
      )}
      <Modal
        open={removing != null}
        onClose={() => !removingBusy && setRemoving(null)}
        title="Excluir acesso?"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setRemoving(null)} disabled={removingBusy}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={removingBusy}
              onClick={() => {
                if (!removing) return;
                setRemovingBusy(true);
                void removeSellerAccess(removing.id).then((r) => {
                  setRemovingBusy(false);
                  if (!r.ok) return show(r.message, "danger");
                  setRemoving(null);
                  show("Acesso excluído.", "success");
                  setTick((n) => n + 1);
                });
              }}
            >
              {removingBusy ? "Excluindo…" : "Excluir acesso"}
            </Button>
          </>
        }
      >
        {removing && (
          <p className="text-[13.5px] leading-relaxed text-t1">
            <span className="font-bold text-t0">{removing.name}</span> não poderá mais acessar esta filial na WDash. Você poderá convidar essa pessoa novamente depois.
          </p>
        )}
      </Modal>
      <SellerEditor
        seller={editing}
        store={branchStore}
        shifts={shifts}
        pendingShift={pendingShift}
        onClose={() => setEditing(null)}
        onCreateGroup={() => editing && setCreating({ sellerId: editing.id, ...nextGroupWindow(shifts) })}
        onSave={(seller, draft) => saveProfile(seller, draft)}
      />
      <GroupFormModal
        open={creating != null}
        title="Criar grupo"
        submitLabel="Criar grupo"
        busyLabel="Criando…"
        initial={{ name: "", start: creating?.start ?? "08:00", end: creating?.end ?? "14:00" }}
        onClose={() => setCreating(null)}
        onSubmit={createGroup}
      />
      <InviteSellerModal
        seller={inviting ? { id: inviting.id, name: inviting.name, email: inviting.email } : null}
        onClose={() => setInviting(null)}
        onDone={() => {
          setInviting(null);
          setTick((n) => n + 1);
        }}
      />
    </Card>
  );
}

const ACCESS_BADGE: Record<AccessState, string> = {
  NONE: ACCESS_LABEL.NONE,
  PENDING: ACCESS_LABEL.PENDING,
  ACTIVE: ACCESS_LABEL.ACTIVE,
  SUSPENDED: ACCESS_LABEL.SUSPENDED,
};

function AccessBadge({ state }: { state: AccessState | "loading" }) {
  if (state === "loading") return <Skeleton className="h-6 w-24 rounded-[var(--radius-vela-sm)]" />;
  const label = ACCESS_BADGE[state];
  return <Badge variant={statusBadgeVariant(label)}>{label}</Badge>;
}

function rowActions(input: {
  sales: boolean;
  state: AccessState | null;
  grouped: boolean;
  onEdit: () => void;
  onInvite: () => void;
  onCopy: () => void;
  onResend: () => void;
  onRevoke: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
  onRemove: () => void;
}): DropdownItem[] {
  const edit: DropdownItem = { label: "Editar cadastro", onClick: input.onEdit };
  if (!input.sales) return [edit];
  if (!input.state) return [edit];
  const exclude: DropdownItem = { label: "Excluir acesso", onClick: input.onRemove, danger: true };
  const access: DropdownItem[] =
    input.state === "NONE"
      ? [{ label: "Convidar", onClick: input.onInvite, disabled: !input.grouped, description: input.grouped ? undefined : "Vincule o vendedor a um grupo antes de convidar." }]
      : input.state === "PENDING"
        ? [
            { label: "Copiar link", onClick: input.onCopy },
            { label: "Reenviar convite", onClick: input.onResend },
            { label: "Cancelar convite", onClick: input.onRevoke, danger: true },
          ]
        : input.state === "ACTIVE"
          ? [{ label: "Suspender acesso", onClick: input.onSuspend }, exclude]
          : [{ label: "Reativar acesso", onClick: input.onReactivate }, exclude];
  return [edit, { label: "", divider: true }, ...access];
}

function RowMenu({ items }: { items: DropdownItem[] }) {
  return (
    <Dropdown
      align="right"
      portal
      items={items}
      trigger={
        <button type="button" aria-label="Ações" className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-t1 hover:bg-bg-3">
          <Icon d={icons.dots} size={16} />
        </button>
      }
    />
  );
}

type SellerDraft = { shiftId: string | null; sales: boolean; branchUser: boolean };

function SellerEditor({
  seller,
  store,
  shifts,
  pendingShift,
  onClose,
  onCreateGroup,
  onSave,
}: {
  seller: StoreSeller | null;
  store: Store;
  shifts: StoreShift[];
  pendingShift: { sellerId: string; shiftId: string } | null;
  onClose: () => void;
  onCreateGroup: () => void;
  onSave: (seller: StoreSeller, draft: SellerDraft) => Promise<boolean>;
}) {
  const sales = seller ? isBranchSalesPerson(seller, store) : false;
  const [shiftId, setShiftId] = useState<string | null>(seller?.shiftId ?? null);
  const [branchUser, setBranchUserOn] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setShiftId(seller?.shiftId ?? null);
    setBranchUserOn(seller ? isResolvedBranchUser(seller, store) : false);
    setSaving(false);
  }, [seller, store]);

  useEffect(() => {
    if (seller && pendingShift?.sellerId === seller.id) setShiftId(pendingShift.shiftId);
  }, [pendingShift, seller]);

  async function save() {
    if (!seller) return;
    setSaving(true);
    const ok = await onSave(seller, { shiftId, sales, branchUser });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal
      open={seller != null}
      onClose={() => !saving && onClose()}
      title={seller ? `Editar ${seller.name}` : ""}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      {seller && (
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-t2">O grupo e o usuário da filial são salvos na WDash. A atualização do Millennium não altera esses dados.</p>
          <FormField label="Usuário da filial" hint="A venda deste usuário fica fora do ranking e não entra no rateio. Só uma pessoa por filial.">
            <Switch checked={branchUser} onChange={setBranchUserOn} />
          </FormField>
          {sales && (
            <FormField label="Grupo">
              <select className="h-[42px] w-full rounded-[var(--radius-vela-md)] border border-line bg-bg-inset px-3.5 text-[13px] text-t0 outline-none focus:border-acc" value={shiftId ?? ""} onChange={(event) => setShiftId(event.target.value || null)}>
                <option value="">Sem grupo</option>
                {shifts.map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shiftName(shift.name)}
                  </option>
                ))}
              </select>
              <button type="button" className="mt-2 text-[12.5px] font-semibold text-acc" onClick={onCreateGroup}>
                + Criar grupo
              </button>
            </FormField>
          )}
        </div>
      )}
    </Modal>
  );
}

function accessLabel(state: AccessState): string {
  return ACCESS_LABEL[state];
}

function groupLabel(shiftId: string | null | undefined, shifts: StoreShift[]): string {
  const shift = shifts.find((s) => s.id === shiftId);
  return shift ? shiftName(shift.name) : "Sem grupo";
}

function sellerColumns(store: Store): DataTableColumn<StoreSeller>[] {
  return [
  {
    key: "seller",
    header: "Nome",
    sortable: true,
    sortValue: (v) => v.name,
    render: (v) => (
      <div className="flex min-w-0 items-center gap-3">
        <PersonAvatar name={v.name} employeeId={v.code} />
        <span className="truncate text-[13.5px] font-bold text-t0">{v.name}</span>
      </div>
    ),
  },
  {
    key: "role",
    header: "Cargo",
    sortable: true,
    sortValue: (v) => teamRoleLabel(v, store),
    render: (v) => <span className="text-t1">{teamRoleLabel(v, store)}</span>,
  },
  {
    key: "code",
    header: "Código no Millennium",
    sortable: true,
    sortValue: (v) => v.code?.trim() || null,
    render: (v) => <span className="tabular-nums text-t1">{v.code || "—"}</span>,
  },
  {
    key: "status",
    header: "Status",
    sortable: true,
    sortValue: (v) => (v.active ? "Ativo" : "Desligado"),
    render: (v) => {
      const label = v.active ? "Ativo" : "Desligado";
      return <Badge variant={statusBadgeVariant(label)}>{label}</Badge>;
    },
  },
  ];
}

export default StaffPage;
