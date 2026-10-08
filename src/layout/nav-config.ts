import { paths } from "@/router/paths";

export type NavLeaf = {
  label: string;
  to: string;
  dot?: string;
  badge?: string;
};

export type NavGroup = {
  label: string;
  /** Dica ao passar o mouse no grupo. */
  description?: string;
  icon: string; // svg path "d"
  items: NavLeaf[];
};

export type NavSingle = {
  label: string;
  icon: string;
  to: string;
  badge?: string;
  /** Outras rotas que tambem devem acender esta entrada (ex.: abas de um mesmo modulo). */
  activePaths?: string[];
};

export type NavEntry = NavGroup | NavSingle;

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

const ICON = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  briefcase: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  dollar: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  hr: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  truck: "M1 3h15v13H1zM16 8h4l3 3v5h-7M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
  cart: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0",
  table: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18",
  chart: "M3 3v18h18M18 9l-5 5-4-4-4 4",
  layers: "M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  account: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  megaphone: "M3 11v2a1 1 0 0 0 1 1h3l4 4V6L7 10H4a1 1 0 0 0-1 1zM16 8a4 4 0 0 1 0 8",
  fileText: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9",
  life: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  star: "M12 2 15 9l7 .5-5.5 4.5 2 7-6.5-4-6.5 4 2-7L2 9.5 9 9z",
  boxes: "M4 4h6v6H4zM14 4h6v6h-6zM14 14h6v6h-6zM4 14h6v6H4z",
};

export const dashboardSubs: NavLeaf[] = [
  { label: "Analytics", to: paths.dashboards.analytics, dot: "var(--acc)" },
  { label: "CRM", to: paths.dashboards.crm, dot: "var(--info)" },
  { label: "Ecommerce", to: paths.dashboards.ecommerce, dot: "var(--ok)" },
  { label: "Finance", to: paths.dashboards.finance, dot: "var(--warn)" },
  { label: "Sales", to: paths.dashboards.sales, dot: "var(--bad)" },
  { label: "Marketing", to: paths.dashboards.marketing, dot: "var(--acc-2)" },
  { label: "Logistics", to: paths.dashboards.logistics, dot: "var(--info)" },
  { label: "Projects", to: paths.dashboards.projects, dot: "var(--ok)" },
  { label: "SaaS", to: paths.dashboards.saas, dot: "var(--acc)" },
  { label: "Business Intelligence", to: paths.dashboards.bi, dot: "var(--warn)" },
];

