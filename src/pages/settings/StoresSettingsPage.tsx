import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Card } from "@/components/ui";
import { PersonAvatarGroup } from "@/components/wedash/PersonAvatar";
import { Switch } from "@/components/ui/form";
import { useToast } from "@/components/ui/Toast";
import { CardGridSkeleton } from "@/components/wedash/LoadingSkeletons";
import {
  fetchManagedStores,
  fetchStoreSellers,
  hydrateSessionStores,
  isActiveSalesPerson,
  setStoreActive,
  type Store,
  type StoreSeller,
} from "@/data/wedash/stores";
import { statusBadgeVariant } from "@/lib/status";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { StoreIcon } from "@/pages/dashboards/icons";
import { paths } from "@/router/paths";
import { useSession } from "@/session/SessionProvider";

const STORE_STORAGE_KEY = "wedash.store";

/**
 * Administracao > Lojas. A desativada continua neste card e some do restante do app.
 */
export function StoresSettingsPage() {
  const { session, update } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinSkeleton(loading);
  const [storeRows, setStores] = useState<Store[]>([]);
  const [sellers, setSellers] = useState<Map<string, StoreSeller[]>>(new Map());
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const rows = await fetchManagedStores(session.tenantId, session.membershipId);
      if (!cancelled) {
        setStores(rows);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.tenantId, session?.membershipId]);

  useEffect(() => {
    if (!session || storeRows.length === 0) return;
    let cancelled = false;
    void fetchStoreSellers(session.tenantId, storeRows.map((s) => s.id)).then((m) => {
      if (!cancelled) setSellers(m);
    });
    return () => {
      cancelled = true;
    };
  }, [session?.tenantId, storeRows]);

  if (!session) return null;

  async function toggle(store: Store, active: boolean) {
    if (!session || savingId) return;
    setSavingId(store.id);
    const res = await setStoreActive(store.id, active);
    setSavingId(null);
    if (!res.ok) {
      toast.show(res.error, "danger");
      return;
    }
    setStores((rows) => rows.map((s) => (s.id === store.id ? { ...s, active } : s)));
    const ativas = active ? [...session.stores, store.id] : session.stores.filter((id) => id !== store.id);
    update({ stores: [...new Set(ativas)] });
    if (active) void hydrateSessionStores(session.tenantId, [...new Set(ativas)]);
    if (!active) {
      try {
        if (sessionStorage.getItem(STORE_STORAGE_KEY) === store.id) sessionStorage.setItem(STORE_STORAGE_KEY, "");
      } catch {
        /* ignore */
      }
      if ((params.get("store") ?? params.get("filial")) === store.id) {
        const next = new URLSearchParams(params);
        next.delete("store");
        next.delete("filial");
        setParams(next, { replace: true });
      }
    }
    toast.show(active ? "Filial ativada." : "Filial desativada.", "success");
  }

  if (showSkeleton) {
    return <CardGridSkeleton count={Math.max(1, storeRows.length || session.stores.length)} />;
  }

  if (storeRows.length === 0) {
    return <span className="block py-6 text-center text-[12px] text-t2">Nenhuma filial disponível.</span>;
  }

  const canToggle = session.role === "OWNER" || session.role === "MANAGER" || session.role === "ADMIN_GLOBAL";

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {storeRows.map((s) => {
        const team = (sellers.get(s.id) ?? []).filter(isActiveSalesPerson);
        const deactivated = s.active === false;
        const open = () => navigate(paths.settings.storeDetail(s.id));
        return (
          <Card
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={open}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
              }
            }}
            className="cursor-pointer transition-colors hover:border-acc"
          >
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[13px] bg-acc-soft text-acc">
                <StoreIcon size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold text-t0">{s.tradeName}</p>
                <p className="mt-0.5 truncate text-xs text-t2">{s.cnpj || "—"}</p>
              </div>
              <span className="flex shrink-0 flex-col items-end gap-1 self-start">
                <Badge variant="accent">Filial {s.branchCode}</Badge>
                {deactivated ? <Badge variant={statusBadgeVariant("Desativada")}>Desativada</Badge> : null}
              </span>
            </div>
            <div className="flex min-h-8 items-center justify-between gap-3">
              {team.length > 0 ? (
                <PersonAvatarGroup people={team.map((v) => ({ name: v.name, employeeId: v.code }))} max={4} />
              ) : (
                <span className="text-xs text-t2">Ninguém ativo na equipe</span>
              )}
              <span className="shrink-0 text-xs font-semibold text-t2">{team.length} na equipe</span>
            </div>
            {canToggle ? (
              <div
                className="mt-3 flex justify-end border-t border-line pt-3"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <Switch checked={!deactivated} onChange={(v) => void toggle(s, v)} label="Em operação" />
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}

export default StoresSettingsPage;
