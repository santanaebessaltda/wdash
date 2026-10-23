import { paths } from "@/router/paths";
import type { Role } from "@/data/wedash/team";
import { isNavGroup, type NavEntry, type NavGroup, type NavSingle } from "./nav-config";

const ICON = {
  dashboard: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  analysis: "M3 3v18h18M18 9l-5 5-4-4-4 4",
  goal: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  tasks: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  ranking: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a2 2 0 0 0 0 4h3M17 6h3a2 2 0 0 1 0 4h-3",
  /** Lucide ChartNoAxesColumnIncreasing — Performance. */
  chart: "M5 21v-6M12 21V9M19 21V3",
  /** Ondas de transmissao  -  "ao vivo" / tempo real (nao raio). */
  live: "M4.9 19.1C1 15.2 1 8.8 4.9 4.9M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5M19.1 4.9C23 8.8 23 15.1 19.1 19M9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0",
  /** ClipboardList — pedido de compra. */
  order:
    "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM12 11h4M12 16h4M8 11h.01M8 16h.01",
  /** Cifrão — fechamento, sangrias e informe. */
  finance: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  /** Lucide Wallet — carteira da vendedora. */
  wallet: "M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h4v-4z",
  /** Lucide Plug — adquirente e administradora. */
  plug: "M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z",
  /** Lucide Settings — engrenagem. */
  gear: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0",
  /** Caixa  -  estoque. */
  stock: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96 12 12.01l8.73-5.05M12 22.08V12",
  /** Círculo com interrogação — Ajuda. */
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",
};

/** Saldo por local. Página direta, sem submenu. */
const stock: NavSingle = {
  label: "Estoque",
  icon: ICON.stock,
  to: paths.stock.inventory,
};

/** Pessoas da filial. Página direta, sem submenu. */
const team: NavSingle = {
  label: "Equipe",
  icon: ICON.team,
  to: paths.management.team,
};

/** Metas e desafios. */
const performance: NavGroup = {
  label: "Performance",
  description: "Administre as metas e os desafios da equipe.",
  icon: ICON.chart,
  items: [
    { label: "Metas", to: paths.goals },
    { label: "Desafios", to: paths.management.challenges },
  ],
};

/** Fechamento, sangrias, carteira e informe. A análise de margem continua em Dashboard > Financeiro. */
const finance: NavGroup = {
  label: "Financeiro",
  description: "Acompanhe o fechamento, as sangrias, a carteira e o informe de vendas.",
  icon: ICON.finance,
  items: [
    { label: "Fechamento", to: paths.management.cashClose },
    { label: "Sangrias", to: paths.management.cashDrop },
    { label: "Carteira", to: paths.management.wallet },
    { label: "Informe de vendas", to: paths.management.salesReport },
  ],
};

/** Card no pé do menu, fora da lista. Gestor, gerente e equipe. */
export const helpMenu = {
  label: "Ajuda",
  description: "Vídeos de como usar a WDash",
  action: "Assistir",
  icon: ICON.help,
  to: paths.help,
};

/** Saldo do pedido. Página direta, sem submenu. */
const purchaseOrder: NavSingle = {
  label: "Pedido de compra",
  icon: ICON.order,
  to: paths.management.purchaseOrder,
};

/** Adquirente e administradora da filial (só Gestor). */
const integrations: NavGroup = {
  label: "Integrações",
  description: "Conecte a adquirente e a administradora de cada filial.",
  icon: ICON.plug,
  items: [
    { label: "Adquirentes", to: paths.operation.acquirers },
    { label: "Administradora", to: paths.operation.shopping },
  ],
};

/** Dados da filial (só Gestor). */
const settings: NavGroup = {
  label: "Configurações",
  description: "Configure a filial, o funcionamento e os custos usados no resultado.",
  icon: ICON.gear,
  items: [
    { label: "Filial", to: paths.operation.branch },
    { label: "Funcionamento", to: paths.operation.hours },
    { label: "Royalties e marketing", to: paths.operation.royalties },
    { label: "Aluguel", to: paths.operation.rentPage },
    { label: "Custo dos produtos", to: paths.operation.productsTaxes },
  ],
};

/** Tira Shopping e Informe de vendas quando a filial selecionada não entra na regra. */
export function applyShoppingMenu(entries: NavEntry[], menu: { settings: boolean; report: boolean }): NavEntry[] {
  return entries.map((entry) => {
    if (!isNavGroup(entry)) return entry;
    return {
      ...entry,
      items: entry.items.filter((item) => {
        if (item.to === paths.operation.shopping) return menu.settings;
        if (item.to === paths.management.salesReport) return menu.report;
        return true;
      }),
    };
  });
}

/** Abas das telas de cada grupo = os mesmos itens do menu. */
export const performanceTabs = performance.items.map(({ label, to }) => ({ label, to }));
export const financeTabs = finance.items.map(({ label, to }) => ({ label, to }));
export const integrationTabs = integrations.items.map(({ label, to }) => ({ label, to }));
export const settingsTabs = settings.items.map(({ label, to }) => ({ label, to }));

const navOwner: NavEntry[] = [
  {
    label: "Dashboard",
    icon: ICON.dashboard,
    items: [
      { label: "Visão geral", to: paths.overview },
      { label: "Financeiro", to: paths.financial },
      { label: "Produtos", to: paths.products },
      { label: "Equipe", to: paths.team },
    ],
  },
  stock,
  team,
  performance,
  finance,
  purchaseOrder,
  integrations,
  settings,
];

/** Gerente: sem a análise financeira do Dashboard, sem Integrações e sem Configurações. */
const navManager: NavEntry[] = [
  {
    label: "Dashboard",
    icon: ICON.dashboard,
    items: [
      { label: "Visão geral", to: paths.overview },
      { label: "Produtos", to: paths.products },
      { label: "Equipe", to: paths.team },
    ],
  },
  stock,
  team,
  performance,
  finance,
  purchaseOrder,
];

/** Telas só do Gestor (análise financeira, Integrações, Configurações, ERP, Usuários, Logs). */
export const OWNER_ROLES: Role[] = ["OWNER", "ADMIN_GLOBAL"];

export function isOwner(role: Role): boolean {
  return OWNER_ROLES.includes(role);
}

const sellerNav: NavEntry[] = [
  { label: "Início", icon: ICON.dashboard, to: paths.seller.home },
  { label: "Carteira", icon: ICON.wallet, to: paths.seller.wallet },
];

export function navForRole(role: Role): NavEntry[] {
  switch (role) {
    case "SELLER":
      return sellerNav;
    case "MANAGER":
      return navManager;
    default:
      return navOwner;
  }
}
