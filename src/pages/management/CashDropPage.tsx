import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, DateRangePicker, Dropdown, Modal, Segmented, Skeleton, useToast, CALENDAR_QUICK_RANGES, Badge, type DatePresetId, type DateRangeChangeMeta, type DropdownItem } from "@/components/ui";
import { DayFace, MonthCalendar, blankDayClass } from "@/components/wedash/MonthCalendar";
import { calendarTodayIso } from "@/data/wedash/clock";
import { periodLabels } from "@/data/wedash/dashboard";
import { fetchLatestCashCloseError, fetchNavMonthFloor, fetchOpenCashCloseJob, requestCashDropMonth } from "@/data/wedash/cashCloseRepo";
import { fetchSyncWatermark } from "@/data/wedash/salesRepo";
import {
  createCashDropDeposit,
  fetchDepositDayCount,
  fetchCashDropMonth,
  saveCashDropLine,
  saveCashDropLines,
  saveCashDropShortage,
  undoCashDropDeposit,
  type CashDropDepositDay,
  type CashDropLineRow,
  type CashDropShortageRow,
} from "@/data/wedash/cashDropRepo";
import { dayAmounts, depositBoleto, sumAmounts, type CashDropAmounts } from "@/data/wedash/cashDropMath";
import { brlCent, longDate, isoToDate, endOfMonth, startOfMonth, dateToIso, addDays } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { refreshMomentTitle, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { useScope } from "@/pages/dashboard/useScope";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { NumberInput, SectionHeader, SelectStoreCard, parseNum, pickOneStore, useScopedStores } from "@/pages/operation/shared";
import { DayChip, PlainKpi } from "@/pages/cash-close/CashClosePage";
import { monthsTouched, cashDropMonthSpan } from "@/data/wedash/cashCloseMonth";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { HeaderFilters } from "@/pages/stock/shared";

const money = (cents: number) => brlCent(cents / 100);

type ActionBatch = "recebido" | "aCobrar" | "fora" | "falta" | "desfazer";

function rangeCells(from: string, to: string): Array<string | null> {
  const cells: Array<string | null> = Array.from({ length: isoToDate(from).getDay() }, () => null);
  for (let day = from; day <= to; day = addDays(day, 1)) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function dayTitle(iso: string): string {
  const s = longDate(iso);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Gestão > Sangrias. Calendário do mês e o recebimento dos dias em aberto. */
export function CashDropPage() {
  const { show } = useToast();
  const { session, storeRows, loading: storesLoading } = useScopedStores();
  const { scope } = useScope();
  const escolher = pickOneStore(scope.storeIds, session.stores.length);
  const showStores = useMinSkeleton(storesLoading);
  const today = calendarTodayIso();
  const [rangeFrom, setRangeFrom] = useState(() => startOfMonth(today));
  const [rangeTo, setRangeTo] = useState(() => endOfMonth(today));
  const [presetId, setPresetId] = useState<DatePresetId | null>("thisMonth");
  const [floor, setFloor] = useState(() => startOfMonth(today));
  const [lines, setLines] = useState<CashDropLineRow[]>([]);
  const [deposits, setDeposits] = useState<CashDropDepositDay[]>([]);
  const [shortages, setShortages] = useState<CashDropShortageRow[]>([]);
  const [loaded, setLoaded] = useState("");
  const [error, setError] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [depositando, setDepositando] = useState(false);
  const [action, setAction] = useState<ActionBatch | null>(null);
  const [reasonBatch, setReasonBatch] = useState("");
  const [gapBatch, setGapBatch] = useState("");
  const [reasonGapBatch, setReasonGapBatch] = useState("");
  const [daysUndo, setDaysUndo] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [watermark, setWatermark] = useState<Date | null | undefined>(undefined);

  const store = storeRows[0];
  const storeRef = useRef(store);
  storeRef.current = store;
  const rangeFromRef = useRef(rangeFrom);
  rangeFromRef.current = rangeFrom;
  const rangeToRef = useRef(rangeTo);
  rangeToRef.current = rangeTo;
  const from = rangeFrom;
  const to = rangeTo;
  const cells = useMemo(() => rangeCells(from, to), [from, to]);
  const band = store ? `${store.id}|${from}|${to}|${reloadKey}` : "";

  const storeIdValue = store?.id ?? "";
  const storeSelection = escolher ? "" : storeIdValue;
  const [storeView, setStoreView] = useState(storeSelection);
  if (storeView !== storeSelection) {
    setStoreView(storeSelection);
    setDay(null);
    setMarcados([]);
    setAction(null);
  }
  useEffect(() => {
    if (storesLoading || escolher || !storeIdValue) return;
    let stop = false;
    void fetchNavMonthFloor("sangria_line", session.tenantId, storeIdValue, today).then((month) => {
      if (stop) return;
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
  }, [storesLoading, escolher, storeIdValue, session.tenantId, today, reloadKey]);

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

  const request = useCallback(async () => {
    const current = storeRef.current;
    if (escolher || !current) return;
    const months = monthsTouched(rangeFromRef.current, rangeToRef.current);
    const todayIso = calendarTodayIso();
    const withDay = months.filter((month) => cashDropMonthSpan(month, todayIso));
    const targets = withDay.length > 0 ? withDay : [months[0]];
    for (const month of targets) {
      const r = await requestCashDropMonth([current.id], month);
      if (!r.ok) {
        show(r.message, "danger");
        return;
      }
    }
    setSyncing(true);
  }, [escolher, show]);

  useScreenRefresh({
    label: "Atualizar vendas e sangrias",
    tip: "Busca as vendas de hoje e as sangrias do período.",
    status: refreshMomentTitle(watermark ? watermark.toISOString() : watermark),
    busyLabel: "Atualizando…",
    sales: true,
    run: () => request(),
  });

  useEffect(() => {
    const onSynced = () => setReloadKey((n) => n + 1);
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, []);

  useEffect(() => {
    if (storesLoading || escolher || !store) return;
    let cancel = false;
    setError(false);
    void fetchCashDropMonth(session.tenantId, store.id, from, to)
      .then((res) => {
        if (cancel) return;
        setLines(res.lines);
        setDeposits(res.deposits);
        setShortages(res.shortages);
        setLoaded(band);
        setMarcados((current) => current.filter((day) => !res.deposits.some((d) => d.day === day)));
      })
      .catch(() => {
        if (!cancel) setError(true);
      });
    return () => {
      cancel = true;
    };
  }, [storesLoading, escolher, store, session.tenantId, from, to, band]);

  const taken = useMemo(() => new Set(deposits.map((d) => d.day)), [deposits]);
  const gapByDay = useMemo(() => new Map(shortages.map((s) => [s.day, s.amountCents])), [shortages]);
  const byDay = useMemo(() => {
    const map = new Map<string, CashDropLineRow[]>();
    for (const line of lines) {
      const list = map.get(line.day) ?? [];
      list.push(line);
      map.set(line.day, list);
    }
    return map;
  }, [lines]);
  const month = useMemo(() => {
    const days = new Set<string>([...byDay.keys(), ...gapByDay.keys()]);
    return sumAmounts([...days].map((day) => dayAmounts(byDay.get(day) ?? [], gapByDay.get(day) ?? 0)));
  }, [byDay, gapByDay]);
  const open = useMemo(() => {
    const days = [...byDay.keys()].filter((day) => !taken.has(day) && day <= today);
    return depositBoleto(lines, days, gapByDay);
  }, [byDay, taken, lines, today, gapByDay]);
  const depositado = useMemo(() => depositBoleto(lines, deposits.map((d) => d.day), gapByDay), [lines, deposits, gapByDay]);
  const openDays = useMemo(() => marcados.filter((day) => !taken.has(day)), [marcados, taken]);
  const daysReceivables = useMemo(
    () => openDays.filter((day) => day < today && dayAmounts(byDay.get(day) ?? [], gapByDay.get(day) ?? 0).boletoCents > 0),
    [openDays, byDay, gapByDay, today],
  );
  const amountToReceive = depositBoleto(lines, daysReceivables, gapByDay);
  const linesExcludedAbertas = useMemo(
    () => lines.filter((line) => openDays.includes(line.day) && line.kind === "purchase"),
    [lines, openDays],
  );
  const linesBoletoAbertas = useMemo(
    () => lines.filter((line) => openDays.includes(line.day) && line.kind === "deposit"),
    [lines, openDays],
  );
  const markedDeposits = useMemo(() => {
    const ids = new Set<string>();
    for (const day of marcados) {
      const id = deposits.find((d) => d.day === day)?.depositId;
      if (id) ids.add(id);
    }
    return [...ids];
  }, [marcados, deposits]);
  const pronto = loaded === band;
  const markLabel = marcados.length === 0 ? "Marcar como" : marcados.length === 1 ? "Marcar como · 1 dia" : `Marcar como · ${marcados.length} dias`;

  function toggleDay(day: string) {
    if (day > today) return;
    setMarcados((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day]));
  }

  async function openUndo() {
    if (markedDeposits.length === 0) return;
    let total = marcados.filter((day) => taken.has(day)).length;
    try {
      const counts = await Promise.all(markedDeposits.map((id) => fetchDepositDayCount(id)));
      total = counts.reduce((sum, n) => sum + n, 0);
    } catch {
      total = marcados.filter((day) => taken.has(day)).length;
    }
    setDaysUndo(Math.max(1, total));
    setAction("desfazer");
  }

  function openShortage() {
    const day = marcados[0];
    const current = day ? shortages.find((s) => s.day === day) : undefined;
    setGapBatch(brlField(current?.amountCents ?? 0));
    setReasonGapBatch(current?.note ?? "");
    setAction("falta");
  }

  async function confirmAction() {
    if (!store || !action) return;
    if (action === "fora" && !reasonBatch.trim()) {
      show("Informe o motivo.", "danger");
      return;
    }
    if (action === "desfazer") {
      setDepositando(true);
      try {
        await Promise.all(markedDeposits.map((id) => undoCashDropDeposit(id)));
        const ids = new Set(markedDeposits);
        setDeposits((current) => current.filter((d) => !ids.has(d.depositId)));
        setMarcados((current) => current.filter((day) => !taken.has(day)));
        setReloadKey((n) => n + 1);
        setAction(null);
        show(markedDeposits.length > 1 ? "Recebimentos desfeitos." : "Recebimento desfeito.", "success");
      } catch {
        show("Não foi possível desfazer o recebimento. Tente novamente.", "danger");
      } finally {
        setDepositando(false);
      }
      return;
    }
    if (action === "falta") {
      const day = marcados[0];
      if (!day) return;
      const cents = fieldToCents(gapBatch);
      if (cents == null) {
        show("O valor da falta não é válido.", "danger");
        return;
      }
      const base = (byDay.get(day) ?? []).reduce((sum, line) => (line.kind === "purchase" ? sum : sum + line.amountCents), 0);
      if (cents > base) {
        show("A falta não pode passar do valor que iria para o boleto.", "danger");
        return;
      }
      setDepositando(true);
      try {
        const text = cents === 0 ? "" : reasonGapBatch.trim();
        await saveCashDropShortage(session.tenantId, store.id, day, cents, text);
        setShortages((current) => {
          const without = current.filter((s) => s.day !== day);
          return cents === 0 ? without : [...without, { day, amountCents: cents, note: text }];
        });
        setAction(null);
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
      if (action === "recebido") {
        await createCashDropDeposit(session.tenantId, store.id, daysReceivables, taken);
        setMarcados([]);
        setReloadKey((n) => n + 1);
        show("Valor marcado como recebido.", "success");
      } else if (action === "aCobrar") {
        const next = linesExcludedAbertas.map((line) => ({ ...line, kind: "deposit" as const }));
        await saveCashDropLines(next);
        setLines((current) => current.map((row) => next.find((n) => n.id === row.id) ?? row));
        show("Sangrias marcadas como a receber.", "success");
      } else {
        const reason = reasonBatch.trim();
        const next = linesBoletoAbertas.map((line) => ({ ...line, kind: "purchase" as const, note: line.note.trim() || reason }));
        await saveCashDropLines(next);
        setLines((current) => current.map((row) => next.find((n) => n.id === row.id) ?? row));
        show("Sangrias marcadas como fora do boleto.", "success");
      }
      setAction(null);
    } catch (e) {
      show(e instanceof Error ? e.message : "Não foi possível marcar as sangrias. Tente novamente.", "danger");
    } finally {
      setDepositando(false);
    }
  }

  function applyInterval(start: Date, end: Date, goal?: DateRangeChangeMeta) {
    const nextFrom = dateToIso(start);
    const nextTo = dateToIso(end);
    setRangeFrom(nextFrom);
    setRangeTo(nextTo);
    setPresetId(goal?.presetId ?? null);
    setMarcados((current) => current.filter((day) => day >= nextFrom && day <= nextTo));
  }

  return (
    <div>
      <SectionHeader
        section="Gestão"
        title="Sangrias"
        subtitle="Confira as sangrias, defina o que entra no boleto e acompanhe os recebimentos."
        actions={
          <HeaderFilters>
            <DateRangePicker
              value={[isoToDate(from), isoToDate(to)]}
              minDate={isoToDate(floor)}
              maxDate={isoToDate(endOfMonth(today))}
              quickRanges={CALENDAR_QUICK_RANGES}
              displayLabel={presetId ? periodLabels[presetId] : null}
              activePresetId={presetId}
              onChange={([start, end], goal) => applyInterval(start, end, goal)}
            />
            {!escolher && store ? <MarkAs days={marcados.length} label={markLabel} amount={amountToReceive} recebidoOk={daysReceivables.length > 0} excludedOk={linesBoletoAbertas.length > 0} cobrarOk={linesExcludedAbertas.length > 0} tudoRecebido={marcados.length > 0 && marcados.every((day) => taken.has(day))} canUndo={markedDeposits.length > 0} onRecebido={() => setAction("recebido")} onCobrar={() => setAction("aCobrar")} onExcluded={() => { setReasonBatch(""); setAction("fora"); }} onGap={openShortage} onUndo={() => void openUndo()} /> : null}
          </HeaderFilters>
        }
      />
      <div className="mt-6 pb-8">
        {error ? <Alert className="mb-4" variant="danger" title="Não foi possível carregar as sangrias. Tente novamente." /> : null}
        {escolher ? (
          <div className="max-w-[720px]">
            <SelectStoreCard />
          </div>
        ) : showStores || (store != null && !pronto) ? (
          <Skeleton className="h-[520px] w-full rounded-[18px]" />
        ) : storeRows.length === 0 || !store ? (
          <Card>
            <EmptyBlock icon="💵" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : (
          <>
            <MonthSummary aCobrar={open} recebido={depositado} excluded={month.excludedCents} gap={month.gapCents} />
            <MonthCalendar>
              {cells.map((day, i) => (
                <DayCell
                  key={day ?? `vazio-${i}`}
                  index={i}
                  day={day}
                  today={today}
                  rows={day ? (byDay.get(day) ?? []) : []}
                  depositado={day ? taken.has(day) : false}
                  marcado={day ? marcados.includes(day) : false}
                  gapCents={day ? (gapByDay.get(day) ?? 0) : 0}
                  onOpen={setDay}
                  onToggle={toggleDay}
                />
              ))}
            </MonthCalendar>
          </>
        )}
      </div>
      {day && store ? (
        <DayModal
          key={`${store.id}|${day}`}
          day={day}
          today={today}
          rows={byDay.get(day) ?? []}
          shortage={shortages.find((s) => s.day === day)}
          deposit={deposits.find((d) => d.day === day)}
          tenantId={session.tenantId}
          storeId={store.id}
          onClose={() => setDay(null)}
          onSaved={(nextLines, nextShortage) => {
            setLines((current) => current.map((row) => nextLines.find((n) => n.id === row.id) ?? row));
            setShortages((current) => {
              const without = current.filter((s) => s.day !== day);
              return nextShortage ? [...without, nextShortage] : without;
            });
          }}
          onUndo={async (depositId) => {
            try {
              await undoCashDropDeposit(depositId);
              setDeposits((current) => current.filter((d) => d.depositId !== depositId));
              setDay(null);
              setReloadKey((n) => n + 1);
              show("Recebimento desfeito.", "success");
            } catch {
              show("Não foi possível desfazer o recebimento. Tente novamente.", "danger");
              throw new Error("undo");
            }
          }}
        />
      ) : null}
      <ActionModal
        action={action}
        gravando={depositando}
        amount={amountToReceive}
        days={daysReceivables.length}
        gapNoRecebido={action === "aCobrar" && marcados.some((day) => taken.has(day))}
        excludedNoRecebido={action === "fora" && marcados.some((day) => taken.has(day))}
        reason={reasonBatch}
        onReason={setReasonBatch}
        gap={gapBatch}
        onGap={setGapBatch}
        reasonGap={reasonGapBatch}
        onReasonGap={setReasonGapBatch}
        dayRecebido={marcados.length === 1 && taken.has(marcados[0]!)}
        recebimentos={markedDeposits.length}
        daysUndo={daysUndo}
        onClose={() => {
          if (!depositando) setAction(null);
        }}
        onConfirm={() => void confirmAction()}
      />
    </div>
  );
}

function dayChips(total: CashDropAmounts, recebido: boolean, open: boolean): Array<{ color: string; text: string }> {
  if (total.totalCents <= 0 && total.gapCents <= 0) return [];
  const chips: Array<{ color: string; text: string }> = [];
  if (total.boletoCents > 0 && !(open && !recebido)) {
    chips.push(
      recebido
        ? { color: "bg-ok", text: `Recebido ${money(total.boletoCents)}` }
        : { color: "bg-warn", text: `A receber ${money(total.boletoCents)}` },
    );
  }
  if (total.excludedCents > 0) chips.push({ color: "bg-info", text: `Fora ${money(total.excludedCents)}` });
  if (total.gapCents > 0) chips.push({ color: "bg-bad", text: `Falta ${money(total.gapCents)}` });
  return chips;
}

function DayCell({
  index,
  day,
  today,
  rows,
  depositado,
  marcado,
  gapCents,
  onOpen,
  onToggle,
}: {
  index: number;
  day: string | null;
  today: string;
  rows: CashDropLineRow[];
  depositado: boolean;
  marcado: boolean;
  gapCents: number;
  onOpen: (day: string) => void;
  onToggle: (day: string) => void;
}) {
  if (!day) return <div className={blankDayClass(index)} />;
  const total = dayAmounts(rows, gapCents);
  const future = day > today;
  const hasAction = !future && (rows.length > 0 || gapCents > 0 || depositado);
  const partes = rows.length > 0 || gapCents > 0 ? dayChips(total, depositado, day === today) : [];
  const chips = day === today ? [{ color: "bg-acc", text: "Em aberto" }, ...partes] : partes;
  return (
    <DayFace
      index={index}
      iso={day}
      today={today}
      selected={marcado}
      openable={day === today || hasAction}
      openLabel={`Abrir ${dayTitle(day)}`}
      onOpen={() => onOpen(day)}
      amount={rows.length > 0 || day === today ? money(total.totalCents) : null}
      check={hasAction ? { checked: marcado, label: `Marcar ${dayTitle(day)}`, onToggle: () => onToggle(day) } : null}
      badges={chips.length > 0 ? chips.map((chip) => (
        <DayChip key={chip.text} color={chip.color}>{chip.text}</DayChip>
      )) : null}
    />
  );
}

function brlField(cents: number): string {
  if (cents <= 0) return "";
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fieldToCents(txt: string): number | null {
  if (!txt.trim()) return 0;
  const n = parseNum(txt);
  if (n == null || Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100);
}

function MonthSummary({ aCobrar, recebido, excluded, gap }: { aCobrar: number; recebido: number; excluded: number; gap: number }) {
  const cards = [
    { label: "A receber", value: money(aCobrar), color: "var(--t0)", tooltip: "Valor das sangrias que ainda precisa ser repassado pela filial." },
    { label: "Recebido", value: money(recebido), color: "var(--t0)", tooltip: "Valor já recebido." },
    { label: "Fora do boleto", value: money(excluded), color: "var(--t0)", tooltip: "Valor destinado a compras, fornecedores, premiações ou outros pagamentos." },
    { label: "Falta", value: money(gap), color: "var(--t0)", tooltip: "Valor da sangria que deveria estar no caixa e não foi encontrado." },
  ];
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <PlainKpi key={card.label} label={card.label} value={card.value} color={card.color} tooltip={card.tooltip} />
      ))}
    </div>
  );
}

function DayFigures({ items }: { items: Array<{ label: string; value: string; tone: string }> }) {
  const cols = items.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : items.length === 3 ? "sm:grid-cols-3" : items.length === 2 ? "sm:grid-cols-2" : "";
  return (
    <div className={cn("mb-4 grid grid-cols-1 gap-2", cols)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-[14px] border border-line bg-bg-1 px-3 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-t2">{item.label}</p>
          <p className={cn("mt-1 truncate font-mono text-lg font-extrabold", item.tone)}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function DayModal({
  day,
  today,
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
  today: string;
  rows: CashDropLineRow[];
  shortage?: CashDropShortageRow;
  deposit?: CashDropDepositDay;
  tenantId: string;
  storeId: string;
  onClose: () => void;
  onSaved: (lines: CashDropLineRow[], shortage: CashDropShortageRow | null) => void;
  onUndo: (depositId: string) => Promise<void>;
}) {
  const { show } = useToast();
  const [lines, setLines] = useState(rows);
  const [gap, setGap] = useState(() => brlField(shortage?.amountCents ?? 0));
  const [reason, setReason] = useState(shortage?.note ?? "");
  const [salvando, setSalvando] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [daysReceipt, setDaysReceipt] = useState(1);
  const [desfazendo, setDesfazendo] = useState(false);
  const consulta = rows.length === 0;
  const travado = Boolean(deposit);
  const preview = dayAmounts(
    lines.map((line) => ({ amountCents: line.amountCents, kind: line.kind, note: line.note })),
    fieldToCents(gap) ?? shortage?.amountCents ?? 0,
  );
  const metrics = [
    preview.totalCents > 0 ? { label: "Sangrias", value: money(preview.totalCents), tone: "text-t0" } : null,
    preview.boletoCents > 0 ? { label: travado ? "Recebido" : "A receber", value: money(preview.boletoCents), tone: "text-t0" } : null,
    preview.excludedCents > 0 ? { label: "Fora do boleto", value: money(preview.excludedCents), tone: "text-t0" } : null,
    preview.gapCents > 0 ? { label: "Falta", value: money(preview.gapCents), tone: "text-bad" } : null,
  ].filter((item): item is { label: string; value: string; tone: string } => item != null);

  async function save() {
    const cents = fieldToCents(gap);
    if (cents == null) {
      show("O valor da falta não é válido.", "danger");
      return;
    }
    const base = lines.reduce((sum, line) => (line.kind === "purchase" ? sum : sum + line.amountCents), 0);
    if (cents > base) {
      show("A falta não pode passar do valor que iria para o boleto.", "danger");
      return;
    }
    if (!travado && lines.some((line) => line.kind === "purchase" && !line.note.trim())) {
      show("Informe a descrição das sangrias fora do boleto.", "danger");
      return;
    }
    setSalvando(true);
    try {
      for (const line of lines) {
        const before = rows.find((row) => row.id === line.id);
        if (!before || (before.kind === line.kind && before.note === line.note)) continue;
        await saveCashDropLine(line.id, { kind: line.kind, note: line.note });
      }
      const text = cents === 0 ? "" : reason.trim();
      const changedGap = (shortage?.amountCents ?? 0) !== cents || (shortage?.note ?? "") !== text;
      if (changedGap) await saveCashDropShortage(tenantId, storeId, day, cents, text);
      onSaved(lines, cents === 0 ? null : { day, amountCents: cents, note: text });
      show("Sangrias atualizadas.", "success");
      onClose();
    } catch {
      show("Não foi possível salvar a sangria. Tente novamente.", "danger");
    } finally {
      setSalvando(false);
    }
  }

  async function openUndo() {
    if (!deposit) return;
    let n = 1;
    try {
      n = await fetchDepositDayCount(deposit.depositId);
    } catch {
      n = 1;
    }
    setDaysReceipt(Math.max(1, n));
    setConfirmUndo(true);
  }

  async function undo() {
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
      title={(() => {
        const selo = deposit
          ? { variant: "success" as const, text: "Recebido" }
          : day === today
            ? { variant: "accent" as const, text: "Em aberto" }
            : preview.boletoCents > 0
              ? { variant: "warning" as const, text: "A receber" }
              : null;
        return (
          <>
            <span>{dayTitle(day)}</span>
            {selo ? <Badge variant={selo.variant}>{selo.text}</Badge> : null}
          </>
        );
      })()}
      footer={
        consulta ? (
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
        ) : (
          <>
            {deposit ? (
              <Button variant="outline" onClick={() => void openUndo()} disabled={salvando || desfazendo}>
                Desfazer recebimento
              </Button>
            ) : null}
            <Button variant="outline" onClick={onClose} disabled={salvando || desfazendo}>
              Cancelar
            </Button>
            <Button onClick={() => void save()} disabled={salvando || desfazendo}>
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
          {metrics.length > 0 ? <DayFigures items={metrics} /> : null}
          <ul className="space-y-3">
            {lines.map((line) => {
              const excluded = line.kind === "purchase";
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
                    onChange={(e) => setLines((current) => current.map((row) => (row.id === line.id ? { ...row, note: e.target.value } : row)))}
                  />
                  <div className="mt-2">
                    {travado ? (
                      <>
                        <p className="text-[13px] font-semibold text-t0">{excluded ? "Fora do boleto" : "Recebido"}</p>
                        <p className="mt-1 text-[12px] text-t2">Desfaça o recebimento para alterar.</p>
                      </>
                    ) : (
                      <Segmented
                        options={[
                          { value: "deposit", label: "A receber" },
                          { value: "purchase", label: "Fora do boleto" },
                        ]}
                        value={line.kind}
                        onChange={(kind) => {
                          if (!kind) return;
                          setLines((current) => current.map((row) => (row.id === line.id ? { ...row, kind } : row)));
                        }}
                      />
                    )}
                    {excluded && !travado ? <p className="mt-1 text-[12px] text-t2">A descrição é obrigatória.</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 rounded-[14px] border border-line p-3">
            <p className="text-[12.5px] font-bold text-t0">Falta em dinheiro</p>
            {travado ? <p className="mt-1 text-[12px] text-t2">Este dia já foi recebido. A falta reduz o valor recebido.</p> : null}
            <NumberInput className="mt-2" compact unit="R$" value={gap} aria-label="Valor da falta" onChange={setGap} />
            <p className="mt-3 text-[12.5px] font-bold text-t0">Motivo da falta</p>
            <input
              className="mt-2 w-full rounded-[10px] border border-line bg-bg-1 px-2.5 py-2 text-[13px] text-t0"
              value={reason}
              placeholder="Ex.: diferença no caixa"
              aria-label="Motivo da falta"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </>
      )}
    </Modal>
    <Modal
      open={confirmUndo}
      onClose={() => {
        if (!desfazendo) setConfirmUndo(false);
      }}
      title="Desfazer recebimento?"
      footer={
        <>
          <Button variant="outline" onClick={() => setConfirmUndo(false)} disabled={desfazendo}>
            Cancelar
          </Button>
          <Button onClick={() => void undo()} disabled={desfazendo}>
            {desfazendo ? "Desfazendo…" : "Desfazer recebimento"}
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] text-t1">
        {daysReceipt <= 1
          ? "O valor voltará para A receber."
          : `Este recebimento inclui ${daysReceipt} dias. Ao desfazer, os valores de todos eles voltarão para A receber.`}
      </p>
    </Modal>
    </>
  );
}

function MarkAs({
  days,
  label,
  amount,
  recebidoOk,
  excludedOk,
  cobrarOk,
  tudoRecebido,
  canUndo,
  onRecebido,
  onCobrar,
  onExcluded,
  onGap,
  onUndo,
}: {
  days: number;
  label: string;
  amount: number;
  recebidoOk: boolean;
  excludedOk: boolean;
  cobrarOk: boolean;
  tudoRecebido: boolean;
  canUndo: boolean;
  onRecebido: () => void;
  onCobrar: () => void;
  onExcluded: () => void;
  onGap: () => void;
  onUndo: () => void;
}) {
  if (days === 0) return <Button disabled>Marcar como</Button>;
  const items: DropdownItem[] = [
    ...(canUndo
      ? [
          {
            label: "Desfazer recebimento",
            description: "Devolve o valor recebido para A receber.",
            onClick: onUndo,
          },
          { divider: true, label: "" },
        ]
      : []),
    {
      label: "Recebido",
      description: recebidoOk
        ? "Registra como recebido o valor a receber dos dias selecionados."
        : tudoRecebido
          ? "Estes dias já foram recebidos."
          : "Não há valor a receber nos dias selecionados.",
      disabled: !recebidoOk,
      onClick: onRecebido,
    },
    {
      label: "A receber",
      description: cobrarOk
        ? "Devolve as sangrias dos dias selecionados para A receber."
        : tudoRecebido
          ? "Desfaça o recebimento para alterar estes dias."
          : "Não há sangrias fora do boleto nos dias selecionados.",
      disabled: !cobrarOk,
      onClick: onCobrar,
    },
    {
      label: "Fora do boleto",
      description: excludedOk
        ? "Retira do boleto as sangrias dos dias selecionados."
        : tudoRecebido
          ? "Desfaça o recebimento para alterar estes dias."
          : "Não há sangrias a receber nos dias selecionados.",
      disabled: !excludedOk,
      onClick: onExcluded,
    },
    {
      label: "Registrar falta",
      description: days === 1 ? "Informe o valor que deveria estar no caixa e não foi encontrado." : "Selecione apenas um dia para registrar a falta.",
      disabled: days !== 1,
      onClick: onGap,
    },
  ];
  return (
    <div className="flex flex-col items-start gap-1.5 lg:flex-row lg:items-center">
      <Dropdown portal align="right" menuClassName="w-[320px]" trigger={<Button>{label}</Button>} items={items} />
      <span className="text-[13px] font-semibold text-t1">{money(amount)} a receber</span>
    </div>
  );
}

function ActionModal({
  action,
  gravando,
  amount,
  days,
  gapNoRecebido,
  excludedNoRecebido,
  reason,
  onReason,
  gap,
  onGap,
  reasonGap,
  onReasonGap,
  dayRecebido,
  recebimentos,
  daysUndo,
  onClose,
  onConfirm,
}: {
  action: ActionBatch | null;
  gravando: boolean;
  amount: number;
  days: number;
  gapNoRecebido: boolean;
  excludedNoRecebido: boolean;
  reason: string;
  onReason: (value: string) => void;
  gap: string;
  onGap: (value: string) => void;
  reasonGap: string;
  onReasonGap: (value: string) => void;
  dayRecebido: boolean;
  recebimentos: number;
  daysUndo: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const title =
    action === "recebido"
      ? `Marcar ${money(amount)} como recebido?`
      : action === "aCobrar"
        ? "Marcar como A receber?"
        : action === "fora"
          ? "Fora do boleto"
          : action === "falta"
            ? "Registrar falta"
            : action === "desfazer"
              ? "Desfazer recebimento?"
              : "";
  const confirm =
    action === "recebido"
      ? "Marcar como recebido"
      : action === "aCobrar"
        ? "Marcar como A receber"
        : action === "fora"
          ? "Marcar como fora do boleto"
          : action === "desfazer"
            ? "Desfazer recebimento"
            : "Registrar falta";
  return (
    <Modal
      open={action != null}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={gravando}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={gravando}>
            {gravando ? (action === "desfazer" ? "Desfazendo…" : "Salvando…") : confirm}
          </Button>
        </>
      }
    >
      {action === "desfazer" ? (
        <p className="text-[13.5px] text-t1">
          {recebimentos > 1
            ? `${recebimentos} recebimentos serão desfeitos. Os valores voltam para A receber.`
            : daysUndo <= 1
              ? "O valor voltará para A receber."
              : `Este recebimento inclui ${daysUndo} dias. Ao desfazer, os valores de todos eles voltarão para A receber.`}
        </p>
      ) : null}
      {action === "recebido" ? (
        <p className="text-[13.5px] text-t1">{days === 1 ? "1 dia será incluído neste recebimento." : `${days} dias serão incluídos neste recebimento.`}</p>
      ) : null}
      {action === "aCobrar" ? (
        <p className="text-[13.5px] text-t1">
          {gapNoRecebido
            ? "As sangrias fora do boleto voltarão para A receber. Os dias já recebidos não mudam."
            : "As sangrias dos dias selecionados voltarão para A receber."}
        </p>
      ) : null}
      {action === "fora" ? (
        <div>
          <p className="text-[13.5px] text-t1">
            {excludedNoRecebido
              ? "As sangrias a receber dos dias selecionados ficarão fora do boleto. Os dias já recebidos não mudam."
              : "Todas as sangrias dos dias selecionados ficarão fora do boleto."}
          </p>
          <p className="mt-3 text-[12.5px] font-bold text-t0">Motivo</p>
          <input
            className="mt-2 w-full rounded-[10px] border border-line bg-bg-1 px-2.5 py-2 text-[13px] text-t0"
            value={reason}
            placeholder="Ex.: pagamento de fornecedor"
            aria-label="Motivo"
            onChange={(e) => onReason(e.target.value)}
          />
          <p className="mt-1 text-[12px] text-t2">A descrição que a sangria já tem permanece.</p>
        </div>
      ) : null}
      {action === "falta" ? (
        <div>
          <p className="text-[13.5px] text-t1">Informe o valor que deveria estar no caixa e não foi encontrado.</p>
          {dayRecebido ? <p className="mt-2 text-[13.5px] text-t1">Este dia já foi recebido. A falta reduz o valor recebido.</p> : null}
          <p className="mt-3 text-[12.5px] font-bold text-t0">Valor da falta</p>
          <NumberInput className="mt-2" compact unit="R$" value={gap} aria-label="Valor da falta" onChange={onGap} />
          <p className="mt-3 text-[12.5px] font-bold text-t0">Motivo da falta</p>
          <input
            className="mt-2 w-full rounded-[10px] border border-line bg-bg-1 px-2.5 py-2 text-[13px] text-t0"
            value={reasonGap}
            placeholder="Ex.: diferença no caixa"
            aria-label="Motivo da falta"
            onChange={(e) => onReasonGap(e.target.value)}
          />
        </div>
      ) : null}
    </Modal>
  );
}

