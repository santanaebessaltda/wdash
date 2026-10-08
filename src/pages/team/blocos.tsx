/**
 * Blocos visuais da aba Equipe. A página só monta; nada calcula aqui.
 * Reusa os componentes do tema: StatCard, DataTable, Card, ProgressBar,
 * Badge, Avatar, EmptyState e o padrão BlockState compartilhado.
 */
import type { ReactNode } from "react";
import { Avatar, Badge, Card, CardTitle, DataTable, EmptyState, ProgressBar, progressColor, progressTextClass, StatCard, type DataTableColumn } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { brl, brlCent, brlK, intervaloDias, num } from "@/lib/format";
import type { BlockState as BlockStateTipo } from "@/data/wedash/dashboard";
import { BlockState } from "@/pages/dashboard/BlockState";
import type { ChallengeView, TeamView, GoalCardView, NetworkGlobalGoal, SellerRow } from "@/data/wedash/teamViews";
import { defaultTiers } from "@/data/wedash/goals";
import { TODAY_ISO } from "@/data/wedash/clock";
import { cn } from "@/lib/cn";
import { ICONS, FlameIcon } from "@/pages/dashboards/icons";

const TipHelp = ({ label }: { label: string }) => (
  <Tooltip label={label}>
    <span className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-t2 transition-colors hover:text-t1">
      ?
    </span>
  </Tooltip>
);

function IconRelogio() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function lojaCurta(fantasia: string): string {
  return fantasia.replace(/^Shopping\s+/i, "");
}

/* ------------------------- KPIs do topo ------------------------- */

const IconFat = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);
const IconVendas = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const IconTicket = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);
const IconPA = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2 2 7l10 5 10-5-10-5Z" />
    <path d="m2 17 10 5 10-5" />
    <path d="m2 12 10 5 10-5" />
  </svg>
);

/** Mesmo padrão visual das demais telas (VG/Fin/Prod): ícone + valor + delta + sub + tooltip — sem sparkline. */
const KPI_COLORS = [
  { iconColor: "var(--acc)", iconBg: "var(--acc-soft)" },
  { iconColor: "var(--ok)", iconBg: "var(--ok-soft)" },
  { iconColor: "var(--info)", iconBg: "rgba(59,130,246,0.12)" },
  { iconColor: "var(--warn)", iconBg: "rgba(245,158,11,0.12)" },
];

export function BlocoKpisEquipe({
  faturamento,
  atendimentos,
  ticket,
  pa,
}: {
  faturamento: TeamView["kpiFaturamento"];
  atendimentos: TeamView["kpiAtendimentos"];
  ticket: TeamView["kpiTicket"];
  pa: TeamView["kpiPA"];
}) {
  const kpis = [
    {
      label: "Faturamento",
      valor: faturamento.valor,
      delta: faturamento.delta,
      sub: faturamento.sub,
      Icon: IconFat,
    },
    {
      label: "Nº de vendas",
      valor: atendimentos.valor,
      delta: atendimentos.delta,
      sub: atendimentos.sub,
      Icon: IconVendas,
    },
    {
      label: "Ticket médio",
      valor: ticket.valor,
      delta: ticket.delta,
      sub: undefined,
      Icon: IconTicket,
    },
    {
      label: "P.A.",
      valor: pa.valor,
      delta: pa.delta,
      sub: pa.sub,
      tooltip: "Quantidade média de itens vendidos por venda.",
      Icon: IconPA,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {kpis.map((kpi, i) => {
        const c = KPI_COLORS[i];
        const Icon = kpi.Icon;
        return (
          <StatCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.valor}
            icon={<Icon />}
            iconColor={c.iconColor}
            iconBg={c.iconBg}
            delta={kpi.delta}
            sub={kpi.sub}
            tooltip={"tooltip" in kpi ? kpi.tooltip : undefined}
          />
        );
      })}
    </div>
  );
}

/* ------------------------- Tabela de vendedoras ------------------------- */

type LinhaRank = SellerRow & { posicao: number };

