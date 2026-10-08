import { Navigate, useRoutes, type RouteObject } from "react-router-dom";
import { AppShell } from "@/layout/AppShell";
import { AuthLayout } from "@/layout/AuthLayout";
import { paths } from "./paths";
import { NotFound } from "@/pages/auth/NotFound";
import { RequireSession } from "@/session/RequireSession";
import { useSession } from "@/session/SessionProvider";
import { destinationAfterAuth } from "@/session/authApi";
import { lazyPage } from "@/lib/lazyPage";

/* Produto */
import { acessoRoutes } from "@/pages/access/routes";
import { onboardingRoutes, syncingRoutes } from "@/pages/onboarding/routes";
import { dashboardRoutes } from "@/pages/dashboard/routes";
import { equipeRoutes } from "@/pages/team/routes";
import { metasRoutes } from "@/pages/goals/routes";
import { aoVivoRoutes } from "@/pages/live/routes";
import { emBreveRoutes } from "@/pages/coming-soon/routes";
import { managementRoutes } from "@/pages/management/routes";
import { cashCloseRoutes } from "@/pages/cash-close/routes";
import { stockRoutes } from "@/pages/stock/routes";
import { operationRoutes } from "@/pages/operation/routes";

/* Template Vela (referencia, acessivel por URL) */
import { dashboardsRoutes } from "@/pages/dashboards/routes";
import { usersRoutes } from "@/pages/users/routes";
import { projectsRoutes } from "@/pages/projects/routes";
import { ecommerceRoutes } from "@/pages/ecommerce/routes";
import { financeRoutes } from "@/pages/finance/routes";
import { crmRoutes } from "@/pages/crm/routes";
import { hrRoutes } from "@/pages/hr/routes";
import { logisticsRoutes } from "@/pages/logistics/routes";
import { appsRoutes } from "@/pages/apps/routes";
import { tablesRoutes } from "@/pages/tables/routes";
import { formsRoutes } from "@/pages/forms/routes";
import { chartsRoutes } from "@/pages/charts/routes";
import { componentsShowcaseRoutes } from "@/pages/components-showcase/routes";
import { accountRoutes } from "@/pages/account/routes";
import { marketingRoutes } from "@/pages/marketing/routes";
import { reportsRoutes } from "@/pages/reports/routes";
import { settingsRoutes } from "@/pages/settings/routes";
import { utilityRoutes } from "@/pages/utility/routes";
import { miscRoutes } from "@/pages/misc/routes";
import { authRoutes } from "@/pages/auth/routes";

const CreateAccess = lazyPage(() => import("@/pages/access/CreateAccess"), "CreateAccess");

/** Raiz: sem sessao  ->  login; com sessao  ->  senha temp  ->  onboarding  ->  app. */
function Raiz() {
  const { session, ready } = useSession();
  // PWA start_url = ./  -  sem esperar ready bounce pro login e "desloga".
  if (!ready) return null;
  if (!session) return <Navigate to={paths.access.login} replace />;
  return <Navigate to={destinationAfterAuth(session)} replace />;
}

const routeTree: RouteObject[] = [
  { path: paths.home, element: <Raiz /> },
  {
    element: <AuthLayout />,
    children: [...acessoRoutes, ...authRoutes],
  },
  {
    element: <RequireSession modo="create-access" />,
    children: [
      {
        element: <AuthLayout />,
        children: [{ path: paths.access.createAccess, element: <CreateAccess /> }],
      },
    ],
  },
  {
    element: <RequireSession modo="onboarding" />,
    children: [{ element: <AuthLayout />, children: [...onboardingRoutes] }],
  },
  {
    element: <RequireSession modo="app" />,
    children: [...syncingRoutes],
  },
  {
    element: <RequireSession modo="app" />,
    children: [
      {
        element: <AppShell />,
        children: [
          ...dashboardRoutes,
          ...equipeRoutes,
          ...aoVivoRoutes,
          ...metasRoutes,
          ...stockRoutes,
          ...cashCloseRoutes,
          ...managementRoutes,
          ...operationRoutes,
          ...settingsRoutes,
          ...emBreveRoutes,
          ...dashboardsRoutes,
          ...usersRoutes,
          ...projectsRoutes,
          ...ecommerceRoutes,
          ...financeRoutes,
          ...crmRoutes,
          ...hrRoutes,
          ...logisticsRoutes,
          ...appsRoutes,
          ...tablesRoutes,
          ...formsRoutes,
          ...chartsRoutes,
          ...componentsShowcaseRoutes,
          ...accountRoutes,
          ...marketingRoutes,
          ...reportsRoutes,
          ...utilityRoutes,
          ...miscRoutes,
        ],
      },
    ],
  },
  { path: "*", element: <NotFound /> },
];

export function AppRouter() {
  return useRoutes(routeTree);
}
