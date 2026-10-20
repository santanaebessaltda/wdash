import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Badge, Button, Card, CardTitle, DateRangePicker, Modal, PageHeader, Pagination, Skeleton, StatCard, ThSort, Tooltip, CALENDAR_QUICK_RANGES, type DatePresetId, type DateRangeChangeMeta, type SortDir } from "@/components/ui";
import { ExportDialog } from "@/components/wedash/ExportDialog";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
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
import { brlCent, dateToIso, endOfMonth, fullDate, isoToDate, num } from "@/lib/format";
import { exportPdf, usePrintMode } from "@/lib/printMode";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { usePagedRows } from "@/lib/usePagedRows";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { CheckCircleIcon, FlameIcon, TargetIcon, TrophyIcon } from "@/pages/dashboards/icons";
import { CostCardTitle, SectionHeader, useScopedStores } from "@/pages/operation/shared";
import { fetchStoreSellers, type Store } from "@/data/wedash/stores";
import { matchesCodeOrName } from "@/lib/personSearch";
import { buildXlsx, type XlsxCell } from "@/lib/xlsx";
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

const LINE_ORDER: Record<WalletLine["kind"], number> = {
  prize: 0,
  bonus: 1,
  management: 2,
  managementBonus: 3,
  challenge: 4,
  withdrawal: 5,
  shortage: 6,
};

function compareLines(a: WalletLine, b: WalletLine): number {
  return (a.day ?? "").localeCompare(b.day ?? "") || LINE_ORDER[a.kind] - LINE_ORDER[b.kind] || lineTitle(a).localeCompare(lineTitle(b), "pt-BR");
}

/** O que entra leva +, o que sai leva −. Linha que não mexe no saldo fica sem sinal. */
function tapeAmount(line: WalletLine): { text: string; className: string } {
  if (line.cents === 0 && line.note && line.note !== "Em andamento") return { text: line.note, className: "text-t2" };
  if (line.open && line.kind === "challenge") return { text: "—", className: "text-t2" };
  if (line.kind === "withdrawal" || line.kind === "shortage") {
    if (line.cents <= 0) return { text: "—", className: "text-t2" };
    return { text: `− ${money(line.cents)}`, className: "text-bad" };
  }
  return { text: `+ ${money(line.cents)}`, className: "text-ok" };
}

function lineNote(line: WalletLine): string | null {
  if (line.kind === "challenge" && line.note === "Em andamento") return "Em andamento";
  return null;
}

