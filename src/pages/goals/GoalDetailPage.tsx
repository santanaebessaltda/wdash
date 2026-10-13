import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Badge, Breadcrumbs, Button, Card, CardTitle, progressTextClass } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { DuplicateChoiceModal } from "@/components/wedash/DuplicateChoiceModal";
import { GoalDetailSkeleton } from "@/components/wedash/LoadingSkeletons";
import { calendarTodayIso } from "@/data/wedash/clock";
import {
  buildGoalCardView,
  GOAL_STATUS_LABEL,
  goalManagerPrize,
  goalStatus,
  prazoRestante,
  type GoalManagerPrize,
  type GoalStatus,
} from "@/data/wedash/goalView";
import { fetchGoal, fetchGoalTeam, type GoalRecord, type GoalTeamMember } from "@/data/wedash/goalsRepo";
import { fetchSalesDayAggs, fetchSalesSellerDayAggs } from "@/data/wedash/salesRepo";
import type { SalesDayAgg, SalesSellerDayAgg } from "@/data/wedash/salesTypes";
import { storesForSession } from "@/data/wedash/stores";
import type { GoalCardView } from "@/data/wedash/teamViews";
import { WedashBrand } from "@/components/wedash/WedashBrand";
import { brlCent, fullDate, shortDate, isoToDate, num, dateToIso, shiftName } from "@/lib/format";
import { exportPdf } from "@/lib/printMode";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useReturnWhenStoreChanges } from "@/pages/dashboard/useScope";
import { TargetIcon } from "@/pages/dashboards/icons";
import { SellersCard, GlobalGoalBand, goalUnlockedProjection } from "@/pages/team/goalBlocks";
import { Icon, icons } from "@/pages/users/Icons";
import { goalBackPath } from "@/pages/goals/backPath";
import { paths } from "@/router/paths";
import { useActiveSession } from "@/session/SessionProvider";

type Loaded = { goal: GoalRecord | null; dayAggs: SalesDayAgg[]; sellerAggs: SalesSellerDayAgg[]; team: GoalTeamMember[] };

const TipHelp = ({ label }: { label: string }) => (
  <Tooltip label={label}>
    <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 transition-colors hover:text-t1">
      ?
    </span>
  </Tooltip>
);

const AJUDA_MODO: Record<GoalRecord["tierMode"], string> = {
  INDIVIDUAL:
    "Cada pessoa sobe de nível pela própria meta e recebe a premiação do nível sobre as próprias vendas. Os bônus dos níveis alcançados são acumulados.",
  GROUP:
    "O grupo sobe de nível pela soma das vendas. A premiação é dividida igualmente entre as pessoas do grupo, e o bônus de cada nível vale para cada pessoa. Os bônus dos níveis alcançados são acumulados.",
  GENERAL:
    "A filial sobe de nível pelo total vendido, inclusive a venda do caixa e a venda sem vendedor. Faturamento e nº de vendas de cada pessoa são a parte igual desse total. Ticket médio e P.A. são os da filial. A premiação é dividida igualmente e o bônus vale para cada pessoa.",
};

const MODO_LABEL: Record<GoalRecord["tierMode"], string> = {
  INDIVIDUAL: "Premiação individual",
  GROUP: "Premiação por grupo",
  GENERAL: "Premiação geral",
};

