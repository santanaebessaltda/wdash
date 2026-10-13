import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, DateRangePicker, Skeleton, useToast, type QuickRange } from "@/components/ui";
import { ChipDia, PlainKpi } from "@/pages/cash-close/CashClosePage";
import { calendarTodayIso } from "@/data/wedash/clock";
import { fetchSalesCoverage, fetchSalesDayAggs } from "@/data/wedash/salesRepo";
import { fetchLaunchedDays, fetchShoppingAccount, requestShoppingLaunch, requestShoppingRead, type ShoppingAccount } from "@/data/wedash/shoppingRepo";
import { ALREADY_LAUNCHED, forceLaunchAllowed, monthReport, reportDays, sumSoldByDay } from "@/data/wedash/shoppingReport";
import { brlCent, deIso, fimDoMes, inicioDoMes, intervaloDias, paraIso, somarDias } from "@/lib/format";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { cn } from "@/lib/cn";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { refreshMomentTitle, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { useScope } from "@/pages/dashboard/useScope";
import { isGestor } from "@/layout/nav-wedash";
import { paths } from "@/router/paths";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { SectionHeader, SelectStoreCard, pickOneStore, useScopedStores } from "@/pages/operation/shared";
import { HeaderFilters } from "@/pages/stock/shared";

const WEEK = [
  { longo: "Domingo", curto: "D" },
  { longo: "Segunda-feira", curto: "S" },
  { longo: "Terça-feira", curto: "T" },
  { longo: "Quarta-feira", curto: "Q" },
  { longo: "Quinta-feira", curto: "Q" },
  { longo: "Sexta-feira", curto: "S" },
  { longo: "Sábado", curto: "S" },
];

const money = (cents: number) => brlCent(cents / 100);

const MES_CHEIO: QuickRange[] = [
  {
    id: "esteMes",
    label: "Este mês",
    resolve: (hoje) => [new Date(hoje.getFullYear(), hoje.getMonth(), 1), new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)],
  },
];

function valorDiferenca(cents: number): string {
  const abs = brlCent(Math.abs(cents) / 100);
  if (cents < 0) return `−${abs}`;
  if (cents > 0) return `+${abs}`;
  return abs;
}

function corDaDiferenca(cents: number): string {
  if (cents > 0) return "var(--ok)";
  if (cents < 0) return "var(--bad)";
  return "var(--t0)";
}