/** Meta ou desafio ainda aberto: o saldo de agora pode crescer. */
function balanceStillOpen(person: Pick<WalletPersonMonth, "openPrize" | "lines">): boolean {
  return person.openPrize || person.lines.some((line) => line.open);
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
  const open = rows.some(balanceStillOpen);
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

function Statement({
  person,
  emptyTitle = "Nada neste mês",
  emptyDescription = "Não há premiação, desafio, retirada ou quebra neste mês.",
}: {
  person: WalletPersonMonth;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (person.lines.length === 0) {
    return <EmptyBlock icon="👛" title={emptyTitle} description={emptyDescription} />;
  }
  const lines = [...person.lines].sort(compareLines);
  const untilNow = balanceStillOpen(person);
  return (
    <div>
      <ul>
        {lines.map((line, index) => {
          const note = lineNote(line);
          const amount = tapeAmount(line);
          return (
            <li key={`${line.kind}-${line.title}-${line.day ?? ""}-${index}`} className="flex items-start justify-between gap-4 border-b border-line py-3">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-t0">{lineTitle(line)}</p>
                {note ? <p className="mt-0.5 text-[12.5px] text-t2">{note}</p> : null}
              </div>
              <p className={cn("shrink-0 text-right font-mono text-[13.5px] font-bold", amount.className)}>{amount.text}</p>
            </li>
          );
        })}
      </ul>
      <div className="flex items-baseline justify-between gap-4 bg-bg-inset px-1 py-3">
        <span className="text-[13.5px] font-extrabold text-t0">
          Saldo
          {untilNow ? <span className="mt-0.5 block text-[11px] font-semibold text-t2">Até agora</span> : null}
        </span>
        <span className={cn("font-mono text-[15px] font-extrabold", balanceClass(person.balanceCents))}>{money(person.balanceCents)}</span>
      </div>
    </div>
  );
}

function PersonDialog({
  person,
  storeId,
  storeName,
  employeeId,
  onClose,
}: {
  person: WalletPersonMonth;
  storeId: string;
  storeName?: string;
  employeeId?: string;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="flex min-w-0 items-center gap-3">
          <PersonAvatar name={person.name} employeeId={employeeId} storeId={storeId} size="md" />
          <span className="min-w-0">
            <span className="block truncate">{person.name}</span>
            {storeName ? <span className="mt-0.5 block truncate text-[12.5px] font-semibold text-t2">{storeName}</span> : null}
          </span>
        </span>
      }
    >
      <Statement person={person} emptyTitle="Nada neste período" emptyDescription="Não há premiação, desafio, retirada ou quebra neste período." />
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

type PeopleSort = "name" | "store" | "earnings" | "withdrawal" | "shortage" | "balance";

const peopleSearchClass =
  "h-8 rounded-[var(--radius-vela-sm)] border border-line bg-bg-3 px-3 text-xs font-semibold text-t0 transition-colors hover:border-acc focus:border-acc focus:outline-none";

function peopleValue(row: PersonRow, key: PeopleSort): number {
  if (key === "earnings") return earningsOf(row);
  if (key === "withdrawal") return row.withdrawalCents;
  if (key === "shortage") return row.shortageCents;
  return row.balanceCents;
}

function PeopleList({
  rows,
  showStore,
  codes,
  onOpen,
}: {
  rows: PersonRow[];
  showStore: boolean;
  codes: Map<string, string>;
  onOpen: (key: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<PeopleSort>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const sorted = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    const list = query ? rows.filter((row) => matchesCodeOrName(row.name, codes.get(rowKey(row)), query)) : rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const cmp =
        sortKey === "name"
          ? a.name.localeCompare(b.name, "pt-BR") || a.storeName.localeCompare(b.storeName, "pt-BR")
          : sortKey === "store"
            ? a.storeName.localeCompare(b.storeName, "pt-BR") || a.name.localeCompare(b.name, "pt-BR")
            : peopleValue(a, sortKey) - peopleValue(b, sortKey);
      return cmp * dir || a.name.localeCompare(b.name, "pt-BR");
    });
  }, [rows, codes, search, sortKey, sortDir]);
  const { page, setPage, totalPages, pageRows } = usePagedRows(sorted, `${search}|${sortKey}|${sortDir}`);
  const total = useMemo(
    () => ({
      earnings: sorted.reduce((sum, row) => sum + earningsOf(row), 0),
      withdrawal: sorted.reduce((sum, row) => sum + row.withdrawalCents, 0),
      shortage: sorted.reduce((sum, row) => sum + row.shortageCents, 0),
      balance: sorted.reduce((sum, row) => sum + row.balanceCents, 0),
    }),
    [sorted],
  );

  function toggleSort(key: PeopleSort) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "name" || key === "store" ? "asc" : "desc");
  }

  const headClass = "px-4 py-3 text-[10.5px] font-bold uppercase tracking-wide";
  const cellClass = "px-4 py-3.5 align-middle";

  return (
    <Card className="print-flow min-w-0" padding="none">
      <div className="px-5 pt-5">
        <CostCardTitle title="Pessoas" />
      </div>
      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center justify-end gap-3 px-5 pb-4 print:hidden">
          <input
            type="search"
            placeholder="Buscar por código ou nome…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(peopleSearchClass, "w-full sm:w-56")}
          />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyBlock icon="👛" title="Nada neste período" description="Não há premiação, desafio, retirada ou quebra neste período." />
      ) : sorted.length === 0 ? (
        <EmptyBlock
          icon="🔍"
          title="Nenhuma pessoa encontrada"
          description="Tente outro código ou nome."
          action={
            <Button variant="outline" size="sm" onClick={() => setSearch("")}>
              Limpar busca
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden border-t border-line bg-transparent">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <ThSort label="Nome" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} align="left" className={headClass} />
                    {showStore ? <ThSort label="Filial" active={sortKey === "store"} dir={sortDir} onClick={() => toggleSort("store")} align="left" className={headClass} /> : null}
                    <ThSort label="Ganhos" active={sortKey === "earnings"} dir={sortDir} onClick={() => toggleSort("earnings")} className={headClass} />
                    <ThSort label="Retiradas" active={sortKey === "withdrawal"} dir={sortDir} onClick={() => toggleSort("withdrawal")} className={headClass} />
                    <ThSort label="Quebra" active={sortKey === "shortage"} dir={sortDir} onClick={() => toggleSort("shortage")} className={headClass} />
                    <ThSort label="Saldo" active={sortKey === "balance"} dir={sortDir} onClick={() => toggleSort("balance")} className={headClass} />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr
                      key={rowKey(row)}
                      tabIndex={0}
                      onClick={() => onOpen(rowKey(row))}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        onOpen(rowKey(row));
                      }}
                      className="cursor-pointer border-b border-line transition-colors hover:bg-bg-3 focus-visible:bg-bg-3 focus-visible:outline-none"
                    >
                      <td className={cellClass}>
                        <div className="flex min-w-0 items-center gap-3">
                          <PersonAvatar name={row.name} employeeId={codes.get(rowKey(row))} storeId={row.storeId} />
                          <span className="truncate text-[13.5px] font-bold text-t0">{row.name}</span>
                        </div>
                      </td>
                      {showStore ? <td className={cn(cellClass, "text-t1")}>{row.storeName}</td> : null}
                      <td className={cn(cellClass, "text-right font-mono text-[13px] font-bold text-t0")}>{money(earningsOf(row))}</td>
                      <td className={cn(cellClass, "text-right font-mono text-[13px] font-bold text-t0")}>{minusMoney(row.withdrawalCents)}</td>
                      <td className={cn(cellClass, "text-right font-mono text-[13px] font-bold text-t0")}>{minusMoney(row.shortageCents)}</td>
                      <td className={cn(cellClass, "text-right font-mono text-[13px] font-bold", balanceClass(row.balanceCents))}>{money(row.balanceCents)}</td>
                    </tr>
                  ))}
                  <tr className="bg-bg-inset">
                    <td className={cn(cellClass, "text-[13.5px] font-extrabold text-t0")}>
                      Total do filtro
                      <span className="mt-0.5 block text-[11px] font-semibold text-t2">
                        {num(sorted.length)} {sorted.length === 1 ? "pessoa" : "pessoas"}
                      </span>
                    </td>
                    {showStore ? <td /> : null}
                    <td className={cn(cellClass, "text-right font-mono text-[13px] font-extrabold text-t0")}>{money(total.earnings)}</td>
                    <td className={cn(cellClass, "text-right font-mono text-[13px] font-extrabold text-t0")}>{minusMoney(total.withdrawal)}</td>
                    <td className={cn(cellClass, "text-right font-mono text-[13px] font-extrabold text-t0")}>{minusMoney(total.shortage)}</td>
                    <td className={cn(cellClass, "text-right font-mono text-[13px] font-extrabold", balanceClass(total.balance))}>{money(total.balance)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
      )}
      {sorted.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3.5 print:hidden">
          <span className="text-[12.5px] text-t2">
            Mostrando {pageRows.length} de {num(sorted.length)} pessoas
          </span>
          {totalPages > 1 ? <Pagination page={page} totalPages={totalPages} onChange={setPage} /> : null}
        </div>
      ) : null}
    </Card>
  );
}

