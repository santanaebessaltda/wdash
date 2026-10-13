import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Badge, Button, Card, DateRangePicker, Modal, Skeleton, Tooltip, useToast, QUICK_RANGES_CALENDARIO, type DatePresetId, type DateRangeChangeMeta } from "@/components/ui";
import { EmployeeWithdrawal } from "@/pages/cash-close/EmployeeWithdrawal";
import { monthCloseSpanFor, monthsTouched } from "@/data/wedash/cashCloseMonth";
import {
  applyCloseReview,
  buildCashCloseView,
  closeDayGap,
  dayWithoutReal,
  monthCloseSummary,
  realCentsOf,
  type CashCloseBucket,
  type CashCloseLine,
  type MonthCloseSummary,
} from "@/data/wedash/cashCloseView";
import {
  fetchCashCloseMonthMarks,
  fetchCashCloseReviews,
  fetchCashCloseSnapshot,
  fetchNavMonthFloor,
  fetchOpenCashCloseJob,
  fetchLatestCashCloseError,
  requestMonthClose,
  saveCashCloseReview,
  type CashCloseDayMark,
  type CashCloseReview,
  type CashCloseSnapshot,
} from "@/data/wedash/cashCloseRepo";
import { calendarTodayIso } from "@/data/wedash/clock";
import { periodLabels } from "@/data/wedash/dashboard";
import {
  dayShortageCents,
  netCloseDiff,
  withdrawalDraftFrom,
  withdrawalPeople,
  withdrawalSave,
  type WithdrawalDraft,
} from "@/data/wedash/employeeWithdrawal";
import { fetchSalesDayAggs, fetchSyncWatermark } from "@/data/wedash/salesRepo";
import { fetchStoreSellers, type Store, type StoreSeller } from "@/data/wedash/stores";
import { isGestor } from "@/layout/nav-wedash";
import { cn } from "@/lib/cn";
import { brlCent, dataExtenso, deIso, fimDoMes, inicioDoMes, paraIso, somarDias, labelUpper } from "@/lib/format";
import { refreshMomentTitle, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useScope } from "@/pages/dashboard/useScope";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { parseNum, SectionHeader, SelectStoreCard, pickOneStore, useScopedStores } from "@/pages/operation/shared";
import { HeaderFilters } from "@/pages/stock/shared";

