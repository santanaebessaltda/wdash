import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import { brlCent, dataCompleta, dataCurta, deIso, num, paraIso, shiftName } from "@/lib/format";
import { exportPdf } from "@/lib/printMode";
import { useMinSkeleton } from "@/lib/useMinSkeleton";
import { EmptyBlock } from "@/pages/dashboard/EmptyBlock";
import { SALES_SYNCED_EVENT } from "@/pages/dashboard/useForceRefresh";
import { useReturnWhenStoreChanges } from "@/pages/dashboard/useScope";
import { TargetIcon } from "@/pages/dashboards/icons";
import { SellersCard, GoalProgressBar, goalShowsProjection } from "@/pages/team/blocks";
import { Icon, icons } from "@/pages/users/Icons";
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
};

/** Gestao > Metas > detalhe  -  resumo, niveis com o progresso e equipe; meta encerrada = fechamento da premiacao. */
export default function GoalDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const session = useActiveSession();
  const today = calendarTodayIso();
  const [data, setData] = useState<Loaded | null>(null);
  const [reload, setReload] = useState(0);
  const [duplicarAberto, setDuplicarAberto] = useState(false);
  const hasOtherStores = storesForSession(session.stores).length > 1;
  useReturnWhenStoreChanges(data?.goal?.storeId, paths.goals);

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
  const loja = useMemo(() => (goal ? storesForSession(session.stores).find((s) => s.id === goal.storeId) : undefined), [goal, session.stores]);

  const card = useMemo(() => {
    if (!data?.goal) return null;
    return buildGoalCardView({
      goal: data.goal,
      lojaNome: loja?.fantasia ?? "Loja",
      dayAggs: data.dayAggs,
      sellerDayAggs: data.sellerAggs,
      team: data.team,
      today,
    });
  }, [data, loja, today]);

  const status = goal ? goalStatus(goal, today) : null;
  const gerencia = goal && card ? goalManagerPrize(goal, card.faixa.realizado) : null;

  return (
    <div>
      {goal && card && status === "ended" && <PayoutReportHeader goal={goal} lojaNome={loja?.fantasia} />}
      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <Button variant="secondary" size="sm" icon={<Icon d={icons.arrowLeft} size={14} />} onClick={() => navigate(paths.goals)}>
          Voltar
        </Button>
        <Breadcrumbs items={[{ label: "Gestão" }, { label: "Metas", to: paths.goals }, { label: goal?.name ?? "Detalhe" }]} />
        {goal && !showSkeleton && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDuplicarAberto(true)}>
              Duplicar meta
            </Button>
            <Button size="sm" onClick={() => navigate(paths.goalEdit(goal.id))}>
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
            description="A meta pode ter sido excluída ou não pertencer às suas lojas."
            action={
              <Button size="sm" variant="outline" onClick={() => navigate(paths.goals)}>
                Ver metas
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <GoalHero goal={goal} card={card} status={status} lojaNome={loja?.fantasia} gerencia={gerencia} today={today} />

          {status === "ended" ? (
            <>
              <GoalPayoutCard
                goal={goal}
                card={card}
                gerencia={gerencia}
                today={today}
                onExport={() => exportPdf(["Fechamento da meta", loja?.fantasia ?? "", goal.name, `${dataCompleta(goal.startsOn)} a ${dataCompleta(goal.endsOn)}`])}
              />
              <GoalTiersCard goal={goal} card={card} status={status} gerencia={gerencia} today={today} />
            </>
          ) : (
            <div className="flex flex-col gap-5">
              <GoalTiersCard goal={goal} card={card} status={status} gerencia={gerencia} today={today} />
              <SellersCard
                estado={card.vendedoras.length > 0 ? "disponivel" : "sem_dados"}
                lista={card.vendedoras}
                metaAtiva
                grupo={goal.tierMode === "GROUP"}
                title="Equipe na meta"
                help="Veja o nível atual, quanto falta para o próximo nível e a premiação de cada pessoa desde o início da meta."
                aside={`${card.vendedoras.length} ${card.vendedoras.length === 1 ? "pessoa" : "pessoas"}`}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function prazoTexto(goal: GoalRecord, card: GoalCardView, status: GoalStatus): string {
  if (status === "upcoming") return `Começa em ${dataCurta(goal.startsOn)}`;
  if (status === "ended") return "Encerrada";
  return prazoRestante(card.faixa.diasRestantes);
}

function GoalHero({
  goal,
  card,
  status,
  lojaNome,
  gerencia,
  today,
}: {
  goal: GoalRecord;
  card: GoalCardView;
  status: GoalStatus;
  lojaNome?: string;
  gerencia: GoalManagerPrize | null;
  today: string;
}) {
  const { realizado, pct, projetadoPct } = card.faixa;
  const premiacao =
    card.vendedoras.reduce((s, v) => s + v.premiacaoAcumulada + v.bonusAlcancado, 0) + (gerencia ? gerencia.premiacao + gerencia.bonus : 0);
  const faltam = Math.max(0, goal.target - realizado);
  const liberou = status === "active" && goalShowsProjection(goal.startsOn, goal.endsOn, today);
  const stats: { label: string; value: string; cls: string; sub?: string; subCls?: string; help?: string }[] = [
    { label: "Meta da loja", value: brlCent(goal.target), cls: "text-acc" },
    {
      label: "Realizado",
      value: brlCent(realizado),
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
            value: liberou ? brlCent((goal.target * projetadoPct) / 100) : "—",
            cls: !liberou ? "text-t2" : projetadoPct >= 100 ? "text-ok" : "text-t0",
            sub: liberou ? `${num(projetadoPct, 0)}% da meta` : "Disponível após metade do período",
            help: "Estimativa de faturamento até o fim da meta com base no ritmo de vendas até hoje. Disponível após metade do período.",
          },
        ]
      : []),
    {
      label: status === "ended" ? "Premiação total" : "Premiação até agora",
      value: brlCent(premiacao),
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
            {dataCompleta(goal.startsOn)} a {dataCompleta(goal.endsOn)}
            {lojaNome ? ` · ${lojaNome}` : ""} · {goal.tierMode === "INDIVIDUAL" ? "Premiação individual" : "Premiação por grupo"}
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
  const participantes = card.vendedoras.filter((v) => !v.semMeta);
  let bonusAcum = 0;
  let bonusGerAcum = 0;
  return (
    <Card className={status === "ended" ? "print:hidden" : undefined}>
      <div className="mb-4 flex items-center gap-1.5">
        <CardTitle>Níveis e premiação</CardTitle>
      </div>
      <GoalProgressBar meta={card.faixa} degraus={card.degraus} hojeIso={today} embedded soBarra />
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
            const alcancaram = participantes.filter((v) => (v.nivelAtual ?? 0) >= i + 1).length;
            const feito = alcancaram > 0;
            const partes = [`A partir de ${num(t.atingimentoMinPct, 0)}% da meta`];
            if (t.bonus > 0) {
              partes.push(`bônus de ${brlCent(t.bonus)}`);
              if (bonusAcum > t.bonus) partes.push(`bônus acumulado de ${brlCent(bonusAcum)}`);
            }
            if (participantes.length > 0) partes.push(`${alcancaram} de ${participantes.length} ${participantes.length === 1 ? "pessoa" : "pessoas"}`);
            let linhaGerencia: string | null = null;
            if (t.gerenciaPct != null) {
              const bonusGer = t.gerenciaBonus ?? 0;
              bonusGerAcum += bonusGer;
              const ger = [`Gerência: ${num(t.gerenciaPct, 1)}% da venda da loja`];
              if (bonusGer > 0) ger.push(`bônus de ${brlCent(bonusGer)}`);
              if (bonusGerAcum > bonusGer) ger.push(`total de ${brlCent(bonusGerAcum)}`);
              linhaGerencia = ger.join(" · ");
            }
            return (
              <div
                key={`${t.nome}-${i}`}
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
                    N{i + 1} · {t.nome}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-t2">{partes.join(" · ")}</p>
                  {linhaGerencia && <p className="mt-0.5 text-[11.5px] text-t2">{linhaGerencia}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className={`font-mono text-[13px] font-extrabold ${feito ? "text-ok" : "text-t1"}`}>{num(t.comissaoPct, 1)}%</p>
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
            <TipHelp label="A gerência sobe de nível pelo faturamento total da loja, incluindo vendas sem vendedor identificado ou realizadas pela própria gerência. A premiação é calculada sobre o faturamento da loja, e os bônus dos níveis alcançados são acumulados." />
          </span>
          <span className={`font-semibold ${gerencia.nivel ? "text-acc" : "text-t2"}`}>
            {gerencia.nivel ? `N${gerencia.nivelNumero} · ${gerencia.nivel}` : "Abaixo do 1º nível"}
          </span>
          <span className="text-t1">
            Premiação até agora: <span className="font-mono font-bold text-t0">{brlCent(gerencia.premiacao + gerencia.bonus)}</span>
          </span>
          <span className="text-t1 sm:ml-auto">
            {gerencia.proximo ? (
              <>
                Falta <span className="font-mono font-bold text-warn">{brlCent(gerencia.proximo.falta)}</span> para N{gerencia.proximo.numero} ·{" "}
                {gerencia.proximo.nome}
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
function PayoutReportHeader({ goal, lojaNome }: { goal: GoalRecord; lojaNome?: string }) {
  const agora = new Date();
  const geradoEm = `${agora.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })} às ${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
  return (
    <div className="mb-5 hidden border-b border-line pb-4 print:block">
      <div className="flex items-start justify-between gap-6">
        <WedashBrand size={28} />
        <p className="text-right text-[11px] leading-5 text-t2">Gerado em {geradoEm}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-[12.5px]">
        {lojaNome && (
          <p>
            <span className="text-t2">Loja: </span>
            <span className="font-bold uppercase text-t0">{lojaNome}</span>
          </p>
        )}
        <p>
          <span className="text-t2">Meta: </span>
          <span className="font-bold text-t0">{goal.name}</span>
        </p>
        <p>
          <span className="text-t2">Período: </span>
          <span className="font-bold text-t0">
            {dataCompleta(goal.startsOn)} a {dataCompleta(goal.endsOn)}
          </span>
        </p>
      </div>
    </div>
  );
}

type PayoutRow = {
  key: string;
  nome: string;
  sub: string | null;
  nivel: string | null;
  faturamento: number;
  pct: number;
  premiacao: number;
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
  const fimMais1 = deIso(goal.endsOn);
  fimMais1.setDate(fimMais1.getDate() + 1);
  const emFechamento = today <= paraIso(fimMais1);

  const equipe: PayoutRow[] = card.vendedoras
    .filter((v) => !v.semMeta)
    .map((v) => ({
      key: v.colaboradorId || v.nome,
      nome: v.nome,
      sub: goal.groups.length > 0 ? v.grupo : null,
      nivel: v.nivelAtual ? `N${v.nivelAtual} · ${v.degrauAtual}` : null,
      faturamento: v.faturamentoValor,
      pct: v.comissaoPct,
      premiacao: v.premiacaoAcumulada,
      bonus: v.bonusAlcancado,
      total: v.premiacaoAcumulada + v.bonusAlcancado,
    }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"));
  const linhaGerencia: PayoutRow | null = gerencia
    ? {
        key: "gerencia",
        nome: "GERÊNCIA",
        sub: "Faturamento total da loja",
        nivel: gerencia.nivelNumero ? `N${gerencia.nivelNumero} · ${gerencia.nivel}` : null,
        faturamento: card.faixa.realizado,
        pct: gerencia.pct,
        premiacao: gerencia.premiacao,
        bonus: gerencia.bonus,
        total: gerencia.premiacao + gerencia.bonus,
      }
    : null;
  const totalEquipe = equipe.reduce((s, r) => s + r.total, 0);
  const totalGerencia = linhaGerencia?.total ?? 0;
  const linhas = linhaGerencia ? [...equipe, linhaGerencia] : equipe;
  const soma = (k: "premiacao" | "bonus" | "total") => linhas.reduce((s, r) => s + r[k], 0);

  const resumo = [
    { label: "Equipe", value: totalEquipe },
    ...(linhaGerencia ? [{ label: "Gerência", value: totalGerencia }] : []),
    { label: "Total ganho", value: totalEquipe + totalGerencia, destaque: true },
  ];

  return (
    <Card className="mb-5 min-w-0 print:break-inside-avoid">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Fechamento da premiação</CardTitle>
            {emFechamento && (
              <Tooltip
                label={`O último dia da meta será fechado na madrugada de ${dataCurta(paraIso(fimMais1))}. Vendas incluídas ou canceladas até lá ainda podem alterar os valores.`}
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
        {resumo.map((r) => (
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
                    <p className="font-bold text-t0">{r.nome}</p>
                    {r.sub && <p className="text-[11px] text-t2">{r.sub}</p>}
                  </td>
                  <td className={`py-2.5 pr-3 font-semibold ${r.nivel ? "text-acc" : "text-t2"}`}>{r.nivel ?? "Abaixo do 1º nível"}</td>
                  <td className="py-2.5 pr-3 text-right font-mono font-bold text-t1">{brlCent(r.faturamento)}</td>
                  <td className="py-2.5 pr-3 text-right">
                    <p className="font-mono font-bold text-t0">{r.premiacao > 0 ? brlCent(r.premiacao) : "—"}</p>
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
                <td className="pt-3 pr-3 text-right font-mono font-extrabold">{brlCent(soma("premiacao"))}</td>
                <td className="pt-3 pr-3 text-right font-mono font-extrabold">{brlCent(soma("bonus"))}</td>
                <td className="pt-3 text-right font-mono font-extrabold text-ok">{brlCent(soma("total"))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {goal.tierMode === "GROUP" && equipe.length > 0 && (
        <p className="mt-3 text-[11.5px] text-t2">
          No modo Grupo, a premiação do grupo é dividida igualmente entre as pessoas. O faturamento exibido continua sendo o de cada pessoa.
        </p>
      )}
    </Card>
  );
}
