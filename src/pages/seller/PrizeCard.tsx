import { useState, type ReactNode } from "react";
import { Badge, Card, CardTitle, ProgressBar, progressTextClass } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import type { SellerHomeGoal, SellerHomeStore } from "@/data/wedash/engine/sellerHome";
import { brlCent, num, shortDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { goalShowsProjection } from "@/pages/team/blocks";
import { Icon, icons } from "@/pages/users/Icons";

type Me = NonNullable<SellerHomeGoal["me"]>;

const MODE = {
  individual: {
    badge: "Individual",
    help: "Cada pessoa sobe de nível pela própria meta e recebe a premiação do nível sobre as próprias vendas. Os bônus dos níveis alcançados são acumulados.",
  },
  grupo: {
    badge: "Grupo",
    help: "O grupo sobe de nível pela soma das vendas. A premiação é dividida igualmente entre as pessoas do grupo, e o bônus de cada nível vale para cada pessoa. Os bônus dos níveis alcançados são acumulados.",
  },
  geral: {
    badge: "Geral",
    help: "A filial sobe de nível pelo total vendido, inclusive a venda do caixa e a venda sem vendedor. A premiação é dividida igualmente e o bônus vale para cada pessoa.",
  },
} as const;

function TipHelp({ label }: { label: string }) {
  return (
    <Tooltip label={label}>
      <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 transition-colors hover:text-t1">
        ?
      </span>
    </Tooltip>
  );
}

function IconBadge({ children }: { children: ReactNode }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function Tile({
  label,
  value,
  sub,
  tip,
  mono = true,
  valueClass = "text-t0",
}: {
  label: string;
  value: string;
  sub?: string;
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
              <CardTitle>{goal.name}</CardTitle>
              <p className="py-6 text-center text-[13.5px] text-t1">Você ainda não está em um grupo desta meta. Fale com a gerência da loja.</p>
            </>
          ) : (
            <PrizeBody goal={goal} me={goal.me} today={today} through={through} closed={closed} />
          )}
        </Card>
      ))}
    </div>
  );
}

function prazoLabel(days: number): string {
  if (days <= 0) return "Encerrada";
  if (days === 1) return "Último dia";
  return `${days} dias restantes`;
}