function CelulaVendedora({ l }: { l: LinhaRank }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar name={l.nome} size="sm" />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-bold text-t0">{l.nome}</p>
        <p className="truncate text-[11px] text-t2">
          {l.grupo} · {lojaCurta(l.filialNome)}
        </p>
      </div>
    </div>
  );
}

function CelulaFaturamento({ l }: { l: LinhaRank }) {
  return (
    <div>
      <p className="font-mono text-[12.5px] font-bold text-t0">{l.faturamento}</p>
      <p className="text-[11px] text-t2">
        {num(l.atendimentos, 0)} {l.atendimentos === 1 ? "venda" : "vendas"}
      </p>
    </div>
  );
}

function CelulaPctIndividual({ l }: { l: LinhaRank }) {
  if (l.semMeta) return <span className="text-t2">—</span>;
  const escala = Math.max(...l.marcosEscada.map((m) => m.pct), 100);
  return (
    <div className="w-[88px]">
      <p className="font-mono text-[12.5px] font-bold text-t0">{num(l.atingimentoPct, 0)}%</p>
      <div className="mt-1">
        <ProgressBar value={Math.min(100, (l.atingimentoPct / escala) * 100)} height={5} />
      </div>
    </div>
  );
}

function CelulaNivel({ l }: { l: LinhaRank }) {
  if (l.semMeta || !l.degrauAtual || l.nivelAtual == null) return <span className="text-t2">—</span>;
  const pctRef = l.atingimentoProjetadoPct ?? l.atingimentoPct;
  return (
    <Badge variant={pctRef >= 100 ? "success" : "warning"}>
      N{l.nivelAtual} · {l.degrauAtual}
    </Badge>
  );
}

function CelulaProximo({ l }: { l: LinhaRank }) {
  if (l.semMeta) return <span className="text-t2">—</span>;
  if (!l.proximoDegrau) {
    return <p className="text-[12.5px] font-bold text-ok">Último nível</p>;
  }
  return (
    <div>
      <p className="font-mono text-[12.5px] font-bold text-t0">{brl(l.proximoDegrau.faltaValor)}</p>
      <p className="text-[11px] text-t2">para {l.proximoDegrau.nome}</p>
    </div>
  );
}

function CelulaPremiacao({ l }: { l: LinhaRank }) {
  if (l.semMeta) return <span className="text-t2">—</span>;
  const valor = l.premiacaoAcumulada + l.bonusAlcancado;
  if (valor <= 0 && l.comissaoPct <= 0) return <span className="text-t2">—</span>;
  return (
    <div className="text-right">
      <p className="font-mono text-[12.5px] font-bold text-ok">{brlCent(valor)}</p>
      {l.comissaoPct > 0 ? (
        <p className="text-[11px] text-t2">
          {num(l.comissaoPct, 1)}%
          {l.bonusAlcancado > 0 ? ` · +${brlCent(l.bonusAlcancado)} de bônus` : ""}
        </p>
      ) : null}
    </div>
  );
}

function CardMobileVendedora({ l, metaAtiva, encerrada = false }: { l: LinhaRank; metaAtiva: boolean; encerrada?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-bg-inset p-3.5">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="w-7 shrink-0 text-[12.5px] font-extrabold text-t2">{l.posicao}º</span>
        <Avatar name={l.nome} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-t0">{l.nome}</p>
          <p className="truncate text-[11.5px] text-t2">
            {l.grupo} · {lojaCurta(l.filialNome)}
          </p>
        </div>
      </div>
      {metaAtiva ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-line pt-2.5 text-[12px]">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-t2">Faturamento</p>
            <CelulaFaturamento l={l} />
          </div>
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-t2">% da meta</p>
            <CelulaPctIndividual l={l} />
          </div>
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-t2">Nível</p>
            <CelulaNivel l={l} />
          </div>
          {!encerrada && (
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-t2">Falta</p>
              <CelulaProximo l={l} />
            </div>
          )}
          <div className="col-span-2 text-right">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-t2">Premiação</p>
            <CelulaPremiacao l={l} />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between border-t border-line pt-2.5">
          <span className="text-xs text-t2">
            {num(l.atendimentos, 0)} vendas · Ticket {l.ticket}
          </span>
          <span className="font-mono text-[13px] font-extrabold text-t0">{l.faturamento}</span>
        </div>
      )}
    </div>
  );
}

