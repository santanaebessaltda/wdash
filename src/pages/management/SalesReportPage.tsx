import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, Skeleton, useToast } from "@/components/ui";
import { ChipDia, monthNavBtn, PlainKpi, SeletorMesAno, Seta } from "@/pages/cash-close/CashClosePage";
import { calendarTodayIso } from "@/data/wedash/clock";
import { fetchSalesCoverage, fetchSalesDayAggs } from "@/data/wedash/salesRepo";
import { fetchLaunchedDays, fetchShoppingAccount, requestShoppingLaunch, type ShoppingAccount } from "@/data/wedash/shoppingRepo";
import { ALREADY_LAUNCHED, allosPeriods, forceLaunchAllowed, monthReport, reportDays, sumSoldByDay, unlaunchedDays } from "@/data/wedash/shoppingReport";
import { brlCent, deIso, fimDoMes, inicioDoMes, intervaloDias, somarDias } from "@/lib/format";
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

function somarMes(iso: string, meses: number): string {
  const d = deIso(inicioDoMes(iso));
  d.setMonth(d.getMonth() + meses);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function celulasDoMes(iso: string): Array<string | null> {
  const inicio = inicioDoMes(iso);
  const fim = fimDoMes(iso);
  const cells: Array<string | null> = Array.from({ length: deIso(inicio).getDay() }, () => null);
  for (let day = inicio; day <= fim; day = somarDias(day, 1)) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function textoDiferenca(cents: number): string {
  if (cents > 0) return `A mais ${money(cents)}`;
  if (cents < 0) return `A menos ${money(Math.abs(cents))}`;
  return "Igual";
}

function rotuloPeriodo(from: string, to: string): string {
  const inicio = deIso(from);
  const fim = deIso(to);
  const mes = fim.toLocaleDateString("pt-BR", { month: "long" });
  if (inicio.getMonth() === fim.getMonth() && inicio.getFullYear() === fim.getFullYear()) {
    if (from === to) return `${inicio.getDate()} de ${mes}`;
    return `${inicio.getDate()} a ${fim.getDate()} de ${mes}`;
  }
  const mesInicio = inicio.toLocaleDateString("pt-BR", { month: "long" });
  return `${inicio.getDate()} de ${mesInicio} a ${fim.getDate()} de ${mes}`;
}

const filtroBtn = "rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition-colors";

/** Gestão > Informe de vendas. Calendário do que foi informado no shopping. */
export function SalesReportPage() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { session, lojas, loading: lojasLoading } = useScopedStores();
  const { escopo } = useScope();
  const escolher = pickOneStore(escopo.filialIds, session.stores.length);
  const showLojas = useMinSkeleton(lojasLoading);
  const hoje = calendarTodayIso();
  const [anchor, setAnchor] = useState(hoje);
  const [piso, setPiso] = useState(() => inicioDoMes(hoje));
  const [sold, setSold] = useState<Record<string, number>>({});
  const [launched, setLaunched] = useState<Record<string, number>>({});
  const [account, setAccount] = useState<ShoppingAccount | null>(null);
  const [loaded, setLoaded] = useState("");
  const [erro, setErro] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [granularity, setGranularity] = useState<"month" | "week">("month");
  const [weekFrom, setWeekFrom] = useState<string | null>(null);

  const loja = lojas[0];
  const lojaRef = useRef(loja);
  lojaRef.current = loja;
  const accountRef = useRef(account);
  accountRef.current = account;
  const launchedRef = useRef(launched);
  launchedRef.current = launched;
  const prontoRef = useRef(false);
  const from = inicioDoMes(anchor);
  const to = fimDoMes(anchor);
  const monthRef = useRef({ from, to });
  monthRef.current = { from, to };
  const podeAvancar = somarMes(anchor, 1) <= hoje;
  const podeVoltar = somarMes(anchor, -1) >= piso;
  const cells = useMemo(() => celulasDoMes(anchor), [anchor]);
  const faixa = loja ? `${loja.id}|${from}|${reloadKey}` : "";
  const quiosque = loja?.pointType === "SHOPPING";

  useEffect(() => {
    if (lojasLoading || escolher || !loja) return;
    let stop = false;
    void fetchSalesCoverage(session.tenantId, [loja.id]).then((coverage) => {
      if (stop || !coverage.from) return;
      const month = inicioDoMes(coverage.from);
      setPiso(month);
      setAnchor((atual) => (inicioDoMes(atual) < month ? month : atual));
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
  prontoRef.current = pronto;

  const pedir = useCallback(async () => {
    const atual = lojaRef.current;
    if (escolher || !atual) {
      show("Escolha uma filial para lançar no shopping.", "danger");
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
    const month = monthRef.current;
    const pending = unlaunchedDays(month.from, month.to, hoje, new Set(Object.keys(launchedRef.current)));
    if (prontoRef.current && pending.length === 0) {
      show(ALREADY_LAUNCHED, "success");
      return;
    }
    const result = await requestShoppingLaunch(atual.id, month);
    setReloadKey((n) => n + 1);
    if (!result.ok) show(result.message, "danger");
    else show(result.message ?? "Vendas lançadas no shopping.", "success");
  }, [escolher, hoje, show]);

  useScreenRefresh({
    label: "Lançar vendas no shopping",
    tip: "Abre o shopping só se este mês ainda tiver dia passado sem lançamento.",
    status: refreshMomentTitle(pronto ? (account?.lastRunAt ?? null) : undefined),
    busyLabel: "Lançando vendas no shopping…",
    run: () => pedir(),
  });

  const dias = useMemo(() => reportDays(intervaloDias(from, to), sold, launched, hoje), [from, to, sold, launched, hoje]);
  const blocos = useMemo(() => allosPeriods(from, to), [from, to]);
  const bloco = useMemo(() => {
    const escolhido = weekFrom ? blocos.find((period) => period.from === weekFrom) : undefined;
    return escolhido ?? blocos.find((period) => period.from <= hoje && hoje <= period.to) ?? blocos[blocos.length - 1];
  }, [blocos, weekFrom, hoje]);
  const diasVisiveis = useMemo(
    () => (granularity === "week" && bloco ? dias.filter((day) => day.date >= bloco.from && day.date <= bloco.to) : dias),
    [granularity, bloco, dias],
  );
  const resumo = useMemo(() => monthReport(diasVisiveis, hoje), [diasVisiveis, hoje]);
  const porDia = useMemo(() => new Map(dias.map((day) => [day.date, day])), [dias]);
  const gestor = isGestor(session.role);
  const primeiro = allosPeriods(piso, fimDoMes(piso))[0];
  const ultimo = allosPeriods(inicioDoMes(hoje), fimDoMes(hoje)).at(-1);
  const podeVoltarPeriodo = bloco != null && bloco.from !== primeiro?.from;
  const podeAvancarPeriodo = bloco != null && bloco.from !== ultimo?.from;

  function irParaMes(alvo: string) {
    const mes = inicioDoMes(alvo);
    if (mes < piso || mes > inicioDoMes(hoje)) return;
    setWeekFrom(null);
    setAnchor(mes === inicioDoMes(hoje) ? hoje : mes);
  }

  function irPeriodo(delta: number) {
    if (!bloco) return;
    const index = blocos.findIndex((period) => period.from === bloco.from);
    const next = index + delta;
    if (next >= 0 && next < blocos.length) {
      setWeekFrom(blocos[next].from);
      return;
    }
    if (delta < 0) {
      const prevMonth = somarMes(anchor, -1);
      if (prevMonth < piso) return;
      const prev = allosPeriods(prevMonth, fimDoMes(prevMonth));
      setWeekFrom(prev.at(-1)?.from ?? null);
      setAnchor(prevMonth === inicioDoMes(hoje) ? hoje : prevMonth);
      return;
    }
    const nextMonth = somarMes(anchor, 1);
    if (nextMonth > inicioDoMes(hoje)) return;
    const following = allosPeriods(nextMonth, fimDoMes(nextMonth));
    setWeekFrom(following[0]?.from ?? null);
    setAnchor(nextMonth === inicioDoMes(hoje) ? hoje : nextMonth);
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
              <div className="flex gap-1 rounded-[11px] border border-line bg-bg-2 p-1">
                <button type="button" className={cn(filtroBtn, granularity === "month" ? "bg-acc text-white" : "text-t1 hover:text-t0")} onClick={() => setGranularity("month")}>
                  Mensal
                </button>
                <button type="button" className={cn(filtroBtn, granularity === "week" ? "bg-acc text-white" : "text-t1 hover:text-t0")} onClick={() => setGranularity("week")}>
                  Semanal
                </button>
              </div>
              <SeletorMesAno iso={anchor} hoje={hoje} minIso={piso} onChange={irParaMes} />
              {granularity === "month" ? (
                <>
                  <button type="button" aria-label="Mês anterior" className={monthNavBtn} disabled={!podeVoltar} onClick={() => irParaMes(somarMes(anchor, -1))}>
                    <Seta dir="anterior" />
                  </button>
                  <button type="button" aria-label="Próximo mês" className={monthNavBtn} disabled={!podeAvancar} onClick={() => irParaMes(somarMes(anchor, 1))}>
                    <Seta dir="proximo" />
                  </button>
                </>
              ) : (
                <>
                  <span className="text-[13px] font-bold text-t0">{bloco ? rotuloPeriodo(bloco.from, bloco.to) : ""}</span>
                  <button type="button" aria-label="Período anterior" className={monthNavBtn} disabled={!podeVoltarPeriodo} onClick={() => irPeriodo(-1)}>
                    <Seta dir="anterior" />
                  </button>
                  <button type="button" aria-label="Próximo período" className={monthNavBtn} disabled={!podeAvancarPeriodo} onClick={() => irPeriodo(1)}>
                    <Seta dir="proximo" />
                  </button>
                </>
              )}
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
                value={textoDiferenca(resumo.differenceCents)}
                color={resumo.differenceCents === 0 ? "var(--ok)" : "var(--bad)"}
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
                      marcado={granularity === "month" || (bloco != null && day != null && day >= bloco.from && day <= bloco.to)}
                      destaque={granularity === "week" && bloco != null && day != null && day >= bloco.from && day <= bloco.to}
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
  destaque,
  row,
}: {
  index: number;
  day: string | null;
  hoje: string;
  marcado: boolean;
  destaque: boolean;
  row?: { soldCents: number; launchedCents: number | null };
}) {
  const borda = cn(
    "flex min-h-[108px] w-full min-w-0 flex-col items-stretch justify-start border-b border-r border-line p-1.5 text-left sm:min-h-[132px] sm:p-2",
    (index + 1) % 7 === 0 && "border-r-0",
    !day && "bg-bg-1/30",
    destaque && "bg-acc-soft",
    day && !marcado && "opacity-40",
  );
  if (!day) return <div className={borda} />;
  const futuro = day >= hoje;
  const lancado = row?.launchedCents ?? 0;
  const igual = row != null && lancado === row.soldCents;
  return (
    <div className={borda}>
      <span
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center self-start rounded-full text-[12px] font-bold",
          day === hoje ? "bg-acc text-white" : futuro ? "text-t2" : "text-t1",
        )}
      >
        {deIso(day).getDate()}
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
