import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Badge, Button, Card, Checkbox, FormField, Modal, Skeleton, Textarea, Tooltip, useToast } from "@/components/ui";
import { monthCloseSpanFor } from "@/data/wedash/cashCloseMonth";
import {
  applyCloseReview,
  buildCashCloseView,
  closeDayTotals,
  dayAwaitingClose,
  monthCloseSummary,
  type CashCloseBucket,
  type CashCloseLine,
} from "@/data/wedash/cashCloseView";
import { closeBreaks, type CloseBreak } from "@/data/wedash/closeBreak";
import {
  fetchCashCloseMonthMarks,
  fetchCashCloseReviews,
  fetchCashCloseSaleDays,
  fetchCashCloseSales,
  fetchCashCloseSnapshot,
  fetchCloseShifts,
  fetchOpenCashCloseJob,
  fetchLatestCashCloseError,
  requestMonthClose,
  saveCashCloseReview,
  type CashCloseDayMark,
  type CashCloseReview,
  type CashCloseSnapshot,
  type CloseSaleRow,
  type CloseShiftRow,
} from "@/data/wedash/cashCloseRepo";
import { calendarTodayIso } from "@/data/wedash/clock";
import type { Store } from "@/data/wedash/stores";
import { isGestor } from "@/layout/nav-wedash";
import { cn } from "@/lib/cn";
import { brlCent, dataCurta, dataExtenso, deIso, fimDoMes, inicioDoMes, paraIso, somarDias, labelUpper } from "@/lib/format";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { parseNum, SectionHeader, useScopedStores } from "@/pages/operation/shared";

const DIAS = [
  { longo: "Dom", curto: "D" },
  { longo: "Seg", curto: "S" },
  { longo: "Ter", curto: "T" },
  { longo: "Qua", curto: "Q" },
  { longo: "Qui", curto: "Q" },
  { longo: "Sex", curto: "S" },
  { longo: "Sáb", curto: "S" },
];

const money = (cents: number | null) => (cents == null ? "—" : brlCent(cents / 100));

function diffClass(cents: number | null): string {
  if (cents == null || cents === 0) return "text-t2";
  return cents < 0 ? "text-bad" : "text-ok";
}

function totalDia(cents: number): string {
  const abs = brlCent(Math.abs(cents) / 100);
  if (cents < 0) return `−${abs}`;
  if (cents > 0) return `+${abs}`;
  return abs;
}

const MESES_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function somarMes(iso: string, meses: number): string {
  const d = deIso(inicioDoMes(iso));
  return paraIso(new Date(d.getFullYear(), d.getMonth() + meses, 1));
}

function rotuloMesAno(iso: string): string {
  const d = deIso(inicioDoMes(iso));
  return `${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`;
}

function fimDaPagina(ano: number, hojeAno: number): number {
  const alvo = Math.min(ano, hojeAno);
  return hojeAno - Math.floor((hojeAno - alvo) / 12) * 12;
}

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

