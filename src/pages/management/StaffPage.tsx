import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, DataTable, Dropdown, EmptyState, FormField, Modal, Segmented, Skeleton, useToast, type DataTableColumn, type DropdownItem } from "@/components/ui";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { SegmentedSkeleton, StoreCardsSkeleton, TeamTableSkeleton } from "@/components/wedash/LoadingSkeletons";
import {
  fetchLatestSellerSyncedAt,
  fetchStoreSellers,
  fetchStoreShifts,
  isBranchSalesPerson,
  isBranchTeamMember,
  teamRoleLabel,
  saveStoreShift,
  setSellerShift,
  syncStoreSellersNow,
  type Store,
  type StoreSeller,
  type StoreShift,
} from "@/data/wedash/stores";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { refreshMomentTitle, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { shiftName } from "@/lib/format";
import { matchesCodeOrName } from "@/lib/personSearch";
import { InviteSellerModal } from "@/pages/management/InviteSellerModal";
import { GroupFormModal, ManageGroupsModal, groupProblem, nextGroupWindow } from "@/pages/management/SellerGroups";
import { isOwner } from "@/layout/nav-wedash";
import { CostCardTitle, SAVE_ERROR_MSG, SectionHeader, useScopedStores } from "@/pages/operation/shared";
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
    tip: storeRows.length > 1 ? "Busca no Millennium a equipe das filiais desta tela." : "Busca no Millennium a equipe desta filial.",
    status: refreshMomentTitle(sellerSyncAt),
    busyLabel: "Buscando equipe…",
    run: refreshTeam,
  });

  const storeKey = storeRows.map((store) => store.id).join(",");
  const manage = isOwner(session.role);

  return (
    <>
      <SectionHeader
        section="Equipe"
        title="Equipe"
        subtitle={
          manage
            ? storeRows.length > 1
              ? "Acompanhe a equipe das filiais e gerencie cadastros, grupos e acessos."
              : "Acompanhe a equipe da filial e gerencie cadastros, grupos e acessos."
            : storeRows.length > 1
              ? "Consulte a equipe das filiais."
              : "Consulte a equipe da filial."
        }
        actions={
          manage && singleStore ? (
            <Button type="button" onClick={() => setManageOpen(true)}>
              Gerenciar grupos
            </Button>
          ) : undefined
        }
      />
      <div className="mt-6">
        {loading ? (
          <StoreCardsSkeleton count={1} title team wide />
        ) : storeRows.length === 0 ? (
          <Card className="flex min-h-[280px] flex-col">
            <EmptyBlock icon="🏬" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : (
          <StaffList key={storeKey} tenantId={session.tenantId} stores={storeRows} reloadKey={reloadKey} groupsTick={groupsTick} manage={manage} />
        )}
      </div>
      {manage && singleStore && (
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

type StaffPerson = { seller: StoreSeller; store: Store };

function storeLabel(store: Store): string {
  return store.tradeName || store.name;
}

function StaffList({
  tenantId,
  stores,
  reloadKey,
  groupsTick,
  manage,
}: {
  tenantId: string;
  stores: Store[];
  reloadKey: number;
  groupsTick: number;
  manage: boolean;
}) {
  const showStore = stores.length > 1;
  const { show } = useToast();
  const [team, setTeam] = useState<StaffPerson[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const [shifts, setShifts] = useState<Map<string, StoreShift[]>>(() => new Map());
  const storesRef = useRef(stores);
  storesRef.current = stores;
  const storeKey = stores.map((store) => store.id).join(",");
  const [shiftOf, setShiftOf] = useState<Record<string, string | null>>({});
  const [tab, setTab] = useState<"ativos" | "desligados">("ativos");
  const [search, setSearch] = useState("");
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [access, setAccess] = useState<Map<string, AccessState> | null>(null);
  const [inviting, setInviting] = useState<StaffPerson | null>(null);
  const [editing, setEditing] = useState<StaffPerson | null>(null);
  const [pendingShift, setPendingShift] = useState<{ sellerId: string; shiftId: string } | null>(null);
  const [removing, setRemoving] = useState<StaffPerson | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);
  const [creating, setCreating] = useState<{ sellerId: string; storeId: string; start: string; end: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const list = storesRef.current;
    void fetchStoreSellers(tenantId, list.map((store) => store.id))
      .then((map) => {
        if (cancelled) return;
        const people: StaffPerson[] = [];
        for (const store of list) {
          for (const seller of map.get(store.id) ?? []) people.push({ seller, store });
        }
        setTeam(people);
        setShiftOf({});
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, storeKey, tick, reloadKey, groupsTick]);

  useEffect(() => {
    let cancelled = false;
    setAccess(null);
    const list = storesRef.current;
    void Promise.all(list.map((store) => fetchSellerAccess(store.id))).then((results: (SellerAccessRow[] | null)[]) => {
      if (cancelled) return;
      const next = new Map<string, AccessState>();
      for (const rows of results) {
        for (const row of rows ?? []) next.set(row.storeSellerId, row.state);
      }
      setAccess(next);
    });
    return () => {
      cancelled = true;
    };
  }, [storeKey, tick, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    const list = storesRef.current;
    void Promise.all(list.map(async (store) => [store.id, await fetchStoreShifts(tenantId, store.id)] as const)).then((pairs) => {
      if (!cancelled) setShifts(new Map(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId, storeKey, groupsTick]);

  const salesPerson = (person: StaffPerson) => isBranchSalesPerson(person.seller, person.store);
  const ativos = useMemo(() => team.filter((person) => isBranchTeamMember(person.seller, person.store)), [team]);
  const desligados = useMemo(() => team.filter((person) => !person.seller.active), [team]);
  const rows = tab === "ativos" ? ativos : desligados;
  const shown = useMemo(() => {
    const list = rows.filter((person) => matchesCodeOrName(person.seller.name, person.seller.code, search));
    return [...list].sort(
      (a, b) => a.seller.name.localeCompare(b.seller.name, "pt-BR") || storeLabel(a.store).localeCompare(storeLabel(b.store), "pt-BR"),
    );
  }, [rows, search]);

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
    const storeId = creating.storeId;
    const sellerId = creating.sellerId;
    const storeShifts = shifts.get(storeId) ?? [];
    const problem = groupProblem(draft.name, draft.start, draft.end, storeShifts);
    if (problem) {
      show(problem, "danger");
      return false;
    }
    const saved = await saveStoreShift({ tenantId, storeId, shift: draft });
    if (!saved.ok) {
      show(SAVE_ERROR_MSG, "danger");
      return false;
    }
    const fresh = await fetchStoreShifts(tenantId, storeId);
    setShifts((current) => new Map(current).set(storeId, fresh));
    const assigned = await changeShift(sellerId, saved.id);
    if (!assigned) return false;
    setPendingShift({ sellerId, shiftId: saved.id });
    setTeam((list) => list.map((person) => (person.seller.id === sellerId ? { ...person, seller: { ...person.seller, shiftId: saved.id } } : person)));
    show("Grupo criado.", "success");
    return true;
  }

  function noteInvited(sellerId: string, email: string) {
    setAccess((current) => {
      const next = new Map(current ?? []);
      next.set(sellerId, "PENDING");
      return next;
    });
    setTeam((list) =>
      list.map((person) => (person.seller.id === sellerId ? { ...person, seller: { ...person.seller, email } } : person)),
    );
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
      setTeam((list) => list.map((person) => (person.seller.id === seller.id ? { ...person, seller: { ...person.seller, shiftId: draft.shiftId } } : person)));
    }
    show("Cadastro salvo.", "success");
    return true;
  }

  const identity = useMemo(() => personColumns(showStore), [showStore]);

  const columns = useMemo<DataTableColumn<StaffPerson>[]>(
    () => [
      ...identity,
      {
        key: "access",
        header: "Acesso",
        sortable: true,
        sortValue: (v) => (access == null || !salesPerson(v) ? null : accessLabel(access.get(v.seller.id) ?? "NONE")),
        render: (v) => {
          if (!salesPerson(v)) return <span className="text-t2">—</span>;
          return <AccessBadge state={access == null ? "loading" : (access.get(v.seller.id) ?? "NONE")} />;
        },
      },
      {
        key: "shift",
        header: "Grupo",
        sortable: true,
        sortValue: (v) => (salesPerson(v) ? groupLabel(v.seller.id in shiftOf ? shiftOf[v.seller.id] : v.seller.shiftId, shifts.get(v.store.id) ?? []) : null),
        render: (v) => {
          if (!salesPerson(v)) return <span className="text-[12.5px] font-semibold text-t2">—</span>;
          const current = v.seller.id in shiftOf ? shiftOf[v.seller.id] : v.seller.shiftId;
          const shift = (shifts.get(v.store.id) ?? []).find((item) => item.id === current);
          if (!shift) return <p className="text-[12.5px] font-semibold text-t2">Sem grupo</p>;
          return (
            <>
              <p className="text-[12.5px] font-semibold text-t1">{shiftName(shift.name)}</p>
              <p className="text-[11px] text-t2">
                {shift.start} – {shift.end}
              </p>
            </>
          );
        },
      },
      ...(manage
        ? [
      {
        key: "actions",
        header: "",
        align: "right" as const,
        render: (v: StaffPerson) => {
          const current = v.seller.id in shiftOf ? shiftOf[v.seller.id] : v.seller.shiftId;
          const items = rowActions({
            sales: salesPerson(v),
            state: salesPerson(v) ? (access == null ? null : (access.get(v.seller.id) ?? "NONE")) : null,
            grouped: hasSalesGroup(current),
            onEdit: () => setEditing({ seller: { ...v.seller, shiftId: current ?? null }, store: v.store }),
            onInvite: () => setInviting(v),
            onCopy: () => void copyLink(v.seller.id),
            onResend: () => void runAccess(v.seller.id, resendSellerInvite, "Convite reenviado."),
            onRevoke: () => void runAccess(v.seller.id, revokeSellerInvite, "Convite cancelado."),
            onSuspend: () => void runAccess(v.seller.id, suspendSeller, "Acesso suspenso."),
            onReactivate: () => void runAccess(v.seller.id, reactivateSeller, "Acesso reativado."),
            onRemove: () => setRemoving(v),
          });
          if (items.length === 0) return null;
          return <RowMenu items={items} />;
        },
      },
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identity, shifts, shiftOf, savingIds, access, manage],
  );

  const withoutTeam = loaded && team.length === 0;

  return (
    <Card className="min-w-0 overflow-hidden" padding="none">
      <div className="px-5 pt-5">
        <CostCardTitle title={showStore ? "Equipe" : "Equipe da filial"} />
      </div>
      {!loaded ? (
        <div className="px-5 pb-4">
          <SegmentedSkeleton widths={["w-24", "w-32"]} />
        </div>
      ) : !withoutTeam && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4">
          <Segmented
            options={[
              { value: "ativos", label: `Ativos (${ativos.length})` },
              { value: "desligados", label: `Desligados (${desligados.length})` },
            ]}
            value={tab}
            onChange={(v) => v && setTab(v)}
          />
          <input
            type="search"
            placeholder="Buscar por código ou nome…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-[var(--radius-vela-sm)] border border-line bg-bg-inset px-3 text-xs font-semibold text-t0 transition-colors hover:border-acc focus:border-acc focus:outline-none print:hidden sm:w-56"
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
              ? showStore
                ? "Use Atualizar equipe no topo para buscar a equipe das filiais no Millennium."
                : "Use Atualizar equipe no topo para buscar a equipe desta filial no Millennium."
              : tab === "ativos"
                ? showStore
                  ? "Não há vendedores, operadores de caixa ou usuários da filial ativos nas filiais no momento."
                  : "Não há vendedores, operadores de caixa ou usuários da filial ativos nesta filial no momento."
                : "Pessoas desligadas no Millennium aparecem aqui."
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          framed={false}
          className="pt-4!"
          icon="🔍"
          title="Nenhuma pessoa encontrada"
          description="Tente outro código ou nome."
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => setSearch("")}>
              Limpar busca
            </Button>
          }
        />
      ) : (
        <div className="px-5 pb-5">
          <DataTable
            compact
            columns={tab === "ativos" ? columns : [...identity, columns[columns.length - 1]!]}
            data={shown}
            rowKey={(v) => v.seller.id}
            paginate="pessoas"
            defaultSortKey={showStore ? "store" : undefined}
            defaultSortDir="asc"
          />
        </div>
      )}
      <Modal
        open={removing != null}
        onClose={() => !removingBusy && setRemoving(null)}
        title="Excluir acesso?"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setRemoving(null)} disabled={removingBusy}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={removingBusy}
              onClick={() => {
                if (!removing) return;
                setRemovingBusy(true);
                void removeSellerAccess(removing.seller.id).then((r) => {
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
            <span className="font-bold text-t0">{removing.seller.name}</span> não poderá mais acessar {showStore ? storeLabel(removing.store) : "esta filial"} na WDash. Você poderá convidar essa pessoa novamente depois.
          </p>
        )}
      </Modal>
      <SellerEditor
        seller={editing?.seller ?? null}
        store={editing?.store ?? stores[0]!}
        shifts={editing ? (shifts.get(editing.store.id) ?? []) : []}
        pendingShift={pendingShift}
        onClose={() => setEditing(null)}
        onCreateGroup={() => {
          if (!editing) return;
          setCreating({ sellerId: editing.seller.id, storeId: editing.store.id, ...nextGroupWindow(shifts.get(editing.store.id) ?? []) });
        }}
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
        seller={inviting ? { id: inviting.seller.id, name: inviting.seller.name, email: inviting.seller.email } : null}
        onClose={() => setInviting(null)}
        onInvited={noteInvited}
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
  if (!input.sales) return [];
  const edit: DropdownItem = { label: "Editar cadastro", onClick: input.onEdit };
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

type SellerDraft = { shiftId: string | null; sales: boolean };

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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setShiftId(seller?.shiftId ?? null);
    setSaving(false);
  }, [seller]);

  useEffect(() => {
    if (seller && pendingShift?.sellerId === seller.id) setShiftId(pendingShift.shiftId);
  }, [pendingShift, seller]);

  async function save() {
    if (!seller) return;
    setSaving(true);
    const ok = await onSave(seller, { shiftId, sales });
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
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
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
          <p className="text-[12.5px] text-t2">O grupo é salvo na WDash. A atualização do Millennium não altera esse dado.</p>
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

function personColumns(showStore: boolean): DataTableColumn<StaffPerson>[] {
  const columns: DataTableColumn<StaffPerson>[] = [
    {
      key: "seller",
      header: "Nome",
      sortable: true,
      sortValue: (v) => v.seller.name,
      render: (v) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <PersonAvatar name={v.seller.name} employeeId={v.seller.code} storeId={v.store.id} size="sm" />
          <p className="min-w-0 truncate text-[13px] font-bold text-t0">{v.seller.name}</p>
        </div>
      ),
    },
  ];
  if (showStore) {
    columns.push({
      key: "store",
      header: "Filial",
      sortable: true,
      sortValue: (v) => storeLabel(v.store),
      render: (v) => <span className="text-[13px] text-t1">{storeLabel(v.store)}</span>,
    });
  }
  columns.push(
    {
      key: "role",
      header: "Cargo",
      sortable: true,
      sortValue: (v) => teamRoleLabel(v.seller, v.store),
      render: (v) => <span className="text-[13px] text-t1">{teamRoleLabel(v.seller, v.store)}</span>,
    },
    {
      key: "code",
      header: "Código no Millennium",
      sortable: true,
      sortValue: (v) => v.seller.code?.trim() || null,
      render: (v) => <span className="font-mono text-[13px] font-bold text-t0">{v.seller.code || "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (v) => (v.seller.active ? "Ativo" : "Desligado"),
      render: (v) => {
        const label = v.seller.active ? "Ativo" : "Desligado";
        return <Badge variant={statusBadgeVariant(label)}>{label}</Badge>;
      },
    },
  );
  return columns;
}

export default StaffPage;