export function BlocoVendedoras({
  lista,
  metaAtiva,
  encerrada = false,
  grupo = false,
  geral = false,
}: {
  lista: SellerRow[];
  metaAtiva: boolean;
  /** Meta encerrada: sem "Falta para o próximo nível". */
  encerrada?: boolean;
  /** Meta no modo Grupo: a meta e o % da linha são do grupo da pessoa. */
  grupo?: boolean;
  /** Meta no modo Geral: a meta e o % da linha são da loja. */
  geral?: boolean;
}) {
  const metaHeader = geral ? "Meta da loja" : grupo ? "Meta do grupo" : "Meta individual";
  const pctHeader = geral ? "Atingimento da loja" : grupo ? "% da meta do grupo" : "% da meta individual";
  const ranked: LinhaRank[] = lista.map((l, i) => ({ ...l, posicao: i + 1 }));

  const colunas: DataTableColumn<LinhaRank>[] = [
    {
      key: "pos",
      header: "#",
      width: "48px",
      sortable: true,
      sortValue: (l) => l.posicao,
      render: (l) => <span className="text-[12.5px] font-extrabold text-t2">{l.posicao}º</span>,
    },
    {
      key: "vendedora",
      header: "Nome",
      sortable: true,
      sortValue: (l) => l.nome,
      render: (l) => <CelulaVendedora l={l} />,
    },
    {
      key: "faturamento",
      header: "Faturamento",
      sortable: true,
      sortValue: (l) => l.faturamentoValor,
      render: (l) => <CelulaFaturamento l={l} />,
    },
    ...(metaAtiva
      ? ([
          {
            key: "meta",
            header: metaHeader,
            hideBelow: "md",
            sortable: true,
            sortValue: (l: LinhaRank) => (l.semMeta ? null : l.metaIndividualValor),
            render: (l: LinhaRank) =>
              l.semMeta ? <span className="text-t2">—</span> : <span className="font-mono text-[12.5px] font-bold text-t0">{brl(l.metaIndividualValor)}</span>,
          },
          {
            key: "pctIndiv",
            header: pctHeader,
            sortable: true,
            sortValue: (l: LinhaRank) => (l.semMeta ? null : l.atingimentoPct),
            render: (l: LinhaRank) => <CelulaPctIndividual l={l} />,
          },
          {
            key: "pctGeral",
            header: "% da meta da loja",
            hideBelow: "lg",
            sortable: true,
            sortValue: (l: LinhaRank) => (l.semMeta ? null : l.pctMetaGeral),
            render: (l: LinhaRank) =>
              l.semMeta ? <span className="text-t2">—</span> : <span className="font-mono text-[12.5px] font-bold text-t0">{num(l.pctMetaGeral, 1)}%</span>,
          },
          {
            key: "nivel",
            header: "Nível",
            hideBelow: "md",
            sortable: true,
            sortValue: (l: LinhaRank) => l.nivelAtual ?? 0,
            render: (l: LinhaRank) => <CelulaNivel l={l} />,
          },
          ...(encerrada ? [] : [{
            key: "proximo",
            header: "Falta para o próximo nível",
            hideBelow: "lg",
            sortable: true,
            sortValue: (l: LinhaRank) => l.proximoDegrau?.faltaValor ?? null,
            render: (l: LinhaRank) => <CelulaProximo l={l} />,
          }]),
          {
            key: "premiacao",
            header: "Premiação",
            align: "right",
            sortable: true,
            sortValue: (l: LinhaRank) => (l.semMeta ? null : l.premiacaoAcumulada + l.bonusAlcancado),
            render: (l: LinhaRank) => <CelulaPremiacao l={l} />,
          },
        ] as DataTableColumn<LinhaRank>[])
      : ([
          {
            key: "ticket",
            header: "Ticket médio",
            hideBelow: "sm",
            align: "right",
            sortable: true,
            sortValue: (l: LinhaRank) => l.ticketValor,
            render: (l: LinhaRank) => <span className="font-mono text-[12.5px] text-t1">{l.ticket}</span>,
          },
          {
            key: "pa",
            header: "P.A.",
            hideBelow: "sm",
            align: "right",
            sortable: true,
            sortValue: (l: LinhaRank) => l.paValor,
            render: (l: LinhaRank) => <span className="font-mono text-[12.5px] text-t1">{l.pa}</span>,
          },
        ] as DataTableColumn<LinhaRank>[])),
  ];

  return (
    <>
      <div className="hidden p-4 md:block">
        <DataTable
          columns={colunas}
          data={ranked}
          rowKey={(l) => `${l.filialId}-${l.colaboradorId}`}
          paginate="pessoas"
          emptyMessage="Nenhuma pessoa da equipe participa desta meta."
        />
      </div>
      <div className="flex flex-col gap-2.5 p-3.5 md:hidden">
        {ranked.map((l) => (
          <CardMobileVendedora key={`${l.filialId}-${l.colaboradorId}`} l={l} metaAtiva={metaAtiva} encerrada={encerrada} />
        ))}
      </div>
    </>
  );
}

