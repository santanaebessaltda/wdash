import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Card, Checkbox, Modal, Skeleton, useToast } from "@/components/ui";
import { calendarTodayIso } from "@/data/wedash/clock";
import { fetchLatestCashCloseError, fetchNavMonthFloor, fetchOpenCashCloseJob, requestSangriaMonth } from "@/data/wedash/cashCloseRepo";
import { fetchSyncWatermark } from "@/data/wedash/salesRepo";
import {
  createSangriaDeposit,
  fetchSangriaMonth,
  saveSangriaLine,
  saveSangriaShortage,
  undoSangriaDeposit,
  type SangriaDepositDay,
  type SangriaLineRow,
  type SangriaShortageRow,
} from "@/data/wedash/sangriaRepo";
import { dayAmounts, depositBoleto, sumAmounts, type SangriaKind } from "@/data/wedash/sangriaMath";
import { brlCent, dataExtenso, deIso, fimDoMes, inicioDoMes, somarDias } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { refreshMomentTitle, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { useScope } from "@/pages/dashboard/useScope";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { SectionHeader, SelectStoreCard, parseNum, pickOneStore, useScopedStores } from "@/pages/operation/shared";
import { monthNavBtn, SeletorMesAno, Seta } from "@/pages/cash-close/CashClosePage";
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
  const [shortages, setShortages] = useState<SangriaShortageRow[]>([]);
  const [loaded, setLoaded] = useState("");
  const [erro, setErro] = useState(false);
  const [dia, setDia] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [depositando, setDepositando] = useState(false);
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
  const shortagesRef = useRef(shortages);
  shortagesRef.current = shortages;
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
  const boletoMarcado = depositBoleto(lines, marcados, faltaPorDia);
  const linhasDia = dia ? (porDia.get(dia) ?? []) : [];
  const contaDia = dayAmounts(linhasDia, dia ? (faltaPorDia.get(dia) ?? 0) : 0);
  const faltaDia = dia ? shortages.find((s) => s.day === dia) : undefined;
  const baseBoletoDia = linhasDia.reduce((sum, line) => (line.kind === "purchase" ? sum : sum + line.amountCents), 0);
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

  async function salvarFalta(valor: string, note: string) {
    if (!loja || !dia) return;
    const cents = campoParaCentavos(valor);
    if (cents == null) {
      show("O valor da falta não é válido.", "danger");
      return;
    }
    if (cents > baseBoletoDia) {
      show("A falta não pode passar do valor que iria para o boleto.", "danger");
      return;
    }
    const texto = cents === 0 ? "" : note.trim();
    const atual = shortagesRef.current.find((s) => s.day === dia);
    if ((atual?.amountCents ?? 0) === cents && (atual?.note ?? "") === texto) return;
    const next =
      cents === 0
        ? shortagesRef.current.filter((s) => s.day !== dia)
        : [...shortagesRef.current.filter((s) => s.day !== dia), { day: dia, amountCents: cents, note: texto }];
    shortagesRef.current = next;
    setShortages(next);
    try {
      await saveSangriaShortage(session.tenantId, loja.id, dia, cents, texto);
    } catch {
      show("Não foi possível salvar a falta. Tente novamente.", "danger");
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
        subtitle="Marque os dias e faça o depósito. O que saiu para outra coisa, ou faltou, não entra no boleto."
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
              {!escolher && loja ? (
                <Button disabled={marcados.length === 0 || depositando} onClick={() => void depositar()}>
                  {depositando ? "Depositando…" : marcados.length ? `Fazer depósito · ${money(boletoMarcado)}` : "Fazer depósito"}
                </Button>
              ) : null}
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
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Card padding="sm">
                <p className="text-[11px] font-bold uppercase tracking-wide text-t2">Em aberto</p>
                <p className="mt-1 truncate font-mono text-xl font-extrabold text-t0">{money(aberto)}</p>
                <p className="mt-0.5 text-[11px] text-t2">Boleto dos dias ainda sem depósito</p>
              </Card>
              <Card padding="sm">
                <p className="text-[11px] font-bold uppercase tracking-wide text-t2">Depositado</p>
                <p className={cn("mt-1 truncate font-mono text-xl font-extrabold", depositado > 0 ? "text-ok" : "text-t0")}>{money(depositado)}</p>
                <p className="mt-0.5 text-[11px] text-t2">Boleto dos dias já depositados neste mês</p>
              </Card>
              <Card padding="sm">
                <p className="text-[11px] font-bold uppercase tracking-wide text-t2">Fora do boleto</p>
                <p className={cn("mt-1 truncate font-mono text-xl font-extrabold", mes.foraCents > 0 ? "text-warn" : "text-t0")}>{money(mes.foraCents)}</p>
                <p className="mt-0.5 text-[11px] text-t2">Compra, premiação, fornecedor</p>
              </Card>
              <Card padding="sm">
                <p className="text-[11px] font-bold uppercase tracking-wide text-t2">Falta</p>
                <p className={cn("mt-1 truncate font-mono text-xl font-extrabold", mes.faltaCents > 0 ? "text-bad" : "text-t0")}>{money(mes.faltaCents)}</p>
                <p className="mt-0.5 text-[11px] text-t2">Dinheiro que faltou nas sangrias</p>
              </Card>
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
          <>
            <div className="mb-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px]">
              <span className="text-t2">Total</span>
              <span className="font-mono font-bold text-t0">{money(contaDia.totalCents)}</span>
              <span className="text-t2">· Boleto</span>
              <span className="font-mono font-bold text-t0">{money(contaDia.boletoCents)}</span>
              {contaDia.faltaCents > 0 ? (
                <>
                  <span className="text-t2">· Falta</span>
                  <span className="font-mono font-bold text-bad">{money(contaDia.faltaCents)}</span>
                </>
              ) : null}
            </div>
            <p className="mb-3 text-[12.5px] text-t2">Marque o que não entra no boleto: compra, premiação, fornecedor ou outro uso.</p>
            <ul className="space-y-3">
              {linhasDia.map((line) => {
                const fora = line.kind === "purchase";
                return (
                  <li key={line.id} className={cn("rounded-[14px] border border-line p-3", fora && "bg-warn-soft")}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-[15px] font-bold text-t0">{money(line.amountCents)}</p>
                        {line.document ? <p className="mt-0.5 text-[12px] text-t2">{line.document}</p> : null}
                      </div>
                      <Checkbox
                        checked={fora}
                        label="Não entra no boleto"
                        onChange={(e) => void mudar(line, { kind: e.target.checked ? "purchase" : "deposit" })}
                      />
                    </div>
                    <input
                      className="mt-2 w-full rounded-[10px] border border-line bg-bg-1 px-2.5 py-2 text-[13px] text-t0"
                      defaultValue={line.note}
                      key={`${line.id}:${line.note}`}
                      aria-label={fora ? "O que foi feito com este valor" : "Observação"}
                      placeholder={fora ? "Ex.: compra, premiação, fornecedor" : "Observação"}
                      onBlur={(e) => {
                        const note = e.target.value;
                        if (note !== line.note) void mudar(line, { note });
                      }}
                    />
                  </li>
                );
              })}
            </ul>
            {dia ? <FaltaDia key={dia} amountCents={faltaDia?.amountCents ?? 0} note={faltaDia?.note ?? ""} onCommit={(valor, texto) => void salvarFalta(valor, texto)} /> : null}
          </>
        )}
      </Modal>
    </div>
  );
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
  const abre = day != null && !futuro && (rows.length > 0 || depositado);
  const borda = cn(
    "flex min-h-[84px] flex-col items-start justify-start border-b border-r border-line p-1.5 text-left sm:min-h-[110px] sm:p-2",
    (index + 1) % 7 === 0 && "border-r-0",
    !day && "bg-bg-1/30",
    depositado && "bg-ok-soft",
    marcado && "ring-2 ring-inset ring-acc",
    futuro && "opacity-40",
  );
  const miolo = day ? (
    <>
      <span className="flex w-full items-start justify-between gap-1">
        <NumeroDia iso={day} hoje={hoje} />
        {!futuro && !depositado && rows.length > 0 ? (
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
      {rows.length > 0 ? (
        <div className="mt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-t2">Total</p>
          <p className="whitespace-nowrap font-mono text-[12px] font-extrabold text-t2 sm:text-[13px]">{money(tot.totalCents)}</p>
          {tot.foraCents > 0 ? (
            <Badge variant="warning" className="mt-1 px-2 py-0.5 text-[10px]">
              fora {money(tot.foraCents)}
            </Badge>
          ) : null}
          {tot.faltaCents > 0 ? (
            <Badge variant="danger" className="mt-1 px-2 py-0.5 text-[10px]">
              falta {money(tot.faltaCents)}
            </Badge>
          ) : null}
        </div>
      ) : null}
    </>
  ) : null;
  if (!day) return <div className={borda} />;
  if (!abre) return <div className={borda}>{miolo}</div>;
  return (
    <button type="button" className={cn(borda, depositado ? "hover:brightness-95" : "hover:bg-bg-3")} onClick={() => onOpen(day)}>
      {miolo}
    </button>
  );
}

function NumeroDia({ iso, hoje }: { iso: string; hoje: string }) {
  const futuro = iso > hoje;
  return (
    <span
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold",
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

function FaltaDia({
  amountCents,
  note,
  onCommit,
}: {
  amountCents: number;
  note: string;
  onCommit: (valor: string, texto: string) => void;
}) {
  const [valor, setValor] = useState(() => reaisCampo(amountCents));
  const [texto, setTexto] = useState(note);
  const valorRef = useRef(valor);
  const textoRef = useRef(texto);
  valorRef.current = valor;
  textoRef.current = texto;
  return (
    <div className="mt-4 rounded-[14px] border border-line p-3">
      <p className="text-[12.5px] font-bold text-t0">Falta</p>
      <p className="mt-0.5 text-[12px] text-t2">Dinheiro da sangria que não estava no caixa. Não entra no boleto.</p>
      <input
        inputMode="decimal"
        className="mt-2 h-9 w-full rounded-[10px] border border-line bg-bg-1 px-2.5 text-right font-mono text-[13px] font-bold text-t0 outline-none focus:border-acc"
        value={valor}
        placeholder="0,00"
        aria-label="Valor da falta"
        onChange={(e) => setValor(e.target.value)}
        onBlur={() => {
          const cents = campoParaCentavos(valorRef.current);
          const mostrado = cents != null && cents > 0 ? reaisCampo(cents) : valorRef.current;
          valorRef.current = mostrado;
          if (mostrado !== valor) setValor(mostrado);
          onCommit(mostrado, textoRef.current);
        }}
      />
      <input
        className="mt-2 w-full rounded-[10px] border border-line bg-bg-1 px-2.5 py-2 text-[13px] text-t0"
        value={texto}
        placeholder="Por que faltou"
        aria-label="Justificativa da falta"
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => onCommit(valorRef.current, textoRef.current)}
      />
    </div>
  );
}