function celulasDoIntervalo(from: string, to: string): Array<string | null> {
  const cells: Array<string | null> = Array.from({ length: deIso(from).getDay() }, () => null);
  for (let day = from; day <= to; day = somarDias(day, 1)) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Gestão > Informe de vendas. Calendário do que foi informado no shopping. */
export function SalesReportPage() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { session, lojas, loading: lojasLoading } = useScopedStores();
  const { escopo } = useScope();
  const escolher = pickOneStore(escopo.filialIds, session.stores.length);
  const showLojas = useMinSkeleton(lojasLoading);
  const hoje = calendarTodayIso();
  const [rangeFrom, setRangeFrom] = useState(() => inicioDoMes(hoje));
  const [rangeTo, setRangeTo] = useState(() => fimDoMes(hoje));
  const [piso, setPiso] = useState(() => inicioDoMes(hoje));
  const [sold, setSold] = useState<Record<string, number>>({});
  const [launched, setLaunched] = useState<Record<string, number>>({});
  const [account, setAccount] = useState<ShoppingAccount | null>(null);
  const [loaded, setLoaded] = useState("");
  const [erro, setErro] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [lancando, setLancando] = useState(false);

  const loja = lojas[0];
  const lojaRef = useRef(loja);
  lojaRef.current = loja;
  const accountRef = useRef(account);
  accountRef.current = account;
  const launchedRef = useRef(launched);
  launchedRef.current = launched;
  const from = rangeFrom;
  const to = rangeTo;
  const rangeRef = useRef({ from, to });
  rangeRef.current = { from, to };
  const marcadosRef = useRef(marcados);
  marcadosRef.current = marcados;
  const faixa = loja ? `${loja.id}|${from}|${to}|${reloadKey}` : "";
  const quiosque = loja?.pointType === "SHOPPING";

  useEffect(() => {
    if (lojasLoading || escolher || !loja) return;
    let stop = false;
    void fetchSalesCoverage(session.tenantId, [loja.id]).then((coverage) => {
      if (stop || !coverage.from) return;
      const month = inicioDoMes(coverage.from);
      setPiso(month);
      setRangeFrom((atual) => (atual < month ? month : atual));
    });
    return () => {
      stop = true;
    };
  }, [lojasLoading, escolher, loja, session.tenantId, reloadKey]);

  useEffect(() => {
    if (lojasLoading || escolher || !loja) return;
    let cancel = false;
    setErro(false);
    void Promise.all([
      fetchSalesDayAggs({ tenantId: session.tenantId, storeIds: [loja.id], from, to }),
      fetchLaunchedDays(session.tenantId, loja.id, from, to),
      fetchShoppingAccount(session.tenantId, loja.id),
    ])
      .then(([days, launches, access]) => {
        if (cancel) return;
        setSold(sumSoldByDay(days));
        setLaunched(launches);
        setAccount(access);
        setLoaded(faixa);
      })
      .catch(() => {
        if (!cancel) setErro(true);
      });
    return () => {
      cancel = true;
    };
  }, [lojasLoading, escolher, loja, session.tenantId, from, to, faixa]);

  const pronto = loaded === faixa;

  const puxar = useCallback(async () => {
    const atual = lojaRef.current;
    if (escolher || !atual) {
      show("Escolha uma filial para ler o shopping.", "danger");
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
    const atual = lojaRef.current;
    if (lancando || escolher || !atual) {
      if (escolher || !atual) show("Escolha uma filial para lançar no shopping.", "danger");
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
    const dias = marcadosRef.current.filter((day) => day < hoje && !jaLancado.has(day));
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
      show(result.message ?? "Vendas lançadas no shopping.", "success");
    }
  }, [escolher, hoje, lancando, show]);

  useScreenRefresh({
    label: "Atualizar vendas e lançamentos",
    tip: "Busca as vendas de hoje e lê o que já está lançado no shopping. Não lança venda.",
    status: refreshMomentTitle(pronto ? (account?.lastRunAt ?? null) : undefined),
    busyLabel: "Lendo o shopping…",
    sales: true,
    run: () => puxar(),
  });

  useEffect(() => {
    const onSynced = () => setReloadKey((n) => n + 1);
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, []);

  const dias = useMemo(() => reportDays(intervaloDias(from, to), sold, launched, hoje), [from, to, sold, launched, hoje]);
  const resumo = useMemo(() => monthReport(dias, hoje), [dias, hoje]);
  const porDia = useMemo(() => new Map(dias.map((day) => [day.date, day])), [dias]);
  const cells = useMemo(() => celulasDoIntervalo(from, to), [from, to]);
  const gestor = isGestor(session.role);
  const mesAtual = from === inicioDoMes(hoje) && to === fimDoMes(hoje);
  const paraLancar = marcados.filter((day) => day < hoje && launched[day] == null);

  function aplicarIntervalo(inicio: Date, fim: Date) {
    const nextFrom = paraIso(inicio);
    const nextTo = paraIso(fim);
    setRangeFrom(nextFrom);
    setRangeTo(nextTo);
    setMarcados((atual) => atual.filter((day) => day >= nextFrom && day <= nextTo));
  }

  function toggleDia(day: string) {
    setMarcados((atual) => (atual.includes(day) ? atual.filter((item) => item !== day) : [...atual, day]));
  }

  return (
    <div>
      <SectionHeader
        section="Gestão"
        title="Informe de vendas"
        subtitle="Compare o que a filial vendeu com o que foi lançado no shopping."
        actions={
          <HeaderFilters>
            <div className="flex flex-wrap items-center gap-2">
              <DateRangePicker
                value={[deIso(from), deIso(to)]}
                minDate={deIso(piso)}
                maxDate={deIso(fimDoMes(hoje))}
                quickRanges={MES_CHEIO}
                displayLabel={mesAtual ? "Este mês" : null}
                activePresetId={mesAtual ? "esteMes" : null}
                onChange={([inicio, fim]) => aplicarIntervalo(inicio, fim)}
              />
              <Button onClick={() => void lancar()} disabled={lancando || paraLancar.length === 0}>
                {lancando ? "Lançando…" : paraLancar.length === 0 ? "Lançar" : paraLancar.length === 1 ? "Lançar · 1 dia" : `Lançar · ${paraLancar.length} dias`}
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
        ) : showLojas || (loja != null && !pronto) ? (
          <Skeleton className="h-[520px] w-full rounded-[18px]" />
        ) : lojas.length === 0 || !loja ? (
          <Card>
            <EmptyBlock icon="🏬" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : !quiosque ? (
          <Card>
            <EmptyBlock icon="🏬" title="Quiosque em shopping" description="Esta tela vale para filial que é quiosque em shopping." />
          </Card>
        ) : account?.administrator !== "allos" ? (
          <Card>
            <EmptyBlock
              icon="🏬"
              title="Allos não conectada"
              description={gestor ? "Conecte a administradora desta filial para informar as vendas no shopping." : "O Gestor ainda não conectou a administradora desta filial."}
              action={gestor ? <Button onClick={() => navigate(paths.operation.shopping)}>Conectar a Allos</Button> : undefined}
            />
          </Card>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <PlainKpi label="Vendido" value={money(resumo.soldCents)} color="var(--t0)" />
              <PlainKpi label="Lançado" value={money(resumo.launchedCents)} color="var(--t0)" />
              <PlainKpi
                label="Diferença"
                value={valorDiferenca(resumo.differenceCents)}
                color={corDaDiferenca(resumo.differenceCents)}
                tooltip="Lançado menos vendido. Positivo é aluguel percentual a mais. Negativo é risco de multa. Dia passado sem lançamento conta como zero."
              />
            </div>
            <div className="overflow-x-auto rounded-[18px] border border-line bg-bg-2 shadow-[var(--shadow-vela)]">
              <div className="min-w-[980px]">
                <div className="grid grid-cols-7">
                  {WEEK.map((d, i) => (
                    <div key={i} className="border-b border-line px-1 py-3 text-center text-[10px] font-bold leading-tight text-t2 sm:text-[11px]">
                      <span className="hidden sm:inline">{d.longo}</span>
                      <span className="sm:hidden uppercase">{d.curto}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {cells.map((day, i) => (
                    <DiaCelula
                      key={day ?? `vazio-${i}`}
                      index={i}
                      day={day}
                      hoje={hoje}
                      marcado={day != null && marcados.includes(day)}
                      onToggle={toggleDia}
                      row={day ? porDia.get(day) : undefined}
                    />
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DiaCelula({
  index,
  day,
  hoje,
  marcado,
  onToggle,
  row,
}: {
  index: number;
  day: string | null;
  hoje: string;
  marcado: boolean;
  onToggle: (day: string) => void;
  row?: { soldCents: number; launchedCents: number | null };
}) {
  const borda = cn(
    "relative flex min-h-[108px] w-full min-w-0 flex-col items-stretch justify-start border-b border-r border-line p-1.5 text-left sm:min-h-[132px] sm:p-2",
    (index + 1) % 7 === 0 && "border-r-0",
    !day && "bg-bg-1/30",
    marcado && "bg-acc-soft/40",
  );
  if (!day) return <div className={borda} />;
  const passado = day < hoje;
  const lancado = row?.launchedCents ?? 0;
  const igual = row != null && lancado === row.soldCents;
  return (
    <div className={borda}>
      {marcado ? <span aria-hidden className="pointer-events-none absolute inset-0 z-10 border border-acc" /> : null}
      <span className="flex w-full items-start justify-between gap-1">
        <span
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center self-start rounded-full text-[12px] font-bold",
            day === hoje ? "bg-acc text-white" : passado ? "text-t1" : "text-t2",
          )}
        >
          {deIso(day).getDate()}
        </span>
        {passado ? (
          <input
            type="checkbox"
            aria-label={`Marcar ${deIso(day).getDate()}`}
            checked={marcado}
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ accentColor: "var(--acc)" }}
            onChange={() => onToggle(day)}
          />
        ) : null}
      </span>
      {row ? (
        <>
          <ChipDia cor="bg-chip-gray">{`Vendido ${money(row.soldCents)}`}</ChipDia>
          <ChipDia cor={igual ? "bg-ok" : "bg-bad"}>{`Lançado ${money(lancado)}`}</ChipDia>
        </>
      ) : null}
    </div>
  );
}
