import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AvatarGroup, Badge, Card } from "@/components/ui";
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
  const [lojas, setLojas] = useState<Store[]>([]);
  const [sellers, setSellers] = useState<Map<string, StoreSeller[]>>(new Map());
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const rows = await fetchManagedStores(session.tenantId, session.membershipId);
      if (!cancelled) {
        setLojas(rows);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.tenantId, session?.membershipId]);

  useEffect(() => {
    if (!session || lojas.length === 0) return;
    let cancelled = false;
    void fetchStoreSellers(session.tenantId, lojas.map((s) => s.id)).then((m) => {
      if (!cancelled) setSellers(m);
    });
    return () => {
      cancelled = true;
    };
  }, [session?.tenantId, lojas]);

  if (!session) return null;

  async function alternar(loja: Store, active: boolean) {
    if (!session || savingId) return;
    setSavingId(loja.id);
    const res = await setStoreActive(loja.id, active);
    setSavingId(null);
    if (!res.ok) {
      toast.show(res.error, "danger");
      return;
    }
    setLojas((rows) => rows.map((s) => (s.id === loja.id ? { ...s, active } : s)));
    const ativas = active ? [...session.stores, loja.id] : session.stores.filter((id) => id !== loja.id);
    update({ stores: [...new Set(ativas)] });
    if (active) void hydrateSessionStores(session.tenantId, [...new Set(ativas)]);
    if (!active) {
      try {
        if (sessionStorage.getItem(STORE_STORAGE_KEY) === loja.id) sessionStorage.setItem(STORE_STORAGE_KEY, "");
      } catch {
        /* ignore */
      }
      if (params.get("filial") === loja.id) {
        const next = new URLSearchParams(params);
        next.delete("filial");
        setParams(next, { replace: true });
      }
    }
    toast.show(active ? "Loja ativada." : "Loja desativada.", "success");
  }

  if (showSkeleton) {
    return <CardGridSkeleton count={Math.max(1, lojas.length || session.stores.length)} />;
  }

  if (lojas.length === 0) {
    return <span className="block py-6 text-center text-[12px] text-t2">Nenhuma loja no seu escopo.</span>;
  }

  const podeAlternar = session.role === "OWNER" || session.role === "MANAGER" || session.role === "ADMIN_GLOBAL";

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {lojas.map((s) => {
        const equipe = (sellers.get(s.id) ?? []).filter(isActiveSalesPerson);
        const desativada = s.active === false;
        const abrir = () => navigate(paths.settings.storeDetail(s.id));
        return (
          <Card
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={abrir}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                abrir();
              }
            }}
            className="cursor-pointer transition-colors hover:border-acc"
          >
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[13px] bg-acc-soft text-acc">
                <StoreIcon size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold text-t0">{s.fantasia}</p>
                <p className="mt-0.5 truncate text-xs text-t2">{s.cnpj || "—"}</p>
              </div>
              <span className="flex shrink-0 flex-col items-end gap-1 self-start">
                <Badge variant="accent">Filial {s.codFilial}</Badge>
                {desativada ? <Badge variant="neutral">Desativada</Badge> : null}
              </span>
            </div>
            <div className="flex min-h-8 items-center justify-between gap-3">
              {equipe.length > 0 ? (
                <AvatarGroup names={equipe.map((v) => v.name)} max={4} />
              ) : (
                <span className="text-xs text-t2">Ninguém ativo na equipe</span>
              )}
              <span className="shrink-0 text-xs font-semibold text-t2">{equipe.length} na equipe</span>
            </div>
            {podeAlternar ? (
              <div
                className="mt-3 flex justify-end border-t border-line pt-3"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <Switch checked={!desativada} onChange={(v) => void alternar(s, v)} label="Em operação" />
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}

export default StoresSettingsPage;
