import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Badge, Button, Card, DataTable, Dropdown, EmptyState, Modal, Segmented, Select, Skeleton, Tooltip, useToast, type DataTableColumn, type DropdownItem } from "@/components/ui";
import { SegmentedSkeleton, StoreCardsSkeleton, TeamTableSkeleton } from "@/components/wedash/LoadingSkeletons";
import {
  fetchLatestSellerSyncedAt,
  fetchStoreSellers,
  fetchStoreShifts,
  isActiveSalesPerson,
  setSellerShift,
  syncStoreSellersNow,
  type Store,
  type StoreSeller,
  type StoreShift,
} from "@/data/wedash/stores";
import { shiftName } from "@/lib/format";
import { refreshStatusLine, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { InviteSellerModal } from "@/pages/management/InviteSellerModal";
import { StoreCardHeader, StoreCardsPage, useScopedStores } from "@/pages/operation/shared";
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

/** Configurações > Vendedores. Equipe de cada loja (Millennium) e o grupo de cada pessoa. */
export function StaffPage() {
  const { session, lojas, loading } = useScopedStores();
  const { show } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const syncing = useRef(false);

  const lojasRef = useRef(lojas);
  lojasRef.current = lojas;
  const [sellerSyncAt, setSellerSyncAt] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (loading) return;
    let stop = false;
    const ids = lojas.map((loja) => loja.id);
    void fetchLatestSellerSyncedAt(session.tenantId, ids).then((at) => {
      if (!stop) setSellerSyncAt(at);
    });
    return () => {
      stop = true;
    };
  }, [loading, lojas, reloadKey, session.tenantId]);

  useScreenRefresh({
    label: "Atualizar os vendedores",
    tip: "Busca no Millennium os vendedores das lojas desta tela.",
    status:
      sellerSyncAt === undefined
        ? undefined
        : refreshStatusLine("Vendedores atualizados", "Vendedores ainda não atualizados", sellerSyncAt),
    run: async () => {
      const lista = lojasRef.current;
      if (syncing.current || lista.length === 0) return;
      syncing.current = true;
      try {
        const results = await Promise.all(lista.map((loja) => syncStoreSellersNow(loja.id)));
        const fail = results.find((r) => !r.ok);
        if (fail && !fail.ok) show(fail.message, "danger");
        else show("Vendedores atualizados.", "success");
        if (results.some((r) => r.ok)) setReloadKey((n) => n + 1);
      } finally {
        syncing.current = false;
      }
    },
  });

  return (
    <StoreCardsPage
      section="Operação"
      title="Vendedores"
      subtitle="Acompanhe os vendedores de cada loja e defina seus grupos."
      loading={loading}
      skeleton={(n) => <StoreCardsSkeleton count={n} team wide />}
      lojas={lojas}
      wide
      oneStore
    >
      {(loja) => <StaffCard tenantId={session.tenantId} loja={loja} reloadKey={reloadKey} />}
    </StoreCardsPage>
  );
}