const DIAS = [
  { longo: "Domingo", curto: "D" },
  { longo: "Segunda-feira", curto: "S" },
  { longo: "Terça-feira", curto: "T" },
  { longo: "Quarta-feira", curto: "Q" },
  { longo: "Quinta-feira", curto: "Q" },
  { longo: "Sexta-feira", curto: "S" },
  { longo: "Sábado", curto: "S" },
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

function rotuloMesAno(iso: string): string {
  const d = deIso(inicioDoMes(iso));
  return `${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`;
}

function fimDaPagina(ano: number, hojeAno: number): number {
  const alvo = Math.min(ano, hojeAno);
  return hojeAno - Math.floor((hojeAno - alvo) / 12) * 12;
}

function celulasDoIntervalo(from: string, to: string): Array<string | null> {
  const cells: Array<string | null> = Array.from({ length: deIso(from).getDay() }, () => null);
  for (let day = from; day <= to; day = somarDias(day, 1)) cells.push(day);
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

function linesWithDraft(lines: CashCloseLine[], draft: CloseDraft | undefined): CashCloseLine[] {
  if (!draft) return lines;
  return lines.map((line) => {
    const next = { ...line };
    const typed = fieldToCents(draft.typed[line.key] ?? "");
    if (typed != null) next.typedCents = typed;
    if (line.key !== "cash") {
      const raw = draft.acquirer[line.key] ?? "";
      const real = fieldToCents(raw);
      if (raw.trim() && real != null && !(line.stoneCents == null && real === 0)) next.stoneCents = real;
    }
    return next;
  });
}

type CloseDraft = {
  typed: Partial<Record<CashCloseBucket, string>>;
  acquirer: Partial<Record<CashCloseBucket, string>>;
};

function CloseTable({
  lines,
  pixPending,
  gestor,
  fechado,
  draft,
  onAcquirer,
}: {
  lines: CashCloseLine[];
  pixPending: boolean;
  gestor: boolean;
  fechado: boolean;
  draft?: CloseDraft;
  onAcquirer?: (key: CashCloseBucket, value: string) => void;
}) {
  if (lines.length === 0) return null;
  const campo =
    "h-9 w-full min-w-0 rounded-[9px] border border-line bg-bg-inset px-2 text-right font-mono text-[13px] font-bold text-t0 outline-none focus:border-acc";
  const cabecalhos = ["Forma", "Millennium", "Total real", "Diferença"];
  const conta = closeDayGap(lines);
  return (
    <>
      {pixPending && (
        <Alert className="mb-4" variant="info" title="O fechamento de Pix deste dia já foi solicitado. O total real aparecerá assim que estiver disponível." />
      )}
      <div className="overflow-x-auto rounded-[var(--radius-vela-lg)] border border-line bg-bg-2">
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
              const real = realCentsOf(row);
              const diff = real == null ? null : real - row.systemCents;
              const acqTxt = draft?.acquirer[row.key] ?? (row.stoneCents == null ? "" : centsToField(row.stoneCents));
              return (
                <tr key={row.key} className="border-b border-line">
                  <td className="px-3 py-3 text-t0">{labelUpper(row.label)}</td>
                  <td className="px-3 py-3 text-right font-mono text-[13px] font-bold text-t0">{money(row.systemCents)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {row.key === "cash" || !(gestor && draft && onAcquirer) ? (
                      <span className="font-mono text-[13px] font-bold text-t0">{real == null ? "—" : money(real)}</span>
                    ) : (
                      <input
                        value={acqTxt}
                        onChange={(e) => onAcquirer(row.key, e.target.value)}
                        inputMode="decimal"
                        placeholder="—"
                        aria-label={`Total real para ${row.label}`}
                        className={campo}
                      />
                    )}
                  </td>
                  <td className={cn("px-3 py-3 text-right font-mono text-[13px] font-bold", fechado && diff != null ? diffClass(diff) : "text-t2")}>
                    {fechado && diff != null ? totalDia(diff) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-bg-1">
              <td className="px-3 py-3 text-[12px] font-bold uppercase tracking-wide text-t2">Total</td>
              <td className="px-3 py-3 text-right font-mono text-[13px] font-bold text-t0">{money(conta.systemCents)}</td>
              <td className="px-3 py-3 text-right font-mono text-[13px] font-bold text-t0">
                {dayWithoutReal(lines) ? "—" : money(conta.realCents)}
              </td>
              <td className={cn("px-3 py-3 text-right font-mono text-[13px] font-bold", fechado && !dayWithoutReal(lines) ? diffClass(conta.diffCents) : "text-t2")}>
                {fechado && !dayWithoutReal(lines) ? totalDia(conta.diffCents) : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
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

export function SeletorMesAno({
  iso,
  hoje,
  minIso,
  onChange,
}: {
  iso: string;
  hoje: string;
  /** Primeiro mês que pode ser escolhido. Antes disso o mês fica bloqueado. */
  minIso: string;
  onChange: (alvo: string) => void;
}) {
  const hojeData = deIso(hoje);
  const hojeAno = hojeData.getFullYear();
  const hojeMes = hojeData.getMonth();
  const piso = deIso(inicioDoMes(minIso));
  const pisoAno = piso.getFullYear();
  const pisoMes = piso.getMonth();
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

  const anos = Array.from({ length: 12 }, (_, i) => anoPagina - 11 + i);
  const podeAnoAnt = modo === "ano" ? anos[0] > pisoAno : anoVista > pisoAno;
  const podeAnoProx = modo === "ano" ? anoPagina < hojeAno : anoVista < hojeAno;
  const navBtn = (ok: boolean) =>
    cn("flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line text-t1", ok ? "hover:bg-bg-3" : "cursor-not-allowed opacity-40");

  function escolherMes(month: number) {
    const antes = anoVista < pisoAno || (anoVista === pisoAno && month < pisoMes);
    const futuro = anoVista > hojeAno || (anoVista === hojeAno && month > hojeMes);
    if (antes || futuro) return;
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
                  const bloqueado =
                    anoVista < pisoAno ||
                    (anoVista === pisoAno && month < pisoMes) ||
                    anoVista > hojeAno ||
                    (anoVista === hojeAno && month > hojeMes);
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
                  const bloqueado = ano < pisoAno || ano > hojeAno;
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

export const monthNavBtn =
  "flex h-10 w-10 items-center justify-center rounded-[11px] border border-line bg-bg-2 text-t1 hover:border-line-2 hover:text-t0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-t1";

export function Seta({ dir }: { dir: "anterior" | "proximo" }) {
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
  const { escopo } = useScope();
  const escolher = pickOneStore(escopo.filialIds, session.stores.length);
  const showLojas = useMinSkeleton(lojasLoading);
  const hoje = calendarTodayIso();
  const [rangeFrom, setRangeFrom] = useState(() => inicioDoMes(hoje));
  const [rangeTo, setRangeTo] = useState(() => fimDoMes(hoje));
  const [presetId, setPresetId] = useState<DatePresetId | null>("esteMes");
  const [piso, setPiso] = useState(() => inicioDoMes(hoje));
  const [marks, setMarks] = useState<CashCloseDayMark[]>([]);
  const [marksKey, setMarksKey] = useState("");
  const [reviews, setReviews] = useState<CashCloseReview[]>([]);
  const [sellersByStore, setSellersByStore] = useState<Map<string, StoreSeller[]>>(new Map());
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  const [dias, setDias] = useState<Record<string, CashCloseSnapshot>>({});
  const [diaKey, setDiaKey] = useState("");
  const [erro, setErro] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [watermark, setWatermark] = useState<Date | null | undefined>(undefined);
  const [soldToday, setSoldToday] = useState<{ cents: number; byStore: Record<string, number> } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const storeKey = lojas.map((l) => l.id).join(",");
  const lojasRef = useRef(lojas);
  lojasRef.current = lojas;
  const rangeFromRef = useRef(rangeFrom);
  rangeFromRef.current = rangeFrom;
  const rangeToRef = useRef(rangeTo);
  rangeToRef.current = rangeTo;
  const cells = useMemo(() => celulasDoIntervalo(rangeFrom, rangeTo), [rangeFrom, rangeTo]);
  const from = rangeFrom;
  const toBruto = rangeTo;
  const to = toBruto < hoje ? toBruto : hoje;
  const faixaKey = `${storeKey}|${from}|${to}|${reloadKey}`;

  const lojaId = lojas[0]?.id ?? "";
  useEffect(() => {
    if (lojasLoading || escolher || lojas.length === 0) return;
    let stop = false;
    void fetchStoreSellers(session.tenantId, lojas.map((loja) => loja.id)).then((map) => {
      if (!stop) setSellersByStore(map);
    });
    return () => {
      stop = true;
    };
  }, [lojasLoading, escolher, session.tenantId, lojas]);
  useEffect(() => {
    if (lojasLoading || escolher || !lojaId) return;
    let stop = false;
    void fetchNavMonthFloor("cash_close_day", session.tenantId, lojaId, hoje).then((month) => {
      if (stop) return;
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
  }, [lojasLoading, escolher, lojaId, session.tenantId, hoje, reloadKey]);

  useEffect(() => {
    if (!syncing) return;
    let stop = false;
    let checks = 0;
    const tick = async () => {
      checks += 1;
      const open = await fetchOpenCashCloseJob(session.tenantId, "close");
      if (stop || open || checks < 2) return;
      const message = await fetchLatestCashCloseError(session.tenantId, "close");
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

  const pedirFechamento = useCallback(async () => {
    if (escolher) return;
    const ids = lojasRef.current.map((loja) => loja.id);
    if (ids.length === 0) return;
    const months = monthsTouched(rangeFromRef.current, rangeToRef.current);
    const hojeIso = calendarTodayIso();
    const comDia = months.filter((month) => monthCloseSpanFor(month, hojeIso));
    const alvos = comDia.length > 0 ? comDia : [months[0]];
    for (const month of alvos) {
      const r = await requestMonthClose(ids, month);
      if (!r.ok) {
        show(r.message, "danger");
        return;
      }
    }
    setSyncing(true);
  }, [show, escolher]);

  useScreenRefresh({
    label: "Atualizar vendas e fechamento",
    tip: "Busca as vendas de hoje e os fechamentos do mês deste período.",
    status: refreshMomentTitle(watermark ? watermark.toISOString() : watermark),
    busyLabel: "Buscando vendas e fechamentos…",
    sales: true,
    run: () => pedirFechamento(),
  });

  useEffect(() => {
    const onSynced = () => setReloadKey((n) => n + 1);
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, []);

  useEffect(() => {
    if (lojasLoading || escolher || lojas.length === 0 || from > to) return;
    let cancelled = false;
    setErro(false);
    const ids = lojas.map((l) => l.id);
    void Promise.all([
      fetchCashCloseMonthMarks(session.tenantId, ids, from, to),
      fetchCashCloseReviews(session.tenantId, ids, from, to),
    ])
      .then(([rows, ajustes]) => {
        if (cancelled) return;
        setMarks(rows);
        setReviews(ajustes);
        setMarksKey(faixaKey);
      })
      .catch(() => {
        if (!cancelled) setErro(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lojasLoading, escolher, session.tenantId, lojas, from, to, faixaKey]);

  useEffect(() => {
    if (lojasLoading || escolher || lojas.length === 0 || to < hoje) {
      setSoldToday(null);
      return;
    }
    let stop = false;
    void fetchSalesDayAggs({
      tenantId: session.tenantId,
      storeIds: lojas.map((loja) => loja.id),
      from: hoje,
      to: hoje,
      brand: null,
    })
      .then((rows) => {
        if (stop) return;
        const all = rows.filter((row) => row.brand === "ALL");
        const used = all.length > 0 ? all : rows.filter((row) => row.brand !== "ALL");
        const byStore: Record<string, number> = {};
        let cents = 0;
        for (const row of used) {
          byStore[row.storeId] = (byStore[row.storeId] ?? 0) + row.revenueCents;
          cents += row.revenueCents;
        }
        setSoldToday({ cents, byStore });
      })
      .catch(() => {
        if (!stop) setSoldToday({ cents: 0, byStore: {} });
      });
    return () => {
      stop = true;
    };
  }, [lojasLoading, escolher, lojas, session.tenantId, hoje, to, reloadKey]);

  useEffect(() => {
    if (lojasLoading || escolher || !diaAberto || lojas.length === 0 || diaAberto > hoje) return;
    let cancelled = false;
    setErro(false);
    const key = `${storeKey}|${diaAberto}|${reloadKey}`;
    void Promise.all(lojas.map((loja) => fetchCashCloseSnapshot(session.tenantId, loja.id, diaAberto).then((snap) => [loja.id, snap] as const)))
      .then((rows) => {
        if (cancelled || !diaAberto) return;
        setDias(Object.fromEntries(rows));
        setDiaKey(key);
        setMarks((atual) => {
          const next = atual.map((mark) => ({ ...mark }));
          for (const [storeId, snap] of rows) {
            const i = next.findIndex((mark) => mark.storeId === storeId && mark.day.slice(0, 10) === diaAberto);
            const mark = { storeId, day: diaAberto, snap, cardPending: snap.cardPending };
            if (i >= 0) next[i] = mark;
            else next.push(mark);
          }
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setErro(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lojasLoading, escolher, diaAberto, session.tenantId, lojas, hoje, storeKey, reloadKey]);

  const analise = useMemo(() => {
    if (marksKey !== faixaKey) return null;
    const porDia = new Map<string, { systemCents: number; realCents: number; diffCents: number; withdrawalCents: number; hasMillennium: boolean; hasLines: boolean; pending: boolean }>();
    const rows: Array<{ day: string; systemCents: number; realCents: number; diffCents: number; pending: boolean }> = [];
    for (const mark of marks) {
      const day = mark.day.slice(0, 10);
      const review = reviews.find((r) => r.storeId === mark.storeId && r.day.slice(0, 10) === day) ?? null;
      const view = buildCashCloseView(mark.snap);
      const lines = applyCloseReview(view.lines, review, {
        cardPending: mark.cardPending,
        pixRequested: mark.snap.pixRequested,
      });
      const gap = closeDayGap(lines);
      const semReal = dayWithoutReal(lines);
      const retirada = (review?.withdrawals ?? []).reduce((sum, row) => sum + row.cents, 0);
      const diffCents = netCloseDiff(gap.diffCents, retirada);
      if (day < hoje) {
        rows.push({
          day,
          systemCents: gap.comparedSystemCents,
          realCents: gap.realCents,
          diffCents,
          pending: semReal,
        });
      }
      const atual = porDia.get(day) ?? { systemCents: 0, realCents: 0, diffCents: 0, withdrawalCents: 0, hasMillennium: false, hasLines: false, pending: false };
      atual.systemCents += gap.systemCents;
      atual.realCents += gap.realCents;
      atual.diffCents += diffCents;
      atual.withdrawalCents += retirada;
      atual.hasMillennium = atual.hasMillennium || mark.snap.millennium.length > 0;
      atual.hasLines = atual.hasLines || lines.length > 0;
      atual.pending = atual.pending || semReal;
      porDia.set(day, atual);
    }
    return { resumo: monthCloseSummary(rows), porDia };
  }, [marks, reviews, marksKey, faixaKey, hoje]);

  function faceDoDia(day: string): { kind: "vazio" | "zero" | "pendente" | "hoje" | "total"; totalCents: number; diffCents: number; withdrawalCents: number; aguardando?: boolean } {
    const info = analise?.porDia.get(day);
    if (day === hoje) return { kind: "hoje", totalCents: soldToday?.cents ?? 0, diffCents: 0, withdrawalCents: 0, aguardando: soldToday == null };
    if (info?.pending) return { kind: "pendente", totalCents: info.systemCents, diffCents: 0, withdrawalCents: 0 };
    if (!info || (info.systemCents === 0 && info.realCents === 0)) return { kind: "zero", totalCents: 0, diffCents: 0, withdrawalCents: 0 };
    if (!info.hasMillennium && !info.hasLines) return { kind: "vazio", totalCents: 0, diffCents: 0, withdrawalCents: 0 };
    return { kind: "total", totalCents: info.realCents, diffCents: info.diffCents, withdrawalCents: info.withdrawalCents };
  }

  function abrirDia(iso: string) {
    if (iso > hoje) return;
    if (iso < hoje && faceDoDia(iso).kind === "zero") return;
    setDiaAberto(iso);
  }

  function aplicarIntervalo(inicio: Date, fim: Date, meta?: DateRangeChangeMeta) {
    setRangeFrom(paraIso(inicio));
    setRangeTo(paraIso(fim));
    setPresetId(meta?.presetId ?? null);
  }

  const diaPronto = diaAberto != null && diaKey === `${storeKey}|${diaAberto}|${reloadKey}`;

  return (
    <div>
      <SectionHeader
        section="Gestão"
        title="Fechamento"
        subtitle="Compare o Millennium com o total real e acompanhe sobras, quebras e pendências do mês."
        actions={
          <HeaderFilters>
            <DateRangePicker
              value={[deIso(rangeFrom), deIso(rangeTo)]}
              minDate={deIso(piso)}
              maxDate={deIso(fimDoMes(hoje))}
              quickRanges={QUICK_RANGES_CALENDARIO}
              displayLabel={presetId ? periodLabels[presetId] : null}
              activePresetId={presetId}
              onChange={([inicio, fim], meta) => aplicarIntervalo(inicio, fim, meta)}
            />
          </HeaderFilters>
        }
      />
      <div className="mt-6 pb-6">
        {erro ? <Alert className="mb-4" variant="danger" title="Não foi possível carregar o fechamento. Tente novamente." /> : null}
        {escolher ? (
          <div className="max-w-[720px]">
            <SelectStoreCard />
          </div>
        ) : showLojas ? (
          <Skeleton className="h-[520px] w-full rounded-[18px]" />
        ) : lojas.length === 0 ? (
          <Card>
            <EmptyBlock icon="🏬" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : (
          <>
            {analise ? (
              <ResumoMes resumo={analise.resumo} />
            ) : (
              <Skeleton className="mb-4 h-[88px] w-full rounded-[18px]" />
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
        pronto={diaPronto}
        gestor={isGestor(session.role)}
        fechado={diaAberto != null && diaAberto < hoje}
        tenantId={session.tenantId}
        soldByStore={soldToday?.byStore ?? null}
        sellersByStore={sellersByStore}
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

function dicaDiferenca(resumo: MonthCloseSummary): string {
  const base = "Diferença acumulada entre o total real e o Millennium nos dias já fechados.";
  if (resumo.surplusCents === 0 && resumo.shortageCents === 0) return base;
  return `${base}\nSobras: ${brlCent(resumo.surplusCents / 100)} · Quebras: ${brlCent(resumo.shortageCents / 100)}`;
}

function corDaDiferenca(cents: number): string {
  if (cents > 0) return "var(--ok)";
  if (cents < 0) return "var(--bad)";
  return "var(--t0)";
}

export function PlainKpi({ label, value, color, tooltip }: { label: string; value: string; color: string; tooltip?: string }) {
  return (
    <Card>
      <p className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-t2">
        {label}
        {tooltip ? (
          <Tooltip label={tooltip} side="bottom">
            <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold normal-case tracking-normal text-t2 transition-colors hover:text-t1">?</span>
          </Tooltip>
        ) : null}
      </p>
      <p className="mt-1.5 truncate font-mono text-[22px] font-extrabold" style={{ color }}>{value}</p>
    </Card>
  );
}

function ResumoMes({ resumo }: { resumo: MonthCloseSummary }) {
  const cards = [
    { label: "Total real", value: brlCent(resumo.realCents / 100), color: "var(--t0)" },
    { label: "Diferença", value: totalDia(resumo.diffCents), color: corDaDiferenca(resumo.diffCents), tooltip: dicaDiferenca(resumo) },
    { label: "Dias pendentes", value: String(resumo.pendingDays), color: "var(--t0)" },
  ];
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      {cards.map((card) => (
        <PlainKpi key={card.label} label={card.label} value={card.value} color={card.color} tooltip={"tooltip" in card ? card.tooltip : undefined} />
      ))}
    </div>
  );
}

function ContaDoDia({ systemCents, realCents, diffCents }: { systemCents: number; realCents: number; diffCents: number }) {
  const itens = [
    { label: "Millennium", value: money(systemCents), tom: "text-t0" },
    { label: "Total real", value: money(realCents), tom: "text-t0" },
    { label: "Diferença", value: totalDia(diffCents), tom: diffClass(diffCents) },
  ];
  return (
    <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {itens.map((item) => (
        <div key={item.label} className="min-w-0 rounded-[14px] border border-line bg-bg-1 px-3 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-t2">{item.label}</p>
          <p className={cn("mt-1 truncate font-mono text-lg font-extrabold", item.tom)}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export function ChipDia({ cor, children }: { cor: string; children: string }) {
  return (
    <div title={children} className={cn("mt-1 w-full self-stretch truncate rounded-md px-1.5 py-1 text-[10px] font-semibold text-white sm:text-[11px]", cor)}>
      {children}
    </div>
  );
}

function chipDaDiferenca(cents: number): { cor: string; texto: string } {
  if (cents > 0) return { cor: "bg-ok", texto: `Sobra ${brlCent(cents / 100)}` };
  if (cents < 0) return { cor: "bg-bad", texto: `Quebra ${brlCent(Math.abs(cents) / 100)}` };
  return { cor: "bg-chip-gray", texto: "Sem diferença" };
}

function dicaDoDia(face: { kind: "vazio" | "zero" | "pendente" | "hoje" | "total"; totalCents: number; diffCents: number; withdrawalCents: number }): string | undefined {
  if (face.kind !== "total") return undefined;
  const partes: string[] = [];
  if (face.diffCents !== 0) partes.push(chipDaDiferenca(face.diffCents).texto);
  if (face.withdrawalCents > 0) partes.push(`Retirada ${brlCent(face.withdrawalCents / 100)}`);
  return partes.length > 0 ? partes.join(" · ") : undefined;
}

function Mes({
  hoje,
  cells,
  faceDoDia,
  onOpen,
}: {
  hoje: string;
  cells: Array<string | null>;
  faceDoDia: (day: string) => { kind: "vazio" | "zero" | "pendente" | "hoje" | "total"; totalCents: number; diffCents: number; withdrawalCents: number; aguardando?: boolean };
  onOpen: (iso: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-[18px] border border-line bg-bg-2 shadow-[var(--shadow-vela)]">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-7">
          {DIAS.map((d, i) => (
            <div key={i} className="border-b border-line px-1 py-3 text-center text-[10px] font-bold leading-tight text-t2 sm:text-[11px]">
              <span className="hidden sm:inline">{d.longo}</span>
              <span className="sm:hidden uppercase">{d.curto}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          const face = day && day <= hoje ? faceDoDia(day) : null;
          const borda = cn(
            "flex min-h-[84px] w-full min-w-0 flex-col items-stretch justify-start border-b border-r border-line p-1.5 text-left sm:min-h-[110px] sm:p-2",
            (i + 1) % 7 === 0 && "border-r-0",
            !day && "bg-bg-1/30",
          );
          if (!day) return <div key={`vazio-${i}`} className={borda} />;
          const futuro = day > hoje;
          const mostraTotal = face?.kind === "pendente" || face?.kind === "total" || (face?.kind === "hoje" && !face.aguardando);
          const dica = face ? dicaDoDia(face) : undefined;
          const miolo = (
            <>
              <NumeroDia iso={day} hoje={hoje} />
              {face?.kind === "hoje" && face.aguardando ? (
                <div className="mt-1.5 w-full min-w-0">
                  <ChipDia cor="bg-acc">Em aberto</ChipDia>
                </div>
              ) : null}
              {mostraTotal && face && (
                <div className="mt-1.5 w-full min-w-0">
                  <p className="whitespace-nowrap font-mono text-[12px] font-extrabold text-t1 sm:text-[13px]">
                    {brlCent(face.totalCents / 100)}
                  </p>
                  {face.kind === "pendente" && <ChipDia cor="bg-warn">{`Pendente ${brlCent(face.totalCents / 100)}`}</ChipDia>}
                  {face.kind === "hoje" && <ChipDia cor="bg-acc">Em aberto</ChipDia>}
                  {face.kind === "total" && (face.diffCents !== 0 || face.withdrawalCents === 0) && (
                    <ChipDia cor={chipDaDiferenca(face.diffCents).cor}>{chipDaDiferenca(face.diffCents).texto}</ChipDia>
                  )}
                  {face.kind === "total" && face.withdrawalCents > 0 && (
                    <ChipDia cor="bg-info">{`Retirada ${brlCent(face.withdrawalCents / 100)}`}</ChipDia>
                  )}
                </div>
              )}
            </>
          );
          if (futuro || face?.kind === "zero") return <div key={day} className={borda}>{miolo}</div>;
          return (
            <button key={day} type="button" title={dica} className={cn(borda, "hover:bg-bg-3")} onClick={() => onOpen(day)}>
              {miolo}
            </button>
          );
        })}
        </div>
      </div>
    </div>
  );
}

function DiaModal({
  day,
  lojas,
  snaps,
  reviews,
  pronto,
  gestor,
  fechado,
  tenantId,
  soldByStore,
  sellersByStore,
  onClose,
  onSaved,
}: {
  day: string | null;
  lojas: Store[];
  snaps: Record<string, CashCloseSnapshot>;
  reviews: CashCloseReview[];
  pronto: boolean;
  gestor: boolean;
  fechado: boolean;
  tenantId: string;
  soldByStore: Record<string, number> | null;
  sellersByStore: Map<string, StoreSeller[]>;
  onClose: () => void;
  onSaved: (review: CashCloseReview) => void;
}) {
  const { show } = useToast();
  const [drafts, setDrafts] = useState<Record<string, CloseDraft>>({});
  const [withdrawalDrafts, setWithdrawalDrafts] = useState<Record<string, WithdrawalDraft>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!day || !pronto) return;
    const next: Record<string, CloseDraft> = {};
    const nextWithdrawals: Record<string, WithdrawalDraft> = {};
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
      next[loja.id] = { typed, acquirer };
      nextWithdrawals[loja.id] = withdrawalDraftFrom(review?.withdrawals ?? [], centsToField);
    }
    setDrafts(next);
    setWithdrawalDrafts(nextWithdrawals);
  }, [day, pronto, lojas, snaps, reviews]);

  const comDados = day
    ? lojas.filter((loja) => {
        const snap = snaps[loja.id];
        return snap && buildCashCloseView(snap).lines.some((line) => line.systemCents !== 0 || line.typedCents !== 0 || line.stoneCents != null);
      })
    : [];

  const diaPendente =
    fechado &&
    pronto &&
    (comDados.length === 0 ||
      comDados.some((loja) => {
        const snap = snaps[loja.id];
        if (!snap || !day) return true;
        const review = reviews.find((r) => r.storeId === loja.id && r.day === day) ?? null;
        const lines = applyCloseReview(buildCashCloseView(snap).lines, review, {
          cardPending: snap.cardPending,
          pixRequested: snap.pixRequested,
        });
        return dayWithoutReal(lines);
      }));

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
        if (real != null && real !== line.stoneCents && !(line.stoneCents == null && real === 0)) acquirerCents[line.key] = real;
      }
      if (invalido) {
        setBusy(false);
        return;
      }
      const review = reviews.find((item) => item.storeId === loja.id && item.day === day);
      const people = withdrawalPeople(
        (sellersByStore.get(loja.id) ?? []).map((seller) => ({ id: seller.id, name: seller.name, active: seller.active })),
        (withdrawalDrafts[loja.id]?.rows ?? []).map((row) => row.sellerId),
      );
      const retiro = withdrawalSave({
        shortageCents: dayShortageCents(closeDayGap(linesWithDraft(linhas, draft)).diffCents),
        enabled: withdrawalDrafts[loja.id]?.enabled ?? false,
        rows: withdrawalDrafts[loja.id]?.rows ?? [],
        parseCents: fieldToCents,
        names: new Map(people.map((person) => [person.id, person.name])),
      });
      if (!retiro.ok) {
        setBusy(false);
        show(retiro.message, "danger");
        return;
      }
      const saved: CashCloseReview = {
        storeId: loja.id,
        day,
        cashTypedCents: typedCents.cash ?? null,
        justification: review?.justification ?? "",
        waive: review?.waive ?? false,
        typedCents,
        acquirerCents,
        shortageScope: review?.shortageScope ?? "",
        shortageSellers: review?.shortageSellers ?? [],
        shortageGroup: review?.shortageGroup ?? "",
        withdrawals: retiro.lines,
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
      title={
        day ? (
          <>
            <span>{tituloDia(day)}</span>
            {(!fechado || pronto) && (
              <Badge variant={!fechado ? "accent" : diaPendente ? "warning" : "success"}>
                {!fechado ? "Em aberto" : diaPendente ? "Pendente" : "Fechado"}
              </Badge>
            )}
          </>
        ) : (
          ""
        )
      }
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {gestor ? "Cancelar" : "Voltar"}
          </Button>
          {gestor && fechado && comDados.length > 0 && (
            <Button onClick={() => void salvar()} disabled={busy || !pronto}>
              {busy ? "Salvando…" : "Salvar"}
            </Button>
          )}
        </>
      }
    >
      {!pronto ? (
        <Skeleton className="h-40 w-full" />
      ) : !fechado ? (
        <div className="flex flex-col gap-4">
          {lojas.map((loja) => (
            <p key={loja.id} className="text-[13px] leading-relaxed text-t2">
              {lojas.length > 1 ? <span className="mb-1 block font-bold text-t0">{loja.fantasia}</span> : null}
              Vendido hoje: {soldByStore ? brlCent((soldByStore[loja.id] ?? 0) / 100) : "…"}. Este dia ainda não fechou. Amanhã o valor passa a ser o do fechamento de caixa.
            </p>
          ))}
        </div>
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
            const linhas = linesWithDraft(view.lines, draft);
            const conta = closeDayGap(linhas);
            const people = withdrawalPeople(
              (sellersByStore.get(loja.id) ?? []).map((seller) => ({ id: seller.id, name: seller.name, active: seller.active })),
              (withdrawalDrafts[loja.id]?.rows ?? []).map((row) => row.sellerId),
            );
            return (
              <section key={loja.id}>
                {lojas.length > 1 && <p className="mb-3 text-[13px] font-bold text-t0">{loja.fantasia}</p>}
                {!dayWithoutReal(linhas) ? (
                  <ContaDoDia systemCents={conta.comparedSystemCents} realCents={conta.realCents} diffCents={conta.diffCents} />
                ) : (
                  <p className="mb-4 text-[13px] text-t2">Falta o total real de alguma forma. A diferença aparece quando ele for informado.</p>
                )}
                {cash?.openingCents != null && (
                  <p className="mb-3 text-[12px] text-t2">
                    Fundo de caixa {brlCent(cash.openingCents / 100)}
                    {cash.sangriaCents != null ? ` · Sangria ${brlCent(Math.abs(cash.sangriaCents) / 100)}` : ""}
                  </p>
                )}
                <CloseTable
                  lines={linhas}
                  pixPending={view.pixPending}
                  gestor={gestor}
                  fechado={fechado}
                  draft={draft}
                  onAcquirer={(key, value) =>
                    setDrafts((atual) => ({
                      ...atual,
                      [loja.id]: { ...(atual[loja.id] ?? draft!), acquirer: { ...(atual[loja.id]?.acquirer ?? {}), [key]: value } },
                    }))
                  }
                />
                <EmployeeWithdrawal
                  gestor={gestor}
                  shortageCents={dayShortageCents(conta.diffCents)}
                  people={people}
                  draft={withdrawalDrafts[loja.id] ?? { enabled: false, rows: [] }}
                  onChange={(next) => setWithdrawalDrafts((atual) => ({ ...atual, [loja.id]: next }))}
                  toCents={fieldToCents}
                />
              </section>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
