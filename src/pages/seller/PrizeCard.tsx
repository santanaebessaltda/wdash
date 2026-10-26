import { Badge, Card, CardTitle } from "@/components/ui";
import { BranchBadge, PeriodBadge, RecordStatusBadge, UnidentifiedSalesBadge } from "@/components/wedash/RecordBadges";
import { Tooltip } from "@/components/ui/Tooltip";
import type { SellerHomeGoal, SellerHomeStore } from "@/data/wedash/engine/sellerHome";
import { GOAL_STATUS_LABEL, goalLevelPct, goalStatus } from "@/data/wedash/goalView";
import type { NetworkGlobalGoal } from "@/data/wedash/teamViews";
import { brlCent, num, presenceDayLabel, shortDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { GoalProgressBar } from "@/pages/team/blocks";
import { Icon, icons } from "@/pages/users/Icons";

type Me = NonNullable<SellerHomeGoal["me"]>;

function TipHelp({ label }: { label: string }) {
  return (
    <Tooltip label={label}>
      <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 transition-colors hover:text-t1">
        ?
      </span>
    </Tooltip>
  );
}

function Tile({
  label,
  value,
  sub,
  detail,
  tip,
  mono = true,
  valueClass = "text-t0",
}: {
  label: string;
  value: string;
  sub?: string;
  detail?: string;
  tip?: string;
  mono?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-bg-inset p-3">
      <p className="flex items-center gap-1 text-[11.5px] font-semibold text-t2">
        {label}
        {tip && <TipHelp label={tip} />}
      </p>
      <p className={cn("mt-1 text-[15px] font-extrabold leading-tight", mono && "font-mono tabular-nums", value === "—" ? "text-t2" : valueClass)}>{value}</p>
      {sub && <p className="mt-0.5 text-[12px] font-semibold leading-snug text-t1">{sub}</p>}
      {detail && <p className="mt-0.5 text-[12px] font-semibold leading-snug text-t1">{detail}</p>}
    </div>
  );
}

/** Uma meta da pessoa, no card do gestor: selos, barra, projeção e a escada com bônus. */
export function PrizeCard({
  store,
  today,
  through,
  closed = false,
  embedded = false,
}: {
  store: SellerHomeStore;
  today: string;
  /** Último dia já carregado do mês visto. */
  through: string;
  /** Mês anterior ao corrente: meta encerrada até esse dia não mostra "Último dia". */
  closed?: boolean;
  embedded?: boolean;
}) {
  const goals = store.goals;
  if (goals.length === 0) {
    const empty = <EmptyBlock icon="🎯" title="Meta não configurada" description="Quando a meta da filial for cadastrada, ela aparecerá aqui." />;
    return embedded ? empty : <Card className="flex flex-col">{empty}</Card>;
  }
  return (
    <div className="flex flex-col gap-4">
      {goals.map((goal) => (
        <Card key={goal.id} className="min-w-0 overflow-hidden" padding="lg">
          {!goal.me ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <CardTitle>{goal.name}</CardTitle>
                <RecordStatusBadge label={GOAL_STATUS_LABEL[goalStatus(goal, closed ? through : today)]} />
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <PeriodBadge from={goal.startsOn} to={goal.endsOn} />
                <BranchBadge name={store.storeName} />
              </div>
              <p className="py-6 text-center text-[13.5px] text-t1">Você ainda não participa de um grupo desta meta. Fale com a gerência.</p>
            </>
          ) : (
            <PrizeBody goal={goal} me={goal.me} storeName={store.storeName} today={today} through={through} closed={closed} />
          )}
        </Card>
      ))}
    </div>
  );
}

