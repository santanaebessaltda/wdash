import { StatCard } from "@/components/ui";
import { brlCent, num } from "@/data/wedash/engine/format";
import { sellerNumbers } from "@/data/wedash/sellerNumbers";
import type { SellerDay } from "@/data/wedash/engine/sellerHome";

const IconRevenue = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);
const IconSales = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);
const IconTicket = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
    <path d="M13 5v2M13 17v2M13 11v2" />
  </svg>
);
const IconPa = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const KPI_ICONS = [IconRevenue, IconSales, IconTicket, IconPa];

/** Comparação curta da tela do vendedor. O tooltip do gestor continua "Em relação a…". */
function sellerDeltaTip(delta: { vs?: string; previous?: string }): string {
  if (!delta.vs) return delta.previous ? `Período anterior: ${delta.previous}` : "";
  const raw = delta.vs.replace(/^(os|o|a)\s+/i, "");
  const label = raw.charAt(0).toUpperCase() + raw.slice(1);
  return delta.previous ? `${label}: ${delta.previous}` : label;
}

/** Mesma paleta da Visao geral e do Financeiro. */
const KPI_COLORS = [
  { iconColor: "var(--acc)", iconBg: "var(--acc-soft)" },
  { iconColor: "var(--warn)", iconBg: "rgba(245,158,11,0.12)" },
  { iconColor: "var(--ok)", iconBg: "var(--ok-soft)" },
  { iconColor: "var(--info)", iconBg: "rgba(59,130,246,0.12)" },
];

/** Faturamento, vendas, ticket e P.A. do vendedor no intervalo do seletor. */
export function NumbersCard({
  days,
  period,
  today,
}: {
  days: SellerDay[];
  period: { from: string; to: string };
  today: string;
}) {
  const singleToday = period.from === today && period.to === today;
  const n = sellerNumbers(days, period, today, singleToday ? "today" : "month");
  const pa = n.pa.value == null ? "—" : num(n.pa.value, 2);
  const cards: { label: string; value: string; delta?: (typeof n.revenue)["delta"]; tooltip?: string }[] = [
    { label: "Faturamento", value: brlCent(n.revenue.value ?? 0), delta: n.revenue.delta },
    { label: "Vendas", value: num(n.sales.value ?? 0, 0), delta: n.sales.delta },
    { label: "Ticket médio", value: brlCent(n.ticket.value ?? 0), delta: n.ticket.delta },
    {
      label: "P.A.",
      value: pa,
      delta: n.pa.delta,
      tooltip: n.pa.value == null ? "Não há dados suficientes para calcular o P.A. neste período." : undefined,
    },
  ];
  return (
    <div>
      <h2 className="mb-4 text-[15px] font-bold text-t0">Seus números</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((kpi, i) => {
          const Icon = KPI_ICONS[i] ?? IconRevenue;
          const c = KPI_COLORS[i % KPI_COLORS.length]!;
          return (
            <StatCard
              key={kpi.label}
              label={kpi.label}
              value={kpi.value}
              icon={<Icon />}
              iconColor={c.iconColor}
              iconBg={c.iconBg}
              delta={kpi.delta}
              deltaTooltip={kpi.delta ? sellerDeltaTip(kpi.delta) : undefined}
              tooltip={kpi.tooltip}
            />
          );
        })}
      </div>
    </div>
  );
}
