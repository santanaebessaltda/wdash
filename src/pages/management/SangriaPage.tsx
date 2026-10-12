import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Dropdown, Modal, Segmented, Skeleton, useToast, type DropdownItem } from "@/components/ui";
import { calendarTodayIso } from "@/data/wedash/clock";
import { fetchLatestCashCloseError, fetchNavMonthFloor, fetchOpenCashCloseJob, requestSangriaMonth } from "@/data/wedash/cashCloseRepo";
import { fetchSyncWatermark } from "@/data/wedash/salesRepo";
import {
  createSangriaDeposit,
  fetchDepositDayCount,
  fetchSangriaMonth,
  saveSangriaLine,
  saveSangriaLines,
  saveSangriaShortage,
  undoSangriaDeposit,
  type SangriaDepositDay,
  type SangriaLineRow,
  type SangriaShortageRow,
} from "@/data/wedash/sangriaRepo";
import { dayAmounts, depositBoleto, sumAmounts, type SangriaAmounts } from "@/data/wedash/sangriaMath";
import { brlCent, dataExtenso, deIso, fimDoMes, inicioDoMes, somarDias } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { refreshMomentTitle, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { useScope } from "@/pages/dashboard/useScope";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { NumberInput, SectionHeader, SelectStoreCard, parseNum, pickOneStore, useScopedStores } from "@/pages/operation/shared";
import { ChipDia, monthNavBtn, SeletorMesAno, Seta } from "@/pages/cash-close/CashClosePage";
import { QuickStat } from "@/pages/dashboards/QuickStat";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
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

type AcaoLote = "recebido" | "aCobrar" | "fora" | "falta" | "desfazer";

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

/** Gestão > Sangrias. Calendário do mês e o recebimento dos dias em aberto. */
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
  const [shortages, setShortages] = useState<SangriaShortageRow[]>([]);
  const [loaded, setLoaded] = useState("");
  const [erro, setErro] = useState(false);
  const [dia, setDia] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [depositando, setDepositando] = useState(false);
  const [acao, setAcao] = useState<AcaoLote | null>(null);
  const [motivoLote, setMotivoLote] = useState("");
  const [faltaLote, setFaltaLote] = useState("");
  const [motivoFaltaLote, setMotivoFaltaLote] = useState("");
  const [diasDesfazer, setDiasDesfazer] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [watermark, setWatermark] = useState<Date | null | undefined>(undefined);

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
      const open = await fetchOpenCashCloseJob(session.tenantId, "sangria");
      if (stop || open || checks < 2) return;
      const message = await fetchLatestCashCloseError(session.tenantId, "sangria");
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
    void fetchSyncWatermark(session.tenantId)
      .catch(() => null)
      .then((wm) => {
        if (!stop) setWatermark(wm);
      });
    return () => {
      stop = true;
    };
  }, [session.tenantId, reloadKey]);

  const pedir = useCallback(async () => {
    const atual = lojaRef.current;
    if (escolher || !atual) return;
    const r = await requestSangriaMonth([atual.id], anchorRef.current);
    if (!r.ok) {
      show(r.message, "danger");
      return;
    }
    setSyncing(true);
  }, [escolher, show]);

  useScreenRefresh({
    label: "Atualizar vendas e sangrias",
    tip: "Busca as vendas de hoje e as sangrias do mês exibido.",
    status: refreshMomentTitle(watermark ? watermark.toISOString() : watermark),
    busyLabel: "Buscando vendas e sangrias…",
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
        setShortages(res.shortages);
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
  const faltaPorDia = useMemo(() => new Map(shortages.map((s) => [s.day, s.amountCents])), [shortages]);
  const porDia = useMemo(() => {
    const map = new Map<string, SangriaLineRow[]>();
    for (const line of lines) {
      const list = map.get(line.day) ?? [];
      list.push(line);
      map.set(line.day, list);
    }
    return map;
  }, [lines]);
  const mes = useMemo(() => {
    const days = new Set<string>([...porDia.keys(), ...faltaPorDia.keys()]);
    return sumAmounts([...days].map((day) => dayAmounts(porDia.get(day) ?? [], faltaPorDia.get(day) ?? 0)));
  }, [porDia, faltaPorDia]);
  const aberto = useMemo(() => {
    const days = [...porDia.keys()].filter((day) => !taken.has(day) && day <= hoje);
    return depositBoleto(lines, days, faltaPorDia);
  }, [porDia, taken, lines, hoje, faltaPorDia]);
  const depositado = useMemo(() => depositBoleto(lines, deposits.map((d) => d.day), faltaPorDia), [lines, deposits, faltaPorDia]);
  const diasAbertos = useMemo(() => marcados.filter((day) => !taken.has(day)), [marcados, taken]);
  const diasRecebiveis = useMemo(
    () => diasAbertos.filter((day) => dayAmounts(porDia.get(day) ?? [], faltaPorDia.get(day) ?? 0).boletoCents > 0),
    [diasAbertos, porDia, faltaPorDia],
  );
  const valorACobrar = depositBoleto(lines, diasRecebiveis, faltaPorDia);
  const linhasForaAbertas = useMemo(
    () => lines.filter((line) => diasAbertos.includes(line.day) && line.kind === "purchase"),
    [lines, diasAbertos],
  );
  const linhasBoletoAbertas = useMemo(
    () => lines.filter((line) => diasAbertos.includes(line.day) && line.kind === "deposit"),
    [lines, diasAbertos],
  );
  const depositosMarcados = useMemo(() => {
    const ids = new Set<string>();
    for (const day of marcados) {
      const id = deposits.find((d) => d.day === day)?.depositId;
      if (id) ids.add(id);
    }
    return [...ids];
  }, [marcados, deposits]);
  const pronto = loaded === faixa;
  const rotuloMarcar = marcados.length === 0 ? "Marcar como" : marcados.length === 1 ? "Marcar como · 1 dia" : `Marcar como · ${marcados.length} dias`;

  function toggleDia(day: string) {
    if (day > hoje) return;
    setMarcados((atual) => (atual.includes(day) ? atual.filter((d) => d !== day) : [...atual, day]));
  }

  async function abrirDesfazer() {
    if (depositosMarcados.length === 0) return;
    let total = marcados.filter((day) => taken.has(day)).length;
    try {
      const counts = await Promise.all(depositosMarcados.map((id) => fetchDepositDayCount(id)));
      total = counts.reduce((sum, n) => sum + n, 0);
    } catch {
      total = marcados.filter((day) => taken.has(day)).length;
    }
    setDiasDesfazer(Math.max(1, total));
    setAcao("desfazer");
  }

  function abrirFalta() {
    const day = marcados[0];
    const atual = day ? shortages.find((s) => s.day === day) : undefined;
    setFaltaLote(reaisCampo(atual?.amountCents ?? 0));
    setMotivoFaltaLote(atual?.note ?? "");
    setAcao("falta");
  }

  async function confirmarAcao() {
    if (!loja || !acao) return;
    if (acao === "fora" && !motivoLote.trim()) {
      show("Informe o motivo.", "danger");
      return;
    }
    if (acao === "desfazer") {
      setDepositando(true);
      try {
        await Promise.all(depositosMarcados.map((id) => undoSangriaDeposit(id)));
        const ids = new Set(depositosMarcados);
        setDeposits((atual) => atual.filter((d) => !ids.has(d.depositId)));
        setMarcados((atual) => atual.filter((day) => !taken.has(day)));
        setReloadKey((n) => n + 1);
        setAcao(null);
        show(depositosMarcados.length > 1 ? "Recebimentos desfeitos." : "Recebimento desfeito.", "success");
      } catch {
        show("Não foi possível desfazer o recebimento. Tente novamente.", "danger");
      } finally {
        setDepositando(false);
      }
      return;
    }
    if (acao === "falta") {
      const day = marcados[0];
      if (!day) return;
      const cents = campoParaCentavos(faltaLote);
      if (cents == null) {
        show("O valor da falta não é válido.", "danger");
        return;
      }
      const base = (porDia.get(day) ?? []).reduce((sum, line) => (line.kind === "purchase" ? sum : sum + line.amountCents), 0);
      if (cents > base) {
        show("A falta não pode passar do valor que iria para o boleto.", "danger");
        return;
      }
      setDepositando(true);
      try {
        const texto = cents === 0 ? "" : motivoFaltaLote.trim();
        await saveSangriaShortage(session.tenantId, loja.id, day, cents, texto);
        setShortages((atual) => {
          const sem = atual.filter((s) => s.day !== day);
          return cents === 0 ? sem : [...sem, { day, amountCents: cents, note: texto }];
        });
        setAcao(null);
        show(cents === 0 ? "Falta removida." : "Falta registrada.", "success");
      } catch {
        show("Não foi possível registrar a falta. Tente novamente.", "danger");
      } finally {
        setDepositando(false);
      }
      return;
    }
    setDepositando(true);
    try {
      if (acao === "recebido") {
        await createSangriaDeposit(session.tenantId, loja.id, diasRecebiveis, taken);
        setMarcados([]);
        setReloadKey((n) => n + 1);
        show("Valor marcado como recebido.", "success");
      } else if (acao === "aCobrar") {
        const next = linhasForaAbertas.map((line) => ({ ...line, kind: "deposit" as const }));
        await saveSangriaLines(next);
        setLines((atual) => atual.map((row) => next.find((n) => n.id === row.id) ?? row));
        show("Sangrias marcadas como a cobrar.", "success");
      } else {
        const motivo = motivoLote.trim();
        const next = linhasBoletoAbertas.map((line) => ({ ...line, kind: "purchase" as const, note: line.note.trim() || motivo }));
        await saveSangriaLines(next);
        setLines((atual) => atual.map((row) => next.find((n) => n.id === row.id) ?? row));
        show("Sangrias marcadas como fora do boleto.", "success");
      }
      setAcao(null);
    } catch (e) {
      show(e instanceof Error ? e.message : "Não foi possível marcar as sangrias. Tente novamente.", "danger");
    } finally {
      setDepositando(false);
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
        subtitle="Confira as sangrias, defina o que entra no boleto e acompanhe os valores recebidos."
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
              {!escolher && loja ? <MarcarComo dias={marcados.length} rotulo={rotuloMarcar} valor={valorACobrar} recebidoOk={diasRecebiveis.length > 0} foraOk={linhasBoletoAbertas.length > 0} cobrarOk={linhasForaAbertas.length > 0} tudoRecebido={marcados.length > 0 && marcados.every((day) => taken.has(day))} podeDesfazer={depositosMarcados.length > 0} onRecebido={() => setAcao("recebido")} onCobrar={() => setAcao("aCobrar")} onFora={() => { setMotivoLote(""); setAcao("fora"); }} onFalta={abrirFalta} onDesfazer={() => void abrirDesfazer()} /> : null}
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
            <EmptyBlock icon="🏬" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : (
          <>
            <ResumoMes aCobrar={aberto} recebido={depositado} fora={mes.foraCents} falta={mes.faltaCents} />
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
                    <DiaCelula
                      key={day ?? `vazio-${i}`}
                      index={i}
                      day={day}
                      hoje={hoje}
                      rows={day ? (porDia.get(day) ?? []) : []}
                      depositado={day ? taken.has(day) : false}
                      marcado={day ? marcados.includes(day) : false}
                      faltaCents={day ? (faltaPorDia.get(day) ?? 0) : 0}
                      onOpen={setDia}
                      onToggle={toggleDia}
                    />
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      {dia && loja ? (
        <DiaModal
          key={dia}
          day={dia}
          rows={porDia.get(dia) ?? []}
          shortage={shortages.find((s) => s.day === dia)}
          deposit={deposits.find((d) => d.day === dia)}
          tenantId={session.tenantId}
          storeId={loja.id}
          onClose={() => setDia(null)}
          onSaved={(nextLines, nextShortage) => {
            setLines((atual) => atual.map((row) => nextLines.find((n) => n.id === row.id) ?? row));
            setShortages((atual) => {
              const sem = atual.filter((s) => s.day !== dia);
              return nextShortage ? [...sem, nextShortage] : sem;
            });
          }}
          onUndo={async (depositId) => {
            try {
              await undoSangriaDeposit(depositId);
              setDeposits((atual) => atual.filter((d) => d.depositId !== depositId));
              setDia(null);
              setReloadKey((n) => n + 1);
              show("Recebimento desfeito.", "success");
            } catch {
              show("Não foi possível desfazer o recebimento. Tente novamente.", "danger");
              throw new Error("undo");
            }
          }}
        />
      ) : null}
      <AcaoModal
        acao={acao}
        gravando={depositando}
        valor={valorACobrar}
        dias={diasRecebiveis.length}
        faltaNoRecebido={acao === "aCobrar" && marcados.some((day) => taken.has(day))}
        foraNoRecebido={acao === "fora" && marcados.some((day) => taken.has(day))}
        motivo={motivoLote}
        onMotivo={setMotivoLote}
        falta={faltaLote}
        onFalta={setFaltaLote}
        motivoFalta={motivoFaltaLote}
        onMotivoFalta={setMotivoFaltaLote}
        diaRecebido={marcados.length === 1 && taken.has(marcados[0]!)}
        recebimentos={depositosMarcados.length}
        diasDesfazer={diasDesfazer}
        onClose={() => {
          if (!depositando) setAcao(null);
        }}
        onConfirm={() => void confirmarAcao()}
      />
    </div>
  );
}

function chipsDoDia(tot: SangriaAmounts, recebido: boolean): Array<{ cor: string; texto: string }> {
  if (tot.totalCents <= 0 && tot.faltaCents <= 0) return [];
  const chips: Array<{ cor: string; texto: string }> = [];
  if (tot.boletoCents > 0) {
    chips.push(
      recebido
        ? { cor: "bg-ok", texto: `Recebido ${money(tot.boletoCents)}` }
        : { cor: "bg-acc", texto: `A cobrar ${money(tot.boletoCents)}` },
    );
  }
  if (tot.foraCents > 0) chips.push({ cor: "bg-chip-blue", texto: `Fora ${money(tot.foraCents)}` });
  if (tot.faltaCents > 0) chips.push({ cor: "bg-bad", texto: `Falta ${money(tot.faltaCents)}` });
  return chips;
}

function DiaCelula({
  index,
  day,
  hoje,
  rows,
  depositado,
  marcado,
  faltaCents,
  onOpen,
  onToggle,
}: {
  index: number;
  day: string | null;
  hoje: string;
  rows: SangriaLineRow[];
  depositado: boolean;
  marcado: boolean;
  faltaCents: number;
  onOpen: (day: string) => void;
  onToggle: (day: string) => void;
}) {
  const tot = dayAmounts(rows, faltaCents);
  const futuro = day != null && day > hoje;
  const abre = day != null && !futuro && (rows.length > 0 || depositado || faltaCents > 0);
  const chips = rows.length > 0 || faltaCents > 0 ? chipsDoDia(tot, depositado) : [];
  const borda = cn(
    "flex min-h-[84px] w-full min-w-0 flex-col items-stretch justify-start border-b border-r border-line p-1.5 text-left sm:min-h-[110px] sm:p-2",
    (index + 1) % 7 === 0 && "border-r-0",
    !day && "bg-bg-1/30",
    marcado && "ring-2 ring-inset ring-t0",
  );
  const miolo = day ? (
    <>
      <span className="flex w-full items-start justify-between gap-1">
        <NumeroDia iso={day} hoje={hoje} />
        {!futuro && (rows.length > 0 || faltaCents > 0) ? (
          <input
            type="checkbox"
            aria-label={`Marcar ${tituloDia(day)}`}
            checked={marcado}
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ accentColor: "var(--acc)" }}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggle(day)}
          />
        ) : null}
      </span>
      {rows.length > 0 || chips.length > 0 ? (
        <div className="mt-1.5 w-full min-w-0">
          {rows.length > 0 ? (
            <p className={cn("whitespace-nowrap font-mono text-[12px] font-extrabold sm:text-[13px]", day === hoje ? "text-acc" : "text-t1")}>
              {money(tot.totalCents)}
            </p>
          ) : null}
          {chips.map((chip) => (
            <ChipDia key={chip.texto} cor={chip.cor}>{chip.texto}</ChipDia>
          ))}
        </div>
      ) : day < hoje && faltaCents <= 0 && !depositado ? (
        <div className="mt-1.5 w-full min-w-0">
          <ChipDia cor="bg-chip-quiet">Sem sangria</ChipDia>
        </div>
      ) : null}
    </>
  ) : null;
  if (!day) return <div className={borda} />;
  if (!abre) return <div className={borda}>{miolo}</div>;
  return (
    <button type="button" className={cn(borda, "hover:bg-bg-3")} onClick={() => onOpen(day)}>
      {miolo}
    </button>
  );
}