/** Gestao > Metas > detalhe  -  resumo, niveis com o progresso e equipe; meta encerrada = fechamento da premiacao. */
export default function GoalDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const session = useActiveSession();
  const today = calendarTodayIso();
  const [data, setData] = useState<Loaded | null>(null);
  const [reload, setReload] = useState(0);
  const [duplicarAberto, setDuplicarAberto] = useState(false);
  const hasOtherStores = storesForSession(session.stores).length > 1;
  const voltarPara = goalBackPath(location.state);
  const fromTeam = voltarPara.startsWith(paths.team);
  useReturnWhenStoreChanges(data?.goal?.storeId, voltarPara);

  useEffect(() => {
    const onSync = () => setReload((n) => n + 1);
    window.addEventListener(SALES_SYNCED_EVENT, onSync);
    return () => window.removeEventListener(SALES_SYNCED_EVENT, onSync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const goal = await fetchGoal(session.tenantId, id);
      let dayAggs: SalesDayAgg[] = [];
      let sellerAggs: SalesSellerDayAgg[] = [];
      let team: GoalTeamMember[] = [];
      if (goal) {
        const to = goal.endsOn < today ? goal.endsOn : today;
        const query = { tenantId: session.tenantId, storeIds: [goal.storeId], from: goal.startsOn, to };
        [dayAggs, sellerAggs, team] = await Promise.all([
          goal.startsOn <= to ? fetchSalesDayAggs({ ...query, brand: "ALL" }) : Promise.resolve([]),
          goal.startsOn <= to ? fetchSalesSellerDayAggs(query) : Promise.resolve([]),
          fetchGoalTeam(session.tenantId, [goal.storeId]),
        ]);
      }
      if (!cancelled) setData({ goal, dayAggs, sellerAggs, team });
    })();
    return () => {
      cancelled = true;
    };
  }, [session.tenantId, id, today, reload]);

  const showSkeleton = useMinSkeleton(data === null);
  const goal = data?.goal ?? null;
  const store = useMemo(() => (goal ? storesForSession(session.stores).find((s) => s.id === goal.storeId) : undefined), [goal, session.stores]);

  const card = useMemo(() => {
    if (!data?.goal) return null;
    return buildGoalCardView({
      goal: data.goal,
      storeNameValue: store?.fantasia ?? "Filial",
      dayAggs: data.dayAggs,
      sellerDayAggs: data.sellerAggs,
      team: data.team,
      today,
    });
  }, [data, store, today]);

  const status = goal ? goalStatus(goal, today) : null;
  const gerencia = goal && card ? goalManagerPrize(goal, card.band.achieved) : null;
  const voltar = () => navigate(voltarPara);

  return (
    <div>
      {goal && card && status === "ended" && <PayoutReportHeader goal={goal} storeNameValue={store?.fantasia} />}
      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <Button variant="secondary" size="sm" icon={<Icon d={icons.arrowLeft} size={14} />} onClick={voltar}>
          Voltar
        </Button>
        <Breadcrumbs
          items={
            fromTeam
              ? [{ label: "Dashboard", to: paths.overview }, { label: "Equipe", to: voltarPara }, { label: goal?.name ?? "Detalhe" }]
              : [{ label: "Gestão" }, { label: "Metas", to: paths.goals }, { label: goal?.name ?? "Detalhe" }]
          }
        />
        {goal && !showSkeleton && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDuplicarAberto(true)}>
              Duplicar meta
            </Button>
            <Button size="sm" onClick={() => navigate(paths.goalEdit(goal.id), { state: location.state })}>
              Editar meta
            </Button>
          </div>
        )}
      </div>

      <DuplicateChoiceModal
        open={duplicarAberto}
        onClose={() => setDuplicarAberto(false)}
        kind="meta"
        name={goal?.name ?? null}
        hasOtherStores={hasOtherStores}
        onChoose={(choice) => {
          if (!goal) return;
          setDuplicarAberto(false);
          navigate(choice === "store" ? paths.goalCopyStore(goal.id) : paths.goalCopy(goal.id));
        }}
      />

      {showSkeleton ? (
        <GoalDetailSkeleton />
      ) : !goal || !card || !status ? (
        <Card className="flex min-h-[280px] flex-col">
          <EmptyBlock
            icon="🔍"
            title="Meta não encontrada"
            description="A meta pode ter sido excluída ou não pertencer às suas filiais."
            action={
              <Button size="sm" variant="outline" onClick={voltar}>
                {fromTeam ? "Voltar para Equipe" : "Ver metas"}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <GoalHero goal={goal} card={card} status={status} storeNameValue={store?.fantasia} gerencia={gerencia} today={today} />

          {status === "ended" ? (
            <>
              <GoalPayoutCard
                goal={goal}
                card={card}
                gerencia={gerencia}
                today={today}
                onExport={() => exportPdf(["Fechamento da meta", store?.fantasia ?? "", goal.name, `${fullDate(goal.startsOn)} a ${fullDate(goal.endsOn)}`])}
              />
              <GoalTiersCard goal={goal} card={card} status={status} gerencia={gerencia} today={today} />
            </>
          ) : (
            <div className="flex flex-col gap-5">
              <GoalTiersCard goal={goal} card={card} status={status} gerencia={gerencia} today={today} />
              <SellersCard
                estado={card.sellers.length > 0 ? "available" : "noData"}
                lista={card.sellers}
                activeGoal
                group={goal.tierMode === "GROUP"}
                geral={goal.tierMode === "GENERAL"}
                title="Equipe na meta"
                help="Veja o nível atual, quanto falta para o próximo nível e a premiação de cada pessoa desde o início da meta."
                aside={`${card.sellers.length} ${card.sellers.length === 1 ? "pessoa" : "pessoas"}`}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function prazoTexto(goal: GoalRecord, card: GoalCardView, status: GoalStatus): string {
  if (status === "upcoming") return `Começa em ${shortDate(goal.startsOn)}`;
  if (status === "ended") return "Encerrada";
  return prazoRestante(card.band.daysRemaining);
}

function GoalHero({
  goal,
  card,
  status,
  storeNameValue,
  gerencia,
  today,
}: {
  goal: GoalRecord;
  card: GoalCardView;
  status: GoalStatus;
  storeNameValue?: string;
  gerencia: GoalManagerPrize | null;
  today: string;
}) {
  const { achieved, pct, projectedPct } = card.band;
  const prizeAmount =
    card.sellers.reduce((s, v) => s + v.accruedPrize + v.bonusReached, 0) + (gerencia ? gerencia.prizeAmount + gerencia.bonus : 0);
  const faltam = Math.max(0, goal.target - achieved);
  const liberou = status === "active" && goalUnlockedProjection(goal.startsOn, goal.endsOn, today);
  const stats: { label: string; value: string; cls: string; sub?: string; subCls?: string; help?: string }[] = [
    { label: "Meta da filial", value: brlCent(goal.target), cls: "text-acc" },
    {
      label: "Realizado",
      value: brlCent(achieved),
      cls: "text-ok",
      sub: status === "upcoming" ? undefined : `${num(pct, 1)}% da meta`,
      subCls: progressTextClass(pct),
    },
    {
      label: status === "ended" && faltam > 0 ? "Faltou" : "Faltam",
      value: faltam <= 0 ? "Meta atingida" : brlCent(faltam),
      cls: faltam > 0 ? "text-warn" : "text-ok",
    },
    ...(status === "active"
      ? [
          {
            label: "Projeção",
            value: liberou ? brlCent((goal.target * projectedPct) / 100) : "—",
            cls: !liberou ? "text-t2" : projectedPct >= 100 ? "text-ok" : "text-t0",
            sub: liberou ? `${num(projectedPct, 0)}% da meta` : "Disponível após metade do período",
            help: "Estimativa de faturamento até o fim da meta com base no ritmo de vendas até hoje. Disponível após metade do período.",
          },
        ]
      : []),
    {
      label: status === "ended" ? "Premiação total" : "Premiação até agora",
      value: brlCent(prizeAmount),
      cls: "text-t0",
      help:
        status === "ended"
          ? "Total de premiação e bônus obtidos pela equipe e, quando aplicável, pela gerência no período da meta."
          : "Total de premiação e bônus já garantidos pela equipe e, quando aplicável, pela gerência desde o início da meta.",
    },
    { label: "Prazo", value: prazoTexto(goal, card, status), cls: "text-t0" },
  ];

  return (
    <Card padding="lg" className="mb-5">
      <div className="flex flex-wrap items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-acc-soft text-acc">
          <TargetIcon size={26} />
        </span>
        <div className="min-w-[220px] flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-extrabold text-t0 sm:text-[22px]">{goal.name}</h1>
            <Badge variant={status === "active" ? "success" : status === "upcoming" ? "info" : "neutral"}>{GOAL_STATUS_LABEL[status]}</Badge>
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13.5px] leading-relaxed text-t1">
            {fullDate(goal.startsOn)} a {fullDate(goal.endsOn)}
            {storeNameValue ? ` · ${storeNameValue}` : ""} · {MODO_LABEL[goal.tierMode]}
            <TipHelp label={AJUDA_MODO[goal.tierMode]} />
          </p>
        </div>
      </div>
      <div className={`mt-5 grid grid-cols-2 gap-3.5 border-t border-line pt-4 sm:grid-cols-3 ${stats.length === 6 ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}>
        {stats.map((s) => (
          <div key={s.label} className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-t2">
              {s.label}
              {s.help && <TipHelp label={s.help} />}
            </p>
            <p className={`mt-1 truncate font-mono text-[16px] font-extrabold ${s.cls}`}>{s.value}</p>
            {s.sub && <p className={`mt-0.5 truncate text-[11px] font-semibold ${s.subCls ?? "text-t2"}`}>{s.sub}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Barra de progresso com os niveis + grupos + lista de niveis (formato Milestones) + nivel atual da gerencia. */
function GoalTiersCard({
  goal,
  card,
  status,
  gerencia,
  today,
}: {
  goal: GoalRecord;
  card: GoalCardView;
  status: GoalStatus;
  gerencia: GoalManagerPrize | null;
  today: string;
}) {
  const participants = card.sellers.filter((v) => !v.noGoal);
  let bonusAcum = 0;
  let bonusGerAcum = 0;
  return (
    <Card className={status === "ended" ? "print:hidden" : undefined}>
      <div className="mb-4 flex items-center gap-1.5">
        <CardTitle>Níveis e premiação</CardTitle>
      </div>
      <GlobalGoalBand goal={card.band} tiers={card.tiers} todayIso={today} embedded soBarra />
      {goal.groups.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="mr-1 text-t2">Grupos:</span>
          {goal.groups.map((g) => (
            <span key={g.shiftId} className="rounded-lg bg-bg-inset px-2.5 py-1 text-t1">
              <span className="font-bold text-t0">{shiftName(g.name)}</span> · {num(g.pct, 0)}% ·{" "}
              <span className="font-mono">{brlCent((goal.target * g.pct) / 100)}</span>
            </span>
          ))}
        </div>
      )}
      <div className="my-4 border-t border-line" />
      {goal.tiers.length === 0 ? (
        <p className="text-[12.5px] text-t2">Esta meta não tem níveis de premiação.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {goal.tiers.map((t, i) => {
            bonusAcum += t.bonus;
            const alcancaram = participants.filter((v) => (v.currentLevel ?? 0) >= i + 1).length;
            const feito = alcancaram > 0;
            const partes = [`A partir de ${num(t.minAttainmentPct, 0)}% da meta`];
            if (t.bonus > 0) {
              partes.push(`bônus de ${brlCent(t.bonus)}`);
              if (bonusAcum > t.bonus) partes.push(`bônus acumulado de ${brlCent(bonusAcum)}`);
            }
            if (participants.length > 0) partes.push(`${alcancaram} de ${participants.length} ${participants.length === 1 ? "pessoa" : "pessoas"}`);
            let linhaGerencia: string | null = null;
            if (t.managerPct != null) {
              const bonusGer = t.managerBonus ?? 0;
              bonusGerAcum += bonusGer;
              const ger = [`Gerência: ${num(t.managerPct, 1)}% da venda da filial`];
              if (bonusGer > 0) ger.push(`bônus de ${brlCent(bonusGer)}`);
              if (bonusGerAcum > bonusGer) ger.push(`total de ${brlCent(bonusGerAcum)}`);
              linhaGerencia = ger.join(" · ");
            }
            return (
              <div
                key={`${t.name}-${i}`}
                className="flex items-center gap-3 rounded-xl border bg-bg-inset px-3.5 py-3"
                style={{ borderColor: feito ? "var(--ok-soft)" : "var(--line)" }}
              >
                <span
                  className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 text-white"
                  style={{ background: feito ? "var(--ok)" : "var(--bg-3)", borderColor: feito ? "var(--ok)" : "var(--line-2)" }}
                >
                  {feito && <Icon d={icons.check} size={12} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold text-t0">
                    N{i + 1} · {t.name}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-t2">{partes.join(" · ")}</p>
                  {linhaGerencia && <p className="mt-0.5 text-[11.5px] text-t2">{linhaGerencia}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className={`font-mono text-[13px] font-extrabold ${feito ? "text-ok" : "text-t1"}`}>{num(t.commissionPct, 1)}%</p>
                  <p className="text-[10.5px] text-t2">de premiação</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {gerencia && status === "active" && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-acc-soft px-3.5 py-3 text-[12.5px]">
          <span className="flex items-center gap-1.5 font-bold text-t0">
            Gerência
            <TipHelp label="A gerência sobe de nível pelo faturamento total da filial, incluindo vendas sem vendedor identificado ou realizadas pela própria gerência. A premiação é calculada sobre o faturamento da filial, e os bônus dos níveis alcançados são acumulados." />
          </span>
          <span className={`font-semibold ${gerencia.nivel ? "text-acc" : "text-t2"}`}>
            {gerencia.nivel ? `N${gerencia.nivelNumero} · ${gerencia.nivel}` : "Abaixo do 1º nível"}
          </span>
          <span className="text-t1">
            Premiação até agora: <span className="font-mono font-bold text-t0">{brlCent(gerencia.prizeAmount + gerencia.bonus)}</span>
          </span>
          <span className="text-t1 sm:ml-auto">
            {gerencia.proximo ? (
              <>
                Falta <span className="font-mono font-bold text-warn">{brlCent(gerencia.proximo.falta)}</span> para N{gerencia.proximo.numero} ·{" "}
                {gerencia.proximo.name}
              </>
            ) : (
              <span className="font-semibold text-ok">Último nível</span>
            )}
          </span>
        </div>
      )}
    </Card>
  );
}

/** Cabecalho que so aparece no PDF do fechamento: marca, loja, meta e periodo. */
function PayoutReportHeader({ goal, storeNameValue }: { goal: GoalRecord; storeNameValue?: string }) {
  const agora = new Date();
  const geradoEm = `${agora.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })} às ${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
  return (
    <div className="mb-5 hidden border-b border-line pb-4 print:block">
      <div className="flex items-start justify-between gap-6">
        <WedashBrand size={28} />
        <p className="text-right text-[11px] leading-5 text-t2">Gerado em {geradoEm}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-[12.5px]">
        {storeNameValue && (
          <p>
            <span className="text-t2">Loja: </span>
            <span className="font-bold uppercase text-t0">{storeNameValue}</span>
          </p>
        )}
        <p>
          <span className="text-t2">Meta: </span>
          <span className="font-bold text-t0">{goal.name}</span>
        </p>
        <p>
          <span className="text-t2">Período: </span>
          <span className="font-bold text-t0">
            {fullDate(goal.startsOn)} a {fullDate(goal.endsOn)}
          </span>
        </p>
      </div>
    </div>
  );
}

type PayoutRow = {
  key: string;
  name: string;
  sub: string | null;
  nivel: string | null;
  revenue: number;
  pct: number;
  prizeAmount: number;
  bonus: number;
  total: number;
};

/** Meta encerrada: quanto cada pessoa e a gerencia ganharam (premiacao do nivel + bonus somados). */
function GoalPayoutCard({
  goal,
  card,
  gerencia,
  today,
  onExport,
}: {
  goal: GoalRecord;
  card: GoalCardView;
  gerencia: GoalManagerPrize | null;
  today: string;
  onExport: () => void;
}) {
  const fimMais1 = isoToDate(goal.endsOn);
  fimMais1.setDate(fimMais1.getDate() + 1);
  const emFechamento = today <= dateToIso(fimMais1);

  const team: PayoutRow[] = card.sellers
    .filter((v) => !v.noGoal)
    .map((v) => ({
      key: v.employeeId || v.name,
      name: v.name,
      sub: goal.groups.length > 0 ? v.group : null,
      nivel: v.currentLevel ? `N${v.currentLevel} · ${v.currentTierName}` : null,
      revenue: v.revenueAmount,
      pct: v.commissionPct,
      prizeAmount: v.accruedPrize,
      bonus: v.bonusReached,
      total: v.accruedPrize + v.bonusReached,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "pt-BR"));
  const linhaGerencia: PayoutRow | null = gerencia
    ? {
        key: "gerencia",
        name: "GERÊNCIA",
        sub: "Faturamento total da filial",
        nivel: gerencia.nivelNumero ? `N${gerencia.nivelNumero} · ${gerencia.nivel}` : null,
        revenue: card.band.achieved,
        pct: gerencia.pct,
        prizeAmount: gerencia.prizeAmount,
        bonus: gerencia.bonus,
        total: gerencia.prizeAmount + gerencia.bonus,
      }
    : null;
  const teamTotal = team.reduce((s, r) => s + r.total, 0);
  const totalGerencia = linhaGerencia?.total ?? 0;
  const linhas = linhaGerencia ? [...team, linhaGerencia] : team;
  const soma = (k: "prizeAmount" | "bonus" | "total") => linhas.reduce((s, r) => s + r[k], 0);

  const summary = [
    { label: "Equipe", value: teamTotal },
    ...(linhaGerencia ? [{ label: "Gerência", value: totalGerencia }] : []),
    { label: "Total ganho", value: teamTotal + totalGerencia, destaque: true },
  ];

  return (
    <Card className="mb-5 min-w-0 print:break-inside-avoid">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Fechamento da premiação</CardTitle>
            {emFechamento && (
              <Tooltip
                label={`O último dia da meta será fechado na madrugada de ${shortDate(dateToIso(fimMais1))}. Vendas incluídas ou canceladas até lá ainda podem alterar os valores.`}
              >
                <span className="inline-flex cursor-help">
                  <Badge variant="warning">Fechamento em andamento</Badge>
                </span>
              </Tooltip>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-t2">
            {linhaGerencia ? "Veja a premiação final de cada pessoa e da gerência." : "Veja a premiação final de cada pessoa."}
          </p>
        </div>
        <Button variant="secondary" size="sm" className="print:hidden" onClick={onExport}>
          Exportar
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3.5 sm:grid-cols-3">
        {summary.map((r) => (
          <div key={r.label} className="rounded-xl bg-bg-inset px-3.5 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-t2">{r.label}</p>
            <p className={`mt-1 font-mono text-[16px] font-extrabold ${r.destaque ? "text-ok" : "text-t0"}`}>{brlCent(r.value)}</p>
          </div>
        ))}
      </div>

      {linhas.length === 0 ? (
        <EmptyBlock icon="👤" title="Nenhuma pessoa na meta" description="Nenhuma pessoa da equipe participa desta meta." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]" style={{ minWidth: 680 }}>
            <thead>
              <tr className="border-b border-line text-[11px] font-bold uppercase tracking-wide text-t2">
                <th className="pb-3 pr-3 text-left">Nome</th>
                <th className="pb-3 pr-3 text-left">Nível</th>
                <th className="pb-3 pr-3 text-right">Faturamento</th>
                <th className="pb-3 pr-3 text-right">Premiação</th>
                <th className="pb-3 pr-3 text-right">Bônus</th>
                <th className="pb-3 text-right">Total ganho</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((r) => (
                <tr key={r.key} className={`border-b border-line ${r.key === "gerencia" ? "bg-bg-inset" : ""}`}>
                  <td className="py-2.5 pr-3">
                    <p className="font-bold text-t0">{r.name}</p>
                    {r.sub && <p className="text-[11px] text-t2">{r.sub}</p>}
                  </td>
                  <td className={`py-2.5 pr-3 font-semibold ${r.nivel ? "text-acc" : "text-t2"}`}>{r.nivel ?? "Abaixo do 1º nível"}</td>
                  <td className="py-2.5 pr-3 text-right font-mono font-bold text-t1">{brlCent(r.revenue)}</td>
                  <td className="py-2.5 pr-3 text-right">
                    <p className="font-mono font-bold text-t0">{r.prizeAmount > 0 ? brlCent(r.prizeAmount) : "—"}</p>
                    {r.pct > 0 && <p className="text-[11px] text-t2">{num(r.pct, 1)}%</p>}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-mono font-bold text-t0">{r.bonus > 0 ? brlCent(r.bonus) : "—"}</td>
                  <td className={`py-2.5 text-right font-mono font-extrabold ${r.total > 0 ? "text-ok" : "text-t2"}`}>{brlCent(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-t0">
                <td className="pt-3 pr-3 font-extrabold" colSpan={3}>
                  Total
                </td>
                <td className="pt-3 pr-3 text-right font-mono font-extrabold">{brlCent(soma("prizeAmount"))}</td>
                <td className="pt-3 pr-3 text-right font-mono font-extrabold">{brlCent(soma("bonus"))}</td>
                <td className="pt-3 text-right font-mono font-extrabold text-ok">{brlCent(soma("total"))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {goal.tierMode === "GROUP" && team.length > 0 && (
        <p className="mt-3 text-[11.5px] text-t2">
          No modo Grupo, a premiação do grupo é dividida igualmente entre as pessoas. O faturamento exibido continua sendo o de cada pessoa.
        </p>
      )}
      {goal.tierMode === "GENERAL" && team.length > 0 && (
        <p className="mt-3 text-[11.5px] text-t2">
          No modo Geral, o faturamento de cada pessoa é a parte igual da venda da filial. A premiação desse total é dividida igualmente.
        </p>
      )}
    </Card>
  );
}
