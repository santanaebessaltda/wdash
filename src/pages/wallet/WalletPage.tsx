import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Badge, Button, Card, CardTitle, Checkbox, DataTable, DateRangePicker, Dropdown, Modal, PageHeader, Skeleton, StatCard, Tooltip, CALENDAR_QUICK_RANGES, type DataTableColumn, type DatePresetId, type DateRangeChangeMeta } from "@/components/ui";
import { WedashBrand } from "@/components/wedash/WedashBrand";
import { calendarTodayIso } from "@/data/wedash/clock";
import { periodLabels } from "@/data/wedash/dashboard";
import { monthsTouched } from "@/data/wedash/cashCloseMonth";
import { startOfMonth } from "@/data/wedash/engine/format";
import { sellerHistoryFloor } from "@/data/wedash/engine/sellerHome";
import { opportunitiesInRange, type WalletChallengeOpportunity, type WalletGoalOpportunity, type WalletOpportunity } from "@/data/wedash/engine/sellerOpportunity";
import { walletInRange, type WalletLine, type WalletMonth, type WalletPersonMonth } from "@/data/wedash/engine/wallet";
import { loadBranchWallet, loadSellerWallet } from "@/data/wedash/walletLoad";
import { effectiveWeekHours } from "@/data/wedash/storeHours";
import { cn } from "@/lib/cn";
import { brlCent, dateToIso, endOfMonth, fullDate, isoToDate } from "@/lib/format";
import { exportPdf, usePrintMode } from "@/lib/printMode";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { CheckCircleIcon, FlameIcon, TargetIcon, TrophyIcon } from "@/pages/dashboards/icons";
import { SectionHeader, useScopedStores } from "@/pages/operation/shared";
import type { Store } from "@/data/wedash/stores";
import { HeaderFilters } from "@/pages/stock/shared";

const money = (cents: number) => brlCent(cents / 100);

/** Positivo ainda tem valor a receber. Negativo já passou da premiação. Zero fica na cor do texto. */
function balanceClass(cents: number): string {
  if (cents > 0) return "text-ok";
  if (cents < 0) return "text-bad";
  return "text-t0";
}

function lineTitle(line: WalletLine): string {
  if (line.kind === "prize") return `Premiação · ${line.title}`;
  if (line.kind === "bonus") return `Bônus · ${line.title}`;
  if (line.kind === "management") return `Premiação da gerência · ${line.title}`;
  if (line.kind === "managementBonus") return `Bônus da gerência · ${line.title}`;
  if (line.kind === "challenge") return `Desafio · ${line.title}`;
  if (line.kind === "withdrawal") return `Retirada · ${line.day ? fullDate(line.day) : ""}`;
  return `Quebra de caixa · ${line.day ? fullDate(line.day) : ""}`;
}

function earningsOf(row: WalletPersonMonth): number {
  return row.prizeCents + row.bonusCents + (row.managementCents || 0) + row.challengeCents;
}

function discountsOf(row: WalletPersonMonth): number {
  return row.withdrawalCents + row.shortageCents;
}

function minusMoney(cents: number): string {
  if (cents <= 0) return "—";
  return `− ${money(cents)}`;
}

function isGain(line: WalletLine): boolean {
  return line.kind === "prize" || line.kind === "bonus" || line.kind === "management" || line.kind === "managementBonus" || line.kind === "challenge";
}

function lineAmount(line: WalletLine): string {
  if (line.cents === 0 && line.note && line.note !== "Em andamento") return line.note;
  if (line.open && line.kind === "challenge") return "—";
  const text = money(line.cents);
  if ((line.kind === "withdrawal" || line.kind === "shortage") && line.cents > 0) return `−${text}`;
  return text;
}

function lineNote(line: WalletLine): string | null {
  if (line.kind === "challenge" && line.note === "Em andamento") return "Em andamento";
  if (line.open) return "Até agora";
  return null;
}

function PeriodControl({
  from,
  to,
  today,
  floor,
  presetId,
  onChange,
  extra,
}: {
  from: string;
  to: string;
  today: string;
  floor: string;
  presetId: DatePresetId | null;
  onChange: (from: string, to: string, presetId: DatePresetId | null) => void;
  extra?: ReactNode;
}) {
  function apply(start: Date, end: Date, goal?: DateRangeChangeMeta) {
    onChange(dateToIso(start), dateToIso(end), goal?.presetId ?? null);
  }
  return (
    <HeaderFilters>
      <DateRangePicker
        value={[isoToDate(from), isoToDate(to)]}
        minDate={isoToDate(floor)}
        maxDate={isoToDate(endOfMonth(today))}
        quickRanges={CALENDAR_QUICK_RANGES}
        displayLabel={presetId ? periodLabels[presetId] : null}
        activePresetId={presetId}
        onChange={([start, end], goal) => apply(start, end, goal)}
      />
      {extra}
    </HeaderFilters>
  );
}

