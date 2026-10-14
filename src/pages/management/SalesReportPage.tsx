import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Badge, Button, Card, DateRangePicker, Modal, Skeleton, useToast, CALENDAR_QUICK_RANGES, type DatePresetId, type DateRangeChangeMeta } from "@/components/ui";
import { DayFace, DayMetrics, MonthCalendar, blankDayClass } from "@/components/wedash/MonthCalendar";
import { DayChip, PlainKpi } from "@/pages/cash-close/CashClosePage";
import { calendarTodayIso } from "@/data/wedash/clock";
import { periodLabels } from "@/data/wedash/dashboard";
import { fetchSalesCoverage, fetchSalesDayAggs } from "@/data/wedash/salesRepo";
import { fetchLaunchedDays, fetchShoppingAccount, requestShoppingLaunch, requestShoppingRead, type ShoppingAccount } from "@/data/wedash/shoppingRepo";
import { ALREADY_LAUNCHED, canResendDay, forceLaunchAllowed, informedGap, monthReport, reportDays, shoppingSendsSales, sumSoldByDay } from "@/data/wedash/shoppingReport";
import { brlCent, longDate, isoToDate, endOfMonth, startOfMonth, eachDay, dateToIso, addDays } from "@/lib/format";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { refreshMomentTitle, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { useScope } from "@/pages/dashboard/useScope";
import { isOwner } from "@/layout/nav-wedash";
import { paths } from "@/router/paths";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { SectionHeader, SelectStoreCard, pickOneStore, useScopedStores } from "@/pages/operation/shared";
import { HeaderFilters } from "@/pages/stock/shared";

const money = (cents: number) => brlCent(cents / 100);

function differenceAmount(cents: number): string {
  const abs = brlCent(Math.abs(cents) / 100);
  if (cents < 0) return `−${abs}`;
  if (cents > 0) return `+${abs}`;
  return abs;
}

function differenceColor(cents: number): string {
  if (cents > 0) return "var(--warn)";
  if (cents < 0) return "var(--bad)";
  return "var(--t0)";
}

function dayTitle(iso: string): string {
  const s = longDate(iso);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dayAmount(
  day: string,
  today: string,
  row: { soldCents: number; launchedCents: number | null } | undefined,
  sold: Record<string, number>,
): number | null {
  if (day > today) return null;
  if (day === today) return sold[day] != null && sold[day] > 0 ? sold[day] : null;
  if (!row || row.soldCents <= 0) return null;
  return row.soldCents;
}

function dayStatus(soldCents: number, informedCents: number | null): { text: string; color: string } {
  const gap = informedGap(soldCents, informedCents);
  if (gap === "missing" || informedCents == null) return { text: "Não informado", color: "bg-warn" };
  const text = `Informado ${money(informedCents)}`;
  if (gap === "match") return { text, color: "bg-ok" };
  if (gap === "over") return { text, color: "bg-warn" };
  return { text, color: "bg-bad" };
}

function rangeCells(from: string, to: string): Array<string | null> {
  const cells: Array<string | null> = Array.from({ length: isoToDate(from).getDay() }, () => null);
  for (let day = from; day <= to; day = addDays(day, 1)) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Gestão > Informe de vendas. Calendário do que foi informado no shopping. */
export function SalesReportPage() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { session, storeRows, loading: storesLoading } = useScopedStores();
  const { scope } = useScope();
  const escolher = pickOneStore(scope.storeIds, session.stores.length);
  const showStores = useMinSkeleton(storesLoading);
  const today = calendarTodayIso();
  const [rangeFrom, setRangeFrom] = useState(() => startOfMonth(today));
  const [rangeTo, setRangeTo] = useState(() => endOfMonth(today));
  const [presetId, setPresetId] = useState<DatePresetId | null>("thisMonth");
  const [floor, setFloor] = useState(() => startOfMonth(today));
  const [sold, setSold] = useState<Record<string, number>>({});
  const [launched, setLaunched] = useState<Record<string, number>>({});
  const [account, setAccount] = useState<ShoppingAccount | null>(null);
  const [loaded, setLoaded] = useState("");
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [lancando, setLancando] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [dayOpen, setDayOpen] = useState<string | null>(null);

  const store = storeRows[0];
  const storeRef = useRef(store);
  storeRef.current = store;
  const accountRef = useRef(account);
  accountRef.current = account;
  const launchedRef = useRef(launched);
  launchedRef.current = launched;
  const soldRef = useRef(sold);
  soldRef.current = sold;
  const from = rangeFrom;
  const to = rangeTo;
  const rangeRef = useRef({ from, to });
  rangeRef.current = { from, to };
  const markedRef = useRef(marcados);
  markedRef.current = marcados;
  const band = store ? `${store.id}|${from}|${to}|${reloadKey}` : "";
  const kiosk = store?.pointType === "SHOPPING";

  useEffect(() => {
    if (storesLoading || escolher || !store) return;
    let stop = false;
    void fetchSalesCoverage(session.tenantId, [store.id]).then((coverage) => {
      if (stop || !coverage.from) return;
      const month = startOfMonth(coverage.from);
      setFloor(month);
      setRangeFrom((current) => {
        if (current >= month) return current;
        setPresetId(null);
        return month;
      });
    });
    return () => {
      stop = true;
    };
  }, [storesLoading, escolher, store, session.tenantId, reloadKey]);

  useEffect(() => {
    if (storesLoading || escolher || !store) return;
    let cancel = false;
    setError(false);
    void Promise.all([
      fetchSalesDayAggs({ tenantId: session.tenantId, storeIds: [store.id], from, to }),
      fetchLaunchedDays(session.tenantId, store.id, from, to),
      fetchShoppingAccount(session.tenantId, store.id),
    ])
      .then(([days, launches, access]) => {
        if (cancel) return;
        setSold(sumSoldByDay(days));
        setLaunched(launches);
        setAccount(access);
        setLoaded(band);
      })
      .catch(() => {
        if (!cancel) setError(true);
      });
    return () => {
      cancel = true;
    };
  }, [storesLoading, escolher, store, session.tenantId, from, to, band]);

  const pronto = loaded === band;

  const puxar = useCallback(async () => {
    const current = storeRef.current;
    if (escolher || !current) {
      show("Escolha uma filial para atualizar o informe de vendas.", "danger");
      return;
    }
    const gate = forceLaunchAllowed({
      kiosk: current.pointType === "SHOPPING",
      administrator: accountRef.current?.administrator ?? null,
    });
    if (!gate.ok) {
      show(gate.message, "danger");
      return;
    }
    const result = await requestShoppingRead(current.id, { from, to });
    setReloadKey((n) => n + 1);
    if (!result.ok) show(result.message, "danger");
  }, [escolher, from, show, to]);

  const lancar = useCallback(async () => {
    const current = storeRef.current;
    if (lancando || escolher || !current) {
      if (escolher || !current) show("Escolha uma filial para informar as vendas ao shopping.", "danger");
      return;
    }
    const gate = forceLaunchAllowed({
      kiosk: current.pointType === "SHOPPING",
      administrator: accountRef.current?.administrator ?? null,
    });
    if (!gate.ok) {
      show(gate.message, "danger");
      return;
    }
    const days = markedRef.current.filter((day) => canResendDay(day, today, soldRef.current[day] ?? 0, launchedRef.current[day] ?? null));
    if (days.length === 0) {
      show(ALREADY_LAUNCHED, "success");
      return;
    }
    const span = rangeRef.current;
    setLancando(true);
    const result = await requestShoppingLaunch(current.id, { from: span.from, to: span.to, days: days });
    setLancando(false);
    setReloadKey((n) => n + 1);
    if (!result.ok) show(result.message, "danger");
    else {
      setMarcados([]);
      show(result.message ?? "Vendas informadas ao shopping.", "success");
    }
  }, [escolher, today, lancando, show]);

  useScreenRefresh({
    label: "Atualizar vendas e valores informados",
    tip: "Busca as vendas de hoje e lê os valores informados ao shopping.",
    status: refreshMomentTitle(pronto ? (account?.lastRunAt ?? null) : undefined),
    busyLabel: "Atualizando…",
    sales: true,
    run: () => puxar(),
  });

  useEffect(() => {
    const onSynced = () => setReloadKey((n) => n + 1);
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, []);

  const days = useMemo(() => reportDays(eachDay(from, to), sold, launched, today), [from, to, sold, launched, today]);
  const summary = useMemo(() => monthReport(days, today), [days, today]);
  const byDay = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const cells = useMemo(() => rangeCells(from, to), [from, to]);
  const owner = isOwner(session.role);
  const toLancar = marcados.filter((day) => canResendDay(day, today, sold[day] ?? 0, launched[day] ?? null));
  const toCorrigir = toLancar.filter((day) => launched[day] != null);

  function applyInterval(start: Date, end: Date, goal?: DateRangeChangeMeta) {
    const nextFrom = dateToIso(start);
    const nextTo = dateToIso(end);
    setRangeFrom(nextFrom);
    setRangeTo(nextTo);
    setPresetId(goal?.presetId ?? null);
    setMarcados((current) => current.filter((day) => day >= nextFrom && day <= nextTo));
    setDayOpen((current) => (current && current >= nextFrom && current <= nextTo ? current : null));
  }

  function toggleDay(day: string) {
    setMarcados((current) => (current.includes(day) ? current.filter((item) => item !== day) : [...current, day]));
  }

  return (
    <div>
      <SectionHeader
        section="Gestão"
        title="Informe de vendas"
        subtitle="Compare o faturamento da filial com os valores informados ao shopping."
        actions={
          <HeaderFilters>
            <div className="flex flex-wrap items-center gap-2">
              <DateRangePicker
                value={[isoToDate(from), isoToDate(to)]}
                minDate={isoToDate(floor)}
                maxDate={isoToDate(endOfMonth(today))}
                quickRanges={CALENDAR_QUICK_RANGES}
                displayLabel={presetId ? periodLabels[presetId] : null}
                activePresetId={presetId}
                onChange={([start, end], goal) => applyInterval(start, end, goal)}
              />
              <Button onClick={() => setConfirm(true)} disabled={lancando || toLancar.length === 0}>
                {lancando ? "Informando…" : toLancar.length === 0 ? "Informar vendas" : toLancar.length === 1 ? "Informar vendas · 1 dia" : `Informar vendas · ${toLancar.length} dias`}
              </Button>
            </div>
          </HeaderFilters>
        }
      />
      <div className="mt-6 pb-8">
        {error ? <Alert className="mb-4" variant="danger" title="Não foi possível carregar o informe de vendas. Tente novamente." /> : null}
        {shoppingSendsSales(account?.administrator) && account?.lastError ? <Alert className="mb-4" variant="danger" title={account.lastError} /> : null}
        {escolher ? (
          <div className="max-w-[720px]">
            <SelectStoreCard />
          </div>
        ) : showStores || (store != null && !pronto) ? (
          <Skeleton className="h-[520px] w-full rounded-[18px]" />
        ) : storeRows.length === 0 || !store ? (
          <Card>
            <EmptyBlock icon="🧾" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : !kiosk ? (
          <Card>
            <EmptyBlock icon="🧾" title="Informe de vendas indisponível" description="Esta tela está disponível apenas para filiais do tipo Quiosque em shopping." />
          </Card>
        ) : account?.administrator === "argo" ? (
          <Card>
            <EmptyBlock icon="🧾" title="Argo ainda não disponível" description="A integração com a Argo ainda não está disponível na WDash." />
          </Card>
        ) : !shoppingSendsSales(account?.administrator) ? (
          <Card>
            <EmptyBlock
              icon="🧾"
              title="Administradora não configurada"
              description={owner ? "Configure a administradora desta filial para informar as vendas ao shopping." : "O Gestor ainda não configurou a administradora desta filial."}
              action={owner ? <Button onClick={() => navigate(paths.operation.branch)}>Configurar na filial</Button> : undefined}
            />
          </Card>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <PlainKpi label="Vendido" value={money(summary.soldCents)} color="var(--t0)" />
              <PlainKpi label="Informado" value={money(summary.launchedCents)} color="var(--t0)" />
              <PlainKpi
                label="Diferença"
                value={differenceAmount(summary.differenceCents)}
                color={differenceColor(summary.differenceCents)}
                tooltip="Informado − vendido. Valor a mais pode aumentar o aluguel percentual; valor a menos pode gerar divergência na auditoria."
              />
            </div>
            <MonthCalendar>
              {cells.map((day, i) => {
                if (!day) return <div key={`vazio-${i}`} className={blankDayClass(i)} />;
                const row = byDay.get(day);
                const past = day < today;
                const todayDay = day === today;
                const amount = dayAmount(day, today, row, sold);
                const status = todayDay ? { text: "Em aberto", color: "bg-acc" } : past && row ? dayStatus(row.soldCents, row.launchedCents) : null;
                const pending = row != null && canResendDay(day, today, row.soldCents, row.launchedCents);
                const correcting = pending && row.launchedCents != null;
                return (
                  <DayFace
                    key={day}
                    index={i}
                    iso={day}
                    today={today}
                    selected={marcados.includes(day)}
                    openable={todayDay || past}
                    openLabel={`Abrir ${dayTitle(day)}`}
                    onOpen={() => setDayOpen(day)}
                    amount={amount != null ? money(amount) : null}
                    check={pending ? { checked: marcados.includes(day), label: `${correcting ? "Corrigir" : "Marcar"} ${dayTitle(day)}`, onToggle: () => toggleDay(day) } : null}
                    badges={status ? <DayChip color={status.color}>{status.text}</DayChip> : null}
                  />
                );
              })}
            </MonthCalendar>
          </>
        )}
      </div>
      <InformedDayModal
        day={dayOpen}
        today={today}
        sold={dayOpen == null ? null : dayOpen === today ? (sold[today] != null && sold[today] > 0 ? sold[today] : null) : (byDay.get(dayOpen)?.soldCents ?? 0)}
        informed={dayOpen && dayOpen < today ? (byDay.get(dayOpen)?.launchedCents ?? null) : null}
        onClose={() => setDayOpen(null)}
      />
      <Modal
        open={confirm}
        onClose={() => { if (!lancando) setConfirm(false); }}
        title="Informar vendas ao shopping?"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={lancando}>Cancelar</Button>
            <Button onClick={() => { setConfirm(false); void lancar(); }} disabled={lancando || toLancar.length === 0}>Informar vendas</Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-t1">
          <p>{toLancar.length === 1 ? "O valor vendido em 1 dia será informado ao shopping." : `Os valores vendidos em ${toLancar.length} dias serão informados ao shopping.`}</p>
          {toCorrigir.length > 0 ? (
            <p className="text-t2">{toCorrigir.length === 1 ? "1 dia já informado com valor diferente será substituído pelo vendido." : `${toCorrigir.length} dias já informados com valor diferente serão substituídos pelo vendido.`}</p>
          ) : (
            <p className="text-t2">Dias que já têm o valor certo não serão alterados.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}

function InformedDayModal({
  day,
  today,
  sold,
  informed,
  onClose,
}: {
  day: string | null;
  today: string;
  sold: number | null;
  informed: number | null;
  onClose: () => void;
}) {
  const todayDay = day === today;
  const faltando = day != null && !todayDay && informed == null;
  const diferente = day != null && !todayDay && informed != null && sold != null && informed !== sold;
  const status = todayDay ? "Em aberto" : faltando ? "Não informado" : "Informado";
  const variant = todayDay ? "accent" : faltando ? "warning" : "success";
  const difference = sold != null && informed != null ? informed - sold : null;
  return (
    <Modal
      open={day != null}
      onClose={onClose}
      size="lg"
      title={
        day ? (
          <>
            <span>{dayTitle(day)}</span>
            <Badge variant={variant}>{status}</Badge>
          </>
        ) : (
          ""
        )
      }
      footer={<Button variant="outline" onClick={onClose}>Voltar</Button>}
    >
      {day ? (
        <>
          <DayMetrics
            items={[
              { label: "Vendido", value: sold == null ? "—" : money(sold) },
              { label: "Informado", value: todayDay ? "—" : informed == null ? "Não informado" : money(informed) },
              { label: "Diferença", value: difference == null ? "—" : differenceAmount(difference), color: difference == null ? undefined : differenceColor(difference) },
            ]}
          />
          {todayDay ? <p className="text-[13px] leading-relaxed text-t2">Este dia ainda está em aberto. O valor será informado depois do fechamento.</p> : null}
          {faltando ? <p className="text-[13px] leading-relaxed text-t2">Este dia ainda não foi informado ao shopping. Marque a caixa do calendário para enviar o valor, inclusive quando a venda é zero.</p> : null}
          {diferente ? <p className="text-[13px] leading-relaxed text-t2">O valor informado é diferente do vendido. Marque a caixa do calendário para enviar o valor vendido de novo.</p> : null}
        </>
      ) : null}
    </Modal>
  );
}
