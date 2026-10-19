/**
 * Blocos visuais da aba Equipe. A pagina so monta; nada calcula aqui.
 * Reusa os componentes do tema: DataTable, Card, ProgressBar,
 * Badge, Avatar, EmptyState e o padrao BlockState compartilhado.
 */
import type { ReactNode } from "react";
import { Badge, Card, CardTitle, DataTable, EmptyState, ProgressBar, progressColor, progressTextClass, type DataTableColumn } from "@/components/ui";
import { PersonAvatar } from "@/components/wedash/PersonAvatar";
import { Tooltip } from "@/components/ui/Tooltip";
import { brl, brlCent, eachDay, num } from "@/lib/format";
import type { BlockState as BlockStateKind } from "@/data/wedash/dashboard";
import { BlockState } from "@/pages/dashboard/BlockState";
import type { GoalCardView, NetworkGlobalGoal, SellerRow } from "@/data/wedash/teamViews";
import { outsideRankingNote } from "@/data/wedash/goalView";
import { defaultTiers } from "@/data/wedash/goals";
import { TODAY_ISO } from "@/data/wedash/clock";
import { cn } from "@/lib/cn";

const TipHelp = ({ label }: { label: string }) => (
  <Tooltip label={label}>
    <span
      onClick={(e) => e.stopPropagation()}
      className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 transition-colors hover:text-t1"
    >
      ?
    </span>
  </Tooltip>
);

function ClockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function shortStoreName(tradeName: string): string {
  return tradeName.replace(/^Shopping\s+/i, "");
}

/* ------------------------- Tabela de vendedoras ------------------------- */

type LineRank = SellerRow & { position: number };

function SellerCell({ l }: { l: LineRank }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <PersonAvatar name={l.name} employeeId={l.employeeId} storeId={l.storeId} size="sm" />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-bold text-t0">{l.name}</p>
        <p className="truncate text-[11px] text-t2">
          {l.group} · {shortStoreName(l.storeName)}
        </p>
      </div>
    </div>
  );
}

function RevenueCell({ l }: { l: LineRank }) {
  return (
    <div>
      <p className="font-mono text-[12.5px] font-bold text-t0">{l.revenue}</p>
      <p className="text-[11px] text-t2">
        {num(l.salesCount, 0)} {l.salesCount === 1 ? "venda" : "vendas"}
      </p>
    </div>
  );
}

function IndividualPctCell({ l }: { l: LineRank }) {
  if (l.noGoal) return <span className="text-t2">—</span>;
  const scale = Math.max(...l.ladderMarks.map((m) => m.pct), 100);
  return (
    <div className="w-[88px]">
      <p className="font-mono text-[12.5px] font-bold text-t0">{num(l.attainmentPct, 0)}%</p>
      <div className="mt-1">
        <ProgressBar value={Math.min(100, (l.attainmentPct / scale) * 100)} height={5} />
      </div>
    </div>
  );
}

function LevelCell({ l }: { l: LineRank }) {
  if (l.noGoal || !l.currentTierName || l.currentLevel == null) return <span className="text-t2">—</span>;
  return (
    <Badge variant="neutral">
      N{l.currentLevel} · {l.currentTierName}
    </Badge>
  );
}

function NextCell({ l }: { l: LineRank }) {
  if (l.noGoal) return <span className="text-t2">—</span>;
  if (!l.nextTier) {
    return <p className="text-[12.5px] font-bold text-ok">Último nível</p>;
  }
  return (
    <div>
      <p className="font-mono text-[12.5px] font-bold text-t0">{brl(l.nextTier.gapAmount)}</p>
      <p className="text-[11px] text-t2">para {l.nextTier.name}</p>
    </div>
  );
}

function PrizeCell({ l }: { l: LineRank }) {
  if (l.noGoal) return <span className="text-t2">—</span>;
  const amount = l.accruedPrize + l.bonusReached;
  if (amount <= 0 && l.commissionPct <= 0) return <span className="text-t2">—</span>;
  return (
    <div className="text-right">
      <p className="font-mono text-[12.5px] font-bold text-ok">{brlCent(amount)}</p>
      {l.commissionPct > 0 ? (
        <p className="text-[11px] text-t2">
          {num(l.commissionPct, 1)}%
          {l.bonusReached > 0 ? ` · +${brlCent(l.bonusReached)} de bônus` : ""}
        </p>
      ) : null}
    </div>
  );
}