function Totals({ rows }: { rows: WalletPersonMonth[] }) {
  const sum = (pick: (row: WalletPersonMonth) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const balance = sum((row) => row.balanceCents);
  const open = rows.some((row) => row.openPrize || row.lines.some((line) => line.open));
  const cards = [
    { label: "Saldo a pagar", value: money(balance), sub: open ? "Até agora" : undefined, valueClassName: balanceClass(balance) },
    { label: "Ganhos", value: money(sum(earningsOf)) },
    { label: "Descontos", value: money(sum(discountsOf)) },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {cards.map((card) => (
        <StatCard key={card.label} label={card.label} value={card.value} sub={card.sub} valueClassName={card.valueClassName} />
      ))}
    </div>
  );
}

function LineList({ lines }: { lines: WalletLine[] }) {
  return (
    <ul>
      {lines.map((line, index) => {
        const note = lineNote(line);
        return (
          <li key={`${line.kind}-${line.title}-${line.day ?? ""}-${index}`} className="flex items-start justify-between gap-4 border-b border-line py-3 last:border-b-0">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-t0">{lineTitle(line)}</p>
              {note ? <p className="mt-0.5 text-[12.5px] text-t2">{note}</p> : null}
            </div>
            <p className="shrink-0 text-right font-mono text-[13.5px] font-bold text-t0">{lineAmount(line)}</p>
          </li>
        );
      })}
    </ul>
  );
}

function Statement({
  person,
  emptyTitle = "Nada neste mês",
  emptyDescription = "Não há premiação, desafio, retirada ou quebra neste mês.",
}: {
  person: WalletPersonMonth;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const gains = person.lines.filter(isGain);
  const discounts = person.lines.filter((line) => !isGain(line));
  if (person.lines.length === 0) {
    return <EmptyBlock icon="👛" title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="flex flex-col gap-5">
      {gains.length > 0 ? (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-t2">Ganhos</p>
          <LineList lines={gains} />
        </div>
      ) : null}
      {discounts.length > 0 ? (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-t2">Descontos</p>
          <LineList lines={discounts} />
        </div>
      ) : null}
    </div>
  );
}

function PersonDialog({ person, storeName, onClose }: { person: WalletPersonMonth; storeName?: string; onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="min-w-0">
          <span className="block truncate">{person.name}</span>
          {storeName ? <span className="mt-0.5 block text-[12.5px] font-semibold text-t2">{storeName}</span> : null}
        </span>
      }
    >
      <p className="mb-4 text-[12.5px] text-t2">
        Saldo: <span className={`font-bold ${balanceClass(person.balanceCents)}`}>{money(person.balanceCents)}</span>
      </p>
      <Statement person={person} />
    </Modal>
  );
}

type PersonRow = WalletPersonMonth & { storeId: string; storeName: string };

type ShortageBlock = { storeId: string; storeName: string; cents: number; days: { day: string; cents: number }[] };

function rowKey(row: PersonRow): string {
  return `${row.storeId}:${row.personId}`;
}

function UnassignedShortage({ blocks, showStore }: { blocks: ShortageBlock[]; showStore: boolean }) {
  const printing = usePrintMode();
  const [open, setOpen] = useState(false);
  const total = blocks.reduce((sum, block) => sum + block.cents, 0);
  const days = blocks.flatMap((block) => block.days.map((day) => ({ ...day, storeId: block.storeId, storeName: block.storeName })));
  if (total <= 0) return null;
  const shown = printing || open;
  return (
    <div className="rounded-[var(--radius-vela-lg)] border border-line bg-bg-2 px-4 py-3">
      <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen((current) => !current)} aria-expanded={shown}>
        <span>
          <span className="text-[13.5px] font-bold text-warn">Quebra sem destino · {money(total)}</span>
          <span className="mt-0.5 block text-[12.5px] text-t2">Há valores de quebra que ainda não estão vinculados a uma pessoa, grupo ou equipe.</span>
        </span>
        <span className="shrink-0 text-[12px] font-bold text-t2 print:hidden">{shown ? "Ocultar" : "Ver dias"}</span>
      </button>
      {shown ? (
        <ul className="mt-3 border-t border-line">
          {days.map((day) => (
            <li key={`${day.storeId}-${day.day}`} className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
              <span className="text-[13.5px] text-t0">{showStore ? `${day.storeName} · ${fullDate(day.day)}` : fullDate(day.day)}</span>
              <span className="font-mono text-[13.5px] font-bold text-t0">{money(day.cents)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function WalletBody({ rows, shortages, showStore }: { rows: PersonRow[]; shortages: ShortageBlock[]; showStore: boolean }) {
  const [picked, setPicked] = useState<string | null>(null);
  const person = rows.find((row) => rowKey(row) === picked) ?? null;
  const close = useCallback(() => setPicked(null), []);
  const columns = useMemo<DataTableColumn<PersonRow>[]>(() => {
    const filial: DataTableColumn<PersonRow>[] = showStore
      ? [{ key: "store", header: "Filial", sortable: true, sortValue: (row) => row.storeName, render: (row) => row.storeName }]
      : [];
    return [
      {
        key: "name",
        header: "Pessoa",
        sortable: true,
        sortValue: (row) => row.name,
        render: (row) => <span className="font-semibold text-t0">{row.name}</span>,
      },
      ...filial,
      { key: "earnings", header: "Ganhos", align: "right", sortable: true, sortValue: (row) => earningsOf(row), render: (row) => money(earningsOf(row)) },
      { key: "withdrawal", header: "Retiradas", align: "right", sortable: true, sortValue: (row) => row.withdrawalCents, render: (row) => minusMoney(row.withdrawalCents) },
      { key: "shortage", header: "Quebra", align: "right", sortable: true, sortValue: (row) => row.shortageCents, render: (row) => minusMoney(row.shortageCents) },
      {
        key: "balance",
        header: "Saldo",
        align: "right",
        sortable: true,
        sortValue: (row) => row.balanceCents,
        render: (row) => <span className={`font-bold ${balanceClass(row.balanceCents)}`}>{money(row.balanceCents)}</span>,
      },
    ];
  }, [showStore]);

  return (
    <div className="flex flex-col gap-4">
      <Totals rows={rows} />
      <Card className="min-w-0">
        <CardTitle>Pessoas</CardTitle>
        <div className="mt-3">
          <DataTable
            columns={columns}
            data={rows}
            rowKey={rowKey}
            defaultSortKey="name"
            defaultSortDir="asc"
            paginate="pessoas"
            onRowClick={(row) => setPicked(rowKey(row))}
            empty={<EmptyBlock icon="👛" title="Nada neste período" description="Não há premiação, desafio, retirada ou quebra neste período." />}
          />
        </div>
      </Card>
      <UnassignedShortage blocks={shortages} showStore={showStore} />
      {person ? <PersonDialog person={person} storeName={showStore ? person.storeName : undefined} onClose={close} /> : null}
    </div>
  );
}

function useWalletPeriod() {
  const today = calendarTodayIso();
  const [from, setFrom] = useState(() => startOfMonth(today));
  const [to, setTo] = useState(() => endOfMonth(today));
  const [presetId, setPresetId] = useState<DatePresetId | null>("thisMonth");
  const [floor, setFloor] = useState(() => sellerHistoryFloor(today));
  const change = useCallback((nextFrom: string, nextTo: string, nextPreset: DatePresetId | null) => {
    setFrom(nextFrom);
    setTo(nextTo);
    setPresetId(nextPreset);
  }, []);
  return { today, from, to, presetId, floor, setFloor, change };
}

function balanceLines(person: WalletPersonMonth): WalletPersonMonth {
  return {
    ...person,
    lines: person.lines.filter((line) => {
      if (line.open && line.kind === "challenge") return false;
      if (line.cents === 0 && (line.kind === "prize" || line.kind === "bonus" || line.kind === "management" || line.kind === "managementBonus")) return false;
      if (line.cents === 0 && line.kind === "challenge" && !line.note) return false;
      return true;
    }),
  };
}

const KPI_COLORS = [
  { iconColor: "var(--acc)", iconBg: "var(--acc-soft)" },
  { iconColor: "var(--ok)", iconBg: "var(--ok-soft)" },
  { iconColor: "var(--info)", iconBg: "rgba(59,130,246,0.12)" },
];

function WalletGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h4v-4z" />
    </svg>
  );
}

function sellerSummary(guaranteed: number, upside: number, goals: WalletGoalOpportunity[]): string | null {
  const belowLast = goals.some((goal) => goal.floor && !goal.atLast);
  const atLast = goals.some((goal) => goal.atLast);
  const potential = guaranteed + upside;
  if (belowLast && upside > 0) {
    return `Você já garantiu ${money(guaranteed)} e, se alcançar o último nível, passa a receber a partir de ${money(potential)}. Vender mais aumenta a premiação.`;
  }
  if (atLast && upside > 0 && guaranteed > 0) {
    return `Você já garantiu ${money(guaranteed)} e ainda pode conquistar ${money(upside)} neste período. No último nível, vender mais aumenta a premiação.`;
  }
  if (atLast && guaranteed > 0) {
    return `Você já garantiu ${money(guaranteed)}. No último nível, vender mais aumenta a premiação.`;
  }
  if (upside > 0 && guaranteed > 0) return `Você já garantiu ${money(guaranteed)} e ainda pode conquistar ${money(upside)} neste período.`;
  if (upside > 0) return `Você ainda pode conquistar ${money(upside)} neste período.`;
  if (guaranteed > 0) return `Você já garantiu ${money(guaranteed)} neste período.`;
  return null;
}

function Tile({ label, value, sub, tip, mono = true, valueClass = "text-t0" }: { label: string; value: string; sub?: string; tip?: string; mono?: boolean; valueClass?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-bg-inset p-3">
      <p className="flex items-center gap-1 text-[11.5px] font-semibold text-t2">
        {label}
        {tip ? (
          <Tooltip label={tip}>
            <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-3 text-[10px] font-semibold text-t2 transition-colors hover:text-t1">?</span>
          </Tooltip>
        ) : null}
      </p>
      <p className={cn("mt-1 text-[15px] font-extrabold leading-tight", mono && "font-mono tabular-nums", value === "—" ? "text-t2" : valueClass)}>{value}</p>
      {sub ? <p className="mt-0.5 text-[12px] font-semibold leading-snug text-t1">{sub}</p> : null}
    </div>
  );
}

function GoalOpportunityCard({ item }: { item: WalletGoalOpportunity }) {
  const ended = item.state === "missed";
  const badge = item.state === "guaranteed" ? { label: "Alcançado", variant: "success" as const } : item.state === "missed" ? { label: "Não alcançado", variant: "danger" as const } : { label: "Em andamento", variant: "warning" as const };
  const showMoney = item.state === "guaranteed" || item.prizeCents > 0 || item.bonusCents > 0;
  return (
    <div className={cn("flex items-start gap-3.5 rounded-xl border border-line p-4", ended ? "bg-bg-inset" : "bg-bg-2")}>
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", ended ? "bg-bg-3 text-t2" : "bg-acc-soft text-acc")}>
        <TargetIcon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-[14px] font-bold text-t0">{item.name}</p>
          <Badge variant={badge.variant} className="shrink-0 uppercase">
            {badge.label}
          </Badge>
        </div>
        {item.levelLabel ? <p className="mt-0.5 text-[12px] text-t2">{item.levelLabel}</p> : null}
        {showMoney ? (
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <Tile label="Premiação" value={money(item.prizeCents)} valueClass={item.prizeCents > 0 ? "text-ok" : "text-t0"} />
            <Tile label="Bônus" value={money(item.bonusCents)} valueClass={item.bonusCents > 0 ? "text-ok" : "text-t0"} />
          </div>
        ) : null}
        {item.state === "missed" && (item.missedPrizeCents > 0 || item.missedBonusCents > 0) ? (
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <Tile label="Premiação" value={money(item.missedPrizeCents)} sub={item.missedLevelLabel ?? undefined} tip="Não entrou na carteira." />
            <Tile label="Bônus" value={money(item.missedBonusCents)} tip="Não entrou na carteira." />
          </div>
        ) : null}
        {item.next ? (
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <Tile label="Próximo nível" value={item.next.label} mono={false} sub={item.next.gapCents > 0 ? `Faltam ${money(item.next.gapCents)}` : undefined} />
            <Tile
              label="A partir deste nível"
              value={item.next.prizeGainCents > 0 ? `+${money(item.next.prizeGainCents)}` : "—"}
              valueClass={item.next.prizeGainCents > 0 ? "text-ok" : "text-t0"}
              sub={item.next.bonusGainCents > 0 ? `+${money(item.next.bonusGainCents)} de bônus` : undefined}
              tip="No piso deste nível. O percentual vale sobre o que você vender, então vender mais aumenta a premiação."
            />
          </div>
        ) : null}
        {item.atLast ? <p className="mt-2 text-[12.5px] font-semibold text-t1">Último nível. Vender mais aumenta a premiação.</p> : null}
      </div>
    </div>
  );
}

function ChallengeOpportunityCard({ item }: { item: WalletChallengeOpportunity }) {
  const ended = item.state !== "open";
  return (
    <div className={cn("flex items-start gap-3.5 rounded-xl border border-line p-4", ended ? "bg-bg-inset" : "bg-bg-2")}>
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", ended ? "bg-bg-3 text-t2" : "bg-acc-soft text-acc")}>
        <FlameIcon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-[14px] font-bold text-t0">{item.name}</p>
          <Badge variant={item.state === "open" ? "warning" : "neutral"} className="shrink-0 uppercase">
            {item.state === "open" ? "Em andamento" : "Encerrado"}
          </Badge>
        </div>
        {item.placeLabel ? <p className="mt-2 text-[13px] font-semibold text-t0">{item.placeLabel}</p> : null}
        {item.state === "missed" ? <p className="mt-2 text-[13px] font-semibold text-bad">Não alcançado</p> : null}
        {item.resultLabel ? (
          <p className="mt-2 text-[13px] text-t1">
            {item.resultCaption}: {item.resultLabel}
          </p>
        ) : null}
        {item.targetLabel ? <p className="mt-1 text-[13px] text-t1">Meta: {item.targetLabel}</p> : null}
        {item.gapLabel ? <p className="mt-2 text-[12.5px] font-semibold text-t1">{item.gapLabel}</p> : null}
        {item.prizeLabel ? (
          <p className="mt-2 flex items-center gap-1 text-[12px] text-t2">
            <TrophyIcon size={13} />
            {item.state === "guaranteed" ? "Prêmio conquistado" : "Prêmio"}: <span className="font-mono font-bold text-t0">{item.prizeLabel}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SellerWallet({ wallet, opportunities }: { wallet: WalletMonth; opportunities: WalletOpportunity[] }) {
  const person = wallet.people[0];
  if (!person) return <EmptyBlock icon="👛" title="Nada neste período" description="Não há carteira para este acesso." />;
  const goals = opportunities.filter((item): item is WalletGoalOpportunity => item.kind === "goal");
  const guaranteed = earningsOf(person);
  const upside = opportunities.reduce((total, item) => total + item.upsideCents, 0);
  const potential = guaranteed + upside;
  const belowLast = goals.some((goal) => goal.floor && !goal.atLast);
  const atLast = goals.some((goal) => goal.atLast);
  const sentence = sellerSummary(guaranteed, upside, goals);
  const potentialSub = belowLast ? "A partir do último nível" : atLast ? "Vender mais aumenta a premiação" : upside > 0 ? "Se conquistar o que ainda está em disputa" : undefined;
  const potentialTip = belowLast || atLast ? "O último nível paga um percentual sobre o que você vender. O valor é o mínimo ao chegar nele. Vender mais aumenta a premiação." : undefined;
  const movement = balanceLines(person);
  const saldo = KPI_COLORS[0]!;
  const ganhos = KPI_COLORS[1]!;
  const potencial = KPI_COLORS[2]!;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Saldo atual" value={money(person.balanceCents)} icon={<WalletGlyph />} iconColor={saldo.iconColor} iconBg={saldo.iconBg} sub={person.openPrize ? "Até agora" : undefined} valueClassName={balanceClass(person.balanceCents)} />
        <StatCard label="Ganhos garantidos" value={money(guaranteed)} icon={<CheckCircleIcon size={20} />} iconColor={ganhos.iconColor} iconBg={ganhos.iconBg} />
        <StatCard label="Potencial do período" value={money(potential)} icon={<TargetIcon size={20} />} iconColor={potencial.iconColor} iconBg={potencial.iconBg} sub={potentialSub} tooltip={potentialTip} />
      </div>
      {sentence ? <p className="text-[13px] leading-snug text-t1">{sentence}</p> : null}
      <Card>
        <CardTitle>Suas oportunidades</CardTitle>
        <div className="mt-3">
          {opportunities.length === 0 ? (
            <EmptyBlock icon="🎯" title="Nada neste período" description="Não há meta nem desafio terminando neste período." />
          ) : (
            <div className="flex flex-col gap-3">
              {opportunities.map((item, index) =>
                item.kind === "goal" ? (
                  <GoalOpportunityCard key={`${item.kind}-${item.endsOn}-${item.name}-${index}`} item={item} />
                ) : (
                  <ChallengeOpportunityCard key={`${item.kind}-${item.endsOn}-${item.name}-${index}`} item={item} />
                ),
              )}
            </div>
          )}
        </div>
      </Card>
      <Card>
        <CardTitle>Movimento do período</CardTitle>
        <div className="mt-2">
          <Statement person={movement} emptyTitle="Nada neste período" emptyDescription="Não há premiação, bônus, desafio pago, retirada ou quebra neste período." />
        </div>
      </Card>
    </div>
  );
}

/** Carteira da vendedora: o que já está garantido e o que ainda dá para conquistar. */
export function SellerWalletPage() {
  const { today, from, to, presetId, floor, setFloor, change } = useWalletPeriod();
  const [wallet, setWallet] = useState<WalletMonth | null>(null);
  const [opportunities, setOpportunities] = useState<WalletOpportunity[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinSkeleton(loading && !wallet);
  const request = useRef(0);

  const load = useCallback((rangeFrom: string, rangeTo: string) => {
    const id = ++request.current;
    setFailed(false);
    const months = monthsTouched(rangeFrom, rangeTo);
    void Promise.all(months.map((month) => loadSellerWallet(month))).then((loaded) => {
      if (id !== request.current) return;
      const history = loaded.find((item) => item?.historyFrom)?.historyFrom;
      if (history && history > sellerHistoryFloor(calendarTodayIso())) setFloor(startOfMonth(history));
      if (loaded.some((item) => item == null)) {
        setWallet(null);
        setOpportunities([]);
        setFailed(true);
        setLoading(false);
        return;
      }
      const parts: WalletMonth[] = [];
      const lists: WalletOpportunity[][] = [];
      loaded.forEach((item, index) => {
        const month = months[index]?.slice(0, 7);
        if (!item || item.wallet.month !== month) return;
        parts.push(item.wallet);
        lists.push(item.opportunities);
      });
      const personId = parts[0]?.people[0]?.personId ?? null;
      setWallet(walletInRange(parts, rangeFrom, rangeTo, personId));
      setOpportunities(opportunitiesInRange(lists, rangeFrom, rangeTo));
      setFailed(false);
      setLoading(false);
    });
  }, [setFloor]);

  useEffect(() => {
    load(from, to);
  }, [load, from, to]);

  useEffect(() => {
    const onSynced = () => load(from, to);
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [load, from, to]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Carteira"
        subtitle="O que já está garantido e o que ainda dá para conquistar no período."
        actions={<PeriodControl from={from} to={to} today={today} floor={floor} presetId={presetId} onChange={change} />}
      />
      {showSkeleton ? (
        <Skeleton className="h-[420px] w-full rounded-[18px]" />
      ) : failed || !wallet ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-[15px] font-bold text-t0">Não foi possível carregar a carteira</p>
          <Button type="button" onClick={() => load(from, to)}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <SellerWallet wallet={wallet} opportunities={opportunities} />
      )}
    </div>
  );
}

type LoadedBranch = { store: Store; wallet: WalletMonth };

function storeLabel(store: Store): string {
  return store.tradeName || store.name;
}

function peopleOf(branches: LoadedBranch[]): PersonRow[] {
  return branches.flatMap((branch) =>
    branch.wallet.people.map((person) => ({ ...person, storeId: branch.store.id, storeName: storeLabel(branch.store) })),
  );
}

function shortagesOf(branches: LoadedBranch[]): ShortageBlock[] {
  return branches
    .filter((branch) => branch.wallet.unassignedShortageCents > 0)
    .map((branch) => ({
      storeId: branch.store.id,
      storeName: storeLabel(branch.store),
      cents: branch.wallet.unassignedShortageCents,
      days: branch.wallet.unassignedShortageDays,
    }));
}

function dataBr(iso: string): string {
  return isoToDate(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function periodFile(from: string, to: string, presetId: DatePresetId | null): string {
  const datas = from === to ? dataBr(from) : `${dataBr(from)} a ${dataBr(to)}`;
  const preset = presetId ? periodLabels[presetId] : null;
  return preset ? `${preset} · ${datas}` : datas;
}

function csvMoney(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function csvCell(value: string): string {
  return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function fileStore(stores: Store[], all: boolean): string {
  if (stores.length === 1) return [stores[0]!.branchCode.trim(), storeLabel(stores[0]!)].filter(Boolean).join(" ");
  if (all) return "Todas as filiais";
  return stores.length <= 3 ? stores.map(storeLabel).join(", ") : `${stores.length} filiais`;
}

function downloadCsv(rows: PersonRow[], showStore: boolean, fileName: string) {
  const header = [...(showStore ? ["Filial"] : []), "Pessoa", "Ganhos", "Retiradas", "Quebra", "Saldo"];
  const body = rows.map((row) =>
    [...(showStore ? [row.storeName] : []), row.name, csvMoney(earningsOf(row)), csvMoney(row.withdrawalCents), csvMoney(row.shortageCents), csvMoney(row.balanceCents)]
      .map(csvCell)
      .join(";"),
  );
  const total = [
    ...(showStore ? [""] : []),
    "Total",
    csvMoney(rows.reduce((sum, row) => sum + earningsOf(row), 0)),
    csvMoney(rows.reduce((sum, row) => sum + row.withdrawalCents, 0)),
    csvMoney(rows.reduce((sum, row) => sum + row.shortageCents, 0)),
    csvMoney(rows.reduce((sum, row) => sum + row.balanceCents, 0)),
  ]
    .map(csvCell)
    .join(";");
  const blob = new Blob([`\uFEFF${[header.join(";"), ...body, total].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const safeName = fileName.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName.endsWith(".csv") ? safeName : `${safeName}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function WalletPrintHeader({ stores, all, period }: { stores: Store[]; all: boolean; period: string }) {
  const now = new Date();
  const geradoEm = `${now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })} às ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
  const one = stores.length === 1 ? stores[0] : null;
  return (
    <div className="mb-5 hidden border-b border-line pb-4 print:block">
      <div className="flex items-start justify-between gap-6">
        <WedashBrand size={28} />
        <p className="text-right text-[11px] leading-5 text-t2">Gerado em {geradoEm}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-[12.5px]">
        <p>
          <span className="text-t2">{one ? "Filial: " : "Filiais: "}</span>
          <span className={one ? "font-bold uppercase text-t0" : "font-bold text-t0"}>{one ? storeLabel(one) : all ? "Todas as filiais" : fileStore(stores, false)}</span>
          {one?.branchCode.trim() ? <span className="text-t2"> · Cód. {one.branchCode.trim()}</span> : null}
          {one?.cnpj.trim() ? <span className="text-t2"> · {one.cnpj.trim()}</span> : null}
        </p>
        <p>
          <span className="text-t2">Período: </span>
          <span className="font-bold text-t0">{period}</span>
        </p>
      </div>
    </div>
  );
}

function ExportMenu({
  stores,
  disabled,
  onCsv,
  onPdf,
}: {
  stores: Store[];
  disabled: boolean;
  onCsv: (ids: string[]) => void;
  onPdf: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const many = stores.length > 1;
  function openStores() {
    setIds(stores.map((store) => store.id));
    setOpen(true);
  }

  function toggle(id: string) {
    setIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  if (!many) {
    const only = stores.map((store) => store.id);
    return (
      <Dropdown
        align="right"
        portal
        trigger={
          <Button type="button" variant="primary" disabled={disabled || stores.length === 0}>
            Exportar
          </Button>
        }
        items={[
          { label: "CSV", onClick: () => onCsv(only) },
          { label: "PDF", onClick: () => onPdf(only) },
        ]}
      />
    );
  }

  const allOn = ids.length === stores.length;
  return (
    <>
      <Button type="button" variant="primary" disabled={disabled} onClick={openStores}>
        Exportar
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Exportar"
        footer={
          <>
            <Button type="button" variant="outline" disabled={ids.length === 0} onClick={() => { onCsv(ids); setOpen(false); }}>
              CSV
            </Button>
            <Button type="button" variant="primary" disabled={ids.length === 0} onClick={() => { onPdf(ids); setOpen(false); }}>
              PDF
            </Button>
          </>
        }
      >
        <p className="mb-3 text-[13px] text-t1">Escolha as filiais. O arquivo usa o período desta tela.</p>
        <div className="flex flex-col gap-2.5">
          <Checkbox label="Todas" checked={allOn} onChange={() => setIds(allOn ? [] : stores.map((store) => store.id))} />
          {stores.map((store) => (
            <Checkbox key={store.id} label={storeLabel(store)} checked={ids.includes(store.id)} onChange={() => toggle(store.id)} />
          ))}
        </div>
      </Modal>
    </>
  );
}

/** Financeiro da gestão: as filiais do seletor, uma linha por pessoa em cada filial. */
export function BranchWalletPage() {
  const { session, storeRows, loading: storesLoading } = useScopedStores();
  const { today, from, to, presetId, floor, change } = useWalletPeriod();
  const [branches, setBranches] = useState<LoadedBranch[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [printIds, setPrintIds] = useState<string[] | null>(null);
  const [pdfQueued, setPdfQueued] = useState(false);
  const printing = usePrintMode();
  const showSkeleton = useMinSkeleton(storesLoading || loading);
  const request = useRef(0);
  const loadedKey = useRef("");
  const pdfOnce = useRef(false);
  const storeKey = storeRows.map((store) => store.id).join(",");

  const load = useCallback(() => {
    if (storeRows.length === 0) return;
    const id = ++request.current;
    const key = `${storeRows.map((store) => store.id).join(",")}|${from}|${to}`;
    if (loadedKey.current !== key) setBranches(null);
    setFailed(false);
    setLoading(true);
    const months = monthsTouched(from, to);
    void Promise.all(
      storeRows.map(async (store) => {
        const parts = await Promise.all(
          months.map((month) =>
            loadBranchWallet({
              tenantId: session.tenantId,
              storeId: store.id,
              storeName: storeLabel(store),
              month,
              today,
              timeZone: store.timezone,
              week: effectiveWeekHours(store.hours),
            }),
          ),
        );
        return { store, wallet: walletInRange(parts, from, to) };
      }),
    )
      .then((loaded) => {
        if (id !== request.current) return;
        loadedKey.current = key;
        setBranches(loaded);
        setFailed(false);
      })
      .catch(() => {
        if (id !== request.current) return;
        setFailed(true);
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
  }, [from, to, session.tenantId, storeRows, today]);

  useEffect(() => {
    if (!storeKey) return;
    load();
  }, [load, storeKey]);

  useEffect(() => {
    const onSynced = () => load();
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [load]);

  useEffect(() => {
    if (!printing) setPrintIds(null);
  }, [printing]);

  const period = periodFile(from, to, presetId);
  const activeIds = printIds ?? storeRows.map((store) => store.id);
  const visible = (branches ?? []).filter((branch) => activeIds.includes(branch.store.id));
  const rows = peopleOf(visible);
  const showStore = new Set(visible.map((branch) => branch.store.id)).size > 1;
  const printStores = storeRows.filter((store) => activeIds.includes(store.id));
  const exportingAll = printStores.length > 1 && printStores.length === session.stores.length;

  useEffect(() => {
    if (!pdfQueued || !printIds || pdfOnce.current) return;
    pdfOnce.current = true;
    setPdfQueued(false);
    const picked = storeRows.filter((store) => printIds.includes(store.id));
    const all = picked.length > 1 && picked.length === storeRows.length && storeRows.length === session.stores.length;
    exportPdf(["Carteira", fileStore(picked, all), period]);
  }, [pdfQueued, printIds, storeRows, session.stores.length, period]);

  function exportCsv(ids: string[]) {
    const picked = (branches ?? []).filter((branch) => ids.includes(branch.store.id));
    const pickedRows = peopleOf(picked);
    const stores = storeRows.filter((store) => ids.includes(store.id));
    const all = stores.length > 1 && stores.length === session.stores.length;
    downloadCsv(pickedRows, stores.length > 1, `WDash - Carteira - ${fileStore(stores, all)} - ${period}.csv`);
  }

  function exportPdfOf(ids: string[]) {
    pdfOnce.current = false;
    setPrintIds(ids);
    setPdfQueued(true);
  }

  return (
    <div>
      {printIds ? <WalletPrintHeader stores={printStores} all={exportingAll} period={period} /> : null}
      <SectionHeader
        section="Financeiro"
        title="Carteira"
        subtitle="A carteira de cada pessoa. A retirada e a quebra são lançadas no Fechamento."
        actions={
          <PeriodControl
            from={from}
            to={to}
            today={today}
            floor={floor}
            presetId={presetId}
            onChange={change}
            extra={<ExportMenu stores={storeRows} disabled={!branches || loading} onCsv={exportCsv} onPdf={exportPdfOf} />}
          />
        }
      />
      <div className="mt-6 pb-6">
        {failed ? (
          <div className="mb-4 flex flex-col items-start gap-3">
            <Alert variant="danger" title="Não foi possível carregar a carteira. Tente novamente." />
            <Button type="button" onClick={() => load()}>
              Tentar novamente
            </Button>
          </div>
        ) : null}
        {showSkeleton && !branches ? (
          <Skeleton className="h-[520px] w-full rounded-[18px]" />
        ) : storeRows.length === 0 ? (
          <Card>
            <EmptyBlock icon="👛" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : branches ? (
          <WalletBody rows={rows} shortages={shortagesOf(visible)} showStore={showStore} />
        ) : null}
      </div>
    </div>
  );
}

export default BranchWalletPage;
