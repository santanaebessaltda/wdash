import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Badge, Button, Card, DateRangePicker, Modal, useToast, CALENDAR_QUICK_RANGES, type DatePresetId, type DateRangeChangeMeta } from "@/components/ui";
import { FinanceMonthSkeleton } from "@/components/wedash/LoadingSkeletons";
import { DayFace, DayMetrics, MonthCalendar, blankDayClass } from "@/components/wedash/MonthCalendar";
import { StoreDivisionTitle } from "@/components/wedash/StoreDivisionTitle";
import { DayChip, PlainKpi } from "@/pages/cash-close/CashClosePage";
import { calendarTodayIso } from "@/data/wedash/clock";
import { periodLabels } from "@/data/wedash/dashboard";
import { fetchSalesCoverage, fetchSalesDayAggs } from "@/data/wedash/salesRepo";
import { fetchInformedCents, fetchLaunchedDays, fetchShoppingAccount, requestShoppingLaunch, requestShoppingRead, type ShoppingAccount } from "@/data/wedash/shoppingRepo";
import { ALREADY_LAUNCHED, canResendDay, forceLaunchAllowed, groupedDay, groupedPeriod, informedGap, monthReport, reportDays, shoppingSendsSales, sumSoldByDay } from "@/data/wedash/shoppingReport";
import { brlCent, longDate, isoToDate, endOfMonth, startOfMonth, eachDay, dateToIso, addDays } from "@/lib/format";
import { statusBadgeVariant } from "@/lib/status";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { refreshMomentTitle, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { isOwner } from "@/layout/nav-wedash";
import { paths } from "@/router/paths";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { SectionHeader, useScopedStores } from "@/pages/operation/shared";
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
  return { text, color: "bg-bad" };
}

type GroupStore = { id: string; name: string };

function soldByStoreDay(aggs: Array<{ storeId: string; day: string; revenueCents: number; brand?: string | null }>): Record<string, number> {
  const byStore = new Map<string, typeof aggs>();
  for (const row of aggs) {
    const list = byStore.get(row.storeId) ?? [];
    list.push(row);
    byStore.set(row.storeId, list);
  }
  const out: Record<string, number> = {};
  for (const [storeId, rows] of byStore) {
    for (const [day, cents] of Object.entries(sumSoldByDay(rows))) out[`${storeId}|${day}`] = cents;
  }
  return out;
}

function filialCount(count: number, one: string, many: string): string {
  return count === 1 ? `1 filial ${one}` : `${count} filiais ${many}`;
}