function SellerMobileCard({ l, activeGoal, closed = false }: { l: LineRank; activeGoal: boolean; closed?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-bg-inset p-3.5">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="w-7 shrink-0 text-[12.5px] font-extrabold text-t2">{l.position}º</span>
        <PersonAvatar name={l.name} employeeId={l.employeeId} storeId={l.storeId} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-t0">{l.name}</p>
          <p className="truncate text-[11.5px] text-t2">
            {l.group} · {shortStoreName(l.storeName)}
          </p>
        </div>
      </div>
      {activeGoal ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-line pt-2.5 text-[12px]">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-t2">Faturamento</p>
            <RevenueCell l={l} />
          </div>
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-t2">% da meta</p>
            <IndividualPctCell l={l} />
          </div>
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-t2">Nível</p>
            <LevelCell l={l} />
          </div>
          {!closed && (
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-t2">Falta</p>
              <NextCell l={l} />
            </div>
          )}
          <div className="col-span-2 text-right">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-t2">Premiação</p>
            <PrizeCell l={l} />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between border-t border-line pt-2.5">
          <span className="text-xs text-t2">
            {num(l.salesCount, 0)} vendas · Ticket {l.ticket}
          </span>
          <span className="font-mono text-[13px] font-extrabold text-t0">{l.revenue}</span>
        </div>
      )}
    </div>
  );
}

