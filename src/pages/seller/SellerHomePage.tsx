import { useCallback, useEffect, useState } from "react";
import { Button, PageHeader } from "@/components/ui";
import { SellerHomeSkeleton } from "@/components/wedash/LoadingSkeletons";
import { fetchSellerHome } from "@/data/wedash/sellerHomeRepo";
import type { SellerHomePayload } from "@/data/wedash/engine/sellerHome";
import { dataCurta, titleName } from "@/lib/format";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useSession } from "@/session/SessionProvider";
import { NumbersCard } from "./NumbersCard";
import { PerformanceCard } from "./PerformanceCard";

/** Tela Inicio do vendedor: premiacao, numeros e ranking, sem controles de gestor. */
export function SellerHomePage() {
  const { session } = useSession();
  const [home, setHome] = useState<SellerHomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const showSkeleton = useMinSkeleton(loading);

  const load = useCallback(() => {
    setFailed(false);
    void fetchSellerHome().then((data) => {
      setHome(data);
      setFailed(data == null);
      setLoading(false);
      setRetrying(false);
    });
  }, []);

  const retry = useCallback(() => {
    setRetrying(true);
    void fetchSellerHome().then((data) => {
      setHome(data);
      setFailed(data == null);
      setLoading(false);
      setRetrying(false);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onSynced = () => load();
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [load]);

  const firstName = titleName(session?.name).split(" ")[0]?.trim() ?? "";
  const periodo = home
    ? `Este mês · ${dataCurta(home.numbersPeriod.from)} a ${dataCurta(home.numbersPeriod.to)}`
    : undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={firstName ? `Bem-vindo(a) de volta, ${firstName} 👋` : "Bem-vindo(a) de volta 👋"} subtitle={periodo} />
      {showSkeleton ? (
        <SellerHomeSkeleton stores={session?.stores.length ?? 1} />
      ) : failed || !home ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-[15px] font-bold text-t0">Não foi possível carregar seus dados</p>
          <p className="text-[13.5px] text-t1">Tente novamente.</p>
          <Button type="button" onClick={retry} disabled={retrying}>
            {retrying ? "Tentando…" : "Tentar novamente"}
          </Button>
        </div>
      ) : (
        <>
          <NumbersCard days={home.myDays} period={home.numbersPeriod} today={home.today} />
          {home.stores.map((s) => (
            <PerformanceCard key={s.storeId} store={s} />
          ))}
        </>
      )}
    </div>
  );
}

export default SellerHomePage;