function rangeCells(from: string, to: string): Array<string | null> {
  const cells: Array<string | null> = Array.from({ length: isoToDate(from).getDay() }, () => null);
  for (let day = from; day <= to; day = addDays(day, 1)) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Financeiro > Informe de vendas. Calendário do que foi informado no shopping. */
export function SalesReportPage() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { session, storeRows, loading: storesLoading } = useScopedStores();
  const manyStores = storeRows.length > 1;
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
  const [groupStores, setGroupStores] = useState<GroupStore[]>([]);
  const [groupSold, setGroupSold] = useState<Record<string, number>>({});
  const [groupInformed, setGroupInformed] = useState<Record<string, number>>({});
  const [groupLoaded, setGroupLoaded] = useState("");

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
  const storeKey = storeRows.map((item) => item.id).join(",");
  const band = storeKey ? `${storeKey}|${from}|${to}|${reloadKey}` : "";
  const kiosk = store?.pointType === "SHOPPING";

  useEffect(() => {
    if (storesLoading || storeRows.length === 0) return;
    let stop = false;
    void fetchSalesCoverage(session.tenantId, storeRows.map((item) => item.id)).then((coverage) => {
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
  }, [storesLoading, storeRows, session.tenantId, reloadKey]);

  useEffect(() => {
    if (storesLoading || manyStores || !store) return;
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
  }, [storesLoading, manyStores, store, session.tenantId, from, to, band]);

  useEffect(() => {
    if (storesLoading || !manyStores) return;
    let cancel = false;
    setError(false);
    const kiosks = storeRows.filter((item) => item.pointType === "SHOPPING");
    void (async () => {
      const accounts = await Promise.all(kiosks.map(async (item) => ({ item, account: await fetchShoppingAccount(session.tenantId, item.id) })));
      if (cancel) return;
      const sending = accounts.filter((row) => shoppingSendsSales(row.account?.administrator));
      const ids = sending.map((row) => row.item.id);
      if (ids.length === 0) {
        setGroupStores([]);
        setGroupSold({});
        setGroupInformed({});
        setGroupLoaded(band);
        return;
      }
      const [aggs, informed] = await Promise.all([
        fetchSalesDayAggs({ tenantId: session.tenantId, storeIds: ids, from, to }),
        fetchInformedCents(session.tenantId, ids, from, to),
      ]);
      if (cancel) return;
      setGroupStores(sending.map(({ item }) => ({ id: item.id, name: item.tradeName })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
      setGroupSold(soldByStoreDay(aggs));
      setGroupInformed(informed);
      setGroupLoaded(band);
    })().catch(() => {
      if (!cancel) setError(true);
    });
    return () => {
      cancel = true;
    };
  }, [storesLoading, manyStores, storeRows, session.tenantId, from, to, band]);

  const pronto = loaded === band;

  const puxar = useCallback(async () => {
    const current = storeRef.current;
    if (manyStores || !current) return;
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
  }, [manyStores, from, show, to]);

  const lancar = useCallback(async () => {
    const current = storeRef.current;
    if (lancando || manyStores || !current) return;
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
  }, [manyStores, today, lancando, show]);

  useScreenRefresh({
    label: "Atualizar vendas e valores informados",
    tip: manyStores ? "Busca as vendas de hoje." : "Busca as vendas de hoje e lê os valores informados ao shopping.",
    status: refreshMomentTitle(pronto ? (account?.lastRunAt ?? null) : undefined),
    busyLabel: "Atualizando…",
    sales: true,
    run: () => {
      if (manyStores) {
        setReloadKey((n) => n + 1);
        return;
      }
      return puxar();
    },
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
        section="Financeiro"
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
              {manyStores ? null : (
                <Button onClick={() => setConfirm(true)} disabled={lancando || toLancar.length === 0}>
                  {lancando ? "Informando…" : toLancar.length === 0 ? "Informar vendas" : toLancar.length === 1 ? "Informar vendas · 1 dia" : `Informar vendas · ${toLancar.length} dias`}
                </Button>
              )}
            </div>
          </HeaderFilters>
        }
      />
      <div className="mt-6 pb-8">
        {error ? <Alert className="mb-4" variant="danger" title="Não foi possível carregar o informe de vendas. Tente novamente." /> : null}
        {!manyStores && shoppingSendsSales(account?.administrator) && account?.lastError ? <Alert className="mb-4" variant="danger" title={account.lastError} /> : null}
        {showStores || (storeRows.length > 0 && (manyStores ? groupLoaded !== band : store != null && !pronto)) ? (
          <FinanceMonthSkeleton cells={cells} today={today} marked={storeRows.length === 1} />
        ) : storeRows.length === 0 ? (
          <Card>
            <EmptyBlock icon="🧾" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : manyStores ? (
          groupStores.length === 0 ? (
            <Card>
              <EmptyBlock icon="🧾" title="Nenhum quiosque com informe de vendas" description="Neste acesso não há quiosque com Intranet Mall ou Group COM conectados." />
            </Card>
          ) : (
            <GroupCalendar
              today={today}
              cells={cells}
              stores={groupStores}
              sold={groupSold}
              informed={groupInformed}
              summary={groupedPeriod(groupStores.map((item) => item.id), from, to, today, groupSold, groupInformed)}
              onOpen={setDayOpen}
            />
          )
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
              title="Administradora desconectada"
              description={owner ? "Conecte a administradora desta filial para informar as vendas ao shopping." : "O Gestor ainda não conectou a administradora desta filial."}
              action={owner ? <Button onClick={() => navigate(paths.operation.shopping)}>Conectar administradora</Button> : undefined}
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
      {manyStores ? (
        <GroupDayModal day={dayOpen} today={today} stores={groupStores} sold={groupSold} informed={groupInformed} onClose={() => setDayOpen(null)} />
      ) : (
        <InformedDayModal
          day={dayOpen}
          today={today}
          sold={dayOpen == null ? null : dayOpen === today ? (sold[today] != null && sold[today] > 0 ? sold[today] : null) : (byDay.get(dayOpen)?.soldCents ?? 0)}
          informed={dayOpen && dayOpen < today ? (byDay.get(dayOpen)?.launchedCents ?? null) : null}
          onClose={() => setDayOpen(null)}
        />
      )}
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

function GroupCalendar({
  today,
  cells,
  stores,
  sold,
  informed,
  summary,
  onOpen,
}: {
  today: string;
  cells: Array<string | null>;
  stores: GroupStore[];
  sold: Record<string, number>;
  informed: Record<string, number>;
  summary: { soldCents: number; informedCents: number; differenceCents: number };
  onOpen: (day: string) => void;
}) {
  const ids = stores.map((store) => store.id);
  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <PlainKpi label="Vendido" value={money(summary.soldCents)} color="var(--t0)" />
        <PlainKpi label="Informado" value={money(summary.informedCents)} color="var(--t0)" />
        <PlainKpi
          label="Diferença"
          value={differenceAmount(summary.differenceCents)}
          color={differenceColor(summary.differenceCents)}
          tooltip="Informado − vendido, somando as filiais. Dia sem informe entra como zero."
        />
      </div>
      <MonthCalendar>
        {cells.map((day, i) => {
          if (!day) return <div key={`vazio-${i}`} className={blankDayClass(i)} />;
          const past = day < today;
          const todayDay = day === today;
          const face = past || todayDay ? groupedDay(ids, day, sold, informed) : null;
          const amount = face && face.soldCents > 0 ? money(face.soldCents) : null;
          const informedStatus = past && face?.informedCents != null ? dayStatus(face.informedSoldCents, face.informedCents) : null;
          const missingLabel = face && face.missingStores === ids.length ? "Não informado" : face ? filialCount(face.missingStores, "não informada", "não informadas") : "";
          return (
            <DayFace
              key={day}
              index={i}
              iso={day}
              today={today}
              openable={todayDay || past}
              openLabel={`Abrir ${dayTitle(day)}`}
              onOpen={() => onOpen(day)}
              amount={amount}
              badges={
                face ? (
                  <>
                    {informedStatus ? <DayChip color={informedStatus.color}>{informedStatus.text}</DayChip> : null}
                    {past && face.missingStores > 0 ? <DayChip color="bg-warn">{missingLabel}</DayChip> : null}
                    {todayDay ? <DayChip color="bg-acc">Em aberto</DayChip> : null}
                  </>
                ) : null
              }
            />
          );
        })}
      </MonthCalendar>
    </>
  );
}

function GroupDayModal({
  day,
  today,
  stores,
  sold,
  informed,
  onClose,
}: {
  day: string | null;
  today: string;
  stores: GroupStore[];
  sold: Record<string, number>;
  informed: Record<string, number>;
  onClose: () => void;
}) {
  const todayDay = day === today;
  const blocks = day
    ? stores.map((store) => {
        const key = `${store.id}|${day}`;
        const soldCents = todayDay ? (sold[key] != null && sold[key] > 0 ? sold[key] : null) : (sold[key] ?? 0);
        const informedCents = !todayDay && Object.prototype.hasOwnProperty.call(informed, key) ? informed[key]! : null;
        return { ...store, soldCents, informedCents };
      })
    : [];
  const missing = blocks.some((block) => block.informedCents == null);
  const gap = blocks.some((block) => block.informedCents != null && block.soldCents != null && block.informedCents !== block.soldCents);
  const status = todayDay ? "Em aberto" : missing ? "Não informado" : "Informado";
  const variant = !todayDay && !missing && gap ? "danger" : statusBadgeVariant(status);
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
        <div className="flex flex-col gap-6">
          {blocks.map((block) => {
            const difference = block.soldCents != null && block.informedCents != null ? block.informedCents - block.soldCents : null;
            const faltando = !todayDay && block.informedCents == null;
            const diferente = !todayDay && block.informedCents != null && block.soldCents != null && block.informedCents !== block.soldCents;
            return (
              <section key={block.id}>
                <StoreDivisionTitle className="mb-3">{block.name}</StoreDivisionTitle>
                <DayMetrics
                  items={[
                    { label: "Vendido", value: block.soldCents == null ? "—" : money(block.soldCents) },
                    { label: "Informado", value: todayDay ? "—" : block.informedCents == null ? "Não informado" : money(block.informedCents) },
                    { label: "Diferença", value: difference == null ? "—" : differenceAmount(difference), color: difference == null ? undefined : differenceColor(difference) },
                  ]}
                />
                {todayDay ? <p className="text-[13px] leading-relaxed text-t2">Este dia ainda está em aberto. O valor será informado depois do fechamento.</p> : null}
                {faltando ? <p className="text-[13px] leading-relaxed text-t2">Este dia ainda não foi informado ao shopping.</p> : null}
                {diferente ? <p className="text-[13px] leading-relaxed text-t2">O valor informado é diferente do vendido.</p> : null}
              </section>
            );
          })}
        </div>
      ) : null}
    </Modal>
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
  const variant = diferente ? "danger" : statusBadgeVariant(status);
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