function PrizeBody({ goal, me, today, through, closed }: { goal: SellerHomeGoal; me: Me; today: string; through: string; closed: boolean }) {
  const [showAllLevels, setShowAllLevels] = useState(false);
  const mode = MODE[me.modo];
  const level = me.levelNumber != null && me.level ? `N${me.levelNumber} · ${me.level}` : null;
  const current = me.levelNumber != null ? me.marcos[me.levelNumber - 1] : undefined;
  const total = me.prizeAmount + me.bonus;
  const daysLeft = closed && me.end <= through ? 0 : me.daysRemaining;
  const showsProjection = goalShowsProjection(me.start, me.end, today);
  const levels = me.marcos.map((marco, i) => ({
    marco,
    number: i + 1,
    bonusSoFar: me.marcos.slice(0, i + 1).reduce((sum, m) => sum + m.bonus, 0),
  }));
  const preview = levels.filter((l) => (me.levelNumber == null ? l.number === 1 : l.number === me.levelNumber || l.number === me.levelNumber + 1));
  const shownLevels = showAllLevels ? levels : preview;
  const nextGain =
    me.next == null
      ? null
      : [
          goal.nextLevelGain != null && goal.nextLevelGain > 0 ? `${num(me.next.commissionPct, 1)}% de premiação` : "de premiação",
          me.next.bonus > 0 ? `+${brlCent(me.next.bonus)} de bônus` : "",
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <CardTitle>
            {goal.name}
            {me.group ? ` · Grupo ${me.group}` : ""}
          </CardTitle>
          <Badge variant="neutral" className="gap-1 uppercase">
            <IconBadge>
              {me.modo === "individual" ? (
                <>
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </>
              ) : (
                <>
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </>
              )}
            </IconBadge>
            {mode.badge}
          </Badge>
          <TipHelp label={mode.help} />
        </div>
        <p className="mt-1 text-[13px] font-semibold text-t2">{prazoLabel(daysLeft)}</p>
      </div>

      <div>
        <p className="text-[18px] font-extrabold tracking-tight text-t0 sm:text-[20px]">
          <span className="font-mono">{brlCent(me.achieved)}</span>
          <span className="mx-1.5 text-[14px] font-semibold text-t2">/</span>
          <span className="font-mono text-[14px] font-bold text-t2 sm:text-[15px]">{brlCent(me.goalAmount)}</span>
        </p>
        <p className={`mt-1 font-mono text-[26px] font-extrabold leading-none sm:text-[28px] ${progressTextClass(me.attainmentPct)}`}>
          {num(me.attainmentPct, 1)}%
        </p>
        <div className="mt-3">
          <ProgressBar value={me.attainmentPct} height={12} />
        </div>
      </div>

      <div>
        {me.next ? (
          <p className="text-[15px] font-semibold leading-tight text-t1">
            <span className="text-[20px] font-extrabold text-t0">Faltam {brlCent(me.next.gap)}</span> para {me.next.name}
          </p>
        ) : (
          <p className="text-[15px] font-extrabold text-ok">Você chegou ao último nível.</p>
        )}
        <p className="mt-2 flex flex-wrap items-center gap-1 text-[13.5px] text-t1">
          <span>
            Premiação atual: <span className={cn("font-mono font-extrabold", total > 0 ? "text-ok" : "text-t0")}>{brlCent(total)}</span>
          </span>
          {me.bonus > 0 && <TipHelp label={`Inclui ${brlCent(me.bonus)} de bônus dos níveis alcançados.`} />}
        </p>
        <p className="mt-0.5 text-[12.5px] font-semibold text-t2">
          {level ? `${level}${current ? ` · ${num(current.commissionPct, 1)}%` : ""}` : "Ainda abaixo do 1º nível"}
        </p>
      </div>

      {showsProjection && goal.projectedPct != null && (
        <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold text-t2">
          Projeção de fechamento
          <span className="font-mono font-bold text-t0">{num(goal.projectedPct, 0)}%</span>
          <TipHelp label="Projeção de atingimento ao final da meta. Aparece depois de metade do período." />
        </p>
      )}

      <div className={cn("grid grid-cols-1 gap-2.5", me.next && "sm:grid-cols-2")}>
        {me.next && (
          <Tile
            label="Premiação no próximo nível"
            value={goal.nextLevelGain != null && goal.nextLevelGain > 0 ? `+${brlCent(goal.nextLevelGain)}` : `${num(me.next.commissionPct, 1)}%`}
            valueClass={goal.nextLevelGain != null && goal.nextLevelGain > 0 ? "text-ok" : "text-t0"}
            sub={nextGain ?? undefined}
            tip="Quanto a premiação aumenta ao chegar neste nível, sobre as vendas de agora."
          />
        )}
        <Tile
          label="Premiação projetada"
          value={goal.projectedPrize != null ? brlCent(goal.projectedPrize) : "—"}
          sub={goal.projectedPrize != null ? `Se mantiver o ritmo até ${shortDate(goal.endsOn)}` : "Disponível após metade do período"}
          tip="Estimativa da sua premiação no fim da meta, se o ritmo de vendas se mantiver. Aparece depois de metade do período."
        />
      </div>

      {levels.length > 0 && (
        <div>
          <CardTitle className="mb-3">Níveis e premiação</CardTitle>
          <div className="flex flex-col gap-2.5">
            {shownLevels.map(({ marco, number, bonusSoFar }) => {
              const reached = me.levelNumber != null && me.levelNumber >= number;
              const currentLevel = me.levelNumber === number;
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
          {levels.length > preview.length && (
            <button
              type="button"
              className="mt-2 text-[12px] font-semibold text-t2 hover:text-t1"
              aria-expanded={showAllLevels}
              onClick={() => setShowAllLevels((v) => !v)}
            >
              {showAllLevels ? "Fechar níveis" : "Ver todos os níveis"}
            </button>
          )}
        </div>
      )}

      {me.modo === "grupo" && me.group && (
        <p className="text-[12px] text-t2">
          O grupo <span className="font-semibold text-t1">{me.group}</span> sobe de nível pela soma das vendas.
        </p>
      )}
      {me.modo === "geral" && (
        <p className="text-[12px] text-t2">A equipe sobe de nível pelo total da loja e divide a premiação igualmente.</p>
      )}
    </div>
  );
}
