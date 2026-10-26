import { useState } from "react";
import { Segmented } from "@/components/ui";
import type { GoalManagerPrize } from "@/data/wedash/engine/goalView";
import type { GoalRecord, SellerRow } from "@/data/wedash/engine/goalTypes";
import { brlCent, num, shiftName } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Icon, icons } from "@/pages/users/Icons";

const MANAGEMENT_KEY = "gerencia";

/** Níveis no desenho da vendedora. No detalhe fica no card. No placar abre numa janela. */
export function GoalLevelGuide({
  goal,
  sellers,
  showReached = false,
  flush = false,
  hideNote = false,
  management = null,
  managementClosed = false,
  greenValues = false,
}: {
  goal: GoalRecord;
  sellers: SellerRow[];
  /** No detalhe, a contagem de quem já atingiu entra em cada nível. */
  showReached?: boolean;
  /** Sem a margem de cima, para caber numa janela. */
  flush?: boolean;
  /** No detalhe, a proporcionalidade fica na ajuda do título. */
  hideNote?: boolean;
  /** No detalhe da meta, a gerência vira um pill no mesmo formato dos turnos. O placar não recebe. */
  management?: GoalManagerPrize | null;
  /** Meta encerrada: a premiação vira total e some o que falta para o próximo nível. */
  managementClosed?: boolean;
  /** No detalhe da meta, realizado e premiação ficam verdes. O placar segue na cor primária. */
  greenValues?: boolean;
}) {
  const guide = buildGoalLevelGuide(goal, sellers);
  const [groupKey, setGroupKey] = useState(guide?.groups[0]?.key ?? MANAGEMENT_KEY);
  if (!guide && !management) return null;

  const days = guide?.groups[0]?.days ?? daysBetween(goal.startsOn, goal.endsOn);
  const managementRows = management ? rowsForManagement(goal, days, management.levelNumber) : null;
  const options = [
    ...(guide?.groups.map((group) => ({ value: group.key, label: group.title })) ?? []),
    ...(managementRows ? [{ value: MANAGEMENT_KEY, label: "GERÊNCIA" }] : []),
  ];
  const selectedKey = options.some((option) => option.value === groupKey) ? groupKey : (options[0]?.value ?? MANAGEMENT_KEY);
  const selected = guide?.groups.find((group) => group.key === selectedKey) ?? null;
  const showingManagement = selectedKey === MANAGEMENT_KEY && managementRows != null && management != null;
  const rows = showingManagement ? managementRows : (selected?.rows ?? []);
  const kind: GuideKind = showingManagement ? "store" : (selected?.kind ?? "person");
  const people = showingManagement ? 0 : (selected?.people ?? 0);
  const hasNote = Boolean(guide?.note && !hideNote);
  const hasPills = options.length > 1;

  const levels = (
    <>
      {hasNote ? <p className="text-[12px] leading-snug text-t2">{guide?.note}</p> : null}
      {hasPills ? (
        <Segmented
          className={hasNote ? "mt-3" : undefined}
          options={options}
          value={selectedKey}
          onChange={(value) => value && setGroupKey(value)}
        />
      ) : null}
      {showingManagement ? <ManagementSummary management={management} closed={managementClosed} greenValues={greenValues} className={hasNote || hasPills ? "mt-3" : undefined} /> : null}
      <div className={cn("flex flex-col gap-2.5", (hasNote || hasPills || showingManagement) && "mt-3")}>
        {rows.map((row) => {
          const everyone = row.marked || (people > 0 && row.reached === people);
          return (
            <div
              key={row.number}
              className="flex items-center gap-3 rounded-xl border border-line bg-bg-inset px-3.5 py-3"
            >
              <span
                className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold"
                style={{
                  background: everyone ? "var(--acc)" : "var(--bg-3)",
                  borderColor: everyone ? "var(--acc)" : "var(--line-2)",
                  color: everyone ? "#fff" : "var(--t2)",
                }}
              >
                {everyone ? <Icon d={icons.check} size={12} /> : row.number}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-bold text-t0">
                  N{row.number} · {row.name}
                </p>
                <p className="mt-0.5 text-[12px] font-semibold text-t1">{moneyLine(kind, row.month, row.day)}</p>
                <p className="mt-0.5 text-[11.5px] text-t2">{ruleLine(row)}</p>
                {showReached && !management && row.manager ? <p className="mt-0.5 text-[11.5px] text-t2">{row.manager}</p> : null}
                {row.statusLine ? (
                  <p className="mt-0.5 text-[11.5px] font-semibold text-acc">{row.statusLine.text}</p>
                ) : people > 0 ? (
                  <p className="mt-0.5 text-[11.5px] font-semibold text-acc">
                    <span className="font-mono tabular-nums">
                      {row.reached}/{people}
                    </span>{" "}
                    já atingiu
                  </p>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <p className={`font-mono text-[13px] font-extrabold ${greenValues ? "text-ok" : "text-acc"}`}>{num(row.commissionPct, 1)}%</p>
                <p className="text-[10.5px] text-t2">de premiação</p>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
  return <div className={flush ? undefined : "mt-4"}>{levels}</div>;
}

/** Nível já atingido e a premiação acumulada. Fica só na vista Gerência. */
function ManagementSummary({ management, closed, greenValues = false, className }: { management: GoalManagerPrize; closed: boolean; greenValues?: boolean; className?: string }) {
  const prize = management.prizeAmount + management.bonus;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-acc-soft px-3.5 py-3 text-[12.5px]", className)}>
      <span className={`font-semibold ${management.level ? "text-acc" : "text-t2"}`}>
        {management.level ? `N${management.levelNumber} · ${management.level}` : "Abaixo do 1º nível"}
      </span>
      <span className="text-t1">
        {closed ? "Premiação total" : "Premiação até agora"}: <span className={`font-mono font-bold ${greenValues ? "text-ok" : "text-t0"}`}>{brlCent(prize)}</span>
      </span>
      {!closed ? (
        <span className="text-t1 sm:ml-auto">
          {management.next ? (
            <>
              Falta <span className="font-mono font-bold text-acc">{brlCent(management.next.gap)}</span> para N{management.next.number} · {management.next.name}
            </>
          ) : (
            <span className="font-semibold text-acc">Último nível</span>
          )}
        </span>
      ) : null}
    </div>
  );
}

function moneyLine(kind: GuideGroup["kind"], month: number, day: number): string {
  const value = `${brlCent(month)} ${kind === "store" ? "a loja no mês" : kind === "group" ? "o grupo no mês" : "no mês"} · ${brlCent(day)} por dia`;
  return value;
}

function ruleLine(row: GuideRow): string {
  const parts = [`A partir de ${num(row.pct, 0)}% da meta`];
  if (row.bonus > 0) {
    parts.push(`bônus de ${brlCent(row.bonus)}`);
    if (row.bonusSoFar > row.bonus) parts.push(`bônus acumulado de ${brlCent(row.bonusSoFar)}`);
  }
  return parts.join(" · ");
}

type GuideKind = "person" | "group" | "store";

type GuideGroup = { key: string; title: string; people: number; fullAmount: number; days: number; kind: GuideKind; members: SellerRow[] };

type GuideRow = {
  number: number;
  name: string;
  pct: number;
  month: number;
  day: number;
  commissionPct: number;
  bonus: number;
  bonusSoFar: number;
  reached: number;
  manager: string | null;
  /** Check verde sem depender da contagem de pessoas. Usado na gerência. */
  marked?: boolean;
  /** Substitui "N/M já atingiu". */
  statusLine?: { text: string; tone: "current" | "done" } | null;
};

function buildGoalLevelGuide(goal: GoalRecord, sellers: SellerRow[]): { intro: string; note: string | null; groups: Array<GuideGroup & { rows: GuideRow[] }> } | null {
  if (goal.tiers.length === 0) return null;
  const people = sellers.filter((seller) => !seller.noGoal);
  const days = people[0]?.periodDays && people[0].periodDays > 0 ? people[0].periodDays : daysBetween(goal.startsOn, goal.endsOn);
  const grouped = new Map<string, SellerRow[]>();
  for (const seller of people) {
    const key = seller.group || "Sem grupo";
    const list = grouped.get(key) ?? [];
    list.push(seller);
    grouped.set(key, list);
  }

  let intro: string;
  let note: string | null = null;
  let blocks: GuideGroup[];

  if (goal.tierMode === "GENERAL") {
    intro = "A loja sobe de nível junta. Cada card é o que a filial precisa vender no mês. Por dia é esse valor dividido pelos dias da meta.";
    blocks = [{ key: "store", title: "Filial", people: people.length, fullAmount: goal.target, days, kind: "store", members: people }];
  } else if (goal.tierMode === "GROUP") {
    intro = "O turno sobe junto. Cada card é o que o grupo precisa vender no mês. Por dia é esse valor dividido pelos dias da meta.";
    blocks = [...grouped.entries()].map(([name, rows]) => ({
      key: name,
      title: shiftName(name),
      people: rows.length,
      fullAmount: rows[0]?.individualGoalAmount ?? 0,
      days: rows[0]?.periodDays || days,
      kind: "group",
      members: rows,
    }));
  } else {
    intro = "Cada card é o que uma pessoa do turno precisa vender no mês, na parte cheia. Por dia é esse valor dividido pelos dias da meta.";
    if (people.some((seller) => seller.proportionalGoal)) {
      note = "Quem não ficou o mês inteiro leva uma parte menor, pelos dias em que esteve presente. Na tela dela, os valores já saem dessa parte.";
    }
    blocks = [...grouped.entries()].map(([name, rows]) => {
      const shares = rows.map(fullPersonShare).filter((amount) => amount > 0);
      return {
        key: name,
        title: shiftName(name),
        people: rows.length,
        fullAmount: shares.length > 0 ? Math.max(...shares) : 0,
        days: rows[0]?.periodDays || days,
        kind: "person",
        members: rows,
      };
    });
  }

  if (blocks.length === 0) return null;
  const order = goal.groups.map((group) => shiftName(group.name));
  const groups = blocks
    .filter((group) => group.fullAmount > 0)
    .sort((a, b) => {
      const left = order.indexOf(a.title);
      const right = order.indexOf(b.title);
      if (left === -1 && right === -1) return a.title.localeCompare(b.title, "pt-BR");
      if (left === -1) return 1;
      if (right === -1) return -1;
      return left - right;
    })
    .map((group) => ({ ...group, rows: rowsOf(goal, group) }));
  if (groups.length === 0) return null;
  return { intro, note, groups };
}

/** Mesmos cards do turno, sobre a meta da loja e a premiação da gerência. */
function rowsForManagement(goal: GoalRecord, days: number, levelNumber: number | null): GuideRow[] {
  let bonusSoFar = 0;
  return goal.tiers.map((tier, index) => {
    const bonus = tier.managerPct != null ? (tier.managerBonus ?? 0) : 0;
    bonusSoFar += bonus;
    const month = (goal.target * tier.minAttainmentPct) / 100;
    const number = index + 1;
    const reached = levelNumber != null && number <= levelNumber;
    return {
      number,
      name: tier.name,
      pct: tier.minAttainmentPct,
      month,
      day: days > 0 ? month / days : month,
      commissionPct: tier.managerPct ?? 0,
      bonus,
      bonusSoFar,
      reached: reached ? 1 : 0,
      manager: null,
      marked: reached,
      statusLine: levelNumber === number ? { text: "Nível atual", tone: "current" } : reached ? { text: "Já atingiu", tone: "done" } : null,
    };
  });
}

function rowsOf(goal: GoalRecord, group: GuideGroup): GuideRow[] {
  let bonusSoFar = 0;
  let managerBonusSoFar = 0;
  return goal.tiers.map((tier, index) => {
    bonusSoFar += tier.bonus;
    const managerBonus = tier.managerBonus ?? 0;
    managerBonusSoFar += tier.managerPct != null ? managerBonus : 0;
    const month = (group.fullAmount * tier.minAttainmentPct) / 100;
    const number = index + 1;
    const manager =
      tier.managerPct != null
        ? [
            `Gerência: ${num(tier.managerPct, 1)}% da venda da filial`,
            managerBonus > 0 ? `bônus de ${brlCent(managerBonus)}` : "",
            managerBonusSoFar > managerBonus ? `total de ${brlCent(managerBonusSoFar)}` : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : null;
    return {
      number,
      name: tier.name,
      pct: tier.minAttainmentPct,
      month,
      day: group.days > 0 ? month / group.days : month,
      commissionPct: tier.commissionPct,
      bonus: tier.bonus,
      bonusSoFar,
      reached: group.members.filter((seller) => (seller.currentLevel ?? 0) >= number).length,
      manager,
    };
  });
}

/** Parte cheia: a meta individual de quem ficou o período inteiro. */
function fullPersonShare(seller: SellerRow): number {
  if (seller.periodDays > 0 && seller.eligibleDays > 0 && seller.eligibleDays < seller.periodDays) {
    return (seller.individualGoalAmount * seller.periodDays) / seller.eligibleDays;
  }
  return seller.individualGoalAmount;
}

function daysBetween(start: string, end: string): number {
  const span = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  if (!Number.isFinite(span)) return 1;
  return Math.round(span / 86_400_000) + 1;
}