export function SellersBlock({
  list,
  activeGoal,
  closed = false,
  group = false,
  geral = false,
}: {
  list: SellerRow[];
  activeGoal: boolean;
  /** Meta encerrada: sem "Falta para o proximo nivel". */
  closed?: boolean;
  /** Meta no modo Grupo: a meta e o % da linha sao do grupo da pessoa. */
  group?: boolean;
  /** Meta no modo Geral: a meta e o % da linha sao da loja. */
  geral?: boolean;
}) {
  const goalHeader = geral ? "Meta da filial" : group ? "Meta do grupo" : "Meta individual";
  const pctHeader = geral ? "Atingimento da filial" : group ? "% da meta do grupo" : "% da meta individual";
  const ranked: LineRank[] = list.map((l, i) => ({ ...l, position: i + 1 }));

  const colunas: DataTableColumn<LineRank>[] = [
    {
      key: "pos",
      header: "#",
      width: "48px",
      sortable: true,
      sortValue: (l) => l.position,
      render: (l) => <span className="text-[12.5px] font-extrabold text-t2">{l.position}º</span>,
    },
    {
      key: "vendedora",
      header: "Nome",
      sortable: true,
      sortValue: (l) => l.name,
      render: (l) => <SellerCell l={l} />,
    },
    {
      key: "revenue",
      header: "Faturamento",
      sortable: true,
      sortValue: (l) => l.revenueAmount,
      render: (l) => <RevenueCell l={l} />,
    },
    ...(activeGoal
      ? ([
          {
            key: "meta",
            header: goalHeader,
            hideBelow: "md",
            sortable: true,
            sortValue: (l: LineRank) => (l.noGoal ? null : l.individualGoalAmount),
            render: (l: LineRank) =>
              l.noGoal ? (
                <span className="text-t2">—</span>
              ) : (
                <span className="inline-flex flex-col items-end">
                  <span className="font-mono text-[12.5px] font-bold text-t0">{brl(l.individualGoalAmount)}</span>
                  {l.proportionalGoal ? <span className="text-[11px] text-t2">{l.eligibleDays} de {l.periodDays} dias</span> : null}
                </span>
              ),
          },
          {
            key: "pctIndiv",
            header: pctHeader,
            sortable: true,
            sortValue: (l: LineRank) => (l.noGoal ? null : l.attainmentPct),
            render: (l: LineRank) => <IndividualPctCell l={l} />,
          },
          {
            key: "pctGeral",
            header: "% da meta da filial",
            hideBelow: "lg",
            sortable: true,
            sortValue: (l: LineRank) => (l.noGoal ? null : l.storeGoalPct),
            render: (l: LineRank) =>
              l.noGoal ? <span className="text-t2">—</span> : <span className="font-mono text-[12.5px] font-bold text-t0">{num(l.storeGoalPct, 1)}%</span>,
          },
          {
            key: "nivel",
            header: "Nível",
            hideBelow: "md",
            sortable: true,
            sortValue: (l: LineRank) => l.currentLevel ?? 0,
            render: (l: LineRank) => <LevelCell l={l} />,
          },
          ...(closed ? [] : [{
            key: "proximo",
            header: "Falta para o próximo nível",
            hideBelow: "lg",
            sortable: true,
            sortValue: (l: LineRank) => l.nextTier?.gapAmount ?? null,
            render: (l: LineRank) => <NextCell l={l} />,
          }]),
          {
            key: "premiacao",
            header: "Premiação",
            align: "right",
            sortable: true,
            sortValue: (l: LineRank) => (l.noGoal ? null : l.accruedPrize + l.bonusReached),
            render: (l: LineRank) => <PrizeCell l={l} />,
          },
        ] as DataTableColumn<LineRank>[])
      : ([
          {
            key: "ticket",
            header: "Ticket médio",
            hideBelow: "sm",
            align: "right",
            sortable: true,
            sortValue: (l: LineRank) => l.ticketAmount,
            render: (l: LineRank) => <span className="font-mono text-[12.5px] text-t1">{l.ticket}</span>,
          },
          {
            key: "pa",
            header: "P.A.",
            hideBelow: "sm",
            align: "right",
            sortable: true,
            sortValue: (l: LineRank) => l.paAmount,
            render: (l: LineRank) => <span className="font-mono text-[12.5px] text-t1">{l.pa}</span>,
          },
        ] as DataTableColumn<LineRank>[])),
  ];

  return (
    <>
      <div className="hidden p-4 md:block">
        <DataTable
          columns={colunas}
          data={ranked}
          rowKey={(l) => `${l.storeId}-${l.employeeId}`}
          paginate="pessoas"
          emptyMessage="Nenhuma pessoa da equipe participa desta meta."
        />
      </div>
      <div className="flex flex-col gap-2.5 p-3.5 md:hidden">
        {ranked.map((l) => (
          <SellerMobileCard key={`${l.storeId}-${l.employeeId}`} l={l} activeGoal={activeGoal} closed={closed} />
        ))}
      </div>
    </>
  );
}

/** Card inteiro da lista (titulo + estados + tabela). */
export function SellersCard({
  status,
  list,
  activeGoal,
  embedded = false,
  title = "Escada de premiação",
  help = "Mostra o nível atual, quanto falta para o próximo e a premiação estimada de cada pessoa da equipe.",
  aside,
  closed = false,
  group = false,
  geral = false,
}: {
  status: BlockStateKind;
  list: SellerRow[] | null;
  activeGoal: boolean;
  closed?: boolean;
  /** Meta no modo Grupo (colunas "Meta do grupo" / "% da meta do grupo"). */
  group?: boolean;
  /** Meta no modo Geral (colunas "Meta da loja" / "Atingimento da loja"). */
  geral?: boolean;
  /** Sem Card externo  -  bloco continuo apos a projecao (GoalCard). */
  embedded?: boolean;
  title?: string;
  help?: string;
  /** Texto a direita do titulo (ex.: "8 pessoas"). */
  aside?: ReactNode;
}) {
  const table =
    list && list.length > 0 ? (
      <div className="max-h-[min(520px,70vh)] overflow-x-auto overflow-y-auto pr-1">
        <SellersBlock list={list} activeGoal={activeGoal} closed={closed} group={group} geral={geral} />
      </div>
    ) : (
      <div className={embedded ? "py-2" : "p-5"}>
        <EmptyState icon="👤" title="Nenhuma pessoa na meta" description="Nenhuma pessoa da equipe participa desta meta." />
      </div>
    );

  if (embedded) {
    return (
      <div className="mt-4 min-w-0">
        <BlockState status={status}>{table}</BlockState>
      </div>
    );
  }

  return (
    <Card padding="none">
      <div className="flex shrink-0 items-center gap-1.5 px-5 py-4">
        <CardTitle>{title}</CardTitle>
        <TipHelp label={help} />
        {aside ? <span className="ml-auto text-xs text-t2">{aside}</span> : null}
      </div>
      <BlockState status={status}>{table}</BlockState>
    </Card>
  );
}

