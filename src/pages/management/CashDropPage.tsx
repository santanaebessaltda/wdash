import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Card, DateRangePicker, Dropdown, FormField, Input, Modal, Segmented, useToast, CALENDAR_QUICK_RANGES, Badge, type DatePresetId, type DateRangeChangeMeta, type DropdownItem } from "@/components/ui";
import { ColorLegend, type LegendItem } from "@/components/wedash/ColorLegend";
import { FinanceMonthSkeleton } from "@/components/wedash/LoadingSkeletons";
import { DayFace, MonthCalendar, blankDayClass } from "@/components/wedash/MonthCalendar";
import { StoreDivisionTitle } from "@/components/wedash/StoreDivisionTitle";
import { calendarTodayIso } from "@/data/wedash/clock";
import { isOwner } from "@/layout/nav-wedash";
import { periodLabels } from "@/data/wedash/dashboard";
import { fetchLatestCashCloseError, fetchNavMonthFloor, fetchOpenCashCloseJob, requestCashDropMonth } from "@/data/wedash/cashCloseRepo";
import { addMonths } from "@/data/wedash/engine/format";
import { goalMonthFloor, laterMonth } from "@/data/wedash/goalMonths";
import { fetchGoals } from "@/data/wedash/goalsRepo";
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
import { statusBadgeVariant } from "@/lib/status";
import { brlCent, longDate, isoToDate, endOfMonth, startOfMonth, dateToIso, addDays } from "@/lib/format";
import { cn } from "@/lib/cn";
import { filterCacheGet, filterCacheSet } from "@/lib/filterCache";
import { useFilterSkeleton } from "@/lib/useFilterSkeleton";
import { refreshMomentTitle, useScreenRefresh } from "@/pages/dashboard/screenRefresh";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { NumberInput, SectionHeader, parseNum, useScopedStores } from "@/pages/operation/shared";
import { DayChip, PlainKpi } from "@/pages/cash-close/CashClosePage";
import { monthsTouched, cashDropMonthSpan } from "@/data/wedash/cashCloseMonth";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { HeaderFilters } from "@/pages/stock/shared";

const money = (cents: number) => brlCent(cents / 100);

type ActionBatch = "recebido" | "aCobrar" | "fora" | "falta" | "desfazer";
type DropLine = CashDropLineRow & { storeId: string };
type DropDeposit = CashDropDepositDay & { storeId: string };
type DropShortage = CashDropShortageRow & { storeId: string };

type CashDropMonthCache = { lines: DropLine[]; deposits: DropDeposit[]; shortages: DropShortage[] };

function cashDropCacheReady(c: CashDropMonthCache | null): c is CashDropMonthCache {
  return c != null && Array.isArray(c.lines) && Array.isArray(c.deposits) && Array.isArray(c.shortages);
}

function storeTotals(
  storeIds: string[],
  lines: DropLine[],
  deposits: DropDeposit[],
  shortages: DropShortage[],
  today: string,
) {
  let aCobrar = 0;
  let recebido = 0;
  let excluded = 0;
  let gap = 0;
  for (const storeId of storeIds) {
    const storeLines = lines.filter((line) => line.storeId === storeId);
    const gaps = new Map(shortages.filter((row) => row.storeId === storeId).map((row) => [row.day, row.amountCents]));
    const takenDays = new Set(deposits.filter((row) => row.storeId === storeId).map((row) => row.day));
    const days = new Set<string>([...storeLines.map((line) => line.day), ...gaps.keys()]);
    const summed = sumAmounts([...days].map((day) => dayAmounts(storeLines.filter((line) => line.day === day), gaps.get(day) ?? 0)));
    excluded += summed.excludedCents;
    gap += summed.gapCents;
    aCobrar += depositBoleto(storeLines, [...days].filter((day) => !takenDays.has(day) && day <= today), gaps);
    recebido += depositBoleto(storeLines, [...takenDays], gaps);
  }
  return { aCobrar, recebido, excluded, gap };
}

