import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Modal, Skeleton, useToast } from "@/components/ui";
import { calendarTodayIso } from "@/data/wedash/clock";
import { fetchLatestCashCloseError, fetchNavMonthFloor, fetchOpenCashCloseJob, requestMonthClose } from "@/data/wedash/cashCloseRepo";
import { fetchSyncWatermark } from "@/data/wedash/salesRepo";
import {
  createSangriaDeposit,
  fetchSangriaMonth,
  saveSangriaLine,
  undoSangriaDeposit,
  type SangriaDepositDay,
  type SangriaLineRow,
} from "@/data/wedash/sangriaRepo";
import { dayAmounts, depositBoleto, sumAmounts, type SangriaKind } from "@/data/wedash/sangriaMath";
import { brlCent, dataExtenso, deIso, fimDoMes, inicioDoMes, somarDias } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { refreshStatusLine, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { useScope } from "@/pages/dashboard/useScope";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { SectionHeader, SelectStoreCard, pickOneStore, useScopedStores } from "@/pages/operation/shared";
import { monthNavBtn, SeletorMesAno, Seta } from "@/pages/cash-close/CashClosePage";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { HeaderFilters } from "@/pages/stock/shared";

const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const money = (cents: number) => brlCent(cents / 100);

function celulasDoMes(iso: string): Array<string | null> {
  const inicio = inicioDoMes(iso);
  const fim = fimDoMes(iso);
  const cells: Array<string | null> = Array.from({ length: deIso(inicio).getDay() }, () => null);
  for (let day = inicio; day <= fim; day = somarDias(day, 1)) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function tituloDia(iso: string): string {
  const s = dataExtenso(iso);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Gestão > Sangrias. Calendário do mês e o depósito dos dias em aberto. */
export function SangriaPage() {
  const { show } = useToast();
  const { session, lojas, loading: lojasLoading } = useScopedStores();
  const { escopo } = useScope();
  const escolher = pickOneStore(escopo.filialIds, session.stores.length);
  const showLojas = useMinSkeleton(lojasLoading);
  const hoje = calendarTodayIso();
  const [anchor, setAnchor] = useState(hoje);
  const [piso, setPiso] = useState(() => inicioDoMes(hoje));
  const [lines, setLines] = useState<SangriaLineRow[]>([]);
  const [deposits, setDeposits] = useState<SangriaDepositDay[]>([]);
  const [loaded, setLoaded] = useState("");
  const [erro, setErro] = useState(false);
  const [dia, setDia] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [depositando, setDepositando] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [watermark, setWatermark] = useState<Date | null>(null);

  const loja = lojas[0];
  const lojaRef = useRef(loja);
  lojaRef.current = loja;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const from = inicioDoMes(anchor);
  const to = fimDoMes(anchor);
  const podeAvancar = somarMes(anchor, 1) <= hoje;
  const podeVoltar = somarMes(anchor, -1) >= piso;
  const cells = useMemo(() => celulasDoMes(anchor), [anchor]);
  const faixa = loja ? `${loja.id}|${from}|${reloadKey}` : "";

  const lojaId = loja?.id ?? "";
  useEffect(() => {
    if (lojasLoading || escolher || !lojaId) return;
    let stop = false;
    void fetchNavMonthFloor("sangria_line", session.tenantId, lojaId, hoje).then((month) => {
      if (stop) return;
      setPiso(month);
      setAnchor((atual) => (inicioDoMes(atual) < month ? month : atual));
    });
    return () => {
      stop = true;
    };
  }, [lojasLoading, escolher, lojaId, session.tenantId, hoje, reloadKey]);

  useEffect(() => {
    if (!syncing) return;
    let stop = false;
    let checks = 0;
    const tick = async () => {
      checks += 1;
      const open = await fetchOpenCashCloseJob(session.tenantId);
      if (stop || open || checks < 2) return;
      const message = await fetchLatestCashCloseError(session.tenantId);
      if (stop) return;
      setSyncing(false);
      setReloadKey((n) => n + 1);
      if (message) show(message, "danger");
    };
    void tick();
    const id = window.setInterval(() => void tick(), 3000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [syncing, session.tenantId, show]);

  useEffect(() => {
    let stop = false;
    void fetchSyncWatermark(session.tenantId).then((wm) => {
      if (!stop) setWatermark(wm);
    });
    return () => {
      stop = true;
    };
  }, [session.tenantId, reloadKey]);

  const pedir = useCallback(async () => {
    const atual = lojaRef.current;
    if (escolher || !atual) return;
    const r = await requestMonthClose([atual.id], anchorRef.current);
    if (!r.ok) {
      show(r.message, "danger");
      return;
    }
    setSyncing(true);
  }, [escolher, show]);

  useScreenRefresh({
    label: "Atualizar vendas e sangrias",
    tip: "Busca as vendas de hoje e as sangrias do mês que está na tela.",
    status: refreshStatusLine("Sangrias atualizadas", "Sangrias ainda não atualizadas", watermark?.toISOString()),
    sales: true,
    run: () => pedir(),
  });

  useEffect(() => {
    const onSynced = () => setReloadKey((n) => n + 1);
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, []);

  useEffect(() => {
    if (lojasLoading || escolher || !loja) return;
    let cancel = false;
    setErro(false);
    void fetchSangriaMonth(session.tenantId, loja.id, from, to)
      .then((res) => {
        if (cancel) return;
        setLines(res.lines);
        setDeposits(res.deposits);
        setLoaded(faixa);
        setMarcados((atual) => atual.filter((day) => !res.deposits.some((d) => d.day === day)));
      })
      .catch(() => {
        if (!cancel) setErro(true);
      });
    return () => {
      cancel = true;
    };
  }, [lojasLoading, escolher, loja, session.tenantId, from, to, faixa]);

  const taken = useMemo(() => new Set(deposits.map((d) => d.day)), [deposits]);
  const porDia = useMemo(() => {
    const map = new Map<string, SangriaLineRow[]>();
    for (const line of lines) {
      const list = map.get(line.day) ?? [];
      list.push(line);
      map.set(line.day, list);
    }
    return map;
  }, [lines]);
  const mes = useMemo(() => sumAmounts([...porDia.values()].map((rows) => dayAmounts(rows))), [porDia]);
  const aberto = useMemo(() => {
    const days = [...porDia.keys()].filter((day) => !taken.has(day) && day <= hoje);
    return depositBoleto(lines, days);
  }, [porDia, taken, lines, hoje]);
  const boletoMarcado = depositBoleto(lines, marcados);
  const linhasDia = dia ? (porDia.get(dia) ?? []) : [];
  const depositoDia = dia ? deposits.find((d) => d.day === dia) : undefined;
  const pronto = loaded === faixa;

  function toggleDia(day: string) {
    if (taken.has(day) || day > hoje) return;
    setMarcados((atual) => (atual.includes(day) ? atual.filter((d) => d !== day) : [...atual, day]));
  }

  async function depositar() {
    if (!loja) return;
    setDepositando(true);
    try {
      await createSangriaDeposit(session.tenantId, loja.id, marcados, taken);
      setMarcados([]);
      setReloadKey((n) => n + 1);
      show("Depósito feito.", "success");
    } catch (e) {
      show(e instanceof Error ? e.message : "Não foi possível fazer o depósito. Tente novamente.", "danger");
    } finally {
      setDepositando(false);
    }
  }

  async function desfazer() {
    if (!depositoDia) return;
    try {
      await undoSangriaDeposit(depositoDia.depositId);
      setDeposits((atual) => atual.filter((d) => d.depositId !== depositoDia.depositId));
      setDia(null);
      setReloadKey((n) => n + 1);
    } catch {
      show("Não foi possível desfazer o depósito. Tente novamente.", "danger");
    }
  }

  async function mudar(line: SangriaLineRow, patch: { kind?: SangriaKind; note?: string }) {
    setLines((atual) => atual.map((row) => (row.id === line.id ? { ...row, ...patch } : row)));
    try {
      await saveSangriaLine(line.id, patch);
    } catch {
      show("Não foi possível salvar a sangria. Tente novamente.", "danger");
      setReloadKey((n) => n + 1);
    }
  }

  function irParaMes(alvo: string) {
    const mes = inicioDoMes(alvo);
    if (mes < piso || mes > inicioDoMes(hoje)) return;
    setAnchor(mes === inicioDoMes(hoje) ? hoje : mes);
    setMarcados([]);
  }

  return (
    <div>
      <SectionHeader
        section="Gestão"
        title="Sangrias"
        subtitle="Separe o que vai para o depósito e o que foi compra. O boleto é a soma dos dias que você marcar."
        actions={
          <HeaderFilters>
            <div className="flex flex-wrap items-center gap-2">
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
        {erro ? <Alert className="mb-4" variant="danger" title="Não foi possível carregar as sangrias. Tente novamente." /> : null}
        {escolher ? (
          <div className="max-w-[720px]">
            <SelectStoreCard />
          </div>
        ) : showLojas || (loja != null && !pronto) ? (
          <Skeleton className="h-[520px] w-full rounded-[18px]" />
        ) : lojas.length === 0 || !loja ? (
          <Card>
            <EmptyBlock icon="🏬" title="Nenhuma loja disponível" description="Não há lojas disponíveis para este acesso." />
          </Card>
        ) : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-4">
              <Resumo label="Em aberto" valor={money(aberto)} detalhe="Boleto dos dias ainda sem depósito" />
              <Resumo label="Total sangria" valor={money(mes.totalCents)} detalhe="Mês na tela" />
              <Resumo label="Boleto" valor={money(mes.boletoCents)} detalhe="Depois das compras" />
              <Resumo label="Faltando" valor={money(mes.faltandoCents)} detalhe="Compras do mês" />
            </div>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Button disabled={marcados.length === 0 || depositando} onClick={() => void depositar()}>
                {depositando ? "Depositando…" : `Fazer depósito${marcados.length ? ` · ${money(boletoMarcado)}` : ""}`}
              </Button>
              <span className="text-[12.5px] text-t2">
                {marcados.length === 0 ? "Marque os dias em aberto no calendário." : `${marcados.length} ${marcados.length === 1 ? "dia marcado" : "dias marcados"}.`}
              </span>
            </div>
            <div className="overflow-hidden rounded-[18px] border border-line bg-bg-2 shadow-[var(--shadow-vela)]">
              <div className="grid grid-cols-7">
                {WEEK.map((d) => (
                  <div key={d} className="border-b border-line px-1 py-2 text-center text-[10px] font-bold text-t2">
                    {d}
                  </div>
                ))}
                {cells.map((day, i) => {
                  const rows = day ? (porDia.get(day) ?? []) : [];
                  const tot = dayAmounts(rows);
                  const depositado = day ? taken.has(day) : false;
                  const marcado = day ? marcados.includes(day) : false;
                  const futuro = day != null && day > hoje;
                  return (
                    <div key={day ?? `vazio-${i}`} className="min-h-[88px] border-b border-r border-line p-1.5 sm:min-h-[108px] sm:p-2">
                      {day ? (
                        <button
                          type="button"
                          disabled={futuro}
                          onClick={() => setDia(day)}
                          className={cn(
                            "flex h-full w-full flex-col rounded-[12px] px-1.5 py-1 text-left",
                            futuro && "opacity-40",
                            marcado && "bg-acc/10 ring-1 ring-acc",
                            depositado && "bg-bg-1",
                          )}
                        >
                          <span className="flex items-center justify-between gap-1">
                            <span className="text-[12px] font-bold text-t0">{Number(day.slice(8))}</span>
                            {!futuro && !depositado && rows.length > 0 ? (
                              <input
                                type="checkbox"
                                aria-label={`Marcar ${tituloDia(day)}`}
                                checked={marcado}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => toggleDia(day)}
                              />
                            ) : null}
                          </span>
                          {rows.length > 0 ? (
                            <>
                              <span className="mt-1 font-mono text-[11px] font-bold text-t0">{money(tot.boletoCents)}</span>
                              {tot.faltandoCents > 0 ? <span className="text-[10px] text-t2">falta {money(tot.faltandoCents)}</span> : null}
                              {depositado ? <span className="text-[10px] font-semibold text-ok">Depositado</span> : null}
                            </>
                          ) : null}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
      <Modal
        open={dia != null}
        onClose={() => setDia(null)}
        size="md"
        title={dia ? tituloDia(dia) : ""}
        footer={
          depositoDia ? (
            <Button variant="outline" onClick={() => void desfazer()}>
              Desfazer depósito
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setDia(null)}>
              Fechar
            </Button>
          )
        }
      >
        {linhasDia.length === 0 ? (
          <p className="text-[13.5px] text-t2">Nenhuma sangria neste dia.</p>
        ) : (
          <ul className="space-y-3">
            {linhasDia.map((line) => (
              <li key={line.id} className="rounded-[14px] border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-mono text-[15px] font-bold text-t0">{money(line.amountCents)}</p>
                  <div className="flex gap-1">
                    <KindButton atual={line.kind} valor="deposit" onClick={() => void mudar(line, { kind: "deposit" })}>
                      Depósito
                    </KindButton>
                    <KindButton atual={line.kind} valor="purchase" onClick={() => void mudar(line, { kind: "purchase" })}>
                      Compra
                    </KindButton>
                  </div>
                </div>
                <input
                  className="mt-2 w-full rounded-[10px] border border-line bg-bg-1 px-2.5 py-2 text-[13px] text-t0"
                  defaultValue={line.note}
                  key={`${line.id}:${line.note}`}
                  aria-label="Observação"
                  onBlur={(e) => {
                    const note = e.target.value;
                    if (note !== line.note) void mudar(line, { note });
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}

function Resumo({ label, valor, detalhe }: { label: string; valor: string; detalhe: string }) {
  return (
    <Card padding="sm">
      <p className="text-[11px] font-bold uppercase tracking-wide text-t2">{label}</p>
      <p className="mt-1 truncate font-mono text-xl font-extrabold text-t0">{valor}</p>
      <p className="mt-0.5 text-[11px] text-t2">{detalhe}</p>
    </Card>
  );
}

function KindButton({ atual, valor, onClick, children }: { atual: SangriaKind; valor: SangriaKind; onClick: () => void; children: string }) {
  const on = atual === valor;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-[12px] font-semibold",
        on ? "bg-acc text-white" : "border border-line text-t1",
      )}
    >
      {children}
    </button>
  );
}

function somarMes(iso: string, meses: number): string {
  const d = deIso(inicioDoMes(iso));
  d.setMonth(d.getMonth() + meses);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}