function PrizeBody({ goal, me, storeName, today, through, closed }: { goal: SellerHomeGoal; me: Me; storeName: string; today: string; through: string; closed: boolean }) {
  const level = me.levelNumber != null && me.level ? `N${me.levelNumber} · ${me.level}` : null;
  const current = me.levelNumber != null ? me.marcos[me.levelNumber - 1] : undefined;
  const total = me.prizeAmount + me.bonus;
  const band: NetworkGlobalGoal = {
    competenceText: me.metaName,
    achieved: me.achieved,
    total: me.goalAmount,
    pct: me.attainmentPct,
    projectedPct: goal.projectedPct ?? 0,
    daysRemaining: closed && me.end <= through ? 0 : me.daysRemaining,
    start: me.start,
    end: me.end,
  };
  const tiers = me.marcos.map((m) => ({ name: m.name, minAttainmentPct: m.pct, commissionPct: m.commissionPct }));
  const levels = me.marcos.map((marco, i) => ({
    marco,
    number: i + 1,
    bonusSoFar: me.marcos.slice(0, i + 1).reduce((sum, m) => sum + m.bonus, 0),
  }));
  const nextMarco = me.next ? me.marcos[me.next.number - 1] : undefined;
  const nextDaily =
    me.next && me.daysRemaining > 0
      ? me.next.gap / me.daysRemaining
      : nextMarco && me.periodDays > 0
        ? (me.goalAmount * nextMarco.pct) / 100 / me.periodDays
        : null;
  const nextSub = me.next
    ? [`Faltam ${brlCent(me.next.gap)}`, nextDaily != null && nextDaily > 0 ? `${brlCent(nextDaily)} por dia` : ""]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const nextDetail = me.next
    ? [
        goal.nextLevelGain != null && goal.nextLevelGain > 0
          ? `Ao atingir: +${brlCent(goal.nextLevelGain)} de premiação`
          : `Ao atingir: ${num(me.next.commissionPct, 1)}% de premiação`,
        me.next.bonus > 0 ? `+${brlCent(me.next.bonus)} de bônus` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const ended = goalStatus(goal, closed ? through : today) === "ended";
  const missedNext = ended && me.next ? `Faltaram ${brlCent(me.next.gap)} para N${me.next.number} · ${me.next.name}` : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>{goal.name}</CardTitle>
          <RecordStatusBadge label={GOAL_STATUS_LABEL[goalStatus(goal, closed ? through : today)]} />
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <PeriodBadge from={goal.startsOn} to={goal.endsOn} />
          <BranchBadge name={storeName} />
          {goal.spreadsUnidentified ? <UnidentifiedSalesBadge /> : null}
        </div>
        {me.group ? <p className="mt-1.5 text-[12px] text-t2">Grupo {me.group}</p> : null}
      </div>

      <GoalProgressBar goal={band} tiers={tiers} todayIso={today} embedded hideTitle individual={false} hideMissed labelPct={goalLevelPct(me.attainmentPct, me.marcos.map((m) => m.pct))} />

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <Tile
          label="Premiação atual"
          value={brlCent(total)}
          valueClass={total > 0 ? "text-ok" : "text-t0"}
          sub={
            !level
              ? ended
                ? undefined
                : "Ainda abaixo do 1º nível"
              : ended
                ? current
                  ? `${num(current.commissionPct, 1)}%`
                  : undefined
                : `${level}${current ? ` · ${num(current.commissionPct, 1)}%` : ""}`
          }
          tip={me.bonus > 0 ? `Inclui ${brlCent(me.bonus)} de bônus dos níveis alcançados.` : undefined}
        />
        {ended ? (
          <Tile
            label="Nível final"
            value={level ?? "Não atingiu"}
            mono={false}
            valueClass={!level ? "text-t1" : me.next ? "text-t0" : "text-ok"}
            sub={level && !me.next ? "Você chegou ao último nível." : missedNext}
          />
        ) : me.next ? (
          <Tile label="Próximo nível" value={`N${me.next.number} · ${me.next.name}`} mono={false} sub={nextSub} detail={nextDetail} />
        ) : (
          <Tile label="Próximo nível" value="Último nível" mono={false} valueClass="text-ok" sub="Você chegou ao último nível." />
        )}
      </div>
      {me.daysRemaining > 0 ? (
        <p className="text-[12px] leading-snug text-t2">
          Premiação projetada:{" "}
          <span className="font-semibold text-t1">{goal.projectedPrize != null ? brlCent(goal.projectedPrize) : "—"}</span>
          {goal.projectedPrize != null ? ` · se mantiver o ritmo até ${shortDate(goal.endsOn)}` : " · disponível após metade do período"}
        </p>
      ) : null}

      {levels.length > 0 && (
        <div>
          <CardTitle className="mb-1">Níveis e premiação</CardTitle>
          {me.periodDays > 0 ? (
            <p className="mb-3 text-[12px] text-t2">{presenceDayLabel(me.eligibleDays, "meta")}</p>
          ) : null}
          <div className="flex flex-col gap-2.5">
            {levels.map(({ marco, number, bonusSoFar }) => {
              const reached = me.levelNumber != null && me.levelNumber >= number;
              const currentLevel = me.levelNumber === number;
              const days = me.periodDays > 0 ? me.periodDays : 1;
              const month = (me.goalAmount * marco.pct) / 100;
              const perDay = month / days;
              const money =
                me.modo === "geral"
                  ? `${brlCent(month)} a loja no mês · ${brlCent(perDay)} por dia`
                  : me.modo === "grupo"
                    ? `${brlCent(month)} o grupo no mês · ${brlCent(perDay)} por dia`
                    : `${brlCent(month)} no mês · ${brlCent(perDay)} por dia`;
              const parts = [`A partir de ${num(marco.pct, 0)}% da meta`];
              if (marco.bonus > 0) {
                parts.push(`bônus de ${brlCent(marco.bonus)}`);
                if (bonusSoFar > marco.bonus) parts.push(`bônus acumulado de ${brlCent(bonusSoFar)}`);
              }
              return (
                <div
                  key={`${marco.name}-${number}`}
                  className="flex items-center gap-3 rounded-xl border bg-bg-inset px-3.5 py-3"
                  style={{ borderColor: currentLevel ? "var(--acc)" : reached ? "var(--ok-soft)" : "var(--line)" }}
                >
                  <span
                    className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold"
                    style={{
                      background: reached ? "var(--ok)" : "var(--bg-3)",
                      borderColor: reached ? "var(--ok)" : "var(--line-2)",
                      color: reached ? "#fff" : "var(--t2)",
                    }}
                  >
                    {reached ? <Icon d={icons.check} size={12} /> : number}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-bold text-t0">
                      N{number} · {marco.name}
                      {currentLevel && (
                        <Badge variant="accent" className="uppercase">
                          Seu nível
                        </Badge>
                      )}
                    </p>
                    {me.goalAmount > 0 ? <p className="mt-0.5 text-[12px] font-semibold text-t1">{money}</p> : null}
                    <p className="mt-0.5 text-[11.5px] text-t2">{parts.join(" · ")}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn("font-mono text-[13px] font-extrabold", reached ? "text-ok" : "text-t1")}>{num(marco.commissionPct, 1)}%</p>
                    <p className="text-[10.5px] text-t2">de premiação</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