function WalletBody({
  rows,
  shortages,
  showStore,
  codes,
}: {
  rows: PersonRow[];
  shortages: ShortageBlock[];
  showStore: boolean;
  codes: Map<string, string>;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const person = rows.find((row) => rowKey(row) === picked) ?? null;
  const close = useCallback(() => setPicked(null), []);

  return (
    <div className="flex flex-col gap-4">
      <Totals rows={rows} />
      <PeopleList rows={rows} showStore={showStore} codes={codes} onOpen={setPicked} />
      <UnassignedShortage blocks={shortages} showStore={showStore} />
      {person ? (
        <PersonDialog
          person={person}
          storeId={person.storeId}
          storeName={showStore ? person.storeName : undefined}
          employeeId={codes.get(rowKey(person))}
          onClose={close}
        />
      ) : null}
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
        <StatCard label="Saldo atual" value={money(person.balanceCents)} icon={<WalletGlyph />} iconColor={saldo.iconColor} iconBg={saldo.iconBg} sub={balanceStillOpen(person) ? "Até agora" : undefined} valueClassName={balanceClass(person.balanceCents)} />
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

function fileStore(stores: Store[], all: boolean): string {
  if (stores.length === 1) return [stores[0]!.branchCode.trim(), storeLabel(stores[0]!)].filter(Boolean).join(" ");
  if (all) return "Todas as filiais";
  return stores.length <= 3 ? stores.map(storeLabel).join(", ") : `${stores.length} filiais`;
}

function reais(cents: number): number {
  return Math.round(cents) / 100;
}

function downloadXlsx(rows: PersonRow[], showStore: boolean, fileName: string) {
  const header: XlsxCell[] = ["Nome", ...(showStore ? ["Filial"] : []), "Ganhos", "Retiradas", "Quebra", "Saldo"];
  const body = rows.map((row) => [
    row.name,
    ...(showStore ? [row.storeName] : []),
    reais(earningsOf(row)),
    reais(row.withdrawalCents),
    reais(row.shortageCents),
    reais(row.balanceCents),
  ]);
  const total: XlsxCell[] = [
    "Total do filtro",
    ...(showStore ? [""] : []),
    reais(rows.reduce((sum, row) => sum + earningsOf(row), 0)),
    reais(rows.reduce((sum, row) => sum + row.withdrawalCents, 0)),
    reais(rows.reduce((sum, row) => sum + row.shortageCents, 0)),
    reais(rows.reduce((sum, row) => sum + row.balanceCents, 0)),
  ];
  const sheet = rows.length === 0 ? [header] : [header, ...body, total];
  const bytes = buildXlsx(sheet, { textColumns: showStore ? [0, 1] : [0], sheetName: "Carteira" });
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const safeName = fileName.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName.endsWith(".xlsx") ? safeName : `${safeName}.xlsx`;
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

/** Três números e a lista, no mesmo lugar em que aparecem carregados. */
function WalletSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Card key={index}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-1 h-8 w-36" />
          </Card>
        ))}
      </div>
      <Card padding="none">
        <div className="px-5 pt-5">
          <Skeleton className="mb-4 h-4 w-24" />
        </div>
        <div className="flex justify-end px-5 pb-4">
          <Skeleton className="h-8 w-full rounded-[var(--radius-vela-sm)] sm:w-56" />
        </div>
        <div className="overflow-hidden border-t border-line">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                {Array.from({ length: 5 }, (_, index) => (
                  <th key={index} className="px-4 py-3 text-left">
                    <Skeleton className="h-2.5 w-14" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 4 }, (_, row) => (
                <tr key={row} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                      <Skeleton className="h-3.5 w-32" />
                    </div>
                  </td>
                  {Array.from({ length: 4 }, (_, cell) => (
                    <td key={cell} className="px-4 py-3.5 text-right">
                      <Skeleton className="ml-auto h-3 w-16" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
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
  const [codes, setCodes] = useState<Map<string, string>>(() => new Map());
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
    const ids = storeKey ? storeKey.split(",") : [];
    if (ids.length === 0) {
      setCodes(new Map());
      return;
    }
    let stop = false;
    void fetchStoreSellers(session.tenantId, ids).then((map) => {
      if (stop) return;
      const next = new Map<string, string>();
      for (const [storeId, people] of map) {
        for (const person of people) {
          const code = person.code?.trim();
          if (code) next.set(`${storeId}:${person.id}`, code);
        }
      }
      setCodes(next);
    });
    return () => {
      stop = true;
    };
  }, [session.tenantId, storeKey]);

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

  function exportXlsx() {
    const picked = branches ?? [];
    const many = picked.length > 1;
    const all = many && picked.length === session.stores.length;
    downloadXlsx(peopleOf(picked), many, `WDash - Carteira - ${fileStore(picked.map((branch) => branch.store), all)} - ${period}.xlsx`);
  }

  function exportPdfOf() {
    pdfOnce.current = false;
    setPrintIds(storeRows.map((store) => store.id));
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
            extra={
              <ExportDialog
                formats={["pdf", "xlsx"]}
                disabled={!branches || loading || storeRows.length === 0}
                onExport={(format) => {
                  if (format === "pdf") exportPdfOf();
                  else exportXlsx();
                }}
              />
            }
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
          <WalletSkeleton />
        ) : storeRows.length === 0 ? (
          <Card>
            <EmptyBlock icon="👛" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : branches ? (
          <WalletBody rows={rows} shortages={shortagesOf(visible)} showStore={showStore} codes={codes} />
        ) : null}
      </div>
    </div>
  );
}

export default BranchWalletPage;