function dayAcrossStores(
  day: string,
  today: string,
  stores: Array<{ id: string }>,
  lines: DropLine[],
  deposits: DropDeposit[],
  shortages: DropShortage[],
) {
  let total = 0;
  let aReceber = 0;
  let recebido = 0;
  let excluded = 0;
  let gap = 0;
  let has = false;
  for (const store of stores) {
    const rows = lines.filter((line) => line.storeId === store.id && line.day === day);
    const gapCents = shortages.find((row) => row.storeId === store.id && row.day === day)?.amountCents ?? 0;
    const depositado = deposits.some((row) => row.storeId === store.id && row.day === day);
    if (rows.length === 0 && gapCents === 0 && !depositado) continue;
    has = true;
    const amounts = dayAmounts(rows, gapCents);
    total += amounts.totalCents;
    excluded += amounts.excludedCents;
    gap += amounts.gapCents;
    if (depositado) recebido += amounts.boletoCents;
    else aReceber += amounts.boletoCents;
  }
  const chips: Array<{ color: string; text: string }> = [];
  if (day === today) chips.push({ color: "bg-acc", text: "Em aberto" });
  if (day < today && aReceber > 0) chips.push({ color: "bg-warn", text: `A receber ${money(aReceber)}` });
  if (day < today && recebido > 0) chips.push({ color: "bg-ok", text: `Recebido ${money(recebido)}` });
  if (excluded > 0) chips.push({ color: "bg-info", text: `Fora ${money(excluded)}` });
  if (gap > 0) chips.push({ color: "bg-bad", text: `Falta ${money(gap)}` });
  return { total, chips, has };
}

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

