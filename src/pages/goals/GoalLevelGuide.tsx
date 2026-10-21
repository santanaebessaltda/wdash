import type { GoalRecord, SellerRow } from "@/data/wedash/engine/goalTypes";
import { brlCent, num, shiftName } from "@/lib/format";

/** Quanto cada nível vale, no formato da planilha: valor do mês, média por dia, premiação e bônus. */
export function GoalLevelGuide({ goal, sellers }: { goal: GoalRecord; sellers: SellerRow[] }) {
  const guide = buildGoalLevelGuide(goal, sellers);
  if (!guide) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-[12.5px] leading-snug text-t1">{guide.intro}</p>
      {guide.note ? <p className="mt-1 text-[12px] leading-snug text-t2">{guide.note}</p> : null}
      <div className="mt-3 flex flex-col gap-3">
        {guide.groups.map((group) => (
          <div key={group.key}>
            <p className="mb-1.5 text-[12px] font-bold text-t0">
              {group.title}
              {group.people > 0 ? (
                <span className="font-semibold text-t2">
                  {" "}
                  · {group.people} {group.people === 1 ? "pessoa" : "pessoas"}
                </span>
              ) : null}
            </p>
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-t2">
                    <th className="py-1.5 pr-2 font-semibold">Nível</th>
                    <th className="py-1.5 pr-2 text-right font-semibold">No mês</th>
                    <th className="py-1.5 pr-2 text-right font-semibold">Por dia</th>
                    <th className="py-1.5 pr-2 text-right font-semibold">Premiação</th>
                    <th className="py-1.5 text-right font-semibold">Bônus</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={`${group.key}-${row.number}`} className="border-b border-line last:border-b-0">
                      <td className="py-1.5 pr-2 font-semibold text-t0">
                        N{row.number} · {row.name}
                        <span className="mt-0.5 block text-[11px] font-medium text-t2">a partir de {num(row.pct, 0)}%</span>
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono font-bold tabular-nums text-t0">{brlCent(row.month)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-t1">{brlCent(row.day)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono font-bold tabular-nums text-t0">{num(row.commissionPct, 1)}%</td>
                      <td className="py-1.5 text-right text-t1">
                        {row.bonus > 0 ? (
                          <>
                            <span className="font-mono font-bold text-t0">{brlCent(row.bonus)}</span>
                            {row.bonusSoFar > row.bonus ? <span className="block text-[11px] text-t2">acumula {brlCent(row.bonusSoFar)}</span> : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type GuideGroup = { key: string; title: string; people: number; fullAmount: number; days: number };

type GuideRow = {
  number: number;
  name: string;
  pct: number;
  month: number;
  day: number;
  commissionPct: number;
  bonus: number;
  bonusSoFar: number;
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
    intro = "A loja sobe de nível junta. Cada linha é o que a filial precisa vender no mês. Por dia é esse valor dividido pelos dias da meta.";
    blocks = [{ key: "store", title: "Filial", people: people.length, fullAmount: goal.target, days }];
  } else if (goal.tierMode === "GROUP") {
    intro = "O turno sobe junto. Cada linha é o que o grupo precisa vender no mês. Por dia é esse valor dividido pelos dias da meta.";
    blocks = [...grouped.entries()].map(([name, rows]) => ({
      key: name,
      title: shiftName(name),
      people: rows.length,
      fullAmount: rows[0]?.individualGoalAmount ?? 0,
      days: rows[0]?.periodDays || days,
    }));
  } else {
    intro = "Cada linha é o que uma pessoa do turno precisa vender no mês, na parte cheia. Por dia é esse valor dividido pelos dias da meta.";
    if (people.some((seller) => seller.proportionalGoal)) {
      note = "Quem não ficou o mês inteiro leva uma parte menor, pelos dias em que esteve presente. Na tela dela, os valores já saem dessa parte.";
    }
    blocks = [...grouped.entries()].map(([name, rows]) => {
      const shares = rows.map(fullPersonShare).filter((amount) => amount > 0);
      return {
        key: name,
        title: `${shiftName(name)} · cada pessoa`,
        people: rows.length,
        fullAmount: shares.length > 0 ? Math.max(...shares) : 0,
        days: rows[0]?.periodDays || days,
      };
    });
  }

  if (blocks.length === 0) return null;
  const groups = blocks
    .filter((group) => group.fullAmount > 0)
    .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"))
    .map((group) => ({ ...group, rows: rowsOf(goal, group.fullAmount, group.days) }));
  if (groups.length === 0) return null;
  return { intro, note, groups };
}

function rowsOf(goal: GoalRecord, fullAmount: number, days: number): GuideRow[] {
  let bonusSoFar = 0;
  return goal.tiers.map((tier, index) => {
    bonusSoFar += tier.bonus;
    const month = (fullAmount * tier.minAttainmentPct) / 100;
    return {
      number: index + 1,
      name: tier.name,
      pct: tier.minAttainmentPct,
      month,
      day: days > 0 ? month / days : month,
      commissionPct: tier.commissionPct,
      bonus: tier.bonus,
      bonusSoFar,
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