function centsToField(cents: number): string {
  const abs = Math.abs(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `−${abs}` : abs;
}

function fieldToCents(txt: string): number | null {
  const raw = txt.trim().replace("−", "-");
  if (!raw || raw === "-") return null;
  const neg = raw.startsWith("-");
  const n = parseNum(neg ? raw.slice(1) : raw);
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(n * 100) * (neg ? -1 : 1);
}

type CloseDraft = {
  typed: Partial<Record<CashCloseBucket, string>>;
  acquirer: Partial<Record<CashCloseBucket, string>>;
  justification: string;
  waive: boolean;
};

function CloseTable({
  lines,
  pixPending,
  gestor,
  draft,
  onTyped,
  onAcquirer,
}: {
  lines: CashCloseLine[];
  pixPending: boolean;
  gestor: boolean;
  draft?: CloseDraft;
  onTyped?: (key: CashCloseBucket, value: string) => void;
  onAcquirer?: (key: CashCloseBucket, value: string) => void;
}) {
  if (lines.length === 0) return null;
  const campo =
    "h-9 w-full min-w-0 rounded-[9px] border border-line bg-bg-inset px-2 text-right font-mono text-[13px] font-bold text-t0 outline-none focus:border-acc";
  const cabecalhos = ["Forma", "Millennium", "Digitado", "Total real"];
  return (
    <>
      {pixPending && (
        <Alert className="mb-4" variant="info" title="O fechamento de Pix deste dia já foi solicitado. O total real aparece assim que o arquivo estiver disponível." />
      )}
      <div className="overflow-hidden rounded-[var(--radius-vela-lg)] border border-line bg-bg-2">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              {cabecalhos.map((header, index) => (
                <th
                  key={header}
                  className={cn(
                    "px-3 py-3 text-[10.5px] font-bold uppercase tracking-wide text-t2",
                    index === 0 ? "text-left" : "text-right",
                  )}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((row) => {
              const typedTxt = draft?.typed[row.key] ?? centsToField(row.typedCents);
              const acqTxt = draft?.acquirer[row.key] ?? (row.stoneCents == null ? "" : centsToField(row.stoneCents));
              return (
                <tr key={row.key} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-3 text-t0">{labelUpper(row.label)}</td>
                  <td className="px-3 py-3 text-right font-mono text-[13px] font-bold text-t0">{money(row.systemCents)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {gestor && draft && onTyped ? (
                      <input
                        value={typedTxt}
                        onChange={(e) => onTyped(row.key, e.target.value)}
                        inputMode="decimal"
                        aria-label={`Valor digitado para ${row.label}`}
                        className={campo}
                      />
                    ) : (
                      <span className="font-mono text-[13px] font-bold text-t0">{money(fieldToCents(typedTxt) ?? row.typedCents)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {row.key === "cash" ? (
                      <span className="font-mono text-[13px] font-bold text-t0">{money(fieldToCents(typedTxt) ?? row.typedCents)}</span>
                    ) : gestor && draft && onAcquirer ? (
                      <input
                        value={acqTxt}
                        onChange={(e) => onAcquirer(row.key, e.target.value)}
                        inputMode="decimal"
                        aria-label={`Total real para ${row.label}`}
                        placeholder="—"
                        className={campo}
                      />
                    ) : (
                      <span className="font-mono text-[13px] font-bold text-t0">{money(fieldToCents(acqTxt))}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function QuebraDoDia({ breaks, indisponivel }: { breaks: CloseBreak[]; indisponivel: boolean }) {
  if (indisponivel) return <p className="mt-4 text-[12.5px] text-t2">Não foi possível ver o grupo deste dia.</p>;
  if (breaks.length === 0) return null;
  return (
    <div className="mt-4 flex flex-col gap-2">
      {breaks.map((item) => (
        <div key={item.key} className="rounded-[12px] border border-line bg-bg-1 px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13px] font-bold text-t0">{labelUpper(item.label)}</p>
            <p className={cn("font-mono text-[13px] font-bold", diffClass(item.diffCents))}>{totalDia(item.diffCents)}</p>
          </div>
          {item.diffCents < 0 && (
            <>
              <p className="mt-1 text-[12.5px] text-t1">{item.groups.length === 0 ? "Sem grupo" : item.groups.join(" · ")}</p>
              <p className="mt-0.5 text-[12.5px] text-t2">{item.reason}</p>
            </>
          )}
        </div>
      ))}
    </div>
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

function SeletorMesAno({ iso, hoje, onChange }: { iso: string; hoje: string; onChange: (alvo: string) => void }) {
  const hojeData = deIso(hoje);
  const hojeAno = hojeData.getFullYear();
  const hojeMes = hojeData.getMonth();
  const selecionado = deIso(inicioDoMes(iso));
  const [open, setOpen] = useState(false);
  const [modo, setModo] = useState<"mes" | "ano">("mes");
  const [anoVista, setAnoVista] = useState(selecionado.getFullYear());
  const [anoPagina, setAnoPagina] = useState(hojeAno);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setModo("mes");
    setAnoVista(selecionado.getFullYear());
  }, [open]); // ano lido só ao abrir

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (!open || !triggerRef.current) {
      setPanelPos(null);
      return;
    }
    function colocar() {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const margem = 12;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(vw - margem * 2, 300);
      let left = rect.right - width;
      if (left < margem) left = margem;
      if (left + width > vw - margem) left = Math.max(margem, vw - margem - width);
      const top = Math.min(rect.bottom + 8, vh - margem - 80);
      setPanelPos({ top, left, width, maxHeight: Math.max(200, vh - top - margem) });
    }
    colocar();
    window.addEventListener("resize", colocar);
    window.addEventListener("scroll", colocar, true);
    return () => {
      window.removeEventListener("resize", colocar);
      window.removeEventListener("scroll", colocar, true);
    };
  }, [open]);

  const podeAnoAnt = modo === "ano" ? anoPagina > 12 : anoVista > 2000;
  const podeAnoProx = modo === "ano" ? anoPagina < hojeAno : anoVista < hojeAno;
  const anos = Array.from({ length: 12 }, (_, i) => anoPagina - 11 + i);
  const navBtn = (ok: boolean) =>
    cn("flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line text-t1", ok ? "hover:bg-bg-3" : "cursor-not-allowed opacity-40");

  function escolherMes(month: number) {
    if (anoVista > hojeAno || (anoVista === hojeAno && month > hojeMes)) return;
    onChange(paraIso(new Date(anoVista, month, 1)));
    setOpen(false);
  }

  const painel =
    open && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width, maxHeight: panelPos.maxHeight }}
            className="fixed z-[80] overflow-y-auto rounded-[14px] border border-line bg-bg-2 p-4 shadow-[var(--shadow-vela)]"
          >
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                disabled={!podeAnoAnt}
                aria-label={modo === "ano" ? "Anos anteriores" : "Ano anterior"}
                className={navBtn(podeAnoAnt)}
                onClick={() => (modo === "ano" ? setAnoPagina((n) => n - 12) : setAnoVista((n) => n - 1))}
              >
                <Seta dir="anterior" />
              </button>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-sm font-bold text-t0 hover:bg-bg-3"
                onClick={() => {
                  if (modo === "mes") {
                    setAnoPagina(fimDaPagina(anoVista, hojeAno));
                    setModo("ano");
                    return;
                  }
                  setModo("mes");
                }}
              >
                {modo === "mes" ? anoVista : `${anos[0]} – ${anos[anos.length - 1]}`}
              </button>
              <button
                type="button"
                disabled={!podeAnoProx}
                aria-label={modo === "ano" ? "Próximos anos" : "Próximo ano"}
                className={navBtn(podeAnoProx)}
                onClick={() => (modo === "ano" ? setAnoPagina((n) => Math.min(hojeAno, n + 12)) : setAnoVista((n) => n + 1))}
              >
                <Seta dir="proximo" />
              </button>
            </div>
            {modo === "mes" ? (
              <div className="grid grid-cols-3 gap-1">
                {MESES_PT.map((nome, month) => {
                  const bloqueado = anoVista > hojeAno || (anoVista === hojeAno && month > hojeMes);
                  const ativo = selecionado.getFullYear() === anoVista && selecionado.getMonth() === month;
                  return (
                    <button
                      key={nome}
                      type="button"
                      disabled={bloqueado}
                      onClick={() => escolherMes(month)}
                      className={cn(
                        "h-9 truncate rounded-[9px] px-1 text-[12.5px] font-semibold transition-colors",
                        bloqueado ? "cursor-not-allowed text-t2 opacity-30" : ativo ? "bg-acc text-white" : "text-t1 hover:bg-bg-3",
                      )}
                    >
                      {nome}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {anos.map((ano) => {
                  const bloqueado = ano > hojeAno;
                  const ativo = selecionado.getFullYear() === ano;
                  return (
                    <button
                      key={ano}
                      type="button"
                      disabled={bloqueado}
                      onClick={() => {
                        setAnoVista(ano);
                        setModo("mes");
                      }}
                      className={cn(
                        "h-9 rounded-[9px] text-[12.5px] font-semibold transition-colors",
                        bloqueado ? "cursor-not-allowed text-t2 opacity-30" : ativo ? "bg-acc text-white" : "text-t1 hover:bg-bg-3",
                      )}
                    >
                      {ano}
                    </button>
                  );
                })}
              </div>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={triggerRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={`Mês e ano: ${rotuloMesAno(iso)}`}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-10 min-w-0 items-center gap-2.5 rounded-[var(--radius-vela-sm)] border bg-bg-3 px-3.5 text-left transition-colors",
          open ? "border-acc" : "border-line hover:border-acc",
        )}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={open ? "var(--acc)" : "var(--t2)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span className="truncate text-[13.5px] font-semibold text-t0">{rotuloMesAno(iso)}</span>
      </button>
      {painel}
    </div>
  );
}

function Seta({ dir }: { dir: "anterior" | "proximo" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === "anterior" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

/** Gestão > Fechamento. Calendário do mês, no desenho do Vela. */
export function CashClosePage() {
  const { show } = useToast();
  const { session, lojas, loading: lojasLoading } = useScopedStores();
  const showLojas = useMinSkeleton(lojasLoading);
  const hoje = calendarTodayIso();
  const [anchor, setAnchor] = useState(hoje);
  const [marks, setMarks] = useState<CashCloseDayMark[]>([]);
  const [marksKey, setMarksKey] = useState("");
  const [reviews, setReviews] = useState<CashCloseReview[]>([]);
  const [diasComVenda, setDiasComVenda] = useState<Set<string>>(new Set());
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  const [dias, setDias] = useState<Record<string, CashCloseSnapshot>>({});
  const [quebra, setQuebra] = useState<{ sales: CloseSaleRow[]; shifts: CloseShiftRow[] } | "erro" | null>(null);
  const [diaKey, setDiaKey] = useState("");
  const [erro, setErro] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const storeKey = lojas.map((l) => l.id).join(",");
  const span = monthCloseSpanFor(anchor, hoje);
  const podeAvancar = somarMes(anchor, 1) <= hoje;
  const cells = useMemo(() => celulasDoMes(anchor), [anchor]);
  const from = inicioDoMes(anchor);
  const toBruto = fimDoMes(anchor);
  const to = toBruto < hoje ? toBruto : hoje;
  const faixaKey = `${storeKey}|${from}|${to}|${reloadKey}`;

  useEffect(() => {
    if (!syncing) return;
    let stop = false;
    const tick = async () => {
      const open = await fetchOpenCashCloseJob(session.tenantId);
      if (stop) return;
      if (!open) {
        const message = await fetchLatestCashCloseError(session.tenantId);
        if (stop) return;
        setSyncing(false);
        setReloadKey((n) => n + 1);
        if (message) show(message, "danger");
      }
    };
    const id = window.setInterval(() => void tick(), 3000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [syncing, session.tenantId, show]);

  useEffect(() => {
    if (lojasLoading || lojas.length === 0 || from > to) return;
    let cancelled = false;
    setErro(false);
    const ids = lojas.map((l) => l.id);
    void Promise.all([
      fetchCashCloseMonthMarks(session.tenantId, ids, from, to),
      fetchCashCloseReviews(session.tenantId, ids, from, to),
      fetchCashCloseSaleDays(session.tenantId, ids, from, to),
    ])
      .then(([rows, ajustes, vendas]) => {
        if (cancelled) return;
        setMarks(rows);
        setReviews(ajustes);
        setDiasComVenda(vendas);
        setMarksKey(faixaKey);
      })
      .catch(() => {
        if (!cancelled) setErro(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lojasLoading, session.tenantId, lojas, from, to, faixaKey]);

  useEffect(() => {
    if (lojasLoading || !diaAberto || lojas.length === 0 || diaAberto > hoje) return;
    let cancelled = false;
    setErro(false);
    const key = `${storeKey}|${diaAberto}|${reloadKey}`;
    const ids = lojas.map((loja) => loja.id);
    void Promise.all([
      Promise.all(lojas.map((loja) => fetchCashCloseSnapshot(session.tenantId, loja.id, diaAberto).then((snap) => [loja.id, snap] as const))),
      fetchCashCloseSales(session.tenantId, ids, diaAberto).catch(() => null),
      fetchCloseShifts(session.tenantId, ids).catch(() => null),
    ])
      .then(([rows, sales, shifts]) => {
        if (cancelled) return;
        setDias(Object.fromEntries(rows));
        setQuebra(sales && shifts ? { sales, shifts } : "erro");
        setDiaKey(key);
      })
      .catch(() => {
        if (!cancelled) setErro(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lojasLoading, diaAberto, session.tenantId, lojas, hoje, storeKey, reloadKey]);

  const analise = useMemo(() => {
    if (marksKey !== faixaKey) return null;
    const porDia = new Map<string, { systemCents: number; typedCents: number; hasMillennium: boolean; hasLines: boolean }>();
    const rows: Array<{ day: string; systemCents: number; typedCents: number; pending: boolean }> = [];
    for (const mark of marks) {
      const review = reviews.find((r) => r.storeId === mark.storeId && r.day === mark.day) ?? null;
      const view = buildCashCloseView(mark.snap);
      const lines = applyCloseReview(view.lines, review, {
        cardPending: mark.cardPending,
        pixRequested: mark.snap.pixRequested,
      });
      const totals = closeDayTotals(lines);
      const awaiting = dayAwaitingClose({
        hasMillennium: mark.snap.millennium.length > 0,
        cardPending: mark.cardPending,
        pixRequested: mark.snap.pixRequested,
        pixCents: mark.snap.pixCents,
      });
      if (mark.day < hoje) {
        rows.push({ day: mark.day, systemCents: totals.systemCents, typedCents: totals.typedCents, pending: awaiting });
      }
      const atual = porDia.get(mark.day) ?? { systemCents: 0, typedCents: 0, hasMillennium: false, hasLines: false };
      atual.systemCents += totals.systemCents;
      atual.typedCents += totals.typedCents;
      atual.hasMillennium = atual.hasMillennium || mark.snap.millennium.length > 0;
      atual.hasLines = atual.hasLines || lines.length > 0;
      porDia.set(mark.day, atual);
    }
    return { resumo: monthCloseSummary(rows), porDia };
  }, [marks, reviews, marksKey, faixaKey, hoje]);

  function faceDoDia(day: string): { kind: "vazio" | "zero" | "pendente" | "hoje" | "total"; diffCents: number } {
    const info = analise?.porDia.get(day);
    if (day === hoje) return { kind: "hoje", diffCents: info ? Math.max(info.systemCents, info.typedCents) : 0 };
    if (!info || (info.systemCents === 0 && info.typedCents === 0)) return { kind: "zero", diffCents: 0 };
    if (!info.hasMillennium && !info.hasLines) return { kind: "vazio", diffCents: 0 };
    if (!info.hasMillennium) return { kind: "pendente", diffCents: 0 };
    const diffCents = info.typedCents - info.systemCents;
    if (diffCents === 0 && !diasComVenda.has(day)) return { kind: "pendente", diffCents: 0 };
    return { kind: "total", diffCents };
  }

  function abrirDia(iso: string) {
    if (iso > hoje) return;
    if (iso < hoje && faceDoDia(iso).kind === "zero") return;
    setDiaAberto(iso);
  }

  function irParaMes(alvo: string) {
    setAnchor(inicioDoMes(alvo) === inicioDoMes(hoje) ? hoje : inicioDoMes(alvo));
  }

  function mover(dir: -1 | 1) {
    if (dir > 0 && !podeAvancar) return;
    irParaMes(somarMes(anchor, dir));
  }

  async function sincronizar() {
    setSyncing(true);
    const r = await requestMonthClose(lojas.map((l) => l.id), anchor);
    if (!r.ok) {
      setSyncing(false);
      show(r.message, "danger");
    }
  }

  const diaPronto = diaAberto != null && diaKey === `${storeKey}|${diaAberto}|${reloadKey}`;
  const navBtn =
    "flex h-10 w-10 items-center justify-center rounded-[11px] border border-line bg-bg-2 text-t1 hover:border-line-2 hover:text-t0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-t1";

  return (
    <div>
      <SectionHeader
        section="Gestão"
        title="Fechamento"
        subtitle="Confira o fechamento diário comparando o Millennium, o digitado e o total real."
      />
      <div className="mt-6 pb-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <h2 className="text-xl font-extrabold text-t0 sm:text-[26px]">{rotuloMesAno(anchor)}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <SeletorMesAno iso={anchor} hoje={hoje} onChange={irParaMes} />
            <button type="button" aria-label="Mês anterior" className={navBtn} onClick={() => mover(-1)}>
              <Seta dir="anterior" />
            </button>
            <button type="button" aria-label="Próximo mês" className={navBtn} disabled={!podeAvancar} onClick={() => mover(1)}>
              <Seta dir="proximo" />
            </button>
            <Tooltip
              label={
                span
                  ? `Busca os fechamentos de ${dataCurta(span.from)} a ${dataCurta(span.to)}. Dias que já têm fechamento não são buscados novamente.`
                  : "Os fechamentos deste mês estarão disponíveis a partir de amanhã."
              }
            >
              <Button onClick={() => void sincronizar()} disabled={syncing || !span || lojas.length === 0}>
                {syncing ? "Buscando…" : "Buscar fechamentos"}
              </Button>
            </Tooltip>
          </div>
        </div>
        {erro ? <Alert className="mb-4" variant="danger" title="Não foi possível carregar o fechamento. Tente novamente." /> : null}
        {showLojas ? (
          <Skeleton className="h-[520px] w-full rounded-[18px]" />
        ) : lojas.length === 0 ? (
          <Card>
            <EmptyBlock icon="🏬" title="Nenhuma loja disponível" description="Não há lojas disponíveis para este acesso." />
          </Card>
        ) : (
          <>
            {analise ? (
              <ResumoMes resumo={analise.resumo} />
            ) : (
              <Skeleton className="mb-4 h-[76px] w-full rounded-[18px]" />
            )}
            <Mes hoje={hoje} cells={cells} faceDoDia={faceDoDia} onOpen={abrirDia} />
          </>
        )}
      </div>
      <DiaModal
        day={diaAberto}
        lojas={lojas}
        snaps={dias}
        reviews={reviews}
        quebra={diaPronto ? quebra : null}
        pronto={diaPronto}
        gestor={isGestor(session.role)}
        fechado={diaAberto != null && diaAberto < hoje}
        tenantId={session.tenantId}
        onClose={() => setDiaAberto(null)}
        onSaved={(next) => {
          setReviews((atual) => {
            const sem = atual.filter((r) => !(r.storeId === next.storeId && r.day === next.day));
            return [...sem, next];
          });
        }}
      />
    </div>
  );
}

function ResumoMes({ resumo }: { resumo: { systemCents: number; typedCents: number; diffCents: number; pendingDays: number } }) {
  const itens = [
    { label: "Total digitado", valor: money(resumo.typedCents), detalhe: `Millennium: ${money(resumo.systemCents)}`, tom: "text-t0" },
    { label: "Diferença", valor: money(resumo.diffCents), detalhe: "Digitado − Millennium", tom: diffClass(resumo.diffCents) },
    { label: "Dias pendentes", valor: String(resumo.pendingDays), detalhe: "Ainda não fechados", tom: resumo.pendingDays > 0 ? "text-warn" : "text-t0" },
  ];
  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {itens.map((item) => (
        <Card key={item.label} padding="sm">
          <p className="text-[11px] font-bold uppercase tracking-wide text-t2">{item.label}</p>
          <p className={cn("mt-1 truncate font-mono text-xl font-extrabold", item.tom)}>{item.valor}</p>
          <p className="mt-0.5 text-[11px] text-t2">{item.detalhe}</p>
        </Card>
      ))}
    </div>
  );
}

function Diff({ cents }: { cents: number | null }) {
  return <span className={`font-mono text-[13px] font-bold ${diffClass(cents)}`}>{money(cents)}</span>;
}

function ContaDoDia({ systemCents, typedCents }: { systemCents: number; typedCents: number }) {
  const diff = typedCents - systemCents;
  return (
    <div className="mb-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-[14px] border border-line bg-bg-1 px-3 py-3 text-[13px]">
      <span className="text-t2">Digitado</span>
      <span className="font-mono font-bold text-t0">{money(typedCents)}</span>
      <span className="text-t2">−</span>
      <span className="text-t2">Millennium</span>
      <span className="font-mono font-bold text-t0">{money(systemCents)}</span>
      <span className="text-t2">=</span>
      <span className="text-t2">Diferença</span>
      <Diff cents={diff} />
    </div>
  );
}

function Mes({
  hoje,
  cells,
  faceDoDia,
  onOpen,
}: {
  hoje: string;
  cells: Array<string | null>;
  faceDoDia: (day: string) => { kind: "vazio" | "zero" | "pendente" | "hoje" | "total"; diffCents: number };
  onOpen: (iso: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-[18px] border border-line bg-bg-2 shadow-[var(--shadow-vela)]">
      <div className="grid grid-cols-7">
        {DIAS.map((d, i) => (
          <div key={i} className="border-b border-line px-2 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-t2">
            <span className="hidden sm:inline">{d.longo}</span>
            <span className="sm:hidden">{d.curto}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          const face = day && day <= hoje ? faceDoDia(day) : null;
          const cor =
            face?.kind === "pendente"
              ? "bg-warn-soft"
              : face?.kind === "total" && face.diffCents < 0
                ? "bg-bad-soft"
                : face?.kind === "total" && face.diffCents > 0
                  ? "bg-ok-soft"
                  : "";
          const borda = cn(
            "min-h-[84px] border-b border-r border-line p-1.5 text-left sm:min-h-[110px] sm:p-2",
            (i + 1) % 7 === 0 && "border-r-0",
            !day && "bg-bg-1/30",
            cor,
          );
          if (!day) return <div key={`vazio-${i}`} className={borda} />;
          const futuro = day > hoje;
          const miolo = (
            <>
              <NumeroDia iso={day} hoje={hoje} />
              {face?.kind === "pendente" && (
                <Badge variant="warning" className="mt-2 px-2 py-0.5 text-[10px]">
                  Pendente
                </Badge>
              )}
              {(face?.kind === "hoje" || face?.kind === "total") && (
                <div className="mt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-t2">Total</p>
                  <p
                    className={cn(
                      "truncate font-mono text-[12px] font-extrabold sm:text-[13px]",
                      face.kind === "total" ? diffClass(face.diffCents) : "text-t1",
                    )}
                  >
                    {face.kind === "hoje" ? brlCent(face.diffCents / 100) : totalDia(face.diffCents)}
                  </p>
                </div>
              )}
            </>
          );
          if (futuro || face?.kind === "zero") return <div key={day} className={borda}>{miolo}</div>;
          const pintado = face?.kind === "pendente" || (face?.kind === "total" && face.diffCents !== 0);
          return (
            <button key={day} type="button" className={cn(borda, pintado ? "hover:brightness-95" : "hover:bg-bg-3")} onClick={() => onOpen(day)}>
              {miolo}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DiaModal({
  day,
  lojas,
  snaps,
  reviews,
  quebra,
  pronto,
  gestor,
  fechado,
  tenantId,
  onClose,
  onSaved,
}: {
  day: string | null;
  lojas: Store[];
  snaps: Record<string, CashCloseSnapshot>;
  reviews: CashCloseReview[];
  quebra: { sales: CloseSaleRow[]; shifts: CloseShiftRow[] } | "erro" | null;
  pronto: boolean;
  gestor: boolean;
  fechado: boolean;
  tenantId: string;
  onClose: () => void;
  onSaved: (review: CashCloseReview) => void;
}) {
  const { show } = useToast();
  const [drafts, setDrafts] = useState<Record<string, CloseDraft>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!day || !pronto) return;
    const next: Record<string, CloseDraft> = {};
    for (const loja of lojas) {
      const snap = snaps[loja.id];
      if (!snap) continue;
      const review = reviews.find((r) => r.storeId === loja.id && r.day === day);
      const typed: CloseDraft["typed"] = {};
      const acquirer: CloseDraft["acquirer"] = {};
      for (const line of buildCashCloseView(snap).lines) {
        const salvo = review?.typedCents[line.key] ?? (line.key === "cash" ? review?.cashTypedCents : null);
        typed[line.key] = centsToField(salvo ?? line.typedCents);
        const manual = review?.acquirerCents[line.key];
        const shown = manual ?? line.stoneCents;
        acquirer[line.key] = shown == null ? "" : centsToField(shown);
      }
      next[loja.id] = {
        typed,
        acquirer,
        justification: review?.justification ?? "",
        waive: review?.waive ?? false,
      };
    }
    setDrafts(next);
  }, [day, pronto, lojas, snaps, reviews]);

  const comDados = day
    ? lojas.filter((loja) => {
        const snap = snaps[loja.id];
        return snap && buildCashCloseView(snap).lines.some((line) => line.systemCents !== 0 || line.typedCents !== 0 || line.stoneCents != null);
      })
    : [];

  async function salvar() {
    if (!day) return;
    setBusy(true);
    for (const loja of comDados) {
      const snap = snaps[loja.id];
      const draft = drafts[loja.id];
      if (!snap || !draft) continue;
      const linhas = buildCashCloseView(snap).lines;
      const typedCents: CashCloseReview["typedCents"] = {};
      const acquirerCents: CashCloseReview["acquirerCents"] = {};
      let invalido = false;
      for (const line of linhas) {
        const typedRaw = draft.typed[line.key] ?? "";
        const typed = fieldToCents(typedRaw);
        if (typedRaw.trim() && typed == null) {
          invalido = true;
          show(`O valor digitado para ${line.label} não é válido.`, "danger");
          break;
        }
        if (typed != null && typed !== line.typedCents) typedCents[line.key] = typed;
        if (line.key === "cash") continue;
        const raw = draft.acquirer[line.key] ?? "";
        const real = fieldToCents(raw);
        if (raw.trim() && real == null) {
          invalido = true;
          show(`O total real para ${line.label} não é válido.`, "danger");
          break;
        }
        if (real != null && real !== line.stoneCents) acquirerCents[line.key] = real;
      }
      if (invalido) {
        setBusy(false);
        return;
      }
      const cash = linhas.find((l) => l.key === "cash");
      const cashTyped = typedCents.cash ?? cash?.typedCents ?? null;
      const falta = cash != null && cashTyped != null && cashTyped < cash.systemCents;
      if (draft.waive && !falta) {
        setBusy(false);
        show("A falta só pode ser assumida quando o valor digitado em dinheiro for menor que o valor do Millennium.", "danger");
        return;
      }
      if (draft.waive && draft.justification.trim().length === 0) {
        setBusy(false);
        show("Informe uma justificativa para não descontar esta falta.", "danger");
        return;
      }
      const saved: CashCloseReview = {
        storeId: loja.id,
        day,
        cashTypedCents: typedCents.cash ?? null,
        justification: falta ? draft.justification.trim() : "",
        waive: falta && draft.waive,
        typedCents,
        acquirerCents,
      };
      const r = await saveCashCloseReview({ tenantId, ...saved });
      if (!r.ok) {
        setBusy(false);
        show(r.message, "danger");
        return;
      }
      onSaved(saved);
    }
    setBusy(false);
    show("Fechamento atualizado.", "success");
    onClose();
  }

  return (
    <Modal
      open={day != null}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={day ? tituloDia(day) : ""}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {gestor ? "Cancelar" : "Voltar"}
          </Button>
          {gestor && comDados.length > 0 && (
            <Button onClick={() => void salvar()} disabled={busy || !pronto}>
              {busy ? "Salvando…" : "Salvar"}
            </Button>
          )}
        </>
      }
    >
      {!pronto ? (
        <Skeleton className="h-40 w-full" />
      ) : comDados.length === 0 ? (
        <p className="text-[13.5px] leading-relaxed text-t1">Ainda não há fechamento neste dia.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {comDados.map((loja) => {
            const snap = snaps[loja.id];
            if (!snap) return null;
            const view = buildCashCloseView(snap);
            const cash = view.lines.find((l) => l.key === "cash");
            const draft = drafts[loja.id];
            const cashTyped = draft ? fieldToCents(draft.typed.cash ?? "") : null;
            const falta = cash != null && cashTyped != null && cashTyped < cash.systemCents;
            const linhas = view.lines.map((line) => {
              const typed = draft ? fieldToCents(draft.typed[line.key] ?? "") : null;
              return typed == null ? line : { ...line, typedCents: typed };
            });
            const conta = closeDayTotals(linhas);
            return (
              <section key={loja.id}>
                {lojas.length > 1 && <p className="mb-3 text-[13px] font-bold text-t0">{loja.fantasia}</p>}
                {fechado ? (
                  <ContaDoDia systemCents={conta.systemCents} typedCents={conta.typedCents} />
                ) : (
                  <p className="mb-4 text-[13px] text-t2">Este dia ainda não fechou. A sobra ou a quebra aparece a partir de amanhã.</p>
                )}
                {cash?.openingCents != null && (
                  <p className="mb-3 text-[12px] text-t2">
                    Fundo de caixa: {brlCent(cash.openingCents / 100)}
                    {cash.sangriaCents != null ? ` · Sangria: ${brlCent(cash.sangriaCents / 100)}` : ""}
                  </p>
                )}
                <CloseTable
                  lines={view.lines}
                  pixPending={view.pixPending}
                  gestor={gestor}
                  draft={draft}
                  onTyped={(key, value) =>
                    setDrafts((atual) => ({
                      ...atual,
                      [loja.id]: { ...(atual[loja.id] ?? draft!), typed: { ...(atual[loja.id]?.typed ?? {}), [key]: value } },
                    }))
                  }
                  onAcquirer={(key, value) =>
                    setDrafts((atual) => ({
                      ...atual,
                      [loja.id]: { ...(atual[loja.id] ?? draft!), acquirer: { ...(atual[loja.id]?.acquirer ?? {}), [key]: value } },
                    }))
                  }
                />
                {fechado && (
                  <QuebraDoDia
                    indisponivel={quebra === "erro"}
                    breaks={
                      quebra && quebra !== "erro"
                        ? closeBreaks({
                            lines: linhas,
                            sales: quebra.sales.filter((sale) => sale.storeId === loja.id),
                            shifts: quebra.shifts.filter((shift) => shift.storeId === loja.id),
                            timeZone: loja.fuso || "America/Campo_Grande",
                            pixPending: view.pixPending,
                          })
                        : []
                    }
                  />
                )}
                {falta && draft && (
                  <div className="mt-4 flex flex-col gap-3">
                    <FormField label="Justificativa">
                      <Textarea
                        value={draft.justification}
                        onChange={(e) =>
                          setDrafts((atual) => ({
                            ...atual,
                            [loja.id]: { ...draft, justification: e.target.value },
                          }))
                        }
                        placeholder="Ex.: diferença no troco"
                        disabled={!gestor}
                      />
                    </FormField>
                    {gestor && (
                      <Checkbox
                        label="Não descontar da equipe. A loja assume esta falta."
                        checked={draft.waive}
                        onChange={(e) =>
                          setDrafts((atual) => ({
                            ...atual,
                            [loja.id]: { ...draft, waive: e.target.checked },
                          }))
                        }
                      />
                    )}
                    {!gestor && draft.waive && <p className="text-[12.5px] text-t2">A loja assumiu esta falta. Ela não entra no desconto.</p>}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