/** Financeiro > Sangrias. Calendário do mês e o recebimento dos dias em aberto. */
export function CashDropPage() {
  const { show } = useToast();
  const { session, storeRows, loading: storesLoading } = useScopedStores();
  const gestor = isOwner(session.role);
  const manyStores = storeRows.length > 1;
  const today = calendarTodayIso();
  const [rangeFrom, setRangeFrom] = useState(() => startOfMonth(today));
  const [rangeTo, setRangeTo] = useState(() => endOfMonth(today));
  const [presetId, setPresetId] = useState<DatePresetId | null>("thisMonth");
  const [floor, setFloor] = useState(() => startOfMonth(today));
  const [lines, setLines] = useState<DropLine[]>([]);
  const [deposits, setDeposits] = useState<DropDeposit[]>([]);
  const [shortages, setShortages] = useState<DropShortage[]>([]);
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
  const storesRef = useRef(storeRows);
  storesRef.current = storeRows;
  const storeKey = storeRows.map((item) => item.id).join(",");
  const rangeFromRef = useRef(rangeFrom);
  rangeFromRef.current = rangeFrom;
  const rangeToRef = useRef(rangeTo);
  rangeToRef.current = rangeTo;
  const from = rangeFrom;
  const to = rangeTo;
  const cells = useMemo(() => rangeCells(from, to), [from, to]);
  const filterKey = `cashdrop:${session.tenantId}:${storeKey}:${from}:${to}`;
  const { showSkeleton: filterSkeleton, settle } = useFilterSkeleton(filterKey);
  const showSkeleton = storesLoading || filterSkeleton;
  const band = filterKey;
  const reloadGen = useRef(0);

  const [storeView, setStoreView] = useState(storeKey);
  if (storeView !== storeKey) {
    setStoreView(storeKey);
    setDay(null);
    setMarcados([]);
    setAction(null);
  }
  useEffect(() => {
    if (storesLoading || !storeKey) return;
    let stop = false;
    const ids = storeKey.split(",");
    void Promise.all([
      Promise.all(ids.map((id) => fetchNavMonthFloor("sangria_line", session.tenantId, id, today))),
      fetchGoals({
        tenantId: session.tenantId,
        storeIds: ids,
        from: addMonths(today, -36),
        to: endOfMonth(today),
        includeDrafts: true,
      }),
    ]).then(([months, goals]) => {
      if (stop || months.length === 0) return;
      const dataFloor = months.reduce((earliest, item) => (item < earliest ? item : earliest));
      const month = laterMonth(dataFloor, goalMonthFloor(today, goals));
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
  }, [storesLoading, storeKey, session.tenantId, today, reloadKey]);

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
    const ids = storesRef.current.map((item) => item.id);
    if (ids.length === 0) return;
    const months = monthsTouched(rangeFromRef.current, rangeToRef.current);
    const todayIso = calendarTodayIso();
    const withDay = months.filter((month) => cashDropMonthSpan(month, todayIso));
    const targets = withDay.length > 0 ? withDay : [months[0]];
    for (const month of targets) {
      const r = await requestCashDropMonth(ids, month);
      if (!r.ok) {
        show(r.message, "danger");
        return;
      }
    }
    setSyncing(true);
  }, [show]);

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
    if (storesLoading) return;
    const gen = ++reloadGen.current;
    const key = filterKey;
    if (storeRows.length === 0) {
      setLines([]);
      setDeposits([]);
      setShortages([]);
      setLoaded(key);
      settle(key);
      return;
    }
    const cached = filterCacheGet<CashDropMonthCache>(key);
    if (cashDropCacheReady(cached)) {
      setLines(cached.lines);
      setDeposits(cached.deposits);
      setShortages(cached.shortages);
      setLoaded(key);
      settle(key);
    }
    let cancel = false;
    setError(false);
    void Promise.all(
      storeRows.map(async (item) => {
        const res = await fetchCashDropMonth(session.tenantId, item.id, from, to);
        return {
          lines: res.lines.map((line) => ({ ...line, storeId: item.id })),
          deposits: res.deposits.map((row) => ({ ...row, storeId: item.id })),
          shortages: res.shortages.map((row) => ({ ...row, storeId: item.id })),
        };
      }),
    )
      .then((parts) => {
        if (cancel || gen !== reloadGen.current) return;
        const nextDeposits = parts.flatMap((part) => part.deposits);
        const nextLines = parts.flatMap((part) => part.lines);
        const nextShortages = parts.flatMap((part) => part.shortages);
        filterCacheSet(key, { lines: nextLines, deposits: nextDeposits, shortages: nextShortages } satisfies CashDropMonthCache);
        setLines(nextLines);
        setDeposits(nextDeposits);
        setShortages(nextShortages);
        setLoaded(key);
        settle(key);
        setMarcados((current) => current.filter((day) => !nextDeposits.some((row) => row.day === day)));
      })
      .catch(() => {
        if (cancel || gen !== reloadGen.current) return;
        setError(true);
        if (!cashDropCacheReady(cached)) settle(key);
      });
    return () => {
      cancel = true;
    };
  }, [storesLoading, storeRows, session.tenantId, from, to, filterKey, reloadKey, settle]);

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
  const monthCards = useMemo(
    () => storeTotals(storeRows.map((item) => item.id), lines, deposits, shortages, today),
    [storeRows, lines, deposits, shortages, today],
  );
  const open = monthCards.aCobrar;
  const depositado = monthCards.recebido;
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
  const pronto = loaded === band && !showSkeleton;
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
          const without = current.filter((s) => !(s.storeId === store.id && s.day === day));
          return cents === 0 ? without : [...without, { storeId: store.id, day, amountCents: cents, note: text }];
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
        section="Financeiro"
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
            {!manyStores && store ? <MarkAs days={marcados.length} label={markLabel} amount={amountToReceive} recebidoOk={daysReceivables.length > 0} excludedOk={linesBoletoAbertas.length > 0} cobrarOk={linesExcludedAbertas.length > 0} tudoRecebido={marcados.length > 0 && marcados.every((day) => taken.has(day))} canUndo={gestor && markedDeposits.length > 0} gapOk={gestor || marcados.every((day) => !taken.has(day))} onRecebido={() => setAction("recebido")} onCobrar={() => setAction("aCobrar")} onExcluded={() => { setReasonBatch(""); setAction("fora"); }} onGap={openShortage} onUndo={() => void openUndo()} /> : null}
          </HeaderFilters>
        }
      />
      <div className="mt-6 pb-8">
        {error ? <Alert className="mb-4" variant="danger" title="Não foi possível carregar as sangrias. Tente novamente." /> : null}
        {showSkeleton || (storeRows.length > 0 && !pronto) ? (
          <FinanceMonthSkeleton
            cells={cells}
            today={today}
            kpis={4}
            columns="sm:grid-cols-2 lg:grid-cols-4"
            hint
            marked={storeRows.length === 1}
            legend={storeRows.length > 0 ? <ColorLegend mark="square" items={DROP_LEGEND} /> : undefined}
          />
        ) : storeRows.length === 0 || !store ? (
          <Card className="flex min-h-[280px] flex-col">
            <EmptyBlock icon="💵" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : (
          <>
            <MonthSummary aCobrar={open} recebido={depositado} excluded={monthCards.excluded} gap={monthCards.gap} />
            <div className="mb-3">
              <ColorLegend mark="square" items={DROP_LEGEND} />
            </div>
            <MonthCalendar>
              {cells.map((day, i) => {
                const across = day && manyStores && day <= today ? dayAcrossStores(day, today, storeRows, lines, deposits, shortages) : null;
                return (
                  <DayCell
                    key={day ?? `vazio-${i}`}
                    index={i}
                    day={day}
                    today={today}
                    rows={day ? (byDay.get(day) ?? []) : []}
                    depositado={day ? taken.has(day) : false}
                    marcado={day ? marcados.includes(day) : false}
                    gapCents={day ? (gapByDay.get(day) ?? 0) : 0}
                    chips={across?.chips}
                    amountCents={across && (day === today || across.has) ? across.total : undefined}
                    openable={across ? day === today || across.has : undefined}
                    allowMark={!manyStores}
                    onOpen={setDay}
                    onToggle={toggleDay}
                  />
                );
              })}
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
          gestor={gestor}
          tenantId={session.tenantId}
          storeId={store.id}
          onClose={() => setDay(null)}
          onSaved={(nextLines, nextShortage) => {
            setLines((current) => current.map((row) => {
              const next = nextLines.find((item) => item.id === row.id);
              return next ? { ...next, storeId: row.storeId } : row;
            }));
            setShortages((current) => {
              const without = current.filter((s) => !(s.storeId === store.id && s.day === day));
              return nextShortage ? [...without, { ...nextShortage, storeId: store.id }] : without;
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
      {day && manyStores ? (
        <StoresDayModal
          gestor={gestor}
          day={day}
          today={today}
          blocks={storeRows.flatMap((item) => {
            const rows = lines.filter((line) => line.storeId === item.id && line.day === day);
            const shortage = shortages.find((row) => row.storeId === item.id && row.day === day);
            const deposit = deposits.find((row) => row.storeId === item.id && row.day === day);
            if (rows.length === 0 && !shortage && !deposit) return [];
            return [{ storeId: item.id, storeName: item.tradeName, rows, shortage, deposit }];
          })}
          tenantId={session.tenantId}
          onClose={() => setDay(null)}
          onSaved={(storeId, nextLines, nextShortage) => {
            setLines((current) => current.map((row) => {
              const next = nextLines.find((item) => item.id === row.id);
              return next ? { ...next, storeId: row.storeId } : row;
            }));
            setShortages((current) => {
              const without = current.filter((row) => !(row.storeId === storeId && row.day === day));
              return nextShortage ? [...without, { ...nextShortage, storeId }] : without;
            });
          }}
          onUndo={async (depositId) => {
            try {
              await undoCashDropDeposit(depositId);
              setDeposits((current) => current.filter((row) => row.depositId !== depositId));
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

const DROP_LEGEND: LegendItem[] = [
  { key: "today", color: "bg-acc", label: "Em aberto" },
  { key: "due", color: "bg-warn", label: "A receber" },
  { key: "paid", color: "bg-ok", label: "Recebido" },
  { key: "out", color: "bg-info", label: "Fora" },
  { key: "gap", color: "bg-bad", label: "Falta" },
];

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
  chips: chipOverride,
  amountCents,
  openable: openableOverride,
  allowMark = true,
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
  chips?: Array<{ color: string; text: string }>;
  amountCents?: number;
  openable?: boolean;
  allowMark?: boolean;
  onOpen: (day: string) => void;
  onToggle: (day: string) => void;
}) {
  if (!day) return <div className={blankDayClass(index)} />;
  const total = dayAmounts(rows, gapCents);
  const future = day > today;
  const hasAction = !future && (rows.length > 0 || gapCents > 0 || depositado);
  const partes = rows.length > 0 || gapCents > 0 ? dayChips(total, depositado, day === today) : [];
  const chips = chipOverride ?? (day === today ? [{ color: "bg-acc", text: "Em aberto" }, ...partes] : partes);
  const shown = amountCents ?? total.totalCents;
  const canOpen = openableOverride ?? (day === today || hasAction);
  return (
    <DayFace
      index={index}
      iso={day}
      today={today}
      selected={allowMark && marcado}
      openable={canOpen}
      openLabel={`Abrir ${dayTitle(day)}`}
      onOpen={() => onOpen(day)}
      amount={rows.length > 0 || day === today || amountCents != null ? money(shown) : null}
      check={allowMark && hasAction ? { checked: marcado, label: `Marcar ${dayTitle(day)}`, onToggle: () => onToggle(day) } : null}
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

function DropShell({
  embedded,
  storeName,
  title,
  footer,
  onClose,
  children,
}: {
  embedded: boolean;
  storeName?: string;
  title: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  if (embedded) {
    return (
      <section className="border-t border-line pb-6 pt-5 first:border-t-0 first:pt-0 last:pb-0">
        {storeName ? <StoreDivisionTitle className="mb-3">{storeName}</StoreDivisionTitle> : null}
        {children}
        {footer ? <div className="mt-4 flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </section>
    );
  }
  return (
    <Modal open onClose={onClose} size="lg" title={title} footer={footer}>
      {children}
    </Modal>
  );
}

function StoresDayModal({
  gestor,
  day,
  today,
  blocks,
  tenantId,
  onClose,
  onSaved,
  onUndo,
}: {
  gestor: boolean;
  day: string;
  today: string;
  blocks: Array<{ storeId: string; storeName: string; rows: DropLine[]; shortage?: DropShortage; deposit?: DropDeposit }>;
  tenantId: string;
  onClose: () => void;
  onSaved: (storeId: string, lines: CashDropLineRow[], shortage: CashDropShortageRow | null) => void;
  onUndo: (depositId: string) => Promise<void>;
}) {
  const { show } = useToast();
  const savers = useRef(new Map<string, () => Promise<boolean>>());
  const [salvando, setSalvando] = useState(false);
  const canSave = blocks.some((block) => block.rows.length > 0 && (gestor || !block.deposit));
  const bindSave = useCallback((storeId: string, save: (() => Promise<boolean>) | null) => {
    if (save) savers.current.set(storeId, save);
    else savers.current.delete(storeId);
  }, []);

  async function saveAll() {
    setSalvando(true);
    try {
      for (const block of blocks) {
        if (block.rows.length === 0) continue;
        const save = savers.current.get(block.storeId);
        if (!save) continue;
        const ok = await save();
        if (!ok) return;
      }
      show("Sangrias atualizadas.", "success");
      onClose();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!salvando) onClose();
      }}
      size="lg"
      title={dayTitle(day)}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={salvando}>
            {canSave ? "Cancelar" : "Voltar"}
          </Button>
          {canSave ? (
            <Button onClick={() => void saveAll()} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar"}
            </Button>
          ) : null}
        </>
      }
    >
      {blocks.length === 0 ? (
        <p className="text-[13.5px] text-t2">Nenhuma sangria neste dia.</p>
      ) : (
        blocks.map((block) => (
          <DayModal
            key={block.storeId}
            gestor={gestor}
            embedded
            busy={salvando}
            onBindSave={bindSave}
            storeName={block.storeName}
            day={day}
            today={today}
            rows={block.rows}
            shortage={block.shortage}
            deposit={block.deposit}
            tenantId={tenantId}
            storeId={block.storeId}
            onClose={onClose}
            onSaved={(nextLines, nextShortage) => onSaved(block.storeId, nextLines, nextShortage)}
            onUndo={onUndo}
          />
        ))
      )}
    </Modal>
  );
}

function DayModal({
  gestor,
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
  embedded = false,
  storeName,
  busy = false,
  onBindSave,
}: {
  gestor: boolean;
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
  embedded?: boolean;
  storeName?: string;
  busy?: boolean;
  onBindSave?: (storeId: string, save: (() => Promise<boolean>) | null) => void;
}) {
  const { show } = useToast();
  const [lines, setLines] = useState(rows);
  const [gap, setGap] = useState(() => brlField(shortage?.amountCents ?? 0));
  const [reason, setReason] = useState(shortage?.note ?? "");
  const [salvando, setSalvando] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [daysReceipt, setDaysReceipt] = useState(1);
  const [desfazendo, setDesfazendo] = useState(false);
  const persist = useRef<(quiet: boolean) => Promise<boolean>>(async () => false);
  const consulta = rows.length === 0;
  const travado = Boolean(deposit);
  const concluido = travado && !gestor;
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

  function fail(message: string) {
    show(storeName ? `${storeName}: ${message}` : message, "danger");
  }

  async function save(quiet = false) {
    if (concluido) return false;
    const cents = fieldToCents(gap);
    if (cents == null) {
      fail("O valor da falta não é válido.");
      return false;
    }
    const base = lines.reduce((sum, line) => (line.kind === "purchase" ? sum : sum + line.amountCents), 0);
    if (cents > base) {
      fail("A falta não pode passar do valor que iria para o boleto.");
      return false;
    }
    if (!travado && lines.some((line) => line.kind === "purchase" && !line.note.trim())) {
      fail("Informe a descrição das sangrias fora do boleto.");
      return false;
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
      if (!quiet) {
        show("Sangrias atualizadas.", "success");
        if (!embedded) onClose();
      }
      return true;
    } catch {
      fail("Não foi possível salvar a sangria. Tente novamente.");
      return false;
    } finally {
      setSalvando(false);
    }
  }

  persist.current = save;

  useEffect(() => {
    if (!onBindSave) return;
    if (concluido) {
      onBindSave(storeId, null);
      return;
    }
    onBindSave(storeId, () => persist.current(true));
    return () => onBindSave(storeId, null);
  }, [onBindSave, storeId, concluido]);

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

  const selo = deposit ? "Recebido" : day === today ? "Em aberto" : preview.boletoCents > 0 ? "A receber" : null;
  const title = (
    <>
      <span>{dayTitle(day)}</span>
      {selo ? <Badge variant={statusBadgeVariant(selo)}>{selo}</Badge> : null}
    </>
  );
  const travadoUi = salvando || desfazendo || busy;
  const desfazer = gestor && deposit ? (
    <Button variant="outline" onClick={() => void openUndo()} disabled={travadoUi}>
      Desfazer recebimento
    </Button>
  ) : null;
  const footer = embedded ? (
    desfazer
  ) : consulta || concluido ? (
    <Button variant="outline" onClick={onClose}>
      Voltar
    </Button>
  ) : (
    <>
      {desfazer}
      <Button variant="outline" onClick={onClose} disabled={travadoUi}>
        Cancelar
      </Button>
      <Button onClick={() => void save()} disabled={travadoUi}>
        {salvando ? "Salvando…" : "Salvar"}
      </Button>
    </>
  );

  return (
    <>
    <DropShell
      embedded={embedded}
      storeName={storeName}
      title={title}
      footer={footer}
      onClose={() => {
        if (!salvando && !desfazendo) onClose();
      }}
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
                  <div className="mt-2">
                    <FormField label="Descrição" required={excluded}>
                      <Input
                        value={line.note}
                        aria-label="Descrição"
                        placeholder="Descrição"
                        disabled={travado}
                        onChange={(e) => setLines((current) => current.map((row) => (row.id === line.id ? { ...row, note: e.target.value } : row)))}
                      />
                    </FormField>
                  </div>
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
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 rounded-[14px] border border-line p-3">
            <p className="text-[12.5px] font-bold text-t0">Falta em dinheiro</p>
            {travado ? <p className="mt-1 text-[12px] text-t2">Este dia já foi recebido. A falta reduz o valor recebido.</p> : null}
            <NumberInput className="mt-2" compact unit="R$" value={gap} aria-label="Valor da falta" onChange={setGap} disabled={concluido} />
            <div className="mt-3">
              <FormField label="Motivo da falta" optional>
                <Input
                  value={reason}
                  placeholder="Ex.: diferença no caixa"
                  aria-label="Motivo da falta"
                  disabled={concluido}
                  onChange={(e) => setReason(e.target.value)}
                />
              </FormField>
            </div>
          </div>
        </>
      )}
    </DropShell>
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
  gapOk,
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
  gapOk: boolean;
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
      description: days !== 1 ? "Selecione apenas um dia para registrar a falta." : gapOk ? "Informe o valor que deveria estar no caixa e não foi encontrado." : "Este dia já foi recebido.",
      disabled: days !== 1 || !gapOk,
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
          <div className="mt-3">
            <FormField label="Motivo" required>
              <Input
                value={reason}
                placeholder="Ex.: pagamento de fornecedor"
                aria-label="Motivo"
                onChange={(e) => onReason(e.target.value)}
              />
            </FormField>
          </div>
          <p className="mt-1 text-[12px] text-t2">A descrição que a sangria já tem permanece.</p>
        </div>
      ) : null}
      {action === "falta" ? (
        <div>
          <p className="text-[13.5px] text-t1">Informe o valor que deveria estar no caixa e não foi encontrado.</p>
          {dayRecebido ? <p className="mt-2 text-[13.5px] text-t1">Este dia já foi recebido. A falta reduz o valor recebido.</p> : null}
          <div className="mt-3">
            <FormField label="Valor da falta" required>
              <NumberInput compact unit="R$" value={gap} aria-label="Valor da falta" onChange={onGap} />
            </FormField>
          </div>
          <div className="mt-3">
            <FormField label="Motivo da falta" optional>
              <Input
                value={reasonGap}
                placeholder="Ex.: diferença no caixa"
                aria-label="Motivo da falta"
                onChange={(e) => onReasonGap(e.target.value)}
              />
            </FormField>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

