import { useCallback, useEffect, useRef, useState } from "react";
import { Button, DateRangePicker, PageHeader, type DateRange, type DateRangeChangeMeta } from "@/components/ui";
import { SellerHomeSkeleton } from "@/components/wedash/LoadingSkeletons";
import { calendarTodayIso } from "@/data/wedash/clock";
import { resolvePeriod, type Period } from "@/data/wedash/dashboard";
import { fetchSellerHome } from "@/data/wedash/sellerHomeRepo";
import type { SellerHomePayload } from "@/data/wedash/engine/sellerHome";
import { dateToIso, isoToDate, titleName } from "@/lib/format";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { dateRangeFromPeriod, periodActivePresetId, periodDisplayLabel } from "@/pages/dashboard/periodPicker";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useSession } from "@/session/SessionProvider";
import { NumbersCard } from "./NumbersCard";
import { PerformanceCard } from "./PerformanceCard";

/** Tela Inicio do vendedor: premiacao, numeros e ranking, sem controles de gestor. */
export function SellerHomePage() {
  const { session } = useSession();
  const [period, setPeriod] = useState<Period>({ kind: "thisMonth" });
  const [home, setHome] = useState<SellerHomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const showSkeleton = useMinSkeleton(loading && !home);
  const request = useRef(0);
  const resolved = resolvePeriod(period, calendarTodayIso());

  const load = useCallback((from: string, to: string) => {
    const id = ++request.current;
    setFailed(false);
    void fetchSellerHome({ from, to }).then((data) => {
      if (id !== request.current) return;
      if (data && (data.numbersPeriod.from !== from || data.numbersPeriod.to !== to)) {
        setPeriod({ kind: "custom", start: data.numbersPeriod.from, end: data.numbersPeriod.to });
      }
      setHome((prev) => data ?? prev);
      setFailed(data == null);
      setLoading(false);
      setRetrying(false);
    });
  }, []);

  const retry = useCallback(() => {
    setRetrying(true);
    load(resolved.start, resolved.end);
  }, [load, resolved.start, resolved.end]);

  useEffect(() => {
    load(resolved.start, resolved.end);
  }, [load, resolved.start, resolved.end]);

  useEffect(() => {
    const onSynced = () => load(resolved.start, resolved.end);
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [load, resolved.start, resolved.end]);

  function onDateChange(range: DateRange, meta?: DateRangeChangeMeta) {
    if (meta?.presetId) {
      setPeriod({ kind: meta.presetId });
      return;
    }
    const start = dateToIso(range[0]);
    const end = dateToIso(range[1]);
    setPeriod({ kind: "custom", start, end: end < start ? start : end });
  }

  const firstName = titleName(session?.name).split(" ")[0]?.trim() ?? "";
  const mismatch = home != null && (home.numbersPeriod.from !== resolved.start || home.numbersPeriod.to !== resolved.end);
  const pending = mismatch && !failed;
  const closed = home != null && home.numbersPeriod.to < home.today;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={firstName ? `Bem-vindo(a) de volta, ${firstName} 👋` : "Bem-vindo(a) de volta 👋"}
        subtitle="Acompanhe seus principais indicadores, metas e resultados."
        actions={
          <DateRangePicker
            value={dateRangeFromPeriod(period)}
            onChange={onDateChange}
            displayLabel={periodDisplayLabel(period)}
            activePresetId={periodActivePresetId(period)}
            minDate={home ? isoToDate(home.historyFrom) : null}
            maxDate={home ? isoToDate(home.today) : isoToDate(calendarTodayIso())}
          />
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
      ) : mismatch ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-[15px] font-bold text-t0">Não foi possível carregar este período</p>
          <p className="text-[13.5px] text-t1">Tente novamente.</p>
          <Button type="button" onClick={retry} disabled={retrying}>
            {retrying ? "Tentando…" : "Tentar novamente"}
          </Button>
        </div>
      ) : (
        <>
          <NumbersCard days={home.myDays} period={home.numbersPeriod} today={home.today} showToday={period.kind === "thisMonth"} />
          {home.stores.map((s) => (
            <PerformanceCard key={s.storeId} store={s} today={home.today} through={home.numbersPeriod.to} closed={closed} />
          ))}
        </>
      )}
    </div>
  );
}

export default SellerHomePage;