/**
 * Projecao so depois de 50% do periodo da meta (inicio -> fim).
 * Antes disso o ritmo ainda oscila demais para cravar fechamento.
 */
export function goalShowsProjection(start: string, end: string, todayIso: string = TODAY_ISO): boolean {
  if (todayIso < start) return false;
  if (todayIso >= end) return true;
  const total = eachDay(start, end).length;
  if (total <= 0) return false;
  const elapsedOpenDays = eachDay(start, todayIso).length;
  return elapsedOpenDays / total >= 0.5;
}

/**
 * Faixa de progresso da meta (loja ou rede)  -  estilo Progresso Global:
 * R$ realizado/meta  |  %  |  barra com marcos da escada (Meta -> Desafio).
 */
export function GoalProgressBar({
  goal,
  embedded = false,
  hideTitle = false,
  tiers = defaultTiers,
  todayIso,
  soBarra = false,
  individual = false,
}: {
  goal: NetworkGlobalGoal;
  embedded?: boolean;
  /** So a barra com os niveis (os numeros ficam no resumo, como no detalhe da meta). */
  soBarra?: boolean;
  /** Quando o titulo da meta ja esta no GoalCard. */
  hideTitle?: boolean;
  /** Degraus desta meta (default = escada padrao). */
  tiers?: { name: string; minAttainmentPct: number; commissionPct: number }[];
  /** Dia de hoje (dados reais); sem ele usa o relogio da fixture. */
  todayIso?: string;
  /** Individual: o nivel e de cada pessoa. A barra mostra so o faturamento da filial. */
  individual?: boolean;
}) {
  const showsProjection = !soBarra && goalShowsProjection(goal.start, goal.end, todayIso);
  const scaleMax = Math.max(...tiers.map((d) => d.minAttainmentPct), 100);
  const fillPct = Math.min(100, (goal.pct / scaleMax) * 100);
  const colorBarra = progressColor(goal.pct);
  const colorPct = progressTextClass(goal.pct);
  const projectionLabel = `Projeção: ${num(goal.projectedPct, 0)}%`;

  const body = (
    <>
      {!soBarra && (
      <>
      <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-2", hideTitle && "mb-3")}>
        {!hideTitle && (
          <div className="flex min-w-0 items-center gap-1.5">
            <CardTitle>{showsProjection ? "Projeção da meta" : "Progresso da meta"}</CardTitle>
            <TipHelp
              label={
                showsProjection
                  ? "Projeção de atingimento ao final da meta. Aparece depois de metade do período."
                  : "A projeção de fechamento aparece depois que 50% do período da meta já passou — assim o ritmo fica mais confiável."
              }
            />
          </div>
        )}
        <div className={cn("flex flex-wrap items-center gap-1.5", hideTitle ? "w-full justify-between sm:justify-end" : "justify-end")}>
          {showsProjection && (
            <Tooltip label="Projeção de atingimento ao final da meta. Aparece depois de metade do período.">
              <span className="inline-flex cursor-help">
                <Badge variant="accent" className="uppercase">{projectionLabel}</Badge>
              </span>
            </Tooltip>
          )}
          <Badge variant="neutral" className="gap-1 uppercase">
            <ClockIcon />
            {goal.daysRemaining <= 0
              ? "Encerrada"
              : goal.daysRemaining === 1
                ? "Último dia"
                : `${goal.daysRemaining} dias restantes`}
          </Badge>
        </div>
      </div>

      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-[18px] font-extrabold tracking-tight text-t0 sm:text-[20px]">
          <span className="font-mono">{brlCent(goal.achieved)}</span>
          <span className="mx-1.5 text-[14px] font-semibold text-t2">/</span>
          <span className="font-mono text-[14px] font-bold text-t2 sm:text-[15px]">{brlCent(goal.total)}</span>
        </p>
        <p className={`font-mono text-[26px] font-extrabold leading-none sm:text-[28px] ${colorPct}`}>{num(goal.pct, 1)}%</p>
      </div>
      {outsideRankingNote(goal) ? <p className="mt-1 text-[12px] text-t2">{outsideRankingNote(goal)}</p> : null}
      </>
      )}

      {individual ? (
        <div className={cn("flex items-center gap-3", !soBarra && "mt-4")}>
          <div className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: "var(--bg-3)" }}>
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${Math.min(100, Math.max(0, goal.pct))}%`, background: colorBarra }}
            />
          </div>
          {soBarra && (
            <p className={`shrink-0 font-mono text-[13px] font-extrabold leading-none ${colorPct}`}>{num(goal.pct, 1)}%</p>
          )}
        </div>
      ) : (() => {
        const LABEL_MIN_PX = 140;
        const GAP_PX = 10;
        let lowerFrac = 1;
        for (let i = 1; i < tiers.length; i++) {
          const frac = (tiers[i].minAttainmentPct - tiers[i - 1].minAttainmentPct) / scaleMax;
          if (frac > 0 && frac < lowerFrac) lowerFrac = frac;
        }
        // Com N3 a esquerda do tick e N4 a direita da faixa, o vao = frac * W.
        const trackMinW = tiers.length > 1 ? Math.ceil((LABEL_MIN_PX + GAP_PX) / lowerFrac) : 280;

        return (
          <div className={cn("min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x", !soBarra && "mt-4")}>
            <div className="w-full" style={{ minWidth: trackMinW }}>
              <div className="relative h-3 w-full overflow-hidden rounded-full" style={{ background: "var(--bg-3)" }}>
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${fillPct}%`, background: colorBarra }} />
                {tiers.map((d) => {
                  const left = (d.minAttainmentPct / scaleMax) * 100;
                  const atingido = goal.pct >= d.minAttainmentPct;
                  return (
                    <span
                      key={`tick-${d.name}`}
                      className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2"
                      style={{ left: `${left}%`, background: atingido ? "var(--t0)" : "var(--t2)", opacity: atingido ? 0.55 : 0.35 }}
                    />
                  );
                })}
              </div>

              <div className="relative mt-2 h-7 w-full">
                {tiers.map((d, i) => {
                  const left = (d.minAttainmentPct / scaleMax) * 100;
                  const atingido = goal.pct >= d.minAttainmentPct;
                  const isLast = i === tiers.length - 1;
                  const next = tiers[i + 1];
                  const gapPts = next ? next.minAttainmentPct - d.minAttainmentPct : Infinity;
                  // Intervalo apertado: texto termina no tick (nao centra), liberando o vao ate o N4.
                  const anchorDireitaNoTick = !isLast && gapPts <= 15;
                  const shortLabel = d.name.replace(/^Goal\s+/i, "");
                  return (
                    <p
                      key={d.name}
                      className={cn(
                        "absolute top-0 whitespace-nowrap text-[10px] font-bold leading-tight",
                        isLast && "right-0 text-right",
                        anchorDireitaNoTick && "-translate-x-full text-right",
                        !isLast && !anchorDireitaNoTick && "-translate-x-1/2 text-center",
                        atingido ? "text-acc" : "text-t2",
                      )}
                      style={isLast ? undefined : { left: `${left}%` }}
                      title={`N${i + 1} · ${d.name} · ${num(d.commissionPct, 1)}%`}
                    >
                      N{i + 1} · {shortLabel}
                      <span className="font-semibold opacity-75"> ({num(d.commissionPct, 1)}%)</span>
                    </p>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
      {soBarra && outsideRankingNote(goal) ? <p className="mt-1 text-[12px] text-t2">{outsideRankingNote(goal)}</p> : null}
    </>
  );

  if (embedded) return <div className="min-w-0">{body}</div>;
  return <Card className="min-w-0 overflow-hidden">{body}</Card>;
}

/**
 * Card de uma meta ativa: nome + badges + projecao + escada (lista continua).
 * Usado no Ao vivo e na Equipe (embedded dentro de Metas da equipe).
 */
function IconBadge({ children }: { children: ReactNode }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function IndividualTypeIcon() {
  return (
    <IconBadge>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </IconBadge>
  );
}

function GroupTypeIcon() {
  return (
    <IconBadge>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </IconBadge>
  );
}

function StoreIcon() {
  return (
    <IconBadge>
      <path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" />
      <path d="M3 7h18l-1.5 5.5A3 3 0 0 1 16.6 13a3 3 0 0 1-2.9-2 3 3 0 0 1-5.4 0 3 3 0 0 1-2.9 2 3 3 0 0 1-2.9-1.5L3 7Z" />
      <path d="M4 12v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8" />
    </IconBadge>
  );
}

function BrandIcon() {
  return (
    <IconBadge>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </IconBadge>
  );
}

function GroupsIcon() {
  return (
    <IconBadge>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </IconBadge>
  );
}

function SellersIcon() {
  return (
    <IconBadge>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </IconBadge>
  );
}

function LevelsIcon() {
  return (
    <IconBadge>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </IconBadge>
  );
}

export function GoalCard({
  card,
  activeGoal,
  todayIso,
  onOpen,
}: {
  card: GoalCardView;
  activeGoal: boolean;
  todayIso?: string;
  /** Clique no resumo abre o detalhe. A escada não navega. */
  onOpen?: () => void;
}) {
  const kindLabel = card.kind === "individual" ? "Individual" : card.kind === "geral" ? "Geral" : "Grupo";
  const summary = (
    <>
      <CardTitle>{card.name}</CardTitle>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Badge variant="neutral" className="gap-1 uppercase">
          {card.kind === "individual" ? <IndividualTypeIcon /> : <GroupTypeIcon />}
          {kindLabel}
        </Badge>
        <Badge variant="neutral" className="gap-1 uppercase">
          <StoreIcon />
          {card.storeNameValue}
        </Badge>
        {card.brands.map((m) => (
          <Badge key={m} variant="neutral" className="gap-1">
            <BrandIcon />
            {m}
          </Badge>
        ))}
        {card.qtyGroups > 0 ? (
          <Badge variant="neutral" className="gap-1 uppercase">
            <GroupsIcon />
            {card.qtyGroups} {card.qtyGroups === 1 ? "grupo" : "grupos"}
          </Badge>
        ) : null}
        <Badge variant="neutral" className="gap-1 uppercase">
          <SellersIcon />
          {card.qtySellers} na equipe
        </Badge>
        <Badge variant="neutral" className="gap-1 uppercase">
          <LevelsIcon />
          {card.qtyLevels} {card.qtyLevels === 1 ? "nível" : "níveis"}
        </Badge>
      </div>

      <div className="mt-4">
        <GoalProgressBar
          goal={card.band}
          embedded
          hideTitle
          tiers={card.tiers}
          todayIso={todayIso}
          individual={card.kind === "individual"}
        />
      </div>
    </>
  );
  return (
    <Card className={cn("min-w-0 overflow-hidden", onOpen && "transition-colors hover:border-line-2")} padding="lg">
      {onOpen ? (
        <div
          role="link"
          tabIndex={0}
          onClick={onOpen}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen();
            }
          }}
          aria-label={`Ver detalhe da meta ${card.name}`}
          className="cursor-pointer rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acc"
        >
          {summary}
        </div>
      ) : (
        summary
      )}

      <SellersCard
        embedded
        status={card.sellers.length > 0 ? "available" : "noData"}
        list={card.sellers}
        activeGoal={activeGoal}
        group={card.kind === "grupo"}
        geral={card.kind === "geral"}
      />
    </Card>
  );
}