function StaffCard({ tenantId, loja, reloadKey }: { tenantId: string; loja: Store; reloadKey: number }) {
  const { show } = useToast();
  const [equipe, setEquipe] = useState<StoreSeller[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const [shifts, setShifts] = useState<StoreShift[]>([]);
  const [shiftOf, setShiftOf] = useState<Record<string, string | null>>({});
  const [tab, setTab] = useState<"ativos" | "desligados">("ativos");
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [access, setAccess] = useState<Map<string, AccessState> | null>(null);
  const [inviting, setInviting] = useState<StoreSeller | null>(null);
  const [removing, setRemoving] = useState<StoreSeller | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchStoreSellers(tenantId, [loja.id])
      .then((m) => {
        if (!cancelled) {
          setEquipe(m.get(loja.id) ?? []);
          setShiftOf({});
        }
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, loja.id, tick, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    setAccess(null);
    void fetchSellerAccess(loja.id).then((rows: SellerAccessRow[] | null) => {
      if (cancelled) return;
      setAccess(new Map((rows ?? []).map((r) => [r.storeSellerId, r.state])));
    });
    return () => {
      cancelled = true;
    };
  }, [loja.id, tick, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    void fetchStoreShifts(tenantId, loja.id).then((list) => {
      if (!cancelled) setShifts(list);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId, loja.id]);

  const ativos = useMemo(() => equipe.filter(isActiveSalesPerson), [equipe]);
  const desligados = useMemo(() => equipe.filter((s) => !s.active), [equipe]);
  const rows = tab === "ativos" ? ativos : desligados;

  async function changeShift(sellerId: string, shiftId: string | null) {
    const antes = shiftOf[sellerId];
    setShiftOf((m) => ({ ...m, [sellerId]: shiftId }));
    setSavingIds((s) => new Set(s).add(sellerId));
    const r = await setSellerShift(sellerId, shiftId);
    setSavingIds((s) => {
      const next = new Set(s);
      next.delete(sellerId);
      return next;
    });
    if (r.ok) return;
    setShiftOf((m) => {
      const next = { ...m };
      if (antes === undefined) delete next[sellerId];
      else next[sellerId] = antes;
      return next;
    });
    show("Não foi possível alterar o grupo. Tente novamente.", "danger");
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

  const columns = useMemo<DataTableColumn<StoreSeller>[]>(
    () => [
      ...SELLER_COLUMNS,
      {
        key: "access",
        header: "Acesso",
        render: (v) => {
          const grupo = v.id in shiftOf ? shiftOf[v.id] : v.shiftId;
          return (
            <AccessCell
              state={access == null ? "loading" : (access.get(v.id) ?? "NONE")}
              grouped={hasSalesGroup(grupo) && !savingIds.has(v.id)}
              onInvite={() => setInviting(v)}
            />
          );
        },
      },
      {
        key: "shift",
        header: "Grupo",
        render: (v) => {
          const atual = v.id in shiftOf ? shiftOf[v.id] : v.shiftId;
          return (
            <Select
              className="h-9! min-w-[150px]"
              value={atual ?? ""}
              disabled={shifts.length === 0 || savingIds.has(v.id)}
              onChange={(e) => void changeShift(v.id, e.target.value || null)}
              aria-label={`Grupo de ${v.name}`}
            >
              <option value="">{shifts.length === 0 ? "Cadastre um grupo" : "Sem grupo"}</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {shiftName(s.name)} · {s.start}–{s.end}
                </option>
              ))}
            </Select>
          );
        },
      },
      {
        key: "actions",
        header: "",
        align: "right",
        render: (v) => (
          <AccessMenu
            state={access?.get(v.id) ?? null}
            onCopy={() => void copyLink(v.id)}
            onResend={() => void runAccess(v.id, resendSellerInvite, "Convite reenviado.")}
            onRevoke={() => void runAccess(v.id, revokeSellerInvite, "Convite cancelado.")}
            onSuspend={() => void runAccess(v.id, suspendSeller, "Acesso suspenso.")}
            onReactivate={() => void runAccess(v.id, reactivateSeller, "Acesso reativado.")}
            onRemove={() => setRemoving(v)}
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shifts, shiftOf, savingIds, access],
  );

  const semEquipe = loaded && equipe.length === 0;

  return (
    <Card padding="none">
      <StoreCardHeader className="mb-0 px-5 pt-5 pb-4" loja={loja} />
      {!loaded ? (
        <div className="px-5 pb-4">
          <SegmentedSkeleton widths={["w-24", "w-32"]} />
        </div>
      ) : !semEquipe && (
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
          title={semEquipe ? "Nenhum vendedor sincronizado" : tab === "ativos" ? "Nenhum vendedor ativo" : "Nenhum vendedor desligado"}
          description={
            semEquipe
              ? "Use Atualizar no topo para buscar os vendedores desta loja no Millennium."
              : tab === "ativos"
                ? "Não há vendedores ativos nesta loja no momento."
                : "Vendedores desativados no Millennium aparecem aqui."
          }
        />
      ) : (
        <DataTable
          className="rounded-none! border-x-0! border-b-0! bg-transparent!"
          columns={tab === "ativos" ? columns : SELLER_COLUMNS}
          data={rows}
          rowKey={(v) => v.id}
          paginate="vendedores"
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
            <span className="font-bold text-t0">{removing.name}</span> deixa de entrar na WDash por esta loja. Dá para convidar de novo depois.
          </p>
        )}
      </Modal>
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

const ACCESS_BADGE: Record<AccessState, { variant: "neutral" | "warning" | "success" | "danger"; label: string }> = {
  NONE: { variant: "neutral", label: ACCESS_LABEL.NONE },
  PENDING: { variant: "warning", label: ACCESS_LABEL.PENDING },
  ACTIVE: { variant: "success", label: ACCESS_LABEL.ACTIVE },
  SUSPENDED: { variant: "danger", label: ACCESS_LABEL.SUSPENDED },
};

function AccessCell({ state, grouped, onInvite }: { state: AccessState | "loading"; grouped: boolean; onInvite: () => void }) {
  if (state === "loading") return <Skeleton className="h-8 w-24 rounded-[var(--radius-vela-sm)]" />;
  if (state === "NONE") {
    const button = (
      <Button type="button" size="sm" onClick={onInvite} disabled={!grouped}>
        Convidar
      </Button>
    );
    if (grouped) return button;
    return <Tooltip label="Vincule um grupo antes de convidar.">{button}</Tooltip>;
  }
  const b = ACCESS_BADGE[state];
  return <Badge variant={b.variant}>{b.label}</Badge>;
}

function AccessMenu({
  state,
  onCopy,
  onResend,
  onRevoke,
  onSuspend,
  onReactivate,
  onRemove,
}: {
  state: AccessState | null;
  onCopy: () => void;
  onResend: () => void;
  onRevoke: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
  onRemove: () => void;
}) {
  if (!state || state === "NONE") return null;
  const excluir: DropdownItem = { label: "Excluir acesso", onClick: onRemove, danger: true };
  const items: DropdownItem[] =
    state === "PENDING" ? [
        { label: "Copiar link", onClick: onCopy },
        { label: "Reenviar", onClick: onResend },
        { label: "Cancelar convite", onClick: onRevoke, danger: true },
      ]
    : state === "ACTIVE" ? [{ label: "Suspender", onClick: onSuspend }, excluir]
    : [{ label: "Reativar", onClick: onReactivate }, excluir];
  return (
    <Dropdown
      align="right"
      portal
      items={items}
      trigger={
        <button type="button" aria-label="Ações do acesso" className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-t1 hover:bg-bg-3">
          <Icon d={icons.dots} size={16} />
        </button>
      }
    />
  );
}

const SELLER_COLUMNS: DataTableColumn<StoreSeller>[] = [
  {
    key: "seller",
    header: "Nome",
    render: (v) => (
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={v.name} />
        <span className="truncate text-[13.5px] font-bold text-t0">{v.name}</span>
      </div>
    ),
  },
  {
    key: "code",
    header: "Código no Millennium",
    render: (v) => <span className="tabular-nums text-t1">{v.code || "—"}</span>,
  },
  {
    key: "status",
    header: "Status",
    render: (v) => (v.active ? <Badge variant="success">Ativo</Badge> : <Badge variant="neutral">Desligado</Badge>),
  },
];

export default StaffPage;
