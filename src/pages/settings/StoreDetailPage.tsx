import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Breadcrumbs, Button, Card, CardHeader, CardTitle } from "@/components/ui";
import { StoreDetailSkeleton } from "@/components/wedash/LoadingSkeletons";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { useActiveSession } from "@/session/SessionProvider";
import { hydrateSessionStores, storesForSession, type Store } from "@/data/wedash/stores";
import { Icon, icons } from "@/pages/users/Icons";
import { StoreScheduleForm } from "@/pages/operation/StoreSchedule";
import { paths } from "@/router/paths";

/**
 * Administracao > Lojas > detalhe  -  funcionamento (fuso + horario), o mesmo formulario de Configuracoes > Loja.
 * Custos ficam em Configuracoes; turnos e equipe em Gestao.
 */
export function StoreDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const session = useActiveSession();
  const [catalogTick, setCatalogTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinSkeleton(loading);

  const store = useMemo(
    () => storesForSession(session.stores).find((s) => s.id === id) ?? null,
    [session.stores, id, catalogTick], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      if (session.stores.length > 0) {
        await hydrateSessionStores(session.tenantId, session.stores);
        if (!cancelled) setCatalogTick((n) => n + 1);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session.tenantId, session.stores]);

  const voltar = () => navigate(paths.settings.stores);

  if (showSkeleton || !store) {
    return (
      <div>
        <DetailHeader nome={store?.fantasia ?? "Loja"} onBack={voltar} />
        {showSkeleton ? (
          <StoreDetailSkeleton />
        ) : (
          <span className="block py-6 text-center text-[12px] text-t2">Loja não encontrada no seu escopo.</span>
        )}
      </div>
    );
  }

  return (
    <StoreDetailForm
      key={store.id}
      store={store}
      canEdit={session.role === "OWNER" || session.role === "MANAGER" || session.role === "ADMIN_GLOBAL"}
      onBack={voltar}
      onSaved={() => setCatalogTick((n) => n + 1)}
    />
  );
}

function DetailHeader({ nome, onBack }: { nome: string; onBack: () => void }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <Button variant="secondary" size="sm" icon={<Icon d={icons.arrowLeft} size={14} />} onClick={onBack}>
        Voltar
      </Button>
      <Breadcrumbs items={[{ label: "Lojas", to: paths.settings.stores }, { label: nome }]} />
    </div>
  );
}

function StoreDetailForm({
  store,
  canEdit,
  onBack,
  onSaved,
}: {
  store: Store;
  canEdit: boolean;
  onBack: () => void;
  onSaved: () => void;
}) {
  return (
    <div>
      <DetailHeader nome={store.fantasia} onBack={onBack} />
      <div className="flex max-w-[720px] flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Funcionamento</CardTitle>
          </CardHeader>
          <StoreScheduleForm store={store} canEdit={canEdit} onSaved={onSaved} />
        </Card>
      </div>
    </div>
  );
}

export default StoreDetailPage;
