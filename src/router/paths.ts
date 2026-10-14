/**
 * ========================================================
 * Template Name: Vela  -  React Admin Dashboard Template
 * Author: elsayedB
 * License: You must have a valid license purchased only from ThemeForest
 * ========================================================
 */

/**
 * Canonical route path manifest for the whole app. Every page (all ~147
 * views from the source prototype) has exactly one entry here. Pages,
 * Sidebar links, breadcrumbs, and "view details" buttons must all resolve
 * paths through this object rather than hardcoding strings, so the app
 * never grows two different URLs for the same destination.
 */
export const paths = {
  home: "/",

  /* ---------- WDash (produto) ---------- */
  access: {
    login: "/login",
    forgot: "/forgot",
    /** Formulario OTP + nova senha (recovery). */
    reset: "/reset",
    invite: (token: string = ":token") => `/invite/${token}`,
    install: "/install",
    /** Primeiro acesso com senha temporaria = "Crie seu acesso" (nome, sobrenome e senha). */
    createAccess: "/create-access",
  },
  onboarding: "/onboarding",
  /** Pos-onboarding  -  aguarda SEED antes do Dashboard. */
  syncing: "/syncing",
  /** Entrada canonica do Dashboard = overview. `/dashboard` redireciona. */
  dashboard: "/dashboard",
  overview: "/dashboard/overview",
  /** WDash finance screen (template Vela uses `paths.finance.*`). */
  financial: "/dashboard/finance",
  products: "/dashboard/products",
  groups: "/dashboard/groups",
  team: "/dashboard/team",
  documents: "/documents",
  /** CRUD de metas, dentro de Gestão. `/goals` redireciona. */
  goals: "/management/goals",
  goalNew: "/management/goals/new",
  goalDetail: (id: string) => `/management/goals/${id}`,
  goalEdit: (id: string) => `/management/goals/${id}/edit`,
  /** Nova meta preenchida com a configuracao de outra (periodo seguinte). */
  goalCopy: (id: string) => `/management/goals/new?copy=${encodeURIComponent(id)}`,
  /** Nova meta com a mesma configuracao e datas, para escolher outra loja. */
  goalCopyStore: (id: string) => `/management/goals/new?copy=${encodeURIComponent(id)}&for=store`,
  /** Estoque: saldo em `/stock`. Pedido de compra fica em Gestão. URLs antigas redirecionam. */
  stock: {
    inventory: "/stock",
    legacyInventory: "/stock/inventory",
    purchaseOrder: "/stock/purchase-order",
    saleTables: "/stock/sale-tables",
    products: "/stock/products",
  },
  /** Gestao: todas as telas do grupo ficam em `/management`. */
  management: {
    team: "/management/team",
    purchaseOrder: "/management/purchase-order",
    challenges: "/management/challenges",
    challengeNew: "/management/challenges/new",
    challengeDetail: (id: string) => `/management/challenges/${id}`,
    challengeEdit: (id: string) => `/management/challenges/${id}/edit`,
    /** Novo desafio preenchido com a configuracao de outro (periodo seguinte). */
    challengeCopy: (id: string) => `/management/challenges/new?copy=${encodeURIComponent(id)}`,
    /** Novo desafio com a mesma configuracao e datas, para escolher outra loja. */
    challengeCopyStore: (id: string) => `/management/challenges/new?copy=${encodeURIComponent(id)}&for=store`,
    shifts: "/management/shifts",
    staff: "/management/staff",
    /** Calendário do fechamento de caixa. A adquirente fica em Configurações. */
    cashClose: "/management/cash-close",
    cashDrop: "/management/cash-drop",
    /** Calendário do informe de vendas no shopping. */
    salesReport: "/management/sales-report",
  },
  /** Configurações da filial em `/settings`. Custos, loja e equipe são URLs antigas. */
  operation: {
    costs: "/operation/costs",
    store: "/operation/store",
    franchise: "/operation/franchise",
    rent: "/operation/rent",
    /** Tipo, horário, franquia e aluguel. */
    branch: "/settings/branch",
    productsTaxes: "/settings/products-and-taxes",
    /** Stone de cada loja. Não fica em Integrações: a chave é da loja, não da empresa. */
    acquirers: "/settings/acquirers",
    /** Painel do shopping de cada quiosque. A senha é da filial. */
    shopping: "/settings/shopping",
    /** URL antiga. Abre Gestão > Equipe, onde o grupo é criado e administrado. */
    groups: "/operation/groups",
    sellers: "/operation/sellers",
  },
  /** Live  -  painel operacional do mes + pulso do dia. */
  live: {
    root: "/live",
    share: "/live/share",
    tv: "/live/tv",
  },
  analytics: "/analytics",
  seller: {
    home: "/home",
    myGoal: "/my-goal",
    tasks: "/tasks",
    ranking: "/ranking",
  },
  profile: "/profile",

  /** URLs antigas em PT  -  so para redirects. */
  legacy: {
    auth: {
      entrar: "/entrar",
      recuperar: "/recuperar",
      redefinir: "/redefinir",
      invite: "/convite/:token",
      instalar: "/instalar",
      trocarPassword: "/trocar-senha",
      changePassword: "/change-password",
      createPassword: "/create-password",
    },
    overview: "/dashboard/visao-geral",
    finance: "/dashboard/financeiro",
    products: "/dashboard/produtos",
    groups: "/dashboard/grupos",
    syncing: "/sincronizando",
    cashDrop: "/management/sangria",
    branch: "/operation/filial",
    operationBranch: "/operation/branch",
    operationProductsTaxes: "/operation/products-and-taxes",
    operationAcquirers: "/operation/acquirers",
    operationShopping: "/operation/shopping",
    team: "/dashboard/equipe",
    teamRoot: "/equipe",
    shifts: "/dashboard/turnos",
    store: "/loja",
    goals: "/metas",
    /** Metas antes de entrar em `/management/goals`. */
    goalsRoot: "/goals",
    goalsInSettings: "/configuracoes/metas",
    live: {
      root: "/ao-vivo",
      share: "/ao-vivo/compartilhar",
      tv: "/ao-vivo/tv",
    },
    analytics: "/analise",
    settings: {
      root: "/configuracoes",
      challenges: "/configuracoes/desafios",
      staff: "/configuracoes/colaboradores",
      groups: "/configuracoes/grupos-e-tarefas",
      shifts: "/configuracoes/turnos-e-tarefas",
      messages: "/configuracoes/mensagens",
      documents: "/configuracoes/documentos",
      costs: "/configuracoes/custos",
      erp: "/configuracoes/erp",
      cashClose: "/cash-close",
      cashCloseAcquirers: "/cash-close/acquirers",
      stores: "/configuracoes/lojas",
      users: "/configuracoes/usuarios",
    },
    seller: {
      myGoal: "/minha-meta",
      tasks: "/tarefas",
    },
    profile: "/perfil",
  },
  /* ---------- Template Vela (referencia) ---------- */

  dashboards: {
    analytics: "/dashboards/analytics",
    crm: "/crm/dashboard",
    ecommerce: "/ecommerce/dashboard",
    finance: "/finance/dashboard",
    sales: "/dashboards/sales",
    marketing: "/marketing",
    logistics: "/logistics/dashboard",
    projects: "/dashboards/projects",
    saas: "/dashboards/saas",
    bi: "/dashboards/bi",
  },

  users: {
    list: "/users",
    profile: "/users/profile",
    detail: (id: string | number = ":id") => `/users/${id}`,
    new: "/users/new",
    edit: (id: string | number = ":id") => `/users/${id}/edit`,
    roles: "/users/roles",
    permissions: "/users/permissions",
    teams: "/users/teams",
    departments: "/users/departments",
    activityLogs: "/users/activity-logs",
  },

  projects: {
    list: "/projects",
    detail: (id: string | number = ":id") => `/projects/${id}`,
    new: "/projects/new",
    edit: (id: string | number = ":id") => `/projects/${id}/edit`,
    task: (id: string | number = ":id") => `/projects/tasks/${id}`,
    timeline: "/projects/timeline",
    teamBoard: "/projects/team-board",
    sprintBoard: "/projects/sprint-board",
    gantt: "/projects/gantt",
    analytics: "/projects/analytics",
    kanban: "/projects/kanban",
  },

  orders: {
    overview: "/orders",
  },

  tables: {
    responsive: "/tables/responsive",
    filter: "/tables/filter",
    basic: "/tables/basic",
    data: "/tables/data",
    advanced: "/tables/advanced",
    editable: "/tables/editable",
  },

  forms: {
    elements: "/forms/elements",
    layouts: "/forms/layouts",
    validation: "/forms/validation",
    wizard: "/forms/wizard",
    fileUpload: "/forms/file-upload",
    richText: "/forms/rich-text-editor",
    datePickers: "/forms/date-pickers",
    select: "/forms/select-components",
    inputMasks: "/forms/input-masks",
  },

  charts: {
    apex: "/charts/apex-charts",
    chartjs: "/charts/chartjs",
    statistics: "/charts/statistics",
    kpi: "/charts/kpi-analytics",
    heatmaps: "/charts/heatmaps",
    revenue: "/charts/revenue-analytics",
    userAnalytics: "/charts/user-analytics",
  },

  pricing: "/pricing",

  apps: {
    chat: "/apps/chat",
    contacts: "/apps/contacts",
    contactDetail: (id: string | number = ":id") => `/apps/contacts/${id}`,
    fileManager: "/apps/file-manager",
    notes: "/apps/notes",
    taskManager: "/apps/task-manager",
    helpDesk: "/apps/help-desk",
    ticketDetail: (id: string | number = ":id") => `/apps/help-desk/${id}`,
    groupChat: "/apps/group-chat",
    supportTickets: "/apps/support-tickets",
    email: "/apps/email",
    calendar: "/apps/calendar",
  },

  ecommerce: {
    dashboard: "/ecommerce/dashboard",
    productGrid: "/products",
    productList: "/products/list",
    productDetail: (id: string | number = ":id") => `/products/${id}`,
    productNew: "/products/new",
    productEdit: (id: string | number = ":id") => `/products/${id}/edit`,
    categories: "/products/categories",
    ordersList: "/ecommerce/orders",
    orderDetail: (id: string | number = ":id") => `/ecommerce/orders/${id}`,
    orderNew: "/ecommerce/orders/new",
    customersList: "/ecommerce/customers",
    customerDetail: (id: string | number = ":id") => `/ecommerce/customers/${id}`,
    customerAnalytics: "/ecommerce/customer-analytics",
    reviews: "/ecommerce/reviews",
    inventory: "/ecommerce/inventory",
    coupons: "/ecommerce/coupons",
    wishlist: "/ecommerce/wishlist",
    promotions: "/ecommerce/promotions",
  },

  finance: {
    dashboard: "/finance/dashboard",
    transactions: "/finance/transactions",
    payments: "/finance/payments",
    expenses: "/finance/expenses",
    profitLoss: "/finance/profit-loss",
    budget: "/finance/budget",
    invoices: "/finance/invoices",
    invoiceDetail: (id: string | number = ":id") => `/finance/invoices/${id}`,
    invoiceNew: "/finance/invoices/new",
    invoiceEdit: (id: string | number = ":id") => `/finance/invoices/${id}/edit`,
    reports: "/finance/reports",
  },

  crm: {
    dashboard: "/crm/dashboard",
    app: "/crm/app",
    leads: "/crm/leads",
    leadDetail: (id: string | number = ":id") => `/crm/leads/${id}`,
    opportunities: "/crm/opportunities",
    customers: "/crm/customers",
    dealsPipeline: "/crm/deals-pipeline",
    salesFunnel: "/crm/sales-funnel",
    campaigns: "/crm/campaigns",
    customerJourney: "/crm/customer-journey",
  },

  hr: {
    employees: "/hr/employees",
    employeeDetail: (id: string | number = ":id") => `/hr/employees/${id}`,
    attendance: "/hr/attendance",
    leaveRequests: "/hr/leave-requests",
    payroll: "/hr/payroll",
    departments: "/hr/departments",
    recruitment: "/hr/recruitment",
    jobApplications: "/hr/job-applications",
  },

  logistics: {
    dashboard: "/logistics/dashboard",
    shipments: "/logistics/shipments",
    shipmentDetail: (id: string | number = ":id") => `/logistics/shipments/${id}`,
    deliveryTracking: "/logistics/delivery-tracking",
    fleet: "/logistics/fleet",
    warehouse: "/logistics/warehouse",
    routePlanning: "/logistics/route-planning",
  },

  components: {
    root: "/components",
    tab: (tab: string) => `/components/${tab}`,
  },

  account: {
    root: "/account",
    tab: (tab: string) => `/account/${tab}`,
  },

  marketing: {
    root: "/marketing",
    tab: (tab: string) => `/marketing/${tab}`,
  },

  reports: {
    root: "/reports",
    tab: (tab: string) => `/reports/${tab}`,
  },

  settings: {
    root: "/settings",
    tab: (tab: string) => `/settings/${tab}`,
    /** WDash app settings */
    challenges: "/settings/challenges",
    staff: "/settings/staff",
    groups: "/settings/groups-and-tasks",
    messages: "/settings/messages",
    documents: "/settings/documents",
    costs: "/settings/costs",
    erp: "/settings/erp",
    stores: "/settings/stores",
    storeDetail: (id: string) => `/settings/stores/${id}`,
    /** Erros e avisos do sync ERP (worker). */
    logs: "/settings/logs",
    users: "/settings/users",
    notifications: "/settings/notifications",
  },

  utility: {
    faq: "/utility/faq",
    helpCenter: "/utility/help-center",
    knowledgeBase: "/utility/knowledge-base",
    documentation: "/utility/documentation",
    searchResults: "/utility/search-results",
    notifications: "/utility/notifications",
    activityFeed: "/utility/activity-feed",
  },

  misc: {
    widgetGallery: "/pages/widget-gallery",
    uiPlayground: "/pages/ui-playground",
    themeCustomizer: "/pages/theme-customizer",
    rtlPreview: "/pages/rtl-preview",
    starterKit: "/pages/starter-kit",
    changelog: "/pages/changelog",
    roadmap: "/pages/roadmap",
    releaseNotes: "/pages/release-notes",
  },

  auth: {
    login: "/auth/login",
    loginSplit: "/auth/login-split",
    register: "/auth/register",
    registerSplit: "/auth/register-split",
    forgotPassword: "/auth/forgot-password",
    resetPassword: "/auth/reset-password",
    twoFactor: "/auth/two-factor",
    lockScreen: "/auth/lock-screen",
    verifyEmail: "/auth/verify-email",
    sessionTimeout: "/auth/session-timeout",
    maintenance: "/auth/maintenance",
    error: (code: string | number = ":code") => `/error/${code}`,
    notFound: "/404",
  },
} as const;
