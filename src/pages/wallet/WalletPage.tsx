import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Card, CardTitle, DataTable, PageHeader, Skeleton, StatCard, type DataTableColumn } from "@/components/ui";
import { calendarTodayIso } from "@/data/wedash/clock";
import { addMonths, startOfMonth } from "@/data/wedash/engine/format";
import { sellerHistoryFloor } from "@/data/wedash/engine/sellerHome";
import type { WalletLine, WalletMonth, WalletPersonMonth } from "@/data/wedash/engine/wallet";
import { loadBranchWallet, loadSellerWallet } from "@/data/wedash/walletLoad";
import { effectiveWeekHours } from "@/data/wedash/storeHours";
import { brlCent, fullDate } from "@/lib/format";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useScope } from "@/pages/dashboard/useScope";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { MonthStep, MonthYearPicker, monthNavBtn } from "@/pages/cash-close/MonthYearPicker";
import { SectionHeader, SelectStoreCard, pickOneStore, useScopedStores } from "@/pages/operation/shared";
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
  if (line.kind === "challenge") return `Desafio · ${line.title}`;
  if (line.kind === "withdrawal") return `Retirada · ${line.day ? fullDate(line.day) : ""}`;
  return `Quebra de caixa · ${line.day ? fullDate(line.day) : ""}`;
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

function MonthControls({
  month,
  today,
  floor,
  onChange,
}: {
  month: string;
  today: string;
  floor: string;
  onChange: (next: string) => void;
}) {
  const current = startOfMonth(today);
  return (
    <HeaderFilters>
      <div className="flex items-center gap-2">
        <button type="button" className={monthNavBtn} aria-label="Mês anterior" disabled={month <= floor} onClick={() => onChange(addMonths(month, -1))}>
          <MonthStep dir="anterior" />
        </button>
        <MonthYearPicker iso={month} today={today} minIso={floor} onChange={onChange} />
        <button type="button" className={monthNavBtn} aria-label="Próximo mês" disabled={month >= current} onClick={() => onChange(addMonths(month, 1))}>
          <MonthStep dir="proximo" />
        </button>
      </div>
    </HeaderFilters>
  );
}