function NumeroDia({ iso, hoje }: { iso: string; hoje: string }) {
  const futuro = iso > hoje;
  return (
    <span
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center self-start rounded-full text-[12px] font-bold",
        iso === hoje ? "bg-acc text-white" : futuro ? "text-t2" : "text-t1",
      )}
    >
      {deIso(iso).getDate()}
    </span>
  );
}

function somarMes(iso: string, meses: number): string {
  const d = deIso(inicioDoMes(iso));
  d.setMonth(d.getMonth() + meses);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function reaisCampo(cents: number): string {
  if (cents <= 0) return "";
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function campoParaCentavos(txt: string): number | null {
  if (!txt.trim()) return 0;
  const n = parseNum(txt);
  if (n == null || Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100);
}

function ResumoMes({ aCobrar, recebido, fora, falta }: { aCobrar: number; recebido: number; fora: number; falta: number }) {
  const cards = [
    { label: "A cobrar", value: money(aCobrar), icon: <IconCobrar />, tint: "acc" as const, tooltip: "Valor que ainda entra no próximo boleto." },
    { label: "Recebido", value: money(recebido), icon: <IconRecebido />, tint: "ok" as const, tooltip: "Valor já recebido." },
    { label: "Fora do boleto", value: money(fora), icon: <IconFora />, tint: "warn" as const, tooltip: "Valor destinado a compras, fornecedores, premiações ou outros pagamentos." },
    { label: "Falta", value: money(falta), icon: <IconFalta />, tint: "bad" as const, tooltip: "Valor da sangria que deveria estar no caixa e não foi encontrado." },
  ];
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <QuickStat key={card.label} label={card.label} value={card.value} icon={card.icon} tint={card.tint} tooltip={card.tooltip} />
      ))}
    </div>
  );
}