export const navGroups: NavEntry[] = [
  {
    label: "Apps",
    icon: ICON.boxes,
    items: [
      { label: "Chat", to: paths.apps.chat },
      { label: "Contacts", to: paths.apps.contacts },
      { label: "File Manager", to: paths.apps.fileManager },
      { label: "Notes", to: paths.apps.notes },
      { label: "Task Manager", to: paths.apps.taskManager },
      { label: "Help Desk", to: paths.apps.helpDesk },
      { label: "Group Chat", to: paths.apps.groupChat },
      { label: "Support Tickets", to: paths.apps.supportTickets },
      { label: "Email", to: paths.apps.email },
      { label: "Calendar", to: paths.apps.calendar },
    ],
  },
  {
    label: "User Management",
    icon: ICON.users,
    items: [
      { label: "All Users", to: paths.users.list },
      { label: "My Profile", to: paths.users.profile },
      { label: "Add User", to: paths.users.new },
      { label: "Roles", to: paths.users.roles },
      { label: "Permissions", to: paths.users.permissions },
      { label: "Teams", to: paths.users.teams },
      { label: "Departments", to: paths.users.departments },
      { label: "Activity Logs", to: paths.users.activityLogs },
    ],
  },
  {
    label: "Projects",
    icon: ICON.briefcase,
    items: [
      { label: "All Projects", to: paths.projects.list },
      { label: "Create Project", to: paths.projects.new },
      { label: "Timeline", to: paths.projects.timeline },
      { label: "Team Board", to: paths.projects.teamBoard },
      { label: "Sprint Board", to: paths.projects.sprintBoard },
      { label: "Gantt View", to: paths.projects.gantt },
      { label: "Project Analytics", to: paths.projects.analytics },
      { label: "Kanban View", to: paths.projects.kanban },
    ],
  },
  {
    label: "Finance",
    icon: ICON.dollar,
    items: [
      { label: "Transactions", to: paths.finance.transactions },
      { label: "Payments", to: paths.finance.payments },
      { label: "Expenses", to: paths.finance.expenses },
      { label: "Profit & Loss", to: paths.finance.profitLoss },
      { label: "Budget Management", to: paths.finance.budget },
      { label: "Invoices", to: paths.finance.invoices },
      { label: "Financial Reports", to: paths.finance.reports },
    ],
  },
  {
    label: "CRM",
    icon: ICON.users,
    items: [
      { label: "CRM Dashboard", to: paths.crm.dashboard },
      { label: "CRM App", to: paths.crm.app },
      { label: "Leads", to: paths.crm.leads },
      { label: "Opportunities", to: paths.crm.opportunities },
      { label: "Customers", to: paths.crm.customers },
      { label: "Deals Pipeline", to: paths.crm.dealsPipeline },
      { label: "Sales Funnel", to: paths.crm.salesFunnel },
      { label: "Campaigns", to: paths.crm.campaigns },
      { label: "Customer Journey", to: paths.crm.customerJourney },
    ],
  },
  {
    label: "HR Management",
    icon: ICON.hr,
    items: [
      { label: "Employees", to: paths.hr.employees },
      { label: "Attendance", to: paths.hr.attendance },
      { label: "Leave Requests", to: paths.hr.leaveRequests },
      { label: "Payroll", to: paths.hr.payroll },
      { label: "Departments", to: paths.hr.departments },
      { label: "Recruitment", to: paths.hr.recruitment },
      { label: "Job Applications", to: paths.hr.jobApplications },
    ],
  },
  {
    label: "Logistics",
    icon: ICON.truck,
    items: [
      { label: "Shipments", to: paths.logistics.shipments },
      { label: "Delivery Tracking", to: paths.logistics.deliveryTracking },
      { label: "Fleet Management", to: paths.logistics.fleet },
      { label: "Warehouse Management", to: paths.logistics.warehouse },
      { label: "Route Planning", to: paths.logistics.routePlanning },
    ],
  },
  {
    label: "Ecommerce",
    icon: ICON.cart,
    items: [
      { label: "Product Grid", to: paths.ecommerce.productGrid },
      { label: "Product List", to: paths.ecommerce.productList },
      { label: "Add Product", to: paths.ecommerce.productNew },
      { label: "Categories", to: paths.ecommerce.categories },
      { label: "Orders", to: paths.ecommerce.ordersList },
      { label: "Create Order", to: paths.ecommerce.orderNew },
      { label: "Customers", to: paths.ecommerce.customersList },
      { label: "Customer Analytics", to: paths.ecommerce.customerAnalytics },
      { label: "Reviews", to: paths.ecommerce.reviews },
      { label: "Inventory", to: paths.ecommerce.inventory },
      { label: "Coupons", to: paths.ecommerce.coupons },
      { label: "Wishlist", to: paths.ecommerce.wishlist },
      { label: "Promotions", to: paths.ecommerce.promotions },
    ],
  },
  {
    label: "Tables & Forms",
    icon: ICON.table,
    items: [
      { label: "Responsive Table", to: paths.tables.responsive },
      { label: "Filter Table", to: paths.tables.filter },
      { label: "Basic Table", to: paths.tables.basic },
      { label: "Data Table", to: paths.tables.data },
      { label: "Advanced Table", to: paths.tables.advanced },
      { label: "Form Elements", to: paths.forms.elements },
      { label: "Form Layouts", to: paths.forms.layouts },
      { label: "Form Validation", to: paths.forms.validation },
      { label: "Multi-Step Wizard", to: paths.forms.wizard },
      { label: "File Upload", to: paths.forms.fileUpload },
      { label: "Rich Text Editor", to: paths.forms.richText },
      { label: "Date Pickers", to: paths.forms.datePickers },
      { label: "Select Components", to: paths.forms.select },
      { label: "Input Masks", to: paths.forms.inputMasks },
    ],
  },
  {
    label: "Charts & Analytics",
    icon: ICON.chart,
    items: [
      { label: "Apex Charts", to: paths.charts.apex },
      { label: "Chart.js", to: paths.charts.chartjs },
      { label: "Statistics", to: paths.charts.statistics },
      { label: "KPI Analytics", to: paths.charts.kpi },
      { label: "Heatmaps", to: paths.charts.heatmaps },
      { label: "Revenue Analytics", to: paths.charts.revenue },
      { label: "User Analytics", to: paths.charts.userAnalytics },
    ],
  },
  {
    label: "Components",
    icon: ICON.layers,
    items: [
      { label: "Buttons", to: paths.components.tab("buttons") },
      { label: "Alerts", to: paths.components.tab("alerts") },
      { label: "Cards", to: paths.components.tab("cards") },
      { label: "Modals", to: paths.components.tab("modals") },
      { label: "Tabs", to: paths.components.tab("tabs") },
      { label: "Accordions", to: paths.components.tab("accordions") },
      { label: "Avatars", to: paths.components.tab("avatars") },
      { label: "Badges", to: paths.components.tab("badges") },
      { label: "Breadcrumbs", to: paths.components.tab("breadcrumbs") },
      { label: "Dropdowns", to: paths.components.tab("dropdowns") },
      { label: "Pagination", to: paths.components.tab("pagination") },
      { label: "Progress", to: paths.components.tab("progress") },
      { label: "Tooltips", to: paths.components.tab("tooltips") },
      { label: "Popovers", to: paths.components.tab("popovers") },
      { label: "Toasts", to: paths.components.tab("toasts") },
      { label: "Timeline", to: paths.components.tab("timeline") },
      { label: "Ratings", to: paths.components.tab("ratings") },
      { label: "Carousel", to: paths.components.tab("carousel") },
      { label: "Offcanvas", to: paths.components.tab("offcanvas") },
      { label: "Loaders", to: paths.components.tab("loaders") },
      { label: "Empty States", to: paths.components.tab("empty-states") },
    ],
  },
  {
    label: "Account",
    icon: ICON.account,
    items: [
      { label: "Profile", to: paths.account.tab("profile") },
      { label: "Settings", to: paths.account.tab("settings") },
      { label: "Security", to: paths.account.tab("security") },
      { label: "Billing", to: paths.account.tab("billing") },
      { label: "Notifications", to: paths.account.tab("notifications") },
      { label: "Connected Apps", to: paths.account.tab("connected-apps") },
      { label: "API", to: paths.account.tab("api") },
    ],
  },
  {
    label: "Marketing",
    icon: ICON.megaphone,
    items: [
      { label: "Overview", to: paths.marketing.tab("overview") },
      { label: "Email Campaigns", to: paths.marketing.tab("email") },
      { label: "SMS Campaigns", to: paths.marketing.tab("sms") },
      { label: "Landing Pages", to: paths.marketing.tab("landing-pages") },
      { label: "Segments", to: paths.marketing.tab("segments") },
      { label: "Analytics", to: paths.marketing.tab("analytics") },
    ],
  },
  {
    label: "Reports",
    icon: ICON.fileText,
    items: [
      { label: "Sales Report", to: paths.reports.tab("sales") },
      { label: "Revenue Report", to: paths.reports.tab("revenue") },
      { label: "Customer Report", to: paths.reports.tab("customer") },
      { label: "Project Report", to: paths.reports.tab("project") },
      { label: "Marketing Report", to: paths.reports.tab("marketing") },
      { label: "Custom Builder", to: paths.reports.tab("custom") },
    ],
  },
  {
    label: "Settings",
    icon: ICON.gear,
    items: [
      { label: "General", to: paths.settings.tab("general") },
      { label: "Company", to: paths.settings.tab("company") },
      { label: "Theme", to: paths.settings.tab("theme") },
      { label: "Appearance", to: paths.settings.tab("appearance") },
      { label: "Locale", to: paths.settings.tab("locale") },
      { label: "Notifications", to: paths.settings.tab("notifications") },
      { label: "Integrations", to: paths.settings.tab("integrations") },
      { label: "API", to: paths.settings.tab("api") },
    ],
  },
  {
    label: "Utility",
    icon: ICON.life,
    items: [
      { label: "FAQ", to: paths.utility.faq },
      { label: "Help Center", to: paths.utility.helpCenter },
      { label: "Knowledge Base", to: paths.utility.knowledgeBase },
      { label: "Documentation", to: paths.utility.documentation },
      { label: "Search Results", to: paths.utility.searchResults },
      { label: "Notifications Center", to: paths.utility.notifications },
      { label: "Activity Feed", to: paths.utility.activityFeed },
      { label: "Pricing", to: paths.pricing },
      { label: "Widget Gallery", to: paths.misc.widgetGallery },
      { label: "UI Playground", to: paths.misc.uiPlayground },
    ],
  },
  {
    label: "Pages",
    icon: ICON.file,
    items: [
      { label: "Theme Customizer", to: paths.misc.themeCustomizer },
      { label: "RTL / Dark / Light Preview", to: paths.misc.rtlPreview },
      { label: "Starter Kit", to: paths.misc.starterKit },
      { label: "Changelog", to: paths.misc.changelog },
      { label: "Roadmap", to: paths.misc.roadmap },
    ],
  },
  {
    label: "Premium",
    icon: ICON.star,
    items: [
      { label: "Release Notes", to: paths.misc.releaseNotes },
      { label: "Login", to: paths.auth.login },
      { label: "Login (Split)", to: paths.auth.loginSplit },
      { label: "Register", to: paths.auth.register },
      { label: "Register (Split)", to: paths.auth.registerSplit },
      { label: "Forgot Password", to: paths.auth.forgotPassword },
      { label: "404 Error", to: paths.auth.notFound },
      { label: "Maintenance", to: paths.auth.maintenance },
    ],
  },
];