function Totals({ wallet, mine }: { wallet: WalletMonth; mine: boolean }) {
  const rows = wallet.people;
  const sum = (pick: (row: WalletPersonMonth) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const balance = sum((row) => row.balanceCents);
  const open = rows.some((row) => row.openPrize || row.lines.some((line) => line.open));
  const cards = [
    { label: "Saldo", value: money(balance), sub: open ? "Até agora" : undefined, valueClassName: balanceClass(balance) },
    { label: "Premiação", value: money(sum((row) => row.prizeCents)) },
    { label: "Bônus", value: money(sum((row) => row.bonusCents)) },
    { label: "Desafios", value: money(sum((row) => row.challengeCents)) },
    { label: "Retiradas", value: money(sum((row) => row.withdrawalCents)) },
    { label: "Quebra de caixa", value: money(sum((row) => row.shortageCents)) },
  ];
  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${mine ? "lg:grid-cols-3" : "lg:grid-cols-3 xl:grid-cols-6"}`}>
      {cards.map((card) => (
        <StatCard
          key={card.label}
          label={card.label}
          value={card.value}
          sub={card.sub}
          valueClassName={"valueClassName" in card ? card.valueClassName : undefined}
          icon={<span className="text-[13px] font-bold">R$</span>}
        />
      ))}
    </div>
  );
}

function Statement({ person }: { person: WalletPersonMonth }) {
  if (person.lines.length === 0) {
    return <EmptyBlock icon="👛" title="Nada neste mês" description="Não há premiação, desafio, retirada ou quebra neste mês." />;
  }
  return (
    <ul className="divide-y divide-line">
      {person.lines.map((line, index) => {
        const note = lineNote(line);
        return (
          <li key={`${line.kind}-${line.title}-${line.day ?? ""}-${index}`} className="flex items-start justify-between gap-4 py-3">
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

function WalletBody({ wallet, mine }: { wallet: WalletMonth; mine: boolean }) {
  const [picked, setPicked] = useState<string | null>(null);
  const person = mine ? wallet.people[0] : wallet.people.find((row) => row.personId === picked) ?? null;
  const columns = useMemo<DataTableColumn<WalletPersonMonth>[]>(
    () => [
      {
        key: "name",
        header: "Pessoa",
        sortable: true,
        sortValue: (row) => row.name,
        render: (row) => (
          <span className="font-semibold text-t0">
            {row.name}
            {row.openPrize || row.lines.some((line) => line.open) ? (
              <Badge variant="warning" className="ml-2">
                Até agora
              </Badge>
            ) : null}
          </span>
        ),
      },
      { key: "prize", header: "Premiação", align: "right", sortable: true, sortValue: (row) => row.prizeCents, render: (row) => money(row.prizeCents) },
      { key: "bonus", header: "Bônus", align: "right", sortable: true, sortValue: (row) => row.bonusCents, render: (row) => money(row.bonusCents), hideBelow: "md" },
      { key: "challenge", header: "Desafios", align: "right", sortable: true, sortValue: (row) => row.challengeCents, render: (row) => money(row.challengeCents), hideBelow: "lg" },
      { key: "withdrawal", header: "Retiradas", align: "right", sortable: true, sortValue: (row) => row.withdrawalCents, render: (row) => money(row.withdrawalCents), hideBelow: "md" },
      { key: "shortage", header: "Quebra", align: "right", sortable: true, sortValue: (row) => row.shortageCents, render: (row) => money(row.shortageCents), hideBelow: "lg" },
      {
        key: "balance",
        header: "Saldo",
        align: "right",
        sortable: true,
        sortValue: (row) => row.balanceCents,
        render: (row) => <span className={`font-bold ${balanceClass(row.balanceCents)}`}>{money(row.balanceCents)}</span>,
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <Totals wallet={wallet} mine={mine} />
      {mine && person ? (
        <Card>
          <CardTitle>Movimento do mês</CardTitle>
          <div className="mt-2">
            <Statement person={person} />
          </div>
        </Card>
      ) : null}
      {!mine && wallet.unassignedShortageCents > 0 ? (
        <Card>
          <CardTitle>Quebra sem destino</CardTitle>
          <p className="mt-2 text-[13.5px] text-t1">Dias com quebra que não apontam uma pessoa, um grupo ou a equipe.</p>
          <p className="mt-2 font-mono text-[18px] font-bold text-t0">{money(wallet.unassignedShortageCents)}</p>
        </Card>
      ) : null}
      {!mine ? (
        <Card className="min-w-0">
          <CardTitle>Pessoas</CardTitle>
          <div className="mt-3">
            <DataTable
              columns={columns}
              data={wallet.people}
              rowKey={(row) => row.personId}
              defaultSortKey="name"
              defaultSortDir="asc"
              paginate="pessoas"
              onRowClick={(row) => setPicked((current) => (current === row.personId ? null : row.personId))}
              empty={<EmptyBlock icon="👛" title="Nada neste mês" description="Não há premiação, desafio, retirada ou quebra neste mês." />}
            />
          </div>
          {person ? (
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-1 text-[14px] font-bold text-t0">{person.name}</p>
              <Statement person={person} />
            </div>
          ) : wallet.people.length > 0 ? (
            <p className="mt-3 text-[12.5px] text-t2">Toque uma pessoa para ver o movimento do mês.</p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function useWalletMonth() {
  const today = calendarTodayIso();
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [floor, setFloor] = useState(() => sellerHistoryFloor(today));
  return { today, month, setMonth, floor, setFloor };
}

/** Início do vendedor: só a carteira dela. */
export function SellerWalletPage() {
  const { today, month, setMonth, floor, setFloor } = useWalletMonth();
  const [wallet, setWallet] = useState<WalletMonth | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinSkeleton(loading && !wallet);
  const request = useRef(0);

  const load = useCallback((target: string) => {
    const id = ++request.current;
    setFailed(false);
    void loadSellerWallet(target).then((data) => {
      if (id !== request.current) return;
      if (data?.historyFrom && data.historyFrom > sellerHistoryFloor(calendarTodayIso())) setFloor(startOfMonth(data.historyFrom));
      if (data && data.wallet.month !== target.slice(0, 7)) setMonth(`${data.wallet.month}-01`);
      setWallet(data?.wallet ?? null);
      setFailed(data == null);
      setLoading(false);
    });
  }, [setFloor, setMonth]);

  useEffect(() => {
    load(month);
  }, [load, month]);

  useEffect(() => {
    const onSynced = () => load(month);
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [load, month]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Carteira"
        subtitle="Premiação, bônus, desafios, retiradas e quebra de caixa deste mês."
        actions={<MonthControls month={month} today={today} floor={floor} onChange={setMonth} />}
      />
      {showSkeleton ? (
        <Skeleton className="h-[420px] w-full rounded-[18px]" />
      ) : failed || !wallet ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-[15px] font-bold text-t0">Não foi possível carregar a carteira</p>
          <Button type="button" onClick={() => load(month)}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <WalletBody wallet={wallet} mine />
      )}
    </div>
  );
}

/** Financeiro da gestão: uma filial, uma linha por pessoa. */
export function BranchWalletPage() {
  const { session, storeRows, loading: storesLoading } = useScopedStores();
  const { scope } = useScope();
  const escolher = pickOneStore(scope.storeIds, session.stores.length);
  const store = escolher ? null : storeRows[0] ?? null;
  const { today, month, setMonth, floor } = useWalletMonth();
  const [wallet, setWallet] = useState<WalletMonth | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const showSkeleton = useMinSkeleton(storesLoading || loading);
  const request = useRef(0);
  const loadedKey = useRef("");
  const storeId = store?.id ?? "";

  const load = useCallback(() => {
    if (!store) return;
    const id = ++request.current;
    const key = `${store.id}|${month}`;
    if (loadedKey.current !== key) setWallet(null);
    setFailed(false);
    setLoading(true);
    void loadBranchWallet({
      tenantId: session.tenantId,
      storeId: store.id,
      storeName: store.tradeName || store.name,
      month,
      today,
      timeZone: store.timezone,
      week: effectiveWeekHours(store.hours),
    })
      .then((data) => {
        if (id !== request.current) return;
        loadedKey.current = key;
        setWallet(data);
        setFailed(false);
      })
      .catch(() => {
        if (id !== request.current) return;
        setFailed(true);
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
  }, [month, session.tenantId, store, today]);

  useEffect(() => {
    if (!storeId) return;
    load();
  }, [load, storeId]);

  useEffect(() => {
    const onSynced = () => load();
    window.addEventListener(SALES_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSynced);
  }, [load]);

  return (
    <div>
      <SectionHeader
        section="Financeiro"
        title="Carteira"
        subtitle="A carteira de cada pessoa desta filial. A retirada e a quebra são lançadas no Fechamento."
        actions={<MonthControls month={month} today={today} floor={floor} onChange={setMonth} />}
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
        {escolher ? (
          <div className="max-w-[720px]">
            <SelectStoreCard />
          </div>
        ) : showSkeleton && !wallet ? (
          <Skeleton className="h-[520px] w-full rounded-[18px]" />
        ) : !store ? (
          <Card>
            <EmptyBlock icon="👛" title="Nenhuma filial disponível" description="Não há filiais disponíveis para este acesso." />
          </Card>
        ) : wallet ? (
          <WalletBody wallet={wallet} mine={false} />
        ) : null}
      </div>
    </div>
  );
}

export default BranchWalletPage;
