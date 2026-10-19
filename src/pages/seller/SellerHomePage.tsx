import { useCallback, useEffect, useRef, useState } from "react";
import { Button, PageHeader } from "@/components/ui";
import { SellerHomeSkeleton } from "@/components/wedash/LoadingSkeletons";
import { addMonths, startOfMonth } from "@/data/wedash/engine/format";
import { fetchSellerHome } from "@/data/wedash/sellerHomeRepo";
import type { SellerHomePayload } from "@/data/wedash/engine/sellerHome";
import { shortDate, titleName } from "@/lib/format";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { MonthStep, MonthYearPicker, monthNavBtn } from "@/pages/cash-close/MonthYearPicker";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useSession } from "@/session/SessionProvider";
import { NumbersCard } from "./NumbersCard";
import { PerformanceCard } from "./PerformanceCard";

/** Tela Inicio do vendedor: premiacao, numeros e ranking, sem controles de gestor. */
export function SellerHomePage() {
  const { session } = useSession();
  const [month, setMonth] = useState<string | null>(null);
  const [home, setHome] = useState<SellerHomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const showSkeleton = useMinSkeleton(loading && !home);
  const request = useRef(0);

  const load = useCallback((target: string | null) => {
    const id = ++request.current;
    setFailed(false);
    void fetchSellerHome(target).then((data) => {
      if (id !== request.current) return;
      if (data && target && data.month !== startOfMonth(target)) setMonth(data.month);
      setHome((prev) => data ?? prev);
      setFailed(data == null);
      setLoading(false);
      setRetrying(false);
    });
  }, []);

  const retry = useCallback(() => {
    setRetrying(true);
    load(month);
  }, [load, month]);

  useEffect(() => {
    load(month);
  }, [load, month]);

  useEffect(() => {
    const onSynced = () => load(month);
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [load, month]);

  const firstName = titleName(session?.name).split(" ")[0]?.trim() ?? "";
  const selected = month ?? home?.month ?? null;
  const current = home != null && home.month === startOfMonth(home.today);
  const monthFailed = failed && home != null && selected != null && selected !== home.month;
  const pending = home != null && selected != null && selected !== home.month && !failed;
  const period = home
    ? current
      ? `Este mês · ${shortDate(home.numbersPeriod.from)} a ${shortDate(home.numbersPeriod.to)}`
      : `${shortDate(home.numbersPeriod.from)} a ${shortDate(home.numbersPeriod.to)}`
    : undefined;
  const canPrev = home != null && selected != null && selected > home.historyFrom;
  const canNext = home != null && selected != null && !current;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={firstName ? `Bem-vindo(a) de volta, ${firstName} 👋` : "Bem-vindo(a) de volta 👋"}
        subtitle={period}
        actions={
          home && selected ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={monthNavBtn}
                aria-label="Mês anterior"
                disabled={!canPrev}
                onClick={() => setMonth(addMonths(selected, -1))}
              >
                <MonthStep dir="anterior" />
              </button>
              <MonthYearPicker
                iso={selected}
                today={home.today}
                minIso={home.historyFrom}
                onChange={(iso) => setMonth(startOfMonth(iso))}
              />
              <button
                type="button"
                className={monthNavBtn}
                aria-label="Próximo mês"
                disabled={!canNext}
                onClick={() => setMonth(addMonths(selected, 1))}
              >
                <MonthStep dir="proximo" />
              </button>
            </div>
          ) : undefined
        }
      />
      {showSkeleton || pending ? (
        <SellerHomeSkeleton stores={session?.stores.length ?? 1} />
      ) : !home ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-[15px] font-bold text-t0">Não foi possível carregar seus dados</p>
          <p className="text-[13.5px] text-t1">Tente novamente.</p>
          <Button type="button" onClick={retry} disabled={retrying}>
            {retrying ? "Tentando…" : "Tentar novamente"}
          </Button>
        </div>
      ) : monthFailed ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-[15px] font-bold text-t0">Não foi possível carregar este mês</p>
          <p className="text-[13.5px] text-t1">Tente novamente.</p>
          <Button type="button" onClick={retry} disabled={retrying}>
            {retrying ? "Tentando…" : "Tentar novamente"}
          </Button>
        </div>
      ) : (
        <>
          <NumbersCard days={home.myDays} period={home.numbersPeriod} today={home.today} currentMonth={current} />
          {home.stores.map((s) => (
            <PerformanceCard key={s.storeId} store={s} today={home.today} through={home.numbersPeriod.to} closed={!current} />
          ))}
        </>
      )}
    </div>
  );
}

export default SellerHomePage;
