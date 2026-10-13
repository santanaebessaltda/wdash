import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Badge, Button, Card, DateRangePicker, Modal, Skeleton, useToast, CALENDAR_QUICK_RANGES, type DatePresetId, type DateRangeChangeMeta } from "@/components/ui";
import { DayFace, DayMetrics, MonthCalendar, blankDayClass } from "@/components/wedash/MonthCalendar";
import { DayChip, PlainKpi } from "@/pages/cash-close/CashClosePage";
import { calendarTodayIso } from "@/data/wedash/clock";
import { periodLabels } from "@/data/wedash/dashboard";
import { fetchSalesCoverage, fetchSalesDayAggs } from "@/data/wedash/salesRepo";
import { fetchLaunchedDays, fetchShoppingAccount, requestShoppingLaunch, requestShoppingRead, type ShoppingAccount } from "@/data/wedash/shoppingRepo";
import { ALREADY_LAUNCHED, forceLaunchAllowed, informedGap, monthReport, reportDays, sumSoldByDay } from "@/data/wedash/shoppingReport";
import { brlCent, longDate, isoToDate, endOfMonth, startOfMonth, eachDay, dateToIso, addDays } from "@/lib/format";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { refreshMomentTitle, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { useScope } from "@/pages/dashboard/useScope";
import { isGestor } from "@/layout/nav-wedash";
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

function dayStatus(soldCents: number, informedCents: number | null): { text: string; cor: string } {
  const gap = informedGap(soldCents, informedCents);
  if (gap === "missing" || informedCents == null) return { text: "Não informado", cor: "bg-warn" };
  const text = `Informado ${money(informedCents)}`;
  if (gap === "match") return { text, cor: "bg-ok" };
  if (gap === "over") return { text, cor: "bg-warn" };
  return { text, cor: "bg-bad" };
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
  const { session, storeRows, loading: lojasLoading } = useScopedStores();
  const { scope } = useScope();
  const escolher = pickOneStore(scope.storeIds, session.stores.length);
  const showStores = useMinSkeleton(lojasLoading);
  const today = calendarTodayIso();
  const [rangeFrom, setRangeFrom] = useState(() => startOfMonth(today));
  const [rangeTo, setRangeTo] = useState(() => endOfMonth(today));
  const [presetId, setPresetId] = useState<DatePresetId | null>("thisMonth");
  const [piso, setPiso] = useState(() => startOfMonth(today));
  const [sold, setSold] = useState<Record<string, number>>({});
  const [launched, setLaunched] = useState<Record<string, number>>({});
  const [account, setAccount] = useState<ShoppingAccount | null>(null);
  const [loaded, setLoaded] = useState("");
  const [erro, setErro] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [lancando, setLancando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [diaAberto, setDiaAberto] = useState<string | null>(null);

  const store = storeRows[0];
  const storeRef = useRef(store);
  storeRef.current = store;
  const accountRef = useRef(account);
  accountRef.current = account;
  const launchedRef = useRef(launched);
  launchedRef.current = launched;
  const from = rangeFrom;
  const to = rangeTo;
  const rangeRef = useRef({ from, to });
  rangeRef.current = { from, to };
  const markedRef = useRef(marcados);
  markedRef.current = marcados;
  const band = store ? `${store.id}|${from}|${to}|${reloadKey}` : "";
  const quiosque = store?.pointType === "SHOPPING";

  useEffect(() => {
    if (lojasLoading || escolher || !store) return;
    let stop = false;
    void fetchSalesCoverage(session.tenantId, [store.id]).then((coverage) => {
      if (stop || !coverage.from) return;
      const month = startOfMonth(coverage.from);
      setPiso(month);
      setRangeFrom((atual) => {
        if (atual >= month) return atual;
        setPresetId(null);
        return month;
      });
    });
    return () => {
      stop = true;
    };
  }, [lojasLoading, escolher, store, session.tenantId, reloadKey]);

  useEffect(() => {
    if (lojasLoading || escolher || !store) return;
    let cancel = false;
    setErro(false);
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
        if (!cancel) setErro(true);
      });
    return () => {
      cancel = true;
    };
  }, [lojasLoading, escolher, store, session.tenantId, from, to, band]);

  const pronto = loaded === band;

  const puxar = useCallback(async () => {
    const atual = storeRef.current;
    if (escolher || !atual) {
      show("Escolha uma filial para atualizar o informe de vendas.", "danger");
      return;
    }
    const gate = forceLaunchAllowed({
      kiosk: atual.pointType === "SHOPPING",
      administrator: accountRef.current?.administrator ?? null,
    });
    if (!gate.ok) {
      show(gate.message, "danger");
      return;
    }
    const result = await requestShoppingRead(atual.id);
    setReloadKey((n) => n + 1);
    if (!result.ok) show(result.message, "danger");
  }, [escolher, show]);

  const lancar = useCallback(async () => {
    const atual = storeRef.current;
    if (lancando || escolher || !atual) {
      if (escolher || !atual) show("Escolha uma filial para informar as vendas ao shopping.", "danger");
      return;
    }
    const gate = forceLaunchAllowed({
      kiosk: atual.pointType === "SHOPPING",
      administrator: accountRef.current?.administrator ?? null,
    });
    if (!gate.ok) {
      show(gate.message, "danger");
      return;
    }
    const jaLancado = new Set(Object.keys(launchedRef.current));
    const dias = markedRef.current.filter((day) => day < today && !jaLancado.has(day));
    if (dias.length === 0) {
      show(ALREADY_LAUNCHED, "success");
      return;
    }
    const span = rangeRef.current;
    setLancando(true);
    const result = await requestShoppingLaunch(atual.id, { from: span.from, to: span.to, days: dias });
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

  const dias = useMemo(() => reportDays(eachDay(from, to), sold, launched, today), [from, to, sold, launched, today]);
  const summary = useMemo(() => monthReport(dias, today), [dias, today]);
  const porDia = useMemo(() => new Map(dias.map((day) => [day.date, day])), [dias]);
  const cells = useMemo(() => rangeCells(from, to), [from, to]);
  const gestor = isGestor(session.role);
  const paraLancar = marcados.filter((day) => day < today && launched[day] == null);

  function aplicarIntervalo(start: Date, end: Date, goal?: DateRangeChangeMeta) {
    const nextFrom = dateToIso(start);
    const nextTo = dateToIso(end);
    setRangeFrom(nextFrom);
    setRangeTo(nextTo);
    setPresetId(goal?.presetId ?? null);
    setMarcados((atual) => atual.filter((day) => day >= nextFrom && day <= nextTo));
    setDiaAberto((atual) => (atual && atual >= nextFrom && atual <= nextTo ? atual : null));
  }

  function toggleDia(day: string) {
    setMarcados((atual) => (atual.includes(day) ? atual.filter((item) => item !== day) : [...atual, day]));
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
                minDate={isoToDate(piso)}
                maxDate={isoToDate(endOfMonth(today))}
                quickRanges={CALENDAR_QUICK_RANGES}
                displayLabel={presetId ? periodLabels[presetId] : null}
                activePresetId={presetId}
                onChange={([start, end], goal) => aplicarIntervalo(start, end, goal)}
              />
              <Button onClick={() => setConfirmar(true)} disabled={lancando || paraLancar.length === 0}>
                {lancando ? "Informando…" : paraLancar.length === 0 ? "Informar vendas" : paraLancar.length === 1 ? "Informar vendas · 1 dia" : `Informar vendas · ${paraLancar.length} dias`}
              </Button>
            </div>
          </HeaderFilters>
        }
      />
      <div className="mt-6 pb-8">
        {erro ? <Alert className="mb-4" variant="danger" title="Não foi possível carregar o informe de vendas. Tente novamente." /> : null}
        {account?.administrator === "allos" && account.lastError ? <Alert className="mb-4" variant="danger" title={account.lastError} /> : null}
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
        ) : !quiosque ? (
          <Card>
            <EmptyBlock icon="🧾" title="Informe de vendas indisponível" description="Esta tela está disponível apenas para filiais do tipo Quiosque em shopping." />
          </Card>
        ) : account?.administrator === "argo" ? (
          <Card>
            <EmptyBlock icon="🧾" title="Argo ainda não disponível" description="A integração com a Argo ainda não está disponível na WDash." />
          </Card>
        ) : account?.administrator !== "allos" ? (
          <Card>
            <EmptyBlock
              icon="🧾"
              title="Administradora não configurada"
              description={gestor ? "Configure a administradora desta filial para informar as vendas ao shopping." : "O Gestor ainda não configurou a administradora desta filial."}
              action={gestor ? <Button onClick={() => navigate(paths.operation.shopping)}>Configurar shopping</Button> : undefined}
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
                const row = porDia.get(day);
                const passado = day < today;
                const todayDay = day === today;
                const vendido = dayAmount(day, today, row, sold);
                const status = todayDay ? { text: "Em aberto", cor: "bg-acc" } : passado && row ? dayStatus(row.soldCents, row.launchedCents) : null;
                const pendente = passado && row != null && row.launchedCents == null;
                return (
                  <DayFace
                    key={day}
                    index={i}
                    iso={day}
                    today={today}
                    selected={marcados.includes(day)}
                    openable={todayDay || passado}
                    openLabel={`Abrir ${dayTitle(day)}`}
                    onOpen={() => setDiaAberto(day)}
                    amount={vendido != null ? money(vendido) : null}
                    check={pendente ? { checked: marcados.includes(day), label: `Marcar ${dayTitle(day)}`, onToggle: () => toggleDia(day) } : null}
                    badges={status ? <DayChip cor={status.cor}>{status.text}</DayChip> : null}
                  />
                );
              })}
            </MonthCalendar>
          </>
        )}
      </div>
      <InformedDayModal
        day={diaAberto}
        today={today}
        sold={diaAberto == null ? null : diaAberto === today ? (sold[today] != null && sold[today] > 0 ? sold[today] : null) : (porDia.get(diaAberto)?.soldCents ?? 0)}
        informed={diaAberto && diaAberto < today ? (porDia.get(diaAberto)?.launchedCents ?? null) : null}
        onClose={() => setDiaAberto(null)}
      />
      <Modal
        open={confirmar}
        onClose={() => { if (!lancando) setConfirmar(false); }}
        title="Informar vendas ao shopping?"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmar(false)} disabled={lancando}>Cancelar</Button>
            <Button onClick={() => { setConfirmar(false); void lancar(); }} disabled={lancando || paraLancar.length === 0}>Informar vendas</Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-t1">
          <p>{paraLancar.length === 1 ? "O valor vendido em 1 dia será informado ao shopping." : `Os valores vendidos em ${paraLancar.length} dias serão informados ao shopping.`}</p>
          <p className="text-t2">Dias que já têm valor informado não serão alterados.</p>
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
  const status = todayDay ? "Em aberto" : faltando ? "Não informado" : "Informado";
  const variant = todayDay ? "accent" : faltando ? "warning" : "success";
  const diferenca = sold != null && informed != null ? informed - sold : null;
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
              { label: "Diferença", value: diferenca == null ? "—" : differenceAmount(diferenca), color: diferenca == null ? undefined : differenceColor(diferenca) },
            ]}
          />
          {todayDay ? <p className="text-[13px] leading-relaxed text-t2">Este dia ainda está em aberto. O valor será informado depois do fechamento.</p> : null}
          {faltando ? <p className="text-[13px] leading-relaxed text-t2">Este dia ainda não foi informado ao shopping. Marque a caixa do calendário para enviar o valor, inclusive quando a venda é zero.</p> : null}
        </>
      ) : null}
    </Modal>
  );
}
