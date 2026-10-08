import { lazyPage } from "@/lib/lazyPage";
import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { paths } from "@/router/paths";
import { RequireRole } from "@/session/RequireSession";
import { GESTOR_ROLES } from "@/layout/nav-wedash";
const AnalyticsDashboardPage = lazyPage(() => import("./AnalyticsDashboardPage"), "AnalyticsDashboardPage");
const SalesDashboardPage = lazyPage(() => import("./SalesDashboardPage"), "SalesDashboardPage");
const ProjectDashboardPage = lazyPage(() => import("./ProjectDashboardPage"), "ProjectDashboardPage");
const SaasDashboardPage = lazyPage(() => import("./SaasDashboardPage"), "SaasDashboardPage");
const BiDashboardPage = lazyPage(() => import("./BiDashboardPage"), "BiDashboardPage");
const FinancePage = lazyPage(() => import("./FinancePage"), "default");
const ProductsPage = lazyPage(() => import("./ProductsPage"), "default");
const OverviewPage = lazyPage(() => import("./OverviewPage"), "default");

/**
 * NOTE: paths.dashboards.{crm,ecommerce,finance,logistics} and the marketing
 * dashboard intentionally reuse the SAME url as their owning domain module
 * (e.g. /crm/dashboard is registered once, in pages/crm/routes.tsx, and the
 * "Dashboards" sidebar group just links to it). Only register the 5 dashboard
 * pages that don't already belong to another domain module here.
 */
export const dashboardsRoutes: RouteObject[] = [
  { path: paths.dashboards.analytics, element: <AnalyticsDashboardPage /> },
  { path: paths.dashboards.sales, element: <SalesDashboardPage /> },
  { path: paths.dashboards.projects, element: <ProjectDashboardPage /> },
  { path: paths.dashboards.saas, element: <SaasDashboardPage /> },
  { path: paths.dashboards.bi, element: <BiDashboardPage /> },
  { element: <RequireRole roles={GESTOR_ROLES} />, children: [{ path: paths.financial, element: <FinancePage /> }] },
  { path: paths.products, element: <ProductsPage /> },
  { path: paths.groups, element: <Navigate to={paths.overview} replace /> },
  { path: paths.overview, element: <OverviewPage /> },
  /* PT legacy  ->  EN */
  { path: paths.legacy.finance, element: <Navigate to={paths.financial} replace /> },
  { path: paths.legacy.products, element: <Navigate to={paths.products} replace /> },
  { path: paths.legacy.groups, element: <Navigate to={paths.overview} replace /> },
  { path: paths.legacy.shifts, element: <Navigate to={paths.overview} replace /> },
  { path: paths.legacy.overview, element: <Navigate to={paths.overview} replace /> },
];
