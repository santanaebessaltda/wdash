import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Card, Skeleton, useToast } from "@/components/ui";
import { ChipDia, monthNavBtn, PlainKpi, SeletorMesAno, Seta } from "@/pages/cash-close/CashClosePage";
import { calendarTodayIso } from "@/data/wedash/clock";
import { fetchSalesCoverage, fetchSalesDayAggs } from "@/data/wedash/salesRepo";
import { fetchLaunchedDays, fetchShoppingAccount, requestShoppingLaunch, type ShoppingAccount } from "@/data/wedash/shoppingRepo";
import { forceLaunchAllowed, monthReport, reportDays, sumSoldByDay } from "@/data/wedash/shoppingReport";
import { brlCent, deIso, fimDoMes, inicioDoMes, intervaloDias, somarDias } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { refreshMomentTitle, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { useScope } from "@/pages/dashboard/useScope";
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

/** Gestão > Informe de vendas. Calendário do que foi informado no shopping. */
export function SalesReportPage() {
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

  const loja = lojas[0];
  const lojaRef = useRef(loja);
  lojaRef.current = loja;
  const accountRef = useRef(account);
  accountRef.current = account;
  const from = inicioDoMes(anchor);
  const to = fimDoMes(anchor);
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

  const pedir = useCallback(async () => {
    const atual = lojaRef.current;
    if (escolher || !atual) return;
    const gate = forceLaunchAllowed({
      kiosk: atual.pointType === "SHOPPING",
      administrator: accountRef.current?.administrator ?? null,
    });
    if (!gate.ok) {
      show(gate.message, "danger");
      return;
    }
    const result = await requestShoppingLaunch(atual.id);
    setReloadKey((n) => n + 1);
    if (!result.ok) show(result.message, "danger");
    else show("Vendas lançadas no shopping.", "success");
  }, [escolher, show]);

  useScreenRefresh({
    label: "Lançar vendas no shopping",
    tip: "Informa no shopping os dias passados que ainda estão vazios.",
    status: refreshMomentTitle(pronto ? (account?.lastRunAt ?? null) : undefined),
    busyLabel: "Lançando vendas no shopping…",
    run: () => pedir(),
  });

  const dias = useMemo(() => reportDays(intervaloDias(from, to), sold, launched, hoje), [from, to, sold, launched, hoje]);
  const resumo = useMemo(() => monthReport(dias, hoje), [dias, hoje]);
  const porDia = useMemo(() => new Map(dias.map((day) => [day.date, day])), [dias]);

  function irParaMes(alvo: string) {
    const mes = inicioDoMes(alvo);
    if (mes < piso || mes > inicioDoMes(hoje)) return;
    setAnchor(mes === inicioDoMes(hoje) ? hoje : mes);
  }

  return (
    <div>
      <SectionHeader
        section="Gestão"
        title="Informe de vendas"
        subtitle="Compare o que a filial vendeu com o que foi lançado no shopping."
        actions={
          <HeaderFilters>
            <div className="flex items-center gap-2">
              <SeletorMesAno iso={anchor} hoje={hoje} minIso={piso} onChange={irParaMes} />
              <button type="button" aria-label="Mês anterior" className={monthNavBtn} disabled={!podeVoltar} onClick={() => irParaMes(somarMes(anchor, -1))}>
                <Seta dir="anterior" />
              </button>
              <button type="button" aria-label="Próximo mês" className={monthNavBtn} disabled={!podeAvancar} onClick={() => irParaMes(somarMes(anchor, 1))}>
                <Seta dir="proximo" />
              </button>
            </div>
          </HeaderFilters>
        }
      />
      <div className="mt-6 pb-8">
        {erro ? <Alert className="mb-4" variant="danger" title="Não foi possível carregar o informe de vendas. Tente novamente." /> : null}
        {account?.lastError ? <Alert className="mb-4" variant="danger" title={account.lastError} /> : null}
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
            <EmptyBlock icon="🏬" title="Loja de rua" description="O informe de vendas vale para quiosque em shopping." />
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
              <div className="min-w-[760px]">
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
                    <DiaCelula key={day ?? `vazio-${i}`} index={i} day={day} hoje={hoje} row={day ? porDia.get(day) : undefined} />
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
  row,
}: {
  index: number;
  day: string | null;
  hoje: string;
  row?: { soldCents: number; launchedCents: number | null };
}) {
  const borda = cn(
    "flex min-h-[84px] w-full min-w-0 flex-col items-stretch justify-start border-b border-r border-line p-1.5 text-left sm:min-h-[110px] sm:p-2",
    (index + 1) % 7 === 0 && "border-r-0",
    !day && "bg-bg-1/30",
  );
  if (!day) return <div className={borda} />;
  const futuro = day >= hoje;
  const diferenca = row && row.launchedCents != null ? row.launchedCents - row.soldCents : row ? 0 - row.soldCents : 0;
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
          <p className="mt-1 truncate font-mono text-[12px] font-bold text-t0 sm:text-[13px]">{row.launchedCents == null ? "—" : money(row.launchedCents)}</p>
          {row.launchedCents == null ? (
            <ChipDia cor="bg-chip-gray">Em branco</ChipDia>
          ) : diferenca !== 0 ? (
            <ChipDia cor="bg-bad">{textoDiferenca(diferenca)}</ChipDia>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
