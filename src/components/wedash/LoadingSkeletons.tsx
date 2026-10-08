import type { ReactNode } from "react";
import { Card, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";

/*
 * Skeletons espelham o layout real de cada tela (mesmos cards, grades e paddings),
 * para a troca skeleton  ->  conteudo nao mexer na pagina.
 */

function Busy({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={className} aria-busy="true" aria-label="Carregando">
      {children}
    </div>
  );
}

const Pill = ({ className }: { className?: string }) => <Skeleton className={cn("h-6 w-14 rounded-full", className)} />;
const Title = ({ className }: { className?: string }) => <Skeleton className={cn("h-4 w-40", className)} />;

function Ring({ size, thickness }: { size: number; thickness: number }) {
  return (
    <div className="relative mx-auto shrink-0" style={{ width: size, height: size }}>
      <Skeleton className="h-full w-full rounded-full" />
      <div className="absolute rounded-full bg-bg-2" style={{ inset: thickness }} />
    </div>
  );
}

/* ---------------- Dashboard: pecas ---------------- */

/** Mesmo desenho do `StatCard`: icone + badge, rotulo, valor e sub. */
function StatCardSkeleton() {
  return (
    <Card className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-11 w-11 shrink-0 rounded-[13px]" />
        <Pill />
      </div>
      <Skeleton className="mt-4 h-3 w-24" />
      <Skeleton className="mt-2 h-7 w-36" />
      <Skeleton className="mt-1.5 h-3 w-28" />
    </Card>
  );
}

function KpiRowSkeleton() {
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Legendas " Realizado / R$ ..." do cabecalho dos graficos. */
function Legends({ n }: { n: number }) {
  return (
    <div className="mt-2.5 flex flex-wrap gap-5">
      {Array.from({ length: n }, (_, i) => (
        <div key={i}>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-1.5 h-5 w-28" />
        </div>
      ))}
    </div>
  );
}

const BAR_HEIGHTS = [72, 94, 58, 40, 66, 30, 50];

function BarsBody() {
  return (
    <div className="flex h-[220px] items-end gap-3">
      {BAR_HEIGHTS.map((h, i) => (
        <div key={i} className="flex h-full flex-1 flex-col justify-end gap-2">
          <Skeleton className="mx-auto h-2.5 w-3/4" />
          <div style={{ height: `${h}%` }}>
            <Skeleton className="h-full w-full rounded-b-none rounded-t-lg" />
          </div>
          <Skeleton className="mx-auto h-2.5 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** Card de grafico (`padding="lg"`): titulo + rotulo do eixo + legendas + badge + corpo. */
function ChartCardSkeleton({
  body,
  legends = 0,
  rotulo = true,
  bigValue = false,
  badge = true,
}: {
  body: "area" | "bars";
  legends?: number;
  rotulo?: boolean;
  bigValue?: boolean;
  badge?: boolean;
}) {
  return (
    <Card padding="lg">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Title />
          {rotulo && <Skeleton className="mt-2 h-3 w-24" />}
          {bigValue && <Skeleton className="mt-2.5 h-7 w-40" />}
          {legends > 0 && <Legends n={legends} />}
        </div>
        {badge && <Pill />}
      </div>
      {body === "area" ? <Skeleton className="h-[240px] w-full rounded-xl" /> : <BarsBody />}
    </Card>
  );
}

/** Rosca + legenda (Formas de pagamento, Curva ABC). */
function DonutCardSkeleton({ rows = 4, size = 160, withSub = false, lg = false }: { rows?: number; size?: number; withSub?: boolean; lg?: boolean }) {
  return (
    <Card className="flex flex-col" padding={lg ? "lg" : "md"}>
      <Title className="mb-4 w-36" />
      <div className="flex flex-1 flex-col justify-center px-4 pb-4">
        <div className="my-2">
          <Ring size={size} thickness={24} />
        </div>
        <div className={cn("mt-2 flex flex-col", withSub ? "gap-3" : "gap-2")}>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i}>
              <div className="flex items-center gap-2.5">
                <Skeleton className="h-2.5 w-2.5 shrink-0 rounded-[3px]" />
                <Skeleton className="h-3 w-24" />
                <span className="flex-1" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-7" />
              </div>
              {withSub && <Skeleton className="mt-1.5 ml-5 h-2.5 w-3/5" />}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/** Atingimento da meta: anel 150px + 4 linhas rotulo/valor. */
function GoalCardSkeleton() {
  return (
    <Card>
      <Title className="mb-4 w-44" />
      <div className="mb-4">
        <Ring size={150} thickness={15} />
      </div>
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Ranking de lojas: rosca 148px + caixas por loja (nome/valor, barra, % da rede). */
function StoreRankingSkeleton() {
  return (
    <Card className="flex flex-col">
      <Title className="mb-4 w-36" />
      <div className="flex flex-1 items-center justify-center py-2">
        <Ring size={148} thickness={20} />
      </div>
      <div className="mt-4 flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-xl bg-bg-inset p-3">
            <div className="mb-2 flex items-center gap-2">
              <Skeleton className="h-2.5 w-2.5 shrink-0 rounded-[4px]" />
              <Skeleton className="h-3.5 w-32" />
              <span className="flex-1" />
              <Skeleton className="h-3.5 w-24" />
            </div>
            <Skeleton className="mb-2 h-1.5 w-full rounded-full" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Destaques da equipe: posicao + avatar + nome/valor + linha de detalhe. */
function TeamHighlightsSkeleton() {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Title className="w-40" />
        <Pill className="w-12" />
      </div>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-5 shrink-0" />
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3.5 w-20" />
              </div>
              <Skeleton className="h-2.5 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Top produtos / Top linhas: # + avatar de iniciais + nome/codigo + 3 colunas numericas. */
function TopTableSkeleton({
  titleW = "w-32",
  rows = 5,
  search = false,
  variacao = false,
  className,
}: {
  titleW?: string;
  rows?: number;
  /** Busca no lugar do badge "Top 5" (Desempenho por produto). */
  search?: boolean;
  variacao?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Title className={titleW} />
        {search ? <Skeleton className="h-8 w-40 rounded-[var(--radius-vela-sm)] sm:w-56" /> : <Pill className="w-12" />}
      </div>
      <div className="overflow-x-auto">
        <div className={variacao ? "min-w-[620px]" : "min-w-[520px]"}>
          <div className="flex items-center gap-3 border-b border-line px-1 pb-3">
            <Skeleton className="h-2.5 w-3" />
            <Skeleton className="h-2.5 w-16" />
            <span className="flex-1" />
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-2.5 w-14" />
            {variacao && <Skeleton className="h-2.5 w-14" />}
          </div>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-line px-1 py-3 last:border-b-0">
              <Skeleton className="h-3 w-3" />
              <Skeleton className="h-9 w-9 shrink-0 rounded-[11px]" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3.5 w-3/5" />
                <Skeleton className="mt-1.5 h-2.5 w-16" />
              </div>
              <Skeleton className="h-3.5 w-14" />
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-3.5 w-10" />
              {variacao && <Skeleton className="h-3.5 w-10" />}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/** Custos da operacao: linhas rotulo/valor com divisoria; a ultima e o total. */
function CostListSkeleton() {
  return (
    <Card className="flex flex-col">
      <Title className="mb-4 w-40" />
      <div className="px-4 pb-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center justify-between border-b border-line py-3 last:border-b-0">
            <Skeleton className={cn("h-3.5", i === 5 ? "w-36" : "w-28", i > 0 && i < 5 && "ml-4")} />
            <Skeleton className={cn(i === 5 ? "h-4 w-28" : "h-3.5 w-24")} />
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Tabela larga em card `padding="none"` (Evolucao mensal, Desempenho por produto). */
function WideTableSkeleton({ cols, rows = 6, sub = false, actions = false }: { cols: number; rows?: number; sub?: boolean; actions?: boolean }) {
  return (
    <Card className="mt-4" padding="none">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Title className="w-44" />
          {sub && <Skeleton className="mt-2 h-3 w-28" />}
        </div>
        {actions && (
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-full rounded-[var(--radius-vela-sm)] sm:w-56" />
            <Skeleton className="h-8 w-28 shrink-0 rounded-[var(--radius-vela-sm)]" />
          </div>
        )}
      </div>
      <div className="overflow-x-auto p-4">
        <div style={{ minWidth: cols * 110 }}>
          <div className="grid gap-4 border-b border-line px-4 py-3" style={{ gridTemplateColumns: `1.6fr repeat(${cols - 1}, 1fr)` }}>
            {Array.from({ length: cols }, (_, c) => (
              <Skeleton key={c} className={cn("h-2.5 w-16", c > 0 && "justify-self-end")} />
            ))}
          </div>
          {Array.from({ length: rows }, (_, r) => (
            <div
              key={r}
              className="grid items-center gap-4 border-b border-line px-4 py-3.5 last:border-b-0"
              style={{ gridTemplateColumns: `1.6fr repeat(${cols - 1}, 1fr)` }}
            >
              {Array.from({ length: cols }, (_, c) => (
                <Skeleton key={c} className={cn("h-3.5", c === 0 ? "w-3/5" : "w-3/4 justify-self-end")} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ---------------- Dashboard: telas ---------------- */

/** Visao Geral. `weekdays` = card "Dias da semana x meta" (some em periodo de 1 dia). */
export function OverviewSkeleton({ weekdays = true }: { weekdays?: boolean }) {
  return (
    <Busy>
      <KpiRowSkeleton />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.6fr]">
        <GoalCardSkeleton />
        <ChartCardSkeleton body="area" legends={2} />
      </div>
      <div className={cn("mt-4 grid grid-cols-1 gap-4", weekdays && "lg:grid-cols-2")}>
        <ChartCardSkeleton body="bars" rotulo={false} />
        {weekdays && <ChartCardSkeleton body="bars" rotulo={false} legends={2} />}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StoreRankingSkeleton />
        <DonutCardSkeleton />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TeamHighlightsSkeleton />
        <TopTableSkeleton variacao />
      </div>
    </Busy>
  );
}

export function FinanceSkeleton() {
  return (
    <Busy>
      <KpiRowSkeleton />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCardSkeleton body="area" legends={3} />
        <ChartCardSkeleton body="area" legends={3} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CostListSkeleton />
        <DonutCardSkeleton />
      </div>
      <WideTableSkeleton cols={6} sub />
    </Busy>
  );
}

export function ProductsSkeleton() {
  return (
    <Busy>
      <KpiRowSkeleton />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCardSkeleton body="bars" rotulo={false} bigValue />
        <DonutCardSkeleton rows={3} withSub lg />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopTableSkeleton titleW="w-44" />
        <TopTableSkeleton variacao />
      </div>
      <TopTableSkeleton titleW="w-44" rows={8} search variacao className="mt-4" />
    </Busy>
  );
}

/** Estoque: card Produtos no formato do Desempenho por produto. */
export function StockProductsSkeleton() {
  return (
    <Busy>
      <TopTableSkeleton titleW="w-24" rows={10} variacao />
    </Busy>
  );
}

/** Inicio do vendedor: Seus numeros (Hoje | Este mes + 4 KPIs) e um card por loja com as abas e o podio. */
export function SellerHomeSkeleton({ stores = 1 }: { stores?: number }) {
  const count = Math.max(1, stores);
  const podium = [
    { circle: "h-16 w-16", bar: "h-36 sm:h-40", width: "w-[30%] max-w-[148px]" },
    { circle: "h-20 w-20", bar: "h-44 sm:h-48", width: "w-[34%] max-w-[168px]" },
    { circle: "h-16 w-16", bar: "h-28 sm:h-32", width: "w-[30%] max-w-[148px]" },
  ];
  return (
    <Busy className="flex flex-col gap-5">
      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-28" />
          <div className="flex gap-1.5">
            <Skeleton className="h-8 w-16 rounded-[9px]" />
            <Skeleton className="h-8 w-24 rounded-[9px]" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      </div>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} padding="lg" className="min-w-0">
          <Skeleton className="mb-4 h-4 w-44" />
          <div className="flex flex-wrap gap-2.5">
            <Skeleton className="h-[34px] w-24 rounded-[10px]" />
            <Skeleton className="h-[34px] w-28 rounded-[10px]" />
            <Skeleton className="h-[34px] w-20 rounded-[10px]" />
          </div>
          <Skeleton className="mt-4 mb-2 h-3 w-24" />
          <div className="flex items-end justify-center gap-2.5 pt-3 sm:gap-6">
            {podium.map((step) => (
              <div key={step.bar} className={cn("flex flex-col items-center", step.width)}>
                <Skeleton className={cn("rounded-full", step.circle)} />
                <Skeleton className="mt-2.5 h-3.5 w-16" />
                <Skeleton className="mt-1.5 h-2.5 w-14" />
                <Skeleton className="mt-1.5 h-3.5 w-20" />
                <Skeleton className={cn("mt-3 w-full rounded-t-2xl", step.bar)} />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </Busy>
  );
}

export function TeamSkeleton() {
  return (
    <Busy>
      <KpiRowSkeleton />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DonutCardSkeleton rows={3} withSub lg />
        <DonutCardSkeleton rows={2} withSub lg />
      </div>
      <WideTableSkeleton cols={9} rows={8} actions />
    </Busy>
  );
}

/* ---------------- Configuracoes ---------------- */

type TableCell = "person" | "text" | "short" | "pill" | "select" | "menu";

/** Mesmo desenho do `DataTable` (cabecalho uppercase + linhas px-4 py-3.5). */
function DataTableSkeleton({ cells, rows = 4, bare = false }: { cells: TableCell[]; rows?: number; bare?: boolean }) {
  return (
    <div className={cn("overflow-x-auto", !bare && "rounded-[var(--radius-vela-lg)] border border-line bg-bg-2", bare && "border-t border-line")}>
      <table className="w-full min-w-[640px] border-collapse">
        <thead>
          <tr className="border-b border-line">
            {cells.map((c, i) => (
              <th key={i} className="px-4 py-3 text-left">
                {c !== "menu" && <Skeleton className="h-2.5 w-14" />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r} className="border-b border-line last:border-b-0">
              {cells.map((c, i) => (
                <td key={i} className="px-4 py-3.5 align-middle">
                  {c === "person" ? (
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                      <div className="min-w-0 flex-1">
                        <Skeleton className="h-3.5 w-32" />
                        <Skeleton className="mt-1.5 h-3 w-40" />
                      </div>
                    </div>
                  ) : c === "pill" ? (
                    <Skeleton className="h-5 w-16 rounded-full" />
                  ) : c === "select" ? (
                    <Skeleton className="h-9 w-36 rounded-[var(--radius-vela-sm)]" />
                  ) : c === "menu" ? (
                    <Skeleton className="ml-auto h-7 w-7 rounded-lg" />
                  ) : (
                    <Skeleton className={cn("h-3", c === "short" ? "w-14" : "w-24")} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Pills do `Segmented` (h-8, cantos 9px). */
export function SegmentedSkeleton({ widths }: { widths: string[] }) {
  return (
    <div className="flex gap-1.5">
      {widths.map((w, i) => (
        <Skeleton key={i} className={cn("h-8 rounded-[9px]", w)} />
      ))}
    </div>
  );
}

/** Usuarios: pills (Pessoas / Convites pendentes) + tabela Nome  |  Papel  |  Lojas  |  Status  |  Ultimo acesso. */
export function UsersTableSkeleton() {
  return (
    <Busy>
      <SegmentedSkeleton widths={["w-24", "w-40"]} />
      <div className="mt-4">
        <DataTableSkeleton cells={["person", "pill", "text", "pill", "short", "menu"]} />
      </div>
    </Busy>
  );
}

/** Logs: mesmo desenho do `Timeline` (bolinha + linha vertical + frase + horario). */
export function TimelineSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Busy className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3.5">
          <div className="flex flex-col items-center">
            <Skeleton className="mt-1 h-7 w-7 shrink-0 rounded-full" />
            {i < rows - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
          </div>
          <div className="min-w-0 flex-1 pb-6">
            <Skeleton className={cn("h-3.5", i % 2 ? "w-2/5" : "w-3/5")} />
            <Skeleton className="mt-2 h-2.5 w-28" />
          </div>
        </div>
      ))}
    </Busy>
  );
}

/** Equipe da loja: tabela Nome  |  Codigo ERP  |  Status (+ Turno nos ativos). */
export function TeamTableSkeleton({ withShift = true, rows = 3 }: { withShift?: boolean; rows?: number }) {
  return (
    <Busy>
      <DataTableSkeleton bare rows={rows} cells={withShift ? ["person", "short", "pill", "select"] : ["person", "short", "pill"]} />
    </Busy>
  );
}

/** Metas: card da listagem (icone + nome/periodo + status  |  meta  |  barra  |  chips  |  avatares + botoes). */
export function GoalCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <Busy className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-2xl border border-line bg-bg-2 p-5 shadow-[var(--shadow-vela)]">
          <div className="mb-3.5 flex items-center gap-3.5">
            <Skeleton className="h-[50px] w-[50px] shrink-0 rounded-[14px]" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="mt-2 h-3 w-2/5" />
            </div>
            <div className="flex shrink-0 gap-1.5 self-start">
              <Skeleton className="h-7 w-7 rounded-lg" />
              <Skeleton className="h-7 w-7 rounded-lg" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="mt-2 h-[5px] w-full rounded-full" />
          <Skeleton className="mt-2 h-3 w-36" />
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex gap-1.5">
              <Pill className="w-24" />
              <Pill className="w-16" />
              <Pill className="w-16" />
            </div>
            <div className="flex -space-x-2">
              {Array.from({ length: 3 }, (_, j) => (
                <Skeleton key={j} className="h-8 w-8 rounded-full border-2 border-bg-2" />
              ))}
            </div>
          </div>
        </div>
      ))}
    </Busy>
  );
}

/** Detalhe da meta: resumo (icone + nome + numeros)  |  niveis com a barra de progresso  |  equipe. */
export function GoalDetailSkeleton() {
  return (
    <Busy>
      <Card padding="lg" className="mb-5">
        <div className="flex items-start gap-4">
          <Skeleton className="h-14 w-14 shrink-0 rounded-2xl" />
          <div className="flex-1">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="mt-2.5 h-3.5 w-64" />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3.5 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="mt-2 h-4 w-24" />
            </div>
          ))}
        </div>
      </Card>
      <div className="flex flex-col gap-4">
        <Card>
          <Title className="w-40" />
          <Skeleton className="mt-4 h-3 w-full rounded-full" />
          <div className="mt-2 flex justify-between">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-3 w-20" />
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-3">
                <Skeleton className="h-[26px] w-[26px] shrink-0 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="mt-1.5 h-3 w-56" />
                </div>
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <Title className="w-32" />
          <div className="mt-4 flex flex-col gap-3">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="ml-auto h-3.5 w-24" />
                <Skeleton className="hidden h-3.5 w-16 md:block" />
                <Skeleton className="hidden h-6 w-24 rounded-full md:block" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Busy>
  );
}

/** Desafios: card da listagem (icone + nome/periodo + botoes  |  lider  |  premio  |  prazo  |  chips). */
export function ChallengeCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <Busy className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-2xl border border-line bg-bg-2 p-5 shadow-[var(--shadow-vela)]">
          <div className="mb-3.5 flex items-center gap-3.5">
            <Skeleton className="h-[50px] w-[50px] shrink-0 rounded-[14px]" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="mt-2 h-3 w-2/5" />
            </div>
            <div className="flex shrink-0 gap-1.5 self-start">
              <Skeleton className="h-7 w-7 rounded-lg" />
              <Skeleton className="h-7 w-7 rounded-lg" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3.5 w-20" />
          </div>
          <Skeleton className="mt-2 h-3 w-28" />
          <div className="mt-4 flex gap-1.5">
            <Pill className="w-24" />
            <Pill className="w-20" />
            <Pill className="w-16" />
          </div>
        </div>
      ))}
    </Busy>
  );
}

/** Detalhe do desafio: resumo (icone + nome + numeros)  |  tabela de participantes. */
export function ChallengeDetailSkeleton() {
  return (
    <Busy>
      <Card padding="lg" className="mb-5">
        <div className="flex items-start gap-4">
          <Skeleton className="h-14 w-14 shrink-0 rounded-2xl" />
          <div className="flex-1">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="mt-2.5 h-3.5 w-64" />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3.5 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i}>
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="mt-2 h-4 w-24" />
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <Title className="w-32" />
        <div className="mt-4 flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-5 shrink-0" />
              <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="ml-auto h-3.5 w-20" />
              <Skeleton className="hidden h-3.5 w-14 md:block" />
              <Skeleton className="hidden h-6 w-28 rounded-full md:block" />
            </div>
          ))}
        </div>
      </Card>
    </Busy>
  );
}

/** Editor do desafio: cards Informacoes gerais  |  Metrica  |  Modo e premios. */
export function ChallengeEditorSkeleton() {
  return (
    <Busy className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
      {[3, 3, 4].map((campos, i) => (
        <Card key={i}>
          <Skeleton className="mb-5 h-4 w-36" />
          <div className="flex flex-col gap-4">
            {Array.from({ length: campos }, (_, j) => (
              <div key={j}>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-2 h-10 w-full rounded-xl" />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </Busy>
  );
}

/** Lojas: mesmo card da listagem (icone + fantasia/CNPJ + badge Filial  |  avatares + "N na equipe"). */
export function CardGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <Busy className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i}>
          <div className="mb-4 flex items-center gap-3">
            <Skeleton className="h-[46px] w-[46px] shrink-0 rounded-[13px]" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="mt-2 h-3 w-2/5" />
            </div>
            <Skeleton className="h-5 w-16 shrink-0 self-start rounded-full" />
          </div>
          <div className="flex min-h-8 items-center justify-between gap-3">
            <div className="flex -space-x-2">
              {Array.from({ length: 4 }, (_, j) => (
                <Skeleton key={j} className="h-8 w-8 rounded-full border-2 border-bg-2" />
              ))}
            </div>
            <Skeleton className="h-3 w-20" />
          </div>
        </Card>
      ))}
    </Busy>
  );
}

function CardHead({ sub = false, button = false }: { sub?: boolean; button?: boolean }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <Title className="w-32" />
        {sub && <Skeleton className="mt-2 h-3 w-52" />}
      </div>
      {button && <Skeleton className="h-8 w-24 rounded-[var(--radius-vela-sm)]" />}
    </div>
  );
}

function FieldSkeleton() {
  return (
    <div>
      <Skeleton className="mb-2 h-3 w-28" />
      <Skeleton className="h-10 w-full rounded-[var(--radius-vela-sm)]" />
    </div>
  );
}

/** Detalhe da loja: Funcionamento (fuso + 7 dias). */
export function StoreDetailSkeleton() {
  return (
    <Busy className="flex max-w-[720px] flex-col gap-5">
      <Card>
        <CardHead />
        <ScheduleSkeleton />
      </Card>
    </Busy>
  );
}

/** Fuso horario + 7 linhas de horario (Funcionamento da loja). */
function ScheduleSkeleton() {
  return (
    <>
      <FieldSkeleton />
      <Skeleton className="mt-4 mb-2 h-3 w-16" />
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex min-h-[44px] items-center gap-3 py-1">
          <Skeleton className="h-3.5 w-9 shrink-0 sm:w-24" />
          <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
          <span className="hidden w-12 sm:block" />
          <Skeleton className="h-9 w-24 rounded-[var(--radius-vela-sm)]" />
          <Skeleton className="h-9 w-24 rounded-[var(--radius-vela-sm)]" />
        </div>
      ))}
    </>
  );
}

/** Mesmo desenho do `StoreCardHeader`: icone 40px + fantasia + CNPJ (+ botao a direita). */
function StoreHeadSkeleton({ button = false, className }: { button?: boolean; className?: string }) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 items-center gap-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-[12px]" />
        <div className="min-w-0">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="mt-1.5 h-3 w-32" />
        </div>
      </div>
      {button && <Skeleton className="h-8 w-24 shrink-0 rounded-[var(--radius-vela-sm)]" />}
    </div>
  );
}

/** Resetar + Salvar alteracoes (`FormActions`). */
function FormActionsSkeleton() {
  return (
    <div className="flex gap-2.5 pt-1">
      <Skeleton className="h-10 w-[88px] rounded-[var(--radius-vela-md)]" />
      <Skeleton className="h-10 w-[148px] rounded-[var(--radius-vela-md)]" />
    </div>
  );
}

/** Linhas de turno: nome  |  inicio  -  fim  |  lixeira, + "Adicionar turno" e rodape do card. */
export function ShiftRowsSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
            <Skeleton className="h-9 min-w-0 flex-1 basis-full rounded-[var(--radius-vela-sm)] sm:basis-auto" />
            <Skeleton className="h-9 w-[80px] rounded-[var(--radius-vela-sm)] sm:w-[96px]" />
            <span className="text-t2">–</span>
            <Skeleton className="h-9 w-[80px] rounded-[var(--radius-vela-sm)] sm:w-[96px]" />
            <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
          </div>
        ))}
      </div>
      <Skeleton className="h-3.5 w-28" />
      <FormActionsSkeleton />
    </div>
  );
}

/**
 * Telas de Gestao / Configuracoes: 1 card por loja (icone + fantasia + CNPJ).
 * `fields` = grade de campos; `rows` = linhas editaveis (Custos); `shifts` = Turnos; `team` = Vendedores.
 */
export function StoreCardsSkeleton({
  count = 2,
  fields = 0,
  rows = 0,
  shifts = false,
  team = false,
  schedule = false,
  sections = 0,
  intro = false,
  wide = false,
}: {
  /** Linha de texto de apoio antes dos campos. */
  intro?: boolean;
  count?: number;
  fields?: number;
  rows?: number;
  shifts?: boolean;
  team?: boolean;
  /** Funcionamento: fuso + horario por dia. */
  schedule?: boolean;
  /** Texto de apoio + N secoes (titulo, apoio e 2 campos), ex.: Franquia por marca. */
  sections?: number;
  wide?: boolean;
}) {
  return (
    <Busy className={cn("flex flex-col gap-5", !wide && "max-w-[720px]")}>
      {Array.from({ length: count }, (_, c) =>
        team ? (
          <Card key={c} padding="none">
            <div className="px-5 pt-5 pb-4">
              <StoreHeadSkeleton button />
              <SegmentedSkeleton widths={["w-24", "w-32"]} />
            </div>
            <TeamTableSkeleton />
          </Card>
        ) : (
          <Card key={c}>
            <StoreHeadSkeleton />
            {shifts && <ShiftRowsSkeleton />}
            {schedule && <ScheduleSkeleton />}
            {sections > 0 && (
              <div className="flex flex-col gap-4">
                <Skeleton className="h-3 w-full max-w-[520px]" />
                {Array.from({ length: sections }, (_, s) => (
                  <div key={s} className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-20" />
                      <Skeleton className="h-3 w-72 max-w-full" />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <FieldSkeleton />
                      <FieldSkeleton />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {intro && <Skeleton className="mb-4 h-3 w-full max-w-[520px]" />}
            {fields > 0 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {Array.from({ length: fields }, (_, i) => (
                  <FieldSkeleton key={i} />
                ))}
              </div>
            )}
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="mb-2.5 flex items-center gap-3">
                <Skeleton className="h-9 flex-1 rounded-[var(--radius-vela-sm)]" />
                <Skeleton className="h-9 w-28 rounded-[var(--radius-vela-sm)]" />
              </div>
            ))}
          </Card>
        ),
      )}
    </Busy>
  );
}