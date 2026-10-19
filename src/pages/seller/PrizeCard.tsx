import { Badge, Card, CardTitle, progressTextClass } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { GOAL_STATUS_LABEL, prazoRemaining } from "@/data/wedash/goalView";
import type { NetworkGlobalGoal } from "@/data/wedash/teamViews";
import type { SellerHomeStore } from "@/data/wedash/engine/sellerHome";
import { brlCent, fullDate, num, shortDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { statusBadgeVariant } from "@/lib/status";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { TargetIcon } from "@/pages/dashboards/icons";
import { GoalProgressBar } from "@/pages/team/blocks";
import { Icon, icons } from "@/pages/users/Icons";

type Goal = NonNullable<SellerHomeStore["goal"]>;
type Me = NonNullable<Goal["me"]>;

const MODE = {
  individual: {
    badge: "Premiação individual",
    sales: "Suas vendas na meta",
    help: "Cada pessoa sobe de nível pela própria meta e recebe a premiação do nível sobre as próprias vendas. Os bônus dos níveis alcançados são acumulados.",
    prize:
      "Percentual do nível sobre tudo o que você vendeu na meta. Os bônus dos níveis alcançados entram na soma.",
  },
  grupo: {
    badge: "Premiação por grupo",
    sales: "Vendas do grupo",
    help: "O grupo sobe de nível pela soma das vendas. A premiação é dividida igualmente entre as pessoas do grupo, e o bônus de cada nível vale para cada pessoa. Os bônus dos níveis alcançados são acumulados.",
    prize: "Percentual do nível sobre as vendas do grupo, dividido igualmente entre as pessoas. Os bônus dos níveis alcançados entram na soma.",
  },
  geral: {
    badge: "Premiação geral",
    sales: "Vendas da filial",
    help: "A filial sobe de nível pelo total vendido, inclusive a venda do caixa e a venda sem vendedor. A premiação é dividida igualmente e o bônus vale para cada pessoa.",
    prize: "Percentual do nível sobre o total vendido da filial, dividido igualmente entre as pessoas. Os bônus dos níveis alcançados entram na soma.",
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

function ClockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
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

/** Premiacao do vendedor numa loja, no mesmo desenho do resumo da meta do gestor. */
export function PrizeCard({ store, embedded = false }: { store: SellerHomeStore; embedded?: boolean }) {
  const goal = store.goal;
  const body = (
    <>
      {!embedded && <h2 className="text-[15px] font-bold text-t0">{store.storeName}</h2>}
      {!goal ? (
        <EmptyBlock icon="🎯" title="Meta não configurada" description="Quando a meta da filial for cadastrada, ela aparecerá aqui." />
      ) : !goal.me ? (
        <p className="py-6 text-center text-[13.5px] text-t1">Você ainda não está em um grupo desta meta. Fale com a gerência da loja.</p>
      ) : (
        <PrizeBody goal={goal} me={goal.me} />
      )}
    </>
  );
  if (embedded) return body;
  return <Card className="flex flex-col">{body}</Card>;
}

function PrizeBody({ goal, me }: { goal: Goal; me: Me }) {
  const mode = MODE[me.modo];
  const level = me.levelNumber != null && me.level ? `N${me.levelNumber} · ${me.level}` : null;
  const current = me.levelNumber != null ? me.marcos[me.levelNumber - 1] : undefined;
  const total = me.prizeAmount + me.bonus;
  const prazo = me.status === "active" ? prazoRemaining(me.daysRemaining) : GOAL_STATUS_LABEL[me.status];
  const band: NetworkGlobalGoal = {
    competenceText: me.metaName,
    achieved: me.achieved,
    total: me.goalAmount,
    pct: me.attainmentPct,
    projectedPct: 0,
    daysRemaining: me.daysRemaining,
    start: me.start,
    end: me.end,
  };
  const tiers = me.marcos.map((m) => ({ name: m.name, minAttainmentPct: m.pct, commissionPct: m.commissionPct }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-3.5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-acc-soft text-acc">
          <TargetIcon size={22} />
        </span>
        <div className="min-w-[180px] flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h3 className="text-[18px] font-extrabold text-t0 sm:text-xl">{me.metaName}</h3>
            <Badge variant={statusBadgeVariant(GOAL_STATUS_LABEL[me.status])} className="uppercase">
              {GOAL_STATUS_LABEL[me.status]}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="neutral" className="gap-1 uppercase">
              <ClockIcon />
              {prazo}
            </Badge>
            <Badge variant="neutral" className="uppercase">
              {fullDate(me.start)} a {fullDate(me.end)}
            </Badge>
            <Badge variant="neutral" className="uppercase">
              {mode.badge}
            </Badge>
            <TipHelp label={mode.help} />
            {me.group ? (
              <Badge variant="neutral" className="uppercase">
                {me.group}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-[18px] font-extrabold tracking-tight text-t0 sm:text-[20px]">
              <span className="font-mono">{brlCent(me.achieved)}</span>
              <span className="mx-1.5 text-[14px] font-semibold text-t2">/</span>
              <span className="font-mono text-[14px] font-bold text-t2 sm:text-[15px]">{brlCent(me.goalAmount)}</span>
            </p>
            <p className="mt-1 text-[12px] text-t2">{mode.sales}</p>
          </div>
          <p className={`font-mono text-[26px] font-extrabold leading-none sm:text-[28px] ${progressTextClass(me.attainmentPct)}`}>
            {num(me.attainmentPct, 1)}%
          </p>
        </div>
        <div className="mt-4">
          <GoalProgressBar goal={band} tiers={tiers} embedded soBarra individual={false} />
        </div>
      </div>

      <div className={cn("grid grid-cols-2 gap-2.5", me.next ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        <Tile
          label="Premiação até agora"
          value={brlCent(total)}
          valueClass={total > 0 ? "text-ok" : "text-t0"}
          sub={level ? `${level}${current ? ` · ${num(current.commissionPct, 1)}%` : ""}` : "Abaixo do 1º nível"}
          tip={[mode.prize, me.bonus > 0 ? `Inclui ${brlCent(me.bonus)} de bônus dos níveis alcançados.` : ""].filter(Boolean).join(" ")}
        />
        {me.next ? (
          <Tile label="Próximo nível" value={`N${me.next.number} · ${me.next.name}`} mono={false} sub={`Faltam ${brlCent(me.next.gap)}`} />
        ) : (
          <Tile label="Próximo nível" value="Último nível" mono={false} valueClass="text-ok" sub="Chegou ao último nível da meta." />
        )}
        {me.next && (
          <Tile
            label="Ao chegar"
            value={goal.nextLevelGain != null && goal.nextLevelGain > 0 ? `+${brlCent(goal.nextLevelGain)}` : `${num(me.next.commissionPct, 1)}%`}
            valueClass={goal.nextLevelGain != null && goal.nextLevelGain > 0 ? "text-ok" : "text-t0"}
            sub={
              [
                goal.nextLevelGain != null && goal.nextLevelGain > 0 ? `${num(me.next.commissionPct, 1)}% de premiação` : "de premiação",
                me.next.bonus > 0 ? `+${brlCent(me.next.bonus)} de bônus` : "",
              ]
                .filter(Boolean)
                .join(" · ")
            }
            tip="Quanto a premiação aumenta ao chegar neste nível, sobre as vendas de agora."
          />
        )}
        <Tile
          label="Projeção"
          value={goal.projectedPrize != null ? brlCent(goal.projectedPrize) : "—"}
          sub={goal.projectedPrize != null ? `Se mantiver o ritmo até ${shortDate(goal.endsOn)}` : "Disponível após metade do período"}
          tip="Estimativa da sua premiação no fim da meta, se o ritmo de vendas se mantiver. Aparece depois de metade do período."
        />
      </div>

      {me.marcos.length > 0 && (
        <div>
          <CardTitle className="mb-3">Níveis e premiação</CardTitle>
          <div className="flex flex-col gap-2.5">
            {me.marcos.map((marco, i) => {
              const number = i + 1;
              const reached = me.levelNumber != null && me.levelNumber >= number;
              const currentLevel = me.levelNumber === number;
              return (
                <div
                  key={`${marco.name}-${i}`}
                  className="flex items-center gap-3 rounded-xl border bg-bg-inset px-3.5 py-3"
                  style={{ borderColor: currentLevel ? "var(--acc)" : reached ? "var(--ok-soft)" : "var(--line)" }}
                >
                  <span
                    className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold text-white"
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
                    <p className="mt-0.5 text-[11.5px] text-t2">A partir de {num(marco.pct, 0)}% da meta</p>
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

      {me.modo === "grupo" && me.group && (
        <p className="text-[12px] text-t2">
          Meta por grupo: o grupo <span className="font-semibold text-t1">{me.group}</span> sobe de nível junto, pela soma das vendas.
        </p>
      )}
      {me.modo === "geral" && (
        <p className="text-[12px] text-t2">Meta geral: a equipe sobe de nível junta, pelo total vendido da loja. A premiação é dividida igualmente.</p>
      )}
    </div>
  );
}
