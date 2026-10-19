import { useState } from "react";
import { Card, CardTitle, Segmented, Tabs } from "@/components/ui";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { brlCent, num } from "@/data/wedash/engine/format";
import type { MonthRankingEntry, SellerHomeStore } from "@/data/wedash/engine/sellerHome";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { FlameIcon, TargetIcon, TrophyIcon } from "@/pages/dashboards/icons";
import { RankingBlock } from "@/pages/live/blocks";
import type { RankingRow } from "@/data/wedash/live";
import { SellerChallengeList } from "./ChallengeCard";
import { PrizeCard } from "./PrizeCard";

type RankingScope = "group" | "store";

function RankingList({ ranking }: { ranking: MonthRankingEntry[] }) {
  const podium: RankingRow[] = ranking.slice(0, 3).map((r) => ({
    position: r.position,
    employeeId: `e:${r.employeeId}`,
    name: r.me ? "VOCÊ" : r.name,
    avatarName: r.name,
    sales: r.sales,
    revenue: r.revenue,
  }));
  const rest = ranking.slice(3);
  return (
    <div>
      <RankingBlock ranking={podium} formatAmount={brlCent} />
      {rest.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-line">
          {rest.map((r) => (
            <li key={`${r.position}-${r.employeeId}`} className="flex items-center gap-3 py-2">
              <span className="w-7 text-right font-mono text-[13px] font-bold text-t2">{r.position}º</span>
              <PersonAvatar name={r.name} employeeId={r.employeeId} size="sm" />
              <span className={`min-w-0 flex-1 truncate text-[13.5px] ${r.me ? "font-extrabold text-acc" : "font-semibold text-t0"}`}>
                {r.me ? "VOCÊ" : r.name}
              </span>
              <span className="text-[12px] text-t2">
                {num(r.sales)} {r.sales === 1 ? "venda" : "vendas"}
              </span>
              <span className="w-24 text-right font-mono text-[13px] font-bold text-t0">{brlCent(r.revenue)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** O mesmo card da Equipe: Ranking (podio do mes), Desafios e Meta. Na meta Geral o ranking some: a parte e igual para todos. */
export function PerformanceCard({ store, today, through, closed }: { store: SellerHomeStore; today: string; through: string; closed: boolean }) {
  const geral = store.goals.some((g) => g.mode === "geral");
  const [scope, setScope] = useState<RankingScope>("group");
  const ranking = scope === "store" ? (store.storeRanking ?? []) : (store.monthRanking ?? []);
  const challenges = store.challenges ?? [];
  return (
    <Card className="min-w-0 overflow-hidden" padding="lg">
      <CardTitle className="mb-4">{store.storeName}</CardTitle>
      <Tabs
        variant="accent"
        defaultKey={geral ? "metas" : "ranking"}
        items={[
          ...(!geral
            ? [
                {
            key: "ranking",
            label: "Ranking",
            icon: <TrophyIcon size={14} />,
            content: (
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12.5px] font-semibold text-t2">
                    {scope === "group" && store.groupName ? `Grupo ${store.groupName}` : scope === "store" ? "Toda a loja" : "Sem grupo"}
                  </p>
                  <Segmented
                    options={[
                      { value: "group", label: "Grupo" },
                      { value: "store", label: "Loja" },
                    ]}
                    value={scope}
                    onChange={(v) => v && setScope(v)}
                  />
                </div>
                {ranking.length === 0 ? (
                  <EmptyBlock
                    icon="🏆"
                    title={scope === "store" ? "Nenhum vendedor nesta loja" : "Nenhum vendedor neste grupo"}
                    description={
                      scope === "store"
                        ? "Quando houver vendedores nesta loja, o ranking aparecerá aqui."
                        : "Quando houver vendedores vinculados a este grupo, o ranking aparecerá aqui."
                    }
                  />
                ) : (
                  <RankingList ranking={ranking} />
                )}
              </div>
            ),
          },
              ]
            : []),
          {
            key: "metas",
            label: "Metas",
            icon: <TargetIcon size={14} />,
            content: <PrizeCard store={store} today={today} through={through} closed={closed} embedded />,
          },
          {
            key: "desafios",
            label: "Desafios",
            icon: <FlameIcon size={14} />,
            content:
              challenges.length === 0 ? (
                <EmptyBlock icon="🔥" title="Desafio não configurado" description="Quando houver um desafio neste período, ele aparecerá aqui." />
              ) : (
                <SellerChallengeList challenges={challenges} today={today} through={through} closed={closed} />
              ),
          },
        ]}
      />
    </Card>
  );
}