/** Card inteiro da lista (título + estados + tabela). */
export function CardVendedoras({
  estado,
  lista,
  metaAtiva,
  embedded = false,
  title = "Escada de premiação",
  help = "Mostra o nível atual, quanto falta para o próximo e a premiação estimada de cada pessoa da equipe.",
  aside,
  encerrada = false,
  grupo = false,
  geral = false,
}: {
  estado: BlockStateTipo;
  lista: SellerRow[] | null;
  metaAtiva: boolean;
  encerrada?: boolean;
  /** Meta no modo Grupo (colunas "Meta do grupo" / "% da meta do grupo"). */
  grupo?: boolean;
  /** Meta no modo Geral (colunas "Meta da loja" / "Atingimento da loja"). */
  geral?: boolean;
  /** Sem Card externo — bloco contínuo após a projeção (CardMeta). */
  embedded?: boolean;
  title?: string;
  help?: string;
  /** Texto à direita do título (ex.: "8 pessoas"). */
  aside?: ReactNode;
}) {
  const tabela =
    lista && lista.length > 0 ? (
      <div className="max-h-[min(520px,70vh)] overflow-x-auto overflow-y-auto pr-1">
        <BlocoVendedoras lista={lista} metaAtiva={metaAtiva} encerrada={encerrada} grupo={grupo} geral={geral} />
      </div>
    ) : (
      <div className={embedded ? "py-2" : "p-5"}>
        <EmptyState icon="👤" title="Nenhuma pessoa na meta" description="Nenhuma pessoa da equipe participa desta meta." />
      </div>
    );

  if (embedded) {
    return (
      <div className="mt-4 min-w-0">
        <BlockState estado={estado}>{tabela}</BlockState>
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
      <BlockState estado={estado}>{tabela}</BlockState>
    </Card>
  );
}

/**
 * Projeção só depois de 50% do período da meta (inicio→fim).
 * Antes disso o ritmo ainda oscila demais para cravar fechamento.
 */
export function metaLiberouProjecao(inicio: string, fim: string, hojeIso: string = TODAY_ISO): boolean {
  if (hojeIso < inicio) return false;
  if (hojeIso >= fim) return true;
  const total = intervaloDias(inicio, fim).length;
  if (total <= 0) return false;
  const decorridos = intervaloDias(inicio, hojeIso).length;
  return decorridos / total >= 0.5;
}

/**
 * Faixa de progresso da meta (loja ou rede) — estilo Progresso Global:
 * R$ realizado/meta · % · barra com marcos da escada (Meta→Desafio).
 */
export function FaixaMetaGlobal({
  meta,
  embedded = false,
  hideTitle = false,
  degraus = defaultTiers,
  hojeIso,
  soBarra = false,
}: {
  meta: NetworkGlobalGoal;
  embedded?: boolean;
  /** Só a barra com os níveis (os números ficam no resumo, como no detalhe da meta). */
  soBarra?: boolean;
  /** Quando o título da meta já está no CardMeta. */
  hideTitle?: boolean;
  /** Degraus desta meta (default = escada padrão). */
  degraus?: { nome: string; atingimentoMinPct: number; comissaoPct: number }[];
  /** Dia de hoje (dados reais); sem ele usa o relógio da fixture. */
  hojeIso?: string;
}) {
  const mostraProjecao = !soBarra && metaLiberouProjecao(meta.inicio, meta.fim, hojeIso);
  const fecha = meta.projetadoPct >= 100;
  const escalaMax = Math.max(...degraus.map((d) => d.atingimentoMinPct), 100);
  const fillPct = Math.min(100, (meta.pct / escalaMax) * 100);
  const corBarra = progressColor(meta.pct);
  const corPct = progressTextClass(meta.pct);
  const rotuloProjecao = `Projeção: ${num(meta.projetadoPct, 0)}%`;

  const body = (
    <>
      {!soBarra && (
      <>
      <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-2", hideTitle && "mb-3")}>
        {!hideTitle && (
          <div className="flex min-w-0 items-center gap-1.5">
            <CardTitle>{mostraProjecao ? "Projeção da meta" : "Progresso da meta"}</CardTitle>
            <TipHelp
              label={
                mostraProjecao
                  ? "Projeção de atingimento ao final da meta. Aparece depois de metade do período."
                  : "A projeção de fechamento aparece depois que 50% do período da meta já passou — assim o ritmo fica mais confiável."
              }
            />
          </div>
        )}
        <div className={cn("flex flex-wrap items-center gap-1.5", hideTitle ? "w-full justify-between sm:justify-end" : "justify-end")}>
          {mostraProjecao && (
            <Tooltip label="Projeção de atingimento ao final da meta. Aparece depois de metade do período.">
              <span className="inline-flex cursor-help">
                <Badge variant={fecha ? "success" : "warning"}>{rotuloProjecao}</Badge>
              </span>
            </Tooltip>
          )}
          <Badge variant="neutral" className="gap-1">
            <IconRelogio />
            {meta.diasRestantes <= 0
              ? "Encerrada"
              : meta.diasRestantes === 1
                ? "Último dia"
                : `${meta.diasRestantes} dias restantes`}
          </Badge>
        </div>
      </div>

      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-[18px] font-extrabold tracking-tight text-t0 sm:text-[20px]">
          <span className="font-mono">{brl(meta.realizado)}</span>
          <span className="mx-1.5 text-[14px] font-semibold text-t2">/</span>
          <span className="font-mono text-[14px] font-bold text-t2 sm:text-[15px]">{brl(meta.total)}</span>
        </p>
        <p className={`font-mono text-[26px] font-extrabold leading-none sm:text-[28px] ${corPct}`}>{num(meta.pct, 1)}%</p>
      </div>
      {meta.foraDaEquipe ? (
        <p className="mt-1 text-[12px] text-t2">
          Inclui <span className="font-mono">{brl(meta.foraDaEquipe)}</span> de vendas sem vendedor identificado ou realizadas pela gerência, fora do ranking.
        </p>
      ) : null}
      </>
      )}

      {/*
        Rótulos na mesma linha, alinhados à proporção da barra (mesmo % dos ticks).
        Barra sem padding (alinha com o %). Quando dois degraus ficam perto
        (ex.: Hiper→Desafio), o penúltimo ancora à direita do tick e o último
        à direita da faixa; a largura mínima garante espaço em px entre eles.
      */}
      {(() => {
        const LABEL_MIN_PX = 140;
        const GAP_PX = 10;
        let menorFrac = 1;
        for (let i = 1; i < degraus.length; i++) {
          const frac = (degraus[i].atingimentoMinPct - degraus[i - 1].atingimentoMinPct) / escalaMax;
          if (frac > 0 && frac < menorFrac) menorFrac = frac;
        }
        // Com N3 à esquerda do tick e N4 à direita da faixa, o vão = frac * W.
        const trackMinW = degraus.length > 1 ? Math.ceil((LABEL_MIN_PX + GAP_PX) / menorFrac) : 280;

        return (
          <div className={cn("min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x", !soBarra && "mt-4")}>
            <div className="w-full" style={{ minWidth: trackMinW }}>
              <div className="relative h-3 w-full overflow-hidden rounded-full" style={{ background: "var(--bg-3)" }}>
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${fillPct}%`, background: corBarra }} />
                {degraus.map((d) => {
                  const left = (d.atingimentoMinPct / escalaMax) * 100;
                  const atingido = meta.pct >= d.atingimentoMinPct;
                  return (
                    <span
                      key={`tick-${d.nome}`}
                      className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2"
                      style={{ left: `${left}%`, background: atingido ? "var(--t0)" : "var(--t2)", opacity: atingido ? 0.55 : 0.35 }}
                    />
                  );
                })}
              </div>

              <div className="relative mt-2 h-7 w-full">
                {degraus.map((d, i) => {
                  const left = (d.atingimentoMinPct / escalaMax) * 100;
                  const atingido = meta.pct >= d.atingimentoMinPct;
                  const isLast = i === degraus.length - 1;
                  const proximo = degraus[i + 1];
                  const gapPts = proximo ? proximo.atingimentoMinPct - d.atingimentoMinPct : Infinity;
                  // Intervalo apertado: texto termina no tick (não centra), liberando o vão até o N4.
                  const ancoraDireitaNoTick = !isLast && gapPts <= 15;
                  const rotuloCurto = d.nome.replace(/^Goal\s+/i, "");
                  return (
                    <p
                      key={d.nome}
                      className={cn(
                        "absolute top-0 whitespace-nowrap text-[10px] font-bold leading-tight",
                        isLast && "right-0 text-right",
                        ancoraDireitaNoTick && "-translate-x-full text-right",
                        !isLast && !ancoraDireitaNoTick && "-translate-x-1/2 text-center",
                        atingido ? "text-acc" : "text-t2",
                      )}
                      style={isLast ? undefined : { left: `${left}%` }}
                      title={`N${i + 1} · ${d.nome} · ${num(d.comissaoPct, 1)}%`}
                    >
                      N{i + 1} · {rotuloCurto}
                      <span className="font-semibold opacity-75"> ({num(d.comissaoPct, 1)}%)</span>
                    </p>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
      {soBarra && meta.foraDaEquipe ? (
        <p className="mt-1 text-[12px] text-t2">
          Inclui <span className="font-mono">{brl(meta.foraDaEquipe)}</span> de vendas sem vendedor identificado ou realizadas pela gerência, fora do ranking.
        </p>
      ) : null}
    </>
  );

  if (embedded) return <div className="min-w-0">{body}</div>;
  return <Card className="min-w-0 overflow-hidden">{body}</Card>;
}

/**
 * Card de uma meta ativa: nome + badges + projeção + escada (lista contínua).
 * Usado no Ao vivo e na Equipe (embedded dentro de Metas da equipe).
 */
function IconBadge({ children }: { children: ReactNode }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function IconTipoIndividual() {
  return (
    <IconBadge>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </IconBadge>
  );
}

function IconTipoGrupo() {
  return (
    <IconBadge>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </IconBadge>
  );
}

function IconLoja() {
  return (
    <IconBadge>
      <path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" />
      <path d="M3 7h18l-1.5 5.5A3 3 0 0 1 16.6 13a3 3 0 0 1-2.9-2 3 3 0 0 1-5.4 0 3 3 0 0 1-2.9 2 3 3 0 0 1-2.9-1.5L3 7Z" />
      <path d="M4 12v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8" />
    </IconBadge>
  );
}

function IconMarca() {
  return (
    <IconBadge>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </IconBadge>
  );
}

function IconGrupos() {
  return (
    <IconBadge>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </IconBadge>
  );
}

function IconVendedoras() {
  return (
    <IconBadge>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </IconBadge>
  );
}

function IconNiveis() {
  return (
    <IconBadge>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </IconBadge>
  );
}

export function CardMeta({
  card,
  metaAtiva,
  hojeIso,
}: {
  card: GoalCardView;
  metaAtiva: boolean;
  hojeIso?: string;
}) {
  const tipoLabel = card.tipo === "individual" ? "Individual" : "Grupo";
  return (
    <Card className="min-w-0 overflow-hidden" padding="lg">
      <CardTitle>{card.nome}</CardTitle>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Badge variant="neutral" className="gap-1">
          {card.tipo === "individual" ? <IconTipoIndividual /> : <IconTipoGrupo />}
          {tipoLabel}
        </Badge>
        <Badge variant="neutral" className="gap-1">
          <IconLoja />
          {card.lojaNome}
        </Badge>
        {card.marcas.map((m) => (
          <Badge key={m} variant="neutral" className="gap-1">
            <IconMarca />
            {m}
          </Badge>
        ))}
        {card.qtdGrupos > 0 ? (
          <Badge variant="neutral" className="gap-1">
            <IconGrupos />
            {card.qtdGrupos} {card.qtdGrupos === 1 ? "grupo" : "grupos"}
          </Badge>
        ) : null}
        <Badge variant="neutral" className="gap-1">
          <IconVendedoras />
          {card.qtdVendedoras} na equipe
        </Badge>
        <Badge variant="neutral" className="gap-1">
          <IconNiveis />
          {card.qtdNiveis} {card.qtdNiveis === 1 ? "nível" : "níveis"}
        </Badge>
      </div>

      <div className="mt-4">
        <FaixaMetaGlobal meta={card.faixa} embedded hideTitle degraus={card.degraus} hojeIso={hojeIso} />
      </div>

      <CardVendedoras
        embedded
        estado={card.vendedoras.length > 0 ? "disponivel" : "sem_dados"}
        lista={card.vendedoras}
        metaAtiva={metaAtiva}
        grupo={card.tipo === "grupo"}
      />
    </Card>
  );
}

/** Card único da Equipe: agrupa todas as metas ativas (projeção + escada). */
export function CardMetasEquipe({
  cards,
  metaAtiva,
}: {
  cards: GoalCardView[];
  metaAtiva: boolean;
}) {
  if (cards.length === 0) return null;
  return (
    <Card className="min-w-0 overflow-hidden" padding="lg">
      <div className="mb-4 flex items-center gap-1.5">
        <CardTitle>Metas da equipe</CardTitle>
        <TipHelp label="Metas ativas da competência: progresso, projeção (após 50% do período) e escada de premiação." />
      </div>
      <div className="flex flex-col gap-4">
        {cards.map((card) => (
          <CardMeta key={card.id} card={card} metaAtiva={metaAtiva} />
        ))}
      </div>
    </Card>
  );
}

/* ------------------------- Desafios ------------------------- */

function fmtMinimo(v: number, unidade: ChallengeView["unidade"], tipo: ChallengeView["tipo"]): string {
  if (tipo === "ticket" || tipo === "faturamento" || unidade === "R$") return brlK(v);
  if (tipo === "pa" || unidade === "x") return num(v, v % 1 !== 0 ? 2 : 0);
  return `${num(Math.round(v), 0)} un`;
}

export function BlocoDesafios({
  challenges,
  embedded = false,
}: {
  challenges: ChallengeView[];
  /** Sem Card externo (ex.: aba dentro do Ao vivo). */
  embedded?: boolean;
}) {
  if (challenges.length === 0) {
    const empty = (
      <EmptyState
        icon="🎯"
        title="Nenhum desafio nesta competência."
        description="Não há desafios cadastrados para o período atual."
      />
    );
    return embedded ? empty : <Card>{empty}</Card>;
  }

  const cards = challenges.map((d) => {
    const pctAgg = Math.min(100, d.progressoPct);
    const corAgg = progressColor(pctAgg);
    return (
    <div key={d.id} className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-vela-lg)] border border-line bg-bg-inset p-4 sm:p-5">
      <div className="mb-3.5 flex min-w-0 items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px]"
          style={{
            color: d.corIcone,
            backgroundColor: `color-mix(in srgb, ${d.corIcone} 18%, transparent)`,
          }}
          aria-hidden
        >
          <FlameIcon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-bold text-t0">{d.nome}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-t2">{d.lojaRotulo}</p>
        </div>
        <span className="shrink-0" title={d.janelaRotulo}>
          <Badge variant="neutral" className="gap-1">
            <IconRelogio />
            {d.prazoRotulo}
          </Badge>
        </span>
      </div>

      <p className="mb-3.5 line-clamp-2 text-[12.5px] leading-relaxed text-t1">{d.objetivo}</p>

      <div className="mb-3.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-t2">
        <span>
          Goal: <span className="font-bold text-t0">{d.metaRotulo}</span>
        </span>
        {d.temMinimo && d.minimo != null && (
          <span>
            Mínimo: <span className="font-bold text-t0">{fmtMinimo(d.minimo, d.unidade, d.tipo)}</span>
          </span>
        )}
        <span>
          Prêmio: <span className="font-bold text-t0">{brl(d.premio)}</span>
        </span>
        <span>
          Gerente: <span className="font-bold text-t0">{brl(d.premioGerente)}</span>
        </span>
      </div>

      {/* Só o que a barra mede (média no P.A./ticket; soma capped nas un). */}
      <div className="mb-1.5">
        <p className="font-mono text-[12.5px] font-bold tabular-nums text-t0">{d.progressoAgregadoRotulo}</p>
      </div>
      <div className="mb-3.5 flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <ProgressBar value={pctAgg} height={7} />
        </div>
        <span className="shrink-0 font-mono text-xs font-bold" style={{ color: corAgg }}>
          {num(pctAgg, 0)}%
        </span>
      </div>

      <div className="min-w-0 overflow-x-auto border-t border-line pt-3">
        <div
          className={cn(
            "min-w-[420px] space-y-2.5",
            !embedded && "max-h-[260px] overflow-y-auto",
          )}
        >
          {d.ranking.map((p, idx) => {
            const pct = Math.min(100, p.progressoPct);
            const cor = progressColor(pct);
            return (
            <div key={p.colaboradorId} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-[12px] font-extrabold text-t2">{idx + 1}º</span>
              <Avatar name={p.nome} size="xs" />
              <div className="min-w-[110px] flex-1">
                <p className="truncate text-[12.5px] font-semibold text-t0">{p.nome.split(" ")[0]}</p>
                <p className="truncate text-[10.5px] text-t2">
                  {p.grupo} · {lojaCurta(p.loja)}
                </p>
              </div>
              <span className="w-[88px] shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums text-t1">
                {p.progressoRotulo}
              </span>
              <div className="flex w-[110px] shrink-0 items-center gap-2">
                <div className="min-w-0 flex-1">
                  <ProgressBar value={pct} height={5} />
                </div>
                <span className="w-8 shrink-0 text-right font-mono text-[11px] font-bold" style={{ color: cor }}>
                  {num(pct, 0)}%
                </span>
              </div>
            </div>
            );
          })}
          {d.ranking.length === 0 && (
            <p className="py-3 text-center text-[12.5px] text-t2">Nenhuma participante nos filtros atuais.</p>
          )}
        </div>
      </div>
    </div>
    );
  });

  /** Ao vivo: 1 por linha + altura limitada com scroll. Equipe: 1 = largura total; 2+ = metade. */
  const grade = embedded ? (
    <div className="max-h-[min(520px,70vh)] min-w-0 space-y-4 overflow-x-hidden overflow-y-auto pr-1">{cards}</div>
  ) : (
    <div className={`grid min-w-0 grid-cols-1 gap-4 ${challenges.length >= 2 ? "md:grid-cols-2" : ""}`}>{cards}</div>
  );

  if (embedded) return grade;

  return (
    <Card padding="lg">
      <div className="mb-4 flex items-center gap-1.5">
        <CardTitle>Desafios da equipe</CardTitle>
        <TipHelp label="Mostra o progresso, o prazo e a premiação de cada desafio." />
      </div>
      {grade}
    </Card>
  );
}

/* ------------------------- Aviso de competência ------------------------- */

export function AvisoCompetencia({ texto, onVerMes }: { texto: string; onVerMes?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-[var(--radius-vela-lg)] border border-line bg-info-soft px-4 py-3 text-[13px] text-t0">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-info text-white">
        <ICONS.calendar size={14} />
      </span>
      <span className="min-w-0 flex-1">{texto}</span>
      {onVerMes && (
        <button type="button" onClick={onVerMes} className="shrink-0 text-[12.5px] font-bold text-acc hover:underline">
          Ver este mês
        </button>
      )}
    </div>
  );
}