function MetricasDia({ itens }: { itens: Array<{ label: string; value: string; tom: string }> }) {
  const cols = itens.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : itens.length === 3 ? "sm:grid-cols-3" : itens.length === 2 ? "sm:grid-cols-2" : "";
  return (
    <div className={cn("mb-4 grid grid-cols-1 gap-2", cols)}>
      {itens.map((item) => (
        <div key={item.label} className="min-w-0 rounded-[14px] border border-line bg-bg-1 px-3 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-t2">{item.label}</p>
          <p className={cn("mt-1 truncate font-mono text-lg font-extrabold", item.tom)}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function DiaModal({
  day,
  rows,
  shortage,
  deposit,
  tenantId,
  storeId,
  onClose,
  onSaved,
  onUndo,
}: {
  day: string;
  rows: SangriaLineRow[];
  shortage?: SangriaShortageRow;
  deposit?: SangriaDepositDay;
  tenantId: string;
  storeId: string;
  onClose: () => void;
  onSaved: (lines: SangriaLineRow[], shortage: SangriaShortageRow | null) => void;
  onUndo: (depositId: string) => Promise<void>;
}) {
  const { show } = useToast();
  const [linhas, setLinhas] = useState(rows);
  const [falta, setFalta] = useState(() => reaisCampo(shortage?.amountCents ?? 0));
  const [motivo, setMotivo] = useState(shortage?.note ?? "");
  const [salvando, setSalvando] = useState(false);
  const [confirmarDesfazer, setConfirmarDesfazer] = useState(false);
  const [diasRecebimento, setDiasRecebimento] = useState(1);
  const [desfazendo, setDesfazendo] = useState(false);
  const consulta = rows.length === 0;
  const travado = Boolean(deposit);
  const preview = dayAmounts(
    linhas.map((line) => ({ amountCents: line.amountCents, kind: line.kind, note: line.note })),
    campoParaCentavos(falta) ?? shortage?.amountCents ?? 0,
  );
  const metricas = [
    preview.totalCents > 0 ? { label: "Sangrias", value: money(preview.totalCents), tom: "text-t0" } : null,
    preview.boletoCents > 0 ? { label: travado ? "Recebido" : "A cobrar", value: money(preview.boletoCents), tom: "text-t0" } : null,
    preview.foraCents > 0 ? { label: "Fora do boleto", value: money(preview.foraCents), tom: "text-t0" } : null,
    preview.faltaCents > 0 ? { label: "Falta", value: money(preview.faltaCents), tom: "text-bad" } : null,
  ].filter((item): item is { label: string; value: string; tom: string } => item != null);

  async function salvar() {
    const cents = campoParaCentavos(falta);
    if (cents == null) {
      show("O valor da falta não é válido.", "danger");
      return;
    }
    const base = linhas.reduce((sum, line) => (line.kind === "purchase" ? sum : sum + line.amountCents), 0);
    if (cents > base) {
      show("A falta não pode passar do valor que iria para o boleto.", "danger");
      return;
    }
    if (!travado && linhas.some((line) => line.kind === "purchase" && !line.note.trim())) {
      show("Informe a descrição das sangrias fora do boleto.", "danger");
      return;
    }
    setSalvando(true);
    try {
      for (const line of linhas) {
        const antes = rows.find((row) => row.id === line.id);
        if (!antes || (antes.kind === line.kind && antes.note === line.note)) continue;
        await saveSangriaLine(line.id, { kind: line.kind, note: line.note });
      }
      const texto = cents === 0 ? "" : motivo.trim();
      const mudouFalta = (shortage?.amountCents ?? 0) !== cents || (shortage?.note ?? "") !== texto;
      if (mudouFalta) await saveSangriaShortage(tenantId, storeId, day, cents, texto);
      onSaved(linhas, cents === 0 ? null : { day, amountCents: cents, note: texto });
      show("Sangrias atualizadas.", "success");
      onClose();
    } catch {
      show("Não foi possível salvar a sangria. Tente novamente.", "danger");
    } finally {
      setSalvando(false);
    }
  }

  async function abrirDesfazer() {
    if (!deposit) return;
    let n = 1;
    try {
      n = await fetchDepositDayCount(deposit.depositId);
    } catch {
      n = 1;
    }
    setDiasRecebimento(Math.max(1, n));
    setConfirmarDesfazer(true);
  }

  async function desfazer() {
    if (!deposit) return;
    setDesfazendo(true);
    try {
      await onUndo(deposit.depositId);
    } catch {
      setDesfazendo(false);
    }
  }

  return (
    <>
    <Modal
      open
      onClose={() => {
        if (!salvando && !desfazendo) onClose();
      }}
      size="lg"
      title={tituloDia(day)}
      footer={
        consulta ? (
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
        ) : (
          <>
            {deposit ? (
              <Button variant="outline" onClick={() => void abrirDesfazer()} disabled={salvando || desfazendo}>
                Desfazer recebimento
              </Button>
            ) : null}
            <Button variant="outline" onClick={onClose} disabled={salvando || desfazendo}>
              Cancelar
            </Button>
            <Button onClick={() => void salvar()} disabled={salvando || desfazendo}>
              {salvando ? "Salvando…" : "Salvar"}
            </Button>
          </>
        )
      }
    >
      {rows.length === 0 ? (
        <p className="text-[13.5px] text-t2">Nenhuma sangria neste dia.</p>
      ) : (
        <>
          {metricas.length > 0 ? <MetricasDia itens={metricas} /> : null}
          <ul className="space-y-3">
            {linhas.map((line) => {
              const fora = line.kind === "purchase";
              return (
                <li key={line.id} className="rounded-[14px] border border-line px-3 py-3">
                  <p className="font-mono text-[15px] font-bold text-t0">{money(line.amountCents)}</p>
                  {line.document ? <p className="mt-0.5 text-[12px] text-t2">{line.document}</p> : null}
                  <p className="mt-2 text-[12.5px] font-bold text-t0">Descrição</p>
                  <input
                    className="mt-1.5 w-full rounded-[10px] border border-line bg-bg-1 px-2.5 py-2 text-[13px] text-t0 disabled:opacity-60"
                    value={line.note}
                    aria-label="Descrição"
                    placeholder="Descrição"
                    disabled={travado}
                    onChange={(e) => setLinhas((atual) => atual.map((row) => (row.id === line.id ? { ...row, note: e.target.value } : row)))}
                  />
                  <div className="mt-2">
                    {travado ? (
                      <>
                        <p className="text-[13px] font-semibold text-t0">{fora ? "Fora do boleto" : "Recebido"}</p>
                        <p className="mt-1 text-[12px] text-t2">Desfaça o recebimento para alterar.</p>
                      </>
                    ) : (
                      <Segmented
                        options={[
                          { value: "deposit", label: "A cobrar" },
                          { value: "purchase", label: "Fora do boleto" },
                        ]}
                        value={line.kind}
                        onChange={(kind) => {
                          if (!kind) return;
                          setLinhas((atual) => atual.map((row) => (row.id === line.id ? { ...row, kind } : row)));
                        }}
                      />
                    )}
                    {fora && !travado ? <p className="mt-1 text-[12px] text-t2">A descrição é obrigatória.</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 rounded-[14px] border border-line p-3">
            <p className="text-[12.5px] font-bold text-t0">Falta em dinheiro</p>
            {travado ? <p className="mt-1 text-[12px] text-t2">Este dia já foi recebido. A falta reduz o valor recebido.</p> : null}
            <NumberInput className="mt-2" compact unit="R$" value={falta} aria-label="Valor da falta" onChange={setFalta} />
            <p className="mt-3 text-[12.5px] font-bold text-t0">Motivo da falta</p>
            <input
              className="mt-2 w-full rounded-[10px] border border-line bg-bg-1 px-2.5 py-2 text-[13px] text-t0"
              value={motivo}
              placeholder="Ex.: diferença no caixa"
              aria-label="Motivo da falta"
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
        </>
      )}
    </Modal>
    <Modal
      open={confirmarDesfazer}
      onClose={() => {
        if (!desfazendo) setConfirmarDesfazer(false);
      }}
      title="Desfazer recebimento?"
      footer={
        <>
          <Button variant="outline" onClick={() => setConfirmarDesfazer(false)} disabled={desfazendo}>
            Cancelar
          </Button>
          <Button onClick={() => void desfazer()} disabled={desfazendo}>
            {desfazendo ? "Desfazendo…" : "Desfazer recebimento"}
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] text-t1">
        {diasRecebimento <= 1
          ? "O valor voltará para A cobrar."
          : `Este recebimento inclui ${diasRecebimento} dias. Ao desfazer, os valores de todos eles voltarão para A cobrar.`}
      </p>
    </Modal>
    </>
  );
}

function MarcarComo({
  dias,
  rotulo,
  valor,
  recebidoOk,
  foraOk,
  cobrarOk,
  tudoRecebido,
  podeDesfazer,
  onRecebido,
  onCobrar,
  onFora,
  onFalta,
  onDesfazer,
}: {
  dias: number;
  rotulo: string;
  valor: number;
  recebidoOk: boolean;
  foraOk: boolean;
  cobrarOk: boolean;
  tudoRecebido: boolean;
  podeDesfazer: boolean;
  onRecebido: () => void;
  onCobrar: () => void;
  onFora: () => void;
  onFalta: () => void;
  onDesfazer: () => void;
}) {
  if (dias === 0) return <Button disabled>Marcar como</Button>;
  const itens: DropdownItem[] = [
    ...(podeDesfazer
      ? [
          {
            label: "Desfazer recebimento",
            description: "Devolve o valor recebido para A cobrar.",
            onClick: onDesfazer,
          },
          { divider: true, label: "" },
        ]
      : []),
    {
      label: "Recebido",
      description: recebidoOk
        ? "Registra como recebido o valor a cobrar dos dias selecionados."
        : tudoRecebido
          ? "Estes dias já foram recebidos."
          : "Não há valor a cobrar nos dias selecionados.",
      disabled: !recebidoOk,
      onClick: onRecebido,
    },
    {
      label: "A cobrar",
      description: cobrarOk
        ? "Faz as sangrias dos dias selecionados voltarem para o próximo boleto."
        : tudoRecebido
          ? "Desfaça o recebimento para alterar estes dias."
          : "Não há sangrias fora do boleto nos dias selecionados.",
      disabled: !cobrarOk,
      onClick: onCobrar,
    },
    {
      label: "Fora do boleto",
      description: foraOk
        ? "Retira do boleto as sangrias dos dias selecionados."
        : tudoRecebido
          ? "Desfaça o recebimento para alterar estes dias."
          : "Não há sangrias a cobrar nos dias selecionados.",
      disabled: !foraOk,
      onClick: onFora,
    },
    {
      label: "Registrar falta",
      description: dias === 1 ? "Informe o valor que deveria estar no caixa e não foi encontrado." : "Selecione apenas um dia para registrar a falta.",
      disabled: dias !== 1,
      onClick: onFalta,
    },
  ];
  return (
    <>
      <Dropdown portal align="right" menuClassName="w-[320px]" trigger={<Button>{rotulo}</Button>} items={itens} />
      <span className="text-[13px] font-semibold text-t1">{money(valor)} a cobrar</span>
    </>
  );
}

function AcaoModal({
  acao,
  gravando,
  valor,
  dias,
  faltaNoRecebido,
  foraNoRecebido,
  motivo,
  onMotivo,
  falta,
  onFalta,
  motivoFalta,
  onMotivoFalta,
  diaRecebido,
  recebimentos,
  diasDesfazer,
  onClose,
  onConfirm,
}: {
  acao: AcaoLote | null;
  gravando: boolean;
  valor: number;
  dias: number;
  faltaNoRecebido: boolean;
  foraNoRecebido: boolean;
  motivo: string;
  onMotivo: (value: string) => void;
  falta: string;
  onFalta: (value: string) => void;
  motivoFalta: string;
  onMotivoFalta: (value: string) => void;
  diaRecebido: boolean;
  recebimentos: number;
  diasDesfazer: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const titulo =
    acao === "recebido"
      ? `Marcar ${money(valor)} como recebido?`
      : acao === "aCobrar"
        ? "Marcar como A cobrar?"
        : acao === "fora"
          ? "Fora do boleto"
          : acao === "falta"
            ? "Registrar falta"
            : acao === "desfazer"
              ? "Desfazer recebimento?"
              : "";
  const confirmar =
    acao === "recebido"
      ? "Marcar como recebido"
      : acao === "aCobrar"
        ? "Marcar como A cobrar"
        : acao === "fora"
          ? "Marcar como fora do boleto"
          : acao === "desfazer"
            ? "Desfazer recebimento"
            : "Registrar falta";
  return (
    <Modal
      open={acao != null}
      onClose={onClose}
      title={titulo}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={gravando}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={gravando}>
            {gravando ? (acao === "desfazer" ? "Desfazendo…" : "Salvando…") : confirmar}
          </Button>
        </>
      }
    >
      {acao === "desfazer" ? (
        <p className="text-[13.5px] text-t1">
          {recebimentos > 1
            ? `${recebimentos} recebimentos serão desfeitos. Os valores voltam para A cobrar.`
            : diasDesfazer <= 1
              ? "O valor voltará para A cobrar."
              : `Este recebimento inclui ${diasDesfazer} dias. Ao desfazer, os valores de todos eles voltarão para A cobrar.`}
        </p>
      ) : null}
      {acao === "recebido" ? (
        <p className="text-[13.5px] text-t1">{dias === 1 ? "1 dia será incluído neste recebimento." : `${dias} dias serão incluídos neste recebimento.`}</p>
      ) : null}
      {acao === "aCobrar" ? (
        <p className="text-[13.5px] text-t1">
          {faltaNoRecebido
            ? "As sangrias fora do boleto voltarão a entrar no boleto. Os dias já recebidos não mudam."
            : "As sangrias dos dias selecionados voltarão a entrar no boleto."}
        </p>
      ) : null}
      {acao === "fora" ? (
        <div>
          <p className="text-[13.5px] text-t1">
            {foraNoRecebido
              ? "As sangrias a cobrar dos dias selecionados ficarão fora do boleto. Os dias já recebidos não mudam."
              : "Todas as sangrias dos dias selecionados ficarão fora do boleto."}
          </p>
          <p className="mt-3 text-[12.5px] font-bold text-t0">Motivo</p>
          <input
            className="mt-2 w-full rounded-[10px] border border-line bg-bg-1 px-2.5 py-2 text-[13px] text-t0"
            value={motivo}
            placeholder="Ex.: pagamento de fornecedor"
            aria-label="Motivo"
            onChange={(e) => onMotivo(e.target.value)}
          />
          <p className="mt-1 text-[12px] text-t2">A descrição que a sangria já tem permanece.</p>
        </div>
      ) : null}
      {acao === "falta" ? (
        <div>
          <p className="text-[13.5px] text-t1">Informe o valor que deveria estar no caixa e não foi encontrado.</p>
          {diaRecebido ? <p className="mt-2 text-[13.5px] text-t1">Este dia já foi recebido. A falta reduz o valor recebido.</p> : null}
          <p className="mt-3 text-[12.5px] font-bold text-t0">Valor da falta</p>
          <NumberInput className="mt-2" compact unit="R$" value={falta} aria-label="Valor da falta" onChange={onFalta} />
          <p className="mt-3 text-[12.5px] font-bold text-t0">Motivo da falta</p>
          <input
            className="mt-2 w-full rounded-[10px] border border-line bg-bg-1 px-2.5 py-2 text-[13px] text-t0"
            value={motivoFalta}
            placeholder="Ex.: diferença no caixa"
            aria-label="Motivo da falta"
            onChange={(e) => onMotivoFalta(e.target.value)}
          />
        </div>
      ) : null}
    </Modal>
  );
}

function IconCobrar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

function IconRecebido() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IconFora() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

function IconFalta() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16h.01" />
    </svg>
  );
}
